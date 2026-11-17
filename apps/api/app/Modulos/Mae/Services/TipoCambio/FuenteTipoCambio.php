<?php

namespace App\Modulos\Mae\Services\TipoCambio;

/**
 * RN-MAE-14: de dónde sale el tipo de cambio del día. El conector real (SUNAT) llega con INT; mientras tanto
 * rige SinConector y el tipo de cambio se carga a mano en MAE-05. Las pruebas enlazan una fuente falsa.
 */
interface FuenteTipoCambio
{
    /**
     * Compra y venta publicadas para la fecha, o null si ese día no hubo publicación.
     *
     * @return array{buy: float, sell: float, published_on: string}|null
     *
     * @throws \RuntimeException si la fuente no responde
     */
    public function del(string $fecha, string $moneda): ?array;

    /** Nombre para mostrar en la pantalla («SUNAT», «Sin conector»). */
    public function nombre(): string;
}
