<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model as Eloquent;

/**
 * Base de los modelos de negocio: ids uuid y fechas con zona horaria.
 * tenant_id no se asigna desde PHP: la base lo toma de app_tenant_id() y RLS lo valida.
 */
abstract class Model extends Eloquent
{
    use HasUuids;

    protected $guarded = ['id', 'tenant_id'];

    protected $dateFormat = 'Y-m-d H:i:sP';
}
