<?php

namespace App\Modulos\Pro\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Des\Services\DespieceService as Des;
use App\Modulos\Pro\Services\Comun;
use App\Modulos\Pro\Services\ProduccionService as Pro;
use App\Support\Listado;
use App\Support\Params;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * PRO-04 Órdenes, PRO-05 Nueva orden, PRO-06 a PRO-09 Registro en planta, PRO-10 Cierre, PRO-11 Ficha y PRO-13 Anulación.
 * Los costos se muestran solo con pro.cost.view.
 */
class OrdenController extends Controller
{
    use Alcance;

    private const COSTOS = ['raw_material_cost', 'input_cost', 'packaging_cost', 'material_cost', 'labor_cost', 'equipment_cost', 'total_cost', 'cost_per_kg',
        'standard_cost_per_kg', 'cost_deviation_pct', 'ingredient_cost_per_kg', 'joint_cost', 'nrv_total'];

    public function index(Request $r)
    {
        $tol = (float) (Params::get('pro_yield_tolerance_pp') ?? 3);
        $q = DB::table('production_orders as o')->join('production_lines as l', 'l.id', '=', 'o.line_id')->join('establishments as s', 's.id', '=', 'o.establishment_id')
            ->leftJoin('products as p', 'p.id', '=', 'o.product_id')->leftJoin('brands as b', 'b.id', '=', 'o.brand_id')->leftJoin('users as u', 'u.id', '=', 'o.supervisor_user_id')
            ->when($r->query('status'), fn ($x, $v) => $x->whereIn('o.status', explode(',', $v)))
            ->when($r->query('order_type'), fn ($x, $v) => $x->where('o.order_type', $v))
            ->when($r->query('line_id'), fn ($x, $v) => $x->where('o.line_id', $v))
            ->when($r->query('brand_id'), fn ($x, $v) => $x->where('o.brand_id', $v))
            ->when($r->query('from'), fn ($x, $v) => $x->where('o.planned_date', '>=', $v))
            ->when($r->query('to'), fn ($x, $v) => $x->where('o.planned_date', '<=', $v))
            ->when($r->query('abiertas') === 'SI', fn ($x) => $x->whereIn('o.status', ['PLANNED', 'RELEASED', 'IN_PROGRESS']))
            ->selectRaw("o.id, o.number, o.order_type, o.status, o.planned_date, o.close_date, o.planned_output_kg, o.main_kg, o.output_kg, o.input_kg, o.waste_pct,
                o.actual_yield_pct, o.expected_yield_pct, o.yield_deviation_pp, o.critical_deviation, o.establishment_id, o.line_id, o.brand_id,
                l.code as line_code, l.name as line_name, coalesce(s.short, s.name) as establishment_name, p.name as product_name, b.name as brand_name, u.name as supervisor_name,
                o.total_cost, o.cost_per_kg, o.standard_cost_per_kg,
                CASE WHEN o.yield_deviation_pp IS NULL THEN NULL WHEN abs(o.yield_deviation_pp) <= ? THEN 'ok' WHEN abs(o.yield_deviation_pp) <= ? THEN 'warn' ELSE 'bad' END as yield_light,
                CASE WHEN o.cost_per_kg IS NULL OR coalesce(o.standard_cost_per_kg, 0) = 0 THEN NULL
                     WHEN (o.cost_per_kg - o.standard_cost_per_kg) / o.standard_cost_per_kg * 100 <= 5 THEN 'ok'
                     WHEN (o.cost_per_kg - o.standard_cost_per_kg) / o.standard_cost_per_kg * 100 <= 10 THEN 'warn' ELSE 'bad' END as cost_light,
                CASE WHEN coalesce(o.standard_cost_per_kg, 0) = 0 OR o.cost_per_kg IS NULL THEN NULL ELSE round((o.cost_per_kg - o.standard_cost_per_kg) / o.standard_cost_per_kg * 100, 2) END as cost_deviation_pct", [$tol, $tol * 2]);
        $this->porLocal($q, $r, 'o.establishment_id');
        $p = Listado::de(DB::query()->fromSub($q, 's'), $r, buscar: ['number', 'product_name', 'line_name', 'brand_name', 'supervisor_name'],
            ordenar: ['number', 'planned_date', 'close_date', 'status', 'planned_output_kg', 'main_kg', 'actual_yield_pct', 'yield_deviation_pp', 'cost_per_kg', 'total_cost'], porDefecto: '-planned_date');
        if (! $this->puede($r, 'pro.cost.view')) {
            $p->getCollection()->transform(function ($o) {
                $o->total_cost = $o->cost_per_kg = $o->standard_cost_per_kg = $o->cost_deviation_pct = $o->cost_light = null;

                return $o;
            });
        }

        return response()->json($p);
    }

    public function store(Request $r)
    {
        $d = $r->validate([
            'order_type' => 'required|in:RECIPE,CUTTING,PACKING', 'line_id' => 'required|uuid', 'recipe_id' => 'nullable|uuid', 'product_id' => 'nullable|uuid',
            'cutting_template_id' => 'nullable|uuid', 'source_variant_id' => 'nullable|uuid', 'output_variant_id' => 'nullable|uuid', 'planned_output_kg' => 'required|numeric|gt:0',
            'planned_date' => 'nullable|date', 'supervisor_user_id' => 'nullable|uuid', 'brand_id' => 'nullable|uuid', 'expected_yield_pct' => 'nullable|numeric|min:0|max:200',
            'notes' => 'nullable|string|max:2000',
        ]);
        $o = Pro::crearOrden($d, $r->user());
        if ($r->boolean('release')) {
            $o = Pro::liberar($o->id, $r->user());
        }

        return response()->json($o, 201);
    }

    /** PRO-11 Ficha: toda la historia de la orden. */
    public function show(Request $r, string $id)
    {
        DB::table('production_orders')->where('id', $id)->exists() || abort(404);
        $o = Pro::orden($id);
        $this->dentroDelAlcance($r, $o->establishment_id);
        $costos = $this->puede($r, 'pro.cost.view');
        $resumen = Pro::resumen($id);
        $consumos = Pro::consumos($id);
        $salidas = Pro::salidas($id);
        $lotes = $salidas->pluck('lot_id')->filter()->values();
        $out = [
            'order' => $o, 'summary' => $resumen, 'theoretical' => Pro::consumoTeorico($id),
            'consumptions' => $consumos, 'outputs' => $salidas,
            'readings' => DB::table('production_ccp_readings as c')->join('recipe_control_points as p', 'p.id', '=', 'c.control_point_id')->where('c.order_id', $id)->orderBy('c.read_at')
                ->get(['c.*', 'p.code', 'p.variable', 'p.unit', 'p.min_value', 'p.max_value', 'p.is_critical', 'p.step_seq']),
            'control_points' => $o->recipe_version_id ? DB::table('recipe_control_points')->where('version_id', $o->recipe_version_id)->orderBy('step_seq')->orderBy('code')->get() : [],
            'labor' => DB::table('production_order_labor as l')->join('employees as e', 'e.id', '=', 'l.employee_id')->where('l.order_id', $id)->orderBy('l.work_date')
                ->get(['l.*', 'e.full_name as employee_name']),
            'equipment' => DB::table('production_order_equipment as q')->join('equipment as e', 'e.id', '=', 'q.equipment_id')->where('q.order_id', $id)->orderBy('q.used_on')
                ->get(['q.*', 'e.code as equipment_code', DB::raw('coalesce(q.equipment_name, e.name) as equipment_name')]),
            'quality' => $lotes->isEmpty() ? [] : DB::table('lot_quality_decisions as d')->join('lots as l', 'l.id', '=', 'd.lot_id')->whereIn('d.lot_id', $lotes)
                ->orderBy('d.decided_at')->get(['d.*', 'l.code as lot_code']),
            'nonconformities' => DB::table('nonconformities')->where('production_order_id', $id)->get(['id', 'number', 'status', 'severity', 'description']),
            'can' => ['cost' => $costos, 'record' => $this->puede($r, 'pro.order.record'), 'close' => $this->puede($r, 'pro.order.close'),
                'void' => $this->puede($r, 'pro.order.void'), 'release' => $this->puede($r, 'pro.order.create'), 'fefo' => $this->puede($r, 'pro.fefo.override')],
        ];
        if ($o->order_type === 'CUTTING') {
            $out['mass_balance'] = Des::balance($o);
            $out['template_lines'] = DB::table('cutting_template_lines as l')->leftJoin('product_variants as v', 'v.id', '=', 'l.output_variant_id')
                ->where('l.template_id', $o->cutting_template_id)->orderBy('l.seq')->get(['l.*', 'v.sku', 'v.name as variant_name']);
            $out['costing'] = $costos ? Des::costeo($o, $resumen) : null;
        }
        if (! $costos) {
            $this->sinCostos($out);
        }

        return response()->json($out);
    }

    public function liberar(Request $r, string $id)
    {
        return response()->json(Pro::liberar($id, $r->user()));
    }

    public function anular(Request $r, string $id)
    {
        $d = $r->validate(['reason' => 'nullable|string|max:500']);

        return response()->json(Pro::anular($id, (string) ($d['reason'] ?? ''), $r->user()));
    }

    /** PRO-06 */
    public function consumir(Request $r, string $id)
    {
        $d = $r->validate(['lot_id' => 'nullable|uuid', 'lot_code' => 'nullable|string|max:40', 'variant_id' => 'nullable|uuid', 'qty' => 'nullable|numeric|gt:0',
            'weight_kg' => 'nullable|numeric|gt:0', 'warehouse_id' => 'nullable|uuid', 'role' => 'nullable|in:RAW_MATERIAL,INPUT,PACKAGING',
            'fefo_override_reason' => 'nullable|string|max:500', 'consumed_at' => 'nullable|date']);

        return response()->json(Pro::consumir($id, $d, $r->user()), 201);
    }

    public function consumoTeorico(Request $r, string $id)
    {
        $o = DB::table('production_orders')->where('id', $id)->first() ?? abort(404);
        $this->dentroDelAlcance($r, $o->establishment_id);

        return response()->json(['data' => Pro::consumoTeorico($id)]);
    }

    /** PRO-07 */
    public function lectura(Request $r, string $id)
    {
        $d = $r->validate(['control_point_id' => 'required|uuid', 'value' => 'required|numeric', 'corrective_action' => 'nullable|string|max:1000', 'read_at' => 'nullable|date']);

        return response()->json(Pro::lectura($id, $d, $r->user()), 201);
    }

    /** PRO-08 */
    public function producir(Request $r, string $id)
    {
        $d = $r->validate(['output_role' => 'nullable|in:MAIN,CO_PRODUCT,BY_PRODUCT,WASTE', 'variant_id' => 'nullable|uuid', 'qty' => 'nullable|numeric|gt:0',
            'weight_kg' => 'nullable|numeric|gt:0', 'lot_code' => 'nullable|string|max:40', 'expiry_date' => 'nullable|date', 'scale_equipment_id' => 'nullable|uuid',
            'qc_status' => 'nullable|in:RELEASED,QUARANTINE', 'template_line_id' => 'nullable|uuid', 'waste_reason' => 'nullable|string|max:500', 'warehouse_id' => 'nullable|uuid']);
        $s = Pro::producir($id, $d, $r->user());
        if ($s->template_line_id) {
            $s->alert = Des::alertaCorte($id, $s->template_line_id);
        }

        return response()->json($s, 201);
    }

    /** PRO-09 */
    public function personal(Request $r, string $id)
    {
        $d = $r->validate(['employee_id' => 'required|uuid', 'task_role' => 'nullable|in:'.implode(',', Pro::FUNCIONES), 'hours' => 'required|numeric',
            'hourly_rate' => 'nullable|numeric|min:0', 'work_date' => 'nullable|date']);
        $l = Pro::personal($id, $d, $r->user());
        if (! $this->puede($r, 'pro.cost.view')) {
            $l->hourly_rate = $l->cost = null;
        }

        return response()->json($l, 201);
    }

    public function equipo(Request $r, string $id)
    {
        $d = $r->validate(['equipment_id' => 'required|uuid', 'hours' => 'required|numeric', 'used_on' => 'nullable|date']);
        $e = Pro::equipo($id, $d, $r->user());
        if (! $this->puede($r, 'pro.cost.view')) {
            $e->hourly_rate = $e->cost = null;
        }

        return response()->json($e, 201);
    }

    /** PRO-10: cifras para el cierre (y el costeo del despiece). */
    public function resumen(Request $r, string $id)
    {
        $o = Pro::orden($id);
        $this->dentroDelAlcance($r, $o->establishment_id);
        $out = ['summary' => Pro::resumen($id)];
        if ($o->order_type === 'CUTTING') {
            $out['mass_balance'] = Des::balance($o);
            $out['costing'] = $this->puede($r, 'pro.cost.view') ? Des::costeo($o, $out['summary']) : null;
        }
        if (! $this->puede($r, 'pro.cost.view')) {
            $this->sinCostos($out);
        }

        return response()->json($out);
    }

    public function cerrar(Request $r, string $id)
    {
        $d = $r->validate(['close_date' => 'nullable|date', 'yield_deviation_reason' => 'nullable|string|max:500', 'waste_reason' => 'nullable|string|max:500',
            'mass_balance_override' => 'nullable|boolean']);

        return response()->json(Pro::cerrar($id, $d, $r->user()));
    }

    private function sinCostos(array &$out): void
    {
        foreach (self::COSTOS as $k) {
            if (isset($out['summary']) && array_key_exists($k, $out['summary'])) {
                $out['summary'][$k] = null;
            }
            if (isset($out['order']) && property_exists($out['order'], $k)) {
                $out['order']->{$k} = null;
            }
        }
        foreach (['consumptions', 'labor', 'equipment', 'outputs'] as $lista) {
            foreach ($out[$lista] ?? [] as $f) {
                foreach (['unit_cost', 'total_cost', 'hourly_rate', 'cost', 'allocated_cost'] as $k) {
                    if (property_exists($f, $k)) {
                        $f->{$k} = null;
                    }
                }
            }
        }
    }
}
