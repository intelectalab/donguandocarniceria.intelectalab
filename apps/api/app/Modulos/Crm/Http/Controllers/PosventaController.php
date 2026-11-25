<?php

namespace App\Modulos\Crm\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Crm\Services\Encuestas;
use App\Modulos\Crm\Services\Recompra;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/** CRM-15 Recompra y CRM-16 Encuesta posentrega. */
class PosventaController extends Controller
{
    public function recompra(Request $request)
    {
        $f = $request->validate([
            'estado' => ['nullable', Rule::in(array_keys(Recompra::ESTADOS))], 'marca' => ['nullable', 'uuid'], 'vendedora' => ['nullable', 'string', 'regex:/^(none|[0-9a-f-]{36})$/'],
            'tarea' => ['nullable', Rule::in(['0', '1'])], 'buscar' => ['nullable', 'string', 'max:100'],
        ]);

        return response()->json(Recompra::lista($f, $request->user()));
    }

    public function recalcular(Request $request)
    {
        return response()->json(Recompra::recalcular());
    }

    public function plantillaRecompra(Request $request, string $id)
    {
        return response()->json(Recompra::enviarPlantilla($id, $request->user()), 201);
    }

    public function encuestas(Request $request)
    {
        $f = $request->validate([
            'senal' => ['nullable', Rule::in(array_keys(Encuestas::SENALES))], 'envio' => ['nullable', Rule::in(array_keys(Encuestas::ENVIOS))], 'marca' => ['nullable', 'uuid'],
            'vendedora' => ['nullable', 'uuid'], 'desde' => ['nullable', 'date_format:Y-m-d'], 'hasta' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:desde'],
            'buscar' => ['nullable', 'string', 'max:100'],
        ]);

        return response()->json(Encuestas::lista($f, $request->user()));
    }

    public function responderEncuesta(Request $request, string $id)
    {
        $d = $request->validate([
            'rating_service' => ['required', 'integer', 'between:1,5'], 'rating_product' => ['required', 'integer', 'between:1,5'],
            'received_as_ordered' => ['required', 'boolean'], 'bought_outside_catalog' => ['required', 'boolean'], 'comments' => ['nullable', 'string', 'max:1000'],
        ], [], ['rating_service' => 'atención', 'rating_product' => 'producto', 'received_as_ordered' => 'recibió lo que pidió', 'bought_outside_catalog' => 'compró fuera de la web', 'comments' => 'comentario']);

        return response()->json(Encuestas::responder($id, $d, $request->user()));
    }
}
