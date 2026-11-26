<?php

namespace App\Modulos\Crm\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Crm\Services\Canales;
use App\Modulos\Crm\Services\Conversaciones;
use App\Modulos\Crm\Services\Mensajes;
use App\Modulos\Crm\Services\Recepcion;
use App\Modulos\Int\Services\Simulador;
use App\Support\RuleError;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/** CRM-01 Bandeja y CRM-02 Conversación: lista, hilo, responder, asignar, cerrar, notas y etiquetas; el simulador de prueba. */
class ConversacionController extends Controller
{
    public function index(Request $request)
    {
        $f = $request->validate([
            'estado' => ['nullable', Rule::in(['OPEN', 'CLOSED', 'ALL'])], 'canal' => ['nullable', 'uuid'], 'red' => ['nullable', Rule::in(array_keys(Canales::REDES))],
            'marca' => ['nullable', 'uuid'], 'asignada' => ['nullable', 'string', 'max:40', 'regex:/^(me|none|[0-9a-f-]{36})$/'],
            'sin_responder' => ['nullable', 'boolean'], 'por_vencer' => ['nullable', 'boolean'], 'por_anuncio' => ['nullable', 'boolean'], 'buscar' => ['nullable', 'string', 'max:100'],
        ]);

        return response()->json(Conversaciones::lista($f, $request->user()));
    }

    public function show(Request $request, string $id)
    {
        return response()->json(Conversaciones::ver($id, $request->user()));
    }

    public function responder(Request $request, string $id)
    {
        $d = $request->validate(['texto' => ['required', 'string', 'max:4096']], [], ['texto' => 'mensaje']);
        $r = Mensajes::responder($id, $d['texto'], $request->user());

        return response()->json(['mensaje' => $r, 'conversacion' => Conversaciones::ver($id, $request->user())], 201);
    }

    public function reasignar(Request $request, string $id)
    {
        $d = $request->validate(['user_id' => ['nullable', 'uuid'], 'nota' => ['nullable', 'string', 'max:255']], [], ['user_id' => 'persona']);

        return response()->json(Conversaciones::reasignar($id, $d['user_id'] ?? null, $d['nota'] ?? null, $request->user()));
    }

    public function cerrar(Request $request, string $id)
    {
        $d = $request->validate(['motivo' => ['required', Rule::in(array_keys(Conversaciones::CIERRES))]]);

        return response()->json(Conversaciones::cerrar($id, $d['motivo'], $request->user()));
    }

    public function reabrir(Request $request, string $id)
    {
        return response()->json(Conversaciones::reabrir($id, $request->user()));
    }

    public function nota(Request $request, string $id)
    {
        $d = $request->validate(['texto' => ['required', 'string', 'max:1000']], [], ['texto' => 'nota']);

        return response()->json(Conversaciones::nota($id, $d['texto'], $request->user()));
    }

    public function etiquetas(Request $request, string $id)
    {
        $d = $request->validate(['tags' => ['present', 'array', 'max:8'], 'tags.*' => ['string', Rule::in(Conversaciones::ETIQUETAS)]]);

        return response()->json(Conversaciones::etiquetas($id, $d['tags'], $request->user()));
    }

    /** RN-CRM-04: ningún mensaje se edita ni se borra, tampoco por la API. */
    public function inmutable()
    {
        RuleError::fail('RN-CRM-04', 'Los mensajes son de solo inserción: no se editan ni se borran. Envía un mensaje nuevo con la corrección; el original sigue visible para la supervisora.');
    }

    /** Solo en prueba: un mensaje del cliente en esta conversación (o que borra su último mensaje). */
    public function simular(Request $request, string $id)
    {
        abort_unless(Simulador::disponible(), 404);
        $d = $request->validate(['texto' => ['nullable', 'string', 'max:1000'], 'tipo' => ['required', Rule::in(['TEXT', 'VIEW_ONCE', 'LIVE_LOCATION', 'GROUP', 'DELETE'])]]);
        $cv = Conversaciones::visible($id, $request->user());
        if ($d['tipo'] === 'DELETE') {
            $ext = DB::table('conversation_messages')->where('conversation_id', $id)->where('direction', 'IN')->orderByDesc('sent_at')->value('external_id');
            $ext && Recepcion::borradoPorCliente($ext);
        } else {
            $de = DB::table('channel_contacts')->where('id', $cv->contact_id)->value('external_user_id');
            Recepcion::recibir(['channel_id' => $cv->channel_id, 'from' => $de, 'text' => $d['texto'] ?? 'Hola, ¿siguen atendiendo?', 'type' => $d['tipo'] === 'GROUP' ? 'TEXT' : $d['tipo'],
                'group' => $d['tipo'] === 'GROUP', 'external_id' => 'wamid.SIM'.bin2hex(random_bytes(8))]);
        }

        return response()->json(Conversaciones::ver($id, $request->user()));
    }

    /** Solo en prueba: un chat que entra a un número (cliente nuevo o conocido, por anuncio o no). */
    public function simularNuevo(Request $request)
    {
        abort_unless(Simulador::disponible(), 404);
        $d = $request->validate(['channel_id' => ['required', 'uuid'], 'from' => ['required', 'string', 'max:20'], 'name' => ['nullable', 'string', 'max:80'],
            'texto' => ['required', 'string', 'max:1000'], 'anuncio' => ['nullable', 'string', 'max:40']], [], ['channel_id' => 'número', 'from' => 'celular del cliente', 'texto' => 'mensaje']);
        Canales::visibles($request->user())->where('c.id', $d['channel_id'])->exists() || abort(404);
        $r = Recepcion::recibir(['channel_id' => $d['channel_id'], 'from' => $d['from'], 'name' => $d['name'] ?? null, 'text' => $d['texto'],
            'referral' => ! empty($d['anuncio']) ? ['ad_code' => $d['anuncio'], 'headline' => 'Anuncio de prueba'] : null, 'external_id' => 'wamid.SIM'.bin2hex(random_bytes(8))]);

        return response()->json($r, 201);
    }
}
