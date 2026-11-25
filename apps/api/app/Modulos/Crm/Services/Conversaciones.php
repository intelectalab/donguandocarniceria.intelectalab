<?php

namespace App\Modulos\Crm\Services;

use App\Models\User;
use App\Modulos\Int\Services\Adaptadores;
use App\Modulos\Int\Services\Simulador;
use App\Support\Access;
use App\Support\Events;
use App\Support\Paginas;
use App\Support\Params;
use App\Support\RuleError;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * CRM-01 Bandeja y CRM-02 Conversación (RN-CRM-03 y 14).
 *
 * La vendedora ve las bandejas de los números donde es miembro y responde solo los chats asignados a ella. La supervisión
 * (con la gerencia y la auditoría) ve todos los de sus marcas; la supervisora y la gerencia responden y reasignan. El
 * tiempo sin respuesta cuenta solo en el horario de atención.
 */
class Conversaciones
{
    public const ESTADOS = ['OPEN' => 'Abierta', 'PENDING' => 'Esperando al cliente', 'SNOOZED' => 'En espera', 'CLOSED' => 'Cerrada'];

    public const ENTRADAS = [
        'ORGANIC' => 'Orgánico', 'CTWA_AD' => 'Anuncio de clic a WhatsApp', 'TRACKING_CODE' => 'Código de anuncio', 'UTM' => 'Enlace con UTM',
        'TEMPLATE_REPLY' => 'Respuesta a plantilla', 'TIKTOK_DM' => 'Mensaje de TikTok', 'PHONE' => 'Llamada',
    ];

    public const CIERRES = ['ORDER_CREATED' => 'Pedido creado', 'NO_PURCHASE' => 'Sin compra', 'INFO_ONLY' => 'Solo información', 'SPAM' => 'Spam', 'TRANSFERRED' => 'Derivado', 'INACTIVE' => 'Sin actividad'];

    public const ETIQUETAS = ['Cliente frecuente', 'Anuncio', 'Recompra', 'Reclamo', 'Mayorista', 'Evento', 'Provincia', 'Pregunta de precio'];

    public const POR_ANUNCIO = ['CTWA_AD', 'TRACKING_CODE', 'TIKTOK_DM'];

    public static function fila(string $id): object
    {
        return DB::table('conversations')->where('id', $id)->first() ?? abort(404);
    }

    /** Las conversaciones que la persona puede ver (RN-CRM-03). */
    public static function visibles(User $u)
    {
        $a = Access::for($u);
        $q = DB::table('conversations as v')->join('messaging_channels as c', 'c.id', '=', 'v.channel_id')
            ->when($a['brands'], fn ($w) => $w->whereIn('v.brand_id', $a['brands']));
        if (! Access::can($u, 'crm.conversation.view_all')) {
            $q->whereExists(fn ($x) => $x->from('channel_members as m')->whereColumn('m.channel_id', 'v.channel_id')->where('m.user_id', $u->id)->where('m.active', true));
        }

        return $q;
    }

    public static function visible(string $id, User $u): object
    {
        return self::visibles($u)->where('v.id', $id)->first(['v.*']) ?? abort(404);
    }

    /** RN-CRM-03: la vendedora responde solo sus chats; la supervisora y la gerencia, los de sus números. */
    public static function puedeResponder(object $cv, User $u): bool
    {
        if (! Access::can($u, 'crm.conversation.reply')) {
            return false;
        }
        if (! self::visibles($u)->where('v.id', $cv->id)->exists()) {
            return false;
        }
        if (Access::can($u, 'crm.conversation.reassign')) {
            return true;   // supervisora y gerencia
        }

        return $cv->assigned_user_id === $u->id
            && DB::table('channel_members')->where('channel_id', $cv->channel_id)->where('user_id', $u->id)->where('active', true)->exists();
    }

