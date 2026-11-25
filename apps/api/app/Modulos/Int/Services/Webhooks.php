<?php

namespace App\Modulos\Int\Services;

use App\Models\User;
use App\Support\Events;
use App\Support\Paginas;
use App\Support\Params;
use App\Support\RuleError;
use App\Support\TenantContext;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * INT-04 Webhooks de entrada e INT-05 Bitácora de webhooks.
 *  - RN-INT-04: cada proveedor tiene su URL (/api/hooks/{token}) y su secreto de firma. Sin firma válida se responde
 *    401, se guarda como rechazado y no se procesa.
 *  - RN-INT-05: el mismo evento (misma clave en el mismo endpoint) se procesa una sola vez; los repetidos suman al
 *    contador y responden 200 para que el proveedor no insista.
 *  - RN-INT-06: el cuerpo y las cabeceras se guardan tal cual llegaron (sin las de sesión) y no se modifican.
 *  - RN-INT-07: el procesamiento se reintenta hasta int_webhook_max_attempts (5) y queda fallido; un fallido solo se
 *    reprocesa a mano, con int.webhook.reprocess.
 *  - RN-INT-14: con el módulo dueño apagado (o el conector desactivado), el evento se guarda como ignorado y no se procesa.
 *
 * Los procesadores (qué hacer con un pago de Mercado Pago, un pedido de WooCommerce, un mensaje de WhatsApp) los
 * instala cada módulo dueño cuando se construye (WEB, CRM, FAC, DEL, TEL): registra en $procesadores una función
 * fn (array $cuerpo, object $conector, object $evento): string que devuelve el resultado o lanza una excepción si falla.
 * Mientras no está, el evento queda «Recibido», guardado para cuando llegue su procesador, y no cuenta como falla.
 */
final class Webhooks
{
    public const ESTADOS = ['RECEIVED' => 'Recibido', 'PROCESSED' => 'Procesado', 'FAILED' => 'Fallido', 'REJECTED' => 'Rechazado', 'IGNORED' => 'Ignorado'];

    /** Tamaño máximo del cuerpo aceptado (bytes). */
    public const MAX_CUERPO = 262144;

    /** Cabeceras donde los proveedores mandan la firma. */
    private const CABECERAS_FIRMA = ['x-signature', 'x-hub-signature-256', 'x-hub-signature', 'x-wc-webhook-signature', 'tiktok-signature', 'x-twilio-signature'];

    /** Cabeceras que no se guardan nunca (sesión o credenciales). */
    private const CABECERAS_FUERA = ['authorization', 'cookie', 'proxy-authorization', 'x-api-key', 'php-auth-pw'];

    /** @var array<string, callable(array, object, object): string> proveedor => procesador */
    public static array $procesadores = [];

