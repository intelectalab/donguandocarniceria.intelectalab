<?php

namespace App\Modulos\Pos\Services;

use App\Models\User;
use App\Modulos\Fac\Services\Emision;
use App\Support\Params;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * Comprobantes del mostrador (POS-05, POS-09): boleta o factura por marca al cobrar y nota de
 * crédito al devolver. La emisión y el envío al OSE son de FAC (Fac\Services\Emision y Envios);
 * aquí quedan la serie de la caja y la lectura del ticket.
 *
 * Reglas: RN-FAC-01 (líneas que cuadran con la cabecera), RN-FAC-02 (serie del tipo, empresa, local
 * y marca, activa), RN-FAC-04 (factura con RUC válido), RN-FAC-05 (boleta sobre el monto con
 * documento), RN-FAC-07 (nota con serie del mismo tipo y motivo) y RN-POS-12 (si el OSE no responde,
 * el ticket se entrega y el comprobante queda en la cola de reintentos, en Ose).
 */
final class Comprobantes
{
    public const TIPOS = ['RECEIPT' => 'Boleta', 'INVOICE' => 'Factura', 'CREDIT_NOTE' => 'Nota de crédito'];

    public static function igv(): float
    {
        return (float) (Params::get('fac_igv_rate') ?? 0.18);
    }

    /** Los precios incluyen IGV: separa la base y el impuesto de un total. */
    public static function separar(float $total): array
    {
        $base = round($total / (1 + self::igv()), 2);

        return [$base, round($total - $base, 2)];
    }

    /** RN-FAC-04 y RN-FAC-05: el cliente sirve para el comprobante (regla de FAC, con el dígito verificador del RUC). */
    public static function validarCliente(string $tipo, object $cliente, float $total, string $marca): void
    {
        Emision::validarCliente($tipo, (object) ['doc_type' => $cliente->doc_type ?: 'NONE', 'doc_number' => $cliente->doc_number,
            'full_name' => $cliente->full_name ?? 'Cliente'], $total, $marca);
    }

    /** RN-FAC-02: serie de la caja para boleta o factura de la marca. */
    public static function serieDeVenta(object $caja, string $tipo, string $marca): object
    {
        $empresa = DB::table('establishments')->where('id', $caja->establishment_id)->value('company_id');
        $preferida = $tipo === 'INVOICE' ? $caja->invoice_series_id : $caja->receipt_series_id;
        $sirve = fn ($s) => $s && $s->doc_type === $tipo && $s->status === 'ACTIVE' && $s->company_id === $empresa
            && ($s->brand_id === null || $s->brand_id === $marca)
            && ($s->establishment_id === null || $s->establishment_id === $caja->establishment_id || $s->all_sites);
        $s = $preferida ? DB::table('document_series')->where('id', $preferida)->first() : null;
        if ($sirve($s)) {
            return $s;
        }
        // Sin serie propia de la caja (o de otra marca): la de la marca para ese local.
        $s = DB::table('document_series')->where('doc_type', $tipo)->where('status', 'ACTIVE')->where('company_id', $empresa)
            ->where('brand_id', $marca)
            ->where(fn ($q) => $q->whereNull('establishment_id')->orWhere('establishment_id', $caja->establishment_id)->orWhere('all_sites', true))
            ->orderBy('series')->first();
        if (! $s) {
            $m = DB::table('brands')->where('id', $marca)->value('name');
            RuleError::fail('RN-FAC-02', 'No hay una serie de '.mb_strtolower(self::TIPOS[$tipo])." activa para {$m} en este local: configúrala en la caja (POS-11) o en Series (PLT-08).");
        }

        return $s;
    }

    /** RN-FAC-07: serie de nota de crédito de la marca, del mismo tipo que el comprobante (B o F). */
    public static function serieDeNota(object $doc): object
    {
        $s = DB::table('document_series')->where('doc_type', 'CREDIT_NOTE')->where('status', 'ACTIVE')->where('company_id', $doc->company_id)
            ->where(fn ($q) => $q->where('brand_id', $doc->brand_id)->orWhereNull('brand_id'))
            ->where(fn ($q) => $q->where('applies_to', $doc->doc_type)->orWhere(fn ($x) => $x->whereNull('applies_to')->where('series', 'like', substr($doc->series, 0, 1).'%')))
            ->where(fn ($q) => $q->whereNull('establishment_id')->orWhere('establishment_id', $doc->establishment_id)->orWhere('all_sites', true))
            ->orderByRaw('brand_id is null')->orderBy('series')->first();
        if (! $s) {
            RuleError::fail('RN-FAC-07', 'No hay una serie de nota de crédito activa para '.($doc->doc_type === 'INVOICE' ? 'facturas' : 'boletas')." de {$doc->brand_name}.");
        }

        return $s;
    }

