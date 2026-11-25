<?php

namespace App\Modulos\Api\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Api\Services\Publica;
use Closure;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * La API pública v1 (/api/publica/v1). La clave ya fue revisada por el middleware «clave» (empresa, secreto, límites y
 * alcance) y queda en los atributos de la petición. Toda escritura exige Idempotency-Key (RN-API-13): repetirla con el
 * mismo cuerpo devuelve la misma respuesta sin volver a crear nada; con otro cuerpo, 409.
 */
class PublicaController extends Controller
{
    private function clave(Request $r): object
    {
        return $r->attributes->get('api_key');
    }

    private function filtros(Request $r): array
    {
        return array_map(fn ($v) => is_string($v) ? mb_substr($v, 0, 100) : null, $r->query());
    }

    public function pedidos(Request $r)
    {
        return response()->json(Publica::listarPedidos($this->clave($r), $this->filtros($r)));
    }

    public function pedido(Request $r, string $numero)
    {
        return response()->json(Publica::verPedido($this->clave($r), $numero));
    }

    public function crearPedido(Request $r)
    {
        return $this->escritura($r, fn () => [201, Publica::crearPedido($this->clave($r), $r->json()->all())]);
    }

    public function comprobantePedido(Request $r, string $numero)
    {
        return $this->escritura($r, fn () => [501, ['code' => 'RN-API-14', 'message' => 'La emisión de comprobantes por la API llega con el módulo de Comprobantes. El pedido no se modificó.']]);
    }

    public function clientes(Request $r)
    {
        return response()->json(Publica::listarClientes($this->clave($r), $this->filtros($r)));
    }

    public function crearCliente(Request $r)
    {
        return $this->escritura($r, fn () => [201, Publica::crearCliente($this->clave($r), $r->json()->all())]);
    }

    public function productos(Request $r)
    {
        return response()->json(Publica::productos($this->clave($r), $this->filtros($r)));
    }

    public function precios(Request $r)
    {
        return response()->json(Publica::precios($this->clave($r), $this->filtros($r)));
    }

    public function stock(Request $r)
    {
        return response()->json(Publica::stock($this->clave($r), $this->filtros($r)));
    }

    public function comprobantes(Request $r)
    {
        return response()->json(Publica::comprobantes($this->clave($r), $this->filtros($r)));
    }

    public function cobros(Request $r)
    {
        return response()->json(Publica::cobros($this->clave($r), $this->filtros($r)));
    }

    public function entregas(Request $r)
    {
        return response()->json(Publica::entregas($this->clave($r), $this->filtros($r)));
    }

    public function noExiste()
    {
        return response()->json(['code' => 'RN-API-15', 'message' => 'Esa operación no existe en la API v1. Revisa la documentación.'], 404);
    }

    public function version(string $version)
    {
        return response()->json(['code' => 'RN-API-15', 'message' => "La versión {$version} no existe: usa /api/publica/v1."], 404);
    }

        /** Escritura con Idempotency-Key: guarda la respuesta (también la de una regla que no se cumplió) 24 horas. */
    private function escritura(Request $r, Closure $hacer): JsonResponse
    {
        $k = $this->clave($r);
        $idem = trim((string) $r->header('Idempotency-Key'));
        if ($idem === '' || mb_strlen($idem) > 80 || ! preg_match('/^[A-Za-z0-9._:\-]+$/', $idem)) {
            return response()->json(['code' => 'RN-API-13', 'message' => 'Toda escritura exige la cabecera Idempotency-Key (hasta 80 letras, números, puntos, guiones o dos puntos).'], 422);
        }
        $huella = hash('sha256', $r->method().' '.$r->path().' '.$r->getContent());
        $previa = DB::table('api_idempotency')->where('key_id', $k->id)->where('idem_key', $idem)->where('expires_at', '>', now())->first();
        if ($previa) {
            if (! hash_equals($previa->request_hash, $huella)) {
                return response()->json(['code' => 'RN-API-13', 'message' => 'Esa Idempotency-Key ya se usó con otro contenido: usa una nueva para otra operación.'], 409);
            }
            DB::table('api_idempotency')->where('id', $previa->id)->update(['replays' => $previa->replays + 1, 'updated_at' => now()]);

            return response()->json(json_decode((string) $previa->response_body, true), $previa->response_code, ['Idempotent-Replayed' => 'true']);
        }
        try {
            [$http, $cuerpo] = $hacer();
        } catch (\App\Support\RuleError $e) {
            $extra = $e instanceof \App\Modulos\Ped\Services\Faltantes ? ['faltan' => array_column($e->faltan, 'codigo'), 'detalle' => $e->faltan] : [];
            [$http, $cuerpo] = [422, ['code' => $e->rule, 'message' => $e->getMessage()] + $extra];
        }
        try {
            DB::transaction(fn () => DB::table('api_idempotency')->insert(['key_id' => $k->id, 'idem_key' => $idem, 'request_hash' => $huella, 'response_code' => $http,
                'response_body' => json_encode($cuerpo, JSON_UNESCAPED_UNICODE), 'expires_at' => now()->addDay(), 'created_at' => now()]));
        } catch (\Illuminate\Database\UniqueConstraintViolationException) {
            // Otra llamada con la misma clave llegó primero: la respuesta que vale es la suya.
        }

        return response()->json($cuerpo, $http);
    }
}
