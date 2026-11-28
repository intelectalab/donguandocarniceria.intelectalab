<?php

namespace App\Modulos\Web\Services;

use App\Models\User;
use App\Modulos\Int\Services\Webhooks;
use App\Modulos\Web\Services\Proveedores\WooCommerce;
use App\Support\Events;
use App\Support\RuleError;
use App\Support\TenantContext;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Simuladores de WEB-04 (pedido de WooCommerce) y WEB-06 (pago de Mercado Pago), solo con conectores de prueba
 * (SANDBOX o FAKE, RN-INT-01). El cuerpo se firma con el secreto del endpoint y entra por el receptor de INT
 * (/api/hooks/{token}), igual que un webhook real: INT guarda el crudo, valida la firma y deduplica; WEB lo procesa.
 */
final class Simulador
{
    public const PLANTILLAS = ['normal' => 'Pedido completo (cliente con pin)', 'sku' => 'SKU sin mapeo (DG-CUY-ENT-XL)', 'phone' => 'Celular inválido',
        'nopin' => 'Dirección nueva sin pin', 'mixed' => 'Carrito con dos marcas (D-WEB-01)'];

    /** El conector de la tienda, que debe ser de prueba. */
    public static function conectorDePrueba(object $s, string $columna, string $nombre): object
    {
        $c = $s->{$columna} ? DB::table('integration_connectors')->where('id', $s->{$columna})->first() : null;
        if (! $c) {
            RuleError::fail('RN-WEB-10', "{$s->name} no tiene conector de {$nombre}.");
        }
        if (! ($c->environment === 'SANDBOX' || $c->adapter === 'FAKE')) {
            RuleError::fail('RN-INT-01', "El simulador solo usa conectores de prueba: el conector de {$nombre} de {$s->name} es de producción.");
        }

        return $c;
    }

    /**
     * Envía el cuerpo al endpoint del conector como lo haría el proveedor. $entregas: un id de entrega por envío
     * (WooCommerce manda uno nuevo en cada reintento); null = sin cabecera (la clave sale del cuerpo).
     *
     * @return list<array{envio: int, http: int, status: string, duplicate: bool}>
     */
    public static function enviar(object $c, string $cuerpo, array $entregas, bool $firmaValida, User $u): array
    {
        $ep = DB::table('webhook_endpoints')->where('connector_id', $c->id)->where('status', 'ACTIVE')->orderBy('name')->first();
        if (! $ep) {
            RuleError::fail('RN-WEB-10', "El conector {$c->name} no tiene un endpoint de webhook activo en Integraciones (INT-04).");
        }
        if (! str_starts_with((string) $ep->secret_enc, 'enc:v2:')) {
            // Endpoint de prueba sin secreto cargado: se genera uno, como hace el simulador de INT.
            DB::table('webhook_endpoints')->where('id', $ep->id)->update(['secret_enc' => 'enc:v2:'.Crypt::encryptString('sim_'.Str::random(40)), 'secret_loaded_at' => now(), 'updated_at' => now()]);
            Events::emit('webhook_endpoint.secret_loaded', 'webhook_endpoints', $ep->id, ['by' => $u->id, 'name' => $ep->name, 'value' => 'generado por el simulador de WEB']);
            $ep = DB::table('webhook_endpoints')->where('id', $ep->id)->first();
        }
        $secreto = Crypt::decryptString(substr($ep->secret_enc, 7));
        $firma = $firmaValida ? base64_encode(hash_hmac('sha256', $cuerpo, $secreto, true)) : base64_encode(str_repeat("\0", 32));
        $empresa = TenantContext::tenant();
        $out = [];
        try {
            foreach ($entregas as $k => $entrega) {
                $cab = ['content-type' => ['application/json'], 'x-wc-webhook-signature' => [$firma], 'user-agent' => ['Simulador de WEB']];
                if ($entrega !== null && $entrega !== '') {
                    $cab['x-wc-webhook-delivery-id'] = [(string) $entrega];
                }
                [$http, $r] = Webhooks::recibir($ep->token, $cuerpo, $cab, '127.0.0.1', microtime(true));
                $out[] = ['envio' => $k + 1, 'http' => $http, 'status' => (string) ($r['status'] ?? ''), 'duplicate' => (bool) ($r['duplicate'] ?? false)];
            }
        } finally {
            // El receptor fija la empresa como una petición sin sesión: se vuelve a la sesión de quien simula.
            TenantContext::set($empresa);
            TenantContext::setUser($u->id);
        }

        return $out;
    }

