<?php

namespace App\Modulos\Web\Services;

use App\Models\User;
use App\Modulos\Int\Services\Adaptadores;
use App\Modulos\Int\Services\Conectores;
use App\Support\Events;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/** WEB-01 Tiendas: alta y edición, prueba de conexión y estado (web.store.manage; credenciales en INT, RN-WEB-10). */
final class Tiendas
{
    public static function lista(User $u): array
    {
        $tiendas = Base::tiendasDe($u);
        $ids = array_map(fn ($s) => $s->id, $tiendas);
        $marcas = DB::table('brands')->pluck('name', 'id');
        $listas = DB::table('price_lists')->pluck('code', 'id');
        $almacenes = DB::table('warehouses')->pluck('name', 'id');
        $locales = DB::table('establishments')->pluck('name', 'id');
        $hoy = Base::hoy();
        $ultimoStock = DB::table('web_sync_runs')->whereIn('store_id', $ids)->where('kind', 'STOCK')->orderByDesc('started_at')->first(['started_at', 'status', 'store_id']);

        return [
            'data' => array_map(fn ($s) => [
                'id' => $s->id, 'code' => $s->code, 'name' => $s->name, 'url' => $s->url, 'theme' => $s->theme, 'status' => $s->status,
                'brand_id' => $s->brand_id, 'marca' => $marcas[$s->brand_id] ?? null,
                'categorias' => array_values(array_filter(array_map(fn ($b) => $b !== $s->brand_id ? ($marcas[$b] ?? null) : null, (array) $s->brands))),
                'lista' => $listas[$s->price_list_id] ?? null, 'local' => $locales[$s->establishment_id] ?? null,
                'almacenes' => array_values(array_filter(array_map(fn ($w) => $almacenes[$w] ?? null, (array) $s->warehouse_ids))),
                'safety_margin_pct' => (float) $s->safety_margin_pct, 'vendedora' => Base::nombreUsuario($s->default_seller_id),
                'sync_catalog' => (bool) $s->sync_catalog, 'sync_prices' => (bool) $s->sync_prices, 'sync_stock' => (bool) $s->sync_stock, 'sync_orders' => (bool) $s->sync_orders,
                'last_test_at' => $s->last_test_at, 'last_test_ok' => $s->last_test_ok, 'last_test_msg' => $s->last_test_msg,
            ], $tiendas),
            'cifras' => [
                'activas' => count(array_filter($tiendas, fn ($s) => $s->status === 'ACTIVE')), 'total' => count($tiendas),
                'pedidos_hoy' => DB::table('web_order_inbox')->whereIn('store_id', $ids)->whereRaw("(received_at AT TIME ZONE 'America/Lima')::date = ?", [$hoy])->count(),
                'publicados' => DB::table('web_product_mappings as m')->join('web_stores as s', 's.id', '=', 'm.store_id')->whereIn('m.store_id', $ids)
                    ->where('s.status', 'ACTIVE')->where('m.publish', true)->whereIn('m.status', ['LINKED', 'ERROR'])->count(),
                'ultimo_stock' => $ultimoStock, 'stock_cada' => Base::param('web_stock_sync_minutes', 10),
            ],
        ];
    }

