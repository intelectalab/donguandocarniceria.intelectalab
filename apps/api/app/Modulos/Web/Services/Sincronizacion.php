<?php

namespace App\Modulos\Web\Services;

use App\Models\User;
use App\Modulos\Int\Services\Conectores;
use App\Modulos\Web\Services\Proveedores\WooCommerce;
use App\Support\Events;
use App\Support\Paginas;
use App\Support\RuleError;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * WEB-03 Sincronización: catálogo, precios y stock hacia WooCommerce y la consulta de respaldo de pedidos.
 * RN-WEB-05: el stock se publica cada web_stock_sync_minutes y después de cada venta (pedido confirmado o anulado,
 * salida de almacén). La consulta de respaldo corre cada web_order_poll_minutes, reintenta los pedidos con error
 * (RN-WEB-04) y vence los pagos pendientes. Cada corrida deja su detalle por SKU.
 */
final class Sincronizacion
{
    public const BANDERA = ['CATALOG' => 'sync_catalog', 'PRICES' => 'sync_prices', 'STOCK' => 'sync_stock', 'ORDERS' => 'sync_orders'];

    /**
     * Corre una sincronización. $skus: variantes o SKU a enviar (null = todos). Con trigger SALE y nada que enviar no
     * deja corrida (devuelve null).
     */
    public static function correr(string $storeId, string $tipo, string $origen = 'MANUAL', ?array $skus = null, ?User $u = null): ?object
    {
        if (! isset(self::BANDERA[$tipo])) {
            RuleError::fail('RN-WEB-05', 'Elige qué sincronizar: catálogo, precios, stock o pedidos.');
        }
        if (! isset(Base::ORIGENES[$origen])) {
            RuleError::fail('RN-WEB-05', 'Origen de la corrida no válido.');
        }
        $s = $u && $u->id ? Base::tiendaDe($u, $storeId) : Base::tienda($storeId);
        if (! in_array($s->status, ['ACTIVE', 'TESTING'], true)) {
            RuleError::fail('RN-WEB-05', "La tienda {$s->name} está «".Base::ESTADOS_TIENDA[$s->status].'»: prueba la conexión y actívala en Tiendas (WEB-01).');
        }
        if (! $s->{self::BANDERA[$tipo]}) {
            RuleError::fail('RN-WEB-05', "{$s->name} no sincroniza ".mb_strtolower(Base::TIPOS[$tipo]).' (configúralo en Tiendas, WEB-01).');
        }
        $c = $s->connector_id ? DB::table('integration_connectors')->where('id', $s->connector_id)->first() : null;
        if (! $c) {
            RuleError::fail('RN-WEB-10', "{$s->name} no tiene conector de WooCommerce: créalo en Integraciones (INT) y elígelo en la tienda.");
        }
        $inicio = now();
        $caida = $c->status === 'DISABLED' ? 'El conector de WooCommerce está desactivado en Integraciones (INT)' : null;

        if ($tipo === 'ORDERS') {
            [$items, $detalle, $caida] = self::pedidos($s, $c, $caida);
        } else {
            [$items, $detalle, $caida] = self::productos($s, $c, $tipo, $origen, $skus, $caida);
        }
        if ($origen === 'SALE' && ! $items) {
            return null;
        }
        if (! WooCommerce::dePrueba($c) && $c->status !== 'DISABLED') {
            Conectores::reportar($c->id, ! $caida, $caida ? mb_substr($caida, 0, 255) : null);
        }
        $ok = count(array_filter($items, fn ($i) => $i['result'] === 'OK'));
        $mal = count(array_filter($items, fn ($i) => $i['result'] === 'ERROR'));
        $estado = $caida || ($mal && ! $ok) ? 'FAILED' : ($mal ? 'PARTIAL' : 'COMPLETED');
        $id = DB::transaction(function () use ($s, $tipo, $origen, $inicio, $estado, $ok, $mal, $items, $detalle, $u) {
            DB::select('SELECT pg_advisory_xact_lock(hashtext(?))', ['web:corrida:'.DB::selectOne('SELECT app_tenant_id() AS t')->t]);
            $n = (int) DB::table('web_sync_runs')->selectRaw("max(nullif(regexp_replace(number, '\\D', '', 'g'), '')::int) as n")->value('n');

            return DB::table('web_sync_runs')->insertGetId([
                'number' => 'WS-'.str_pad((string) ($n + 1), 6, '0', STR_PAD_LEFT), 'store_id' => $s->id, 'kind' => $tipo, 'trigger' => $origen,
                'started_at' => $inicio, 'finished_at' => now(), 'status' => $estado, 'items_ok' => $ok, 'items_failed' => $mal,
                'items' => Base::enc(array_map(fn ($i) => array_diff_key($i, ['nuevo' => 1]), $items)), 'detail' => mb_substr($detalle, 0, 255),
                'triggered_by' => mb_substr($origen === 'MANUAL' ? ($u?->name ?? 'Sistema') : ($origen === 'SALE' ? 'Venta registrada' : 'Programador de tareas'), 0, 80),
                'created_at' => now(),
            ], 'id');
        });
        Events::emit('web_sync.finished', 'web_sync_runs', $id, ['store' => $s->code, 'kind' => $tipo, 'status' => $estado, 'ok' => $ok, 'failed' => $mal]);

        return DB::table('web_sync_runs')->where('id', $id)->first();
    }

