<?php

namespace App\Support;

use RuntimeException;

/**
 * Regla de negocio que bloquea una acción (G.fail del prototipo). El mensaje empieza con el código
 * de la regla y dice qué pasó y cómo arreglarlo; la API responde 422 con code = la regla.
 *   RuleError::fail('RN-PED-06', 'la franja 09:00–13:00 de Surco B está llena (40 de 40).');
 */
class RuleError extends RuntimeException
{
    public function __construct(public readonly string $rule, string $message)
    {
        parent::__construct("{$rule}: {$message}");
    }

    public static function fail(string $rule, string $message): never
    {
        throw new self($rule, $message);
    }
}
