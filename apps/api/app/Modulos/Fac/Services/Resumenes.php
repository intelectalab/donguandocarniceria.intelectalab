<?php

namespace App\Modulos\Fac\Services;

use App\Models\User;
use App\Support\Events;
use App\Support\Params;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * FAC-08 Resumen diario y bajas (RN-FAC-09, RN-FAC-10) y la anulación de comprobantes.
 *  - RC: resumen diario de boletas (cuando fac_receipt_summary_mode = SUMMARY) y baja de boletas.
 *  - RA: comunicación de baja de facturas y sus notas.
 * Enviar da un ticket; la consulta del ticket (la cola, cada minuto) aplica el resultado a cada comprobante.
 */
final class Resumenes
{
    /**
     * Anula un comprobante. Si aún no se envió, queda de baja sin pasar por SUNAT; si ya fue aceptado,
     * se agrega a la comunicación de baja (RA) o al resumen (RC) del día. Un anulado no se reactiva.
     */
    public static function anular(string $docId, string $motivo, User $u): array
    {
        return DB::transaction(function () use ($docId, $motivo, $u) {
            $d = DB::table('sales_documents')->where('id', $docId)->lockForUpdate()->first() ?? RuleError::fail('RN-FAC-10', 'El comprobante no existe.');
            Emision::alcance($u, $d->brand_id, $d->establishment_id);
            $motivo = trim($motivo);
            if (mb_strlen($motivo) < 5) {
                RuleError::fail('RN-FAC-10', 'Anular exige motivo (al menos 5 letras).');
            }
            if ($d->status === 'VOIDED') {
                RuleError::fail('RN-FAC-10', "{$d->full_number} ya está anulado: un comprobante anulado no se reactiva.");
            }
            if ($d->sunat_status === 'REJECTED') {
                RuleError::fail('RN-FAC-10', "{$d->full_number} fue rechazado por SUNAT y no tiene validez: reemítelo con un número nuevo.");
            }
            $nota = DB::table('sales_documents')->where('related_document_id', $d->id)->where('status', 'ISSUED')->where('sunat_status', '<>', 'REJECTED')->value('full_number');
            if ($nota) {
                RuleError::fail('RN-FAC-10', "{$d->full_number} tiene la nota {$nota}: corrige con otra nota de crédito (motivo 01) en lugar de anular.");
            }
            $pagado = DB::table('payment_allocations as a')->join('payments as p', 'p.id', '=', 'a.payment_id')
                ->where('a.document_id', $d->id)->where('p.status', 'CONFIRMED')->exists();
            if ($pagado && in_array($d->doc_type, ['INVOICE', 'RECEIPT'], true)) {
                RuleError::fail('RN-FAC-10', "{$d->full_number} tiene cobros aplicados: emite una nota de crédito (motivo 01, anulación de la operación) para devolver o dejar saldo a favor.");
            }
            $c = ['status' => 'VOIDED', 'void_reason' => mb_substr($motivo, 0, 255), 'voided_at' => now(), 'voided_by' => mb_substr($u->name, 0, 120), 'updated_at' => now()];
            $enviado = (int) $d->send_attempts > 0 || $d->sunat_status !== 'PENDING';
            $resumen = null;
            if (! $enviado) {
                // Nunca llegó a SUNAT: queda de baja sin comunicación.
                $c += ['sunat_status' => 'VOIDED', 'next_retry_at' => null, 'needs_review' => false, 'summary_pending' => false];
                DB::table('sales_documents')->where('id', $d->id)->update($c);
            } else {
                DB::table('sales_documents')->where('id', $d->id)->update($c + ['next_retry_at' => null]);
                $tipo = str_starts_with($d->series, 'B') ? 'RC' : 'RA';
                $resumen = self::delDia($tipo, $d->company_id, now('America/Lima')->toDateString(), $u);
                DB::table('sunat_daily_summary_lines')->insert(['summary_id' => $resumen->id, 'document_id' => $d->id, 'action' => 'VOID', 'reason' => mb_substr($motivo, 0, 255), 'created_at' => now()]);
            }
            Events::emit('document.voided', 'sales_documents', $d->id, ['full_number' => $d->full_number, 'reason' => $motivo, 'summary' => $resumen?->identifier]);

            return ['documento' => DB::table('sales_documents')->where('id', $d->id)->first(), 'resumen' => $resumen];
        });
    }

    /** Resumen pendiente del día y tipo (lo crea si no hay). */
    private static function delDia(string $tipo, string $empresa, string $fecha, User $u): object
    {
        $s = DB::table('sunat_daily_summaries')->where('summary_type', $tipo)->where('company_id', $empresa)->where('reference_date', $fecha)
            ->where('status', 'PENDING')->lockForUpdate()->first();

        return $s ?? self::crear($tipo, $empresa, $fecha, $u);
    }

