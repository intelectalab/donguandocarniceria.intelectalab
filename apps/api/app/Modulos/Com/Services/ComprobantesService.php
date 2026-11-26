<?php

namespace App\Modulos\Com\Services;

use App\Models\User;
use App\Modulos\Cnt\Services\AsientosService;
use App\Modulos\Cnt\Services\BandejaService;
use App\Modulos\Com\Services\Soporte as C;
use App\Modulos\Plt\Services\Periodos;
use App\Support\Access;
use App\Support\Events;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * COM-07 Comprobantes del proveedor y COM-08 Cruce de tres vías.
 *  RN-COM-05  único por empresa, proveedor, tipo, serie y número (también en la base).
 *  RN-COM-06  total = base gravada + IGV + no gravado + otros cargos (también en la base).
 *  RN-COM-07  precio facturado distinto del de la OC en más de com_price_tolerance_pct, o cantidad facturada distinta de la
 *             recibida: el comprobante queda observado y va a la bandeja de la contadora (CNT-05).
 *  RN-COM-09  sin fecha contable en un período cerrado.
 *  RN-COM-10  la diferencia de costo con la recepción ajusta el lote si queda stock; lo consumido va al costo de ventas.
 *  RN-COM-12  una NTI no lleva IGV (también en la base).
 *  RN-COM-14  un comprobante con pagos no se anula: se registra una nota de crédito.
 *  RN-COM-15  el costo que entra al inventario es la base sin IGV si el IGV es crédito fiscal; si no, el total.
 */
final class ComprobantesService
{
    public static function duplicado(string $supplierId, string $tipo, string $serie, string $numero): ?object
    {
        return DB::table('purchase_documents')->where('supplier_id', $supplierId)->where('doc_type', $tipo)->where('series', $serie)
            ->where('number', $numero)->where('status', '<>', 'VOIDED')->first();
    }

    public static function normalizarNumero(string $n): string
    {
        $n = preg_replace('/\D/', '', $n);

        return ltrim($n, '0') === '' ? '0' : ltrim($n, '0');
    }

    /** Tipo de cambio de la fecha (venta, de MAE) para un comprobante en dólares (RN-CNT-19). */
    public static function tipoCambio(string $moneda, string $fecha): ?float
    {
        if ($moneda === 'PEN') {
            return 1.0;
        }
        $tc = DB::table('exchange_rates')->where('currency', $moneda)->where('date', '<=', $fecha)->orderByDesc('date')->value('sell');

        return $tc ? (float) $tc : null;
    }

