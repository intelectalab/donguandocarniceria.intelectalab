<?php

namespace App\Modulos\Ped\Services;

use App\Models\User;
use App\Modulos\Cli\Services\Celulares;
use App\Support\Events;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * Textos para el cliente. RN-PED-12: el resumen va en un solo mensaje con marca, productos con
 * cantidad y corte, total estimado, aviso de cobro por peso real, dirección y referencia, fecha y
 * franja, forma de pago y comprobante (PED-05). También el aviso de diferencia de peso (PED-07).
 */
final class Mensajes
{
    public static function resumen(object $o): string
    {
        $marca = DB::table('brands')->where('id', $o->brand_id)->value('name');
        $cliente = DB::table('customers')->where('id', $o->customer_id)->first(['full_name', 'trade_name']);
        $nombre = $cliente ? explode(' ', trim($cliente->trade_name ?: $cliente->full_name))[0] : '';
        $ls = DB::table('sales_order_lines as l')->join('product_variants as v', 'v.id', '=', 'l.variant_id')
            ->leftJoin('cut_types as c', 'c.id', '=', 'v.cut_type_id')
            ->where('l.sales_order_id', $o->id)->orderBy('l.line_no')
            ->get(['l.qty', 'l.price_basis', 'l.est_weight_kg', 'l.est_amount', 'l.cut_notes', 'v.name', 'v.sale_mode', 'c.name as corte']);

        $t = ["Hola {$nombre}, te confirmamos tu pedido {$o->number} de *{$marca}*:"];
        foreach ($ls as $l) {
            $cant = $l->sale_mode === 'KG' ? self::kg((float) $l->qty) : self::num((float) $l->qty).' ×';
            $detalle = array_filter([$l->corte, $l->cut_notes]);
            $peso = $l->sale_mode === 'UNIT_VARIABLE_WEIGHT' ? ' (aprox. '.self::kg((float) $l->est_weight_kg).')' : '';
            $t[] = "• {$cant} {$l->name}{$peso}".($detalle ? ' · '.implode(' · ', $detalle) : '').' — '.self::soles((float) $l->est_amount);
        }
        if ((float) $o->discount_total > 0 && $o->discount_status !== 'PENDING_APPROVAL') {
            $t[] = 'Descuento: −'.self::soles((float) $o->discount_total);
        }
        if ($o->fulfillment === 'DELIVERY') {
            $t[] = 'Delivery: '.((float) $o->delivery_fee > 0 ? self::soles((float) $o->delivery_fee) : 'gratis');
        }
        $t[] = '*Total estimado: '.self::soles((float) $o->estimated_total).'*';
        if ($ls->contains(fn ($l) => $l->price_basis === 'KG')) {
            $t[] = 'Los productos por peso se cobran con el peso real al prepararlos; si cambia más de lo normal te avisamos antes.';
        }
        $t[] = '';
        if (in_array($o->fulfillment, ['DELIVERY', 'PROVINCE_SHIPPING'], true) && $o->address_id) {
            $a = DB::table('customer_addresses')->where('id', $o->address_id)->first(['address_line', 'district', 'reference']);
            if ($a) {
                $t[] = "📍 {$a->address_line}, {$a->district}".($a->reference ? " (Ref.: {$a->reference})" : '');
            }
        }
        if ($o->fulfillment === 'PICKUP' && $o->pickup_establishment_id) {
            $t[] = '📍 Recojo en '.DB::table('establishments')->where('id', $o->pickup_establishment_id)->value('name');
        }
        if ($o->fulfillment === 'PROVINCE_SHIPPING') {
            $agencia = $o->province_agency ? DB::table('suppliers')->where('id', $o->province_agency)->value(DB::raw('coalesce(trade_name, legal_name)')) : null;
            $t[] = '🚚 Envío a provincia'.($agencia ? " por {$agencia}" : '').($o->province_destination ? " · destino {$o->province_destination}" : '');
        }
        if ($o->delivery_date && $o->fulfillment !== 'COUNTER') {
            $t[] = '🗓 '.self::fecha($o->delivery_date).($o->slot_from ? ', de '.substr($o->slot_from, 0, 5).' a '.substr($o->slot_to, 0, 5) : '');
        }
        $pago = $o->payment_method_id ? DB::table('payment_methods')->where('id', $o->payment_method_id)->value('name') : null;
        $t[] = '💳 Pago: '.($pago ?? 'por definir').((float) $o->paid_amount > 0 ? ' (pagado '.self::soles((float) $o->paid_amount).')' : '');
        $t[] = '🧾 Comprobante: '.($o->requested_doc_type === 'INVOICE' ? 'factura' : 'boleta');
        $t[] = '';
        $t[] = '¿Está todo correcto? Respóndenos «Sí» para dejarlo listo.';

        return implode("\n", $t);
    }

