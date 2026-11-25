<?php

namespace App\Modulos\Int\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Int\Services\Salientes;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/** INT-06 Mensajes salientes e INT-07 Cola muerta. Reglas en Services\Salientes. */
class SalienteController extends Controller
{
    public function index(Request $request)
    {
        $f = $request->validate([
            'status' => ['nullable', Rule::in(array_keys(Salientes::ESTADOS))], 'kind' => ['nullable', Rule::in(array_keys(Salientes::TIPOS))],
            'connector' => ['nullable', 'uuid'], 'module' => ['nullable', 'string', 'max:20'], 'dia' => ['nullable', 'date_format:Y-m-d'], 'muertos' => ['nullable', 'boolean'],
        ]);

        return response()->json(Salientes::lista($f));
    }

    public function show(string $id)
    {
        return response()->json(Salientes::ver($id));
    }

    /** «Procesar ahora»: despacha todo lo pendiente o reintentando, sin esperar el próximo intento. */
    public function procesar()
    {
        return response()->json(['procesados' => Salientes::procesar(true)]);
    }

    public function reintentar(Request $request, string $id)
    {
        $d = $request->validate(['reason' => ['required', 'string', 'min:10', 'max:300']], [], ['reason' => 'motivo']);

        return response()->json(Salientes::reintentar($id, $d['reason'], $request->user()));
    }

    public function cancelar(Request $request, string $id)
    {
        $d = $request->validate(['reason' => ['required', 'string', 'min:10', 'max:300']], [], ['reason' => 'motivo']);

        return response()->json(Salientes::cancelar($id, $d['reason'], $request->user()));
    }

    public function eventos(Request $request)
    {
        $f = $request->validate(['evento' => ['nullable', 'string', 'max:80']]);

        return response()->json(Salientes::eventos($f));
    }
}
