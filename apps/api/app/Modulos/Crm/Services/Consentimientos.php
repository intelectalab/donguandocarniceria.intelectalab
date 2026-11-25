<?php

namespace App\Modulos\Crm\Services;

use App\Models\User;
use App\Support\Access;
use App\Support\Events;
use App\Support\Paginas;
use App\Support\RuleError;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Consentimientos y avisos (RN-CRM-08 y 21, Ley 29733): nunca se presumen; se registran con evidencia (un mensaje del
 * cliente o un texto) y vale el último registro del cliente o del contacto. Solo se agregan registros: el historial
 * queda. CRM-18 muestra el historial, registra el «sí» o la baja y los textos del aviso de registro de cada número.
 */
class Consentimientos
{
    public const PROPOSITOS = ['DATA_PROCESSING' => 'Tratamiento de datos', 'MARKETING' => 'Marketing', 'RECORDING_NOTICE' => 'Aviso de registro', 'SURVEY' => 'Encuestas'];

    /** Los que se registran a mano (el aviso de registro lo envía el sistema al primer mensaje). */
    public const A_MANO = ['DATA_PROCESSING', 'MARKETING', 'SURVEY'];

    public const CANALES = ['WHATSAPP' => 'WhatsApp', 'MESSENGER' => 'Messenger', 'INSTAGRAM' => 'Instagram', 'TIKTOK' => 'TikTok', 'FACEBOOK' => 'Facebook',
        'PHONE' => 'Teléfono', 'WEB' => 'Web', 'POS' => 'Caja', 'COUNTER' => 'Mostrador'];

    public const CANALES_A_MANO = ['WHATSAPP', 'PHONE', 'WEB', 'COUNTER'];

    public const ORIGENES = ['AUTO' => 'Automático', 'MESSAGE' => 'Mensaje del cliente', 'AGENT' => 'Registrado por el equipo', 'FIRST_ORDER' => 'Primer pedido', 'KEYWORD' => 'Palabra clave'];

    /** true = otorgado, false = dio de baja, null = sin registro. */
    public static function marketing(?string $cliente, ?string $contacto): ?bool
    {
        if (! $cliente && ! $contacto) {
            return null;
        }
        $v = DB::table('contact_consents')->where('purpose', 'MARKETING')
            ->where(fn ($q) => $q->when($cliente, fn ($w) => $w->where('customer_id', $cliente))->when($contacto, fn ($w) => $w->orWhere('contact_id', $contacto)))
            ->orderByDesc('recorded_at')->orderByDesc('created_at')->value('granted');

        return $v === null ? null : (bool) $v;
    }

    /** Registra el «sí» o la baja de marketing desde la conversación, con la evidencia. */
    public static function registrarMarketing(string $conversacion, bool $otorgado, string $evidencia, ?string $mensaje, User $u): array
    {
        $cv = Conversaciones::visible($conversacion, $u);
        if (mb_strlen(trim($evidencia)) < 5) {
            RuleError::fail('RN-CRM-08', 'Indica la evidencia: qué dijo el cliente y dónde (al menos 5 caracteres).');
        }
        if ($mensaje && ! DB::table('conversation_messages')->where('id', $mensaje)->where('conversation_id', $cv->id)->where('direction', 'IN')->exists()) {
            RuleError::fail('RN-CRM-08', 'La evidencia debe ser un mensaje del cliente en esta conversación.');
        }
        $ch = DB::table('messaging_channels')->where('id', $cv->channel_id)->first(['kind', 'brand_id']);
        $id = DB::table('contact_consents')->insertGetId(['customer_id' => $cv->customer_id, 'contact_id' => $cv->contact_id, 'purpose' => 'MARKETING', 'granted' => $otorgado,
            'channel' => $ch->kind, 'evidence_message_id' => $mensaje, 'evidence_text' => mb_substr(trim($evidencia), 0, 500), 'recorded_at' => DB::raw('clock_timestamp()'), 'brand_id' => $ch->brand_id,
            'recorded_by' => mb_substr($u->name, 0, 120), 'source' => 'AGENT', 'created_at' => now()], 'id');
        self::alCliente($cv->customer_id, 'MARKETING', $otorgado, $ch->kind);
        Events::emit($otorgado ? 'consent.granted' : 'consent.revoked', 'contact_consents', $id, ['purpose' => 'MARKETING', 'by' => $u->id]);

        return Conversaciones::ver($conversacion, $u);
    }

