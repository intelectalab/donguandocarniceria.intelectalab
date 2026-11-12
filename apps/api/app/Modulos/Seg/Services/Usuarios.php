<?php

namespace App\Modulos\Seg\Services;

use App\Models\Role;
use App\Models\User;
use App\Support\Access;
use App\Support\Events;
use App\Support\Params;
use App\Support\RuleError;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;

/**
 * Usuarios de la empresa (SEG-08, SEG-09).
 *  RN-SEG-01  correo único en la empresa sin distinguir mayúsculas; se guarda en minúsculas.
 *  Un solo rol por usuario, como el prototipo: el alcance es de la persona y no se puede mezclar
 *  un rol de alcance asignado con uno total.
 *  RN-SEG-13  un rol de alcance asignado exige al menos un local o una marca; uno de alcance total
 *             ve todo, así que no guarda marcas ni locales.
 *  RN-SEG-15  siempre queda un usuario activo con ADMIN_SISTEMA.
 *  RN-SEG-17  los usuarios no se borran: se desactivan.
 *  RN-SEG-18  desactivar o bloquear cierra sus sesiones al instante; desactivar revoca sus celulares.
 *  RN-SEG-20  cambiar roles o alcance rige en la siguiente petición (los permisos se leen por petición)
 *             y queda en la bitácora y en los eventos.
 * El rol SOPORTE_PLATAFORMA no se asigna desde aquí (es de Intelectalab, ver docs/pendientes.md).
 */
final class Usuarios
{
    public const ADMIN = 'ADMIN_SISTEMA';

    public const GERENTE = 'GERENTE';

    /** SOPORTE_PLATAFORMA es de Intelectalab; CLIENTE_B2B es de los usuarios del portal (módulo B2B). */
    public const NO_ASIGNABLES = ['SOPORTE_PLATAFORMA', 'CLIENTE_B2B'];

    /** Horas que dura el código de la invitación (no es parámetro de la spec). */
    public const INVITACION_HORAS = 48;

    private const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

    /**
     * Crea el usuario en estado INVITED y le manda el código para fijar su contraseña.
     *
     * @param  array{name: string, email: string, role_id: string, employee_id?: ?string, brand_ids?: string[], establishment_ids?: string[]}  $d
     */
    public static function crear(array $d, User $quien): User
    {
        $email = mb_strtolower(trim($d['email']));
        if (User::whereRaw('lower(email) = ?', [$email])->exists()) {
            RuleError::fail('RN-SEG-01', 'Ya existe un usuario con ese correo en la empresa.');
        }
        $roles = self::rolesValidos([$d['role_id']]);
        $d = self::alcanceDelRol($roles, $d);
        self::trabajadorLibre($d['employee_id'] ?? null);
        if ($roles->contains('code', self::GERENTE)) {
            self::soloLaGerencia($quien, 'crear un usuario gerente');
        }

        return DB::transaction(function () use ($d, $email, $roles, $quien) {
            $u = new User;
            $u->forceFill([
                'name' => trim($d['name']), 'email' => $email, 'role' => $roles->first()->code, 'status' => 'INVITED',
                'employee_id' => ($d['employee_id'] ?? null) ?: null, 'password' => Hash::make(Str::random(40)), 'must_change_password' => true,
                'failed_logins' => 0, 'twofa_enabled' => false, 'twofa_required' => $roles->contains('requires_mfa', true),
                'invited_at' => now(), 'invited_by' => mb_substr($quien->email, 0, 40),
            ])->save();
            self::guardarRolesYAlcance($u, $roles, $d['brand_ids'] ?? [], $d['establishment_ids'] ?? []);
            self::invitar($u, $quien);
            Events::emit('user.invited', 'users', $u->id, ['email' => $u->email, 'roles' => $roles->pluck('code')->all()]);

            return $u->fresh();
        });
    }

