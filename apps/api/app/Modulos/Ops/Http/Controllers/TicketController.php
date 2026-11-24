<?php

namespace App\Modulos\Ops\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Ops\Services\Tickets;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/** OPS-15 Mis tickets: la empresa abre tickets de soporte, conversa con Intelectalab, los cierra y los califica. */
class TicketController extends Controller
{
    public function index(Request $request)
    {
        return response()->json(Tickets::deLaEmpresa($request->user()) + [
            'categorias' => Tickets::CATEGORIAS, 'prioridades' => Tickets::PRIORIDADES,
        ]);
    }

    public function show(Request $request, string $id)
    {
        return response()->json(Tickets::verDeLaEmpresa($request->user(), $id));
    }

    public function store(Request $request)
    {
        $d = $request->validate([
            'subject' => ['required', 'string', 'min:5', 'max:150'],
            'description' => ['required', 'string', 'min:10', 'max:5000'],
            'category' => ['required', Rule::in(array_keys(Tickets::CATEGORIAS))],
            'priority' => ['required', Rule::in(array_keys(Tickets::PRIORIDADES))],
        ], [], ['subject' => 'asunto', 'description' => 'detalle', 'category' => 'tema', 'priority' => 'prioridad']);

        return response()->json(Tickets::abrir($request->user(), $d), 201);
    }

    public function responder(Request $request, string $id)
    {
        $d = $request->validate(['body' => ['required', 'string', 'min:2', 'max:5000']], [], ['body' => 'mensaje']);

        return response()->json(Tickets::responderEmpresa($request->user(), $id, $d['body']));
    }

    public function cerrar(Request $request, string $id)
    {
        $d = $request->validate([
            'satisfaction' => ['nullable', 'integer', 'between:1,5'],
            'comment' => ['nullable', 'string', 'max:1000'],
        ], [], ['satisfaction' => 'calificación', 'comment' => 'comentario']);

        return response()->json(Tickets::cerrarEmpresa($request->user(), $id, $d['satisfaction'] ?? null, $d['comment'] ?? null));
    }
}
