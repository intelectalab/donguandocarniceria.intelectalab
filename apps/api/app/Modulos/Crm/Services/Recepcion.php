<?php

namespace App\Modulos\Crm\Services;

use App\Support\Events;
use App\Support\Params;
use App\Support\RuleError;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Mensajes que llegan (RN-CRM-02, 10, 11, 12 y 21).
 *
 *  - Un número desconocido se busca como cliente por su celular (E.164); si no existe, se crea un lead (no un cliente).
 *  - Los mensajes de grupos no se sincronizan con la coexistencia: se descartan y se cuentan en el número.
 *  - Si el primer mensaje trae el «referral» de un anuncio de clic a WhatsApp, la conversación queda «por anuncio» y abre
 *    la ventana gratuita de 72 h. Un código de anuncio en el texto (DG-A12) también se reconoce.
 *  - El primer mensaje de un contacto nuevo recibe el aviso de registro del número (Ley 29733) y queda en sus
 *    consentimientos; si no, una conversación nueva recibe el saludo automático. «BAJA» registra la baja de marketing.
 *  - El chat sin asignar va a la vendedora que corresponde (Equipos::elegir); si nadie cumple, queda en cola.
 */
class Recepcion
{
    /** Tipos que la coexistencia no entrega: se guardan como «mensaje no disponible». */
    private const NO_DISPONIBLES = ['VIEW_ONCE', 'LIVE_LOCATION', 'EPHEMERAL'];

    private const TIPOS = ['TEXT', 'IMAGE', 'AUDIO', 'DOCUMENT', 'LOCATION', 'STICKER', 'VIDEO'];

