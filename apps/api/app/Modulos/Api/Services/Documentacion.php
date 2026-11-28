<?php

namespace App\Modulos\Api\Services;

use App\Modulos\Api\Http\Middleware\ClavePublica;
use App\Support\Params;
use App\Support\RuleError;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\RateLimiter;

/**
 * API-08 Documentación (RN-API-07, 13, 15, 17 y 18; CA-API-06).
 *
 *  - Especificación OpenAPI 3.0.3 generada a partir de las operaciones de /api/publica/v1 y los alcances del catálogo,
 *    con ejemplos ejecutados sobre el sandbox emparejado (sin registrar uso).
 *  - Tabla de códigos de error HTTP y reglas de negocio (RN-API-18).
 *  - Guía y calculadora de firma de webhooks (GestionCarnica-Signature: t=…, v1=…) con ejemplos en Node.js y PHP.
 *  - Consola de prueba integrada para invocar /api/publica/v1 desde la interfaz (API-03, API-08 y API-09) con cualquier
 *    clave activa de la empresa o con un token completo pegado por el usuario.
 */
final class Documentacion
{
    public const OPERACIONES = [
        [
            'method' => 'GET',
            'path' => '/orders',
            'scope' => 'orders:read',
            'write' => false,
            'name' => 'Listar pedidos',
            'description' => 'Devuelve los pedidos confirmados, en ruta o entregados de las marcas permitidas por la clave.',
            'params' => [
                ['name' => 'status', 'in' => 'query', 'description' => 'Estado (CONFIRMED, IN_ROUTE, DELIVERED…)'],
                ['name' => 'from', 'in' => 'query', 'description' => 'Fecha de entrega desde (AAAA-MM-DD)'],
                ['name' => 'limit', 'in' => 'query', 'description' => 'Máximo 100, por defecto 20'],
            ],
        ],
        [
            'method' => 'GET',
            'path' => '/orders/{number}',
            'scope' => 'orders:read',
            'write' => false,
            'name' => 'Ver un pedido',
            'description' => 'Detalle de un pedido por su número, con sus líneas, pesos estimados o pesados e importes.',
            'params' => [
                ['name' => 'number', 'in' => 'path', 'description' => 'Número del pedido (ej. P-000120 o SBX-000001)'],
            ],
        ],
        [
            'method' => 'POST',
            'path' => '/orders',
            'scope' => 'orders:write',
            'write' => true,
            'name' => 'Crear pedido',
            'description' => 'Crea y confirma un pedido con las reglas de Pedidos: datos obligatorios, precio vigente del canal de la clave y peso estimado en productos de peso variable. Guarda la clave que lo creó.',
            'params' => [],
        ],
        [
            'method' => 'POST',
            'path' => '/orders/{number}/documents',
            'scope' => 'orders:write',
            'write' => true,
            'name' => 'Emitir comprobante del pedido',
            'description' => 'En producción, solo para pedidos entregados; en el sandbox va al OSE FAKE y queda aceptado al instante sin tocar SUNAT.',
            'params' => [
                ['name' => 'number', 'in' => 'path', 'description' => 'Número del pedido'],
            ],
        ],
        [
            'method' => 'GET',
            'path' => '/customers',
            'scope' => 'customers:read',
            'write' => false,
            'name' => 'Listar clientes',
            'description' => 'Clientes activos con su documento, contacto y direcciones de entrega.',
            'params' => [
                ['name' => 'q', 'in' => 'query', 'description' => 'Texto: nombre, documento o celular'],
                ['name' => 'limit', 'in' => 'query', 'description' => 'Máximo 100'],
            ],
        ],
        [
            'method' => 'POST',
            'path' => '/customers',
            'scope' => 'customers:write',
            'write' => true,
            'name' => 'Crear cliente',
            'description' => 'Registra un cliente nuevo validando RUC (11 dígitos con dígito verificador) o DNI (8 dígitos).',
            'params' => [],
        ],
        [
            'method' => 'GET',
            'path' => '/products',
            'scope' => 'products:read',
            'write' => false,
            'name' => 'Catálogo',
            'description' => 'Presentaciones vendibles de las marcas de la clave: SKU, modo de venta y peso nominal.',
            'params' => [
                ['name' => 'brand', 'in' => 'query', 'description' => 'Código de marca (DG, M2…)'],
                ['name' => 'limit', 'in' => 'query', 'description' => 'Máximo 100'],
            ],
        ],
        [
            'method' => 'GET',
            'path' => '/prices',
            'scope' => 'prices:read',
            'write' => false,
            'name' => 'Precios vigentes',
            'description' => 'Precio vigente con IGV de la lista que corresponde al canal y tipo de cliente de la clave.',
            'params' => [
                ['name' => 'sku', 'in' => 'query', 'description' => 'Filtrar por un SKU'],
                ['name' => 'limit', 'in' => 'query', 'description' => 'Máximo 100'],
            ],
        ],
        [
            'method' => 'GET',
            'path' => '/stock',
            'scope' => 'stock:read',
            'write' => false,
            'name' => 'Stock disponible',
            'description' => 'Disponible por SKU en los almacenes que permiten venta (descontando reservas).',
            'params' => [
                ['name' => 'sku', 'in' => 'query', 'description' => 'Filtrar por un SKU'],
                ['name' => 'limit', 'in' => 'query', 'description' => 'Máximo 100'],
            ],
        ],
        [
            'method' => 'GET',
            'path' => '/documents',
            'scope' => 'documents:read',
            'write' => false,
            'name' => 'Comprobantes',
            'description' => 'Facturas, boletas y notas emitidas con sus montos y estado SUNAT.',
            'params' => [
                ['name' => 'from', 'in' => 'query', 'description' => 'Emitidos desde (AAAA-MM-DD)'],
                ['name' => 'status', 'in' => 'query', 'description' => 'Estado SUNAT (ACCEPTED, PENDING…)'],
                ['name' => 'limit', 'in' => 'query', 'description' => 'Máximo 100'],
            ],
        ],
        [
            'method' => 'GET',
            'path' => '/payments',
            'scope' => 'payments:read',
            'write' => false,
            'name' => 'Cobros',
            'description' => 'Cobros registrados con su medio de pago, referencia e importe.',
            'params' => [
                ['name' => 'from', 'in' => 'query', 'description' => 'Desde (AAAA-MM-DD)'],
                ['name' => 'limit', 'in' => 'query', 'description' => 'Máximo 100'],
            ],
        ],
        [
            'method' => 'GET',
            'path' => '/deliveries',
            'scope' => 'deliveries:read',
            'write' => false,
            'name' => 'Entregas',
            'description' => 'Paradas de reparto y estado de entrega de los pedidos en la fecha consultada.',
            'params' => [
                ['name' => 'date', 'in' => 'query', 'description' => 'Fecha de entrega (por defecto hoy)'],
            ],
        ],
        [
            'method' => 'GET',
            'path' => '/webhook-endpoints',
            'scope' => 'webhooks:write',
            'write' => false,
            'name' => 'Listar destinos de webhooks',
            'description' => 'Destinos de webhooks configurados en el mismo entorno de la clave.',
            'params' => [],
        ],
        [
            'method' => 'POST',
            'path' => '/webhook-endpoints',
            'scope' => 'webhooks:write',
            'write' => true,
            'name' => 'Crear destino de webhooks',
            'description' => 'Registra un destino https para recibir eventos firmados y devuelve su secreto una sola vez.',
            'params' => [],
        ],
    ];

