<?php

namespace App\Modulos\Api\Services;

use App\Models\User;
use App\Support\Access;
use App\Support\Events;
use App\Support\Paginas;
use App\Support\Params;
use App\Support\RuleError;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;

/**
 * API-04 Destinos de webhooks, API-05 Crear o editar destino, API-06 Entregas y API-07 Detalle de entrega
 * (RN-API-05 a 08, 12 y 17; KPI-API-01 y KPI-API-02).
 *
 *  - URL https pública, sin localhost, dominios internos ni IP privadas o de loopback; al enviar se resuelve el host y
 *    se bloquea si apunta a una IP privada (protección contra SSRF, RN-API-05).
 *  - Solo eventos vigentes del catálogo (RN-API-06); si el módulo dueño o API está apagado, no se publica.
 *  - Cada entrega lleva la cabecera GestionCarnica-Signature: t=<segundos>, v1=<HMAC-SHA256 hex de "t.cuerpo">. Al rotar
 *    el secreto, el anterior sigue firmando 24 horas en una segunda v1 (RN-API-07).
 *  - Un evento se entrega una sola vez por destino, salvo reenvío manual (resent_from).
 *  - Reintentos con espera exponencial (1, 5, 30, 120, 360, 720 y 1440 minutos) hasta api_webhook_max_attempts (8); al
 *    octavo intento fallido pasa a la cola muerta y avisa al administrador del sistema (RN-API-08).
 *  - Una racha de api_webhook_disable_after_failures (50) intentos fallidos seguidos desactiva el destino; una entrega
 *    exitosa reinicia la racha a cero. Reactivar un destino desactivado exige un motivo de al menos 10 caracteres (RN-API-12).
 */
final class Webhooks
{
    public const ESTADOS_DESTINO = ['ACTIVE' => 'Activo', 'PAUSED' => 'Pausado', 'DISABLED' => 'Desactivado'];

    public const ESTADOS_ENTREGA = ['PENDING' => 'Pendiente', 'RETRYING' => 'Reintentando', 'DELIVERED' => 'Entregado', 'DEAD' => 'Cola muerta'];

    public const SIMULADOR = [
        'OK' => 'Responde 200 al instante',
        'FLAKY' => 'Falla el primer intento (504) y luego responde 200',
        'DOWN' => 'Caído: 503 o sin respuesta',
        'SLOW' => 'Tarda más de 10 s (tiempo agotado)',
        'ERROR_500' => 'Responde 500 (error del receptor)',
    ];

    /** DNS determinista para los receptores de demostración (RN-API-05: se resuelve al enviar). */
    private const DNS_DEMO = [
        'erp.elcuydorado.pe' => '190.12.88.41',
        'bi.estudiorojas.pe' => '181.176.40.9',
        'tienda.marca5gourmet.pe' => '172.67.150.22',
        'erp-legacy.donguando.pe' => '10.20.0.15',
        'webhook.site' => '46.4.105.116',
        'hooks.zapier.com' => '54.86.12.7',
    ];

    private const BASE62 = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

    private static function azar(int $n): string
    {
        $s = '';
        $max = strlen(self::BASE62) - 1;
        for ($i = 0; $i < $n; $i++) {
            $s .= self::BASE62[random_int(0, $max)];
        }

        return $s;
    }

    /* ------------------------------------------------------------------ URL y SSRF (RN-API-05) */

    public static function esIp(string $host): bool
    {
        return (bool) preg_match('/^\d{1,3}(\.\d{1,3}){3}$/', $host) || str_contains($host, ':');
    }

    public static function esIpPrivada(string $ip): bool
    {
        $ip = strtolower(trim($ip, '[]'));
        if ($ip === '::1' || preg_match('/^(fe80:|f[cd][0-9a-f]{2}:)/i', $ip)) {
            return true;
        }
        if (! preg_match('/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/', $ip, $m)) {
            return false;
        }
        [$a, $b] = [(int) $m[1], (int) $m[2]];

        return $a === 10
            || $a === 127
            || $a === 0
            || ($a === 169 && $b === 254)
            || ($a === 192 && $b === 168)
            || ($a === 172 && $b >= 16 && $b <= 31)
            || ($a === 100 && $b >= 64 && $b <= 127);
    }

    public static function hostDe(string $url): string
    {
        $h = parse_url(trim($url), PHP_URL_HOST);

        return strtolower(trim((string) $h, '[]'));
    }

    /** Resuelve el host a una IP en el momento del envío (RN-API-05). */
    public static function resolverHost(string $host): string
    {
        $host = strtolower(trim($host, '[]'));
        if (self::esIp($host)) {
            return $host;
        }
        if ($host === 'localhost' || str_ends_with($host, '.localhost')) {
            return '127.0.0.1';
        }
        if (isset(self::DNS_DEMO[$host])) {
            return self::DNS_DEMO[$host];
        }
        $x = hash('sha256', $host);

        return sprintf('200.%d.%d.%d', hexdec(substr($x, 0, 2)), hexdec(substr($x, 2, 2)), 1 + (hexdec(substr($x, 4, 2)) % 254));
    }

    /** Valida que la URL sea https pública y devuelve la URL limpia o lanza RN-API-05. */
    public static function validarUrl(string $url): string
    {
        $u = trim($url);
        $partes = parse_url($u);
        if (! is_array($partes) || empty($partes['scheme']) || empty($partes['host'])) {
            RuleError::fail('RN-API-05', 'Escribe una URL completa, por ejemplo https://erp.tucliente.pe/hooks/gestioncarnica.');
        }
        $esquema = strtolower($partes['scheme']);
        if ($esquema !== 'https') {
            RuleError::fail('RN-API-05', "El destino debe usar https (pusiste {$esquema}).");
        }
        $host = strtolower(trim($partes['host'], '[]'));
        if ($host === 'localhost' || preg_match('/\.(localhost|local|internal|lan)$/', $host) || (! str_contains($host, '.') && ! str_contains($host, ':'))) {
            RuleError::fail('RN-API-05', "{$host} es un nombre local: usa un dominio público.");
        }
        if (self::esIp($host)) {
            if (preg_match('/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/', $host, $m)) {
                foreach ([1, 2, 3, 4] as $i) {
                    if ((int) $m[$i] > 255) {
                        RuleError::fail('RN-API-05', "{$host} no es una dirección IP válida.");
                    }
                }
            }
            if (self::esIpPrivada($host)) {
                RuleError::fail('RN-API-05', "{$host} es una IP privada o de loopback.");
            }
        }

        return $u;
    }

    /** Revisión previa de una URL para el formulario API-05. */
    public static function revisarUrl(string $url): array
    {
        $u = self::validarUrl($url);
        $host = self::hostDe($u);
        $ip = self::resolverHost($host);
        $privada = self::esIpPrivada($ip);

        return [
            'ok' => true,
            'url' => $u,
            'host' => $host,
            'ip' => $ip,
            'ip_privada' => $privada,
            'aviso' => $privada
                ? "URL válida, pero {$host} resuelve hoy a {$ip} (red privada): los envíos se bloquearán al enviar."
                : "URL válida · {$host} → {$ip}",
        ];
    }

    /* ------------------------------------------------------------------ firma HMAC-SHA256 (RN-API-07) */

    private static function cifrar(string $secreto): string
    {
        return 'enc:v2:'.Crypt::encryptString($secreto);
    }

