<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Role extends Model
{
    protected $casts = ['is_system' => 'boolean', 'requires_mfa' => 'boolean'];

    public function permissions(): BelongsToMany
    {
        return $this->belongsToMany(Permission::class, 'role_permissions')->withTimestamps();
    }

    public function moduleAccess(): HasMany
    {
        return $this->hasMany(RoleModuleAccess::class);
    }
}
