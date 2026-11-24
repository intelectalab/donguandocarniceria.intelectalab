<?php

namespace App\Modulos\Int\Services;

use App\Models\User;
use App\Support\Events;
use App\Support\Params;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * INT-01 Conectores e INT-02 Ficha del conector.
 *  - RN-INT-01: el adaptador falso nunca se activa en producción (además, la base lo impide).
 *  - RN-INT-14: con el módulo dueño apagado el conector no se activa ni se prueba.
 *  - RN-INT-19: tras int_connector_error_threshold (3) fallos seguidos pasa a «En error» y avisa con severidad crítica a
 *    la administración del sistema; la siguiente conexión correcta lo devuelve a «Activo».
 * La configuración del conector no es secreta; los secretos están en las credenciales (INT-03).
 */
final class Conectores
{
    public const ESTADOS = ['ACTIVE' => 'Activo', 'ERROR' => 'En error', 'DISABLED' => 'Desactivado', 'PENDING' => 'Por configurar'];

    public static function lista(): array
    {
        $creds = DB::table('integration_credentials')->where('status', 'ACTIVE')->selectRaw('connector_id, count(*) AS n')->groupBy('connector_id')->pluck('n', 'connector_id');
        $filas = self::consulta()->orderBy('c.kind')->orderBy('c.name')->get()->map(fn ($c) => self::presentar($c) + ['credenciales' => (int) ($creds[$c->id] ?? 0)])->all();

        return [
            'data' => $filas,
            'cifras' => [
                'activos' => count(array_filter($filas, fn ($c) => $c['status'] === 'ACTIVE')), 'total' => count($filas),
                'en_error' => count(array_filter($filas, fn ($c) => $c['status'] === 'ERROR')),
                'whatsapp' => count(array_filter($filas, fn ($c) => $c['provider'] === 'WHATSAPP_CLOUD' && $c['environment'] === 'PRODUCTION')),
                'prueba' => count(array_filter($filas, fn ($c) => $c['environment'] === 'SANDBOX')),
            ],
            'tipos' => collect(Adaptadores::TIPOS)->map(fn ($t, $k) => ['code' => $k, 'name' => $t[0]])->values(),
            'marcas' => DB::table('brands')->orderBy('sort_order')->get(['id', 'name']),
            'estados' => self::ESTADOS,
        ];
    }

    public static function ficha(string $id): array
    {
        $c = self::consulta()->where('c.id', $id)->first() ?? abort(response()->json(['message' => 'No encontrado.', 'code' => 'NOT_FOUND'], 404));
        $salientes = DB::table('outbox_messages')->where('connector_id', $id)->selectRaw('status, count(*) AS n')->groupBy('status')->pluck('n', 'status');

        return self::presentar($c) + [
            'config' => json_decode($c->config ?? '{}', true) ?: [],
            'errores' => array_reverse(json_decode($c->errors ?? '[]', true) ?: []),
            'credenciales' => DB::table('integration_credentials')->where('connector_id', $id)->where('status', 'ACTIVE')->orderBy('name')
                ->get()->map(fn ($k) => Credenciales::presentar($k))->all(),
            'webhooks' => DB::table('webhook_endpoints')->where('connector_id', $id)->orderBy('name')->get(['id', 'name', 'url', 'status']),
            'actividad' => [
                'enviados' => (int) ($salientes['SENT'] ?? 0), 'reintentando' => (int) ($salientes['RETRYING'] ?? 0), 'cola_muerta' => (int) ($salientes['DEAD'] ?? 0),
                'webhooks' => DB::table('webhook_events')->where('connector_id', $id)->count(),
                'corridas' => DB::table('integration_runs')->where('connector_id', $id)->count(),
            ],
            'umbral_errores' => self::umbral(),
        ];
    }

    /** «Probar conexión». */
    public static function probar(string $id, User $quien): array
    {
        $c = self::fila($id);
        if ($c->status === 'DISABLED') {
            RuleError::fail('RN-INT-14', self::moduloEncendido($c->owner_module)
                ? "{$c->name} está desactivado: actívalo antes de probarlo."
                : "{$c->name} está desactivado porque su módulo está apagado.");
        }
        $r = Adaptadores::probar($c);
        if ($r['ok'] !== null) {
            self::reportar($c->id, $r['ok'], $r['error'], $r['latencia']);
        }
        Events::emit('connector.tested', 'integration_connectors', $c->id, ['by' => $quien->id, 'ok' => $r['ok']]);

        return ['resultado' => $r, 'conector' => self::ficha($c->id)];
    }

    /**
     * RN-INT-19: resultado de una llamada al proveedor (la usan «Probar conexión» y, más adelante, el despacho de
     * mensajes y los webhooks).
     */
    public static function reportar(string $id, bool $ok, ?string $error = null, ?int $latencia = null): void
    {
        $c = self::fila($id);
        if ($ok) {
            DB::table('integration_connectors')->where('id', $id)->update(['consecutive_failures' => 0, 'last_ok_at' => now(),
                'status' => $c->status === 'ERROR' ? 'ACTIVE' : $c->status, 'latency_ms' => $latencia ?? $c->latency_ms, 'updated_at' => now()]);
            if ($c->status === 'ERROR') {
                Events::emit('connector.recovered', 'integration_connectors', $id, []);
                self::avisar($c, 'info', 'INFO', "{$c->name} volvió a conectar", 'La conexión respondió correctamente y el conector pasó a Activo.');
            }

            return;
        }
        $fallos = (int) $c->consecutive_failures + 1;
        $errores = array_slice([...(json_decode($c->errors ?? '[]', true) ?: []), ['at' => now()->toIso8601String(), 'msg' => $error ?: 'Error del proveedor']], -30);
        $aError = $fallos >= self::umbral() && $c->status === 'ACTIVE';
        DB::table('integration_connectors')->where('id', $id)->update(['consecutive_failures' => $fallos, 'last_error_at' => now(),
            'last_error' => mb_substr($error ?: 'Error del proveedor', 0, 255), 'errors' => json_encode($errores, JSON_UNESCAPED_UNICODE),
            'status' => $aError ? 'ERROR' : $c->status, 'updated_at' => now()]);
        if ($aError) {
            Events::emit('connector.failed', 'integration_connectors', $id, ['failures' => $fallos]);
            self::avisar($c, 'bad', 'CRITICAL', "{$c->name} en error", "{$fallos} fallos seguidos: ".($error ?: 'error del proveedor').'. Revisa la conexión.');
        }
    }

