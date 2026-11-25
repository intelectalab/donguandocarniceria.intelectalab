<?php

namespace App\Modulos\Api\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Api\Services\Catalogo;
use App\Modulos\Api\Services\Claves;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/** API-01 Claves, API-02 Crear clave, API-03 Detalle de clave y API-11 Eventos y alcances. */
class ClaveController extends Controller
{
    public function lista(Request $request)
    {
        $f = $request->validate([
            'entorno' => ['nullable', Rule::in(array_keys(Claves::ENTORNOS))], 'estado' => ['nullable', Rule::in(array_keys(Claves::ESTADOS))],
            'escritura' => ['nullable', Rule::in(['0', '1'])], 'alcance' => ['nullable', 'string', 'max:40'], 'buscar' => ['nullable', 'string', 'max:100'],
        ]);

        return response()->json(Claves::lista($f, $request->user()));
    }

    public function formulario()
    {
        return response()->json(Claves::formulario());
    }

    public function clientes(Request $request)
    {
        $f = $request->validate(['buscar' => ['required', 'string', 'min:2', 'max:100']]);

        return response()->json(['data' => Claves::clientes($f['buscar'])]);
    }

    public function crear(Request $request)
    {
        $d = $request->validate([
            'name' => ['required', 'string', 'min:3', 'max:120'], 'description' => ['nullable', 'string', 'max:500'], 'environment' => ['required', Rule::in(array_keys(Claves::ENTORNOS))],
            'scopes' => ['required', 'array', 'min:1', 'max:20'], 'scopes.*' => ['string', 'max:40'], 'brand_ids' => ['nullable', 'array', 'max:20'], 'brand_ids.*' => ['uuid'],
            'allowed_ips' => ['nullable', 'array', 'max:20'], 'allowed_ips.*' => ['string', 'max:18'], 'customer_id' => ['nullable', 'uuid'],
            'channel' => ['nullable', Rule::in(array_keys(Claves::CANALES))], 'expires_at' => ['required', 'date_format:Y-m-d'],
        ], [], ['name' => 'nombre', 'environment' => 'entorno', 'scopes' => 'alcances', 'expires_at' => 'vencimiento', 'allowed_ips' => 'IP permitidas', 'channel' => 'canal']);

        return response()->json(Claves::crear($d, $request->user()), 201);
    }

    public function ver(Request $request, string $id)
    {
        return response()->json(Claves::ver($id, $request->user()));
    }

    public function editar(Request $request, string $id)
    {
        $d = $request->validate([
            'name' => ['sometimes', 'string', 'min:3', 'max:120'], 'description' => ['sometimes', 'nullable', 'string', 'max:500'],
            'allowed_ips' => ['sometimes', 'array', 'max:20'], 'allowed_ips.*' => ['string', 'max:18'], 'expires_at' => ['sometimes', 'date_format:Y-m-d'],
        ], [], ['name' => 'nombre', 'expires_at' => 'vencimiento', 'allowed_ips' => 'IP permitidas']);

        return response()->json(Claves::editar($id, $d, $request->user()));
    }

    public function revocar(Request $request, string $id)
    {
        $d = $request->validate(['motivo' => ['required', 'string', 'min:10', 'max:500']], [], ['motivo' => 'motivo']);

        return response()->json(Claves::revocar($id, $d['motivo'], $request->user()));
    }

    public function catalogo(Request $request)
    {
        $f = $request->validate(['modulo' => ['nullable', 'string', 'max:20'], 'estado' => ['nullable', Rule::in(array_keys(Catalogo::ESTADOS_EVENTO))],
            'alcance' => ['nullable', 'string', 'max:40'], 'buscar' => ['nullable', 'string', 'max:100']]);

        return response()->json(Catalogo::ver($f));
    }
}
