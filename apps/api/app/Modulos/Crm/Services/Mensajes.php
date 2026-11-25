<?php

namespace App\Modulos\Crm\Services;

use App\Models\User;
use App\Modulos\Int\Services\Adaptadores;
use App\Modulos\Int\Services\Conectores;
use App\Modulos\Int\Services\Salientes;
use App\Support\Events;
use App\Support\Params;
use App\Support\RuleError;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Mensajes de las conversaciones (RN-CRM-04, 05, 06 y 13).
 *
 *  - Solo inserción: un mensaje no se edita ni se borra (la base no se lo permite a la aplicación).
 *  - Un mensaje libre solo sale dentro de la ventana de la red (WhatsApp, Messenger e Instagram 24 h; TikTok 48 h y como
 *    máximo 10 seguidos sin respuesta del cliente). Fuera de ella, solo una plantilla aprobada (tanda 3).
 *  - El mensaje sale por el conector del número (INT, mensajes salientes). Si el número todavía no tiene el proveedor
 *    oficial conectado, queda registrado como «no enviado» y no se cobra.
 *  - El costo (WhatsApp) se registra cuando el proveedor acepta el mensaje, con la tarifa vigente.
 */
class Mensajes
{
    public const ORIGENES = ['API' => 'Desde el sistema', 'SYSTEM' => 'Automático', 'BUSINESS_APP' => 'Desde la app del celular'];

    public const ESTADOS = [
        'QUEUED' => 'En cola de envío', 'NOT_SENT' => 'No enviado', 'SENT' => 'Enviado', 'DELIVERED' => 'Entregado', 'READ' => 'Leído', 'FAILED' => 'Falló',
        'DELETED_BY_CUSTOMER' => 'Borrado por el cliente', 'DELETED_IN_APP' => 'Borrado en la app del celular',
    ];

    public const MOTIVOS_COSTO = [
        'CHARGED' => 'Cobrado', 'FREE_SERVICE_QUOTA' => 'Gratis (cuota de respuestas del mes)', 'FREE_CTWA_WINDOW' => 'Gratis (ventana de anuncio de 72 h)',
        'FREE_UTILITY_IN_WINDOW' => 'Gratis (utilidad dentro de la ventana)', 'BUSINESS_APP' => 'Desde la app del celular', 'NOT_WHATSAPP' => 'No es WhatsApp',
    ];

    public const CATEGORIAS = ['SERVICE' => 'Servicio', 'UTILITY' => 'Utilidad', 'MARKETING' => 'Marketing', 'AUTHENTICATION' => 'Autenticación'];

    /** Horas de la ventana de la red del número. */
    public static function horasVentana(string $red): int
    {
        return (int) match ($red) {
            'TIKTOK' => Params::get('crm_tiktok_window_hours') ?? 48,
            'WHATSAPP' => Params::get('crm_wa_service_window_hours') ?? 24,
            default => Params::get('crm_meta_dm_window_hours') ?? 24,
        };
    }

    /** Respuesta libre de una persona (RN-CRM-03, 05, 06). Devuelve el mensaje creado. */
    public static function responder(string $conversacion, string $texto, User $u): array
    {
        $cv = Conversaciones::fila($conversacion);
        if (! Conversaciones::puedeResponder($cv, $u)) {
            RuleError::fail('RN-CRM-03', $cv->assigned_user_id
                ? 'Este chat está asignado a '.(DB::table('users')->where('id', $cv->assigned_user_id)->value('name') ?? 'otra persona').': solo ella o la supervisora responden.'
                : 'El chat está en cola: la supervisora lo asigna o lo toma.');
        }
        $texto = trim($texto);
        if ($texto === '') {
            RuleError::fail('RN-CRM-05', 'Escribe el mensaje.');
        }
        if ($cv->status === 'CLOSED') {
            RuleError::fail('RN-CRM-05', 'La conversación está cerrada: reábrela para escribir.');
        }
        $ch = DB::table('messaging_channels')->where('id', $cv->channel_id)->first();
        $ahora = now();
        if ($ch->kind === 'TIKTOK') {
            $lim = self::horasVentana('TIKTOK');
            $max = (int) (Params::get('crm_tiktok_max_consecutive') ?? 10);
            if (! $cv->last_inbound_at || Carbon::parse($cv->last_inbound_at)->addHours($lim)->lt($ahora)) {
                RuleError::fail('RN-CRM-06', "En TikTok solo se responde dentro de {$lim} h desde el último mensaje del cliente.");
            }
            if ((int) $cv->outbound_since_inbound >= $max) {
                RuleError::fail('RN-CRM-06', "En TikTok se envían como máximo {$max} mensajes seguidos sin respuesta del cliente.");
            }
        } elseif (! $cv->service_window_expires_at || Carbon::parse($cv->service_window_expires_at)->lt($ahora)) {
            RuleError::fail('RN-CRM-05', 'Fuera de la ventana de '.self::horasVentana($ch->kind).' h desde el último mensaje del cliente: solo se envía una plantilla aprobada.');
        }

        return self::salir($cv, $ch, ['body' => mb_substr($texto, 0, 4096), 'msg_type' => 'TEXT', 'category' => 'SERVICE', 'user' => $u]);
    }

