<?php

namespace App\Support;

use RuntimeException;

/**
 * Regla de negocio que bloquea una acción. El mensaje dice qué pasó y cómo arreglarlo, en palabras
 * de quien usa el sistema; el código de la regla va aparte: la API responde 422 con
 * { message, code } y la pantalla muestra solo el mensaje.
 *   RuleError::fail('RN-PED-06', 'La franja 09:00–13:00 de Surco B está llena (40 de 40).');
 */
class RuleError extends RuntimeException
{
    public function __construct(public readonly string $rule, string $message)
    {
        parent::__construct($message);
    }

    public static function fail(string $rule, string $message): never
    {
        throw new self($rule, $message);
    }
}