    /** CRM-01: la bandeja con sus cifras y filtros. */
    public static function lista(array $f, User $u): array
    {
        $ahora = now();
        $lim = (int) (Params::get('crm_unanswered_alert_minutes') ?? 15);
        $base = self::visibles($u);
        $abiertas = (clone $base)->where('v.status', '<>', 'CLOSED');
        $sinResponder = fn ($q) => $q->whereNotNull('v.last_inbound_at')->where(fn ($w) => $w->whereNull('v.last_reply_at')->orWhereColumn('v.last_reply_at', '<', 'v.last_inbound_at'))
            ->where('v.last_inbound_at', '<', $ahora->copy()->subMinutes($lim));
        $porVencer = fn ($q) => $q->whereBetween('v.service_window_expires_at', [$ahora, $ahora->copy()->addHours(2)]);
        $cifras = [
            'abiertas' => (clone $abiertas)->count(),
            'en_cola' => (clone $abiertas)->whereNull('v.assigned_user_id')->count(),
            'mias' => (clone $abiertas)->where('v.assigned_user_id', $u->id)->count(),
            'sin_responder' => $sinResponder(clone $abiertas)->count(),
            'por_vencer' => $porVencer(clone $abiertas)->count(),
            'por_anuncio' => (clone $abiertas)->whereIn('v.entry_point', self::POR_ANUNCIO)->count(),
        ];

        $q = (clone $base)->leftJoin('channel_contacts as k', 'k.id', '=', 'v.contact_id')->leftJoin('customers as cu', 'cu.id', '=', 'v.customer_id')
            ->leftJoin('leads as l', 'l.id', '=', 'v.lead_id')->leftJoin('users as us', 'us.id', '=', 'v.assigned_user_id')->leftJoin('brands as b', 'b.id', '=', 'v.brand_id');
        match ($f['estado'] ?? 'OPEN') {
            'CLOSED' => $q->where('v.status', 'CLOSED'),
            'ALL' => null,
            default => $q->where('v.status', '<>', 'CLOSED'),
        };
        if (! empty($f['canal'])) {
            $q->where('v.channel_id', $f['canal']);
        }
        if (! empty($f['red'])) {
            $q->where('c.kind', $f['red']);
        }
        if (! empty($f['marca'])) {
            $q->where('v.brand_id', $f['marca']);
        }
        match ($f['asignada'] ?? '') {
            '' => null,
            'me' => $q->where('v.assigned_user_id', $u->id),
            'none' => $q->whereNull('v.assigned_user_id'),
            default => $q->where('v.assigned_user_id', $f['asignada']),
        };
        if (! empty($f['sin_responder'])) {
            $sinResponder($q);
        }
        if (! empty($f['por_vencer'])) {
            $porVencer($q);
        }
        if (! empty($f['por_anuncio'])) {
            $q->whereIn('v.entry_point', self::POR_ANUNCIO);
        }
        $t = trim((string) ($f['buscar'] ?? ''));
        if (mb_strlen($t) >= 2) {
            $p = '%'.addcslashes($t, '%_\\').'%';
            $q->where(fn ($w) => $w->where('k.display_name', 'ilike', $p)->orWhere('k.external_user_id', 'ilike', $p)->orWhere('cu.full_name', 'ilike', $p)
                ->orWhere('l.full_name', 'ilike', $p)->orWhere('v.ad_code', 'ilike', $p));
        }
        $q->orderByRaw('greatest(v.last_inbound_at, v.last_outbound_at, v.opened_at) DESC NULLS LAST')->orderBy('v.id');
        Paginas::ordenar($q, ['contacto' => "coalesce(cu.full_name, l.full_name, k.display_name, k.external_user_id)", 'ultimo' => 'greatest(v.last_inbound_at, v.last_outbound_at, v.opened_at)',
            'canal' => 'c.display_name', 'asignada' => 'us.name', 'estado' => 'v.status'], 'v.id', $f);
        $q->select(['v.*', 'c.kind', 'c.display_name as channel_name', 'c.number as channel_number', 'k.display_name as contact_name', 'k.external_user_id',
            'cu.full_name as customer_name', 'l.full_name as lead_name', 'us.name as assigned_name', 'b.name as brand_name', 'b.primary_color']);
        $r = Paginas::de($q, fn ($v) => self::resumen($v, $ahora), $f);
        // El último mensaje de cada fila de la página.
        $ids = array_column($r['data'], 'id');
        $ultimos = $ids ? DB::table('conversation_messages')->whereIn('conversation_id', $ids)->selectRaw('DISTINCT ON (conversation_id) conversation_id, direction, origin, msg_type, body, sent_at')
            ->orderBy('conversation_id')->orderByDesc('sent_at')->get()->keyBy('conversation_id') : collect();
        foreach ($r['data'] as &$fila) {
            $m = $ultimos[$fila['id']] ?? null;
            $fila['ultimo'] = $m ? ['texto' => self::extracto($m), 'at' => $m->sent_at, 'direction' => $m->direction] : null;
        }
        unset($fila);

        return $r + [
            'cifras' => $cifras, 'limite' => $lim,
            'canales' => Canales::visibles($u)->orderByRaw("CASE c.kind WHEN 'WHATSAPP' THEN 0 ELSE 1 END")->orderBy('c.display_name')
                ->get(['c.id', 'c.kind', 'c.display_name'])->map(fn ($c) => ['value' => $c->id, 'label' => (Canales::REDES[$c->kind] ?? $c->kind).' · '.$c->display_name])->all(),
            'personas' => DB::table('channel_members as m')->join('users as x', 'x.id', '=', 'm.user_id')->whereIn('m.channel_id', Canales::visibles($u)->pluck('c.id'))->where('m.active', true)
                ->select('x.id', 'x.name')->distinct()->orderBy('x.name')->get()->map(fn ($x) => ['value' => $x->id, 'label' => $x->name])->all(),
            'redes' => collect(Canales::REDES)->map(fn ($l, $k) => ['value' => $k, 'label' => $l])->values()->all(),
            'estado_agente' => Equipos::miEstado($u),
            'simulador' => Simulador::disponible() && Access::can($u, 'crm.conversation.reply'),
            'puede' => ['responder' => Access::can($u, 'crm.conversation.reply'), 'reasignar' => Access::can($u, 'crm.conversation.reassign')],
        ];
    }

