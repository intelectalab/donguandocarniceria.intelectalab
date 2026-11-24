<?php

namespace App\Modulos\Ops\Services;

use App\Modulos\Sus\Services\Mora;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Salud ponderada de cada empresa (OPS-02, OPS-03, RN-OPS-13), de 0 a 100, con lo que el sistema ya mide:
 *  - Actividad: días desde el último ingreso de sus usuarios (3 días o menos = 100, 7 = 80, 14 = 50, 30 = 20, más = 0).
 *  - Cobro: activa, en prueba o sin suscripción = 100; con deuda = 60 menos 4 por día de mora (mínimo 20);
 *    solo lectura = 15; suspendida o cancelada = 0.
 *  - Soporte: 100 menos 15 por ticket abierto y 25 más por cada urgente (mínimo 0).
 * El prototipo también suma OSE y WhatsApp: se agregan cuando existan esas integraciones. Mientras tanto el puntaje
 * reparte el peso entre las tres partes que hay (los pesos se normalizan).
 * Niveles: crítica debajo de ops_health_critical_below (40), en riesgo debajo de ops_health_risk_below (70).
 */
final class SaludEmpresas
{
    public const NIVELES = ['HEALTHY' => 'Saludable', 'AT_RISK' => 'En riesgo', 'CRITICAL' => 'Crítica'];

    /** @return array<string, array{score: int, level: string, level_name: string, parts: array}> por empresa */
    public static function calcular(): array
    {
        $pesos = self::pesos();
        $total = array_sum($pesos) ?: 1;
        $uso = collect(DB::select('SELECT tenant_id, last_login FROM platform_tenant_usage()'))->pluck('last_login', 'tenant_id');
        $subs = DB::table('subscriptions')->orderByRaw("status = 'CANCELLED' DESC")->orderBy('started_at')->get(['tenant_id', 'status', 'id'])->keyBy('tenant_id');
        $mora = collect(Mora::cola())->pluck('dias', 'subscription_id');
        $tickets = DB::table('support_tickets')->whereIn('status', ['OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER'])
            ->selectRaw("tenant_id, count(*) AS n, count(*) FILTER (WHERE priority = 'URGENT') AS urgentes")->groupBy('tenant_id')->get()->keyBy('tenant_id');
        [$riesgo, $critica] = self::cortes();

        $salida = [];
        foreach (DB::table('tenants')->pluck('id') as $id) {
            $ultimo = $uso[$id] ?? null;
            $dias = $ultimo ? (int) Carbon::parse($ultimo)->diffInDays(now(), true) : null;
            $actividad = match (true) {
                $dias === null => 0, $dias <= 3 => 100, $dias <= 7 => 80, $dias <= 14 => 50, $dias <= 30 => 20, default => 0,
            };
            $s = $subs[$id] ?? null;
            $diasMora = $s ? (int) ($mora[$s->id] ?? 0) : 0;
            $cobro = match ($s->status ?? null) {
                null, 'ACTIVE', 'TRIAL' => 100, 'PAST_DUE' => max(20, 60 - 4 * $diasMora), 'READ_ONLY' => 15, default => 0,
            };
            $t = $tickets[$id] ?? null;
            $abiertos = (int) ($t->n ?? 0);
            $urgentes = (int) ($t->urgentes ?? 0);
            $soporte = max(0, 100 - 15 * $abiertos - 25 * $urgentes);

            $partes = [
                'actividad' => ['label' => 'Actividad', 'weight' => $pesos['actividad'], 'score' => $actividad,
                    'detail' => $dias === null ? 'Nadie ingresó todavía' : ($dias === 0 ? 'Ingresaron hoy' : "Último ingreso hace {$dias} ".($dias === 1 ? 'día' : 'días'))],
                'cobro' => ['label' => 'Cobro', 'weight' => $pesos['cobro'], 'score' => $cobro,
                    'detail' => $s ? Empresas::ESTADOS[$s->status].($diasMora > 0 ? " · {$diasMora} ".($diasMora === 1 ? 'día' : 'días').' de mora' : '') : 'Sin suscripción (piloto)'],
                'soporte' => ['label' => 'Soporte', 'weight' => $pesos['soporte'], 'score' => $soporte,
                    'detail' => $abiertos === 0 ? 'Sin tickets abiertos' : "{$abiertos} ".($abiertos === 1 ? 'ticket abierto' : 'tickets abiertos').($urgentes ? ", {$urgentes} ".($urgentes === 1 ? 'urgente' : 'urgentes') : '')],
            ];
            $puntaje = (int) round(array_sum(array_map(fn ($p) => $p['score'] * $p['weight'], $partes)) / $total);
            $nivel = $puntaje < $critica ? 'CRITICAL' : ($puntaje < $riesgo ? 'AT_RISK' : 'HEALTHY');
            $salida[$id] = ['score' => $puntaje, 'level' => $nivel, 'level_name' => self::NIVELES[$nivel], 'parts' => array_values($partes)];
        }

        return $salida;
    }

    /** Guarda la foto del día de cada empresa (la reemplaza si ya había una hoy). Desde la tarea diaria ($quien nulo) o a mano. */
    public static function guardarFotos(?array $quien): int
    {
        if ($quien) {
            Consola::exigir($quien, 'health.recompute');
        }
        $hoy = Carbon::now('America/Lima')->toDateString();
        $todas = self::calcular();
        foreach ($todas as $id => $s) {
            DB::table('tenant_health_snapshots')->upsert(
                [['tenant_id' => $id, 'day' => $hoy, 'score' => $s['score'], 'level' => $s['level'], 'parts' => json_encode($s['parts'], JSON_UNESCAPED_UNICODE), 'taken_at' => now()]],
                ['tenant_id', 'day'], ['score', 'level', 'parts', 'taken_at']
            );
        }
        if ($quien) {
            Consola::bitacora('HEALTH_RECOMPUTED', $quien, ['entity' => 'tenant_health_snapshots', 'reason' => 'Salud de las empresas recalculada a mano',
                'detail' => ['empresas' => count($todas)]]);
        }

        return count($todas);
    }

    /** Evolución de los últimos 90 días de una empresa. */
    public static function evolucion(string $tenant): array
    {
        return DB::table('tenant_health_snapshots')->where('tenant_id', $tenant)->where('day', '>=', now()->subDays(90)->toDateString())
            ->orderBy('day')->get(['day', 'score', 'level'])->map(fn ($x) => (array) $x)->all();
    }

    /** @return array{0: int, 1: int} cortes de «en riesgo» y «crítica» */
    public static function cortes(): array
    {
        return [(int) Consola::param('ops_health_risk_below', 70), (int) Consola::param('ops_health_critical_below', 40)];
    }

    private static function pesos(): array
    {
        return [
            'actividad' => max(0, (int) Consola::param('ops_health_weight_activity', 40)),
            'cobro' => max(0, (int) Consola::param('ops_health_weight_billing', 35)),
            'soporte' => max(0, (int) Consola::param('ops_health_weight_support', 25)),
        ];
    }
}
