<?php

namespace App\Modulos\Seg\Services;

use App\Models\User;
use App\Support\Access;
use App\Support\Events;
use App\Support\RuleError;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Roles y sus permisos (SEG-10, SEG-11, SEG-12). Escribir exige seg.role.manage.
 *  RN-SEG-12  acceso por módulo (C crear, L leer, E editar, A aprobar o anular) y permisos especiales;
 *             un módulo apagado no concede nada (RN-PLT-07), así que no se le dan accesos ni permisos.
 *  RN-SEG-14  los roles del sistema no se borran ni cambian su código; sus permisos sí se ajustan por
 *             empresa. Los roles propios se crean (copiando uno), se editan y se borran.
 *  RN-SEG-20  rige en la siguiente petición (los permisos se leen por petición); las tablas tienen
 *             auditoría de cambios y además queda en la bitácora y en los eventos.
 * La gerencia tiene todo por contrato del núcleo y el soporte de plataforma es de Intelectalab: no se
 * editan desde aquí. Al administrador del sistema no se le quita lo que necesita para administrar.
 */
final class Roles
{
    /** Roles que no se editan ni se copian desde la empresa. */
    public const FIJOS = ['GERENTE', 'SOPORTE_PLATAFORMA'];

    /** Lo mínimo que conserva ADMIN_SISTEMA para que siempre haya quien administre usuarios y roles. */
    private const ADMIN = 'ADMIN_SISTEMA';

    private const ADMIN_PERMISOS = ['seg.user.manage', 'seg.role.manage'];

    /** Crea un rol propio copiando accesos, permisos, segundo factor y alcance de otro. */
    public static function copiar(string $baseId, string $codigo, string $nombre, User $quien): object
    {
        $codigo = strtoupper(trim($codigo));
        if (! preg_match('/^[A-Z][A-Z0-9_]{2,24}$/', $codigo)) {
            RuleError::fail('RN-SEG-14', 'El código usa mayúsculas, números y guion bajo, de 3 a 25 caracteres, y empieza con una letra.');
        }
        $base = self::fila($baseId);
        if (in_array($base->code, self::FIJOS, true)) {
            RuleError::fail('RN-SEG-14', "El rol {$base->name} no se copia.");
        }
        if (DB::table('roles')->where('code', $codigo)->exists()) {
            RuleError::fail('RN-SEG-14', "Ya existe un rol con el código {$codigo}.");
        }

        return DB::transaction(function () use ($base, $codigo, $nombre, $quien) {
            $id = DB::table('roles')->insertGetId([
                'code' => $codigo, 'name' => mb_substr(trim($nombre), 0, 80), 'is_system' => false, 'description' => "Copia de {$base->name}",
                'requires_mfa' => $base->requires_mfa, 'scope_mode' => $base->scope_mode, 'phase' => $base->phase, 'status' => 'ACTIVE',
            ], 'id');
            foreach (DB::table('role_module_access')->where('role_id', $base->id)->get(['module_code', 'actions']) as $a) {
                DB::table('role_module_access')->insert(['role_id' => $id, 'module_code' => $a->module_code, 'actions' => $a->actions]);
            }
            foreach (DB::table('role_permissions')->where('role_id', $base->id)->pluck('permission_id') as $p) {
                DB::table('role_permissions')->insert(['role_id' => $id, 'permission_id' => $p]);
            }
            self::registrar('Creó el rol '.$codigo." copiando {$base->code}", $id, $quien, ['base' => $base->code]);

            return self::fila($id);
        });
    }

    /** Nombre y descripción de un rol propio. */
    public static function editar(string $id, string $nombre, ?string $descripcion, User $quien): object
    {
        $r = self::fila($id);
        if ($r->is_system) {
            RuleError::fail('RN-SEG-14', 'Los roles del sistema no cambian su nombre ni su código; solo se ajustan sus permisos.');
        }
        DB::table('roles')->where('id', $id)->update(['name' => mb_substr(trim($nombre), 0, 80), 'description' => $descripcion !== null ? trim($descripcion) : null, 'updated_at' => now()]);
        self::registrar("Editó el rol {$r->code}", $id, $quien);

        return self::fila($id);
    }