    /** CRM-02: el hilo con sus notas, el panel del cliente y qué se puede enviar ahora y cuánto cuesta. */
    public static function ver(string $id, User $u): array
    {
        $v = self::visible($id, $u);
        $ahora = now();
        $ch = DB::table('messaging_channels')->where('id', $v->channel_id)->first();
        $fila = self::visibles($u)->where('v.id', $id)->leftJoin('channel_contacts as k', 'k.id', '=', 'v.contact_id')->leftJoin('customers as cu', 'cu.id', '=', 'v.customer_id')
            ->leftJoin('leads as l', 'l.id', '=', 'v.lead_id')->leftJoin('users as us', 'us.id', '=', 'v.assigned_user_id')->leftJoin('brands as b', 'b.id', '=', 'v.brand_id')
            ->first(['v.*', 'c.kind', 'c.display_name as channel_name', 'c.number as channel_number', 'k.display_name as contact_name', 'k.external_user_id',
                'cu.full_name as customer_name', 'l.full_name as lead_name', 'us.name as assigned_name', 'b.name as brand_name', 'b.primary_color']);

        $msgs = DB::table('conversation_messages as m')->where('m.conversation_id', $id)->leftJoin('users as x', 'x.id', '=', 'm.sender_user_id')
            ->leftJoin('message_templates as t', 't.id', '=', 'm.template_id')->leftJoin('message_charges as g', 'g.message_id', '=', 'm.id')
            ->orderBy('m.sent_at')->orderBy('m.created_at')->limit(500)
            ->get(['m.*', 'x.name as sender_name', 't.name as template_name', 'g.amount as charge_amount', 'g.reason as charge_reason_real', 'g.category as charge_category']);
        $estados = DB::table('message_status_events')->whereIn('message_id', $msgs->pluck('id'))->orderBy('occurred_at')->get()->groupBy('message_id');
        $trans = DB::table('message_transcripts')->whereIn('message_id', $msgs->pluck('id'))->pluck('transcript', 'message_id');
        $mensajes = $msgs->map(function ($m) use ($estados, $trans, $ch) {
            $es = collect($estados[$m->id] ?? [])->pluck('status')->all();
            $ultimo = collect(['READ', 'DELIVERED', 'SENT', 'FAILED', 'QUEUED', 'NOT_SENT'])->first(fn ($s) => in_array($s, $es, true));

            return [
                'id' => $m->id, 'direction' => $m->direction, 'origin' => $m->origin, 'origin_name' => Mensajes::ORIGENES[$m->origin] ?? $m->origin, 'msg_type' => $m->msg_type,
                'body' => $m->body, 'media' => $m->media ? json_decode($m->media, true) : null, 'referral' => $m->referral ? json_decode($m->referral, true) : null,
                'unsupported_kind' => $m->unsupported_kind, 'sent_at' => $m->sent_at, 'sender_name' => $m->sender_name, 'template_name' => $m->template_name,
                'category' => $m->category, 'category_name' => Mensajes::CATEGORIAS[$m->category] ?? null, 'transcript' => $trans[$m->id] ?? null,
                'estado' => $ultimo, 'estado_name' => $ultimo ? Mensajes::ESTADOS[$ultimo] : null,
                'borrado_cliente' => in_array('DELETED_BY_CUSTOMER', $es, true), 'borrado_app' => in_array('DELETED_IN_APP', $es, true),
                'estados' => collect($estados[$m->id] ?? [])->map(fn ($e) => ['status' => $e->status, 'name' => Mensajes::ESTADOS[$e->status] ?? $e->status, 'at' => $e->occurred_at])->values()->all(),
                'costo' => $m->direction === 'OUT' && $ch->kind === 'WHATSAPP' ? ($m->charge_reason_real ? ['amount' => (float) $m->charge_amount, 'reason' => Mensajes::MOTIVOS_COSTO[$m->charge_reason_real] ?? $m->charge_reason_real]
                    : ((float) $m->cost > 0 ? ['amount' => (float) $m->cost, 'reason' => Mensajes::MOTIVOS_COSTO[$m->charge_reason] ?? 'Cobrado'] : null)) : null,
                'external_id' => $m->external_id,
            ];
        })->all();

        $c = self::conector($ch);
        $panel = self::panel($fila, $u);

        return self::resumen($fila, $ahora) + [
            'mensajes' => $mensajes,
            'notas' => array_values((array) json_decode((string) ($v->internal_notes ?? '[]'), true)),
            'tags' => array_values((array) json_decode((string) ($v->tags ?? '[]'), true)),
            'ventana' => self::ventana($v, $ch, $ahora),
            'costo_proximo' => self::costoProximo($v, $ch, $ahora),
            'proveedor' => $c,
            'puede' => [
                'responder' => self::puedeResponder($v, $u), 'reasignar' => Access::can($u, 'crm.conversation.reassign') && self::visibles($u)->where('v.id', $id)->exists(),
                'cerrar' => self::puedeResponder($v, $u), 'notas' => self::visibles($u)->where('v.id', $id)->exists() && Access::can($u, 'crm.conversation.reply'),
                'simular' => Simulador::disponible() && Access::can($u, 'crm.conversation.reply'),
                'consentimiento' => Access::can($u, 'crm.consent.manage'),
                'crear_pedido' => Access::can($u, 'crm.conversation.create_order') && self::puedeResponder($v, $u),
            ],
            'marketing' => Consentimientos::marketing($v->customer_id, $v->contact_id),
            'miembros' => DB::table('channel_members as m')->join('users as x', 'x.id', '=', 'm.user_id')->where('m.channel_id', $v->channel_id)->where('m.active', true)
                ->orderBy('x.name')->get(['x.id', 'x.name', 'm.member_role'])->map(fn ($x) => ['value' => $x->id, 'label' => $x->name.' · '.(Equipos::ROLES[$x->member_role] ?? '')])->all(),
            'cierres' => collect(self::CIERRES)->map(fn ($l, $k) => ['value' => $k, 'label' => $l])->values()->all(),
            'etiquetas' => self::ETIQUETAS,
            'respuestas' => DB::table('quick_replies')->where('status', 'ACTIVE')->where(fn ($q) => $q->where('brand_id', $v->brand_id)->orWhere('owner_user_id', $u->id))
                ->orderBy('shortcut')->get(['id', 'shortcut', 'body'])->all(),
        ] + $panel;
    }

