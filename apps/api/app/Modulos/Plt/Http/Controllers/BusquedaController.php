<?php

namespace App\Modulos\Plt\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Plt\Services\Busqueda;
use Illuminate\Http\Request;

/** PLT-02 Búsqueda global: GET /v1/plt/buscar?q=texto. */
class BusquedaController extends Controller
{
    public function __invoke(Request $request)
    {
        $request->validate(['q' => ['nullable', 'string', 'max:100']]);

        return response()->json(Busqueda::buscar((string) $request->query('q', ''), $request->user()) + ['tipos' => Busqueda::TIPOS]);
    }
}
