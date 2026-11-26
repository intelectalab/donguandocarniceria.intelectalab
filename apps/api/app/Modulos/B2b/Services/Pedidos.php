<?php

namespace App\Modulos\B2b\Services;

use App\Models\User;
use App\Modulos\Canales\Soporte as S;
use App\Support\Events;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * Puente con PED, que aún no existe: crea y confirma pedidos del canal B2B (portal y corridas de pedidos
 * recurrentes) directamente en sales_orders y sales_order_lines, con los precios del cliente (RN-B2B-06).
 * Cuando PED exista, este puente llama a su servicio de pedidos. Contrato en docs/contratos.md (sección B2B).
 */
final class Pedidos
{
    /**
     * @param  array{customer_id: string, brand_id?: ?string, establishment_id?: ?string, address_id?: ?string, delivery_date: string, slot_from?: ?string,
     *               payment_method_id?: ?string, requested_doc_type?: string, notes?: ?string, seller_id?: ?string, portal_account_id?: ?string, origin_ref?: ?string,
     *               lines: array<int, array{variant_id: string, qty: mixed, est_weight_kg?: mixed, cut_notes?: ?string}>}  $d
     */
    public static function crear(array $d, User $quien): object
    {
        return DB::transaction(function () use ($d, $quien) {
            $c = DB::table('customers')->where('id', $d['customer_id'])->first() ?? abort(404);
            $dir = ! empty($d['address_id']) ? DB::table('customer_addresses')->where('id', $d['address_id'])->where('customer_id', $c->id)->first()
                : DB::table('customer_addresses')->where('customer_id', $c->id)->where('status', 'ACTIVE')->orderByDesc('is_default')->first();
            $zona = $dir && $dir->zone_id ? DB::table('delivery_zones')->where('id', $dir->zone_id)->first() : null;
            $local = $d['establishment_id'] ?? $zona->establishment_id ?? DB::table('establishments')->where('status', 'ACTIVE')->orderBy('code')->value('id');
            $franja = DB::table('order_time_slots')->where('establishment_id', $local)->where('status', 'ACTIVE')
                ->when($d['slot_from'] ?? null, fn ($q, $f) => $q->orderByRaw('slot_from = ?::time DESC', [$f]))->orderBy('slot_from')->first();
            $fecha = S::fecha($d['delivery_date']);
            $lineas = [];
            $total = 0.0;
            $unidades = 0;
            $kg = 0.0;
            $marca = $d['brand_id'] ?? null;
            foreach ($d['lines'] as $i => $l) {
                $v = DB::table('product_variants')->where('id', $l['variant_id'])->first() ?? RuleError::fail('RN-B2B-11', 'Presentación no encontrada.');
                $marca ??= $v->brand_id;
                $p = PreciosCliente::precio($c->id, $v->id, $fecha) ?? RuleError::fail('RN-B2B-06', "{$v->name} no tiene precio para este cliente.");
                $q = S::r($l['qty'], 3);
                $peso = isset($l['est_weight_kg']) && $l['est_weight_kg'] !== null && $l['est_weight_kg'] !== '' ? (float) $l['est_weight_kg']
                    : ($v->sale_mode === 'KG' ? $q : ($v->nominal_weight_kg ? S::r($q * (float) $v->nominal_weight_kg, 3) : null));
                $monto = S::r(($p['basis'] === 'KG' ? (float) ($peso ?? $q) : $q) * $p['price']);
                $total += $monto;
                $unidades += $v->sale_mode === 'KG' ? 0 : (int) ceil($q);
                $kg += (float) ($peso ?? 0);
                $lineas[] = [
                    'line_no' => $i + 1, 'variant_id' => $v->id, 'qty' => $q, 'unit_price' => $p['price'], 'list_price' => $p['list_price'] ?? $p['price'],
                    'price_basis' => $p['basis'], 'price_list_id' => $p['list_id'], 'est_weight_kg' => $peso, 'discount_pct' => 0, 'discount_amount' => 0,
                    'cut_notes' => $l['cut_notes'] ?? null, 'est_amount' => $monto,
                ];
            }
            $lineas || RuleError::fail('RN-B2B-14', 'El pedido no tiene líneas.');
            $id = DB::table('sales_orders')->insertGetId([
                'number' => S::numero('sales_orders', 'P-', 6), 'brand_id' => $marca, 'establishment_id' => $local, 'channel' => 'B2B', 'customer_id' => $c->id,
                'address_id' => $dir->id ?? null, 'seller_id' => $d['seller_id'] ?? $c->seller_user_id, 'fulfillment' => 'DELIVERY', 'delivery_date' => $fecha,
                'slot_id' => $franja->id ?? null, 'slot_from' => $franja->slot_from ?? null, 'slot_to' => $franja->slot_to ?? null,
                'requested_doc_type' => $d['requested_doc_type'] ?? 'INVOICE', 'billing_customer_id' => $c->id, 'payment_method_id' => $d['payment_method_id'] ?? null,
                'status' => 'DRAFT', 'estimated_total' => S::r($total), 'delivery_fee' => 0, 'paid_amount' => 0, 'discount_total' => 0, 'discount_status' => 'NONE',
                'weight_diff_status' => 'NONE', 'contact_phone' => $dir->contact_phone ?? $c->phone, 'zone_id' => $dir->zone_id ?? null,
                'notes' => $d['notes'] ?? null, 'reschedule_count' => 0, 'units' => $unidades, 'est_kg' => S::r($kg, 3),
                'portal_account_id' => $d['portal_account_id'] ?? null, 'origin_ref' => $d['origin_ref'] ?? null,
            ], 'id');
            foreach ($lineas as $l) {
                DB::table('sales_order_lines')->insert($l + ['sales_order_id' => $id]);
            }
            Events::emit('order.created', 'sales_orders', $id, ['channel' => 'B2B', 'customer_id' => $c->id]);

            return DB::table('sales_orders')->where('id', $id)->first();
        });
    }

    /** RN-PED-01: datos obligatorios para confirmar (dirección, fecha, franja, método de pago y líneas). */
    public static function faltantes(object $o): array
    {
        $f = [];
        $o->address_id || $f[] = 'la dirección de entrega';
        $o->delivery_date || $f[] = 'la fecha de entrega';
        $o->slot_id || $f[] = 'la franja';
        $o->payment_method_id || $f[] = 'el método de pago';
        DB::table('sales_order_lines')->where('sales_order_id', $o->id)->exists() || $f[] = 'las líneas';

        return $f;
    }

    public static function confirmar(object $o, User $quien, ?string $motivo = null): void
    {
        $falta = self::faltantes($o);
        $falta && RuleError::fail('RN-B2B-13', 'Para confirmar el pedido falta '.implode(', ', $falta).'.');
        DB::table('sales_orders')->where('id', $o->id)->update(['status' => 'CONFIRMED', 'confirmed_at' => now(), 'confirmation_channel' => 'B2B', 'updated_at' => now()]);
        Events::emit('order.confirmed', 'sales_orders', $o->id, ['number' => $o->number, 'reason' => $motivo]);
    }

    /** Líneas de un pedido con el nombre de la presentación. */
    public static function lineas(string $orderId): array
    {
        return DB::table('sales_order_lines as l')->join('product_variants as v', 'v.id', '=', 'l.variant_id')->where('l.sales_order_id', $orderId)
            ->orderBy('l.line_no')->get(['l.*', 'v.name as variant_name', 'v.sku', 'v.sale_mode', 'v.status as variant_status', 'v.sellable'])->all();
    }
}
