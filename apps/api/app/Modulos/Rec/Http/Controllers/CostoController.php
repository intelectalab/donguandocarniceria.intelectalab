<?php

namespace App\Modulos\Rec\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Rec\Services\RecetasService as Rec;
use App\Support\Params;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * REC-09 Costo de la receta: costo estándar al aprobar frente al de hoy (costo promedio vigente de
 * cada insumo) y su variación (KPI-REC-01). Solo con rec.cost.view (la ruta lo exige).
 */
class CostoController extends Controller
{
    use Alcance;

    public function index(Request $r)
    {
        $q = DB::table('recipe_versions as v')->join('recipes as r', 'r.id', '=', 'v.recipe_id')->join('brands as b', 'b.id', '=', 'r.brand_id')
            ->where('v.status', 'APPROVED')->orderBy('r.code');
        $this->porMarca($q, $r, 'r.brand_id');
        $filas = $q->get(['v.id', 'v.version', 'v.recipe_id', 'v.standard_cost_per_kg', 'v.recalc_cost_per_kg', 'v.recalc_at', 'v.approved_at',
            'r.code', 'r.name', 'r.brand_id', 'b.name as brand_name']);
        $alerta = (float) Params::get('rec_cost_alert_pct');
        $q2 = trim(mb_strtolower((string) $r->query('q', '')));
        $data = $filas->map(function ($f) use ($alerta) {
            $hoy = (float) Rec::costo($f->id)['per_kg'];
            $std = (float) $f->standard_cost_per_kg;
            $var = $std > 0 ? round(($hoy - $std) / $std * 100, 2) : null;

            return ['id' => $f->id, 'version' => (int) $f->version, 'recipe_id' => $f->recipe_id, 'code' => $f->code, 'name' => $f->name, 'brand_name' => $f->brand_name,
                'standard_cost_per_kg' => Rec::t($f->standard_cost_per_kg, 4), 'cost_today_per_kg' => Rec::t($hoy, 4), 'variation_pct' => Rec::t($var, 2),
                'alert' => $var !== null && abs($var) > $alerta, 'recalc_cost_per_kg' => Rec::t($f->recalc_cost_per_kg, 4), 'recalc_at' => $f->recalc_at,
                'approved_at' => $f->approved_at];
        })->when($q2 !== '', fn ($c) => $c->filter(fn ($f) => str_contains(mb_strtolower($f['code'].' '.$f['name']), $q2)))
            ->sortByDesc(fn ($f) => abs((float) ($f['variation_pct'] ?? 0)))->values();
        $vars = $data->pluck('variation_pct')->filter(fn ($v) => $v !== null)->map(fn ($v) => (float) $v);

        return response()->json(['data' => $data, 'kpi' => [
            'average_variation_pct' => $vars->count() ? Rec::t($vars->avg(), 2) : null, 'over_alert' => $data->where('alert', true)->count(),
            'approved' => $data->count(), 'alert_pct' => $alerta,
        ]]);
    }

    public function recalcular(Request $r)
    {
        return response()->json(Rec::recalcularCostos($r->user()));
    }
}
