<?php

namespace App\Modulos\Alm\Services;

use App\Models\User;
use App\Modulos\Alm\Services\Soporte as S;
use App\Modulos\Plt\Services\Periodos;
use App\Support\Events;
use App\Support\Params;
use App\Support\RuleError;
use Carbon\CarbonImmutable;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * La acción única de inventario (RN-ALM-01). Toda entrada y salida de stock pasa por mover():
 * valida las reglas y llama a alm_inventory_move() en la base, que es lo único que puede escribir
 * stock_balances y stock_movements. Firma publicada en docs/contratos.md.
 *
 *  RN-ALM-01  única puerta; kardex de solo inserción, se corrige con reversar().
 *  RN-ALM-02  venta, transferencia y consignación solo con lote liberado; venta solo desde un almacén que vende.
 *  RN-ALM-03  el saldo no queda negativo.
 *  RN-ALM-04  FEFO con vida mínima a la fecha de entrega; un lote vencido no sale para venta ni transferencia.
 *  RN-ALM-08  producto con lote no se mueve sin lote; el lote es de la misma variante.
 *  RN-ALM-09  lo reservado no se vende.
 *  RN-ALM-16  sin movimientos en un período cerrado.
 */
final class InventarioService
{
    public const TIPOS = ['RECEIPT', 'SALE', 'RETURN', 'TRANSFER_OUT', 'TRANSFER_IN', 'PRODUCTION_IN', 'PRODUCTION_OUT', 'ADJUSTMENT', 'WASTE', 'CONSIGNMENT_OUT', 'CONSIGNMENT_RETURN', 'REVERSAL'];

    /**
     * @param  array{type: string, warehouse_id: string, variant_id: string, lot_id?: ?string, qty: mixed, weight_kg?: mixed,
     *               unit_cost?: mixed, source_type: string, source_id?: ?string, reason: string, moved_at?: mixed,
     *               from_reserved?: bool, delivery_date?: ?string, company_id?: ?string, allow_unreleased?: bool, reversal_of?: ?string}  $m
     * @return array{moves: array<int, array>, total_cost: string, unit_cost: string}
     */
    public static function mover(array $m, User $quien): array
    {
        return DB::transaction(function () use ($m, $quien) {
            $tipo = (string) ($m['type'] ?? '');
            if (! in_array($tipo, self::TIPOS, true)) {
                RuleError::fail('RN-ALM-01', "Tipo de movimiento no válido: {$tipo}.");
            }
            $v = self::variante($m['variant_id'] ?? null);
            $w = self::almacen($m['warehouse_id'] ?? null);
            $cuando = isset($m['moved_at']) ? CarbonImmutable::parse($m['moved_at'])->setTimezone('America/Lima') : S::ahora();
            self::periodoAbierto($cuando, $w->company_id ?? ($m['company_id'] ?? null));
            if (trim((string) ($m['reason'] ?? '')) === '') {
                RuleError::fail('RN-ALM-01', 'Indica el motivo del movimiento.');
            }

            $q = S::q($m['qty'] ?? 0);
            $signo = in_array($tipo, S::ENTRADAS, true) ? 1 : (in_array($tipo, S::SALIDAS, true) ? -1 : ($q < 0 ? -1 : 1));
            $q = abs($q);
            if ($q < S::EPS) {
                RuleError::fail('RN-ALM-01', 'La cantidad debe ser mayor que cero.');
            }
            if ($tipo === 'SALE' && ! $w->allows_sale) {
                RuleError::fail('RN-ALM-02', "{$w->name} no permite vender: la venta sale de un almacén de venta.");
            }

            $lote = null;
            if (! empty($m['lot_id'])) {
                $lote = DB::table('lots')->where('id', $m['lot_id'])->first();
                if (! $lote || $lote->variant_id !== $v->id) {
                    RuleError::fail('RN-ALM-08', 'El lote '.($lote->code ?? '').' no es de '.$v->name.'.');
                }
            } elseif ($v->requires_lot && $signo > 0 && $tipo !== 'ADJUSTMENT') {
                RuleError::fail('RN-ALM-08', "{$v->name} se controla por lote: indica el lote.");
            }

            // Salida sin lote de un producto con lote: se reparte por FEFO entre los lotes que se pueden sacar.
            if ($signo < 0 && ! $lote && $v->requires_lot) {
                $partes = self::partesFefo($v, $w, $q, $tipo, $m);
                $res = ['moves' => [], 'total' => 0.0];
                foreach ($partes as [$loteFila, $cant]) {
                    $peso = isset($m['weight_kg']) ? S::q((float) $m['weight_kg'] * $cant / $q) : null;
                    $r = self::uno($tipo, -1, $cant, $peso, $v, $w, $loteFila, $m, $quien, $cuando);
                    $res['moves'][] = $r;
                    $res['total'] += abs((float) $r['total_cost']);
                }

                return ['moves' => $res['moves'], 'total_cost' => S::t($res['total'], 2), 'unit_cost' => S::t($res['total'] / $q, 4)];
            }

            $r = self::uno($tipo, $signo, $q, isset($m['weight_kg']) && $m['weight_kg'] !== '' ? abs(S::q($m['weight_kg'])) : null, $v, $w, $lote, $m, $quien, $cuando);

            return ['moves' => [$r], 'total_cost' => S::t(abs((float) $r['total_cost']), 2), 'unit_cost' => $r['unit_cost']];
        });
    }

