<?php

namespace App\Modulos\Web\Services;

use App\Models\User;
use App\Modulos\Cli\Models\Customer;
use App\Modulos\Cli\Models\CustomerAddress;
use App\Modulos\Cli\Services\Celulares;
use App\Modulos\Cli\Services\Clientes;
use App\Modulos\Cli\Services\Direcciones;
use App\Modulos\Cli\Services\Enlaces;
use App\Modulos\Cli\Services\ParaWeb as CliWeb;
use App\Modulos\Ped\Services\ParaWeb as PedWeb;
use App\Modulos\Ped\Services\Pedidos;
use App\Modulos\Cat\Services\Precios;
use App\Support\Events;
use App\Support\Paginas;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * WEB-04 Bandeja de pedidos web y WEB-05 Resolver error.
 *  - RN-WEB-02: un pedido externo entra una sola vez por tienda; reenvíos del webhook y la consulta de respaldo devuelven
 *    el mismo registro y un procesado no crea otro pedido.
 *  - RN-WEB-03: cada línea se traduce por su SKU mapeado; nunca se crea un producto libre.
 *  - RN-WEB-04: un pedido con error queda en la bandeja con su código, avisa a la supervisora y se reprocesa; después de
 *    web_order_retry_max intentos automáticos solo se reprocesa a mano (web.inbox.resolve).
 *  - RN-WEB-07: entra como borrador con canal WEB, marca de sus productos (D-WEB-01: un pedido por marca), UTM y número
 *    externo; sin pin, la vendedora lo completa con el enlace de ubicación (CLI-07).
 *  - RN-WEB-08: se respeta lo cobrado en la web; la diferencia con la lista queda como descuento «Precio web».
 */
final class Bandeja
{
    /** Registra un pedido de WooCommerce (webhook o consulta de respaldo) y lo procesa si es nuevo. */
    public static function registrar(object $s, array $p, string $origen = 'WEBHOOK', ?string $eventoId = null): array
    {
        if (! isset($p['id']) || $p['id'] === '' || ! is_scalar($p['id'])) {
            throw new ErrorPedido('INVALID_PAYLOAD', 'El webhook no trae el número del pedido de WooCommerce.');
        }
        $ext = mb_substr((string) (($p['number'] ?? '') !== '' ? $p['number'] : $p['id']), 0, 20);
        $quien = $origen === 'POLL' ? 'Consulta de respaldo' : 'WooCommerce';

        $r = DB::transaction(function () use ($s, $p, $ext, $origen, $eventoId, $quien) {
            DB::select('SELECT pg_advisory_xact_lock(hashtext(?))', ['web:bandeja:'.$s->id.':'.$ext]);
            $ex = DB::table('web_order_inbox')->where('store_id', $s->id)->where('external_order_id', $ext)->lockForUpdate()->first();
            if ($ex) {
                $cambios = ['updated_at' => now()];
                if ($origen === 'POLL') {
                    $cambios += ['last_polled_at' => now(), 'poll_hits' => DB::raw('poll_hits + 1')];
                } else {
                    $cambios += ['duplicates' => DB::raw('duplicates + 1'), 'last_duplicate_at' => now()];
                }
                if ($eventoId && ! in_array($eventoId, Base::json($ex->webhook_event_ids), true)) {
                    $cambios['webhook_event_ids'] = Base::enc(array_merge(Base::json($ex->webhook_event_ids), [$eventoId]));
                }
                DB::table('web_order_inbox')->where('id', $ex->id)->update($cambios);
                if ($origen !== 'POLL') {
                    $estadoWoo = (string) ($p['status'] ?? '');
                    $antes = (string) (Base::json($ex->payload)['status'] ?? '');
                    Base::anotar('web_order_inbox', $ex->id, ['action' => 'DUPLICATE', 'user' => $quien, 'detail' => "Reenvío del pedido #{$ext}: se devuelve el mismo registro (RN-WEB-02)"
                        .($estadoWoo !== '' && $estadoWoo !== $antes ? " · WooCommerce informa estado «{$estadoWoo}»" : '')]);
                }

                return ['id' => $ex->id, 'duplicado' => true];
            }
            $b = $p['billing'] ?? [];
            $id = DB::table('web_order_inbox')->insertGetId([
                'store_id' => $s->id, 'external_order_id' => $ext, 'received_at' => now(), 'source' => $origen, 'status' => 'RECEIVED',
                'payload' => Base::enc($p), 'total' => Base::r($p['total'] ?? 0), 'customer_name' => mb_substr(trim(($b['first_name'] ?? '').' '.($b['last_name'] ?? '')) ?: 'Cliente web', 0, 80),
                'order_ids' => '[]', 'attempts' => 0, 'auto_attempts' => 0, 'manual_only' => false, 'duplicates' => 0, 'ever_error' => false,
                'webhook_event_ids' => Base::enc($eventoId ? [$eventoId] : []),
                'history' => Base::enc([['at' => now()->toIso8601String(), 'action' => 'RECEIVED', 'user' => $quien,
                    'detail' => $origen === 'POLL' ? 'Recuperado por la consulta de respaldo (el webhook no llegó)' : ($origen === 'MANUAL' ? 'Cargado a mano' : 'Recibido por webhook firmado')]]),
                'created_at' => now(),
            ], 'id');
            Events::emit('web_order.received', 'web_order_inbox', $id, ['store' => $s->code, 'external' => $ext, 'source' => $origen]);

            return ['id' => $id, 'duplicado' => false];
        });
        if (! $r['duplicado']) {
            self::procesar($r['id'], true);
        }

        return ['inbox' => DB::table('web_order_inbox')->where('id', $r['id'])->first(), 'duplicado' => $r['duplicado']];
    }

