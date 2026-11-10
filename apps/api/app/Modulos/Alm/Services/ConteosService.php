<?php

namespace App\Modulos\Alm\Services;

use App\Models\User;
use App\Modulos\Alm\Services\Soporte as S;
use App\Support\Access;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * Conteos ciegos por almacén (ALM-08).
 *  RN-ALM-12  lo aprueba una persona distinta de quien contó (con alm.count.approve); al aprobar
 *             se ajustan las diferencias con movimientos ADJUSTMENT.
 */
final class ConteosService
{
    /** @param  array{warehouse_id: string, count_type?: string, blind?: bool, variant_ids?: array, notes?: ?string}  $d */
    public static function crear(array $d, User $quien): object
    {
        return DB::transaction(function () use ($d, $quien) {
            $w = InventarioService::almacen($d['warehouse_id'] ?? null);
            $saldos = DB::table('stock_balances')->where('warehouse_id', $w->id)->where('qty', '>', S::EPS)
                ->when(! empty($d['variant_ids']), fn ($q) => $q->whereIn('variant_id', $d['variant_ids']))->orderBy('variant_id')->orderBy('lot_id')->get();
            if ($saldos->isEmpty()) {
                RuleError::fail('RN-ALM-12', "{$w->name} no tiene saldos para contar.");
            }
            $id = DB::table('stock_counts')->insertGetId([
                'number' => S::numero('stock_counts', 'CNT-'), 'warehouse_id' => $w->id, 'establishment_id' => $w->establishment_id,
                'count_type' => in_array($d['count_type'] ?? 'CYCLE', ['CYCLE', 'SPOT', 'FULL'], true) ? ($d['count_type'] ?? 'CYCLE') : 'CYCLE',
                'status' => 'OPEN', 'blind' => (bool) ($d['blind'] ?? true), 'created_by' => $quien->id, 'notes' => $d['notes'] ?? null,
            ], 'id');
            foreach ($saldos as $b) {
                DB::table('stock_count_lines')->insert([
                    'count_id' => $id, 'variant_id' => $b->variant_id, 'lot_id' => $b->lot_id, 'system_qty' => $b->qty, 'system_weight_kg' => $b->weight_kg,
                ]);
            }

            return self::ver($id, $quien);
        });
    }

    public static function contar(string $lineId, mixed $qty, mixed $peso, User $quien): object
    {
        return DB::transaction(function () use ($lineId, $qty, $peso, $quien) {
            $l = DB::table('stock_count_lines')->where('id', $lineId)->first() ?? RuleError::fail('RN-ALM-12', 'Línea no encontrada.');
            $c = DB::table('stock_counts')->where('id', $l->count_id)->lockForUpdate()->first();
            if ($c->status !== 'OPEN') {
                RuleError::fail('RN-ALM-12', "El conteo {$c->number} ya no está abierto.");
            }
            if ($qty !== null && $qty !== '' && (float) $qty < 0) {
                RuleError::fail('RN-ALM-12', 'Lo contado no puede ser negativo; si no hay producto, registra 0.');
            }
            DB::table('stock_count_lines')->where('id', $l->id)->update([
                'counted_qty' => $qty === null || $qty === '' ? null : S::q($qty), 'counted_weight_kg' => $peso === null || $peso === '' ? null : S::q($peso),
                'counted_by' => $quien->id, 'updated_at' => now(),
            ]);

            return DB::table('stock_count_lines')->find($l->id);
        });
    }

    public static function cerrar(string $id, User $quien): object
    {
        return DB::transaction(function () use ($id, $quien) {
            $c = self::fila($id);
            if ($c->status !== 'OPEN') {
                RuleError::fail('RN-ALM-12', "El conteo {$c->number} ya no está abierto.");
            }
            $faltan = DB::table('stock_count_lines')->where('count_id', $c->id)->whereNull('counted_qty')->count();
            if ($faltan) {
                RuleError::fail('RN-ALM-12', "Faltan {$faltan} línea(s) por contar; si no hay producto, registra 0.");
            }
            DB::table('stock_counts')->where('id', $c->id)->update(['status' => 'COUNTED', 'counted_at' => now(), 'counted_by' => $quien->id, 'updated_at' => now()]);

            return self::ver($c->id, $quien);
        });
    }

