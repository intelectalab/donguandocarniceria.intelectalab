<?php

namespace App\Modulos\Crm\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Crm\Services\Consentimientos;
use App\Modulos\Crm\Services\Equipos;
use App\Modulos\Crm\Services\Supervision;
use App\Modulos\Crm\Services\Tareas;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/** CRM-06 Supervisión en vivo, CRM-17 Mis tareas y CRM-18 Consentimientos y avisos. */
class SupervisionController extends Controller
{
    private function filtrosSupervision(Request $request): array
    {
        return $request->validate(['marca' => ['nullable', 'uuid'], 'canal' => ['nullable', 'uuid'], 'dia' => ['nullable', 'date_format:Y-m-d', 'before_or_equal:today'],
            'buscar' => ['nullable', 'string', 'max:100'], 'estado' => ['nullable', Rule::in(array_keys(Equipos::ESTADOS_AGENTE))]]);
    }

    public function panel(Request $request)
    {
        return response()->json(Supervision::panel($this->filtrosSupervision($request), $request->user()));
    }

    public function chats(Request $request, string $tipo)
    {
        return response()->json(Supervision::chats($tipo, $this->filtrosSupervision($request), $request->user()));
    }

    public function vendedoras(Request $request)
    {
        return response()->json(Supervision::vendedoras($this->filtrosSupervision($request), $request->user()));
    }

    public function estadoVendedora(Request $request, string $id)
    {
        $d = $request->validate(['estado' => ['required', Rule::in(array_keys(Equipos::ESTADOS_AGENTE))]]);

        return response()->json(Supervision::cambiarEstado($id, $d['estado'], $request->user()));
    }

    public function tareas(Request $request)
    {
        $f = $request->validate([
            'alcance' => ['nullable', Rule::in(['mias', 'equipo'])], 'estado' => ['nullable', Rule::in(['OPEN', 'DONE', 'ALL'])], 'tipo' => ['nullable', Rule::in(array_keys(Tareas::TIPOS))],
            'marca' => ['nullable', 'uuid'], 'responsable' => ['nullable', 'string', 'regex:/^(none|[0-9a-f-]{36})$/'], 'vence' => ['nullable', Rule::in(['vencidas', 'hoy'])],
            'buscar' => ['nullable', 'string', 'max:100'], 'tablero' => ['nullable', Rule::in(['1'])],
        ]);

        return response()->json(Tareas::lista($f, $request->user()));
    }

    public function encargables(Request $request)
    {
        return response()->json(Tareas::encargables($request->user()));
    }

    public function clientesTarea(Request $request)
    {
        $f = $request->validate(['buscar' => ['required', 'string', 'min:2', 'max:100']]);

        return response()->json(['data' => Tareas::clientes($f['buscar'], $request->user())]);
    }

    public function encargar(Request $request)
    {
        $d = $request->validate([
            'task_type' => ['required', Rule::in(Tareas::A_MANO)], 'brand_id' => ['required', 'uuid'], 'assigned_user_id' => ['required', 'uuid'],
            'customer_id' => ['nullable', 'uuid'], 'due_at' => ['required', 'date_format:Y-m-d\\TH:i'], 'note' => ['required', 'string', 'min:3', 'max:255'],
        ], [], ['task_type' => 'tipo', 'brand_id' => 'marca', 'assigned_user_id' => 'responsable', 'customer_id' => 'cliente', 'due_at' => 'vencimiento', 'note' => 'indicación']);

        return response()->json(Tareas::encargar($d, $request->user()), 201);
    }

    public function completarTarea(Request $request, string $id)
    {
        $d = $request->validate(['resultado' => ['required', 'string', 'min:3', 'max:1000']], [], ['resultado' => 'resultado']);

        return response()->json(Tareas::completar($id, $d['resultado'], $request->user()));
    }

    public function consentimientos(Request $request)
    {
        $f = $request->validate([
            'proposito' => ['nullable', Rule::in(array_keys(Consentimientos::PROPOSITOS))], 'estado' => ['nullable', Rule::in(['0', '1'])],
            'canal' => ['nullable', Rule::in(array_keys(Consentimientos::CANALES))], 'origen' => ['nullable', Rule::in(array_keys(Consentimientos::ORIGENES))],
            'marca' => ['nullable', 'uuid'], 'desde' => ['nullable', 'date_format:Y-m-d'], 'hasta' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:desde'],
            'buscar' => ['nullable', 'string', 'max:100'],
        ]);

        return response()->json(Consentimientos::historial($f, $request->user()));
    }

    public function clientesConsentimiento(Request $request)
    {
        $f = $request->validate(['buscar' => ['required', 'string', 'min:2', 'max:100']]);

        return response()->json(['data' => Consentimientos::clientes($f['buscar'], $request->user())]);
    }

    public function registrarConsentimiento(Request $request)
    {
        $d = $request->validate([
            'customer_id' => ['required', 'uuid'], 'purpose' => ['required', Rule::in(Consentimientos::A_MANO)], 'granted' => ['required', 'boolean'],
            'channel' => ['required', Rule::in(Consentimientos::CANALES_A_MANO)], 'evidence_text' => ['required', 'string', 'min:5', 'max:500'], 'brand_id' => ['nullable', 'uuid'],
        ], [], ['customer_id' => 'cliente', 'purpose' => 'propósito', 'granted' => 'otorga', 'channel' => 'canal', 'evidence_text' => 'evidencia', 'brand_id' => 'marca']);

        return response()->json(Consentimientos::registrar($d, $request->user()), 201);
    }

    public function avisos(Request $request)
    {
        return response()->json(['data' => Consentimientos::avisos($request->user())]);
    }
}
