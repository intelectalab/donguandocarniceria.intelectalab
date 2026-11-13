<?php

namespace App\Modulos\Rec\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Rec\Services\RecetasService as Rec;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** REC-03 Ingredientes, REC-05 Pasos y REC-06 Puntos de control de una versión. */
class DetalleController extends Controller
{
    use Alcance;

    /** REC-03: ingredientes con % del total, dosis en ppm del aditivo y, con permiso, costo e importe. */
    public function ingredientes(Request $r, string $versionId)
    {
        $this->exigirReceta($r);
        $v = $this->version($r, $versionId);
        $ins = Rec::ingredientes($v->id);
        $total = (float) $ins->sum(fn ($i) => (float) $i->qty_kg);
        $costos = $this->verCostos($r) ? collect(Rec::costo($v->id)['rows'])->keyBy('id') : null;
        $filas = $ins->map(fn ($i) => [
            'id' => $i->id, 'seq' => (int) $i->seq, 'variant_id' => $i->variant_id, 'sku' => $i->sku, 'name' => $i->variant_name, 'qty_kg' => Rec::t($i->qty_kg, 4),
            'pct' => Rec::t($total > 0 ? (float) $i->qty_kg / $total * 100 : 0, 2), 'weighing_tolerance_pct' => Rec::t($i->weighing_tolerance_pct, 2),
            'is_additive' => (bool) $i->is_additive, 'additive_id' => $i->additive_id, 'sin_code' => $i->sin_code, 'additive_name' => $i->additive_name,
            'max_ppm' => $i->max_ppm, 'ppm' => $i->is_additive ? Rec::t(Rec::ppm((float) $i->qty_kg, $total), 1) : null,
            'over_limit' => $i->is_additive && $i->max_ppm !== null && Rec::ppm((float) $i->qty_kg, $total) > (float) $i->max_ppm,
            'allergen' => $i->allergen, 'additive_allergen' => $i->additive_allergen,
            'cost' => $costos[$i->id]['cost'] ?? null, 'amount' => $costos[$i->id]['amount'] ?? null, 'cost_source' => $costos[$i->id]['source'] ?? null,
        ])->values();
        $checks = array_values(array_filter(Rec::validar($v->id), fn ($c) => in_array($c['code'], ['RN-REC-04', 'RN-REC-05'], true)));

        return response()->json(['data' => $filas, 'total_kg' => Rec::t($total, 4), 'allergens' => Rec::alergenos($v->id), 'checks' => $checks,
            'total_cost' => $costos ? Rec::costo($v->id)['total'] : null]);
    }

    public function guardarIngrediente(Request $r, string $versionId, ?string $id = null)
    {
        $d = $r->validate([
            'variant_id' => ($id ? 'sometimes' : 'required').'|uuid', 'qty_kg' => ($id ? 'sometimes' : 'required').'|numeric|gt:0',
            'weighing_tolerance_pct' => 'nullable|numeric|min:0|max:100', 'is_additive' => 'boolean', 'additive_id' => 'nullable|uuid',
            'allergen' => 'nullable|string|max:20', 'seq' => 'nullable|integer|min:1',
        ]);
        $this->version($r, $versionId);

        return response()->json(Rec::guardarIngrediente($versionId, $d, $id, $r->user()), $id ? 200 : 201);
    }

    /** REC-05: pasos con sus puntos de control. */
    public function pasos(Request $r, string $versionId)
    {
        $this->exigirReceta($r);
        $v = $this->version($r, $versionId);
        $puntos = DB::table('recipe_control_points')->where('version_id', $v->id)->get(['id', 'step_seq', 'code', 'is_critical'])->groupBy('step_seq');
        $pasos = DB::table('recipe_steps')->where('version_id', $v->id)->orderBy('seq')->get()
            ->map(fn ($s) => (array) $s + ['control_points' => ($puntos[$s->seq] ?? collect())->values()]);

        return response()->json(['data' => $pasos, 'total_min' => Rec::t($pasos->sum(fn ($s) => (float) ($s['duration_min'] ?? 0)), 2),
            'control_points' => DB::table('recipe_control_points')->where('version_id', $v->id)->count()]);
    }

