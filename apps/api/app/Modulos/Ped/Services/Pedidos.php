<?php

namespace App\Modulos\Ped\Services;

use App\Models\User;
use App\Modulos\Alm\Services\ReservasService;
use App\Modulos\Cat\Services\Precios;
use App\Modulos\Cli\Models\Customer;
use App\Modulos\Cli\Services\Celulares;
use App\Modulos\Cli\Services\Clientes;
use App\Modulos\Cli\Services\Documentos;
use App\Modulos\Cli\Services\Zonas;
use App\Support\Access;
use App\Support\Events;
use App\Modulos\Plt\Services\Marcas;
use App\Support\Params;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * El pedido en borrador y su confirmación. Es el servicio que usarán CRM, WEB, POS y B2B para
 * crear pedidos:
 *   Pedidos::guardar(null, ['brand_id' => …, 'channel' => 'WHATSAPP', 'customer_id' => …, 'lines' => [...]], $usuario);
 *   Pedidos::faltantes($pedido)      // RN-PED-01: lo que falta para confirmar, con su código
 *   Pedidos::confirmar($id, $usuario)
 *
 * Reglas: RN-PED-01 (datos obligatorios), 02 (solo variantes activas de la marca), 04 (precio por
 * kg con el peso real), 06 (franja con cupo y hora de corte, en Franjas), 07 (líneas fijas desde
 * EN PREPARACIÓN), 09 (delivery por la zona del pin, con CLI), 10 (precio de la lista vigente, con
 * CAT), 11 (descuento sobre el límite, en Descuentos), 16 (origen bloqueado desde CRM o WEB) y 17
 * (reserva por FEFO al confirmar, con ALM).
 */
final class Pedidos
{
    public const CANALES = ['WHATSAPP', 'WEB', 'TIKTOK', 'FACEBOOK', 'INSTAGRAM', 'PHONE', 'COUNTER', 'B2B', 'CONSIGNMENT'];

    public const ENTREGAS = ['DELIVERY', 'PICKUP', 'COUNTER', 'PROVINCE_SHIPPING'];

    public const COMPROBANTES = ['RECEIPT', 'INVOICE'];

    /** Estados en los que el pedido ocupa su franja. */
    public const OCUPAN_FRANJA = ['CONFIRMED', 'IN_PREPARATION', 'WEIGHED', 'READY', 'IN_ROUTE', 'DELIVERED', 'NOT_DELIVERED', 'CLOSED'];

    public const EPS = 0.005;

    public static function pedido(string $id): object
    {
        $o = DB::table('sales_orders')->where('id', $id)->first();
        if (! $o) {
            abort(404, 'Pedido no encontrado.');
        }

        return $o;
    }

    /** El pedido con candado de fila, para cambiarlo dentro de una transacción. */
    public static function bloquear(string $id): object
    {
        $o = DB::table('sales_orders')->where('id', $id)->lockForUpdate()->first();
        if (! $o) {
            abort(404, 'Pedido no encontrado.');
        }

        return $o;
    }

    /** Alcance: marcas y locales del usuario; sin ped.order.view_all, solo sus pedidos. */
    public static function puedeVer(object $o, User $u): bool
    {
        $a = Access::for($u);
        if ($a['brands'] && ! in_array($o->brand_id, $a['brands'], true)) {
            return false;
        }
        if ($a['establishments'] && ! in_array($o->establishment_id, $a['establishments'], true)) {
            return false;
        }

        return Access::can($u, 'ped.order.view_all') || $o->seller_id === null || $o->seller_id === $u->id;
    }

    /** El mismo alcance que puedeVer(), para una consulta con el pedido como «o». */
    public static function alcance(\Illuminate\Database\Query\Builder $q, User $u, string $t = 'o'): \Illuminate\Database\Query\Builder
    {
        $a = Access::for($u);

        return $q->when($a['brands'], fn ($w) => $w->whereIn("{$t}.brand_id", $a['brands']))
            ->when($a['establishments'], fn ($w) => $w->whereIn("{$t}.establishment_id", $a['establishments']))
            ->when(! Access::can($u, 'ped.order.view_all'), fn ($w) => $w->where(fn ($x) => $x->where("{$t}.seller_id", $u->id)->orWhereNull("{$t}.seller_id")));
    }

