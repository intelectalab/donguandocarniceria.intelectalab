<?php

namespace App\Modulos\Ops\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Ops\Services\Metricas;
use Illuminate\Http\Request;

/** OPS-10 Métricas del negocio (consola). */
class MetricaController extends Controller
{
    public function index()
    {
        return response()->json(Metricas::tablero());
    }

    public function congelar(Request $request)
    {
        $d = $request->validate([
            'period' => ['required', 'regex:/^\d{4}-(0[1-9]|1[0-2])$/'],
            'reason' => ['nullable', 'string', 'max:300'],
        ], [], ['period' => 'mes', 'reason' => 'motivo']);

        return response()->json(Metricas::congelar($request->attributes->get('consola_usuario'), $d['period'], $d['reason'] ?? null), 201);
    }
}
