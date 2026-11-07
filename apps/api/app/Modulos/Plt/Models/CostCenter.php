<?php

namespace App\Modulos\Plt\Models;

use App\Models\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** Centro de costo: árbol por área, con local y marca opcionales. PLT-07. */
class CostCenter extends Model
{
    protected $table = 'cost_centers';

    protected $casts = ['nivel' => 'integer', 'hijos_count' => 'integer', 'gastos_count' => 'integer'];

    public function parent(): BelongsTo
    {
        return $this->belongsTo(self::class, 'parent_id');
    }
}
