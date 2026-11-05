<?php

namespace App\Modulos\Plt\Models;

use App\Models\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** Local: planta, tienda, almacén, oficina o mixto. PLT-04. */
class Establishment extends Model
{
    protected $casts = ['has_counter' => 'boolean', 'lat' => 'float', 'lng' => 'float', 'warehouses_count' => 'integer', 'zones_count' => 'integer'];

    public function company(): BelongsTo
    {
        return $this->belongsTo(Company::class);
    }
}
