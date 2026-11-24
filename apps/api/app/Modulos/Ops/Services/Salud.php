<?php

namespace App\Modulos\Ops\Services;

use App\Support\RuleError;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Throwable;

/**
 * OPS-07 Salud de componentes (D-OPS-01: lecturas propias cada minuto).
 *  - Se miden de verdad la aplicación, la base de datos, las colas y el almacenamiento. Los servicios externos (OSE,
 *    WhatsApp, pasarelas…) todavía no tienen adaptador: quedan «sin lectura» hasta que ingeniería registre una a mano
 *    o se conecte su adaptador. No se inventa un verde.
 *  - Las lecturas son de solo inserción (RN-OPS-05). Disponibilidad (KPI-OPS-12) = lecturas UP / lecturas con estado,
 *    contando DEGRADED como media.
 *  - CA-OPS-07: un componente que pasa a caído abre solo un incidente SEV2 (si no hay uno abierto para él).
 */
final class Salud
{
    public const ESTADOS = ['UP' => 'Operativo', 'DEGRADED' => 'Degradado', 'DOWN' => 'Caído', 'UNKNOWN' => 'Sin lectura'];

    /** Componentes con sonda propia. */
    public const CON_SONDA = ['APP', 'DB', 'QUEUE', 'STORAGE'];

    /** Tarea de cada minuto (contexto de plataforma). Devuelve cuántas lecturas registró. */
    public static function leer(): int
    {
        $n = 0;
        foreach (self::CON_SONDA as $codigo) {
            self::registrar($codigo, self::sondear($codigo), 'AUTO');
            $n++;
        }

        return $n;
    }

    /** Lectura a mano de ingeniería (p. ej. el proveedor del OSE avisa una caída). */
    public static function registrarManual(array $quien, string $codigo, array $d): array
    {
        Consola::exigir($quien, 'health.record');
        if (! DB::table('platform_components')->where('code', $codigo)->exists()) {
            abort(response()->json(['message' => 'No encontrado.', 'code' => 'NOT_FOUND'], 404));
        }
        self::registrar($codigo, $d, 'MANUAL', $quien['id']);
        Consola::bitacora('HEALTH_RECORDED', $quien, ['entity' => 'platform_components', 'entity_id' => $codigo,
            'reason' => trim($d['detail'] ?? '') ?: 'Lectura registrada a mano', 'detail' => ['estado' => $d['status']]]);

        return self::componente($codigo);
    }

    public static function tablero(): array
    {
        $disp = fn (string $desde) => collect(DB::select(<<<'SQL'
            SELECT component_code, round(100.0 * sum(CASE status WHEN 'UP' THEN 1 WHEN 'DEGRADED' THEN 0.5 ELSE 0 END) / count(*), 2) AS pct
            FROM platform_health_readings WHERE status <> 'UNKNOWN' AND read_at >= ? GROUP BY component_code
            SQL, [$desde]))->pluck('pct', 'component_code');
        $dia = $disp(now()->subDay());
        $semana = $disp(now()->subDays(7));
        $abiertos = DB::table('platform_incidents')->where('status', '!=', 'RESOLVED')->whereNotNull('component_code')
            ->get(['component_code', 'number', 'severity', 'id'])->groupBy('component_code');

        $filas = DB::table('platform_components')->orderBy('sort')->get()->map(fn ($c) => self::presentar($c) + [
            'disponibilidad_24h' => isset($dia[$c->code]) ? (float) $dia[$c->code] : null,
            'disponibilidad_7d' => isset($semana[$c->code]) ? (float) $semana[$c->code] : null,
            'incidentes' => $abiertos[$c->code] ?? [],
        ])->all();

        return [
            'data' => $filas,
            'resumen' => collect($filas)->countBy('status')->all(),
            // Cifras de cabecera (como el prototipo): disponibilidad de 7 días de todos los componentes juntos e incidentes abiertos.
            'disponibilidad_7d' => ($t = DB::selectOne(<<<'SQL'
                SELECT round(100.0 * sum(CASE status WHEN 'UP' THEN 1 WHEN 'DEGRADED' THEN 0.5 ELSE 0 END) / nullif(count(*), 0), 2) AS pct
                FROM platform_health_readings WHERE status <> 'UNKNOWN' AND read_at >= ?
                SQL, [now()->subDays(7)])->pct) === null ? null : (float) $t,
            'incidentes_abiertos' => DB::table('platform_incidents')->where('status', '!=', 'RESOLVED')->count(),
            'estados' => self::ESTADOS,
        ];
    }

