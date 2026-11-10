<?php

namespace App\Modulos\Alm\Services\Guias;

/**
 * Emisor de la guía de remisión de una transferencia entre locales (RN-ALM-10, motivo 04,
 * traslado entre establecimientos). FAC, cuando exista, registra su implementación:
 *   $this->app->bind(EmisorGuiaRemision::class, GuiaElectronicaFac::class);
 * Mientras tanto ALM usa GuiaRemisionManual. Contrato en docs/contratos.md.
 */
interface EmisorGuiaRemision
{
    /**
     * @param  object  $transferencia  fila de stock_transfers
     * @param  array<int, object>  $lineas  filas de stock_transfer_lines
     * @param  array<string, mixed>  $datos  lo que pide el emisor (con el respaldo, el número de la guía)
     * @return array{series: string, number: string, full_number: string, issued_at: string}
     */
    public function emitir(object $transferencia, array $lineas, array $datos = []): array;
}