    public static function visible(string $id, User $u): object
    {
        $o = self::pedido($id);
        if (! self::puedeVer($o, $u)) {
            abort(404, 'Pedido no encontrado.');
        }

        return $o;
    }

    /**
     * Crea o edita un borrador (PED-02). Las líneas se reemplazan completas. Solo en BORRADOR:
     * desde CONFIRMADO hay que volver a borrador y desde EN PREPARACIÓN no se cambia (RN-PED-07).
     */
    public static function guardar(?string $id, array $d, User $u): object
    {
        return DB::transaction(function () use ($id, $d, $u) {
            $antes = $id ? self::bloquear($id) : null;
            if ($antes) {
                self::soloBorrador($antes, 'cambiar el pedido');
            }

            $marca = $d['brand_id'] ?? $antes?->brand_id;
            if (! $marca) {
                RuleError::fail('RN-PED-02', 'Elige la marca del pedido: un pedido es de una sola marca.');
            }
            Marcas::activa($marca, 'RN-SEP-06');
            if ($antes && $antes->brand_id !== $marca && DB::table('sales_order_lines')->where('sales_order_id', $antes->id)->exists() && ! array_key_exists('lines', $d)) {
                RuleError::fail('RN-PED-02', 'Cambiar la marca cambia los productos: vuelve a elegirlos.');
            }

            $bloqueado = (bool) ($antes?->origin_locked);
            $canal = $bloqueado ? $antes->channel : ($d['channel'] ?? $antes?->channel ?? 'WHATSAPP');
            if (! in_array($canal, self::CANALES, true)) {
                RuleError::fail('RN-PED-16', "Canal «{$canal}» no válido.");
            }
            $entrega = $d['fulfillment'] ?? $antes?->fulfillment ?? ($canal === 'COUNTER' ? 'COUNTER' : 'DELIVERY');
            if (! in_array($entrega, self::ENTREGAS, true)) {
                RuleError::fail('RN-PED-01', 'Elige cómo se entrega: delivery, recojo en local, mostrador o envío a provincia.');
            }

            $clienteId = $d['customer_id'] ?? $antes?->customer_id;
            $cliente = $clienteId ? Customer::find($clienteId) : null;
            if (! $cliente) {
                RuleError::fail('RN-PED-01', 'Elige el cliente del pedido (búscalo por celular o dale de alta).');
            }
            if ($cliente->fusionado()) {
                RuleError::fail('RN-CLI-08', "{$cliente->nombre()} fue fusionado: elige el cliente que quedó.");
            }

            $direccion = self::valor($d, 'address_id', $antes);
            if ($direccion && ! DB::table('customer_addresses')->where(['id' => $direccion, 'customer_id' => $cliente->id])->exists()) {
                RuleError::fail('RN-PED-01', 'La dirección elegida no es de este cliente.');
            }
            if (! in_array($entrega, ['DELIVERY', 'PROVINCE_SHIPPING'], true)) {
                $direccion = null;
            }
            $recojo = $entrega === 'PICKUP' ? self::valor($d, 'pickup_establishment_id', $antes) : null;

            $local = self::local($d['establishment_id'] ?? $antes?->establishment_id, $entrega, $direccion, $recojo, $u);

            $fecha = self::valor($d, 'delivery_date', $antes);
            $franja = $entrega === 'COUNTER' ? null : self::valor($d, 'slot_id', $antes);
            $desde = $hasta = null;
            if ($franja) {
                $s = DB::table('order_time_slots')->where('id', $franja)->first();
                if (! $s || $s->establishment_id !== $local) {
                    RuleError::fail('RN-PED-06', 'La franja elegida no es del local que atiende el pedido.');
                }
                [$desde, $hasta] = [$s->slot_from, $s->slot_to];
            }
            if ($entrega === 'COUNTER') {
                $fecha = $fecha ?: now('America/Lima')->toDateString();
            }

            $doc = $d['requested_doc_type'] ?? $antes?->requested_doc_type ?? 'RECEIPT';
            if (! in_array($doc, self::COMPROBANTES, true)) {
                RuleError::fail('RN-PED-01', 'El comprobante es boleta o factura.');
            }
            $facturar = self::valor($d, 'billing_customer_id', $antes) ?: $cliente->id;
            if (! DB::table('customers')->where('id', $facturar)->exists()) {
                RuleError::fail('RN-PED-01', 'El cliente de facturación no existe.');
            }

            $telefono = array_key_exists('contact_phone', $d) ? Celulares::normalizar($d['contact_phone']) : $antes?->contact_phone;
            if ($telefono && ! Celulares::valido($telefono)) {
                RuleError::fail('RN-CLI-01', "El celular de contacto «{$d['contact_phone']}» no es válido: 9 dígitos que empiezan en 9.");
            }

            $pago = self::valor($d, 'payment_method_id', $antes);
            if ($pago && ! DB::table('payment_methods')->where('id', $pago)->exists()) {
                RuleError::fail('RN-PED-01', 'La forma de pago no existe.');
            }

            $vendedora = $antes?->seller_id;
            if (array_key_exists('seller_id', $d) && Access::can($u, 'ped.order.view_all')) {
                $vendedora = $d['seller_id'] ?: null;
            } elseif (! $antes) {
                $vendedora = in_array($u->role, ['VENDEDORA', 'SUPERVISORA_VENTAS', 'CAJERO'], true) ? $u->id : null;
            }

            $datos = [
                'brand_id' => $marca, 'establishment_id' => $local, 'channel' => $canal, 'customer_id' => $cliente->id,
                'address_id' => $direccion, 'seller_id' => $vendedora, 'fulfillment' => $entrega,
                'delivery_date' => $fecha ?: null, 'slot_id' => $franja, 'slot_from' => $desde, 'slot_to' => $hasta,
                'requested_doc_type' => $doc, 'billing_customer_id' => $facturar, 'payment_method_id' => $pago,
                'paid_amount' => round((float) (array_key_exists('paid_amount', $d) ? ($d['paid_amount'] ?: 0) : ($antes->paid_amount ?? 0)), 2),
                'contact_phone' => $telefono, 'pickup_establishment_id' => $recojo,
                'notes' => array_key_exists('notes', $d) ? (trim((string) $d['notes']) ?: null) : $antes?->notes,
                'prep_notes_ok' => array_key_exists('prep_notes_ok', $d) ? (bool) $d['prep_notes_ok'] : $antes?->prep_notes_ok,
                'province_agency' => $entrega === 'PROVINCE_SHIPPING' ? self::valor($d, 'province_agency', $antes) : null,
                'province_destination' => $entrega === 'PROVINCE_SHIPPING' ? (self::valor($d, 'province_destination', $antes) ?: null) : null,
                'thermal_packaging' => $entrega === 'PROVINCE_SHIPPING' ? (bool) self::valor($d, 'thermal_packaging', $antes) : null,
                'last_activity_at' => now(), 'updated_at' => now(),
            ];
            if ($datos['paid_amount'] < 0) {
                RuleError::fail('RN-PED-19', 'El monto pagado no puede ser negativo.');
            }
            // RN-PED-16: el origen lo pone CRM o WEB y la vendedora no lo cambia.
            if (! $bloqueado) {
                foreach (['origin_wa_number' => 40, 'origin_ad_code' => 20, 'external_ref' => 40] as $k => $largo) {
                    if (array_key_exists($k, $d)) {
                        $datos[$k] = trim((string) $d[$k]) !== '' ? mb_substr(trim((string) $d[$k]), 0, $largo) : null;
                    }
                }
                if (array_key_exists('origin_utm', $d)) {
                    $datos['origin_utm'] = $d['origin_utm'] ? json_encode($d['origin_utm'], JSON_UNESCAPED_UNICODE) : null;
                }
                if (! $antes && ! empty($d['origin_locked'])) {
                    $datos['origin_locked'] = true;
                }
            }

            if ($antes) {
                DB::table('sales_orders')->where('id', $antes->id)->update($datos);
                $oid = $antes->id;
            } else {
                $numero = self::numero();
                $oid = DB::table('sales_orders')->insertGetId($datos + [
                    'number' => $numero, 'status' => 'DRAFT', 'estimated_total' => 0, 'delivery_fee' => 0, 'discount_total' => 0,
                    'discount_status' => 'NONE', 'weight_diff_status' => 'NONE', 'reschedule_count' => 0, 'units' => 0, 'est_kg' => 0,
                    'created_at' => now(),
                ], 'id');
                Events::emit('order.created', 'sales_orders', $oid, ['number' => $numero, 'channel' => $canal]);
            }

            if (array_key_exists('lines', $d)) {
                self::lineas($oid, $d['lines'] ?? [], $marca, $canal, $cliente->customer_type);
            }

            if (array_key_exists('discount', $d)) {
                Descuentos::aplicar($oid, $d['discount'], $u);
            } else {
                self::recalcular($oid);
            }

            return self::pedido($oid);
        });
    }

