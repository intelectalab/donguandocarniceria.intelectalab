<?php

namespace App\Modulos\Equ;

use Illuminate\Support\Facades\DB;

/**
 * Permisos propios de EQU que la spec no trae. Se agregan a cada empresa y se dan a sus roles, sin repetir.
 * Corre con el dueño de las tablas: desde la migración (bases que ya existen) y desde la siembra (bases nuevas).
 */
class Permisos
{
    /** código => [descripción, roles que lo reciben]. El gerente los tiene todos sin asignarlos. */
    public const NUEVOS = [
        'equ.usage.record' => ['Registrar horas de uso y lecturas de horómetro', ['JEFE_PRODUCCION', 'OPERARIO_PRODUCCION']],
    ];

    public static function asegurar(?string $conexion = null): void
    {
        $db = DB::connection($conexion);
        foreach ($db->table('tenants')->pluck('id') as $tenant) {
            foreach (self::NUEVOS as $codigo => [$descripcion, $roles]) {
                $permiso = $db->table('permissions')->where('tenant_id', $tenant)->where('code', $codigo)->value('id');
                if (! $permiso) {
                    $permiso = $db->table('permissions')->insertGetId(
                        ['tenant_id' => $tenant, 'code' => $codigo, 'module_code' => 'EQU', 'description' => $descripcion], 'id');
                }
                foreach ($db->table('roles')->where('tenant_id', $tenant)->whereIn('code', $roles)->pluck('id') as $rol) {
                    $db->table('role_permissions')->where('role_id', $rol)->where('permission_id', $permiso)->exists()
                        || $db->table('role_permissions')->insert(['tenant_id' => $tenant, 'role_id' => $rol, 'permission_id' => $permiso]);
                }
            }
        }
    }

    public static function quitar(?string $conexion = null): void
    {
        $db = DB::connection($conexion);
        $ids = $db->table('permissions')->whereIn('code', array_keys(self::NUEVOS))->pluck('id');
        $db->table('role_permissions')->whereIn('permission_id', $ids)->delete();
        $db->table('permissions')->whereIn('id', $ids)->delete();
    }
}