    public static function descifrar(?string $enc): string
    {
        if (! $enc) {
            return '';
        }
        if (str_starts_with($enc, 'enc:v2:')) {
            try {
                return Crypt::decryptString(substr($enc, 7));
            } catch (\Throwable) {
                return '';
            }
        }

        return $enc;
    }

    public static function firma(string $secreto, int|string $t, string $cuerpo): string
    {
        return hash_hmac('sha256', "{$t}.{$cuerpo}", $secreto);
    }

    public static function cabeceraFirma(object $ep, string $cuerpo, ?Carbon $cuando = null): string
    {
        $cuando ??= now();
        $t = $cuando->getTimestamp();
        $firmas = ['v1='.self::firma(self::descifrar($ep->secret_enc), $t, $cuerpo)];
        if ($ep->prev_secret_enc && $ep->prev_valid_until && $cuando->lte(Carbon::parse($ep->prev_valid_until))) {
            $firmas[] = 'v1='.self::firma(self::descifrar($ep->prev_secret_enc), $t, $cuerpo);
        }

        return "t={$t}, ".implode(', ', $firmas);
    }

    /** Lo que hace el receptor: acepta si alguna v1 coincide y la marca de tiempo no supera la tolerancia (RN-API-07). */
    public static function verificarFirma(string $cabecera, string $secreto, string $cuerpo, ?int $ahoraTs = null): array
    {
        $partes = array_map('trim', explode(',', $cabecera));
        $t = 0;
        $firmas = [];
        foreach ($partes as $p) {
            if (str_starts_with($p, 't=')) {
                $t = (int) substr($p, 2);
            } elseif (str_starts_with($p, 'v1=')) {
                $firmas[] = substr($p, 3);
            }
        }
        if ($t <= 0 || ! $firmas) {
            return ['ok' => false, 'reason' => 'Cabecera incompleta'];
        }
        $tol = (int) (Params::get('api_signature_tolerance_seconds') ?? 300);
        $ahora = $ahoraTs ?? $t;
        if (abs($ahora - $t) > $tol) {
            return ['ok' => false, 'reason' => 'Firma con '.abs($ahora - $t)." s de antigüedad (máximo {$tol} s)"];
        }
        $esperada = self::firma($secreto, $t, $cuerpo);
        foreach ($firmas as $f) {
            if (hash_equals($esperada, $f)) {
                return ['ok' => true, 'reason' => 'Firma válida', 't' => $t, 'expected' => $esperada];
            }
        }

        return ['ok' => false, 'reason' => 'Ninguna v1 coincide con el HMAC esperado', 't' => $t, 'expected' => $esperada];
    }

    /* ------------------------------------------------------------------ parámetros */

    public static function maxIntentos(): int
    {
        return max(1, (int) (Params::get('api_webhook_max_attempts') ?? 8));
    }

    public static function limiteFallos(): int
    {
        return max(1, (int) (Params::get('api_webhook_disable_after_failures') ?? 50));
    }

    public static function timeoutSegundos(): int
    {
        return max(1, (int) (Params::get('api_webhook_timeout_seconds') ?? 10));
    }

    public static function esperasMinutos(): array
    {
        $v = Params::get('api_webhook_backoff_minutes');
        if (is_string($v)) {
            $v = json_decode($v, true);
        }

        return is_array($v) && $v ? array_values(array_map('intval', $v)) : [1, 5, 30, 120, 360, 720, 1440];
    }

    /* ------------------------------------------------------------------ presentación */

    private static function marcas(): array
    {
        return DB::table('brands')->orderBy('name')->pluck('name', 'id')->all();
    }

    private static function presentarDestino(object $e, array $marcas, array $conteoEntregas = []): array
    {
        $evs = json_decode((string) $e->events, true) ?: [];
        $brands = json_decode((string) $e->brand_ids, true) ?: [];
        $host = self::hostDe($e->url);
        $ip = self::resolverHost($host);
        $prevVigente = $e->prev_valid_until && Carbon::parse($e->prev_valid_until)->gte(now());

        return [
            'id' => $e->id,
            'name' => $e->name,
            'description' => $e->description,
            'url' => $e->url,
            'host' => $host,
            'resolved_ip' => $ip,
            'ip_privada' => self::esIpPrivada($ip),
            'environment' => $e->environment,
            'entorno' => Claves::ENTORNOS[$e->environment] ?? $e->environment,
            'events' => $evs,
            'brand_ids' => $brands,
            'marcas' => $brands ? array_values(array_map(fn ($b) => $marcas[$b] ?? '—', $brands)) : [],
            'customer_id' => $e->customer_id,
            'cliente' => $e->cliente_comercial ?? $e->cliente_nombre ?? null,
            'sim_mode' => $e->sim_mode,
            'simulador' => self::SIMULADOR[$e->sim_mode] ?? $e->sim_mode,
            'status' => $e->status,
            'estado' => self::ESTADOS_DESTINO[$e->status] ?? $e->status,
            'secret_last4' => $e->secret_last4,
            'secret_version' => (int) $e->secret_version,
            'prev_last4' => $e->prev_last4,
            'prev_valid_until' => $e->prev_valid_until,
            'prev_vigente' => (bool) $prevVigente,
            'rotated_at' => $e->rotated_at,
            'failure_streak' => (int) $e->failure_streak,
            'limite_fallos' => self::limiteFallos(),
            'last_delivery_at' => $e->last_delivery_at,
            'last_delivery_status' => $e->last_delivery_status,
            'disabled_at' => $e->disabled_at,
            'disabled_reason' => $e->disabled_reason,
            'status_reason' => $e->status_reason,
            'entregas_count' => (int) ($conteoEntregas[$e->id] ?? 0),
            'created_at' => $e->created_at,
        ];
    }

    private static function presentarEntrega(object $d): array
    {
        return [
            'id' => $d->id,
            'number' => $d->number,
            'endpoint_id' => $d->endpoint_id,
            'endpoint_name' => $d->endpoint_name ?? '—',
            'endpoint_url' => $d->endpoint_url ?? null,
            'endpoint_status' => $d->endpoint_status ?? null,
            'environment' => $d->environment,
            'entorno' => Claves::ENTORNOS[$d->environment] ?? $d->environment,
            'event_id' => $d->event_id,
            'event_type' => $d->event_type,
            'event_version' => $d->event_version,
            'occurred_at' => $d->occurred_at,
            'payload' => $d->payload,
            'signature' => $d->signature,
            'status' => $d->status,
            'estado' => self::ESTADOS_ENTREGA[$d->status] ?? $d->status,
            'attempts' => (int) $d->attempts,
            'max_attempts' => self::maxIntentos(),
            'next_attempt_at' => $d->next_attempt_at,
            'delivered_at' => $d->delivered_at,
            'dead_at' => $d->dead_at,
            'resent_from' => $d->resent_from,
            'resent_from_number' => $d->resent_from_number ?? null,
            'resent_to' => $d->resent_to,
            'resent_to_number' => $d->resent_to_number ?? null,
            'resent_at' => $d->resent_at,
            'last_http' => $d->last_http !== null ? (int) $d->last_http : null,
            'last_error' => $d->last_error,
            'is_test' => (bool) $d->is_test,
            'created_at' => $d->created_at,
        ];
    }

    /* ------------------------------------------------------------------ indicadores (KPI-API-01, KPI-API-02) */

