<?php

namespace App\Modulos\Alm\Services;

use App\Models\User;
use App\Modulos\Alm\Services\Soporte as S;
use App\Support\Access;
use App\Support\Events;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * Estados del lote con historial (RN-ALM-07). ALM-06.
 *  QUARANTINE → RELEASED | BLOCKED | REJECTED
 *  RELEASED   → BLOCKED | RECALLED
 *  BLOCKED    → RELEASED | REJECTED | RECALLED
 *  REJECTED y RECALLED ya no cambian.
 * Liberar: alm.lot.release (fase 1, el almacenero, D-ALM-01; pasa a CALIDAD con CAL). Bloquear,
 * rechazar o retirar: alm.lot.block y motivo. Un lote vencido no se libera (RN-ALM-04).
 */
final class LotesService
{
    public const FLUJO = [
        'QUARANTINE' => ['RELEASED', 'BLOCKED', 'REJECTED'],
        'RELEASED' => ['BLOCKED', 'RECALLED'],
        'BLOCKED' => ['RELEASED', 'REJECTED', 'RECALLED'],
        'REJECTED' => [],
        'RECALLED' => [],
    ];

    /** @param  array{mover_a?: ?string}  $opciones */
    public static function cambiarEstado(string $lotId, string $estado, ?string $motivo, User $quien, array $opciones = []): array
    {
        return DB::transaction(function () use ($lotId, $estado, $motivo, $quien, $opciones) {
            $lot = DB::table('lots')->where('id', $lotId)->lockForUpdate()->first() ?? RuleError::fail('RN-ALM-07', 'Lote no encontrado.');
            $de = $lot->qc_status;
            $motivo = trim((string) $motivo);
            if (! in_array($estado, self::FLUJO[$de] ?? [], true)) {
                RuleError::fail('RN-ALM-07', "El lote {$lot->code} está ".InventarioService::estado($de).': no puede pasar a '.InventarioService::estado($estado)
                    .(in_array($de, ['REJECTED', 'RECALLED'], true) ? ' (un lote rechazado o retirado ya no cambia)' : '').'.');
            }
            if ($estado === 'RELEASED' && ! Access::can($quien, 'alm.lot.release')) {
                RuleError::fail('RN-ALM-07', 'No tienes el permiso alm.lot.release para liberar lotes.');
            }
            if ($estado !== 'RELEASED' && ! Access::can($quien, 'alm.lot.block')) {
                RuleError::fail('RN-ALM-07', 'No tienes el permiso alm.lot.block.');
            }
            if ($estado !== 'RELEASED' && mb_strlen($motivo) < 5) {
                RuleError::fail('RN-ALM-07', 'Bloquear, rechazar o retirar un lote exige motivo.');
            }
            $vida = S::diasDeVida($lot->expiry_date);
            if ($estado === 'RELEASED' && $vida !== null && $vida < 0) {
                RuleError::fail('RN-ALM-04', "El lote {$lot->code} venció el ".InventarioService::fecha($lot->expiry_date).': no se libera; regístralo como merma por vencido.');
            }

            $cambios = ['qc_status' => $estado, 'updated_at' => now()];
            $cambios += $estado === 'RELEASED'
                ? ['released_at' => now(), 'released_by' => mb_substr((string) $quien->name, 0, 255), 'block_reason' => null]
                : ['block_reason' => mb_substr($motivo, 0, 255)];
            DB::table('lots')->where('id', $lot->id)->update($cambios);
            DB::table('lot_status_changes')->insert([
                'lot_id' => $lot->id, 'from_status' => $de, 'to_status' => $estado,
                'reason' => mb_substr($motivo !== '' ? $motivo : 'Liberación tras control de calidad', 0, 255),
                'changed_at' => now(), 'changed_by' => $quien->id,
            ]);

            // Al liberar, su saldo en cuarentena pasa a un almacén del mismo local.
            $movidos = [];
            if ($estado === 'RELEASED' && ! empty($opciones['mover_a'])) {
                $saldos = DB::table('stock_balances as b')->join('warehouses as w', 'w.id', '=', 'b.warehouse_id')
                    ->where('b.lot_id', $lot->id)->where('b.qty', '>', S::EPS)->where('w.wh_type', 'QUARANTINE')->get(['b.*']);
                foreach ($saldos as $b) {
                    if ((float) $b->qty - (float) $b->reserved_qty < S::EPS) {
                        continue;
                    }
                    $movidos[] = InventarioService::trasladar([
                        'from_warehouse_id' => $b->warehouse_id, 'to_warehouse_id' => $opciones['mover_a'], 'variant_id' => $b->variant_id,
                        'lot_id' => $lot->id, 'qty' => $b->qty - $b->reserved_qty, 'weight_kg' => $b->weight_kg,
                        'source_type' => 'LOT_RELEASE', 'source_id' => $lot->id, 'reason' => "Liberación del lote {$lot->code}",
                    ], $quien);
                }
            }

            // Pedidos con reservas en un lote que deja de estar liberado: se vuelven a reservar por FEFO.
            $rereservados = [];
            if ($estado !== 'RELEASED') {
                foreach (ReservasService::pedidosConLote($lot->id) as $orderId) {
                    ReservasService::rereservar($orderId, $quien);
                    $rereservados[] = DB::table('stock_reservations')->where('order_id', $orderId)->value('order_number');
                }
            }

            $evento = $estado === 'RELEASED' ? 'lot.released' : ($estado === 'RECALLED' ? 'lot.recalled' : 'lot.blocked');
            Events::emit($evento, 'lots', $lot->id, ['code' => $lot->code, 'from' => $de, 'to' => $estado, 'reason' => $motivo ?: null]);

            return ['lot' => DB::table('lots')->find($lot->id), 'moved' => $movidos, 'rereserved' => array_values(array_unique($rereservados))];
        });
    }

    /** Crea un lote nuevo en cuarentena con su primer registro de historial (lo usa la recepción). */
    public static function crear(array $d, User $quien, string $motivo): object
    {
        $id = DB::table('lots')->insertGetId([
            'product_id' => $d['product_id'], 'variant_id' => $d['variant_id'], 'code' => $d['code'], 'origin' => $d['origin'],
            'supplier_id' => $d['supplier_id'] ?? null, 'production_date' => $d['production_date'] ?? null, 'expiry_date' => $d['expiry_date'],
            'qc_status' => 'QUARANTINE', 'unit_cost' => $d['unit_cost'] ?? 0, 'received_weight_kg' => $d['received_weight_kg'] ?? null,
            'supplier_lot_code' => $d['supplier_lot_code'] ?? null, 'created_by_user_id' => $quien->id, 'cost_basis' => $d['cost_basis'] ?? null,
        ], 'id');
        DB::table('lot_status_changes')->insert([
            'lot_id' => $id, 'from_status' => 'NEW', 'to_status' => 'QUARANTINE', 'reason' => mb_substr($motivo, 0, 255), 'changed_at' => now(), 'changed_by' => $quien->id,
        ]);

        return DB::table('lots')->find($id);
    }
}