    /* ------------------------------------------------------------------ WooCommerce */

    /** Cuerpo de ejemplo de un pedido (order.created) con los SKU de la tienda. */
    public static function ejemplo(string $storeId, string $plantilla, User $u): array
    {
        $s = Base::tiendaDe($u, $storeId);
        if (! isset(self::PLANTILLAS[$plantilla])) {
            RuleError::fail('RN-WEB-03', 'Elige una plantilla del simulador.');
        }
        $n = 1 + max(52611, (int) DB::table('web_order_inbox')->whereRaw("external_order_id ~ '^[0-9]{1,6}$'")->max(DB::raw('external_order_id::int')),
            ...array_map('intval', array_keys(WooCommerce::remotos($s->id))));
        $maps = DB::table('web_product_mappings')->where('store_id', $s->id)->where('status', 'LINKED')->where('publish', true)->orderBy('sku')->get();
        $linea = function (string $sku, float $q, int $k) use ($s, $maps, $n) {
            $m = $maps->firstWhere('sku', $sku);
            $v = $m ? Base::variante($m->variant_id) : null;
            $wp = $v ? Base::precioWeb($s, $v) : null;
            $precio = $wp['woo'] ?? 50.0;

            return ['id' => $n * 10 + $k, 'name' => $v->name ?? $sku, 'sku' => $sku, 'product_id' => $m->woo_product_id ?? 3201, 'variation_id' => $m->woo_variation_id ?? 0,
                'quantity' => $q, 'price' => number_format($precio, 2, '.', ''), 'total' => number_format($precio * $q, 2, '.', '')];
        };
        $principal = $maps->where('brand_id', $s->brand_id)->values();
        if ($principal->isEmpty()) {
            RuleError::fail('RN-WEB-03', "{$s->name} no tiene productos vinculados y publicados: vincula al menos uno en Mapeo (WEB-02).");
        }
        $a = $principal[0]->sku;
        $b = $principal[1]->sku ?? $a;
        $lineas = match ($plantilla) {
            'sku' => [$linea('DG-CUY-ENT-XL', 2, 0), $linea($a, 1, 1)],
            'mixed' => [$linea($a, 2, 0), $linea(($maps->firstWhere(fn ($m) => $m->brand_id !== $s->brand_id)->sku ?? null)
                ?? RuleError::fail('RN-WEB-03', "{$s->name} no tiene productos vinculados de otra marca: el carrito de dos marcas no aplica."), 1, 1)],
            default => array_values(array_filter([$linea($a, 2, 0), $b !== $a ? $linea($b, 1, 1) : null])),
        };
        if ($plantilla === 'sku') {
            $lineas[0]['product_id'] = 3299;
            $lineas[0]['name'] = 'Cuy entero XL';
            $lineas[0]['price'] = '79.90';
            $lineas[0]['total'] = '159.80';
        }
        $cli = DB::table('customers as c')->join('customer_addresses as a', fn ($j) => $j->on('a.customer_id', '=', 'c.id')->where('a.is_default', true))
            ->where('c.status', 'ACTIVE')->whereNull('c.merged_into_id')->where('c.customer_type', 'PERSON')->whereNotNull('c.phone')->whereNotNull('a.lat')
            ->orderBy('c.full_name')->first(['c.full_name', 'c.phone', 'c.email', 'a.address_line', 'a.reference', 'a.district', 'a.lat', 'a.lng']);
        $nombre = explode(' ', (string) ($cli->full_name ?? 'Cliente Web'), 2);
        $tel = preg_replace('/^\+51/', '', (string) ($cli->phone ?? '+51987654321'));
        $sinPin = $plantilla === 'nopin';
        $total = array_sum(array_map(fn ($l) => (float) $l['total'], $lineas));
        $meta = [['key' => '_delivery_date', 'value' => now('America/Lima')->addDay()->toDateString()], ['key' => '_delivery_slot', 'value' => '13:00–17:00'],
            ['key' => '_billing_document', 'value' => 'boleta'], ['key' => '_wc_order_attribution_utm_source', 'value' => 'meta'],
            ['key' => '_wc_order_attribution_utm_medium', 'value' => 'cpc'], ['key' => '_wc_order_attribution_utm_campaign', 'value' => 'DGMCT1']];
        if (! $sinPin && $cli) {
            $meta[] = ['key' => '_shipping_lat', 'value' => (string) $cli->lat];
            $meta[] = ['key' => '_shipping_lng', 'value' => (string) $cli->lng];
        }

        return ['id' => $n, 'number' => (string) $n, 'status' => 'processing', 'currency' => 'PEN', 'date_created' => now('America/Lima')->format('Y-m-d\TH:i:s'),
            'date_modified' => now('America/Lima')->format('Y-m-d\TH:i:s'), 'total' => number_format($total, 2, '.', ''), 'shipping_total' => '0.00',
            'customer_note' => 'Tocar el timbre del 2.º piso',
            'billing' => ['first_name' => $nombre[0], 'last_name' => $nombre[1] ?? '', 'email' => $cli->email ?? "cliente{$n}@correo.pe",
                'phone' => $plantilla === 'phone' ? '98765432' : trim(chunk_split($tel, 3, ' '))],
            'shipping' => ['first_name' => $nombre[0], 'last_name' => $nombre[1] ?? '',
                'address_1' => $sinPin ? 'Jr. Las Gardenias 455, dpto. 302' : ($cli->address_line ?? 'Av. Caminos del Inca 1200'),
                'address_2' => $sinPin ? 'Frente a la bodega La Esquina' : ($cli->reference ?? 'Puerta verde'),
                'city' => $sinPin ? 'Santiago de Surco' : ($cli->district ?? 'Santiago de Surco')],
            'payment_method' => 'woo-mercado-pago-basic', 'payment_method_title' => 'Mercado Pago', 'line_items' => $lineas,
            'shipping_lines' => [['method_id' => 'flat_rate', 'total' => '0.00']], 'meta_data' => $meta];
    }

