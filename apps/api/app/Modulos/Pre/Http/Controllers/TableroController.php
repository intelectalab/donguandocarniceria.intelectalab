<?php

namespace App\Modulos\Pre\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Pre\Services\Base;
use App\Modulos\Pre\Services\Indicadores;
use Illuminate\Http\Request;

/** PRE-11 Tablero de preparación y KPI-PRE-01 a 07. */
class TableroController extends Controller
{
    public function dia(Request $request)
    {
        $d = $request->validate(['fecha' => ['nullable', 'date_format:Y-m-d'], 'establishment_id' => ['nullable', 'uuid'], 'brand' => ['nullable', 'string']]);

        return response()->json(Indicadores::dia($d['fecha'] ?? Base::hoy(), $request->user(), $d['establishment_id'] ?? null,
            isset($d['brand']) && $d['brand'] !== 'ALL' ? $d['brand'] : null));
    }

    public function kpis(Request $request)
    {
        $d = $request->validate(['mes' => ['nullable', 'date_format:Y-m'], 'establishment_id' => ['nullable', 'uuid']]);

        return response()->json(Indicadores::kpis($d['mes'] ?? now('America/Lima')->format('Y-m'), $request->user(), $d['establishment_id'] ?? null));
    }
}
