<?php

namespace App\Modulos\Rec\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Rec\Services\RecetasService as Rec;
use App\Support\Access;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Una versión de receta: REC-02 editor, REC-07 revisión y aprobación, REC-08 escalado,
 * REC-09 costo y REC-10 ficha técnica. El selector de versiones de las pantallas sale de index().
 */
class VersionController extends Controller
{
    use Alcance;

    /** Selector de versiones: ?status=APPROVED o ?status=DRAFT,IN_REVIEW, ?recipe_id. */
    public function index(Request $r)
    {
        $this->exigirReceta($r);
        $q = DB::table('recipe_versions as v')->join('recipes as r', 'r.id', '=', 'v.recipe_id')
            ->when($r->query('status'), fn ($x, $s) => $x->whereIn('v.status', explode(',', $s)))
            ->when($r->query('recipe_id'), fn ($x, $id) => $x->where('v.recipe_id', $id))
            ->orderBy('r.code')->orderByDesc('v.version');
        $this->porMarca($q, $r, 'r.brand_id');

        return response()->json(['data' => $q->get(['v.id', 'v.version', 'v.status', 'v.recipe_id', 'r.code as recipe_code', 'r.name as recipe_name', 'v.created_by', 'v.submitted_at'])]);
    }

    public function show(Request $r, string $id)
    {
        $this->exigirReceta($r);
        $v = $this->ver($r, $id);
        $v->can_approve = Access::can($r->user(), 'rec.version.approve') && $v->created_by !== $r->user()->id;
        if ($this->verCostos($r)) {
            $v->live_cost_per_kg = Rec::costo($v->id)['per_kg'];
        }

        return response()->json($v);
    }

    public function store(Request $r, string $recipeId)
    {
        $d = $r->validate(['from_version_id' => 'nullable|uuid']);
        DB::table('recipes')->where('id', $recipeId)->exists() || abort(404);
        $this->dentroDelAlcance($r, Rec::receta($recipeId)->brand_id);

        return response()->json(Rec::nuevaVersion($recipeId, $d['from_version_id'] ?? null, $r->user()), 201);
    }

    public function update(Request $r, string $id)
    {
        $d = $r->validate([
            'base_output_kg' => 'sometimes|numeric|gt:0', 'shelf_life_days' => 'nullable|integer|min:1|max:3650',
            'storage' => 'sometimes|in:'.implode(',', Rec::CONSERVACION), 'notes' => 'nullable|string|max:2000',
            'packaging' => 'sometimes|array|max:20', 'packaging.*.variant_id' => 'required|uuid', 'packaging.*.per' => 'required|in:KG,UNIT',
            'packaging.*.qty' => 'required|numeric|gt:0',
        ]);
        $this->ver($r, $id);

        return response()->json($this->conCostos($r, Rec::guardarVersion($id, $d, $r->user())));
    }

    public function destroy(Request $r, string $id)
    {
        $this->ver($r, $id);
        Rec::borrarBorrador($id, $r->user());

        return response()->noContent();
    }

    public function enviar(Request $r, string $id)
    {
        $this->ver($r, $id);

        return response()->json($this->conCostos($r, Rec::enviar($id, $r->user())));
    }

    public function devolver(Request $r, string $id)
    {
        $d = $r->validate(['reason' => 'required|string|min:5|max:500']);
        $this->ver($r, $id);

        return response()->json($this->conCostos($r, Rec::devolver($id, $d['reason'], $r->user())));
    }

    public function aprobar(Request $r, string $id)
    {
        $this->ver($r, $id);

        return response()->json($this->conCostos($r, Rec::aprobar($id, $r->user())));
    }

