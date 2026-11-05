<?php

namespace App\Modulos\Plt\Models;

use App\Models\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/** Empresa (razón social con RUC) dentro de la empresa cliente. PLT-03. */
class Company extends Model
{
    protected $hidden = ['einvoice_test', 'einvoice_user', 'einvoice_secret_last4'];

    public function establishments(): HasMany
    {
        return $this->hasMany(Establishment::class);
    }

    public function brands(): HasMany
    {
        return $this->hasMany(Brand::class);
    }

    public function series(): HasMany
    {
        return $this->hasMany(DocumentSeries::class);
    }
}
