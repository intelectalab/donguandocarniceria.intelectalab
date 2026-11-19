<?php

namespace App\Modulos\Ops\Services;

use App\Support\RuleError;
use App\Support\Totp;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Illuminate\Validation\ValidationException;

/**
 * OPS-01 y OPS-12: personal de Intelectalab en la consola.
 *  - Alta como invitado con un código de un solo uso; al activarse crea su contraseña y su segundo factor
 *    (RN-OPS-01: sin segundo factor la cuenta no se activa).
 *  - Ingreso con correo, contraseña y código de la app autenticadora; bloqueo al quinto intento fallido;
 *    solo desde las redes permitidas si la lista no está vacía (RN-OPS-16).
 *  - Sesión propia (platform_sessions): vence por inactividad (ops_console_session_minutes) o al tope de horas.
 */
final class UsuariosPlataforma
{
    private const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

    private const INTENTOS = 5;

    private const CREDENCIALES = 'El correo, la contraseña o el código no son correctos.';

    /** Solo para el comando de la primera cuenta y las pruebas: el último código de activación generado. */
    public static ?string $ultimoCodigo = null;

    /* ------------------------------------------------------------------ OPS-12 */

    public static function lista(): array
    {
        return DB::table('platform_users')->orderByRaw("CASE status WHEN 'ACTIVE' THEN 0 WHEN 'INVITED' THEN 1 WHEN 'LOCKED' THEN 2 ELSE 3 END")
            ->orderBy('full_name')
            ->get(['id', 'email', 'full_name', 'role', 'status', 'twofa_enabled_at', 'failed_logins', 'last_login_at', 'disabled_reason', 'created_at'])
            ->map(fn ($u) => (array) $u + [
                'role_name' => Consola::ROLES[$u->role], 'status_name' => Consola::ESTADOS[$u->status],
                'sesiones' => DB::table('platform_sessions')->where('platform_user_id', $u->id)->whereNull('ended_at')->where('expires_at', '>', now())->count(),
            ])->all();
    }

    public static function crear(array $datos, array $quien): array
    {
        Consola::exigir($quien, 'users.manage');
        $email = self::correo($datos['email']);
        if (DB::table('platform_users')->whereRaw('lower(email) = ?', [$email])->exists()) {
            RuleError::fail('RN-OPS-01', 'Ya existe un usuario de plataforma con ese correo.');
        }

        return DB::transaction(function () use ($datos, $email, $quien) {
            $id = DB::table('platform_users')->insertGetId([
                'email' => $email, 'full_name' => trim($datos['full_name']), 'role' => $datos['role'], 'status' => 'INVITED',
                'created_by' => $quien['id'], 'created_at' => now(), 'updated_at' => now(),
            ], 'id');
            $u = self::buscar($id);
            Consola::bitacora('PLATFORM_USER_CREATED', $quien, ['entity' => 'platform_users', 'entity_id' => $id, 'reason' => 'Alta de usuario de plataforma',
                'detail' => ['email' => $email, 'role' => $datos['role']]]);
            self::invitar($u, $quien);

            return $u;
        });
    }