    /** Consulta de respaldo: pedidos de las últimas 24 h, reintentos automáticos y pagos pendientes vencidos. */
    private static function pedidos(object $s, object $c, ?string $caida): array
    {
        $items = [];
        if (! $caida) {
            try {
                $remotos = WooCommerce::pedidos($c, $s, now('America/Lima')->subDay()->format('Y-m-d\TH:i:s'));
            } catch (\Throwable $e) {
                $caida = mb_substr($e->getMessage(), 0, 250);
                $remotos = [];
            }
            foreach ($remotos as $p) {
                $ext = (string) (($p['number'] ?? '') !== '' ? $p['number'] : ($p['id'] ?? '?'));
                try {
                    $r = Bandeja::registrar($s, $p, 'POLL');
                    $ib = $r['inbox'];
                    $nums = DB::table('sales_orders')->whereIn('id', Base::json($ib->order_ids) ?: ['00000000-0000-0000-0000-000000000000'])->orderBy('number')->pluck('number')->all();
                    $items[] = ['sku' => "#{$ext}", 'result' => 'OK', 'nuevo' => ! $r['duplicado'],
                        'detail' => $r['duplicado'] ? 'Ya estaba en la bandeja ('.mb_strtolower(Base::ESTADOS_BANDEJA[$ib->status]).'): mismo registro, sin duplicar'
                            : 'Recuperado por la consulta de respaldo: '.mb_strtolower(Base::ESTADOS_BANDEJA[$ib->status]).($nums ? ' · '.implode(', ', $nums) : '')];
                } catch (\Throwable $e) {
                    $items[] = ['sku' => "#{$ext}", 'result' => 'ERROR', 'detail' => mb_substr($e->getMessage(), 0, 250)];
                }
            }
        }
        $max = Base::param('web_order_retry_max', 5);
        $pendientes = DB::table('web_order_inbox')->where('store_id', $s->id)->where('manual_only', false)
            ->where(fn ($q) => $q->where('status', 'ERROR')->orWhere(fn ($w) => $w->where('status', 'RECEIVED')->where('received_at', '<', now()->subMinutes(2))))
            ->orderBy('received_at')->limit(50)->pluck('id');
        foreach ($pendientes as $id) {
            $r = Bandeja::procesar($id, true);
            $items[] = ['sku' => "#{$r->external_order_id}", 'result' => $r->status === 'PROCESSED' ? 'OK' : 'ERROR',
                'detail' => $r->status === 'PROCESSED' ? 'Reintento automático: procesado'
                    : "Reintento automático {$r->auto_attempts} de {$max}: {$r->error_code}".($r->manual_only ? ' · queda solo para reproceso manual (RN-WEB-04)' : '')];
        }
        foreach (Pagos::vencerPendientes($s->id) as $tx) {
            $items[] = ['sku' => "MP {$tx->external_payment_id}", 'result' => 'OK',
                'detail' => 'Pago pendiente vencido ('.Base::param('web_mp_pending_expire_hours', 48)." h) del pedido web #{$tx->external_reference}"];
        }
        $revisados = count(array_filter($items, fn ($i) => str_starts_with($i['sku'], '#')));
        $nuevos = count(array_filter($items, fn ($i) => ! empty($i['nuevo'])));
        $detalle = $caida ? 'WooCommerce no respondió: '.$caida : "{$revisados} pedido(s) revisados · {$nuevos} recuperado(s)";
        if ($caida) {
            array_unshift($items, ['sku' => '—', 'result' => 'ERROR', 'detail' => $caida]);
        }

        return [$items, $detalle, $caida];
    }

