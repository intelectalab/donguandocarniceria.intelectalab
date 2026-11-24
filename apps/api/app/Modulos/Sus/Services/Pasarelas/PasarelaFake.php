<?php

namespace App\Modulos\Sus\Services\Pasarelas;

use Illuminate\Support\Str;

/**
 * Pasarela de prueba (D-SUS-02: mientras no se elija Mercado Pago o Culqi). No cobra nada de verdad.
 * El resultado depende del token: los que contienen «declined» se rechazan, los que contienen «insufficient» se
 * rechazan por fondos y el resto se aprueba. Devuelve el aviso firmado que entregaría la pasarela real.
 */
final class PasarelaFake implements Pasarela
{
    public function cobrar(string $token, float $monto, string $descripcion): array
    {
        $ref = 'fake_ch_'.Str::lower(Str::random(20));
        [$tipo, $error] = match (true) {
            str_contains($token, 'declined') => ['charge.failed', 'El banco rechazó la tarjeta'],
            str_contains($token, 'insufficient') => ['charge.failed', 'Fondos insuficientes'],
            default => ['charge.succeeded', null],
        };
        $evento = json_encode(['id' => 'evt_'.Str::lower(Str::random(20)), 'type' => $tipo,
            'data' => ['charge' => $ref, 'amount' => round($monto, 2), 'currency' => 'PEN', 'description' => $descripcion, 'error' => $error]]);

        return ['ref' => $ref, 'evento' => $evento, 'firma' => self::firmar($evento)];
    }

    public function verificar(string $cuerpo, ?string $firma): bool
    {
        return $firma !== null && hash_equals(self::firmar($cuerpo), $firma);
    }

    /** Firma HMAC-SHA256 con una clave derivada de la clave de la aplicación (no se guarda en ningún lado). */
    public static function firmar(string $cuerpo): string
    {
        return hash_hmac('sha256', $cuerpo, hash_hmac('sha256', 'pasarela-fake', (string) config('app.key')));
    }
}