    public static function registrar(array $d, User $quien, array $opc = []): object
    {
        return DB::transaction(function () use ($d, $quien, $opc) {
            $s = C::proveedor($d['supplier_id'] ?? null);
            $tipo = $d['doc_type'] ?? 'INVOICE';
            $serie = strtoupper(trim((string) ($d['series'] ?? '')));
            $numero = self::normalizarNumero((string) ($d['number'] ?? ''));
            if ($serie === '' || $numero === '0') {
                RuleError::fail('RN-COM-05', 'Indica la serie y el número del comprobante.');
            }
            DB::select('SELECT pg_advisory_xact_lock(hashtext(?))', ["com:doc:{$s->id}:{$tipo}:{$serie}:{$numero}"]);
            if ($dup = self::duplicado($s->id, $tipo, $serie, $numero)) {
                RuleError::fail('RN-COM-05', (C::TIPOS_DOC[$tipo][0] ?? $tipo)." {$serie}-{$numero} de ".C::nombreProveedor($s).' ya está registrada (del '.C::dmy($dup->issue_date).', '.C::soles($dup->total).').');
            }
            $rc = ! empty($d['receipt_id']) ? DB::table('purchase_receipts')->where('id', $d['receipt_id'])->first() : null;
            $po = ! empty($d['po_id']) ? DB::table('purchase_orders')->where('id', $d['po_id'])->first() : ($rc && $rc->po_id ? DB::table('purchase_orders')->where('id', $rc->po_id)->first() : null);
            foreach ([$rc, $po] as $x) {
                if ($x && $x->supplier_id !== $s->id) {
                    RuleError::fail('RN-COM-07', 'La recepción o la OC vinculada es de otro proveedor.');
                }
            }
            $emision = C::fecha($d['issue_date'] ?? null);
            $contable = C::fecha($d['accounting_date'] ?? $emision);
            $local = $d['establishment_id'] ?? $rc->establishment_id ?? $po->establishment_id ?? DB::table('establishments')->orderBy('code')->value('id');
            $empresa = C::empresaDe($local);
            if (Periodos::cerrado($contable, $empresa)) {
                RuleError::fail('RN-COM-09', 'El período de '.Periodos::nombre($contable).' está cerrado: registra el comprobante con fecha contable en un período abierto.');
            }
            $moneda = $d['currency'] ?? 'PEN';
            $tc = $moneda === 'PEN' ? 1.0 : (isset($d['exchange_rate']) && (float) $d['exchange_rate'] > 0 ? (float) $d['exchange_rate'] : self::tipoCambio($moneda, $emision));
            if (! $tc) {
                RuleError::fail('RN-CNT-19', 'El comprobante en dólares necesita el tipo de cambio de su fecha: cárgalo en Maestros o escríbelo.');
            }
            $nti = $tipo === 'INTERNAL_TRANSFER';
            $conIgv = in_array($tipo, C::CON_IGV, true);
            $lineas = array_values(array_filter($d['lines'] ?? [], fn ($l) => (! empty($l['description']) || ! empty($l['variant_id'])) && (float) ($l['qty'] ?? 0) > 0));
            $base = $d['base_taxed'] ?? null;
            $igv = $d['igv'] ?? null;
            $noGravado = (float) ($d['non_taxed'] ?? 0);
            $otros = (float) ($d['other_charges'] ?? 0);
            $total = $d['total'] ?? null;
            if ($lineas && ($base === null || $base === '')) {
                $sub = C::r(array_sum(array_map(fn ($l) => (float) $l['qty'] * (float) $l['unit_price'], $lineas)));
                if ($conIgv) {
                    $base = $sub;
                    $igv = C::r($sub * C::igv());
                } else {
                    $base = 0;
                    $igv = 0;
                    $noGravado = C::r($noGravado + $sub);
                }
                $total = null;
            }
            $base = C::r($base ?? 0);
            $igv = C::r($igv ?? 0);
            $total = $total === null || $total === '' ? C::r($base + $igv + $noGravado + $otros) : C::r($total);
            if ($nti && abs($igv) > 0.001) {
                RuleError::fail('RN-COM-12', 'Una NTI de la granja no lleva IGV: el IGV debe ser 0,00.');
            }
            if (abs(C::r($base + $igv + $noGravado + $otros) - $total) > 0.011) {
                RuleError::fail('RN-COM-06', 'El total '.C::soles($total).' no cuadra: base '.C::soles($base).' + IGV '.C::soles($igv).' + no gravado '.C::soles($noGravado).' + otros '.C::soles($otros).' = '.C::soles($base + $igv + $noGravado + $otros).'.');
            }
            if (! ($total > 0)) {
                RuleError::fail('RN-COM-06', 'El total del comprobante debe ser mayor que cero.');
            }
            $credito = array_key_exists('igv_is_credit', $d) ? (bool) $d['igv_is_credit'] && in_array($tipo, C::CON_CREDITO, true) : in_array($tipo, C::CON_CREDITO, true);
            $relacionado = null;
            if ($tipo === 'CREDIT_NOTE') {
                $relacionado = ! empty($d['related_document_id']) ? DB::table('purchase_documents')->where('id', $d['related_document_id'])->lockForUpdate()->first() : null;
                if (! $relacionado || $relacionado->supplier_id !== $s->id) {
                    RuleError::fail('RN-COM-14', 'Una nota de crédito va con el comprobante del mismo proveedor que corrige.');
                }
            }
            $sunat = C::TIPOS_DOC[$tipo][1] ?? '00';
            $id = DB::table('purchase_documents')->insertGetId([
                'company_id' => $empresa, 'supplier_id' => $s->id, 'establishment_id' => $local, 'brand_id' => $d['brand_id'] ?? $po->brand_id ?? null,
                'cost_center_id' => $d['cost_center_id'] ?? $s->default_cost_center_id ?? DB::table('cost_centers')->where('status', 'ACTIVE')->orderBy('code')->value('id'),
                'doc_type' => $tipo, 'sunat_doc_type' => $sunat, 'series' => $serie, 'number' => $numero, 'issue_date' => $emision,
                'due_date' => $d['due_date'] ?? ($nti ? null : C::ahora()->parse($emision)->addDays((int) $s->payment_terms_days)->toDateString()),
                'accounting_date' => $contable, 'currency' => $moneda, 'exchange_rate' => $tc, 'base_taxed' => $base, 'igv' => $igv, 'non_taxed' => $noGravado,
                'other_charges' => $otros, 'total' => $total, 'igv_is_credit' => $credito, 'po_id' => $po->id ?? null, 'receipt_id' => $rc->id ?? null,
                'related_document_id' => $relacionado->id ?? null,
                'file_pdf_url' => $d['file_pdf_url'] ?? "comprobantes/{$s->doc_number}-{$sunat}-{$serie}-{$numero}.pdf",
                'file_xml_url' => $nti ? null : ($d['file_xml_url'] ?? "comprobantes/{$s->doc_number}-{$sunat}-{$serie}-{$numero}.xml"),
                'match_status' => 'NOT_CHECKED', 'status' => 'REGISTERED', 'paid_amount' => 0,
                'balance' => ($nti && ($opc['nti_sin_saldo'] ?? true)) || $tipo === 'CREDIT_NOTE' ? 0 : $total,
                'registered_by' => $quien->id, 'registered_at' => now(), 'farm_dispatch_id' => $d['farm_dispatch_id'] ?? null, 'notes' => $d['notes'] ?? null,
                'description' => $d['description'] ?? ($lineas ? collect($lineas)->map(fn ($l) => $l['description'] ?? DB::table('product_variants')->where('id', $l['variant_id'])->value('name'))->take(3)->implode(', ') : null),
            ], 'id');
            $cc = DB::table('purchase_documents')->where('id', $id)->value('cost_center_id');
            foreach ($lineas as $l) {
                $sub = C::r((float) $l['qty'] * (float) $l['unit_price']);
                $li = $conIgv ? C::r($sub * C::igv()) : 0;
                DB::table('purchase_document_lines')->insert([
                    'document_id' => $id, 'receipt_line_id' => $l['receipt_line_id'] ?? null, 'variant_id' => $l['variant_id'] ?? null,
                    'description' => $l['description'] ?? DB::table('product_variants')->where('id', $l['variant_id'])->value('name'),
                    'qty' => C::r($l['qty'], 3), 'unit_price' => C::r($l['unit_price'], 6), 'subtotal' => $conIgv ? $sub : 0, 'igv' => $li, 'total' => C::r($sub + $li),
                    'non_taxed' => $conIgv ? 0 : $sub, 'cost_center_id' => $l['cost_center_id'] ?? $cc,
                ]);
            }
            if ($rc && ! $rc->document_id) {
                DB::table('purchase_receipts')->where('id', $rc->id)->update(['document_id' => $id, 'updated_at' => now()]);
            }
            if ($relacionado) {
                DB::table('purchase_documents')->where('id', $relacionado->id)->update(['balance' => max(0, C::r((float) $relacionado->balance - $total)), 'updated_at' => now()]);
            }
            $doc = DB::table('purchase_documents')->find($id);
            $cruce = self::cruce($id);
            DB::table('purchase_documents')->where('id', $id)->update(['match_status' => $cruce['status'], 'match_detail' => json_encode($cruce['rows'], JSON_UNESCAPED_UNICODE),
                'status' => $cruce['status'] === 'OBSERVED' ? 'OBSERVED' : 'REGISTERED']);
            if ($cruce['status'] === 'OBSERVED') {
                $peor = collect($cruce['rows'])->where('ok', false)->map(fn ($r) => ! $r['price_ok']
                    ? "{$r['description']}: precio ".C::soles($r['inv_price']).' frente a '.C::soles($r['po_price'] ?? $r['rc_price']).' de la OC ('.($r['price_diff_pct'] > 0 ? '+' : '').C::pct($r['price_diff_pct'], 2).')'
                    : "{$r['description']}: facturado ".number_format($r['inv_qty'], 3, ',', '').' frente a '.number_format($r['rec_qty'], 3, ',', '').' recibido')->implode(' · ');
                BandejaService::agregar(['source_type' => 'PURCHASE_DOCUMENT', 'source_id' => $id, 'reason' => 'PO_MISMATCH', 'date' => $contable, 'company_id' => $empresa,
                    'notes' => $peor, 'ref_label' => C::nombreProveedor($s).' · '.C::etiquetaDoc($doc), 'amount' => C::r($total * $tc)]);
            } else {
                self::aplicarCosto($id);
                AsientosService::alRegistrar('PURCHASE', $id, $quien);
            }
            foreach ($lineas as $l) {
                if (! empty($l['variant_id'])) {
                    ProveedoresService::precio($s->id, $l['variant_id'], (float) $l['unit_price'], $emision, $nti ? 'NTI' : 'COMPROBANTE');
                }
            }
            Events::emit('purchase_document.registered', 'purchase_documents', $id, ['supplier_id' => $s->id, 'doc_type' => $tipo, 'total' => C::t($total), 'match_status' => $cruce['status']]);

            return self::ver($id);
        });
    }

