<?php

namespace App\Modulos\Alm\Models;

use App\Models\Model;

/** Kardex de solo inserción. Solo lectura: se escribe con alm_inventory_move (RN-ALM-01). */
class StockMovement extends Model
{
    protected $table = 'stock_movements';
}
