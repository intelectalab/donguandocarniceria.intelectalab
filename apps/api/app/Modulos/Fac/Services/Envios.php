<?php

namespace App\Modulos\Fac\Services;

use App\Models\User;
use App\Modulos\Plt\Services\Ruc;
use App\Support\Events;
use App\Support\Params;
use App\Support\RuleError;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Envío asíncrono al OSE o PSE (RN-FAC-06, FAC-07). Cada intento queda en einvoice_submissions.
 *
 * D-FAC-01: el adaptador activo es fac_einvoice_provider. FAKE (desarrollo) responde como SUNAT sin
 * salir del sistema: acepta, o rechaza una factura sin RUC válido o una nota de un comprobante
 * rechazado. Cualquier otro proveedor aún no tiene adaptador: el comprobante queda pendiente con
 * sus reintentos (1, 5, 15, 60 y 240 minutos) hasta fac_max_send_attempts y luego pide revisión.
 * El mostrador y el despacho no esperan: el comprobante se imprime igual.
 */
final class Envios
{
    /** Solo para pruebas y demostración: el OSE no responde (tiempo agotado). */
    public static bool $caido = false;

    /** Solo para pruebas: la próxima respuesta del OSE (OBSERVED o REJECTED). */
    public static ?string $siguiente = null;

    private static function proveedor(): string
    {
        return strtoupper((string) (Params::get('fac_einvoice_provider') ?? 'FAKE'));
    }

    /** Respuesta del OSE para un comprobante, una guía o un resumen. */
    private static function responder(string $tipo, object $fila): array
    {
        $p = self::proveedor();
        if ($p !== 'FAKE') {
            return ['TIMEOUT', '-', "El proveedor {$p} aún no tiene adaptador: queda en la cola de reintentos (D-FAC-01).", 0];
        }
        if (self::$caido) {
            return ['TIMEOUT', '0109', 'El OSE no respondió en 30 s (servicio no disponible). Se reintentará.', 30000];
        }
        if ($n = self::$siguiente) {
            self::$siguiente = null;
            if ($n === 'OBSERVED') {
                return ['OBSERVED', '4287', 'El precio unitario difiere del calculado con el valor de venta (aceptado con observación).', 410];
            }
            if ($n === 'REJECTED') {
                return ['REJECTED', '3105', 'El XML no contiene la dirección del punto de llegada o del establecimiento emisor.', 395];
            }
        }
        if ($tipo === 'DOC') {
            if ($fila->doc_type === 'INVOICE' && ($fila->customer_doc_type !== 'RUC' || ! Ruc::valido($fila->customer_doc_number))) {
                return ['REJECTED', '2017', 'El número de documento de identidad del receptor debe ser un RUC válido.', 380];
            }
            if ($fila->related_document_id && DB::table('sales_documents')->where('id', $fila->related_document_id)->value('sunat_status') === 'REJECTED') {
                return ['REJECTED', '2116', 'El comprobante de referencia fue rechazado por SUNAT.', 380];
            }
            $nombre = Catalogos::TIPOS[$fila->doc_type] ?? 'El comprobante';

            return ['ACCEPTED', '0', "La {$nombre} número {$fila->full_number} ha sido aceptada.", 420];
        }
        if ($tipo === 'GUIDE') {
            return ['ACCEPTED', '0', "La guía de remisión {$fila->full_number} ha sido aceptada.", 520];
        }

        return ['ACCEPTED', '0', "Ticket generado para {$fila->identifier}.", 610];
    }

    private static function proximo(int $intento): ?Carbon
    {
        if ($intento >= Catalogos::maxIntentos()) {
            return null;
        }
        $e = Catalogos::esperas();

        return now()->addMinutes($e[min($intento - 1, count($e) - 1)]);
    }

