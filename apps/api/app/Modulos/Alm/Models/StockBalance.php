<?php

namespace App\Modulos\Alm\Models;

use App\Models\Model;

/** Saldo por almacén, variante y lote. Solo lectura: se escribe con alm_inventory_move (RN-ALM-01). */
class StockBalance extends Model
{
    protected $table = 'stock_balances';
}
