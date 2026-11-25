<?php

namespace App\Modulos\Crm\Services;

use App\Models\User;
use App\Modulos\Int\Services\Conectores;
use App\Support\Access;
use App\Support\Events;
use App\Support\Paginas;
use App\Support\Params;
use App\Support\RuleError;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * CRM-07 Números y cuentas (RN-CRM-01). Cada número de WhatsApp o cuenta de red se conecta una sola vez, enlazado a su
 * conector de INT (donde están las credenciales cifradas, que las vendedoras nunca ven). WhatsApp solo por la API oficial
 * (con o sin coexistencia) o «solo app»: no hay conexión por QR.
 */
class Canales
{
    public const REDES = ['WHATSAPP' => 'WhatsApp', 'MESSENGER' => 'Messenger', 'INSTAGRAM' => 'Instagram', 'TIKTOK' => 'TikTok'];

    public const CONEXIONES = [
        'CLOUD_API_COEXISTENCE' => 'API oficial con coexistencia', 'CLOUD_API' => 'API oficial (solo API)', 'APP_ONLY' => 'Solo app (sin integración)',
        'DM_API' => 'API de mensajes directos', 'NOT_AVAILABLE' => 'No disponible',
    ];

    /** Conexiones permitidas por red (RN-CRM-01; TikTok según D-CRM-04). */
    public const CONEXIONES_POR_RED = [
        'WHATSAPP' => ['CLOUD_API_COEXISTENCE', 'CLOUD_API', 'APP_ONLY'],
        'MESSENGER' => ['DM_API', 'APP_ONLY'], 'INSTAGRAM' => ['DM_API', 'APP_ONLY'], 'TIKTOK' => ['DM_API', 'NOT_AVAILABLE'],
    ];

    public const ASIGNACION = ['SHIFT_ROUND_ROBIN' => 'Turno rotativo', 'LEAST_OPEN' => 'Menos chats abiertos', 'MANUAL' => 'Manual'];

    public const ESTADOS = ['ACTIVE' => 'Activo', 'PAUSED' => 'Pausado', 'DISCONNECTED' => 'Desconectado'];

    public const CALIDAD = ['HIGH' => 'Alta', 'MEDIUM' => 'Media', 'LOW' => 'Baja'];

    /** Proveedor del conector que corresponde a cada red. */
    private const PROVEEDOR = ['WHATSAPP' => 'WHATSAPP_CLOUD', 'MESSENGER' => 'META_MESSAGING', 'INSTAGRAM' => 'META_MESSAGING', 'TIKTOK' => 'TIKTOK'];

    /** Los números que ve la persona: los de sus marcas (las vendedoras, solo donde son miembros). */
    public static function visibles(User $u)
    {
        $a = Access::for($u);
        $q = DB::table('messaging_channels as c')->when($a['brands'], fn ($w) => $w->whereIn('c.brand_id', $a['brands']));
        if (! Access::can($u, 'crm.conversation.view_all') && ! Access::can($u, 'crm.channel.manage')) {
            $q->whereExists(fn ($x) => $x->from('channel_members as m')->whereColumn('m.channel_id', 'c.id')->where('m.user_id', $u->id)->where('m.active', true));
        }

        return $q;
    }