    /** Corrige un movimiento con su contrario (REVERSAL). Un movimiento ya reversado no se reversa otra vez. */
    public static function reversar(string $movementId, string $motivo, User $quien): array
    {
        return DB::transaction(function () use ($movementId, $motivo, $quien) {
            $o = DB::table('stock_movements')->where('id', $movementId)->first() ?? RuleError::fail('RN-ALM-01', 'Movimiento no encontrado.');
            if (trim($motivo) === '') {
                RuleError::fail('RN-ALM-01', 'Reversar exige motivo.');
            }
            if ($o->movement_type === 'REVERSAL') {
                RuleError::fail('RN-ALM-01', 'Un reverso no se reversa: registra un movimiento nuevo.');
            }
            DB::select('SELECT pg_advisory_xact_lock(hashtext(?))', ['alm:rev:'.$o->id]);
            if (DB::table('stock_movements')->where('reversal_of', $o->id)->exists()) {
                RuleError::fail('RN-ALM-01', 'Ese movimiento ya fue reversado.');
            }

            return self::mover([
                'type' => 'REVERSAL', 'warehouse_id' => $o->warehouse_id, 'variant_id' => $o->variant_id, 'lot_id' => $o->lot_id,
                'qty' => -1 * (float) $o->qty, 'weight_kg' => $o->weight_kg !== null ? abs((float) $o->weight_kg) : null,
                'unit_cost' => $o->unit_cost, 'source_type' => $o->source_type, 'source_id' => $o->source_id,
                'reason' => 'Reverso: '.trim($motivo), 'reversal_of' => $o->id, 'allow_unreleased' => true,
            ], $quien);
        });
    }

    /** Saldo, reservado y disponible de una variante (en un almacén o lote, si se indica). */
    public static function disponible(string $variantId, ?string $warehouseId = null, ?string $lotId = null, bool $soloLiberado = true): array
    {
        $q = DB::table('stock_balances as b')->leftJoin('lots as l', 'l.id', '=', 'b.lot_id')->where('b.variant_id', $variantId)
            ->when($warehouseId, fn ($q) => $q->where('b.warehouse_id', $warehouseId))
            ->when($lotId, fn ($q) => $q->where('b.lot_id', $lotId));
        if ($soloLiberado) {
            $q->where(fn ($w) => $w->whereNull('b.lot_id')->orWhere(fn ($x) => $x->where('l.qc_status', 'RELEASED')->where('l.expiry_date', '>=', S::hoy()->toDateString())));
        }
        $r = $q->selectRaw('coalesce(sum(b.qty),0) qty, coalesce(sum(b.reserved_qty),0) res, coalesce(sum(b.weight_kg),0) peso')->first();

        return ['qty' => S::t($r->qty), 'reserved_qty' => S::t($r->res), 'available_qty' => S::t(max(0, $r->qty - $r->res)), 'weight_kg' => S::t($r->peso)];
    }

