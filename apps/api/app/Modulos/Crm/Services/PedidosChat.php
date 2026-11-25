<?php

namespace App\Modulos\Crm\Services;

use App\Models\User;
use App\Modulos\Cli\Services\Clientes;
use App\Modulos\Ped\Services\Pedidos;
use App\Support\Access;
use App\Support\Events;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * CRM-03 Crear pedido desde el chat (RN-CRM-09, 10 y 22; RN-PED-16).
 *
 * «Crear pedido» abre un borrador de Pedidos con el cliente, el celular, el canal, el número de origen, la marca, la
 * vendedora y el anuncio ya llenos y bloqueados, y la última dirección guardada. El lead pasa a cliente con su primer
 * pedido y queda GANADO; el pedido se vincula a la conversación (una sola) y se registra su atribución. Los productos y la
 * entrega se completan en el formulario de Pedidos. El resumen y el cobro van en un solo mensaje: la plantilla de
 * confirmación (WhatsApp) o un texto (otras redes), con el Yape oficial; la vendedora no escribe números de cuenta.
 */
class PedidosChat
{
    /** Red del número => canal del pedido. */
    public const CANAL = ['WHATSAPP' => 'WHATSAPP', 'TIKTOK' => 'TIKTOK', 'MESSENGER' => 'FACEBOOK', 'INSTAGRAM' => 'INSTAGRAM'];

    private const METODO = ['CTWA_AD' => 'CTWA_REFERRAL', 'TRACKING_CODE' => 'TRACKING_CODE', 'TIKTOK_DM' => 'TIKTOK_DM'];

    /** Lo que se mostrará antes de crear: el origen fijo, el cliente o el lead, sus direcciones y si ya hay pedido. */
    public static function preparar(string $conversacion, User $u): array
    {
        $cv = Conversaciones::visible($conversacion, $u);
        $ch = DB::table('messaging_channels')->where('id', $cv->channel_id)->first();
        $contacto = DB::table('channel_contacts')->where('id', $cv->contact_id)->first();
        $lead = $cv->lead_id ? DB::table('leads')->where('id', $cv->lead_id)->first() : null;
        $cliente = $cv->customer_id ? DB::table('customers')->where('id', $cv->customer_id)->first(['id', 'full_name', 'phone', 'doc_type', 'doc_number']) : null;
        $vendedora = $cv->assigned_user_id ?: $u->id;

        return [
            'conversacion' => ['id' => $cv->id, 'contacto' => $cliente->full_name ?? $lead->full_name ?? $contacto->display_name ?? $contacto->external_user_id],
            'origen' => [
                'canal' => self::CANAL[$ch->kind] ?? 'WHATSAPP', 'canal_nombre' => Canales::REDES[$ch->kind] ?? $ch->kind, 'numero' => $ch->kind === 'WHATSAPP' ? $ch->number : null,
                'cuenta' => $ch->display_name, 'marca' => DB::table('brands')->where('id', $cv->brand_id)->value('name'),
                'vendedora' => DB::table('users')->where('id', $vendedora)->value('name'), 'anuncio' => $cv->ad_code,
                'entrada' => Conversaciones::ENTRADAS[$cv->entry_point] ?? $cv->entry_point,
            ],
            'cliente' => $cliente ? (array) $cliente : null,
            'nuevo' => $cliente ? null : ['full_name' => $lead->full_name ?? $contacto->display_name ?? '', 'phone' => $contacto->phone ?? $lead->phone ?? '', 'telefono_fijo' => (bool) $contacto->phone],
            'direcciones' => $cliente ? DB::table('customer_addresses')->where('customer_id', $cliente->id)->where('status', '<>', 'INACTIVE')
                ->orderByDesc('is_default')->orderByDesc('created_at')->get(['id', 'label', 'address_line', 'reference', 'district', 'lat', 'lng'])->all() : [],
            'pedidos' => self::pedidosDelChat($cv->id),
            'puede' => Access::can($u, 'crm.conversation.create_order') && Conversaciones::puedeResponder($cv, $u),
        ];
    }