    /** Intenta crear los pedidos de un registro de la bandeja. $auto: intento automático (cuenta para RN-WEB-04). */
    public static function procesar(string $id, bool $auto = false, ?User $u = null): object
    {
        $ib = DB::table('web_order_inbox')->where('id', $id)->first() ?? abort(404, 'Pedido web no encontrado.');
        if ($ib->status === 'PROCESSED') {
            return $ib;
        }
        if ($ib->status === 'IGNORED') {
            RuleError::fail('RN-WEB-04', "El pedido web #{$ib->external_order_id} está ignorado: no se reprocesa.");
        }
        $s = Base::tienda($ib->store_id);
        $quien = $u?->name ?? 'Sistema';
        $max = Base::param('web_order_retry_max', 5);
        $intentos = (int) $ib->attempts + 1;
        $auto_ = (int) $ib->auto_attempts + ($auto ? 1 : 0);

        try {
            $res = DB::transaction(function () use ($s, $ib) {
                DB::table('web_order_inbox')->where('id', $ib->id)->lockForUpdate()->first();

                return self::construir($s, $ib);
            });
        } catch (\Throwable $e) {
            $codigo = $e instanceof ErrorPedido ? $e->codigo : 'PROCESSING_ERROR';
            $texto = $e instanceof ErrorPedido || $e instanceof RuleError ? $e->getMessage() : 'No se pudo crear el pedido: '.mb_substr($e->getMessage(), 0, 200);
            $primero = $ib->status !== 'ERROR' || $ib->error_code !== $codigo;
            $soloAMano = $auto_ >= $max;
            DB::table('web_order_inbox')->where('id', $ib->id)->update([
                'status' => 'ERROR', 'error_code' => $codigo, 'error_detail' => $texto, 'error_skus' => $e instanceof ErrorPedido && $e->skus ? Base::enc($e->skus) : null,
                'ever_error' => true, 'manual_only' => $soloAMano, 'attempts' => $intentos, 'auto_attempts' => $auto_, 'last_attempt_at' => now(), 'updated_at' => now(),
            ]);
            Base::anotar('web_order_inbox', $ib->id, ['action' => 'ERROR', 'user' => $quien, 'detail' => "{$codigo} · {$texto}"]);
            if ($primero) {
                Base::avisar(['role' => 'SUPERVISORA_VENTAS'], "Pedido web #{$ib->external_order_id} con error", (Base::ERRORES[$codigo] ?? $codigo).": {$texto}", 'WEB-05', $ib->id, 'bad');
            }
            if ($soloAMano && ! $ib->manual_only) {
                Base::avisar(['role' => 'SUPERVISORA_VENTAS'], "Pedido web #{$ib->external_order_id} agotó los reintentos",
                    "{$max} intentos automáticos sin éxito: desde ahora solo se reprocesa a mano en Resolver error.", 'WEB-05', $ib->id, 'bad');
            }

            return DB::table('web_order_inbox')->where('id', $ib->id)->first();
        }

        if (isset($res['ignorado'])) {
            DB::table('web_order_inbox')->where('id', $ib->id)->update(['status' => 'IGNORED', 'ignore_reason' => mb_substr($res['ignorado'], 0, 255),
                'attempts' => $intentos, 'auto_attempts' => $auto_, 'last_attempt_at' => now(), 'updated_at' => now()]);
            Base::anotar('web_order_inbox', $ib->id, ['action' => 'IGNORED', 'user' => $quien, 'detail' => $res['ignorado']]);

            return DB::table('web_order_inbox')->where('id', $ib->id)->first();
        }

        $numeros = implode(', ', array_column($res['pedidos'], 'number'));
        $varios = count($res['pedidos']) > 1;
        DB::table('web_order_inbox')->where('id', $ib->id)->update([
            'status' => 'PROCESSED', 'processed_at' => now(), 'error_code' => null, 'error_detail' => null, 'error_skus' => null, 'manual_only' => false,
            'order_ids' => Base::enc(array_column($res['pedidos'], 'id')), 'customer_id' => $res['cliente']->id, 'address_id' => $res['direccion']?->id,
            'warning_code' => $res['sin_pin'] ? 'ADDRESS_NO_PIN' : null, 'missing' => $res['faltan'] ? Base::enc($res['faltan']) : null,
            'attempts' => $intentos, 'auto_attempts' => $auto_, 'last_attempt_at' => now(), 'updated_at' => now(),
        ]);
        Base::anotar('web_order_inbox', $ib->id, ['action' => 'PROCESSED', 'user' => $quien, 'detail' => ($varios ? "Pedidos {$numeros} creados" : "Pedido {$numeros} creado")
            .' en borrador'.($varios ? ' (un pedido por marca, con el mismo pago)' : '')]);
        if ($res['notas_precio']) {
            Base::anotar('web_order_inbox', $ib->id, ['action' => 'PRICE', 'user' => 'Sistema', 'detail' => 'Precio web (RN-WEB-08): '.implode('; ', $res['notas_precio'])]);
        }
        if ($res['sin_pin']) {
            Base::anotar('web_order_inbox', $ib->id, ['action' => 'LINK', 'user' => 'Sistema',
                'detail' => 'La dirección llegó sin pin: '.($res['enlace'] ? 'se creó el enlace de ubicación para el cliente (CLI-07)' : 'falta crear el enlace de ubicación (CLI-07)')]);
            if ($s->default_seller_id) {
                Base::avisar(['user_id' => $s->default_seller_id], "Pedido web #{$ib->external_order_id} sin pin",
                    "Completa la ubicación de {$res['cliente']->full_name} para confirmar {$numeros}: marca el pin o envíale el enlace.", 'WEB-05', $ib->id, 'warn');
            }
        }
        Events::emit('web_order.processed', 'web_order_inbox', $ib->id, ['orders' => array_column($res['pedidos'], 'id'), 'external' => $ib->external_order_id]);
        // Un pago aprobado que esperaba el pedido se registra ahora (RN-WEB-06).
        Pagos::alCrearPedidos($ib->id);

        return DB::table('web_order_inbox')->where('id', $ib->id)->first();
    }