    public static function indicadores(): array
    {
        $desde = now('America/Lima')->subDays(29)->startOfDay()->toIso8601String();
        $entregas30 = DB::table('api_webhook_deliveries')->where('created_at', '>=', $desde)
            ->selectRaw('count(*) FILTER (WHERE attempts >= 1) AS total,
                count(*) FILTER (WHERE status = \'DELIVERED\' AND attempts = 1) AS a_la_primera')->first();
        $den = (int) ($entregas30->total ?? 0);
        $num = (int) ($entregas30->a_la_primera ?? 0);
        $muertas = (int) DB::table('api_webhook_deliveries')->where('status', 'DEAD')->whereNull('resent_to')->count();

        return [
            'a_la_primera_pct' => $den > 0 ? round($num / $den * 100, 1) : null,
            'a_la_primera_num' => $num,
            'a_la_primera_den' => $den,
            'cola_muerta_sin_reenviar' => $muertas,
        ];
    }

    /* ------------------------------------------------------------------ API-04 Destinos */

    public static function listaDestinos(array $f, User $u): array
    {
        self::asegurarSemillaDemo();
        $q = DB::table('api_webhook_endpoints as e')->leftJoin('customers as cu', 'cu.id', '=', 'e.customer_id');
        if (! empty($f['estado'])) {
            $q->where('e.status', $f['estado']);
        }
        if (! empty($f['entorno'])) {
            $q->where('e.environment', $f['entorno']);
        }
        $t = trim((string) ($f['buscar'] ?? ''));
        if (mb_strlen($t) >= 2) {
            $p = '%'.addcslashes($t, '%_\\').'%';
            $q->where(fn ($w) => $w->where('e.name', 'ilike', $p)->orWhere('e.url', 'ilike', $p)->orWhere('e.description', 'ilike', $p));
        }
        $q->orderByRaw("CASE e.status WHEN 'ACTIVE' THEN 0 WHEN 'PAUSED' THEN 1 ELSE 2 END")->orderByDesc('e.created_at');
        $filas = $q->get(['e.*', 'cu.full_name as cliente_nombre', 'cu.trade_name as cliente_comercial']);
        $marcas = self::marcas();
        $conteos = DB::table('api_webhook_deliveries')->groupBy('endpoint_id')->selectRaw('endpoint_id, count(*) as n')->pluck('n', 'endpoint_id')->all();
        $tot = DB::table('api_webhook_endpoints')->selectRaw("count(*) as total,
            count(*) FILTER (WHERE status = 'ACTIVE') as activos,
            count(*) FILTER (WHERE status <> 'ACTIVE') as inactivos,
            count(*) FILTER (WHERE status = 'DISABLED') as desactivados")->first();
        $kpis = self::indicadores();

        return [
            'data' => $filas->map(fn ($e) => self::presentarDestino($e, $marcas, $conteos))->all(),
            'cifras' => [
                'total' => (int) $tot->total,
                'activos' => (int) $tot->activos,
                'inactivos' => (int) $tot->inactivos,
                'desactivados' => (int) $tot->desactivados,
                'a_la_primera_pct' => $kpis['a_la_primera_pct'],
                'a_la_primera_num' => $kpis['a_la_primera_num'],
                'a_la_primera_den' => $kpis['a_la_primera_den'],
                'cola_muerta' => $kpis['cola_muerta_sin_reenviar'],
            ],
            'limite_fallos' => self::limiteFallos(),
            'puede' => Access::can($u, 'api.webhook.manage'),
        ];
    }

    public static function verDestino(string $id, User $u): array
    {
        $e = DB::table('api_webhook_endpoints as e')->leftJoin('customers as cu', 'cu.id', '=', 'e.customer_id')
            ->where('e.id', $id)->first(['e.*', 'cu.full_name as cliente_nombre', 'cu.trade_name as cliente_comercial']) ?? abort(404);
        $conteo = [$e->id => DB::table('api_webhook_deliveries')->where('endpoint_id', $e->id)->count()];
        $ultimas = DB::table('api_webhook_deliveries as d')->where('d.endpoint_id', $e->id)->orderByDesc('d.created_at')->limit(8)
            ->get(['d.*'])->map(fn ($d) => self::presentarEntrega($d))->all();

        return self::presentarDestino($e, self::marcas(), $conteo) + [
            'ultimas_entregas' => $ultimas,
            'puede' => Access::can($u, 'api.webhook.manage'),
        ];
    }

    /* ------------------------------------------------------------------ API-05 Crear o editar destino */

    public static function formularioDestino(?string $id, User $u): array
    {
        $encendidos = DB::table('tenant_modules')->where('enabled', true)->pluck('module_code')->all();
        $eventos = DB::table('api_event_types as e')->join('api_scopes as s', 's.code', '=', 'e.scope_code')
            ->where('e.status', 'ACTIVE')->orderBy('e.sort_order')->get(['e.*', 's.name as alcance_nombre'])
            ->map(fn ($e) => [
                'code' => $e->code,
                'module_code' => $e->module_code,
                'modulo' => Catalogo::MODULOS[$e->module_code] ?? $e->module_code,
                'scope_code' => $e->scope_code,
                'description' => $e->description,
                'version' => $e->version,
                'modulo_encendido' => in_array($e->module_code, $encendidos, true),
            ])->all();

        return [
            'destino' => $id ? self::verDestino($id, $u) : null,
            'eventos' => $eventos,
            'marcas' => DB::table('brands')->where('status', 'ACTIVE')->orderBy('name')->get(['id', 'name'])->map(fn ($b) => ['value' => $b->id, 'label' => $b->name])->all(),
            'clientes' => DB::table('customers')->where('doc_type', 'RUC')->where('status', '<>', 'INACTIVE')->whereNull('merged_into_id')
                ->orderBy('full_name')->limit(40)->get(['id', 'full_name', 'trade_name', 'doc_number'])
                ->map(fn ($c) => ['value' => $c->id, 'label' => ($c->trade_name ?: $c->full_name)." · RUC {$c->doc_number}"])->all(),
            'simuladores' => collect(self::SIMULADOR)->map(fn ($l, $k) => ['value' => $k, 'label' => $l])->values()->all(),
            'puede' => Access::can($u, 'api.webhook.manage'),
        ];
    }

    /** Guarda un destino nuevo o edita uno existente. Devuelve el secreto en claro solo al crearlo. */
    public static function guardarDestino(?string $id, array $d, ?User $u = null, ?string $creadoPor = null): array
    {
        if ($u && ! Access::can($u, 'api.webhook.manage')) {
            RuleError::fail('RN-SEG-12', 'Gestionar destinos de webhooks exige el permiso api.webhook.manage.');
        }
        $nombre = trim((string) ($d['name'] ?? ''));
        if (mb_strlen($nombre) < 3) {
            RuleError::fail('RN-API-05', 'Ponle un nombre de al menos 3 caracteres al destino.');
        }
        $url = self::validarUrl((string) ($d['url'] ?? ''));
        $eventos = array_values(array_unique(array_filter($d['events'] ?? [])));
        if (! $eventos) {
            RuleError::fail('RN-API-06', 'Suscribe el destino a al menos un evento.');
        }
        $catalogo = DB::table('api_event_types')->whereIn('code', $eventos)->get()->keyBy('code');
        foreach ($eventos as $ev) {
            $et = $catalogo[$ev] ?? null;
            if (! $et) {
                RuleError::fail('RN-API-06', "El evento {$ev} no existe en el catálogo.");
            }
            if ($et->status !== 'ACTIVE') {
                RuleError::fail('RN-API-06', "El evento {$ev} ({$et->version}) está retirado del catálogo.");
            }
        }
        $marcas = array_values(array_unique(array_filter($d['brand_ids'] ?? [])));
        if ($marcas && DB::table('brands')->whereIn('id', $marcas)->count() !== count($marcas)) {
            RuleError::fail('RN-API-11', 'Alguna de las marcas seleccionadas no pertenece a esta empresa.');
        }
        $cliente = ! empty($d['customer_id']) ? $d['customer_id'] : null;
        if ($cliente && ! DB::table('customers')->where('id', $cliente)->whereNull('merged_into_id')->exists()) {
            RuleError::fail('RN-API-11', 'El cliente seleccionado no existe.');
        }
        $sim = $d['sim_mode'] ?? 'OK';
        if (! isset(self::SIMULADOR[$sim])) {
            $sim = 'OK';
        }
        $desc = isset($d['description']) && trim((string) $d['description']) !== '' ? mb_substr(trim((string) $d['description']), 0, 500) : null;

        if ($id) {
            $actual = DB::table('api_webhook_endpoints')->where('id', $id)->first() ?? abort(404);
            DB::table('api_webhook_endpoints')->where('id', $id)->update([
                'name' => mb_substr($nombre, 0, 120),
                'url' => mb_substr($url, 0, 500),
                'events' => json_encode($eventos),
                'brand_ids' => json_encode($marcas),
                'customer_id' => $cliente,
                'sim_mode' => $sim,
                'description' => $desc,
                'updated_at' => now(),
            ]);
            Events::emit('api.webhook_endpoint_updated', 'api_webhook_endpoints', $actual->id, ['name' => $nombre, 'url' => $url, 'events' => $eventos]);

            return ['destino' => $u ? self::verDestino($actual->id, $u) : self::presentarDestino(DB::table('api_webhook_endpoints')->where('id', $actual->id)->first(), self::marcas()), 'secret' => null];
        }

        $entorno = ($d['environment'] ?? 'LIVE') === 'TEST' ? 'TEST' : 'LIVE';
        $secreto = 'whsec_'.self::azar(32);
        $nuevoId = DB::table('api_webhook_endpoints')->insertGetId([
            'name' => mb_substr($nombre, 0, 120),
            'description' => $desc,
            'url' => mb_substr($url, 0, 500),
            'environment' => $entorno,
            'events' => json_encode($eventos),
            'brand_ids' => json_encode($marcas),
            'customer_id' => $cliente,
            'sim_mode' => $sim,
            'status' => 'ACTIVE',
            'secret_enc' => self::cifrar($secreto),
            'secret_last4' => substr($secreto, -4),
            'secret_version' => 1,
            'failure_streak' => 0,
            'created_by' => $u?->id,
            'created_at' => now(),
            'updated_at' => now(),
        ], 'id');
        Events::emit('api.webhook_endpoint_created', 'api_webhook_endpoints', $nuevoId, ['name' => $nombre, 'url' => $url, 'events' => $eventos, 'by' => $creadoPor ?? $u?->id]);

        return [
            'destino' => $u ? self::verDestino($nuevoId, $u) : self::presentarDestino(DB::table('api_webhook_endpoints')->where('id', $nuevoId)->first(), self::marcas()),
            'secret' => $secreto,
        ];
    }

    /** Pausar, reanudar o reactivar con motivo un destino desactivado por fallos (RN-API-12). */
    public static function cambiarEstado(string $id, string $estado, ?string $motivo, User $u): array
    {
        if (! Access::can($u, 'api.webhook.manage')) {
            RuleError::fail('RN-SEG-12', 'Pausar o reactivar destinos exige el permiso api.webhook.manage.');
        }
        $ep = DB::table('api_webhook_endpoints')->where('id', $id)->first() ?? abort(404);
        if (! in_array($estado, ['ACTIVE', 'PAUSED'], true)) {
            RuleError::fail('RN-API-12', 'El estado elegido no es válido.');
        }
        $motivoLimpio = trim((string) $motivo);
        if ($estado === 'ACTIVE' && $ep->status === 'DISABLED' && mb_strlen($motivoLimpio) < 10) {
            RuleError::fail('RN-API-12', 'Reactivar un destino desactivado por fallos exige un motivo de al menos 10 caracteres (qué se corrigió).');
        }
        DB::table('api_webhook_endpoints')->where('id', $id)->update([
            'status' => $estado,
            'failure_streak' => $estado === 'ACTIVE' ? 0 : $ep->failure_streak,
            'status_reason' => $motivoLimpio !== '' ? mb_substr($motivoLimpio, 0, 500) : null,
            'disabled_at' => $estado === 'ACTIVE' ? null : $ep->disabled_at,
            'disabled_reason' => $estado === 'ACTIVE' ? null : $ep->disabled_reason,
            'updated_at' => now(),
        ]);
        Events::emit('api.webhook_endpoint_status', 'api_webhook_endpoints', $id, ['from' => $ep->status, 'to' => $estado, 'reason' => $motivoLimpio ?: null]);
        if ($estado === 'ACTIVE') {
            self::procesarCola(['endpoint' => $id]);
        }

        return self::verDestino($id, $u);
    }

    /** Rota el secreto: el anterior sigue firmando 24 horas en una segunda v1 (RN-API-07). */
    public static function rotarSecreto(string $id, User $u): array
    {
        if (! Access::can($u, 'api.webhook.manage')) {
            RuleError::fail('RN-SEG-12', 'Rotar secretos exige el permiso api.webhook.manage.');
        }
        $ep = DB::table('api_webhook_endpoints')->where('id', $id)->first() ?? abort(404);
        $secreto = 'whsec_'.self::azar(32);
        $ahora = now();
        $hasta = $ahora->copy()->addHours(24);
        $nuevaVersion = ((int) $ep->secret_version) + 1;
        DB::table('api_webhook_endpoints')->where('id', $id)->update([
            'prev_secret_enc' => $ep->secret_enc,
            'prev_last4' => $ep->secret_last4,
            'prev_valid_until' => $hasta,
            'secret_enc' => self::cifrar($secreto),
            'secret_last4' => substr($secreto, -4),
            'secret_version' => $nuevaVersion,
            'rotated_at' => $ahora,
            'updated_at' => $ahora,
        ]);
        Events::emit('api.webhook_secret_rotated', 'api_webhook_endpoints', $id, ['from_version' => (int) $ep->secret_version, 'to_version' => $nuevaVersion, 'prev_valid_until' => $hasta->toIso8601String()]);

        return ['destino' => self::verDestino($id, $u), 'secret' => $secreto];
    }

    /* ------------------------------------------------------------------ publicación, encolado e intentos (RN-API-06, 07, 08 y 12) */

    public static function eventId(string $tipo, string $fuente, string $ocurrio): string
    {
        $tenant = (string) (DB::selectOne('SELECT app_tenant_id() AS t')?->t ?? '');

        return 'evt_'.substr(hash('sha256', "{$tenant}|{$tipo}|{$fuente}|{$ocurrio}"), 0, 24);
    }

    private static function siguienteNumero(): string
    {
        $ultimo = DB::table('api_webhook_deliveries')->lockForUpdate()->orderByDesc('number')->value('number');
        $n = $ultimo && preg_match('/^WD-(\d+)$/', $ultimo, $m) ? ((int) $m[1]) + 1 : 1;

        return sprintf('WD-%06d', $n);
    }

    /** Publica un evento del catálogo a todos los destinos suscritos del entorno (RN-API-06, RN-API-07, RN-API-17). */
    public static function publicar(string $tipo, array $datos, array $opc = []): array
    {
        $et = DB::table('api_event_types')->where('code', $tipo)->first();
        if (! $et || $et->status !== 'ACTIVE') {
            return [];
        }
        $encendidos = DB::table('tenant_modules')->where('enabled', true)->pluck('module_code')->all();
        if (! in_array('API', $encendidos, true) || ! in_array($et->module_code, $encendidos, true)) {
            return [];
        }
        $entorno = ($opc['env'] ?? 'LIVE') === 'TEST' ? 'TEST' : 'LIVE';
        $cuando = isset($opc['occurred_at']) ? Carbon::parse($opc['occurred_at']) : now();
        $fuente = (string) ($opc['source_id'] ?? substr(json_encode($datos), 0, 80));
        $eventId = $opc['event_id'] ?? self::eventId($tipo, $fuente, $cuando->toIso8601String());
        $marca = $opc['brand_id'] ?? null;
        $cliente = $opc['customer_id'] ?? null;
        $intentarYa = $opc['attempt_now'] ?? true;

        $destinos = DB::table('api_webhook_endpoints')->whereIn('status', ['ACTIVE', 'PAUSED'])->where('environment', $entorno)->get();
        $entregas = [];
        foreach ($destinos as $ep) {
            $evs = json_decode((string) $ep->events, true) ?: [];
            if (! in_array($tipo, $evs, true)) {
                continue;
            }
            $marcasEp = json_decode((string) $ep->brand_ids, true) ?: [];
            if ($marcasEp && $marca && ! in_array($marca, $marcasEp, true)) {
                continue;
            }
            if ($ep->customer_id && $cliente && $ep->customer_id !== $cliente) {
                continue;
            }
            $d = self::encolar($ep, $tipo, $eventId, $datos, $cuando, $et->version, false);
            if ($intentarYa && (int) $d->attempts === 0 && $ep->status === 'ACTIVE') {
                $d = self::intentar($d->id, $cuando);
            }
            $entregas[] = $d;
        }

        return $entregas;
    }

    public static function encolar(object $ep, string $tipo, string $eventId, array $datos, ?Carbon $cuando = null, string $version = 'v1', bool $esPrueba = false): object
    {
        $cuando ??= now();
        $existente = DB::table('api_webhook_deliveries')->where('endpoint_id', $ep->id)->where('event_id', $eventId)->whereNull('resent_from')->first();
        if ($existente) {
            return $existente;   // RN-API-07: una sola vez por destino
        }
        $cuerpo = json_encode([
            'event_id' => $eventId,
            'type' => $tipo,
            'version' => $version,
            'occurred_at' => $cuando->copy()->setTimezone('America/Lima')->format('Y-m-d\TH:i:sP'),
            'livemode' => $ep->environment === 'LIVE',
            'data' => $datos,
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

        try {
            $id = DB::transaction(fn () => DB::table('api_webhook_deliveries')->insertGetId([
                'number' => self::siguienteNumero(),
                'endpoint_id' => $ep->id,
                'environment' => $ep->environment,
                'event_id' => $eventId,
                'event_type' => $tipo,
                'event_version' => $version,
                'occurred_at' => $cuando,
                'payload' => $cuerpo,
                'status' => 'PENDING',
                'attempts' => 0,
                'next_attempt_at' => $cuando,
                'is_test' => $esPrueba,
                'created_at' => $cuando,
                'updated_at' => $cuando,
            ], 'id'));
        } catch (UniqueConstraintViolationException) {
            return DB::table('api_webhook_deliveries')->where('endpoint_id', $ep->id)->where('event_id', $eventId)->whereNull('resent_from')->first();
        }

        return DB::table('api_webhook_deliveries')->where('id', $id)->first();
    }

    /** Respuesta simulada del receptor según su comportamiento configurado y verificación SSRF al resolver DNS. */
    private static function simularReceptor(object $ep, object $d, int $n): array
    {
        $host = self::hostDe($ep->url);
        $ip = self::resolverHost($host);
        if (self::esIpPrivada($ip)) {
            return ['http' => 0, 'ms' => 2, 'ip' => $ip, 'body' => '', 'error' => "{$host} resolvió a {$ip} (red privada); el envío se bloqueó."];
        }
        $hs = hexdec(substr(hash('sha256', "{$d->id}#{$n}"), 0, 4));
        $ok = ['http' => 200, 'ms' => 70 + ($hs % 260), 'ip' => $ip, 'body' => '{"received":true}', 'error' => null];

        return match ($ep->sim_mode) {
            'FLAKY' => $n === 1
                ? ['http' => 504, 'ms' => 9200 + ($hs % 700), 'ip' => $ip, 'body' => '<html><body><h1>504 Gateway Time-out</h1>The server didn\'t respond in time.</body></html>', 'error' => null]
                : $ok,
            'DOWN' => ($n % 2 === 1)
                ? ['http' => 503, 'ms' => 40 + ($hs % 90), 'ip' => $ip, 'body' => '<html><head><title>503 Service Unavailable</title></head><body>nginx</body></html>', 'error' => null]
                : ['http' => 0, 'ms' => 15000, 'ip' => $ip, 'body' => '', 'error' => null],
            'SLOW' => ['http' => 200, 'ms' => 12000 + ($hs % 3000), 'ip' => $ip, 'body' => '{"received":true}', 'error' => null],
            'ERROR_500' => ['http' => 500, 'ms' => 120 + ($hs % 200), 'ip' => $ip, 'body' => '{"error":"Undefined index: data in /var/www/hooks/receptor.php on line 14"}', 'error' => null],
            default => $ok,
        };
    }

    /** Un intento de entrega (RN-API-07, RN-API-08, RN-API-12). */
    public static function intentar(string $deliveryId, ?Carbon $cuando = null, bool $silencioso = false): object
    {
        $d = DB::table('api_webhook_deliveries')->where('id', $deliveryId)->first() ?? abort(404);
        if (! in_array($d->status, ['PENDING', 'RETRYING'], true)) {
            return $d;
        }
        $ep = DB::table('api_webhook_endpoints')->where('id', $d->endpoint_id)->first();
        if (! $ep || $ep->status !== 'ACTIVE') {
            return $d;
        }
        $cuando ??= now();
        $n = ((int) $d->attempts) + 1;
        $tmoMs = self::timeoutSegundos() * 1000;
        $firma = self::cabeceraFirma($ep, (string) $d->payload, $cuando);
        $res = self::simularReceptor($ep, $d, $n);
        if ($res['ms'] > $tmoMs) {
            $res = ['http' => 0, 'ms' => $tmoMs, 'ip' => $res['ip'], 'body' => '', 'error' => 'Sin respuesta en '.($tmoMs / 1000).' s: tiempo de espera agotado.'];
        }
        if (! $res['http'] && ! $res['error']) {
            $res['error'] = 'Conexión rechazada';
        }
        $ok = $res['http'] >= 200 && $res['http'] < 300;
        $max = self::maxIntentos();
        $esperas = self::esperasMinutos();
        $espera = ! $ok && $n < $max ? $esperas[min($n - 1, count($esperas) - 1)] : null;
        $errorTexto = $res['error'] ?: ($ok ? null : "HTTP {$res['http']}");

        DB::table('api_webhook_attempts')->insert([
            'delivery_id' => $d->id,
            'endpoint_id' => $ep->id,
            'attempt_no' => $n,
            'at' => $cuando,
            'http_status' => $res['http'] ?: null,
            'duration_ms' => (int) $res['ms'],
            'ok' => $ok,
            'resolved_ip' => $res['ip'],
            'response_snippet' => $res['body'] !== '' ? mb_substr((string) $res['body'], 0, 200) : null,
            'error' => $errorTexto ? mb_substr($errorTexto, 0, 500) : null,
            'signature' => $firma,
            'secret_version' => (int) $ep->secret_version,
            'wait_next_min' => $espera,
            'created_at' => $cuando,
        ]);

        if ($ok) {
            DB::table('api_webhook_deliveries')->where('id', $d->id)->update([
                'status' => 'DELIVERED',
                'attempts' => $n,
                'delivered_at' => $cuando,
                'last_http' => $res['http'],
                'last_error' => null,
                'next_attempt_at' => null,
                'signature' => $firma,
                'updated_at' => $cuando,
            ]);
            DB::table('api_webhook_endpoints')->where('id', $ep->id)->update([
                'failure_streak' => 0,
                'last_delivery_at' => $cuando,
                'last_delivery_status' => 'DELIVERED',
                'updated_at' => $cuando,
            ]);
        } else {
            $racha = ((int) $ep->failure_streak) + 1;
            $limite = self::limiteFallos();
            if ($n >= $max) {
                DB::table('api_webhook_deliveries')->where('id', $d->id)->update([
                    'status' => 'DEAD',
                    'attempts' => $n,
                    'dead_at' => $cuando,
                    'last_http' => $res['http'] ?: null,
                    'last_error' => mb_substr((string) $errorTexto, 0, 500),
                    'next_attempt_at' => null,
                    'signature' => $firma,
                    'updated_at' => $cuando,
                ]);
                if (! $silencioso) {
                    self::notificar("Entrega {$d->number} en la cola muerta", "{$ep->name} falló {$n} veces ({$errorTexto}). Reenvíala desde el detalle de entrega cuando el destino responda.", '/m/api/api-07?id='.$d->id);
                }
            } else {
                DB::table('api_webhook_deliveries')->where('id', $d->id)->update([
                    'status' => 'RETRYING',
                    'attempts' => $n,
                    'last_http' => $res['http'] ?: null,
                    'last_error' => mb_substr((string) $errorTexto, 0, 500),
                    'next_attempt_at' => $cuando->copy()->addMinutes((int) $espera),
                    'signature' => $firma,
                    'updated_at' => $cuando,
                ]);
            }
            $cambiosEp = [
                'failure_streak' => $racha,
                'last_delivery_at' => $cuando,
                'last_delivery_status' => 'FAILED',
                'updated_at' => $cuando,
            ];
            if ($racha >= $limite) {
                $cambiosEp['status'] = 'DISABLED';
                $cambiosEp['disabled_at'] = $cuando;
                $cambiosEp['disabled_reason'] = mb_substr("{$racha} intentos fallidos seguidos (último: {$errorTexto}).", 0, 500);
            }
            DB::table('api_webhook_endpoints')->where('id', $ep->id)->update($cambiosEp);
            if ($racha >= $limite && ! $silencioso) {
                self::notificar("Destino {$ep->name} desactivado", "{$racha} intentos fallidos seguidos. Corrige el receptor y reactívalo con motivo en Destinos de webhooks.", '/m/api/api-04');
            }
        }

        return DB::table('api_webhook_deliveries')->where('id', $d->id)->first();
    }

    private static function notificar(string $titulo, string $cuerpo, string $href): void
    {
        try {
            DB::table('notifications')->insert([
                'role' => 'ADMIN_SISTEMA',
                'module' => 'API',
                'tone' => 'bad',
                'severity' => 'ERROR',
                'type' => 'WEBHOOK',
                'at' => now(),
                'title' => mb_substr($titulo, 0, 160),
                'body' => mb_substr($cuerpo, 0, 500),
                'ref' => json_encode(['href' => $href]),
            ]);
        } catch (\Throwable) {
            // La notificación no interrumpe el registro del intento.
        }
    }

    /** Procesa las entregas vencidas; con all=true adelanta un intento a la hora programada de cada pendiente. */
    public static function procesarCola(array $opc = []): int
    {
        $adelantar = ! empty($opc['all']);
        $hasta = isset($opc['upTo']) ? Carbon::parse($opc['upTo']) : now();
        $q = DB::table('api_webhook_deliveries as d')
            ->join('api_webhook_endpoints as e', 'e.id', '=', 'd.endpoint_id')
            ->whereIn('d.status', ['PENDING', 'RETRYING'])
            ->where('e.status', 'ACTIVE');
        if (! empty($opc['endpoint'])) {
            $q->where('d.endpoint_id', $opc['endpoint']);
        }
        if (! $adelantar) {
            $q->where('d.next_attempt_at', '<=', $hasta);
        }
        $pendientes = $q->orderBy('d.next_attempt_at')->limit(200)->get(['d.id', 'd.attempts', 'd.next_attempt_at']);
        $realizados = 0;
        foreach ($pendientes as $p) {
            $momento = $p->next_attempt_at ? Carbon::parse($p->next_attempt_at) : $hasta;
            $cuando = $adelantar && $momento->gt($hasta) ? $momento : $hasta;
            $despues = self::intentar($p->id, $cuando);
            if ((int) $despues->attempts > (int) $p->attempts) {
                $realizados++;
            }
        }

        return $realizados;
    }

    /** Envía el evento webhook.test firmado al destino activo. */
    public static function enviarPrueba(string $endpointId, User $u): array
    {
        if (! Access::can($u, 'api.webhook.manage')) {
            RuleError::fail('RN-SEG-12', 'Enviar pruebas exige el permiso api.webhook.manage.');
        }
        $ep = DB::table('api_webhook_endpoints')->where('id', $endpointId)->first() ?? abort(404);
        if ($ep->status !== 'ACTIVE') {
            RuleError::fail('RN-API-12', "{$ep->name} no está activo.");
        }
        $ahora = now();
        $eventId = 'evt_test_'.substr(hash('sha256', $ep->id.$ahora->toIso8601String().random_int(1, 999999)), 0, 16);
        $d = self::encolar($ep, 'webhook.test', $eventId, ['message' => 'Envío de prueba de GestionCarnica', 'endpoint' => $ep->name], $ahora, 'v1', true);
        $d = self::intentar($d->id, $ahora);

        return self::verEntrega($d->id, $u);
    }

    /** Reenvío manual desde API-07: crea una entrega nueva del mismo evento (RN-API-07, RN-API-08). */
    public static function reenviar(string $deliveryId, User $u): array
    {
        if (! Access::can($u, 'api.webhook.resend') && ! Access::can($u, 'api.webhook.manage')) {
            RuleError::fail('RN-SEG-12', 'Reenviar entregas exige el permiso api.webhook.resend.');
        }
        $d = DB::table('api_webhook_deliveries')->where('id', $deliveryId)->first() ?? abort(404);
        if (! in_array($d->status, ['DEAD', 'DELIVERED'], true)) {
            $est = mb_strtolower(self::ESTADOS_ENTREGA[$d->status] ?? $d->status);
            RuleError::fail('RN-API-08', "Solo se reenvía una entrega entregada o en la cola muerta (esta está {$est}).");
        }
        $ep = DB::table('api_webhook_endpoints')->where('id', $d->endpoint_id)->first() ?? abort(404);
        if ($ep->status === 'DISABLED') {
            RuleError::fail('RN-API-12', "{$ep->name} está desactivado: reactívalo en Destinos de webhooks antes de reenviar.");
        }
        $ahora = now();
        $nuevoId = DB::transaction(function () use ($d, $u, $ahora) {
            $id = DB::table('api_webhook_deliveries')->insertGetId([
                'number' => self::siguienteNumero(),
                'endpoint_id' => $d->endpoint_id,
                'environment' => $d->environment,
                'event_id' => $d->event_id,
                'event_type' => $d->event_type,
                'event_version' => $d->event_version,
                'occurred_at' => $d->occurred_at,
                'payload' => $d->payload,
                'status' => 'PENDING',
                'attempts' => 0,
                'next_attempt_at' => $ahora,
                'resent_from' => $d->id,
                'resent_by' => $u->id,
                'is_test' => (bool) $d->is_test,
                'created_at' => $ahora,
                'updated_at' => $ahora,
            ], 'id');
            DB::table('api_webhook_deliveries')->where('id', $d->id)->update(['resent_to' => $id, 'resent_at' => $ahora, 'updated_at' => $ahora]);

            return $id;
        });
        Events::emit('api.webhook_delivery_resent', 'api_webhook_deliveries', $d->id, ['by' => $u->id, 'from' => $d->number, 'to_id' => $nuevoId, 'event_id' => $d->event_id]);
        self::intentar($nuevoId, $ahora);

        return self::verEntrega($nuevoId, $u);
    }

    /* ------------------------------------------------------------------ API-06 Entregas y API-07 Detalle */

    public static function listaEntregas(array $f, User $u): array
    {
        self::asegurarSemillaDemo();
        $q = DB::table('api_webhook_deliveries as d')
            ->join('api_webhook_endpoints as e', 'e.id', '=', 'd.endpoint_id')
            ->leftJoin('api_webhook_deliveries as rf', 'rf.id', '=', 'd.resent_from')
            ->leftJoin('api_webhook_deliveries as rt', 'rt.id', '=', 'd.resent_to');
        if (! empty($f['estado'])) {
            $q->where('d.status', $f['estado']);
        }
        if (! empty($f['destino'])) {
            $q->where('d.endpoint_id', $f['destino']);
        }
        if (! empty($f['evento'])) {
            $q->where('d.event_type', $f['evento']);
        }
        if (! empty($f['entorno'])) {
            $q->where('d.environment', $f['entorno']);
        }
        if (! empty($f['fecha'])) {
            $q->whereRaw("(d.created_at AT TIME ZONE 'America/Lima')::date = ?", [$f['fecha']]);
        }
        $t = trim((string) ($f['buscar'] ?? ''));
        if (mb_strlen($t) >= 2) {
            $p = '%'.addcslashes($t, '%_\\').'%';
            $q->where(fn ($w) => $w->where('d.number', 'ilike', $p)->orWhere('d.event_id', 'ilike', $p)->orWhere('d.event_type', 'ilike', $p)->orWhere('e.name', 'ilike', $p));
        }

        $baseCifras = DB::table('api_webhook_deliveries');
        if (! empty($f['destino'])) {
            $baseCifras->where('endpoint_id', $f['destino']);
        }
        $c = $baseCifras->selectRaw("count(*) as total,
            count(*) FILTER (WHERE status = 'PENDING') as pendientes,
            count(*) FILTER (WHERE status = 'RETRYING') as reintentando,
            count(*) FILTER (WHERE status = 'DELIVERED') as entregadas,
            count(*) FILTER (WHERE status = 'DEAD') as muertas,
            count(*) FILTER (WHERE status = 'DEAD' AND resent_to IS NULL) as muertas_sin_reenviar")->first();
        $kpis = self::indicadores();

        $q->orderByDesc('d.created_at')->orderByDesc('d.number');
        $q->select(['d.*', 'e.name as endpoint_name', 'e.url as endpoint_url', 'e.status as endpoint_status', 'rf.number as resent_from_number', 'rt.number as resent_to_number']);

        return Paginas::de($q, fn ($d) => self::presentarEntrega($d), $f) + [
            'cifras' => [
                'total' => (int) $c->total,
                'pendientes' => (int) $c->pendientes,
                'reintentando' => (int) $c->reintentando,
                'entregadas' => (int) $c->entregadas,
                'muertas' => (int) $c->muertas,
                'muertas_sin_reenviar' => (int) $c->muertas_sin_reenviar,
                'a_la_primera_pct' => $kpis['a_la_primera_pct'],
            ],
            'opciones' => [
                'destinos' => DB::table('api_webhook_endpoints')->orderBy('name')->get(['id', 'name'])->map(fn ($e) => ['value' => $e->id, 'label' => $e->name])->all(),
                'eventos' => DB::table('api_webhook_deliveries')->distinct()->orderBy('event_type')->pluck('event_type')->map(fn ($x) => ['value' => $x, 'label' => $x])->all(),
            ],
            'puede_gestionar' => Access::can($u, 'api.webhook.manage'),
            'puede_reenviar' => Access::can($u, 'api.webhook.resend') || Access::can($u, 'api.webhook.manage'),
        ];
    }

    public static function verEntrega(string $id, User $u): array
    {
        self::asegurarSemillaDemo();
        $q = DB::table('api_webhook_deliveries as d')
            ->join('api_webhook_endpoints as e', 'e.id', '=', 'd.endpoint_id')
            ->leftJoin('api_webhook_deliveries as rf', 'rf.id', '=', 'd.resent_from')
            ->leftJoin('api_webhook_deliveries as rt', 'rt.id', '=', 'd.resent_to')
            ->select(['d.*', 'e.name as endpoint_name', 'e.url as endpoint_url', 'e.status as endpoint_status', 'e.secret_enc', 'rf.number as resent_from_number', 'rt.number as resent_to_number']);

        $d = ($id !== 'primera' ? (clone $q)->where('d.id', $id)->first() : null)
            ?? (clone $q)->where('d.status', 'DEAD')->orderByDesc('d.created_at')->first()
            ?? (clone $q)->orderByDesc('d.created_at')->first()
            ?? abort(404);

        $intentos = DB::table('api_webhook_attempts')->where('delivery_id', $d->id)->orderBy('attempt_no')->get()->map(fn ($a) => [
            'id' => $a->id,
            'attempt_no' => (int) $a->attempt_no,
            'at' => $a->at,
            'http_status' => $a->http_status !== null ? (int) $a->http_status : null,
            'duration_ms' => (int) $a->duration_ms,
            'ok' => (bool) $a->ok,
            'resolved_ip' => $a->resolved_ip,
            'response_snippet' => $a->response_snippet,
            'error' => $a->error,
            'signature' => $a->signature,
            'secret_version' => (int) $a->secret_version,
            'wait_next_min' => $a->wait_next_min !== null ? (int) $a->wait_next_min : null,
        ])->all();

        $ultimaFirma = $d->signature ?: ($intentos ? $intentos[count($intentos) - 1]['signature'] : '');
        $horasEntre = null;
        if (count($intentos) > 1) {
            $horasEntre = round(Carbon::parse($intentos[0]['at'])->diffInMinutes(Carbon::parse($intentos[count($intentos) - 1]['at'])) / 60, 1);
        }
        $tEnvio = preg_match('/t=(\d+)/', (string) $ultimaFirma, $m) ? (int) $m[1] : now()->getTimestamp();
        $secreto = self::descifrar($d->secret_enc);

        return self::presentarEntrega($d) + [
            'cabeceras' => [
                'Content-Type' => 'application/json',
                'User-Agent' => 'GestionCarnica-Webhooks/1.0',
                'GestionCarnica-Event' => $d->event_type,
                'GestionCarnica-Event-Id' => $d->event_id,
                'GestionCarnica-Delivery' => $d->number,
                'GestionCarnica-Signature' => $ultimaFirma,
            ],
            'intentos' => $intentos,
            'horas_entre_intentos' => $horasEntre,
            'verificacion' => [
                'al_enviar' => self::verificarFirma((string) $ultimaFirma, $secreto, (string) $d->payload, $tEnvio + 30),
                'ahora' => self::verificarFirma((string) $ultimaFirma, $secreto, (string) $d->payload, now()->getTimestamp()),
            ],
            'puede_gestionar' => Access::can($u, 'api.webhook.manage'),
            'puede_reenviar' => Access::can($u, 'api.webhook.resend') || Access::can($u, 'api.webhook.manage'),
        ];
    }

    /* ------------------------------------------------------------------ Semilla de demostración */

    /** Si la empresa aún no tiene destinos sembrados (y tiene pedidos de demo), siembra los destinos y entregas de demostración. */
    public static function asegurarSemillaDemo(): void
    {
        if (app()->runningUnitTests() || DB::table('api_webhook_endpoints')->exists()) {
            return;
        }
        if (! DB::table('sales_orders')->exists()) {
            return;
        }
        try {
            $dg = DB::table('brands')->where('code', 'DG')->value('id');
            $m5 = DB::table('brands')->where('code', 'M5')->value('id');
            $cliente = DB::table('customers')->where('doc_type', 'RUC')->where('status', '<>', 'INACTIVE')->orderBy('created_at')->value('id');
            $admin = DB::table('users')->orderBy('created_at')->first();
            $u = $admin ? User::find($admin->id) : null;

            $eErp = self::guardarDestino(null, [
                'name' => 'ERP El Cuy Dorado · avisos de pedido',
                'url' => 'https://erp.elcuydorado.pe/hooks/gestioncarnica',
                'events' => ['order.confirmed', 'order.dispatched', 'order.delivered', 'order.not_delivered'],
                'brand_ids' => $dg ? [$dg] : [],
                'customer_id' => $cliente,
                'sim_mode' => 'OK',
                'description' => 'El ERP del restaurante registra la recepción de la mercadería',
            ], $u)['destino']['id'];

            $eBi = self::guardarDestino(null, [
                'name' => 'Contabilidad · comprobantes y cobros',
                'url' => 'https://bi.estudiorojas.pe/gestioncarnica/webhook',
                'events' => ['document.accepted', 'payment.confirmed'],
                'sim_mode' => 'OK',
            ], $u)['destino']['id'];

            $eM5 = self::guardarDestino(null, [
                'name' => 'Tienda Marca 5 Gourmet · stock',
                'url' => 'https://tienda.marca5gourmet.pe/wp-json/gestioncarnica/v1/webhook',
                'events' => ['stock.low', 'order.confirmed'],
                'brand_ids' => $m5 ? [$m5] : [],
                'sim_mode' => 'DOWN',
            ], $u)['destino']['id'];

            $eOld = self::guardarDestino(null, [
                'name' => 'ERP antiguo (servidor interno)',
                'url' => 'https://erp-legacy.donguando.pe/gestioncarnica/webhook',
                'events' => ['order.confirmed'],
                'brand_ids' => $dg ? [$dg] : [],
                'sim_mode' => 'OK',
            ], $u)['destino']['id'];

            $eSbx = self::guardarDestino(null, [
                'name' => 'Sandbox · webhook.site',
                'url' => 'https://webhook.site/7d1c2e9a-4b8f-4c55-9a51-3e0f1f6b2c11',
                'events' => ['order.created', 'document.accepted'],
                'environment' => 'TEST',
                'sim_mode' => 'OK',
            ], $u)['destino']['id'];

            // Entregas exitosas a ERP y Contabilidad
            $epErpObj = DB::table('api_webhook_endpoints')->where('id', $eErp)->first();
            $epBiObj = DB::table('api_webhook_endpoints')->where('id', $eBi)->first();
            $epM5Obj = DB::table('api_webhook_endpoints')->where('id', $eM5)->first();
            $epOldObj = DB::table('api_webhook_endpoints')->where('id', $eOld)->first();
            $epSbxObj = DB::table('api_webhook_endpoints')->where('id', $eSbx)->first();

            foreach (['order.confirmed', 'order.dispatched', 'order.delivered'] as $i => $ev) {
                $t = now()->subDays(3 - $i)->setTime(10 + $i, 15);
                $del = self::encolar($epErpObj, $ev, self::eventId($ev, "demo-erp-{$i}", $t->toIso8601String()), Catalogo::ejemplo($ev)['data'], $t);
                self::intentar($del->id, $t, true);
            }
            $tBi = now()->subDays(1)->setTime(21, 10);
            $delBi = self::encolar($epBiObj, 'document.accepted', self::eventId('document.accepted', 'demo-bi-1', $tBi->toIso8601String()), Catalogo::ejemplo('document.accepted')['data'], $tBi);
            self::intentar($delBi->id, $tBi, true);

            // Entrega reintentando en Tienda M5
            $tM5 = now()->subHours(2);
            $delM5 = self::encolar($epM5Obj, 'stock.low', self::eventId('stock.low', 'demo-m5-1', $tM5->toIso8601String()), Catalogo::ejemplo('stock.low')['data'], $tM5);
            self::intentar($delM5->id, $tM5, true);

            // ERP antiguo: resuelve a IP privada 10.20.0.15 (RN-API-05), agota los 8 intentos -> DEAD y desactiva por racha (RN-API-12)
            DB::table('api_webhook_endpoints')->where('id', $eOld)->update(['failure_streak' => 42]);
            $tOld = now()->subDays(5)->setTime(9, 0);
            $delOld = self::encolar($epOldObj, 'order.confirmed', self::eventId('order.confirmed', 'demo-legacy', $tOld->toIso8601String()), Catalogo::ejemplo('order.confirmed')['data'], $tOld);
            for ($k = 0; $k < 8; $k++) {
                $actual = DB::table('api_webhook_deliveries')->where('id', $delOld->id)->first();
                if (! $actual || ! in_array($actual->status, ['PENDING', 'RETRYING'], true)) {
                    break;
                }
                self::intentar($delOld->id, Carbon::parse($actual->next_attempt_at ?? $tOld), true);
            }

            // Entrega de sandbox
            $tSbx = now()->subHours(6);
            $delSbx = self::encolar($epSbxObj, 'order.created', self::eventId('order.created', 'demo-sbx-1', $tSbx->toIso8601String()), Catalogo::ejemplo('order.created')['data'], $tSbx);
            self::intentar($delSbx->id, $tSbx, true);
        } catch (\Throwable $e) {
            report($e);
        }
    }
}