    public const ERRORES = [
        ['http' => 400, 'code' => '—', 'when' => 'Cuerpo que no es JSON válido'],
        ['http' => 401, 'code' => 'RN-API-11 · RN-API-10 · RN-API-02', 'when' => 'Clave inválida, revocada o vencida'],
        ['http' => 403, 'code' => 'RN-API-03 · RN-PLT-07 · RN-API-11', 'when' => 'Sin alcance, módulo apagado, IP no permitida o marca fuera de la clave'],
        ['http' => 404, 'code' => 'RN-API-15 · RN-API-16', 'when' => 'Ruta, versión o recurso inexistente (o pedido de otro entorno)'],
        ['http' => 409, 'code' => 'RN-API-13', 'when' => 'Idempotency-Key reutilizada con otro cuerpo'],
        ['http' => 422, 'code' => 'RN-PED-01 · RN-PED-02 · RN-CAT-05 · RN-API-13 · RN-API-14', 'when' => 'Regla de negocio: faltan datos obligatorios, SKU inválido, sin precio o sin Idempotency-Key'],
        ['http' => 429, 'code' => 'RN-API-09', 'when' => 'Límite del día o ráfaga por minuto superados; respeta la cabecera Retry-After'],
    ];

    /** Ejemplo ejecutado sobre el sandbox para cada ruta (sin registrar uso). */
    public static function ejemploOperacion(array $op): array
    {
        $sbx = Sandbox::panel();
        $pedido0 = $sbx['orders'][count($sbx['orders']) - 1] ?? ($sbx['orders'][0] ?? ['number' => 'SBX-000001']);
        $claveFalsa = (object) [
            'prefix' => 'ak_test_docs0000',
            'environment' => 'TEST',
            'scopes' => '["orders:read","orders:write","customers:read","customers:write","products:read","prices:read","stock:read","documents:read","payments:read","deliveries:read","webhooks:write"]',
            'brand_ids' => '[]',
            'customer_id' => null,
            'channel' => 'B2B',
        ];
        $req = null;
        if ($op['write']) {
            $req = match ($op['path']) {
                '/orders' => Sandbox::ejemploCuerpoPedido(),
                '/customers' => ['doc_type' => 'RUC', 'doc_number' => '20601234567', 'name' => 'PARRILLA EL BUEN CORTE SAC', 'phone' => '+51987654321'],
                '/webhook-endpoints' => ['name' => 'Receptor ERP', 'url' => 'https://erp.cliente.pe/hooks/gestioncarnica', 'events' => ['order.delivered']],
                default => [],
            };
        }
        $res = match ($op['method'].' '.$op['path']) {
            'GET /orders' => Sandbox::listarPedidos($claveFalsa, ['limit' => 2]),
            'GET /orders/{number}' => Sandbox::verPedido($claveFalsa, $pedido0['number']),
            'POST /orders' => ['number' => 'SBX-000006', 'status' => 'CONFIRMED', 'external_ref' => $req['external_ref'] ?? 'OC-DEMO-0001', 'api_key' => 'ak_test_xxxxxxxx', 'sandbox' => true] + $pedido0,
            'POST /orders/{number}/documents' => ($sbx['documents'][0] ?? ['full_number' => 'F001-00000001', 'doc_type' => 'INVOICE', 'sunat_status' => 'ACCEPTED', 'ose' => 'FAKE', 'sent_to_sunat' => false]) + ['sandbox' => true],
            'GET /customers' => Sandbox::listarClientes($claveFalsa, ['limit' => 2]),
            'POST /customers' => ['id' => 'sbx-cu-4', 'doc_type' => 'RUC', 'doc_number' => '20601234567', 'name' => 'PARRILLA EL BUEN CORTE SAC', 'status' => 'ACTIVE', 'sandbox' => true],
            'GET /products' => Sandbox::productos($claveFalsa, ['limit' => 2]),
            'GET /prices' => Sandbox::precios($claveFalsa, ['limit' => 2]),
            'GET /stock' => Sandbox::stock($claveFalsa, ['limit' => 2]),
            'GET /documents' => Sandbox::comprobantes($claveFalsa, ['limit' => 2]),
            'GET /payments' => Sandbox::cobros($claveFalsa, ['limit' => 2]),
            'GET /deliveries' => Sandbox::entregas($claveFalsa, []),
            'GET /webhook-endpoints' => ['data' => [['id' => '019a2f00-…', 'name' => 'Sandbox · webhook.site', 'url' => 'https://webhook.site/7d1c2e9a-…', 'events' => ['order.created', 'document.accepted'], 'status' => 'ACTIVE', 'failure_streak' => 0]]],
            'POST /webhook-endpoints' => ['id' => '019a2f01-…', 'name' => 'Receptor ERP', 'url' => 'https://erp.cliente.pe/hooks/gestioncarnica', 'events' => ['order.delivered'], 'secret' => 'whsec_… (se muestra una sola vez)'],
            default => [],
        };

        return ['req' => $req, 'res' => $res];
    }

