<?php

namespace App\Modulos\Web\Services;

use App\Models\User;
use App\Modulos\Int\Services\Conectores;
use App\Support\Events;
use App\Support\Paginas;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * WEB-02 Mapeo de productos (web.mapping.manage) y WEB-08 Stock publicado.
 * Un pedido web se traduce solo por SKU mapeado (RN-WEB-03): aquí se vincula, se desvincula, se crea en la web y se
 * compara lo último enviado (precio y stock) con lo vigente (KPI-WEB-04).
 */
final class Mapeos
{
    public const PROBLEMAS = ['ERROR' => 'Error', 'VARIANT_INACTIVE' => 'Variante inactiva', 'PRICE_MISSING' => 'Sin precio', 'PRICE' => 'Precio por enviar', 'STOCK' => 'Stock por enviar'];

    /** Mapeos de la tienda con lo vigente al lado. */
    public static function filas(object $s): array
    {
        $ms = DB::table('web_product_mappings as m')->leftJoin('product_variants as v', 'v.id', '=', 'm.variant_id')->leftJoin('products as p', 'p.id', '=', 'v.product_id')
            ->leftJoin('brands as b', 'b.id', '=', 'm.brand_id')->where('m.store_id', $s->id)->orderBy('m.sku')
            ->get(['m.*', 'v.sku as v_sku', 'v.name as v_name', 'v.status as v_status', 'v.sellable', 'v.sale_mode', 'v.nominal_weight_kg', 'v.brand_id as v_brand',
                'v.web_publishable', 'v.product_id', 'p.web_publishable as producto_web', 'p.status as producto_estado', 'p.product_type', 'b.name as marca']);
        $stock = Stock::publicados($s, $ms->pluck('variant_id')->filter()->all());

        return $ms->map(function ($m) use ($s, $stock) {
            $v = $m->variant_id ? (object) ['id' => $m->variant_id, 'sku' => $m->v_sku, 'name' => $m->v_name, 'brand_id' => $m->v_brand, 'status' => $m->v_status,
                'sellable' => $m->sellable, 'sale_mode' => $m->sale_mode, 'nominal_weight_kg' => $m->nominal_weight_kg, 'web_publishable' => $m->web_publishable,
                'producto_web' => $m->producto_web, 'producto_estado' => $m->producto_estado] : null;

            return self::presentar($s, $m, $v, $v ? ($stock[$v->id] ?? null) : null);
        })->all();
    }

    private static function presentar(object $s, object $m, ?object $v, ?array $st): array
    {
        $problemas = [];
        $precio = null;
        $publicado = null;
        if ($m->status === 'ERROR') {
            $problemas[] = 'ERROR';
        }
        if ($m->status !== 'UNLINKED' && $v) {
            $wp = Base::precioWeb($s, $v);
            $precio = $wp['woo'] ?? null;
            $publicado = $st['publicado'] ?? 0;
            if (! Base::varianteActiva($v)) {
                $problemas[] = 'VARIANT_INACTIVE';
            }
            if ($m->publish) {
                if ($precio === null) {
                    $problemas[] = 'PRICE_MISSING';
                } elseif ($m->last_price_sent === null || abs((float) $m->last_price_sent - $precio) > 0.004) {
                    $problemas[] = 'PRICE';
                }
                if ($s->sync_stock && ($m->last_stock_sent === null || (int) $m->last_stock_sent !== $publicado)) {
                    $problemas[] = 'STOCK';
                }
            }
        }

        return [
            'id' => $m->id, 'sku' => $m->sku, 'woo_product_id' => $m->woo_product_id, 'woo_variation_id' => $m->woo_variation_id, 'woo_name' => $m->woo_name,
            'variant_id' => $m->variant_id, 'variante' => $v?->name, 'variante_sku' => $v?->sku, 'sale_mode' => $v?->sale_mode, 'unidad' => $v ? Base::unidadWeb($v) : null,
            'brand_id' => $m->brand_id, 'marca' => $m->marca ?? null, 'publish' => (bool) $m->publish, 'web_status' => $m->web_status, 'status' => $m->status,
            'remote_missing' => (bool) $m->remote_missing, 'last_error' => $m->last_error,
            'last_price_sent' => $m->last_price_sent !== null ? (float) $m->last_price_sent : null, 'last_price_at' => $m->last_price_at,
            'last_stock_sent' => $m->last_stock_sent !== null ? (int) $m->last_stock_sent : null, 'last_stock_at' => $m->last_stock_at,
            'precio' => $precio, 'stock' => $publicado, 'problemas' => array_values(array_unique($problemas)),
        ];
    }

