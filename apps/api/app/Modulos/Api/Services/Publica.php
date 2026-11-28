<?php

namespace App\Modulos\Api\Services;

use App\Models\User;
use App\Modulos\Cat\Services\Precios;
use App\Modulos\Cli\Services\Clientes;
use App\Modulos\Fac\Services\Emision;
use App\Modulos\Ped\Services\Pedidos;
use App\Support\Events;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * Lo que responde la API pública v1 (/api/publica/v1). Cada respuesta se filtra por las marcas de la clave (sin marcas:
 * todas) y, si la clave tiene cliente vinculado, solo por sus pedidos (RN-API-11). Las escrituras usan las reglas del
 * módulo dueño (Pedidos, Clientes) en nombre de quien creó la clave, y guardan qué clave creó cada pedido.
 */
final class Publica
{
    public const LIMITE = 100;

    private static function marcasDe(object $k): array
    {
        return json_decode((string) $k->brand_ids, true) ?: [];
    }

    private static function limite(array $q): int
    {
        return max(1, min(self::LIMITE, (int) ($q['limit'] ?? 20)));
    }

    private static function codigoMarca(?string $id): ?string
    {
        static $m = null;
        $m ??= DB::table('brands')->pluck('code', 'id')->all();

        return $id ? ($m[$id] ?? null) : null;
    }

    /** El canal de Pedidos que corresponde al canal de la clave. */
    private static function canal(object $k): string
    {
        return $k->channel === 'WEB' ? 'WEB' : 'B2B';
    }

    /* ------------------------------------------------------------------ pedidos */

    private static function pedidos(object $k)
    {
        $q = DB::table('sales_orders as o')->leftJoin('customers as cu', 'cu.id', '=', 'o.customer_id');
        if ($m = self::marcasDe($k)) {
            $q->whereIn('o.brand_id', $m);
        }
        if ($k->customer_id) {
            $q->where('o.customer_id', $k->customer_id);
        }

        return $q;
    }

    private static function pedidoSalida(object $o, $lineas): array
    {
        return [
            'number' => $o->number, 'status' => $o->status, 'brand' => self::codigoMarca($o->brand_id), 'channel' => $o->channel,
            'customer' => ['id' => $o->customer_id, 'name' => $o->trade_name ?: $o->full_name], 'external_ref' => $o->external_ref, 'fulfillment' => $o->fulfillment,
            'delivery_date' => $o->delivery_date, 'slot' => $o->slot_from ? substr($o->slot_from, 0, 5).'–'.substr((string) $o->slot_to, 0, 5) : null,
            'estimated_total' => (float) $o->estimated_total, 'final_total' => $o->final_total !== null ? (float) $o->final_total : null, 'delivery_fee' => (float) $o->delivery_fee,
            'paid_amount' => (float) $o->paid_amount, 'currency' => 'PEN', 'created_at' => $o->created_at, 'confirmed_at' => $o->confirmed_at,
            'lines' => collect($lineas)->map(fn ($l) => ['sku' => $l->sku, 'name' => $l->name, 'qty' => (float) $l->qty, 'price_basis' => $l->price_basis,
                'unit_price' => (float) $l->unit_price, 'est_weight_kg' => $l->est_weight_kg !== null ? (float) $l->est_weight_kg : null,
                'weighed_kg' => $l->weighed_kg !== null ? (float) $l->weighed_kg : null, 'amount' => (float) ($l->final_amount ?? $l->est_amount)])->values()->all(),
        ];
    }

    private static function lineas(array $ids)
    {
        return $ids ? DB::table('sales_order_lines as l')->join('product_variants as v', 'v.id', '=', 'l.variant_id')->whereIn('l.sales_order_id', $ids)
            ->orderBy('l.line_no')->get(['l.sales_order_id', 'l.qty', 'l.price_basis', 'l.unit_price', 'l.est_weight_kg', 'l.weighed_kg', 'l.final_amount', 'l.est_amount', 'v.sku', 'v.name'])
            ->groupBy('sales_order_id') : collect();
    }