    /**
     * Mensaje saliente ya validado: lo guarda (solo inserción), lo encola por el conector del número y actualiza la
     * conversación. Lo usan la respuesta de una persona y los mensajes automáticos (aviso de registro, saludo).
     *
     * @param  array{body: string, msg_type: string, category: string, user?: ?User, origin?: string, order_id?: ?string, template_id?: ?string}  $o
     */
    public static function salir(object $cv, object $ch, array $o): array
    {
        $u = $o['user'] ?? null;
        $origen = $o['origin'] ?? ($u ? 'API' : 'SYSTEM');
        $ahora = now();

        return DB::transaction(function () use ($cv, $ch, $o, $u, $origen, $ahora) {
            $id = DB::table('conversation_messages')->insertGetId([
                'conversation_id' => $cv->id, 'channel_id' => $ch->id, 'brand_id' => $cv->brand_id, 'direction' => 'OUT', 'origin' => $origen,
                'sender_user_id' => $u?->id, 'msg_type' => $o['msg_type'], 'body' => $o['body'], 'template_id' => $o['template_id'] ?? null,
                'category' => $ch->kind === 'WHATSAPP' ? $o['category'] : null, 'order_id' => $o['order_id'] ?? null, 'sent_at' => $ahora, 'cost' => 0,
                'external_id' => 'crm-'.bin2hex(random_bytes(10)), 'created_at' => $ahora,
            ], 'id');
            $c = $ch->connector_id ? DB::table('integration_connectors')->where('id', $ch->connector_id)->first() : null;
            $puede = $c && $c->status !== 'DISABLED' && Adaptadores::puedeEnviar($c) && Conectores::moduloEncendido('CRM');
            $cola = $puede ? Salientes::encolar($c->id, 'CRM', 'MESSAGE', 'crm.message', [
                'to' => DB::table('channel_contacts')->where('id', $cv->contact_id)->value('external_user_id'), 'channel' => $ch->number,
                'type' => $o['msg_type'], 'text' => $o['body'], 'message_id' => $id,
            ], $id, "crm-msg-{$id}") : null;
            DB::table('message_status_events')->insert(['message_id' => $id, 'status' => $cola ? 'QUEUED' : 'NOT_SENT', 'occurred_at' => $ahora, 'created_at' => $ahora]);

            $humano = $u !== null && $origen !== 'SYSTEM';
            $cambio = ['last_outbound_at' => $ahora, 'updated_at' => $ahora, 'outbound_since_inbound' => (int) $cv->outbound_since_inbound + ($origen === 'SYSTEM' ? 0 : 1)];
            if ($humano) {
                $cambio['last_reply_at'] = $ahora;
                if (! $cv->first_response_at) {
                    $cambio['first_response_at'] = $ahora;   // RN-CRM-14: la primera respuesta humana, sin el saludo automático
                }
            }
            DB::table('conversations')->where('id', $cv->id)->update($cambio);
            if ($humano && $cv->lead_id) {
                DB::table('leads')->where('id', $cv->lead_id)->where('status', 'NEW')->update(['status' => 'CONTACTED', 'first_response_at' => $ahora,
                    'owner_user_id' => DB::raw('coalesce(owner_user_id, '.DB::getPdo()->quote($u->id).'::uuid)'), 'updated_at' => $ahora]);
            }
            Events::emit('message.sent', 'conversation_messages', $id, ['conversation' => $cv->id, 'queued' => (bool) $cola, 'by' => $u?->id]);

            return ['id' => $id, 'estado' => $cola ? 'QUEUED' : 'NOT_SENT',
                'aviso' => $cola ? null : 'El número todavía no tiene el proveedor oficial conectado: el mensaje queda registrado, pero no sale.'];
        });
    }

