<?php

namespace App\Modulos\Tel\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Plt\Services\Modulos;
use App\Modulos\Tel\Services\Ajustes;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/** TEL-01 Lista de activación y TEL-02 Ajustes. */
class AjustesController extends Controller
{
    public function activacion(Request $request)
    {
        return response()->json(Ajustes::activacion($request->user()));
    }

    public function marcarPaso(Request $request, string $codigo)
    {
        abort_unless(isset(Modulos::PASOS_TEL[$codigo]), 404);
        $d = $request->validate(['evidencia' => ['required', 'string', 'min:5', 'max:1000'], 'responsable' => ['nullable', 'uuid']], [], ['evidencia' => 'evidencia', 'responsable' => 'responsable']);

        return response()->json(Ajustes::marcarPaso($codigo, $d['evidencia'], $d['responsable'] ?? null, $request->user()));
    }

    public function enVivo(Request $request)
    {
        return response()->json(Ajustes::enVivo($request->user()));
    }

    public function aConfiguracion(Request $request)
    {
        $d = $request->validate(['motivo' => ['required', 'string', 'min:10', 'max:500']], [], ['motivo' => 'motivo']);

        return response()->json(Ajustes::aConfiguracion($d['motivo'], $request->user()));
    }

    public function ver(Request $request)
    {
        return response()->json(Ajustes::ver($request->user()));
    }

    public function guardar(Request $request)
    {
        $d = $request->validate([
            'provider' => ['required', Rule::in(array_keys(Ajustes::PROVEEDORES))], 'connector_id' => ['nullable', 'uuid'], 'recording_enabled' => ['required', 'boolean'],
            'recording_notice_text' => ['nullable', 'string', 'max:500'], 'ring_strategy' => ['required', Rule::in(array_keys(Ajustes::REPARTOS))],
            'retention_days' => ['required', 'integer', 'between:1,3650'], 'callback_due_minutes' => ['required', 'integer', 'between:1,1440'], 'ring_timeout_s' => ['required', 'integer', 'between:5,120'],
            'transcription_enabled' => ['required', 'boolean'], 'outbound_registered_only' => ['required', 'boolean'],
            'tarifas' => ['required', 'array'], 'tarifas.*' => ['numeric', 'between:0,10'], 'motivo' => ['nullable', 'string', 'max:255'],
        ], [], ['provider' => 'proveedor', 'connector_id' => 'conector', 'recording_notice_text' => 'aviso de grabación', 'ring_strategy' => 'reparto', 'retention_days' => 'días de retención',
            'callback_due_minutes' => 'minutos para devolver', 'ring_timeout_s' => 'segundos de timbre', 'tarifas.*' => 'tarifa', 'motivo' => 'motivo']);

        return response()->json(Ajustes::guardar($d, $request->user()));
    }

    public function subirAudio(Request $request)
    {
        $request->validate(['archivo' => ['required', 'file', 'max:10240']], [], ['archivo' => 'audio']);

        return response()->json(Ajustes::subirAudio($request->file('archivo'), $request->user()), 201);
    }

    public function enlaceAudio(Request $request)
    {
        return response()->json(Ajustes::enlaceAudio($request->user()));
    }
}
