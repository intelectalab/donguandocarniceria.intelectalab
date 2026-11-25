<?php

namespace App\Modulos\Crm\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Crm\Services\Canales;
use App\Modulos\Crm\Services\Equipos;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/** CRM-07 Números y cuentas y CRM-08 Equipos y turnos; el estado de cada vendedora (en línea, ausente, desconectada). */
class CanalController extends Controller
{
    public function index(Request $request)
    {
        $f = $request->validate([
            'red' => ['nullable', Rule::in(array_keys(Canales::REDES))], 'marca' => ['nullable', 'uuid'], 'estado' => ['nullable', Rule::in(array_keys(Canales::ESTADOS))],
            'mes' => ['nullable', 'date_format:Y-m'], 'buscar' => ['nullable', 'string', 'max:100'],
        ]);

        return response()->json(Canales::lista($f, $request->user()));
    }

    public function show(Request $request, string $id)
    {
        return response()->json(Canales::ficha($id, $request->user()));
    }

    public function store(Request $request)
    {
        return response()->json(Canales::guardar(null, $this->datos($request, true), $request->user()), 201);
    }

    public function update(Request $request, string $id)
    {
        return response()->json(Canales::guardar($id, $this->datos($request, false), $request->user()));
    }

    public function probar(Request $request, string $id)
    {
        return response()->json(Canales::probar($id, $request->user()));
    }

    public function equipos(Request $request)
    {
        $f = $request->validate(['marca' => ['nullable', 'uuid']]);

        return response()->json(Equipos::equipos($f, $request->user()));
    }

    public function agregarMiembro(Request $request, string $id)
    {
        $d = $request->validate(['user_id' => ['required', 'uuid'], 'max_open_conversations' => ['nullable', 'integer', 'min:1', 'max:100']],
            [], ['user_id' => 'persona', 'max_open_conversations' => 'tope de chats']);

        return response()->json(Equipos::agregarMiembro($id, $d['user_id'], $d['max_open_conversations'] ?? null, $request->user()), 201);
    }

    public function cambiarMiembro(Request $request, string $id)
    {
        $d = $request->validate(['max_open_conversations' => ['sometimes', 'integer', 'min:1', 'max:100'], 'active' => ['sometimes', 'boolean']],
            [], ['max_open_conversations' => 'tope de chats', 'active' => 'activo']);

        return response()->json(Equipos::cambiarMiembro($id, $d, $request->user()));
    }

    public function turnos(Request $request, string $id)
    {
        $d = $request->validate(['turnos' => ['present', 'array', 'max:7'], 'turnos.*.weekday' => ['required', 'integer', 'between:1,7'],
            'turnos.*.from' => ['required', 'date_format:H:i'], 'turnos.*.to' => ['required', 'date_format:H:i']], [], ['turnos.*.from' => 'desde', 'turnos.*.to' => 'hasta']);

        return response()->json(Equipos::turnos($id, $d['turnos'], $request->user()));
    }

    public function asignacion(Request $request, string $id)
    {
        $d = $request->validate(['assignment_mode' => ['required', Rule::in(array_keys(Canales::ASIGNACION))]], [], ['assignment_mode' => 'asignación']);

        return response()->json(Equipos::modoAsignacion($id, $d['assignment_mode'], $request->user()));
    }

    public function miEstado(Request $request)
    {
        return response()->json(Equipos::miEstado($request->user()));
    }

    public function marcarEstado(Request $request)
    {
        $d = $request->validate(['estado' => ['required', Rule::in(array_keys(Equipos::ESTADOS_AGENTE))]]);

        return response()->json(Equipos::marcarEstado($request->user(), $d['estado']));
    }

    private function datos(Request $request, bool $nuevo): array
    {
        return $request->validate([
            'kind' => [$nuevo ? 'required' : 'prohibited', Rule::in(array_keys(Canales::REDES))],
            'number' => [$nuevo ? 'required' : 'prohibited', 'string', 'max:60'],
            'display_name' => ['required', 'string', 'min:3', 'max:80'],
            'brand_id' => ['required', 'uuid'],
            'connection_mode' => ['required', Rule::in(array_keys(Canales::CONEXIONES))],
            'assignment_mode' => ['required', Rule::in(array_keys(Canales::ASIGNACION))],
            'status' => ['required', Rule::in(array_keys(Canales::ESTADOS))],
            'connector_id' => ['nullable', 'uuid'],
            'auto_greeting' => ['nullable', 'string', 'max:1000'],
            'recording_notice_text' => ['nullable', 'string', 'max:1000'],
        ], [], ['kind' => 'red', 'number' => 'número', 'display_name' => 'nombre visible', 'brand_id' => 'marca', 'connection_mode' => 'modo de conexión',
            'assignment_mode' => 'asignación', 'status' => 'estado', 'connector_id' => 'conector', 'auto_greeting' => 'saludo automático', 'recording_notice_text' => 'aviso de registro']);
    }
}