    /**
     * Primera cuenta de la consola, desde el servidor (comando ops:crear-admin). Solo si no hay ningún administrador
     * de plataforma activo: después, las cuentas se crean en OPS-12. Devuelve el código de activación.
     */
    public static function primeraCuenta(string $email, string $nombre, bool $agregarDominio = false): string
    {
        if (DB::table('platform_users')->where('role', 'PLATFORM_ADMIN')->where('status', 'ACTIVE')->exists()) {
            RuleError::fail('RN-OPS-10', 'Ya hay un administrador de plataforma activo: crea las demás cuentas en Usuarios de plataforma.');
        }
        $sistema = ['id' => null, 'full_name' => 'Servidor (ops:crear-admin)', 'role' => 'PLATFORM_ADMIN'];
        // Sin administrador no hay quien cambie los dominios en la consola: desde el servidor se agrega el de esta cuenta.
        $dominio = mb_strtolower(mb_substr(strrchr(trim($email), '@') ?: '', 1));
        $dominios = Consola::dominios();
        if ($agregarDominio && $dominio !== '' && $dominios && ! in_array($dominio, $dominios, true)) {
            $nuevo = [...$dominios, $dominio];
            DB::table('platform_parameters')->where('key', 'ops_platform_email_domains')->update(['value' => json_encode($nuevo), 'updated_at' => now()]);
            DB::table('platform_parameter_history')->insert(['key' => 'ops_platform_email_domains', 'old_value' => json_encode($dominios), 'new_value' => json_encode($nuevo),
                'reason' => "Dominio de la primera cuenta de la consola ({$dominio})", 'changed_by_name' => $sistema['full_name'], 'changed_at' => now()]);
            Consola::bitacora('PARAMETER_CHANGED', $sistema, ['entity' => 'platform_parameters', 'entity_id' => 'ops_platform_email_domains',
                'reason' => "Dominio de la primera cuenta de la consola ({$dominio})", 'detail' => ['antes' => $dominios, 'despues' => $nuevo]]);
        }
        $email = self::correo($email);

        return DB::transaction(function () use ($email, $nombre, $sistema) {
            $existe = DB::table('platform_users')->whereRaw('lower(email) = ?', [$email])->first();
            if ($existe && $existe->status !== 'INVITED') {
                RuleError::fail('RN-OPS-01', 'Ese correo ya tiene una cuenta '.mb_strtolower(Consola::ESTADOS[$existe->status]).'.');
            }
            $id = $existe->id ?? DB::table('platform_users')->insertGetId(['email' => $email, 'full_name' => trim($nombre), 'role' => 'PLATFORM_ADMIN',
                'status' => 'INVITED', 'created_at' => now(), 'updated_at' => now()], 'id');
            DB::table('platform_users')->where('id', $id)->update(['role' => 'PLATFORM_ADMIN', 'updated_at' => now()]);
            Consola::bitacora('PLATFORM_USER_CREATED', $sistema, ['entity' => 'platform_users', 'entity_id' => $id, 'reason' => 'Primera cuenta de la consola', 'detail' => ['email' => $email]]);
            self::invitar(self::buscar($id), $sistema);

            return self::$ultimoCodigo;
        });
    }

    public static function editar(string $id, array $datos, array $quien): array
    {
        Consola::exigir($quien, 'users.manage');
        $u = self::buscar($id);
        if ($u['id'] === $quien['id'] && $datos['role'] !== $u['role']) {
            RuleError::fail('RN-OPS-10', 'No puedes cambiar tu propio rol.');
        }
        if ($u['role'] === 'PLATFORM_ADMIN' && $datos['role'] !== 'PLATFORM_ADMIN') {
            self::noDejarSinAdministrador($u['id']);
        }
        DB::table('platform_users')->where('id', $id)->update(['full_name' => trim($datos['full_name']), 'role' => $datos['role'], 'updated_at' => now()]);
        Consola::bitacora('PLATFORM_USER_UPDATED', $quien, ['entity' => 'platform_users', 'entity_id' => $id, 'reason' => 'Edición de nombre o rol',
            'detail' => ['antes' => ['full_name' => $u['full_name'], 'role' => $u['role']], 'despues' => ['full_name' => trim($datos['full_name']), 'role' => $datos['role']]]]);

        return self::buscar($id);
    }

    /** Bloquear, dar de baja o reactivar, siempre con motivo. Bloquear o dar de baja cierra sus sesiones. */
    public static function cambiarEstado(string $id, string $estado, string $motivo, array $quien): array
    {
        Consola::exigir($quien, 'users.manage');
        $u = self::buscar($id);
        if ($u['id'] === $quien['id']) {
            RuleError::fail('RN-OPS-10', 'No puedes bloquearte, darte de baja ni reactivarte a ti mismo.');
        }
        if ($estado === 'ACTIVE' && ! $u['twofa_enabled_at']) {
            RuleError::fail('RN-OPS-01', 'Sin segundo factor la cuenta no se activa: reenvía la invitación para que lo configure.');
        }
        if ($estado !== 'ACTIVE' && $u['role'] === 'PLATFORM_ADMIN' && $u['status'] === 'ACTIVE') {
            self::noDejarSinAdministrador($u['id']);
        }
        if ($u['status'] === $estado) {
            RuleError::fail('RN-OPS-01', 'El usuario ya está '.mb_strtolower(Consola::ESTADOS[$estado]).'.');
        }
        DB::transaction(function () use ($u, $estado, $motivo, $quien) {
            DB::table('platform_users')->where('id', $u['id'])->update([
                'status' => $estado, 'disabled_reason' => $estado === 'ACTIVE' ? null : $motivo, 'failed_logins' => 0, 'locked_until' => null, 'updated_at' => now(),
            ]);
            if ($estado !== 'ACTIVE') {
                self::cerrarSesiones($u['id'], 'Cuenta '.mb_strtolower(Consola::ESTADOS[$estado]));
            }
            Consola::bitacora('PLATFORM_USER_'.$estado, $quien, ['entity' => 'platform_users', 'entity_id' => $u['id'], 'reason' => $motivo]);
        });

        return self::buscar($id);
    }

