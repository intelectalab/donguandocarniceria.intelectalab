<?php

namespace App\Modulos\Plt\Models;

use App\Models\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** Serie de documentos (comprobantes, guías, órdenes…) con su correlativo. PLT-08. */
class DocumentSeries extends Model
{
    protected $table = 'document_series';

    protected $casts = ['next_number' => 'integer', 'is_electronic' => 'boolean', 'all_sites' => 'boolean', 'legacy_last_number' => 'integer'];

    public function company(): BelongsTo
    {
        return $this->belongsTo(Company::class);
    }
}