    public function guardarPaso(Request $r, string $versionId, ?string $id = null)
    {
        $d = $r->validate(['description' => ($id ? 'sometimes' : 'required').'|string|max:1000', 'duration_min' => 'nullable|numeric|min:0|max:100000',
            'equipment_category' => 'nullable|in:'.implode(',', Rec::EQUIPOS)]);
        $this->version($r, $versionId);

        return response()->json(Rec::guardarPaso($versionId, $d, $id, $r->user()), $id ? 200 : 201);
    }

    public function moverPaso(Request $r, string $id)
    {
        $d = $r->validate(['dir' => 'required|in:-1,1']);
        $paso = DB::table('recipe_steps')->where('id', $id)->first() ?? abort(404);
        $this->version($r, $paso->version_id);
        Rec::moverPaso($id, (int) $d['dir'], $r->user());

        return response()->noContent();
    }

    /** REC-06: puntos de control. Las lecturas de producción llegarán con PRO (KPI-REC-03). */
    public function puntos(Request $r, string $versionId)
    {
        $this->exigirReceta($r);
        $v = $this->version($r, $versionId);
        $pasos = DB::table('recipe_steps')->where('version_id', $v->id)->pluck('description', 'seq');
        $filas = DB::table('recipe_control_points')->where('version_id', $v->id)->orderBy('step_seq')->orderBy('code')->get()
            ->map(fn ($c) => (array) $c + ['step_description' => $pasos[$c->step_seq] ?? null]);
        $cocida = in_array($v->recipe_type, Rec::COCIDAS, true);
        $critico = $filas->contains(fn ($c) => $c['is_critical'] && in_array($c['variable'], ['CORE_TEMP', 'TIME'], true));

        return response()->json(['data' => $filas, 'needs_critical' => $cocida, 'has_critical' => $critico, 'recipe_type' => $v->recipe_type,
            'steps' => $pasos->map(fn ($d, $s) => ['seq' => $s, 'description' => $d])->values()]);
    }

    public function guardarPunto(Request $r, string $versionId, ?string $id = null)
    {
        $req = $id ? 'sometimes' : 'required';
        $d = $r->validate(['code' => "{$req}|string|max:20", 'variable' => "{$req}|in:".implode(',', Rec::VARIABLES), 'min_value' => "{$req}|numeric",
            'max_value' => "{$req}|numeric", 'unit' => "{$req}|string|max:20", 'is_critical' => 'boolean', 'corrective_action' => "{$req}|string|max:255",
            'step_seq' => 'nullable|integer|min:0']);
        $this->version($r, $versionId);

        return response()->json(Rec::guardarPunto($versionId, $d, $id, $r->user()), $id ? 200 : 201);
    }

    /** DELETE /ingredientes/{id}, /pasos/{id}, /puntos/{id}. */
    public function quitar(Request $r, string $tipo, string $id)
    {
        $tabla = ['ingredientes' => 'recipe_ingredients', 'pasos' => 'recipe_steps', 'puntos' => 'recipe_control_points'][$tipo] ?? abort(404);
        $fila = DB::table($tabla)->where('id', $id)->first() ?? abort(404);
        $this->version($r, $fila->version_id);
        Rec::quitar($tipo, $id, $r->user());

        return response()->noContent();
    }

    private function version(Request $r, string $id): object
    {
        $v = DB::table('recipe_versions as v')->join('recipes as r', 'r.id', '=', 'v.recipe_id')->where('v.id', $id)
            ->first(['v.id', 'v.status', 'r.brand_id', 'r.recipe_type']) ?? abort(404);
        $this->dentroDelAlcance($r, $v->brand_id);

        return $v;
    }
}
