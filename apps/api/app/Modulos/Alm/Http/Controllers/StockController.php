<?php

namespace App\Modulos\Alm\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Alm\Services\InventarioService;
use App\Modulos\Alm\Services\Soporte as S;
use App\Support\Listado;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** ALM-02 Stock y ALM-03 Kardex. Los costos solo con alm.stock.view_cost. */
class StockController extends Controller
{
    use Alcance;

    private function base(Request $r)
    {
        $hoy = S::hoy()->toDateString();
        $q = DB::table('stock_balances as b')->join('warehouses as w', 'w.id', '=', 'b.warehouse_id')->join('product_variants as v', 'v.id', '=', 'b.variant_id')
            ->join('products as p', 'p.id', '=', 'v.product_id')->leftJoin('lots as l', 'l.id', '=', 'b.lot_id')->leftJoin('brands as br', 'br.id', '=', 'v.brand_id')
            ->leftJoin('establishments as e', 'e.id', '=', 'w.establishment_id')
            ->when(! $r->boolean('con_cero'), fn ($x) => $x->where('b.qty', '>', 0))
            ->when($r->query('warehouse_id'), fn ($x, $w) => $x->where('b.warehouse_id', $w))
            ->when($r->query('variant_id'), fn ($x, $v) => $x->where('b.variant_id', $v))
            ->when($r->query('lot_id'), fn ($x, $v) => $x->where('b.lot_id', $v))
            ->when($r->query('line'), fn ($x, $v) => $x->where('p.line', $v))
            ->when($r->query('lot_status'), fn ($x, $v) => $v === 'NONE' ? $x->whereNull('b.lot_id') : ($v === 'HOLD' ? $x->whereIn('l.qc_status', ['QUARANTINE', 'BLOCKED']) : $x->where('l.qc_status', $v)))
            ->when($r->query('expiring'), fn ($x) => $x->where('l.expiry_date', '<=', S::hoy()->addDays(7)->toDateString()))
            ->when($r->boolean('reserved'), fn ($x) => $x->where('b.reserved_qty', '>', 0));
        $this->porLocal($q, $r, 'w.establishment_id');
        $this->porMarca($q, $r, 'v.brand_id');

        return $q->selectRaw('b.id, b.warehouse_id, w.code as warehouse_code, w.name as warehouse_name, w.wh_type, w.establishment_id, e.short as establishment_short,
            b.variant_id, v.sku, v.name as variant_name, v.sale_mode, v.brand_id, br.name as brand_name, p.line, b.lot_id, l.code as lot_code, l.qc_status,
            l.expiry_date, (l.expiry_date - ?::date) as days_left, b.qty, b.reserved_qty, greatest(b.qty - b.reserved_qty, 0) as available_qty, b.weight_kg,
            b.avg_cost, round(b.qty * b.avg_cost, 2) as value', [$hoy]);
    }

    public function index(Request $r)
    {
        $pagina = Listado::de(DB::query()->fromSub($this->base($r), 's'), $r, buscar: ['sku', 'variant_name', 'lot_code', 'warehouse_code'],
            ordenar: ['sku', 'variant_name', 'warehouse_code', 'expiry_date', 'qty', 'available_qty', 'value', 'days_left'], porDefecto: 'expiry_date');
        $this->sinCostos($r, $pagina->getCollection(), ['avg_cost', 'value']);

        return response()->json($pagina);
    }

    public function resumen(Request $r)
    {
        $t = DB::query()->fromSub($this->base($r), 's')->selectRaw("count(*) saldos, count(distinct variant_id) variantes, coalesce(sum(value),0) valor,
            count(*) filter (where qc_status = 'QUARANTINE') en_cuarentena, count(*) filter (where qc_status in ('BLOCKED')) bloqueados,
            count(*) filter (where days_left < 0) vencidos, count(*) filter (where days_left between 0 and 7) por_vencer,
            coalesce(sum(value) filter (where days_left <= 7), 0) valor_por_vencer, count(*) filter (where reserved_qty > 0) con_reserva,
            coalesce(sum(reserved_qty * avg_cost), 0) valor_reservado, coalesce(sum(qty) filter (where qc_status in ('QUARANTINE','BLOCKED')), 0) retenido,
            coalesce(sum(qty), 0) cantidad, coalesce(sum(weight_kg), 0) peso,
            coalesce(sum(reserved_qty),0) reservado")->first();
        $ver = $this->verCostos($r);

        return response()->json([
            'balances' => (int) $t->saldos, 'variants' => (int) $t->variantes, 'value' => $this->verCostos($r) ? S::t($t->valor, 2) : null,
            'quarantine' => (int) $t->en_cuarentena, 'blocked' => (int) $t->bloqueados, 'expired' => (int) $t->vencidos, 'expiring' => (int) $t->por_vencer,
            'reserved' => S::t($t->reservado), 'reserved_balances' => (int) $t->con_reserva, 'reserved_value' => $ver ? S::t($t->valor_reservado, 2) : null,
            'expiring_value' => $ver ? S::t($t->valor_por_vencer, 2) : null, 'on_hold_qty' => S::t($t->retenido), 'qty' => S::t($t->cantidad), 'weight_kg' => S::t($t->peso),
        ]);
    }

    public function kardex(Request $r)
    {
        $q = DB::table('stock_movements as m')->join('warehouses as w', 'w.id', '=', 'm.warehouse_id')->join('product_variants as v', 'v.id', '=', 'm.variant_id')
            ->leftJoin('lots as l', 'l.id', '=', 'm.lot_id')->leftJoin('brands as br', 'br.id', '=', 'v.brand_id')
            ->when($r->query('warehouse_id'), fn ($x, $w) => $x->where('m.warehouse_id', $w))
            ->when($r->query('variant_id'), fn ($x, $v) => $x->where('m.variant_id', $v))
            ->when($r->query('lot_id'), fn ($x, $v) => $x->where('m.lot_id', $v))
            ->when($r->query('movement_type'), fn ($x, $v) => $x->where('m.movement_type', $v))
            ->when($r->query('source_type'), fn ($x, $v) => $x->where('m.source_type', $v))
            ->when($r->query('from'), fn ($x, $v) => $x->where('m.moved_at', '>=', $v))
            ->when($r->query('to'), fn ($x, $v) => $x->where('m.moved_at', '<', CarbonImmutable::parse($v)->addDay()->toDateString()));
        $this->porLocal($q, $r, 'w.establishment_id');
        $this->porMarca($q, $r, 'v.brand_id');
        $q->selectRaw('m.id, m.moved_at, m.movement_type, m.source_type, m.source_id, m.reason, m."user" as user_name, m.qty, m.weight_kg, m.unit_cost, m.total_cost,
            m.bal_qty, m.reversal_of, m.warehouse_id, w.code as warehouse_code, m.variant_id, v.sku, v.name as variant_name, v.sale_mode, m.lot_id, l.code as lot_code,
            br.name as brand_name, '.PantallaController::documentoSql('m').' as document,
            exists(select 1 from stock_movements x where x.reversal_of = m.id) as reversed');
        $pagina = Listado::de(DB::query()->fromSub($q, 's'), $r, buscar: ['sku', 'variant_name', 'lot_code', 'reason', 'user_name', 'document'],
            ordenar: ['moved_at', 'sku', 'movement_type', 'qty'], porDefecto: '-moved_at');
        $this->sinCostos($r, $pagina->getCollection(), ['unit_cost', 'total_cost']);

        return response()->json($pagina);
    }

    public function reversar(Request $r, string $id)
    {
        $d = $r->validate(['reason' => 'required|string|min:10|max:200']);

        return response()->json(InventarioService::reversar($id, $d['reason'], $r->user()));
    }
}
