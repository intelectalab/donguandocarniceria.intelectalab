<?php

namespace App\Modulos\Com\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Com\Services\ComprobantesService as D;
use App\Modulos\Com\Services\Soporte as C;
use App\Support\Listado;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** COM-07 Comprobantes del proveedor y COM-08 Cruce de tres vías. */
class ComprobanteController extends Controller
{
    use Alcance;

    public function index(Request $r)
    {
        $q = DB::table('purchase_documents as d')->join('suppliers as s', 's.id', '=', 'd.supplier_id')->leftJoin('purchase_orders as o', 'o.id', '=', 'd.po_id')
            ->leftJoin('brands as b', 'b.id', '=', 'd.brand_id')->leftJoin('users as u', 'u.id', '=', 'd.registered_by')
            ->when($r->query('doc_type'), fn ($x, $v) => $x->whereIn('d.doc_type', explode(',', $v)))
            ->when($r->query('status'), fn ($x, $v) => $x->whereIn('d.status', explode(',', $v)))
            ->when($r->query('match_status'), fn ($x, $v) => $x->whereIn('d.match_status', explode(',', $v)))
            ->when($r->query('supplier_id'), fn ($x, $v) => $x->where('d.supplier_id', $v))
            ->when($r->query('from'), fn ($x, $v) => $x->where('d.issue_date', '>=', $v))
            ->when($r->query('to'), fn ($x, $v) => $x->where('d.issue_date', '<=', $v))
            ->when($r->query('period'), fn ($x, $v) => $x->whereBetween('d.accounting_date', [substr($v, 0, 7).'-01', \Carbon\CarbonImmutable::parse(substr($v, 0, 7).'-01')->endOfMonth()->toDateString()]))
            ->selectRaw("d.id, d.doc_type, d.sunat_doc_type, d.series, d.number, d.series || '-' || d.number as doc_number, d.issue_date, d.due_date, d.accounting_date, d.currency,
                d.exchange_rate, d.base_taxed, d.igv, d.non_taxed, d.total, d.balance, d.status, d.match_status, d.supplier_id, coalesce(nullif(s.trade_name, ''), s.legal_name) as supplier_name,
                s.doc_number as supplier_doc, d.po_id, o.number as po_number, d.establishment_id, b.name as brand_name, u.name as registered_by_name, d.registered_at,
                (d.file_pdf_url is not null) as has_pdf, (d.file_xml_url is not null) as has_xml,
                (select e.number from journal_entries e where e.source_id = d.id and e.source_kind in ('PURCHASE','NTI') and e.status <> 'VOIDED' order by e.created_at desc limit 1) as entry_number,
                (select e.status from journal_entries e where e.source_id = d.id and e.source_kind in ('PURCHASE','NTI') and e.status <> 'VOIDED' order by e.created_at desc limit 1) as entry_status");
        $this->porLocal($q, $r, 'd.establishment_id');

        return response()->json(Listado::de(DB::query()->fromSub($q, 'd'), $r, buscar: ['doc_number', 'supplier_name', 'supplier_doc', 'po_number'],
            ordenar: ['issue_date', 'due_date', 'doc_number', 'supplier_name', 'total', 'balance', 'match_status', 'registered_at'], porDefecto: '-issue_date'));
    }

    public function show(Request $r, string $id)
    {
        $d = D::ver($id);
        $this->dentroDelAlcance($r, $d->establishment_id);
        $d->match = $d->po_id ? D::cruce($id) : null;

        return response()->json($d);
    }

    /** Aviso de duplicado mientras se escribe (RN-COM-05). */
    public function duplicado(Request $r)
    {
        $d = $r->validate(['supplier_id' => 'required|uuid', 'doc_type' => 'required|string', 'series' => 'required|string|max:8', 'number' => 'required|string|max:20']);
        $x = D::duplicado($d['supplier_id'], $d['doc_type'], strtoupper($d['series']), $d['number']);

        return response()->json(['duplicate' => (bool) $x, 'document' => $x ? ['id' => $x->id, 'label' => C::etiquetaDoc($x), 'issue_date' => $x->issue_date] : null]);
    }

    public function tipoCambio(Request $r)
    {
        $d = $r->validate(['currency' => 'required|in:PEN,USD,EUR', 'date' => 'required|date']);

        return response()->json(['rate' => D::tipoCambio($d['currency'], $d['date'])]);
    }

    public function store(Request $r)
    {
        $d = $r->validate([
            'supplier_id' => 'required|uuid', 'doc_type' => 'required|in:'.implode(',', array_keys(C::TIPOS_DOC)), 'series' => 'required|string|max:8', 'number' => 'required|string|max:20',
            'issue_date' => 'required|date', 'due_date' => 'nullable|date', 'accounting_date' => 'nullable|date', 'currency' => 'nullable|in:PEN,USD,EUR', 'exchange_rate' => 'nullable|numeric|gt:0',
            'base_taxed' => 'required|numeric|min:0', 'igv' => 'required|numeric|min:0', 'non_taxed' => 'nullable|numeric|min:0', 'other_charges' => 'nullable|numeric|min:0',
            'total' => 'required|numeric|gt:0', 'igv_is_credit' => 'nullable|boolean', 'po_id' => 'nullable|uuid', 'receipt_id' => 'nullable|uuid', 'related_document_id' => 'nullable|uuid',
            'establishment_id' => 'nullable|uuid', 'brand_id' => 'nullable|uuid', 'cost_center_id' => 'nullable|uuid', 'description' => 'nullable|string|max:300',
            'file_pdf_url' => 'nullable|string|max:500', 'file_xml_url' => 'nullable|string|max:500', 'notes' => 'nullable|string|max:500',
            'lines' => 'nullable|array', 'lines.*.receipt_line_id' => 'nullable|uuid', 'lines.*.variant_id' => 'nullable|uuid', 'lines.*.description' => 'nullable|string|max:200',
            'lines.*.qty' => 'nullable|numeric|min:0', 'lines.*.unit_price' => 'nullable|numeric|min:0', 'lines.*.cost_center_id' => 'nullable|uuid',
        ]);
        C::enAlcance($r->user(), $d['establishment_id'] ?? null);

        return response()->json(D::registrar($d, $r->user()), 201);
    }

    /** COM-08: comprobantes con su cruce de tres vías (por defecto los observados). */
    public function cruces(Request $r)
    {
        $q = DB::table('purchase_documents as d')->join('suppliers as s', 's.id', '=', 'd.supplier_id')->leftJoin('purchase_orders as o', 'o.id', '=', 'd.po_id')
            ->whereNotNull('d.po_id')->where('d.status', '<>', 'VOIDED')
            ->when($r->query('match_status', 'OBSERVED'), fn ($x, $v) => $v === 'ALL' ? $x : $x->whereIn('d.match_status', explode(',', $v)))
            ->selectRaw("d.id, d.doc_type, d.series || '-' || d.number as doc_number, d.issue_date, d.total, d.match_status, d.match_note, d.supplier_id,
                coalesce(nullif(s.trade_name, ''), s.legal_name) as supplier_name, d.po_id, o.number as po_number, o.total as po_total, d.establishment_id, d.registered_by, d.match_detail,
                (select sum(rc.total_cost) from purchase_receipts rc where rc.po_id = d.po_id and rc.status = 'POSTED') as received_total");
        $this->porLocal($q, $r, 'd.establishment_id');
        $p = Listado::de(DB::query()->fromSub($q, 'd'), $r, buscar: ['doc_number', 'supplier_name', 'po_number'], ordenar: ['issue_date', 'total', 'supplier_name', 'match_status'], porDefecto: '-issue_date');
        $p->getCollection()->transform(function ($x) {
            $x->match_detail = json_decode($x->match_detail ?: '[]', true) ?: [];

            return $x;
        });

        return response()->json($p);
    }

    public function cruce(string $id)
    {
        return response()->json(D::cruce($id));
    }

    public function aprobarDiferencia(Request $r, string $id)
    {
        $d = $r->validate(['note' => 'required|string|min:5|max:300']);

        return response()->json(D::aprobarDiferencia($id, $d['note'], $r->user()));
    }

    public function anular(Request $r, string $id)
    {
        $d = $r->validate(['reason' => 'required|string|min:5|max:300']);

        return response()->json(D::anular($id, $d['reason'], $r->user()));
    }
}