    /**
     * Crea el borrador desde el chat y lo vincula. Devuelve el pedido (id y número) para completarlo en Pedidos.
     *
     * @param  array{full_name?: ?string, phone?: ?string, doc_number?: ?string, address_id?: ?string}  $d
     */
    public static function crear(string $conversacion, array $d, User $u): array
    {
        $cv = Conversaciones::visible($conversacion, $u);
        if (! Access::can($u, 'crm.conversation.create_order')) {
            RuleError::fail('RN-CRM-09', 'Tu rol no crea pedidos desde el chat.');
        }
        if (! Conversaciones::puedeResponder($cv, $u)) {
            RuleError::fail('RN-CRM-03', 'Solo la vendedora asignada o la supervisora crean el pedido de este chat.');
        }
        $ch = DB::table('messaging_channels')->where('id', $cv->channel_id)->first();

        return DB::transaction(function () use ($cv, $ch, $d, $u) {
            $contacto = DB::table('channel_contacts')->where('id', $cv->contact_id)->first();
            $lead = $cv->lead_id ? DB::table('leads')->where('id', $cv->lead_id)->lockForUpdate()->first() : null;

            // RN-CRM-10: el lead pasa a cliente con su primer pedido (si su celular ya es de un cliente, se usa ese).
            $clienteId = $cv->customer_id ?: ($lead?->existing_customer_id);
            if (! $clienteId) {
                $nombre = trim((string) ($d['full_name'] ?? '')) ?: ($lead->full_name ?? $contacto->display_name ?? '');
                if (mb_strlen($nombre) < 3 || $nombre === $contacto->external_user_id) {
                    RuleError::fail('RN-PED-01', 'Escribe el nombre del cliente.');
                }
                $celular = $contacto->phone ?: (trim((string) ($d['phone'] ?? '')) ?: null);
                $doc = trim((string) ($d['doc_number'] ?? ''));
                $alta = Clientes::altaRapida(['full_name' => $nombre, 'phone' => $celular, 'doc_type' => $doc !== '' ? 'DNI' : 'NONE', 'doc_number' => $doc !== '' ? $doc : null,
                    'source_channel' => self::CANAL[$ch->kind] ?? 'WHATSAPP', 'origin_wa_number' => $ch->kind === 'WHATSAPP' ? $ch->number : null], $u);
                $clienteId = $alta['customer']->id;
            }
            DB::table('conversations')->where('id', $cv->id)->update(['customer_id' => $clienteId, 'updated_at' => now()]);
            DB::table('channel_contacts')->where('id', $cv->contact_id)->update(['customer_id' => $clienteId, 'updated_at' => now()]);
            $nuevo = ! DB::table('sales_orders')->where('customer_id', $clienteId)->where('status', '<>', 'CANCELLED')->exists();

            $direccion = $d['address_id'] ?? DB::table('customer_addresses')->where('customer_id', $clienteId)->where('status', '<>', 'INACTIVE')
                ->orderByDesc('is_default')->orderByDesc('created_at')->value('id');
            $o = Pedidos::guardar(null, [
                'brand_id' => $cv->brand_id, 'channel' => self::CANAL[$ch->kind] ?? 'WHATSAPP', 'customer_id' => $clienteId, 'fulfillment' => 'DELIVERY',
                'address_id' => $direccion, 'contact_phone' => $contacto->phone ? preg_replace('/^\+51/', '', $contacto->phone) : null,
                'origin_wa_number' => $ch->kind === 'WHATSAPP' ? $ch->number : null, 'origin_ad_code' => $cv->ad_code, 'external_ref' => 'CRM:'.substr($cv->id, 0, 30),
                'seller_id' => $cv->assigned_user_id ?: $u->id, 'origin_locked' => true,
            ], $u);
            DB::table('sales_orders')->where('id', $o->id)->update(['conversation_id' => $cv->id, 'origin_ref' => 'CRM:'.$cv->id]);
            DB::table('conversation_orders')->insert(['conversation_id' => $cv->id, 'order_id' => $o->id, 'lead_id' => $lead?->id, 'linked_at' => now(), 'created_at' => now()]);
            if ($lead && $lead->status !== 'WON') {
                DB::table('leads')->where('id', $lead->id)->update(['status' => 'WON', 'converted_order_id' => $o->id, 'converted_at' => now(), 'customer_id' => $clienteId,
                    'lost_reason' => null, 'updated_at' => now()]);
                Events::emit('lead.converted', 'leads', $lead->id, ['order' => $o->id]);
            }
            self::atribuir($cv, $o, $lead, $clienteId, $nuevo);
            Events::emit('order.created_from_chat', 'sales_orders', $o->id, ['conversation' => $cv->id, 'by' => $u->id]);

            return ['id' => $o->id, 'number' => $o->number, 'nuevo_cliente' => $nuevo];
        });
    }

