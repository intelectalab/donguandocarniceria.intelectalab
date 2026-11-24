<?php

namespace App\Modulos\Ops\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Ops\Services\Accesos;
use App\Support\Access;
use Illuminate\Http\Request;

/** OPS-14 Accesos de soporte: la empresa aprueba o rechaza los pedidos del soporte, revoca los vigentes y ve lo que hizo. */
class AccesoEmpresaController extends Controller
{
    public function index()
    {
        return response()->json(Accesos::deLaEmpresa(request()->user()));
    }

    public function show(Request $request, string $id)
    {
        return response()->json(Accesos::verDeLaEmpresa($id, Access::can($request->user(), 'ops.support_access.view_log')));
    }

    public function aprobar(Request $request, string $id)
    {
        $d = $request->validate(['hours' => ['nullable', 'integer', 'min:1', 'max:999']], [], ['hours' => 'horas']);

        return response()->json(Accesos::aprobar($request->user(), $id, $d['hours'] ?? null));
    }

    public function rechazar(Request $request, string $id)
    {
        $d = $request->validate(['reason' => ['required', 'string', 'min:5', 'max:300']], [], ['reason' => 'motivo']);

        return response()->json(Accesos::rechazar($request->user(), $id, $d['reason']));
    }

    public function revocar(Request $request, string $id)
    {
        $d = $request->validate(['reason' => ['nullable', 'string', 'max:300']], [], ['reason' => 'motivo']);

        return response()->json(Accesos::revocar($request->user(), $id, $d['reason'] ?? null));
    }
}
