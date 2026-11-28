<?php

namespace App\Modulos\Pre\Services;

use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * PRE-11 Tablero de preparación: olas del día, avance por pedido y preparador, atrasados frente a su
 * franja; y los indicadores del mes (KPI-PRE-01 a KPI-PRE-07).
 */
final class Indicadores
{
    /** @return array{0: CarbonImmutable, 1: CarbonImmutable} */
    public static function mes(string $mes): array
    {
        $ini = CarbonImmutable::parse($mes.'-01 00:00', 'America/Lima');

        return [$ini, $ini->addMonth()];
    }

    /** RN de KPI-PRE-07: hora en que el pedido debe estar listo (inicio de la franja menos pre_ready_lead_minutes). */
    public static function horaListo(object $t): ?CarbonImmutable
    {
        if (! $t->delivery_date || ! $t->slot_from) {
            return null;
        }
        $min = (int) Base::num('pre_ready_lead_minutes', 60, $t->brand_id);

        return CarbonImmutable::parse(substr($t->delivery_date, 0, 10).' '.substr($t->slot_from, 0, 5), 'America/Lima')->subMinutes($min);
    }

    public static function dia(string $fecha, User $u, ?string $local = null, ?string $marca = null): array
    {
        $ahora = CarbonImmutable::now('America/Lima');
        $q = DB::table('picking_tasks as t')->join('picking_waves as w', 'w.id', '=', 't.wave_id')->join('sales_orders as o', 'o.id', '=', 't.order_id')
            ->leftJoin('users as p', 'p.id', '=', 't.preparer_user_id')
            ->where('w.wave_date', $fecha)->whereNotIn('w.status', ['CANCELLED'])->where('t.status', '<>', 'CANCELLED')
            ->when($local, fn ($x, $v) => $x->where('t.establishment_id', $v))->when($marca, fn ($x, $v) => $x->where('t.brand_id', $v));
        Base::alcanceTareas($q, $u);
        $tareas = $q->orderBy('t.slot_from')->orderBy('t.order_number')
            ->get(['t.*', 'w.number as wave_number', 'w.status as wave_status', 'o.customer_id', 'o.status as order_status', 'p.name as preparador']);

        $filas = $tareas->map(function ($t) use ($ahora) {
            $listo = self::horaListo($t);
            $hecho = in_array($t->status, ['VERIFIED', 'LOADED'], true);

            return [
                'id' => $t->id, 'order_id' => $t->order_id, 'pedido' => $t->order_number, 'cliente' => Base::cliente($t->customer_id), 'ola' => $t->wave_number,
                'estado' => $t->status, 'estado_pedido' => $t->order_status, 'franja' => $t->slot_from ? substr($t->slot_from, 0, 5).'–'.substr((string) $t->slot_to, 0, 5) : null,
                'ruta' => $t->route_code, 'parada' => $t->stop_seq, 'preparador' => $t->preparador, 'avance' => Tareas::avance($t),
                'listo_a' => $listo?->format('H:i'), 'atrasado' => ! $hecho && $listo !== null && $ahora->greaterThan($listo),
                'stock_error' => $t->stock_error,
            ];
        });

        $olas = DB::table('picking_waves as w')->where('w.wave_date', $fecha)->where('w.status', '<>', 'CANCELLED')
            ->when($local, fn ($x, $v) => $x->where('w.establishment_id', $v))->leftJoin('establishments as e', 'e.id', '=', 'w.establishment_id');
        Base::alcanceOlas($olas, $u);
        $olas = $olas->orderBy('w.slot_from')->orderBy('w.number')->get(['w.id', 'w.number', 'w.status', 'w.slot_from', 'w.slot_to', 'e.name as local'])
            ->map(function ($w) use ($filas) {
                $mias = $filas->where('ola', $w->number);

                return ['id' => $w->id, 'numero' => $w->number, 'estado' => $w->status, 'local' => $w->local,
                    'franja' => $w->slot_from ? substr($w->slot_from, 0, 5).'–'.substr((string) $w->slot_to, 0, 5) : null,
                    'pedidos' => $mias->count(), 'verificados' => $mias->whereIn('estado', ['VERIFIED', 'LOADED'])->count(),
                    'avance' => $mias->count() ? (int) round($mias->avg('avance')) : 0, 'atrasados' => $mias->where('atrasado', true)->count()];
            })->values();

        $preparadores = $filas->whereNotNull('preparador')->groupBy('preparador')->map(fn ($g, $n) => [
            'nombre' => $n, 'pedidos' => $g->count(), 'terminados' => $g->whereIn('estado', ['PICKED', 'PACKED', 'VERIFIED', 'LOADED'])->count(),
            'en_armado' => $g->where('estado', 'PICKING')->count(),
        ])->sortByDesc('pedidos')->values();

        return [
            'fecha' => $fecha, 'hora' => $ahora->format('H:i'), 'es_hoy' => $fecha === $ahora->toDateString(),
            'olas' => $olas, 'tareas' => $filas->values(), 'preparadores' => $preparadores,
            'cifras' => [
                'pedidos' => $filas->count(), 'pendientes' => $filas->where('estado', 'PENDING')->count(), 'en_armado' => $filas->where('estado', 'PICKING')->count(),
                'armados' => $filas->whereIn('estado', ['PICKED', 'PACKED'])->count(), 'verificados' => $filas->whereIn('estado', ['VERIFIED', 'LOADED'])->count(),
                'atrasados' => $filas->where('atrasado', true)->count(),
                'bloqueos' => (int) Base::alcanceTareas(DB::table('picking_scans as s')->join('picking_tasks as t', 't.id', '=', 's.task_id')
                    ->where('s.scan_type', 'PICK')->where('s.result', '<>', 'OK')->whereRaw("(s.scanned_at AT TIME ZONE 'America/Lima')::date = ?", [$fecha])
                    ->when($local, fn ($x, $v) => $x->where('t.establishment_id', $v)), $u)->count(),
            ],
        ];
    }