    /** REC-07: validaciones y comparación con la versión vigente. */
    public function revision(Request $r, string $id)
    {
        $this->exigirReceta($r);
        $v = $this->ver($r, $id);
        $prev = DB::table('recipe_versions')->where('recipe_id', $v->recipe_id)->where('status', 'APPROVED')->where('id', '<>', $v->id)->first();
        if (! $prev && $v->status === 'APPROVED') {
            $prev = DB::table('recipe_versions')->where('recipe_id', $v->recipe_id)->where('status', 'RETIRED')->where('version', '<', $v->version)->orderByDesc('version')->first();
        }
        $a = $prev ? Rec::ingredientes($prev->id)->keyBy('variant_id') : collect();
        $b = Rec::ingredientes($v->id)->keyBy('variant_id');
        $filas = $a->keys()->merge($b->keys())->unique()->values()->map(fn ($k) => [
            'variant_id' => $k, 'sku' => ($b[$k] ?? $a[$k])->sku, 'name' => ($b[$k] ?? $a[$k])->variant_name,
            'before' => isset($a[$k]) ? Rec::t($a[$k]->qty_kg, 4) : null, 'now' => isset($b[$k]) ? Rec::t($b[$k]->qty_kg, 4) : null,
        ]);
        $costos = $this->verCostos($r);
        $resumen = fn ($x) => $x ? [
            'id' => $x->id, 'version' => (int) $x->version, 'status' => $x->status, 'base_output_kg' => Rec::t($x->base_output_kg, 3), 'total_kg' => Rec::t(Rec::totalKg($x->id), 4),
            'yield_pct' => Rec::t(Rec::rendimiento($x->id), 2), 'shelf_life_days' => $x->shelf_life_days, 'storage' => $x->storage,
            'allergens' => in_array($x->status, ['APPROVED', 'RETIRED'], true) ? (json_decode($x->allergens ?? '[]', true) ?: []) : Rec::alergenos($x->id),
            'cost_per_kg' => $costos ? (in_array($x->status, ['APPROVED', 'RETIRED'], true) ? $x->standard_cost_per_kg : Rec::costo($x->id)['per_kg']) : null,
            'steps' => DB::table('recipe_steps')->where('version_id', $x->id)->count(), 'control_points' => DB::table('recipe_control_points')->where('version_id', $x->id)->count(),
        ] : null;
        $u = $r->user();

        return response()->json([
            'version' => $resumen($v), 'previous' => $resumen($prev), 'ingredients' => $filas, 'checks' => Rec::validar($v->id),
            'author' => ['id' => $v->created_by, 'name' => $v->created_by_name, 'is_me' => $v->created_by === $u->id],
            'reviewer' => ['name' => $u->name, 'can_approve' => Access::can($u, 'rec.version.approve')],
        ]);
    }

    /** REC-08 (y PRO-05): ?kg= kg deseados. Lo ven también los operarios (D-REC-02), sin costo. */
    public function escalar(Request $r, string $id)
    {
        $d = $r->validate(['kg' => 'required|numeric|gt:0|max:100000']);
        $v = $this->ver($r, $id);
        $res = Rec::escalar($id, $d['kg']);
        $res['status'] = $v->status;
        $res['recipe_code'] = $v->recipe_code;
        $res['recipe_name'] = $v->recipe_name;
        $res['expected_yield_pct'] = $v->expected_yield_pct ?? $v->live_yield_pct;
        $res['batch_cost'] = $this->verCostos($r) && $v->standard_cost_per_kg !== null ? Rec::t((float) $v->standard_cost_per_kg * (float) $d['kg'], 2) : null;
        // Stock liberado de cada ingrediente (lectura de ALM), para avisar si no alcanza.
        $stock = DB::table('stock_balances as b')->leftJoin('lots as l', 'l.id', '=', 'b.lot_id')->whereIn('b.variant_id', array_column($res['lines'], 'variant_id'))
            ->where(fn ($x) => $x->whereNull('b.lot_id')->orWhere('l.qc_status', 'RELEASED'))->groupBy('b.variant_id')
            ->selectRaw('b.variant_id, sum(b.qty - b.reserved_qty) as q')->pluck('q', 'variant_id');
        foreach ($res['lines'] as &$l) {
            $l['available_kg'] = Rec::t($stock[$l['variant_id']] ?? 0, 3);
        }
        unset($l);
        if (! $this->verReceta($r)) {
            unset($res['packaging']);
        }

        return response()->json($res);
    }

