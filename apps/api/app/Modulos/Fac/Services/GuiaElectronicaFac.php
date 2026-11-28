<?php

namespace App\Modulos\Fac\Services;

use App\Modulos\Alm\Services\Guias\EmisorGuiaRemision;
use App\Modulos\Alm\Services\Guias\GuiaRemisionManual;
use App\Support\Events;
use App\Support\RuleError;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Auth;

/**
 * Emisor de guías de ALM (contrato EmisorGuiaRemision, RN-ALM-10) con la GRE electrónica de FAC.
 * Con los datos de transporte emite la guía T### (motivo 04) y la envía al OSE. Si solo llega el
 * número de una guía emitida fuera del sistema (pantalla ALM-07), lo registra como el respaldo.
 */
final class GuiaElectronicaFac implements EmisorGuiaRemision
{
    public function emitir(object $transferencia, array $lineas, array $datos = []): array
    {
        if (empty($datos['transport_mode']) && ! empty($datos['guide_number'])) {
            $g = (new GuiaRemisionManual)->emitir($transferencia, $lineas, $datos);
            Events::emit('guide.issued', 'stock_transfers', $transferencia->id, ['full_number' => $g['full_number'], 'reason_code' => '04', 'source' => 'ALM']);

            return $g;
        }
        if (empty($datos['transport_mode'])) {
            RuleError::fail('RN-FAC-11', 'Para la guía electrónica elige la modalidad de transporte, el vehículo y el conductor (o el transportista); o registra el número de una guía ya emitida.');
        }
        $u = request()->user() ?? Auth::user() ?? RuleError::fail('RN-FAC-11', 'No hay un usuario que emita la guía.');
        $base = Guias::datosDeTransferencia($transferencia->id);
        $g = Guias::emitir([
            'establishment_id' => $transferencia->from_site, 'dest_establishment_id' => $transferencia->to_site, 'transfer_id' => $transferencia->id,
            'transfer_reason_code' => $datos['transfer_reason_code'] ?? '04', 'lines' => $datos['lines'] ?? $base['lines'],
            'gross_weight_kg' => $datos['gross_weight_kg'] ?? $base['gross_weight_kg'], 'packages' => $datos['packages'] ?? null,
        ] + array_intersect_key($datos, array_flip(['series_id', 'transport_mode', 'start_date', 'carrier_supplier_id', 'vehicle_id', 'driver_employee_id',
            'driver_license', 'dest_address', 'dest_ubigeo', 'notes'])), $u);

        return ['series' => $g->series, 'number' => str_pad((string) $g->number, 8, '0', STR_PAD_LEFT), 'full_number' => $g->full_number,
            'issued_at' => Carbon::parse($g->issued_at)->toIso8601String()];
    }
}