    /**
     * Cambia nombre, roles, trabajador y alcance. Rige en la siguiente petición del usuario (RN-SEG-20).
     *
     * @param  array{name?: string, role_id: string, employee_id?: ?string, brand_ids?: string[], establishment_ids?: string[]}  $d
     */
    public static function actualizar(User $u, array $d, User $quien): User
    {
        $roles = self::rolesValidos([$d['role_id']]);
        $d = self::alcanceDelRol($roles, $d);
        self::trabajadorLibre($d['employee_id'] ?? null, $u->id);
        $antes = self::codigosDeRoles($u);
        $mismo = fn (array $a, array $b) => collect($a)->sort()->values()->all() === collect($b)->sort()->values()->all();
        $cambiaAcceso = ! $mismo($antes, $roles->pluck('code')->all())
            || ! $mismo(self::alcance($u, 'brand_id'), $d['brand_ids'] ?? []) || ! $mismo(self::alcance($u, 'establishment_id'), $d['establishment_ids'] ?? []);
        // RN-SEG-16: nadie se cambia a sí mismo el rol ni el alcance (solo su nombre o su trabajador).
        if ($cambiaAcceso && $u->id === $quien->id) {
            RuleError::fail('RN-SEG-16', 'No puedes cambiar tu propio rol ni tu alcance: pídeselo a otro administrador.');
        }
        if ($roles->contains('code', self::GERENTE) !== in_array(self::GERENTE, $antes, true)) {
            self::soloLaGerencia($quien, in_array(self::GERENTE, $antes, true) ? 'quitar el rol de gerente' : 'dar el rol de gerente');
        }
        if (! $roles->contains('code', self::ADMIN)) {
            self::noEsElUltimoAdmin($u, 'quitarle el rol de administrador del sistema');
        }

        return DB::transaction(function () use ($u, $d, $roles, $quien) {
            $antes = ['roles' => self::codigosDeRoles($u), 'brands' => self::alcance($u, 'brand_id'), 'sites' => self::alcance($u, 'establishment_id')];
            $u->forceFill(array_filter([
                'name' => isset($d['name']) ? trim($d['name']) : null,
            ]) + [
                'role' => $roles->first()->code, 'employee_id' => ($d['employee_id'] ?? null) ?: null,
                'twofa_required' => $roles->contains('requires_mfa', true), 'updated_at' => now(),
            ])->save();
            self::guardarRolesYAlcance($u, $roles, $d['brand_ids'] ?? [], $d['establishment_ids'] ?? []);
            $despues = ['roles' => $roles->pluck('code')->all(), 'brands' => $d['brand_ids'] ?? [], 'sites' => $d['establishment_ids'] ?? []];
            Bitacora::registrar('USER_UPDATED', ['user' => $quien, 'entity' => 'users', 'entity_id' => $u->id,
                'detail' => "Rol y alcance de {$u->email} cambiados", 'details' => ['antes' => $antes, 'despues' => $despues]]);
            Events::emit('user.updated', 'users', $u->id, $despues);
            Access::forget();

            return $u->fresh();
        });
    }

    /** Bloqueo a mano, sin plazo: lo levanta un administrador (RN-SEG-18 cierra sus sesiones). */
    public static function bloquear(User $u, string $motivo, User $quien): User
    {
        if ($u->id === $quien->id) {
            RuleError::fail('RN-SEG-15', 'No puedes bloquear tu propio usuario.');
        }
        if ($u->status !== 'ACTIVE') {
            RuleError::fail('RN-SEG-04', 'Solo se bloquea un usuario activo.');
        }
        self::noEsElUltimoAdmin($u, 'bloquearlo');

        return DB::transaction(function () use ($u, $motivo, $quien) {
            $u->forceFill(['status' => 'LOCKED', 'locked_until' => null, 'lock_reason' => mb_substr(trim($motivo), 0, 80), 'updated_at' => now()])->save();
            $n = self::cerrarSesionesDe($u, motivo: 'Usuario bloqueado: '.trim($motivo));
            Bitacora::registrar('LOCKED', ['user' => $quien, 'entity' => 'users', 'entity_id' => $u->id, 'detail' => "Bloqueó a {$u->email}: ".trim($motivo), 'details' => ['sessions_closed' => $n]], denegado: true);
            Events::emit('user.locked', 'users', $u->id, ['reason' => trim($motivo), 'by' => $quien->id]);

            return $u->fresh();
        });
    }