    /** RN-COM-07: compara cada línea con su recepción y la OC (precio con tolerancia y cantidad exacta). */
    public static function cruce(string $docId): array
    {
        $tol = C::param('com_price_tolerance_pct');
        $rows = [];
        foreach (DB::table('purchase_document_lines')->where('document_id', $docId)->get() as $l) {
            $rl = $l->receipt_line_id ? DB::table('purchase_receipt_lines')->where('id', $l->receipt_line_id)->first() : null;
            if (! $rl) {
                continue;
            }
            $pl = $rl->po_line_id ? DB::table('purchase_order_lines')->where('id', $rl->po_line_id)->first() : null;
            $recQ = $rl->price_basis === 'KG' ? (float) $rl->weight_kg : (float) $rl->qty;
            $ref = $pl ? (float) $pl->unit_price : (float) $rl->unit_cost;
            $dif = $ref ? ((float) $l->unit_price - $ref) / $ref * 100 : 0;
            $difQ = C::r((float) $l->qty - $recQ, 3);
            $precioOk = abs($dif) <= $tol + 1e-9;
            $cantOk = abs($difQ) < 0.0005;
            $rows[] = ['line_id' => $l->id, 'description' => $l->description, 'variant_id' => $l->variant_id, 'basis' => $rl->price_basis,
                'po_number' => $pl ? DB::table('purchase_orders')->where('id', $pl->po_id)->value('number') : null, 'po_price' => $pl ? (float) $pl->unit_price : null,
                'rc_price' => (float) $rl->unit_cost, 'inv_price' => (float) $l->unit_price, 'price_diff_pct' => C::r($dif, 2), 'po_qty' => $pl ? OrdenesService::pedido($pl) : null,
                'rec_qty' => $recQ, 'inv_qty' => (float) $l->qty, 'qty_diff' => $difQ, 'price_ok' => $precioOk, 'qty_ok' => $cantOk, 'ok' => $precioOk && $cantOk];
        }

        return ['status' => ! $rows ? 'NOT_CHECKED' : (collect($rows)->every(fn ($r) => $r['ok']) ? 'MATCHED' : 'OBSERVED'), 'rows' => $rows, 'tolerance_pct' => $tol];
    }

