<?php

namespace App\Modulos\Web\Services\Proveedores;

use App\Modulos\Int\Services\Credenciales;
use App\Support\TenantContext;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;

/**
 * Adaptador de WooCommerce (API REST wc/v3). Las credenciales (consumer_key y consumer_secret) salen cifradas de INT y
 * nunca vuelven al navegador (RN-WEB-10).
 *
 * Con un conector de prueba (SANDBOX o adaptador FAKE) no sale a internet (RN-INT-01): responde bien, salvo que en INT
 * se haya simulado la caída, y la consulta de respaldo devuelve los pedidos que dejó el simulador de WEB-04.
 */
final class WooCommerce
{
    public const TIEMPO = 15;

    public static function dePrueba(object $c): bool
    {
        return $c->environment === 'SANDBOX' || $c->adapter === 'FAKE';
    }

    /** INT-02 «Probar conexión» (Adaptadores::INSTALADOS). */
    public function probar(object $c): array
    {
        if (self::dePrueba($c)) {
            return $c->simulate_down ? ['ok' => false, 'error' => 'HTTP 503 Service Unavailable: WooCommerce no respondió'] : ['ok' => true];
        }
        try {
            $r = self::http($c)->get(self::base($c).'/system_status');

            return $r->successful() ? ['ok' => true] : ['ok' => false, 'error' => self::error($r)];
        } catch (\Throwable $e) {
            return ['ok' => false, 'error' => mb_substr($e->getMessage(), 0, 200)];
        }
    }

    /**
     * Envía precio, stock o estado de publicación de varios productos. $items: [{mapping_id, woo_product_id, woo_variation_id, price?, stock?, status?}].
     *
     * @return array<string, ?string> mapping_id => null (correcto) o el error de ese producto
     */
    public static function actualizar(object $c, array $items): array
    {
        $out = array_fill_keys(array_column($items, 'mapping_id'), null);
        if (! $items) {
            return $out;
        }
        if (self::dePrueba($c)) {
            if ($c->simulate_down) {
                throw new \RuntimeException('HTTP 503 Service Unavailable: WooCommerce no respondió; se reintenta en la próxima corrida');
            }

            return $out;
        }
        $grupos = [];
        foreach ($items as $i) {
            $cambio = array_filter([
                'id' => (int) ($i['woo_variation_id'] ?: $i['woo_product_id']),
                'regular_price' => isset($i['price']) ? number_format((float) $i['price'], 2, '.', '') : null,
                'manage_stock' => isset($i['stock']) ? true : null,
                'stock_quantity' => isset($i['stock']) ? (int) $i['stock'] : null,
                'status' => $i['status'] ?? null,
            ], fn ($v) => $v !== null);
            $ruta = $i['woo_variation_id'] ? "/products/{$i['woo_product_id']}/variations/batch" : '/products/batch';
            $grupos[$ruta][] = ['m' => $i['mapping_id'], 'cambio' => $cambio];
        }
        foreach ($grupos as $ruta => $lista) {
            foreach (array_chunk($lista, 100) as $lote) {
                $r = self::http($c)->post(self::base($c).$ruta, ['update' => array_column($lote, 'cambio')]);
                if (! $r->successful()) {
                    throw new \RuntimeException(self::error($r));
                }
                $porId = collect($r->json('update') ?? [])->keyBy('id');
                foreach ($lote as $x) {
                    $res = $porId[$x['cambio']['id']] ?? null;
                    if ($res && isset($res['error'])) {
                        $out[$x['m']] = mb_substr(($res['error']['code'] ?? 'error').': '.($res['error']['message'] ?? ''), 0, 250);
                    }
                }
            }
        }

        return $out;
    }

    /** Crea el producto simple en WooCommerce. @return int id del producto */
    public static function crear(object $c, array $d): int
    {
        if (self::dePrueba($c)) {
            if ($c->simulate_down) {
                throw new \RuntimeException('HTTP 503 Service Unavailable: WooCommerce no respondió');
            }

            return 1 + max(3300, (int) DB::table('web_product_mappings')->max('woo_product_id'));
        }
        $r = self::http($c)->post(self::base($c).'/products', [
            'name' => $d['name'], 'type' => 'simple', 'sku' => $d['sku'], 'regular_price' => number_format((float) $d['price'], 2, '.', ''),
            'manage_stock' => true, 'stock_quantity' => (int) $d['stock'], 'status' => 'publish',
        ]);
        if (! $r->successful()) {
            throw new \RuntimeException(self::error($r));
        }

        return (int) $r->json('id');
    }