    /** Catálogo, precios o stock de los productos vinculados. */
    private static function productos(object $s, object $c, string $tipo, string $origen, ?array $skus, ?string $caida): array
    {
        $q = DB::table('web_product_mappings')->where('store_id', $s->id)->orderBy('sku');
        if ($skus !== null) {
            $q->where(fn ($w) => $w->whereIn('variant_id', array_values(array_filter($skus, fn ($x) => preg_match('/^[0-9a-f-]{36}$/i', (string) $x))) ?: ['00000000-0000-0000-0000-000000000000'])
                ->orWhereIn(DB::raw('upper(sku)'), array_map(fn ($x) => mb_strtoupper((string) $x), $skus) ?: ['']));
        }
        $maps = $q->get();
        $stock = $tipo === 'STOCK' ? Stock::publicados($s, $maps->pluck('variant_id')->filter()->all()) : [];
        $manual = $origen === 'MANUAL';
        $items = [];
        foreach ($maps as $m) {
            $v = Base::variante($m->variant_id);
            if ($tipo === 'CATALOG') {
                if ($m->status === 'UNLINKED' || ! $v) {
                    $items[] = ['sku' => $m->sku, 'mapping_id' => $m->id, 'result' => 'SKIPPED', 'detail' => 'SKU de la web sin vínculo con el catálogo (Mapeo, WEB-02)'];

                    continue;
                }
            } elseif ($m->status === 'UNLINKED' || ! $v || ! $m->publish) {
                continue;
            }
            $base = ['sku' => $m->sku, 'variant_id' => $v->id, 'mapping_id' => $m->id];
            if ($m->remote_missing) {
                $items[] = $base + ['result' => 'ERROR', 'detail' => "woocommerce_rest_product_invalid_id: el producto {$m->woo_product_id} ya no existe en WooCommerce; usa «Crear en la web»"];

                continue;
            }
            if ($tipo === 'CATALOG') {
                $destino = $m->publish && Base::varianteActiva($v) && Base::publicable($v) ? 'publish' : 'draft';
                if (! $manual && $m->web_status === $destino) {
                    continue;
                }
                $items[] = $base + ['result' => 'OK', 'old' => $m->web_status ?: '—', 'new' => $destino, 'campo' => 'status',
                    'detail' => "{$v->name} · ".($destino === 'publish' ? 'publicado' : 'borrador (no visible)')];
            } elseif ($tipo === 'PRICES') {
                $wp = Base::precioWeb($s, $v);
                if (! $wp) {
                    $items[] = $base + ['result' => 'ERROR', 'detail' => 'RN-CAT-05: sin precio vigente en la lista de la tienda para '.$v->name];

                    continue;
                }
                if (! $manual && $m->last_price_sent !== null && abs((float) $m->last_price_sent - $wp['woo']) < 0.005) {
                    continue;
                }
                $items[] = $base + ['result' => 'OK', 'old' => $m->last_price_sent !== null ? (float) $m->last_price_sent : null, 'new' => $wp['woo'], 'campo' => 'price',
                    'detail' => Base::soles($wp['woo']).' por '.Base::unidadWeb($v).($v->sale_mode === 'UNIT_VARIABLE_WEIGHT' ? ' ('.Base::soles($wp['price']).'/kg)' : '')];
            } else {
                $x = $stock[$v->id] ?? null;
                $pub = $x['publicado'] ?? 0;
                if (! $manual && $m->last_stock_sent !== null && (int) $m->last_stock_sent === $pub) {
                    continue;
                }
                $items[] = $base + ['result' => 'OK', 'old' => $m->last_stock_sent !== null ? (int) $m->last_stock_sent : null, 'new' => $pub, 'campo' => 'stock',
                    'detail' => $x ? Stock::formula($x) : 'Sin saldo en los almacenes de la tienda'];
            }
        }

        // Los vinculados a mano todavía sin id de WooCommerce: se buscan por SKU antes de enviar.
        $porEnviar = [];
        foreach ($items as $k => $i) {
            if ($i['result'] !== 'OK') {
                continue;
            }
            $m = $maps->firstWhere('id', $i['mapping_id']);
            if (! $caida && (int) $m->woo_product_id === 0) {
                try {
                    $ids = WooCommerce::buscarPorSku($c, $m->sku);
                } catch (\Throwable $e) {
                    $caida = mb_substr($e->getMessage(), 0, 250);
                    $ids = null;
                }
                if ($caida) {
                    break;
                }
                if (! $ids) {
                    $items[$k] = ['result' => 'ERROR', 'detail' => "El SKU {$m->sku} no existe en WooCommerce: usa «Crear en la web» en Mapeo (WEB-02)"] + $i;
                    DB::table('web_product_mappings')->where('id', $m->id)->update(['remote_missing' => true, 'updated_at' => now()]);

                    continue;
                }
                DB::table('web_product_mappings')->where('id', $m->id)->update(['woo_product_id' => $ids[0], 'woo_variation_id' => $ids[1] ?: null, 'updated_at' => now()]);
                $m->woo_product_id = $ids[0];
                $m->woo_variation_id = $ids[1] ?: null;
            }
            $porEnviar[] = ['mapping_id' => $m->id, 'woo_product_id' => (int) $m->woo_product_id, 'woo_variation_id' => (int) ($m->woo_variation_id ?? 0), $i['campo'] => $i['new']];
        }
        $errores = [];
        if (! $caida && $porEnviar) {
            try {
                $errores = WooCommerce::actualizar($c, $porEnviar);
            } catch (\Throwable $e) {
                $caida = mb_substr($e->getMessage(), 0, 250);
            }
        }
        $cuando = now();
        foreach ($items as $k => $i) {
            if ($i['result'] === 'OK' && $caida) {
                $items[$k]['result'] = 'ERROR';
                $items[$k]['detail'] = $caida.'; se reintenta en la próxima corrida';
            } elseif ($i['result'] === 'OK' && ! empty($errores[$i['mapping_id']])) {
                $items[$k]['result'] = 'ERROR';
                $items[$k]['detail'] = $errores[$i['mapping_id']];
            }
            $i = $items[$k];
            unset($items[$k]['campo']);
            if (empty($i['mapping_id'])) {
                continue;
            }
            if ($i['result'] === 'OK') {
                $cambio = match ($tipo) {
                    'PRICES' => ['last_price_sent' => $i['new'], 'last_price_at' => $cuando],
                    'STOCK' => ['last_stock_sent' => $i['new'], 'last_stock_at' => $cuando],
                    default => ['web_status' => $i['new'], 'last_catalog_at' => $cuando],
                };
                $m = $maps->firstWhere('id', $i['mapping_id']);
                if ($m->status === 'ERROR') {
                    $cambio += ['status' => 'LINKED', 'last_error' => null];
                }
                DB::table('web_product_mappings')->where('id', $i['mapping_id'])->update($cambio + ['updated_at' => now()]);
            } elseif ($i['result'] === 'ERROR' && ! $caida) {
                DB::table('web_product_mappings')->where('id', $i['mapping_id'])->update(['status' => 'ERROR', 'last_error' => mb_substr($i['detail'], 0, 255), 'last_error_at' => $cuando, 'updated_at' => now()]);
            }
        }
        $items = array_values($items);
        if ($tipo === 'CATALOG' && ! $caida) {
            // CAT-09: los productos que quedaron al día en la web pasan a «sincronizado» (CAT deja el cambio pendiente para WEB).
            $conError = array_column(array_filter($items, fn ($i) => $i['result'] === 'ERROR'), 'variant_id');
            $vs = $maps->pluck('variant_id')->filter()->reject(fn ($v) => in_array($v, $conError, true))->all();
            if ($vs) {
                DB::table('products')->where('web_sync_status', 'PENDING')
                    ->whereIn('id', DB::table('product_variants')->whereIn('id', $vs)->select('product_id'))
                    ->update(['web_sync_status' => DB::raw("CASE WHEN web_publishable THEN 'SYNCED' ELSE 'NOT_PUBLISHED' END"), 'web_synced_at' => now(), 'updated_at' => now()]);
            }
        }
        $ok = count(array_filter($items, fn ($i) => $i['result'] === 'OK'));
        $mal = count(array_filter($items, fn ($i) => $i['result'] === 'ERROR'));
        $detalle = $caida ? 'WooCommerce no respondió: '.$caida : (! $items ? 'Sin cambios que enviar' : "{$ok} SKU enviados".($mal ? " · {$mal} con error" : ''));

        return [$items, $detalle, $caida];
    }