    /** WEB-02: lista con filtros y cifras. */
    public static function lista(User $u, array $f): array
    {
        $s = Base::tiendaOPrimera($u, $f['store'] ?? null);
        $todas = self::filas($s);
        $filas = array_values(array_filter($todas, function ($m) use ($f) {
            if (! empty($f['estado']) && $m['status'] !== $f['estado']) {
                return false;
            }
            if (! empty($f['marca']) && $m['brand_id'] !== $f['marca']) {
                return false;
            }
            if (($f['problema'] ?? '') === 'SI' && ! $m['problemas']) {
                return false;
            }
            if (($f['problema'] ?? '') === 'NO' && $m['problemas']) {
                return false;
            }
            if (! empty($f['q'])) {
                $t = self::plano($f['q']);

                return str_contains(self::plano($m['sku'].' '.$m['variante'].' '.$m['woo_name'].' '.$m['variante_sku']), $t);
            }

            return true;
        }));
        $filas = Paginas::ordenarLista($filas, ['sku', 'variante', 'marca', 'status', 'precio', 'stock'], $f);

        $vinculadas = array_filter(array_column($todas, 'variant_id', 'id'));
        $faltan = self::sinProducto($s, array_values($vinculadas));

        return Paginas::deLista($filas, $f) + ['cifras' => [
            'vinculados' => count(array_filter($todas, fn ($m) => $m['status'] === 'LINKED')),
            'publicados' => count(array_filter($todas, fn ($m) => $m['status'] === 'LINKED' && $m['publish'])),
            'sin_vinculo' => count(array_filter($todas, fn ($m) => $m['status'] === 'UNLINKED')),
            'con_error' => count(array_filter($todas, fn ($m) => $m['status'] === 'ERROR')),
            'sin_producto' => count($faltan),
            'kpi' => self::kpi($todas),
        ], 'marcas' => DB::table('brands')->whereIn('id', (array) $s->brands)->orderBy('name')->get(['id', 'name']), 'faltan' => $faltan];
    }

    /** KPI-WEB-04: mapeos activos con error o con precio o stock publicado distinto del vigente. */
    public static function kpi(array $filas): array
    {
        $activos = array_filter($filas, fn ($m) => $m['publish'] && in_array($m['status'], ['LINKED', 'ERROR'], true));
        $mal = array_filter($activos, fn ($m) => (bool) array_intersect($m['problemas'], ['ERROR', 'PRICE', 'STOCK', 'PRICE_MISSING', 'VARIANT_INACTIVE']));

        return ['valor' => $activos ? round(count($mal) / count($activos) * 100, 1) : 0, 'numerador' => count($mal), 'denominador' => count($activos)];
    }

    /** Variantes activas y publicables de las marcas de la tienda que no tienen producto en la web. */
    public static function sinProducto(object $s, array $vinculadas): array
    {
        $vs = DB::table('product_variants as v')->join('products as p', 'p.id', '=', 'v.product_id')->leftJoin('brands as b', 'b.id', '=', 'v.brand_id')
            ->whereIn('v.brand_id', (array) $s->brands)->where('v.status', 'ACTIVE')->where('v.sellable', true)
            ->where(fn ($q) => $q->whereNull('v.web_publishable')->orWhere('v.web_publishable', true))->where('p.web_publishable', true)->where('p.status', '<>', 'INACTIVE')
            ->when($vinculadas, fn ($q) => $q->whereNotIn('v.id', $vinculadas))->orderBy('v.sku')
            ->get(['v.id', 'v.sku', 'v.name', 'v.brand_id', 'v.sale_mode', 'v.nominal_weight_kg', 'v.status', 'v.sellable', 'v.web_publishable',
                'p.web_publishable as producto_web', 'p.status as producto_estado', 'b.name as marca']);
        $st = Stock::publicados($s, $vs->pluck('id')->all());

        return $vs->map(function ($v) use ($s, $st) {
            $wp = Base::precioWeb($s, $v);

            return ['id' => $v->id, 'sku' => $v->sku, 'name' => $v->name, 'marca' => $v->marca, 'sale_mode' => $v->sale_mode, 'unidad' => Base::unidadWeb($v),
                'precio' => $wp['woo'] ?? null, 'lista' => $wp['list_code'] ?? null, 'stock' => $st[$v->id]['publicado'] ?? 0];
        })->all();
    }