    /** Perdió el celular: se borra su segundo factor, vuelve a invitado y recibe un código nuevo para configurarlo. */
    public static function reiniciarSegundoFactor(string $id, string $motivo, array $quien): array
    {
        Consola::exigir($quien, 'users.manage');
        $u = self::buscar($id);
        if ($u['id'] === $quien['id']) {
            RuleError::fail('RN-OPS-10', 'No puedes reiniciar tu propio segundo factor: pídeselo a otro administrador.');
        }
        if ($u['status'] === 'DISABLED') {
            RuleError::fail('RN-OPS-01', 'El usuario está de baja: reactívalo antes.');
        }
        if ($u['role'] === 'PLATFORM_ADMIN' && $u['status'] === 'ACTIVE') {
            self::noDejarSinAdministrador($u['id']);
        }
        DB::transaction(function () use ($u, $motivo, $quien) {
            DB::table('platform_users')->where('id', $u['id'])->update([
                'status' => 'INVITED', 'totp_secret' => null, 'twofa_enabled_at' => null, 'totp_last_step' => null, 'password' => null,
                'failed_logins' => 0, 'locked_until' => null, 'updated_at' => now(),
            ]);
            self::cerrarSesiones($u['id'], 'Segundo factor reiniciado');
            Consola::bitacora('PLATFORM_USER_2FA_RESET', $quien, ['entity' => 'platform_users', 'entity_id' => $u['id'], 'reason' => $motivo]);
            self::invitar(self::buscar($u['id']), $quien);
        });

        return self::buscar($id);
    }

    public static function reenviarInvitacion(string $id, array $quien): void
    {
        Consola::exigir($quien, 'users.manage');
        $u = self::buscar($id);
        if ($u['status'] !== 'INVITED') {
            RuleError::fail('RN-OPS-01', 'Solo se reenvía la invitación a un usuario invitado.');
        }
        DB::transaction(fn () => self::invitar($u, $quien));
    }

    /* ------------------------------------------------------------------ activación */

    /**
     * Paso 1: código de la invitación y contraseña nueva. Deja preparado un secreto para la app autenticadora
     * (todavía no activa nada) y devuelve el enlace para el QR.
     */
    public static function prepararActivacion(string $email, string $codigo, string $password): array
    {
        $u = self::conInvitacion($email, $codigo);
        self::validarClave($u, $password);
        $secreto = Totp::secreto();
        DB::table('platform_users')->where('id', $u['id'])->update(['totp_secret' => Crypt::encryptString($secreto), 'updated_at' => now()]);

        return ['secreto' => $secreto, 'enlace' => Totp::enlace($secreto, $u['email']), 'nombre' => $u['full_name']];
    }

    /** Paso 2: con el primer código de la app, guarda la contraseña y activa la cuenta (RN-OPS-01). */
    public static function activar(string $email, string $codigo, string $password, string $totp): void
    {
        $u = self::conInvitacion($email, $codigo);
        self::validarClave($u, $password);
        $fila = DB::table('platform_users')->where('id', $u['id'])->first();
        if (! $fila->totp_secret) {
            throw ValidationException::withMessages(['totp' => ['Primero escanea el código QR con tu app autenticadora.']]);
        }
        $paso = Totp::verificar(Crypt::decryptString($fila->totp_secret), $totp);
        if ($paso === null) {
            throw ValidationException::withMessages(['totp' => ['El código de la app no es correcto o ya venció. Escribe el que se ve ahora.']]);
        }
        DB::transaction(function () use ($u, $password, $paso) {
            DB::table('platform_users')->where('id', $u['id'])->update([
                'password' => Hash::make($password), 'twofa_enabled_at' => now(), 'totp_last_step' => $paso, 'status' => 'ACTIVE',
                'failed_logins' => 0, 'locked_until' => null, 'disabled_reason' => null, 'updated_at' => now(),
            ]);
            DB::table('platform_user_tokens')->where('platform_user_id', $u['id'])->whereNull('used_at')->whereNull('voided_at')->update(['used_at' => now()]);
            Consola::bitacora('PLATFORM_USER_ACTIVATED', self::buscar($u['id']), ['entity' => 'platform_users', 'entity_id' => $u['id'],
                'reason' => 'Contraseña y segundo factor configurados']);
        });
    }

