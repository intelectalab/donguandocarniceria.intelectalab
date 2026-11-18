<?php

namespace App\Modulos\Ped\Services;

use App\Models\User;
use App\Support\Access;
use App\Support\Events;
use App\Support\Params;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * Peso real y aviso de diferencia (RN-PED-04, RN-PED-05, PED-07). Lo usará PRE al pesar:
 *   Pesos::registrar($pedidoId, [['line_id' => …, 'weighed_kg' => 1.96]], $usuario);
 * Importe final de la línea = peso real × precio por kg. Cuando todas las líneas por kg tienen
 * peso, el pedido pasa a PESADO y, si alguna difiere más que su tolerancia, queda «aviso requerido».
 */
final class Pesos
{
    public static function registrar(string $orderId, array $pesos, User $u, string $fuente = 'MANUAL'): object
    {
        return DB::transaction(function () use ($orderId, $pesos, $u, $fuente) {
            $o = Pedidos::bloquear($orderId);
            if (! in_array($o->status, ['IN_PREPARATION', 'WEIGHED'], true)) {
                RuleError::fail('RN-PED-04', 'El peso real se registra con el pedido en preparación (este está '.Estados::nombre($o->status).').');
            }
            foreach ($pesos as $p) {
                $l = DB::table('sales_order_lines')->where('id', $p['line_id'] ?? '')->where('sales_order_id', $o->id)->first();
                if (! $l) {
                    RuleError::fail('RN-PED-04', 'La línea no es de este pedido.');
                }
                if ($l->price_basis !== 'KG') {
                    RuleError::fail('RN-PED-04', 'Ese producto se cobra por unidad: no lleva peso real.');
                }
                $kg = round((float) ($p['weighed_kg'] ?? 0), 3);
                if ($kg <= 0) {
                    RuleError::fail('RN-PED-04', 'El peso real debe ser mayor que 0.');
                }
                DB::table('sales_order_lines')->where('id', $l->id)->update([
                    'weighed_kg' => $kg, 'final_amount' => round($kg * (float) $l->unit_price - (float) $l->discount_amount, 2),
                    'weight_source' => in_array($fuente, ['SCALE', 'MANUAL'], true) ? $fuente : 'MANUAL', 'updated_at' => now(),
                ]);
            }
            $o = Pedidos::recalcular($o->id);
            $diff = self::evaluar($o);
            DB::table('sales_orders')->where('id', $o->id)->update(['weight_diff_status' => $diff['estado'], 'last_activity_at' => now()]);

            if ($diff['completo'] && $o->status === 'IN_PREPARATION') {
                DB::table('sales_orders')->where('id', $o->id)->update(['status' => 'WEIGHED']);
                Estados::historial($o, 'IN_PREPARATION', 'WEIGHED', $diff['estado'] === 'NOTICE_REQUIRED' ? 'Peso fuera de tolerancia: aviso requerido' : null, $u);
                Events::emit('order.weighed', 'sales_orders', $o->id, ['number' => $o->number, 'final_total' => (float) $o->final_total, 'notice' => $diff['estado'] === 'NOTICE_REQUIRED']);
            }

            return Pedidos::pedido($o->id);
        });
    }

    /**
     * Diferencia por línea frente a su tolerancia (la de la variante o ped_weight_tolerance_pct).
     *
     * @return array{completo: bool, estado: string, lineas: list<array>}
     */
    public static function evaluar(object $o): array
    {
        $tol = (float) (Params::get('ped_weight_tolerance_pct', ['brand' => $o->brand_id]) ?? 10);
        $ls = DB::table('sales_order_lines as l')->join('product_variants as v', 'v.id', '=', 'l.variant_id')
            ->where('l.sales_order_id', $o->id)->where('l.price_basis', 'KG')->orderBy('l.line_no')
            ->get(['l.id', 'l.line_no', 'l.qty', 'l.est_weight_kg', 'l.weighed_kg', 'l.tolerance_pct', 'l.est_amount', 'l.final_amount', 'v.name', 'v.sku']);
        $lineas = [];
        $fuera = false;
        foreach ($ls as $l) {
            $est = (float) $l->est_weight_kg;
            $pct = $l->weighed_kg !== null && $est > 0 ? round(((float) $l->weighed_kg - $est) / $est * 100, 1) : null;
            $t = $l->tolerance_pct !== null ? (float) $l->tolerance_pct : $tol;
            $excede = $pct !== null && abs($pct) > $t + 0.0001;
            $fuera = $fuera || $excede;
            $lineas[] = ['line_id' => $l->id, 'name' => $l->name, 'sku' => $l->sku, 'qty' => (float) $l->qty, 'estimado_kg' => $est,
                'real_kg' => $l->weighed_kg !== null ? (float) $l->weighed_kg : null, 'diferencia_pct' => $pct, 'tolerancia_pct' => $t, 'excede' => $excede,
                'importe_estimado' => (float) $l->est_amount, 'importe_final' => $l->final_amount !== null ? (float) $l->final_amount : null];
        }
        $completo = $ls->every(fn ($l) => $l->weighed_kg !== null);
        $estado = match (true) {
            ! $completo || $ls->isEmpty() => $o->weight_diff_status === 'NOTICE_SENT' ? 'NOTICE_SENT' : 'NONE',
            $fuera => $o->weight_diff_status === 'NOTICE_SENT' && self::avisoVigente($o) ? 'NOTICE_SENT' : 'NOTICE_REQUIRED',
            default => 'WITHIN_TOLERANCE',
        };

        return ['completo' => $completo, 'estado' => $estado, 'lineas' => $lineas];
    }

