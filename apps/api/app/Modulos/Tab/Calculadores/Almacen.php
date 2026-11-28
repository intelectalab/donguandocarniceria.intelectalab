<?php

namespace App\Modulos\Tab\Calculadores;

use App\Modulos\Alm\Services\KpiService;
use App\Modulos\Pre\Services\Errores;
use App\Modulos\Pre\Services\Indicadores;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * Calculadores de almacén y preparación: PRE (con las mismas reglas que PRE-11, sin el alcance del usuario) y ALM
 * (KpiService de ALM, que ya calcula los ocho).
 */
final class Almacen
{
    /** Resultado de KpiService::todos por rango, para no repetir el cálculo de ALM en cada indicador. */
    private static array $alm = [];

    public static function todos(): array
    {
        $alm = fn (string $code) => function (Periodo $p) use ($code) {
            $k = self::alm($p)[$code] ?? null;

            return $k ? Periodo::valor($k['value'] === null ? null : (float) $k['value'], isset($k['numerator']) ? (float) $k['numerator'] : null,
                isset($k['denominator']) ? (float) $k['denominator'] : null) : Periodo::valor(null);
        };

        return [
            'KPI-PRE-01' => function (Periodo $p) {
                $v = self::verificadas($p);
                $horas = $v->sum(fn ($t) => max(0, CarbonImmutable::parse($t->finished_at)->diffInSeconds(CarbonImmutable::parse($t->started_at), true)) / 3600);

                return Periodo::razon($v->count(), $horas, 1);
            },
            'KPI-PRE-02' => function (Periodo $p) {
                $v = self::verificadas($p);
                $conf = DB::table('sales_orders')->whereIn('id', $v->pluck('order_id'))->pluck('confirmed_at', 'id');
                $mins = $v->map(fn ($t) => ($c = $conf[$t->order_id] ?? null) ? CarbonImmutable::parse($c)->diffInMinutes(CarbonImmutable::parse($t->finished_at), false) : null)
                    ->filter(fn ($m) => $m !== null && $m >= 0)->all();

                return Periodo::valor(Periodo::mediana($mins), null, count($mins), 0);
            },
            'KPI-PRE-03' => function (Periodo $p) {
                $entregados = $p->enRango($p->pedidos()->whereNotNull('o.delivered_at'), 'o.delivered_at');
                $conError = $p->enRango(DB::table('packing_errors as e')->join('sales_orders as o', 'o.id', '=', 'e.order_id')
                    ->whereIn('e.detected_at_stage', Errores::LLEGARON_AL_CLIENTE), 'e.detected_at')
                    ->when($p->marca, fn ($q, $v) => $q->where('o.brand_id', $v))->when($p->local, fn ($q, $v) => $q->where('o.establishment_id', $v))
                    ->distinct()->count('e.order_id');

                return Periodo::pct($conError, $entregados->count());
            },
            'KPI-PRE-04' => function (Periodo $p) {
                $l = fn () => self::lineas($p)->whereIn('l.status', ['DONE', 'SHORT_APPROVED']);
                $con = $l()->whereExists(fn ($x) => $x->from('picking_scans as s')->whereColumn('s.task_line_id', 'l.id')->where('s.result', 'OK')->where('s.scan_type', 'PICK'))->count();

                return Periodo::pct($con, $l()->count(), 1);
            },
            'KPI-PRE-05' => fn (Periodo $p) => Periodo::total($p->enRango(self::tareas($p)->join('picking_scans as s', 's.task_id', '=', 't.id'), 's.scanned_at')
                ->where('s.scan_type', 'PICK')->where('s.result', '<>', 'OK')->whereNull('s.override_of')->count(), 0),
            'KPI-PRE-06' => function (Periodo $p) {
                $k = self::lineas($p)->where('l.weighted', true)->whereNotNull('l.weighed_kg')->where('l.est_weight_kg', '>', 0)->where('l.status', 'DONE')
                    ->selectRaw('coalesce(sum(abs(l.weighed_kg - l.est_weight_kg)), 0) dif, coalesce(sum(l.est_weight_kg), 0) est')->first();

                return Periodo::pct((float) $k->dif, (float) $k->est, 1);
            },
            'KPI-PRE-07' => function (Periodo $p) {
                $con = self::verificadas($p)->filter(fn ($t) => $t->verified_at && Indicadores::horaListo($t));
                $ok = $con->filter(fn ($t) => CarbonImmutable::parse($t->verified_at)->lessThanOrEqualTo(Indicadores::horaListo($t)))->count();

                return Periodo::pct($ok, $con->count(), 1);
            },

            'KPI-ALM-01' => $alm('KPI-ALM-01'), 'KPI-ALM-02' => $alm('KPI-ALM-02'), 'KPI-ALM-03' => $alm('KPI-ALM-03'), 'KPI-ALM-04' => $alm('KPI-ALM-04'),
            'KPI-ALM-05' => $alm('KPI-ALM-05'), 'KPI-ALM-06' => $alm('KPI-ALM-06'), 'KPI-ALM-07' => $alm('KPI-ALM-07'), 'KPI-ALM-08' => $alm('KPI-ALM-08'),
        ];
    }

    public static function olvidar(): void
    {
        self::$alm = [];
    }

    private static function alm(Periodo $p): array
    {
        $k = implode('|', [\App\Support\TenantContext::id() ?? '', $p->desde, $p->hasta, $p->marca, $p->local]);

        return self::$alm[$k] ??= KpiService::todos(['from' => $p->desde, 'to' => $p->hasta, 'brand_id' => $p->marca, 'establishment_id' => $p->local]);
    }

    public static function tareas(Periodo $p)
    {
        return $p->filtrar(DB::table('picking_tasks as t'), 't.brand_id', 't.establishment_id');
    }

    /** Tareas verificadas o cargadas que terminaron en el rango. */
    public static function verificadas(Periodo $p)
    {
        return $p->enRango(self::tareas($p)->whereIn('t.status', ['VERIFIED', 'LOADED'])->whereNotNull('t.started_at')->whereNotNull('t.finished_at'), 't.finished_at')
            ->get(['t.id', 't.started_at', 't.finished_at', 't.delivery_date', 't.slot_from', 't.brand_id', 't.verified_at', 't.order_id']);
    }

    private static function lineas(Periodo $p)
    {
        return DB::table('picking_task_lines as l')->joinSub($p->enRango(self::tareas($p), 't.finished_at')->select('t.id'), 'tt', 'tt.id', '=', 'l.task_id');
    }
}