    /** Aprueba y ajusta. Devuelve los ajustes [{line_id, qty, cost}]. */
    public static function aprobar(string $id, User $quien): array
    {
        return DB::transaction(function () use ($id, $quien) {
            $c = self::fila($id);
            if ($c->status !== 'COUNTED') {
                RuleError::fail('RN-ALM-12', "El conteo {$c->number} debe estar contado y cerrado para aprobarse.");
            }
            $contaron = DB::table('stock_count_lines')->where('count_id', $c->id)->whereNotNull('counted_by')->distinct()->pluck('counted_by')->push($c->counted_by)->filter()->unique();
            if ($contaron->contains($quien->id)) {
                RuleError::fail('RN-ALM-12', 'Aprueba una persona distinta de quien contó.');
            }
            if (! Access::can($quien, 'alm.count.approve')) {
                RuleError::fail('RN-ALM-12', 'No tienes el permiso alm.count.approve para aprobar conteos.');
            }
            $ajustes = [];
            foreach (DB::table('stock_count_lines')->where('count_id', $c->id)->orderBy('id')->get() as $l) {
                $dif = S::q((float) $l->counted_qty - (float) $l->system_qty);
                $cambios = ['diff_qty' => $dif, 'updated_at' => now()];
                if (abs($dif) > S::EPS) {
                    $pesoDif = $l->counted_weight_kg !== null && $l->system_weight_kg !== null ? S::q((float) $l->counted_weight_kg - (float) $l->system_weight_kg) : null;
                    $r = InventarioService::mover([
                        'type' => 'ADJUSTMENT', 'warehouse_id' => $c->warehouse_id, 'variant_id' => $l->variant_id, 'lot_id' => $l->lot_id, 'qty' => $dif,
                        'weight_kg' => $pesoDif !== null ? abs($pesoDif) : null, 'source_type' => 'STOCK_COUNT', 'source_id' => $c->id,
                        'reason' => "Ajuste del conteo {$c->number}", 'allow_unreleased' => true,
                    ], $quien);
                    $cambios['adjust_move_id'] = $r['moves'][0]['movement_id'];
                    $ajustes[] = ['line_id' => $l->id, 'qty' => S::t($dif), 'cost' => $r['total_cost']];
                }
                DB::table('stock_count_lines')->where('id', $l->id)->update($cambios);
            }
            DB::table('stock_counts')->where('id', $c->id)->update(['status' => 'APPROVED', 'approved_by' => $quien->id, 'approved_at' => now(), 'updated_at' => now()]);

            return $ajustes;
        });
    }

    public static function cancelar(string $id, string $motivo, User $quien): object
    {
        return DB::transaction(function () use ($id, $motivo, $quien) {
            $c = self::fila($id);
            if (! in_array($c->status, ['OPEN', 'COUNTED'], true)) {
                RuleError::fail('RN-ALM-12', 'Solo se cancela un conteo sin aprobar.');
            }
            if (mb_strlen(trim($motivo)) < 5) {
                RuleError::fail('RN-ALM-12', 'Cancelar exige motivo.');
            }
            DB::table('stock_counts')->where('id', $c->id)->update(['status' => 'CANCELLED', 'notes' => trim(($c->notes ? $c->notes.' · ' : '').'Cancelado: '.trim($motivo)), 'updated_at' => now()]);

            return self::ver($c->id, $quien);
        });
    }

    /** En un conteo ciego abierto, quien cuenta no ve el saldo del sistema. */
    public static function ver(string $id, User $quien): object
    {
        $c = DB::table('stock_counts as c')->join('warehouses as w', 'w.id', '=', 'c.warehouse_id')->leftJoin('users as u', 'u.id', '=', 'c.counted_by')
            ->leftJoin('users as a', 'a.id', '=', 'c.approved_by')->where('c.id', $id)
            ->first(['c.*', 'w.code as warehouse_code', 'w.name as warehouse_name', 'u.name as counted_by_name', 'a.name as approved_by_name'])
            ?? RuleError::fail('RN-ALM-12', 'Conteo no encontrado.');
        $ocultar = $c->blind && $c->status === 'OPEN' && ! Access::can($quien, 'alm.count.approve');
        $c->lines = DB::table('stock_count_lines as l')->join('product_variants as v', 'v.id', '=', 'l.variant_id')->leftJoin('lots as lo', 'lo.id', '=', 'l.lot_id')
            ->where('l.count_id', $id)->orderBy('v.sku')->orderBy('lo.code')
            ->get(['l.*', 'v.sku', 'v.name as variant_name', 'v.sale_mode', 'v.barcode', 'lo.code as lot_code', 'lo.expiry_date'])
            ->map(function ($l) use ($ocultar) {
                if ($ocultar) {
                    $l->system_qty = null;
                    $l->system_weight_kg = null;
                    $l->diff_qty = null;
                } elseif ($l->counted_qty !== null && $l->diff_qty === null) {
                    $l->diff_qty = S::t((float) $l->counted_qty - (float) $l->system_qty);
                }

                return $l;
            });
        $c->hidden_system = $ocultar;

        return $c;
    }

    private static function fila(string $id): object
    {
        return DB::table('stock_counts')->where('id', $id)->lockForUpdate()->first() ?? RuleError::fail('RN-ALM-12', 'Conteo no encontrado.');
    }
}