    /** Especificación OpenAPI 3.0.3 completa para ver y descargar en API-08. */
    public static function openapi(string $baseUrl = 'https://gestioncarnica.intelectalab.com'): array
    {
        $mesesAviso = (int) (Params::get('api_version_deprecation_months') ?? 12);
        $paths = [];
        foreach (self::OPERACIONES as $op) {
            $ej = self::ejemploOperacion($op);
            $parametros = array_map(fn ($p) => [
                'name' => $p['name'],
                'in' => $p['in'],
                'required' => $p['in'] === 'path',
                'description' => $p['description'],
                'schema' => ['type' => 'string'],
            ], $op['params']);
            if ($op['write']) {
                $parametros[] = [
                    'name' => 'Idempotency-Key',
                    'in' => 'header',
                    'required' => true,
                    'description' => 'Clave única de la operación (hasta 80 caracteres) para evitar duplicados en reintentos.',
                    'schema' => ['type' => 'string'],
                ];
            }
            $respuestas = [
                (string) ($op['write'] ? 201 : 200) => [
                    'description' => 'Correcto',
                    'content' => ['application/json' => ['example' => $ej['res']]],
                ],
            ];
            foreach (self::ERRORES as $err) {
                $c = $err['http'];
                if ($c !== 400 && ($op['write'] || ! in_array($c, [409, 422], true) || ($c === 422 && str_contains($op['path'], '{')))) {
                    $respuestas[(string) $c] = [
                        'description' => "{$err['when']} ({$err['code']})",
                        'content' => ['application/json' => ['schema' => ['$ref' => '#/components/schemas/Error']]],
                    ];
                }
            }
            $item = [
                'summary' => $op['name'],
                'description' => $op['description']." Alcance requerido: {$op['scope']}.",
                'tags' => [explode(':', $op['scope'])[0]],
                'x-scope' => $op['scope'],
                'security' => [['bearerAuth' => []]],
                'parameters' => $parametros,
                'responses' => $respuestas,
            ];
            if ($op['write']) {
                $item['requestBody'] = [
                    'required' => true,
                    'content' => ['application/json' => ['example' => $ej['req']]],
                ];
            }
            $paths['/api/publica/v1'.$op['path']][strtolower($op['method'])] = $item;
        }

        $eventos = DB::table('api_event_types')->where('status', 'ACTIVE')->orderBy('sort_order')->get(['code', 'scope_code', 'version', 'description'])
            ->map(fn ($e) => ['type' => $e->code, 'scope' => $e->scope_code, 'version' => $e->version, 'description' => $e->description])->all();

        return [
            'openapi' => '3.0.3',
            'info' => [
                'title' => 'GestionCarnica API',
                'version' => 'v1',
                'description' => "API pública de GestionCarnica. Versión en la ruta (/api/publica/v1); los cambios incompatibles salen en una versión nueva y la anterior se retira con {$mesesAviso} meses de aviso.",
            ],
            'servers' => [
                ['url' => rtrim($baseUrl, '/').'/api/publica/v1', 'description' => 'Producción (ak_live_)'],
                ['url' => Sandbox::HOST.'/api/publica/v1', 'description' => 'Sandbox (ak_test_)'],
            ],
            'paths' => $paths,
            'components' => [
                'securitySchemes' => [
                    'bearerAuth' => [
                        'type' => 'http',
                        'scheme' => 'bearer',
                        'bearerFormat' => 'ak_live_xxxxxxxx_secreto',
                    ],
                ],
                'schemas' => [
                    'Error' => [
                        'type' => 'object',
                        'required' => ['code', 'message'],
                        'properties' => [
                            'code' => ['type' => 'string', 'example' => 'RN-PED-01'],
                            'message' => ['type' => 'string', 'example' => 'Faltan datos obligatorios: DIRECCION_CON_PIN.'],
                        ],
                    ],
                ],
            ],
            'x-webhooks' => $eventos,
        ];
    }

