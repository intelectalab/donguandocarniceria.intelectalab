<?php

namespace App\Modulos\Gas\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Gas\Services\Configuracion;
use Illuminate\Http\Request;

/** GAS-05 Categorías y GAS-06 Reglas de aprobación. */
class ConfigController extends Controller
{
    public function categorias()
    {
        return response()->json(Configuracion::categorias());
    }

    private function categoria(Request $request): array
    {
        return $request->validate(['code' => ['required', 'string', 'max:40'], 'name' => ['required', 'string', 'max:80'], 'category_group' => ['required', 'string'],
            'default_area' => ['required', 'string'], 'delivery_cost_type' => ['nullable', 'string'], 'default_cost_center_id' => ['required', 'uuid'],
            'default_doc_type' => ['required', 'string'], 'requires_vehicle' => ['boolean'], 'requires_gallons' => ['boolean'], 'requires_employee' => ['boolean'],
            'requires_supplier' => ['boolean'], 'requires_campaign' => ['boolean'], 'status' => ['nullable', 'in:ACTIVE,INACTIVE']]);
    }

    public function crearCategoria(Request $request)
    {
        return response()->json(Configuracion::guardarCategoria($this->categoria($request)), 201);
    }

    public function editarCategoria(Request $request, string $id)
    {
        return response()->json(Configuracion::guardarCategoria($this->categoria($request), $id));
    }

    public function reglas()
    {
        return response()->json(Configuracion::reglas());
    }

    private function regla(Request $request): array
    {
        return $request->validate(['min_amount' => ['required', 'numeric', 'min:0', 'max:99999999'], 'max_amount' => ['nullable', 'numeric', 'min:0', 'max:99999999'],
            'level' => ['required', 'integer', 'between:1,3'], 'category_id' => ['nullable', 'uuid'], 'establishment_id' => ['nullable', 'uuid'],
            'note' => ['nullable', 'string', 'max:255'], 'status' => ['nullable', 'in:ACTIVE,INACTIVE']]);
    }

    public function crearRegla(Request $request)
    {
        return response()->json(Configuracion::guardarRegla($this->regla($request)), 201);
    }

    public function editarRegla(Request $request, string $id)
    {
        return response()->json(Configuracion::guardarRegla($this->regla($request), $id));
    }
}