    /** RN-CRM-02: asigna el chat a quien corresponde; si nadie cumple, queda en cola. Devuelve a quién. */
    public static function asignarAutomatico(string $id): ?string
    {
        $cv = self::fila($id);
        if ($cv->assigned_user_id) {
            return $cv->assigned_user_id;
        }
        $modo = DB::table('messaging_channels')->where('id', $cv->channel_id)->value('assignment_mode');
        $quien = Equipos::elegir($cv->channel_id);
        if (! $quien) {
            DB::table('conversations')->where('id', $id)->whereNull('queued_at')->update(['queued_at' => now(), 'updated_at' => now()]);

            return null;
        }
        self::asignar($cv, $quien, $modo === 'LEAST_OPEN' ? 'AUTO_LEAST_OPEN' : 'AUTO_SHIFT', null, null);

        return $quien;
    }

    /** RN-CRM-03: la supervisora reasigna, toma o devuelve a la cola; solo a miembros del número. */
    public static function reasignar(string $id, ?string $a, ?string $nota, User $u): array
    {
        $cv = self::visible($id, $u);
        self::asignar($cv, $a, $a ? ($a === $u->id ? 'TAKEN' : 'MANUAL_REASSIGN') : 'RETURN_TO_QUEUE', $u, $nota);

        return self::ver($id, $u);
    }