    /** RN-COM-10 y RN-COM-15: la diferencia entre lo facturado y el costo de la recepción. */
    public static function aplicarCosto(string $docId): array
    {
        $d = DB::table('purchase_documents')->find($docId);
        $ajustes = [];
        foreach (DB::table('purchase_document_lines')->where('document_id', $docId)->whereNotNull('receipt_line_id')->get() as $l) {
            $rl = DB::table('purchase_receipt_lines')->where('id', $l->receipt_line_id)->first();
            if (! $rl || ! $rl->accepted) {
                continue;
            }
            $unit = (float) $l->unit_price * (float) $d->exchange_rate * ($d->igv_is_credit || ! in_array($d->doc_type, C::CON_IGV, true) ? 1 : 1 + C::igv());
            $q = $rl->price_basis === 'KG' ? (float) $rl->weight_kg : (float) $rl->qty;
            $dif = C::r(($unit - (float) $rl->unit_cost) * $q);
            if (abs($dif) < 0.005) {
                continue;
            }
            $queda = $rl->lot_id ? (float) DB::table('stock_balances')->where('lot_id', $rl->lot_id)->sum('qty') : 0;
            $parte = (float) $rl->qty > 0 ? max(0, min(1, $queda / (float) $rl->qty)) : 0;
            $aStock = C::r($dif * $parte);
            if ($rl->lot_id && $parte > 0) {
                DB::table('lots')->where('id', $rl->lot_id)->update(['unit_cost' => round($unit, 4), 'updated_at' => now()]);
            }
            $ajustes[] = ['receipt_line_id' => $rl->id, 'lot_id' => $rl->lot_id, 'diff' => $dif, 'to_stock' => $aStock, 'to_cogs' => C::r($dif - $aStock)];
        }
        DB::table('purchase_documents')->where('id', $docId)->update(['cost_adjustments' => json_encode($ajustes)]);

        return $ajustes;
    }