    /**
     * Lista FEFO de lo que se puede sacar (RN-ALM-02, RN-ALM-04): lotes liberados, vigentes y con vida
     * suficiente a la fecha de entrega, primero el que vence antes y luego la prioridad del almacén.
     *
     * @param  array{establishment_id?: string, warehouse_id?: string, delivery_date?: string, incluir_reservado?: bool}  $donde
     */
    public static function lotesDisponibles(string $variantId, array $donde = []): Collection
    {
        $entrega = isset($donde['delivery_date']) ? CarbonImmutable::parse($donde['delivery_date'], 'America/Lima')->startOfDay() : S::hoy();
        $minimo = (int) (Params::get('alm_min_days_left_on_delivery') ?? 1);
        $hoy = S::hoy()->toDateString();

        $q = DB::table('stock_balances as b')->join('warehouses as w', 'w.id', '=', 'b.warehouse_id')->leftJoin('lots as l', 'l.id', '=', 'b.lot_id')
            ->where('b.variant_id', $variantId)->where('b.qty', '>', S::EPS)->where('w.status', 'ACTIVE')
            ->where(fn ($x) => $x->whereNull('b.lot_id')->orWhere(fn ($y) => $y->where('l.qc_status', 'RELEASED')->where('l.expiry_date', '>=', $hoy)
                ->where('l.expiry_date', '>=', $entrega->addDays($minimo)->toDateString())));
        if (! empty($donde['warehouse_id'])) {
            $q->where('b.warehouse_id', $donde['warehouse_id']);
        } else {
            $q->where('w.allows_sale', true)->when($donde['establishment_id'] ?? null, fn ($x, $e) => $x->where('w.establishment_id', $e));
        }

        return $q->orderByRaw("coalesce(l.expiry_date, '9999-12-31')")->orderBy('w.pick_priority')->orderBy('b.id')
            ->get(['b.id as balance_id', 'b.warehouse_id', 'w.code as warehouse_code', 'b.lot_id', 'l.code as lot_code', 'l.expiry_date', 'b.qty', 'b.reserved_qty', 'b.weight_kg', 'b.avg_cost'])
            ->map(function ($r) use ($entrega, $donde) {
                $disp = S::q($r->qty - (empty($donde['incluir_reservado']) ? $r->reserved_qty : 0));

                return (object) [
                    'balance_id' => $r->balance_id, 'warehouse_id' => $r->warehouse_id, 'warehouse_code' => $r->warehouse_code,
                    'lot_id' => $r->lot_id, 'lot_code' => $r->lot_code, 'expiry_date' => $r->expiry_date ? substr($r->expiry_date, 0, 10) : null,
                    'days_left' => S::diasDeVida($r->expiry_date, $entrega), 'qty' => S::t($r->qty), 'reserved_qty' => S::t($r->reserved_qty),
                    'available_qty' => S::t($disp), 'weight_kg' => S::t($r->weight_kg), 'avg_cost' => S::t($r->avg_cost, 4),
                ];
            })->filter(fn ($r) => (float) $r->available_qty > S::EPS)->values();
    }

    /**
     * Traslado inmediato dentro del mismo local (TRANSFER_OUT + TRANSFER_IN al mismo costo). Entre
     * locales se usa TransferenciasService, que exige guía (RN-ALM-10).
     */
    public static function trasladar(array $t, User $quien, bool $permitirNoLiberado = false): array
    {
        return DB::transaction(function () use ($t, $quien, $permitirNoLiberado) {
            $de = self::almacen($t['from_warehouse_id'] ?? null);
            $a = self::almacen($t['to_warehouse_id'] ?? null);
            if ($de->id === $a->id) {
                RuleError::fail('RN-ALM-10', 'Elige un almacén de destino distinto del de origen.');
            }
            if ($de->establishment_id !== $a->establishment_id && $de->establishment_id && $a->establishment_id) {
                RuleError::fail('RN-ALM-10', "{$de->name} y {$a->name} son de locales distintos: usa una transferencia con guía de remisión.");
            }
            $base = ['variant_id' => $t['variant_id'], 'lot_id' => $t['lot_id'] ?? null, 'qty' => $t['qty'], 'weight_kg' => $t['weight_kg'] ?? null,
                'source_type' => $t['source_type'] ?? 'STOCK_TRANSFER', 'source_id' => $t['source_id'] ?? null, 'reason' => $t['reason'] ?? 'Traslado interno',
                'company_id' => $t['company_id'] ?? null];
            $out = self::mover($base + ['type' => 'TRANSFER_OUT', 'warehouse_id' => $de->id, 'allow_unreleased' => $permitirNoLiberado || ! empty($t['interno'])], $quien);
            $in = [];
            foreach ($out['moves'] as $mv) {
                $in = array_merge($in, self::mover(array_merge($base, [
                    'type' => 'TRANSFER_IN', 'warehouse_id' => $a->id, 'lot_id' => $mv['lot_id'], 'qty' => abs((float) $mv['qty']),
                    'weight_kg' => $mv['weight_kg'] !== null ? abs((float) $mv['weight_kg']) : null, 'unit_cost' => $mv['unit_cost'],
                ]), $quien)['moves']);
            }

            return ['out' => $out['moves'], 'in' => $in];
        });
    }

