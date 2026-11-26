<?php

namespace App\Modulos\Pro\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Equ\Services\EquiposService as Equ;
use App\Modulos\Pro\Services\Comun;
use App\Modulos\Pro\Services\PlanService;
use App\Modulos\Pro\Services\ProduccionService as Pro;
use App\Support\Access;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** PRO-01 Líneas, PRO-02 Plan semanal, PRO-03 Requerimiento, PRO-12 Tablero y las opciones de los formularios. */
class LineaController extends Controller
{
    use Alcance;

    public function index(Request $r)
    {
        $q = DB::table('production_lines as l')->join('establishments as s', 's.id', '=', 'l.establishment_id')
            ->join('warehouses as wi', 'wi.id', '=', 'l.input_warehouse_id')->join('warehouses as wo', 'wo.id', '=', 'l.output_warehouse_id')
            ->leftJoin('cost_centers as cc', 'cc.id', '=', 'l.cost_center_id')
            ->when($r->query('status'), fn ($x, $v) => $x->where('l.status', $v))
            ->when($r->query('line_type'), fn ($x, $v) => $x->where('l.line_type', $v))
            ->orderBy('s.name')->orderBy('l.code')
            ->select(['l.*', DB::raw('coalesce(s.short, s.name) as establishment_name'), 'wi.code as input_warehouse_code', 'wi.name as input_warehouse_name',
                'wo.code as output_warehouse_code', 'wo.name as output_warehouse_name', 'cc.code as cost_center_code', 'cc.name as cost_center_name',
                DB::raw("(SELECT count(*) FROM production_orders o WHERE o.line_id = l.id AND o.status IN ('PLANNED','RELEASED','IN_PROGRESS')) as open_orders"),
                DB::raw("(SELECT max(o.close_date) FROM production_orders o WHERE o.line_id = l.id AND o.status = 'CLOSED') as last_closed")]);
        $this->porLocal($q, $r, 'l.establishment_id');

        return response()->json(['data' => $q->get()]);
    }

    public function store(Request $r)
    {
        return response()->json(Pro::guardarLinea($this->datos($r), null, $r->user()), 201);
    }

    public function update(Request $r, string $id)
    {
        return response()->json(Pro::guardarLinea($this->datos($r), $id, $r->user()));
    }

    private function datos(Request $r): array
    {
        return $r->validate(['establishment_id' => 'nullable|uuid', 'code' => 'nullable|string|max:40', 'name' => 'nullable|string|max:80',
            'line_type' => 'nullable|in:'.implode(',', Pro::TIPOS_LINEA), 'input_warehouse_id' => 'nullable|uuid', 'output_warehouse_id' => 'nullable|uuid',
            'cost_center_id' => 'nullable|uuid', 'max_waste_pct' => 'nullable|numeric|min:0|max:100', 'status' => 'nullable|in:ACTIVE,INACTIVE', 'notes' => 'nullable|string|max:1000']);
    }

    /** PRO-02 */
    public function plan(Request $r)
    {
        $desde = $r->query('from') ?: Comun::ahora()->startOfWeek()->toDateString();

        return response()->json(PlanService::plan($desde, $this->locales($r)));
    }

    /** PRO-03 */
    public function requerimiento(Request $r)
    {
        $desde = $r->query('from') ?: Comun::hoy();
        $hasta = $r->query('to') ?: \Carbon\CarbonImmutable::parse($desde)->addDays(6)->toDateString();

        return response()->json(PlanService::requerimiento($desde, $hasta, $this->locales($r)) + ['purchase_module' => DB::table('tenant_modules')->where('module_code', 'COM')->where('enabled', true)->exists()]);
    }

    /** PRO-12 */
    public function tablero(Request $r)
    {
        [$desde, $hasta] = Comun::mes($r->query('month'));
        $k = PlanService::kpis($desde, $hasta, $this->locales($r), $r->only(['line_id', 'product_id']));
        if (! $this->puede($r, 'pro.cost.view')) {
            $k['kpis']['cost_per_kg'] = $k['kpis']['total_cost'] = $k['kpis']['recipe_vs_actual_pct'] = null;
            foreach (['by_line', 'by_product'] as $g) {
                $k[$g] = collect($k[$g])->map(fn ($x) => array_merge($x, ['cost_per_kg' => null, 'total_cost' => null, 'recipe_vs_actual_pct' => null]))->values();
            }
            $k['trend'] = array_map(fn ($x) => array_merge($x, ['cost_per_kg' => null]), $k['trend']);
        }

        return response()->json($k);
    }

