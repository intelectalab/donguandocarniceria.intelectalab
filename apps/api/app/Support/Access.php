<?php

namespace App\Support;

use App\Models\User;
use App\Modulos\Ops\Services\Accesos;
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

    /** Permisos del servicio (soporte, suscripción y alta inicial): valen aunque el plan no tenga su módulo (OPS, SUS, ONB). */
    public const DEL_SERVICIO = ['ops.ticket.create', 'ops.ticket.view_all', 'ops.support_access.approve', 'ops.support_access.revoke', 'ops.support_access.view_log',
        'sus.subscription.view', 'sus.subscription.change_plan', 'sus.subscription.cancel', 'sus.invoice.view', 'sus.payment_method.manage',
        'onb.setup.run', 'onb.template.apply', 'onb.import.run', 'onb.import.release_opening_stock', 'onb.balance.import'];

    public static function for(User $user): array
    {
        return self::$cache[$user->id] ??= self::load($user);
    }

    public static function forget(): void
    {
        self::$cache = [];
    }

    /** Un módulo apagado no concede sus permisos, ni al gerente (RN-PLT-07). */
    public static function can(User $user, string $permission): bool
    {
        $a = self::for($user);
        $modulo = $a['permission_modules'][$permission] ?? null;
        if ($modulo !== null && ! in_array($modulo, $a['enabled_modules'], true) && ! in_array($permission, self::DEL_SERVICIO, true)) {
            return false;
        }

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
        // OPS-06: el usuario técnico del soporte ve solo los módulos de su acceso vigente, sin permisos especiales.
        // Sus permisos son los de esos módulos (el middleware «soporte» corta los cambios en solo lectura y las
        // exportaciones no permitidas), nunca los de aprobar o revocar accesos ni los de tickets.
        if ($user->user_type === Accesos::TIPO_USUARIO) {
            $modulos = Accesos::accesoTecnico($user);
            $porModulo = DB::table('permissions')->pluck('module_code', 'code')->all();
            $permisos = $modulos ? array_keys(array_filter($porModulo, fn ($m, $p) => (isset($modulos['*']) || isset($modulos[$m])) && ! in_array($p, self::DEL_SERVICIO, true),
                ARRAY_FILTER_USE_BOTH)) : [];

            return ['roles' => ['SOPORTE_TECNICO'], 'all_permissions' => false, 'permissions' => $permisos, 'modules' => $modulos,
                'enabled_modules' => DB::table('tenant_modules')->where('enabled', true)->pluck('module_code')->all(),
                'permission_modules' => $porModulo, 'brands' => [], 'establishments' => []];
        }
        $filas = DB::table('user_roles')->join('roles', 'roles.id', '=', 'user_roles.role_id')
            ->where('user_roles.user_id', $user->id)->where('roles.status', 'ACTIVE')
            ->get(['roles.id', 'roles.code', 'roles.scope_mode']);
        $roles = $filas->pluck('code', 'id');
        // RN-SEG-13: con un rol de alcance total ve todo, aunque queden marcas o locales guardados.
        $alcanceTotal = $filas->contains(fn ($r) => $r->scope_mode !== 'ASSIGNED');

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

        $scopes = $alcanceTotal ? collect() : DB::table('user_scopes')->where('user_id', $user->id)->get();

        return [
            'roles' => $roles->values()->all(),
            'all_permissions' => $roles->contains('GERENTE'),
            'permissions' => $permissions,
            'modules' => $modules,
            'enabled_modules' => DB::table('tenant_modules')->where('enabled', true)->pluck('module_code')->all(),
            'permission_modules' => DB::table('permissions')->pluck('module_code', 'code')->all(),
            'brands' => $scopes->pluck('brand_id')->filter()->unique()->values()->all(),
            'establishments' => $scopes->pluck('establishment_id')->filter()->unique()->values()->all(),
        ];
    }

    private static function merge(string $a, string $b): string
    {
        return implode('', array_filter(str_split('CLEA'), fn ($l) => str_contains($a.$b, $l)));
    }
}