    public static function ver(string $id, User $u): array
    {
        $s = Base::tiendaDe($u, $id);
        $con = fn (?string $c) => $c ? DB::table('integration_connectors')->where('id', $c)->first(['id', 'code', 'name', 'environment', 'status', 'adapter']) : null;
        $ep = fn (?string $e) => $e ? DB::table('webhook_endpoints')->where('id', $e)->first(['id', 'name', 'url', 'status']) : null;
        $mask = fn ($e) => $e ? ['name' => $e->name, 'url' => preg_replace('/[^\/]{12,}$/', '••••'.substr((string) $e->url, -4), (string) $e->url), 'status' => $e->status] : null;
        $marcas = DB::table('brands')->pluck('name', 'id');
        $listas = DB::table('price_lists')->pluck('code', 'id');

        return [
            'id' => $s->id, 'code' => $s->code, 'name' => $s->name, 'url' => $s->url, 'theme' => $s->theme, 'platform' => $s->platform, 'status' => $s->status,
            'brand_id' => $s->brand_id, 'brands' => $s->brands, 'price_list_id' => $s->price_list_id, 'establishment_id' => $s->establishment_id,
            'warehouse_ids' => $s->warehouse_ids, 'safety_margin_pct' => (float) $s->safety_margin_pct, 'default_seller_id' => $s->default_seller_id,
            'connector_id' => $s->connector_id, 'payment_connector_id' => $s->payment_connector_id,
            'sync_catalog' => (bool) $s->sync_catalog, 'sync_prices' => (bool) $s->sync_prices, 'sync_stock' => (bool) $s->sync_stock, 'sync_orders' => (bool) $s->sync_orders,
            'last_test_at' => $s->last_test_at, 'last_test_ok' => $s->last_test_ok, 'last_test_msg' => $s->last_test_msg, 'created_by' => $s->created_by,
            'marca' => $marcas[$s->brand_id] ?? null, 'categorias' => array_values(array_map(fn ($b) => $marcas[$b] ?? '—', (array) $s->brands)),
            'listas' => collect((array) $s->price_lists)->map(fn ($l, $b) => ['marca' => $marcas[$b] ?? '—', 'lista' => $listas[$l] ?? '—'])->values(),
            'local' => DB::table('establishments')->where('id', $s->establishment_id)->value('name'),
            'almacenes' => DB::table('warehouses')->whereIn('id', (array) $s->warehouse_ids)->orderBy('name')->pluck('name'),
            'vendedora' => Base::nombreUsuario($s->default_seller_id),
            'conector' => $con($s->connector_id), 'conector_pagos' => $con($s->payment_connector_id),
            'webhook' => $mask($ep($s->webhook_endpoint_id)), 'webhook_pagos' => $mask($ep($s->payment_endpoint_id)),
            'credenciales' => DB::table('integration_credentials as k')->join('integration_connectors as c', 'c.id', '=', 'k.connector_id')
                ->whereIn('k.connector_id', array_filter([$s->connector_id, $s->payment_connector_id]))->where('k.status', 'ACTIVE')
                ->orderBy('c.code')->orderBy('k.name')->get(['c.code as conector', 'k.name', 'k.version', 'k.last4'])
                ->map(fn ($k) => ['conector' => $k->conector, 'name' => $k->name, 'version' => $k->version, 'valor' => '••••'.($k->last4 ?: '????')]),
            'stock_cada' => Base::param('web_stock_sync_minutes', 10), 'consulta_cada' => Base::param('web_order_poll_minutes', 15),
            'history' => array_reverse(Base::json($s->history)),
        ];
    }

    /** Lo que necesita el formulario. */
    public static function opciones(): array
    {
        return [
            'marcas' => DB::table('brands')->where('status', 'ACTIVE')->orderBy('name')->get(['id', 'name']),
            'listas' => DB::table('price_lists')->where('status', 'ACTIVE')->whereRaw("channels::jsonb @> '[\"WEB\"]'::jsonb")->orderBy('code')->get(['id', 'code', 'name', 'brand_id']),
            'locales' => DB::table('establishments')->where('status', 'ACTIVE')->orderBy('name')->get(['id', 'name']),
            'almacenes' => DB::table('warehouses')->where('status', 'ACTIVE')->where('allows_sale', true)->orderBy('name')->get(['id', 'name', 'establishment_id']),
            'vendedoras' => DB::table('users')->where('status', 'ACTIVE')->whereIn('role', ['VENDEDORA', 'SUPERVISORA_VENTAS'])->orderBy('name')->get(['id', 'name']),
            'conectores' => DB::table('integration_connectors')->where('owner_module', 'WEB')->orWhereIn('kind', ['COMMERCE', 'PAYMENTS'])->orderBy('name')
                ->get(['id', 'name', 'kind', 'environment']),
        ];
    }