    /**
     * Recibe un webhook en la URL pública. Devuelve [código HTTP, cuerpo de la respuesta]. Nunca deja ver si el token
     * existe en otra empresa: un token desconocido o desactivado responde 404 igual.
     */
    public static function recibir(string $token, string $crudo, array $cabeceras, ?string $ip, float $inicio): array
    {
        $empresa = DB::selectOne('SELECT int_webhook_tenant(?) AS t', [$token])?->t;
        if (! $empresa) {
            return [404, ['status' => 'NOT_FOUND']];
        }
        TenantContext::set(TenantContext::find($empresa));
        $ep = DB::table('webhook_endpoints')->where(fn ($w) => $w->where('token', $token)
            ->orWhere(fn ($x) => $x->where('previous_token', $token)->where('previous_token_valid_until', '>', now())))->first();
        if (! $ep || $ep->status !== 'ACTIVE') {
            return [404, ['status' => 'NOT_FOUND']];
        }
        $c = Conectores::fila($ep->connector_id);
        $guardadas = self::cabecerasGuardadas($cabeceras, $ip);
        $base = ['endpoint_id' => $ep->id, 'connector_id' => $c->id, 'owner_module' => $ep->owner_module, 'event_key' => self::clave($crudo, $cabeceras),
            'headers' => json_encode($guardadas, JSON_UNESCAPED_UNICODE), 'body' => $crudo, 'signature' => self::firmaRecibida($cabeceras),
            'received_at' => now(), 'duplicates' => 0, 'attempts' => 0, 'created_at' => now(), 'updated_at' => now()];
        $ms = fn () => max(1, (int) round((microtime(true) - $inicio) * 1000));

        // RN-INT-04: firma
        if (! self::firmaValida($ep, $crudo, $cabeceras)) {
            $sinSecreto = ! str_starts_with((string) $ep->secret_enc, 'enc:v2:');
            DB::table('webhook_events')->insert($base + ['status' => 'REJECTED', 'http_status' => 401, 'ack_ms' => $ms(), 'signature_ok' => false,
                'last_error' => $sinSecreto ? 'El endpoint no tiene secreto de firma cargado: no se procesa.' : 'Firma ausente o inválida: no se procesa.']);
            self::avisarRechazo($ep, $ip);

            return [401, ['status' => 'REJECTED']];
        }

        // RN-INT-05: repetido
        if ($dup = self::repetido($ep->id, $base['event_key'])) {
            return [200, ['status' => $dup, 'duplicate' => true]];
        }

        // RN-INT-14: módulo dueño apagado o conector desactivado
        $apagado = ! Conectores::moduloEncendido($ep->owner_module);
        $estado = $apagado || $c->status === 'DISABLED' ? 'IGNORED' : 'RECEIVED';
        try {
            $id = DB::table('webhook_events')->insertGetId($base + ['status' => $estado, 'http_status' => 200, 'ack_ms' => $ms(), 'signature_ok' => true,
                'last_error' => $estado === 'IGNORED' ? ($apagado ? 'El módulo '.self::nombreModulo($ep->owner_module).' está apagado: se guarda y no se procesa.' : 'El conector está desactivado: se guarda y no se procesa.') : null], 'id');
        } catch (UniqueConstraintViolationException) {
            // Llegó el mismo evento dos veces a la vez: el otro ya lo guardó.
            return [200, ['status' => self::repetido($ep->id, $base['event_key']) ?? 'RECEIVED', 'duplicate' => true]];
        }
        if ($estado === 'IGNORED') {
            return [200, ['status' => 'IGNORED']];
        }
        DB::table('webhook_endpoints')->where('id', $ep->id)->update(['received_count' => DB::raw('received_count + 1'), 'last_received_at' => now(), 'updated_at' => now()]);
        Events::emit('webhook.received', 'webhook_events', $id, ['connector' => $c->code, 'module' => $ep->owner_module]);

        return [200, ['status' => self::procesar($id)->status]];
    }

    /** Procesa un evento recibido con el procesador de su proveedor (RN-INT-07). Con $una, un solo intento (reproceso). */
    public static function procesar(string $id, bool $una = false): object
    {
        $ev = DB::table('webhook_events')->where('id', $id)->first();
        $c = Conectores::fila($ev->connector_id);
        $procesador = self::$procesadores[$c->provider] ?? null;
        if (! $procesador) {
            DB::table('webhook_events')->where('id', $id)->update(['result' => mb_substr('Guardado para '.self::nombreModulo($ev->owner_module).': se procesará cuando el módulo instale su procesador.', 0, 255), 'updated_at' => now()]);

            return DB::table('webhook_events')->where('id', $id)->first();
        }
        $max = self::maxIntentos();
        $intentos = (int) $ev->attempts;
        $cuerpo = json_decode((string) $ev->body, true) ?? [];
        do {
            $intentos++;
            try {
                $resultado = (string) $procesador($cuerpo, $c, $ev);
                DB::table('webhook_events')->where('id', $id)->update(['status' => 'PROCESSED', 'attempts' => $intentos, 'processed_at' => now(),
                    'result' => mb_substr($resultado, 0, 255), 'last_error' => null, 'failed_at' => null, 'updated_at' => now()]);

                return DB::table('webhook_events')->where('id', $id)->first();
            } catch (\Throwable $e) {
                $error = mb_substr($e->getMessage() ?: 'Error al procesar', 0, 255);
            }
        } while (! $una && $intentos < $max);
        DB::table('webhook_events')->where('id', $id)->update(['status' => $intentos >= $max || $una ? 'FAILED' : 'RECEIVED', 'attempts' => $intentos,
            'last_error' => $error, 'failed_at' => now(), 'updated_at' => now()]);

        return DB::table('webhook_events')->where('id', $id)->first();
    }

