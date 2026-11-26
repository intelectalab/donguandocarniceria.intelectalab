<?php

namespace App\Modulos\Des\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Des\Services\DespieceService as Des;
use App\Modulos\Pro\Http\Controllers\Alcance;
use App\Modulos\Pro\Services\Comun;
use App\Modulos\Pro\Services\ProduccionService as Pro;
use App\Support\Listado;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** DES-01 a DES-09. El costeo y los precios se muestran con pro.cost.view. */
class DespieceController extends Controller
{
    use Alcance;

    public function index(Request $r)
    {
        $q = DB::table('cutting_templates as t')->join('product_variants as v', 'v.id', '=', 't.input_variant_id')->leftJoin('brands as b', 'b.id', '=', 't.brand_id')
            ->when($r->query('status'), fn ($x, $s) => $x->where('t.status', $s), fn ($x) => $r->query('todas') ? $x : $x->where('t.status', '<>', 'RETIRED'))
            ->when($r->query('species'), fn ($x, $s) => $x->where('t.species', $s))
            ->selectRaw("t.id, t.code, t.name, t.species, t.version, t.status, t.mass_balance_tolerance_pct, t.activated_at, t.created_at, v.sku as input_sku, v.name as input_variant_name,
                b.name as brand_name,
                (SELECT count(*) FROM cutting_template_lines l WHERE l.template_id = t.id) as cuts,
                (SELECT round(sum(l.standard_yield_pct), 3) FROM cutting_template_lines l WHERE l.template_id = t.id) as yield_sum,
                (SELECT count(*) FROM production_orders o WHERE o.cutting_template_id = t.id) as orders");

        return response()->json(Listado::de(DB::query()->fromSub($q, 's'), $r, buscar: ['code', 'name', 'species', 'input_sku', 'input_variant_name'],
            ordenar: ['code', 'name', 'species', 'version', 'status', 'activated_at', 'orders'], porDefecto: 'species'));
    }

    public function show(string $id)
    {
        DB::table('cutting_templates')->where('id', $id)->exists() || abort(404);

        return response()->json(Des::plantilla($id));
    }

    public function store(Request $r)
    {
        return response()->json(Des::guardarPlantilla($this->datos($r), null, $r->user()), 201);
    }

    public function update(Request $r, string $id)
    {
        return response()->json(Des::guardarPlantilla($this->datos($r), $id, $r->user()));
    }

    public function activar(Request $r, string $id)
    {
        return response()->json(Des::activar($id, $r->user()));
    }

    public function version(Request $r, string $id)
    {
        return response()->json(Des::nuevaVersion($id, $r->user()), 201);
    }

    public function retirar(Request $r, string $id)
    {
        return response()->json(Des::retirar($id, $r->user()));
    }

    private function datos(Request $r): array
    {
        return $r->validate([
            'code' => 'nullable|string|max:40', 'name' => 'nullable|string|max:80', 'species' => 'nullable|string|max:40', 'input_variant_id' => 'nullable|uuid',
            'mass_balance_tolerance_pct' => 'nullable|numeric|min:0|max:20', 'notes' => 'nullable|string|max:2000',
            'lines' => 'nullable|array|max:40', 'lines.*.seq' => 'nullable|integer|min:1', 'lines.*.name' => 'required_with:lines|string|max:80',
            'lines.*.role' => 'required_with:lines|in:CO_PRODUCT,BY_PRODUCT,WASTE', 'lines.*.output_variant_id' => 'nullable|uuid',
            'lines.*.standard_yield_pct' => 'required_with:lines|numeric|min:0|max:100', 'lines.*.nrv_cost_per_kg' => 'nullable|numeric|min:0', 'lines.*.notes' => 'nullable|string|max:500',
        ]);
    }

    /** DES-03: el precio vigente de cada corte de las plantillas, con su historial. */
    public function precios(Request $r)
    {
        $hoy = $r->query('date') ?: Comun::hoy();
        $cortes = DB::table('cutting_template_lines as l')->join('cutting_templates as t', 't.id', '=', 'l.template_id')->join('product_variants as v', 'v.id', '=', 'l.output_variant_id')
            ->where('t.status', '<>', 'RETIRED')->whereIn('l.role', ['CO_PRODUCT', 'BY_PRODUCT'])
            ->groupBy('v.id', 'v.sku', 'v.name')->selectRaw("v.id as variant_id, v.sku, v.name, string_agg(DISTINCT t.species, ', ') as species, string_agg(DISTINCT l.role, ',') as roles")
            ->orderBy('v.sku')->get();
        $hist = DB::table('cut_reference_prices as p')->leftJoin('users as u', 'u.id', '=', 'p.created_by')->whereIn('p.variant_id', $cortes->pluck('variant_id'))
            ->orderByDesc('p.valid_from')->get(['p.*', 'u.name as created_by_name'])->groupBy('variant_id');
        $filas = $cortes->map(function ($c) use ($hist, $hoy) {
            $v = Des::precioVigente($c->variant_id, $hoy);
            $c->price_per_kg = $v ? Comun::t($v->price_per_kg, 4) : null;
            $c->valid_from = $v?->valid_from;
            $c->source = $v?->source;
            $c->history = $hist[$c->variant_id] ?? [];

            return $c;
        })->values();
        $q = mb_strtolower(trim((string) $r->query('q')));

        return response()->json(['date' => $hoy, 'data' => $q === '' ? $filas : $filas->filter(fn ($c) => str_contains(mb_strtolower($c->sku.' '.$c->name.' '.$c->species), $q))->values(),
            'missing' => $filas->whereNull('price_per_kg')->count()]);
    }

    public function guardarPrecio(Request $r)
    {
        $d = $r->validate(['variant_id' => 'required|uuid', 'price_per_kg' => 'nullable|numeric|gt:0', 'source' => 'nullable|in:MANUAL,WEB_LIST',
            'valid_from' => 'nullable|date', 'note' => 'nullable|string|max:255']);

        return response()->json(Des::guardarPrecio($d, $r->user()), 201);
    }

    /** Despieces (órdenes CUTTING) para DES-04 a DES-06. */
    public function despieces(Request $r)
    {
        $q = DB::table('production_orders as o')->join('cutting_templates as t', 't.id', '=', 'o.cutting_template_id')->join('production_lines as l', 'l.id', '=', 'o.line_id')
            ->join('establishments as s', 's.id', '=', 'o.establishment_id')->where('o.order_type', 'CUTTING')
            ->when($r->query('status'), fn ($x, $v) => $x->whereIn('o.status', explode(',', $v)))
            ->when($r->query('species'), fn ($x, $v) => $x->where('t.species', $v))
            ->selectRaw("o.id, o.number, o.status, o.planned_date, o.close_date, o.planned_output_kg, o.input_kg, o.output_kg, o.waste_pct, o.mass_balance_pct, o.joint_cost,
                o.establishment_id, t.code as template_code, t.name as template_name, t.species, t.version as template_version, l.code as line_code,
                coalesce(s.short, s.name) as establishment_name, jsonb_array_length(coalesce(o.cut_alerts, '[]'::jsonb)) as alerts");
        $this->porLocal($q, $r, 'o.establishment_id');
        $p = Listado::de(DB::query()->fromSub($q, 's'), $r, buscar: ['number', 'template_name', 'species'],
            ordenar: ['number', 'planned_date', 'close_date', 'status', 'input_kg', 'mass_balance_pct', 'joint_cost'], porDefecto: '-planned_date');
        if (! $this->puede($r, 'pro.cost.view')) {
            $p->getCollection()->transform(fn ($o) => tap($o, fn () => $o->joint_cost = null));
        }

        return response()->json($p);
    }

    public function despiece(Request $r, string $id)
    {
        $o = DB::table('production_orders')->where('id', $id)->where('order_type', 'CUTTING')->first() ?? abort(404);
        $this->dentroDelAlcance($r, $o->establishment_id);
        $o = Pro::orden($id);
        $resumen = Pro::resumen($id);
        $costos = $this->puede($r, 'pro.cost.view');
        $salidas = Pro::salidas($id);
        $lineas = DB::table('cutting_template_lines as l')->leftJoin('product_variants as v', 'v.id', '=', 'l.output_variant_id')->where('l.template_id', $o->cutting_template_id)
            ->orderBy('l.seq')->get(['l.*', 'v.sku', 'v.name as variant_name'])
            ->map(function ($l) use ($id, $salidas) {
                $l->weighed = $salidas->where('template_line_id', $l->id)->values();
                $l->progress = Des::alertaCorte($id, $l->id);

                return $l;
            });
        $costeo = $costos ? Des::costeo($o, $resumen) : null;

        return response()->json([
            'order' => $o, 'summary' => $costos ? $resumen : array_merge($resumen, array_fill_keys(['raw_material_cost', 'input_cost', 'packaging_cost', 'material_cost', 'labor_cost', 'equipment_cost', 'total_cost', 'ingredient_cost_per_kg'], null)),
            'lines' => $lineas, 'outputs' => $salidas, 'consumptions' => Pro::consumos($id)->map(fn ($c) => $costos ? $c : tap($c, fn () => $c->unit_cost = $c->total_cost = null)),
            'mass_balance' => Des::balance($o), 'costing' => $costeo,
            'can' => ['record' => $this->puede($r, 'pro.order.record'), 'close' => $this->puede($r, 'pro.order.close'), 'override' => $this->puede($r, 'des.mass_balance.override'), 'cost' => $costos],
        ]);
    }

    /** DES-07 */
    public function cortes(Request $r)
    {
        [$desde, $hasta] = $this->periodo($r);
        $filas = collect(Des::cortes($desde, $hasta, $this->locales($r), $r->only(['species', 'supplier', 'operator'])));
        $agrupar = $r->query('group') ?: 'cut';
        $col = in_array($agrupar, ['cut', 'species', 'operator', 'supplier'], true) ? $agrupar : 'cut';
        $tol = (float) (\App\Support\Params::get('des_cut_yield_alert_pp') ?? 3);
        $grupos = $filas->where('role', '<>', 'WASTE')->groupBy(fn ($f) => $f->species.'|'.$f->{$col})->map(function ($g) use ($col, $tol) {
            $dev = $g->whereNotNull('deviation_pp');
            $prom = $dev->count() ? round($dev->avg('deviation_pp'), 2) : null;

            return ['key' => $g->first()->{$col}, 'species' => $g->first()->species, 'cut' => $col === 'cut' ? $g->first()->cut : null, 'records' => $g->count(),
                'kg' => Comun::t($g->sum(fn ($x) => (float) $x->weight_kg)), 'standard_pct' => $col === 'cut' ? Comun::t($g->first()->standard_yield_pct, 3) : null,
                'actual_pct' => Comun::t($g->avg('actual_yield_pct'), 2), 'deviation_pp' => Comun::t($prom, 2),
                'out_of_standard' => $dev->filter(fn ($x) => abs($x->deviation_pp) > $tol + 0.000001)->count()];
        })->sortBy([['species', 'asc'], ['key', 'asc']])->values();

        return response()->json(['period' => ['from' => $desde, 'to' => $hasta], 'group' => $col, 'alert_pp' => Comun::t($tol, 2), 'data' => $grupos,
            'filters' => ['species' => $filas->pluck('species')->unique()->sort()->values(), 'suppliers' => $filas->pluck('supplier')->unique()->sort()->values(),
                'operators' => $filas->pluck('operator')->unique()->sort()->values()]]);
    }

    /** DES-08 */
    public function proveedores(Request $r)
    {
        [$desde, $hasta] = $this->periodo($r);
        $d = Des::proveedores($desde, $hasta, $this->locales($r));
        if (! $this->puede($r, 'pro.cost.view')) {
            $d = array_map(fn ($x) => array_merge($x, ['cost_per_useful_kg' => null]), $d);
        }

        return response()->json(['period' => ['from' => $desde, 'to' => $hasta], 'data' => $d]);
    }

    /** DES-09 */
    public function tablero(Request $r)
    {
        [$desde, $hasta] = $this->periodo($r);
        $k = Des::kpis($desde, $hasta, $this->locales($r));
        if (! $this->puede($r, 'pro.cost.view')) {
            $k['cost_per_useful_kg'] = null;
            $k['by_species'] = array_map(fn ($x) => array_merge($x, ['cost_per_useful_kg' => null]), $k['by_species']);
        }
        $k['recent_alerts'] = DB::table('production_orders')->where('order_type', 'CUTTING')->where('status', 'CLOSED')->whereBetween('close_date', [$desde, $hasta])
            ->whereRaw("jsonb_array_length(coalesce(cut_alerts, '[]'::jsonb)) > 0")->when($this->locales($r), fn ($q, $l) => $q->whereIn('establishment_id', $l))
            ->orderByDesc('close_date')->limit(10)->get(['id', 'number', 'close_date', 'cut_alerts'])
            ->map(fn ($o) => tap($o, fn () => $o->cut_alerts = json_decode($o->cut_alerts, true)));

        return response()->json($k);
    }

    /** ?month=2026-10, o ?from y ?to. */
    private function periodo(Request $r): array
    {
        if ($r->query('from') && $r->query('to')) {
            return [Comun::fecha($r->query('from')), Comun::fecha($r->query('to'))];
        }

        return Comun::mes($r->query('month'));
    }
}