    public static function cerrar(string $id, string $motivo, User $u): array
    {
        $cv = self::visible($id, $u);
        if (! self::puedeResponder($cv, $u)) {
            RuleError::fail('RN-CRM-03', 'Solo quien atiende el chat o la supervisora lo cierra.');
        }
        if (! isset(self::CIERRES[$motivo])) {
            RuleError::fail('RN-CRM-09', 'Elige el motivo de cierre.');
        }
        if ($motivo === 'ORDER_CREATED' && ! DB::table('conversation_orders')->where('conversation_id', $id)->exists()) {
            RuleError::fail('RN-CRM-09', 'No hay pedido vinculado a este chat: elige otro motivo.');
        }
        if ($cv->status === 'CLOSED') {
            RuleError::fail('RN-CRM-09', 'La conversación ya está cerrada.');
        }
        DB::table('conversations')->where('id', $id)->update(['status' => 'CLOSED', 'closed_at' => now(), 'close_reason' => $motivo, 'updated_at' => now()]);
        Events::emit('conversation.closed', 'conversations', $id, ['reason' => $motivo, 'by' => $u->id]);

        return self::ver($id, $u);
    }

    public static function reabrir(string $id, User $u): array
    {
        $cv = self::visible($id, $u);
        if ($cv->status !== 'CLOSED') {
            RuleError::fail('RN-CRM-09', 'La conversación no está cerrada.');
        }
        if (! Access::can($u, 'crm.conversation.reply') || (! Access::can($u, 'crm.conversation.reassign') && $cv->assigned_user_id !== $u->id)) {
            RuleError::fail('RN-CRM-03', 'Solo quien la atendió o la supervisora la reabre.');
        }
        if (DB::table('conversations')->where('channel_id', $cv->channel_id)->where('contact_id', $cv->contact_id)->where('status', '<>', 'CLOSED')->exists()) {
            RuleError::fail('RN-CRM-09', 'El cliente ya tiene otra conversación abierta en este número: continúa en esa.');
        }
        DB::table('conversations')->where('id', $id)->update(['status' => 'OPEN', 'closed_at' => null, 'close_reason' => null, 'updated_at' => now()]);
        Events::emit('conversation.reopened', 'conversations', $id, ['by' => $u->id]);

        return self::ver($id, $u);
    }

    /** Nota interna: la ve el equipo, nunca el cliente. Se agregan; no se editan. */
    public static function nota(string $id, string $texto, User $u): array
    {
        self::visible($id, $u);
        $texto = trim($texto);
        if ($texto === '') {
            RuleError::fail('RN-CRM-04', 'Escribe la nota.');
        }
        DB::transaction(function () use ($id, $texto, $u) {
            $cv = DB::table('conversations')->where('id', $id)->lockForUpdate()->first();
            $notas = (array) json_decode((string) ($cv->internal_notes ?? '[]'), true);
            $notas[] = ['at' => now()->toIso8601String(), 'user_id' => $u->id, 'user_name' => $u->name, 'text' => mb_substr($texto, 0, 1000)];
            DB::table('conversations')->where('id', $id)->update(['internal_notes' => json_encode($notas, JSON_UNESCAPED_UNICODE), 'updated_at' => now()]);
        });

        return self::ver($id, $u);
    }

