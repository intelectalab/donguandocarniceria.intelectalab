<?php

namespace App\Modulos\Sus\Services\Pasarelas;

/**
 * Adaptador de la pasarela de cobro (RN-SUS-20). La tarjeta nunca pasa por el sistema: se cobra con el token que dio la
 * pasarela, y el resultado llega por un aviso firmado (webhook), nunca por la redirección del navegador.
 */
interface Pasarela
{
    /**
     * Pide un cargo. Devuelve la referencia del cargo en la pasarela; el resultado llega después por el aviso.
     * Una pasarela de prueba puede devolver además el aviso que entregará ('evento' y 'firma').
     *
     * @return array{ref: string, evento?: string, firma?: string}
     */
    public function cobrar(string $token, float $monto, string $descripcion): array;

    /** ¿La firma del aviso es de la pasarela? */
    public function verificar(string $cuerpo, ?string $firma): bool;
}