    /**
     * Lo que la persona puede ver: los de sus marcas (o de todas las marcas); la vendedora, solo los de los clientes y
     * contactos de sus chats.
     */
    private static function base(User $u)
    {
        $marcas = Access::for($u)['brands'];
        $q = DB::table('contact_consents as k')->when($marcas, fn ($w) => $w->where(fn ($x) => $x->whereNull('k.brand_id')->orWhereIn('k.brand_id', $marcas)));
        if (self::restringido($u)) {
            $chats = Conversaciones::visibles($u);
            $q->where(fn ($w) => $w->whereIn('k.customer_id', (clone $chats)->whereNotNull('v.customer_id')->select('v.customer_id'))
                ->orWhereIn('k.contact_id', (clone $chats)->select('v.contact_id')));
        }

        return $q;
    }

    /** Los clientes para los que se registra: la vendedora, los de sus chats; marketing y la supervisión, todos. */
    /** Los clientes activos que la persona puede elegir (la vendedora, los de sus chats). También lo usa Mis tareas. */
    public static function clientesBase(User $u)
    {
        $q = DB::table('customers as c')->where('c.status', '<>', 'INACTIVE')->whereNull('c.merged_into_id');

        return self::restringido($u) ? $q->whereIn('c.id', Conversaciones::visibles($u)->whereNotNull('v.customer_id')->select('v.customer_id')) : $q;
    }

    private static function restringido(User $u): bool
    {
        return ! Access::can($u, 'crm.conversation.view_all') && Access::can($u, 'crm.conversation.view_own');
    }