    public static function kpis(string $mes, User $u, ?string $local = null): array
    {
        [$ini, $fin] = self::mes($mes);
        $tareas = fn () => Base::alcanceTareas(DB::table('picking_tasks as t'), $u)->when($local, fn ($x, $v) => $x->where('t.establishment_id', $v));

        // KPI-PRE-01: tareas verificadas por hora-persona (por preparador).
        $verif = $tareas()->leftJoin('users as p', 'p.id', '=', 't.preparer_user_id')->whereIn('t.status', ['VERIFIED', 'LOADED'])
            ->whereNotNull('t.started_at')->whereNotNull('t.finished_at')->where('t.finished_at', '>=', $ini)->where('t.finished_at', '<', $fin)
            ->get(['t.id', 't.started_at', 't.finished_at', 't.delivery_date', 't.slot_from', 't.brand_id', 't.verified_at', 't.order_id', 'p.name as preparador']);
        $horas = fn ($g) => $g->sum(fn ($t) => max(0, CarbonImmutable::parse($t->finished_at)->diffInSeconds(CarbonImmutable::parse($t->started_at), true)) / 3600);
        $porHora = fn ($g) => ($h = $horas($g)) > 0 ? round($g->count() / $h, 1) : null;
        $porPreparador = $verif->whereNotNull('preparador')->groupBy('preparador')
            ->map(fn ($g, $n) => ['nombre' => $n, 'pedidos' => $g->count(), 'por_hora' => $porHora($g)])->sortByDesc('pedidos')->values();

        // KPI-PRE-02: mediana de confirmado a listo, en minutos.
        $conf = DB::table('sales_orders')->whereIn('id', $verif->pluck('order_id'))->pluck('confirmed_at', 'id');
        $mins = $verif->map(fn ($t) => isset($conf[$t->order_id]) && $conf[$t->order_id]
            ? CarbonImmutable::parse($conf[$t->order_id])->diffInMinutes(CarbonImmutable::parse($t->finished_at), false) : null)
            ->filter(fn ($m) => $m !== null && $m >= 0)->sort()->values();
        $mediana = $mins->isEmpty() ? null : round($mins->count() % 2 ? $mins[intdiv($mins->count(), 2)] : ($mins[$mins->count() / 2 - 1] + $mins[$mins->count() / 2]) / 2);

        // KPI-PRE-03 (CA-PRE-08): pedidos con error en entrega o reclamo / pedidos entregados × 100.
        $entregados = Base::alcanceTareas(DB::table('sales_orders as t'), $u)->when($local, fn ($x, $v) => $x->where('t.establishment_id', $v))
            ->whereNotNull('t.delivered_at')->where('t.delivered_at', '>=', $ini)->where('t.delivered_at', '<', $fin)->count();
        $conError = DB::table('packing_errors as e')->join('sales_orders as t', 't.id', '=', 'e.order_id')
            ->whereIn('e.detected_at_stage', Errores::LLEGARON_AL_CLIENTE)->where('e.detected_at', '>=', $ini)->where('e.detected_at', '<', $fin)
            ->when($local, fn ($x, $v) => $x->where('t.establishment_id', $v));
        $conError = Base::alcanceTareas($conError, $u)->distinct()->count('e.order_id');
        $pctError = $entregados > 0 ? round($conError / $entregados * 100, 2) : null;

        // KPI-PRE-04: líneas completas con al menos una lectura correcta / líneas completas o con faltante aprobado.
        $lineas = DB::table('picking_task_lines as l')->joinSub($tareas()->select('t.id', 't.finished_at'), 'tt', 'tt.id', '=', 'l.task_id')
            ->where('tt.finished_at', '>=', $ini)->where('tt.finished_at', '<', $fin)->whereIn('l.status', ['DONE', 'SHORT_APPROVED']);
        $totalLineas = (clone $lineas)->count();
        $conLectura = (clone $lineas)->whereExists(fn ($x) => $x->from('picking_scans as s')->whereColumn('s.task_line_id', 'l.id')->where('s.result', 'OK')->where('s.scan_type', 'PICK'))->count();

        // KPI-PRE-05: lecturas bloqueadas por motivo y por preparador.
        $bloqueos = DB::table('picking_scans as s')->join('picking_tasks as t', 't.id', '=', 's.task_id')->leftJoin('users as p', 'p.id', '=', 's.user_id')
            ->where('s.scan_type', 'PICK')->where('s.result', '<>', 'OK')->whereNull('s.override_of')
            ->where('s.scanned_at', '>=', $ini)->where('s.scanned_at', '<', $fin)->when($local, fn ($x, $v) => $x->where('t.establishment_id', $v));
        $bloqueos = Base::alcanceTareas($bloqueos, $u);
        $porMotivo = (clone $bloqueos)->groupBy('s.result')->selectRaw('s.result, count(*) n')->orderByDesc('n')->get()
            ->map(fn ($r) => ['motivo' => Base::RESULTADOS[$r->result] ?? $r->result, 'n' => (int) $r->n]);
        $porQuien = (clone $bloqueos)->groupBy('p.name')->selectRaw('p.name, count(*) n')->orderByDesc('n')->limit(10)->get()
            ->map(fn ($r) => ['nombre' => $r->name ?? '—', 'n' => (int) $r->n]);

        // KPI-PRE-06: desviación de peso = Σ|real − estimado| / Σ estimado × 100.
        $peso = DB::table('picking_task_lines as l')->joinSub($tareas()->select('t.id', 't.finished_at'), 'tt', 'tt.id', '=', 'l.task_id')
            ->where('tt.finished_at', '>=', $ini)->where('tt.finished_at', '<', $fin)->where('l.weighted', true)->whereNotNull('l.weighed_kg')->where('l.est_weight_kg', '>', 0)
            ->where('l.status', 'DONE')->selectRaw('coalesce(sum(abs(l.weighed_kg - l.est_weight_kg)), 0) dif, coalesce(sum(l.est_weight_kg), 0) est')->first();
        $desvio = (float) $peso->est > 0 ? round((float) $peso->dif / (float) $peso->est * 100, 1) : null;

        // KPI-PRE-07: verificadas antes del inicio de la franja menos pre_ready_lead_minutes.
        $conFranja = $verif->filter(fn ($t) => $t->verified_at && self::horaListo($t));
        $aTiempo = $conFranja->filter(fn ($t) => CarbonImmutable::parse($t->verified_at)->lessThanOrEqualTo(self::horaListo($t)))->count();

        return [
            'mes' => $mes,
            'por_hora' => $porHora($verif), 'verificados' => $verif->count(), 'por_preparador' => $porPreparador,
            'mediana_min' => $mediana,
            'entregados' => $entregados, 'con_error' => $conError, 'error_pct' => $pctError,
            'lineas' => $totalLineas, 'lineas_escaneadas_pct' => $totalLineas ? round($conLectura / $totalLineas * 100, 1) : null,
            'bloqueos' => (clone $bloqueos)->count(), 'bloqueos_por_motivo' => $porMotivo, 'bloqueos_por_preparador' => $porQuien,
            'desvio_peso_pct' => $desvio,
            'a_tiempo_pct' => $conFranja->count() ? round($aTiempo / $conFranja->count() * 100, 1) : null, 'con_franja' => $conFranja->count(),
        ];
    }
}
