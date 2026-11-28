<?php

namespace App\Modulos\Pos\Services;

use App\Modulos\Fac\Services\Envios;

/**
 * Envío del comprobante al OSE (RN-FAC-06, RN-POS-12). Lo hace la cola de FAC (Fac\Services\Envios):
 * cada intento queda en einvoice_submissions y, si el OSE no responde, el comprobante queda
 * pendiente con sus reintentos (1, 5, 15, 60 y 240 minutos). El ticket se entrega igual.
 */
final class Ose
{
    /** Solo para pruebas: simula que el OSE no responde. */
    public static bool $caido = false;

    public static function enviar(string $docId): object
    {
        $antes = Envios::$caido;
        Envios::$caido = self::$caido || $antes;
        try {
            return Envios::enviar($docId);
        } finally {
            Envios::$caido = $antes;
        }
    }
}
