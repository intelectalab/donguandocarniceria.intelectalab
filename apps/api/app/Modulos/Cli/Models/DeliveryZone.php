<?php

namespace App\Modulos\Cli\Models;

use App\Models\Model;

/** Zona de reparto: polígono o distritos, local que atiende y tarifa (CLI-08). */
class DeliveryZone extends Model
{
    protected $table = 'delivery_zones';

    protected $casts = [
        'districts' => 'array', 'polygon' => 'array', 'delivery_fee' => 'float', 'min_order_amount' => 'float',
        'free_from_units' => 'integer', 'free_from_kg' => 'float', 'free_from_amount' => 'float',
        'priority' => 'integer', 'province' => 'boolean', 'lat' => 'float', 'lng' => 'float',
    ];
}