    /**
     * Reingresa lo que salió por un origen (SALE) y aún no volvió: al almacén de devoluciones del
     * local de la salida o, si no tiene, a su cámara de frío. Mismo lote y costo.
     *
     * @param  array<int, array{movement_id: string, qty: mixed, weight_kg?: mixed}>|null  $lineas
     */
    public static function devolver(string $sourceType, string $sourceId, string $motivo, User $quien, ?string $warehouseId = null, ?array $lineas = null): array
    {
        return DB::transaction(function () use ($sourceType, $sourceId, $motivo, $quien, $warehouseId, $lineas) {
            if (trim($motivo) === '') {
                RuleError::fail('RN-ALM-01', 'Devolver exige motivo.');
            }
            $salidas = DB::table('stock_movements')->where('source_type', $sourceType)->where('source_id', $sourceId)
                ->where('movement_type', 'SALE')->orderBy('moved_at')->get();
            if ($salidas->isEmpty()) {
                RuleError::fail('RN-ALM-03', 'No hay salidas de ese origen para devolver.');
            }
            // Lo ya devuelto por cada salida (los RETURN del mismo origen, por variante y lote).
            $devuelto = DB::table('stock_movements')->where('source_type', $sourceType)->where('source_id', $sourceId)->where('movement_type', 'RETURN')
                ->get()->groupBy(fn ($r) => $r->variant_id.'|'.$r->lot_id)->map(fn ($g) => (float) $g->sum('qty'));
            $pedido = $lineas ? collect($lineas)->keyBy('movement_id') : null;
            $moves = [];
            foreach ($salidas as $s) {
                $k = $s->variant_id.'|'.$s->lot_id;
                $salio = abs((float) $s->qty);
                $ya = min($salio, $devuelto[$k] ?? 0);
                $devuelto[$k] = ($devuelto[$k] ?? 0) - $ya;
                $pendiente = S::q($salio - $ya);
                $cant = $pedido ? S::q($pedido[$s->id]['qty'] ?? 0) : $pendiente;
                if ($cant < S::EPS) {
                    continue;
                }
                if ($cant > $pendiente + S::EPS) {
                    RuleError::fail('RN-ALM-03', 'No se devuelve más de lo que salió ('.S::t($pendiente).').');
                }
                $destino = $warehouseId ?? self::almacenDevoluciones($s->warehouse_id);
                $peso = $pedido && isset($pedido[$s->id]['weight_kg']) ? $pedido[$s->id]['weight_kg']
                    : ($s->weight_kg !== null ? abs((float) $s->weight_kg) * $cant / $salio : null);
                $moves = array_merge($moves, self::mover([
                    'type' => 'RETURN', 'warehouse_id' => $destino, 'variant_id' => $s->variant_id, 'lot_id' => $s->lot_id, 'qty' => $cant,
                    'weight_kg' => $peso, 'unit_cost' => $s->unit_cost, 'source_type' => $sourceType, 'source_id' => $sourceId, 'reason' => trim($motivo),
                ], $quien)['moves']);
            }
            if (! $moves) {
                RuleError::fail('RN-ALM-03', 'Lo que salió por ese origen ya se devolvió.');
            }

            return ['moves' => $moves];
        });
    }

    /* ---------------------------------------------------------------- internos */