    /**
     * Reemplaza las líneas del borrador (RN-PED-02 y RN-PED-10). Cada línea toma el precio
     * vigente del canal y la marca; el precio no se edita.
     */
    public static function lineas(string $orderId, array $lineas, string $marca, string $canal, ?string $tipoCliente = null): void
    {
        $ids = array_values(array_unique(array_filter(array_column($lineas, 'variant_id'))));
        $vs = $ids ? DB::table('product_variants as v')->leftJoin('brands as b', 'b.id', '=', 'v.brand_id')->whereIn('v.id', $ids)
            ->get(['v.id', 'v.sku', 'v.name', 'v.brand_id', 'v.status', 'v.sellable', 'v.sale_mode', 'v.nominal_weight_kg', 'v.weight_tolerance_pct', 'b.name as marca'])
            ->keyBy('id') : collect();
        $marcaNombre = DB::table('brands')->where('id', $marca)->value('name');
        $tolerancia = (float) (Params::get('ped_weight_tolerance_pct', ['brand' => $marca]) ?? 10);

        DB::table('sales_order_lines')->where('sales_order_id', $orderId)->delete();
        $n = 0;
        foreach ($lineas as $l) {
            $v = $vs[$l['variant_id'] ?? ''] ?? null;
            if (! $v) {
                RuleError::fail('RN-PED-02', 'Elige el producto del catálogo: no existe el producto libre.');
            }
            if ($v->brand_id !== $marca) {
                RuleError::fail('RN-PED-02', "«{$v->name}» es de {$v->marca} y el pedido es de {$marcaNombre}: un pedido es de una sola marca. Crea otro pedido para ese producto.");
            }
            if ($v->status !== 'ACTIVE' || ! $v->sellable) {
                RuleError::fail('RN-PED-02', "«{$v->name}» no está activo para la venta.");
            }
            $q = round((float) ($l['qty'] ?? 0), 3);
            if ($q <= 0) {
                RuleError::fail('RN-PED-01', "Escribe la cantidad de «{$v->name}».");
            }
            if ($v->sale_mode !== 'KG' && abs($q - round($q)) > 0.0001) {
                RuleError::fail('RN-PED-01', "«{$v->name}» se vende por unidades: la cantidad va sin decimales.");
            }
            $p = Precios::vigente($v->id, ['canal' => $canal, 'tipo_cliente' => $tipoCliente ?? 'PERSON', 'cantidad' => $q, 'marca' => $marca]);
            if (! $p) {
                RuleError::fail('RN-PED-10', "«{$v->name}» no tiene precio vigente para el canal {$canal}: pide a Catálogo que lo agregue a una lista.");
            }
            $peso = match ($v->sale_mode) {
                'KG' => $q,
                'UNIT_VARIABLE_WEIGHT' => isset($l['est_weight_kg']) && $l['est_weight_kg'] !== '' && $l['est_weight_kg'] !== null
                    ? round((float) $l['est_weight_kg'], 3) : round($q * (float) $v->nominal_weight_kg, 3),
                default => null,
            };
            if ($peso !== null && $peso <= 0 && $p['basis'] === 'KG') {
                RuleError::fail('RN-PED-01', "Falta el peso estimado de «{$v->name}».");
            }
            $importe = round(($p['basis'] === 'KG' ? (float) $peso : $q) * $p['price'], 2);
            DB::table('sales_order_lines')->insert([
                'sales_order_id' => $orderId, 'line_no' => ++$n, 'variant_id' => $v->id, 'qty' => $q,
                'unit_price' => $p['price'], 'list_price' => $p['price'], 'price_basis' => $p['basis'], 'price_list_id' => $p['list_id'],
                'est_weight_kg' => $peso, 'tolerance_pct' => $peso !== null ? ($v->weight_tolerance_pct ?? $tolerancia) : null,
                'discount_pct' => 0, 'discount_amount' => 0, 'est_amount' => $importe,
                'cut_notes' => trim((string) ($l['cut_notes'] ?? '')) ?: null, 'created_at' => now(),
            ]);
        }
    }

