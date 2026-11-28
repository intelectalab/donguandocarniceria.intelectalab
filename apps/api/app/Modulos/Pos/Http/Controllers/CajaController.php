<?php

namespace App\Modulos\Pos\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Pos\Services\Cajas;
use Illuminate\Http\Request;

/** POS-11 Cajas registradoras. Reglas en Services\Cajas. */
class CajaController extends Controller
{
    public function index(Request $request)
    {
        return response()->json(Cajas::visibles($request->user()));
    }

    public function opciones(Request $request)
    {
        return response()->json(Cajas::opciones($request->user()));
    }

    public function store(Request $request)
    {
        return response()->json(Cajas::guardar(null, $this->datos($request), $request->user()), 201);
    }

    public function update(Request $request, string $id)
    {
        return response()->json(Cajas::guardar($id, $this->datos($request), $request->user()));
    }

    private function datos(Request $request): array
    {
        return $request->validate([
            'code' => ['sometimes', 'nullable', 'string', 'max:20'], 'name' => ['sometimes', 'nullable', 'string', 'max:80'],
            'establishment_id' => ['sometimes', 'nullable', 'uuid'], 'warehouse_id' => ['sometimes', 'nullable', 'uuid'],
            'cash_account_id' => ['sometimes', 'nullable', 'uuid'], 'card_account_id' => ['sometimes', 'nullable', 'uuid'],
            'receipt_series_id' => ['sometimes', 'nullable', 'uuid'], 'invoice_series_id' => ['sometimes', 'nullable', 'uuid'],
            'default_price_list_id' => ['sometimes', 'nullable', 'uuid'], 'scale_mode' => ['sometimes', 'nullable', 'string'],
            'status' => ['sometimes', 'nullable', 'in:ACTIVE,INACTIVE'],
        ]);
    }
}
