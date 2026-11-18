<?php

namespace App\Modulos\Ped\Services;

use App\Support\RuleError;

/**
 * RN-PED-01 al confirmar: además del mensaje, lleva la lista de códigos de lo que falta
 * (DIRECCION_CON_PIN, FRANJA, FORMA_DE_PAGO…). Laravel responde 422 con { message, code, faltan }.
 */
final class Faltantes extends RuleError
{
    public function __construct(public readonly array $faltan)
    {
        parent::__construct('RN-PED-01', Pedidos::textoFaltantes($faltan));
    }

    public function render(): \Illuminate\Http\JsonResponse
    {
        return response()->json(['message' => $this->getMessage(), 'code' => $this->rule,
            'faltan' => array_column($this->faltan, 'codigo'), 'detalle' => $this->faltan], 422);
    }
}