    /**
     * Cifras del pedido: unidades, kg, descuento, delivery (RN-PED-09, solo en borrador),
     * total estimado y total final cuando todas las líneas por kg tienen peso real (RN-PED-04).
     */
    public static function recalcular(string $orderId): object
    {
        $o = self::pedido($orderId);
        $ls = DB::table('sales_order_lines as l')->join('product_variants as v', 'v.id', '=', 'l.variant_id')
            ->where('l.sales_order_id', $orderId)->orderBy('l.line_no')->get(['l.*', 'v.sale_mode']);
        $unidades = $ls->where('sale_mode', '<>', 'KG')->sum(fn ($l) => (float) $l->qty);
        $kg = $ls->sum(fn ($l) => (float) ($l->est_weight_kg ?? 0));
        $sub = round($ls->sum(fn ($l) => (float) $l->est_amount), 2);

        $porKg = $ls->where('price_basis', 'KG');
        $pesado = $ls->isNotEmpty() && $porKg->every(fn ($l) => $l->weighed_kg !== null);
        $subFinal = $pesado ? round($ls->sum(fn ($l) => $l->price_basis === 'KG' ? (float) $l->final_amount : (float) $l->est_amount), 2) : null;

        $descuento = self::descuento($o, $sub);
        $descuentoFinal = $subFinal !== null ? self::descuento($o, $subFinal) : null;

        $fee = (float) $o->delivery_fee;
        $zona = $o->zone_id;
        if ($o->status === 'DRAFT') {
            [$fee, $zona] = self::delivery($o, $ls);
        }

        $datos = [
            'units' => (int) round($unidades), 'est_kg' => round($kg, 3), 'zone_id' => $zona, 'delivery_fee' => $fee,
            'discount_total' => $descuento,
            'estimated_total' => max(0, round($sub - $descuento + $fee, 2)),
            'final_total' => $subFinal !== null ? max(0, round($subFinal - $descuentoFinal + $fee, 2)) : null,
            'updated_at' => now(),
        ];
        DB::table('sales_orders')->where('id', $orderId)->update($datos);

        return self::pedido($orderId);
    }

