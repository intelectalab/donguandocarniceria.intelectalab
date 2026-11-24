<?php

namespace App\Modulos\Sus\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Sus\Services\Complementos;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/** SUS-10 Complementos (consola). */
class ComplementoController extends Controller
{
    public function index()
    {
        return response()->json(Complementos::lista());
    }

    public function guardar(Request $request, ?string $code = null)
    {
        $d = $request->validate([
            'code' => [$code ? 'nullable' : 'required', 'string', 'regex:/^[A-Za-z][A-Za-z0-9_]{1,19}$/'],
            'name' => ['required', 'string', 'min:3', 'max:80'],
            'description' => ['nullable', 'string', 'max:300'],
            'kind' => ['required', Rule::in(['MODULE', 'LIMIT'])],
            'module_code' => ['nullable', 'required_if:kind,MODULE', 'string', 'max:10'],
            'limit_key' => ['nullable', 'required_if:kind,LIMIT', Rule::in(array_keys(Complementos::LIMITES))],
            'unit_qty' => ['nullable', 'required_if:kind,LIMIT', 'integer', 'min:1', 'max:500'],
            'price_pen' => ['nullable', 'numeric', 'min:0.01', 'max:99999'],
        ], [], ['code' => 'código', 'name' => 'nombre', 'kind' => 'tipo', 'module_code' => 'módulo', 'limit_key' => 'límite', 'unit_qty' => 'unidades', 'price_pen' => 'precio']);

        return response()->json(Complementos::guardar($request->attributes->get('consola_usuario'), $d, $code), $code ? 200 : 201);
    }

    public function publicar(Request $request, string $code)
    {
        return response()->json(Complementos::publicar($code, $request->attributes->get('consola_usuario')));
    }

    public function retirar(Request $request, string $code)
    {
        return response()->json(Complementos::retirar($code, $request->attributes->get('consola_usuario')));
    }
}