    /** Arma los pedidos de un registro. Lanza ErrorPedido con el código de la bandeja. */
    private static function construir(object $s, object $ib): array
    {
        $p = Base::json($ib->payload);
        $ov = Base::json($ib->overrides);
        $estadoWoo = (string) ($p['status'] ?? '');
        if (in_array($estadoWoo, ['cancelled', 'failed', 'refunded', 'trash'], true)) {
            return ['ignorado' => "WooCommerce informa el pedido como «{$estadoWoo}»: no se crea pedido."];
        }
        $lineas = $p['line_items'] ?? [];
        if (! is_array($lineas) || ! $lineas) {
            throw new ErrorPedido('INVALID_PAYLOAD', 'El pedido web llegó sin productos.');
        }
        $b = $p['billing'] ?? [];
        $sh = $p['shipping'] ?? [];
        $crudo = $ov['phone'] ?? ($b['phone'] ?? ($sh['phone'] ?? null));
        $celular = Celulares::normalizar(is_scalar($crudo) ? (string) $crudo : null);
        if (! $celular || ! Celulares::valido($celular)) {
            throw new ErrorPedido('PHONE_INVALID', 'El celular «'.($crudo ?: 'vacío').'» no es válido (9 dígitos que empiezan con 9). Confírmalo con el cliente'
                .(! empty($b['email']) ? " ({$b['email']})" : '').', corrígelo y reprocesa.');
        }

        // RN-WEB-03: traducción por SKU mapeado
        $errores = [];
        $ok = [];
        foreach ($lineas as $i => $li) {
            $sku = mb_strtoupper(trim((string) ($li['sku'] ?? '')));
            $nombre = (string) ($li['name'] ?? 'línea '.($i + 1));
            $m = $sku !== '' ? DB::table('web_product_mappings')->where('store_id', $s->id)->whereRaw('upper(sku) = ?', [$sku])->first() : null;
            if (! $m || $m->status === 'UNLINKED' || ! $m->variant_id) {
                $errores[] = ['SKU_NOT_MAPPED', '«'.($sku ?: 'sin SKU')."» ({$nombre})", $sku];

                continue;
            }
            $v = Base::variante($m->variant_id);
            if (! Base::varianteActiva($v)) {
                $errores[] = ['VARIANT_INACTIVE', "«{$sku}» → ".($v->name ?? 'variante'), $sku];

                continue;
            }
            if (! Precios::vigente($v->id, ['canal' => 'WEB', 'marca' => $v->brand_id, 'cantidad' => (float) ($li['quantity'] ?? 1)])) {
                $errores[] = ['PRICE_MISSING', "«{$sku}» → {$v->name}", $sku];

                continue;
            }
            $qty = (float) ($li['quantity'] ?? 1);
            if ($qty <= 0) {
                throw new ErrorPedido('INVALID_PAYLOAD', "La línea «{$nombre}» llegó sin cantidad.");
            }
            $ok[] = ['v' => $v, 'qty' => $qty, 'web_total' => isset($li['total']) && $li['total'] !== '' ? (float) $li['total'] : null, 'sku' => $sku];
        }
        if ($errores) {
            $codigo = $errores[0][0];
            $mismos = array_values(array_filter($errores, fn ($e) => $e[0] === $codigo));
            $lista = implode(', ', array_column($mismos, 1));
            $msg = match ($codigo) {
                'SKU_NOT_MAPPED' => "{$lista} sin mapeo en {$s->name}. Vincúlalo a una variante del catálogo (Mapeo de productos) y reprocesa; nunca se crea un producto libre.",
                'VARIANT_INACTIVE' => "{$lista} está inactiva en el catálogo. Vincula el SKU a otra variante activa o reactívala en Catálogo y reprocesa.",
                default => "{$lista} no tiene precio vigente para la web (RN-CAT-05): agrégalo a una lista con canal WEB y reprocesa.",
            };
            throw new ErrorPedido($codigo, $msg, array_values(array_filter(array_column($mismos, 2))));
        }

        $sistema = Base::sistema('Tienda web · '.$s->name);
        $meta = [];
        foreach ($p['meta_data'] ?? [] as $x) {
            if (isset($x['key'])) {
                $meta[$x['key']] = $x['value'] ?? null;
            }
        }
        $cliente = self::cliente($p, $meta, $celular, $sistema);
        $recojo = collect($p['shipping_lines'] ?? [])->contains(fn ($x) => ($x['method_id'] ?? '') === 'local_pickup');
        $dir = $recojo ? null : self::direccion($cliente, $p, $meta, $celular);
        $zona = $dir?->zone_id ? DB::table('delivery_zones')->where('id', $dir->zone_id)->first(['establishment_id']) : null;
        $local = $zona?->establishment_id ?: $s->establishment_id;
        $franja = ! empty($meta['_delivery_slot']) ? DB::table('order_time_slots')->where('establishment_id', $local)->whereNull('zone_id')
            ->where('name', (string) $meta['_delivery_slot'])->where('status', 'ACTIVE')->value('id') : null;
        $fecha = ! empty($meta['_delivery_date']) && preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $meta['_delivery_date']) ? $meta['_delivery_date'] : null;
        $utm = ! empty($meta['_wc_order_attribution_utm_source']) ? array_filter(['source' => $meta['_wc_order_attribution_utm_source'],
            'medium' => $meta['_wc_order_attribution_utm_medium'] ?? null, 'campaign' => $meta['_wc_order_attribution_utm_campaign'] ?? null,
            'content' => $meta['_wc_order_attribution_utm_content'] ?? null]) : null;
        $anuncio = ($utm['content'] ?? null) && DB::getSchemaBuilder()->hasTable('ad_ads') && DB::table('ad_ads')->where('code', $utm['content'])->exists() ? $utm['content'] : null;
        $codigoMedio = Base::MEDIOS_WOO[$p['payment_method'] ?? ''] ?? (! empty($p['payment_method']) ? 'MP' : null);
        $medio = $codigoMedio ? DB::table('payment_methods')->where('code', $codigoMedio)->where('status', 'ACTIVE')->value('id') : null;
        $doc = mb_strtolower((string) ($meta['_billing_document'] ?? '')) === 'factura' ? 'INVOICE' : 'RECEIPT';
        $nota = trim((string) ($p['customer_note'] ?? ''));

