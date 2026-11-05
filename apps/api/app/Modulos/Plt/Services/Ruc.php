<?php

namespace App\Modulos\Plt\Services;

/**
 * RN-PLT-13: el RUC tiene 11 dígitos, empieza en 10, 15, 17 o 20 y su dígito verificador
 * (módulo 11) es correcto (ruc_is_valid de la spec). También lo usan CLI y COM.
 *   Ruc::problema('20609147254')  // null si es válido; si no, el motivo
 */
final class Ruc
{
    private const PESOS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];

    public static function valido(?string $ruc): bool
    {
        return self::problema($ruc) === null;
    }

    public static function problema(?string $ruc): ?string
    {
        $ruc = trim((string) $ruc);
        if (! preg_match('/^(10|15|17|20)\d{9}$/', $ruc)) {
            return 'El RUC tiene 11 dígitos y empieza en 10, 15, 17 o 20.';
        }
        $digito = self::digito(substr($ruc, 0, 10));

        return (int) $ruc[10] === $digito ? null
            : "El RUC no es válido: con esos primeros 10 dígitos debería terminar en {$digito}.";
    }

    private static function digito(string $primeros10): int
    {
        $suma = 0;
        foreach (self::PESOS as $i => $peso) {
            $suma += (int) $primeros10[$i] * $peso;
        }
        $r = 11 - ($suma % 11);

        return match ($r) { 10 => 0, 11 => 1, default => $r };
    }
}
