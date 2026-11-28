<?php

namespace App\Modulos\Web\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Int\Services\Webhooks;
use App\Modulos\Web\Services\Eventos;
use Illuminate\Http\Request;

/** WEB-07 Eventos webhook. */
class EventoController extends Controller
{
    public function index(Request $r)
    {
        $f = $r->validate(['proveedor' => ['nullable', 'in:WOOCOMMERCE,MERCADOPAGO'], 'estado' => ['nullable', 'in:RECEIVED,PROCESSED,FAILED,REJECTED,IGNORED'],
            'dia' => ['nullable', 'date_format:Y-m-d'], 'q' => ['nullable', 'string', 'max:80'], 'sort' => ['nullable', 'string', 'max:30'], 'per_page' => ['nullable', 'integer']]);

        return response()->json(Eventos::lista($r->user(), $f));
    }

    public function show(Request $r, string $id)
    {
        return response()->json(Eventos::ver($id, $r->user()));
    }

    public function reprocesar(Request $r, string $id)
    {
        Eventos::ver($id, $r->user());
        Webhooks::reprocesar($id, $r->user());

        return response()->json(Eventos::ver($id, $r->user()));
    }
}