    /** CRM-07: la lista con cifras y filtros; el uso de respuestas gratis es del mes elegido (por defecto, el último con actividad). */
    public static function lista(array $f, User $u): array
    {
        self::enlazarConectores();
        $meses = self::meses();
        $mes = in_array($f['mes'] ?? '', array_column($meses, 'value'), true) ? $f['mes'] : ($meses[0]['value'] ?? now('America/Lima')->format('Y-m'));
        $uso = DB::table('message_charges')->where('period', "{$mes}-01")->where('category', 'SERVICE')->whereIn('reason', ['FREE_SERVICE_QUOTA', 'CHARGED'])
            ->selectRaw('channel_id, count(*) AS n')->groupBy('channel_id')->pluck('n', 'channel_id');
        $miembros = DB::table('channel_members')->where('active', true)->selectRaw('channel_id, count(*) AS n')->groupBy('channel_id')->pluck('n', 'channel_id');
        $todos = self::visibles($u)->leftJoin('brands as b', 'b.id', '=', 'c.brand_id')->leftJoin('integration_connectors as i', 'i.id', '=', 'c.connector_id')
            ->orderByRaw("CASE c.kind WHEN 'WHATSAPP' THEN 0 ELSE 1 END")->orderBy('b.name')->orderBy('c.display_name')
            ->get(['c.*', 'b.name as brand_name', 'i.code as connector_code', 'i.status as connector_status', 'i.environment as connector_environment']);
        $filas = $todos->map(fn ($c) => self::presentar($c, (int) ($uso[$c->id] ?? 0), (int) ($miembros[$c->id] ?? 0)));
        $t = mb_strtolower(trim((string) ($f['buscar'] ?? '')));
        $vista = $filas->filter(fn ($c) => (empty($f['red']) || $c['kind'] === $f['red']) && (empty($f['marca']) || $c['brand_id'] === $f['marca'])
            && (empty($f['estado']) || $c['status'] === $f['estado'])
            && ($t === '' || str_contains(mb_strtolower("{$c['display_name']} {$c['number']} {$c['brand_name']}"), $t)))->values()->all();
        $vista = Paginas::ordenarLista($vista, ['kind_name', 'display_name', 'number', 'brand_name', 'connection_name', 'usadas', 'quality_rating', 'assignment_name', 'status_name']);
        $wa = $filas->where('kind', 'WHATSAPP');

        return Paginas::deLista($vista) + [
            'cifras' => [
                'whatsapp' => $wa->where('status', 'ACTIVE')->count(), 'whatsapp_total' => $wa->count(), 'coexistencia' => $wa->where('connection_mode', 'CLOUD_API_COEXISTENCE')->count(),
                'redes' => $filas->where('kind', '<>', 'WHATSAPP')->where('status', 'ACTIVE')->count(), 'redes_total' => $filas->where('kind', '<>', 'WHATSAPP')->count(),
                'usadas' => $wa->sum('usadas'), 'cuota' => $wa->sum('free_service_quota'),
                'calidad_baja' => $wa->whereIn('quality_rating', ['MEDIUM', 'LOW'])->count(),
            ],
            'mes' => $mes, 'meses' => $meses,
            'opciones' => self::opciones(),
            'conectores' => self::conectoresLibres(),
            'puede' => Access::can($u, 'crm.channel.manage'),
        ];
    }

    public static function ficha(string $id, User $u): array
    {
        self::enlazarConectores();
        $c = self::visibles($u)->where('c.id', $id)->leftJoin('brands as b', 'b.id', '=', 'c.brand_id')->leftJoin('integration_connectors as i', 'i.id', '=', 'c.connector_id')
            ->first(['c.*', 'b.name as brand_name', 'i.code as connector_code', 'i.status as connector_status', 'i.environment as connector_environment',
                'i.last_ok_at as connector_last_ok_at', 'i.last_error as connector_last_error']) ?? abort(404);
        $mes = now('America/Lima')->format('Y-m');
        $usadas = DB::table('message_charges')->where('channel_id', $id)->where('period', "{$mes}-01")->where('category', 'SERVICE')->whereIn('reason', ['FREE_SERVICE_QUOTA', 'CHARGED'])->count();

        return self::presentar($c, $usadas, DB::table('channel_members')->where('channel_id', $id)->where('active', true)->count()) + [
            'auto_greeting' => $c->auto_greeting, 'recording_notice_text' => $c->recording_notice_text,
            'external_id' => $c->external_id, 'waba_id' => $c->waba_id, 'synced_history_from' => $c->synced_history_from, 'connected_at' => $c->connected_at,
            'group_msgs_discarded' => (int) $c->group_msgs_discarded, 'messaging_limit' => $c->messaging_limit ? (int) $c->messaging_limit : null,
            'connector_last_ok_at' => $c->connector_last_ok_at ?? null, 'connector_last_error' => $c->connector_last_error ?? null,
            'conversaciones_abiertas' => DB::table('conversations')->where('channel_id', $id)->where('status', '<>', 'CLOSED')->count(),
        ];
    }

