<?php

namespace App\Modulos\Plt\Models;

use App\Models\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** Marca: factura con el RUC de una empresa. PLT-05. */
class Brand extends Model
{
    protected $table = 'brands';

    protected $casts = [
        'sort_order' => 'integer', 'print_show_logo' => 'boolean',
        'series_count' => 'integer', 'products_count' => 'integer', 'orders_count' => 'integer', 'documents_count' => 'integer',
    ];

    public function company(): BelongsTo
    {
        return $this->belongsTo(Company::class);
    }
}