    /** RN-INT-07: reproceso a mano de un webhook fallido (un intento). */
    public static function reprocesar(string $id, User $quien): array
    {
        $ev = DB::table('webhook_events')->where('id', $id)->first() ?? abort(response()->json(['message' => 'No encontrado.', 'code' => 'NOT_FOUND'], 404));
        if ($ev->status !== 'FAILED') {
            RuleError::fail('RN-INT-07', 'Solo se reprocesa un webhook fallido.');
        }
        if (! Conectores::moduloEncendido($ev->owner_module)) {
            RuleError::fail('RN-INT-14', 'El módulo '.self::nombreModulo($ev->owner_module).' está apagado: enciéndelo antes de reprocesar.');
        }
        $c = Conectores::fila($ev->connector_id);
        if (! isset(self::$procesadores[$c->provider])) {
            RuleError::fail('RN-INT-07', 'El procesador de '.self::nombreModulo($ev->owner_module).' todavía no está instalado: el webhook se reprocesará cuando lo esté.');
        }
        Events::emit('webhook.reprocessed', 'webhook_events', $id, ['by' => $quien->id, 'key' => $ev->event_key]);
        self::procesar($id, true);

        return self::ver($id);
    }

    /** Token nuevo: la URL anterior sigue valiendo 24 horas para cambiarla en el panel del proveedor. */
    public static function regenerarToken(string $id, User $quien): array
    {
        $ep = self::endpoint($id);
        $token = Str::random(32);
        DB::table('webhook_endpoints')->where('id', $id)->update(['token' => $token, 'url' => self::url($token), 'previous_token' => $ep->token,
            'previous_token_valid_until' => now()->addDay(), 'token_rotated_at' => now(), 'updated_at' => now()]);
        Events::emit('webhook_endpoint.token_rotated', 'webhook_endpoints', $id, ['by' => $quien->id, 'name' => $ep->name]);

        return self::presentarEndpoint(self::endpoint($id));
    }

    /** El secreto de firma que da el proveedor, cifrado con la clave de la aplicación; nunca vuelve a mostrarse. */
    public static function cargarSecreto(string $id, string $secreto, User $quien): array
    {
        $ep = self::endpoint($id);
        if (mb_strlen($secreto) < 8) {
            RuleError::fail('RN-INT-02', 'El secreto tiene al menos 8 caracteres.');
        }
        DB::table('webhook_endpoints')->where('id', $id)->update(['secret_enc' => 'enc:v2:'.Crypt::encryptString($secreto), 'secret_loaded_at' => now(), 'updated_at' => now()]);
        Events::emit('webhook_endpoint.secret_loaded', 'webhook_endpoints', $id, ['by' => $quien->id, 'name' => $ep->name, 'value' => '••••'.mb_substr($secreto, -4)]);

        return self::presentarEndpoint(self::endpoint($id));
    }

    public static function endpoints(): array
    {
        $eventos = DB::table('webhook_events')->selectRaw('endpoint_id, count(*) AS n')->groupBy('endpoint_id')->pluck('n', 'endpoint_id');
        $filas = DB::table('webhook_endpoints as e')->join('integration_connectors as c', 'c.id', '=', 'e.connector_id')
            ->select('e.*', 'c.name as connector_name', 'c.environment', 'c.status as connector_status')->orderBy('e.name')->get();

        return ['data' => $filas->map(fn ($e) => self::presentarEndpoint($e) + ['eventos' => (int) ($eventos[$e->id] ?? 0)])->values(),
            'modulos' => $filas->pluck('owner_module')->unique()->sort()->values()];
    }