    /** Conectar o editar. La red y el número no cambian después de conectar (es otro número). */
    public static function guardar(?string $id, array $d, User $u): array
    {
        self::enlazarConectores();
        $antes = $id ? (DB::table('messaging_channels')->where('id', $id)->first() ?? abort(404)) : null;
        $red = $antes->kind ?? $d['kind'];
        $numero = $antes->number ?? trim((string) $d['number']);
        if (! isset(self::REDES[$red])) {
            RuleError::fail('RN-CRM-01', 'Esa red no se puede conectar.');
        }
        if (! $antes) {
            if ($red === 'WHATSAPP' && ! preg_match('/^\+519\d{8}$/', $numero) && ! preg_match('/^\+[1-9]\d{7,14}$/', $numero)) {
                RuleError::fail('RN-CRM-01', 'El número de WhatsApp va en formato internacional, por ejemplo +51987650101.');
            }
            if (DB::table('messaging_channels')->where('kind', $red)->where('number', $numero)->exists()) {
                RuleError::fail('RN-CRM-01', 'Ese número o cuenta ya está conectado: cada uno se conecta una sola vez.');
            }
        }
        if (! in_array($d['connection_mode'], self::CONEXIONES_POR_RED[$red], true)) {
            RuleError::fail('RN-CRM-01', $red === 'WHATSAPP'
                ? 'Un número de WhatsApp solo se conecta por la API oficial (con o sin coexistencia) o queda «solo app». No hay conexión por QR.'
                : 'Ese modo de conexión no corresponde a '.self::REDES[$red].'.');
        }
        if (! DB::table('brands')->where('id', $d['brand_id'])->exists()) {
            RuleError::fail('RN-CRM-01', 'Elige la marca del número.');
        }
        $conector = $d['connector_id'] ?? ($antes->connector_id ?? null);
        if ($conector) {
            $i = DB::table('integration_connectors')->where('id', $conector)->first();
            if (! $i || $i->owner_module !== 'CRM' || $i->provider !== self::PROVEEDOR[$red]) {
                RuleError::fail('RN-CRM-01', 'Ese conector de Integraciones no es de '.self::REDES[$red].'.');
            }
            if (DB::table('messaging_channels')->where('connector_id', $conector)->where('kind', 'WHATSAPP')->when($id, fn ($q) => $q->where('id', '<>', $id))->exists() && $red === 'WHATSAPP') {
                RuleError::fail('RN-CRM-01', 'Ese conector ya atiende otro número de WhatsApp.');
            }
        }
        if (in_array($d['connection_mode'], ['CLOUD_API_COEXISTENCE', 'CLOUD_API', 'DM_API'], true) && ! $conector) {
            RuleError::fail('RN-CRM-01', 'Con la API oficial el número necesita su conector de Integraciones, donde el administrador cargó las credenciales.');
        }
        $fila = [
            'display_name' => mb_substr(trim((string) $d['display_name']), 0, 80), 'brand_id' => $d['brand_id'], 'connection_mode' => $d['connection_mode'],
            'coexistence' => $d['connection_mode'] === 'CLOUD_API_COEXISTENCE', 'assignment_mode' => $d['assignment_mode'], 'status' => $d['status'],
            'auto_greeting' => self::texto($d['auto_greeting'] ?? null), 'recording_notice_text' => self::texto($d['recording_notice_text'] ?? null),
            'connector_id' => $conector, 'updated_at' => now(),
        ];
        if ($red === 'WHATSAPP' && $d['connection_mode'] !== 'APP_ONLY' && ! $fila['recording_notice_text']) {
            RuleError::fail('RN-CRM-21', 'El número necesita el aviso de registro: se envía en el primer mensaje de cada contacto nuevo (Ley 29733).');
        }
        if ($antes) {
            DB::table('messaging_channels')->where('id', $id)->update($fila);
            Events::emit('channel.updated', 'messaging_channels', $id, ['by' => $u->id]);
        } else {
            $id = DB::table('messaging_channels')->insertGetId($fila + [
                'kind' => $red, 'number' => $numero, 'display_phone' => $red === 'WHATSAPP' ? $numero : null, 'provider' => $red === 'WHATSAPP' ? 'CLOUD_API' : null,
                'free_service_quota' => $red === 'WHATSAPP' ? (int) (Params::get('crm_wa_service_free_per_number') ?? 1000) : 0, 'group_msgs_discarded' => 0,
                'connected_at' => now(), 'synced_history_from' => $d['connection_mode'] === 'CLOUD_API_COEXISTENCE' ? now('America/Lima')->subMonths(6)->toDateString() : null,
                'created_at' => now(),
            ], 'id');
            Events::emit('channel.connected', 'messaging_channels', $id, ['kind' => $red, 'by' => $u->id]);
        }

        return self::ficha($id, $u);
    }

