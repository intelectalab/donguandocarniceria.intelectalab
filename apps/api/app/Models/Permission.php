<?php

namespace App\Models;

class Permission extends Model
{
    protected $casts = ['everyone' => 'boolean'];
}