    /** Un movimiento de un solo lote: validaciones de lote y disponible, y la función de la base. */
    private static function uno(string $tipo, int $signo, float $q, ?float $peso, object $v, object $w, ?object $lote, array $m, User $quien, CarbonImmutable $cuando): array
    {
        $interno = ! empty($m['allow_unreleased']);
        // Lo que sale del tránsito hacia el destino ya salió del origen con sus reglas.
        $comercial = in_array($tipo, S::SALIDAS_COMERCIALES, true) && $w->wh_type !== 'TRANSIT';
        if ($signo < 0 && $lote) {
            $vida = S::diasDeVida($lote->expiry_date, $cuando);
            if ($comercial || ! $interno) {
                if ($lote->qc_status !== 'RELEASED') {
                    RuleError::fail('RN-ALM-02', "El lote {$lote->code} está ".self::estado($lote->qc_status).': no se puede despachar hasta liberarlo.');
                }
            }
            if ($comercial && $vida !== null && $vida < 0) {
                RuleError::fail('RN-ALM-04', "El lote {$lote->code} venció el ".self::fecha($lote->expiry_date).': no sale para venta ni transferencia; regístralo como merma por vencido.');
            }
        }

        $reservado = 0.0;
        $peso = $peso !== null ? $peso : null;
        $bal = DB::table('stock_balances')->where('warehouse_id', $w->id)->where('variant_id', $v->id)
            ->when($lote, fn ($x) => $x->where('lot_id', $lote->id), fn ($x) => $x->whereNull('lot_id'))->first();
        if ($signo < 0) {
            $hay = (float) ($bal->qty ?? 0);
            $res = (float) ($bal->reserved_qty ?? 0);
            if ($hay + S::EPS < $q) {
                RuleError::fail('RN-ALM-03', "Stock insuficiente de {$v->name} en {$w->name}".($lote ? " (lote {$lote->code})" : '').': hay '.S::cant($hay, $v->sale_mode).' y se piden '.S::cant($q, $v->sale_mode).'.');
            }
            if (! empty($m['from_reserved'])) {
                $reservado = -min($q, $res);
            } elseif ($tipo === 'ADJUSTMENT' || $tipo === 'REVERSAL') {
                // Un conteo que encuentra menos de lo reservado deja el reservado igual al saldo nuevo.
                $reservado = -max(0, $res - ($hay - $q));
            } elseif ($hay - $res + S::EPS < $q) {
                RuleError::fail('RN-ALM-09', 'Solo hay '.S::cant(max(0, $hay - $res), $v->sale_mode)." disponibles de {$v->name} en {$w->name}: de ".S::cant($hay, $v->sale_mode).' en saldo, '.S::cant($res, $v->sale_mode).' están reservados para pedidos confirmados.');
            }
            if ($peso === null && $bal && $hay > 0) {
                $peso = $v->sale_mode === 'KG' ? $q : S::q((float) $bal->weight_kg * $q / $hay);
            }
        } elseif ($peso === null) {
            $peso = $v->sale_mode === 'KG' ? $q : ($v->nominal_weight_kg ? S::q($q * (float) $v->nominal_weight_kg) : null);
        }

        // La función de la base bloquea el saldo y vuelve a validar saldo y disponible (RN-ALM-03, 09).
        $chequeaDisponible = $signo < 0 && empty($m['from_reserved']) && ! in_array($tipo, ['ADJUSTMENT', 'REVERSAL'], true);
        $id = S::base(fn () => DB::selectOne('SELECT alm_inventory_move(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) AS id', [
            $tipo, $w->id, $v->id, $lote?->id, $signo * $q, $peso !== null ? $signo * abs($peso) : null,
            isset($m['unit_cost']) && $m['unit_cost'] !== '' ? (float) $m['unit_cost'] : null, $reservado,
            $m['source_type'] ?? 'MANUAL', $m['source_id'] ?? null, $cuando->toIso8601String(), mb_substr(trim((string) $m['reason']), 0, 255),
            $quien->id, mb_substr((string) $quien->name, 0, 255), $m['reversal_of'] ?? null, $chequeaDisponible,
        ])->id);

        $mv = DB::table('stock_movements')->where('id', $id)->first();
        Events::emit('stock.moved', 'stock_movements', $id, [
            'type' => $tipo, 'variant_id' => $v->id, 'warehouse_id' => $w->id, 'lot_id' => $lote?->id, 'qty' => S::t($mv->qty), 'total_cost' => S::t($mv->total_cost, 2),
        ]);

        return [
            'movement_id' => $id, 'warehouse_id' => $w->id, 'variant_id' => $v->id, 'lot_id' => $lote?->id,
            'qty' => S::t($mv->qty), 'weight_kg' => S::t($mv->weight_kg), 'unit_cost' => S::t($mv->unit_cost, 4),
            'total_cost' => S::t($mv->total_cost, 2), 'bal_qty' => S::t($mv->bal_qty),
        ];
    }