    /** Borra un rol propio sin usuarios. */
    public static function borrar(string $id, User $quien): void
    {
        $r = self::fila($id);
        if ($r->is_system) {
            RuleError::fail('RN-SEG-14', 'Los roles del sistema no se borran.');
        }
        if (DB::table('user_roles')->where('role_id', $id)->exists()) {
            RuleError::fail('RN-SEG-14', "Hay usuarios con el rol {$r->name}: cámbialos de rol antes de borrarlo.");
        }
        DB::transaction(function () use ($r, $quien) {
            DB::table('role_permissions')->where('role_id', $r->id)->delete();
            DB::table('role_module_access')->where('role_id', $r->id)->delete();
            DB::table('roles')->where('id', $r->id)->delete();
            self::registrar("Borró el rol {$r->code}", $r->id, $quien);
        });
    }

    /** Acceso del rol a un módulo: letras de CLEA ('' = ninguno). Pisa el valor por defecto (*). */
    public static function cambiarAcceso(string $id, string $modulo, string $letras, User $quien): array
    {
        $r = self::editable($id);
        $modulo = strtoupper($modulo);
        if (! DB::table('platform_modules')->where('code', $modulo)->exists()) {
            RuleError::fail('RN-SEG-12', 'Ese módulo no existe.');
        }
        // En el orden C, L, E, A, sin repetir (la base lo exige así).
        $letras = implode('', array_filter(str_split('CLEA'), fn ($l) => str_contains(strtoupper($letras), $l)));
        if ($letras !== '' && ! self::encendido($modulo)) {
            RuleError::fail('RN-PLT-07', "El módulo {$modulo} está apagado: no se le conceden accesos.");
        }
        if ($r->code === self::ADMIN && $modulo === 'SEG' && ! (str_contains($letras, 'L') && str_contains($letras, 'E'))) {
            RuleError::fail('RN-SEG-15', 'El administrador del sistema conserva leer y editar en Seguridad: siempre debe haber quien administre usuarios y roles.');
        }

        DB::transaction(function () use ($r, $modulo, $letras, $quien) {
            $actual = DB::table('role_module_access')->where('role_id', $r->id)->where('module_code', $modulo)->first();
            $actual
                ? DB::table('role_module_access')->where('id', $actual->id)->update(['actions' => $letras, 'updated_at' => now()])
                : DB::table('role_module_access')->insert(['role_id' => $r->id, 'module_code' => $modulo, 'actions' => $letras]);
            self::registrar("Acceso de {$r->code} a {$modulo}: ".($letras ?: 'ninguno'), $r->id, $quien, ['module' => $modulo, 'actions' => $letras]);
        });

        return ['module_code' => $modulo, 'actions' => $letras];
    }

    /** Concede o quita un permiso especial. */
    public static function cambiarPermiso(string $id, string $codigo, bool $conceder, User $quien): array
    {
        $r = self::editable($id);
        $p = DB::table('permissions')->where('code', $codigo)->first() ?? RuleError::fail('RN-SEG-12', 'Ese permiso no existe.');
        if ($p->everyone) {
            RuleError::fail('RN-SEG-12', "El permiso {$codigo} lo tienen todos: no se quita ni se concede por rol.");
        }
        if ($conceder && ! self::encendido($p->module_code)) {
            RuleError::fail('RN-PLT-07', "El módulo {$p->module_code} está apagado: su permiso {$codigo} no se concede.");
        }
        if (! $conceder && $r->code === self::ADMIN && in_array($codigo, self::ADMIN_PERMISOS, true)) {
            RuleError::fail('RN-SEG-15', "El administrador del sistema conserva {$codigo}: siempre debe haber quien administre usuarios y roles.");
        }

        DB::transaction(function () use ($r, $p, $conceder, $quien) {
            $existe = DB::table('role_permissions')->where('role_id', $r->id)->where('permission_id', $p->id)->exists();
            if ($conceder && ! $existe) {
                DB::table('role_permissions')->insert(['role_id' => $r->id, 'permission_id' => $p->id]);
            } elseif (! $conceder && $existe) {
                DB::table('role_permissions')->where('role_id', $r->id)->where('permission_id', $p->id)->delete();
            }
            self::registrar(($conceder ? 'Concedió ' : 'Quitó ')."{$p->code} a {$r->code}", $r->id, $quien, ['permission' => $p->code, 'granted' => $conceder]);
        });

        return ['permission_code' => $p->code, 'granted' => $conceder];
    }