    /**
     * @param  array{channel_id: string, from: string, name?: ?string, text?: ?string, type?: string, external_id?: ?string, referral?: ?array, at?: ?Carbon, media?: ?array, group?: bool, transcript?: ?string}  $o
     * @return array{conversation_id: ?string, message_id: ?string, discarded?: bool, duplicate?: bool, lead_id?: ?string, assigned?: ?string}
     */
    public static function recibir(array $o): array
    {
        $ch = DB::table('messaging_channels')->where('id', $o['channel_id'])->first() ?? RuleError::fail('RN-CRM-01', 'Número o cuenta no conectado.');
        if ($ch->connection_mode === 'NOT_AVAILABLE') {
            RuleError::fail('RN-CRM-06', "{$ch->display_name} no está disponible para la cuenta peruana: los anuncios de TikTok llevan a WhatsApp con código.");
        }
        if ($ch->connection_mode === 'APP_ONLY') {
            RuleError::fail('RN-CRM-01', "{$ch->display_name} está en «solo app»: no está integrado y los pedidos se registran a mano.");
        }
        if (! empty($o['group'])) {
            DB::table('messaging_channels')->where('id', $ch->id)->increment('group_msgs_discarded');

            return ['conversation_id' => null, 'message_id' => null, 'discarded' => true];
        }
        if (! empty($o['external_id']) && ($ya = DB::table('conversation_messages')->where('external_id', $o['external_id'])->first(['id', 'conversation_id']))) {
            return ['conversation_id' => $ya->conversation_id, 'message_id' => $ya->id, 'duplicate' => true];
        }
        $de = trim((string) $o['from']);
        if ($ch->kind === 'WHATSAPP') {
            $de = '+'.ltrim(preg_replace('/[^\d+]/', '', $de), '+');
            if (! preg_match('/^\+[1-9]\d{7,14}$/', $de)) {
                RuleError::fail('RN-CRM-10', 'El número del cliente no es válido.');
            }
        }
        $at = $o['at'] ?? now();
        $tipo = strtoupper((string) ($o['type'] ?? 'TEXT'));
        $texto = isset($o['text']) ? mb_substr(trim((string) $o['text']), 0, 4096) : null;

        $r = DB::transaction(function () use ($ch, $o, $de, $at, $tipo, $texto) {
            // Contacto: cliente por celular o lead (RN-CRM-10).
            $contacto = DB::table('channel_contacts')->where('provider', $ch->kind)->where('external_user_id', $de)->lockForUpdate()->first();
            $nuevo = ! $contacto;
            $lead = null;
            if ($nuevo) {
                $cliente = $ch->kind === 'WHATSAPP' ? DB::table('customers')->where('phone', $de)->first(['id', 'full_name']) : null;
                if (! $cliente) {
                    $lead = DB::table('leads')->insertGetId(['brand_id' => $ch->brand_id, 'channel_id' => $ch->id, 'full_name' => self::nombre($o['name'] ?? null) ?? $de,
                        'phone' => $ch->kind === 'WHATSAPP' ? $de : null, 'source' => $ch->kind, 'status' => 'NEW', 'first_contact_at' => $at, 'created_at' => now(), 'updated_at' => now()], 'id');
                    Events::emit('lead.created', 'leads', $lead, ['channel' => $ch->id]);
                }
                $cid = DB::table('channel_contacts')->insertGetId(['provider' => $ch->kind, 'external_user_id' => $de, 'display_name' => self::nombre($o['name'] ?? null) ?? $cliente?->full_name ?? $de,
                    'phone' => $ch->kind === 'WHATSAPP' ? $de : null, 'customer_id' => $cliente?->id, 'lead_id' => $lead, 'blocked' => false, 'created_at' => now(), 'updated_at' => now()], 'id');
                $contacto = DB::table('channel_contacts')->where('id', $cid)->first();
            } elseif ($contacto->lead_id) {
                $lead = $contacto->lead_id;
            }

            // Conversación abierta del contacto en este número, o una nueva.
            $cv = DB::table('conversations')->where('channel_id', $ch->id)->where('contact_id', $contacto->id)->where('status', '<>', 'CLOSED')->lockForUpdate()->first();
            $referral = $o['referral'] ?? null;
            $codigo = $referral['ad_code'] ?? self::codigoEnTexto($texto);
            $anuncio = $codigo ? DB::table('ad_ads')->where(fn ($q) => $q->whereRaw('upper(code) = ?', [strtoupper($codigo)])->orWhereRaw('upper(tracking_code) = ?', [strtoupper($codigo)]))->value('id') : null;
            $creada = ! $cv;
            if ($creada) {
                $entrada = $referral ? 'CTWA_AD' : ($ch->kind === 'TIKTOK' ? 'TIKTOK_DM' : ($codigo ? 'TRACKING_CODE' : 'ORGANIC'));
                $id = DB::table('conversations')->insertGetId([
                    'channel_id' => $ch->id, 'contact_id' => $contacto->id, 'brand_id' => $ch->brand_id, 'customer_id' => $contacto->customer_id, 'lead_id' => $contacto->lead_id,
                    'status' => 'OPEN', 'entry_point' => $entrada, 'ad_id' => $anuncio, 'ad_code' => $codigo ? mb_substr(strtoupper($codigo), 0, 40) : null, 'opened_at' => $at,
                    'outbound_since_inbound' => 0, 'tags' => '[]', 'internal_notes' => '[]', 'last_inbound_at' => $at,
                    'service_window_expires_at' => $at->copy()->addHours(Mensajes::horasVentana($ch->kind)),
                    'free_entry_expires_at' => $entrada === 'CTWA_AD' ? $at->copy()->addHours((int) (Params::get('crm_wa_ctwa_free_hours') ?? 72)) : null,
                    'created_at' => now(), 'updated_at' => now(),
                ], 'id');
                if ($lead && $codigo) {
                    DB::table('leads')->where('id', $lead)->whereNull('ad_code')->update(['ad_code' => mb_substr(strtoupper($codigo), 0, 40), 'ad_id' => $anuncio, 'updated_at' => now()]);
                }
                $cv = DB::table('conversations')->where('id', $id)->first();
            } elseif ($referral && $cv->entry_point !== 'CTWA_AD') {
                // El referral de un anuncio gana a cualquier otra entrada (RN-CRM-12).
                DB::table('conversations')->where('id', $cv->id)->update(['entry_point' => 'CTWA_AD', 'ad_code' => $codigo ? mb_substr(strtoupper($codigo), 0, 40) : $cv->ad_code, 'ad_id' => $anuncio ?? $cv->ad_id,
                    'free_entry_expires_at' => $at->copy()->addHours((int) (Params::get('crm_wa_ctwa_free_hours') ?? 72)), 'updated_at' => now()]);
            }

            $noDisponible = in_array($tipo, self::NO_DISPONIBLES, true);
            $mid = DB::table('conversation_messages')->insertGetId([
                'conversation_id' => $cv->id, 'channel_id' => $ch->id, 'brand_id' => $cv->brand_id, 'direction' => 'IN', 'origin' => 'API',
                'msg_type' => $noDisponible ? 'UNSUPPORTED' : (in_array($tipo, self::TIPOS, true) ? $tipo : 'TEXT'), 'body' => $noDisponible ? null : $texto,
                'media' => isset($o['media']) ? json_encode($o['media'], JSON_UNESCAPED_UNICODE) : null, 'referral' => $referral ? json_encode($referral, JSON_UNESCAPED_UNICODE) : null,
                'unsupported_kind' => $noDisponible ? $tipo : null, 'sent_at' => isset($o['at']) ? $at : DB::raw('clock_timestamp()'), 'cost' => 0,
                'external_id' => $o['external_id'] ?? 'crm-in-'.bin2hex(random_bytes(10)), 'created_at' => now(),
            ], 'id');
            if (! empty($o['transcript'])) {
                DB::table('message_transcripts')->insert(['message_id' => $mid, 'provider' => 'PROVEEDOR', 'language' => 'es', 'transcript' => mb_substr((string) $o['transcript'], 0, 4000), 'created_at' => now()]);
            }
            DB::table('conversations')->where('id', $cv->id)->update([
                'last_inbound_at' => $at, 'outbound_since_inbound' => 0, 'status' => 'OPEN', 'updated_at' => now(),
                'service_window_expires_at' => $at->copy()->addHours(Mensajes::horasVentana($ch->kind)),
            ]);

            return ['cv' => $cv->id, 'mid' => $mid, 'nuevo' => $nuevo, 'creada' => $creada, 'contacto' => $contacto, 'lead' => $lead];
        });

        $cv = Conversaciones::fila($r['cv']);
        // Aviso de registro (contacto nuevo) o saludo (conversación nueva).
        if ($r['nuevo'] && $ch->recording_notice_text) {
            $aviso = Mensajes::salir($cv, $ch, ['body' => $ch->recording_notice_text, 'msg_type' => 'TEXT', 'category' => 'SERVICE', 'origin' => 'SYSTEM']);
            DB::table('contact_consents')->insert(['contact_id' => $r['contacto']->id, 'customer_id' => $r['contacto']->customer_id, 'purpose' => 'RECORDING_NOTICE', 'granted' => true,
                'channel' => $ch->kind, 'evidence_message_id' => $aviso['id'], 'evidence_text' => 'Aviso automático al primer mensaje', 'recorded_at' => DB::raw('clock_timestamp()'), 'brand_id' => $ch->brand_id,
                'recorded_by' => 'Sistema', 'source' => 'AUTO', 'created_at' => now()]);
        } elseif ($r['creada'] && $ch->auto_greeting) {
            Mensajes::salir($cv, $ch, ['body' => $ch->auto_greeting, 'msg_type' => 'TEXT', 'category' => 'SERVICE', 'origin' => 'SYSTEM']);
        }
        if ($texto !== null && preg_match('/^\s*baja\s*[.!]?\s*$/iu', $texto)) {
            DB::table('contact_consents')->insert(['contact_id' => $r['contacto']->id, 'customer_id' => $r['contacto']->customer_id, 'purpose' => 'MARKETING', 'granted' => false,
                'channel' => $ch->kind, 'evidence_message_id' => $r['mid'], 'evidence_text' => 'Respondió BAJA', 'recorded_at' => DB::raw('clock_timestamp()'), 'brand_id' => $ch->brand_id,
                'recorded_by' => 'Cliente', 'source' => 'MESSAGE', 'created_at' => now()]);
        }
        $asignada = Conversaciones::fila($r['cv'])->assigned_user_id;
        if (! $asignada) {
            $asignada = Conversaciones::asignarAutomatico($r['cv']);
        }
        Events::emit('message.received', 'conversation_messages', $r['mid'], ['conversation' => $r['cv']]);

        return ['conversation_id' => $r['cv'], 'message_id' => $r['mid'], 'lead_id' => $r['lead'], 'assigned' => $asignada];
    }

