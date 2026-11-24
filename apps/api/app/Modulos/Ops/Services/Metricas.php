<?php

namespace App\Modulos\Ops\Services;

use App\Support\RuleError;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * OPS-10 Métricas del negocio (KPI-OPS-01 a 15) y la foto mensual de uso (SUS-04).
 *  - El mes en curso se calcula en vivo; un mes cerrado se congela en platform_metric_runs (RN-OPS-17). Recalcular crea
 *    otra corrida y la pantalla muestra la última. El cierre lo hace la tarea del día 1 (o cobranza a mano).
 *  - El estado de cada suscripción en una fecha sale de su historial de eventos; el precio es el de su versión de plan
 *    actual más los complementos que estaban activos (el historial todavía no guarda el precio de cada cambio).
 *  - Las empresas sin suscripción (piloto, internas) no cuentan como clientes.
 */
final class Metricas
{
    private const VIVAS = ['ACTIVE', 'PAST_DUE'];

    /** Últimos 12 meses: cada uno con su corrida congelada más reciente o, el mes en curso, calculado en vivo. */
    public static function tablero(): array
    {
        $meses = [];
        for ($i = 11; $i >= 0; $i--) {
            $p = now()->startOfMonth()->subMonths($i)->format('Y-m');
            $run = DB::table('platform_metric_runs')->where('period', $p)->orderByDesc('run_no')->first();
            $meses[] = $run
                ? ['period' => $p, 'congelado' => true, 'run_no' => $run->run_no, 'calculado' => $run->created_at, 'por' => $run->created_by_name] + json_decode($run->data, true)
                : ($i === 0 ? ['period' => $p, 'congelado' => false, 'run_no' => null, 'calculado' => now()->toIso8601String(), 'por' => null] + self::calcular($p) : ['period' => $p, 'sin_datos' => true]);
        }

        return ['meses' => $meses, 'corridas' => DB::table('platform_metric_runs')->orderByDesc('created_at')->limit(24)
            ->get(['period', 'run_no', 'reason', 'created_by_name', 'created_at'])];
    }

    /** RN-OPS-17: congela un mes cerrado (otra corrida si ya tenía). */
    public static function congelar(?array $quien, string $periodo, ?string $motivo = null): array
    {
        $quien && Consola::exigir($quien, 'metrics.freeze');
        if ($periodo >= now()->format('Y-m')) {
            RuleError::fail('RN-OPS-17', 'Solo se congela un mes que ya cerró.');
        }
        $runNo = (int) DB::table('platform_metric_runs')->where('period', $periodo)->max('run_no') + 1;
        if ($runNo > 1 && $quien && ! trim((string) $motivo)) {
            RuleError::fail('RN-OPS-17', 'Ese mes ya está congelado: escribe por qué lo recalculas.');
        }
        $datos = self::calcular($periodo);
        DB::table('platform_metric_runs')->insert(['period' => $periodo, 'run_no' => $runNo, 'data' => json_encode($datos, JSON_UNESCAPED_UNICODE),
            'reason' => $motivo ? mb_substr(trim($motivo), 0, 300) : null, 'created_by' => $quien['id'] ?? null, 'created_by_name' => $quien['full_name'] ?? 'Sistema',
            'created_at' => now()]);
        Consola::bitacora('METRICS_FROZEN', $quien, ['actor' => 'Sistema', 'entity' => 'platform_metric_runs', 'entity_id' => null,
            'reason' => "Métricas de {$periodo}, corrida {$runNo}".($motivo ? ": {$motivo}" : ''), 'detail' => ['mrr' => $datos['mrr'], 'clientes' => $datos['clientes_activos']]]);

        return ['period' => $periodo, 'run_no' => $runNo] + $datos;
    }

