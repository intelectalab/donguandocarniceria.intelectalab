<?php

namespace App\Modulos\Api\Services;

use App\Models\User;
use App\Support\Access;
use App\Support\Params;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Response;

/**
 * API-10 Uso de la API (RN-API-09; KPI-API-03): cada llamada suma en el uso del día de su clave y queda en la bitácora
 * de llamadas. Las rechazadas por límite (429) no consumen el límite del día.
 */
final class Uso
{
    /** Llamadas aceptadas hoy en el entorno (las rechazadas por límite no cuentan). */
    public static function delDia(string $entorno = 'LIVE', ?string $dia = null): int
    {
        return (int) DB::table('api_usage_daily')->where('environment', $entorno)->where('day', $dia ?? now('America/Lima')->toDateString())
            ->selectRaw('coalesce(sum(calls - rejected_limit), 0) AS n')->value('n');
    }

    public static function registrar(object $k, Request $request, Response $r, string $ruta, int $ms, string $id): void
    {
        $s = $r->getStatusCode();
        $codigo = null;
        if ($s >= 400) {
            $cuerpo = json_decode((string) $r->getContent(), true);
            $codigo = is_array($cuerpo) && isset($cuerpo['code']) ? mb_substr((string) $cuerpo['code'], 0, 20) : null;
        }
        $dia = now('America/Lima')->toDateString();
        try {
            DB::statement(<<<'SQL'
                INSERT INTO api_usage_daily (key_id, environment, day, calls, ok_2xx, err_4xx, err_5xx, rejected_limit, by_route, created_at)
                VALUES (?, ?, ?, 1, ?, ?, ?, ?, jsonb_build_object(?::text, 1), now())
                ON CONFLICT (key_id, day) DO UPDATE SET calls = api_usage_daily.calls + 1, ok_2xx = api_usage_daily.ok_2xx + EXCLUDED.ok_2xx,
                    err_4xx = api_usage_daily.err_4xx + EXCLUDED.err_4xx, err_5xx = api_usage_daily.err_5xx + EXCLUDED.err_5xx,
                    rejected_limit = api_usage_daily.rejected_limit + EXCLUDED.rejected_limit,
                    by_route = jsonb_set(api_usage_daily.by_route, ARRAY[?::text], to_jsonb(coalesce((api_usage_daily.by_route ->> ?::text)::int, 0) + 1)),
                    updated_at = now()
                SQL, [$k->id, $k->environment, $dia, $s < 300 ? 1 : 0, $s >= 400 && $s < 500 ? 1 : 0, $s >= 500 ? 1 : 0, $s === 429 ? 1 : 0, $ruta, $ruta, $ruta]);
            DB::table('api_requests')->insert(['key_id' => $k->id, 'request_id' => $id, 'method' => $request->method(), 'path' => mb_substr('/'.$request->path().($request->getQueryString() ? '?'.$request->getQueryString() : ''), 0, 255),
                'route' => mb_substr($ruta, 0, 80), 'status' => $s, 'ms' => $ms, 'ip' => mb_substr((string) $request->ip(), 0, 45), 'code' => $codigo,
                'replayed' => $r->headers->get('Idempotent-Replayed') === 'true']);
            if (Claves::estado($k) === 'ACTIVE') {
                DB::table('api_keys')->where('id', $k->id)->update(['last_used_at' => now(), 'last_ip' => mb_substr((string) $request->ip(), 0, 45)]);
            }
        } catch (\Throwable $e) {
            report($e);   // el registro de uso nunca tumba la respuesta
        }
    }

    /** Lo que muestran Claves (API-01) y su detalle (API-03): llamadas de hoy contra el límite y rechazadas en 30 días. */
    public static function resumen(): array
    {
        $hoy = now('America/Lima')->toDateString();
        $desde = Carbon::parse($hoy)->subDays(29)->toDateString();
        $t = DB::table('api_usage_daily')->where('environment', 'LIVE')->whereBetween('day', [$desde, $hoy])->selectRaw('coalesce(sum(calls), 0) AS c, coalesce(sum(rejected_limit), 0) AS r')->first();
        $limite = Params::get('api_calls_per_day');

        return ['hoy' => self::delDia('LIVE', $hoy), 'limite' => $limite !== null && (int) $limite > 0 ? (int) $limite : null,
            'rechazadas_30' => (int) $t->r, 'llamadas_30' => (int) $t->c, 'rechazadas_pct' => (int) $t->c ? round((int) $t->r / (int) $t->c * 100, 2) : null];
    }

    /** El uso de una clave: 30 días por día y sus últimas llamadas. */
    public static function deClave(string $id): array
    {
        $hoy = now('America/Lima')->toDateString();
        $desde = Carbon::parse($hoy)->subDays(29)->toDateString();
        $filas = DB::table('api_usage_daily')->where('key_id', $id)->whereBetween('day', [$desde, $hoy])->orderBy('day')->get()->keyBy(fn ($u) => (string) $u->day);
        $dias = [];
        for ($d = Carbon::parse($desde); $d->lte(Carbon::parse($hoy)); $d->addDay()) {
            $u = $filas[$d->toDateString()] ?? null;
            $dias[] = ['dia' => $d->toDateString(), 'ok' => (int) ($u->ok_2xx ?? 0), 'err_4xx' => (int) (($u->err_4xx ?? 0) - ($u->rejected_limit ?? 0)),
                'rechazadas' => (int) ($u->rejected_limit ?? 0), 'err_5xx' => (int) ($u->err_5xx ?? 0)];
        }
        $tot = ['llamadas' => (int) $filas->sum('calls'), 'rechazadas' => (int) $filas->sum('rejected_limit'), 'err_4xx' => (int) $filas->sum('err_4xx'), 'err_5xx' => (int) $filas->sum('err_5xx'),
            'dias_con_uso' => $filas->count(), 'pedidos' => DB::table('api_key_orders')->where('key_id', $id)->count()];
        $ultimas = DB::table('api_requests')->where('key_id', $id)->orderByDesc('at')->limit(25)->get(['at', 'method', 'path', 'status', 'ms', 'ip', 'code', 'replayed', 'request_id'])
            ->map(fn ($x) => (array) $x)->all();

        return ['dias' => $dias, 'totales' => $tot, 'ultimas' => $ultimas];
    }