    /** Activar o desactivar con motivo. */
    public static function cambiarEstado(string $id, bool $activar, string $motivo, User $quien): array
    {
        $c = self::fila($id);
        if (mb_strlen(trim($motivo)) < 10) {
            RuleError::fail('RN-INT-10', 'El motivo tiene al menos 10 caracteres.');
        }
        if ($activar) {
            if (! self::moduloEncendido($c->owner_module)) {
                RuleError::fail('RN-INT-14', 'Su módulo está apagado: enciéndelo antes en Módulos activables.');
            }
            if ($c->environment === 'PRODUCTION' && $c->adapter === 'FAKE') {
                RuleError::fail('RN-INT-01', 'El adaptador falso no se activa en producción.');
            }
        }
        if ($activar === ($c->status !== 'DISABLED')) {
            RuleError::fail('RN-INT-10', $activar ? 'El conector ya está activo.' : 'El conector ya está desactivado.');
        }
        DB::table('integration_connectors')->where('id', $id)->update(['status' => $activar ? 'ACTIVE' : 'DISABLED', 'consecutive_failures' => 0,
            'status_reason' => trim($motivo), 'updated_at' => now()]);
        Events::emit($activar ? 'connector.enabled' : 'connector.disabled', 'integration_connectors', $id, ['by' => $quien->id, 'reason' => trim($motivo)]);

        return self::ficha($id);
    }

    /** Solo en el entorno de prueba: hace que el adaptador falso no responda, para ver los reintentos y el paso a «En error». */
    public static function simularCaida(string $id, bool $caido, User $quien): array
    {
        $c = self::fila($id);
        if ($c->environment !== 'SANDBOX') {
            RuleError::fail('RN-INT-01', 'La caída solo se simula en los conectores del entorno de prueba.');
        }
        DB::table('integration_connectors')->where('id', $id)->update(['simulate_down' => $caido, 'updated_at' => now()]);
        Events::emit('connector.simulate_down', 'integration_connectors', $id, ['by' => $quien->id, 'down' => $caido]);

        return self::ficha($id);
    }

    public static function moduloEncendido(?string $modulo): bool
    {
        if (! $modulo) {
            return true;
        }
        $m = DB::table('tenant_modules')->where('module_code', $modulo)->value('enabled');

        return $m === null || (bool) $m;
    }

    public static function fila(string $id): object
    {
        return DB::table('integration_connectors')->where('id', $id)->first() ?? abort(response()->json(['message' => 'No encontrado.', 'code' => 'NOT_FOUND'], 404));
    }

    private static function consulta()
    {
        return DB::table('integration_connectors as c')->leftJoin('brands as b', 'b.id', '=', 'c.brand_id')->leftJoin('establishments as e', 'e.id', '=', 'c.establishment_id')
            ->select('c.*', 'b.name as brand_name', 'e.name as establishment_name');
    }

    private static function presentar(object $c): array
    {
        return [
            'id' => $c->id, 'code' => $c->code, 'name' => $c->name, 'kind' => $c->kind, 'kind_name' => Adaptadores::nombreTipo($c->kind),
            'provider' => $c->provider, 'adapter_name' => Adaptadores::nombreAdaptador($c), 'fake' => $c->adapter === 'FAKE', 'environment' => $c->environment,
            'owner_module' => $c->owner_module, 'module_on' => self::moduloEncendido($c->owner_module),
            'brand_id' => $c->brand_id, 'brand_name' => $c->brand_name ?? null, 'establishment_id' => $c->establishment_id, 'establishment_name' => $c->establishment_name ?? null,
            'status' => $c->status, 'status_name' => self::ESTADOS[$c->status] ?? $c->status, 'status_reason' => $c->status_reason ?? null,
            'consecutive_failures' => (int) $c->consecutive_failures, 'last_ok_at' => $c->last_ok_at, 'last_error_at' => $c->last_error_at, 'last_error' => $c->last_error,
            'latency_ms' => $c->latency_ms !== null ? (float) $c->latency_ms : null, 'simulate_down' => (bool) $c->simulate_down,
        ];
    }

    private static function umbral(): int
    {
        return max(1, (int) (Params::get('int_connector_error_threshold') ?? 3));
    }

    /** Aviso a la administración del sistema (rol), con enlace a la ficha del conector. */
    private static function avisar(object $c, string $tono, string $severidad, string $titulo, string $texto): void
    {
        DB::table('notifications')->insert(['role' => 'ADMIN_SISTEMA', 'module' => 'INT', 'tone' => $tono, 'severity' => $severidad, 'type' => 'INTEGRATIONS',
            'at' => now(), 'title' => mb_substr($titulo, 0, 255), 'body' => $texto, 'ref' => json_encode(['href' => "/m/int/int-02?id={$c->id}"])]);
    }
}