    /** KPI-OPS-01 a 15 de un mes (AAAA-MM). */
    public static function calcular(string $periodo): array
    {
        $inicio = Carbon::createFromFormat('Y-m-d', "{$periodo}-01")->startOfDay();
        $fin = $inicio->copy()->endOfMonth();
        $corte = $fin->isFuture() ? now() : $fin;
        $antes = $inicio->copy()->subSecond();

        $subs = DB::table('subscriptions as s')->leftJoin('saas_plan_versions as v', 'v.id', '=', 's.plan_version_id')
            ->select('s.*', 'v.price_pen', 'v.plan_code as version_plan', 'v.users_max', 'v.brands_max', 'v.sites_max')->get();
        $eventos = DB::table('subscription_events')->where('event', 'STATUS_CHANGED')->orderBy('occurred_at')->get()->groupBy('subscription_id');
        $addons = DB::table('subscription_addons')->get()->groupBy('subscription_id');

        $estado = function (object $s, Carbon $d) use ($eventos): ?string {
            if (Carbon::parse($s->started_at)->gt($d)) {
                return null;
            }
            $ev = $eventos[$s->id] ?? collect();
            $ultimo = $ev->filter(fn ($e) => Carbon::parse($e->occurred_at)->lte($d))->last();

            return $ultimo->to_status ?? ($ev->first()->from_status ?? $s->status);
        };
        $cuota = function (object $s, Carbon $d) use ($addons): float {
            $extra = collect($addons[$s->id] ?? [])->filter(fn ($a) => Carbon::parse($a->started_at)->lte($d) && (! $a->ended_at || Carbon::parse($a->ended_at)->gt($d)))
                ->sum(fn ($a) => (float) $a->unit_price * $a->quantity);

            return round((float) $s->price_pen * (1 - (float) ($s->discount_pct ?? 0) / 100) + $extra, 2);
        };

        $mrrIni = $mrrFin = $mrrCancelado = $contraccion = $expansion = $mrrNuevo = $mrrCohorteFin = $mora = $soloLectura = 0.0;
        $activosIni = $activosFin = $cancelados = 0;
        $pruebasTerminadas = $pruebasConvertidas = 0;
        $porPlan = [];
        foreach ($subs as $s) {
            $ei = $estado($s, $antes);
            $ef = $estado($s, $corte);
            $ci = in_array($ei, self::VIVAS, true) ? $cuota($s, $antes) : 0.0;
            $cf = in_array($ef, self::VIVAS, true) ? $cuota($s, $corte) : 0.0;
            $mrrIni += $ci;
            $mrrFin += $cf;
            if (in_array($ei, self::VIVAS, true)) {
                $activosIni++;
                $mrrCohorteFin += $cf;
                if ($ef === 'CANCELLED') {
                    $mrrCancelado += $ci;
                } elseif ($cf < $ci) {
                    $contraccion += $ci - $cf;
                } elseif ($cf > $ci) {
                    $expansion += $cf - $ci;
                }
            } else {
                $mrrNuevo += $cf;   // clientes que no estaban activos al inicio del mes
            }
            if (in_array($ef, self::VIVAS, true)) {
                $activosFin++;
                $porPlan[$s->plan_code][] = $s;
            }
            if ($ef === 'PAST_DUE') {
                $mora += $cf;
            } elseif ($ef === 'READ_ONLY') {
                $soloLectura += $cuota($s, $corte);
            }
            $cancelados += ($eventos[$s->id] ?? collect())->filter(fn ($e) => $e->to_status === 'CANCELLED' && Carbon::parse($e->occurred_at)->between($inicio, $corte))->count() ? 1 : 0;
            if ($s->trial_ends_at && Carbon::parse($s->trial_ends_at)->between($inicio, $corte)) {
                $pruebasTerminadas++;
                $pruebasConvertidas += in_array($ef, self::VIVAS, true) ? 1 : 0;
            }
        }

        $pct = fn (float $a, float $b) => $b > 0 ? round($a / $b * 100, 2) : null;
        $mediana = function (array $v): ?float {
            sort($v);
            $n = count($v);

            return $n ? round($n % 2 ? $v[intdiv($n, 2)] : ($v[$n / 2 - 1] + $v[$n / 2]) / 2, 2) : null;
        };

        // KPI-OPS-08: uso por plan (usado / límite) en los clientes activos de cada plan.
        $uso = collect(DB::select('SELECT * FROM platform_tenant_usage()'))->keyBy('tenant_id');
        $usoPorPlan = [];
        foreach ($porPlan as $plan => $lista) {
            foreach (['users' => ['users_active', 'users_max'], 'brands' => ['brands_active', 'brands_max'], 'sites' => ['sites_active', 'sites_max']] as $k => [$col, $max]) {
                $v = array_values(array_filter(array_map(fn ($s) => $s->{$max} ? (int) ($uso[$s->tenant_id]->{$col} ?? 0) / $s->{$max} * 100 : null, $lista), fn ($x) => $x !== null));
                $usoPorPlan[$plan][$k] = $v ? round(array_sum($v) / count($v), 1) : null;
            }
        }

        // Soporte (KPI-OPS-10, 11, 14, 15) y disponibilidad (KPI-OPS-12).
        $tickets = DB::table('support_tickets')->whereBetween('opened_at', [$inicio, $corte])->get(['priority', 'opened_at', 'first_response_at']);
        $primera = [];
        foreach (['URGENT', 'HIGH', 'NORMAL', 'LOW'] as $p) {
            $primera[$p] = $mediana($tickets->where('priority', $p)->whereNotNull('first_response_at')
                ->map(fn ($t) => Carbon::parse($t->opened_at)->diffInMinutes(Carbon::parse($t->first_response_at), true) / 60)->values()->all());
        }
        $resolucion = $mediana(DB::table('support_tickets')->whereBetween('resolved_at', [$inicio, $corte])->get(['opened_at', 'resolved_at'])
            ->map(fn ($t) => Carbon::parse($t->opened_at)->diffInMinutes(Carbon::parse($t->resolved_at), true) / 60)->all());
        $horasAcceso = DB::table('support_accesses')->whereBetween('decided_at', [$inicio, $corte])->whereNotIn('status', ['PENDING', 'REJECTED', 'CANCELLED'])->get()
            ->sum(fn ($a) => Carbon::parse($a->decided_at)->diffInMinutes(Carbon::parse($a->ended_at ?? (Carbon::parse($a->expires_at)->isFuture() ? now() : $a->expires_at)), true) / 60);
        $disponibilidad = collect(DB::select(<<<'SQL'
            SELECT c.code, c.name, round(100.0 * sum(CASE r.status WHEN 'UP' THEN 1 WHEN 'DEGRADED' THEN 0.5 ELSE 0 END) / count(*), 2) AS pct
            FROM platform_health_readings r JOIN platform_components c ON c.code = r.component_code
            WHERE r.status <> 'UNKNOWN' AND r.read_at BETWEEN ? AND ? GROUP BY c.code, c.name, c.sort ORDER BY c.sort
            SQL, [$inicio, $corte]))->map(fn ($r) => ['code' => $r->code, 'name' => $r->name, 'pct' => (float) $r->pct])->all();

        // Facturado y cobrado del mes (comprobantes del SaaS).
        $facturado = (float) DB::table('saas_invoices')->where('status', 'ISSUED')->where('doc_type', '!=', 'CREDIT_NOTE')->whereBetween('issue_date', [$inicio->toDateString(), $corte->toDateString()])->sum('subtotal')
            - (float) DB::table('saas_invoices')->where('status', 'ISSUED')->where('doc_type', 'CREDIT_NOTE')->whereBetween('issue_date', [$inicio->toDateString(), $corte->toDateString()])->sum('subtotal');
        $cobrado = (float) DB::table('saas_payments')->where('status', 'APPROVED')->whereBetween('confirmed_at', [$inicio, $corte])->sum('amount');

        return [
            'mrr' => round($mrrFin, 2),                                                                  // KPI-OPS-01
            'clientes_activos' => $activosFin,                                                           // KPI-OPS-02
            'churn_clientes' => $pct($cancelados, $activosIni),                                          // KPI-OPS-03
            'churn_mrr' => $pct($mrrCancelado + $contraccion, $mrrIni),                                  // KPI-OPS-04
            'retencion_neta' => $pct($mrrCohorteFin, $mrrIni),                                           // KPI-OPS-05
            'ingreso_promedio' => $activosFin ? round($mrrFin / $activosFin, 2) : null,                  // KPI-OPS-06
            'conversion_prueba' => $pct($pruebasConvertidas, $pruebasTerminadas),                        // KPI-OPS-07
            'uso_por_plan' => $usoPorPlan,                                                               // KPI-OPS-08
            'tiempo_de_alta' => null,                                                                    // KPI-OPS-09: falta el primer comprobante aceptado (FAC)
            'tickets_por_cliente' => $activosFin ? round($tickets->count() / $activosFin, 2) : null,     // KPI-OPS-10
            'primera_respuesta_horas' => $primera,                                                       // KPI-OPS-11
            'disponibilidad' => $disponibilidad,                                                         // KPI-OPS-12
            'mrr_en_mora' => $pct($mora + $soloLectura, $mrrFin + $soloLectura),                         // KPI-OPS-13
            'resolucion_horas' => $resolucion,                                                           // KPI-OPS-14
            'horas_acceso_soporte' => round($horasAcceso, 1),                                            // KPI-OPS-15
            'mrr_inicio' => round($mrrIni, 2), 'clientes_inicio' => $activosIni, 'cancelaciones' => $cancelados,
            // Movimiento del MRR (como el prototipo): inicio + nuevo + expansión − contracción − cancelado = cierre.
            'mrr_nuevo' => round($mrrNuevo, 2), 'mrr_expansion' => round($expansion, 2), 'mrr_contraccion' => round($contraccion, 2), 'mrr_cancelado' => round($mrrCancelado, 2),
            'pruebas_terminadas' => $pruebasTerminadas, 'pruebas_convertidas' => $pruebasConvertidas, 'tickets' => $tickets->count(),
            'facturado' => round($facturado, 2), 'cobrado' => round($cobrado, 2),
        ];
    }