    public static function etiquetas(string $id, array $tags, User $u): array
    {
        self::visible($id, $u);
        $tags = array_values(array_unique(array_intersect($tags, self::ETIQUETAS)));
        DB::table('conversations')->where('id', $id)->update(['tags' => json_encode($tags, JSON_UNESCAPED_UNICODE), 'updated_at' => now()]);

        return self::ver($id, $u);
    }

    /** Minutos dentro del horario de atención entre dos instantes (fuera de horario el reloj se detiene; RN-CRM-14). */
    public static function minutosHabiles(Carbon $desde, Carbon $hasta, ?string $marca = null): int
    {
        if ($hasta->lte($desde)) {
            return 0;
        }
        $h = Equipos::horario($marca);
        $d = $desde->copy()->setTimezone('America/Lima');
        $fin = $hasta->copy()->setTimezone('America/Lima');
        $total = 0;
        $dia = $d->copy()->startOfDay();
        for ($i = 0; $dia->lte($fin) && $i < 400; $i++, $dia->addDay()) {
            $w = $h[(int) $dia->isoWeekday()] ?? null;
            if (! $w) {
                continue;
            }
            $ini = $dia->copy()->setTimeFromTimeString($w[0])->max($d);
            $cie = $dia->copy()->setTimeFromTimeString($w[1])->min($fin);
            if ($cie->gt($ini)) {
                $total += (int) floor($ini->diffInSeconds($cie) / 60);
            }
        }

        return $total;
    }

    private static function asignar(object $cv, ?string $a, string $motivo, ?User $por, ?string $nota): void
    {
        if ($a && ! DB::table('channel_members')->where('channel_id', $cv->channel_id)->where('user_id', $a)->where('active', true)->exists()) {
            $n = DB::table('users')->where('id', $a)->value('name') ?? 'Esa persona';
            RuleError::fail('RN-CRM-03', "{$n} no es miembro del número de este chat: no se le puede asignar.");
        }
        if (($a ?: null) === ($cv->assigned_user_id ?: null)) {
            return;
        }
        DB::transaction(function () use ($cv, $a, $motivo, $por, $nota) {
            DB::table('conversation_assignments')->insert(['conversation_id' => $cv->id, 'channel_id' => $cv->channel_id, 'from_user_id' => $cv->assigned_user_id, 'to_user_id' => $a,
                'reason' => $motivo, 'assigned_by' => $por?->id, 'assigned_at' => DB::raw('clock_timestamp()'), 'note' => $nota ? mb_substr(trim($nota), 0, 255) : null, 'created_at' => now()]);
            DB::table('conversations')->where('id', $cv->id)->update(['assigned_user_id' => $a, 'queued_at' => $a ? null : now(), 'updated_at' => now()]);
            if ($a && $a !== $por?->id) {
                $nombre = self::nombreContacto($cv);
                DB::table('notifications')->insert(['user_id' => $a, 'module' => 'CRM', 'tone' => 'info', 'severity' => 'INFO', 'type' => 'ORDERS', 'at' => now(),
                    'title' => 'Chat asignado', 'body' => mb_substr("{$nombre} · ".DB::table('messaging_channels')->where('id', $cv->channel_id)->value('display_name'), 0, 1000),
                    'ref' => json_encode(['href' => "/m/crm/crm-02?id={$cv->id}"])]);
            }
            Events::emit('conversation.assigned', 'conversations', $cv->id, ['to' => $a, 'reason' => $motivo, 'by' => $por?->id]);
        });
    }

    private static function nombreContacto(object $cv): string
    {
        return DB::table('customers')->where('id', $cv->customer_id)->value('full_name')
            ?? DB::table('leads')->where('id', $cv->lead_id)->value('full_name')
            ?? DB::table('channel_contacts')->where('id', $cv->contact_id)->value('display_name')
            ?? DB::table('channel_contacts')->where('id', $cv->contact_id)->value('external_user_id') ?? 'Cliente';
    }

