<?php

namespace App\Modulos\Pro\Services;

use App\Modulos\Rec\Services\RecetasService;
use App\Support\Params;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * PRO-02 Plan semanal, PRO-03 Requerimiento de insumos y PRO-12 Tablero (KPI-PRO-01 a 07). Solo lee.
 *
 *  Necesidad = pedidos confirmados de la semana + stock de seguridad − stock liberado − órdenes abiertas.
 *  Stock de seguridad = venta diaria promedio de los últimos 28 días × pro_safety_stock_days.
 */
final class PlanService
{
    private const PEDIDOS_VIVOS = ['CONFIRMED', 'IN_PREPARATION', 'WEIGHED', 'READY'];

    private const ORDENES_ABIERTAS = ['PLANNED', 'RELEASED', 'IN_PROGRESS'];

    /** PRO-02: un renglón por producto que se fabrica con receta aprobada, con la orden sugerida. */
    public static function plan(string $desde, array $locales = []): array
    {
        $d = CarbonImmutable::parse($desde, 'America/Lima');
        $hasta = $d->addDays(6)->toDateString();
        $dias = (float) (Params::get('pro_safety_stock_days') ?? 2);
        $recetas = DB::table('recipes as r')->join('recipe_versions as v', fn ($j) => $j->on('v.recipe_id', '=', 'r.id')->where('v.status', 'APPROVED'))
            ->join('product_variants as pv', 'pv.id', '=', 'r.output_variant_id')->join('products as p', 'p.id', '=', 'r.product_id')
            ->leftJoin('brands as b', 'b.id', '=', 'r.brand_id')
            ->where('r.status', 'ACTIVE')
            ->get(['r.id as recipe_id', 'r.code as recipe_code', 'r.name as recipe_name', 'r.output_variant_id', 'pv.sku', 'pv.name as variant_name', 'p.name as product_name',
                'b.name as brand_name', 'v.version', 'v.base_output_kg', 'v.standard_cost_per_kg']);
        $ids = $recetas->pluck('output_variant_id')->all();
        $kgLinea = 'coalesce(l.weighed_kg, l.est_weight_kg, l.qty)';
        $pedidos = DB::table('sales_order_lines as l')->join('sales_orders as o', 'o.id', '=', 'l.sales_order_id')
            ->whereIn('l.variant_id', $ids)->whereIn('o.status', self::PEDIDOS_VIVOS)->whereBetween('o.delivery_date', [$d->toDateString(), $hasta])
            ->when($locales, fn ($q) => $q->whereIn('o.establishment_id', $locales))
            ->groupBy('l.variant_id')->selectRaw("l.variant_id, sum({$kgLinea}) as kg, count(distinct o.id) as orders")->get()->keyBy('variant_id');
        $venta = DB::table('sales_order_lines as l')->join('sales_orders as o', 'o.id', '=', 'l.sales_order_id')
            ->whereIn('l.variant_id', $ids)->whereIn('o.status', ['CLOSED', 'DELIVERED'])
            ->whereBetween('o.delivery_date', [$d->subDays(28)->toDateString(), $d->subDay()->toDateString()])
            ->when($locales, fn ($q) => $q->whereIn('o.establishment_id', $locales))
            ->groupBy('l.variant_id')->selectRaw("l.variant_id, sum({$kgLinea}) as kg")->pluck('kg', 'variant_id');
        $stock = DB::table('stock_balances as b')->join('warehouses as w', 'w.id', '=', 'b.warehouse_id')->leftJoin('lots as t', 't.id', '=', 'b.lot_id')
            ->whereIn('b.variant_id', $ids)->where(fn ($q) => $q->whereNull('b.lot_id')->orWhere('t.qc_status', 'RELEASED'))
            ->when($locales, fn ($q) => $q->whereIn('w.establishment_id', $locales))
            ->groupBy('b.variant_id')->selectRaw('b.variant_id, sum(coalesce(b.weight_kg, b.qty)) as kg')->pluck('kg', 'variant_id');
        $abiertas = DB::table('production_orders')->whereIn('output_variant_id', $ids)->whereIn('status', self::ORDENES_ABIERTAS)
            ->when($locales, fn ($q) => $q->whereIn('establishment_id', $locales))
            ->groupBy('output_variant_id')->selectRaw('output_variant_id, sum(planned_output_kg) as kg, count(*) as n')->get()->keyBy('output_variant_id');
        // Línea sugerida: la última que hizo esa receta.
        $lineas = DB::table('production_orders as o')->join('production_lines as pl', 'pl.id', '=', 'o.line_id')->join('establishments as s', 's.id', '=', 'pl.establishment_id')
            ->join('recipe_versions as v', 'v.id', '=', 'o.recipe_version_id')->where('pl.status', 'ACTIVE')
            ->when($locales, fn ($q) => $q->whereIn('pl.establishment_id', $locales))
            ->orderByDesc('o.planned_date')->get(['v.recipe_id', 'pl.id', 'pl.code', 'pl.name', DB::raw('coalesce(s.short, s.name) as establishment_name')])
            ->unique('recipe_id')->keyBy('recipe_id');

        $filas = $recetas->map(function ($r) use ($pedidos, $venta, $stock, $abiertas, $lineas, $dias) {
            $ped = (float) ($pedidos[$r->output_variant_id]->kg ?? 0);
            $seg = round((float) ($venta[$r->output_variant_id] ?? 0) / 28 * $dias, 3);
            $st = max(0, (float) ($stock[$r->output_variant_id] ?? 0));
            $ab = (float) ($abiertas[$r->output_variant_id]->kg ?? 0);
            $nec = round($ped + $seg - $st - $ab, 3);
            $base = (float) $r->base_output_kg ?: 1;
            $sugerido = $nec > 0 ? ceil($nec / $base) * $base : 0;
            $l = $lineas[$r->recipe_id] ?? null;

            return [
                'recipe_id' => $r->recipe_id, 'recipe_code' => $r->recipe_code, 'recipe_name' => $r->recipe_name, 'version' => $r->version,
                'variant_id' => $r->output_variant_id, 'sku' => $r->sku, 'variant_name' => $r->variant_name, 'brand_name' => $r->brand_name,
                'orders_kg' => Comun::t($ped), 'sales_orders' => (int) ($pedidos[$r->output_variant_id]->orders ?? 0), 'safety_kg' => Comun::t($seg),
                'released_stock_kg' => Comun::t($st), 'open_orders_kg' => Comun::t($ab), 'open_orders' => (int) ($abiertas[$r->output_variant_id]->n ?? 0),
                'need_kg' => Comun::t(max(0, $nec)), 'suggested_kg' => Comun::t($sugerido), 'base_output_kg' => Comun::t($base),
                'line_id' => $l?->id, 'line_code' => $l?->code, 'line_name' => $l?->name, 'establishment_name' => $l?->establishment_name,
            ];
        })->sortByDesc(fn ($f) => (float) $f['need_kg'])->values()->all();

        return ['from' => $d->toDateString(), 'to' => $hasta, 'safety_days' => Comun::t($dias, 1), 'data' => $filas,
            'totals' => ['need_kg' => Comun::t(array_sum(array_map(fn ($f) => (float) $f['need_kg'], $filas))), 'to_produce' => count(array_filter($filas, fn ($f) => (float) $f['need_kg'] > 0))]];
    }