    /* ------------------------------------------------------------------ programador (cada minuto) */

    /** Lo que toca correr ahora en cada tienda activa o en prueba. Devuelve un resumen por tienda. */
    public static function programado(?CarbonImmutable $ahora = null): array
    {
        $ahora ??= CarbonImmutable::now();
        $cadaStock = max(1, Base::param('web_stock_sync_minutes', 10));
        $cadaPoll = max(1, Base::param('web_order_poll_minutes', 15));
        $out = [];
        foreach (DB::table('web_stores')->whereIn('status', ['ACTIVE', 'TESTING'])->whereNotNull('connector_id')->orderBy('name')->get() as $s) {
            $ultima = fn (string $tipo, ?string $origen = null) => DB::table('web_sync_runs')->where('store_id', $s->id)->where('kind', $tipo)
                ->when($origen, fn ($q) => $q->where('trigger', $origen))->max('started_at');
            $hecho = [];
            try {
                if ($s->sync_stock) {
                    $u = $ultima('STOCK');
                    if (! $u || CarbonImmutable::parse($u)->addMinutes($cadaStock)->lessThanOrEqualTo($ahora)) {
                        $r = self::correr($s->id, 'STOCK', 'SCHEDULE');
                        $hecho[] = "stock {$r->number}";
                    } elseif ($vs = self::vendidoDesde($u)) {
                        $r = self::correr($s->id, 'STOCK', 'SALE', $vs);
                        if ($r) {
                            $hecho[] = "stock tras venta {$r->number}";
                        }
                    }
                }
                if ($s->sync_catalog && ($u = $ultima('CATALOG')) && ($vs = self::cambiosDeCatalogo($u))) {
                    $r = self::correr($s->id, 'CATALOG', 'SCHEDULE', $vs);
                    if ($r) {
                        $hecho[] = "catálogo {$r->number}";
                    }
                }
                if ($s->sync_prices) {
                    $u = $ultima('PRICES', 'SCHEDULE');
                    if (! $u || CarbonImmutable::parse($u)->addHour()->lessThanOrEqualTo($ahora)) {
                        $r = self::correr($s->id, 'PRICES', 'SCHEDULE');
                        $hecho[] = "precios {$r->number}";
                    }
                }
                if ($s->sync_orders) {
                    $u = $ultima('ORDERS');
                    if (! $u || CarbonImmutable::parse($u)->addMinutes($cadaPoll)->lessThanOrEqualTo($ahora)) {
                        $r = self::correr($s->id, 'ORDERS', 'SCHEDULE');
                        $hecho[] = "pedidos {$r->number}";
                    }
                }
                foreach (DB::table('web_order_inbox')->where('store_id', $s->id)->where('status', 'PROCESSED')->where('warning_code', 'ADDRESS_NO_PIN')
                    ->where('received_at', '>', $ahora->subDays(3))->get() as $ib) {
                    if (Bandeja::usarUbicacionRecibida($ib, Base::sistema('Enlace de ubicación'))) {
                        $hecho[] = "pin recibido #{$ib->external_order_id}";
                    }
                }
            } catch (\Throwable $e) {
                $hecho[] = 'error: '.mb_substr($e->getMessage(), 0, 200);
            }
            $out[$s->code] = $hecho;
        }
        $vencidos = count(Pagos::vencerPendientes());
        if ($vencidos) {
            $out['MP'] = ["{$vencidos} pago(s) pendientes vencidos"];
        }

        return $out;
    }

