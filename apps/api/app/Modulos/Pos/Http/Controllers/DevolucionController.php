<?php

namespace App\Modulos\Pos\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Pos\Services\Devoluciones;
use Illuminate\Http\Request;

/** POS-09 Devolución. Reglas en Services\Devoluciones. */
class DevolucionController extends Controller
{
    public function index(Request $request)
    {
        return response()->json([
            'comprobantes' => Devoluciones::delDia($request->user(), $request->query('q')),
            'notas' => Devoluciones::notas($request->user()),
        ]);
    }

    public function store(Request $request, string $id)
    {
        $d = $request->validate([
            'lines' => ['required', 'array', 'min:1', 'max:80'], 'lines.*.line_id' => ['required', 'uuid'],
            'lines.*.qty' => ['nullable', 'numeric', 'min:0'], 'lines.*.weight_kg' => ['nullable', 'numeric', 'min:0'],
            'mode' => ['required', 'in:SAME,CREDIT'], 'reason' => ['required', 'string', 'max:200'], 'restock' => ['nullable', 'boolean'],
        ]);

        return response()->json(Devoluciones::devolver($id, $d, $request->user()), 201);
    }
}
