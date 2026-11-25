<?php

namespace App\Modulos\Crm\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Crm\Services\Consentimientos;
use App\Modulos\Crm\Services\Costos;
use App\Modulos\Crm\Services\Plantillas;
use App\Modulos\Crm\Services\Respuestas;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/** CRM-09 Plantillas, CRM-10 Respuestas rápidas y catálogo, CRM-11 Costo de WhatsApp; su uso desde la conversación. */
class PlantillaController extends Controller
{
    public function plantillas(Request $request)
    {
        $f = $request->validate(['categoria' => ['nullable', Rule::in(array_keys(Plantillas::CATEGORIAS))], 'estado' => ['nullable', Rule::in(array_keys(Plantillas::ESTADOS))],
            'marca' => ['nullable', 'uuid'], 'proposito' => ['nullable', Rule::in(array_keys(Plantillas::PROPOSITOS))], 'buscar' => ['nullable', 'string', 'max:100']]);

        return response()->json(Plantillas::lista($f, $request->user()));
    }

    public function plantilla(Request $request, string $id)
    {
        return response()->json(Plantillas::ver($id, $request->user()));
    }

    public function guardarPlantilla(Request $request, ?string $id = null)
    {
        $d = $request->validate(['brand_id' => ['required', 'uuid'], 'name' => ['required', 'string', 'max:250'], 'category' => ['required', Rule::in(array_keys(Plantillas::CATEGORIAS))],
            'purpose' => ['required', Rule::in(array_keys(Plantillas::PROPOSITOS))], 'body' => ['required', 'string', 'min:10', 'max:1024']],
            [], ['brand_id' => 'marca', 'name' => 'nombre', 'category' => 'categoría', 'purpose' => 'propósito', 'body' => 'texto']);

        return response()->json(Plantillas::guardar($id, $d, $request->user()), $id ? 200 : 201);
    }

    public function enviarARevision(Request $request, string $id)
    {
        return response()->json(Plantillas::enviarARevision($id, $request->user()));
    }

    public function respuestaDeMeta(Request $request, string $id)
    {
        $d = $request->validate(['aprobada' => ['required', 'boolean'], 'motivo' => ['nullable', 'string', 'max:255']]);

        return response()->json(Plantillas::respuestaDeMeta($id, (bool) $d['aprobada'], $d['motivo'] ?? null, $request->user()));
    }

    public function plantillasDeConversacion(Request $request, string $id)
    {
        return response()->json(Plantillas::paraConversacion($id, $request->user()));
    }

    public function enviarPlantilla(Request $request, string $id)
    {
        $d = $request->validate(['template_id' => ['required', 'uuid'], 'order_id' => ['nullable', 'uuid'], 'extra' => ['nullable', 'boolean']], [], ['template_id' => 'plantilla', 'order_id' => 'pedido']);

        return response()->json(Plantillas::enviar($id, $d['template_id'], $d['order_id'] ?? null, (bool) ($d['extra'] ?? false), $request->user()), 201);
    }

    public function consentimiento(Request $request, string $id)
    {
        $d = $request->validate(['otorgado' => ['required', 'boolean'], 'evidencia' => ['required', 'string', 'max:500'], 'message_id' => ['nullable', 'uuid']], [], ['evidencia' => 'evidencia']);

        return response()->json(Consentimientos::registrarMarketing($id, (bool) $d['otorgado'], $d['evidencia'], $d['message_id'] ?? null, $request->user()));
    }

    public function respuestas(Request $request)
    {
        $f = $request->validate(['marca' => ['nullable', 'uuid'], 'alcance' => ['nullable', Rule::in(['ME', 'MARCA'])], 'estado' => ['nullable', Rule::in(['ACTIVE', 'INACTIVE'])],
            'buscar' => ['nullable', 'string', 'max:100']]);

        return response()->json(Respuestas::lista($f, $request->user()));
    }

    public function guardarRespuesta(Request $request, ?string $id = null)
    {
        $d = $request->validate(['shortcut' => ['required', 'string', 'max:31'], 'body' => ['required', 'string', 'min:2', 'max:2000'], 'status' => ['required', Rule::in(['ACTIVE', 'INACTIVE'])],
            'alcance' => ['required', 'string', 'regex:/^(ME|[0-9a-f-]{36})$/']], [], ['shortcut' => 'atajo', 'body' => 'texto', 'status' => 'estado', 'alcance' => 'alcance']);

        return response()->json(Respuestas::guardar($id, $d, $request->user()), $id ? 200 : 201);
    }

    public function catalogo(Request $request)
    {
        $f = $request->validate(['marca' => ['nullable', 'uuid'], 'estado' => ['nullable', Rule::in(['PUBLICADO', 'FUERA'])], 'buscar' => ['nullable', 'string', 'max:100']]);

        return response()->json(Respuestas::catalogo($f, $request->user()));
    }

    public function sincronizar(Request $request)
    {
        return response()->json(Respuestas::sincronizar($request->user()));
    }

    public function catalogoDeConversacion(Request $request, string $id)
    {
        return response()->json(['data' => Respuestas::catalogoDeConversacion($id, $request->user())]);
    }

    public function enviarProducto(Request $request, string $id)
    {
        $d = $request->validate(['variant_id' => ['required', 'uuid']], [], ['variant_id' => 'producto']);
        $r = Respuestas::enviarProducto($id, $d['variant_id'], $request->user());

        return response()->json(['mensaje' => $r, 'conversacion' => \App\Modulos\Crm\Services\Conversaciones::ver($id, $request->user())], 201);
    }

    public function costos(Request $request)
    {
        $f = $request->validate(['mes' => ['nullable', 'date_format:Y-m'], 'marca' => ['nullable', 'uuid']]);

        return response()->json(Costos::resumen($f, $request->user()));
    }

    public function simular(Request $request)
    {
        $d = $request->validate(['pedidos' => ['required', 'integer', 'min:0', 'max:100000'], 'numeros' => ['required', 'integer', 'min:1', 'max:20'],
            'respuestas' => ['required', 'integer', 'min:0', 'max:100'], 'utilidades' => ['required', 'integer', 'min:0', 'max:5'], 'por_anuncio' => ['required', 'numeric', 'min:0', 'max:1']]);

        return response()->json(Costos::simular((int) $d['pedidos'], (int) $d['numeros'], (int) $d['respuestas'], (int) $d['utilidades'], (float) $d['por_anuncio']));
    }
}