    /**
     * Enlaza con su conector de INT los números que aún no lo tienen (por el número que atiende cada conector). Lo hace la
     * migración con los datos que ya existían; aquí, una sola vez, para los números cargados después (por ejemplo, la semilla).
     */
    public static function enlazarConectores(): void
    {
        if (! DB::table('messaging_channels')->whereNull('connector_id')->whereIn('connection_mode', ['CLOUD_API_COEXISTENCE', 'CLOUD_API', 'DM_API'])->exists()) {
            return;
        }
        DB::update(<<<'SQL'
            UPDATE messaging_channels c SET connector_id = i.id
            FROM integration_connectors i
            WHERE i.tenant_id = c.tenant_id AND i.owner_module = 'CRM' AND c.connector_id IS NULL AND (
                (c.kind = 'WHATSAPP' AND i.config->>'display_number' = c.number)
                OR (c.kind = 'MESSENGER' AND i.config->>'page' = c.number)
                OR (c.kind = 'INSTAGRAM' AND i.config->>'instagram' = c.number)
                OR (c.kind = 'TIKTOK' AND i.provider = 'TIKTOK' AND position(c.number IN coalesce(i.config->>'accounts', '')) > 0)
            )
        SQL);
    }

    /** «Probar conexión»: con la API oficial prueba su conector de INT; «solo app» y «no disponible» lo explican. */
    public static function probar(string $id, User $u): array
    {
        $c = DB::table('messaging_channels')->where('id', $id)->first() ?? abort(404);
        if ($c->connection_mode === 'NOT_AVAILABLE') {
            return ['ok' => false, 'mensaje' => 'La mensajería directa de TikTok no está disponible para esta cuenta en Perú. Los anuncios de TikTok llevan a WhatsApp con un código.'];
        }
        if ($c->connection_mode === 'APP_ONLY' || ! $c->connector_id) {
            return ['ok' => false, 'mensaje' => 'Este número está en «solo app»: no está integrado, así que no hay conexión que probar. Sus pedidos se registran a mano.'];
        }
        $r = Conectores::probar($c->connector_id, $u)['resultado'];
        $ms = isset($r['latencia']) && $r['latencia'] !== null ? " en {$r['latencia']} ms" : '';

        return $r['ok'] ? ['ok' => true, 'mensaje' => "Conexión correcta: el conector respondió{$ms}."]
            : ['ok' => false, 'mensaje' => 'El conector no respondió: '.($r['error'] ?? 'sin detalle').'. Revísalo en Integraciones.'];
    }