    private static function crear(string $tipo, string $empresa, string $fecha, User $u): object
    {
        $n = DB::table('sunat_daily_summaries')->where('summary_type', $tipo)->where('reference_date', $fecha)->count() + 1;
        $id = DB::table('sunat_daily_summaries')->insertGetId([
            'company_id' => $empresa, 'summary_type' => $tipo, 'reference_date' => $fecha,
            'identifier' => $tipo.'-'.str_replace('-', '', $fecha).'-'.$n, 'status' => 'PENDING', 'created_by_name' => mb_substr($u->name, 0, 120), 'created_at' => now(),
        ], 'id');

        return DB::table('sunat_daily_summaries')->where('id', $id)->first();
    }

    /** RC: resumen diario de las boletas de una fecha que esperan informarse (modo SUMMARY). */
    public static function resumenDeBoletas(string $fecha, User $u): object
    {
        return DB::transaction(function () use ($fecha, $u) {
            $docs = DB::table('sales_documents')->where('doc_type', 'RECEIPT')->where('issue_date', $fecha)->where('summary_pending', true)
                ->where('sunat_status', 'PENDING')->where('status', 'ISSUED')->lockForUpdate()->get(['id', 'company_id']);
            if ($docs->isEmpty()) {
                RuleError::fail('RN-FAC-09', 'No hay boletas del '.date('d/m/Y', strtotime($fecha)).' pendientes de informar por resumen diario.');
            }
            $ya = DB::table('sunat_daily_summary_lines')->whereIn('document_id', $docs->pluck('id'))->where('action', 'ADD')->pluck('document_id')->all();
            $docs = $docs->reject(fn ($d) => in_array($d->id, $ya, true));
            if ($docs->isEmpty()) {
                RuleError::fail('RN-FAC-09', 'Las boletas de esa fecha ya están en un resumen.');
            }
            $s = self::crear('RC', $docs->first()->company_id, $fecha, $u);
            foreach ($docs as $d) {
                DB::table('sunat_daily_summary_lines')->insert(['summary_id' => $s->id, 'document_id' => $d->id, 'action' => 'ADD', 'created_at' => now()]);
            }

            return $s;
        });
    }

    /** Envía el resumen o la baja: el OSE devuelve un ticket que se consulta después. */
    public static function enviar(string $id, User $u): object
    {
        return DB::transaction(function () use ($id, $u) {
            $s = DB::table('sunat_daily_summaries')->where('id', $id)->lockForUpdate()->first() ?? RuleError::fail('RN-FAC-09', 'El resumen no existe.');
            if ($s->status !== 'PENDING') {
                RuleError::fail('RN-FAC-09', "{$s->identifier} ya fue enviado.");
            }
            if (! DB::table('sunat_daily_summary_lines')->where('summary_id', $id)->exists()) {
                RuleError::fail('RN-FAC-09', "{$s->identifier} no tiene comprobantes.");
            }
            $n = DB::table('einvoice_submissions')->where('summary_id', $id)->count() + 1;
            $caido = Envios::$caido;
            $prov = strtoupper((string) (Params::get('fac_einvoice_provider') ?? 'FAKE'));
            $ok = $prov === 'FAKE' && ! $caido;
            $msg = $ok ? "Ticket generado para {$s->identifier}." : ($prov !== 'FAKE' ? "El proveedor {$prov} aún no tiene adaptador." : 'El OSE no respondió en 30 s (servicio no disponible).');
            DB::table('einvoice_submissions')->insert([
                'summary_id' => $id, 'attempt_no' => $n, 'provider' => mb_substr($prov, 0, 20), 'requested_at' => now(), 'response_code' => $ok ? '0' : '0109',
                'result' => $ok ? 'ACCEPTED' : 'TIMEOUT', 'message' => $msg, 'duration_ms' => $ok ? 610 : 30000, 'manual' => true,
                'requested_by_name' => mb_substr($u->name, 0, 120), 'created_at' => now(),
            ]);
            if (! $ok) {
                DB::table('sunat_daily_summaries')->where('id', $id)->update(['last_error' => $msg, 'updated_at' => now()]);
            } else {
                DB::table('sunat_daily_summaries')->where('id', $id)->update(['status' => 'SENT', 'sent_at' => now(), 'last_error' => null,
                    'ticket' => '2026'.substr((string) abs(crc32($s->identifier.microtime())), 0, 8).str_pad((string) $n, 2, '0', STR_PAD_LEFT), 'updated_at' => now()]);
            }

            return DB::table('sunat_daily_summaries')->where('id', $id)->first();
        });
    }