    /** Opciones de los formularios de PRO y DES. */
    public function opciones(Request $r)
    {
        $locales = Access::for($r->user())['establishments'];
        $enLocal = fn ($q, $col) => $q->when($locales, fn ($x) => $x->whereIn($col, $locales));
        $hoy = Comun::hoy();
        $equipos = $enLocal(DB::table('equipment')->where('status', '<>', 'RETIRED'), 'establishment_id')->orderBy('code')
            ->get(['id', 'code', 'name', 'category', 'status', 'establishment_id', 'hourly_rate'])
            ->map(function ($e) use ($hoy) {
                $e->not_usable = Equ::motivoNoApto(Equ::equipo($e->id), $hoy);

                return $e;
            });

        return response()->json([
            'establishments' => $enLocal(DB::table('establishments')->where('status', 'ACTIVE'), 'id')->orderBy('name')->get(['id', 'name', 'short', 'company_id']),
            'lines' => $enLocal(DB::table('production_lines')->where('status', 'ACTIVE'), 'establishment_id')->orderBy('code')
                ->get(['id', 'code', 'name', 'line_type', 'establishment_id', 'input_warehouse_id', 'output_warehouse_id', 'max_waste_pct']),
            'warehouses' => $enLocal(DB::table('warehouses')->where('status', 'ACTIVE'), 'establishment_id')->orderBy('code')->get(['id', 'code', 'name', 'establishment_id']),
            'cost_centers' => DB::table('cost_centers')->where('status', 'ACTIVE')->orderBy('code')->get(['id', 'code', 'name']),
            'recipes' => DB::table('recipes as r')->join('recipe_versions as v', fn ($j) => $j->on('v.recipe_id', '=', 'r.id')->where('v.status', 'APPROVED'))
                ->leftJoin('product_variants as pv', 'pv.id', '=', 'r.output_variant_id')->where('r.status', 'ACTIVE')->orderBy('r.name')
                ->get(['r.id', 'r.code', 'r.name', 'r.product_id', 'r.brand_id', 'r.output_variant_id', 'pv.sku', 'v.id as version_id', 'v.version', 'v.base_output_kg', 'v.expected_yield_pct']),
            'templates' => DB::table('cutting_templates as t')->join('product_variants as v', 'v.id', '=', 't.input_variant_id')->where('t.status', 'ACTIVE')->orderBy('t.name')
                ->get(['t.id', 't.code', 't.name', 't.version', 't.species', 't.input_variant_id', 'v.sku as input_sku', 'v.name as input_variant_name', 't.brand_id']),
            'variants' => DB::table('product_variants as v')->join('products as p', 'p.id', '=', 'v.product_id')->where('v.status', 'ACTIVE')->orderBy('v.sku')
                ->get(['v.id', 'v.sku', 'v.name', 'v.sale_mode', 'v.product_id', 'v.brand_id', 'p.product_type', 'p.requires_lot']),
            'supervisors' => DB::table('users as u')->join('user_roles as ur', 'ur.user_id', '=', 'u.id')->join('roles as ro', 'ro.id', '=', 'ur.role_id')
                ->whereIn('ro.code', ['JEFE_PRODUCCION', 'GERENTE', 'CALIDAD'])->where('u.status', 'ACTIVE')->distinct()->orderBy('u.name')->get(['u.id', 'u.name']),
            'employees' => DB::table('employees')->where('status', 'ACTIVE')->orderBy('full_name')->get(['id', 'full_name', 'establishment_id']),
            'equipment' => $equipos,
            'brands' => DB::table('brands')->where('status', 'ACTIVE')->orderBy('name')->get(['id', 'name']),
            'line_types' => Pro::TIPOS_LINEA, 'functions' => Pro::FUNCIONES,
            'labor_rate' => Comun::t(\App\Support\Params::get('pro_default_labor_rate_pen') ?? 9.5, 2),
            'can' => ['create' => $this->puede($r, 'pro.order.create'), 'record' => $this->puede($r, 'pro.order.record'), 'close' => $this->puede($r, 'pro.order.close'),
                'void' => $this->puede($r, 'pro.order.void'), 'cost' => $this->puede($r, 'pro.cost.view'), 'fefo' => $this->puede($r, 'pro.fefo.override'),
                'template' => $this->puede($r, 'des.template.manage'), 'price' => $this->puede($r, 'des.reference_price.manage'), 'override' => $this->puede($r, 'des.mass_balance.override')],
        ]);
    }
}