    /**
     * Busca en WooCommerce el producto (o la variación) de un SKU vinculado a mano.
     *
     * @return array{0: int, 1: int}|null [producto, variación]
     */
    public static function buscarPorSku(object $c, string $sku): ?array
    {
        if (self::dePrueba($c)) {
            if ($c->simulate_down) {
                throw new \RuntimeException('HTTP 503 Service Unavailable: WooCommerce no respondió');
            }

            return [1 + max(3300, (int) DB::table('web_product_mappings')->max('woo_product_id')), 0];
        }
        $r = self::http($c)->get(self::base($c).'/products', ['sku' => $sku]);
        if (! $r->successful()) {
            throw new \RuntimeException(self::error($r));
        }
        $p = ($r->json() ?? [])[0] ?? null;
        if (! $p) {
            return null;
        }

        return ($p['type'] ?? '') === 'variation' ? [(int) $p['parent_id'], (int) $p['id']] : [(int) $p['id'], 0];
    }

    /** Consulta de respaldo: pedidos creados o cambiados desde $desde (ISO). */
    public static function pedidos(object $c, object $s, string $desde): array
    {
        if (self::dePrueba($c)) {
            if ($c->simulate_down) {
                throw new \RuntimeException('HTTP 503: WooCommerce no respondió a la consulta de pedidos');
            }

            return array_values(array_filter(self::remotos($s->id), fn ($p) => (string) ($p['date_modified'] ?? $p['date_created'] ?? '') >= substr($desde, 0, 19)));
        }
        $todos = [];
        for ($pagina = 1; $pagina <= 10; $pagina++) {
            $r = self::http($c)->get(self::base($c).'/orders', ['modified_after' => $desde, 'per_page' => 100, 'page' => $pagina, 'orderby' => 'date', 'order' => 'asc']);
            if (! $r->successful()) {
                throw new \RuntimeException(self::error($r));
            }
            $lote = $r->json() ?? [];
            $todos = array_merge($todos, $lote);
            if (count($lote) < 100) {
                break;
            }
        }

        return $todos;
    }

    /** Pedidos del lado de WooCommerce en el adaptador falso (los deja el simulador; viven 3 días). */
    public static function guardarRemoto(string $storeId, array $p): void
    {
        $k = self::clave($storeId);
        $lista = Cache::get($k, []);
        $lista[(string) ($p['number'] ?? $p['id'])] = $p;
        Cache::put($k, array_slice($lista, -200, null, true), now()->addDays(3));
    }

    public static function remotos(string $storeId): array
    {
        return Cache::get(self::clave($storeId), []);
    }

    private static function clave(string $storeId): string
    {
        return 'web:woo:'.(TenantContext::tenant()['id'] ?? 'x').':'.$storeId;
    }

    private static function base(object $c): string
    {
        $cfg = json_decode((string) $c->config, true) ?: [];
        $url = $cfg['store_url'] ?? DB::table('web_stores')->where('connector_id', $c->id)->value('url');
        if (! $url) {
            throw new \RuntimeException('El conector no tiene la URL de la tienda (store_url).');
        }

        return rtrim($url, '/').'/wp-json/'.($cfg['api_version'] ?? 'wc/v3');
    }

    private static function http(object $c)
    {
        $key = Credenciales::secreto($c->id, 'consumer_key');
        $secret = Credenciales::secreto($c->id, 'consumer_secret');
        if (! $key || ! $secret) {
            throw new \RuntimeException('Faltan las credenciales de WooCommerce (consumer_key y consumer_secret): cárgalas en Credenciales (INT-03).');
        }

        return Http::withBasicAuth($key, $secret)->acceptJson()->timeout(self::TIEMPO)->connectTimeout(5);
    }

    private static function error($r): string
    {
        $j = $r->json();

        return mb_substr('HTTP '.$r->status().(is_array($j) && isset($j['code']) ? " {$j['code']}: ".($j['message'] ?? '') : ''), 0, 250);
    }
}