    /* ------------------------------------------------------------------ lectura */

    /**
     * Acceso efectivo de cada rol a cada módulo (fila propia o la de «*»; la gerencia, todo).
     *
     * @return array<string, array<string, string>> [role_id => [module_code => letras]]
     */
    public static function accesos(Collection $roles): array
    {
        $filas = DB::table('role_module_access')->whereIn('role_id', $roles->pluck('id'))->get(['role_id', 'module_code', 'actions'])->groupBy('role_id');
        $modulos = DB::table('platform_modules')->pluck('code');
        $out = [];
        foreach ($roles as $r) {
            $propias = ($filas[$r->id] ?? collect())->pluck('actions', 'module_code');
            foreach ($modulos as $m) {
                $out[$r->id][$m] = $r->code === 'GERENTE' ? 'CLEA' : ($propias[$m] ?? $propias['*'] ?? '');
            }
        }

        return $out;
    }

    /** @return array<string, string[]> [role_id => códigos de permisos] (la gerencia, todos) */
    public static function permisos(Collection $roles): array
    {
        $todos = DB::table('permissions')->orderBy('code')->pluck('code')->all();
        $todosLosTienen = DB::table('permissions')->where('everyone', true)->pluck('code')->all();
        $filas = DB::table('role_permissions as rp')->join('permissions as p', 'p.id', '=', 'rp.permission_id')->whereIn('rp.role_id', $roles->pluck('id'))
            ->get(['rp.role_id', 'p.code'])->groupBy('role_id');
        $out = [];
        foreach ($roles as $r) {
            $out[$r->id] = $r->code === 'GERENTE' ? $todos : array_values(array_unique(array_merge(($filas[$r->id] ?? collect())->pluck('code')->all(), $todosLosTienen)));
        }

        return $out;
    }

    public static function encendido(string $modulo): bool
    {
        return DB::table('tenant_modules')->where('module_code', $modulo)->where('enabled', true)->exists();
    }

    public static function fila(string $id): object
    {
        return DB::table('roles')->where('id', $id)->first() ?? abort(404, 'Rol no encontrado.');
    }

    private static function editable(string $id): object
    {
        $r = self::fila($id);
        if ($r->code === 'GERENTE') {
            RuleError::fail('RN-SEG-14', 'La gerencia ve todo y tiene todos los permisos por contrato del núcleo.');
        }
        if ($r->code === 'SOPORTE_PLATAFORMA') {
            RuleError::fail('RN-SEG-14', 'El soporte de plataforma es de Intelectalab: sus permisos no se cambian desde la empresa.');
        }

        return $r;
    }

    private static function registrar(string $detalle, string $roleId, User $quien, array $datos = []): void
    {
        Bitacora::registrar('ROLE_CHANGED', ['user' => $quien, 'entity' => 'roles', 'entity_id' => $roleId, 'detail' => $detalle, 'details' => $datos ?: null]);
        Events::emit('user.roles_changed', 'roles', $roleId, $datos + ['detail' => $detalle]);
        Access::forget();
    }
}