    /** CRM-18: el historial con cifras, buscador y filtros. */
    public static function historial(array $f, User $u): array
    {
        $q = self::base($u)->leftJoin('customers as cu', 'cu.id', '=', 'k.customer_id')->leftJoin('channel_contacts as ct', 'ct.id', '=', 'k.contact_id')
            ->leftJoin('brands as b', 'b.id', '=', 'k.brand_id')->leftJoin('conversation_messages as m', 'm.id', '=', 'k.evidence_message_id');
        $cifras = (clone $q)->selectRaw("count(*) FILTER (WHERE k.purpose = 'RECORDING_NOTICE') AS avisos,
            count(*) FILTER (WHERE k.purpose = 'MARKETING' AND k.granted) AS otorgados, count(*) FILTER (WHERE k.purpose = 'MARKETING' AND NOT k.granted) AS bajas")->first();
        // Clientes cuyo último registro de marketing es «otorgado»: a quienes hoy se puede enviar una promoción.
        $vigentes = DB::query()->fromSub(self::base($u)->where('k.purpose', 'MARKETING')->whereNotNull('k.customer_id')
            ->selectRaw('DISTINCT ON (k.customer_id) k.customer_id, k.granted')->orderBy('k.customer_id')->orderByDesc('k.recorded_at')->orderByDesc('k.created_at'), 'u')
            ->where('u.granted', true)->count();
        foreach (['proposito' => 'k.purpose', 'canal' => 'k.channel', 'marca' => 'k.brand_id', 'origen' => 'k.source'] as $k => $col) {
            if (! empty($f[$k])) {
                $q->where($col, $f[$k]);
            }
        }
        if (($f['estado'] ?? '') !== '') {
            $q->where('k.granted', $f['estado'] === '1');
        }
        if (! empty($f['desde'])) {
            $q->where('k.recorded_at', '>=', Carbon::parse($f['desde'], 'America/Lima')->startOfDay());
        }
        if (! empty($f['hasta'])) {
            $q->where('k.recorded_at', '<=', Carbon::parse($f['hasta'], 'America/Lima')->endOfDay());
        }
        $t = trim((string) ($f['buscar'] ?? ''));
        if (mb_strlen($t) >= 2) {
            $p = '%'.addcslashes($t, '%_\\').'%';
            $q->where(fn ($w) => $w->where('cu.full_name', 'ilike', $p)->orWhere('cu.phone', 'ilike', $p)->orWhere('ct.display_name', 'ilike', $p)
                ->orWhere('ct.external_user_id', 'ilike', $p)->orWhere('k.evidence_text', 'ilike', $p));
        }
        $q->orderByDesc('k.recorded_at')->orderByDesc('k.created_at');
        Paginas::ordenar($q, ['fecha' => 'k.recorded_at', 'quien' => 'coalesce(cu.full_name, ct.display_name, ct.external_user_id)', 'proposito' => 'k.purpose',
            'marca' => 'b.name', 'canal' => 'k.channel'], 'k.id', $f);
        $q->select(['k.id', 'k.customer_id', 'k.contact_id', 'k.purpose', 'k.granted', 'k.channel', 'k.evidence_text', 'k.evidence_message_id', 'k.recorded_at', 'k.recorded_by', 'k.source',
            'b.name as marca', 'm.conversation_id', 'm.body as evidencia_mensaje', DB::raw('coalesce(cu.trade_name, cu.full_name, ct.display_name, ct.external_user_id) AS quien'),
            DB::raw('coalesce(cu.phone, ct.external_user_id) AS celular')]);
        $r = Paginas::de($q, fn ($k) => [
            'id' => $k->id, 'recorded_at' => $k->recorded_at, 'quien' => $k->quien ?: 'Contacto', 'celular' => $k->celular, 'customer_id' => $k->customer_id,
            'purpose' => $k->purpose, 'proposito' => self::PROPOSITOS[$k->purpose] ?? $k->purpose, 'granted' => (bool) $k->granted,
            'canal' => self::CANALES[$k->channel] ?? $k->channel, 'marca' => $k->marca ?? 'Todas las marcas',
            'evidencia' => $k->evidence_text, 'evidencia_mensaje' => $k->evidencia_mensaje ? mb_substr($k->evidencia_mensaje, 0, 300) : null, 'conversation_id' => $k->conversation_id,
            'registro' => $k->recorded_by, 'origen' => $k->source ? (self::ORIGENES[$k->source] ?? $k->source) : null,
        ], $f);
        $ids = array_filter(array_column($r['data'], 'conversation_id'));
        $abribles = $ids ? Conversaciones::visibles($u)->whereIn('v.id', $ids)->pluck('v.id')->all() : [];
        foreach ($r['data'] as &$fila) {
            $fila['conversation_id'] = in_array($fila['conversation_id'], $abribles, true) ? $fila['conversation_id'] : null;
        }
        unset($fila);
        $marcas = Access::for($u)['brands'];

        return $r + [
            'cifras' => ['avisos' => (int) $cifras->avisos, 'otorgados' => (int) $cifras->otorgados, 'bajas' => (int) $cifras->bajas, 'vigentes' => $vigentes],
            'puede' => ['registrar' => Access::can($u, 'crm.consent.manage'), 'ficha' => Access::can($u, 'crm.customer.view_full'), 'numeros' => Access::can($u, 'crm.channel.manage')],
            'opciones' => [
                'propositos' => self::opciones(self::PROPOSITOS), 'a_mano' => self::opciones(array_intersect_key(self::PROPOSITOS, array_flip(self::A_MANO))),
                'canales' => self::opciones(self::CANALES), 'canales_a_mano' => self::opciones(array_intersect_key(self::CANALES, array_flip(self::CANALES_A_MANO))),
                'origenes' => self::opciones(self::ORIGENES),
                'marcas' => DB::table('brands')->when($marcas, fn ($w) => $w->whereIn('id', $marcas))->where('status', 'ACTIVE')->orderBy('name')
                    ->get(['id', 'name'])->map(fn ($b) => ['value' => $b->id, 'label' => $b->name])->all(),
            ],
        ];
    }

    /** Clientes para registrar: búsqueda por nombre, celular o documento dentro de lo que la persona puede ver. */
    public static function clientes(string $buscar, User $u): array
    {
        $t = trim($buscar);
        if (mb_strlen($t) < 2) {
            return [];
        }
        $p = '%'.addcslashes($t, '%_\\').'%';

        return self::clientesBase($u)->where(fn ($w) => $w->where('c.full_name', 'ilike', $p)->orWhere('c.trade_name', 'ilike', $p)->orWhere('c.phone', 'ilike', $p)->orWhere('c.doc_number', 'ilike', $p))
            ->orderBy('c.full_name')->limit(20)->get(['c.id', 'c.full_name', 'c.trade_name', 'c.phone'])
            ->map(fn ($c) => ['value' => $c->id, 'label' => ($c->trade_name ?: $c->full_name).($c->phone ? " · {$c->phone}" : ''),
                'marketing' => self::marketing($c->id, null)])->all();
    }

    /** Registrar un consentimiento o una baja a mano, siempre con evidencia. */
    public static function registrar(array $d, User $u): array
    {
        if (! in_array($d['purpose'], self::A_MANO, true)) {
            RuleError::fail('RN-CRM-21', 'El aviso de registro lo envía el sistema con el primer mensaje: no se registra a mano.');
        }
        if (! in_array($d['channel'], self::CANALES_A_MANO, true)) {
            RuleError::fail('RN-CRM-21', 'El canal es WhatsApp, teléfono, web o mostrador.');
        }
        $evidencia = trim((string) $d['evidence_text']);
        if (mb_strlen($evidencia) < 5) {
            RuleError::fail('RN-CRM-21', 'Indica la evidencia: qué dijo el cliente y dónde, o el documento que firmó (al menos 5 caracteres). El consentimiento nunca se presume.');
        }
        $c = self::clientesBase($u)->where('c.id', $d['customer_id'])->first(['c.id']) ?? abort(404);
        $marcas = Access::for($u)['brands'];
        $marca = $d['brand_id'] ?? null;
        if ($marca && $marcas && ! in_array($marca, $marcas, true)) {
            RuleError::fail('RN-CRM-21', 'Esa marca no es tuya.');
        }
        if (! $marca && $marcas) {
            // Quien trabaja solo algunas marcas no registra para todas.
            $marca = count($marcas) === 1 ? $marcas[0] : RuleError::fail('RN-CRM-21', 'Elige la marca del consentimiento.');
        }
        $otorgado = (bool) $d['granted'];
        $id = DB::table('contact_consents')->insertGetId(['customer_id' => $c->id, 'purpose' => $d['purpose'], 'granted' => $otorgado, 'channel' => $d['channel'],
            'evidence_text' => mb_substr($evidencia, 0, 500), 'recorded_at' => DB::raw('clock_timestamp()'), 'brand_id' => $marca,
            'recorded_by' => mb_substr($u->name, 0, 120), 'source' => 'AGENT', 'created_at' => now()], 'id');
        self::alCliente($c->id, $d['purpose'], $otorgado, $d['channel']);
        Events::emit($otorgado ? 'consent.granted' : 'consent.revoked', 'contact_consents', $id, ['purpose' => $d['purpose'], 'by' => $u->id]);

        return ['id' => $id, 'marketing' => self::marketing($c->id, null)];
    }

    /** El cliente guarda su último «sí» o baja de marketing (lo usa Clientes); la baja avisa a las campañas. */
    private static function alCliente(?string $cliente, string $proposito, bool $otorgado, string $canal): void
    {
        if (! $cliente || $proposito !== 'MARKETING') {
            return;
        }
        DB::table('customers')->where('id', $cliente)->update(['marketing_opt_in' => $otorgado, 'marketing_opt_in_at' => now(), 'marketing_opt_in_source' => $canal]);
        if (! $otorgado) {
            Events::emit('consent.opted_out', 'customers', $cliente, ['channel' => $canal]);
        }
    }

    /** Los textos del aviso de registro de cada número, con cuántos avisos se enviaron. */
    public static function avisos(User $u): array
    {
        $enviados = DB::table('contact_consents as k')->join('conversation_messages as m', 'm.id', '=', 'k.evidence_message_id')->where('k.purpose', 'RECORDING_NOTICE')
            ->selectRaw('m.channel_id, count(*) AS n, max(k.recorded_at) AS ultimo')->groupBy('m.channel_id')->get()->keyBy('channel_id');

        return Canales::visibles($u)->leftJoin('brands as b', 'b.id', '=', 'c.brand_id')
            ->orderByRaw("CASE c.kind WHEN 'WHATSAPP' THEN 0 ELSE 1 END")->orderBy('b.name')->orderBy('c.display_name')
            ->get(['c.id', 'c.kind', 'c.display_name', 'c.number', 'c.connection_mode', 'c.recording_notice_text', 'b.name as marca'])
            ->map(fn ($c) => ['id' => $c->id, 'red' => Canales::REDES[$c->kind] ?? $c->kind, 'kind' => $c->kind, 'nombre' => $c->display_name, 'numero' => $c->number, 'marca' => $c->marca,
                'texto' => $c->recording_notice_text, 'enviados' => (int) ($enviados[$c->id]->n ?? 0), 'ultimo' => $enviados[$c->id]->ultimo ?? null,
                'exigido' => $c->kind === 'WHATSAPP' && $c->connection_mode !== 'APP_ONLY'])->all();
    }

    private static function opciones(array $xs): array
    {
        return collect($xs)->map(fn ($l, $k) => ['value' => $k, 'label' => $l])->values()->all();
    }
}