    /** Cuando INT confirma que el proveedor aceptó el mensaje: estado «enviado» y su costo (RN-CRM-13). */
    public static function aceptado(object $salida): void
    {
        // Solo los mensajes que encola la bandeja (otros módulos usan el mismo conector con sus propias referencias).
        $id = (string) $salida->ref;
        if ($salida->event !== 'crm.message' || ! preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/', $id)) {
            return;
        }
        $m = DB::table('conversation_messages')->where('id', $id)->first();
        if (! $m || DB::table('message_status_events')->where('message_id', $id)->where('status', 'SENT')->exists()) {
            return;
        }
        $ahora = now();
        DB::table('message_status_events')->insert(['message_id' => $id, 'status' => 'SENT', 'occurred_at' => $ahora, 'pricing_category' => $m->category, 'created_at' => $ahora]);
        $ch = DB::table('messaging_channels')->where('id', $m->channel_id)->first();
        if ($ch->kind !== 'WHATSAPP' || DB::table('message_charges')->where('message_id', $id)->exists()) {
            return;
        }
        $cv = DB::table('conversations')->where('id', $m->conversation_id)->first();
        $t = self::tarifa($m->category ?? 'SERVICE', $cv, $ch, $m->origin, Carbon::parse($m->sent_at));
        DB::table('message_charges')->insert([
            'message_id' => $id, 'channel_id' => $ch->id, 'brand_id' => $m->brand_id, 'user_id' => $m->sender_user_id, 'conversation_id' => $cv->id, 'order_id' => $m->order_id,
            'period' => Carbon::parse($m->sent_at)->setTimezone('America/Lima')->startOfMonth()->toDateString(), 'category' => $m->category ?? 'SERVICE',
            'billable' => $t['billable'], 'reason' => $t['reason'], 'rate' => $t['rate'], 'amount' => $t['amount'], 'charged_at' => $ahora, 'created_at' => $ahora,
        ]);
    }

    /**
     * RN-CRM-13: costo de un mensaje saliente de WhatsApp. Gratis desde la app del celular y dentro de la ventana de 72 h de
     * un anuncio; las respuestas de servicio son gratis hasta la cuota del mes del número; la utilidad, gratis dentro de la
     * ventana de servicio.
     *
     * @return array{billable: bool, reason: string, rate: float, amount: float}
     */
    public static function tarifa(string $categoria, object $cv, object $ch, string $origen = 'API', ?Carbon $cuando = null): array
    {
        $cuando ??= now();
        $gratis = fn (string $r) => ['billable' => false, 'reason' => $r, 'rate' => 0.0, 'amount' => 0.0];
        if ($ch->kind !== 'WHATSAPP') {
            return $gratis('NOT_WHATSAPP');
        }
        if ($origen === 'BUSINESS_APP') {
            return $gratis('BUSINESS_APP');
        }
        if ($cv->free_entry_expires_at && Carbon::parse($cv->free_entry_expires_at)->gte($cuando)) {
            return $gratis('FREE_CTWA_WINDOW');
        }
        $tarifa = fn (string $p, float $d) => ['billable' => true, 'reason' => 'CHARGED', 'rate' => (float) str_replace(',', '.', (string) (Params::get($p) ?? $d)), 'amount' => (float) str_replace(',', '.', (string) (Params::get($p) ?? $d))];
        if ($categoria === 'SERVICE') {
            return self::usadas($ch->id, $cuando) < (int) ($ch->free_service_quota ?: (Params::get('crm_wa_service_free_per_number') ?? 1000))
                ? $gratis('FREE_SERVICE_QUOTA') : $tarifa('crm_wa_rate_service', 0.0998);
        }
        if ($categoria === 'UTILITY') {
            return $cv->service_window_expires_at && Carbon::parse($cv->service_window_expires_at)->gte($cuando) ? $gratis('FREE_UTILITY_IN_WINDOW') : $tarifa('crm_wa_rate_utility', 0.0998);
        }

        return $categoria === 'AUTHENTICATION' ? $tarifa('crm_wa_rate_authentication', 0.0998) : $tarifa('crm_wa_rate_marketing', 0.2339);
    }

    /** Respuestas de servicio del mes que cuentan para la cuota del número. */
    public static function usadas(string $canal, ?Carbon $cuando = null): int
    {
        $mes = ($cuando ?? now())->copy()->setTimezone('America/Lima')->startOfMonth()->toDateString();

        return DB::table('message_charges')->where('channel_id', $canal)->where('period', $mes)->where('category', 'SERVICE')->whereIn('reason', ['FREE_SERVICE_QUOTA', 'CHARGED'])->count();
    }

    /** Estados de WhatsApp (sent, delivered, read, failed) que llegan por webhook; el mensaje se busca por la referencia del proveedor. */
    public static function estadoDelProveedor(string $refProveedor, string $estado, Carbon $cuando): bool
    {
        $mapa = ['sent' => 'SENT', 'delivered' => 'DELIVERED', 'read' => 'READ', 'failed' => 'FAILED'];
        $e = $mapa[strtolower($estado)] ?? null;
        $id = $e ? (DB::table('outbox_messages')->where('module', 'CRM')->where('provider_ref', $refProveedor)->value('ref')
            ?? DB::table('conversation_messages')->where('external_id', $refProveedor)->value('id')) : null;
        if (! $id || DB::table('message_status_events')->where('message_id', $id)->where('status', $e)->exists()) {
            return false;
        }
        DB::table('message_status_events')->insert(['message_id' => $id, 'status' => $e, 'occurred_at' => $cuando, 'created_at' => now()]);

        return true;
    }
}