    /** Variantes vendidas, reservadas o liberadas desde la última corrida de stock (RN-WEB-05: «después de cada venta»). */
    private static function vendidoDesde(string $desde): array
    {
        $ev = DB::table('domain_events')->where('occurred_at', '>', $desde)
            ->whereIn('event_name', ['order.confirmed', 'order.cancelled', 'stock.moved'])->get(['event_name', 'aggregate_id', 'payload']);
        $vs = [];
        $pedidos = [];
        foreach ($ev as $e) {
            if ($e->event_name === 'stock.moved') {
                $p = Base::json($e->payload);
                if (! empty($p['variant_id'])) {
                    $vs[$p['variant_id']] = true;
                }
            } elseif ($e->aggregate_id) {
                $pedidos[] = $e->aggregate_id;
            }
        }
        if ($pedidos) {
            foreach (DB::table('sales_order_lines')->whereIn('sales_order_id', array_unique($pedidos))->distinct()->pluck('variant_id') as $v) {
                $vs[$v] = true;
            }
        }

        return array_keys($vs);
    }

    /** Variantes que CAT cambió (publicar, datos web, estado) desde la última corrida de catálogo (CAT-09: product.changed). */
    private static function cambiosDeCatalogo(string $desde): array
    {
        $vs = [];
        foreach (DB::table('domain_events')->where('occurred_at', '>', $desde)->where('event_name', 'product.changed')->get(['aggregate_type', 'aggregate_id']) as $e) {
            if (! $e->aggregate_id) {
                continue;
            }
            if ($e->aggregate_type === 'product_variants') {
                $vs[$e->aggregate_id] = true;
            } else {
                foreach (DB::table('product_variants')->where('product_id', $e->aggregate_id)->pluck('id') as $v) {
                    $vs[$v] = true;
                }
            }
        }

        return array_keys($vs);
    }

