<?php

namespace App\Modulos\Cal\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Cal\Services\CalidadService as Cal;
use App\Modulos\Pro\Http\Controllers\Alcance;
use App\Support\Listado;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** CAL-07 Lotes por liberar: lotes en cuarentena o retenidos con lo que hace falta para liberarlos. */
class LoteController extends Controller
{
    use Alcance;

    public function index(Request $r)
    {
        $estados = $r->query('status') ? explode(',', $r->query('status')) : ['QUARANTINE', 'BLOCKED'];
        $q = DB::table('lots as l')->join('products as p', 'p.id', '=', 'l.product_id')->join('product_variants as v', 'v.id', '=', 'l.variant_id')
            ->leftJoin('production_orders as o', 'o.number', '=', 'l.production_order_ref')->leftJoin('establishments as e', 'e.id', '=', 'o.establishment_id')
            ->whereIn('l.qc_status', $estados)
            ->when($r->query('origin'), fn ($x, $v) => $x->where('l.origin', $v), fn ($x) => $x->whereIn('l.origin', ['PRODUCTION', 'CUTTING']))
            ->selectRaw("l.id, l.code, l.origin, l.qc_status, l.requested_qc_status, l.production_date, l.expiry_date, l.ccp_deviation, l.production_order_ref, l.created_at,
                p.name as product_name, p.sanitary_authority, v.sku, v.name as variant_name, o.id as order_id, o.critical_deviation, o.establishment_id,
                coalesce(e.short, e.name) as establishment_name,
                (SELECT sum(b.qty) FROM stock_balances b WHERE b.lot_id = l.id) as stock_qty,
                (SELECT i.result FROM qc_inspections i WHERE i.lot_id = l.id AND i.status = 'DONE' ORDER BY i.inspected_at DESC LIMIT 1) as last_inspection,
                (SELECT count(*) FROM nonconformities n WHERE n.lot_id = l.id AND n.status <> 'CLOSED') as open_nc,
                (l.expiry_date - CURRENT_DATE) as days_to_expiry");
        $this->porLocal($q, $r, 'o.establishment_id');

        return response()->json(Listado::de(DB::query()->fromSub($q, 's'), $r, buscar: ['code', 'product_name', 'sku', 'production_order_ref'],
            ordenar: ['code', 'production_date', 'expiry_date', 'product_name', 'qc_status', 'created_at'], porDefecto: '-created_at'));
    }

    public function show(Request $r, string $id)
    {
        $l = DB::table('lots as l')->join('products as p', 'p.id', '=', 'l.product_id')->join('product_variants as v', 'v.id', '=', 'l.variant_id')
            ->leftJoin('users as c', 'c.id', '=', 'l.created_by_user_id')->leftJoin('users as s', 's.id', '=', 'l.supervisor_user_id')->where('l.id', $id)
            ->first(['l.*', 'p.name as product_name', 'p.sanitary_authority', 'p.sanitary_registry', 'p.sanitary_registry_expires', 'p.sanitary_alert_days', 'v.sku', 'v.name as variant_name',
                'c.name as created_by_name', 's.name as supervisor_name']) ?? abort(404);
        $orden = $l->production_order_ref ? DB::table('production_orders')->where('number', $l->production_order_ref)->first(['id', 'number', 'status', 'critical_deviation', 'establishment_id', 'order_type']) : null;
        $this->dentroDelAlcance($r, $orden?->establishment_id);
        $l->parent_lots = json_decode($l->parent_lots ?? '[]', true) ?: [];

        return response()->json([
            'lot' => $l, 'order' => $orden,
            'inspections' => DB::table('qc_inspections as i')->join('qc_checklists as c', 'c.id', '=', 'i.checklist_id')->where('i.lot_id', $id)->orderByDesc('i.inspected_at')
                ->get(['i.id', 'i.number', 'i.stage', 'i.result', 'i.score_pct', 'i.inspected_at', 'c.name as checklist_name']),
            'readings' => $orden ? DB::table('production_ccp_readings as c')->join('recipe_control_points as p', 'p.id', '=', 'c.control_point_id')->where('c.order_id', $orden->id)
                ->orderBy('c.read_at')->get(['c.id', 'c.value', 'c.in_range', 'c.read_at', 'c.corrective_action', 'p.code', 'p.variable', 'p.unit', 'p.min_value', 'p.max_value', 'p.is_critical']) : [],
            'nonconformities' => DB::table('nonconformities')->where(fn ($q) => $q->where('lot_id', $id)->when($orden, fn ($x) => $x->orWhere('production_order_id', $orden->id)))
                ->orderByDesc('detected_at')->get(['id', 'number', 'severity', 'status', 'description', 'detected_at']),
            'decisions' => DB::table('lot_quality_decisions as d')->leftJoin('users as u', 'u.id', '=', 'd.decided_by')->where('d.lot_id', $id)->orderByDesc('d.decided_at')
                ->get(['d.*', 'u.name as decided_by_name']),
            'blocks' => Cal::bloqueos(DB::table('lots')->where('id', $id)->first(), $r->user()),
            'can_decide' => $this->puede($r, 'cal.lot.release'),
            'release_warehouses' => DB::table('warehouses')->where('status', 'ACTIVE')->where('wh_type', '<>', 'QUARANTINE')->when($orden, fn ($q) => $q->where('establishment_id', $orden->establishment_id))
                ->orderBy('code')->get(['id', 'code', 'name']),
        ]);
    }

    public function decidir(Request $r, string $id)
    {
        $d = $r->validate(['decision' => 'required|in:RELEASE,RELEASE_WITH_NOTE,HOLD,REJECT', 'reason' => 'nullable|string|max:255', 'reject_destination' => 'nullable|in:WASTE,REPROCESS',
            'inspection_id' => 'nullable|uuid', 'move_to' => 'nullable|uuid']);

        return response()->json(Cal::decidir($id, $d, $r->user()), 201);
    }
}
