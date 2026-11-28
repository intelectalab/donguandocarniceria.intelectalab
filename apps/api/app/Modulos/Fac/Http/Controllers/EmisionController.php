<?php

namespace App\Modulos\Fac\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Fac\Services\Catalogos;
use App\Modulos\Fac\Services\Emision;
use App\Modulos\Plt\Services\Ruc;
use App\Support\Access;
use App\Support\Listado;
use App\Support\Params;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** FAC-02 Emitir desde el pedido y FAC-03 Emisión directa. */
class EmisionController extends Controller
{
    /** FAC-02: pedidos listos o entregados con peso real que pidieron comprobante y aún no lo tienen. */
    public function pedidos(Request $request)
    {
        $u = $request->user();
        $a = Access::for($u);
        $brand = $request->query('brand');
        $site = $request->query('site');
        $q = DB::table('sales_orders as o')->join('customers as c', 'c.id', '=', DB::raw('coalesce(o.billing_customer_id, o.customer_id)'))
            ->leftJoin('brands as b', 'b.id', '=', 'o.brand_id')
            ->whereIn('o.status', Emision::ESTADOS_FACTURABLES)->where('o.requested_doc_type', '<>', 'NONE')
            ->whereNotExists(fn ($w) => $w->from('sales_documents as x')->whereColumn('x.order_id', 'o.id')->whereIn('x.doc_type', ['INVOICE', 'RECEIPT'])
                ->where('x.status', 'ISSUED')->where('x.sunat_status', '<>', 'REJECTED'))
            ->when($a['brands'], fn ($w) => $w->whereIn('o.brand_id', $a['brands']))
            ->when($a['establishments'], fn ($w) => $w->whereIn('o.establishment_id', $a['establishments']))
            ->when($brand && $brand !== 'ALL', fn ($w) => $w->where('o.brand_id', $brand))
            ->when($site && $site !== 'ALL', fn ($w) => $w->where('o.establishment_id', $site))
            ->when($request->query('status'), fn ($w, $v) => $w->where('o.status', $v))
            ->select(['o.id', 'o.number', 'o.status', 'o.channel', 'o.delivery_date', 'o.delivered_at', 'o.requested_doc_type', 'o.brand_id', 'b.name as brand',
                DB::raw('coalesce(o.final_total, o.estimated_total) as total'), 'o.paid_amount', 'c.full_name as customer_name', 'c.doc_type as customer_doc_type', 'c.doc_number as customer_doc_number',
                DB::raw("(select count(*) from sales_order_lines l where l.sales_order_id = o.id and l.price_basis = 'KG' and l.weighed_kg is null) as sin_pesar"),
                DB::raw("(o.delivered_at is not null and o.delivered_at < now() - interval '24 hours') as atrasado")]);

        return response()->json(Listado::de($q, $request, buscar: ['o.number', 'c.full_name', 'c.doc_number'],
            ordenar: ['number', 'delivery_date', 'total', 'customer_name', 'status'], porDefecto: 'delivery_date'));
    }

    public function pedido(Request $request, string $id)
    {
        return response()->json(Emision::vistaPedido($id, $request->user()));
    }

    public function emitirPedido(Request $request, string $id)
    {
        $d = $request->validate([
            'doc_type' => ['nullable', 'in:INVOICE,RECEIPT'], 'payment_terms' => ['nullable', 'in:CASH,CREDIT'], 'credit_days' => ['nullable', 'integer', 'min:1', 'max:180'],
            'buyer' => ['nullable', 'array'], 'buyer.doc_type' => ['nullable', 'in:DNI,RUC,CE,PAS,NONE'], 'buyer.doc_number' => ['nullable', 'string', 'max:20'],
            'buyer.name' => ['nullable', 'string', 'max:200'], 'buyer.address' => ['nullable', 'string', 'max:255'],
        ]);

        return response()->json(Emision::desdePedido($id, $d, $request->user()), 201);
    }

    /** FAC-03: opciones del formulario (marcas, locales y series vigentes). */
    public function opciones(Request $request)
    {
        $a = Access::for($request->user());

        return response()->json([
            'marcas' => DB::table('brands')->where('status', 'ACTIVE')->when($a['brands'], fn ($w) => $w->whereIn('id', $a['brands']))->orderBy('sort_order')->orderBy('name')->get(['id', 'name', 'code', 'primary_color']),
            'locales' => DB::table('establishments')->where('status', 'ACTIVE')->when($a['establishments'], fn ($w) => $w->whereIn('id', $a['establishments']))->orderBy('code')->get(['id', 'name', 'short', 'code']),
            'series' => DB::table('document_series')->whereIn('doc_type', ['INVOICE', 'RECEIPT'])->where('status', 'ACTIVE')->whereNotNull('brand_id')
                ->orderBy('series')->get(['id', 'series', 'doc_type', 'brand_id', 'establishment_id', 'all_sites', 'next_number']),
            'tope_boleta' => (float) (Params::get('fac_receipt_id_required_above') ?? 700),
            'igv' => Catalogos::igv(),
            'dias_credito' => (int) (Params::get('fac_default_credit_days') ?? 15),
            'hoy' => now('America/Lima')->toDateString(),
        ]);
    }