    public static function ver(string $id, User $u): array
    {
        $m = DB::table('web_product_mappings')->where('id', $id)->first() ?? abort(404, 'Mapeo no encontrado.');
        $s = Base::tiendaDe($u, $m->store_id);
        $fila = collect(self::filas($s))->firstWhere('id', $id);
        $v = Base::variante($m->variant_id);
        $extra = [];
        if ($v) {
            $wp = Base::precioWeb($s, $v);
            $st = Stock::publicado($s, $v->id);
            $extra = ['precio_detalle' => $wp ? Base::soles($wp['woo']).' por '.Base::unidadWeb($v).' (lista '.($wp['list_code'] ?? '—')
                .($v->sale_mode === 'UNIT_VARIABLE_WEIGHT' && $wp['basis'] === 'KG' ? ', '.Base::soles($wp['price']).'/kg × '.number_format((float) $v->nominal_weight_kg, 3).' kg' : '').')' : null,
                'stock_detalle' => Stock::formula($st), 'variante_activa' => Base::varianteActiva($v), 'publicable' => Base::publicable($v)];
        }

        return $fila + $extra + ['store_id' => $s->id, 'tienda' => $s->name, 'previous_variant_id' => $m->previous_variant_id, 'linked_at' => $m->linked_at,
            'linked_by' => $m->linked_by, 'history' => array_reverse(Base::json($m->history))];
    }

    /** Variantes que se pueden vincular en la tienda. */
    public static function variantes(User $u, ?string $storeId): array
    {
        $s = Base::tiendaOPrimera($u, $storeId);

        return DB::table('product_variants as v')->join('products as p', 'p.id', '=', 'v.product_id')->leftJoin('brands as b', 'b.id', '=', 'v.brand_id')
            ->whereIn('v.brand_id', (array) $s->brands)->where('v.status', 'ACTIVE')->where('v.sellable', true)->whereIn('p.product_type', ['GOODS', 'COMBO'])
            ->orderBy('v.sku')->get(['v.id', 'v.sku', 'v.name', 'b.name as marca'])->all();
    }