    public static function eventos(array $f): array
    {
        $q = DB::table('webhook_events as w')->leftJoin('integration_connectors as c', 'c.id', '=', 'w.connector_id')
            ->leftJoin('webhook_endpoints as e', 'e.id', '=', 'w.endpoint_id')
            ->select('w.id', 'w.received_at', 'w.connector_id', 'c.name as connector_name', 'e.name as endpoint_name', 'w.event_key', 'w.owner_module', 'w.duplicates',
                'w.attempts', 'w.processed_at', 'w.status', 'w.last_error', 'w.result', 'w.http_status')
            ->selectRaw('extract(epoch FROM (w.processed_at - w.received_at)) AS segundos');
        foreach (['status' => 'w.status', 'connector' => 'w.connector_id', 'endpoint' => 'w.endpoint_id'] as $k => $col) {
            if (! empty($f[$k])) {
                $q->where($col, $f[$k]);
            }
        }
        if (! empty($f['dia'])) {
            $q->whereRaw("(w.received_at AT TIME ZONE 'America/Lima')::date = ?", [$f['dia']]);
        }
        if (! empty($f['buscar'])) {
            $t = '%'.addcslashes(trim($f['buscar']), '%_\\').'%';
            $q->where(fn ($w) => $w->where('w.body', 'ilike', $t)->orWhere('w.event_key', 'ilike', $t));
        }
        $q->orderByDesc('w.received_at')->orderBy('w.id');
        Paginas::ordenar($q, ['received_at' => 'w.received_at', 'connector' => 'c.name', 'event_key' => 'w.event_key', 'module' => 'w.owner_module',
            'duplicates' => 'w.duplicates', 'attempts' => 'w.attempts', 'segundos' => 'segundos', 'status' => 'w.status', 'last_error' => 'w.last_error'], 'w.id', $f);

        return Paginas::de($q, fn ($w) => self::presentarEvento($w), $f) + [
            'cifras' => self::cifras(), 'max_intentos' => self::maxIntentos(), 'ack_segundos' => (int) (Params::get('int_webhook_ack_seconds') ?? 5),
            'conectores' => DB::table('integration_connectors as c')->whereExists(fn ($w) => $w->from('webhook_events as x')->whereColumn('x.connector_id', 'c.id'))->orderBy('c.name')->get(['c.id', 'c.name']),
            'estados' => self::ESTADOS,
        ];
    }

    public static function ver(string $id): array
    {
        $w = DB::table('webhook_events as w')->leftJoin('integration_connectors as c', 'c.id', '=', 'w.connector_id')->leftJoin('webhook_endpoints as e', 'e.id', '=', 'w.endpoint_id')
            ->where('w.id', $id)->select('w.*', 'c.name as connector_name', 'c.provider', 'e.name as endpoint_name')
            ->selectRaw('extract(epoch FROM (w.processed_at - w.received_at)) AS segundos')->first()
            ?? abort(response()->json(['message' => 'No encontrado.', 'code' => 'NOT_FOUND'], 404));

        return self::presentarEvento($w) + [
            'headers' => json_decode($w->headers ?? '{}', true) ?: [], 'body' => $w->body, 'ack_ms' => $w->ack_ms, 'failed_at' => $w->failed_at,
            'last_duplicate_at' => $w->last_duplicate_at, 'endpoint_name' => $w->endpoint_name, 'max_intentos' => self::maxIntentos(),
            'ack_segundos' => (int) (Params::get('int_webhook_ack_seconds') ?? 5), 'procesador' => isset(self::$procesadores[$w->provider ?? '']),
        ];
    }

    public static function url(string $token): string
    {
        return rtrim((string) config('app.url'), '/').'/api/hooks/'.$token;
    }

    public static function nombreModulo(?string $code): string
    {
        if (! $code) {
            return 'la empresa';
        }
        // El nombre del catálogo es la descripción («Delivery: rutas, app del repartidor…»): basta lo de antes de los dos puntos.
        $nombre = (string) (DB::table('platform_modules')->where('code', $code)->value('name') ?? $code);

        return trim(explode(':', $nombre)[0]);
    }

