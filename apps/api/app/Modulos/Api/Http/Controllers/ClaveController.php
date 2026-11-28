<?php

namespace App\Modulos\Api\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Api\Services\Catalogo;
use App\Modulos\Api\Services\Claves;
use App\Modulos\Api\Services\Documentacion;
use App\Modulos\Api\Services\Sandbox;
use App\Modulos\Api\Services\Uso;
use App\Modulos\Api\Services\Webhooks;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/** API-01 a API-11: Claves, Webhooks, Entregas, Documentación, Sandbox, Uso y Catálogo de eventos y alcances. */
class ClaveController extends Controller
{
    public function lista(Request $request)
    {
        $f = $request->validate([
            'entorno' => ['nullable', Rule::in(array_keys(Claves::ENTORNOS))], 'estado' => ['nullable', Rule::in(array_keys(Claves::ESTADOS))],
            'escritura' => ['nullable', Rule::in(['0', '1'])], 'alcance' => ['nullable', 'string', 'max:40'], 'buscar' => ['nullable', 'string', 'max:100'],
        ]);

        return response()->json(Claves::lista($f, $request->user()));
    }

    public function formulario()
    {
        return response()->json(Claves::formulario());
    }

    public function clientes(Request $request)
    {
        $f = $request->validate(['buscar' => ['required', 'string', 'min:2', 'max:100']]);

        return response()->json(['data' => Claves::clientes($f['buscar'])]);
    }

    public function crear(Request $request)
    {
        $d = $request->validate([
            'name' => ['required', 'string', 'min:3', 'max:120'], 'description' => ['nullable', 'string', 'max:500'], 'environment' => ['required', Rule::in(array_keys(Claves::ENTORNOS))],
            'scopes' => ['required', 'array', 'min:1', 'max:20'], 'scopes.*' => ['string', 'max:40'], 'brand_ids' => ['nullable', 'array', 'max:20'], 'brand_ids.*' => ['uuid'],
            'allowed_ips' => ['nullable', 'array', 'max:20'], 'allowed_ips.*' => ['string', 'max:18'], 'customer_id' => ['nullable', 'uuid'],
            'channel' => ['nullable', Rule::in(array_keys(Claves::CANALES))], 'expires_at' => ['required', 'date_format:Y-m-d'],
        ], [], ['name' => 'nombre', 'environment' => 'entorno', 'scopes' => 'alcances', 'expires_at' => 'vencimiento', 'allowed_ips' => 'IP permitidas', 'channel' => 'canal']);

        return response()->json(Claves::crear($d, $request->user()), 201);
    }

    public function ver(Request $request, string $id)
    {
        return response()->json(Claves::ver($id, $request->user()));
    }

    public function editar(Request $request, string $id)
    {
        $d = $request->validate([
            'name' => ['sometimes', 'string', 'min:3', 'max:120'], 'description' => ['sometimes', 'nullable', 'string', 'max:500'],
            'allowed_ips' => ['sometimes', 'array', 'max:20'], 'allowed_ips.*' => ['string', 'max:18'], 'expires_at' => ['sometimes', 'date_format:Y-m-d'],
        ], [], ['name' => 'nombre', 'expires_at' => 'vencimiento', 'allowed_ips' => 'IP permitidas']);

        return response()->json(Claves::editar($id, $d, $request->user()));
    }

    public function revocar(Request $request, string $id)
    {
        $d = $request->validate(['motivo' => ['required', 'string', 'min:10', 'max:500']], [], ['motivo' => 'motivo']);

        return response()->json(Claves::revocar($id, $d['motivo'], $request->user()));
    }

    public function catalogo(Request $request)
    {
        $f = $request->validate(['modulo' => ['nullable', 'string', 'max:20'], 'estado' => ['nullable', Rule::in(array_keys(Catalogo::ESTADOS_EVENTO))],
            'alcance' => ['nullable', 'string', 'max:40'], 'buscar' => ['nullable', 'string', 'max:100']]);

        return response()->json(Catalogo::ver($f));
    }

