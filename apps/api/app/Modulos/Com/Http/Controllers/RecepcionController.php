<?php

namespace App\Modulos\Com\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Com\Services\OrdenesService as O;
use App\Modulos\Com\Services\RecepcionesService as R;
use App\Support\Listado;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** COM-06 Recepción de compras (contra la OC o sin ella). */
class RecepcionController extends Controller
{
    use Alcance;

    public function index(Request $r)
    {
        $q = DB::table('purchase_receipts as r')->join('suppliers as s', 's.id', '=', 'r.supplier_id')->join('warehouses as w', 'w.id', '=', 'r.warehouse_id')
            ->leftJoin('purchase_orders as o', 'o.id', '=', 'r.po_id')->leftJoin('users as u', 'u.id', '=', 'r.received_by')
            ->leftJoin('purchase_documents as d', 'd.id', '=', 'r.document_id')
            ->when($r->query('receipt_type'), fn ($x, $v) => $x->whereIn('r.receipt_type', explode(',', $v)))
            ->when($r->query('supplier_id'), fn ($x, $v) => $x->where('r.supplier_id', $v))
            ->when($r->query('po_id'), fn ($x, $v) => $x->where('r.po_id', $v))
            ->when($r->query('from'), fn ($x, $v) => $x->whereRaw("(r.received_at AT TIME ZONE 'America/Lima')::date >= ?", [$v]))
            ->when($r->query('to'), fn ($x, $v) => $x->whereRaw("(r.received_at AT TIME ZONE 'America/Lima')::date <= ?", [$v]))
            ->when($r->query('without_document'), fn ($x) => $x->whereNull('r.document_id')->where('r.status', 'POSTED')
                ->whereNotExists(fn ($e) => $e->from('purchase_document_lines as dl')->join('purchase_receipt_lines as rl', 'rl.id', '=', 'dl.receipt_line_id')->whereColumn('rl.receipt_id', 'r.id')))
            ->when($r->query('observed'), fn ($x) => $x->whereExists(fn ($e) => $e->from('purchase_receipt_lines as l')->whereColumn('l.receipt_id', 'r.id')
                ->where(fn ($y) => $y->where('l.accepted', false)->orWhere('l.quality_hold', true))))
            ->selectRaw("r.id, r.number, r.receipt_type, r.received_at, r.status, r.supplier_id, coalesce(nullif(s.trade_name, ''), s.legal_name) as supplier_name, r.po_id,
                o.number as po_number, r.warehouse_id, w.code as warehouse_code, r.establishment_id, r.vehicle_temp_c, r.inspection_result, r.total_cost, u.name as received_by_name,
                r.document_id, d.series || '-' || d.number as document_label, r.carrier_guide,
                (select count(*) from purchase_receipt_lines l where l.receipt_id = r.id) as line_count,
                (select count(*) from purchase_receipt_lines l where l.receipt_id = r.id and (not l.accepted or l.quality_hold)) as observed_lines,
                (select coalesce(sum(l.weight_kg), 0) from purchase_receipt_lines l where l.receipt_id = r.id and l.accepted) as weight_kg");
        $this->porLocal($q, $r, 'r.establishment_id');

        return response()->json(Listado::de(DB::query()->fromSub($q, 'r'), $r, buscar: ['number', 'supplier_name', 'po_number', 'carrier_guide', 'document_label'],
            ordenar: ['number', 'received_at', 'supplier_name', 'total_cost', 'weight_kg', 'observed_lines'], porDefecto: '-received_at'));
    }

    public function show(Request $r, string $id)
    {
        $x = R::ver($id);
        $this->dentroDelAlcance($r, $x->establishment_id);

        return response()->json($x);
    }

    /** Líneas pendientes de una OC aprobada, para precargar la recepción. */
    public function pendientes(Request $r, string $poId)
    {
        $po = O::ver($poId);
        $this->dentroDelAlcance($r, $po->establishment_id);
        $po->lines = $po->lines->filter(fn ($l) => (float) $l->pending > 0)->values();
        foreach ($po->lines as $l) {
            $l->storage = DB::table('product_variants as v')->join('products as p', 'p.id', '=', 'v.product_id')->where('v.id', $l->variant_id)->value('p.storage');
            $l->temp_max = R::tempMax($l->storage);
        }

        return response()->json($po);
    }

    public function store(Request $r)
    {
        $d = $r->validate([
            'po_id' => 'nullable|uuid', 'supplier_id' => 'required_without:po_id|nullable|uuid', 'warehouse_id' => 'required_without:po_id|nullable|uuid',
            'received_at' => 'nullable|date', 'vehicle_temp_c' => 'nullable|numeric|min:-40|max:40', 'carrier_guide' => 'nullable|string|max:40',
            'scale_equipment_id' => 'nullable|uuid', 'inspection_result' => 'nullable|in:OK,PENDING,OBSERVED', 'notes' => 'nullable|string|max:500',
            'lines' => 'required|array|min:1', 'lines.*.po_line_id' => 'nullable|uuid', 'lines.*.variant_id' => 'nullable|uuid', 'lines.*.qty' => 'nullable|numeric|min:0',
            'lines.*.weight_kg' => 'nullable|numeric|min:0', 'lines.*.temp_c' => 'nullable|numeric|min:-40|max:40', 'lines.*.unit_price' => 'nullable|numeric|min:0',
            'lines.*.price_basis' => 'nullable|in:KG,UNIT', 'lines.*.supplier_lot_code' => 'nullable|string|max:60', 'lines.*.expiry_date' => 'nullable|date',
            'lines.*.production_date' => 'nullable|date', 'lines.*.decision' => 'nullable|in:'.implode(',', R::DECISIONES),
            'lines.*.rejection_reason' => 'nullable|string|max:200', 'lines.*.over_receipt_reason' => 'nullable|string|max:200',
        ]);

        return response()->json(R::registrar($d, $r->user()), 201);
    }
}
