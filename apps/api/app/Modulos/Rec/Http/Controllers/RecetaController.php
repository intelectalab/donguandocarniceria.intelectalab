<?php

namespace App\Modulos\Rec\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Rec\Services\RecetasService as Rec;
use App\Support\Access;
use App\Support\Listado;
use App\Support\Params;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** REC-01 Recetas: lista, ficha con sus versiones, nueva receta, opciones de los formularios y cifras de cabecera. */
class RecetaController extends Controller
{
    use Alcance;

    public function index(Request $r)
    {
        $this->exigirReceta($r);
        $q = $this->base($r)
            ->when($r->query('recipe_type'), fn ($x, $t) => $x->where('r.recipe_type', $t))
            ->when($r->query('vigente') === 'SI', fn ($x) => $x->whereNotNull('cur.id'))
            ->when($r->query('vigente') === 'NO', fn ($x) => $x->whereNull('cur.id'))
            ->when($r->query('en_curso'), fn ($x, $s) => $x->where('pend.status', $s));
        $pagina = Listado::de(DB::query()->fromSub($q, 's'), $r, buscar: ['code', 'name', 'product_name', 'brand_name'],
            ordenar: ['code', 'name', 'product_name', 'brand_name', 'recipe_type', 'current_yield_pct', 'current_cost_per_kg'], porDefecto: 'code');
        $this->sinCostos($r, $pagina->items(), ['current_cost_per_kg', 'current_recalc_cost_per_kg']);
        foreach ($pagina->items() as $f) {
            $f->current_allergens = json_decode($f->current_allergens ?? 'null', true);
        }

        return response()->json($pagina);
    }

    public function show(Request $r, string $id)
    {
        $this->exigirReceta($r);
        DB::table('recipes')->where('id', $id)->exists() || abort(404);
        $rc = Rec::receta($id);
        $this->dentroDelAlcance($r, $rc->brand_id);
        $rc->versions = DB::table('recipe_versions as v')->leftJoin('users as a', 'a.id', '=', 'v.approved_by')->leftJoin('users as c', 'c.id', '=', 'v.created_by')
            ->where('v.recipe_id', $id)->orderByDesc('v.version')
            ->get(['v.id', 'v.version', 'v.status', 'v.base_output_kg', 'v.expected_yield_pct', 'v.standard_cost_per_kg', 'v.shelf_life_days', 'v.created_at',
                'v.approved_at', 'v.retired_at', 'a.name as approved_by_name', 'c.name as created_by_name']);
        $this->sinCostos($r, $rc->versions, ['standard_cost_per_kg']);

        return response()->json($rc);
    }

    public function store(Request $r)
    {
        $d = $r->validate([
            'product_id' => 'required|uuid', 'code' => 'required|string|max:40', 'name' => 'required|string|max:80',
            'recipe_type' => 'required|in:'.implode(',', Rec::TIPOS), 'line_code' => 'nullable|string|max:20',
            'output_variant_id' => 'nullable|uuid', 'base_output_kg' => 'required|numeric|gt:0',
        ]);

        return response()->json(Rec::crearReceta($d, $r->user()), 201);
    }

    public function update(Request $r, string $id)
    {
        $d = $r->validate([
            'name' => 'sometimes|string|max:80', 'recipe_type' => 'sometimes|in:'.implode(',', Rec::TIPOS), 'line_code' => 'nullable|string|max:20',
            'output_variant_id' => 'nullable|uuid', 'status' => 'sometimes|in:ACTIVE,INACTIVE',
        ]);
        DB::table('recipes')->where('id', $id)->exists() || abort(404);
        $this->dentroDelAlcance($r, Rec::receta($id)->brand_id);

        return response()->json(Rec::editarReceta($id, $d, $r->user()));
    }

