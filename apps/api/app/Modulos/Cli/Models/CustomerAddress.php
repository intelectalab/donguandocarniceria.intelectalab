<?php

namespace App\Modulos\Cli\Models;

use App\Models\Model;

/** Dirección con pin y referencia (CLI-05 y CLI-06). La zona sale del pin (RN-CLI-06). */
class CustomerAddress extends Model
{
    protected $table = 'customer_addresses';

    protected $casts = [
        'lat' => 'float', 'lng' => 'float', 'is_default' => 'boolean', 'out_of_coverage' => 'boolean',
        'geocode_confidence' => 'float', 'last_used_at' => 'datetime',
    ];
}
