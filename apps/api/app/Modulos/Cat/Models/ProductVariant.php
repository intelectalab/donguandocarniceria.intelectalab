<?php

namespace App\Modulos\Cat\Models;

use App\Models\Model;

/** Variante: un SKU por corte o presentación de un producto, con su modo de venta y pesos. CAT-03. */
class ProductVariant extends Model
{
    protected $table = 'product_variants';

    protected $casts = [
        'web_publishable' => 'boolean', 'sellable' => 'boolean',
    ];
}
