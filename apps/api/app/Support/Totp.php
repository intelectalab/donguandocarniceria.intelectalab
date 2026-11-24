<?php

namespace App\Support;

/**
 * Códigos de un solo uso por tiempo (TOTP, RFC 6238): 6 dígitos, pasos de 30 segundos y HMAC-SHA1, que es lo
 * que usan Google Authenticator, Microsoft Authenticator y similares. El secreto va en base32 (RFC 4648).
 * Acepta el paso anterior y el siguiente por diferencias de reloj, y nunca el mismo paso dos veces.
 */
final class Totp
{
    private const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

    private const PASO = 30;

    private const DIGITOS = 6;

    /** Secreto nuevo de 160 bits en base32 (32 caracteres). */
    public static function secreto(): string
    {
        $bytes = random_bytes(20);
        $bits = '';
        foreach (str_split($bytes) as $b) {
            $bits .= str_pad(decbin(ord($b)), 8, '0', STR_PAD_LEFT);
        }
        $out = '';
        foreach (str_split($bits, 5) as $grupo) {
            $out .= self::BASE32[bindec(str_pad($grupo, 5, '0'))];
        }

        return $out;
    }

    /** Enlace otpauth:// para el código QR de la app autenticadora. */
    public static function enlace(string $secreto, string $cuenta, string $emisor = 'GestionCarnica Consola'): string
    {
        return 'otpauth://totp/'.rawurlencode($emisor).':'.rawurlencode($cuenta)
            .'?secret='.$secreto.'&issuer='.rawurlencode($emisor).'&algorithm=SHA1&digits='.self::DIGITOS.'&period='.self::PASO;
    }

    public static function pasoActual(?int $ahora = null): int
    {
        return intdiv($ahora ?? now()->getTimestamp(), self::PASO);   // now(): las pruebas pueden mover el reloj
    }

    public static function codigo(string $secreto, int $paso): string
    {
        $mensaje = pack('N*', 0, $paso);   // contador de 64 bits (big endian)
        $hash = hash_hmac('sha1', $mensaje, self::decodificar($secreto), true);
        $desfase = ord($hash[19]) & 0x0F;
        $numero = ((ord($hash[$desfase]) & 0x7F) << 24) | (ord($hash[$desfase + 1]) << 16) | (ord($hash[$desfase + 2]) << 8) | ord($hash[$desfase + 3]);

        return str_pad((string) ($numero % (10 ** self::DIGITOS)), self::DIGITOS, '0', STR_PAD_LEFT);
    }

    /**
     * Devuelve el paso que coincide (para guardarlo como el último usado) o null si el código no sirve:
     * fuera de la ventana, mal escrito o un paso igual o anterior al último usado.
     */
    public static function verificar(string $secreto, string $codigo, ?int $ultimoPaso = null, ?int $ahora = null): ?int
    {
        $codigo = preg_replace('/\s+/', '', $codigo);
        if (! preg_match('/^\d{'.self::DIGITOS.'}$/', $codigo)) {
            return null;
        }
        $actual = self::pasoActual($ahora);
        foreach ([$actual, $actual - 1, $actual + 1] as $paso) {
            if ($ultimoPaso !== null && $paso <= $ultimoPaso) {
                continue;
            }
            if (hash_equals(self::codigo($secreto, $paso), $codigo)) {
                return $paso;
            }
        }

        return null;
    }

    private static function decodificar(string $secreto): string
    {
        $secreto = strtoupper(preg_replace('/[^A-Za-z2-7]/', '', $secreto));
        $bits = '';
        foreach (str_split($secreto) as $c) {
            $bits .= str_pad(decbin(strpos(self::BASE32, $c)), 5, '0', STR_PAD_LEFT);
        }
        $out = '';
        foreach (str_split($bits, 8) as $byte) {
            if (strlen($byte) === 8) {
                $out .= chr(bindec($byte));
            }
        }

        return $out;
    }
}
