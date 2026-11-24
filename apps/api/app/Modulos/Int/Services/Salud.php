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
 * Los días terminan en la última actividad registrada: en operación es hoy, y en una empresa sin movimiento reciente
 * se ve su última semana y media, en vez de un gráfico vacío.
 */
final class Salud
{
    public const DIAS = 10;

    public const DIAS_CREDENCIALES = 30;

    public static function resumen(): array
    {
        $ob = Salientes::cifras();
        $wh = Webhooks::cifras();
        $hasta = DB::selectOne(<<<'SQL'
            SELECT (coalesce(greatest((SELECT max(created_at) FROM outbox_messages), (SELECT max(received_at) FROM webhook_events)), now())
                    AT TIME ZONE 'America/Lima')::date AS d
            SQL)->d;
        $desde = date('Y-m-d', strtotime($hasta.' -'.(self::DIAS - 1).' days'));

        $latencia = collect(DB::select(<<<'SQL'
            SELECT (received_at AT TIME ZONE 'America/Lima')::date AS d,
                   percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM (processed_at - received_at))) AS p95, count(*) AS n
            FROM webhook_events
            WHERE status = 'PROCESSED' AND processed_at IS NOT NULL AND (received_at AT TIME ZONE 'America/Lima')::date BETWEEN ? AND ?
            GROUP BY 1
            SQL, [$desde, $hasta]))->keyBy('d');
        $salientes = collect(DB::select(<<<'SQL'
            SELECT (created_at AT TIME ZONE 'America/Lima')::date AS d,
                   count(*) FILTER (WHERE status = 'SENT') AS enviados, count(*) FILTER (WHERE status IN ('PENDING','RETRYING')) AS reintentando,
                   count(*) FILTER (WHERE status = 'DEAD') AS muertos
            FROM outbox_messages WHERE (created_at AT TIME ZONE 'America/Lima')::date BETWEEN ? AND ?
            GROUP BY 1
            SQL, [$desde, $hasta]))->keyBy('d');
        $dias = [];
        for ($d = $desde; $d <= $hasta; $d = date('Y-m-d', strtotime($d.' +1 day'))) {
            $l = $latencia[$d] ?? null;
            $o = $salientes[$d] ?? null;
            $dias[] = ['dia' => $d, 'p95' => $l ? round((float) $l->p95, 1) : null, 'webhooks' => (int) ($l->n ?? 0),
                'enviados' => (int) ($o->enviados ?? 0), 'reintentando' => (int) ($o->reintentando ?? 0), 'muertos' => (int) ($o->muertos ?? 0)];
        }

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
            'dias' => $dias, 'desde' => $desde, 'hasta' => $hasta,
            'problemas' => $problemas->map(fn ($c) => [
                'id' => $c->id, 'name' => $c->name, 'status' => $c->status, 'status_name' => ['ACTIVE' => 'Activo', 'ERROR' => 'En error', 'DISABLED' => 'Desactivado', 'PENDING' => 'Pendiente'][$c->status] ?? $c->status,
                'consecutive_failures' => (int) $c->consecutive_failures, 'last_error' => $c->last_error, 'last_error_at' => $c->last_error_at, 'simulate_down' => (bool) $c->simulate_down,
            ])->values(),
            'credenciales' => $vencen->map(fn ($k) => ['id' => $k->id, 'name' => $k->name, 'expires_at' => $k->expires_at, 'connector_id' => $k->connector_id,
                'connector_name' => $k->connector_name, 'dias' => (int) now()->startOfDay()->diffInDays(Carbon::parse($k->expires_at)->startOfDay(), false)])->values(),
            'metas' => ['exito' => 99.5, 'p95' => 60], 'umbral_errores' => (int) (Params::get('int_connector_error_threshold') ?? 3),
        ];
    }
}