        // D-WEB-01: un pedido por marca, primero la de la tienda
        $grupos = [];
        foreach ($ok as $l) {
            $grupos[$l['v']->brand_id][] = $l;
        }
        uksort($grupos, fn ($a, $b) => $a === $s->brand_id ? -1 : ($b === $s->brand_id ? 1 : strcmp($a, $b)));
        $varios = count($grupos) > 1;
        $pedidos = [];
        $notasPrecio = [];
        $k = 0;
        foreach ($grupos as $marca => $ls) {
            $k++;
            $ref = $varios ? "WC-{$ib->external_order_id}/{$k}" : "WC-{$ib->external_order_id}";
            $datos = [
                'brand_id' => $marca, 'channel' => 'WEB', 'customer_id' => $cliente->id, 'fulfillment' => $recojo ? 'PICKUP' : 'DELIVERY',
                'address_id' => $dir?->id, 'delivery_date' => $fecha, 'slot_id' => $franja, 'payment_method_id' => $medio, 'requested_doc_type' => $doc,
                'notes' => $nota !== '' ? mb_substr($nota, 0, 1000) : 'Pedido web sin indicaciones', 'contact_phone' => $celular,
                'lines' => array_map(fn ($l) => ['variant_id' => $l['v']->id, 'qty' => $l['qty']], $ls),
                'origin_utm' => $utm ?: null, 'origin_ad_code' => $anuncio, 'external_ref' => $ref, 'origin_locked' => true,
                'pickup_establishment_id' => $recojo ? $s->establishment_id : null,
            ];
            if (! $zona) {
                $datos['establishment_id'] = $s->establishment_id;
            }
            $actor = self::actor($s, $sistema);
            $o = Pedidos::guardar(null, $datos, $actor);
            PedWeb::enlazar($o->id, $s->id, $ib->id, $varios && $k > 1 && ! $recojo ? "WC-{$ib->external_order_id}/1" : null);

            // RN-WEB-08: se respeta lo cobrado en la web
            $descuento = 0.0;
            $lineasPedido = DB::table('sales_order_lines')->where('sales_order_id', $o->id)->get(['variant_id', 'est_amount']);
            foreach ($ls as $l) {
                $lp = $lineasPedido->firstWhere('variant_id', $l['v']->id);
                if (! $lp || $l['web_total'] === null || $l['web_total'] < 0) {
                    continue;
                }
                $dif = Base::r((float) $lp->est_amount - $l['web_total']);
                if (abs($dif) < 0.01) {
                    continue;
                }
                if ($dif > 0) {
                    $descuento += $dif;
                }
                $notasPrecio[] = "{$l['sku']}: lista ".Base::soles((float) $lp->est_amount).' → cobrado '.Base::soles($l['web_total'])
                    .($dif > 0 ? ' (descuento '.Base::soles($dif).')' : ' (la web cobró '.Base::soles(-$dif).' más; el pedido queda con el precio de la lista)');
            }
            if ($descuento > 0.004) {
                PedWeb::descuentoPrecioWeb($o->id, $descuento);
            }
            $pedidos[] = Pedidos::pedido($o->id);
        }

        $faltan = [];
        foreach ($pedidos as $o) {
            foreach (Pedidos::faltantes($o) as $f) {
                $faltan[$f['codigo']] = true;
            }
        }
        $faltan = array_keys($faltan);
        $sinPin = in_array('DIRECCION_CON_PIN', $faltan, true) && $dir !== null;
        $enlace = false;
        if ($sinPin) {
            try {
                Enlaces::crear($cliente, $sistema);
                $enlace = true;
            } catch (\Throwable) {
                $enlace = false;
            }
        }

