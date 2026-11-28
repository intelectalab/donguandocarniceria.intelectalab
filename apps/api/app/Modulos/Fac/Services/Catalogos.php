<?php

namespace App\Modulos\Fac\Services;

use App\Support\Params;

/** Catálogos SUNAT y nombres que usa FAC (09, 10, 20, tipos de comprobante y de documento). */
final class Catalogos
{
    public const TIPOS = [
        'INVOICE' => 'Factura', 'RECEIPT' => 'Boleta', 'CREDIT_NOTE' => 'Nota de crédito', 'DEBIT_NOTE' => 'Nota de débito',
    ];

    /** Código SUNAT del tipo de comprobante (catálogo 01). */
    public const CODIGO = ['INVOICE' => '01', 'RECEIPT' => '03', 'CREDIT_NOTE' => '07', 'DEBIT_NOTE' => '08', 'DISPATCH_GUIDE' => '09'];

    /** Código SUNAT del documento del adquirente (catálogo 06). */
    public const DOC_ID = ['RUC' => '6', 'DNI' => '1', 'CE' => '4', 'PAS' => '7', 'NONE' => '0'];

    /** Catálogo 09: motivos de la nota de crédito. */
    public const CAT09 = [
        '01' => 'Anulación de la operación', '02' => 'Anulación por error en el RUC', '03' => 'Corrección por error en la descripción',
        '04' => 'Descuento global', '05' => 'Descuento por ítem', '06' => 'Devolución total', '07' => 'Devolución por ítem',
        '08' => 'Bonificación', '09' => 'Disminución en el valor (diferencia de peso)', '10' => 'Otros conceptos',
        '13' => 'Ajustes de montos o fechas de pago',
    ];

    /** Catálogo 10: motivos de la nota de débito. */
    public const CAT10 = ['01' => 'Intereses por mora', '02' => 'Aumento en el valor', '03' => 'Penalidades u otros conceptos'];

    /** Catálogo 20: motivos de traslado de la guía de remisión. */
    public const CAT20 = [
        '01' => 'Venta', '02' => 'Compra', '04' => 'Traslado entre establecimientos de la misma empresa', '05' => 'Consignación',
        '06' => 'Devolución', '08' => 'Importación', '09' => 'Exportación', '13' => 'Otros', '14' => 'Venta sujeta a confirmación del comprador',
        '17' => 'Traslado de bienes para transformación',
    ];

    /** Catálogo 18: modalidad de transporte. */
    public const CAT18 = ['01' => 'Transporte público', '02' => 'Transporte privado'];

    /** Catálogo 07 (afectación al IGV) que maneja la fase 1. */
    public const AFECTACION = ['10' => 'Gravado', '20' => 'Exonerado', '30' => 'Inafecto'];

    public const ESTADOS_SUNAT = ['PENDING' => 'Pendiente', 'ACCEPTED' => 'Aceptado', 'OBSERVED' => 'Observado', 'REJECTED' => 'Rechazado', 'VOIDED' => 'De baja'];

    /** Motivos de nota de crédito que devuelven mercadería (reingreso de stock). */
    public const DEVOLUCION = ['06', '07'];

    /** fac_igv_rate se escribe como fracción (0.18); también se acepta 18. */
    public static function igv(): float
    {
        $v = (float) (Params::get('fac_igv_rate') ?? 0.18);

        return $v > 1 ? $v / 100 : $v;
    }

    public static function motivosGuia(): array
    {
        $v = Params::get('fac_gre_allowed_reasons');
        $l = is_array($v) ? $v : json_decode((string) ($v ?? ''), true);

        return is_array($l) && $l ? array_values(array_map(fn ($x) => str_pad((string) $x, 2, '0', STR_PAD_LEFT), $l)) : ['01', '04', '05', '06', '13', '14'];
    }

    public static function esperas(): array
    {
        $v = Params::get('fac_retry_backoff_minutes');
        $l = is_array($v) ? $v : json_decode((string) ($v ?? ''), true);

        return is_array($l) && $l ? array_values(array_map('intval', $l)) : [1, 5, 15, 60, 240];
    }

    public static function maxIntentos(): int
    {
        return max(1, (int) (Params::get('fac_max_send_attempts') ?? 5));
    }

    public static function modoBoletas(): string
    {
        return strtoupper((string) (Params::get('fac_receipt_summary_mode') ?? 'INDIVIDUAL')) === 'SUMMARY' ? 'SUMMARY' : 'INDIVIDUAL';
    }
}
