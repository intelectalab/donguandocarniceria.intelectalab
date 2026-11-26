<?php

namespace App\Modulos\Tel\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Tel\Services\Llamadas;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/** TEL-06 Teléfono en la app y TEL-07 Llamar desde la ficha o el pedido. */
class LlamadaController extends Controller
{
    public function telefono(Request $request)
    {
        return response()->json(Llamadas::telefono($request->user()));
    }

    public function simular(Request $request)
    {
        $d = $request->validate([
            'from' => ['required', 'string', 'max:20'], 'number_id' => ['nullable', 'uuid'], 'option' => ['nullable', 'integer', 'between:1,9'],
            'resultado' => ['required', Rule::in(['COMPLETED', 'MISSED', 'NO_ANSWER', 'VOICEMAIL', 'BUSY'])], 'segundos' => ['nullable', 'integer', 'between:1,7200'],
        ], [], ['from' => 'número de quien llama', 'option' => 'opción', 'resultado' => 'resultado', 'segundos' => 'duración']);

        return response()->json(Llamadas::simularEntrante($d, $request->user()), 201);
    }

    private function referencia(Request $request): array
    {
        $d = $request->validate(['order_id' => ['nullable', 'uuid'], 'customer_id' => ['nullable', 'uuid'], 'lead_id' => ['nullable', 'uuid']]);
        abort_unless(array_filter($d), 422, 'Indica el cliente, el lead o el pedido.');

        return $d;
    }

    public function destino(Request $request)
    {
        return response()->json(Llamadas::destino($this->referencia($request), $request->user()));
    }

    public function llamar(Request $request)
    {
        return response()->json(Llamadas::llamar($this->referencia($request), $request->user()), 201);
    }

    public function resultado(Request $request, string $id)
    {
        $d = $request->validate(['estado' => ['required', Rule::in(['COMPLETED', 'NO_ANSWER', 'BUSY', 'FAILED'])], 'segundos' => ['nullable', 'integer', 'between:0,7200']],
            [], ['estado' => 'resultado', 'segundos' => 'duración']);

        return response()->json(Llamadas::resultado($id, $d['estado'], (int) ($d['segundos'] ?? 0), $request->user()));
    }

    public function ver(Request $request, string $id)
    {
        return response()->json(Llamadas::ver($id, $request->user()));
    }

    public function salientes(Request $request)
    {
        $f = $request->validate(['estado' => ['nullable', Rule::in(array_keys(Llamadas::ESTADOS))], 'vendedora' => ['nullable', 'uuid'], 'desde' => ['nullable', 'date_format:Y-m-d'],
            'hasta' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:desde'], 'buscar' => ['nullable', 'string', 'max:100']]);

        return response()->json(Llamadas::salientes($f, $request->user()));
    }

    public function pedidos(Request $request)
    {
        $f = $request->validate(['buscar' => ['nullable', 'string', 'max:100']]);

        return response()->json(['data' => Llamadas::pedidos($f['buscar'] ?? null, $request->user())]);
    }
}