    public static function listarPedidos(object $k, array $q): array
    {
        if ($k->environment === 'TEST') {
            return Sandbox::listarPedidos($k, $q);
        }
        $b = self::pedidos($k)->where('o.status', '<>', 'DRAFT');
        if (! empty($q['status'])) {
            $b->where('o.status', strtoupper((string) $q['status']));
        }
        if (! empty($q['from']) && preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $q['from'])) {
            $b->where('o.delivery_date', '>=', $q['from']);
        }
        $os = $b->orderByDesc('o.created_at')->limit(self::limite($q))->get(['o.*', 'cu.full_name', 'cu.trade_name']);
        $ls = self::lineas($os->pluck('id')->all());

        return ['data' => $os->map(fn ($o) => self::pedidoSalida($o, $ls[$o->id] ?? []))->all()];
    }

    public static function verPedido(object $k, string $numero): array
    {
        if ($k->environment === 'TEST') {
            return Sandbox::verPedido($k, $numero);
        }
        $o = self::pedidos($k)->where('o.number', $numero)->first(['o.*', 'cu.full_name', 'cu.trade_name']) ?? abort(response()->json(['code' => 'RN-API-15', 'message' => "No existe el pedido {$numero}."], 404));

        return self::pedidoSalida($o, self::lineas([$o->id])[$o->id] ?? []);
    }

    /** Crea y confirma el pedido con las reglas de Pedidos. Si falta algo para confirmarlo, no queda nada creado. */
    public static function crearPedido(object $k, array $b): array
    {
        if ($k->environment === 'TEST') {
            return Sandbox::crearPedido($k, $b);
        }
        $quien = User::find($k->created_by);
        if (! $quien || ($quien->status ?? 'ACTIVE') !== 'ACTIVE') {
            RuleError::fail('RN-API-11', 'Quien creó la clave ya no está activo en la empresa: crea una clave nueva.');
        }
        $marcas = self::marcasDe($k);
        $marca = null;
        if (! empty($b['brand'])) {
            $marca = DB::table('brands')->where('code', $b['brand'])->value('id');
            if (! $marca || ($marcas && ! in_array($marca, $marcas, true))) {
                RuleError::fail('RN-API-11', "La marca {$b['brand']} no existe o no es de esta clave.");
            }
        } elseif (count($marcas) === 1) {
            $marca = $marcas[0];
        } else {
            RuleError::fail('RN-PED-02', 'Indica la marca del pedido en «brand» (por ejemplo DG).');
        }
        $cliente = $k->customer_id ?: ($b['customer_id'] ?? null);
        if (! $cliente) {
            RuleError::fail('RN-PED-01', 'Indica el cliente en «customer_id».');
        }
        if ($k->customer_id && ! empty($b['customer_id']) && $b['customer_id'] !== $k->customer_id) {
            RuleError::fail('RN-API-11', 'Esta clave solo crea pedidos de su cliente vinculado.');
        }
        $lineas = [];
        foreach (array_values($b['lines'] ?? []) as $i => $l) {
            $v = DB::table('product_variants')->where('sku', (string) ($l['sku'] ?? ''))->where('brand_id', $marca)->first(['id']);
            if (! $v) {
                RuleError::fail('RN-PED-02', 'La línea '.($i + 1).': el SKU «'.($l['sku'] ?? '').'» no existe en la marca.');
            }
            $lineas[] = ['variant_id' => $v->id, 'qty' => $l['qty'] ?? 0, 'est_weight_kg' => $l['est_weight_kg'] ?? null, 'cut_notes' => $l['notes'] ?? null];
        }
        if (! $lineas) {
            RuleError::fail('RN-PED-01', 'El pedido necesita al menos una línea en «lines».');
        }
        $pago = ! empty($b['payment_method']) ? DB::table('payment_methods')->where('code', $b['payment_method'])->where('status', 'ACTIVE')->value('id') : null;
        if (! empty($b['payment_method']) && ! $pago) {
            RuleError::fail('RN-PED-01', "La forma de pago {$b['payment_method']} no existe.");
        }

        $o = DB::transaction(function () use ($k, $b, $quien, $marca, $cliente, $lineas, $pago) {
            $datos = ['brand_id' => $marca, 'channel' => self::canal($k), 'customer_id' => $cliente, 'fulfillment' => $b['fulfillment'] ?? 'DELIVERY',
                'address_id' => $b['address_id'] ?? null, 'delivery_date' => $b['delivery_date'] ?? null, 'slot_id' => $b['slot_id'] ?? null,
                'payment_method_id' => $pago, 'contact_phone' => $b['contact_phone'] ?? null, 'notes' => $b['notes'] ?? null, 'external_ref' => $b['external_ref'] ?? null,
                // Las notas de preparación las manda el sistema del cliente; si no manda, es «sin indicaciones».
                'prep_notes_ok' => true, 'origin_locked' => true, 'lines' => $lineas];
            if (! empty($b['document_type'])) {
                $datos['requested_doc_type'] = $b['document_type'];
            }
            $o = Pedidos::guardar(null, $datos, $quien);
            Pedidos::confirmar($o->id, $quien);
            DB::table('api_key_orders')->insert(['key_id' => $k->id, 'order_id' => $o->id]);

            return $o;
        });
        Events::emit('api.order_created', 'sales_orders', $o->id, ['key' => $k->prefix, 'number' => $o->number]);
        $salida = self::verPedido($k, $o->number);
        Webhooks::publicar('order.created', $salida, ['brand_id' => $o->brand_id, 'customer_id' => $o->customer_id, 'source_id' => $o->id]);
        Webhooks::publicar('order.confirmed', $salida, ['brand_id' => $o->brand_id, 'customer_id' => $o->customer_id, 'source_id' => $o->id.'|CONFIRMED']);

        return $salida;
    }

    /** Emite el comprobante de un pedido entregado (o en el sandbox usa el OSE FAKE, RN-API-14, RN-API-16, CA-API-07). */
    public static function emitirComprobante(object $k, string $numero): array
    {
        if ($k->environment === 'TEST') {
            return Sandbox::emitirComprobante($k, $numero);
        }
        $o = self::pedidos($k)->where('o.number', $numero)->first(['o.*'])
            ?? abort(response()->json(['code' => 'RN-API-15', 'message' => "No existe el pedido {$numero}."], 404));
        $existente = DB::table('sales_documents')->where('order_id', $o->id)->whereIn('doc_type', ['INVOICE', 'RECEIPT'])
            ->where('status', 'ISSUED')->where('sunat_status', '<>', 'REJECTED')->first();
        if (! $existente) {
            if (! in_array($o->status, ['DELIVERED', 'CLOSED'], true)) {
                $est = Emision::estadoPedido($o->status);
                RuleError::fail('RN-API-14', "El pedido {$o->number} está «{$est}»: el comprobante por la API se emite cuando el pedido está entregado.");
            }
            $quien = User::find($k->created_by);
            if (! $quien || ($quien->status ?? 'ACTIVE') !== 'ACTIVE') {
                RuleError::fail('RN-API-11', 'Quien creó la clave ya no está activo en la empresa: crea una clave nueva.');
            }
            $existente = Emision::desdePedido($o->id, [], $quien);
        }
        $salida = [
            'type' => $existente->doc_type,
            'doc_type' => $existente->doc_type,
            'number' => $existente->full_number,
            'full_number' => $existente->full_number,
            'issue_date' => $existente->issue_date,
            'brand' => self::codigoMarca($existente->brand_id),
            'customer' => ['doc_type' => $existente->customer_doc_type, 'doc_number' => $existente->customer_doc_number, 'name' => $existente->customer_name],
            'order' => $o->number,
            'order_number' => $o->number,
            'currency' => $existente->currency ?: 'PEN',
            'subtotal' => (float) $existente->subtotal,
            'igv' => (float) $existente->igv,
            'total' => (float) $existente->total,
            'sunat_status' => $existente->sunat_status,
            'status' => $existente->status,
        ];
        if ($existente->sunat_status === 'ACCEPTED') {
            Webhooks::publicar('document.accepted', $salida, ['brand_id' => $existente->brand_id, 'customer_id' => $existente->customer_id, 'source_id' => $existente->id]);
        }

        return $salida;
    }

    /* ------------------------------------------------------------------ clientes */

    public static function listarClientes(object $k, array $q): array
    {
        if ($k->environment === 'TEST') {
            return Sandbox::listarClientes($k, $q);
        }
        $b = DB::table('customers')->whereNull('merged_into_id')->where('status', '<>', 'INACTIVE');
        if ($k->customer_id) {
            $b->where('id', $k->customer_id);
        }
        $t = trim((string) ($q['q'] ?? ''));
        if (mb_strlen($t) >= 2) {
            $p = '%'.addcslashes($t, '%_\\').'%';
            $b->where(fn ($w) => $w->where('full_name', 'ilike', $p)->orWhere('trade_name', 'ilike', $p)->orWhere('doc_number', 'ilike', $p)->orWhere('phone', 'ilike', $p));
        }
        $cs = $b->orderBy('full_name')->limit(self::limite($q))->get(['id', 'doc_type', 'doc_number', 'full_name', 'trade_name', 'phone', 'email', 'customer_type', 'status']);
        $dirs = DB::table('customer_addresses')->whereIn('customer_id', $cs->pluck('id'))->where('status', 'ACTIVE')->get(['id', 'customer_id', 'label', 'address_line', 'district', 'is_default'])->groupBy('customer_id');

        return ['data' => $cs->map(fn ($c) => ['id' => $c->id, 'doc_type' => $c->doc_type, 'doc_number' => $c->doc_number, 'name' => $c->trade_name ?: $c->full_name,
            'legal_name' => $c->full_name, 'phone' => $c->phone, 'email' => $c->email, 'type' => $c->customer_type, 'status' => $c->status,
            'addresses' => ($dirs[$c->id] ?? collect())->map(fn ($a) => ['id' => $a->id, 'label' => $a->label, 'address' => $a->address_line, 'district' => $a->district, 'default' => (bool) $a->is_default])->values()->all(),
        ])->all()];
    }

    public static function crearCliente(object $k, array $b): array
    {
        if ($k->environment === 'TEST') {
            return Sandbox::crearCliente($k, $b);
        }
        if ($k->customer_id) {
            RuleError::fail('RN-API-11', 'Una clave con cliente vinculado no registra clientes.');
        }
        $quien = User::find($k->created_by);
        if (! $quien || ($quien->status ?? 'ACTIVE') !== 'ACTIVE') {
            RuleError::fail('RN-API-11', 'Quien creó la clave ya no está activo en la empresa: crea una clave nueva.');
        }
        $r = Clientes::crear(['doc_type' => $b['doc_type'] ?? 'NONE', 'doc_number' => $b['doc_number'] ?? null, 'full_name' => $b['name'] ?? null, 'trade_name' => $b['trade_name'] ?? null,
            'phone' => $b['phone'] ?? null, 'email' => $b['email'] ?? null, 'customer_type' => $b['type'] ?? null, 'source_channel' => self::canal($k)], $quien);
        $c = $r['customer'];

        return ['id' => $c->id, 'doc_type' => $c->doc_type, 'doc_number' => $c->doc_number, 'name' => $c->trade_name ?: $c->full_name, 'phone' => $c->phone, 'status' => $c->status];
    }

    /* ------------------------------------------------------------------ catálogo, precios y stock */

    private static function variantes(object $k, array $q)
    {
        $b = DB::table('product_variants as v')->join('products as p', 'p.id', '=', 'v.product_id')->where('v.status', 'ACTIVE')->where('v.sellable', true);
        if ($m = self::marcasDe($k)) {
            $b->whereIn('v.brand_id', $m);
        }
        if (! empty($q['brand'])) {
            $b->whereIn('v.brand_id', DB::table('brands')->where('code', $q['brand'])->select('id'));
        }
        if (! empty($q['sku'])) {
            $b->where('v.sku', (string) $q['sku']);
        }

        return $b;
    }

    public static function productos(object $k, array $q): array
    {
        if ($k->environment === 'TEST') {
            return Sandbox::productos($k, $q);
        }
        $vs = self::variantes($k, $q)->orderBy('v.sku')->limit(self::limite($q))->get(['v.sku', 'v.name', 'v.brand_id', 'v.sale_mode', 'v.nominal_weight_kg', 'v.min_order_qty', 'v.qty_step', 'p.name as product']);

        return ['data' => $vs->map(fn ($v) => ['sku' => $v->sku, 'name' => $v->name, 'product' => $v->product, 'brand' => self::codigoMarca($v->brand_id), 'sale_mode' => $v->sale_mode,
            'nominal_weight_kg' => $v->nominal_weight_kg !== null ? (float) $v->nominal_weight_kg : null, 'min_qty' => $v->min_order_qty !== null ? (float) $v->min_order_qty : null,
            'qty_step' => $v->qty_step !== null ? (float) $v->qty_step : null])->all()];
    }

    public static function precios(object $k, array $q): array
    {
        if ($k->environment === 'TEST') {
            return Sandbox::precios($k, $q);
        }
        $vs = self::variantes($k, $q)->orderBy('v.sku')->limit(self::limite($q))->get(['v.id', 'v.sku', 'v.name', 'v.brand_id']);
        $tipo = $k->customer_id ? (DB::table('customers')->where('id', $k->customer_id)->value('customer_type') ?? 'BUSINESS') : 'PERSON';
        $ps = Precios::vigentes($vs->pluck('id')->all(), ['canal' => self::canal($k), 'tipo_cliente' => $tipo]);

        return ['data' => $vs->map(fn ($v) => ['sku' => $v->sku, 'name' => $v->name, 'brand' => self::codigoMarca($v->brand_id),
            'price' => isset($ps[$v->id]) ? (float) $ps[$v->id]['price'] : null, 'basis' => $ps[$v->id]['basis'] ?? null, 'includes_igv' => true, 'currency' => 'PEN'])->all()];
    }

    public static function stock(object $k, array $q): array
    {
        if ($k->environment === 'TEST') {
            return Sandbox::stock($k, $q);
        }
        $vs = self::variantes($k, $q)->orderBy('v.sku')->limit(self::limite($q))->get(['v.id', 'v.sku', 'v.name', 'v.brand_id', 'v.sale_mode']);
        $saldo = DB::table('stock_balances as s')->join('warehouses as w', 'w.id', '=', 's.warehouse_id')->where('w.allows_sale', true)->where('w.status', 'ACTIVE')
            ->whereIn('s.variant_id', $vs->pluck('id'))->groupBy('s.variant_id')
            ->selectRaw('s.variant_id, sum(s.qty - coalesce(s.reserved_qty, 0)) AS qty, sum(coalesce(s.weight_kg, 0)) AS kg')->get()->keyBy('variant_id');

        return ['data' => $vs->map(fn ($v) => ['sku' => $v->sku, 'name' => $v->name, 'brand' => self::codigoMarca($v->brand_id), 'sale_mode' => $v->sale_mode,
            'available_qty' => round(max(0, (float) ($saldo[$v->id]->qty ?? 0)), 3)])->all()];
    }

    /* ------------------------------------------------------------------ comprobantes, cobros y entregas */

    public static function comprobantes(object $k, array $q): array
    {
        if ($k->environment === 'TEST') {
            return Sandbox::comprobantes($k, $q);
        }
        $b = DB::table('sales_documents as d')->leftJoin('sales_orders as o', 'o.id', '=', 'd.order_id');
        if ($m = self::marcasDe($k)) {
            $b->whereIn('d.brand_id', $m);
        }
        if ($k->customer_id) {
            $b->where('d.customer_id', $k->customer_id);
        }
        if (! empty($q['from']) && preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $q['from'])) {
            $b->where('d.issue_date', '>=', $q['from']);
        }
        if (! empty($q['status'])) {
            $b->where('d.sunat_status', strtoupper((string) $q['status']));
        }
        $ds = $b->orderByDesc('d.issue_date')->orderByDesc('d.number')->limit(self::limite($q))
            ->get(['d.doc_type', 'd.full_number', 'd.issue_date', 'd.customer_doc_type', 'd.customer_doc_number', 'd.customer_name', 'd.currency', 'd.subtotal', 'd.igv', 'd.total', 'd.sunat_status', 'd.status', 'd.brand_id', 'o.number as order']);

        return ['data' => $ds->map(fn ($d) => ['type' => $d->doc_type, 'number' => $d->full_number, 'issue_date' => $d->issue_date, 'brand' => self::codigoMarca($d->brand_id),
            'customer' => ['doc_type' => $d->customer_doc_type, 'doc_number' => $d->customer_doc_number, 'name' => $d->customer_name], 'order' => $d->order,
            'currency' => $d->currency ?: 'PEN', 'subtotal' => (float) $d->subtotal, 'igv' => (float) $d->igv, 'total' => (float) $d->total, 'sunat_status' => $d->sunat_status, 'status' => $d->status])->all()];
    }

    public static function cobros(object $k, array $q): array
    {
        if ($k->environment === 'TEST') {
            return Sandbox::cobros($k, $q);
        }
        $b = DB::table('payments as p')->leftJoin('payment_methods as m', 'm.id', '=', 'p.payment_method_id');
        if ($m = self::marcasDe($k)) {
            $b->whereIn('p.brand_id', $m);
        }
        if ($k->customer_id) {
            $b->where('p.customer_id', $k->customer_id);
        }
        if (! empty($q['from']) && preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $q['from'])) {
            $b->where('p.paid_at', '>=', $q['from']);
        }
        $ps = $b->orderByDesc('p.paid_at')->limit(self::limite($q))->get(['p.number', 'p.amount', 'p.paid_at', 'p.status', 'p.reference', 'p.brand_id', 'p.customer_id', 'm.code as method']);

        return ['data' => $ps->map(fn ($p) => ['number' => $p->number, 'method' => $p->method, 'amount' => (float) $p->amount, 'currency' => 'PEN', 'paid_at' => $p->paid_at,
            'status' => $p->status, 'reference' => $p->reference, 'brand' => self::codigoMarca($p->brand_id), 'customer_id' => $p->customer_id])->all()];
    }

    public static function entregas(object $k, array $q): array
    {
        if ($k->environment === 'TEST') {
            return Sandbox::entregas($k, $q);
        }
        $dia = ! empty($q['date']) && preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $q['date']) ? $q['date'] : now('America/Lima')->toDateString();
        $b = self::pedidos($k)->join('delivery_stops as s', 's.order_id', '=', 'o.id')->join('delivery_routes as r', 'r.id', '=', 's.route_id')->where('r.route_date', $dia);
        $xs = $b->orderBy('r.code')->orderBy('s.seq')->limit(self::LIMITE)->get(['o.number', 'o.brand_id', 'cu.full_name', 'cu.trade_name', 'r.code as route', 's.seq', 's.status', 's.eta', 's.closed_at', 's.fail_reason']);

        return ['date' => $dia, 'data' => $xs->map(fn ($x) => ['order' => $x->number, 'brand' => self::codigoMarca($x->brand_id), 'customer' => $x->trade_name ?: $x->full_name,
            'route' => $x->route, 'stop' => (int) $x->seq, 'status' => $x->status, 'eta' => $x->eta, 'closed_at' => $x->closed_at, 'fail_reason' => $x->fail_reason])->all()];
    }

    /* ------------------------------------------------------------------ destinos de webhooks por API (webhooks:write) */

    public static function listarDestinosWebhook(object $k): array
    {
        $filas = DB::table('api_webhook_endpoints')->where('environment', $k->environment)->orderByDesc('created_at')->get();

        return [
            'data' => $filas->map(fn ($e) => [
                'id' => $e->id,
                'name' => $e->name,
                'url' => $e->url,
                'events' => json_decode((string) $e->events, true) ?: [],
                'status' => $e->status,
                'failure_streak' => (int) $e->failure_streak,
            ])->all(),
        ];
    }

    public static function crearDestinoWebhook(object $k, array $b): array
    {
        $r = Webhooks::guardarDestino(null, [
            'name' => $b['name'] ?? 'Destino creado por API',
            'url' => $b['url'] ?? '',
            'events' => $b['events'] ?? [],
            'environment' => $k->environment,
            'brand_ids' => self::marcasDe($k),
            'customer_id' => $k->customer_id,
        ], null, "API {$k->prefix}");

        return [
            'id' => $r['destino']['id'],
            'name' => $r['destino']['name'],
            'url' => $r['destino']['url'],
            'events' => $r['destino']['events'],
            'secret' => $r['secret'],
        ];
    }
}