    /** COM-08: acepta la diferencia del cruce con motivo. La aprueba COM (A) o la contadora. */
    public static function aprobarDiferencia(string $id, string $nota, User $quien): object
    {
        return DB::transaction(function () use ($id, $nota, $quien) {
            $d = DB::table('purchase_documents')->where('id', $id)->lockForUpdate()->first() ?? abort(404);
            if ($d->match_status !== 'OBSERVED') {
                RuleError::fail('RN-COM-07', 'El comprobante no está observado.');
            }
            if (! Access::module($quien, 'COM', 'A') && ! Access::can($quien, 'cnt.entry.approve')) {
                RuleError::fail('RN-COM-07', 'Aceptar una diferencia del cruce es de la contadora, administración o el gerente.');
            }
            if ($d->registered_by === $quien->id) {
                RuleError::fail('RN-COM-07', 'Quien registró el comprobante no acepta su diferencia: debe hacerlo otra persona.');
            }
            if (mb_strlen(trim($nota)) < 5) {
                RuleError::fail('RN-COM-07', 'Indica el motivo por el que se acepta la diferencia.');
            }
            DB::table('purchase_documents')->where('id', $id)->update(['match_status' => 'APPROVED_DIFF', 'status' => 'APPROVED', 'match_note' => $nota,
                'match_approved_by' => $quien->id, 'match_approved_at' => now(), 'updated_at' => now()]);
            self::aplicarCosto($id);
            BandejaService::cerrarPorOrigen('PURCHASE_DOCUMENT', $id, 'PO_MISMATCH', $quien, 'Diferencia aceptada: '.$nota);
            AsientosService::alRegistrar('PURCHASE', $id, $quien);

            return self::ver($id);
        });
    }