    private static function ventana(object $v, object $ch, Carbon $ahora): array
    {
        $svc = $v->service_window_expires_at ? Carbon::parse($v->service_window_expires_at) : null;
        $ad = $ch->kind === 'WHATSAPP' && $v->free_entry_expires_at ? Carbon::parse($v->free_entry_expires_at) : null;

        return [
            'horas' => Mensajes::horasVentana($ch->kind), 'abierta' => $svc && $svc->gte($ahora), 'vence' => $svc?->toIso8601String(),
            'minutos' => $svc && $svc->gte($ahora) ? (int) floor($ahora->diffInSeconds($svc) / 60) : null,
            'anuncio' => $ad && $ad->gte($ahora), 'anuncio_vence' => $ad?->toIso8601String(), 'anuncio_minutos' => $ad && $ad->gte($ahora) ? (int) floor($ahora->diffInSeconds($ad) / 60) : null,
            'tiktok_seguidos' => $ch->kind === 'TIKTOK' ? (int) $v->outbound_since_inbound : null, 'tiktok_max' => $ch->kind === 'TIKTOK' ? (int) (Params::get('crm_tiktok_max_consecutive') ?? 10) : null,
            'plantillas' => $ch->kind === 'WHATSAPP',
        ];
    }

    /** Lo que costaría el próximo mensaje de cada categoría (solo WhatsApp). */
    private static function costoProximo(object $v, object $ch, Carbon $ahora): ?array
    {
        if ($ch->kind !== 'WHATSAPP') {
            return null;
        }
        $out = ['usadas' => Mensajes::usadas($ch->id, $ahora), 'cuota' => (int) $ch->free_service_quota];
        foreach (['SERVICE' => 'servicio', 'UTILITY' => 'utilidad', 'MARKETING' => 'marketing'] as $cat => $k) {
            $t = Mensajes::tarifa($cat, $v, $ch, 'API', $ahora);
            $out[$k] = ['amount' => $t['amount'], 'reason' => Mensajes::MOTIVOS_COSTO[$t['reason']] ?? $t['reason']];
        }

        return $out;
    }

    /** ¿El número puede enviar de verdad? Si no, los mensajes quedan registrados como «no enviado». */
    private static function conector(object $ch): array
    {
        $c = $ch->connector_id ? DB::table('integration_connectors')->where('id', $ch->connector_id)->first() : null;
        $ok = $c && $c->status !== 'DISABLED' && Adaptadores::puedeEnviar($c);

        return ['conectado' => $ok, 'codigo' => $c?->code, 'prueba' => $c && ($c->environment === 'SANDBOX' || $c->adapter === 'FAKE'),
            'aviso' => $ok ? null : ($ch->connection_mode === 'APP_ONLY' ? 'Este número está en «solo app»: se atiende desde el celular.'
                : 'Este número todavía no tiene el proveedor oficial conectado: los mensajes quedan registrados, pero no salen.')];
    }

    /** Panel del cliente o del lead: datos, pedidos, saldo, consentimiento, pedido del chat y tareas. */
    private static function panel(object $v, User $u): array
    {
        $cliente = null;
        if ($v->customer_id) {
            $c = DB::table('customers')->where('id', $v->customer_id)->first(['id', 'full_name', 'phone', 'doc_type', 'doc_number']);
            $ped = DB::table('sales_orders')->where('customer_id', $v->customer_id)->whereNotIn('status', ['CANCELLED'])->orderByDesc('created_at')
                ->limit(5)->get(['id', 'number', 'status', 'created_at', 'estimated_total', 'final_total']);
            $mk = DB::table('contact_consents')->where('purpose', 'MARKETING')->where(fn ($q) => $q->where('customer_id', $v->customer_id)->orWhere('contact_id', $v->contact_id))
                ->orderByDesc('recorded_at')->value('granted');
            $cliente = [
                'id' => $c->id, 'nombre' => $c->full_name, 'celular' => $c->phone, 'documento' => $c->doc_number ? trim(($c->doc_type ?? '').' '.$c->doc_number) : null,
                'pedidos' => DB::table('sales_orders')->where('customer_id', $v->customer_id)->whereNotIn('status', ['CANCELLED', 'DRAFT'])->count(),
                'ultimos' => $ped->map(fn ($o) => ['id' => $o->id, 'number' => $o->number, 'status' => $o->status, 'at' => $o->created_at, 'total' => (float) ($o->final_total ?? $o->estimated_total)])->all(),
                'marketing' => $mk === null ? null : (bool) $mk,
            ];
        }
        $lead = $v->lead_id ? DB::table('leads')->where('id', $v->lead_id)->first(['id', 'status', 'source', 'ad_code', 'first_contact_at', 'lost_reason', 'full_name']) : null;
        $vinculados = PedidosChat::pedidosDelChat($v->id);
        $tareas = DB::table('crm_tasks')->where('status', 'OPEN')->where(fn ($q) => $q->where('conversation_id', $v->id)->when($v->customer_id, fn ($w) => $w->orWhere('customer_id', $v->customer_id)))
            ->orderBy('due_at')->limit(5)->get(['id', 'task_type', 'due_at', 'note'])->all();

        return ['cliente' => $cliente, 'lead' => $lead ? (array) $lead : null, 'pedidos_chat' => $vinculados, 'tareas' => $tareas];
    }

