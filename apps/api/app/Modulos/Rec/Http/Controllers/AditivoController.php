<?php

namespace App\Modulos\Rec\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Rec\Services\RecetasService as Rec;
use App\Support\Listado;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** REC-04 Catálogo de aditivos: código SIN, función, límite máximo (D-REC-01), alérgeno e insumo de almacén. */
class AditivoController extends Controller
{
    use Alcance;

    public function index(Request $r)
    {
        $this->exigirReceta($r);
        $q = DB::table('food_additives as f')->leftJoin('product_variants as v', 'v.id', '=', 'f.variant_id')
            ->when($r->query('function_class'), fn ($x, $c) => $x->where('f.function_class', $c))
            ->when($r->query('status'), fn ($x, $s) => $x->where('f.status', $s))
            ->when($r->query('limite') === 'SI', fn ($x) => $x->whereNotNull('f.max_ppm'))
            ->when($r->query('limite') === 'NO', fn ($x) => $x->whereNull('f.max_ppm'))
            ->selectRaw('f.*, v.name as variant_name, v.sku,
                (select count(distinct i.version_id) from recipe_ingredients i where i.additive_id = f.id) as uses');

        return response()->json(Listado::de(DB::query()->fromSub($q, 's'), $r, buscar: ['sin_code', 'name', 'allergen'],
            ordenar: ['sin_code', 'name', 'function_class', 'max_ppm', 'uses'], porDefecto: 'sin_code'));
    }

    /** Ficha con su uso en las versiones de receta y la dosis en cada una. */
    public function show(Request $r, string $id)
    {
        $this->exigirReceta($r);
        $a = DB::table('food_additives as f')->leftJoin('product_variants as v', 'v.id', '=', 'f.variant_id')->where('f.id', $id)
            ->first(['f.*', 'v.name as variant_name', 'v.sku']) ?? abort(404);
        $uso = DB::table('recipe_ingredients as i')->join('recipe_versions as rv', 'rv.id', '=', 'i.version_id')->join('recipes as r', 'r.id', '=', 'rv.recipe_id')
            ->where('i.additive_id', $id)->orderBy('r.code')->orderByDesc('rv.version')
            ->get(['rv.id as version_id', 'rv.version', 'rv.status', 'r.code', 'r.name', 'r.brand_id', 'i.qty_kg']);
        $this->porMarcaEnColeccion($r, $uso);
        $a->usage = $uso->filter(fn ($u) => $u->visible)->map(function ($u) use ($a) {
            $total = Rec::totalKg($u->version_id);
            $ppm = Rec::ppm((float) $u->qty_kg, $total);

            return ['version_id' => $u->version_id, 'version' => (int) $u->version, 'status' => $u->status, 'code' => $u->code, 'name' => $u->name,
                'qty_kg' => Rec::t($u->qty_kg, 4), 'ppm' => Rec::t($ppm, 1), 'over_limit' => $a->max_ppm !== null && $ppm > (float) $a->max_ppm];
        })->values();

        return response()->json($a);
    }

    public function guardar(Request $r, ?string $id = null)
    {
        $d = $r->validate([
            'sin_code' => 'required|string|max:20', 'name' => 'required|string|max:80', 'function_class' => 'required|in:'.implode(',', Rec::FUNCIONES),
            'max_ppm' => 'nullable|numeric|gt:0', 'max_ppm_source' => 'nullable|string|max:255', 'allergen' => 'nullable|string|max:20',
            'variant_id' => 'nullable|uuid', 'status' => 'nullable|in:ACTIVE,INACTIVE',
        ]);

        return response()->json(Rec::guardarAditivo($d, $id, $r->user()), $id ? 200 : 201);
    }

    private function porMarcaEnColeccion(Request $r, $filas): void
    {
        $marcas = \App\Support\Access::for($r->user())['brands'];
        foreach ($filas as $f) {
            $f->visible = ! $marcas || in_array($f->brand_id, $marcas, true);
        }
    }
}
