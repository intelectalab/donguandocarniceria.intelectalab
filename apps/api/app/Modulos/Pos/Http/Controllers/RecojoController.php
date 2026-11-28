<?php

namespace App\Modulos\Pos\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Pos\Services\Cajas;
use App\Modulos\Pos\Services\Recojos;
use App\Modulos\Pos\Services\Turnos;
use Illuminate\Http\Request;

/** POS-12 Pedidos por recoger. Reglas en Services\Recojos. */
class RecojoController extends Controller
{
    public function index(Request $request)
    {
        $u = $request->user();
        $t = Turnos::abiertoDe($u);
        $local = $request->query('establishment_id') ?: ($t?->establishment_id ?? Cajas::visibles($u, true)->first()?->establishment_id);

        return response()->json(['local' => $local, 'pedidos' => Recojos::pendientes($u, $local, $request->query('q'))]);
    }

    public function show(Request $request, string $id)
    {
        return response()->json(Recojos::detalle($id, $request->user()));
    }

    public function entregar(Request $request, string $id)
    {
        $d = $request->validate(['payments' => ['nullable', 'array', 'max:8'], 'doc_type' => ['nullable', 'in:RECEIPT,INVOICE']]);

        return response()->json(Recojos::entregar($id, $d, $request->user()));
    }
}