    /** El último aviso sigue valiendo si se dio con el mismo total final y el cliente no lo rechazó. */
    private static function avisoVigente(object $o): bool
    {
        $n = DB::table('order_weight_notices')->where('order_id', $o->id)->orderByDesc('sent_at')->first();

        return $n && abs((float) $n->final_total - (float) $o->final_total) < Pedidos::EPS && $n->customer_response !== 'REJECTED';
    }

    /**
     * PED-07: registra el aviso al cliente. Desde la tercera plantilla del pedido por WhatsApp exige
     * crm.template.send_extra (RN-CRM-07).
     */
    public static function avisar(string $orderId, string $canal, ?string $mensaje, User $u): object
    {
        return DB::transaction(function () use ($orderId, $canal, $mensaje, $u) {
            $o = Pedidos::bloquear($orderId);
            if (! in_array($o->weight_diff_status, ['NOTICE_REQUIRED', 'NOTICE_SENT'], true)) {
                RuleError::fail('RN-PED-05', 'Este pedido no tiene diferencia de peso por avisar.');
            }
            if (! in_array($canal, ['WHATSAPP', 'PHONE'], true)) {
                RuleError::fail('RN-PED-05', 'El aviso va por WhatsApp o por teléfono.');
            }
            $previos = DB::table('order_weight_notices')->where('order_id', $o->id)->where('channel', 'WHATSAPP')->count();
            if ($canal === 'WHATSAPP' && $previos >= 2 && ! Access::can($u, 'crm.template.send_extra')) {
                RuleError::fail('RN-CRM-07', 'Ya se enviaron 2 plantillas por WhatsApp a este pedido: una tercera exige el permiso crm.template.send_extra. Llama por teléfono.');
            }
            $texto = trim((string) $mensaje) ?: Mensajes::avisoPeso($o);
            $est = (float) $o->estimated_total;
            $fin = (float) ($o->final_total ?? $o->estimated_total);
            $id = DB::table('order_weight_notices')->insertGetId([
                'order_id' => $o->id, 'order_number' => $o->number, 'brand_id' => $o->brand_id, 'establishment_id' => $o->establishment_id,
                'estimated_total' => $est, 'final_total' => $fin, 'diff_pct' => $est > 0 ? round(($fin - $est) / $est * 100, 2) : 0,
                'message' => $texto, 'channel' => $canal, 'sent_at' => now(), 'sent_by' => $u->id, 'customer_response' => 'NO_RESPONSE', 'cost' => 0,
            ], 'id');
            DB::table('sales_orders')->where('id', $o->id)->update(['weight_diff_status' => 'NOTICE_SENT', 'last_activity_at' => now(), 'updated_at' => now()]);
            Events::emit('order.weight_notice_sent', 'sales_orders', $o->id, ['number' => $o->number, 'channel' => $canal, 'notice_id' => $id]);

            return DB::table('order_weight_notices')->where('id', $id)->first();
        });
    }

    /** Respuesta del cliente: si rechaza, el pedido vuelve a quedar con aviso requerido (se vuelve a pesar o se ajusta). */
    public static function respuesta(string $noticeId, string $respuesta, User $u): object
    {
        return DB::transaction(function () use ($noticeId, $respuesta, $u) {
            if (! in_array($respuesta, ['ACCEPTED', 'REJECTED', 'NO_RESPONSE'], true)) {
                RuleError::fail('RN-PED-05', 'La respuesta es aceptó, rechazó o sin respuesta.');
            }
            $n = DB::table('order_weight_notices')->where('id', $noticeId)->first();
            if (! $n) {
                abort(404, 'Aviso no encontrado.');
            }
            $o = Pedidos::bloquear($n->order_id);
            DB::table('order_weight_notices')->where('id', $n->id)->update([
                'customer_response' => $respuesta, 'responded_at' => now('America/Lima')->format('Y-m-d H:i'), 'updated_at' => now(),
            ]);
            if ($respuesta === 'REJECTED') {
                DB::table('sales_orders')->where('id', $o->id)->update(['weight_diff_status' => 'NOTICE_REQUIRED', 'last_activity_at' => now()]);
            }
            Events::emit('order.weight_notice_answered', 'sales_orders', $o->id, ['number' => $o->number, 'response' => $respuesta, 'by' => $u->name]);

            return DB::table('order_weight_notices')->where('id', $n->id)->first();
        });
    }
}