    /** Vincula un SKU de la web con una variante del catálogo (RN-WEB-03). */
    public static function vincular(string $storeId, string $sku, string $varianteId, ?string $nota, User $u): array
    {
        $s = Base::tiendaDe($u, $storeId);
        $k = mb_strtoupper(trim($sku));
        if ($k === '' || mb_strlen($k) > 40) {
            RuleError::fail('RN-WEB-03', 'Escribe el SKU de la web (hasta 40 caracteres).');
        }
        $v = Base::variante($varianteId);
        if (! $v) {
            RuleError::fail('RN-WEB-03', 'Elige la variante del catálogo.');
        }
        if (! Base::varianteActiva($v)) {
            RuleError::fail('RN-WEB-03', "{$v->name} está inactiva o no se vende (VARIANT_INACTIVE): elige una variante activa.");
        }
        if (! in_array($v->brand_id, (array) $s->brands, true)) {
            RuleError::fail('RN-WEB-03', "{$v->name} es de ".DB::table('brands')->where('id', $v->brand_id)->value('name').", que no se vende en {$s->name}.");
        }
        $otro = DB::table('web_product_mappings')->where('store_id', $s->id)->where('variant_id', $v->id)->where('status', '<>', 'UNLINKED')->whereRaw('upper(sku) <> ?', [$k])->value('sku');
        $detalle = "Vinculado a {$v->sku} · {$v->name}".($otro ? " (la variante también responde al SKU {$otro})" : '').($nota ? ' · '.mb_substr(trim($nota), 0, 160) : '');

        return DB::transaction(function () use ($s, $k, $v, $u, $detalle) {
            $ex = DB::table('web_product_mappings')->where('store_id', $s->id)->whereRaw('upper(sku) = ?', [$k])->lockForUpdate()->first();
            $datos = ['variant_id' => $v->id, 'brand_id' => $v->brand_id, 'publish' => Base::publicable($v), 'linked_at' => now(), 'linked_by' => mb_substr($u->name, 0, 40), 'updated_at' => now()];
            if ($ex) {
                DB::table('web_product_mappings')->where('id', $ex->id)->update($datos + ['status' => $ex->remote_missing ? 'ERROR' : 'LINKED']);
                $id = $ex->id;
            } else {
                $id = DB::table('web_product_mappings')->insertGetId($datos + ['store_id' => $s->id, 'sku' => $k, 'woo_product_id' => 0, 'woo_variation_id' => 0,
                    'woo_name' => mb_substr($v->name, 0, 80), 'status' => 'LINKED', 'web_status' => 'publish', 'remote_missing' => false, 'history' => '[]', 'created_at' => now()], 'id');
            }
            Base::anotar('web_product_mappings', $id, ['user' => $u->name, 'detail' => $detalle]);
            Events::emit('web_mapping.linked', 'web_product_mappings', $id, ['sku' => $k, 'variant_id' => $v->id, 'by' => $u->id]);

            return self::ver($id, $u);
        });
    }

    public static function desvincular(string $id, ?string $motivo, User $u): array
    {
        $m = DB::table('web_product_mappings')->where('id', $id)->first() ?? abort(404, 'Mapeo no encontrado.');
        Base::tiendaDe($u, $m->store_id);
        $motivo = trim((string) $motivo);
        if (mb_strlen($motivo) < 10) {
            RuleError::fail('RN-WEB-03', 'Desvincular exige un motivo de al menos 10 caracteres.');
        }
        if ($m->status === 'UNLINKED') {
            RuleError::fail('RN-WEB-03', "El SKU {$m->sku} ya está sin vínculo.");
        }
        $nombre = DB::table('product_variants')->where('id', $m->variant_id)->value('name');
        DB::table('web_product_mappings')->where('id', $id)->update(['status' => 'UNLINKED', 'previous_variant_id' => $m->variant_id, 'variant_id' => null,
            'publish' => false, 'updated_at' => now()]);
        Base::anotar('web_product_mappings', $id, ['user' => $u->name, 'detail' => "Desvinculado de {$nombre}: ".mb_substr($motivo, 0, 200)]);
        Events::emit('web_mapping.unlinked', 'web_product_mappings', $id, ['sku' => $m->sku, 'by' => $u->id]);

        return self::ver($id, $u);
    }

    public static function publicar(string $id, bool $si, User $u): array
    {
        $m = DB::table('web_product_mappings')->where('id', $id)->first() ?? abort(404, 'Mapeo no encontrado.');
        Base::tiendaDe($u, $m->store_id);
        $v = Base::variante($m->variant_id);
        if (! $v) {
            RuleError::fail('RN-WEB-03', "El SKU {$m->sku} no tiene variante vinculada: vincúlalo antes de publicarlo.");
        }
        if ($si && (! Base::varianteActiva($v) || ! Base::publicable($v))) {
            RuleError::fail('RN-WEB-03', "{$v->name} no está activa o no está marcada para la web en Catálogo (Publicación web): actívala allí antes de publicarla.");
        }
        DB::table('web_product_mappings')->where('id', $id)->update(['publish' => $si, 'updated_at' => now()]);
        Base::anotar('web_product_mappings', $id, ['user' => $u->name, 'detail' => $si ? 'Publicado en la web' : 'Retirado de la web (queda como borrador en WooCommerce en la próxima corrida de catálogo)']);

        return self::ver($id, $u);
    }

