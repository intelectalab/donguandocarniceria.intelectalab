<?php

namespace App\Modulos\Fac\Services;

use App\Models\User;
use App\Support\RuleError;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** Lecturas de FAC: lista y filtros (FAC-01), ficha (FAC-04), XML y CDR, y las cifras (FAC-12, KPI-FAC). */
final class Consultas
{
    /** Consulta base de comprobantes con los filtros de FAC-01 y el alcance del usuario. */
    public static function comprobantes(Request $r, User $u)
    {
        $q = DB::table('sales_documents as d')->leftJoin('establishments as e', 'e.id', '=', 'd.establishment_id')->leftJoin('brands as b', 'b.id', '=', 'd.brand_id');
        Emision::filtrar($q, $u);
        $brand = $r->query('brand') ?? $r->query('brand_id');
        $site = $r->query('site') ?? $r->query('establishment_id');

        return $q->when($brand && $brand !== 'ALL', fn ($w) => $w->where('d.brand_id', $brand))
            ->when($site && $site !== 'ALL', fn ($w) => $w->where('d.establishment_id', $site))
            ->when($r->query('doc_type'), fn ($w, $v) => $w->whereIn('d.doc_type', explode(',', $v)))
            ->when($r->query('series'), fn ($w, $v) => $w->where('d.series', strtoupper($v)))
            ->when($r->query('sunat_status'), fn ($w, $v) => $w->whereIn('d.sunat_status', explode(',', $v)))
            ->when($r->query('status'), fn ($w, $v) => $w->where('d.status', $v))
            ->when($r->query('customer_id'), fn ($w, $v) => $w->where('d.customer_id', $v))
            ->when($r->query('order_id'), fn ($w, $v) => $w->where('d.order_id', $v))
            ->when($r->query('source'), fn ($w, $v) => $w->where('d.source', $v))
            ->when($r->query('from'), fn ($w, $v) => $w->where('d.issue_date', '>=', $v))
            ->when($r->query('to'), fn ($w, $v) => $w->where('d.issue_date', '<=', $v));
    }

    public static function columnas(): array
    {
        return ['d.id', 'd.doc_type', 'd.series', 'd.number', 'd.full_number', 'd.issue_date', 'd.issued_at', 'd.customer_name', 'd.customer_doc_type',
            'd.customer_doc_number', 'd.brand_id', DB::raw('coalesce(d.brand_name, b.name) as brand_name'), 'd.establishment_id', 'd.subtotal', 'd.igv', 'd.total', 'd.payment_terms', 'd.due_date',
            'd.sunat_status', 'd.status', 'd.send_attempts', 'd.next_retry_at', 'd.needs_review', 'd.sunat_code', 'd.sunat_message', 'd.order_id',
            'd.related_document_id', 'd.pos_ticket', 'd.source', 'd.summary_pending', 'd.reissued_by', 'd.note_reason_code', 'e.short as site'];
    }

