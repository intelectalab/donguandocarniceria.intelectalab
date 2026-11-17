<?php

namespace App\Modulos\Cli\Models;

use App\Models\Model;

/** Cliente único para las 5 marcas (CLI-01 y CLI-02). El celular va en E.164 (RN-CLI-01). */
class Customer extends Model
{
    protected $table = 'customers';

    protected $casts = [
        'marketing_opt_in' => 'boolean', 'segment_brands' => 'array', 'orders_count' => 'integer',
        'first_order_at' => 'datetime', 'last_order_at' => 'datetime', 'doc_validated_at' => 'datetime',
        'marketing_opt_in_at' => 'datetime', 'blocked_at' => 'datetime', 'merged_at' => 'datetime', 'unblocked_at' => 'datetime',
    ];

    public function nombre(): string
    {
        return $this->trade_name ?: $this->full_name;
    }

    public function fusionado(): bool
    {
        return $this->merged_into_id !== null;
    }
}
