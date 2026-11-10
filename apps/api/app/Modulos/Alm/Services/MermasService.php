<?php

namespace App\Modulos\Alm\Services;

use App\Models\User;
use App\Modulos\Alm\Services\Soporte as S;
use App\Support\Access;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * Mermas con motivo (ALM-09) y su catálogo de motivos (ALM-13).
 *  RN-ALM-13  descuenta stock solo al aprobarse; si su costo supera el umbral del motivo, la
 *             aprueba otra persona con alm.waste.approve. Regla del repo: quien pide no aprueba.
 *  RN-ALM-14  los motivos que lo exigen (cadena de frío, daño) necesitan foto.
 */
final class MermasService
{
    /** @param  array{warehouse_id: string, variant_id: string, lot_id?: ?string, reason_id: string, qty: mixed, weight_kg?: mixed, photo_url?: ?string, notes?: ?string}  $d */
    public static function registrar(array $d, User $quien): object
    {
        return DB::transaction(function () use ($d, $quien) {
            $motivo = DB::table('waste_reasons')->where('id', $d['reason_id'] ?? null)->where('status', 'ACTIVE')->first()
                ?? RuleError::fail('RN-ALM-13', 'Elige el motivo de la merma.');
            $v = InventarioService::variante($d['variant_id'] ?? null);
            $w = InventarioService::almacen($d['warehouse_id'] ?? null, $quien);
            if ($v->requires_lot && empty($d['lot_id'])) {
                RuleError::fail('RN-ALM-08', "{$v->name} se controla por lote: indica el lote.");
            }
            $lote = ! empty($d['lot_id']) ? DB::table('lots')->where('id', $d['lot_id'])->first() : null;
            if ($lote && $lote->variant_id !== $v->id) {
                RuleError::fail('RN-ALM-08', 'El lote no es de ese producto.');
            }
            $q = S::q($d['qty'] ?? 0);
            if ($q < S::EPS) {
                RuleError::fail('RN-ALM-13', 'La cantidad debe ser mayor que cero.');
            }
            if ($motivo->requires_photo && trim((string) ($d['photo_url'] ?? '')) === '') {
                RuleError::fail('RN-ALM-14', "El motivo «{$motivo->name}» exige foto: adjúntala antes de registrar.");
            }
            $b = DB::table('stock_balances')->where('warehouse_id', $w->id)->where('variant_id', $v->id)
                ->when($lote, fn ($x) => $x->where('lot_id', $lote->id), fn ($x) => $x->whereNull('lot_id'))->first();
            if (! $b || (float) $b->qty + S::EPS < $q) {
                RuleError::fail('RN-ALM-03', "En {$w->name} hay ".S::cant((float) ($b->qty ?? 0), $v->sale_mode)." de {$v->name}".($lote ? " (lote {$lote->code})" : '').': no se puede mermar '.S::cant($q, $v->sale_mode).'.');
            }
            $costo = S::q($q * ((float) $b->avg_cost ?: (float) $v->std_cost), 2);
            $id = DB::table('stock_waste_records')->insertGetId([
                'number' => S::numero('stock_waste_records', 'MER-'), 'warehouse_id' => $w->id, 'establishment_id' => $w->establishment_id,
                'variant_id' => $v->id, 'lot_id' => $lote?->id, 'reason_id' => $motivo->id, 'qty' => $q,
                'weight_kg' => isset($d['weight_kg']) && $d['weight_kg'] !== '' ? S::q($d['weight_kg']) : ($v->sale_mode === 'KG' ? $q : null),
                'estimated_cost' => $costo, 'photo_url' => $d['photo_url'] ?? null, 'notes' => $d['notes'] ?? null, 'status' => 'PENDING',
                'requested_by' => $quien->id, 'requested_at' => now(),
            ], 'id');

            return self::ver($id);
        });
    }

    public static function necesitaOtro(object $merma): bool
    {
        $umbral = (float) (DB::table('waste_reasons')->where('id', $merma->reason_id)->value('approval_above_pen') ?? 100);

        return (float) $merma->estimated_cost > $umbral;
    }

