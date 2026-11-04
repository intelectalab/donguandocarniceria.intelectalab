<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Laravel\Sanctum\HasApiTokens;

/**
 * Usuario de una empresa (SEG). Pertenece a un solo tenant: la tabla tiene RLS, así que
 * solo se encuentra con el contexto de su empresa ya fijado (ver ResolveTenant).
 */
class User extends Authenticatable
{
    use HasApiTokens, HasUuids;

    protected $guarded = ['id', 'tenant_id', 'password'];

    protected $hidden = ['password', 'totp_last_step'];

    protected $dateFormat = 'Y-m-d H:i:sP';

    protected function casts(): array
    {
        return [
            'password' => 'hashed',
            'twofa_enabled' => 'boolean',
            'twofa_required' => 'boolean',
            'must_change_password' => 'boolean',
            'notify_prefs' => 'array',
            'last_login' => 'datetime',
            'locked_until' => 'datetime',
            'password_changed_at' => 'datetime',
        ];
    }

    // La tabla no tiene remember_token: la sesión es por token de Sanctum.
    public function getRememberTokenName()
    {
        return null;
    }

    public function roles(): BelongsToMany
    {
        return $this->belongsToMany(Role::class, 'user_roles')->withTimestamps();
    }

    public function scopes(): HasMany
    {
        return $this->hasMany(UserScope::class);
    }
}
