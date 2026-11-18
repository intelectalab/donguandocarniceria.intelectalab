<?php

namespace App\Modulos\Ped\Services;

use App\Models\User;
use App\Support\Access;
use App\Support\Events;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * Descuento del pedido (RN-PED-10 y RN-PED-11). El precio de la línea no se edita: la rebaja es
 * un descuento en % o en soles sobre los productos. Hasta el límite del rol y la marca
 * (discount_limits) se aplica; por encima queda «pendiente de aprobación» y lo aprueba otra
 * persona con ped.discount.approve (PED-10). D-PED-04: VENDEDORA 5 % o S/ 20, SUPERVISORA 15 %
 * o S/ 100, GERENTE sin límite. Pasar cualquiera de los dos topes pide aprobación.
 */
final class Descuentos
{
    /** @return array{max_pct: ?float, max_amount: ?float} null = sin límite */
    public static function limite(User $u, string $marca): array
    {
        $fila = DB::table('discount_limits')->where('role', $u->role)->where('status', 'ACTIVE')
            ->where(fn ($q) => $q->where('brand_id', $marca)->orWhereNull('brand_id'))
            ->orderByRaw('brand_id is null')->first();
        if ($fila) {
            return ['max_pct' => (float) $fila->max_pct, 'max_amount' => (float) $fila->max_amount];
        }
        if ($u->role === 'GERENTE' || Access::can($u, 'ped.discount.approve')) {
            return ['max_pct' => null, 'max_amount' => null];
        }

        return ['max_pct' => 0.0, 'max_amount' => 0.0];
    }

    /**
     * Aplica o pide el descuento de un borrador. $d: pct o amount, y reason. Sin pct ni amount
     * (o en 0) lo quita.
     */
    public static function aplicar(string $orderId, ?array $d, User $u): object
    {
        return DB::transaction(function () use ($orderId, $d, $u) {
            $o = Pedidos::bloquear($orderId);
            Pedidos::soloBorrador($o, 'cambiar el descuento');
            $pct = isset($d['pct']) && $d['pct'] !== '' ? round((float) $d['pct'], 2) : null;
            $monto = isset($d['amount']) && $d['amount'] !== '' ? round((float) $d['amount'], 2) : null;
            if ($pct !== null && $monto !== null && $pct > 0 && $monto > 0) {
                RuleError::fail('RN-PED-11', 'El descuento va en % o en soles, no en los dos.');
            }
            if (($pct ?? 0) < 0 || ($monto ?? 0) < 0 || ($pct ?? 0) > 100) {
                RuleError::fail('RN-PED-11', 'El descuento va de 0 % a 100 %, sin montos negativos.');
            }

            DB::table('order_discount_approvals')->where('order_id', $o->id)->where('status', 'PENDING')
                ->update(['status' => 'REJECTED', 'decided_at' => now(), 'decided_by_name' => mb_substr($u->name, 0, 120), 'decision_note' => 'Reemplazado por otro descuento', 'updated_at' => now()]);

            if (! $pct && ! $monto) {
                DB::table('sales_orders')->where('id', $o->id)->update(['order_discount_pct' => null, 'order_discount' => null, 'discount_reason' => null, 'discount_status' => 'NONE']);

                return Pedidos::recalcular($o->id);
            }
            $motivo = trim((string) ($d['reason'] ?? ''));
            if ($motivo === '') {
                RuleError::fail('RN-PED-11', 'Escribe el motivo del descuento (cliente frecuente, reclamo, promoción…).');
            }

            // Primero se aplica para saber el monto sobre los productos.
            DB::table('sales_orders')->where('id', $o->id)->update([
                'order_discount_pct' => $pct ?: null, 'order_discount' => $pct ? null : $monto, 'discount_reason' => mb_substr($motivo, 0, 255),
                'discount_status' => 'APPLIED',
            ]);
            $o = Pedidos::recalcular($o->id);
            $base = round((float) DB::table('sales_order_lines')->where('sales_order_id', $o->id)->sum('est_amount'), 2);
            $importe = (float) $o->discount_total;
            $pctReal = $base > 0 ? round($importe / $base * 100, 2) : 0.0;

            $lim = self::limite($u, $o->brand_id);
            $sobre = ($lim['max_pct'] !== null && $pctReal > $lim['max_pct'] + 0.001) || ($lim['max_amount'] !== null && $importe > $lim['max_amount'] + Pedidos::EPS);
            if ($sobre) {
                DB::table('sales_orders')->where('id', $o->id)->update(['discount_status' => 'PENDING_APPROVAL']);
                DB::table('order_discount_approvals')->insert([
                    'order_id' => $o->id, 'order_number' => $o->number, 'brand_id' => $o->brand_id, 'establishment_id' => $o->establishment_id,
                    'requested_by' => $u->id, 'requested_by_name' => mb_substr($u->name, 0, 120), 'requested_role' => $u->role ?? 'OTRO',
                    'requested_pct' => $pctReal, 'requested_amount' => $importe, 'order_base' => $base, 'reason' => mb_substr($motivo, 0, 255),
                    'status' => 'PENDING', 'requested_at' => now(),
                ]);
                Events::emit('order.discount_requested', 'sales_orders', $o->id, ['number' => $o->number, 'pct' => $pctReal, 'amount' => $importe]);
            }

            return Pedidos::pedido($o->id);
        });
    }

    /** PED-10: aprobar o rechazar. Quien pide no aprueba. */
    public static function decidir(string $approvalId, bool $aprueba, ?string $nota, User $u): object
    {
        return DB::transaction(function () use ($approvalId, $aprueba, $nota, $u) {
            $a = DB::table('order_discount_approvals')->where('id', $approvalId)->lockForUpdate()->first();
            if (! $a) {
                abort(404, 'Solicitud no encontrada.');
            }
            if ($a->status !== 'PENDING') {
                RuleError::fail('RN-PED-11', 'Esta solicitud ya fue '.($a->status === 'APPROVED' ? 'aprobada.' : 'rechazada.'));
            }
            if ($a->requested_by === $u->id) {
                RuleError::fail('RN-PED-11', 'Quien pide el descuento no lo aprueba: debe hacerlo otra persona con permiso.');
            }
            if (! $aprueba && trim((string) $nota) === '') {
                RuleError::fail('RN-PED-11', 'Al rechazar, escribe el motivo para la vendedora.');
            }
            $o = Pedidos::bloquear($a->order_id);
            DB::table('order_discount_approvals')->where('id', $a->id)->update([
                'status' => $aprueba ? 'APPROVED' : 'REJECTED', 'decided_by' => $u->id, 'decided_by_name' => mb_substr($u->name, 0, 120),
                'decided_at' => now(), 'decision_note' => $nota ? mb_substr($nota, 0, 255) : null, 'updated_at' => now(),
            ]);
            DB::table('sales_orders')->where('id', $o->id)->update(['discount_status' => $aprueba ? 'APPROVED' : 'REJECTED', 'last_activity_at' => now()]);
            Pedidos::recalcular($o->id);
            Events::emit($aprueba ? 'order.discount_approved' : 'order.discount_rejected', 'sales_orders', $o->id, ['number' => $o->number, 'by' => $u->name]);

            return DB::table('order_discount_approvals')->where('id', $a->id)->first();
        });
    }
}
