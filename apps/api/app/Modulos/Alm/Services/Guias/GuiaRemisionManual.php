<?php

namespace App\Modulos\Alm\Services\Guias;

use App\Support\RuleError;

/**
 * Respaldo sin FAC: el almacenero registra el número de la GRE que emitió fuera del sistema
 * (portal de SUNAT). No toma números de las series DISPATCH_GUIDE (T001, T002) para no chocar
 * con las guías electrónicas que emitirá FAC.
 */
final class GuiaRemisionManual implements EmisorGuiaRemision
{
    public function emitir(object $transferencia, array $lineas, array $datos = []): array
    {
        $numero = strtoupper(trim((string) ($datos['guide_number'] ?? '')));
        if (! preg_match('/^([A-Z0-9]{4})-(\d{1,8})$/', $numero, $m)) {
            RuleError::fail('RN-ALM-10', 'Registra el número de la guía de remisión emitida, por ejemplo T001-00000031.');
        }
        $correlativo = str_pad($m[2], 8, '0', STR_PAD_LEFT);

        return ['series' => $m[1], 'number' => $correlativo, 'full_number' => $m[1].'-'.$correlativo, 'issued_at' => now()->toIso8601String()];
    }
}
