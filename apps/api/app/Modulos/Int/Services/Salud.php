<?php

namespace App\Modulos\Int\Services;

use App\Support\Params;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * INT-12 Salud de integraciones: los cinco indicadores del módulo, los últimos 10 días de webhooks y mensajes
 * salientes, los conectores con problemas y las credenciales por vencer.
 *  - KPI-INT-01 éxito de entrega de los mensajes salientes (meta ≥ 99,5 %)
 *  - KPI-INT-02 mensajes en la cola muerta (meta 0)
 *  - KPI-INT-03 webhooks repetidos (informativo)
 *  - KPI-INT-04 tiempo de proceso p95 de los webhooks (meta ≤ 60 s)
 *  - KPI-INT-05 conectores en error (meta 0)
 * Cada gráfico muestra sus últimos 10 días con actividad de su tipo (webhooks procesados, mensajes salientes): en
 * operación terminan hoy; en una empresa sin movimiento reciente (o con solo pruebas de hoy) se ve su último tramo con
 * datos, en vez de un gráfico vacío.
 */
final class Salud
{
    public const DIAS = 10;

    public const DIAS_CREDENCIALES = 30;

    /** $mes «2026-10»: los gráficos muestran ese mes día por día; sin mes, los últimos 10 días con actividad. */
    public static function resumen(?string $mes = null): array
    {
        [$desde, $hasta] = $mes ? [Carbon::parse($mes.'-01')->toDateString(), Carbon::parse($mes.'-01')->endOfMonth()->toDateString()] : [null, null];
        $ob = Salientes::cifras();
        $wh = Webhooks::cifras();
        // Cada gráfico, sus últimos 10 días con actividad de su tipo: los webhooks procesados y los mensajes salientes.
        $latencia = self::serie(
            "SELECT max(received_at) AS d FROM webhook_events WHERE status = 'PROCESSED' AND processed_at IS NOT NULL",
            <<<'SQL'
                SELECT (received_at AT TIME ZONE 'America/Lima')::date AS d,
                       round(percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM (processed_at - received_at)))::numeric, 1) AS p95, count(*) AS webhooks
                FROM webhook_events
                WHERE status = 'PROCESSED' AND processed_at IS NOT NULL AND (received_at AT TIME ZONE 'America/Lima')::date BETWEEN ? AND ?
                GROUP BY 1
                SQL,
            fn ($f) => ['p95' => $f ? (float) $f->p95 : null, 'webhooks' => (int) ($f->webhooks ?? 0)],
            $desde, $hasta,
        );
        $salientes = self::serie(
            'SELECT max(created_at) AS d FROM outbox_messages',
            <<<'SQL'
                SELECT (created_at AT TIME ZONE 'America/Lima')::date AS d,
                       count(*) FILTER (WHERE status = 'SENT') AS enviados, count(*) FILTER (WHERE status IN ('PENDING','RETRYING')) AS reintentando,
                       count(*) FILTER (WHERE status = 'DEAD') AS muertos
                FROM outbox_messages WHERE (created_at AT TIME ZONE 'America/Lima')::date BETWEEN ? AND ?
                GROUP BY 1
                SQL,
            fn ($f) => ['enviados' => (int) ($f->enviados ?? 0), 'reintentando' => (int) ($f->reintentando ?? 0), 'muertos' => (int) ($f->muertos ?? 0)],
            $desde, $hasta,
        );

        $problemas = DB::table('integration_connectors')->where(fn ($w) => $w->where('status', 'ERROR')->orWhere('consecutive_failures', '>', 0)->orWhere('simulate_down', true))
            ->orderByRaw("status = 'ERROR' DESC")->orderByDesc('consecutive_failures')->get(['id', 'name', 'status', 'consecutive_failures', 'last_error', 'last_error_at', 'simulate_down']);
        $vencen = DB::table('integration_credentials as k')->join('integration_connectors as c', 'c.id', '=', 'k.connector_id')
            ->where('k.status', 'ACTIVE')->whereNotNull('k.expires_at')->where('k.expires_at', '<=', now()->addDays(self::DIAS_CREDENCIALES))
            ->orderBy('k.expires_at')->get(['k.id', 'k.name', 'k.expires_at', 'k.connector_id', 'c.name as connector_name']);

        return [
            'indicadores' => [
                'exito' => $ob['exito'], 'enviados_30' => $ob['enviados_30'], 'base_30' => $ob['base_30'], 'muertos' => $ob['muertos'],
                'duplicados' => $wh['duplicados'], 'repetidos' => $wh['repetidos'], 'p95' => $wh['p95'],
                'en_error' => DB::table('integration_connectors')->where('status', 'ERROR')->count(),
            ],
            'latencia' => $latencia, 'salientes' => $salientes, 'mes' => $mes, 'meses' => self::meses(),
            'problemas' => $problemas->map(fn ($c) => [
                'id' => $c->id, 'name' => $c->name, 'status' => $c->status, 'status_name' => ['ACTIVE' => 'Activo', 'ERROR' => 'En error', 'DISABLED' => 'Desactivado', 'PENDING' => 'Pendiente'][$c->status] ?? $c->status,
                'consecutive_failures' => (int) $c->consecutive_failures, 'last_error' => $c->last_error, 'last_error_at' => $c->last_error_at, 'simulate_down' => (bool) $c->simulate_down,
            ])->values(),
            'credenciales' => $vencen->map(fn ($k) => ['id' => $k->id, 'name' => $k->name, 'expires_at' => $k->expires_at, 'connector_id' => $k->connector_id,
                'connector_name' => $k->connector_name, 'dias' => (int) now()->startOfDay()->diffInDays(Carbon::parse($k->expires_at)->startOfDay(), false)])->values(),
            'metas' => ['exito' => 99.5, 'p95' => 60], 'umbral_errores' => (int) (Params::get('int_connector_error_threshold') ?? 3),
        ];
    }

    /**
     * Una serie de 10 días que termina en el último día con actividad (o hoy, si no hay ninguna). $fila arma cada día a
     * partir de la fila de la consulta (o null si ese día no hubo nada).
     *
     * @return array{desde: string, hasta: string, dias: list<array>}
     */
    private static function serie(string $ultimo, string $consulta, callable $fila, ?string $desde = null, ?string $hasta = null): array
    {
        if (! $desde || ! $hasta) {
            $max = DB::selectOne($ultimo)->d;
            $hasta = Carbon::parse($max ?? now())->setTimezone('America/Lima')->toDateString();
            $desde = Carbon::parse($hasta)->subDays(self::DIAS - 1)->toDateString();
        }
        $filas = collect(DB::select($consulta, [$desde, $hasta]))->keyBy('d');
        $dias = [];
        for ($d = $desde; $d <= $hasta; $d = Carbon::parse($d)->addDay()->toDateString()) {
            $dias[] = ['dia' => $d] + $fila($filas[$d] ?? null);
        }

        return ['desde' => $desde, 'hasta' => $hasta, 'dias' => $dias];
    }

    /** Los meses con webhooks o mensajes salientes (los últimos 12), para elegir el período. */
    private static function meses(): array
    {
        return array_column(DB::select(<<<'SQL'
            SELECT DISTINCT to_char(d AT TIME ZONE 'America/Lima', 'YYYY-MM') AS mes FROM (
                SELECT received_at AS d FROM webhook_events WHERE status <> 'REJECTED' UNION ALL SELECT created_at FROM outbox_messages
            ) x ORDER BY 1 DESC LIMIT 12
            SQL), 'mes');
    }
}