    /** Un intento de envío de un comprobante. $manual: reenvío desde FAC-07 (permiso fac.document.resend). */
    public static function enviar(string $docId, ?User $u = null, bool $manual = false): object
    {
        return DB::transaction(function () use ($docId, $u, $manual) {
            $d = DB::table('sales_documents')->where('id', $docId)->lockForUpdate()->first() ?? RuleError::fail('RN-FAC-06', 'El comprobante no existe.');
            if ($d->sunat_status !== 'PENDING') {
                if ($manual) {
                    RuleError::fail('RN-FAC-03', "{$d->full_number} ya tiene respuesta de SUNAT (".Catalogos::ESTADOS_SUNAT[$d->sunat_status].'): no se vuelve a enviar.');
                }

                return $d;
            }
            if ($d->status === 'VOIDED') {
                RuleError::fail('RN-FAC-10', "{$d->full_number} está anulado: no se envía.");
            }
            if ($d->summary_pending) {
                RuleError::fail('RN-FAC-09', "{$d->full_number} se informa en el resumen diario de boletas (FAC-08), no por envío individual.");
            }
            Emision::cuadra($d); // RN-FAC-01 antes de cada intento
            $n = (int) $d->send_attempts + 1;
            [$res, $code, $msg, $ms] = self::responder('DOC', $d);
            DB::table('einvoice_submissions')->insert([
                'document_id' => $d->id, 'attempt_no' => $n, 'provider' => mb_substr(self::proveedor(), 0, 20), 'requested_at' => now(),
                'response_code' => $code, 'result' => $res, 'message' => $msg, 'duration_ms' => $ms, 'manual' => $manual,
                'requested_by_name' => $u ? mb_substr($u->name, 0, 120) : null, 'created_at' => now(),
            ]);
            $c = ['send_attempts' => $n, 'last_attempt_at' => now(), 'sunat_code' => $code, 'sunat_message' => $msg, 'updated_at' => now()];
            if (in_array($res, ['ACCEPTED', 'OBSERVED'], true)) {
                $c += ['sunat_status' => $res, 'sent_at' => now(), 'accepted_at' => now(), 'next_retry_at' => null, 'needs_review' => false,
                    'cdr_hash' => substr(base64_encode(hash('sha256', $d->xml_hash.'|cdr|'.$n, true)), 0, 28)];
            } elseif ($res === 'REJECTED') {
                $c += ['sunat_status' => 'REJECTED', 'sent_at' => now(), 'next_retry_at' => null, 'needs_review' => true];
            } else {
                $prox = self::proximo($n);
                $c += ['sent_at' => $d->sent_at ?? now(), 'next_retry_at' => $prox, 'needs_review' => $prox === null];
            }
            DB::table('sales_documents')->where('id', $d->id)->update($c);
            if (isset($c['sunat_status']) && $c['sunat_status'] !== 'REJECTED') {
                Events::emit('document.accepted', 'sales_documents', $d->id, ['full_number' => $d->full_number, 'sunat_status' => $res, 'order_id' => $d->order_id]);
            } elseif (($c['sunat_status'] ?? null) === 'REJECTED') {
                Events::emit('document.rejected', 'sales_documents', $d->id, ['full_number' => $d->full_number, 'code' => $code, 'message' => $msg]);
                self::avisar("SUNAT rechazó {$d->full_number}", "{$code} · {$msg} Reemítelo con un número nuevo en la cola de envío.", $d->id, 'bad');
            } elseif ($c['needs_review']) {
                self::avisar("{$d->full_number} agotó los reintentos al OSE", 'RN-FAC-06: requiere reenvío manual en la cola de envío (FAC-07).', $d->id, 'bad');
            }

            return DB::table('sales_documents')->where('id', $d->id)->first();
        });
    }