    public static function avisoPeso(object $o): string
    {
        $cliente = DB::table('customers')->where('id', $o->customer_id)->first(['full_name', 'trade_name']);
        $nombre = $cliente ? explode(' ', trim($cliente->trade_name ?: $cliente->full_name))[0] : '';
        $ev = Pesos::evaluar($o);
        $lineas = collect($ev['lineas'])->filter(fn ($l) => $l['excede'])
            ->map(fn ($l) => "• {$l['name']}: pesó ".self::kg((float) $l['real_kg']).' (estimado '.self::kg($l['estimado_kg']).')')->implode("\n");

        return "Hola {$nombre}, ya pesamos tu pedido {$o->number}.\n{$lineas}\n"
            .'El total pasa de '.self::soles((float) $o->estimated_total).' a '.self::soles((float) ($o->final_total ?? $o->estimated_total)).".\n"
            .'¿Lo enviamos así? Si prefieres, lo ajustamos al peso que pediste.';
    }

    /** PED-05: registra cuándo y por qué canal confirmó el cliente. */
    public static function confirmoCliente(string $orderId, string $canal, User $u): object
    {
        if (! in_array($canal, ['WHATSAPP', 'PHONE', 'WEB'], true)) {
            RuleError::fail('RN-PED-12', 'El cliente confirma por WhatsApp, teléfono o la web.');
        }

        return DB::transaction(function () use ($orderId, $canal, $u) {
            $o = Pedidos::bloquear($orderId);
            if (in_array($o->status, ['CANCELLED', 'CLOSED'], true)) {
                RuleError::fail('RN-PED-03', 'El pedido está '.Estados::nombre($o->status).'.');
            }
            DB::table('sales_orders')->where('id', $o->id)->update(['customer_confirmed_at' => now(), 'confirmation_channel' => $canal, 'last_activity_at' => now()]);
            Events::emit('order.customer_confirmed', 'sales_orders', $o->id, ['number' => $o->number, 'channel' => $canal, 'by' => $u->name]);

            return Pedidos::pedido($o->id);
        });
    }

    /** Enlace wa.me con el texto listo, al celular de contacto o del cliente. */
    public static function enlaceWhatsapp(object $o, string $texto): ?string
    {
        $tel = $o->contact_phone ?: DB::table('customers')->where('id', $o->customer_id)->value('phone');
        $tel = Celulares::normalizar($tel);

        return $tel ? 'https://wa.me/'.ltrim($tel, '+').'?text='.rawurlencode($texto) : null;
    }

    public static function soles(float $n): string
    {
        return 'S/ '.number_format($n, 2, '.', ',');
    }

    public static function kg(float $n): string
    {
        return rtrim(rtrim(number_format($n, 3, ',', '.'), '0'), ',').' kg';
    }

    private static function num(float $n): string
    {
        return rtrim(rtrim(number_format($n, 3, ',', '.'), '0'), ',');
    }

    private static function fecha(string $f): string
    {
        $dias = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
        $meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
        $t = strtotime($f);

        return ucfirst($dias[(int) date('w', $t)]).' '.date('j', $t).' de '.$meses[(int) date('n', $t) - 1];
    }
}