    /** Crea el producto en WooCommerce con su precio y stock y deja el mapeo vinculado. */
    public static function crearEnWeb(string $storeId, string $varianteId, User $u): array
    {
        $s = Base::tiendaDe($u, $storeId);
        $v = Base::variante($varianteId);
        if (! $v || ! Base::varianteActiva($v) || ! Base::publicable($v)) {
            RuleError::fail('RN-WEB-03', ($v->name ?? 'La variante').' no está activa o no está marcada para la web en Catálogo (Publicación web).');
        }
        if (! in_array($v->brand_id, (array) $s->brands, true)) {
            RuleError::fail('RN-WEB-03', "{$v->name} es de una marca que no se vende en {$s->name}.");
        }
        $wp = Base::precioWeb($s, $v);
        if (! $wp) {
            RuleError::fail('RN-WEB-08', "{$v->name} no tiene precio vigente en la lista de la tienda (RN-CAT-05): sin precio no se publica.");
        }
        if (! $s->connector_id) {
            RuleError::fail('RN-WEB-10', "{$s->name} no tiene conector de WooCommerce.");
        }
        $c = Conectores::fila($s->connector_id);
        $stock = Stock::publicado($s, $v->id)['publicado'];
        try {
            $wooId = Proveedores\WooCommerce::crear($c, ['name' => $v->name, 'sku' => $v->sku, 'price' => $wp['woo'], 'stock' => $stock]);
            Conectores::reportar($c->id, true);
        } catch (\Throwable $e) {
            Conectores::reportar($c->id, false, mb_substr($e->getMessage(), 0, 255));
            RuleError::fail('RN-WEB-05', 'WooCommerce no creó el producto: '.$e->getMessage());
        }

        return DB::transaction(function () use ($s, $v, $wp, $stock, $wooId, $u) {
            $ex = DB::table('web_product_mappings')->where('store_id', $s->id)->where(fn ($q) => $q->where('variant_id', $v->id)->orWhereRaw('upper(sku) = ?', [mb_strtoupper($v->sku)]))
                ->lockForUpdate()->first();
            $datos = ['variant_id' => $v->id, 'brand_id' => $v->brand_id, 'woo_product_id' => $wooId, 'woo_variation_id' => 0, 'woo_name' => mb_substr($v->name, 0, 80),
                'status' => 'LINKED', 'remote_missing' => false, 'last_error' => null, 'publish' => true, 'web_status' => 'publish', 'last_price_sent' => $wp['woo'],
                'last_price_at' => now(), 'last_stock_sent' => $stock, 'last_stock_at' => now(), 'linked_at' => now(), 'linked_by' => mb_substr($u->name, 0, 40), 'updated_at' => now()];
            if ($ex) {
                DB::table('web_product_mappings')->where('id', $ex->id)->update($datos);
                $id = $ex->id;
            } else {
                $id = DB::table('web_product_mappings')->insertGetId($datos + ['store_id' => $s->id, 'sku' => mb_strtoupper($v->sku), 'history' => '[]', 'created_at' => now()], 'id');
            }
            Base::anotar('web_product_mappings', $id, ['user' => $u->name, 'detail' => "Creado en WooCommerce como producto {$wooId} · ".Base::soles($wp['woo'])." · stock {$stock}"]);
            Events::emit('web_mapping.created_remote', 'web_product_mappings', $id, ['sku' => $v->sku, 'woo_product_id' => $wooId, 'by' => $u->id]);

            return self::ver($id, $u);
        });
    }