    /** Datos completos para la pantalla API-08 Documentación. */
    public static function ver(string $baseUrl = 'https://gestioncarnica.intelectalab.com'): array
    {
        $tolerancia = (int) (Params::get('api_signature_tolerance_seconds') ?? 300);
        $mesesAviso = (int) (Params::get('api_version_deprecation_months') ?? 12);
        $operaciones = array_map(fn ($op) => $op + ['ejemplo' => self::ejemploOperacion($op)], self::OPERACIONES);
        $claves = DB::table('api_keys')->orderByDesc('created_at')->get()
            ->map(function ($k) {
                $est = Claves::estado($k);

                return [
                    'id' => $k->id,
                    'name' => $k->name,
                    'prefix' => $k->prefix,
                    'environment' => $k->environment,
                    'entorno' => Claves::ENTORNOS[$k->environment] ?? $k->environment,
                    'status' => $est,
                    'estado' => Claves::ESTADOS[$est] ?? $est,
                    'scopes' => json_decode((string) $k->scopes, true) ?: [],
                ];
            })->all();

        $secretoEjemplo = 'whsec_prueba';
        $tEjemplo = '1760090400';
        $cuerpoEjemplo = '{"id":1}';

        return [
            'base_produccion' => rtrim($baseUrl, '/').'/api/publica/v1',
            'base_sandbox' => Sandbox::HOST.'/api/publica/v1',
            'meses_aviso' => $mesesAviso,
            'tolerancia_firma_s' => $tolerancia,
            'operaciones' => $operaciones,
            'errores' => self::ERRORES,
            'claves' => $claves,
            'firma_ejemplo' => [
                'secret' => $secretoEjemplo,
                't' => $tEjemplo,
                'body' => $cuerpoEjemplo,
                'v1' => Webhooks::firma($secretoEjemplo, $tEjemplo, $cuerpoEjemplo),
                'header' => "GestionCarnica-Signature: t={$tEjemplo}, v1=".Webhooks::firma($secretoEjemplo, $tEjemplo, $cuerpoEjemplo),
            ],
            'openapi' => self::openapi($baseUrl),
        ];
    }

