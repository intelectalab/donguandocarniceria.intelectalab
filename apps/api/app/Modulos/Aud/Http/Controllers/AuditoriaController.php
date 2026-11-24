<?php

namespace App\Modulos\Aud\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Aud\Services\Accesos;
use App\Modulos\Aud\Services\Cambios;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/** AUD-01 Consulta de cambios, AUD-02 Historia del registro y AUD-03 Bitácora de accesos. Reglas en sus servicios. */
class AuditoriaController extends Controller
{
    public function cambios(Request $request)
    {
        $f = $request->validate([
            'tabla' => ['nullable', 'string', 'max:63', 'regex:/^[a-z_]+$/'], 'usuario' => ['nullable', 'string', 'regex:/^(SISTEMA|[0-9a-f-]{36})$/'],
            'accion' => ['nullable', Rule::in(array_keys(Cambios::ACCIONES))], 'registro' => ['nullable', 'uuid'],
            'desde' => ['nullable', 'date_format:Y-m-d'], 'hasta' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:desde'], 'revelar' => ['nullable', 'boolean'],
            'sistema' => ['nullable', 'boolean'], 'buscar' => ['nullable', 'string', 'max:100'],
        ]);

        return response()->json(Cambios::lista($f, $request->user()));
    }

    public function cambio(Request $request, int $id)
    {
        $f = $request->validate(['revelar' => ['nullable', 'boolean']]);

        return response()->json(Cambios::ver($id, $f, $request->user()));
    }

    public function historia(Request $request)
    {
        $f = $request->validate(['tabla' => ['required', 'string', 'max:63', 'regex:/^[a-z_]+$/'], 'id' => ['required', 'uuid'], 'revelar' => ['nullable', 'boolean']]);

        return response()->json(Cambios::historia($f['tabla'], $f['id'], $f, $request->user()));
    }

    public function registros(Request $request)
    {
        $d = $request->validate(['tabla' => ['nullable', 'string', 'max:63', 'regex:/^[a-z_]+$/'], 'buscar' => ['nullable', 'string', 'max:80']]);
        $tablas = Cambios::elegibles($request->user());
        // Sin tabla: la primera que tiene historia.
        $tabla = $d['tabla'] ?? ($tablas[0]['value'] ?? null);

        return response()->json(['tablas' => $tablas, 'tabla' => $tabla, 'registros' => $tabla ? Cambios::registros($tabla, $d['buscar'] ?? null, $request->user()) : []]);
    }

    public function accesos(Request $request)
    {
        $f = $request->validate([
            'evento' => ['nullable', 'string', 'max:80', 'regex:/^[A-Z_]+$/'], 'usuario' => ['nullable', 'uuid'], 'ip' => ['nullable', 'string', 'max:40', 'regex:/^[0-9a-fA-F.:]+$/'],
            'resultado' => ['nullable', Rule::in(['OK', 'DENIED'])], 'desde' => ['nullable', 'date_format:Y-m-d'], 'hasta' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:desde'],
        ]);

        return response()->json(Accesos::lista($f, $request->user()));
    }
}
