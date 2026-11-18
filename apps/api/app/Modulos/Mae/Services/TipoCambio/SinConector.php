<?php

namespace App\Modulos\Mae\Services\TipoCambio;

/** Mientras no exista el conector FX de INT: la carga automática falla y avisa para cargarlo a mano. */
final class SinConector implements FuenteTipoCambio
{
    public function del(string $fecha, string $moneda): ?array
    {
        throw new \RuntimeException('Todavía no hay conexión con SUNAT para el tipo de cambio: regístralo a mano.');
    }

    public function nombre(): string
    {
        return 'Sin conector';
    }
}
