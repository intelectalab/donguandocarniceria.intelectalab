<?php

namespace App\Modulos\Alm\Services;

use App\Models\User;
use App\Modulos\Alm\Services\Soporte as S;
use App\Support\Access;
use App\Support\Params;
use App\Support\RuleError;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * Recepción con control de calidad mínimo (ALM-04).
 *  RN-ALM-05  se confirma solo con todas sus líneas controladas; cada línea aprobada crea su lote en
 *             CUARENTENA y entra al stock; la rechazada no entra.
 *  RN-ALM-06  refrigerado hasta alm_max_temp_chilled_c (4 °C), congelado hasta alm_max_temp_frozen_c
 *             (−18 °C); aspecto rechazado no se aprueba; una línea rechazada exige nota.
 */
final class RecepcionService
{
    public const ORIGENES = ['PURCHASE', 'FARM', 'PRODUCTION', 'CUSTOMER_RETURN', 'OTHER'];

    /** @param  array{warehouse_id: string, source_type: string, supplier_id?: ?string, supplier_doc?: ?string, received_at?: ?string, vehicle_temp_c?: mixed, lines: array}  $d */
    public static function crear(array $d, User $quien): object
    {
        self::puede($quien);

        return DB::transaction(function () use ($d, $quien) {
            $w = InventarioService::almacen($d['warehouse_id'] ?? null);
            if (! in_array($d['source_type'] ?? '', self::ORIGENES, true)) {
                RuleError::fail('RN-ALM-05', 'Elige el origen de la recepción.');
            }
            if (in_array($d['source_type'], ['PURCHASE', 'FARM'], true) && empty($d['supplier_id'])) {
                RuleError::fail('RN-ALM-05', 'Elige el proveedor o la granja.');
            }
            if (empty($d['lines'])) {
                RuleError::fail('RN-ALM-05', 'La recepción necesita al menos una línea.');
            }
            $id = DB::table('stock_receipts')->insertGetId([
                'number' => S::numero('stock_receipts', 'REC-'), 'warehouse_id' => $w->id, 'establishment_id' => $w->establishment_id,
                'source_type' => $d['source_type'], 'supplier_id' => $d['supplier_id'] ?? null, 'supplier_doc' => (string) ($d['supplier_doc'] ?? ''),
                'received_at' => $d['received_at'] ?? now(), 'vehicle_temp_c' => $d['vehicle_temp_c'] ?? null, 'status' => 'DRAFT', 'received_by' => $quien->id,
            ], 'id');
            self::guardarLineas($id, $d['lines']);

            return self::ver($id);
        });
    }

    /** Cambia las líneas de un borrador (el control de calidad se registra antes de confirmar). */
    public static function actualizar(string $id, array $d, User $quien): object
    {
        self::puede($quien);

        return DB::transaction(function () use ($id, $d) {
            $rc = self::borrador($id);
            $cambios = array_intersect_key($d, array_flip(['supplier_id', 'supplier_doc', 'vehicle_temp_c', 'received_at']));
            if ($cambios) {
                DB::table('stock_receipts')->where('id', $rc->id)->update($cambios + ['updated_at' => now()]);
            }
            if (isset($d['lines'])) {
                DB::table('stock_receipt_lines')->where('receipt_id', $rc->id)->delete();
                self::guardarLineas($rc->id, $d['lines']);
            }

            return self::ver($rc->id);
        });
    }

