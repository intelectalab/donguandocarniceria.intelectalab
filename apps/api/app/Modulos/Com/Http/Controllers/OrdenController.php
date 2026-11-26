<?php

namespace App\Modulos\Com\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Com\Services\OrdenesService as O;
use App\Support\Listado;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** COM-03 Requerimientos, COM-04 Órdenes de compra y COM-05 Aprobación de órdenes. */
class OrdenController extends Controller
{
    use Alcance;

    public function requerimientos(Request $r)
    {
        $q = DB::table('purchase_requisitions as q')->join('product_variants as v', 'v.id', '=', 'q.variant_id')->join('warehouses as w', 'w.id', '=', 'q.warehouse_id')
            ->leftJoin('users as u', 'u.id', '=', 'q.requested_by')->leftJoin('purchase_orders as o', 'o.id', '=', 'q.po_id')
            ->when($r->query('status'), fn ($x, $v) => $x->whereIn('q.status', explode(',', $v)))
            ->when($r->query('source'), fn ($x, $v) => $x->where('q.source', $v))
            ->when($r->query('warehouse_id'), fn ($x, $v) => $x->where('q.warehouse_id', $v))
            ->selectRaw("q.id, q.number, q.source, q.source_ref, q.warehouse_id, w.code as warehouse_code, w.name as warehouse_name, q.establishment_id, q.variant_id, v.sku,
                v.name as variant_name, v.sale_mode, q.qty, q.needed_date, q.status, u.name as requested_by_name, q.requested_at, q.po_id, o.number as po_number, q.notes,
                (select k.supplier_id from supplier_catalog k join suppliers s on s.id = k.supplier_id where k.variant_id = q.variant_id and k.status = 'ACTIVE' and s.status = 'ACTIVE'
                   order by k.last_price nulls last limit 1) as suggested_supplier_id,
                (select coalesce(nullif(s.trade_name, ''), s.legal_name) from supplier_catalog k join suppliers s on s.id = k.supplier_id where k.variant_id = q.variant_id and k.status = 'ACTIVE' and s.status = 'ACTIVE'
                   order by k.last_price nulls last limit 1) as suggested_supplier_name,
                (select min(k.last_price) from supplier_catalog k where k.variant_id = q.variant_id and k.status = 'ACTIVE') as best_price");
        $this->porLocal($q, $r, 'q.establishment_id');

        return response()->json(Listado::de(DB::query()->fromSub($q, 'q'), $r, buscar: ['number', 'sku', 'variant_name', 'source_ref'],
            ordenar: ['number', 'needed_date', 'variant_name', 'qty', 'status', 'requested_at'], porDefecto: 'needed_date'));
    }

    public function crearRequerimiento(Request $r)
    {
        $d = $r->validate(['warehouse_id' => 'required|uuid', 'variant_id' => 'required|uuid', 'qty' => 'required|numeric|gt:0', 'needed_date' => 'nullable|date',
            'source' => 'nullable|in:MANUAL,WAREHOUSE,PRO-03', 'source_ref' => 'nullable|string|max:60', 'notes' => 'nullable|string|max:300']);

        return response()->json(O::crearRequerimiento($d, $r->user()), 201);
    }

    public function cancelarRequerimiento(Request $r, string $id)
    {
        $d = $r->validate(['reason' => 'required|string|min:5|max:200']);

        return response()->json(O::cancelarRequerimiento($id, $d['reason']));
    }

    public function agrupar(Request $r)
    {
        $d = $r->validate(['ids' => 'required|array|min:1', 'ids.*' => 'uuid', 'suppliers' => 'nullable|array', 'suppliers.*' => 'nullable|uuid']);

        return response()->json(['orders' => O::agrupar($d['ids'], array_filter($d['suppliers'] ?? []), $r->user())], 201);
    }

    public function index(Request $r)
    {
        $q = DB::table('purchase_orders as o')->join('suppliers as s', 's.id', '=', 'o.supplier_id')->join('warehouses as w', 'w.id', '=', 'o.warehouse_id')
            ->leftJoin('establishments as e', 'e.id', '=', 'o.establishment_id')->leftJoin('users as u', 'u.id', '=', 'o.created_by')
            ->when($r->query('status'), fn ($x, $v) => $x->whereIn('o.status', explode(',', $v)))
            ->when($r->query('supplier_id'), fn ($x, $v) => $x->where('o.supplier_id', $v))
            ->when($r->query('from'), fn ($x, $v) => $x->where('o.order_date', '>=', $v))
            ->when($r->query('to'), fn ($x, $v) => $x->where('o.order_date', '<=', $v))
            ->when($r->boolean('late'), fn ($x) => $x->whereIn('o.status', O::ABIERTAS)->where('o.expected_date', '<', now('America/Lima')->toDateString()))
            ->selectRaw("o.id, o.number, o.order_date, o.expected_date, o.status, o.supplier_id, coalesce(nullif(s.trade_name, ''), s.legal_name) as supplier_name, s.supplier_type,
                o.warehouse_id, w.code as warehouse_code, o.establishment_id, e.name as establishment_name, o.subtotal, o.igv, o.total, o.no_igv, o.auto_approved,
                u.name as created_by_name, o.created_by, o.submitted_at, o.approved_at, o.last_receipt_at,
                (select count(*) from purchase_order_lines l where l.po_id = o.id) as line_count,
                (select round(100 * coalesce(sum(case when l.price_basis = 'KG' then least(l.received_weight_kg, coalesce(l.est_weight_kg, l.qty)) else least(l.received_qty, l.qty) end), 0)
                   / nullif(sum(case when l.price_basis = 'KG' then coalesce(l.est_weight_kg, l.qty) else l.qty end), 0), 1) from purchase_order_lines l where l.po_id = o.id) as received_pct");
        $this->porLocal($q, $r, 'o.establishment_id');

        return response()->json(Listado::de(DB::query()->fromSub($q, 'o'), $r, buscar: ['number', 'supplier_name', 'warehouse_code'],
            ordenar: ['number', 'order_date', 'expected_date', 'supplier_name', 'total', 'status', 'submitted_at'], porDefecto: '-order_date'));
    }

    public function show(Request $r, string $id)
    {
        $po = O::ver($id);
        $this->dentroDelAlcance($r, $po->establishment_id);
        $po->can_approve = $po->status === 'PENDING_APPROVAL' && $po->created_by !== $r->user()->id && \App\Support\Access::can($r->user(), 'com.order.approve');

        return response()->json($po);
    }

    private function validar(Request $r): array
    {
        return $r->validate([
            'supplier_id' => 'required|uuid', 'warehouse_id' => 'required|uuid', 'brand_id' => 'nullable|uuid', 'order_date' => 'nullable|date', 'expected_date' => 'required|date',
            'notes' => 'nullable|string|max:500', 'lines' => 'required|array|min:1', 'lines.*.variant_id' => 'required|uuid', 'lines.*.qty' => 'required|numeric|gt:0',
            'lines.*.price_basis' => 'nullable|in:KG,UNIT', 'lines.*.est_weight_kg' => 'nullable|numeric|min:0', 'lines.*.unit_price' => 'required|numeric|min:0',
            'submit' => 'nullable|boolean',
        ]);
    }

    public function store(Request $r)
    {
        $d = $this->validar($r);
        $po = O::crear($d, $r->user());
        if (! empty($d['submit'])) {
            $po = O::enviar($po->id, $r->user());
        }

        return response()->json($po, 201);
    }

    public function update(Request $r, string $id)
    {
        $this->dentroDelAlcance($r, DB::table('purchase_orders')->where('id', $id)->value('establishment_id'));
        $d = $this->validar($r);
        $po = O::editar($id, $d, $r->user());

        return response()->json(! empty($d['submit']) ? O::enviar($po->id, $r->user()) : $po);
    }

    public function enviar(Request $r, string $id)
    {
        return response()->json(O::enviar($id, $r->user()));
    }

    public function aprobar(Request $r, string $id)
    {
        return response()->json(O::aprobar($id, $r->user()));
    }

    private function motivo(Request $r): string
    {
        return $r->validate(['reason' => 'required|string|min:5|max:300'])['reason'];
    }

    public function devolver(Request $r, string $id)
    {
        return response()->json(O::devolver($id, $this->motivo($r), $r->user()));
    }

    public function anular(Request $r, string $id)
    {
        return response()->json(O::anular($id, $this->motivo($r), $r->user()));
    }

    public function cerrar(Request $r, string $id)
    {
        return response()->json(O::cerrar($id, $this->motivo($r), $r->user()));
    }
}