    /** WEB-08 Stock publicado: por SKU vinculado y publicado. */
    public static function stock(User $u, array $f): array
    {
        $s = Base::tiendaOPrimera($u, $f['store'] ?? null);
        $ms = DB::table('web_product_mappings as m')->join('product_variants as v', 'v.id', '=', 'm.variant_id')->leftJoin('brands as b', 'b.id', '=', 'm.brand_id')
            ->where('m.store_id', $s->id)->whereIn('m.status', ['LINKED', 'ERROR'])->where('m.publish', true)->orderBy('m.sku')
            ->get(['m.id', 'm.sku', 'm.variant_id', 'm.brand_id', 'm.last_stock_sent', 'm.last_stock_at', 'v.name', 'b.name as marca']);
        $st = Stock::publicados($s, $ms->pluck('variant_id')->all());
        $todas = $ms->map(function ($m) use ($st) {
            $x = $st[$m->variant_id];
            $sit = $x['publicado'] <= 0 ? 'AGOTADO' : ($m->last_stock_sent === null || (int) $m->last_stock_sent !== $x['publicado'] ? 'POR_ENVIAR' : 'AL_DIA');

            return ['id' => $m->id, 'sku' => $m->sku, 'variant_id' => $m->variant_id, 'producto' => $m->name, 'brand_id' => $m->brand_id, 'marca' => $m->marca,
                'saldo' => $x['total'], 'no_usable' => $x['no_usable'], 'reservado' => $x['reservado'], 'disponible' => $x['disponible'], 'margen' => $x['margen'],
                'publicado' => $x['publicado'], 'enviado' => $m->last_stock_sent !== null ? (int) $m->last_stock_sent : null, 'enviado_at' => $m->last_stock_at,
                'por_enviar' => $m->last_stock_sent === null || (int) $m->last_stock_sent !== $x['publicado'], 'situacion' => $sit, 'formula' => Stock::formula($x)];
        })->all();
        $filas = array_values(array_filter($todas, function ($r) use ($f) {
            if (! empty($f['marca']) && $r['brand_id'] !== $f['marca']) {
                return false;
            }
            if (! empty($f['situacion']) && ! ($f['situacion'] === 'POR_ENVIAR' ? $r['por_enviar'] : $r['situacion'] === $f['situacion'])) {
                return false;
            }
            if (! empty($f['q'])) {
                return str_contains(self::plano($r['sku'].' '.$r['producto']), self::plano($f['q']));
            }

            return true;
        }));
        $filas = Paginas::ordenarLista($filas, ['sku', 'producto', 'saldo', 'disponible', 'publicado', 'enviado'], $f);
        $ultimo = DB::table('web_sync_runs')->where('store_id', $s->id)->where('kind', 'STOCK')->orderByDesc('started_at')->first(['number', 'started_at', 'status', 'detail']);

        return Paginas::deLista($filas, $f) + ['cifras' => [
            'publicados' => count($todas), 'agotados' => count(array_filter($todas, fn ($r) => $r['publicado'] <= 0)),
            'no_usable' => count(array_filter($todas, fn ($r) => $r['no_usable'] > 0)), 'por_enviar' => count(array_filter($todas, fn ($r) => $r['por_enviar'])),
        ], 'tienda' => ['id' => $s->id, 'name' => $s->name, 'margen' => (float) $s->safety_margin_pct, 'sync_stock' => (bool) $s->sync_stock, 'status' => $s->status,
            'almacenes' => DB::table('warehouses')->whereIn('id', (array) $s->warehouse_ids)->orderBy('name')->pluck('name')],
            'ultimo' => $ultimo, 'stock_cada' => Base::param('web_stock_sync_minutes', 10),
            'marcas' => DB::table('brands')->whereIn('id', (array) $s->brands)->orderBy('name')->get(['id', 'name'])];
    }

    /** WEB-08: cálculo de un SKU por lote y almacén. */
    public static function stockDe(string $id, User $u): array
    {
        $m = DB::table('web_product_mappings')->where('id', $id)->first() ?? abort(404, 'Mapeo no encontrado.');
        $s = Base::tiendaDe($u, $m->store_id);
        if (! $m->variant_id) {
            RuleError::fail('RN-WEB-03', "El SKU {$m->sku} no tiene variante vinculada.");
        }
        $x = Stock::publicado($s, $m->variant_id);

        return ['sku' => $m->sku, 'producto' => DB::table('product_variants')->where('id', $m->variant_id)->value('name'), 'formula' => Stock::formula($x),
            'enviado' => $m->last_stock_sent, 'enviado_at' => $m->last_stock_at, 'variant_id' => $m->variant_id] + $x;
    }

    public static function plano(?string $t): string
    {
        $t = mb_strtolower(trim((string) $t));

        return strtr($t, ['á' => 'a', 'é' => 'e', 'í' => 'i', 'ó' => 'o', 'ú' => 'u', 'ü' => 'u', 'ñ' => 'n']);
    }
}