    /**
     * Emite un comprobante con sus líneas y lo envía al OSE (RN-POS-12). Lo hace el emisor de FAC
     * (Fac\Services\Emision::registrar): numeración, IGV por línea, RN-FAC-01, RN-FAC-17 y la cola del OSE.
     * $c: brand_id, establishment_id, series_id, doc_type, customer (objeto), order_id, related_document_id,
     *     seller_id, pos_shift_id, pos_terminal_id, pos_ticket, balance, note_reason_code, note_reason, refund_*.
     * $lineas: variant_id, description, qty, uom_code, unit_price, total, lot_id, unit_cost, cost.
     */
    public static function emitir(array $c, array $lineas, User $u): object
    {
        $doc = Emision::registrar($c + ['source' => 'POS', 'mostrador' => true], $lineas, $u, false);

        return $doc->summary_pending ? $doc : Ose::enviar($doc->id);
    }

    /** POS-05: el comprobante con sus líneas, cobros, marca y empresa, para el ticket de 80 mm. */
    public static function detalle(object $d): array
    {
        $lineas = DB::table('sales_document_lines as l')->leftJoin('product_variants as v', 'v.id', '=', 'l.variant_id')
            ->where('l.sales_document_id', $d->id)->orderBy('l.line_no')
            ->get(['l.id', 'l.line_no', 'l.variant_id', 'l.description', 'l.qty', 'l.uom_code', 'l.unit_price', 'l.total', 'l.subtotal', 'l.igv', 'v.sku', 'v.sale_mode']);
        $cobros = DB::table('payment_allocations as a')->join('payments as p', 'p.id', '=', 'a.payment_id')
            ->join('payment_methods as m', 'm.id', '=', 'p.payment_method_id')->where('a.document_id', $d->id)->where('p.status', 'CONFIRMED')
            ->orderBy('p.paid_at')->get(['p.id', 'p.number', 'm.code', 'm.name as medio', 'a.amount', 'p.amount as monto_cobro', 'p.reference', 'p.card_brand', 'p.card_last4', 'p.cash_given', 'p.change_given']);
        $saldo = $d->order_id ? DB::table('customer_balance_movements')->where('order_id', $d->order_id)->where('movement_type', 'APPLIED')->sum(DB::raw('-amount')) : 0;
        $empresa = DB::table('companies')->where('id', $d->company_id)->first();
        $local = DB::table('establishments')->where('id', $d->establishment_id)->first(['name', 'address']);
        $marca = DB::table('brands')->where('id', $d->brand_id)->first();
        $cliente = DB::table('customers')->where('id', $d->customer_id)->first(['id', 'full_name', 'phone', 'email', 'doc_type', 'doc_number', 'customer_type']);
        $relacionado = $d->related_document_id ? DB::table('sales_documents')->where('id', $d->related_document_id)->first(['id', 'full_number', 'doc_type']) : null;
        $notas = DB::table('sales_documents')->where('related_document_id', $d->id)->where('doc_type', 'CREDIT_NOTE')->orderBy('issued_at')
            ->get(['id', 'full_number', 'total', 'note_reason', 'refund_mode', 'issued_at']);
        $turno = $d->pos_shift_id ? DB::table('pos_shifts')->where('id', $d->pos_shift_id)->first(['number', 'cashier_name']) : null;
        $caja = $d->pos_terminal_id ? DB::table('pos_terminals')->where('id', $d->pos_terminal_id)->first(['code', 'name']) : null;
        $envios = DB::table('einvoice_submissions')->where('document_id', $d->id)->orderBy('requested_at')->get(['attempt_no', 'requested_at', 'result', 'response_code', 'message']);

        return [
            'documento' => $d, 'tipo' => self::TIPOS[$d->doc_type] ?? $d->doc_type, 'lineas' => $lineas, 'cobros' => $cobros,
            'saldo_a_favor' => round((float) $saldo, 2), 'notas' => $notas, 'relacionado' => $relacionado, 'envios' => $envios,
            'empresa' => $empresa ? ['ruc' => $empresa->ruc, 'razon_social' => $empresa->legal_name, 'nombre_comercial' => $empresa->trade_name, 'direccion' => $empresa->fiscal_address] : null,
            'local' => $local, 'cliente' => $cliente, 'turno' => $turno, 'caja' => $caja,
            'marca' => $marca ? ['id' => $marca->id, 'code' => $marca->code, 'name' => $marca->name, 'color' => $marca->primary_color,
                'logo' => (bool) $marca->logo_url && $marca->print_show_logo !== false, 'pie' => $marca->legal_footer, 'leyendas' => $marca->print_legends] : null,
            'devuelto' => self::devuelto($d),
        ];
    }

    /** Lo ya devuelto por línea del comprobante: cantidad (kg o unidades) por id de línea. */
    public static function devuelto(object $d): array
    {
        $r = is_string($d->returned) ? json_decode($d->returned, true) : (array) ($d->returned ?? []);

        return is_array($r) ? $r : [];
    }
}