    /**
     * PRO-03: explosión de las órdenes planificadas o liberadas del período con la receta escalada (RN-PRO-12),
     * frente al stock liberado del almacén de insumos de cada línea. Lo que falta es el requerimiento de compra.
     */
    public static function requerimiento(string $desde, string $hasta, array $locales = []): array
    {
        $ordenes = DB::table('production_orders as o')->join('production_lines as l', 'l.id', '=', 'o.line_id')
            ->whereIn('o.status', ['PLANNED', 'RELEASED'])->whereBetween('o.planned_date', [$desde, $hasta])->whereNotNull('o.recipe_version_id')
            ->when($locales, fn ($q) => $q->whereIn('o.establishment_id', $locales))
            ->get(['o.id', 'o.number', 'o.planned_date', 'o.recipe_version_id', 'o.planned_output_kg', 'l.input_warehouse_id']);
        $nec = [];
        foreach ($ordenes as $o) {
            $e = RecetasService::escalar($o->recipe_version_id, $o->planned_output_kg);
            foreach ($e['lines'] as $l) {
                $k = $l['variant_id'].'|'.$o->input_warehouse_id;
                $nec[$k] ??= ['variant_id' => $l['variant_id'], 'warehouse_id' => $o->input_warehouse_id, 'kg' => 0.0, 'orders' => []];
                $nec[$k]['kg'] += (float) $l['kg'];
                $nec[$k]['orders'][$o->number] = true;
            }
            foreach (Comun::empaques($e['packaging']) as $p) {
                $k = $p['variant_id'].'|'.$o->input_warehouse_id;
                $nec[$k] ??= ['variant_id' => $p['variant_id'], 'warehouse_id' => $o->input_warehouse_id, 'kg' => 0.0, 'orders' => []];
                $nec[$k]['kg'] += (float) $p['qty'];
                $nec[$k]['orders'][$o->number] = true;
            }
        }
        $vars = DB::table('product_variants as v')->join('products as p', 'p.id', '=', 'v.product_id')->whereIn('v.id', array_column($nec, 'variant_id'))
            ->get(['v.id', 'v.sku', 'v.name', 'v.sale_mode', 'v.std_cost', 'p.product_type'])->keyBy('id');
        $alm = DB::table('warehouses')->whereIn('id', array_column($nec, 'warehouse_id'))->get(['id', 'code', 'name'])->keyBy('id');
        $filas = [];
        foreach ($nec as $n) {
            $st = (float) DB::table('stock_balances as b')->leftJoin('lots as t', 't.id', '=', 'b.lot_id')->where('b.variant_id', $n['variant_id'])
                ->where('b.warehouse_id', $n['warehouse_id'])->where(fn ($q) => $q->whereNull('b.lot_id')->orWhere(fn ($x) => $x->where('t.qc_status', 'RELEASED')->where('t.expiry_date', '>=', $desde)))
                ->sum(DB::raw('coalesce(b.weight_kg, b.qty)'));
            $v = $vars[$n['variant_id']] ?? null;
            $falta = max(0, round($n['kg'] - $st, 3));
            $filas[] = ['variant_id' => $n['variant_id'], 'sku' => $v?->sku, 'name' => $v?->name, 'sale_mode' => $v?->sale_mode ?? 'KG',
                'packaging' => ($v?->product_type) === 'PACKAGING', 'warehouse_code' => $alm[$n['warehouse_id']]->code ?? null, 'warehouse_id' => $n['warehouse_id'],
                'required' => Comun::t($n['kg']), 'released_stock' => Comun::t($st), 'shortage' => Comun::t($falta),
                'estimated_cost' => Comun::t($falta * (float) ($v?->std_cost ?? 0), 2), 'orders' => array_keys($n['orders'])];
        }
        usort($filas, fn ($a, $b) => [(float) $b['shortage'] > 0, $a['sku']] <=> [(float) $a['shortage'] > 0, $b['sku']]);

        return ['from' => $desde, 'to' => $hasta, 'orders' => $ordenes->count(), 'data' => $filas,
            'totals' => ['items_short' => count(array_filter($filas, fn ($f) => (float) $f['shortage'] > 0)),
                'estimated_cost' => Comun::t(array_sum(array_map(fn ($f) => (float) $f['estimated_cost'], $filas)), 2)]];
    }