    /**
     * KPI-INT-03 (repetidos), KPI-INT-04 (latencia p95 de proceso) y los recibidos en el mes. Se miden hasta el último
     * evento recibido: en operación es hoy, y en una empresa sin movimiento reciente sigue mostrando su último mes.
     */
    public static function cifras(): array
    {
        $r = DB::selectOne(<<<'SQL'
            WITH u AS (SELECT coalesce(max(received_at) FILTER (WHERE status <> 'REJECTED'), max(received_at)) AS hasta FROM webhook_events)
            SELECT u.hasta,
                   count(*) FILTER (WHERE w.received_at >= date_trunc('month', u.hasta AT TIME ZONE 'America/Lima') AT TIME ZONE 'America/Lima') AS mes,
                   count(*) FILTER (WHERE w.status <> 'REJECTED' AND w.received_at >= u.hasta - interval '30 days') AS unicos_30,
                   coalesce(sum(w.duplicates) FILTER (WHERE w.status <> 'REJECTED' AND w.received_at >= u.hasta - interval '30 days'), 0) AS repetidos_30,
                   percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM (w.processed_at - w.received_at)))
                       FILTER (WHERE w.processed_at IS NOT NULL AND w.received_at >= u.hasta - interval '30 days') AS p95,
                   count(*) FILTER (WHERE w.status = 'FAILED') AS fallidos,
                   count(*) FILTER (WHERE w.status = 'REJECTED') AS rechazados,
                   count(*) FILTER (WHERE w.status = 'RECEIVED') AS en_espera
            FROM webhook_events w, u GROUP BY u.hasta
            SQL);
        if (! $r) {
            return ['mes' => 0, 'duplicados' => null, 'repetidos' => 0, 'p95' => null, 'fallidos' => 0, 'rechazados' => 0, 'en_espera' => 0, 'hasta' => null];
        }
        $total = (int) $r->unicos_30 + (int) $r->repetidos_30;

        return ['mes' => (int) $r->mes, 'duplicados' => $total ? round((int) $r->repetidos_30 / $total * 100, 2) : null, 'repetidos' => (int) $r->repetidos_30,
            'p95' => $r->p95 === null ? null : round((float) $r->p95, 1), 'fallidos' => (int) $r->fallidos, 'rechazados' => (int) $r->rechazados,
            'en_espera' => (int) $r->en_espera, 'hasta' => $r->hasta];
    }

    private static function presentarEndpoint(object $e): array
    {
        $c = isset($e->connector_name) ? $e : DB::table('integration_connectors')->where('id', $e->connector_id)->first(['name as connector_name', 'environment', 'status as connector_status']);

        return [
            'id' => $e->id, 'name' => $e->name, 'url' => self::url($e->token), 'signature_scheme' => $e->signature_scheme, 'owner_module' => $e->owner_module,
            'module_name' => self::nombreModulo($e->owner_module), 'module_on' => Conectores::moduloEncendido($e->owner_module), 'connector_id' => $e->connector_id,
            'connector_name' => $c->connector_name, 'environment' => $c->environment, 'connector_status' => $c->connector_status, 'status' => $e->status,
            'status_name' => $e->status === 'ACTIVE' ? 'Activo' : 'Desactivado', 'received_count' => (int) $e->received_count, 'last_received_at' => $e->last_received_at,
            'con_secreto' => str_starts_with((string) $e->secret_enc, 'enc:v2:'), 'secret_loaded_at' => $e->secret_loaded_at, 'token_rotated_at' => $e->token_rotated_at,
            'anterior_vale_hasta' => $e->previous_token && $e->previous_token_valid_until && now()->lt($e->previous_token_valid_until) ? $e->previous_token_valid_until : null,
        ];
    }

    private static function presentarEvento(object $w): array
    {
        return [
            'id' => $w->id, 'received_at' => $w->received_at, 'connector_id' => $w->connector_id, 'connector_name' => $w->connector_name, 'endpoint_name' => $w->endpoint_name ?? null,
            'event_key' => $w->event_key, 'owner_module' => $w->owner_module, 'module_name' => self::nombreModulo($w->owner_module), 'duplicates' => (int) $w->duplicates,
            'attempts' => (int) $w->attempts, 'processed_at' => $w->processed_at, 'segundos' => $w->segundos === null ? null : round((float) $w->segundos, 1),
            'status' => $w->status, 'status_name' => self::ESTADOS[$w->status] ?? $w->status, 'http_status' => $w->http_status,
            // Los datos de demostración traen el código de la regla delante del error: en pantalla va solo el texto.
            'last_error' => $w->last_error ? Str::ucfirst(preg_replace('/^RN-[A-Z]+-\d+:\s*/', '', $w->last_error)) : null, 'result' => $w->result,
        ];
    }

    private static function endpoint(string $id): object
    {
        return DB::table('webhook_endpoints')->where('id', $id)->first() ?? abort(response()->json(['message' => 'No encontrado.', 'code' => 'NOT_FOUND'], 404));
    }

    /** Si ya llegó (y no fue rechazado), suma el repetido y devuelve su estado. */
    private static function repetido(string $endpoint, string $clave): ?string
    {
        $dup = DB::table('webhook_events')->where('endpoint_id', $endpoint)->where('event_key', $clave)->where('status', '<>', 'REJECTED')->first(['id', 'status']);
        if (! $dup) {
            return null;
        }
        DB::table('webhook_events')->where('id', $dup->id)->update(['duplicates' => DB::raw('duplicates + 1'), 'last_duplicate_at' => now(), 'updated_at' => now()]);

        return $dup->status;
    }

    /** Clave del evento: el id que manda el proveedor (cabecera o cuerpo); si no trae, la huella del cuerpo. */
    private static function clave(string $crudo, array $cabeceras): string
    {
        $h = array_change_key_case($cabeceras);
        foreach (['x-event-id', 'x-wc-webhook-delivery-id', 'x-request-id-provider'] as $k) {
            if (! empty($h[$k][0])) {
                return mb_substr((string) $h[$k][0], 0, 80);
            }
        }
        $b = json_decode($crudo, true);
        $id = is_array($b) ? ($b['id'] ?? ($b['entry'][0]['id'] ?? null)) : null;

        return is_scalar($id) && (string) $id !== '' ? mb_substr((string) $id, 0, 80) : hash('sha256', $crudo);
    }

    private static function firmaRecibida(array $cabeceras): ?string
    {
        $h = array_change_key_case($cabeceras);
        foreach (self::CABECERAS_FIRMA as $k) {
            if (! empty($h[$k][0])) {
                return mb_substr((string) $h[$k][0], 0, 255);
            }
        }

        return null;
    }

    /** HMAC del cuerpo con el secreto del endpoint, en las formas que usan los proveedores (hex o base64, SHA-256 o SHA-1). */
    private static function firmaValida(object $ep, string $crudo, array $cabeceras): bool
    {
        $firma = self::firmaRecibida($cabeceras);
        if (! $firma || ! str_starts_with((string) $ep->secret_enc, 'enc:v2:')) {
            return false;
        }
        try {
            $secreto = Crypt::decryptString(substr($ep->secret_enc, 7));
        } catch (\Throwable) {
            return false;
        }
        $s256 = hash_hmac('sha256', $crudo, $secreto, true);
        $s1 = hash_hmac('sha1', $crudo, $secreto, true);
        foreach (['sha256='.bin2hex($s256), bin2hex($s256), base64_encode($s256), 'sha1='.bin2hex($s1), base64_encode($s1)] as $esperada) {
            if (hash_equals($esperada, trim($firma))) {
                return true;
            }
        }

        return false;
    }

    private static function cabecerasGuardadas(array $cabeceras, ?string $ip): array
    {
        $out = [];
        foreach ($cabeceras as $k => $v) {
            $k = strtolower((string) $k);
            if (! in_array($k, self::CABECERAS_FUERA, true) && count($out) < 40) {
                $out[$k] = mb_substr(implode(', ', (array) $v), 0, 500);
            }
        }

        return $out + ($ip ? ['x-forwarded-for' => $ip] : []);
    }

    /** Aviso de seguridad a la administración del sistema; uno por endpoint y hora, para no inundar con cada intento. */
    private static function avisarRechazo(object $ep, ?string $ip): void
    {
        $titulo = 'Webhook rechazado por firma inválida';
        $ya = DB::table('notifications')->where('module', 'INT')->where('title', $titulo)->where('at', '>=', now()->subHour())
            ->whereRaw("ref->>'endpoint' = ?", [$ep->id])->exists();
        if (! $ya) {
            DB::table('notifications')->insert(['role' => 'ADMIN_SISTEMA', 'module' => 'INT', 'tone' => 'warn', 'severity' => 'WARNING', 'type' => 'SECURITY', 'at' => now(),
                'title' => $titulo, 'body' => "Un intento contra el endpoint {$ep->name}".($ip ? " desde {$ip}" : '').' fue rechazado y no se procesó.',
                'ref' => json_encode(['href' => '/m/int/int-05?status=REJECTED', 'endpoint' => $ep->id])]);
        }
    }

    private static function maxIntentos(): int
    {
        return max(1, (int) (Params::get('int_webhook_max_attempts') ?? 5));
    }
}