    public function uso(Request $request)
    {
        $f = $request->validate(['entorno' => ['nullable', Rule::in(array_keys(Claves::ENTORNOS))], 'clave' => ['nullable', 'uuid'], 'buscar' => ['nullable', 'string', 'max:100'],
            'desde' => ['nullable', 'date_format:Y-m-d'], 'hasta' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:desde', 'before_or_equal:today']]);
        if (! empty($f['desde']) && ! empty($f['hasta']) && (strtotime($f['hasta']) - strtotime($f['desde'])) / 86400 > 92) {
            return response()->json(['message' => 'Elige un período de hasta 3 meses.', 'code' => 'RN-API-09'], 422);
        }

        return response()->json(Uso::panel($f, $request->user()));
    }

    /* ------------------------------------------------------------------ API-04 y API-05 Destinos de webhooks */

    public function destinos(Request $request)
    {
        $f = $request->validate([
            'estado' => ['nullable', Rule::in(array_keys(Webhooks::ESTADOS_DESTINO))],
            'entorno' => ['nullable', Rule::in(array_keys(Claves::ENTORNOS))],
            'buscar' => ['nullable', 'string', 'max:100'],
        ]);

        return response()->json(Webhooks::listaDestinos($f, $request->user()));
    }

    public function formularioDestino(Request $request)
    {
        $f = $request->validate(['id' => ['nullable', 'uuid']]);

        return response()->json(Webhooks::formularioDestino($f['id'] ?? null, $request->user()));
    }

    public function revisarUrl(Request $request)
    {
        $d = $request->validate(['url' => ['required', 'string', 'max:500']]);

        return response()->json(Webhooks::revisarUrl($d['url']));
    }

    public function verDestino(Request $request, string $id)
    {
        return response()->json(Webhooks::verDestino($id, $request->user()));
    }

    public function crearDestino(Request $request)
    {
        $d = $request->validate([
            'name' => ['required', 'string', 'min:3', 'max:120'],
            'description' => ['nullable', 'string', 'max:500'],
            'url' => ['required', 'string', 'max:500'],
            'environment' => ['nullable', Rule::in(array_keys(Claves::ENTORNOS))],
            'events' => ['required', 'array', 'min:1', 'max:20'],
            'events.*' => ['string', 'max:60'],
            'brand_ids' => ['nullable', 'array', 'max:20'],
            'brand_ids.*' => ['uuid'],
            'customer_id' => ['nullable', 'uuid'],
            'sim_mode' => ['nullable', Rule::in(array_keys(Webhooks::SIMULADOR))],
        ], [], ['name' => 'nombre', 'url' => 'URL', 'events' => 'eventos']);

        return response()->json(Webhooks::guardarDestino(null, $d, $request->user()), 201);
    }

    public function editarDestino(Request $request, string $id)
    {
        $d = $request->validate([
            'name' => ['required', 'string', 'min:3', 'max:120'],
            'description' => ['nullable', 'string', 'max:500'],
            'url' => ['required', 'string', 'max:500'],
            'events' => ['required', 'array', 'min:1', 'max:20'],
            'events.*' => ['string', 'max:60'],
            'brand_ids' => ['nullable', 'array', 'max:20'],
            'brand_ids.*' => ['uuid'],
            'customer_id' => ['nullable', 'uuid'],
            'sim_mode' => ['nullable', Rule::in(array_keys(Webhooks::SIMULADOR))],
        ], [], ['name' => 'nombre', 'url' => 'URL', 'events' => 'eventos']);

        return response()->json(Webhooks::guardarDestino($id, $d, $request->user()));
    }

    public function estadoDestino(Request $request, string $id)
    {
        $d = $request->validate([
            'status' => ['required', Rule::in(['ACTIVE', 'PAUSED'])],
            'reason' => ['nullable', 'string', 'max:500'],
        ], [], ['status' => 'estado', 'reason' => 'motivo']);

        return response()->json(Webhooks::cambiarEstado($id, $d['status'], $d['reason'] ?? null, $request->user()));
    }

    public function rotarSecretoDestino(Request $request, string $id)
    {
        return response()->json(Webhooks::rotarSecreto($id, $request->user()));
    }

    public function probarDestino(Request $request, string $id)
    {
        return response()->json(Webhooks::enviarPrueba($id, $request->user()));
    }

    /* ------------------------------------------------------------------ API-06 y API-07 Entregas */

    public function entregas(Request $request)
    {
        $f = $request->validate([
            'estado' => ['nullable', Rule::in(array_keys(Webhooks::ESTADOS_ENTREGA))],
            'destino' => ['nullable', 'uuid'],
            'evento' => ['nullable', 'string', 'max:60'],
            'entorno' => ['nullable', Rule::in(array_keys(Claves::ENTORNOS))],
            'fecha' => ['nullable', 'date_format:Y-m-d'],
            'buscar' => ['nullable', 'string', 'max:100'],
        ]);

        return response()->json(Webhooks::listaEntregas($f, $request->user()));
    }

    public function procesarEntregas(Request $request)
    {
        $d = $request->validate([
            'all' => ['nullable', 'boolean'],
            'endpoint' => ['nullable', 'uuid'],
        ]);
        $n = Webhooks::procesarCola(['all' => ! empty($d['all']), 'endpoint' => $d['endpoint'] ?? null]);

        return response()->json(['procesadas' => $n]);
    }

    public function verEntrega(Request $request, string $id)
    {
        return response()->json(Webhooks::verEntrega($id, $request->user()));
    }

    public function intentarEntrega(Request $request, string $id)
    {
        Webhooks::intentar($id);

        return response()->json(Webhooks::verEntrega($id, $request->user()));
    }

    public function reenviarEntrega(Request $request, string $id)
    {
        return response()->json(Webhooks::reenviar($id, $request->user()));
    }

    /* ------------------------------------------------------------------ API-08 Documentación y API-09 Sandbox */

    public function documentacion(Request $request)
    {
        return response()->json(Documentacion::ver($request->getSchemeAndHttpHost()));
    }

    public function openapi(Request $request)
    {
        return response()->json(Documentacion::openapi($request->getSchemeAndHttpHost()));
    }

    public function calcularFirma(Request $request)
    {
        $d = $request->validate([
            'secret' => ['required', 'string', 'max:200'],
            't' => ['required', 'string', 'max:30'],
            'body' => ['present', 'string', 'max:20000'],
        ]);
        $v1 = Webhooks::firma($d['secret'], $d['t'], $d['body']);

        return response()->json([
            'message' => "{$d['t']}.{$d['body']}",
            'v1' => $v1,
            'header' => "GestionCarnica-Signature: t={$d['t']}, v1={$v1}",
        ]);
    }

    public function probarConsola(Request $request)
    {
        $d = $request->validate([
            'key_id' => ['nullable', 'uuid'],
            'token' => ['nullable', 'string', 'max:120'],
            'method' => ['required', Rule::in(['GET', 'POST'])],
            'path' => ['required', 'string', 'max:255'],
            'ip' => ['nullable', 'string', 'max:45'],
            'idempotency_key' => ['nullable', 'string', 'max:80'],
            'body' => ['nullable', 'array'],
        ]);

        return response()->json(Documentacion::probar($d));
    }

    public function sandbox(Request $request)
    {
        return response()->json(Sandbox::panel($request->user()));
    }

    public function reiniciarSandbox(Request $request)
    {
        return response()->json(Sandbox::reiniciar($request->user()));
    }
}
