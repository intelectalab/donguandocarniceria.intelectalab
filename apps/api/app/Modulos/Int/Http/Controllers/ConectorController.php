<?php

namespace App\Modulos\Int\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Int\Services\Conectores;
use App\Modulos\Int\Services\Credenciales;
use Illuminate\Http\Request;

/** INT-01 Conectores, INT-02 Ficha del conector e INT-03 Credenciales. Reglas en Services\Conectores y Services\Credenciales. */
class ConectorController extends Controller
{
    public function index()
    {
        return response()->json(Conectores::lista());
    }

    public function show(string $id)
    {
        return response()->json(Conectores::ficha($id));
    }

    public function probar(Request $request, string $id)
    {
        return response()->json(Conectores::probar($id, $request->user()));
    }

    public function estado(Request $request, string $id)
    {
        $d = $request->validate(['active' => ['required', 'boolean'], 'reason' => ['required', 'string', 'min:10', 'max:300']], [], ['reason' => 'motivo']);

        return response()->json(Conectores::cambiarEstado($id, (bool) $d['active'], $d['reason'], $request->user()));
    }

    public function simularCaida(Request $request, string $id)
    {
        $d = $request->validate(['down' => ['required', 'boolean']]);

        return response()->json(Conectores::simularCaida($id, (bool) $d['down'], $request->user()));
    }

    public function credenciales(Request $request)
    {
        $d = $request->validate(['connector' => ['nullable', 'uuid']]);

        return response()->json(Credenciales::lista($d['connector'] ?? null));
    }

    public function cargarCredencial(Request $request)
    {
        $d = $request->validate([
            'connector_id' => ['required', 'uuid'], 'name' => ['required', 'string', 'regex:/^[a-z][a-z0-9_]{1,79}$/'],
            'secret' => ['required', 'string', 'min:8', 'max:4000'], 'expires_at' => ['nullable', 'date', 'after:today'],
        ], ['name.regex' => 'El nombre va en minúsculas, sin espacios (por ejemplo access_token).'], ['name' => 'nombre', 'secret' => 'secreto', 'expires_at' => 'vencimiento']);

        return response()->json(Credenciales::cargar($d, $request->user()), 201);
    }

    public function rotarCredencial(Request $request, string $id)
    {
        $d = $request->validate(['secret' => ['required', 'string', 'min:8', 'max:4000'], 'expires_at' => ['nullable', 'date', 'after:today']], [],
            ['secret' => 'secreto nuevo', 'expires_at' => 'vencimiento']);

        return response()->json(Credenciales::rotar($id, $d, $request->user()));
    }

    public function revocarCredencial(Request $request, string $id)
    {
        $d = $request->validate(['reason' => ['required', 'string', 'min:10', 'max:300']], [], ['reason' => 'motivo']);

        return response()->json(Credenciales::revocar($id, $d['reason'], $request->user()));
    }
}
