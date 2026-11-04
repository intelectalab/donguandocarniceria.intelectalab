<?php

namespace App\Support;

use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Qué puede hacer un usuario:
 *  - permisos especiales de la spec (permissions, p. ej. ped.discount.approve);
 *  - acceso por módulo (role_module_access: C crear, L leer, E editar, A aprobar);
 *  - alcance por marca y local (user_scopes; sin filas = todas).
 * GERENTE tiene todo; AUDITOR lee todo.
 */
final class Access
{
    private static array $cache = [];

    public static function for(User $user): array
    {
        return self::$cache[$user->id] ??= self::load($user);
    }

    public static function forget(): void
    {
        self::$cache = [];
    }

    public static function can(User $user, string $permission): bool
    {
        $a = self::for($user);

        return $a['all_permissions'] || in_array($permission, $a['permissions'], true);
    }

    /** $action: C, L, E o A. */
    public static function module(User $user, string $module, string $action = 'L'): bool
    {
        $a = self::for($user);
        if (! in_array($module, $a['enabled_modules'], true)) {
            return false;
        }
        $actions = $a['modules'][$module] ?? $a['modules']['*'] ?? '';

        return str_contains($actions, $action);
    }

    private static function load(User $user): array
    {
        $roles = DB::table('user_roles')->join('roles', 'roles.id', '=', 'user_roles.role_id')
            ->where('user_roles.user_id', $user->id)->where('roles.status', 'ACTIVE')
            ->pluck('roles.code', 'roles.id');

        $permissions = DB::table('role_permissions')->join('permissions', 'permissions.id', '=', 'role_permissions.permission_id')
            ->whereIn('role_permissions.role_id', $roles->keys())->pluck('permissions.code')
            ->merge(DB::table('permissions')->where('everyone', true)->pluck('code'))
            ->unique()->sort()->values()->all();

        // Varios roles con el mismo módulo: se suman las letras.
        $modules = [];
        foreach (DB::table('role_module_access')->whereIn('role_id', $roles->keys())->get() as $row) {
            $modules[$row->module_code] = self::merge($modules[$row->module_code] ?? '', $row->actions);
        }
        if ($roles->contains('GERENTE')) {
            $modules = ['*' => 'CLEA'];
        } elseif ($roles->contains('AUDITOR')) {
            $modules = ['*' => 'L'];
        }

        $scopes = DB::table('user_scopes')->where('user_id', $user->id)->get();

        return [
            'roles' => $roles->values()->all(),
            'all_permissions' => $roles->contains('GERENTE'),
            'permissions' => $permissions,
            'modules' => $modules,
            'enabled_modules' => DB::table('tenant_modules')->where('enabled', true)->pluck('module_code')->all(),
            'brands' => $scopes->pluck('brand_id')->filter()->unique()->values()->all(),
            'establishments' => $scopes->pluck('establishment_id')->filter()->unique()->values()->all(),
        ];
    }

    private static function merge(string $a, string $b): string
    {
        return implode('', array_filter(str_split('CLEA'), fn ($l) => str_contains($a.$b, $l)));
    }
}