    private static function descuento(object $o, float $sub): float
    {
        if (in_array($o->discount_status, ['NONE', 'REJECTED'], true)) {
            return 0.0;
        }
        if ($o->order_discount_pct !== null && (float) $o->order_discount_pct > 0) {
            return round(min($sub, $sub * (float) $o->order_discount_pct / 100), 2);
        }

        return round(min($sub, (float) ($o->order_discount ?? 0)), 2);
    }

    /** RN-PED-09: tarifa de la zona del pin (CLI). Recojo, mostrador y provincia no pagan delivery en el pedido. */
    private static function delivery(object $o, $lineas): array
    {
        if ($o->fulfillment !== 'DELIVERY' || ! $o->address_id) {
            return [0.0, null];
        }
        $a = DB::table('customer_addresses')->where('id', $o->address_id)->first(['lat', 'lng', 'district', 'zone_id']);
        if (! $a) {
            return [0.0, null];
        }
        $t = Zonas::tarifa([
            'zone_id' => $a->zone_id, 'lat' => $a->lat, 'lng' => $a->lng, 'distrito' => $a->district, 'canal' => $o->channel,
            'lineas' => $lineas->map(fn ($l) => ['variant_id' => $l->variant_id, 'qty' => (float) $l->qty])->all(),
        ]);
        if (! $t['cubierto']) {
            return [0.0, null];
        }
        if ($o->fee_override !== null) {
            return [(float) $o->fee_override, $t['zona']['id']];
        }

        return [(float) $t['tarifa'], $t['zona']['id']];
    }