    /** Cifras de la cabecera de FAC-01 con los mismos filtros. */
    public static function totales(Request $r, User $u): array
    {
        $t = self::comprobantes($r, $u)->selectRaw("
            count(*) as n,
            coalesce(sum(d.total) filter (where d.doc_type in ('INVOICE','RECEIPT','DEBIT_NOTE') and d.status = 'ISSUED' and d.sunat_status <> 'REJECTED'), 0) as ventas,
            coalesce(sum(d.total) filter (where d.doc_type = 'CREDIT_NOTE' and d.status = 'ISSUED' and d.sunat_status <> 'REJECTED'), 0) as notas,
            coalesce(sum(d.igv) filter (where d.doc_type in ('INVOICE','RECEIPT','DEBIT_NOTE') and d.status = 'ISSUED' and d.sunat_status <> 'REJECTED'), 0)
              - coalesce(sum(d.igv) filter (where d.doc_type = 'CREDIT_NOTE' and d.status = 'ISSUED' and d.sunat_status <> 'REJECTED'), 0) as igv,
            count(*) filter (where d.sunat_status = 'PENDING' and d.status = 'ISSUED') as pendientes,
            count(*) filter (where d.sunat_status = 'PENDING' and d.status = 'ISSUED' and d.needs_review) as revision,
            count(*) filter (where d.sunat_status = 'REJECTED' and d.reissued_by is null) as rechazados,
            count(*) filter (where d.sunat_status in ('ACCEPTED','OBSERVED')) as aceptados")->first();

        return ['comprobantes' => (int) $t->n, 'ventas' => round((float) $t->ventas, 2), 'notas' => round((float) $t->notas, 2),
            'neto' => round((float) $t->ventas - (float) $t->notas, 2), 'igv' => round((float) $t->igv, 2), 'pendientes' => (int) $t->pendientes,
            'revision' => (int) $t->revision, 'rechazados' => (int) $t->rechazados, 'aceptados' => (int) $t->aceptados];
    }

    /** FAC-04: todo lo del comprobante. */
    public static function ficha(string $id, User $u): array
    {
        $d = DB::table('sales_documents')->where('id', $id)->first() ?? abort(404);
        Emision::alcance($u, $d->brand_id, $d->establishment_id);
        $d->brand_name ??= DB::table('brands')->where('id', $d->brand_id)->value('name');
        $lineas = DB::table('sales_document_lines as l')->leftJoin('product_variants as v', 'v.id', '=', 'l.variant_id')->leftJoin('lots as lo', 'lo.id', '=', 'l.lot_id')
            ->where('l.sales_document_id', $id)->orderBy('l.line_no')
            ->get(['l.id', 'l.line_no', 'l.variant_id', 'l.description', 'l.qty', 'l.uom_code', 'l.unit_price', 'l.igv_affectation', 'l.subtotal', 'l.igv', 'l.total', 'v.sku', 'lo.code as lot']);
        $cobros = DB::table('payment_allocations as a')->join('payments as p', 'p.id', '=', 'a.payment_id')->leftJoin('payment_methods as m', 'm.id', '=', 'p.payment_method_id')
            ->where(fn ($w) => $w->where('a.document_id', $id)->when($d->order_id, fn ($x) => $x->orWhere(fn ($y) => $y->where('a.order_id', $d->order_id)->whereNull('a.document_id'))))
            ->orderBy('p.paid_at')->get(['p.id', 'p.number', 'p.paid_at', 'p.status', 'm.name as medio', 'a.amount', 'p.reference']);
        $envios = DB::table('einvoice_submissions')->where('document_id', $id)->orderBy('attempt_no')
            ->get(['attempt_no', 'requested_at', 'provider', 'result', 'response_code', 'message', 'duration_ms', 'manual', 'requested_by_name']);
        $notas = DB::table('sales_documents')->where('related_document_id', $id)->orderBy('issued_at')
            ->get(['id', 'doc_type', 'full_number', 'total', 'note_reason_code', 'note_reason', 'issue_date', 'sunat_status', 'status']);
        $rel = fn ($x) => $x ? DB::table('sales_documents')->where('id', $x)->first(['id', 'doc_type', 'full_number', 'total', 'sunat_status', 'status']) : null;
        $pedido = $d->order_id ? DB::table('sales_orders')->where('id', $d->order_id)->first(['id', 'number', 'status', 'channel', 'delivery_date', 'final_total', 'estimated_total']) : null;
        $resumen = DB::table('sunat_daily_summary_lines as l')->join('sunat_daily_summaries as s', 's.id', '=', 'l.summary_id')->where('l.document_id', $id)
            ->get(['s.id', 's.identifier', 's.summary_type', 's.status', 's.ticket', 'l.action']);
        $guias = DB::table('dispatch_guides')->where('sales_document_id', $id)->orWhere(fn ($w) => $w->whereNotNull('order_id')->where('order_id', $d->order_id))
            ->get(['id', 'full_number', 'transfer_reason_code', 'sunat_status', 'status']);
        $acreditado = in_array($d->doc_type, ['INVOICE', 'RECEIPT'], true) ? Notas::acreditado($id) : 0;

        return [
            'documento' => $d, 'tipo' => Catalogos::TIPOS[$d->doc_type] ?? $d->doc_type, 'lineas' => $lineas, 'cobros' => $cobros, 'envios' => $envios,
            'notas' => $notas, 'relacionado' => $rel($d->related_document_id), 'reemitido_por' => $rel($d->reissued_by), 'reemite_a' => $rel($d->reissue_of),
            'pedido' => $pedido, 'resumenes' => $resumen, 'guias' => $guias, 'acreditado' => $acreditado,
            'disponible_nc' => round((float) $d->total - $acreditado, 2), 'acreditado_por_linea' => Notas::acreditadoPorLinea($d),
            'motivo' => $d->note_reason_code ? ($d->doc_type === 'DEBIT_NOTE' ? Catalogos::CAT10 : Catalogos::CAT09)[$d->note_reason_code] ?? null : null,
            'almacen_reingreso' => $d->restocked_warehouse_id ? DB::table('warehouses')->where('id', $d->restocked_warehouse_id)->value('name') : null,
            'seller' => $d->seller_id ? DB::table('users')->where('id', $d->seller_id)->value('name') : null,
        ] + Plantillas::impresion($d);
    }

    /** XML UBL 2.1 del comprobante (lo que se firma y envía al OSE). */
    public static function xml(object $d): string
    {
        $e = DB::table('companies')->where('id', $d->company_id)->first();
        $ls = DB::table('sales_document_lines')->where('sales_document_id', $d->id)->orderBy('line_no')->get();
        $raiz = ['INVOICE' => 'Invoice', 'RECEIPT' => 'Invoice', 'CREDIT_NOTE' => 'CreditNote', 'DEBIT_NOTE' => 'DebitNote'][$d->doc_type];
        $x = fn ($v) => htmlspecialchars((string) $v, ENT_XML1 | ENT_QUOTES, 'UTF-8');
        $f = fn ($v) => number_format((float) $v, 2, '.', '');
        $out = '<?xml version="1.0" encoding="UTF-8"?>'."\n";
        $out .= "<{$raiz} xmlns=\"urn:oasis:names:specification:ubl:schema:xsd:{$raiz}-2\" xmlns:cac=\"urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2\" xmlns:cbc=\"urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2\">\n";
        $out .= "  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>\n  <cbc:CustomizationID>2.0</cbc:CustomizationID>\n";
        $out .= "  <cbc:ID>{$x($d->full_number)}</cbc:ID>\n  <cbc:IssueDate>{$x($d->issue_date)}</cbc:IssueDate>\n";
        if ($d->due_date) {
            $out .= "  <cbc:DueDate>{$x($d->due_date)}</cbc:DueDate>\n";
        }
        if (in_array($d->doc_type, ['INVOICE', 'RECEIPT'], true)) {
            $out .= '  <cbc:InvoiceTypeCode listID="0101">'.Catalogos::CODIGO[$d->doc_type]."</cbc:InvoiceTypeCode>\n";
        }
        $out .= "  <cbc:DocumentCurrencyCode>PEN</cbc:DocumentCurrencyCode>\n";
        if ($d->related_document_id) {
            $ref = DB::table('sales_documents')->where('id', $d->related_document_id)->first(['full_number', 'doc_type']);
            $out .= "  <cac:DiscrepancyResponse>\n    <cbc:ReferenceID>{$x($ref->full_number)}</cbc:ReferenceID>\n    <cbc:ResponseCode>{$x($d->note_reason_code)}</cbc:ResponseCode>\n    <cbc:Description>{$x($d->note_reason)}</cbc:Description>\n  </cac:DiscrepancyResponse>\n";
            $out .= "  <cac:BillingReference><cac:InvoiceDocumentReference><cbc:ID>{$x($ref->full_number)}</cbc:ID><cbc:DocumentTypeCode>".Catalogos::CODIGO[$ref->doc_type]."</cbc:DocumentTypeCode></cac:InvoiceDocumentReference></cac:BillingReference>\n";
        }
        $out .= "  <cac:AccountingSupplierParty><cac:Party>\n    <cac:PartyIdentification><cbc:ID schemeID=\"6\">{$x($e->ruc)}</cbc:ID></cac:PartyIdentification>\n";
        $out .= "    <cac:PartyName><cbc:Name>{$x($d->brand_name)}</cbc:Name></cac:PartyName>\n    <cac:PartyLegalEntity><cbc:RegistrationName>{$x($e->legal_name)}</cbc:RegistrationName></cac:PartyLegalEntity>\n  </cac:Party></cac:AccountingSupplierParty>\n";
        $out .= "  <cac:AccountingCustomerParty><cac:Party>\n    <cac:PartyIdentification><cbc:ID schemeID=\"".(Catalogos::DOC_ID[$d->customer_doc_type] ?? '0')."\">{$x($d->customer_doc_number ?: '-')}</cbc:ID></cac:PartyIdentification>\n";
        $out .= "    <cac:PartyLegalEntity><cbc:RegistrationName>{$x($d->customer_name)}</cbc:RegistrationName></cac:PartyLegalEntity>\n  </cac:Party></cac:AccountingCustomerParty>\n";
        $out .= "  <cac:TaxTotal>\n    <cbc:TaxAmount currencyID=\"PEN\">{$f($d->igv)}</cbc:TaxAmount>\n  </cac:TaxTotal>\n";
        $out .= "  <cac:LegalMonetaryTotal>\n    <cbc:LineExtensionAmount currencyID=\"PEN\">{$f($d->subtotal)}</cbc:LineExtensionAmount>\n    <cbc:PayableAmount currencyID=\"PEN\">{$f($d->total)}</cbc:PayableAmount>\n  </cac:LegalMonetaryTotal>\n";
        $tag = ['Invoice' => 'InvoiceLine', 'CreditNote' => 'CreditNoteLine', 'DebitNote' => 'DebitNoteLine'][$raiz];
        $qtag = ['Invoice' => 'InvoicedQuantity', 'CreditNote' => 'CreditedQuantity', 'DebitNote' => 'DebitedQuantity'][$raiz];
        foreach ($ls as $l) {
            $out .= "  <cac:{$tag}>\n    <cbc:ID>{$l->line_no}</cbc:ID>\n    <cbc:{$qtag} unitCode=\"{$x($l->uom_code)}\">".number_format((float) $l->qty, 3, '.', '')."</cbc:{$qtag}>\n";
            $out .= "    <cbc:LineExtensionAmount currencyID=\"PEN\">{$f($l->subtotal)}</cbc:LineExtensionAmount>\n";
            $out .= "    <cac:TaxTotal><cbc:TaxAmount currencyID=\"PEN\">{$f($l->igv)}</cbc:TaxAmount><cac:TaxSubtotal><cbc:TaxableAmount currencyID=\"PEN\">{$f($l->subtotal)}</cbc:TaxableAmount><cac:TaxCategory><cbc:TaxExemptionReasonCode>{$x($l->igv_affectation)}</cbc:TaxExemptionReasonCode></cac:TaxCategory></cac:TaxSubtotal></cac:TaxTotal>\n";
            $out .= "    <cac:Item><cbc:Description>{$x($l->description)}</cbc:Description></cac:Item>\n    <cac:Price><cbc:PriceAmount currencyID=\"PEN\">{$f($l->unit_price)}</cbc:PriceAmount></cac:Price>\n  </cac:{$tag}>\n";
        }
        $out .= "  <!-- Hash: {$x($d->xml_hash)} -->\n</{$raiz}>\n";

        return $out;
    }

    /** CDR (constancia de recepción) del comprobante aceptado u observado. */
    public static function cdr(object $d): string
    {
        if (! in_array($d->sunat_status, ['ACCEPTED', 'OBSERVED', 'VOIDED'], true) || ! $d->cdr_hash) {
            RuleError::fail('RN-FAC-06', "{$d->full_number} aún no tiene constancia de recepción (CDR) de SUNAT.");
        }
        $ruc = DB::table('companies')->where('id', $d->company_id)->value('ruc');
        $x = fn ($v) => htmlspecialchars((string) $v, ENT_XML1 | ENT_QUOTES, 'UTF-8');

        return '<?xml version="1.0" encoding="UTF-8"?>'."\n"
            .'<ar:ApplicationResponse xmlns:ar="urn:oasis:names:specification:ubl:schema:xsd:ApplicationResponse-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2">'."\n"
            ."  <cbc:ID>{$x($d->cdr_hash)}</cbc:ID>\n  <cbc:IssueDate>".substr((string) $d->accepted_at, 0, 10)."</cbc:IssueDate>\n"
            ."  <cac:SenderParty><cac:PartyIdentification><cbc:ID>20131312955</cbc:ID></cac:PartyIdentification></cac:SenderParty>\n"
            ."  <cac:ReceiverParty><cac:PartyIdentification><cbc:ID>{$x($ruc)}</cbc:ID></cac:PartyIdentification></cac:ReceiverParty>\n"
            ."  <cac:DocumentResponse>\n    <cac:Response><cbc:ReferenceID>{$x($d->full_number)}</cbc:ReferenceID><cbc:ResponseCode>{$x($d->sunat_code ?? '0')}</cbc:ResponseCode><cbc:Description>{$x($d->sunat_message)}</cbc:Description></cac:Response>\n"
            ."    <cac:DocumentReference><cbc:ID>{$x($d->full_number)}</cbc:ID></cac:DocumentReference>\n  </cac:DocumentResponse>\n"
            ."  <!-- Proveedor de prueba (D-FAC-01): constancia simulada, no emitida por SUNAT. -->\n</ar:ApplicationResponse>\n";
    }

    /** FAC-12: resumen del mes por tipo, marca y estado SUNAT, con los KPI-FAC. */
    public static function periodo(string $mes, User $u, ?string $marca = null, ?string $local = null): array
    {
        $desde = substr($mes, 0, 7).'-01';
        $hasta = date('Y-m-t', strtotime($desde));
        $base = fn () => Emision::filtrar(DB::table('sales_documents as d'), $u)->whereBetween('d.issue_date', [$desde, $hasta])
            ->when($marca && $marca !== 'ALL', fn ($w) => $w->where('d.brand_id', $marca))
            ->when($local && $local !== 'ALL', fn ($w) => $w->where('d.establishment_id', $local));
        $filas = $base()->leftJoin('brands as b', 'b.id', '=', 'd.brand_id')
            ->groupBy('d.doc_type', 'b.name', 'd.brand_id', 'd.sunat_status', 'd.status')
            ->orderBy('b.name')->orderBy('d.doc_type')
            ->get([DB::raw('d.doc_type'), DB::raw('b.name as marca'), 'd.brand_id', 'd.sunat_status', 'd.status', DB::raw('count(*) as cantidad'),
                DB::raw('sum(d.subtotal) as subtotal'), DB::raw('sum(d.igv) as igv'), DB::raw('sum(d.total) as total'),
                DB::raw('min(d.full_number) as desde'), DB::raw('max(d.full_number) as hasta')]);
        $validos = $base()->where('d.status', 'ISSUED')->where('d.sunat_status', '<>', 'REJECTED');
        $ventas = (float) (clone $validos)->whereIn('d.doc_type', ['INVOICE', 'RECEIPT'])->sum('d.total');
        $nc = (float) (clone $validos)->where('d.doc_type', 'CREDIT_NOTE')->sum('d.total');
        $nd = (float) (clone $validos)->where('d.doc_type', 'DEBIT_NOTE')->sum('d.total');
        $enviados = $base()->where('d.send_attempts', '>', 0)->count();
        $rechazados = $base()->where('d.sunat_status', 'REJECTED')->count();
        $mediana = $base()->whereNotNull('d.accepted_at')->whereNotNull('d.issued_at')
            ->selectRaw('percentile_cont(0.5) within group (order by extract(epoch from (d.accepted_at - d.issued_at)) / 60) as m')->value('m');
        $entregados = DB::table('sales_orders as o')->whereIn('o.status', ['DELIVERED', 'CLOSED'])->whereBetween('o.delivered_at', [$desde, $hasta.' 23:59:59'])
            ->where('o.requested_doc_type', '<>', 'NONE')->where('o.channel', '<>', 'COUNTER')
            ->when($marca && $marca !== 'ALL', fn ($w) => $w->where('o.brand_id', $marca));
        $sinDoc = (clone $entregados)->where('o.delivered_at', '<', now()->subDay())
            ->whereNotExists(fn ($w) => $w->from('sales_documents as x')->whereColumn('x.order_id', 'o.id')->whereIn('x.doc_type', ['INVOICE', 'RECEIPT'])->where('x.status', 'ISSUED'))->count();
        $totalEntregados = $entregados->count();

        return [
            'mes' => $desde, 'desde' => $desde, 'hasta' => $hasta, 'filas' => $filas,
            'cifras' => ['ventas' => round($ventas, 2), 'notas_credito' => round($nc, 2), 'notas_debito' => round($nd, 2), 'neto' => round($ventas - $nc + $nd, 2),
                'comprobantes' => $base()->count(), 'igv' => round((float) (clone $validos)->whereIn('d.doc_type', ['INVOICE', 'RECEIPT', 'DEBIT_NOTE'])->sum('d.igv')
                    - (float) (clone $validos)->where('d.doc_type', 'CREDIT_NOTE')->sum('d.igv'), 2)],
            'kpis' => [
                'rechazados_pct' => $enviados ? round($rechazados / $enviados * 100, 2) : 0,
                'pendientes_24h' => Emision::filtrar(DB::table('sales_documents as d'), $u)->where('d.sunat_status', 'PENDING')->where('d.status', 'ISSUED')->where('d.issued_at', '<', now()->subDay())->count(),
                'notas_sobre_ventas_pct' => $ventas > 0 ? round($nc / $ventas * 100, 2) : 0,
                'mediana_aceptacion_min' => $mediana !== null ? round((float) $mediana, 1) : null,
                'entregados_sin_comprobante_pct' => $totalEntregados ? round($sinDoc / $totalEntregados * 100, 2) : 0,
                'entregados_sin_comprobante' => $sinDoc,
            ],
        ];
    }
}
