<?php

namespace App\Modulos\Api\Services;

use Illuminate\Support\Facades\DB;

/**
 * API-11 Eventos y alcances: el catálogo de la plataforma. Cada evento lleva event_id, type, occurred_at, versión y su
 * contenido (RN-API-17); cada alcance habilita sus operaciones. Las rutas son las de la API v1.
 */
final class Catalogo
{
    /** Las operaciones de la API v1: [método, ruta, alcance, nombre]. */
    public const RUTAS = [
        ['GET', '/orders', 'orders:read', 'Listar pedidos'],
        ['GET', '/orders/{number}', 'orders:read', 'Ver un pedido'],
        ['POST', '/orders', 'orders:write', 'Crear pedido'],
        ['POST', '/orders/{number}/documents', 'orders:write', 'Emitir comprobante del pedido'],
        ['GET', '/customers', 'customers:read', 'Listar clientes'],
        ['POST', '/customers', 'customers:write', 'Crear cliente'],
        ['GET', '/products', 'products:read', 'Catálogo'],
        ['GET', '/prices', 'prices:read', 'Precios vigentes'],
        ['GET', '/stock', 'stock:read', 'Stock disponible'],
        ['GET', '/documents', 'documents:read', 'Comprobantes'],
        ['GET', '/payments', 'payments:read', 'Cobros'],
        ['GET', '/deliveries', 'deliveries:read', 'Entregas'],
        ['GET', '/webhook-endpoints', 'webhooks:write', 'Listar destinos de webhooks'],
        ['POST', '/webhook-endpoints', 'webhooks:write', 'Crear destino de webhooks'],
    ];

    public const MODULOS = ['PED' => 'Pedidos', 'CLI' => 'Clientes', 'CAT' => 'Catálogo', 'ALM' => 'Almacenes', 'FAC' => 'Comprobantes', 'CAJ' => 'Caja y cobros',
        'DEL' => 'Reparto', 'API' => 'API'];

    public const ESTADOS_EVENTO = ['ACTIVE' => 'Vigente', 'RETIRED' => 'Retirado'];

    private const PEDIDO = ['number' => 'P-001234', 'status' => 'CONFIRMED', 'brand' => 'DG', 'channel' => 'B2B', 'customer' => ['id' => '6f1c…', 'name' => 'Restaurante El Cuy Dorado'],
        'external_ref' => 'OC-88213', 'fulfillment' => 'DELIVERY', 'delivery_date' => '2026-12-02', 'slot' => '09:00–13:00', 'estimated_total' => 186.5, 'currency' => 'PEN',
        'lines' => [['sku' => 'DG-CUY-ENT', 'name' => 'Cuy entero', 'qty' => 2, 'price_basis' => 'UNIT', 'unit_price' => 48.0, 'est_weight_kg' => null, 'amount' => 96.0],
            ['sku' => 'DG-LOM-FIN', 'name' => 'Lomo fino', 'qty' => 1.5, 'price_basis' => 'KG', 'unit_price' => 60.33, 'est_weight_kg' => 1.5, 'amount' => 90.5]]];

    /** Ejemplo del contenido de cada evento, para la documentación. */
    public static function ejemplo(string $evento): array
    {
        $datos = match (true) {
            str_starts_with($evento, 'order.') => array_merge(self::PEDIDO, match ($evento) {
                'order.created' => ['status' => 'DRAFT'],
                'order.dispatched' => ['status' => 'DISPATCHED', 'route' => 'R-2026-12-02-01'],
                'order.delivered' => ['status' => 'DELIVERED', 'final_total' => 191.2, 'delivered_at' => '2026-12-02T11:42:00-05:00'],
                'order.not_delivered' => ['status' => 'NOT_DELIVERED', 'reason' => 'Cliente ausente'],
                'order.cancelled' => ['status' => 'CANCELLED', 'reason' => 'El cliente desistió'],
                default => [],
            }),
            str_starts_with($evento, 'document.') => ['series' => 'F001', 'number' => '00004521', 'type' => 'FACTURA', 'order' => 'P-001234', 'customer_doc' => '20601234567',
                'total' => 191.2, 'currency' => 'PEN', 'sunat_status' => $evento === 'document.accepted' ? 'ACCEPTED' : 'REJECTED',
                'sunat_message' => $evento === 'document.accepted' ? 'La factura ha sido aceptada' : 'El RUC del receptor no está activo'],
            str_starts_with($evento, 'payment.') => ['id' => '9a2e…', 'order' => 'P-001234', 'method' => 'YAPE', 'amount' => 191.2, 'currency' => 'PEN',
                'status' => $evento === 'payment.confirmed' ? 'CONFIRMED' : 'REVERSED', 'confirmed_at' => '2026-12-02T12:05:00-05:00'],
            $evento === 'stock.low' => ['sku' => 'DG-CUY-ENT', 'name' => 'Cuy entero', 'brand' => 'DG', 'available_qty' => 4, 'threshold' => 5, 'threshold_source' => 'ALM'],
            default => [],
        };

        return ['event_id' => 'evt_01JDX7K2Q8', 'type' => $evento, 'version' => 'v1', 'occurred_at' => '2026-12-02T11:42:00-05:00', 'data' => $datos];
    }

