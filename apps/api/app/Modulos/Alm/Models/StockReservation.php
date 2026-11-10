<?php

namespace App\Modulos\Alm\Models;

use App\Models\Model;

/** Reserva FEFO de una línea de pedido (ALM-10). */
class StockReservation extends Model
{
    protected $table = 'stock_reservations';
}