    /* ------------------------------------------------------------------ OPS-01 ingreso y sesión */

    /** @return array{token: string, expires_at: string, usuario: array} */
    public static function ingresar(string $email, string $password, string $totp, ?string $ip, ?string $agente): array
    {
        $fila = DB::table('platform_users')->whereRaw('lower(email) = ?', [mb_strtolower(trim($email))])->first();
        $falla = fn (string $msg = self::CREDENCIALES) => throw ValidationException::withMessages(['email' => [$msg]]);
        if (! $fila) {
            Consola::bitacora('CONSOLE_LOGIN_FAILED', null, ['actor' => 'Desconocido', 'reason' => 'Correo no registrado', 'detail' => ['email' => mb_substr($email, 0, 120)]]);
            Hash::make($password);   // mismo tiempo de respuesta que con un correo registrado
            $falla();
        }
        $u = (array) $fila;
        $claveOk = $u['password'] && Hash::check($password, $u['password']);
        // El estado de la cuenta solo se dice a quien sabe la contraseña.
        if ($claveOk && $u['status'] === 'INVITED') {
            $falla('Tu cuenta aún no está activa: usa el código de tu invitación en «Activar mi cuenta».');
        }
        if ($u['status'] === 'LOCKED') {
            Consola::bitacora('CONSOLE_LOGIN_BLOCKED', $u, ['reason' => 'Cuenta bloqueada', 'entity' => 'platform_users', 'entity_id' => $u['id']]);
            $falla($claveOk ? 'Tu cuenta está bloqueada. Un administrador de plataforma la reactiva en Usuarios de plataforma.' : self::CREDENCIALES);
        }
        if ($u['status'] === 'DISABLED') {
            $falla($claveOk ? 'Tu cuenta está dada de baja.' : self::CREDENCIALES);
        }
        if ($u['status'] !== 'ACTIVE' || ! $claveOk) {
            self::fallo($u, 'Contraseña incorrecta');
            $falla();
        }
        $paso = Totp::verificar(Crypt::decryptString($u['totp_secret']), $totp, $u['totp_last_step'] !== null ? (int) $u['totp_last_step'] : null);
        if ($paso === null) {
            self::fallo($u, 'Código de segundo factor incorrecto o ya usado');
            $falla();
        }
        $lista = (array) Consola::param('ops_console_ip_allowlist', []);
        if (! Consola::ipPermitida($ip, $lista)) {
            Consola::bitacora('CONSOLE_LOGIN_BLOCKED', $u, ['reason' => "IP {$ip} fuera de la lista permitida", 'detail' => ['ip' => $ip, 'lista' => $lista]]);
            RuleError::fail('RN-OPS-16', 'La consola no acepta conexiones desde tu red. Pide que la agreguen a las redes permitidas.');
        }

        $token = 'gcc_'.bin2hex(random_bytes(32));
        $vence = now()->addHours((int) Consola::param('ops_console_session_max_hours', 12));
        DB::transaction(function () use ($u, $paso, $token, $vence, $ip, $agente) {
            DB::table('platform_users')->where('id', $u['id'])->update(['failed_logins' => 0, 'last_login_at' => now(), 'totp_last_step' => $paso,
                'password' => Hash::needsRehash($u['password']) ? Hash::make($password) : $u['password'], 'updated_at' => now()]);
            DB::table('platform_sessions')->insert(['platform_user_id' => $u['id'], 'token_hash' => hash('sha256', $token), 'ip' => $ip ? mb_substr($ip, 0, 45) : null,
                'device' => $agente ? mb_substr($agente, 0, 120) : null, 'created_at' => now(), 'last_used_at' => now(), 'expires_at' => $vence]);
            Consola::bitacora('CONSOLE_LOGIN', $u, ['reason' => 'Inicio de sesión en la consola']);
        });

        return ['token' => $token, 'expires_at' => $vence->toIso8601String(), 'usuario' => self::publico(self::buscar($u['id']))];
    }