    public static function guardar(array $d, ?string $id, User $u): array
    {
        $antes = $id ? Base::tiendaDe($u, $id) : null;
        $url = rtrim(mb_strtolower(trim((string) ($d['url'] ?? ''))), '/');
        $nombre = trim((string) ($d['name'] ?? ''));
        if ($nombre === '') {
            RuleError::fail('RN-WEB-10', 'Escribe el nombre de la tienda.');
        }
        if (! preg_match('/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(\/[a-z0-9._\/-]*)?$/', $url)) {
            RuleError::fail('RN-WEB-01', "La URL «{$d['url']}» no es válida: la tienda se conecta solo por HTTPS (por ejemplo https://www.donguando.com).");
        }
        if (DB::table('web_stores')->whereRaw('lower(url) = ?', [$url])->when($antes, fn ($q) => $q->where('id', '<>', $antes->id))->exists()) {
            RuleError::fail('RN-WEB-02', "Ya existe una tienda con la URL {$url}.");
        }
        $marca = $d['brand_id'] ?? null;
        if (! $marca || ! DB::table('brands')->where('id', $marca)->exists()) {
            RuleError::fail('RN-WEB-08', 'Elige la marca de la tienda.');
        }
        $marcas = array_values(array_unique(array_merge([$marca], array_filter((array) ($d['brands'] ?? [])))));
        if (DB::table('brands')->whereIn('id', $marcas)->count() !== count($marcas)) {
            RuleError::fail('RN-WEB-08', 'Una de las categorías no es una marca de la empresa.');
        }
        $lista = DB::table('price_lists')->where('id', $d['price_list_id'] ?? null)->first(['id', 'code', 'brand_id', 'channels', 'status']);
        if (! $lista || ($lista->brand_id && $lista->brand_id !== $marca) || ! in_array('WEB', Base::json($lista->channels), true) || $lista->status !== 'ACTIVE') {
            $mn = DB::table('brands')->where('id', $marca)->value('name');
            RuleError::fail('RN-WEB-08', 'La lista '.($lista->code ?? '—')." no es una lista activa de {$mn} para el canal web (RN-CAT-05): elige una lista con canal WEB.");
        }
        // Lista de cada marca de la tienda: la elegida para la marca principal; para las demás, su lista pública con canal WEB.
        $listas = [$marca => $lista->id];
        foreach ($marcas as $b) {
            if ($b === $marca) {
                continue;
            }
            $previa = $antes ? (((array) $antes->price_lists)[$b] ?? null) : null;
            $listas[$b] = $previa ?: DB::table('price_lists')->where('brand_id', $b)->where('status', 'ACTIVE')->whereRaw("channels::jsonb @> '[\"WEB\"]'::jsonb")
                ->orderByRaw('coalesce(priority, 100)')->orderBy('code')->value('id');
            if (! $listas[$b]) {
                RuleError::fail('RN-WEB-08', DB::table('brands')->where('id', $b)->value('name').' no tiene una lista de precios activa con canal WEB: créala en Catálogo antes de venderla en la tienda.');
            }
        }
        $local = $d['establishment_id'] ?? null;
        if (! $local || ! DB::table('establishments')->where('id', $local)->exists()) {
            RuleError::fail('RN-WEB-05', 'Elige el local de la tienda.');
        }
        $almacenes = array_values(array_unique(array_filter((array) ($d['warehouse_ids'] ?? []))));
        if (! $almacenes) {
            RuleError::fail('RN-WEB-05', 'Elige al menos un almacén de stock para la tienda.');
        }
        $malos = DB::table('warehouses')->whereIn('id', $almacenes)->where(fn ($q) => $q->where('establishment_id', '<>', $local)->orWhere('allows_sale', false)->orWhere('status', '<>', 'ACTIVE'))->pluck('name');
        if ($malos->isNotEmpty() || DB::table('warehouses')->whereIn('id', $almacenes)->count() !== count($almacenes)) {
            RuleError::fail('RN-WEB-05', ($malos->implode(', ') ?: 'Un almacén').' no es un almacén de venta del local de la tienda: el stock publicado sale solo de los almacenes de venta de ese local.');
        }
        $margen = (float) ($d['safety_margin_pct'] ?? -1);
        if ($margen < 0 || $margen > 50) {
            RuleError::fail('RN-WEB-05', 'El margen de seguridad va de 0 % a 50 %.');
        }
        $vendedora = ($d['default_seller_id'] ?? null) ?: null;
        if ($vendedora) {
            $v = DB::table('users')->where('id', $vendedora)->where('status', 'ACTIVE')->first(['id', 'name']);
            if (! $v) {
                RuleError::fail('RN-WEB-07', 'La vendedora por defecto no es un usuario activo.');
            }
            $alcance = DB::table('user_scopes')->where('user_id', $vendedora)->whereNotNull('brand_id')->pluck('brand_id')->all();
            if ($alcance && ! in_array($marca, $alcance, true)) {
                RuleError::fail('RN-WEB-07', "{$v->name} no atiende ".DB::table('brands')->where('id', $marca)->value('name').': elige una vendedora de la marca.');
            }
        }
        $conector = ($d['connector_id'] ?? null) ?: null;
        $conectorPagos = ($d['payment_connector_id'] ?? null) ?: null;
        foreach ([[$conector, 'COMMERCE', 'WooCommerce'], [$conectorPagos, 'PAYMENTS', 'Mercado Pago']] as [$c, $tipo, $nom]) {
            if ($c && ! DB::table('integration_connectors')->where('id', $c)->where('kind', $tipo)->exists()) {
                RuleError::fail('RN-WEB-10', "El conector de {$nom} no es de ese tipo: elige uno de INT.");
            }
        }

        $fila = [
            'name' => mb_substr($nombre, 0, 80), 'url' => mb_substr($url, 0, 80), 'platform' => 'WOOCOMMERCE', 'theme' => trim((string) ($d['theme'] ?? '')) ?: null, 'brand_id' => $marca, 'brands' => Base::enc($marcas),
            'price_list_id' => $lista->id, 'price_lists' => Base::enc((object) $listas), 'establishment_id' => $local, 'warehouse_ids' => Base::enc($almacenes),
            'safety_margin_pct' => round($margen, 2), 'default_seller_id' => $vendedora,
            'sync_catalog' => (bool) ($d['sync_catalog'] ?? false), 'sync_prices' => (bool) ($d['sync_prices'] ?? false),
            'sync_stock' => (bool) ($d['sync_stock'] ?? false), 'sync_orders' => (bool) ($d['sync_orders'] ?? false),
            'split_mixed_cart' => true, 'connector_id' => $conector, 'payment_connector_id' => $conectorPagos,
            'webhook_endpoint_id' => $conector ? DB::table('webhook_endpoints')->where('connector_id', $conector)->value('id') : null,
            'payment_endpoint_id' => $conectorPagos ? DB::table('webhook_endpoints')->where('connector_id', $conectorPagos)->value('id') : null,
            'updated_at' => now(),
        ];

        return DB::transaction(function () use ($antes, $fila, $u, $url) {
            if ($antes) {
                $cambioConexion = $antes->connector_id !== $fila['connector_id'] || $antes->url !== $fila['url'];
                DB::table('web_stores')->where('id', $antes->id)->update($fila + ($cambioConexion ? ['last_test_ok' => null, 'last_test_at' => null, 'last_test_msg' => null] : []));
                Base::anotar('web_stores', $antes->id, ['user' => $u->name, 'detail' => 'Configuración editada'.($cambioConexion ? ': hay que volver a probar la conexión' : '')]);
                Events::emit('web_store.updated', 'web_stores', $antes->id, ['by' => $u->id]);

                return self::ver($antes->id, $u);
            }
            $codigo = mb_strtoupper(mb_substr(explode('.', preg_replace('/^https:\/\/(www\.)?/', '', $url))[0], 0, 12));
            $n = 1;
            $base = $codigo;
            while (DB::table('web_stores')->where('code', $codigo)->exists()) {
                $codigo = mb_substr($base, 0, 10).++$n;
            }
            $id = DB::table('web_stores')->insertGetId($fila + ['code' => $codigo, 'status' => 'PENDING', 'created_by' => mb_substr($u->name, 0, 40),
                'history' => Base::enc([['at' => now()->toIso8601String(), 'user' => $u->name, 'detail' => 'Tienda creada']]), 'created_at' => now()], 'id');
            Events::emit('web_store.created', 'web_stores', $id, ['by' => $u->id, 'url' => $url]);

            return self::ver($id, $u);
        });
    }