    public static function opciones(): array
    {
        $o = fn (array $a) => collect($a)->map(fn ($l, $k) => ['value' => $k, 'label' => $l])->values()->all();

        return [
            'redes' => $o(self::REDES), 'conexiones' => $o(self::CONEXIONES), 'por_red' => self::CONEXIONES_POR_RED, 'asignacion' => $o(self::ASIGNACION),
            'estados' => $o(self::ESTADOS), 'marcas' => DB::table('brands')->orderBy('name')->get(['id as value', 'name as label'])->all(),
        ];
    }

    /** Los meses con uso de respuestas (el más reciente primero) y el mes en curso. */
    private static function meses(): array
    {
        $hay = DB::table('message_charges')->where('category', 'SERVICE')->selectRaw("to_char(period, 'YYYY-MM') AS m")->distinct()->pluck('m')->all();
        $todos = array_unique(array_merge([now('America/Lima')->format('Y-m')], $hay));
        rsort($todos);
        // El último con actividad va primero (el mes en curso puede estar vacío al empezar).
        $conUso = array_values(array_filter($todos, fn ($m) => in_array($m, $hay, true)));
        $orden = array_values(array_unique(array_merge($conUso ? [$conUso[0]] : [], $todos)));

        return array_map(fn ($m) => ['value' => $m, 'label' => ucfirst(Carbon::createFromFormat('Y-m-d', "{$m}-01")->locale('es')->translatedFormat('F Y'))], $orden);
    }

    /** Conectores de mensajería de INT que se pueden enlazar (los de WhatsApp, si no atienden ya otro número). */
    private static function conectoresLibres(): array
    {
        $usados = DB::table('messaging_channels')->where('kind', 'WHATSAPP')->whereNotNull('connector_id')->pluck('connector_id')->all();

        return DB::table('integration_connectors')->where('owner_module', 'CRM')->orderBy('code')->get(['id', 'code', 'name', 'provider', 'environment'])
            ->map(fn ($i) => ['value' => $i->id, 'label' => "{$i->name}".($i->environment === 'SANDBOX' ? ' (prueba)' : ''), 'provider' => $i->provider,
                'libre' => $i->provider !== 'WHATSAPP_CLOUD' || ! in_array($i->id, $usados, true)])->all();
    }

    private static function texto(?string $t): ?string
    {
        $t = trim((string) $t);

        return $t === '' ? null : mb_substr($t, 0, 1000);
    }

    private static function presentar(object $c, int $usadas, int $miembros): array
    {
        return [
            'id' => $c->id, 'kind' => $c->kind, 'kind_name' => self::REDES[$c->kind] ?? $c->kind, 'display_name' => $c->display_name, 'number' => $c->number,
            'brand_id' => $c->brand_id, 'brand_name' => $c->brand_name ?? '—', 'connection_mode' => $c->connection_mode, 'connection_name' => self::CONEXIONES[$c->connection_mode] ?? $c->connection_mode,
            'free_service_quota' => (int) $c->free_service_quota, 'usadas' => $c->kind === 'WHATSAPP' ? $usadas : null,
            'quality_rating' => $c->quality_rating, 'quality_name' => self::CALIDAD[$c->quality_rating] ?? null,
            'assignment_mode' => $c->assignment_mode, 'assignment_name' => self::ASIGNACION[$c->assignment_mode] ?? $c->assignment_mode,
            'status' => $c->status, 'status_name' => self::ESTADOS[$c->status] ?? $c->status, 'miembros' => $miembros,
            'connector_id' => $c->connector_id, 'connector_code' => $c->connector_code ?? null, 'connector_status' => $c->connector_status ?? null,
            'connector_environment' => $c->connector_environment ?? null, 'coexistence' => (bool) $c->coexistence,
        ];
    }
}