    /**
     * Consola de prueba integrada (usada en API-08 y API-09): permite probar cualquier operación de /api/publica/v1
     * eligiendo una clave de la empresa (por su key_id) o pegando un token completo, respetando todas las reglas
     * (estado de la clave, IP permitida, límites por minuto y día, alcances e Idempotency-Key) y registrando el uso.
     */
    public static function probar(array $d): array
    {
        $inicio = microtime(true);
        $reqId = 'req_'.bin2hex(random_bytes(8));
        $metodo = strtoupper(trim((string) ($d['method'] ?? 'GET')));
        $rutaCruda = trim((string) ($d['path'] ?? '/orders'));
        $ip = trim((string) ($d['ip'] ?? '181.65.70.12')) ?: '181.65.70.12';
        $idem = trim((string) ($d['idempotency_key'] ?? ''));
        $cuerpo = is_array($d['body'] ?? null) ? $d['body'] : [];

        [$soloRuta, $qs] = array_pad(explode('?', $rutaCruda, 2), 2, '');
        $soloRuta = '/'.ltrim((string) preg_replace('#^/api/(publica/)?v1#', '', $soloRuta), '/');
        parse_str((string) $qs, $query);

        $k = null;
        if (! empty($d['token'])) {
            $token = trim((string) preg_replace('/^Bearer\s+/i', '', (string) $d['token']));
            if (! preg_match('/^(ak_(live|test)_[a-z0-9]{8})_([A-Za-z0-9]{40})$/', $token, $m)) {
                return self::respuestaConsola(401, ['code' => 'RN-API-11', 'message' => 'Falta la clave o no tiene el formato. Envía Authorization: Bearer ak_live_…'], $reqId, $inicio, $metodo, $soloRuta, $qs, 'ak_live_????', $idem, $cuerpo);
            }
            $k = DB::table('api_keys')->where('prefix', $m[1])->first();
            if (! $k || ! hash_equals((string) $k->secret_hash, hash('sha256', $m[3]))) {
                return self::respuestaConsola(401, ['code' => 'RN-API-11', 'message' => 'La clave no existe o el secreto no corresponde.'], $reqId, $inicio, $metodo, $soloRuta, $qs, $m[1], $idem, $cuerpo);
            }
        } elseif (! empty($d['key_id'])) {
            $k = DB::table('api_keys')->where('id', $d['key_id'])->first();
        }
        if (! $k) {
            return self::respuestaConsola(401, ['code' => 'RN-API-11', 'message' => 'Selecciona una clave o pega un token completo.'], $reqId, $inicio, $metodo, $soloRuta, $qs, 'ak_live_????', $idem, $cuerpo);
        }

        $estado = Claves::estado($k);
        if ($estado === 'REVOKED') {
            return self::registrarYResponder($k, 401, ['code' => 'RN-API-10', 'message' => "La clave {$k->prefix} está revocada."], $reqId, $inicio, $metodo, $soloRuta, $qs, $ip, $idem, $cuerpo);
        }
        if ($estado === 'EXPIRED') {
            return self::registrarYResponder($k, 401, ['code' => 'RN-API-02', 'message' => "La clave {$k->prefix} venció el ".date('d/m/Y', strtotime($k->expires_at)).'.'], $reqId, $inicio, $metodo, $soloRuta, $qs, $ip, $idem, $cuerpo);
        }
        $ips = json_decode((string) $k->allowed_ips, true) ?: [];
        if ($ips && ! array_filter($ips, fn ($r) => ClavePublica::ipEn($ip, $r))) {
            return self::registrarYResponder($k, 403, ['code' => 'RN-API-11', 'message' => "La IP {$ip} no está en la lista permitida de la clave."], $reqId, $inicio, $metodo, $soloRuta, $qs, $ip, $idem, $cuerpo);
        }
        $porMinuto = max(1, (int) (Params::get('api_rate_limit_per_minute') ?? 120));
        $balde = "api-clave:{$k->id}";
        if (RateLimiter::tooManyAttempts($balde, $porMinuto)) {
            return self::registrarYResponder($k, 429, ['code' => 'RN-API-09', 'message' => "Superaste las {$porMinuto} llamadas por minuto de la clave."], $reqId, $inicio, $metodo, $soloRuta, $qs, $ip, $idem, $cuerpo, ['Retry-After' => (string) RateLimiter::availableIn($balde)]);
        }
        $porDia = Params::get('api_calls_per_day');
        if ($porDia !== null && (int) $porDia > 0 && Uso::delDia($k->environment) >= (int) $porDia) {
            return self::registrarYResponder($k, 429, ['code' => 'RN-API-09', 'message' => 'Llegaste al límite de '.number_format((int) $porDia, 0, ',', ' ').' llamadas del día de tu empresa.'], $reqId, $inicio, $metodo, $soloRuta, $qs, $ip, $idem, $cuerpo, ['Retry-After' => '3600']);
        }
        RateLimiter::hit($balde, 60);

        // Resolver operación
        [$alcance, $esEscritura, $ejecutar, $patronRuta] = self::resolverOperacion($metodo, $soloRuta, $k, $query, $cuerpo);
        if (! $alcance) {
            return self::registrarYResponder($k, 404, ['code' => 'RN-API-15', 'message' => "No existe {$metodo} /api/publica/v1{$soloRuta}."], $reqId, $inicio, $metodo, $soloRuta, $qs, $ip, $idem, $cuerpo, [], $patronRuta);
        }
        if (! in_array($alcance, json_decode((string) $k->scopes, true) ?: [], true)) {
            return self::registrarYResponder($k, 403, ['code' => 'RN-API-03', 'message' => "La clave no tiene el alcance {$alcance}."], $reqId, $inicio, $metodo, $soloRuta, $qs, $ip, $idem, $cuerpo, [], $patronRuta);
        }

        if ($esEscritura) {
            if ($idem === '' || mb_strlen($idem) > 80 || ! preg_match('/^[A-Za-z0-9._:\-]+$/', $idem)) {
                return self::registrarYResponder($k, 422, ['code' => 'RN-API-13', 'message' => 'Toda escritura exige la cabecera Idempotency-Key.'], $reqId, $inicio, $metodo, $soloRuta, $qs, $ip, $idem, $cuerpo, [], $patronRuta);
            }
            $huella = hash('sha256', $metodo.' '.$soloRuta.' '.json_encode($cuerpo));
            $previa = DB::table('api_idempotency')->where('key_id', $k->id)->where('idem_key', $idem)->where('expires_at', '>', now())->first();
            if ($previa) {
                if (! hash_equals($previa->request_hash, $huella)) {
                    return self::registrarYResponder($k, 409, ['code' => 'RN-API-13', 'message' => 'Esa Idempotency-Key ya se usó con otro contenido.'], $reqId, $inicio, $metodo, $soloRuta, $qs, $ip, $idem, $cuerpo, [], $patronRuta);
                }
                DB::table('api_idempotency')->where('id', $previa->id)->update(['replays' => $previa->replays + 1, 'updated_at' => now()]);

                return self::registrarYResponder($k, (int) $previa->response_code, json_decode((string) $previa->response_body, true) ?: [], $reqId, $inicio, $metodo, $soloRuta, $qs, $ip, $idem, $cuerpo, ['Idempotent-Replayed' => 'true'], $patronRuta);
            }
        }

        try {
            $res = $ejecutar();
            $http = $esEscritura ? 201 : 200;
        } catch (RuleError $e) {
            $http = 422;
            $res = ['code' => $e->rule, 'message' => $e->getMessage()];
        } catch (\Symfony\Component\HttpKernel\Exception\HttpException $e) {
            $http = $e->getStatusCode();
            $resp = $e->getResponse();
            $res = $resp ? (json_decode((string) $resp->getContent(), true) ?: ['code' => 'RN-API-15', 'message' => 'No encontrado.']) : ['code' => 'RN-API-15', 'message' => $e->getMessage()];
        }

        if ($esEscritura) {
            try {
                $huella = hash('sha256', $metodo.' '.$soloRuta.' '.json_encode($cuerpo));
                DB::table('api_idempotency')->insert([
                    'key_id' => $k->id,
                    'idem_key' => $idem,
                    'request_hash' => $huella,
                    'response_code' => $http,
                    'response_body' => json_encode($res, JSON_UNESCAPED_UNICODE),
                    'expires_at' => now()->addDay(),
                    'created_at' => now(),
                ]);
            } catch (\Throwable) {
            }
        }

        return self::registrarYResponder($k, $http, $res, $reqId, $inicio, $metodo, $soloRuta, $qs, $ip, $idem, $cuerpo, [], $patronRuta);
    }