    public static function alcances(): array
    {
        $rutas = collect(self::RUTAS)->groupBy(2);

        return DB::table('api_scopes')->orderBy('sort_order')->get()->map(fn ($s) => [
            'code' => $s->code, 'name' => $s->name, 'module_code' => $s->module_code, 'modulo' => self::MODULOS[$s->module_code] ?? $s->module_code,
            'description' => $s->description, 'is_write' => (bool) $s->is_write,
            'rutas' => ($rutas[$s->code] ?? collect())->map(fn ($r) => ['metodo' => $r[0], 'ruta' => '/api/v1'.$r[1], 'nombre' => $r[3]])->values()->all(),
        ])->all();
    }

    /** API-11: eventos con su alcance, versión, ejemplo y destinos suscritos (cuando existan, tanda 3); alcances con sus rutas. */
    public static function ver(array $f): array
    {
        $q = DB::table('api_event_types as e')->join('api_scopes as s', 's.code', '=', 'e.scope_code');
        foreach (['modulo' => 'e.module_code', 'estado' => 'e.status', 'alcance' => 'e.scope_code'] as $k => $col) {
            if (! empty($f[$k])) {
                $q->where($col, $f[$k]);
            }
        }
        $t = trim((string) ($f['buscar'] ?? ''));
        if (mb_strlen($t) >= 2) {
            $p = '%'.addcslashes($t, '%_\\').'%';
            $q->where(fn ($w) => $w->where('e.code', 'ilike', $p)->orWhere('e.description', 'ilike', $p));
        }
        $eventos = $q->orderBy('e.sort_order')->get(['e.*', 's.name as alcance'])->map(fn ($e) => [
            'code' => $e->code, 'module_code' => $e->module_code, 'modulo' => self::MODULOS[$e->module_code] ?? $e->module_code, 'scope_code' => $e->scope_code, 'alcance' => $e->alcance,
            'description' => $e->description, 'version' => $e->version, 'status' => $e->status, 'estado' => self::ESTADOS_EVENTO[$e->status] ?? $e->status, 'retired_at' => $e->retired_at,
            'ejemplo' => self::ejemplo($e->code),
        ])->all();
        $mods = DB::table('api_event_types')->distinct()->orderBy('module_code')->pluck('module_code');

        return [
            'eventos' => $eventos, 'alcances' => self::alcances(),
            'opciones' => [
                'modulos' => $mods->map(fn ($m) => ['value' => $m, 'label' => self::MODULOS[$m] ?? $m])->all(),
                'estados' => collect(self::ESTADOS_EVENTO)->map(fn ($l, $k) => ['value' => $k, 'label' => $l])->values()->all(),
                'alcances' => DB::table('api_scopes')->orderBy('sort_order')->get(['code', 'name'])->map(fn ($s) => ['value' => $s->code, 'label' => "{$s->name} ({$s->code})"])->all(),
            ],
            'firma' => ['cabecera' => 'GestionCarnica-Signature', 'formato' => 't=<segundos>,v1=<HMAC-SHA256 hex de "t.cuerpo">', 'reintentos' => [1, 5, 30, 120, 360, 720, 1440]],
        ];
    }
}