    /** Consulta el ticket: SUNAT aplica el resumen y cada comprobante queda aceptado o de baja. */
    public static function consultar(string $id): object
    {
        return DB::transaction(function () use ($id) {
            $s = DB::table('sunat_daily_summaries')->where('id', $id)->lockForUpdate()->first() ?? RuleError::fail('RN-FAC-09', 'El resumen no existe.');
            if ($s->status !== 'SENT') {
                RuleError::fail('RN-FAC-09', "{$s->identifier} no tiene un ticket por consultar.");
            }
            DB::table('sunat_daily_summaries')->where('id', $id)->update(['status' => 'ACCEPTED', 'accepted_at' => now(), 'updated_at' => now()]);
            foreach (DB::table('sunat_daily_summary_lines')->where('summary_id', $id)->get() as $l) {
                $d = DB::table('sales_documents')->where('id', $l->document_id)->first();
                if (! $d) {
                    continue;
                }
                if ($l->action === 'VOID') {
                    DB::table('sales_documents')->where('id', $d->id)->update(['sunat_status' => 'VOIDED', 'updated_at' => now()]);
                } elseif ($d->sunat_status === 'PENDING' && $d->status === 'ISSUED') {
                    DB::table('sales_documents')->where('id', $d->id)->update(['sunat_status' => 'ACCEPTED', 'summary_pending' => false, 'sent_at' => $s->sent_at,
                        'accepted_at' => now(), 'sunat_code' => '0', 'sunat_message' => "Aceptada en el resumen {$s->identifier}.",
                        'cdr_hash' => substr(base64_encode(hash('sha256', $d->xml_hash.'|'.$s->identifier, true)), 0, 28), 'updated_at' => now()]);
                    Events::emit('document.accepted', 'sales_documents', $d->id, ['full_number' => $d->full_number, 'summary' => $s->identifier]);
                }
            }

            return DB::table('sunat_daily_summaries')->where('id', $id)->first();
        });
    }

    /**
     * Comprobante rechazado: se reemite con un número nuevo y los mismos datos (el rechazado no se
     * reutiliza). El nuevo enlaza al anterior.
     */
    public static function reemitir(string $docId, User $u): object
    {
        return DB::transaction(function () use ($docId, $u) {
            $old = DB::table('sales_documents')->where('id', $docId)->lockForUpdate()->first() ?? RuleError::fail('RN-FAC-03', 'El comprobante no existe.');
            Emision::alcance($u, $old->brand_id, $old->establishment_id);
            if ($old->sunat_status !== 'REJECTED') {
                RuleError::fail('RN-FAC-03', "{$old->full_number} no está rechazado: un comprobante válido se corrige con nota de crédito o débito.");
            }
            if ($old->reissued_by) {
                RuleError::fail('RN-FAC-03', "{$old->full_number} ya se reemitió como ".DB::table('sales_documents')->where('id', $old->reissued_by)->value('full_number').'.');
            }
            $cli = Emision::comprador($old->customer_id);
            $lineas = DB::table('sales_document_lines')->where('sales_document_id', $old->id)->orderBy('line_no')->get()
                ->map(fn ($l) => ['variant_id' => $l->variant_id, 'description' => $l->description, 'qty' => (float) $l->qty, 'uom_code' => $l->uom_code,
                    'unit_price' => (float) $l->unit_price, 'total' => (float) $l->total, 'igv_affectation' => $l->igv_affectation, 'lot_id' => $l->lot_id,
                    'unit_cost' => $l->unit_cost !== null ? (float) $l->unit_cost : null, 'cost' => (float) $l->cost])->all();
            if (in_array($old->doc_type, ['INVOICE', 'RECEIPT'], true)) {
                Emision::validarCliente($old->doc_type, $cli, (float) $old->total, $old->brand_id);
                $serie = Emision::serie($old->doc_type, $old->brand_id, $old->establishment_id, ['series_id' => $old->series_id, 'mostrador' => $old->pos_terminal_id !== null]);
            } else {
                $ref = DB::table('sales_documents')->where('id', $old->related_document_id)->first();
                $serie = Emision::serie($old->doc_type, $old->brand_id, $old->establishment_id, ['series_id' => $old->series_id, 'applies_to' => $ref->doc_type]);
            }
            $nuevo = Emision::registrar([
                'doc_type' => $old->doc_type, 'series_id' => $serie->id, 'brand_id' => $old->brand_id, 'establishment_id' => $old->establishment_id,
                'customer' => $cli, 'order_id' => $old->order_id, 'related_document_id' => $old->related_document_id, 'seller_id' => $old->seller_id,
                'note_reason_code' => $old->note_reason_code, 'note_reason' => $old->note_reason, 'payment_terms' => $old->payment_terms,
                'due_date' => $old->due_date ? max($old->due_date, now('America/Lima')->toDateString()) : null, 'credit_days' => $old->credit_days,
                'pos_shift_id' => $old->pos_shift_id, 'pos_terminal_id' => $old->pos_terminal_id, 'pos_ticket' => $old->pos_ticket,
                'balance' => (float) $old->balance, 'source' => $old->source, 'reissue_of' => $old->id, 'mostrador' => true,
            ], $lineas, $u);
            DB::table('sales_documents')->where('id', $old->id)->update(['reissued_by' => $nuevo->id, 'needs_review' => false, 'updated_at' => now()]);
            DB::table('payment_allocations')->where('document_id', $old->id)->update(['document_id' => $nuevo->id, 'updated_at' => now()]);

            return $nuevo;
        });
    }
}
