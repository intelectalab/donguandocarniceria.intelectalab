<?php

namespace App\Modulos\Int\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Int\Services\Archivos;
use App\Modulos\Int\Services\Notificaciones;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/** INT-09 Centro de notificaciones, INT-10 Preferencias e INT-11 Archivos adjuntos. Reglas en sus servicios. */
class AvisoArchivoController extends Controller
{
    public function notificaciones(Request $request)
    {
        $f = $request->validate([
            'scope' => ['nullable', Rule::in(['mine', 'all'])], 'severidad' => ['nullable', Rule::in(array_keys(Notificaciones::SEVERIDADES))],
            'tipo' => ['nullable', Rule::in(array_keys(Notificaciones::TIPOS))], 'lectura' => ['nullable', Rule::in(['U', 'R'])], 'buscar' => ['nullable', 'string', 'max:100'],
        ]);

        return response()->json(Notificaciones::lista($f, $request->user()));
    }

    public function marcar(Request $request, string $id)
    {
        $d = $request->validate(['leida' => ['required', 'boolean']]);
        Notificaciones::marcar($id, (bool) $d['leida'], $request->user());

        return response()->noContent();
    }

    public function marcarTodas(Request $request)
    {
        return response()->json(['marcadas' => Notificaciones::marcarTodas($request->user())]);
    }

    public function preferencias(Request $request)
    {
        $d = $request->validate(['user' => ['nullable', 'uuid']]);

        return response()->json(Notificaciones::preferencias($d['user'] ?? $request->user()->id, $request->user()));
    }

    public function guardarPreferencia(Request $request)
    {
        $d = $request->validate([
            'user' => ['required', 'uuid'], 'type' => ['required', Rule::in(array_keys(Notificaciones::TIPOS))],
            'in_app' => ['sometimes', 'boolean'], 'email' => ['sometimes', 'boolean'], 'push' => ['sometimes', 'boolean'],
        ]);

        return response()->json(Notificaciones::guardarPreferencia($d['user'], $d['type'], array_intersect_key($d, array_flip(['in_app', 'email', 'push'])), $request->user()));
    }

    public function archivos(Request $request)
    {
        $f = $request->validate([
            'entity' => ['nullable', Rule::in(array_keys(Archivos::REGISTROS))], 'entity_id' => ['nullable', 'uuid'],
            'classification' => ['nullable', Rule::in(array_keys(Archivos::CLASIFICACIONES))], 'status' => ['nullable', Rule::in(['ACTIVE', 'DELETED'])],
            'buscar' => ['nullable', 'string', 'max:100'],
        ]);

        return response()->json(Archivos::lista($f));
    }

    public function registros(Request $request)
    {
        $d = $request->validate(['entity' => ['required', Rule::in(Archivos::ADJUNTABLES)], 'buscar' => ['nullable', 'string', 'max:80']]);

        return response()->json(Archivos::registros($d['entity'], $d['buscar'] ?? null));
    }

    public function subir(Request $request)
    {
        $d = $request->validate([
            // El tamaño y el tipo los revisa el servicio con los parámetros (RN-INT-16); aquí solo que venga un archivo.
            'file' => ['required', 'file'], 'entity' => ['nullable', Rule::in(Archivos::ADJUNTABLES)], 'entity_id' => ['nullable', 'required_with:entity', 'uuid'],
            'classification' => ['required', Rule::in(array_keys(Archivos::CLASIFICACIONES))],
        ], [], ['file' => 'archivo', 'classification' => 'clasificación']);

        return response()->json(Archivos::subir($request->file('file'), $d['entity'] ?? null, $d['entity_id'] ?? null, $d['classification'], $request->user()), 201);
    }

    public function enlace(Request $request, string $id)
    {
        return response()->json(Archivos::enlace($id, $request->user()));
    }

    public function eliminar(Request $request, string $id)
    {
        $d = $request->validate(['reason' => ['required', 'string', 'min:10', 'max:300']], [], ['reason' => 'motivo']);

        return response()->json(Archivos::eliminar($id, $d['reason'], $request->user()));
    }

    /** Descarga desde el enlace firmado y temporal (sin sesión: la firma lleva el archivo, la empresa y el vencimiento). */
    public function descargar(string $id, Request $request)
    {
        return Archivos::descargar($id, (string) $request->query('e'));
    }
}
