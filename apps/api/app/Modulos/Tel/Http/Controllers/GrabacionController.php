<?php

namespace App\Modulos\Tel\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Tel\Services\Grabaciones;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/** TEL-10 Grabación y transcripción y TEL-12 Escuchas y retención. */
class GrabacionController extends Controller
{
    public function lista(Request $request)
    {
        $f = $request->validate([
            'estado' => ['nullable', Rule::in(array_keys(Grabaciones::ESTADOS))], 'marca' => ['nullable', 'uuid'], 'vendedora' => ['nullable', 'uuid'],
            'texto' => ['nullable', Rule::in(['0', '1'])], 'alertas' => ['nullable', Rule::in(['1'])], 'buscar' => ['nullable', 'string', 'max:100'],
            'desde' => ['nullable', 'date_format:Y-m-d'], 'hasta' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:desde'],
        ]);

        return response()->json(Grabaciones::lista($f, $request->user()));
    }

    public function ver(Request $request, string $id)
    {
        return response()->json(Grabaciones::ver($id, $request->user()));
    }

    public function acceder(Request $request, string $id)
    {
        $d = $request->validate(['accion' => ['required', Rule::in(array_keys(Grabaciones::ACCIONES))], 'motivo' => ['nullable', 'string', 'max:255']], [], ['motivo' => 'motivo']);

        return response()->json(Grabaciones::acceder($id, $d['accion'], $d['motivo'] ?? null, $request->user()));
    }

    public function transcribir(Request $request, string $id)
    {
        return response()->json(Grabaciones::transcribir($id, $request->user()));
    }

    public function retencion(Request $request, string $id)
    {
        $d = $request->validate(['activa' => ['required', 'boolean'], 'motivo' => ['required', 'string', 'min:5', 'max:255']], [], ['motivo' => 'motivo']);

        return response()->json(Grabaciones::retencion($id, (bool) $d['activa'], $d['motivo'], $request->user()));
    }

    public function panel(Request $request)
    {
        $f = $request->validate([
            'vista' => ['nullable', Rule::in(['bitacora', 'por_vencer', 'retenidas', 'corridas', 'purgadas'])], 'accion' => ['nullable', Rule::in(array_keys(Grabaciones::ACCIONES))],
            'persona' => ['nullable', 'uuid'], 'buscar' => ['nullable', 'string', 'max:100'],
            'desde' => ['nullable', 'date_format:Y-m-d'], 'hasta' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:desde'],
        ]);

        return response()->json(Grabaciones::retencionPanel($f, $request->user()));
    }

    public function purgar(Request $request)
    {
        $r = Grabaciones::purgar($request->user()->name);

        return response()->json($r + ['mensaje' => $r['purgadas'] ? "{$r['purgadas']} grabaciones purgadas." : 'No había grabaciones vencidas.']);
    }
}
