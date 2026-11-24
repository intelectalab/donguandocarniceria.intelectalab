<?php

namespace App\Modulos\Ops\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Ops\Services\Tickets;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/** OPS-09 Bandeja de tickets: soporte de Intelectalab atiende los tickets de todas las empresas (rol con ticket.manage). */
class BandejaController extends Controller
{
    public function index(Request $request)
    {
        $f = $request->validate([
            'status' => ['nullable', Rule::in([...array_keys(Tickets::ESTADOS), 'ACTIVOS'])],
            'priority' => ['nullable', Rule::in(array_keys(Tickets::PRIORIDADES))],
            'category' => ['nullable', Rule::in(array_keys(Tickets::CATEGORIAS))],
            'tenant' => ['nullable', 'uuid'],
            'assigned' => ['nullable', 'string', 'max:36', 'regex:/^(NONE|[0-9a-f-]{36})$/'],
            'search' => ['nullable', 'string', 'max:80'],
        ]);

        return response()->json(Tickets::bandeja($f) + ['categorias' => Tickets::CATEGORIAS, 'prioridades' => Tickets::PRIORIDADES, 'estados' => Tickets::ESTADOS]);
    }

    public function show(string $id)
    {
        return response()->json(Tickets::verConsola($id));
    }

    public function responder(Request $request, string $id)
    {
        $d = $request->validate([
            'body' => ['required', 'string', 'min:2', 'max:5000'],
            'status' => ['required', Rule::in(['IN_PROGRESS', 'WAITING_CUSTOMER', 'RESOLVED'])],
        ], [], ['body' => 'respuesta', 'status' => 'estado']);

        return response()->json(Tickets::responderConsola($id, $this->quien($request), $d['body'], $d['status']));
    }

    public function asignar(Request $request, string $id)
    {
        $d = $request->validate(['platform_user_id' => ['nullable', 'uuid']]);

        return response()->json(Tickets::asignar($id, $this->quien($request), $d['platform_user_id'] ?? null));
    }

    private function quien(Request $request): array
    {
        return $request->attributes->get('consola_usuario');
    }
}
