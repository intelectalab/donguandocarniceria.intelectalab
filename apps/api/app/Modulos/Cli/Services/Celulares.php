<?php

namespace App\Modulos\Cli\Services;

use App\Support\Params;

/**
 * RN-CLI-01: el celular se guarda en E.164. «987 654 321», «(01) 987654321», «0051987654321» y
 * «+51 987 654 321» quedan como +51987654321.
 *   Celulares::normalizar('987 654 321')  // '+51987654321'
 *   Celulares::valido('+51987654321')     // true
 */
final class Celulares
{
    public static function normalizar(?string $raw): ?string
    {
        $s = trim((string) $raw);
        if ($s === '') {
            return null;
        }
        $pais = (string) (Params::get('cli_default_country_code') ?: '+51');
        $cc = preg_replace('/\D/', '', $pais);
        $d = preg_replace('/\D/', '', $s);
        if (str_starts_with($s, '00')) {
            $d = substr($d, 2);
        }
        if (str_starts_with($s, '+') || str_starts_with($s, '00')) {
            return '+'.$d;
        }
        if (strlen($d) === 9 && $d[0] === '9') {
            return '+'.$cc.$d;
        }
        // «(01) 987654321»: el 01 de Lima delante de un celular.
        if (strlen($d) === 11 && str_starts_with($d, '01') && $d[2] === '9') {
            return '+'.$cc.substr($d, 2);
        }
        if (str_starts_with($d, $cc) && strlen($d) === strlen($cc) + 9) {
            return '+'.$d;
        }

        return '+'.$cc.$d;
    }

    /** Perú: +51 y 9 dígitos que empiezan en 9. Otro país: + y de 8 a 15 dígitos. */
    public static function valido(?string $e164): bool
    {
        if (! $e164) {
            return false;
        }
        if (str_starts_with($e164, '+51')) {
            return (bool) preg_match('/^\+519\d{8}$/', $e164);
        }

        return (bool) preg_match('/^\+\d{8,15}$/', $e164);
    }
}
