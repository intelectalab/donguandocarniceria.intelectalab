<?php

namespace App\Modulos\Crm\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Crm\Services\Ficha360;
use App\Modulos\Crm\Services\Leads;
use App\Modulos\Crm\Services\PedidosChat;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/** CRM-03 Crear pedido desde el chat, CRM-04 Ficha 360 del cliente y CRM-05 Leads. */
class ClienteController extends Controller
{
    public function prepararPedido(Request $request, string $id)
    {
        return response()->json(PedidosChat::preparar($id, $request->user()));
    }

    public function crearPedido(Request $request, string $id)
    {
        $d = $request->validate(['full_name' => ['nullable', 'string', 'max:120'], 'phone' => ['nullable', 'string', 'max:20'], 'doc_number' => ['nullable', 'string', 'regex:/^\d{8}$/'],
            'address_id' => ['nullable', 'uuid']], [], ['full_name' => 'nombre', 'phone' => 'celular', 'doc_number' => 'DNI', 'address_id' => 'dirección']);

        return response()->json(PedidosChat::crear($id, $d, $request->user()), 201);
    }

    public function enviarResumen(Request $request, string $id)
    {
        $d = $request->validate(['order_id' => ['required', 'uuid']], [], ['order_id' => 'pedido']);

        return response()->json(PedidosChat::enviarResumen($id, $d['order_id'], $request->user()), 201);
    }

    public function clientes(Request $request)
    {
        $f = $request->validate(['buscar' => ['nullable', 'string', 'max:100'], 'tipo' => ['nullable', Rule::in(array_keys(Ficha360::TIPOS))], 'con_chat' => ['nullable', 'boolean']]);

        return response()->json(Ficha360::lista($f, $request->user()));
    }

    public function cliente(Request $request, string $id)
    {
        return response()->json(Ficha360::ver($id, $request->user()));
    }

    public function leads(Request $request)
    {
        $f = $request->validate([
            'estado' => ['nullable', Rule::in(array_keys(Leads::ESTADOS))], 'marca' => ['nullable', 'uuid'], 'red' => ['nullable', Rule::in(array_keys(Leads::ORIGENES))],
            'canal' => ['nullable', 'uuid'], 'anuncio' => ['nullable', Rule::in(['0', '1'])], 'vendedora' => ['nullable', 'uuid'], 'buscar' => ['nullable', 'string', 'max:100'],
            'desde' => ['nullable', 'date_format:Y-m-d'], 'hasta' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:desde'], 'tablero' => ['nullable', Rule::in(['1'])],
        ]);

        return response()->json(Leads::lista($f, $request->user()));
    }

    public function lead(Request $request, string $id)
    {
        return response()->json(Leads::ver($id, $request->user()));
    }

    public function estadoLead(Request $request, string $id)
    {
        $d = $request->validate(['estado' => ['required', Rule::in(['CONTACTED', 'QUALIFIED', 'LOST', 'DISCARDED', 'WON'])], 'motivo' => ['nullable', Rule::in(array_keys(Leads::MOTIVOS))],
            'nota' => ['nullable', 'string', 'max:500']]);

        return response()->json(Leads::cambiarEstado($id, $d['estado'], $d['motivo'] ?? null, $d['nota'] ?? null, $request->user()));
    }

    public function crearLead(Request $request)
    {
        $d = $request->validate(['full_name' => ['required', 'string', 'min:3', 'max:120'], 'phone' => ['required', 'string', 'max:20'], 'brand_id' => ['required', 'uuid'],
            'source' => ['required', Rule::in(Leads::MANUALES)], 'notes' => ['nullable', 'string', 'max:2000']],
            [], ['full_name' => 'nombre', 'phone' => 'celular', 'brand_id' => 'marca', 'source' => 'origen', 'notes' => 'notas']);

        return response()->json(Leads::crear($d, $request->user()), 201);
    }
}
