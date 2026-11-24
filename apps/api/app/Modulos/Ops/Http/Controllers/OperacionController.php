<?php

namespace App\Modulos\Ops\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Ops\Services\Anuncios;
use App\Modulos\Ops\Services\Incidentes;
use App\Modulos\Ops\Services\Salud;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/** Operación de la plataforma en la consola: OPS-07 Salud de componentes, OPS-08 Incidentes y OPS-11 Anuncios. */
class OperacionController extends Controller
{
    /* ------------------------------------------------------------------ OPS-07 */

    public function salud()
    {
        return response()->json(Salud::tablero());
    }

    public function componente(string $codigo)
    {
        return response()->json(Salud::componente($codigo));
    }

    public function registrarLectura(Request $request, string $codigo)
    {
        $d = $request->validate([
            'status' => ['required', Rule::in(['UP', 'DEGRADED', 'DOWN'])],
            'latency_ms' => ['nullable', 'integer', 'min:0', 'max:600000'],
            'error_rate' => ['nullable', 'numeric', 'min:0', 'max:100'],
            'queue_depth' => ['nullable', 'integer', 'min:0', 'max:100000000'],
            'detail' => ['required', 'string', 'min:5', 'max:300'],
        ], [], ['status' => 'estado', 'detail' => 'detalle']);

        return response()->json(Salud::registrarManual($this->quien($request), $codigo, $d));
    }

    /* ------------------------------------------------------------------ OPS-08 */

    public function incidentes(Request $request)
    {
        $f = $request->validate([
            'status' => ['nullable', Rule::in([...array_keys(Incidentes::ESTADOS), 'ABIERTOS'])],
            'severity' => ['nullable', Rule::in(array_keys(Incidentes::SEVERIDADES))],
            'tenant' => ['nullable', 'uuid'],
        ]);

        return response()->json(Incidentes::lista($f) + ['severidades' => Incidentes::SEVERIDADES, 'estados' => Incidentes::ESTADOS,
            'componentes' => Salud::tablero()['data']]);
    }

    public function incidente(string $id)
    {
        return response()->json(Incidentes::ver($id));
    }

    public function crearIncidente(Request $request)
    {
        return response()->json(Incidentes::crear($this->quien($request), $this->datosIncidente($request) + $request->validate([
            'started_at' => ['nullable', 'date'], 'message' => ['nullable', 'string', 'max:2000'],
        ])), 201);
    }

    public function editarIncidente(Request $request, string $id)
    {
        return response()->json(Incidentes::editar($id, $this->quien($request), $this->datosIncidente($request)));
    }

    public function actualizarIncidente(Request $request, string $id)
    {
        $d = $request->validate([
            'status' => ['required', Rule::in(array_keys(Incidentes::ESTADOS))],
            'message' => ['required', 'string', 'min:5', 'max:2000'],
            'public' => ['required', 'boolean'],
        ], [], ['status' => 'estado', 'message' => 'mensaje']);

        return response()->json(Incidentes::actualizar($id, $this->quien($request), $d));
    }

    public function resolverIncidente(Request $request, string $id)
    {
        $d = $request->validate([
            'resolved_at' => ['nullable', 'date'],
            'root_cause' => ['required', 'string', 'min:5', 'max:2000'],
            'postmortem' => ['nullable', 'string', 'max:10000'],
            'message' => ['nullable', 'string', 'max:2000'],
        ], [], ['resolved_at' => 'hora de cierre', 'root_cause' => 'causa raíz']);

        return response()->json(Incidentes::resolver($id, $this->quien($request), $d));
    }

    public function postmortem(Request $request, string $id)
    {
        $d = $request->validate(['postmortem' => ['required', 'string', 'min:5', 'max:10000']], [], ['postmortem' => 'post mortem']);

        return response()->json(Incidentes::postmortem($id, $this->quien($request), $d['postmortem']));
    }

    public function vincularTicket(Request $request, string $ticket)
    {
        $d = $request->validate(['incident_id' => ['nullable', 'uuid']]);
        Incidentes::vincularTicket($ticket, $d['incident_id'] ?? null, $this->quien($request));

        return response()->noContent();
    }

    public function incidentesParaVincular()
    {
        return response()->json(Incidentes::paraVincular());
    }

    /* ------------------------------------------------------------------ OPS-11 */

    public function anuncios()
    {
        return response()->json(Anuncios::lista() + ['tipos' => Anuncios::TIPOS, 'publicos' => Anuncios::PUBLICOS, 'estados' => Anuncios::ESTADOS]);
    }

    public function guardarAnuncio(Request $request, ?string $id = null)
    {
        $d = $request->validate([
            'title' => ['required', 'string', 'min:5', 'max:120'],
            'body' => ['required', 'string', 'min:5', 'max:2000'],
            'kind' => ['required', Rule::in(['INFO', 'MAINTENANCE', 'FEATURE'])],
            'audience' => ['required', Rule::in(array_keys(Anuncios::PUBLICOS))],
            'audience_plans' => ['array', 'max:20'], 'audience_plans.*' => ['string', 'max:20'],
            'audience_tenants' => ['array', 'max:500'], 'audience_tenants.*' => ['uuid'],
            'starts_at' => ['nullable', 'date'], 'ends_at' => ['nullable', 'date'],
            'maintenance_starts_at' => ['nullable', 'date'], 'maintenance_ends_at' => ['nullable', 'date'],
        ], [], ['title' => 'título', 'body' => 'texto', 'kind' => 'tipo', 'audience' => 'a quién']);

        return response()->json(Anuncios::guardar($this->quien($request), $d, $id), $id ? 200 : 201);
    }

    public function publicarAnuncio(Request $request, string $id)
    {
        return response()->json(Anuncios::publicar($id, $this->quien($request)));
    }

    public function cancelarAnuncio(Request $request, string $id)
    {
        return response()->json(Anuncios::cancelar($id, $this->quien($request)));
    }

    private function datosIncidente(Request $request): array
    {
        return $request->validate([
            'title' => ['required', 'string', 'min:5', 'max:150'],
            'severity' => ['required', Rule::in(array_keys(Incidentes::SEVERIDADES))],
            'component_code' => ['nullable', 'string', 'exists:platform_components,code'],
            'affects_all' => ['required', 'boolean'],
            'tenants' => ['array', 'max:500'], 'tenants.*' => ['uuid'],
        ], [], ['title' => 'título', 'severity' => 'severidad', 'component_code' => 'componente']);
    }

    private function quien(Request $request): array
    {
        return $request->attributes->get('consola_usuario');
    }
}
