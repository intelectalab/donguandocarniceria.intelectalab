<?php

namespace App\Modulos\Alm\Services;

use App\Models\User;
use App\Modulos\Alm\Services\Soporte as S;
use App\Support\Access;
use App\Support\Params;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * Reservas por FEFO de los pedidos confirmados (RN-ALM-09). Recibe líneas genéricas: PED la
 * llamará al confirmar, al cancelar y al despachar. El reservado del saldo solo se cambia con
 * alm_reserve_adjust() (RN-ALM-01) y nunca supera el saldo (RN-ALM-03). Firma en docs/contratos.md.
 */
final class ReservasService
{
    public static function reservaAlConfirmar(?string $brandId = null): bool
    {
        return in_array(strtolower((string) (Params::get('alm_reserve_on_confirm', ['brand' => $brandId]) ?? 'true')), ['true', '1', 'si', 'sí'], true);
    }

    /**
     * @param  array{order_id: string, order_number: string, brand_id: string, establishment_id: string, delivery_date?: ?string,
     *               lines: array<int, array{line_id: string, variant_id: string, qty: mixed, weight_kg?: mixed, lot_id?: ?string}>}  $pedido
     */
    public static function reservar(array $pedido, User $quien): array
    {
        return DB::transaction(function () use ($pedido, $quien) {
            foreach (['order_id', 'order_number', 'brand_id', 'establishment_id'] as $k) {
                if (empty($pedido[$k])) {
                    RuleError::fail('RN-ALM-09', "Falta {$k} del pedido para reservar.");
                }
            }
            // Si ya tenía reservas, se recalcula desde cero.
            self::liberar($pedido['order_id'], 'Reserva recalculada', $quien);
            DB::select('SELECT pg_advisory_xact_lock(hashtext(?))', ['alm:res:'.$pedido['order_id']]);

            $entrega = $pedido['delivery_date'] ?? S::hoy()->toDateString();
            $reservas = [];
            $faltan = [];
            foreach ($pedido['lines'] ?? [] as $l) {
                $v = InventarioService::variante($l['variant_id'] ?? null);
                $necesito = S::q($l['qty'] ?? 0);
                if ($necesito < S::EPS) {
                    continue;
                }
                if (! empty($l['lot_id']) && DB::table('lots')->where('id', $l['lot_id'])->value('variant_id') !== $v->id) {
                    RuleError::fail('RN-ALM-08', "El lote indicado no es de {$v->name}.");
                }
                $candidatos = InventarioService::lotesDisponibles($v->id, ['establishment_id' => $pedido['establishment_id'], 'delivery_date' => $entrega])
                    ->when(! empty($l['lot_id']), fn ($c) => $c->where('lot_id', $l['lot_id']));
                foreach ($candidatos as $c) {
                    if ($necesito < S::EPS) {
                        break;
                    }
                    $toma = S::q(min($necesito, (float) $c->available_qty));
                    if ($toma < S::EPS) {
                        continue;
                    }
                    S::base(fn () => DB::select('SELECT alm_reserve_adjust(?, ?)', [$c->balance_id, $toma]));
                    $peso = $v->sale_mode === 'KG' ? $toma : (isset($l['weight_kg']) && (float) $l['qty'] > 0 ? S::q((float) $l['weight_kg'] * $toma / (float) $l['qty'])
                        : ($v->nominal_weight_kg ? S::q($toma * (float) $v->nominal_weight_kg) : null));
                    $id = DB::table('stock_reservations')->insertGetId([
                        'order_id' => $pedido['order_id'], 'order_number' => $pedido['order_number'], 'order_line_id' => $l['line_id'],
                        'balance_id' => $c->balance_id, 'warehouse_id' => $c->warehouse_id, 'variant_id' => $v->id, 'lot_id' => $c->lot_id,
                        'qty' => $toma, 'weight_kg' => $peso, 'status' => 'ACTIVE', 'brand_id' => $pedido['brand_id'],
                        'establishment_id' => $pedido['establishment_id'], 'delivery_date' => $entrega, 'reserved_at' => now(),
                    ], 'id');
                    $reservas[] = ['reservation_id' => $id, 'line_id' => $l['line_id'], 'balance_id' => $c->balance_id, 'warehouse_id' => $c->warehouse_id,
                        'lot_id' => $c->lot_id, 'lot_code' => $c->lot_code, 'expiry_date' => $c->expiry_date, 'qty' => S::t($toma), 'weight_kg' => S::t($peso)];
                    $necesito = S::q($necesito - $toma);
                }
                if ($necesito > S::EPS) {
                    $faltan[] = ['line_id' => $l['line_id'], 'variant_id' => $v->id, 'qty' => S::t($necesito)];
                }
            }

            return ['reservations' => $reservas, 'short' => $faltan];
        });
    }

    /** Libera las reservas activas del pedido (o de esas líneas). Devuelve cuántas liberó. */
    public static function liberar(string $orderId, string $motivo, User $quien, ?array $lineIds = null): int
    {
        return DB::transaction(function () use ($orderId, $motivo, $lineIds) {
            $filas = DB::table('stock_reservations')->where('order_id', $orderId)->where('status', 'ACTIVE')
                ->when($lineIds, fn ($q) => $q->whereIn('order_line_id', $lineIds))->orderBy('id')->get();
            foreach ($filas as $r) {
                self::cerrar($r, 'RELEASED', $motivo, null);
            }

            return $filas->count();
        });
    }

