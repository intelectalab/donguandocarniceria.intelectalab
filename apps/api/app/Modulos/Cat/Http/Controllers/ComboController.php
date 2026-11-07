<?php

namespace App\Modulos\Cat\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Cat\Services\Combos;
use App\Modulos\Cat\Services\Precios;
use App\Support\Access;
use App\Support\RuleError;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * CAT-08 Combos: componentes con cantidad, peso estimado y porcentaje del precio; el reparto suma 100 %
 * y se muestra cuántos combos alcanzan con el stock de cada componente. Reglas en Services\Combos.
 */
class ComboController extends Controller
{
    public function index(Request $request)
    {
        $marcas = Access::for($request->user())['brands'];
        $combos = DB::table('product_variants as v')->join('products as p', 'p.id', '=', 'v.product_id')
            ->leftJoin('brands as b', 'b.id', '=', 'v.brand_id')->where('p.product_type', 'COMBO')
            ->when($marcas, fn ($q) => $q->whereIn('v.brand_id', $marcas))
            ->when($request->query('brand_id'), fn ($q, $m) => $q->where('v.brand_id', $m))
            ->orderBy('v.sku')->get(['v.id', 'v.sku', 'v.name', 'v.status', 'v.brand_id', 'b.name as brand_name', 'p.id as product_id']);

        $componentes = $combos->mapWithKeys(fn ($c) => [$c->id => Combos::componentes($c->id)]);
        $stock = Combos::stock($componentes->flatten(1)->pluck('component_variant_id')->unique()->values()->all());
        $precios = Precios::vigentes($combos->pluck('id')->all(), ['canal' => ProductoController::CANAL]);

        return response()->json($combos->map(function ($c) use ($componentes, $stock, $precios) {
            $cs = $componentes[$c->id];
            $precio = $precios[$c->id] ?? null;
            $revision = Combos::revisar($c->id);
            $c->precio_whatsapp = $precio;
            $c->revision = $revision;
            $c->alcanza = Combos::alcanza($cs, $stock);
            $c->componentes = $cs->map(fn ($x) => [
                'id' => $x->id, 'component_variant_id' => $x->component_variant_id, 'sku' => $x->sku, 'name' => $x->name, 'sale_mode' => $x->sale_mode,
                'qty' => (float) $x->qty, 'est_weight_kg' => $x->est_weight_kg === null ? null : (float) $x->est_weight_kg,
                'price_share_pct' => (float) $x->price_share_pct, 'stock' => $stock[$x->component_variant_id] ?? 0,
                'importe' => $precio ? round($precio['price'] * $x->price_share_pct / 100, 2) : null,
            ])->values();

            return $c;
        })->values());
    }

    public function store(Request $request)
    {
        $request->merge(['code' => mb_strtoupper(trim((string) $request->input('code')))]);
        $d = $request->validate([
            'brand_id' => ['required', 'uuid', 'exists:brands,id'],
            'code' => ['required', 'regex:/^[A-Z0-9-]{2,30}$/', Rule::unique('products', 'code')],
            'name' => ['required', 'string', 'max:255'],
            'price' => ['required', 'numeric', 'gt:0', 'max:99999'],
        ], ['code.unique' => 'Ya existe un producto con ese código (RN-CAT-01).', 'code.regex' => 'El código tiene letras, números o guiones. Ej.: PACK-PARRILLA.']);
        $sku = DB::table('brands')->where('id', $d['brand_id'])->value('code').'-'.$d['code'];
        if (DB::table('product_variants')->where('sku', $sku)->exists()) {
            RuleError::fail('RN-CAT-01', "Ya existe una variante con el SKU {$sku}.");
        }
        $v = Combos::crear($d, $request->user());

        return response()->json(['id' => $v->id, 'sku' => $v->sku], 201);
    }

    public function agregar(Request $request, string $id)
    {
        $combo = Combos::delAlcance($request->user(), $id);

        return response()->json(Combos::guardarComponente($combo, $this->validar($request, true), null), 201);
    }

    public function actualizar(Request $request, string $id, string $componente)
    {
        $combo = Combos::delAlcance($request->user(), $id);
        $c = DB::table('combo_components')->where('combo_variant_id', $id)->where('id', $componente)->first() ?? abort(404);

        return response()->json(Combos::guardarComponente($combo, $this->validar($request, false), $c));
    }

    public function quitar(Request $request, string $id, string $componente)
    {
        $combo = Combos::delAlcance($request->user(), $id);
        $c = DB::table('combo_components')->where('combo_variant_id', $id)->where('id', $componente)->first() ?? abort(404);
        Combos::quitarComponente($combo, $c);

        return response()->noContent();
    }

    private function validar(Request $request, bool $nuevo): array
    {
        return $request->validate([
            'component_variant_id' => [$nuevo ? 'required' : 'nullable', 'uuid'],
            'qty' => ['required', 'numeric', 'gt:0', 'max:9999'],
            'est_weight_kg' => ['nullable', 'numeric', 'min:0', 'max:9999'],
            'price_share_pct' => ['required', 'numeric', 'min:0.01', 'max:100'],
        ], [
            'qty.gt' => 'La cantidad del componente debe ser mayor que cero.',
            'price_share_pct.min' => 'El porcentaje del precio va de 0,01 a 100.',
            'price_share_pct.max' => 'El porcentaje del precio va de 0,01 a 100.',
        ]);
    }
}
