<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Laravel\Sanctum\PersonalAccessToken as SanctumToken;

// Token con id uuid. La tabla tiene RLS: Sanctum solo encuentra tokens de la empresa del dominio.
class PersonalAccessToken extends SanctumToken
{
    use HasUuids;
}