    /**
     * La sesión del token, o null si no sirve. Cierra la que venció por inactividad o por tiempo (RN-OPS-16)
     * y anota el uso como máximo una vez por minuto.
     */
    public static function sesion(?string $token): ?array
    {
        if (! $token || ! str_starts_with($token, 'gcc_')) {
            return null;
        }
        $s = DB::table('platform_sessions')->where('token_hash', hash('sha256', $token))->whereNull('ended_at')->first();
        if (! $s) {
            return null;
        }
        $minutos = (int) Consola::param('ops_console_session_minutes', 30);
        $fin = match (true) {
            now()->greaterThanOrEqualTo($s->expires_at) => 'Sesión vencida por tiempo',
            now()->diffInMinutes($s->last_used_at, true) >= $minutos => "Inactividad de más de {$minutos} minutos",
            default => null,
        };
        $u = DB::table('platform_users')->where('id', $s->platform_user_id)->first();
        if (! $fin && (! $u || $u->status !== 'ACTIVE')) {
            $fin = 'Cuenta no activa';
        }
        if ($fin) {
            DB::table('platform_sessions')->where('id', $s->id)->update(['ended_at' => now(), 'end_reason' => $fin]);
            Consola::bitacora('CONSOLE_LOGOUT', $u ? (array) $u : null, ['reason' => $fin]);

            return null;
        }
        if (now()->diffInSeconds($s->last_used_at, true) >= 60) {
            DB::table('platform_sessions')->where('id', $s->id)->update(['last_used_at' => now()]);
        }

        return ['sesion_id' => $s->id, 'usuario' => (array) $u];
    }

    public static function salir(string $sesionId, array $usuario): void
    {
        DB::table('platform_sessions')->where('id', $sesionId)->whereNull('ended_at')->update(['ended_at' => now(), 'end_reason' => 'Cierre manual']);
        Consola::bitacora('CONSOLE_LOGOUT', $usuario, ['reason' => 'Cierre manual']);
    }

    /** Lo que la web puede ver del usuario (nunca la contraseña ni el secreto). */
    public static function publico(array $u): array
    {
        return ['id' => $u['id'], 'email' => $u['email'], 'full_name' => $u['full_name'], 'role' => $u['role'], 'role_name' => Consola::ROLES[$u['role']],
            'status' => $u['status'], 'puede' => collect(['users.manage', 'tenant.create', 'tenant.status', 'plans.manage', 'params.manage', 'catalogs.import'])->mapWithKeys(fn ($c) => [$c => Consola::puede($u, $c)])->all()];
    }

    /* ------------------------------------------------------------------ internos */

    public static function buscar(string $id): array
    {
        $u = DB::table('platform_users')->where('id', $id)->first();
        if (! $u) {
            abort(response()->json(['message' => 'No encontrado.', 'code' => 'NOT_FOUND'], 404));
        }

        return (array) $u;
    }

    private static function correo(string $email): string
    {
        $email = mb_strtolower(trim($email));
        $dominios = Consola::dominios();
        if ($dominios && ! in_array(mb_substr(strrchr($email, '@') ?: '', 1), $dominios, true)) {
            RuleError::fail('RN-OPS-01', 'El correo debe ser de '.(count($dominios) === 1 ? 'el dominio ' : 'uno de estos dominios: ').implode(', ', $dominios)
                .'. Los dominios permitidos se cambian en Parámetros de plataforma.');
        }

        return $email;
    }

    private static function noDejarSinAdministrador(string $exceptoId): void
    {
        $otros = DB::table('platform_users')->where('role', 'PLATFORM_ADMIN')->where('status', 'ACTIVE')->where('id', '<>', $exceptoId)->count();
        if ($otros === 0) {
            RuleError::fail('RN-OPS-10', 'Es el único administrador de plataforma activo: primero activa a otro.');
        }
    }

    private static function cerrarSesiones(string $usuarioId, string $motivo): void
    {
        DB::table('platform_sessions')->where('platform_user_id', $usuarioId)->whereNull('ended_at')->update(['ended_at' => now(), 'end_reason' => $motivo]);
    }