    /**
     * RN-PED-01: los datos que faltan para confirmar, con su código y en palabras.
     *
     * @return list<array{codigo: string, texto: string}>
     */
    public static function faltantes(object $o): array
    {
        $f = [];
        $add = function (string $codigo, string $texto) use (&$f) {
            $f[] = ['codigo' => $codigo, 'texto' => $texto];
        };
        $mostrador = $o->fulfillment === 'COUNTER';
        $cliente = $o->customer_id ? DB::table('customers')->where('id', $o->customer_id)->first() : null;
        if (! $cliente) {
            $add('CLIENTE', 'cliente');
        }
        if (! $mostrador && ! $o->contact_phone && ! $cliente?->phone) {
            $add('CELULAR', 'celular del cliente o de contacto');
        }

        // Comprobante: factura con RUC válido; boleta sobre el monto exige documento.
        $fact = $o->billing_customer_id ? DB::table('customers')->where('id', $o->billing_customer_id)->first(['doc_type', 'doc_number']) : null;
        if (! $o->requested_doc_type) {
            $add('COMPROBANTE', 'comprobante (boleta o factura)');
        } elseif ($o->requested_doc_type === 'INVOICE') {
            if (! $fact || $fact->doc_type !== 'RUC' || Documentos::problema('RUC', $fact->doc_number)) {
                $add('RUC_DE_FACTURACION', 'cliente de facturación con RUC válido');
            }
        } else {
            $tope = (float) (Params::get('fac_receipt_id_required_above', ['brand' => $o->brand_id]) ?? 700);
            if ((float) $o->estimated_total > $tope && (! $fact || $fact->doc_type === 'NONE' || ! $fact->doc_number)) {
                $add('DOCUMENTO_PARA_BOLETA', 'DNI o documento del cliente (boleta sobre S/ '.number_format($tope, 2).')');
            }
        }

        if (in_array($o->fulfillment, ['DELIVERY', 'PROVINCE_SHIPPING'], true)) {
            $a = $o->address_id ? DB::table('customer_addresses')->where('id', $o->address_id)->first(['lat', 'lng', 'needs_pin', 'status']) : null;
            if (! $a || $a->lat === null || $a->lng === null || $a->needs_pin || $a->status !== 'ACTIVE') {
                $add('DIRECCION_CON_PIN', 'dirección con pin');
            }
        }
        if ($o->fulfillment === 'PICKUP' && ! $o->pickup_establishment_id) {
            $add('LOCAL_DE_RECOJO', 'local de recojo');
        }
        if ($o->fulfillment === 'PROVINCE_SHIPPING' && ! $o->province_agency) {
            $add('AGENCIA', 'agencia de envío');
        }
        if (! $mostrador) {
            if (! $o->delivery_date) {
                $add('FECHA', 'fecha de entrega');
            }
            if (! $o->slot_id && $o->fulfillment !== 'PROVINCE_SHIPPING') {
                $add('FRANJA', 'franja de entrega');
            }
        }

        $ls = DB::table('sales_order_lines')->where('sales_order_id', $o->id)->get(['price_basis', 'est_weight_kg']);
        if ($ls->isEmpty()) {
            $add('PRODUCTOS', 'al menos un producto');
        } elseif ($ls->contains(fn ($l) => $l->price_basis === 'KG' && ! ((float) $l->est_weight_kg > 0))) {
            $add('PESO_ESTIMADO', 'peso estimado de los productos por kg');
        }
        if (! $o->payment_method_id) {
            $add('FORMA_DE_PAGO', 'forma de pago');
        } elseif ($o->fulfillment === 'PROVINCE_SHIPPING' && in_array(DB::table('payment_methods')->where('id', $o->payment_method_id)->value('code'), ['CASH', 'CREDIT'], true)) {
            $add('PAGO_ADELANTADO', 'pago adelantado (provincia no acepta contra entrega)');
        }
        if (! $mostrador && trim((string) $o->notes) === '' && ! $o->prep_notes_ok) {
            $add('NOTAS_DE_PREPARACION', 'notas de preparación (o «Sin indicaciones»)');
        }

        return $f;
    }