    /** Prueba de conexión: conector y credenciales en INT (RN-WEB-10) y llamada al adaptador. */
    public static function probar(string $id, User $u): array
    {
        $s = Base::tiendaDe($u, $id);
        $ok = true;
        $msg = '';
        if (! $s->connector_id) {
            [$ok, $msg] = [false, 'La tienda no tiene conector de WooCommerce: créalo en Integraciones y carga consumer_key y consumer_secret en Credenciales (INT-03).'];
        } else {
            $c = Conectores::fila($s->connector_id);
            $dePrueba = Proveedores\WooCommerce::dePrueba($c);
            $nombres = DB::table('integration_credentials')->where('connector_id', $c->id)->where('status', 'ACTIVE')->pluck('name')->all();
            if (! $dePrueba && ! (in_array('consumer_key', $nombres, true) && in_array('consumer_secret', $nombres, true))) {
                [$ok, $msg] = [false, 'Faltan las credenciales de WooCommerce (consumer_key y consumer_secret) en Credenciales (INT-03): se guardan cifradas y nunca vuelven al navegador.'];
            } elseif ($c->status === 'DISABLED') {
                [$ok, $msg] = [false, "El conector {$c->name} está desactivado en Integraciones."];
            } else {
                $r = Adaptadores::probar($c);
                Conectores::reportar($c->id, $r['ok'] !== false, $r['error'], $r['latencia']);
                [$ok, $msg] = [$r['ok'] === true, $r['mensaje']];
            }
        }
        DB::table('web_stores')->where('id', $s->id)->update(['last_test_at' => now(), 'last_test_ok' => $ok, 'last_test_msg' => mb_substr($msg, 0, 255)]);
        Base::anotar('web_stores', $s->id, ['user' => $u->name, 'detail' => 'Prueba de conexión: '.($ok ? 'correcta' : 'fallida')]);

        return ['ok' => $ok, 'mensaje' => $msg];
    }

    public static function cambiarEstado(string $id, string $estado, ?string $motivo, User $u): array
    {
        $s = Base::tiendaDe($u, $id);
        if (! isset(Base::ESTADOS_TIENDA[$estado])) {
            RuleError::fail('RN-WEB-10', 'Estado no válido.');
        }
        $motivo = trim((string) $motivo);
        if (mb_strlen($motivo) < 10) {
            RuleError::fail('RN-WEB-10', 'Escribe un motivo de al menos 10 caracteres.');
        }
        if (in_array($estado, ['ACTIVE', 'TESTING'], true) && ! $s->last_test_ok) {
            RuleError::fail('RN-WEB-10', "Prueba la conexión de {$s->name} con resultado correcto antes de activarla.");
        }
        DB::table('web_stores')->where('id', $s->id)->update(['status' => $estado, 'updated_at' => now()]);
        Base::anotar('web_stores', $s->id, ['user' => $u->name, 'detail' => 'Estado → '.Base::ESTADOS_TIENDA[$estado].': '.mb_substr($motivo, 0, 200)]);
        Events::emit('web_store.status_changed', 'web_stores', $s->id, ['status' => $estado, 'by' => $u->id]);

        return self::ver($s->id, $u);
    }
}