    /** SUS-04: foto de uso del mes en curso de cada empresa con suscripción (la tarea diaria la actualiza). */
    public static function fotoDeUso(): int
    {
        $periodo = now()->format('Y-m');
        $uso = collect(DB::select('SELECT * FROM platform_tenant_usage()'))->keyBy('tenant_id');
        $n = 0;
        foreach (DB::table('subscriptions as s')->leftJoin('saas_plan_versions as v', 'v.id', '=', 's.plan_version_id')->where('s.status', '!=', 'CANCELLED')
            ->select('s.id', 's.tenant_id', 'v.users_max', 'v.brands_max', 'v.sites_max')->get() as $s) {
            $u = $uso[$s->tenant_id] ?? null;
            $extra = DB::table('subscription_addons as x')->join('saas_addons as a', 'a.code', '=', 'x.addon_code')->where('x.subscription_id', $s->id)
                ->where('x.status', 'ACTIVE')->where('a.kind', 'LIMIT')->selectRaw('a.limit_key, sum(x.quantity * a.unit_qty) AS n')->groupBy('a.limit_key')->pluck('n', 'limit_key');
            $lim = fn ($base, $k) => $base === null ? null : (int) $base + (int) ($extra[$k] ?? 0);
            DB::table('tenant_usage_snapshots')->upsert([[
                'tenant_id' => $s->tenant_id, 'period' => $periodo, 'users' => (int) ($u->users_active ?? 0), 'brands' => (int) ($u->brands_active ?? 0),
                'sites' => (int) ($u->sites_active ?? 0), 'users_limit' => $lim($s->users_max, 'users'), 'brands_limit' => $lim($s->brands_max, 'brands'),
                'sites_limit' => $lim($s->sites_max, 'sites'), 'taken_at' => now(),
            ]], ['tenant_id', 'period'], ['users', 'brands', 'sites', 'users_limit', 'brands_limit', 'sites_limit', 'taken_at']);
            $n++;
        }

        return $n;
    }
}