    /** Texto de la regla: «Falta: dirección con pin, franja y forma de pago.» */
    public static function textoFaltantes(array $f): string
    {
        $t = array_column($f, 'texto');
        $ultimo = array_pop($t);

        return 'Para confirmar falta: '.($t ? implode(', ', $t).' y ' : '').$ultimo.'.';
    }

    /**
     * BORRADOR → CONFIRMADO. Falla con los datos que faltan (RN-PED-01), con el cliente bloqueado
     * (RN-CLI-09), con descuento sin aprobar (RN-PED-11), franja llena o pasada la hora de corte
     * (RN-PED-06) y sin stock salvo permiso (RN-PED-17).
     *
     * @return array{pedido: object, reservas: ?array, faltan: list}
     */
    public static function confirmar(string $id, User $u): array
    {
        return DB::transaction(function () use ($id, $u) {
            $o = self::bloquear($id);
            if ($o->status !== 'DRAFT') {
                RuleError::fail('RN-PED-03', 'Solo se confirma un pedido en borrador (este está '.Estados::nombre($o->status).').');
            }
            $o = self::recalcular($o->id);
            if ($f = self::faltantes($o)) {
                throw new Faltantes($f);
            }
            if ($motivo = Clientes::puedeComprar(Customer::findOrFail($o->customer_id))) {
                RuleError::fail($motivo[0], $motivo[1]);
            }
            if ($o->discount_status === 'PENDING_APPROVAL') {
                RuleError::fail('RN-PED-11', 'El descuento está pendiente de aprobación: la supervisora debe aprobarlo antes de confirmar.');
            }
            Marcas::activa($o->brand_id);
            if ($o->slot_id) {
                Franjas::validar($o->slot_id, $o->delivery_date, $u, $o->id);
            }

            // RN-PED-17: reserva por FEFO en el almacén del local que atiende.
            $reservas = null;
            $sinStock = false;
            if (ReservasService::reservaAlConfirmar($o->brand_id)) {
                $ls = DB::table('sales_order_lines')->where('sales_order_id', $o->id)->orderBy('line_no')->get();
                $reservas = ReservasService::reservar([
                    'order_id' => $o->id, 'order_number' => $o->number, 'brand_id' => $o->brand_id, 'establishment_id' => $o->establishment_id,
                    'delivery_date' => $o->delivery_date,
                    'lines' => $ls->map(fn ($l) => ['line_id' => $l->id, 'variant_id' => $l->variant_id, 'qty' => $l->qty, 'weight_kg' => $l->est_weight_kg])->all(),
                ], $u);
                if ($reservas['short']) {
                    if (! Access::can($u, 'ped.order.confirm_without_stock')) {
                        $nombres = DB::table('product_variants')->whereIn('id', array_column($reservas['short'], 'variant_id'))->pluck('name')->implode(', ');
                        RuleError::fail('RN-PED-17', "No hay stock disponible de {$nombres} en el local que atiende. Solo la supervisora puede confirmarlo sin stock (queda marcado para producción o compra).");
                    }
                    $sinStock = true;
                }
            }

            DB::table('sales_orders')->where('id', $o->id)->update([
                'status' => 'CONFIRMED', 'confirmed_at' => now(), 'needs_stock' => $sinStock, 'last_activity_at' => now(), 'updated_at' => now(),
            ]);
            Estados::historial($o, 'DRAFT', 'CONFIRMED', $sinStock ? 'Confirmado sin stock disponible' : null, $u);
            if (! DB::table('customers')->where('id', $o->customer_id)->value('first_order_at')) {
                DB::table('customers')->where('id', $o->customer_id)->update(['first_order_at' => now()]);
            }
            DB::table('customers')->where('id', $o->customer_id)->update(['last_order_at' => now(), 'orders_count' => DB::raw('coalesce(orders_count, 0) + 1')]);
            Events::emit('order.confirmed', 'sales_orders', $o->id, [
                'number' => $o->number, 'brand_id' => $o->brand_id, 'channel' => $o->channel, 'fulfillment' => $o->fulfillment,
                'delivery_date' => $o->delivery_date, 'slot_id' => $o->slot_id, 'estimated_total' => (float) $o->estimated_total, 'needs_stock' => $sinStock,
            ]);

            return ['pedido' => self::pedido($o->id), 'reservas' => $reservas, 'sin_stock' => $sinStock];
        });
    }

