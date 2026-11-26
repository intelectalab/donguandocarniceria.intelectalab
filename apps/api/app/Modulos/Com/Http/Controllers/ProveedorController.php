<?php

namespace App\Modulos\Com\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Com\Services\ProveedoresService as P;
use App\Modulos\Com\Services\Soporte as C;
use App\Support\Listado;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** COM-01 Proveedores y COM-02 Catálogo por proveedor. */
class ProveedorController extends Controller
{
    public function index(Request $r)
    {
        $q = DB::table('suppliers as s')->leftJoin('companies as c', 'c.id', '=', 's.related_company_id')
            ->when($r->query('supplier_type'), fn ($x, $v) => $x->whereIn('s.supplier_type', explode(',', $v)))
            ->when($r->query('status'), fn ($x, $v) => $x->where('s.status', $v))
            ->when($r->query('sunat_status'), fn ($x, $v) => $x->where('s.sunat_status', $v))
            ->when($r->boolean('pending_bank'), fn ($x) => $x->whereNotNull('s.pending_bank_change'))
            ->selectRaw("s.id, s.doc_type, s.doc_number, s.legal_name, s.trade_name, coalesce(nullif(s.trade_name, ''), s.legal_name) as name, s.supplier_type, s.phone, s.email,
                s.status, s.payment_terms_days, s.sunat_status, s.rating, s.bank_name, s.bank_account, (s.pending_bank_change is not null) as bank_change_pending,
                c.legal_name as related_company_name, s.created_at,
                (select count(*) from supplier_catalog k where k.supplier_id = s.id and k.status = 'ACTIVE') as catalog_items,
                (select coalesce(sum(d.balance * d.exchange_rate), 0) from purchase_documents d where d.supplier_id = s.id and d.status <> 'VOIDED' and d.doc_type <> 'CREDIT_NOTE') as balance_pen,
                (select max(o.order_date) from purchase_orders o where o.supplier_id = s.id) as last_order_date");

        return response()->json(Listado::de(DB::query()->fromSub($q, 's'), $r, buscar: ['doc_number', 'legal_name', 'trade_name', 'email'],
            ordenar: ['name', 'doc_number', 'supplier_type', 'status', 'rating', 'balance_pen', 'payment_terms_days', 'last_order_date', 'created_at'], porDefecto: 'name'));
    }

    public function show(string $id)
    {
        $s = P::ver($id);
        $s->orders = DB::table('purchase_orders')->where('supplier_id', $id)->orderByDesc('order_date')->limit(15)->get(['id', 'number', 'order_date', 'expected_date', 'status', 'total']);
        $s->documents = DB::table('purchase_documents')->where('supplier_id', $id)->orderByDesc('issue_date')->limit(15)
            ->get(['id', 'doc_type', 'series', 'number', 'issue_date', 'due_date', 'total', 'balance', 'currency', 'status', 'match_status']);
        $s->catalog = DB::table('supplier_catalog as k')->join('product_variants as v', 'v.id', '=', 'k.variant_id')->where('k.supplier_id', $id)->orderBy('v.name')
            ->get(['k.id', 'k.variant_id', 'v.sku', 'v.name as variant_name', 'k.supplier_sku', 'k.price_basis', 'k.last_price', 'k.min_order_qty', 'k.lead_time_days', 'k.status']);
        $s->farm_links = DB::table('farm_links')->where('supplier_id', $id)->orderByDesc('valid_from')->get(['id', 'mode', 'valid_from', 'valid_to', 'status', 'connector_status']);

        return response()->json($s);
    }

    private function validar(Request $r): array
    {
        return $r->validate([
            'doc_type' => 'required|in:RUC,DNI,FOREIGN', 'doc_number' => 'required|string|max:20', 'legal_name' => 'required|string|max:200', 'trade_name' => 'nullable|string|max:200',
            'supplier_type' => 'required|in:'.implode(',', C::TIPOS_PROVEEDOR), 'phone' => 'nullable|string|max:40', 'email' => 'nullable|email|max:120',
            'payment_terms_days' => 'nullable|integer|min:0|max:180', 'related_company_id' => 'nullable|uuid', 'default_cost_center_id' => 'nullable|uuid',
            'bank_name' => 'nullable|string|max:80', 'bank_account' => 'nullable|string|max:40', 'bank_reason' => 'nullable|string|max:200', 'notes' => 'nullable|string|max:500',
            'status' => 'nullable|in:ACTIVE,INACTIVE',
        ]);
    }

    public function store(Request $r)
    {
        return response()->json(P::guardar($this->validar($r), null, $r->user()), 201);
    }

    public function update(Request $r, string $id)
    {
        return response()->json(P::guardar($this->validar($r), $id, $r->user()));
    }

    public function sunat(string $id)
    {
        return response()->json(P::consultarSunat($id));
    }

    public function estadoSunat(Request $r, string $id)
    {
        $d = $r->validate(['sunat_status' => 'required|in:ACTIVE,SUSPENDED,LOW,NOT_LOCATED,UNKNOWN', 'note' => 'nullable|string|max:200']);

        return response()->json(P::fijarEstadoSunat($id, $d['sunat_status'], $d['note'] ?? null));
    }

    public function cuenta(Request $r, string $id)
    {
        $d = $r->validate(['bank_name' => 'nullable|string|max:80', 'bank_account' => 'required|string|max:40', 'reason' => 'nullable|string|max:200']);
        if (! empty($d['bank_name'])) {
            DB::table('suppliers')->where('id', $id)->whereNull('pending_bank_change')->update(['bank_name' => $d['bank_name'], 'updated_at' => now()]);
        }

        return response()->json(P::pedirCambioCuenta($id, $d['bank_account'], $d['reason'] ?? null, $r->user()));
    }

    public function aprobarCuenta(Request $r, string $id)
    {
        return response()->json(P::aprobarCambioCuenta($id, $r->user()));
    }

    public function rechazarCuenta(string $id)
    {
        return response()->json(P::rechazarCambioCuenta($id));
    }

    /* ======================================================== COM-02 catálogo */

    public function catalogo(Request $r)
    {
        $q = DB::table('supplier_catalog as k')->join('suppliers as s', 's.id', '=', 'k.supplier_id')->join('product_variants as v', 'v.id', '=', 'k.variant_id')
            ->join('products as p', 'p.id', '=', 'v.product_id')->leftJoin('units_of_measure as u', 'u.id', '=', 'k.purchase_uom_id')
            ->when($r->query('supplier_id'), fn ($x, $v) => $x->where('k.supplier_id', $v))
            ->when($r->query('variant_id'), fn ($x, $v) => $x->where('k.variant_id', $v))
            ->when($r->query('status'), fn ($x, $v) => $x->where('k.status', $v))
            ->when($r->query('line'), fn ($x, $v) => $x->where('p.line', $v))
            ->selectRaw("k.id, k.supplier_id, coalesce(nullif(s.trade_name, ''), s.legal_name) as supplier_name, s.supplier_type, k.variant_id, v.sku, v.name as variant_name, p.line,
                k.supplier_sku, k.purchase_uom_id, u.code as uom_code, k.price_basis, k.last_price, k.min_order_qty, k.lead_time_days, k.status, k.price_history, k.updated_at,
                (select min(k2.last_price) from supplier_catalog k2 where k2.variant_id = k.variant_id and k2.status = 'ACTIVE' and k2.price_basis = k.price_basis) as best_price");
        $p = Listado::de(DB::query()->fromSub($q, 'k'), $r, buscar: ['supplier_name', 'sku', 'variant_name', 'supplier_sku'],
            ordenar: ['supplier_name', 'variant_name', 'sku', 'last_price', 'lead_time_days', 'updated_at'], porDefecto: 'variant_name');
        $p->getCollection()->transform(function ($x) {
            $x->price_history = array_slice(array_reverse(json_decode($x->price_history ?: '[]', true) ?: []), 0, 12);

            return $x;
        });

        return response()->json($p);
    }

    public function guardarCatalogo(Request $r, ?string $id = null)
    {
        $d = $r->validate([
            'supplier_id' => ($id ? 'nullable' : 'required').'|uuid', 'variant_id' => ($id ? 'nullable' : 'required').'|uuid', 'supplier_sku' => 'nullable|string|max:60',
            'purchase_uom_id' => 'nullable|uuid', 'price_basis' => 'required|in:KG,UNIT', 'last_price' => 'nullable|numeric|min:0', 'min_order_qty' => 'nullable|numeric|min:0',
            'lead_time_days' => 'nullable|integer|min:0|max:120', 'status' => 'nullable|in:ACTIVE,INACTIVE',
        ]);

        return response()->json(P::guardarCatalogo($d, $id), $id ? 200 : 201);
    }
}
