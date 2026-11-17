<?php

namespace App\Modulos\Mae\Services\TipoCambio;

/** Mientras no exista el conector FX de INT: la carga automática falla y avisa para cargarlo a mano. */
final class SinConector implements FuenteTipoCambio
{
    public function del(string $fecha, string $moneda): ?array
    {
        throw new \RuntimeException('Todavía no hay un conector de tipo de cambio configurado (INT): cárgalo a mano en MAE-05.');
    }

    public function nombre(): string
    {
        return 'Sin conector';
    }
}