    /** Un intento de envío de una guía de remisión. */
    public static function enviarGuia(string $guiaId, ?User $u = null, bool $manual = false): object
    {
        return DB::transaction(function () use ($guiaId, $u, $manual) {
            $g = DB::table('dispatch_guides')->where('id', $guiaId)->lockForUpdate()->first() ?? RuleError::fail('RN-FAC-06', 'La guía no existe.');
            if ($g->sunat_status !== 'PENDING') {
                if ($manual) {
                    RuleError::fail('RN-FAC-03', "La guía {$g->full_number} ya tiene respuesta de SUNAT.");
                }

                return $g;
            }
            if ($g->status === 'VOIDED') {
                RuleError::fail('RN-FAC-10', "La guía {$g->full_number} está anulada.");
            }
            $n = (int) $g->send_attempts + 1;
            [$res, $code, $msg, $ms] = self::responder('GUIDE', $g);
            DB::table('einvoice_submissions')->insert([
                'guide_id' => $g->id, 'attempt_no' => $n, 'provider' => mb_substr(self::proveedor(), 0, 20), 'requested_at' => now(),
                'response_code' => $code, 'result' => $res, 'message' => $msg, 'duration_ms' => $ms, 'manual' => $manual,
                'requested_by_name' => $u ? mb_substr($u->name, 0, 120) : null, 'created_at' => now(),
            ]);
            $c = ['send_attempts' => $n, 'last_attempt_at' => now(), 'sunat_code' => $code, 'sunat_message' => $msg, 'updated_at' => now()];
            if (in_array($res, ['ACCEPTED', 'OBSERVED'], true)) {
                $c += ['sunat_status' => 'ACCEPTED', 'accepted_at' => now(), 'next_retry_at' => null, 'needs_review' => false];
            } elseif ($res === 'REJECTED') {
                $c += ['sunat_status' => 'REJECTED', 'next_retry_at' => null, 'needs_review' => true];
            } else {
                $prox = self::proximo($n);
                $c += ['next_retry_at' => $prox, 'needs_review' => $prox === null];
            }
            DB::table('dispatch_guides')->where('id', $g->id)->update($c);

            return DB::table('dispatch_guides')->where('id', $g->id)->first();
        });
    }

    /**
     * Procesa la cola de la empresa actual: comprobantes y guías aún no enviados o con el reintento
     * vencido, y la consulta de los tickets de resúmenes enviados. Lo corre fac:procesar-cola cada minuto.
     */
    public static function procesar(int $limite = 200): array
    {
        $r = ['procesados' => 0, 'aceptados' => 0, 'pendientes' => 0, 'rechazados' => 0];
        $docs = DB::table('sales_documents')->where('sunat_status', 'PENDING')->where('status', 'ISSUED')->where('summary_pending', false)
            ->where(fn ($q) => $q->where('needs_review', false)->orWhereNull('needs_review'))
            ->where(fn ($q) => $q->where('send_attempts', 0)->orWhere('next_retry_at', '<=', now()))
            ->orderBy('issued_at')->limit($limite)->pluck('id');
        foreach ($docs as $id) {
            try {
                $d = self::enviar($id);
                $r['procesados']++;
                $r[match ($d->sunat_status) {
                    'ACCEPTED', 'OBSERVED' => 'aceptados', 'REJECTED' => 'rechazados', default => 'pendientes'
                }]++;
            } catch (\Throwable) {
                $r['pendientes']++;
            }
        }
        $guias = DB::table('dispatch_guides')->where('sunat_status', 'PENDING')->where('status', 'ISSUED')->where('needs_review', false)
            ->where(fn ($q) => $q->where('send_attempts', 0)->orWhere('next_retry_at', '<=', now()))->limit($limite)->pluck('id');
        foreach ($guias as $id) {
            $g = self::enviarGuia($id);
            $r['procesados']++;
            $r[$g->sunat_status === 'ACCEPTED' ? 'aceptados' : ($g->sunat_status === 'REJECTED' ? 'rechazados' : 'pendientes')]++;
        }
        foreach (DB::table('sunat_daily_summaries')->where('status', 'SENT')->pluck('id') as $id) {
            Resumenes::consultar($id);
            $r['procesados']++;
        }

        return $r;
    }

    private static function avisar(string $titulo, string $cuerpo, string $docId, string $tono): void
    {
        DB::table('notifications')->insert([
            'role' => 'ADMINISTRACION', 'title' => mb_substr($titulo, 0, 255), 'body' => $cuerpo,
            'ref' => json_encode(['screen' => 'FAC-04', 'id' => $docId]), 'tone' => $tono, 'module' => 'FAC', 'at' => now(),
            'type' => 'ALERTS', 'in_app' => true,
        ]);
    }
}