    private static function extracto(object $m): string
    {
        $t = match ($m->msg_type) {
            'AUDIO' => 'Nota de voz', 'LOCATION' => 'Ubicación', 'IMAGE' => 'Foto'.($m->body ? ': '.$m->body : ''), 'DOCUMENT' => 'Documento', 'UNSUPPORTED' => 'Mensaje no disponible',
            'TEMPLATE' => 'Plantilla: '.strtok((string) $m->body, "\n"), default => strtok((string) $m->body, "\n") ?: '',
        };
        $pre = $m->direction === 'OUT' ? ($m->origin === 'SYSTEM' ? 'Automático: ' : 'Tú: ') : '';

        return mb_substr($pre.$t, 0, 120);
    }

    private static function resumen(object $v, Carbon $ahora): array
    {
        $esperando = $v->status !== 'CLOSED' && $v->last_inbound_at && (! $v->last_reply_at || $v->last_reply_at < $v->last_inbound_at);
        $svc = $v->service_window_expires_at ? Carbon::parse($v->service_window_expires_at) : null;

        return [
            'id' => $v->id, 'status' => $v->status, 'status_name' => self::ESTADOS[$v->status] ?? $v->status, 'kind' => $v->kind, 'kind_name' => Canales::REDES[$v->kind] ?? $v->kind,
            'channel_id' => $v->channel_id, 'channel_name' => $v->channel_name, 'channel_number' => $v->channel_number, 'brand_id' => $v->brand_id, 'brand_name' => $v->brand_name,
            'brand_color' => $v->primary_color ?? null,
            'contacto' => $v->customer_name ?? $v->lead_name ?? $v->contact_name ?? $v->external_user_id, 'numero_cliente' => $v->external_user_id,
            'es_cliente' => (bool) $v->customer_id, 'customer_id' => $v->customer_id, 'lead_id' => $v->lead_id,
            'assigned_user_id' => $v->assigned_user_id, 'assigned_name' => $v->assigned_name,
            'entry_point' => $v->entry_point, 'entry_name' => self::ENTRADAS[$v->entry_point] ?? $v->entry_point, 'ad_code' => $v->ad_code, 'por_anuncio' => in_array($v->entry_point, self::POR_ANUNCIO, true),
            'opened_at' => $v->opened_at, 'last_inbound_at' => $v->last_inbound_at, 'first_response_at' => $v->first_response_at, 'closed_at' => $v->closed_at,
            'close_reason' => $v->close_reason, 'close_name' => $v->close_reason ? (self::CIERRES[$v->close_reason] ?? $v->close_reason) : null,
            'espera_min' => $esperando ? self::minutosHabiles(Carbon::parse($v->last_inbound_at), $ahora, $v->brand_id) : 0,
            'ventana_abierta' => $svc && $svc->gte($ahora), 'ventana_min' => $svc && $svc->gte($ahora) ? (int) floor($ahora->diffInSeconds($svc) / 60) : null,
            'tags' => array_values((array) json_decode((string) ($v->tags ?? '[]'), true)),
        ];
    }
}