    /** Confirma: cada línea aprobada crea su lote en CUARENTENA y entra al stock (RN-ALM-05). */
    public static function confirmar(string $id, User $quien): array
    {
        self::puede($quien);

        return DB::transaction(function () use ($id, $quien) {
            $rc = self::borrador($id);
            $lineas = DB::table('stock_receipt_lines')->where('receipt_id', $rc->id)->orderBy('created_at')->orderBy('id')->get();
            foreach ($lineas as $l) {
                if ($e = self::revisarLinea($l)) {
                    RuleError::fail($e[0], $e[1]);
                }
            }
            $w = InventarioService::almacen($rc->warehouse_id);
            $origen = ['FARM' => 'FARM', 'CUSTOMER_RETURN' => 'RETURN', 'PRODUCTION' => 'PRODUCTION'][$rc->source_type] ?? 'PURCHASE';
            $lotes = [];
            $aceptadas = 0;
            foreach ($lineas as $l) {
                if ($l->qc_result !== 'PASS') {
                    continue;
                }
                $v = InventarioService::variante($l->variant_id);
                $loteId = null;
                if ($v->requires_lot) {
                    $prod = $l->production_date ? substr($l->production_date, 0, 10) : CarbonImmutable::parse($rc->received_at)->setTimezone('America/Lima')->toDateString();
                    $vence = $l->expiry_date ? substr($l->expiry_date, 0, 10) : self::venceSegunVida($v->product_id, $prod);
                    $lote = LotesService::crear([
                        'product_id' => $v->product_id, 'variant_id' => $v->id, 'code' => self::codigoLote($prod), 'origin' => $origen,
                        'supplier_id' => $rc->supplier_id, 'production_date' => $prod, 'expiry_date' => $vence, 'unit_cost' => $l->unit_cost,
                        'received_weight_kg' => $l->weight_kg,
                    ], $quien, "Recepción {$rc->number}");
                    $loteId = $lote->id;
                    $lotes[] = $lote->id;
                    DB::table('stock_receipt_lines')->where('id', $l->id)->update(['lot_id' => $loteId, 'updated_at' => now()]);
                }
                InventarioService::mover([
                    'type' => 'RECEIPT', 'warehouse_id' => $w->id, 'variant_id' => $v->id, 'lot_id' => $loteId, 'qty' => $l->qty,
                    'weight_kg' => $l->weight_kg, 'unit_cost' => $l->unit_cost, 'source_type' => 'STOCK_RECEIPT', 'source_id' => $rc->id,
                    'reason' => "Recepción {$rc->number}", 'moved_at' => $rc->received_at,
                ], $quien);
                $aceptadas++;
            }
            DB::table('stock_receipts')->where('id', $rc->id)->update(['status' => 'CONFIRMED', 'confirmed_at' => now(), 'confirmed_by' => $quien->id, 'updated_at' => now()]);

            return ['receipt' => self::ver($rc->id), 'lots' => $lotes, 'accepted' => $aceptadas, 'rejected' => $lineas->count() - $aceptadas];
        });
    }

    public static function anular(string $id, string $motivo, User $quien): object
    {
        self::puede($quien);
        if (mb_strlen(trim($motivo)) < 5) {
            RuleError::fail('RN-ALM-05', 'Anular exige motivo.');
        }

        return DB::transaction(function () use ($id, $motivo) {
            $rc = DB::table('stock_receipts')->where('id', $id)->lockForUpdate()->first() ?? RuleError::fail('RN-ALM-05', 'Recepción no encontrada.');
            if ($rc->status !== 'DRAFT') {
                RuleError::fail('RN-ALM-05', 'Solo se anula una recepción en borrador; una confirmada se corrige con merma o reverso.');
            }
            DB::table('stock_receipts')->where('id', $rc->id)->update(['status' => 'VOIDED', 'void_reason' => mb_substr(trim($motivo), 0, 255), 'updated_at' => now()]);

            return self::ver($rc->id);
        });
    }

    /** null si la línea está lista; si no, [regla, mensaje]. */
    public static function revisarLinea(object $l): ?array
    {
        $v = DB::table('product_variants as v')->join('products as p', 'p.id', '=', 'v.product_id')->where('v.id', $l->variant_id)
            ->first(['v.name', 'v.sale_mode', 'p.storage', 'p.requires_lot', 'p.shelf_life_days']);
        if (! $v) {
            return ['RN-ALM-05', 'Elige el producto de la línea.'];
        }
        if (! ((float) $l->qty > 0)) {
            return ['RN-ALM-05', "La cantidad de {$v->name} debe ser mayor que cero."];
        }
        if (! $l->qc_result || $l->qc_result === 'PENDING') {
            return ['RN-ALM-05', "La línea de {$v->name} no está controlada: márcala como aprobada o rechazada."];
        }
        if ($l->qc_result === 'FAIL') {
            return trim((string) $l->qc_notes) !== '' ? null : ['RN-ALM-06', "La línea rechazada de {$v->name} exige una nota con el motivo."];
        }
        $t = $l->product_temp_c !== null ? (float) $l->product_temp_c : null;
        foreach (['CHILLED' => ['alm_max_temp_chilled_c', 4, 'refrigerados'], 'FROZEN' => ['alm_max_temp_frozen_c', -18, 'congelados']] as $tipo => [$param, $def, $nombre]) {
            if ($v->storage !== $tipo) {
                continue;
            }
            $max = (float) (Params::get($param) ?? $def);
            if ($t === null) {
                return ['RN-ALM-06', "Registra la temperatura de {$v->name} (máximo {$max} °C para {$nombre})."];
            }
            if ($t > $max) {
                return ['RN-ALM-06', "{$v->name} llegó a ".number_format($t, 1, ',', '')." °C y el máximo para {$nombre} es {$max} °C: marca la línea como rechazada con nota."];
            }
        }
        if ($l->appearance === 'REJECTED') {
            return ['RN-ALM-06', "{$v->name} tiene aspecto rechazado: no se puede aprobar."];
        }
        if ($v->sale_mode !== 'UNIT' && ! ((float) $l->weight_kg > 0)) {
            return ['RN-ALM-05', "Registra el peso recibido de {$v->name}."];
        }
        if ($v->requires_lot && ! $l->expiry_date && ! $v->shelf_life_days) {
            return ['RN-ALM-05', "Registra el vencimiento de {$v->name}."];
        }

        return null;
    }