        return ['pedidos' => $pedidos, 'cliente' => $cliente, 'direccion' => $dir, 'faltan' => $faltan, 'sin_pin' => $sinPin, 'enlace' => $enlace, 'notas_precio' => $notasPrecio];
    }

    /** Quien crea el pedido: la vendedora por defecto de la tienda (queda como su vendedora), con el nombre de la tienda en el historial. */
    private static function actor(object $s, User $sistema): User
    {
        if (! $s->default_seller_id) {
            return $sistema;
        }
        $v = User::find($s->default_seller_id);
        if (! $v || $v->status !== 'ACTIVE') {
            return $sistema;
        }
        $v->name = 'Tienda web · '.$s->name;

        return $v;
    }

    private static function cliente(array $p, array $meta, string $celular, User $sistema): Customer
    {
        if ($c = Clientes::buscarPorCelular($celular)) {
            return $c;
        }
        $b = $p['billing'] ?? [];
        $doc = preg_replace('/\D/', '', (string) ($meta['_billing_dni'] ?? $meta['_billing_ruc'] ?? ''));
        $tipo = strlen($doc) === 8 ? 'DNI' : (strlen($doc) === 11 ? 'RUC' : 'NONE');
        if ($tipo !== 'NONE' && ($otro = Clientes::buscarPorDocumento($tipo, $doc))) {
            return $otro;
        }
        $nombre = trim(($b['first_name'] ?? '').' '.($b['last_name'] ?? '')) ?: 'Cliente web';
        $correo = filter_var($b['email'] ?? null, FILTER_VALIDATE_EMAIL) ?: null;
        try {
            return Clientes::crear([
                'full_name' => mb_substr($nombre, 0, 120), 'phone' => $celular, 'email' => $correo, 'doc_type' => $tipo, 'doc_number' => $tipo === 'NONE' ? null : $doc,
                'customer_type' => $tipo === 'RUC' ? 'BUSINESS' : 'PERSON', 'source_channel' => 'WEB', 'marketing_opt_in' => ($meta['_marketing_opt_in'] ?? '') === 'yes',
                'seller_user_id' => null,
            ], $sistema)['customer'];
        } catch (RuleError $e) {
            throw new ErrorPedido('PROCESSING_ERROR', 'No se pudo dar de alta al cliente: '.$e->getMessage());
        }
    }

    private static function direccion(Customer $c, array $p, array $meta, string $celular): ?CustomerAddress
    {
        $sh = $p['shipping'] ?? [];
        $linea = trim((string) ($sh['address_1'] ?? ''));
        if ($linea === '') {
            return null;
        }
        if ($igual = CliWeb::direccionIgual($c->id, $linea)) {
            return $igual;
        }
        $ref = trim((string) ($sh['address_2'] ?? ''));
        $distrito = trim((string) ($sh['city'] ?? ''));
        $contacto = trim(($sh['first_name'] ?? '').' '.($sh['last_name'] ?? ''));
        $lat = isset($meta['_shipping_lat']) && is_numeric($meta['_shipping_lat']) ? (float) $meta['_shipping_lat'] : null;
        $lng = isset($meta['_shipping_lng']) && is_numeric($meta['_shipping_lng']) ? (float) $meta['_shipping_lng'] : null;
        if ($lat !== null && $lng !== null) {
            try {
                return DB::transaction(fn () => Direcciones::guardar($c, ['label' => 'Web', 'address_line' => $linea, 'reference' => $ref, 'district' => $distrito,
                    'lat' => $lat, 'lng' => $lng, 'pin_source' => 'MAP', 'geocode_confidence' => 1, 'contact_name' => $contacto, 'contact_phone' => $celular])['direccion']);
            } catch (RuleError) {
                // Pin fuera del Perú, referencia corta o sin distrito: queda por completar como si no trajera pin.
            }
        }

        return CliWeb::direccionSinPin($c, ['address_line' => $linea, 'reference' => $ref, 'district' => $distrito, 'contact_name' => $contacto, 'contact_phone' => $celular]);
    }

    /* ------------------------------------------------------------------ WEB-05: acciones */

    public static function reprocesar(string $id, User $u): array
    {
        $ib = self::visible($id, $u);
        if (! in_array($ib->status, ['ERROR', 'RECEIVED'], true)) {
            RuleError::fail('RN-WEB-02', "El pedido web #{$ib->external_order_id} ya está ".mb_strtolower(Base::ESTADOS_BANDEJA[$ib->status]).': no se crea otro pedido.');
        }
        Base::anotar('web_order_inbox', $ib->id, ['action' => 'RETRY', 'user' => $u->name, 'detail' => 'Reproceso a mano']);
        self::procesar($ib->id, false, $u);

        return self::ver($ib->id, $u);
    }

    public static function ignorar(string $id, ?string $motivo, User $u): array
    {
        $ib = self::visible($id, $u);
        if (! in_array($ib->status, ['ERROR', 'RECEIVED'], true)) {
            RuleError::fail('RN-WEB-04', 'Solo se ignora un pedido web recibido o con error.');
        }
        $motivo = trim((string) $motivo);
        if (mb_strlen($motivo) < 10) {
            RuleError::fail('RN-WEB-04', 'Ignorar un pedido web exige un motivo de al menos 10 caracteres.');
        }
        DB::table('web_order_inbox')->where('id', $ib->id)->update(['status' => 'IGNORED', 'ignore_reason' => mb_substr($motivo, 0, 255), 'updated_at' => now()]);
        Base::anotar('web_order_inbox', $ib->id, ['action' => 'IGNORED', 'user' => $u->name, 'detail' => mb_substr($motivo, 0, 255)]);
        Events::emit('web_order.ignored', 'web_order_inbox', $ib->id, ['by' => $u->id]);

        return self::ver($ib->id, $u);
    }

    /** Corrige el celular que llegó mal (queda como corrección; el cuerpo recibido no cambia) y reprocesa. */
    public static function corregirCelular(string $id, ?string $celular, User $u): array
    {
        $ib = self::visible($id, $u);
        $n = Celulares::normalizar($celular);
        if (! $n || ! Celulares::valido($n)) {
            RuleError::fail('RN-WEB-07', "El celular «{$celular}» no es válido: son 9 dígitos que empiezan con 9.");
        }
        if (! in_array($ib->status, ['ERROR', 'RECEIVED'], true)) {
            RuleError::fail('RN-WEB-02', 'El pedido web ya se procesó: corrige el celular en el cliente.');
        }
        DB::table('web_order_inbox')->where('id', $ib->id)->update(['overrides' => Base::enc(['phone' => $n] + Base::json($ib->overrides)), 'updated_at' => now()]);
        Base::anotar('web_order_inbox', $ib->id, ['action' => 'FIX', 'user' => $u->name, 'detail' => "Celular corregido a {$n}"]);

        return self::reprocesar($ib->id, $u);
    }

    /** RN-WEB-07: la vendedora marca el pin de la dirección web y, si el pago ya está aprobado, se confirma. */
    public static function completarPin(string $id, array $d, User $u): array
    {
        $ib = self::visible($id, $u);
        if (! $ib->address_id) {
            RuleError::fail('RN-WEB-07', 'El pedido web no tiene dirección de entrega.');
        }
        $a = CustomerAddress::findOrFail($ib->address_id);
        $c = Customer::findOrFail($a->customer_id);
        $r = Direcciones::guardar($c, ['label' => $a->label, 'address_line' => $d['address_line'] ?? $a->address_line, 'district' => $d['district'] ?? $a->district,
            'reference' => $d['reference'] ?? $a->reference, 'lat' => $d['lat'] ?? null, 'lng' => $d['lng'] ?? null, 'pin_source' => 'MAP', 'geocode_confidence' => 1,
            'contact_name' => $a->contact_name, 'contact_phone' => $a->contact_phone, 'is_default' => $a->is_default], $a);
        $res = self::trasPin($ib, $r['direccion']->id, $u);
        Base::anotar('web_order_inbox', $ib->id, ['action' => 'PIN', 'user' => $u->name, 'detail' => 'Pin marcado en '.($r['zona']['name'] ?? 'fuera de cobertura').' · '.implode('; ', $res)]);

        return self::ver($ib->id, $u);
    }

    /** El cliente ya envió su ubicación por el enlace: los pedidos en borrador pasan a esa dirección. */
    public static function usarUbicacionRecibida(object $ib, User $u): ?array
    {
        if ($ib->warning_code !== 'ADDRESS_NO_PIN' || ! $ib->customer_id || ! $ib->processed_at) {
            return null;
        }
        $nueva = CliWeb::ubicacionRecibida($ib->customer_id, (string) $ib->processed_at);
        if (! $nueva || $nueva === $ib->address_id) {
            return null;
        }
        $res = self::trasPin($ib, $nueva, $u);
        Base::anotar('web_order_inbox', $ib->id, ['action' => 'PIN', 'user' => $u->name, 'detail' => 'El cliente envió su ubicación por el enlace · '.implode('; ', $res)]);

        return $res;
    }

    /** Después de tener el pin: dirección en los borradores, recalcular delivery y confirmar si el pago está aprobado. */
    private static function trasPin(object $ib, string $direccion, User $u): array
    {
        $res = [];
        $sistema = Base::sistema($u->name);
        foreach (Base::json($ib->order_ids) as $oid) {
            $o = DB::table('sales_orders')->where('id', $oid)->first();
            if (! $o || $o->status !== 'DRAFT') {
                continue;
            }
            if ($o->fulfillment === 'DELIVERY' && $o->address_id !== $direccion) {
                Pedidos::guardar($o->id, ['address_id' => $direccion], $sistema);
            } else {
                Pedidos::recalcular($o->id);
            }
            $o = Pedidos::pedido($o->id);
            $pagado = Pagos::pagadoDe($o);
            $c = $pagado ? self::confirmar($o->id, 'Pago web aprobado y pin completado') : ['ok' => false, 'motivo' => null];
            $res[] = "{$o->number}: ".($c['ok'] ? 'confirmado' : ($c['motivo'] ?? 'queda en borrador hasta el pago aprobado (RN-WEB-06)'));
        }
        $faltan = [];
        foreach (Base::json($ib->order_ids) as $oid) {
            $o = DB::table('sales_orders')->where('id', $oid)->first();
            if ($o && $o->status === 'DRAFT') {
                foreach (Pedidos::faltantes($o) as $f) {
                    $faltan[$f['codigo']] = true;
                }
            }
        }
        DB::table('web_order_inbox')->where('id', $ib->id)->update(['address_id' => $direccion, 'warning_code' => isset($faltan['DIRECCION_CON_PIN']) ? 'ADDRESS_NO_PIN' : null,
            'missing' => $faltan ? Base::enc(array_keys($faltan)) : null, 'updated_at' => now()]);

        return $res ?: ['sin pedidos en borrador'];
    }

    /** Intenta confirmar un pedido web (RN-PED-01, franja y stock); no falla: devuelve por qué no. */
    public static function confirmar(string $orderId, string $motivo): array
    {
        $o = DB::table('sales_orders')->where('id', $orderId)->first();
        if (! $o || $o->status !== 'DRAFT') {
            return ['ok' => $o && $o->status !== 'CANCELLED', 'motivo' => $o ? null : 'no existe'];
        }
        if ($f = Pedidos::faltantes($o)) {
            return ['ok' => false, 'motivo' => 'en borrador, falta '.implode(', ', array_column($f, 'texto'))];
        }
        try {
            DB::transaction(fn () => Pedidos::confirmar($orderId, Base::sistema('Tienda web')));
            DB::table('sales_orders')->where('id', $orderId)->update(['confirmation_channel' => 'WEB', 'customer_confirmed_at' => now()]);

            return ['ok' => true, 'motivo' => $motivo];
        } catch (\Throwable $e) {
            return ['ok' => false, 'motivo' => 'en borrador: '.mb_substr($e->getMessage(), 0, 200)];
        }
    }

    /** Nuevo enlace de ubicación para el cliente (CLI-07): devuelve la dirección para enviarla por WhatsApp. */
    public static function enlace(string $id, User $u): array
    {
        $ib = self::visible($id, $u);
        if (! $ib->customer_id) {
            RuleError::fail('RN-WEB-07', 'El pedido web todavía no tiene cliente.');
        }
        $c = Customer::findOrFail($ib->customer_id);
        $r = Enlaces::crear($c, $u);
        Base::anotar('web_order_inbox', $ib->id, ['action' => 'LINK', 'user' => $u->name, 'detail' => "Enlace de ubicación nuevo (vence en {$r['horas']} h)"]);

        return ['token' => $r['token'], 'horas' => $r['horas'], 'phone' => $c->phone, 'nombre' => explode(' ', trim($c->full_name))[0]];
    }

    /* ------------------------------------------------------------------ lectura */

    public static function visible(string $id, User $u): object
    {
        $ib = DB::table('web_order_inbox')->where('id', $id)->first();
        if (! $ib || ! in_array($ib->store_id, Base::idsTiendasDe($u), true)) {
            abort(response()->json(['message' => 'Pedido web no encontrado.', 'code' => 'NOT_FOUND'], 404));
        }

        return $ib;
    }

    public static function lista(User $u, array $f): array
    {
        $tiendas = Base::idsTiendasDe($u);
        $q = DB::table('web_order_inbox as i')->join('web_stores as s', 's.id', '=', 'i.store_id')->whereIn('i.store_id', $tiendas)
            ->select('i.id', 'i.store_id', 's.name as tienda', 'i.external_order_id', 'i.received_at', 'i.source', 'i.status', 'i.total', 'i.customer_name', 'i.customer_id',
                'i.order_ids', 'i.attempts', 'i.auto_attempts', 'i.manual_only', 'i.duplicates', 'i.poll_hits', 'i.error_code', 'i.error_detail', 'i.warning_code', 'i.missing', 'i.ignore_reason')
            ->selectRaw("i.payload->>'payment_method_title' AS medio_web")
            ->selectRaw("(SELECT string_agg(o.number, ', ' ORDER BY o.number) FROM sales_orders o WHERE o.id::text IN (SELECT jsonb_array_elements_text(i.order_ids))) AS pedidos")
            ->selectRaw("(SELECT x.status FROM gateway_transactions x WHERE x.store_id = i.store_id AND x.external_reference = i.external_order_id ORDER BY x.date_created DESC LIMIT 1) AS pago")
            ->selectRaw('(SELECT count(*) FROM gateway_transactions x WHERE x.store_id = i.store_id AND x.external_reference = i.external_order_id) AS pagos');
        foreach (['store' => 'i.store_id', 'estado' => 'i.status', 'origen' => 'i.source', 'error' => 'i.error_code'] as $k => $col) {
            if (! empty($f[$k])) {
                $q->where($col, $f[$k]);
            }
        }
        if (($f['sin_pin'] ?? '') === '1') {
            $q->where('i.warning_code', 'ADDRESS_NO_PIN');
        }
        if (! empty($f['dia']) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $f['dia'])) {
            $q->whereRaw("(i.received_at AT TIME ZONE 'America/Lima')::date = ?", [$f['dia']]);
        }
        if (! empty($f['q'])) {
            $t = '%'.addcslashes(trim($f['q']), '%_\\').'%';
            $q->where(fn ($w) => $w->where('i.external_order_id', 'ilike', $t)->orWhere('i.customer_name', 'ilike', $t)
                ->orWhereRaw("i.payload->'billing'->>'phone' ILIKE ?", [$t]));
        }
        $q->orderByDesc('i.received_at')->orderBy('i.id');
        Paginas::ordenar($q, ['received_at' => 'i.received_at', 'external_order_id' => 'i.external_order_id', 'total' => 'i.total', 'customer_name' => 'i.customer_name', 'status' => 'i.status'], 'i.id', $f);

        return Paginas::de($q, fn ($r) => array_merge((array) $r, ['order_ids' => Base::json($r->order_ids), 'missing' => Base::json($r->missing, null),
            'attempts' => (int) $r->attempts, 'auto_attempts' => (int) $r->auto_attempts, 'total' => (float) $r->total, 'pagos' => (int) $r->pagos]), $f) + ['cifras' => self::cifras($tiendas)];
    }

    /** Cifras de WEB-04 (KPI-WEB-01 y KPI-WEB-02). */
    public static function cifras(array $tiendas): array
    {
        $hoy = Base::hoy();
        $mes = substr($hoy, 0, 7).'-01';
        $base = fn () => DB::table('web_order_inbox')->whereIn('store_id', $tiendas);
        $delMes = $base()->whereRaw("(received_at AT TIME ZONE 'America/Lima')::date >= ?", [$mes]);
        $recibidosMes = (clone $delMes)->count();
        $sinIntervencion = (clone $delMes)->where('status', 'PROCESSED')->where('ever_error', false)->count();

        return [
            'hoy' => $base()->whereRaw("(received_at AT TIME ZONE 'America/Lima')::date = ?", [$hoy])->count(),
            'sin_intervencion' => $recibidosMes ? round($sinIntervencion / $recibidosMes * 100, 1) : null, 'recibidos_mes' => $recibidosMes,
            'con_error' => $base()->where('status', 'ERROR')->count(),
            'sin_pin' => $base()->where('warning_code', 'ADDRESS_NO_PIN')->count(),
            'reenvios_mes' => (int) (clone $delMes)->sum('duplicates'),
            'reintentos_max' => Base::param('web_order_retry_max', 5),
        ];
    }

    public static function ver(string $id, User $u): array
    {
        $ib = self::visible($id, $u);
        $s = Base::tienda($ib->store_id);
        $p = Base::json($ib->payload);
        $pedidos = DB::table('sales_orders as o')->leftJoin('brands as b', 'b.id', '=', 'o.brand_id')->whereIn('o.id', Base::json($ib->order_ids))->orderBy('o.number')
            ->get(['o.id', 'o.number', 'o.status', 'o.estimated_total', 'o.paid_amount', 'o.discount_total', 'o.discount_reason', 'o.delivery_fee', 'b.name as marca'])
            ->map(fn ($o) => (array) $o + ['faltan' => $o->status === 'DRAFT' ? Pedidos::faltantes(Pedidos::pedido($o->id)) : []]);
        $mapeos = DB::table('web_product_mappings as m')->leftJoin('product_variants as v', 'v.id', '=', 'm.variant_id')->where('m.store_id', $s->id)
            ->get(['m.id', 'm.sku', 'm.status', 'm.variant_id', 'v.name', 'v.status as v_status', 'v.sellable'])->keyBy(fn ($m) => mb_strtoupper($m->sku));
        $lineas = array_map(function ($li) use ($mapeos) {
            $sku = mb_strtoupper(trim((string) ($li['sku'] ?? '')));
            $m = $mapeos[$sku] ?? null;
            $estado = ! $m || $m->status === 'UNLINKED' || ! $m->variant_id ? 'SIN_MAPEO' : ($m->v_status !== 'ACTIVE' || ! $m->sellable ? 'INACTIVA' : 'OK');

            return ['sku' => $sku ?: null, 'name' => $li['name'] ?? null, 'quantity' => $li['quantity'] ?? null, 'price' => $li['price'] ?? null, 'total' => $li['total'] ?? null,
                'mapeo' => $estado, 'mapping_id' => $m?->id, 'variante' => $m?->name];
        }, is_array($p['line_items'] ?? null) ? $p['line_items'] : []);
        $txs = DB::table('gateway_transactions as x')->leftJoin('payments as py', 'py.id', '=', 'x.payment_id')->where('x.store_id', $ib->store_id)
            ->where('x.external_reference', $ib->external_order_id)->orderByDesc('x.date_created')
            ->get(['x.id', 'x.external_payment_id', 'x.date_created', 'x.amount', 'x.status', 'x.payment_method', 'py.number as cobro']);
        $dir = $ib->address_id ? DB::table('customer_addresses')->where('id', $ib->address_id)->first(['id', 'address_line', 'district', 'reference', 'lat', 'lng', 'needs_pin', 'zone_id']) : null;
        $cliente = $ib->customer_id ? DB::table('customers')->where('id', $ib->customer_id)->first(['id', 'full_name', 'phone']) : null;
        $ov = Base::json($ib->overrides);
        $variantes = in_array($ib->error_code, ['SKU_NOT_MAPPED', 'VARIANT_INACTIVE'], true) ? Mapeos::variantes($u, $s->id) : [];

        return [
            'id' => $ib->id, 'store_id' => $s->id, 'tienda' => $s->name, 'external_order_id' => $ib->external_order_id, 'received_at' => $ib->received_at, 'source' => $ib->source,
            'status' => $ib->status, 'total' => (float) $ib->total, 'customer_name' => $ib->customer_name, 'attempts' => (int) $ib->attempts, 'auto_attempts' => (int) $ib->auto_attempts,
            'manual_only' => (bool) $ib->manual_only, 'duplicates' => (int) $ib->duplicates, 'poll_hits' => (int) $ib->poll_hits, 'processed_at' => $ib->processed_at,
            'error_code' => $ib->error_code, 'error_detail' => $ib->error_detail, 'error_skus' => Base::json($ib->error_skus), 'warning_code' => $ib->warning_code,
            'missing' => Base::json($ib->missing), 'ignore_reason' => $ib->ignore_reason, 'reintentos_max' => Base::param('web_order_retry_max', 5),
            'celular_web' => $p['billing']['phone'] ?? null, 'celular_corregido' => $ov['phone'] ?? null, 'correo' => $p['billing']['email'] ?? null,
            'direccion_web' => trim(($p['shipping']['address_1'] ?? '').' · '.($p['shipping']['city'] ?? ''), ' ·'), 'referencia_web' => $p['shipping']['address_2'] ?? null,
            'medio_web' => $p['payment_method_title'] ?? ($p['payment_method'] ?? null), 'nota' => $p['customer_note'] ?? null, 'envio' => $p['shipping_total'] ?? null,
            'pedidos' => $pedidos, 'lineas' => $lineas, 'pagos' => $txs, 'direccion' => $dir, 'cliente' => $cliente,
            'variantes' => $variantes, 'distritos' => \App\Modulos\Cli\Services\Zonas::distritos(), 'min_referencia' => CliWeb::minimoReferencia(),
            'local' => DB::table('establishments')->where('id', $s->establishment_id)->first(['lat', 'lng']),
            'history' => array_reverse(Base::json($ib->history)), 'payload' => Base::enc($p),
        ];
    }
}
