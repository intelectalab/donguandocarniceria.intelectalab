<?php

namespace App\Modulos\Web\Services;

/** Por qué un pedido web no se pudo crear: código de la bandeja (SKU_NOT_MAPPED, PHONE_INVALID…) y los SKU afectados. */
final class ErrorPedido extends \RuntimeException
{
    public function __construct(public readonly string $codigo, string $mensaje, public readonly array $skus = [])
    {
        parent::__construct($mensaje);
    }
}