    /* ------------------------------------------------------------------ lectura */

    public static function lista(User $u, array $f): array
    {
        $tiendas = Base::idsTiendasDe($u);
        $q = DB::table('web_sync_runs as r')->join('web_stores as s', 's.id', '=', 'r.store_id')->whereIn('r.store_id', $tiendas)
            ->select('r.id', 'r.number', 'r.store_id', 's.name as tienda', 'r.kind', 'r.trigger', 'r.started_at', 'r.finished_at', 'r.status', 'r.items_ok', 'r.items_failed',
                'r.detail', 'r.triggered_by');
        foreach (['tienda' => 'r.store_id', 'tipo' => 'r.kind', 'estado' => 'r.status', 'origen' => 'r.trigger'] as $k => $col) {
            if (! empty($f[$k])) {
                $q->where($col, $f[$k]);
            }
        }
        $q->orderByDesc('r.started_at');
        $ultimas = [];
        foreach (DB::table('web_stores')->whereIn('id', $tiendas)->orderBy('name')->get() as $s) {
            $fila = ['id' => $s->id, 'name' => $s->name, 'status' => $s->status];
            foreach (array_keys(self::BANDERA) as $t) {
                $r = DB::table('web_sync_runs')->where('store_id', $s->id)->where('kind', $t)->orderByDesc('started_at')->first(['number', 'status', 'started_at']);
                $fila[$t] = ['activo' => (bool) $s->{self::BANDERA[$t]}, 'ultima' => $r];
            }
            $ultimas[] = $fila;
        }

        return Paginas::de($q, fn ($r) => (array) $r, $f) + ['tiendas' => $ultimas, 'cada' => [
            'stock' => Base::param('web_stock_sync_minutes', 10), 'pedidos' => Base::param('web_order_poll_minutes', 15),
        ]];
    }

    public static function ver(string $id, User $u): array
    {
        $r = DB::table('web_sync_runs as r')->join('web_stores as s', 's.id', '=', 'r.store_id')->where('r.id', $id)->first(['r.*', 's.name as tienda']);
        if (! $r || ! in_array($r->store_id, Base::idsTiendasDe($u), true)) {
            abort(404, 'Corrida no encontrada.');
        }
        $r->items = Base::json($r->items);

        return ['corrida' => $r];
    }
}
