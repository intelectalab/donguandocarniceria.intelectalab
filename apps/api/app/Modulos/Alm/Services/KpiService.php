<?php

namespace App\Modulos\Alm\Services;

use App\Modulos\Alm\Services\Soporte as S;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * Indicadores KPI-ALM-01 a 08, con los desgloses de la spec: 02 por motivo, línea y almacén;
 * 06 por proveedor; 08 por almacén, marca y línea. Filtros: desde, hasta, marca y local.
 */
final class KpiService
{
    /** @param  array{from?: ?string, to?: ?string, brand_id?: ?string, establishment_id?: ?string}  $p */
    public static function todos(array $p): array
    {
        $desde = CarbonImmutable::parse($p['from'] ?? S::hoy()->startOfMonth()->toDateString(), 'America/Lima')->startOfDay();
        $hasta = CarbonImmutable::parse($p['to'] ?? S::hoy()->toDateString(), 'America/Lima')->endOfDay();
        $dias = max(1, (int) $desde->diffInDays($hasta->startOfDay()) + 1);
        $marca = $p['brand_id'] ?? null;
        $local = $p['establishment_id'] ?? null;

        $saldos = fn () => DB::table('stock_balances as b')->join('warehouses as w', 'w.id', '=', 'b.warehouse_id')->join('product_variants as v', 'v.id', '=', 'b.variant_id')
            ->join('products as p', 'p.id', '=', 'v.product_id')->where('b.qty', '>', 0)
            ->when($marca, fn ($q) => $q->where('v.brand_id', $marca))->when($local, fn ($q) => $q->where('w.establishment_id', $local));
        $kardex = fn (string $tipo) => DB::table('stock_movements as m')->join('warehouses as w', 'w.id', '=', 'm.warehouse_id')->join('product_variants as v', 'v.id', '=', 'm.variant_id')
            ->join('products as p', 'p.id', '=', 'v.product_id')->where('m.movement_type', $tipo)->whereBetween('m.moved_at', [$desde, $hasta])
            ->when($marca, fn ($q) => $q->where('v.brand_id', $marca))->when($local, fn ($q) => $q->where('w.establishment_id', $local));

        // Costo de ventas del período: salidas SALE del kardex (a costo promedio).
        $cogs = (float) -$kardex('SALE')->sum('m.total_cost');
        $valor = (float) $saldos()->where('w.wh_type', '<>', 'TRANSIT')->sum(DB::raw('b.qty * b.avg_cost'));
        $mermas = (float) -$kardex('WASTE')->sum('m.total_cost');

        $vencidos = (float) DB::table('stock_waste_records as r')->join('waste_reasons as wr', 'wr.id', '=', 'r.reason_id')->join('product_variants as v', 'v.id', '=', 'r.variant_id')
            ->where('r.status', 'APPROVED')->where('wr.counts_as_expired', true)->whereBetween(DB::raw('coalesce(r.approved_at, r.requested_at)'), [$desde, $hasta])
            ->when($marca, fn ($q) => $q->where('v.brand_id', $marca))->when($local, fn ($q) => $q->where('r.establishment_id', $local))
            ->sum(DB::raw('coalesce(r.actual_cost, r.estimated_cost)'));

        $porVencer = AlertasService::vencimientos(['brand_id' => $marca, 'establishment_id' => $local])->where('days_left', '>=', 0);

        $lineasConteo = DB::table('stock_count_lines as l')->join('stock_counts as c', 'c.id', '=', 'l.count_id')
            ->whereIn('c.status', ['COUNTED', 'APPROVED'])->whereNotNull('l.counted_qty')->whereBetween('c.counted_at', [$desde, $hasta])
            ->when($local, fn ($q) => $q->where('c.establishment_id', $local))
            ->selectRaw('count(*) total, count(*) filter (where abs(l.counted_qty - l.system_qty) < 0.0005) exactas')->first();

        $recepciones = DB::table('stock_receipt_lines as l')->join('stock_receipts as r', 'r.id', '=', 'l.receipt_id')->leftJoin('suppliers as s', 's.id', '=', 'r.supplier_id')
            ->where('r.status', 'CONFIRMED')->whereBetween('r.received_at', [$desde, $hasta])->when($local, fn ($q) => $q->where('r.establishment_id', $local))
            ->groupBy('s.trade_name')
            ->selectRaw("coalesce(s.trade_name, 'Sin proveedor') proveedor, count(*) total, count(*) filter (where l.appearance <> 'OK' or l.qc_result = 'FAIL') observadas")->get();

        $pedidos = DB::table('sales_orders')->whereNotNull('confirmed_at')->whereBetween('confirmed_at', [$desde, $hasta])
            ->when($marca, fn ($q) => $q->where('brand_id', $marca))->when($local, fn ($q) => $q->where('establishment_id', $local))->pluck('id');
        $quiebres = $pedidos->isEmpty() ? 0 : DB::table('sales_order_lines as l')->whereIn('l.sales_order_id', $pedidos)
            ->whereRaw("l.qty > coalesce((select sum(r.qty) from stock_reservations r where r.order_line_id = l.id and r.status in ('ACTIVE','CONSUMED')), 0) + 0.0005")
            ->distinct()->count('l.sales_order_id');

        $pct = fn ($a, $b) => $b ? round($a / $b * 100, 2) : 0.0;
        $obs = (int) $recepciones->sum('observadas');
        $rec = (int) $recepciones->sum('total');

        return [
            'period' => ['from' => $desde->toDateString(), 'to' => $hasta->toDateString(), 'days' => $dias],
            'KPI-ALM-01' => ['name' => 'Días de inventario', 'value' => $cogs ? round($valor / $cogs * $dias, 1) : null, 'numerator' => S::t($valor, 2), 'denominator' => S::t($cogs, 2)],
            'KPI-ALM-02' => ['name' => 'Mermas', 'value' => $pct($mermas, $cogs), 'numerator' => S::t($mermas, 2), 'denominator' => S::t($cogs, 2),
                'by_reason' => DB::table('stock_waste_records as r')->join('waste_reasons as wr', 'wr.id', '=', 'r.reason_id')->join('product_variants as v', 'v.id', '=', 'r.variant_id')
                    ->where('r.status', 'APPROVED')->whereBetween(DB::raw('coalesce(r.approved_at, r.requested_at)'), [$desde, $hasta])
                    ->when($marca, fn ($q) => $q->where('v.brand_id', $marca))->when($local, fn ($q) => $q->where('r.establishment_id', $local))
                    ->groupBy('wr.name')->selectRaw('wr.name as label, round(sum(coalesce(r.actual_cost, r.estimated_cost)), 2) as value')->orderByDesc('value')->get(),
                'by_line' => $kardex('WASTE')->groupBy('p.line')->selectRaw('p.line as label, round(-sum(m.total_cost), 2) as value')->orderByDesc('value')->get(),
                'by_warehouse' => $kardex('WASTE')->groupBy('w.code')->selectRaw('w.code as label, round(-sum(m.total_cost), 2) as value')->orderByDesc('value')->get()],
            'KPI-ALM-03' => ['name' => 'Vencidos', 'value' => round($vencidos, 2)],
            'KPI-ALM-04' => ['name' => 'Stock por vencer', 'value' => round((float) $porVencer->sum(fn ($x) => (float) $x->value), 2),
                'd3' => round((float) $porVencer->where('days_left', '<=', 3)->sum(fn ($x) => (float) $x->value), 2),
                'd7' => round((float) $porVencer->sum(fn ($x) => (float) $x->value), 2)],
            'KPI-ALM-05' => ['name' => 'Exactitud del conteo', 'value' => $pct((int) $lineasConteo->exactas, (int) $lineasConteo->total), 'numerator' => (int) $lineasConteo->exactas, 'denominator' => (int) $lineasConteo->total],
            'KPI-ALM-06' => ['name' => 'Recepciones observadas', 'value' => $pct($obs, $rec), 'numerator' => $obs, 'denominator' => $rec,
                'by_supplier' => $recepciones->map(fn ($r) => ['label' => $r->proveedor, 'value' => $pct((int) $r->observadas, (int) $r->total), 'observed' => (int) $r->observadas, 'total' => (int) $r->total])->values()],
            'KPI-ALM-07' => ['name' => 'Quiebres de stock', 'value' => $pct($quiebres, $pedidos->count()), 'numerator' => $quiebres, 'denominator' => $pedidos->count()],
            'KPI-ALM-08' => ['name' => 'Valor del inventario', 'value' => round((float) $saldos()->sum(DB::raw('b.qty * b.avg_cost')), 2),
                'by_warehouse' => $saldos()->groupBy('w.code')->selectRaw('w.code as label, round(sum(b.qty * b.avg_cost), 2) as value')->orderByDesc('value')->get(),
                'by_brand' => $saldos()->join('brands as br', 'br.id', '=', 'v.brand_id')->groupBy('br.name')->selectRaw('br.name as label, round(sum(b.qty * b.avg_cost), 2) as value')->orderByDesc('value')->get(),
                'by_line' => $saldos()->groupBy('p.line')->selectRaw('p.line as label, round(sum(b.qty * b.avg_cost), 2) as value')->orderByDesc('value')->get()],
        ];
    }
}
