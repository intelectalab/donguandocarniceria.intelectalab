<?php

namespace App\Modulos\Int\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Int\Services\Webhooks;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/** INT-04 Webhooks de entrada e INT-05 Bitácora de webhooks. Reglas en Services\Webhooks. */
class WebhookController extends Controller
{
    /**
     * Receptor público: /api/hooks/{token}, sin sesión. La empresa sale del token; la firma decide si se procesa.
     * Responde rápido (el proveedor espera unos segundos) y nunca devuelve datos de la empresa.
     */
    public function recibir(Request $request, string $token)
    {
        $inicio = defined('LARAVEL_START') ? LARAVEL_START : microtime(true);
        $crudo = (string) $request->getContent();
        if (strlen($crudo) > Webhooks::MAX_CUERPO) {
            return response()->json(['status' => 'TOO_LARGE'], 413);
        }
        [$http, $cuerpo] = Webhooks::recibir($token, $crudo, $request->headers->all(), $request->ip(), $inicio);

        return response()->json($cuerpo, $http);
    }

    public function endpoints()
    {
        return response()->json(Webhooks::endpoints());
    }

    public function regenerar(Request $request, string $id)
    {
        return response()->json(Webhooks::regenerarToken($id, $request->user()));
    }

    public function secreto(Request $request, string $id)
    {
        $d = $request->validate(['secret' => ['required', 'string', 'min:8', 'max:500']], [], ['secret' => 'secreto']);

        return response()->json(Webhooks::cargarSecreto($id, $d['secret'], $request->user()));
    }

    public function eventos(Request $request)
    {
        $f = $request->validate([
            'status' => ['nullable', Rule::in(array_keys(Webhooks::ESTADOS))], 'connector' => ['nullable', 'uuid'], 'endpoint' => ['nullable', 'uuid'],
            'dia' => ['nullable', 'date_format:Y-m-d'], 'buscar' => ['nullable', 'string', 'max:100'],
        ]);

        return response()->json(Webhooks::eventos($f));
    }

    public function evento(string $id)
    {
        return response()->json(Webhooks::ver($id));
    }

    public function reprocesar(Request $request, string $id)
    {
        return response()->json(Webhooks::reprocesar($id, $request->user()));
    }
}