    public static function aprobar(string $id, User $quien): object
    {
        return DB::transaction(function () use ($id, $quien) {
            $m = self::pendiente($id);
            $motivo = DB::table('waste_reasons')->find($m->reason_id);
            if ($m->requested_by === $quien->id) {
                RuleError::fail('RN-ALM-13', self::necesitaOtro($m)
                    ? "La merma {$m->number} cuesta S/ ".number_format((float) $m->estimated_cost, 2).' y supera el umbral del motivo (S/ '.number_format((float) $motivo->approval_above_pen, 2).'): la aprueba otra persona.'
                    : 'Quien registra la merma no la aprueba: la aprueba otra persona.');
            }
            if (self::necesitaOtro($m) && ! Access::can($quien, 'alm.waste.approve')) {
                RuleError::fail('RN-ALM-13', 'La merma supera el umbral de S/ '.number_format((float) $motivo->approval_above_pen, 2).': se necesita el permiso alm.waste.approve.');
            }
            $r = InventarioService::mover([
                'type' => 'WASTE', 'warehouse_id' => $m->warehouse_id, 'variant_id' => $m->variant_id, 'lot_id' => $m->lot_id, 'qty' => $m->qty,
                'weight_kg' => $m->weight_kg, 'source_type' => 'STOCK_WASTE', 'source_id' => $m->id, 'reason' => "Merma {$m->number}: {$motivo->name}",
                'allow_unreleased' => true,
            ], $quien);
            DB::table('stock_waste_records')->where('id', $m->id)->update([
                'status' => 'APPROVED', 'approved_by' => $quien->id, 'approved_at' => now(), 'actual_cost' => $r['total_cost'],
                'move_id' => $r['moves'][0]['movement_id'], 'updated_at' => now(),
            ]);

            return self::ver($m->id);
        });
    }

    public static function rechazar(string $id, string $motivo, User $quien): object
    {
        if (mb_strlen(trim($motivo)) < 5) {
            RuleError::fail('RN-ALM-13', 'Rechazar exige motivo.');
        }

        return DB::transaction(function () use ($id, $motivo, $quien) {
            $m = self::pendiente($id);
            DB::table('stock_waste_records')->where('id', $m->id)->update([
                'status' => 'REJECTED', 'approved_by' => $quien->id, 'approved_at' => now(), 'reject_reason' => mb_substr(trim($motivo), 0, 255), 'updated_at' => now(),
            ]);

            return self::ver($m->id);
        });
    }

    public static function ver(string $id): object
    {
        return DB::table('stock_waste_records as m')->join('waste_reasons as r', 'r.id', '=', 'm.reason_id')->join('product_variants as v', 'v.id', '=', 'm.variant_id')
            ->join('warehouses as w', 'w.id', '=', 'm.warehouse_id')->leftJoin('lots as l', 'l.id', '=', 'm.lot_id')
            ->leftJoin('users as u', 'u.id', '=', 'm.requested_by')->leftJoin('users as a', 'a.id', '=', 'm.approved_by')->where('m.id', $id)
            ->first(['m.*', 'r.code as reason_code', 'r.name as reason_name', 'r.approval_above_pen', 'r.requires_photo', 'v.sku', 'v.name as variant_name', 'v.sale_mode',
                'w.code as warehouse_code', 'w.name as warehouse_name', 'l.code as lot_code', 'u.name as requested_by_name', 'a.name as approved_by_name'])
            ?? RuleError::fail('RN-ALM-13', 'Merma no encontrada.');
    }

    /** ALM-13: crear o editar un motivo. */
    public static function guardarMotivo(array $d, ?string $id): object
    {
        $codigo = strtoupper(trim((string) ($d['code'] ?? '')));
        if ($codigo === '' || trim((string) ($d['name'] ?? '')) === '') {
            RuleError::fail('RN-ALM-13', 'El motivo necesita código y nombre.');
        }
        if ((float) ($d['approval_above_pen'] ?? -1) < 0) {
            RuleError::fail('RN-ALM-13', 'El umbral de aprobación no puede ser negativo.');
        }
        if (DB::table('waste_reasons')->where('code', $codigo)->when($id, fn ($q) => $q->where('id', '<>', $id))->exists()) {
            RuleError::fail('RN-ALM-13', "Ya existe un motivo con el código {$codigo}.");
        }
        $fila = ['code' => $codigo, 'name' => trim($d['name']), 'requires_photo' => (bool) ($d['requires_photo'] ?? false),
            'approval_above_pen' => (int) round((float) $d['approval_above_pen']), 'counts_as_expired' => (bool) ($d['counts_as_expired'] ?? false),
            'status' => in_array($d['status'] ?? 'ACTIVE', ['ACTIVE', 'INACTIVE'], true) ? ($d['status'] ?? 'ACTIVE') : 'ACTIVE'];
        if ($id) {
            DB::table('waste_reasons')->where('id', $id)->update($fila + ['updated_at' => now()]) ?: RuleError::fail('RN-ALM-13', 'Motivo no encontrado.');
        } else {
            $id = DB::table('waste_reasons')->insertGetId($fila, 'id');
        }

        return DB::table('waste_reasons')->find($id);
    }

    private static function pendiente(string $id): object
    {
        $m = DB::table('stock_waste_records')->where('id', $id)->lockForUpdate()->first() ?? RuleError::fail('RN-ALM-13', 'Merma no encontrada.');
        if ($m->status !== 'PENDING') {
            RuleError::fail('RN-ALM-13', "La merma {$m->number} ya está ".($m->status === 'APPROVED' ? 'aprobada' : 'rechazada').'.');
        }

        return $m;
    }
}