    /** Quita el bloqueo (a mano o por intentos) antes del plazo. Permiso seg.user.unlock. */
    public static function desbloquear(User $u, User $quien): User
    {
        if ($u->status !== 'LOCKED' && ! ($u->locked_until && $u->locked_until->isFuture())) {
            RuleError::fail('RN-SEG-04', 'El usuario no está bloqueado.');
        }

        return DB::transaction(function () use ($u, $quien) {
            $u->forceFill(['status' => 'ACTIVE', 'locked_until' => null, 'lock_reason' => null, 'failed_logins' => 0, 'updated_at' => now()])->save();
            Bitacora::registrar('UNLOCKED', ['user' => $quien, 'entity' => 'users', 'entity_id' => $u->id, 'detail' => "Desbloqueó a {$u->email}"]);

            return $u->fresh();
        });
    }

    /** No se borra: queda INACTIVE con motivo, sin sesiones y con sus celulares revocados (RN-SEG-17, 18). */
    public static function desactivar(User $u, string $motivo, User $quien): User
    {
        if ($u->id === $quien->id) {
            RuleError::fail('RN-SEG-15', 'No puedes desactivar tu propio usuario.');
        }
        if ($u->status === 'INACTIVE') {
            RuleError::fail('RN-SEG-17', 'El usuario ya está inactivo.');
        }
        self::noEsElUltimoAdmin($u, 'desactivarlo');

        return DB::transaction(function () use ($u, $motivo, $quien) {
            $u->forceFill(['status' => 'INACTIVE', 'deactivated_at' => now(), 'deactivated_reason' => mb_substr(trim($motivo), 0, 255),
                'locked_until' => null, 'updated_at' => now()])->save();
            $n = self::cerrarSesionesDe($u, motivo: 'Usuario desactivado: '.trim($motivo));
            $d = DB::table('user_devices')->where('user_id', $u->id)->whereIn('status', ['APPROVED', 'PENDING'])
                ->update(['status' => 'REVOKED', 'revoked_at' => now(), 'revoke_reason' => 'Usuario desactivado (RN-SEG-18)', 'updated_at' => now()]);
            Bitacora::registrar('USER_DEACTIVATED', ['user' => $quien, 'entity' => 'users', 'entity_id' => $u->id,
                'detail' => "Desactivó a {$u->email}: ".trim($motivo), 'details' => ['sessions_closed' => $n, 'devices_revoked' => $d]]);
            Events::emit('user.deactivated', 'users', $u->id, ['reason' => trim($motivo), 'by' => $quien->id]);

            return $u->fresh();
        });
    }

    public static function reactivar(User $u, User $quien): User
    {
        if ($u->status !== 'INACTIVE') {
            RuleError::fail('RN-SEG-17', 'El usuario no está inactivo.');
        }

        return DB::transaction(function () use ($u, $quien) {
            // Vuelve con contraseña nueva: se le manda otra invitación.
            $u->forceFill(['status' => 'INVITED', 'deactivated_at' => null, 'deactivated_reason' => null, 'failed_logins' => 0,
                'password' => Hash::make(Str::random(40)), 'must_change_password' => true, 'invited_at' => now(),
                'invited_by' => mb_substr($quien->email, 0, 40), 'updated_at' => now()])->save();
            self::invitar($u, $quien);
            Bitacora::registrar('USER_REACTIVATED', ['user' => $quien, 'entity' => 'users', 'entity_id' => $u->id, 'detail' => "Reactivó a {$u->email}"]);
            Events::emit('user.reactivated', 'users', $u->id, ['by' => $quien->id]);

            return $u->fresh();
        });
    }

    /**
     * Cierra todas las sesiones del usuario (o una). Permiso seg.session.revoke. La sesión con la que
     * se hace el pedido nunca se cierra: sobre la propia cuenta es «cerrar todas las demás», como SEG-07.
     */
    public static function cerrarSesiones(User $u, User $quien, ?string $tokenId = null): int
    {
        $actual = $quien->currentAccessToken()?->id;
        if ($tokenId && $tokenId === $actual) {
            RuleError::fail('RN-SEG-09', 'Esa es tu sesión actual: para salir usa «Salir».');
        }

        return DB::transaction(function () use ($u, $quien, $tokenId, $actual) {
            $n = self::cerrarSesionesDe($u, $tokenId, $actual, "Cerrada por {$quien->name}");
            Bitacora::registrar('SESSION_REVOKED', ['user' => $quien, 'entity' => 'users', 'entity_id' => $u->id,
                'detail' => ($tokenId ? 'Cerró una sesión de ' : 'Cerró las sesiones de ').$u->email, 'details' => ['sessions_closed' => $n]]);

            return $n;
        });
    }

