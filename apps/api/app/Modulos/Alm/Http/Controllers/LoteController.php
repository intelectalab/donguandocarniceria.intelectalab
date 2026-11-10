<?php

namespace App\Modulos\Alm\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Alm\Services\LotesService;
use App\Modulos\Alm\Services\Soporte as S;
use App\Support\Listado;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** ALM-05 Lotes y ALM-06 Liberar o bloquear lote. */
class LoteController extends Controller
{
    use Alcance;

    public function index(Request $r)
    {
        $hoy = S::hoy()->toDateString();
        $stock = $r->query('stock', $r->boolean('todos') ? 'ALL' : 'WITH');
        $conStock = fn ($e) => $e->from('stock_balances as b')->whereColumn('b.lot_id', 'l.id')->where('b.qty', '>', 0);
        $q = DB::table('lots as l')->join('product_variants as v', 'v.id', '=', 'l.variant_id')->join('products as p', 'p.id', '=', 'v.product_id')
            ->leftJoin('suppliers as s', 's.id', '=', 'l.supplier_id')->leftJoin('brands as br', 'br.id', '=', 'v.brand_id')
            ->when($r->query('qc_status'), fn ($x, $s) => $x->whereIn('l.qc_status', explode(',', $s)))
            ->when($r->query('variant_id'), fn ($x, $s) => $x->where('l.variant_id', $s))
            ->when($r->query('line'), fn ($x, $s) => $x->where('p.line', $s))
            ->when($r->query('expiring'), fn ($x) => $x->where('l.expiry_date', '<=', S::hoy()->addDays(7)->toDateString()))
            ->when($stock === 'WITH', fn ($x) => $x->whereExists($conStock))
            ->when($stock === 'WITHOUT', fn ($x) => $x->whereNotExists($conStock));
        $this->porMarca($q, $r, 'v.brand_id');
        $q->selectRaw("l.id, l.code, l.qc_status, l.origin, l.production_date, l.expiry_date, (l.expiry_date - ?::date) as days_left, l.block_reason,
            l.released_at, l.released_by, v.id as variant_id, v.sku, v.name as variant_name, v.sale_mode, s.trade_name as supplier_name, br.name as brand_name, p.line,
            (select round(coalesce(sum(b.qty * b.avg_cost), 0), 2) from stock_balances b where b.lot_id = l.id) as value,
            (select coalesce(sum(b.qty),0) from stock_balances b where b.lot_id = l.id) as stock_qty,
            (select coalesce(sum(b.reserved_qty),0) from stock_balances b where b.lot_id = l.id) as reserved_qty,
            (select string_agg(w.code || ': ' || trim(to_char(b.qty, 'FM999990.###')), ', ') from stock_balances b join warehouses w on w.id = b.warehouse_id where b.lot_id = l.id and b.qty > 0) as stock_by_warehouse,
            l.created_at", [$hoy]);

        $pagina = Listado::de(DB::query()->fromSub($q, 's'), $r, buscar: ['code', 'sku', 'variant_name', 'supplier_name'],
            ordenar: ['code', 'expiry_date', 'qc_status', 'sku', 'stock_qty', 'value', 'production_date', 'created_at'], porDefecto: 'expiry_date');
        $this->sinCostos($r, $pagina->getCollection(), ['value']);

        return response()->json($pagina);
    }

    public function show(Request $r, string $id)
    {
        $l = DB::table('lots as l')->join('product_variants as v', 'v.id', '=', 'l.variant_id')->leftJoin('suppliers as s', 's.id', '=', 'l.supplier_id')
            ->leftJoin('brands as br', 'br.id', '=', 'v.brand_id')->join('products as p', 'p.id', '=', 'v.product_id')
            ->where('l.id', $id)->first(['l.*', 'v.sku', 'v.name as variant_name', 'v.sale_mode', 's.trade_name as supplier_name', 'br.name as brand_name', 'p.line', 'p.storage']);
        abort_unless($l, 404);
        if (! $this->verCostos($r)) {
            $l->unit_cost = null;
        }
        $l->movements = DB::table('stock_movements as m')->join('warehouses as w', 'w.id', '=', 'm.warehouse_id')->where('m.lot_id', $id)
            ->orderByDesc('m.moved_at')->limit(50)->get(['m.id', 'm.moved_at', 'm.movement_type', 'm.source_type', 'm.reason', 'm.user as user_name', 'm.qty', 'm.bal_qty', 'w.code as warehouse_code']);
        $l->days_left = S::diasDeVida($l->expiry_date);
        $l->stock = DB::table('stock_balances as b')->join('warehouses as w', 'w.id', '=', 'b.warehouse_id')->where('b.lot_id', $id)
            ->orderBy('w.pick_priority')->get(['b.id', 'b.warehouse_id', 'w.code as warehouse_code', 'w.name as warehouse_name', 'w.wh_type', 'b.qty', 'b.reserved_qty', 'b.weight_kg']);
        $l->history = DB::table('lot_status_changes as c')->leftJoin('users as u', 'u.id', '=', 'c.changed_by')->where('c.lot_id', $id)
            ->orderBy('c.changed_at')->get(['c.id', 'c.from_status', 'c.to_status', 'c.reason', 'c.changed_at', 'u.name as changed_by_name']);
        $l->orders = DB::table('stock_reservations')->where('lot_id', $id)->groupBy('order_id', 'order_number', 'status')
            ->selectRaw('order_id, order_number, status, sum(qty) qty')->orderBy('order_number')->get()
            ->merge(DB::table('stock_movements as m')->join('sales_orders as o', 'o.id', '=', 'm.source_id')->where('m.lot_id', $id)
                ->where('m.source_type', 'SALES_ORDER')->where('m.movement_type', 'SALE')->whereNotExists(fn ($e) => $e->from('stock_reservations as r')->whereColumn('r.order_id', 'o.id')->where('r.lot_id', $id))
                ->groupBy('o.id', 'o.number')->selectRaw("o.id as order_id, o.number as order_number, 'DISPATCHED' as status, -sum(m.qty) qty")->get());
        $l->flow = LotesService::FLUJO[$l->qc_status] ?? [];

        return response()->json($l);
    }

    public function estado(Request $r, string $id)
    {
        $d = $r->validate(['status' => 'required|in:RELEASED,BLOCKED,REJECTED,RECALLED', 'reason' => 'nullable|string|max:200', 'move_to' => 'nullable|uuid']);

        return response()->json(LotesService::cambiarEstado($id, $d['status'], $d['reason'] ?? null, $r->user(), ['mover_a' => $d['move_to'] ?? null]));
    }
}
