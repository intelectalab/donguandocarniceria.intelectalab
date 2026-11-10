<?php

namespace App\Modulos\Seg\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Seg\Services\Dispositivos;
use Illuminate\Http\Request;

/** Aprobar y revocar dispositivos (SEG-09; los reutiliza SEG-13). Reglas en Dispositivos. */
class DispositivoController extends Controller
{
    public function aprobar(Request $request, string $id)
    {
        return response()->json(Dispositivos::aprobar($id, $request->user()));
    }

    public function revocar(Request $request, string $id)
    {
        $d = $request->validate(['reason' => ['required', 'string', 'min:5', 'max:80']], ['reason.min' => 'Escribe el motivo (al menos 5 letras).']);

        return response()->json(Dispositivos::revocar($id, $d['reason'], $request->user()));
    }
}