    /** RN-COM-14: con pagos no se anula. */
    public static function anular(string $id, string $motivo, User $quien): object
    {
        return DB::transaction(function () use ($id, $motivo, $quien) {
            $d = DB::table('purchase_documents')->where('id', $id)->lockForUpdate()->first() ?? abort(404);
            if ($d->status === 'VOIDED') {
                RuleError::fail('RN-COM-14', 'El comprobante ya está anulado.');
            }
            if ((float) $d->paid_amount > 0.004) {
                RuleError::fail('RN-COM-14', C::etiquetaDoc($d).' tiene pagos por '.C::soles($d->paid_amount).': no se anula; registra una nota de crédito del proveedor.');
            }
            if (Periodos::cerrado($d->accounting_date, $d->company_id)) {
                RuleError::fail('RN-COM-09', 'El período del comprobante está cerrado: no se anula.');
            }
            DB::table('purchase_documents')->where('id', $id)->update(['status' => 'VOIDED', 'balance' => 0, 'void_reason' => mb_substr($motivo, 0, 255), 'voided_by' => $quien->id, 'updated_at' => now()]);
            DB::table('purchase_receipts')->where('document_id', $id)->update(['document_id' => null]);
            if ($d->related_document_id) {
                DB::table('purchase_documents')->where('id', $d->related_document_id)->increment('balance', (float) $d->total);
            }
            BandejaService::cerrarPorOrigen('PURCHASE_DOCUMENT', $id, 'PO_MISMATCH', $quien, 'Comprobante anulado');
            AsientosService::alAnular('PURCHASE', $id, $quien, 'Comprobante anulado: '.$motivo);

            return self::ver($id);
        });
    }

    public static function ver(string $id): object
    {
        $d = DB::table('purchase_documents as d')->join('suppliers as s', 's.id', '=', 'd.supplier_id')->leftJoin('purchase_orders as o', 'o.id', '=', 'd.po_id')
            ->leftJoin('purchase_receipts as r', 'r.id', '=', 'd.receipt_id')->leftJoin('cost_centers as cc', 'cc.id', '=', 'd.cost_center_id')
            ->leftJoin('brands as b', 'b.id', '=', 'd.brand_id')->leftJoin('users as u', 'u.id', '=', 'd.registered_by')->leftJoin('users as ua', 'ua.id', '=', 'd.match_approved_by')
            ->leftJoin('establishments as e', 'e.id', '=', 'd.establishment_id')
            ->where('d.id', $id)->first(['d.*', 's.legal_name as supplier_name', 's.trade_name as supplier_trade_name', 's.doc_number as supplier_doc', 's.supplier_type',
                'o.number as po_number', 'r.number as receipt_number', 'cc.code as cost_center_code', 'cc.name as cost_center_name', 'b.name as brand_name',
                'u.name as registered_by_name', 'ua.name as match_approved_by_name', 'e.name as establishment_name']) ?? abort(404);
        $d->match_detail = json_decode($d->match_detail ?? '[]', true) ?: [];
        $d->cost_adjustments = json_decode($d->cost_adjustments ?? '[]', true) ?: [];
        $d->lines = DB::table('purchase_document_lines as l')->leftJoin('product_variants as v', 'v.id', '=', 'l.variant_id')->where('l.document_id', $id)
            ->orderBy('l.created_at')->get(['l.*', 'v.sku']);
        $d->payments = DB::table('supplier_payment_allocations as a')->join('supplier_payments as p', 'p.id', '=', 'a.payment_id')->where('a.document_id', $id)
            ->orderBy('p.paid_at')->get(['p.id', 'p.number', 'p.paid_at', 'p.method', 'p.reference', 'p.status', 'a.amount']);
        $d->entries = DB::table('journal_entries')->where('source_id', $id)->whereIn('source_kind', ['PURCHASE', 'NTI'])->orderBy('prepared_at')
            ->get(['id', 'number', 'status', 'total_debit', 'entry_date']);
        $d->label = C::etiquetaDoc($d);

        return $d;
    }
}
