<?php

namespace App\Modulos\Int\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Int\Services\Corridas;
use App\Modulos\Int\Services\Salud;
use App\Modulos\Int\Services\Simulador;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/** INT-08 Corridas programadas, INT-12 Salud de integraciones e INT-13 Simulador. Reglas en sus servicios. */
class OperacionIntController extends Controller
{
    public function corridas(Request $request)
    {
        $f = $request->validate([
            'job' => ['nullable', Rule::in(array_keys(Corridas::PROCESOS))], 'status' => ['nullable', Rule::in(array_keys(Corridas::ESTADOS))],
            'connector' => ['nullable', 'uuid'], 'dia' => ['nullable', 'date_format:Y-m-d'],
        ]);

        return response()->json(Corridas::lista($f));
    }

    public function ejecutar(Request $request)
    {
        $d = $request->validate(['job' => ['required', Rule::in(array_keys(Corridas::PROCESOS))], 'connector_id' => ['required', 'uuid']]);

        return response()->json(Corridas::ejecutar($d['job'], $d['connector_id'], $request->user()), 201);
    }

    /** INT-13 solo en los ambientes de prueba: en producción no existe. */
    private function soloEnPrueba(): void
    {
        if (! Simulador::disponible()) {
            abort(response()->json(['message' => 'El simulador solo existe en los ambientes de prueba.', 'code' => 'NOT_FOUND'], 404));
        }
    }

    public function salud()
    {
        return response()->json(Salud::resumen());
    }

    public function simulador()
    {
        $this->soloEnPrueba();

        return response()->json(['ejemplos' => Simulador::opciones()]);
    }

    public function simular(Request $request)
    {
        $this->soloEnPrueba();
        $d = $request->validate([
            'ejemplo' => ['required', Rule::in(array_keys(Simulador::EJEMPLOS))], 'firma_invalida' => ['boolean'], 'veces' => ['required', 'integer', Rule::in([1, 3])],
        ]);

        return response()->json(Simulador::disparar($d['ejemplo'], (bool) ($d['firma_invalida'] ?? false), (int) $d['veces'], $request->user()));
    }
}
