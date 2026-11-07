<?php

namespace App\Modulos\Cat\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Cat\Services\Listas;
use App\Modulos\Cat\Services\Precios;
use App\Support\Access;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * CAT-07 Simulador de precio: dado canal, marca, tipo de cliente, fecha y cantidad, muestra la lista
 * y el precio que el sistema elegiría y por qué (RN-CAT-05), con el peso y el importe estimados.
 */
class SimuladorController extends Controller
{
    public function __invoke(Request $request)
    {
        $d = $request->validate([
            'variant_id' => ['required', 'uuid'],
            'canal' => ['required', Rule::in(Precios::CANALES)],
            'tipo_cliente' => ['required', Rule::in(Listas::TIPOS_CLIENTE)],
            'fecha' => ['required', 'date_format:Y-m-d'],
            'cantidad' => ['required', 'numeric', 'min:0', 'max:99999'],
            'cliente_id' => ['nullable', 'uuid'],
        ]);
        $marcas = Access::for($request->user())['brands'];
        $v = DB::table('product_variants as v')->join('products as p', 'p.id', '=', 'v.product_id')->where('v.id', $d['variant_id'])
            ->when($marcas, fn ($q) => $q->whereIn('v.brand_id', $marcas))
            ->first(['v.id', 'v.sku', 'v.name', 'v.brand_id', 'v.sale_mode', 'v.nominal_weight_kg', 'v.min_order_qty', 'v.qty_step', 'p.allow_discount'])
            ?? abort(404);

        $r = Precios::simular($v->id, ['canal' => $d['canal'], 'tipo_cliente' => $d['tipo_cliente'], 'fecha' => $d['fecha'],
            'cantidad' => $d['cantidad'], 'cliente_id' => $d['cliente_id'] ?? null]);

        $cantidad = (float) $d['cantidad'];
        $kg = match ($v->sale_mode) {
            'UNIT_VARIABLE_WEIGHT' => round($cantidad * (float) $v->nominal_weight_kg, 3), // RN-CAT-02
            'KG' => round($cantidad, 3),
            default => null,
        };
        $e = $r['elegido'];
        $base = $e ? ($e['basis'] === 'KG' ? ($kg ?? $cantidad) : $cantidad) : null;

        return response()->json($r + [
            'variante' => ['id' => $v->id, 'sku' => $v->sku, 'name' => $v->name, 'sale_mode' => $v->sale_mode,
                'nominal_weight_kg' => $v->nominal_weight_kg === null ? null : (float) $v->nominal_weight_kg],
            'kg_estimado' => $kg,
            'importe_estimado' => $e ? round($base * $e['price'], 2) : null,
            'admite_descuento' => $v->allow_discount !== false, // RN-CAT-10
            'aviso_cantidad' => $this->cantidad($v, $cantidad),
        ]);
    }

    /** RN-CAT-07: cantidad mínima y múltiplo de la variante. */
    private function cantidad(object $v, float $q): ?string
    {
        $u = $v->sale_mode === 'KG' ? 'kg' : 'u';
        $n = fn ($x) => rtrim(rtrim(number_format((float) $x, 3, ',', '.'), '0'), ',');
        if ($q <= 0) {
            return 'La cantidad debe ser mayor que cero (RN-CAT-07).';
        }
        if ($v->min_order_qty && $q + 1e-9 < (float) $v->min_order_qty) {
            return "{$v->name}: la cantidad mínima es {$n($v->min_order_qty)} {$u} (RN-CAT-07).";
        }
        if ((float) $v->qty_step > 0) {
            $k = $q / (float) $v->qty_step;
            if (abs($k - round($k)) > 1e-6) {
                return "{$v->name} se pide en múltiplos de {$n($v->qty_step)} {$u}: {$n($q)} no es múltiplo (RN-CAT-07).";
            }
        }

        return null;
    }
}