    /**
     * WEB-04: simula el webhook order.created. $veces envíos (reintentos de WooCommerce, cada uno con su id de entrega)
     * o ninguno ($veces = 0: el webhook se perdió y solo lo encuentra la consulta de respaldo).
     */
    public static function pedido(array $d, User $u): array
    {
        $s = Base::tiendaDe($u, $d['store_id'] ?? null);
        $c = self::conectorDePrueba($s, 'connector_id', 'WooCommerce');
        $p = is_array($d['payload'] ?? null) ? $d['payload'] : json_decode((string) ($d['payload'] ?? ''), true);
        if (! is_array($p) || ! isset($p['id'])) {
            RuleError::fail('RN-WEB-03', 'El cuerpo JSON no es un pedido de WooCommerce (falta el id).');
        }
        $veces = max(0, min(5, (int) ($d['veces'] ?? 1)));
        $p['date_modified'] = now('America/Lima')->format('Y-m-d\TH:i:s');
        WooCommerce::guardarRemoto($s->id, $p);
        $ext = (string) (($p['number'] ?? '') !== '' ? $p['number'] : $p['id']);
        $entrega = trim((string) ($d['delivery_id'] ?? '')) ?: 'entrega-'.$ext;
        $entregas = [];
        for ($i = 1; $i <= $veces; $i++) {
            $entregas[] = ! empty($d['mismo_envio']) ? $entrega : "{$entrega}-{$i}";
        }
        $resp = $veces ? self::enviar($c, json_encode($p, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), $entregas, ($d['firma_valida'] ?? true) !== false, $u) : [];
        $ib = DB::table('web_order_inbox')->where('store_id', $s->id)->where('external_order_id', mb_substr($ext, 0, 20))->first();

        return ['respuestas' => $resp, 'inbox' => $ib ? ['id' => $ib->id, 'status' => $ib->status, 'error_code' => $ib->error_code,
            'external_order_id' => $ib->external_order_id, 'duplicates' => (int) $ib->duplicates,
            'pedidos' => DB::table('sales_orders')->whereIn('id', Base::json($ib->order_ids) ?: ['00000000-0000-0000-0000-000000000000'])->orderBy('number')->pluck('number')->all()] : null,
            'en_woocommerce' => true];
    }