    /** ALM-10: liberación a mano, con permiso y motivo (RN-ALM-09). */
    public static function liberarManual(string $reservationId, string $motivo, User $quien): array
    {
        if (! Access::can($quien, 'alm.reservation.release')) {
            RuleError::fail('RN-ALM-09', 'No tienes el permiso alm.reservation.release para liberar reservas.');
        }
        if (mb_strlen(trim($motivo)) < 5) {
            RuleError::fail('RN-ALM-09', 'Liberar una reserva a mano exige motivo.');
        }

        return DB::transaction(function () use ($reservationId, $motivo, $quien) {
            $r = DB::table('stock_reservations')->where('id', $reservationId)->first() ?? RuleError::fail('RN-ALM-09', 'Reserva no encontrada.');
            if ($r->status !== 'ACTIVE') {
                RuleError::fail('RN-ALM-09', 'La reserva ya no está activa.');
            }
            self::cerrar($r, 'RELEASED', trim($motivo), $quien->id);

            return ['reservation' => DB::table('stock_reservations')->find($r->id),
                'short' => [['line_id' => $r->order_line_id, 'variant_id' => $r->variant_id, 'qty' => S::t($r->qty)]]];
        });
    }

    /**
     * Al despachar: las reservas activas pasan a salidas SALE que consumen lo reservado.
     *
     * @param  array<string, mixed>  $pesos  peso real por línea (line_id => kg), se prorratea entre sus reservas
     */
    public static function consumir(string $orderId, User $quien, array $pesos = []): array
    {
        return DB::transaction(function () use ($orderId, $quien, $pesos) {
            $filas = DB::table('stock_reservations')->where('order_id', $orderId)->where('status', 'ACTIVE')->orderBy('id')->get();
            if ($filas->isEmpty()) {
                RuleError::fail('RN-ALM-09', 'El pedido no tiene reservas activas para despachar.');
            }
            $porLinea = $filas->groupBy('order_line_id')->map(fn ($g) => (float) $g->sum('qty'));
            $moves = [];
            $salida = [];
            foreach ($filas as $r) {
                $peso = isset($pesos[$r->order_line_id]) ? S::q((float) $pesos[$r->order_line_id] * (float) $r->qty / $porLinea[$r->order_line_id]) : ($r->weight_kg !== null ? (float) $r->weight_kg : null);
                $mv = InventarioService::mover([
                    'type' => 'SALE', 'warehouse_id' => $r->warehouse_id, 'variant_id' => $r->variant_id, 'lot_id' => $r->lot_id,
                    'qty' => $r->qty, 'weight_kg' => $peso, 'from_reserved' => true, 'source_type' => 'SALES_ORDER', 'source_id' => $r->order_id,
                    'reason' => 'Despacho del pedido '.$r->order_number,
                ], $quien);
                DB::table('stock_reservations')->where('id', $r->id)->update(['status' => 'CONSUMED', 'closed_at' => now(), 'updated_at' => now()]);
                $moves = array_merge($moves, $mv['moves']);
                $salida[] = ['line_id' => $r->order_line_id, 'warehouse_id' => $r->warehouse_id, 'lot_id' => $r->lot_id, 'qty' => S::t($r->qty),
                    'weight_kg' => S::t($peso), 'movement_ids' => array_column($mv['moves'], 'movement_id')];
            }

            return ['moves' => $moves, 'stock_out' => $salida];
        });
    }

    /** Pedidos con reservas activas en un lote (para volver a reservarlos cuando el lote se bloquea). */
    public static function pedidosConLote(string $lotId): array
    {
        return DB::table('stock_reservations')->where('lot_id', $lotId)->where('status', 'ACTIVE')->distinct()->pluck('order_id')->all();
    }

    /** Vuelve a reservar un pedido con sus mismas líneas y cantidades (lo usa LotesService). */
    public static function rereservar(string $orderId, User $quien): ?array
    {
        $activas = DB::table('stock_reservations')->where('order_id', $orderId)->where('status', 'ACTIVE')->get();
        if ($activas->isEmpty()) {
            return null;
        }
        $f = $activas->first();
        $lineas = $activas->groupBy('order_line_id')->map(fn ($g, $lineId) => ['line_id' => $lineId, 'variant_id' => $g->first()->variant_id,
            'qty' => $g->sum('qty'), 'weight_kg' => $g->every(fn ($x) => $x->weight_kg !== null) ? $g->sum('weight_kg') : null])->values()->all();

        return self::reservar(['order_id' => $orderId, 'order_number' => $f->order_number, 'brand_id' => $f->brand_id,
            'establishment_id' => $f->establishment_id, 'delivery_date' => substr((string) $f->delivery_date, 0, 10), 'lines' => $lineas], $quien);
    }

    private static function cerrar(object $r, string $estado, string $motivo, ?string $quienId): void
    {
        S::base(fn () => DB::select('SELECT alm_reserve_adjust(?, ?)', [$r->balance_id, -1 * (float) $r->qty]));
        DB::table('stock_reservations')->where('id', $r->id)->update([
            'status' => $estado, 'released_reason' => mb_substr($motivo, 0, 255), 'closed_at' => now(), 'released_by' => $quienId, 'updated_at' => now(),
        ]);
    }
}