    /** PRO-12: KPI-PRO-01 a 07 del mes, con el detalle por línea y por producto. */
    public static function kpis(string $desde, string $hasta, array $locales = [], array $f = []): array
    {
        $base = DB::table('production_orders as o')->join('production_lines as l', 'l.id', '=', 'o.line_id')
            ->when($locales, fn ($q) => $q->whereIn('o.establishment_id', $locales))
            ->when($f['establishment_id'] ?? null, fn ($q, $v) => $q->where('o.establishment_id', $v))
            ->when($f['line_id'] ?? null, fn ($q, $v) => $q->where('o.line_id', $v))
            ->when($f['product_id'] ?? null, fn ($q, $v) => $q->where('o.product_id', $v));
        $cerradas = (clone $base)->leftJoin('products as p', 'p.id', '=', 'o.product_id')->where('o.status', 'CLOSED')->whereBetween('o.close_date', [$desde, $hasta])
            ->get(['o.id', 'o.order_type', 'o.line_id', 'l.code as line_code', 'l.name as line_name', 'o.product_id', 'p.name as product_name', 'o.input_kg', 'o.output_kg', 'o.main_kg',
                'o.waste_kg', 'o.total_cost', 'o.expected_yield_pct', 'o.standard_cost_per_kg', 'o.cost_per_kg', 'o.planned_date', 'o.close_date']);
        $sum = fn ($c, $k) => (float) $c->sum(fn ($o) => (float) $o->{$k});
        $horas = (float) DB::table('production_order_labor')->whereIn('order_id', $cerradas->pluck('id'))->sum('hours');
        $calc = function ($c) use ($sum) {
            $in = $sum($c, 'input_kg');
            $out = $sum($c, 'output_kg');
            $esp = $in > 0 ? $c->sum(fn ($o) => (float) $o->input_kg * (float) $o->expected_yield_pct) / $in : null;
            $conStd = $c->filter(fn ($o) => (float) $o->standard_cost_per_kg > 0 && $o->cost_per_kg !== null);
            $real = $conStd->sum(fn ($o) => (float) $o->total_cost);
            $stdKg = $conStd->sum(fn ($o) => (float) $o->main_kg);

            return ['orders' => $c->count(), 'produced_kg' => Comun::t($sum($c, 'main_kg')), 'input_kg' => Comun::t($in),
                'yield_vs_expected_pp' => $in > 0 && $esp !== null ? Comun::t($out / $in * 100 - $esp, 2) : null,
                'waste_pct' => $in > 0 ? Comun::t($sum($c, 'waste_kg') / $in * 100, 2) : null,
                'cost_per_kg' => $out > 0 ? Comun::t($sum($c, 'total_cost') / $out, 4) : null, 'total_cost' => Comun::t($sum($c, 'total_cost'), 2),
                'recipe_vs_actual_pct' => $stdKg > 0 ? Comun::t((($real / $stdKg) - ($conStd->sum(fn ($o) => (float) $o->standard_cost_per_kg * (float) $o->main_kg) / $stdKg))
                    / ($conStd->sum(fn ($o) => (float) $o->standard_cost_per_kg * (float) $o->main_kg) / $stdKg) * 100, 2) : null];
        };
        $planificadas = (clone $base)->whereBetween('o.planned_date', [$desde, $hasta])->where('o.status', '<>', 'VOIDED')->get(['o.status', 'o.planned_date', 'o.close_date']);
        $aTiempo = $planificadas->filter(fn ($o) => $o->status === 'CLOSED' && $o->close_date !== null && $o->close_date <= $o->planned_date)->count();
        $k = $calc($cerradas) + [
            'labor_hours' => Comun::t($horas, 1), 'productivity_kg_h' => $horas > 0 ? Comun::t($sum($cerradas, 'main_kg') / $horas, 2) : null,
            'planned_orders' => $planificadas->count(), 'on_time_orders' => $aTiempo,
            'plan_compliance_pct' => $planificadas->count() ? Comun::t($aTiempo / $planificadas->count() * 100, 1) : null,
        ];
        $porLinea = $cerradas->groupBy('line_id')->map(fn ($c) => ['line_id' => $c->first()->line_id, 'line_code' => $c->first()->line_code, 'line_name' => $c->first()->line_name] + $calc($c))->values()->sortBy('line_code')->values();
        $porProducto = $cerradas->groupBy('product_id')->map(fn ($c) => ['product_id' => $c->first()->product_id, 'product_name' => $c->first()->product_name] + $calc($c))
            ->sortByDesc(fn ($x) => (float) $x['produced_kg'])->values();
        // Seis meses hasta el elegido, para la tendencia.
        $fin = CarbonImmutable::parse($hasta);
        $tendencia = [];
        for ($i = 5; $i >= 0; $i--) {
            $m = $fin->startOfMonth()->subMonths($i);
            $c = (clone $base)->where('o.status', 'CLOSED')->whereBetween('o.close_date', [$m->toDateString(), $m->endOfMonth()->toDateString()])
                ->selectRaw('sum(o.main_kg) as kg, sum(o.input_kg) as entrada, sum(o.waste_kg) as merma, sum(o.total_cost) as costo, sum(o.output_kg) as salida')->first();
            $tendencia[] = ['month' => $m->format('Y-m'), 'produced_kg' => Comun::t($c->kg ?? 0), 'waste_pct' => (float) $c->entrada > 0 ? Comun::t($c->merma / $c->entrada * 100, 2) : null,
                'cost_per_kg' => (float) $c->salida > 0 ? Comun::t($c->costo / $c->salida, 4) : null];
        }

        return ['period' => ['from' => $desde, 'to' => $hasta], 'kpis' => $k, 'by_line' => $porLinea, 'by_product' => $porProducto, 'trend' => $tendencia];
    }
}
