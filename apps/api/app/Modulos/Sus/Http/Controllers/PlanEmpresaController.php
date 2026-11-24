<?php

namespace App\Modulos\Sus\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Sus\Services\CambioDePlan;
use Illuminate\Http\Request;

/** SUS-02 Cambiar de plan y SUS-03 Complementos (la empresa). */
class PlanEmpresaController extends Controller
{
    public function planes()
    {
        return response()->json(CambioDePlan::comparador());
    }

    public function cambiar(Request $request)
    {
        $d = $request->validate(['plan_version_id' => ['required', 'uuid']], [], ['plan_version_id' => 'plan']);

        return response()->json(CambioDePlan::cambiar($request->user(), $d['plan_version_id']));
    }

    public function deshacer(Request $request)
    {
        return response()->json(CambioDePlan::deshacerPendiente($request->user()));
    }

    public function complementos()
    {
        return response()->json(['data' => CambioDePlan::complementos()]);
    }

    public function contratar(Request $request, string $code)
    {
        $d = $request->validate(['quantity' => ['nullable', 'integer', 'min:1', 'max:50']], [], ['quantity' => 'cantidad']);

        return response()->json(['data' => CambioDePlan::contratar($request->user(), strtoupper($code), (int) ($d['quantity'] ?? 1))]);
    }

    public function quitar(Request $request, string $code)
    {
        $d = $request->validate(['quantity' => ['nullable', 'integer', 'min:1', 'max:50']], [], ['quantity' => 'cantidad']);

        return response()->json(['data' => CambioDePlan::quitar($request->user(), strtoupper($code), isset($d['quantity']) ? (int) $d['quantity'] : null)]);
    }
}
