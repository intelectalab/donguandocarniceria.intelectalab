<?php

namespace App\Modulos\Cmp\Services;

use App\Models\User;
use App\Modulos\Canales\Soporte as S;
use App\Support\Events;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * CMP-07: cupones con vigencia, mínimo, límites, cliente y canales (RN-CMP-07 a 10). PED llama a
 * Cupones::revisar() para mostrar el descuento y a Cupones::aplicar() para registrarlo en el pedido.
 */
final class Cupones
{
    public const TIPOS = ['PCT' => 'Porcentaje', 'AMOUNT' => 'Monto fijo', 'FREE_DELIVERY' => 'Delivery gratis'];

    public static function porCodigo(?string $code): ?object
    {
        return DB::table('coupons')->whereRaw('upper(code) = ?', [strtoupper(trim((string) $code))])->first();
    }

    public static function guardar(array $d, ?string $id, User $quien): object
    {
        return S::base(function () use ($d, $id, $quien) {
            $code = strtoupper(trim((string) ($d['code'] ?? '')));
            preg_match('/^[A-Z0-9-]{3,20}$/', $code) || RuleError::fail('RN-CMP-07', 'El código va en mayúsculas, de 3 a 20 letras, números o guiones.');
            DB::table('coupons')->whereRaw('upper(code) = ?', [$code])->when($id, fn ($q) => $q->where('id', '<>', $id))->exists()
                && RuleError::fail('RN-CMP-07', "El código {$code} ya existe en la empresa.");
            $desde = $d['valid_from'] ?? null;
            $hasta = $d['valid_to'] ?? null;
            ($desde && $hasta && $desde < $hasta) || RuleError::fail('RN-CMP-07', 'La vigencia debe tener inicio menor que fin.');
            $tipo = $d['discount_type'] ?? 'PCT';
            isset(self::TIPOS[$tipo]) || RuleError::fail('RN-CMP-08', 'Elige el tipo de descuento.');
            $valor = (float) ($d['value'] ?? 0);
            $valor >= 0 || RuleError::fail('RN-CMP-08', 'El valor no puede ser negativo.');
            ($tipo !== 'PCT' || $valor <= 100) || RuleError::fail('RN-CMP-08', 'Un porcentaje no supera 100 %.');
            $total = isset($d['max_uses_total']) && $d['max_uses_total'] !== '' ? (int) $d['max_uses_total'] : null;
            ($total === null || $total > 0) || RuleError::fail('RN-CMP-08', 'Los usos totales deben ser mayores que cero.');
            $porCliente = (int) ($d['max_uses_per_customer'] ?? 1);
            $porCliente > 0 || RuleError::fail('RN-CMP-08', 'Los usos por cliente deben ser mayores que cero.');
            $fila = ['code' => $code, 'brand_id' => $d['brand_id'] ?? null, 'discount_type' => $tipo, 'value' => $tipo === 'FREE_DELIVERY' ? 0 : $valor,
                'max_discount' => isset($d['max_discount']) && $d['max_discount'] !== '' ? (float) $d['max_discount'] : null, 'min_order_amount' => (float) ($d['min_order_amount'] ?? 0),
                'valid_from' => $desde, 'valid_to' => $hasta, 'max_uses_total' => $total, 'max_uses_per_customer' => $porCliente, 'customer_id' => $d['customer_id'] ?? null,
                'channels' => json_encode(array_values((array) ($d['channels'] ?? []))), 'status' => $d['status'] ?? 'ACTIVE',
                'description' => isset($d['description']) ? mb_substr((string) $d['description'], 0, 255) : null, 'updated_at' => now()];
            if ($id) {
                DB::table('coupons')->where('id', $id)->update($fila);
            } else {
                $id = DB::table('coupons')->insertGetId($fila + ['created_by' => $quien->id, 'campaign_id' => $d['campaign_id'] ?? null], 'id');
            }

            return DB::table('coupons')->where('id', $id)->first();
        });
    }

    public static function usos(string $couponId): array
    {
        $r = DB::table('coupon_redemptions')->where('coupon_id', $couponId)->where('status', 'APPLIED')
            ->selectRaw('count(*) AS n, coalesce(sum(discount_amount), 0) AS discount, count(DISTINCT customer_id) AS customers')->first();

        return ['uses' => (int) $r->n, 'discount' => S::r($r->discount), 'customers' => (int) $r->customers];
    }

    private static function base(object $o): float
    {
        return S::r((float) DB::table('sales_order_lines')->where('sales_order_id', $o->id)->sum('est_amount'));
    }

