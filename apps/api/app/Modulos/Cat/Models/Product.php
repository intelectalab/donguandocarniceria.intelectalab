<?php

namespace App\Modulos\Cat\Models;

use App\Models\Model;

/** Producto: lo que vende (o compra) una marca, una sola vez. Sus presentaciones son las variantes. CAT-01 y CAT-02. */
class Product extends Model
{
    protected $table = 'products';

    protected $casts = [
        'shelf_life_days' => 'integer', 'requires_lot' => 'boolean', 'web_publishable' => 'boolean', 'allow_discount' => 'boolean',
        'variantes_activas' => 'integer', 'lotes_bloqueados' => 'integer',
    ];
}