    /** Opciones de los formularios: productos terminados, insumos, aditivos, marcas, líneas y catálogos de valores. */
    public function opciones(Request $r)
    {
        $marcas = Access::for($r->user())['brands'];
        $productos = DB::table('products as p')->join('brands as b', 'b.id', '=', 'p.brand_id')->where('p.status', 'ACTIVE')
            ->where('p.product_type', 'GOODS')->where('p.origin', 'PRODUCED')->when($marcas, fn ($x) => $x->whereIn('p.brand_id', $marcas))
            ->orderBy('p.name')->get(['p.id', 'p.code', 'p.name', 'p.brand_id', 'b.name as brand_name', 'p.storage', 'p.shelf_life_days']);
        $presentaciones = DB::table('product_variants')->whereIn('product_id', $productos->pluck('id'))->where('status', 'ACTIVE')
            ->orderBy('sku')->get(['id', 'product_id', 'sku', 'name']);
        // Ingredientes: materia prima e insumos por kg (no empaques ni productos por unidad).
        $insumos = DB::table('product_variants as v')->join('products as p', 'p.id', '=', 'v.product_id')->where('v.status', 'ACTIVE')
            ->where(fn ($x) => $x->where('p.product_type', 'INPUT')->orWhere('p.origin', 'RAW_MATERIAL')->orWhere('v.sale_mode', 'KG'))
            ->where('p.product_type', '<>', 'PACKAGING')->where('v.sale_mode', '<>', 'UNIT')
            ->orderBy('v.name')->get(['v.id', 'v.sku', 'v.name', 'p.product_type', 'p.line']);
        $empaques = DB::table('product_variants as v')->join('products as p', 'p.id', '=', 'v.product_id')->where('v.status', 'ACTIVE')
            ->where(fn ($x) => $x->where('p.product_type', 'PACKAGING')->orWhere('v.sku', 'like', 'IN-TRI%'))->orderBy('v.name')->get(['v.id', 'v.sku', 'v.name']);
        $aditivos = DB::table('food_additives')->orderBy('sin_code')->get(['id', 'sin_code', 'name', 'function_class', 'max_ppm', 'allergen', 'variant_id', 'status']);

        return response()->json([
            'products' => $productos, 'output_variants' => $presentaciones, 'inputs' => $insumos, 'packaging' => $empaques, 'additives' => $aditivos,
            'brands' => DB::table('brands')->when($marcas, fn ($x) => $x->whereIn('id', $marcas))->orderBy('name')->get(['id', 'code', 'name']),
            'lines' => DB::table('recipes')->whereNotNull('line_code')->distinct()->orderBy('line_code')->pluck('line_code'),
            'max_yield_pct' => (float) Params::get('rec_max_yield_pct'), 'cost_alert_pct' => (float) Params::get('rec_cost_alert_pct'),
            'see_recipe' => $this->verReceta($r), 'see_cost' => $this->verCostos($r),
        ]);
    }

    /** Cifras de la cabecera de REC-01, REC-04, REC-07 y REC-09. */
    public function cifras(Request $r, string $pantalla)
    {
        $this->exigirReceta($r);
        $filas = $this->base($r)->get();
        $alerta = (float) Params::get('rec_cost_alert_pct');
        $var = fn ($f) => $f->current_cost_per_kg && $f->current_recalc_cost_per_kg !== null
            ? ((float) $f->current_recalc_cost_per_kg - (float) $f->current_cost_per_kg) / (float) $f->current_cost_per_kg * 100 : null;
        $costos = $this->verCostos($r);

        return response()->json(match ($pantalla) {
            '01' => [
                'active' => $filas->where('status', 'ACTIVE')->count(), 'with_current' => $filas->whereNotNull('current_id')->count(),
                'in_review' => $filas->where('pending_status', 'IN_REVIEW')->count(), 'drafts' => $filas->where('pending_status', 'DRAFT')->count(),
                'cost_alerts' => $costos ? $filas->filter(fn ($f) => abs($var($f) ?? 0) > $alerta)->count() : null, 'cost_alert_pct' => $alerta,
                'control_points' => DB::table('recipe_control_points')->count(),
            ],
            '04' => [
                'additives' => DB::table('food_additives')->count(), 'with_limit' => DB::table('food_additives')->whereNotNull('max_ppm')->count(),
                'without_limit' => DB::table('food_additives')->whereNull('max_ppm')->count(),
                'used' => DB::table('food_additives as f')->whereExists(fn ($x) => $x->from('recipe_ingredients as i')->whereColumn('i.additive_id', 'f.id'))->count(),
            ],
            '07' => [
                'in_review' => $filas->where('pending_status', 'IN_REVIEW')->count(), 'drafts' => $filas->where('pending_status', 'DRAFT')->count(),
                'approved_30d' => DB::table('recipe_versions')->where('approved_at', '>=', now()->subDays(30))->count(),
            ],
            default => abort(404),
        });
    }

    /** Receta con su versión vigente (APPROVED) y la versión en curso (DRAFT o IN_REVIEW). */
    private function base(Request $r)
    {
        $q = DB::table('recipes as r')->join('products as p', 'p.id', '=', 'r.product_id')->join('brands as b', 'b.id', '=', 'r.brand_id')
            ->leftJoin('recipe_versions as cur', fn ($j) => $j->on('cur.recipe_id', '=', 'r.id')->where('cur.status', 'APPROVED'))
            ->leftJoin('recipe_versions as pend', fn ($j) => $j->on('pend.recipe_id', '=', 'r.id')->whereIn('pend.status', ['DRAFT', 'IN_REVIEW']))
            ->selectRaw('r.id, r.code, r.name, r.recipe_type, r.status, r.brand_id, r.line_code, r.product_id, p.name as product_name, b.name as brand_name,
                cur.id as current_id, cur.version as current_version, cur.expected_yield_pct as current_yield_pct, cur.standard_cost_per_kg as current_cost_per_kg,
                cur.recalc_cost_per_kg as current_recalc_cost_per_kg, cur.allergens::text as current_allergens, cur.shelf_life_days as current_shelf_life_days,
                pend.id as pending_id, pend.version as pending_version, pend.status as pending_status,
                (select max(version) from recipe_versions x where x.recipe_id = r.id) as last_version');
        $this->porMarca($q, $r, 'r.brand_id');

        return $q;
    }
}