    /** El usuario deberá activar el segundo factor otra vez; sus códigos de recuperación dejan de servir. */
    public static function reiniciarSegundoFactor(User $u, User $quien): User
    {
        if ($u->id === $quien->id) {
            RuleError::fail('RN-SEG-16', 'No puedes reiniciar tu propio segundo factor: pídeselo a otro administrador.');
        }
        if (! $u->twofa_enabled) {
            RuleError::fail('RN-SEG-05', 'El usuario no tiene el segundo factor activo.');
        }

        return DB::transaction(function () use ($u, $quien) {
            $u->forceFill(['twofa_enabled' => false, 'mfa_enrolled_at' => null, 'totp_last_step' => null, 'updated_at' => now()])->save();
            DB::table('mfa_recovery_codes')->where('user_id', $u->id)->whereNull('used_at')->whereNull('voided_at')
                ->update(['voided_at' => 'REINICIADO', 'updated_at' => now()]);
            Bitacora::registrar('MFA_RESET', ['user' => $quien, 'entity' => 'users', 'entity_id' => $u->id, 'detail' => "Reinició el segundo factor de {$u->email}"]);

            return $u->fresh();
        });
    }

    /** Manda (otra vez) el código de invitación a un usuario INVITED. */
    public static function reinvitar(User $u, User $quien): void
    {
        if ($u->status !== 'INVITED') {
            RuleError::fail('RN-SEG-01', 'Solo se reenvía la invitación a un usuario que aún no fijó su contraseña.');
        }
        DB::transaction(fn () => self::invitar($u, $quien));
    }

    /* ------------------------------------------------------------------ internos */

    /** Código de 6 caracteres que se canjea en «Nueva contraseña» (SEG-05); al usarlo, el usuario pasa a ACTIVE. */
    private static function invitar(User $u, User $quien): void
    {
        $codigo = '';
        for ($i = 0; $i < 6; $i++) {
            $codigo .= self::ALFABETO[random_int(0, strlen(self::ALFABETO) - 1)];
        }
        DB::table('password_reset_tokens')->where('user_id', $u->id)->whereNull('used_at')->whereNull('voided_at')
            ->update(['voided_at' => 'REEMPLAZADO', 'updated_at' => now()]);
        DB::table('password_reset_tokens')->insert([
            'user_id' => $u->id, 'token_hash' => Hash::make($codigo), 'kind' => 'INVITE',
            'expires_at' => now()->addHours(self::INVITACION_HORAS), 'requested_at' => now(), 'requested_ip' => request()?->ip(),
        ]);
        $horas = self::INVITACION_HORAS;
        Mail::raw(
            "Hola {$u->name}:\n\n{$quien->name} te invitó a Aycha. Entra a «Olvidé mi contraseña», elige «Ya tengo un código» "
            ."y usa el código {$codigo} con tu correo {$u->email} para crear tu contraseña.\n"
            ."El código vence en {$horas} horas. Si no esperabas esta invitación, ignora este correo.",
            fn ($m) => $m->to($u->email)->subject('Invitación a Aycha')
        );
        Bitacora::registrar('USER_INVITED', ['user' => $quien, 'entity' => 'users', 'entity_id' => $u->id, 'detail' => "Invitó a {$u->email}"]);
    }

    /** @return Collection<int, Role> */
    private static function rolesValidos(array $ids)
    {
        $ids = array_values(array_unique($ids));
        $roles = Role::whereIn('id', $ids)->where('status', 'ACTIVE')->get();
        if ($roles->count() !== count($ids) || $roles->isEmpty()) {
            RuleError::fail('RN-SEG-12', 'Elige al menos un rol activo de la empresa.');
        }
        if ($roles->contains(fn ($r) => in_array($r->code, self::NO_ASIGNABLES, true))) {
            RuleError::fail('RN-SEG-12', 'Ese rol es de la plataforma y no se asigna a usuarios de la empresa.');
        }

        return $roles->sortBy('code')->values();
    }