    /** REC-09: costo por ingrediente con el costo promedio vigente. */
    public function costo(Request $r, string $id)
    {
        abort_unless($this->verCostos($r), 403, 'No tienes el permiso rec.cost.view.');
        $v = $this->ver($r, $id);
        $c = Rec::costo($id);

        return response()->json($c + ['version_id' => $v->id, 'version' => (int) $v->version, 'status' => $v->status, 'recipe_code' => $v->recipe_code,
            'recipe_name' => $v->recipe_name, 'base_output_kg' => Rec::t($v->base_output_kg, 3), 'standard_cost_per_kg' => $v->standard_cost_per_kg,
            'variation_pct' => $v->standard_cost_per_kg && $c['per_kg'] !== null ? Rec::t(((float) $c['per_kg'] - (float) $v->standard_cost_per_kg) / (float) $v->standard_cost_per_kg * 100, 2) : null]);
    }

    /** REC-10: datos de la ficha técnica (la web la imprime o la guarda en PDF). */
    public function ficha(Request $r, string $id)
    {
        $this->exigirReceta($r);
        $v = $this->ver($r, $id);
        $total = Rec::totalKg($v->id);
        $ins = Rec::ingredientes($v->id)->sortByDesc(fn ($i) => (float) $i->qty_kg)->values()->map(fn ($i) => [
            'name' => $i->is_additive && $i->additive_name ? $i->additive_name : preg_replace('/\s*\(SIN [^)]*\)$/u', '', $i->variant_name),
            'pct' => Rec::t($total > 0 ? (float) $i->qty_kg / $total * 100 : 0, 2), 'is_additive' => (bool) $i->is_additive, 'sin_code' => $i->sin_code,
            'function_class' => $i->function_class, 'ppm' => $i->is_additive ? Rec::t(Rec::ppm((float) $i->qty_kg, $total), 1) : null, 'max_ppm' => $i->max_ppm,
        ]);
        $p = DB::table('products')->where('id', $v->product_id)->first();
        $reg = DB::table('sanitary_registrations')->where('product_id', $p->id)->where('status', '<>', 'REVOKED')->orderByDesc('expires_on')->first();
        $marca = DB::table('brands')->where('id', $v->brand_id)->first();
        $cerrada = in_array($v->status, ['APPROVED', 'RETIRED'], true);

        return response()->json([
            'version' => (int) $v->version, 'status' => $v->status, 'recipe_code' => $v->recipe_code, 'recipe_name' => $v->recipe_name,
            'product_name' => $p->name, 'brand' => ['name' => $marca->name, 'legal_footer' => $marca->legal_footer ?? null],
            'company_name' => DB::table('companies')->orderBy('created_at')->value('legal_name'),
            'ingredients' => $ins, 'allergens' => $cerrada ? $v->allergens : $v->live_allergens,
            'shelf_life_days' => $v->shelf_life_days, 'storage' => $v->storage,
            'presentations' => DB::table('product_variants')->where('product_id', $p->id)->where('status', 'ACTIVE')->orderBy('sku')->pluck('name'),
            'control_points' => DB::table('recipe_control_points')->where('version_id', $v->id)->orderBy('step_seq')->orderBy('code')
                ->get(['code', 'variable', 'min_value', 'max_value', 'unit', 'is_critical']),
            'sanitary' => ['number' => $reg->number ?? $p->sanitary_registry, 'authority' => $reg->authority ?? $p->sanitary_authority,
                'expires_on' => $reg->expires_on ?? $p->sanitary_registry_expires],
            'approved_at' => $v->approved_at, 'approved_by_name' => $v->approved_by_name,
        ]);
    }

    private function ver(Request $r, string $id): object
    {
        DB::table('recipe_versions')->where('id', $id)->exists() || abort(404);
        $v = Rec::version($id);
        $this->dentroDelAlcance($r, $v->brand_id);

        return $this->conCostos($r, $v);
    }

    private function conCostos(Request $r, object $v): object
    {
        $this->sinCostos($r, [$v], ['standard_cost_per_kg', 'recalc_cost_per_kg']);

        return $v;
    }
}
