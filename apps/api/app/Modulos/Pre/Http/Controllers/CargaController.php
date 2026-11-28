<?php

namespace App\Modulos\Pre\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Pre\Services\Base;
use App\Modulos\Pre\Services\Despacho;
use Illuminate\Http\Request;

/** PRE-08 Carga del vehículo: rutas del día, bolsas en orden de carga y escaneo de cada bolsa (RN-PRE-08). */
class CargaController extends Controller
{
    public function rutas(Request $request)
    {
        $d = $request->validate(['fecha' => ['nullable', 'date_format:Y-m-d'], 'establishment_id' => ['nullable', 'uuid']]);

        return response()->json(Despacho::rutas($d['fecha'] ?? Base::hoy(), $request->user(), $d['establishment_id'] ?? null));
    }

    public function carga(Request $request)
    {
        $d = $request->validate(['route_key' => ['required', 'string', 'max:80']]);

        return response()->json(Despacho::carga($d['route_key'], $request->user()));
    }

    public function escanear(Request $request)
    {
        $d = $request->validate(['route_key' => ['required', 'string', 'max:80'], 'code' => ['required', 'string', 'max:80'], 'device' => ['nullable', 'string', 'max:40']]);
        $u = $request->user();
        $r = Despacho::cargar($d['route_key'], $d['code'], $u, $d['device'] ?? 'WEB');

        return response()->json($r + ['carga' => Despacho::carga($d['route_key'], $u)]);
    }
}