    /** Partes FEFO de una salida sin lote: [lote, cantidad]. Falla si no alcanza (RN-ALM-03). */
    private static function partesFefo(object $v, object $w, float $q, string $tipo, array $m): array
    {
        $interno = ! empty($m['allow_unreleased']) && ! in_array($tipo, S::SALIDAS_COMERCIALES, true);
        $hoy = S::hoy()->toDateString();
        $saldos = DB::table('stock_balances as b')->join('lots as l', 'l.id', '=', 'b.lot_id')
            ->where('b.warehouse_id', $w->id)->where('b.variant_id', $v->id)->where('b.qty', '>', S::EPS)
            ->when(! $interno, fn ($x) => $x->where('l.qc_status', 'RELEASED'))
            ->when(in_array($tipo, S::SALIDAS_COMERCIALES, true), fn ($x) => $x->where('l.expiry_date', '>=', $hoy))
            ->when(! empty($m['delivery_date']), fn ($x) => $x->where('l.expiry_date', '>=', CarbonImmutable::parse($m['delivery_date'])->addDays((int) (Params::get('alm_min_days_left_on_delivery') ?? 1))->toDateString()))
            ->orderBy('l.expiry_date')->orderBy('b.id')
            ->get(['b.qty', 'b.reserved_qty', 'l.*']);
        $falta = $q;
        $partes = [];
        foreach ($saldos as $s) {
            if ($falta < S::EPS) {
                break;
            }
            $libre = S::q($s->qty - (! empty($m['from_reserved']) || $tipo === 'ADJUSTMENT' ? 0 : $s->reserved_qty));
            $toma = min($falta, $libre);
            if ($toma < S::EPS) {
                continue;
            }
            $partes[] = [$s, S::q($toma)];
            $falta = S::q($falta - $toma);
        }
        if ($falta > S::EPS) {
            RuleError::fail('RN-ALM-03', "Stock insuficiente de {$v->name} en {$w->name}: faltan ".S::cant($falta, $v->sale_mode).' en lotes liberados y disponibles.');
        }

        return $partes;
    }

    /** RN-ALM-16 (RN-PLT-05): sin empresa conocida (almacén sin local) se exige que todas estén abiertas. */
    private static function periodoAbierto(CarbonImmutable $cuando, ?string $companyId): void
    {
        $empresas = $companyId ? [$companyId] : DB::table('companies')->pluck('id')->all();
        foreach ($empresas as $c) {
            try {
                Periodos::abierto($cuando, $c);
            } catch (RuleError $e) {
                RuleError::fail('RN-ALM-16', $e->getMessage());
            }
        }
    }

    public static function variante(?string $id): object
    {
        $v = $id ? DB::table('product_variants as v')->join('products as p', 'p.id', '=', 'v.product_id')->where('v.id', $id)
            ->first(['v.id', 'v.sku', 'v.name', 'v.sale_mode', 'v.nominal_weight_kg', 'v.std_cost', 'v.brand_id', 'v.status', 'v.product_id',
                'p.requires_lot', 'p.storage', 'p.line', 'p.name as product_name']) : null;

        return $v ?? RuleError::fail('RN-ALM-01', 'Producto no encontrado.');
    }

    public static function almacen(?string $id): object
    {
        $w = $id ? DB::table('warehouses as w')->leftJoin('establishments as e', 'e.id', '=', 'w.establishment_id')->where('w.id', $id)
            ->first(['w.*', 'e.company_id', 'e.name as establishment_name']) : null;
        if (! $w) {
            RuleError::fail('RN-ALM-01', 'Almacén no encontrado.');
        }
        if ($w->status !== 'ACTIVE') {
            RuleError::fail('RN-ALM-01', "{$w->name} está inactivo.");
        }

        return $w;
    }

    /** Almacén de devoluciones del local del almacén dado; sin él, su cámara de frío. */
    public static function almacenDevoluciones(string $warehouseId): string
    {
        $local = DB::table('warehouses')->where('id', $warehouseId)->value('establishment_id');
        foreach (['RETURNS', 'COLD_ROOM', 'MAIN'] as $tipo) {
            $id = DB::table('warehouses')->where('establishment_id', $local)->where('wh_type', $tipo)->where('status', 'ACTIVE')->orderBy('pick_priority')->value('id');
            if ($id) {
                return $id;
            }
        }

        return $warehouseId;
    }

    public static function estado(string $s): string
    {
        return ['QUARANTINE' => 'en cuarentena', 'RELEASED' => 'liberado', 'BLOCKED' => 'bloqueado', 'REJECTED' => 'rechazado', 'RECALLED' => 'retirado'][$s] ?? strtolower($s);
    }

    public static function fecha(?string $d): string
    {
        return $d ? CarbonImmutable::parse(substr($d, 0, 10))->format('d/m/Y') : '';
    }
}