    /** Valida el cupón para el pedido y calcula el descuento, sin aplicarlo. */
    public static function revisar(object $o, string $code, ?string $fecha = null): array
    {
        $fecha = S::fecha($fecha);
        $cp = self::porCodigo($code) ?? RuleError::fail('RN-CMP-07', 'El cupón '.strtoupper(trim($code)).' no existe.');
        $cp->status === 'ACTIVE' || RuleError::fail('RN-CMP-07', "El cupón {$cp->code} está ".($cp->status === 'PAUSED' ? 'pausado' : 'vencido').'.');
        if ($fecha < $cp->valid_from || $fecha > $cp->valid_to) {
            RuleError::fail('RN-CMP-07', "El cupón {$cp->code} vale del ".S::dmy($cp->valid_from).' al '.S::dmy($cp->valid_to).'; hoy es '.S::dmy($fecha).'.');
        }
        $otro = DB::table('coupon_redemptions')->where('order_id', $o->id)->where('status', 'APPLIED')->first();
        if ($otro || ($o->coupon_code && strtoupper($o->coupon_code) !== $cp->code)) {
            RuleError::fail('RN-CMP-10', "El pedido {$o->number} ya tiene un cupón: un pedido acepta un solo cupón.");
        }
        if ($cp->brand_id && $cp->brand_id !== $o->brand_id) {
            RuleError::fail('RN-CMP-08', "El cupón {$cp->code} es de otra marca.");
        }
        $canales = json_decode($cp->channels ?? '[]', true) ?: [];
        if ($canales && ! in_array($o->channel, $canales, true)) {
            RuleError::fail('RN-CMP-08', "El cupón {$cp->code} no vale en este canal de venta.");
        }
        if ($cp->customer_id && $cp->customer_id !== $o->customer_id) {
            RuleError::fail('RN-CMP-09', "El cupón {$cp->code} es personal de otro cliente.");
        }
        $usados = DB::table('coupon_redemptions')->where('coupon_id', $cp->id)->where('status', 'APPLIED');
        if ($cp->max_uses_total && (clone $usados)->count() >= $cp->max_uses_total) {
            RuleError::fail('RN-CMP-08', "El cupón {$cp->code} ya llegó a sus {$cp->max_uses_total} usos.");
        }
        $mios = (clone $usados)->where('customer_id', $o->customer_id)->count();
        if ($mios >= max(1, (int) $cp->max_uses_per_customer)) {
            RuleError::fail('RN-CMP-08', "El cliente ya usó el cupón {$cp->code} ".($mios === 1 ? 'una vez' : "{$mios} veces")." (máximo {$cp->max_uses_per_customer} por cliente).");
        }
        $base = self::base($o);
        if ($base + 0.005 < (float) $cp->min_order_amount) {
            RuleError::fail('RN-CMP-08', 'El pedido suma '.S::soles($base)." en productos y el cupón {$cp->code} exige un mínimo de ".S::soles($cp->min_order_amount).'.');
        }
        $desc = match ($cp->discount_type) {
            'PCT' => S::r($base * (float) $cp->value / 100),
            'AMOUNT' => min((float) $cp->value, $base),
            default => (float) ($o->delivery_fee ?? 0),
        };
        if ($cp->max_discount !== null && $cp->discount_type !== 'FREE_DELIVERY') {
            $desc = min($desc, (float) $cp->max_discount);
        }

        return ['coupon' => $cp, 'base' => $base, 'discount' => S::r($desc)];
    }

    /** Aplica el cupón a un pedido en borrador o confirmado y registra el canje. */
    public static function aplicar(string $orderId, string $code, User $quien, ?string $fecha = null): array
    {
        return S::base(fn () => DB::transaction(function () use ($orderId, $code, $quien, $fecha) {
            $o = DB::table('sales_orders')->where('id', $orderId)->lockForUpdate()->first() ?? RuleError::fail('RN-CMP-10', 'Pedido no encontrado.');
            in_array($o->status, ['DRAFT', 'CONFIRMED'], true) || RuleError::fail('RN-CMP-10', "El pedido {$o->number} ya no está en borrador ni confirmado: el cupón no se aplica.");
            $r = self::revisar($o, $code, $fecha);
            $cp = $r['coupon'];
            $cambio = ['coupon_code' => $cp->code, 'updated_at' => now()];
            if ($cp->discount_type === 'FREE_DELIVERY') {
                $cambio += ['delivery_fee' => 0, 'estimated_total' => S::r((float) $o->estimated_total - (float) $o->delivery_fee)];
            } else {
                $cambio += ['order_discount' => S::r((float) ($o->order_discount ?? 0) + $r['discount']), 'discount_total' => S::r((float) ($o->discount_total ?? 0) + $r['discount']),
                    'estimated_total' => S::r(max(0, (float) $o->estimated_total - $r['discount']))];
            }
            DB::table('sales_orders')->where('id', $o->id)->update($cambio);
            $id = DB::table('coupon_redemptions')->insertGetId(['coupon_id' => $cp->id, 'customer_id' => $o->customer_id, 'order_id' => $o->id,
                'discount_amount' => $r['discount'], 'order_amount' => $r['base'], 'redeemed_at' => now(), 'status' => 'APPLIED'], 'id');
            Events::emit('coupon.redeemed', 'coupon_redemptions', $id, ['coupon_id' => $cp->id, 'code' => $cp->code, 'order_id' => $o->id, 'discount' => $r['discount']]);

            return ['redemption_id' => $id, 'discount' => $r['discount'], 'total' => $cambio['estimated_total']];
        }));
    }

    /** Devuelve el canje si el pedido se anula. */
    public static function quitar(string $orderId, ?string $motivo = null): bool
    {
        $red = DB::table('coupon_redemptions')->where('order_id', $orderId)->where('status', 'APPLIED')->first();
        if (! $red) {
            return false;
        }
        DB::table('coupon_redemptions')->where('id', $red->id)->update(['status' => 'REVERSED', 'updated_at' => now()]);
        $o = DB::table('sales_orders')->where('id', $orderId)->first();
        if ($o && in_array($o->status, ['DRAFT', 'CONFIRMED'], true)) {
            DB::table('sales_orders')->where('id', $orderId)->update(['coupon_code' => null, 'order_discount' => max(0, S::r((float) $o->order_discount - (float) $red->discount_amount)),
                'estimated_total' => S::r((float) $o->estimated_total + (float) $red->discount_amount), 'updated_at' => now()]);
        }

        return true;
    }
}
