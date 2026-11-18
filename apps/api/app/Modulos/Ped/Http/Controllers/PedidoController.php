<?php

namespace App\Modulos\Ped\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Ped\Services\Estados;
use App\Modulos\Ped\Services\Pedidos;
use App\Modulos\Ped\Services\Pesos;
use App\Support\Exportar;
use App\Support\Listado;
use Illuminate\Database\Query\Builder;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * PED-01 Pedidos (lista con contadores y alertas), PED-02 Nuevo pedido (crear y editar el
 * borrador) y PED-03 Detalle. Reglas en Services\Pedidos y Services\Estados.
 */
class PedidoController extends Controller
{
    public const VISTAS = ['ACTIVOS', 'HOY', 'BORRADORES', 'INCOMPLETOS', 'AVISO_PESO', 'CERRADOS', 'CANCELADOS', 'TODOS'];

    private const SQL_FALTAN = "(o.payment_method_id is null
        or (o.fulfillment in ('DELIVERY','PROVINCE_SHIPPING') and o.address_id is null)
        or (o.fulfillment in ('DELIVERY','PICKUP') and (o.delivery_date is null or o.slot_id is null))
        or (o.fulfillment = 'PICKUP' and o.pickup_establishment_id is null)
        or (o.fulfillment = 'PROVINCE_SHIPPING' and o.province_agency is null)
        or (o.fulfillment <> 'COUNTER' and coalesce(o.notes, '') = '' and not coalesce(o.prep_notes_ok, false))
        or not exists (select 1 from sales_order_lines l where l.sales_order_id = o.id))";

    public function index(Request $request)
    {
        $f = $this->filtros($request);
        $q = $this->consulta($request, $f);
        $this->vista($q, $f['vista'] ?? 'ACTIVOS');
        $q->when($f['status'] ?? null, fn ($w, $v) => $w->whereIn('o.status', explode(',', $v)));
        $pagina = Listado::de($q, $request, buscar: ['o.number', 'c.full_name', 'c.trade_name', 'c.phone', 'o.contact_phone', 'o.external_ref'],
            ordenar: ['number', 'delivery_date', 'slot_from', 'status', 'estimated_total', 'created_at', 'cliente'], porDefecto: '-created_at');

        return response()->json($pagina);
    }

    /** Contadores por estado con los mismos filtros (sin el de estado) y opciones de los filtros. */
    public function resumen(Request $request)
    {
        // RN-PED-18: además del comando ped:vencer-borradores, al abrir la lista se cancelan los
        // borradores vencidos (a lo más cada 10 minutos por empresa).
        $empresa = DB::selectOne('SELECT app_tenant_id() AS t')->t;
        if (Cache::add("ped:vencer:{$empresa}", 1, 600)) {
            Estados::vencerBorradores($request->user());
        }
        $f = $this->filtros($request);
        $base = $this->consulta($request, $f);
        $this->vista($base, $f['vista'] ?? 'ACTIVOS');
        $porEstado = (clone $base)->reorder()->select(DB::raw('o.status, count(*) as n'))->groupBy('o.status')->pluck('n', 'status');
        $alertas = (clone $base)->reorder()->select(DB::raw("
            count(*) filter (where o.status = 'DRAFT' and ".self::SQL_FALTAN.") as faltan,
            count(*) filter (where o.weight_diff_status = 'NOTICE_REQUIRED') as aviso_peso,
            count(*) filter (where o.discount_status = 'PENDING_APPROVAL') as descuento,
            count(*) filter (where o.needs_stock and o.status in ('CONFIRMED','IN_PREPARATION')) as sin_stock"))->first();

        return response()->json([
            'por_estado' => $porEstado, 'alertas' => $alertas,
            'opciones' => self::opciones(),
        ]);
    }

    public static function opciones(): array
    {
        return [
            'marcas' => DB::table('brands')->where('status', 'ACTIVE')->orderBy('name')->get(['id', 'code', 'name']),
            'locales' => DB::table('establishments')->where('status', 'ACTIVE')->orderBy('name')->get(['id', 'code', 'name', 'short', 'has_counter']),
            'zonas' => DB::table('delivery_zones')->where('status', 'ACTIVE')->orderByRaw('coalesce(priority, 100)')->get(['id', 'code', 'name', 'establishment_id', 'province']),
            'vendedoras' => DB::table('users')->whereIn('role', ['VENDEDORA', 'SUPERVISORA_VENTAS', 'CAJERO'])->where('status', 'ACTIVE')->orderBy('name')->get(['id', 'name']),
            'formas_pago' => DB::table('payment_methods')->where('status', 'ACTIVE')->whereNotIn('code', ['BALANCE'])->orderBy('name')->get(['id', 'code', 'name', 'kind']),
            'agencias' => DB::table('suppliers')->where('supplier_type', 'DELIVERY_COMPANY')->where('status', 'ACTIVE')->orderBy('legal_name')
                ->get(['id', DB::raw('coalesce(trade_name, legal_name) as name')]),
            'franjas' => DB::table('order_time_slots')->where('status', 'ACTIVE')->orderBy('slot_from')->get(['id', 'name', 'establishment_id', 'zone_id', 'slot_from', 'slot_to']),
        ];
    }

    public function exportar(Request $request)
    {
        $f = $this->filtros($request);
        $q = $this->consulta($request, $f);
        $this->vista($q, $f['vista'] ?? 'ACTIVOS');
        $q->when($f['status'] ?? null, fn ($w, $v) => $w->whereIn('o.status', explode(',', $v)));
        $filas = $q->reorder()->orderByDesc('o.delivery_date')->orderBy('o.slot_from')->limit(5000)->get()
            ->map(fn ($o) => [$o->number, $o->delivery_date, $o->slot_from ? substr($o->slot_from, 0, 5).'–'.substr($o->slot_to, 0, 5) : '', $o->marca, $o->channel,
                $o->cliente, $o->zona, $o->vendedora, Estados::nombre($o->status), (float) $o->estimated_total, $o->final_total !== null ? (float) $o->final_total : null]);

        return Exportar::libro('Pedidos', $request->user())
            ->hoja('Pedidos', columnas: [
                ['titulo' => 'Pedido', 'ancho' => 11], ['titulo' => 'Entrega', 'ancho' => 12, 'tipo' => 'fecha'], ['titulo' => 'Franja', 'ancho' => 12, 'tipo' => 'centro'],
                ['titulo' => 'Marca', 'ancho' => 18], ['titulo' => 'Canal', 'ancho' => 12], ['titulo' => 'Cliente', 'ancho' => 30], ['titulo' => 'Zona', 'ancho' => 22],
                ['titulo' => 'Vendedora', 'ancho' => 20], ['titulo' => 'Estado', 'ancho' => 14], ['titulo' => 'Estimado', 'ancho' => 12, 'tipo' => 'soles'],
                ['titulo' => 'Final', 'ancho' => 12, 'tipo' => 'soles'],
            ], filas: $filas, descripcion: 'Pedidos con los filtros de la lista', resumen: ['Pedidos' => $filas->count()])
            ->descargar('pedidos.xlsx');
    }

    /** PED-03: el pedido completo. */
    public function show(Request $request, string $id)
    {
        $o = Pedidos::visible($id, $request->user());

        return response()->json(self::detalle($o, $request->user()));
    }

    public static function detalle(object $o, $u): array
    {
        $cliente = DB::table('customers')->where('id', $o->customer_id)
            ->first(['id', 'full_name', 'trade_name', 'phone', 'phone_alt', 'doc_type', 'doc_number', 'customer_type', 'status', 'blocked_reason', 'email']);
        $lineas = DB::table('sales_order_lines as l')->join('product_variants as v', 'v.id', '=', 'l.variant_id')
            ->leftJoin('cut_types as c', 'c.id', '=', 'v.cut_type_id')->leftJoin('price_lists as pl', 'pl.id', '=', 'l.price_list_id')
            ->where('l.sales_order_id', $o->id)->orderBy('l.line_no')
            ->get(['l.*', 'v.sku', 'v.name', 'v.sale_mode', 'v.nominal_weight_kg', 'c.name as corte', 'pl.name as lista']);
        $pagos = DB::table('payment_allocations as a')->join('payments as p', 'p.id', '=', 'a.payment_id')
            ->leftJoin('payment_methods as m', 'm.id', '=', 'p.payment_method_id')->where('a.order_id', $o->id)
            ->orderBy('p.paid_at')->get(['p.id', 'p.number', 'p.paid_at', 'p.reference', 'p.status', 'a.amount', 'm.name as forma']);

        return [
            'pedido' => $o,
            'marca' => DB::table('brands')->where('id', $o->brand_id)->first(['id', 'code', 'name']),
            'local' => DB::table('establishments')->where('id', $o->establishment_id)->value('name'),
            'cliente' => $cliente,
            'facturar_a' => $o->billing_customer_id && $o->billing_customer_id !== $o->customer_id
                ? DB::table('customers')->where('id', $o->billing_customer_id)->first(['id', 'full_name', 'doc_type', 'doc_number']) : null,
            'direccion' => $o->address_id ? DB::table('customer_addresses')->where('id', $o->address_id)
                ->first(['id', 'label', 'address_line', 'district', 'reference', 'lat', 'lng', 'contact_name', 'contact_phone', 'zone_id']) : null,
            'zona' => $o->zone_id ? DB::table('delivery_zones')->where('id', $o->zone_id)->first(['id', 'code', 'name']) : null,
            'recojo' => $o->pickup_establishment_id ? DB::table('establishments')->where('id', $o->pickup_establishment_id)->value('name') : null,
            'franja' => $o->slot_id ? DB::table('order_time_slots')->where('id', $o->slot_id)->first(['id', 'name', 'slot_from', 'slot_to', 'cutoff', 'capacity']) : null,
            'forma_pago' => $o->payment_method_id ? DB::table('payment_methods')->where('id', $o->payment_method_id)->first(['id', 'code', 'name']) : null,
            'vendedora' => $o->seller_id ? DB::table('users')->where('id', $o->seller_id)->value('name') : null,
            'agencia' => $o->province_agency ? DB::table('suppliers')->where('id', $o->province_agency)->value(DB::raw('coalesce(trade_name, legal_name)')) : null,
            'lineas' => $lineas,
            'subtotal' => round($lineas->sum(fn ($l) => (float) $l->est_amount), 2),
            'pagos' => $pagos,
            'comprobantes' => DB::table('sales_documents')->where('order_id', $o->id)->orderBy('issue_date')
                ->get(['id', 'doc_type', 'full_number', 'issue_date', 'total', 'status', 'sunat_status']),
            'guias' => DB::table('dispatch_guides')->where('order_id', $o->id)->get(['id', 'full_number', 'status', 'issued_at']),
            'historial' => DB::table('sales_order_status_history')->where('order_id', $o->id)->orderBy('changed_at')->orderBy('created_at')
                ->get(['id', 'from_status', 'to_status', 'reason', 'changed_at', 'changed_by_name']),
            'reprogramaciones' => DB::table('order_reschedules')->where('order_id', $o->id)->orderBy('at')
                ->get(['id', 'old_date', 'old_slot_from', 'new_date', 'new_slot_from', 'reason', 'rescheduled_by_name', 'at']),
            'avisos' => DB::table('order_weight_notices')->where('order_id', $o->id)->orderBy('sent_at')
                ->get(['id', 'channel', 'message', 'sent_at', 'customer_response', 'responded_at', 'estimated_total', 'final_total', 'diff_pct']),
            'descuentos' => DB::table('order_discount_approvals')->where('order_id', $o->id)->orderBy('requested_at')
                ->get(['id', 'requested_by_name', 'requested_pct', 'requested_amount', 'reason', 'status', 'requested_at', 'decided_by_name', 'decided_at', 'decision_note']),
            'reservas' => DB::table('stock_reservations as r')->leftJoin('lots as t', 't.id', '=', 'r.lot_id')->where('r.order_id', $o->id)->where('r.status', 'ACTIVE')
                ->get(['r.order_line_id', 'r.qty', 't.code as lote']),
            'faltan' => $o->status === 'DRAFT' ? Pedidos::faltantes($o) : [],
            'siguientes' => Estados::siguientes($o),
            'saldo' => Estados::saldo($o),
            'peso' => in_array($o->status, ['IN_PREPARATION', 'WEIGHED', 'READY', 'IN_ROUTE', 'DELIVERED', 'NOT_DELIVERED', 'CLOSED'], true) ? Pesos::evaluar($o) : null,
            'max_reprogramaciones' => (int) (\App\Support\Params::get('ped_max_reschedules', ['brand' => $o->brand_id]) ?? 2),
        ];
    }

    /** PED-02: crear el borrador. */
    public function store(Request $request)
    {
        $o = Pedidos::guardar(null, $this->datos($request), $request->user());

        return response()->json(self::detalle($o, $request->user()), 201);
    }

    /** PED-02: editar el borrador (solo en BORRADOR, RN-PED-07). */
    public function update(Request $request, string $id)
    {
        Pedidos::visible($id, $request->user());
        $o = Pedidos::guardar($id, $this->datos($request), $request->user());

        return response()->json(self::detalle($o, $request->user()));
    }

    private function datos(Request $request): array
    {
        return $request->validate([
            'brand_id' => ['sometimes', 'uuid'], 'establishment_id' => ['sometimes', 'nullable', 'uuid'],
            'channel' => ['sometimes', Rule::in(Pedidos::CANALES)], 'customer_id' => ['sometimes', 'uuid'],
            'contact_phone' => ['sometimes', 'nullable', 'string', 'max:30'], 'fulfillment' => ['sometimes', Rule::in(Pedidos::ENTREGAS)],
            'address_id' => ['sometimes', 'nullable', 'uuid'], 'pickup_establishment_id' => ['sometimes', 'nullable', 'uuid'],
            'delivery_date' => ['sometimes', 'nullable', 'date_format:Y-m-d'], 'slot_id' => ['sometimes', 'nullable', 'uuid'],
            'requested_doc_type' => ['sometimes', Rule::in(Pedidos::COMPROBANTES)], 'billing_customer_id' => ['sometimes', 'nullable', 'uuid'],
            'payment_method_id' => ['sometimes', 'nullable', 'uuid'], 'paid_amount' => ['sometimes', 'nullable', 'numeric', 'min:0', 'max:999999'],
            'notes' => ['sometimes', 'nullable', 'string', 'max:2000'], 'prep_notes_ok' => ['sometimes', 'nullable', 'boolean'],
            'seller_id' => ['sometimes', 'nullable', 'uuid'],
            'origin_wa_number' => ['sometimes', 'nullable', 'string', 'max:40'], 'origin_ad_code' => ['sometimes', 'nullable', 'string', 'max:20'],
            'origin_utm' => ['sometimes', 'nullable', 'array'], 'external_ref' => ['sometimes', 'nullable', 'string', 'max:40'],
            'province_agency' => ['sometimes', 'nullable', 'uuid'], 'province_destination' => ['sometimes', 'nullable', 'string', 'max:20'],
            'thermal_packaging' => ['sometimes', 'nullable', 'boolean'],
            'lines' => ['sometimes', 'array', 'max:60'], 'lines.*.variant_id' => ['required', 'uuid'], 'lines.*.qty' => ['required', 'numeric', 'gt:0', 'max:9999'],
            'lines.*.est_weight_kg' => ['nullable', 'numeric', 'min:0', 'max:9999'], 'lines.*.cut_notes' => ['nullable', 'string', 'max:255'],
            'discount' => ['sometimes', 'nullable', 'array'], 'discount.pct' => ['nullable', 'numeric', 'min:0', 'max:100'],
            'discount.amount' => ['nullable', 'numeric', 'min:0'], 'discount.reason' => ['nullable', 'string', 'max:255'],
        ]);
    }

    private function filtros(Request $request): array
    {
        return $request->validate([
            'vista' => ['nullable', Rule::in(self::VISTAS)], 'status' => ['nullable', 'string', 'max:200', 'regex:/^(?:'.implode('|', array_keys(Estados::NOMBRES)).')(?:,(?:'.implode('|', array_keys(Estados::NOMBRES)).'))*$/'],
            'desde' => ['nullable', 'date_format:Y-m-d'], 'hasta' => ['nullable', 'date_format:Y-m-d'], 'slot_id' => ['nullable', 'uuid'],
            'brand_id' => ['nullable', 'uuid'], 'brand' => ['nullable', 'string'], 'channel' => ['nullable', Rule::in(Pedidos::CANALES)],
            'zone_id' => ['nullable', 'uuid'], 'seller_id' => ['nullable', 'uuid'], 'establishment_id' => ['nullable', 'uuid'],
            'site' => ['nullable', 'string'], 'fulfillment' => ['nullable', Rule::in(Pedidos::ENTREGAS)],
        ]);
    }

    /** Consulta base con alcance: marcas y locales del usuario; sin ped.order.view_all, solo sus pedidos. */
    private function consulta(Request $request, array $f): Builder
    {
        $marca = $f['brand_id'] ?? (isset($f['brand']) && $f['brand'] !== 'ALL' ? $f['brand'] : null);
        $local = $f['establishment_id'] ?? (isset($f['site']) && $f['site'] !== 'ALL' ? $f['site'] : null);

        $q = DB::table('sales_orders as o')
            ->leftJoin('customers as c', 'c.id', '=', 'o.customer_id')
            ->leftJoin('brands as b', 'b.id', '=', 'o.brand_id')
            ->leftJoin('delivery_zones as z', 'z.id', '=', 'o.zone_id')
            ->leftJoin('users as s', 's.id', '=', 'o.seller_id')
            ->leftJoin('order_time_slots as ts', 'ts.id', '=', 'o.slot_id')
            ->when($f['desde'] ?? null, fn ($w, $v) => $w->where('o.delivery_date', '>=', $v))
            ->when($f['hasta'] ?? null, fn ($w, $v) => $w->where('o.delivery_date', '<=', $v))
            ->when($f['slot_id'] ?? null, fn ($w, $v) => $w->where('o.slot_id', $v))
            ->when($marca, fn ($w, $v) => $w->where('o.brand_id', $v))
            ->when($f['channel'] ?? null, fn ($w, $v) => $w->where('o.channel', $v))
            ->when($f['zone_id'] ?? null, fn ($w, $v) => $w->where('o.zone_id', $v))
            ->when($f['seller_id'] ?? null, fn ($w, $v) => $w->where('o.seller_id', $v))
            ->when($local, fn ($w, $v) => $w->where('o.establishment_id', $v))
            ->when($f['fulfillment'] ?? null, fn ($w, $v) => $w->where('o.fulfillment', $v))
            ->select([
                'o.id', 'o.number', 'o.status', 'o.channel', 'o.fulfillment', 'o.delivery_date', 'o.slot_from', 'o.slot_to', 'o.slot_id',
                'o.estimated_total', 'o.final_total', 'o.paid_amount', 'o.weight_diff_status', 'o.discount_status', 'o.needs_stock', 'o.reschedule_count',
                'o.created_at', 'o.confirmed_at', 'o.imported', 'o.brand_id', 'o.customer_confirmed_at',
                DB::raw('coalesce(c.trade_name, c.full_name) as cliente'), 'c.phone as celular', 'b.name as marca', 'b.code as marca_code',
                'z.name as zona', 's.name as vendedora',
                DB::raw("(o.status = 'DRAFT' and ".self::SQL_FALTAN.') as faltan_datos'),
                DB::raw("(o.slot_id is not null and o.delivery_date is not null and (select count(*) from sales_orders x where x.slot_id = o.slot_id and x.delivery_date = o.delivery_date
                    and x.status in ('".implode("','", Pedidos::OCUPAN_FRANJA)."')) >= ts.capacity) as franja_llena"),
            ]);

        return Pedidos::alcance($q, $request->user());
    }

    private function vista(Builder $q, string $v): void
    {
        $hoy = now('America/Lima')->toDateString();
        match ($v) {
            'ACTIVOS' => $q->whereNotIn('o.status', ['CLOSED', 'CANCELLED']),
            'HOY' => $q->where('o.delivery_date', $hoy)->where('o.status', '<>', 'CANCELLED'),
            'BORRADORES' => $q->where('o.status', 'DRAFT'),
            // CA-PED-11: los importados con datos faltantes (la base no deja confirmar los demás).
            'INCOMPLETOS' => $q->whereNotIn('o.status', ['DRAFT', 'CANCELLED'])->whereRaw('coalesce(o.imported, false)')->whereRaw(self::SQL_FALTAN),
            'AVISO_PESO' => $q->whereIn('o.weight_diff_status', ['NOTICE_REQUIRED']),
            'CERRADOS' => $q->where('o.status', 'CLOSED'),
            'CANCELADOS' => $q->where('o.status', 'CANCELLED'),
            default => $q,
        };
    }
}