    /** API-10: llamadas por día y por clave contra el límite, errores y rechazos, en un período. */
    public static function panel(array $f, User $u): array
    {
        $hoy = now('America/Lima')->toDateString();
        $hasta = $f['hasta'] ?? $hoy;
        $desde = $f['desde'] ?? Carbon::parse($hasta)->subDays(29)->toDateString();
        $entorno = $f['entorno'] ?? 'LIVE';
        $q = DB::table('api_usage_daily as u')->join('api_keys as k', 'k.id', '=', 'u.key_id')->where('u.environment', $entorno)->whereBetween('u.day', [$desde, $hasta]);
        if (! empty($f['clave'])) {
            $q->where('u.key_id', $f['clave']);
        }
        $porDia = (clone $q)->groupBy('u.day')->orderBy('u.day')->selectRaw('u.day, sum(u.calls) AS calls, sum(u.ok_2xx) AS ok, sum(u.err_4xx - u.rejected_limit) AS e4, sum(u.err_5xx) AS e5, sum(u.rejected_limit) AS rj')
            ->get()->keyBy(fn ($x) => (string) $x->day);
        $dias = [];
        for ($d = Carbon::parse($desde); $d->lte(Carbon::parse($hasta)); $d->addDay()) {
            $x = $porDia[$d->toDateString()] ?? null;
            $dias[] = ['dia' => $d->toDateString(), 'llamadas' => (int) ($x->calls ?? 0), 'ok' => (int) ($x->ok ?? 0), 'err_4xx' => (int) ($x->e4 ?? 0), 'err_5xx' => (int) ($x->e5 ?? 0),
                'rechazadas' => (int) ($x->rj ?? 0)];
        }
        $porClave = (clone $q)->groupBy('u.key_id', 'k.name', 'k.prefix')->selectRaw('u.key_id, k.name, k.prefix, sum(u.calls) AS calls, sum(u.err_4xx - u.rejected_limit) AS e4, sum(u.err_5xx) AS e5, sum(u.rejected_limit) AS rj, max(u.day) AS ultimo')
            ->orderByDesc('calls')->get();
        $rutas = [];
        foreach ((clone $q)->pluck('u.by_route') as $br) {
            foreach (json_decode((string) $br, true) ?: [] as $r => $n) {
                $rutas[$r] = ($rutas[$r] ?? 0) + (int) $n;
            }
        }
        arsort($rutas);
        $tot = collect($dias);
        $limite = Params::get('api_calls_per_day');
        $t = trim((string) ($f['buscar'] ?? ''));
        $claves = $porClave->map(fn ($x) => ['id' => $x->key_id, 'name' => $x->name, 'prefix' => $x->prefix, 'llamadas' => (int) $x->calls, 'err_4xx' => (int) $x->e4,
            'err_5xx' => (int) $x->e5, 'rechazadas' => (int) $x->rj, 'rechazadas_pct' => (int) $x->calls ? round((int) $x->rj / (int) $x->calls * 100, 2) : null, 'ultimo' => $x->ultimo])
            ->filter(fn ($x) => mb_strlen($t) < 2 || str_contains(mb_strtolower($x['name'].' '.$x['prefix']), mb_strtolower($t)))->values()->all();

        return [
            'desde' => $desde, 'hasta' => $hasta, 'entorno' => $entorno, 'hoy' => $hoy,
            'limite' => $limite !== null && (int) $limite > 0 ? (int) $limite : null, 'por_minuto' => (int) (Params::get('api_rate_limit_per_minute') ?? 120),
            'cifras' => ['llamadas' => $tot->sum('llamadas'), 'hoy' => self::delDia($entorno, $hoy), 'err_4xx' => $tot->sum('err_4xx'), 'err_5xx' => $tot->sum('err_5xx'),
                'rechazadas' => $tot->sum('rechazadas'), 'rechazadas_pct' => $tot->sum('llamadas') ? round($tot->sum('rechazadas') / $tot->sum('llamadas') * 100, 2) : null,
                'pico' => $tot->max('llamadas') ?? 0],
            'dias' => $dias, 'claves' => $claves,
            'rutas' => collect($rutas)->take(12)->map(fn ($n, $r) => ['ruta' => $r, 'llamadas' => $n])->values()->all(),
            'opciones' => ['claves' => DB::table('api_keys')->where('environment', $entorno)->orderBy('name')->get(['id', 'name', 'prefix'])
                ->map(fn ($k) => ['value' => $k->id, 'label' => "{$k->name} ({$k->prefix}…)"])->all()],
            'puede_parametros' => Access::can($u, 'plt.parameter.manage'),
        ];
    }
}