    public static function componente(string $codigo): array
    {
        $c = DB::table('platform_components')->where('code', $codigo)->first() ?? abort(response()->json(['message' => 'No encontrado.', 'code' => 'NOT_FOUND'], 404));

        return self::presentar($c) + [
            'lecturas' => DB::table('platform_health_readings as r')->leftJoin('platform_users as p', 'p.id', '=', 'r.platform_user_id')
                ->where('r.component_code', $codigo)->orderByDesc('r.read_at')->limit(100)
                ->get(['r.status', 'r.latency_ms', 'r.error_rate', 'r.queue_depth', 'r.detail', 'r.source', 'p.full_name as registered_by', 'r.read_at']),
        ];
    }

    /** Guarda la lectura y el estado actual del componente; si cae, abre el incidente automático. */
    public static function registrar(string $codigo, array $l, string $origen, ?string $platformUserId = null): void
    {
        if (! array_key_exists($l['status'], self::ESTADOS)) {
            RuleError::fail('RN-OPS-05', 'Estado de componente no válido.');
        }
        $antes = DB::table('platform_components')->where('code', $codigo)->value('status');
        $fila = ['status' => $l['status'], 'latency_ms' => $l['latency_ms'] ?? null, 'error_rate' => $l['error_rate'] ?? null,
            'queue_depth' => $l['queue_depth'] ?? null, 'detail' => isset($l['detail']) ? mb_substr(trim($l['detail']), 0, 300) : null];
        DB::table('platform_health_readings')->insert($fila + ['component_code' => $codigo, 'source' => $origen, 'platform_user_id' => $platformUserId, 'read_at' => now()]);
        DB::table('platform_components')->where('code', $codigo)->update($fila + ['last_read_at' => now()]
            + ($antes !== $l['status'] ? ['status_since' => now()] : []));
        if ($l['status'] === 'DOWN' && $antes !== 'DOWN') {
            Incidentes::automatico($codigo, $fila['detail']);
        }
    }

    private static function sondear(string $codigo): array
    {
        $t0 = hrtime(true);
        $ms = fn () => (int) round((hrtime(true) - $t0) / 1e6);
        try {
            switch ($codigo) {
                case 'APP':
                    return ['status' => 'UP', 'latency_ms' => 0, 'detail' => 'PHP '.PHP_VERSION];
                case 'DB':
                    DB::select('SELECT 1');
                    $l = $ms();

                    return ['status' => $l > 500 ? 'DEGRADED' : 'UP', 'latency_ms' => $l, 'detail' => $l > 500 ? 'Responde lento' : null];
                case 'QUEUE':
                    $pendientes = DB::table('jobs')->count();
                    $viejo = DB::table('jobs')->min('created_at');
                    $espera = $viejo ? now()->timestamp - (int) $viejo : 0;
                    $fallidos = DB::table('failed_jobs')->where('failed_at', '>=', now()->subHour())->count();
                    $estado = $espera > 900 ? 'DOWN' : (($espera > 300 || $fallidos > 0) ? 'DEGRADED' : 'UP');
                    $detalle = match (true) {
                        $espera > 900 => 'Ningún proceso atiende la cola hace más de 15 minutos',
                        $espera > 300 => 'La cola se está atrasando',
                        $fallidos > 0 => "{$fallidos} trabajo(s) fallido(s) en la última hora",
                        default => null,
                    };

                    return ['status' => $estado, 'latency_ms' => $ms(), 'queue_depth' => $pendientes, 'detail' => $detalle];
                case 'STORAGE':
                    $disco = Storage::disk('local');
                    $disco->put('salud/ping.txt', (string) now()->timestamp);
                    $ok = $disco->get('salud/ping.txt') !== null;
                    $disco->delete('salud/ping.txt');

                    return ['status' => $ok ? 'UP' : 'DOWN', 'latency_ms' => $ms(), 'detail' => $ok ? null : 'No se pudo escribir en el disco'];
            }
        } catch (Throwable $e) {
            return ['status' => 'DOWN', 'latency_ms' => $ms(), 'detail' => mb_substr('Falló la lectura: '.class_basename($e), 0, 300)];
        }

        return ['status' => 'UNKNOWN', 'detail' => 'Sin adaptador conectado'];
    }

    private static function presentar(object $c): array
    {
        return [
            'code' => $c->code, 'name' => $c->name, 'status' => $c->status, 'status_name' => self::ESTADOS[$c->status],
            'latency_ms' => $c->latency_ms, 'error_rate' => $c->error_rate !== null ? (float) $c->error_rate : null, 'queue_depth' => $c->queue_depth,
            'detail' => $c->detail ?? (in_array($c->code, self::CON_SONDA, true) ? null : 'Sin adaptador conectado: se registra a mano'),
            'last_read_at' => $c->last_read_at, 'status_since' => $c->status_since, 'con_sonda' => in_array($c->code, self::CON_SONDA, true),
        ];
    }
}