    /**
     * RN-SEG-13: un rol de alcance asignado exige al menos un local o una marca; uno de alcance total
     * ve todo, así que se descartan las marcas y locales que vinieran.
     */
    private static function alcanceDelRol($roles, array $d): array
    {
        $rol = $roles->first();
        if ($rol->scope_mode !== 'ASSIGNED') {
            return ['brand_ids' => [], 'establishment_ids' => []] + $d;
        }
        if (empty($d['brand_ids']) && empty($d['establishment_ids'])) {
            RuleError::fail('RN-SEG-13', "El rol {$rol->name} es de alcance asignado: elige al menos un local o una marca.");
        }

        return $d;
    }

    private static function trabajadorLibre(?string $employeeId, ?string $salvo = null): void
    {
        if (! $employeeId) {
            return;
        }
        if (! DB::table('employees')->where('id', $employeeId)->exists()) {
            RuleError::fail('RN-SEG-01', 'El trabajador no existe.');
        }
        if (User::where('employee_id', $employeeId)->when($salvo, fn ($q) => $q->where('id', '<>', $salvo))->exists()) {
            RuleError::fail('RN-SEG-01', 'Ese trabajador ya está vinculado a otro usuario.');
        }
    }

    /** RN-SEG-15: si es el único ADMIN_SISTEMA activo, no se le quita el rol, no se bloquea ni se desactiva. */
    private static function noEsElUltimoAdmin(User $u, string $accion): void
    {
        $admin = Role::where('code', self::ADMIN)->value('id');
        if (! $admin || ! DB::table('user_roles')->where('user_id', $u->id)->where('role_id', $admin)->exists() || $u->status !== 'ACTIVE') {
            return;
        }
        $otros = DB::table('user_roles as ur')->join('users as x', 'x.id', '=', 'ur.user_id')
            ->where('ur.role_id', $admin)->where('x.status', 'ACTIVE')->where('x.id', '<>', $u->id)->count();
        if ($otros === 0) {
            RuleError::fail('RN-SEG-15', "{$u->name} es el único administrador del sistema activo: no se puede {$accion}. Asigna el rol a otra persona primero.");
        }
    }

    private static function guardarRolesYAlcance(User $u, $roles, array $brands, array $sites): void
    {
        DB::table('user_roles')->where('user_id', $u->id)->delete();
        foreach ($roles as $r) {
            DB::table('user_roles')->insert(['user_id' => $u->id, 'role_id' => $r->id]);
        }
        DB::table('user_scopes')->where('user_id', $u->id)->delete();
        foreach (array_unique($brands) as $b) {
            DB::table('user_scopes')->insert(['user_id' => $u->id, 'brand_id' => $b]);
        }
        foreach (array_unique($sites) as $s) {
            DB::table('user_scopes')->insert(['user_id' => $u->id, 'establishment_id' => $s]);
        }
    }

    private static function cerrarSesionesDe(User $u, ?string $tokenId = null, ?string $salvo = null, string $motivo = 'Sesión cerrada'): int
    {
        return Sesiones::cerrando('REVOKED', $motivo, fn () => $u->tokens()->when($tokenId, fn ($q) => $q->where('id', $tokenId))->when($salvo, fn ($q) => $q->where('id', '<>', $salvo))->delete());
    }

    /** El rol Gerente lo tiene todo: solo otra persona de la gerencia lo da o lo quita. */
    private static function soloLaGerencia(User $quien, string $accion): void
    {
        if (! in_array(self::GERENTE, self::codigosDeRoles($quien), true)) {
            RuleError::fail('RN-SEG-16', "Solo la gerencia puede {$accion}.");
        }
    }

    private static function codigosDeRoles(User $u): array
    {
        return DB::table('user_roles as ur')->join('roles as r', 'r.id', '=', 'ur.role_id')->where('ur.user_id', $u->id)->orderBy('r.code')->pluck('r.code')->all();
    }

    private static function alcance(User $u, string $columna): array
    {
        return DB::table('user_scopes')->where('user_id', $u->id)->whereNotNull($columna)->pluck($columna)->all();
    }

    /** Días sin ingresar que cuentan como «sin uso» (KPI-SEG-03). */
    public static function diasSinUso(): int
    {
        return (int) (Params::get('seg_inactive_user_days') ?? 60);
    }
}