    private static function resolverOperacion(string $metodo, string $ruta, object $k, array $q, array $b): array
    {
        if ($metodo === 'GET' && $ruta === '/orders') {
            return ['orders:read', false, fn () => Publica::listarPedidos($k, $q), 'GET /orders'];
        }
        if ($metodo === 'POST' && $ruta === '/orders') {
            return ['orders:write', true, fn () => Publica::crearPedido($k, $b), 'POST /orders'];
        }
        if ($metodo === 'GET' && preg_match('#^/orders/([A-Za-z0-9\-]{1,30})$#', $ruta, $m)) {
            return ['orders:read', false, fn () => Publica::verPedido($k, $m[1]), 'GET /orders/{number}'];
        }
        if ($metodo === 'POST' && preg_match('#^/orders/([A-Za-z0-9\-]{1,30})/documents$#', $ruta, $m)) {
            return ['orders:write', true, fn () => Publica::emitirComprobante($k, $m[1]), 'POST /orders/{number}/documents'];
        }
        if ($metodo === 'GET' && $ruta === '/customers') {
            return ['customers:read', false, fn () => Publica::listarClientes($k, $q), 'GET /customers'];
        }
        if ($metodo === 'POST' && $ruta === '/customers') {
            return ['customers:write', true, fn () => Publica::crearCliente($k, $b), 'POST /customers'];
        }
        if ($metodo === 'GET' && $ruta === '/products') {
            return ['products:read', false, fn () => Publica::productos($k, $q), 'GET /products'];
        }
        if ($metodo === 'GET' && $ruta === '/prices') {
            return ['prices:read', false, fn () => Publica::precios($k, $q), 'GET /prices'];
        }
        if ($metodo === 'GET' && $ruta === '/stock') {
            return ['stock:read', false, fn () => Publica::stock($k, $q), 'GET /stock'];
        }
        if ($metodo === 'GET' && $ruta === '/documents') {
            return ['documents:read', false, fn () => Publica::comprobantes($k, $q), 'GET /documents'];
        }
        if ($metodo === 'GET' && $ruta === '/payments') {
            return ['payments:read', false, fn () => Publica::cobros($k, $q), 'GET /payments'];
        }
        if ($metodo === 'GET' && $ruta === '/deliveries') {
            return ['deliveries:read', false, fn () => Publica::entregas($k, $q), 'GET /deliveries'];
        }
        if ($metodo === 'GET' && $ruta === '/webhook-endpoints') {
            return ['webhooks:write', false, fn () => Publica::listarDestinosWebhook($k), 'GET /webhook-endpoints'];
        }
        if ($metodo === 'POST' && $ruta === '/webhook-endpoints') {
            return ['webhooks:write', true, fn () => Publica::crearDestinoWebhook($k, $b), 'POST /webhook-endpoints'];
        }

        return [null, false, null, "{$metodo} {$ruta}"];
    }