    /** FAC-03: productos vendibles de la marca con su precio de lista. */
    public function productos(Request $request)
    {
        $brand = $request->validate(['brand' => ['required', 'uuid']])['brand'];
        $q = trim((string) $request->query('q', ''));
        $lista = DB::table('price_lists')->where('brand_id', $brand)->where('status', 'ACTIVE')->orderByRaw("CASE WHEN code LIKE '%-PUB' THEN 0 ELSE 1 END")->orderBy('priority')->value('id');
        if (! $lista) {
            return response()->json([]);
        }
        $filas = DB::table('product_variants as v')->join('products as p', 'p.id', '=', 'v.product_id')
            ->where('v.brand_id', $brand)->where('v.status', 'ACTIVE')
            ->when($q !== '', fn ($w) => $w->where(fn ($x) => $x->whereRaw("translate(lower(v.name), 'áéíóúüñ', 'aeiouun') like translate(?, 'áéíóúüñ', 'aeiouun')", ['%'.mb_strtolower($q).'%'])->orWhere('v.sku', 'ilike', "%{$q}%")))
            ->orderBy('v.name')->limit(30)
            ->get(['v.id', 'v.sku', 'v.name', 'v.sale_mode', 'p.igv_affectation',
                DB::raw('(select pi.price from price_list_items pi where pi.variant_id = v.id and pi.list_id = '.DB::getPdo()->quote((string) $lista).'::uuid and pi.valid_to is null order by pi.min_qty nulls first, pi.created_at desc limit 1) as price'),
                DB::raw('(select pi.basis from price_list_items pi where pi.variant_id = v.id and pi.list_id = '.DB::getPdo()->quote((string) $lista).'::uuid and pi.valid_to is null order by pi.min_qty nulls first, pi.created_at desc limit 1) as basis')]);

        return response()->json($filas);
    }

    /** Clientes para FAC-03 (por nombre, documento o celular). */
    public function clientes(Request $request)
    {
        $q = trim((string) $request->query('q', ''));
        if (mb_strlen($q) < 2) {
            return response()->json([]);
        }
        $p = '%'.mb_strtolower($q).'%';
        $filas = DB::table('customers')->where('status', '<>', 'MERGED')
            ->where(fn ($w) => $w->whereRaw("translate(lower(full_name), 'áéíóúüñ', 'aeiouun') like translate(?, 'áéíóúüñ', 'aeiouun')", [$p])
                ->orWhere('doc_number', 'like', "%{$q}%")->orWhere('phone', 'like', "%{$q}%"))
            ->orderBy('full_name')->limit(15)->get(['id', 'full_name', 'doc_type', 'doc_number', 'phone', 'fiscal_address', 'customer_type']);

        return response()->json($filas->map(fn ($c) => (array) $c + ['ruc_valido' => $c->doc_type === 'RUC' && Ruc::valido($c->doc_number)]));
    }

    public function directa(Request $request)
    {
        $d = $request->validate([
            'doc_type' => ['required', 'in:INVOICE,RECEIPT'], 'brand_id' => ['required', 'uuid'], 'establishment_id' => ['required', 'uuid'],
            'customer_id' => ['required', 'uuid'], 'series_id' => ['nullable', 'uuid'], 'payment_terms' => ['nullable', 'in:CASH,CREDIT'],
            'credit_days' => ['nullable', 'integer', 'min:1', 'max:180'], 'issue_date' => ['nullable', 'date_format:Y-m-d'],
            'buyer' => ['nullable', 'array'], 'buyer.doc_type' => ['nullable', 'in:DNI,RUC,CE,PAS,NONE'], 'buyer.doc_number' => ['nullable', 'string', 'max:20'],
            'buyer.name' => ['nullable', 'string', 'max:200'], 'buyer.address' => ['nullable', 'string', 'max:255'],
            'lines' => ['required', 'array', 'min:1', 'max:80'], 'lines.*.variant_id' => ['nullable', 'uuid'], 'lines.*.description' => ['nullable', 'string', 'max:250'],
            'lines.*.qty' => ['required', 'numeric', 'gt:0', 'max:100000'], 'lines.*.unit_price' => ['required', 'numeric', 'gt:0', 'max:1000000'],
            'lines.*.uom_code' => ['nullable', 'in:KGM,NIU,ZZ'], 'lines.*.igv_affectation' => ['nullable', 'in:10,20,30'],
        ], ['lines.required' => 'Agrega al menos una línea.', 'lines.*.qty.gt' => 'La cantidad debe ser mayor que cero.', 'lines.*.unit_price.gt' => 'El precio debe ser mayor que cero.']);
        foreach ($d['lines'] as $i => $l) {
            if (empty($l['variant_id']) && trim((string) ($l['description'] ?? '')) === '') {
                return response()->json(['message' => 'Cada línea sin producto necesita su descripción.', 'errors' => ["lines.{$i}.description" => ['Escribe la descripción del servicio.']]], 422);
            }
        }

        return response()->json(Emision::directa($d, $request->user()), 201);
    }
}