    /** RN-CRM-22: el resumen con el cobro en un solo mensaje. */
    public static function enviarResumen(string $conversacion, string $pedido, User $u): array
    {
        $cv = Conversaciones::visible($conversacion, $u);
        if (! DB::table('conversation_orders')->where('conversation_id', $cv->id)->where('order_id', $pedido)->exists()) {
            RuleError::fail('RN-CRM-09', 'Ese pedido no es de esta conversación.');
        }
        $ch = DB::table('messaging_channels')->where('id', $cv->channel_id)->first();
        $o = DB::table('sales_orders')->where('id', $pedido)->first();
        if (! DB::table('sales_order_lines')->where('sales_order_id', $pedido)->exists()) {
            RuleError::fail('RN-CRM-22', "El pedido {$o->number} todavía no tiene productos: complétalo en Pedidos antes de enviar el resumen.");
        }
        if ($ch->kind === 'WHATSAPP') {
            $t = DB::table('message_templates')->where('brand_id', $cv->brand_id)->where('purpose', 'ORDER_CONFIRMATION')->where('provider_status', 'APPROVED')->value('id');
            if (! $t) {
                RuleError::fail('RN-CRM-07', 'La marca no tiene una plantilla de confirmación aprobada.');
            }

            return Plantillas::enviar($conversacion, $t, $pedido, false, $u);
        }
        $v = Plantillas::variables($cv, $o);
        $texto = "Pedido {$v['pedido']} de {$v['marca']}:\n{$v['productos']}\nTotal estimado {$v['total']}".($v['direccion'] ? " · {$v['direccion']}" : '')
            .($v['fecha'] ? " · {$v['fecha']} {$v['franja']}" : '')."\nPaga con el Yape oficial de la empresa: {$v['yape']}. El monto final se ajusta al peso real.";

        return ['mensaje' => Mensajes::responder($conversacion, $texto, $u), 'conversacion' => Conversaciones::ver($conversacion, $u)];
    }

    public static function pedidosDelChat(string $conversacion): array
    {
        return DB::table('conversation_orders as x')->join('sales_orders as o', 'o.id', '=', 'x.order_id')->where('x.conversation_id', $conversacion)
            ->orderBy('x.linked_at')->get(['o.id', 'o.number', 'o.status', 'o.estimated_total', 'o.final_total', 'o.origin_ad_code'])
            ->map(fn ($o) => ['id' => $o->id, 'number' => $o->number, 'status' => $o->status, 'total' => (float) ($o->final_total ?? $o->estimated_total),
                'anuncio' => $o->origin_ad_code, 'lineas' => DB::table('sales_order_lines')->where('sales_order_id', $o->id)->count(),
                'resumen_enviado' => DB::table('conversation_messages as m')->join('message_templates as t', 't.id', '=', 'm.template_id')->where('m.order_id', $o->id)->where('t.purpose', 'ORDER_CONFIRMATION')->exists()])->all();
    }

    /** RN-CRM-09 y RN-ADS-05: la atribución del pedido al anuncio del chat (ADS la completará cuando esté). */
    private static function atribuir(object $cv, object $o, ?object $lead, string $cliente, bool $nuevo): void
    {
        if (DB::table('ad_attributions')->where('order_id', $o->id)->exists()) {
            return;
        }
        $anuncio = $cv->ad_code ? DB::table('ad_ads')->where(fn ($q) => $q->whereRaw('upper(code) = ?', [strtoupper($cv->ad_code)])->orWhereRaw('upper(tracking_code) = ?', [strtoupper($cv->ad_code)]))
            ->first(['id', 'campaign_id', 'platform']) : null;
        DB::table('ad_attributions')->insert([
            'lead_id' => $lead?->id, 'order_id' => $o->id, 'conversation_id' => $cv->id, 'ad_id' => $anuncio?->id, 'campaign_id' => $anuncio?->campaign_id,
            'platform' => $anuncio?->platform ?? ($cv->entry_point === 'TIKTOK_DM' ? 'TIKTOK' : ($cv->entry_point === 'CTWA_AD' ? 'META' : null)),
            'brand_id' => $o->brand_id, 'method' => self::METODO[$cv->entry_point] ?? ($cv->ad_code ? 'TRACKING_CODE' : 'NONE'), 'is_new_customer' => $nuevo,
            'attributed_at' => now(), 'lead_at' => $lead?->first_contact_at, 'customer_id' => $cliente, 'ad_code' => $cv->ad_code, 'created_at' => now(),
        ]);
    }
}