    public static function ver(string $id): object
    {
        $rc = DB::table('stock_receipts as r')->leftJoin('suppliers as s', 's.id', '=', 'r.supplier_id')->join('warehouses as w', 'w.id', '=', 'r.warehouse_id')
            ->where('r.id', $id)->first(['r.*', 's.trade_name as supplier_name', 'w.code as warehouse_code', 'w.name as warehouse_name']);
        $rc->lines = DB::table('stock_receipt_lines as l')->join('product_variants as v', 'v.id', '=', 'l.variant_id')->join('products as p', 'p.id', '=', 'v.product_id')
            ->leftJoin('lots as lo', 'lo.id', '=', 'l.lot_id')->where('l.receipt_id', $id)->orderBy('l.created_at')->orderBy('l.id')
            ->get(['l.*', 'v.sku', 'v.name as variant_name', 'v.sale_mode', 'p.storage', 'p.requires_lot', 'lo.code as lot_code'])
            ->map(function ($l) {
                $e = self::revisarLinea($l);
                $l->issue = $e ? ['code' => $e[0], 'message' => $e[1]] : null;

                return $l;
            });

        return $rc;
    }

    private static function guardarLineas(string $receiptId, array $lineas): void
    {
        foreach (array_values($lineas) as $i => $l) {
            DB::table('stock_receipt_lines')->insert([
                'receipt_id' => $receiptId, 'variant_id' => $l['variant_id'], 'qty' => S::q($l['qty'] ?? 0), 'weight_kg' => isset($l['weight_kg']) && $l['weight_kg'] !== '' ? S::q($l['weight_kg']) : null,
                'unit_cost' => S::q($l['unit_cost'] ?? 0, 2), 'expiry_date' => $l['expiry_date'] ?? null, 'production_date' => $l['production_date'] ?? null,
                'product_temp_c' => isset($l['product_temp_c']) && $l['product_temp_c'] !== '' ? (float) $l['product_temp_c'] : null,
                'appearance' => $l['appearance'] ?? 'OK', 'qc_result' => $l['qc_result'] ?? 'PENDING', 'qc_notes' => $l['qc_notes'] ?? null,
                'created_at' => now()->addMicroseconds($i),
            ]);
        }
    }

    private static function borrador(string $id): object
    {
        $rc = DB::table('stock_receipts')->where('id', $id)->lockForUpdate()->first() ?? RuleError::fail('RN-ALM-05', 'Recepción no encontrada.');
        if ($rc->status !== 'DRAFT') {
            RuleError::fail('RN-ALM-05', "La recepción {$rc->number} ya está ".($rc->status === 'CONFIRMED' ? 'confirmada' : 'anulada').'.');
        }

        return $rc;
    }

    private static function puede(User $quien): void
    {
        if (! Access::can($quien, 'alm.receipt.create')) {
            RuleError::fail('RN-ALM-05', 'No tienes el permiso alm.receipt.create para registrar recepciones.');
        }
    }

    private static function venceSegunVida(string $productId, string $produccion): string
    {
        $dias = (int) (DB::table('products')->where('id', $productId)->value('shelf_life_days') ?? 0);

        return CarbonImmutable::parse($produccion)->addDays(max(1, $dias))->toDateString();
    }

    /** «L261110-R001»: fecha de producción y correlativo del día en la empresa. */
    private static function codigoLote(string $produccion): string
    {
        $base = 'L'.CarbonImmutable::parse($produccion)->format('ymd').'-R';
        DB::select('SELECT pg_advisory_xact_lock(hashtext(?))', ['alm:lot:'.$base]);
        $n = DB::table('lots')->where('code', 'like', $base.'%')->count() + 1;

        return $base.str_pad((string) $n, 3, '0', STR_PAD_LEFT);
    }
}