    /** El cliente borró su mensaje: el original se conserva y queda el estado (RN-CRM-04). */
    public static function borradoPorCliente(string $externalId, ?Carbon $cuando = null): bool
    {
        $id = DB::table('conversation_messages')->where('external_id', $externalId)->where('direction', 'IN')->value('id');
        if (! $id || DB::table('message_status_events')->where('message_id', $id)->where('status', 'DELETED_BY_CUSTOMER')->exists()) {
            return false;
        }
        DB::table('message_status_events')->insert(['message_id' => $id, 'status' => 'DELETED_BY_CUSTOMER', 'occurred_at' => $cuando ?? now(), 'created_at' => now()]);

        return true;
    }

    /**
     * Procesador del webhook de WhatsApp Cloud (lo instala CRM en INT). Lee mensajes y estados de cada cambio. El número
     * es el enlazado al conector del webhook.
     */
    public static function webhookWhatsApp(array $cuerpo, object $conector, object $evento): string
    {
        $recibidos = 0;
        $estados = 0;
        $grupos = 0;
        foreach ($cuerpo['entry'] ?? [] as $entrada) {
            foreach ($entrada['changes'] ?? [] as $cambio) {
                $v = $cambio['value'] ?? [];
                $numero = isset($v['metadata']['display_phone_number']) ? '+'.ltrim((string) $v['metadata']['display_phone_number'], '+') : null;
                $ch = DB::table('messaging_channels')->where('connector_id', $conector->id)->where('kind', 'WHATSAPP')->when($numero, fn ($q) => $q->where('number', $numero))->first()
                    ?? DB::table('messaging_channels')->where('connector_id', $conector->id)->where('kind', 'WHATSAPP')->first();
                if (! $ch) {
                    throw new \RuntimeException("El conector {$conector->code} no atiende ningún número de WhatsApp en CRM: enlázalo en Números y cuentas.");
                }
                $nombres = collect($v['contacts'] ?? [])->mapWithKeys(fn ($c) => [(string) ($c['wa_id'] ?? '') => $c['profile']['name'] ?? null])->all();
                foreach ($v['messages'] ?? [] as $m) {
                    $tipo = strtoupper((string) ($m['type'] ?? 'text'));
                    if (isset($m['group_id']) || str_contains((string) ($m['from'] ?? ''), '@g.us')) {
                        self::recibir(['channel_id' => $ch->id, 'from' => (string) $m['from'], 'group' => true]);
                        $grupos++;

                        continue;
                    }
                    if ($tipo === 'REACTION' || ($tipo === 'UNSUPPORTED' && ($m['errors'][0]['code'] ?? null) === 131051)) {
                        continue;
                    }
                    if (isset($m['type']) && $m['type'] === 'revoke' && isset($m['context']['id'])) {
                        self::borradoPorCliente((string) $m['context']['id']);

                        continue;
                    }
                    $texto = $m['text']['body'] ?? $m['image']['caption'] ?? $m['document']['caption'] ?? $m['button']['text'] ?? $m['interactive']['button_reply']['title'] ?? null;
                    $ref = isset($m['referral']) ? ['ad_code' => $m['referral']['source_id'] ?? null, 'headline' => $m['referral']['headline'] ?? null, 'source_url' => $m['referral']['source_url'] ?? null] : null;
                    $media = $tipo === 'LOCATION' ? ['lat' => $m['location']['latitude'] ?? null, 'lng' => $m['location']['longitude'] ?? null, 'label' => $m['location']['name'] ?? null] : null;
                    self::recibir([
                        'channel_id' => $ch->id, 'from' => (string) $m['from'], 'name' => $nombres[(string) $m['from']] ?? null, 'text' => $texto,
                        'type' => ($m['is_view_once'] ?? false) ? 'VIEW_ONCE' : $tipo, 'external_id' => (string) ($m['id'] ?? ''), 'referral' => $ref, 'media' => $media,
                        'at' => isset($m['timestamp']) ? Carbon::createFromTimestamp((int) $m['timestamp']) : now(),
                    ]);
                    $recibidos++;
                }
                foreach ($v['statuses'] ?? [] as $s) {
                    if (Mensajes::estadoDelProveedor((string) ($s['id'] ?? ''), (string) ($s['status'] ?? ''), isset($s['timestamp']) ? Carbon::createFromTimestamp((int) $s['timestamp']) : now())) {
                        $estados++;
                    }
                }
            }
        }

        return "CRM: {$recibidos} mensaje(s) recibido(s), {$estados} estado(s)".($grupos ? ", {$grupos} de grupo descartado(s)" : '').'.';
    }

    /** Un código de anuncio en el texto: «DG-A12», «M2-B3» o el código de un anuncio cargado. */
    public static function codigoEnTexto(?string $texto): ?string
    {
        $t = (string) $texto;
        if ($t === '') {
            return null;
        }
        foreach (DB::table('ad_ads')->whereNotNull('tracking_code')->pluck('tracking_code') as $c) {
            if (mb_strlen($c) >= 5 && preg_match('/(^|[^A-Za-z0-9])'.preg_quote($c, '/').'($|[^A-Za-z0-9])/i', $t)) {
                return strtoupper($c);
            }
        }

        return preg_match('/\b([A-Z]{2}\d?)-([A-Z]\d{1,3})\b/i', $t, $m) ? strtoupper($m[0]) : null;
    }

    private static function nombre(?string $n): ?string
    {
        $n = trim((string) $n);

        return $n === '' ? null : mb_substr($n, 0, 80);
    }
}
