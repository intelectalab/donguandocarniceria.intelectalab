<?php

namespace App\Modulos\Cat\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Cat\Services\Balanza;
use App\Modulos\Cat\Services\Precios;
use App\Modulos\Plt\Services\Parametros;
use App\Support\Access;
use App\Support\RuleError;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/** CAT-11 Etiquetas de balanza: formato EAN-13 prefijo 2, prueba de lectura y etiqueta de prueba (RN-CAT-12). */
class EtiquetaController extends Controller
{
    public function index(Request $request)
    {
        $marcas = Access::for($request->user())['brands'];
        $variantes = DB::table('product_variants as v')->leftJoin('brands as b', 'b.id', '=', 'v.brand_id')
            ->whereNotNull('v.scale_plu')->where('v.status', 'ACTIVE')
            ->when($marcas, fn ($q) => $q->whereIn('v.brand_id', $marcas))
            ->orderBy('v.scale_plu')->get(['v.id', 'v.scale_plu', 'v.sku', 'v.name', 'v.sale_mode', 'b.name as brand_name']);

        return response()->json(['formato' => Balanza::formato(), 'variantes' => $variantes]);
    }

    /** Lee una etiqueta con el formato vigente y suma el precio de mostrador y el rango de peso. */
    public function leer(Request $request)
    {
        $d = $request->validate(['codigo' => ['required', 'string', 'max:40']]);
        $r = Balanza::leer($d['codigo']);
        $v = $r['variant'];
        $r['precio'] = null;
        $r['importe'] = null;
        $r['fuera_de_rango'] = false;
        if ($v) {
            $marcas = Access::for($request->user())['brands'];
            if ($marcas && ! in_array($v->brand_id, $marcas, true)) {
                $r['variant'] = null; // de otra marca: no se muestra
            } else {
                $p = Precios::vigente($v->id, ['canal' => 'COUNTER']);
                $r['precio'] = $p;
                if ($p && $r['weight_kg'] !== null && $p['basis'] === 'KG') {
                    $r['importe'] = round($r['weight_kg'] * $p['price'], 2);
                }
                // RN-CAT-03: el peso por unidad fuera del rango pide confirmación en el mostrador (RN-POS-04).
                $r['fuera_de_rango'] = $v->sale_mode === 'UNIT_VARIABLE_WEIGHT' && $r['weight_kg'] !== null && $v->min_weight_kg !== null
                    && ($r['weight_kg'] < (float) $v->min_weight_kg || $r['weight_kg'] > (float) $v->max_weight_kg);
            }
        }

        return response()->json($r);
    }

    public function generar(Request $request)
    {
        $d = $request->validate(['variant_id' => ['required', 'uuid'], 'valor' => ['required', 'numeric', 'gt:0', 'max:99999']]);
        $marcas = Access::for($request->user())['brands'];
        $v = DB::table('product_variants')->where('id', $d['variant_id'])->whereNotNull('scale_plu')
            ->when($marcas, fn ($q) => $q->whereIn('brand_id', $marcas))->first(['id', 'scale_plu']) ?? abort(404);
        $f = Balanza::formato();
        $max = (10 ** $f['value_len'] - 1) / ($f['value_type'] === 'WEIGHT_G' ? 1000 : 100);
        if ($d['valor'] > $max) {
            RuleError::fail('RN-CAT-12', "El valor no cabe en {$f['value_len']} dígitos (máximo {$max}).");
        }

        return response()->json(['codigo' => Balanza::armar($v->scale_plu, (float) $d['valor'], $f)]);
    }

    /** Cambia el formato (parámetro de la empresa, con motivo e historial en PLT). */
    public function formato(Request $request)
    {
        $d = $request->validate([
            'prefix' => ['required', 'regex:/^\d{1,2}$/'],
            'plu_start' => ['required', 'integer', 'min:1', 'max:12'],
            'plu_len' => ['required', 'integer', 'min:1', 'max:6'],
            'value_start' => ['required', 'integer', 'min:1', 'max:12'],
            'value_len' => ['required', 'integer', 'min:1', 'max:6'],
            'value_type' => ['required', Rule::in(['WEIGHT_G', 'PRICE_CENTS'])],
            'reason' => ['required', 'string', 'min:5', 'max:255'],
        ], ['reason.required' => 'Escribe el motivo del cambio.']);
        $f = ['prefix' => $d['prefix'], 'plu_start' => (int) $d['plu_start'], 'plu_len' => (int) $d['plu_len'],
            'value_start' => (int) $d['value_start'], 'value_len' => (int) $d['value_len'], 'value_type' => $d['value_type']];
        if ($problema = Balanza::problemaFormato($f)) {
            RuleError::fail('RN-CAT-12', $problema);
        }
        Parametros::cambiar('cat_scale_barcode_layout', json_encode($f), $d['reason'], $request->user());

        return response()->json(['formato' => Balanza::formato()]);
    }
}