    /** RN-PED-07: el pedido solo se cambia en borrador. */
    public static function soloBorrador(object $o, string $que): void
    {
        if ($o->status === 'DRAFT') {
            return;
        }
        if ($o->status === 'CONFIRMED') {
            RuleError::fail('RN-PED-07', "Para {$que}, primero vuelve el pedido a borrador (aún no se prepara).");
        }
        RuleError::fail('RN-PED-07', 'El pedido está '.Estados::nombre($o->status).": sus líneas ya no cambian de producto, cantidad, precio ni descuento. Solo se registra el peso real; para cambiarlo, cancélalo con motivo.");
    }

    /** Número P-000001 por empresa, con candado: dos pedidos a la vez no reciben el mismo. */
    public static function numero(): string
    {
        DB::select('SELECT pg_advisory_xact_lock(hashtext(?))', ['ped:numero:'.DB::selectOne('SELECT app_tenant_id() AS t')->t]);
        $max = DB::table('sales_orders')->where('number', 'like', 'P-%')
            ->selectRaw("max(nullif(regexp_replace(substr(number, 3), '\\D', '', 'g'), '')::int) AS n")->value('n');

        return 'P-'.str_pad((string) (((int) $max) + 1), 6, '0', STR_PAD_LEFT);
    }

    /** Local que atiende: el elegido, el de recojo, el de la zona del pin o el del usuario. */
    private static function local(?string $elegido, string $entrega, ?string $direccion, ?string $recojo, User $u): string
    {
        $id = $elegido;
        if (! $id && $entrega === 'PICKUP') {
            $id = $recojo;
        }
        if (! $id && $direccion) {
            $zona = DB::table('customer_addresses')->where('id', $direccion)->value('zone_id');
            $id = $zona ? DB::table('delivery_zones')->where('id', $zona)->value('establishment_id') : null;
        }
        if (! $id) {
            $a = Access::for($u);
            $id = $a['establishments'][0] ?? null;
        }
        $id ??= DB::table('establishments')->where('status', 'ACTIVE')->orderBy('name')->value('id');
        if (! $id || ! DB::table('establishments')->where('id', $id)->exists()) {
            RuleError::fail('RN-PED-01', 'Elige el local que atiende el pedido.');
        }

        return $id;
    }

    private static function valor(array $d, string $k, ?object $antes): mixed
    {
        return array_key_exists($k, $d) ? ($d[$k] === '' ? null : $d[$k]) : ($antes->{$k} ?? null);
    }
}