    private static function fallo(array $u, string $motivo): void
    {
        $n = $u['failed_logins'] + 1;
        if ($n >= self::INTENTOS) {
            DB::table('platform_users')->where('id', $u['id'])->update(['failed_logins' => 0, 'status' => 'LOCKED', 'disabled_reason' => "{$n} intentos fallidos seguidos", 'updated_at' => now()]);
            self::cerrarSesiones($u['id'], 'Cuenta bloqueada por intentos fallidos');
            Consola::bitacora('CONSOLE_LOCKED', $u, ['reason' => "{$n} intentos fallidos seguidos", 'entity' => 'platform_users', 'entity_id' => $u['id']]);

            return;
        }
        DB::table('platform_users')->where('id', $u['id'])->update(['failed_logins' => $n, 'updated_at' => now()]);
        Consola::bitacora('CONSOLE_LOGIN_FAILED', $u, ['reason' => $motivo, 'detail' => ['intento' => $n]]);
    }

    /** Usuario invitado con un código vigente que coincide. */
    private static function conInvitacion(string $email, string $codigo): array
    {
        $fila = DB::table('platform_users')->whereRaw('lower(email) = ?', [mb_strtolower(trim($email))])->where('status', 'INVITED')->first();
        $token = $fila ? DB::table('platform_user_tokens')->where('platform_user_id', $fila->id)->whereNull('used_at')->whereNull('voided_at')
            ->where('expires_at', '>', now())->latest('created_at')->first() : null;
        if (! $token || ! Hash::check(strtoupper(trim($codigo)), $token->token_hash)) {
            throw ValidationException::withMessages(['codigo' => ['El código no es correcto o ya venció. Pide que te reenvíen la invitación.']]);
        }

        return (array) $fila;
    }

    /** Contraseña de la consola: 12 caracteres o más, con mayúscula, minúscula y número, sin el correo ni el nombre. */
    private static function validarClave(array $u, string $password): void
    {
        $base = mb_strtolower(strtok($u['email'], '@'));
        $nombre = collect(preg_split('/\s+/', mb_strtolower($u['full_name'])))->filter(fn ($p) => mb_strlen($p) >= 4);
        $problema = match (true) {
            mb_strlen($password) < 12 => 'Usa al menos 12 caracteres.',
            ! preg_match('/[A-ZÁÉÍÓÚÑ]/u', $password) || ! preg_match('/[a-záéíóúñ]/u', $password) || ! preg_match('/\d/', $password) => 'Combina mayúsculas, minúsculas y al menos un número.',
            str_contains(mb_strtolower($password), $base) || $nombre->contains(fn ($p) => str_contains(mb_strtolower($password), $p)) => 'No uses tu correo ni tu nombre en la contraseña.',
            default => null,
        };
        if ($problema) {
            throw ValidationException::withMessages(['password' => [$problema]]);
        }
    }

    private static function invitar(array $u, array $quien): void
    {
        $codigo = '';
        for ($i = 0; $i < 8; $i++) {
            $codigo .= self::ALFABETO[random_int(0, strlen(self::ALFABETO) - 1)];
        }
        $horas = (int) Consola::param('ops_platform_user_invite_hours', 48);
        DB::table('platform_user_tokens')->where('platform_user_id', $u['id'])->whereNull('used_at')->whereNull('voided_at')->update(['voided_at' => now()]);
        DB::table('platform_user_tokens')->insert(['platform_user_id' => $u['id'], 'token_hash' => Hash::make($codigo), 'expires_at' => now()->addHours($horas), 'created_at' => now()]);
        Mail::raw(
            "Hola {$u['full_name']}:\n\n{$quien['full_name']} te dio acceso a la consola de GestionCarnica como ".Consola::ROLES[$u['role']].".\n"
            ."Entra a /consola/activar con tu correo {$u['email']} y el código {$codigo} para crear tu contraseña y configurar tu app autenticadora "
            ."(Google Authenticator, Microsoft Authenticator u otra).\nEl código vence en {$horas} horas. Si no esperabas este correo, ignóralo.",
            fn ($m) => $m->to($u['email'])->subject('Acceso a la consola de GestionCarnica')
        );
        Consola::bitacora('PLATFORM_USER_INVITED', $quien, ['entity' => 'platform_users', 'entity_id' => $u['id'], 'reason' => 'Código de activación enviado']);
        self::$ultimoCodigo = $codigo;
    }
}