    /* ------------------------------------------------------------------ Mercado Pago */

    /** WEB-06: el pago queda «del lado de Mercado Pago» y llega su notificación firmada (solo el id: se verifica con la API). */
    public static function pago(array $d, User $u): array
    {
        $s = Base::tiendaDe($u, $d['store_id'] ?? null);
        $c = self::conectorDePrueba($s, 'payment_connector_id', 'Mercado Pago');
        $estado = (string) ($d['status'] ?? 'approved');
        if (! in_array($estado, ['approved', 'pending', 'in_process', 'rejected', 'refunded', 'charged_back'], true)) {
            RuleError::fail('RN-WEB-06', 'Elige el estado del pago a simular.');
        }
        $id = trim((string) ($d['payment_id'] ?? ''));
        $previo = $id !== '' ? DB::table('gateway_transactions')->where('provider', Pagos::PROVEEDOR)->where('external_payment_id', $id)->first() : null;
        if ($id !== '' && ! $previo) {
            RuleError::fail('RN-WEB-06', "No hay una transacción {$id} de Mercado Pago: deja el id vacío para un pago nuevo.");
        }
        if (in_array($estado, Pagos::REVERSOS, true) && (! $previo || $previo->status !== 'approved')) {
            RuleError::fail('RN-WEB-09', 'Un reembolso o contracargo se simula sobre un pago aprobado: elige su id.');
        }
        $ref = trim((string) ($d['external_reference'] ?? ($previo->external_reference ?? '')));
        if ($ref === '') {
            RuleError::fail('RN-WEB-06', 'Escribe el número del pedido web (external_reference).');
        }
        $monto = round((float) ($d['amount'] ?? ($previo->amount ?? 0)), 2);
        if ($monto <= 0) {
            RuleError::fail('RN-WEB-06', 'El monto del pago debe ser mayor que cero.');
        }
        if ($id === '') {
            do {
                $id = (string) (1330000000 + random_int(100000, 9999999));
            } while (DB::table('gateway_transactions')->where('provider', Pagos::PROVEEDOR)->where('external_payment_id', $id)->exists());
        }
        if ($previo && ! \Illuminate\Support\Facades\Cache::has('web:mp:'.(TenantContext::tenant()['id'] ?? 'x').':'.$id)) {
            \Illuminate\Support\Facades\Cache::put('web:mp:'.(TenantContext::tenant()['id'] ?? 'x').':'.$id, Base::json($previo->raw), now()->addDays(30));
        }
        Proveedores\MercadoPago::remoto(['id' => $id, 'external_reference' => $ref, 'amount' => $monto, 'status' => $estado, 'method' => $d['method'] ?? 'visa',
            'payer_email' => $d['payer_email'] ?? null]);
        $cuerpo = ['id' => (string) random_int(10000000000, 99999999999), 'type' => 'payment', 'action' => 'payment.updated', 'live_mode' => false,
            'date_created' => now('America/Lima')->toIso8601String(), 'data' => ['id' => $id]];
        $resp = self::enviar($c, json_encode($cuerpo, JSON_UNESCAPED_SLASHES), [null], ($d['firma_valida'] ?? true) !== false, $u);
        $tx = DB::table('gateway_transactions')->where('provider', Pagos::PROVEEDOR)->where('external_payment_id', $id)->first(['id', 'status', 'payment_id']);
        $ev = DB::table('webhook_events')->where('connector_id', $c->id)->where('event_key', $cuerpo['id'])->first(['status', 'result', 'last_error']);

        return ['respuestas' => $resp, 'tx' => $tx, 'payment_id' => $id, 'resultado' => $ev->result ?? $ev->last_error ?? null];
    }
}
