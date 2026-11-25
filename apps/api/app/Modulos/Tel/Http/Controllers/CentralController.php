<?php

namespace App\Modulos\Tel\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Tel\Services\Central;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/** TEL-03 Números y desvíos, TEL-04 Menú de voz y horario y TEL-05 Grupos de llamada. */
class CentralController extends Controller
{
    public function numeros(Request $request)
    {
        $f = $request->validate(['estado' => ['nullable', Rule::in(array_keys(Central::ESTADOS))], 'tipo' => ['nullable', Rule::in(array_keys(Central::TIPOS))],
            'marca' => ['nullable', 'string', 'regex:/^(GENERAL|[0-9a-f-]{36})$/'], 'buscar' => ['nullable', 'string', 'max:100']]);

        return response()->json(Central::numeros($f, $request->user()));
    }

    public function guardarNumero(Request $request, ?string $id = null)
    {
        $d = $request->validate([
            'e164' => ['required', 'string', 'max:20'], 'number_kind' => ['required', Rule::in(array_keys(Central::TIPOS))], 'brand_id' => ['nullable', 'uuid'],
            'menu_id' => ['nullable', 'uuid'], 'ring_group_id' => ['nullable', 'uuid'], 'forwarded_from' => ['nullable', 'array', 'max:20'], 'forwarded_from.*' => ['string', 'max:20'],
            'provider_ref' => ['nullable', 'string', 'max:60'], 'status' => ['required', Rule::in(array_keys(Central::ESTADOS))],
        ], [], ['e164' => 'número', 'number_kind' => 'tipo', 'brand_id' => 'marca', 'menu_id' => 'menú', 'ring_group_id' => 'grupo', 'forwarded_from.*' => 'celular desviado', 'status' => 'estado']);

        return response()->json(Central::guardarNumero($id, $d, $request->user()), $id ? 200 : 201);
    }

    public function menu(Request $request)
    {
        return response()->json(Central::menu($request->user()));
    }

    public function guardarMenu(Request $request)
    {
        $d = $request->validate([
            'name' => ['required', 'string', 'min:3', 'max:120'], 'greeting_text' => ['required', 'string', 'min:10', 'max:1000'],
            'after_hours_action' => ['required', Rule::in(array_keys(Central::FUERA_DE_HORARIO))],
            'horario' => ['required', 'array'], 'horario.lun_sab' => ['required', 'array', 'size:2'], 'horario.dom' => ['nullable', 'array', 'size:2'],
            'opciones' => ['required', 'array', 'min:1', 'max:9'], 'opciones.*.digit' => ['required', 'integer', 'between:1,9'],
            'opciones.*.tipo' => ['required', Rule::in(['MARCA', 'SUPERVISORA'])], 'opciones.*.brand_id' => ['nullable', 'uuid'], 'opciones.*.direct_user_id' => ['nullable', 'uuid'],
        ], [], ['name' => 'nombre', 'greeting_text' => 'saludo', 'after_hours_action' => 'fuera de horario', 'opciones' => 'opciones']);

        return response()->json(Central::guardarMenu($d, $request->user()));
    }

    public function grupos(Request $request)
    {
        $f = $request->validate(['marca' => ['nullable', 'uuid'], 'estrategia' => ['nullable', Rule::in(array_keys(Central::ESTRATEGIAS))], 'buscar' => ['nullable', 'string', 'max:100']]);

        return response()->json(Central::grupos($f, $request->user()));
    }

    public function guardarGrupo(Request $request, ?string $id = null)
    {
        $d = $request->validate([
            'brand_id' => [$id ? 'nullable' : 'required', 'uuid'], 'name' => ['required', 'string', 'min:3', 'max:120'],
            'strategy' => ['required', Rule::in(array_keys(Central::ESTRATEGIAS))], 'ring_timeout_s' => ['required', 'integer', 'between:5,120'],
        ], [], ['brand_id' => 'marca', 'name' => 'nombre', 'strategy' => 'estrategia', 'ring_timeout_s' => 'segundos por vendedora']);

        return response()->json(Central::guardarGrupo($id, $d, $request->user()), $id ? 200 : 201);
    }

    public function candidatos(Request $request, string $id)
    {
        return response()->json(['data' => Central::candidatos($id)]);
    }

    public function agregarMiembro(Request $request, string $id)
    {
        $d = $request->validate(['user_id' => ['required', 'uuid']], [], ['user_id' => 'persona']);

        return response()->json(Central::agregarMiembro($id, $d['user_id'], $request->user()), 201);
    }

    public function cambiarMiembro(Request $request, string $id)
    {
        $d = $request->validate(['active' => ['sometimes', 'boolean'], 'mover' => ['sometimes', Rule::in(['subir', 'bajar'])]]);

        return response()->json(Central::cambiarMiembro($id, $d, $request->user()));
    }
}