    private static function registrarYResponder(object $k, int $http, array $cuerpo, string $reqId, float $inicio, string $metodo, string $soloRuta, string $qs, string $ip, string $idem, array $reqBody, array $extraHeaders = [], ?string $patronRuta = null): array
    {
        $ms = max(1, (int) round((microtime(true) - $inicio) * 1000));
        $req = Request::create('/api/publica/v1'.$soloRuta.($qs ? "?{$qs}" : ''), $metodo, [], [], [], ['REMOTE_ADDR' => $ip]);
        $resp = response()->json($cuerpo, $http, $extraHeaders);
        Uso::registrar($k, $req, $resp, $patronRuta ?? "{$metodo} {$soloRuta}", $ms, $reqId);

        return self::respuestaConsola($http, $cuerpo, $reqId, $inicio, $metodo, $soloRuta, $qs, $k->prefix, $idem, $reqBody, $extraHeaders);
    }

    private static function respuestaConsola(int $http, array $cuerpo, string $reqId, float $inicio, string $metodo, string $soloRuta, string $qs, string $prefijo, string $idem, array $reqBody, array $extraHeaders = []): array
    {
        $ms = max(1, (int) round((microtime(true) - $inicio) * 1000));
        $cabeceras = [
            'Content-Type' => 'application/json',
            'X-Request-Id' => $reqId,
            'GestionCarnica-Api-Version' => 'v1',
        ] + $extraHeaders;
        $host = str_starts_with($prefijo, 'ak_test_') ? Sandbox::HOST : 'https://gestioncarnica.intelectalab.com';
        $rutaCompleta = '/api/publica/v1'.$soloRuta.($qs ? "?{$qs}" : '');
        $curl = "curl -X {$metodo} '{$host}{$rutaCompleta}' \\\n  -H 'Authorization: Bearer {$prefijo}_••••' \\\n  -H 'Content-Type: application/json'";
        if ($idem !== '') {
            $curl .= " \\\n  -H 'Idempotency-Key: {$idem}'";
        }
        if ($metodo === 'POST' && $reqBody) {
            $curl .= " \\\n  -d '".json_encode($reqBody, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)."'";
        }

        return [
            'status' => $http,
            'ms' => $ms,
            'headers' => $cabeceras,
            'body' => $cuerpo,
            'curl' => $curl,
            'replayed' => ($extraHeaders['Idempotent-Replayed'] ?? '') === 'true',
        ];
    }
}
