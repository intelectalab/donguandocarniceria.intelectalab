<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Modulos\Ops\Services\Accesos;
use App\Modulos\Seg\Services\Bitacora;
use App\Modulos\Seg\Services\SegundoFactor;
use App\Modulos\Seg\Services\Sesiones;
use App\Support\Events;
use App\Support\Params;
use App\Support\PasswordPolicy;
use App\Support\TenantContext;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;

/**
 * Ingreso con correo y contraseña. La empresa sale del correo (modo general) o del dominio
 * (modo por dominio): TenantContext::forEmail recorre las empresas donde existe ese correo.
 * Bloqueo tras seg_max_failed_logins intentos durante seg_lockout_minutes (RN-SEG-04); el aviso de
 * bloqueo solo se muestra con la contraseña correcta (RN-SEG-19). Cada intento queda en la bitácora
 * de accesos; la sesión es el token, con su IP y dispositivo, su vencimiento y el máximo por usuario.
 * Segundo factor (SEG-02, SEG-03): con él activo, la contraseña correcta no entrega la sesión sino un «desafío» para
 * escribir el código (o activarlo, si es obligatorio para su rol). Ver Seg\Services\SegundoFactor.
 * Pendiente: el ingreso de la app móvil con dispositivo aprobado.
 */
class AuthController extends Controller
{
    private const CREDENCIALES = 'El correo o la contraseña no son correctos.';

    public function login(Request $request)
    {
        $data = $request->validate([
            'email' => ['required', 'email'],
            'password' => ['required', 'string'],
            'remember' => ['sometimes', 'boolean'],
        ]);

        // Si ninguna empresa lo deja entrar, se responde el motivo más útil (bloqueo, inactivo) o el genérico.
        $motivo = self::CREDENCIALES;
        $user = TenantContext::forEmail($data['email'], function () use ($data, &$motivo) {
            $user = User::whereRaw('lower(email) = ?', [strtolower(trim($data['email']))])->first();
            if (! $user) {
                return null;
            }
            // El bloqueo por intentos se levanta solo al vencer el plazo (RN-SEG-04).
            if ($user->status === 'LOCKED' && $user->locked_until && $user->locked_until->isPast()) {
                $user->forceFill(['status' => 'ACTIVE', 'locked_until' => null, 'failed_logins' => 0, 'lock_reason' => null])->save();
            }
            // OPS-06: el usuario técnico del soporte no ingresa con contraseña, solo desde la consola con un acceso aprobado.
            if ($user->user_type === Accesos::TIPO_USUARIO) {
                return null;
            }
            $correcta = Hash::check($data['password'], $user->password);
            if ($user->status === 'LOCKED' || ($user->locked_until && $user->locked_until->isFuture())) {
                // RN-SEG-19: el bloqueo solo se dice a quien sabe la contraseña; a los demás, el mensaje genérico,
                // para no revelar que el correo existe. Bloqueada, ni la contraseña correcta entra (RN-SEG-04).
                if ($correcta) {
                    $motivo = $user->locked_until
                        ? 'Tu cuenta está bloqueada por intentos fallidos hasta las '.$user->locked_until->format('H:i').'.'
                        : 'Tu cuenta está bloqueada. Pide el desbloqueo al administrador.';
                }
                Bitacora::registrar('LOGIN_BLOCKED', ['user' => $user, 'email' => $data['email'], 'details' => ['password_ok' => $correcta]], denegado: true);

                return null;
            }
            if (! $correcta) {
                self::registrarFallo($user);

                return null;
            }
            if ($user->status !== 'ACTIVE') {
                $motivo = $user->status === 'INVITED'
                    ? 'Tu usuario aún no tiene contraseña: usa el código de tu invitación en «Olvidé mi contraseña».'
                    : 'Tu usuario no está activo. Pide al administrador que lo revise.';
                Bitacora::registrar('LOGIN_FAILED', ['user' => $user, 'email' => $data['email'], 'details' => ['reason' => $user->status]], denegado: true);

                return null;
            }

            return $user;
        });

        if (! $user) {
            throw ValidationException::withMessages(['email' => [$motivo]]);
        }

        $user->forceFill(['failed_logins' => 0, 'locked_until' => null])->save();
        // RN-SEG-02: una contraseña guardada con otro algoritmo (bcrypt) o con otro costo se vuelve a
        // guardar con Argon2id. Es la misma contraseña: no cuenta como cambio ni entra al historial.
        if (Hash::needsRehash($user->password)) {
            $user->forceFill(['password' => Hash::make($data['password'])])->saveQuietly();
        }
        TenantContext::setUser($user->id);
        $recordar = (bool) ($data['remember'] ?? false);

        // SEG-02: con el segundo factor activo, primero el código. SEG-03: si su rol lo exige (y la empresa lo hace
        // obligatorio), primero activarlo. En los dos casos todavía no hay sesión.
        if (SegundoFactor::tiene($user)) {
            return response()->json(['mfa' => 'VERIFY', 'desafio' => SegundoFactor::desafio($user, 'VERIFY', $recordar), 'vence_en_minutos' => SegundoFactor::MINUTOS_DESAFIO]);
        }
        if (SegundoFactor::exigido($user)) {
            return response()->json(['mfa' => 'ENROLL', 'desafio' => SegundoFactor::desafio($user, 'ENROLL', $recordar), 'vence_en_minutos' => SegundoFactor::MINUTOS_DESAFIO]);
        }

        return response()->json($this->emitir($user, $request, $recordar));
    }

    /** SEG-02: el código de la app (o uno de recuperación) del desafío; si es correcto, la sesión. */
    public function verificarSegundoFactor(Request $request)
    {
        $d = $request->validate(['desafio' => ['required', 'string', 'size:64'], 'codigo' => ['required', 'string', 'max:20']]);
        [$user, $desafio, $como] = SegundoFactor::verificarDesafio($d['desafio'], $d['codigo'], fn (User $u) => self::registrarFallo($u));
        TenantContext::setUser($user->id);

        return response()->json($this->emitir($user, $request, (bool) $desafio['recordar'], ['mfa' => $como]));
    }

    /** SEG-03 en el ingreso (obligatorio para su rol): el secreto y el enlace para el QR. */
    public function prepararSegundoFactor(Request $request)
    {
        $d = $request->validate(['desafio' => ['required', 'string', 'size:64']]);
        [$user] = SegundoFactor::abrir($d['desafio'], 'ENROLL');

        return response()->json(SegundoFactor::preparar($user));
    }

    /** SEG-03 en el ingreso: con el primer código queda activo, entrega los códigos de recuperación y la sesión. */
    public function activarSegundoFactor(Request $request)
    {
        $d = $request->validate(['desafio' => ['required', 'string', 'size:64'], 'codigo' => ['required', 'string', 'max:20']]);
        [$user, $desafio] = SegundoFactor::abrir($d['desafio'], 'ENROLL');
        TenantContext::setUser($user->id);
        $r = SegundoFactor::activar($user, $d['codigo']);
        SegundoFactor::cerrarDesafio($d['desafio']);

        return response()->json($this->emitir($user->fresh(), $request, (bool) $desafio['recordar'], ['mfa' => 'ENROLLED']) + ['codigos' => $r['codigos']]);
    }

    /** La sesión: el token con su vencimiento, IP y dispositivo, y el máximo de sesiones por persona. */
    private function emitir(User $user, Request $request, bool $recordar, array $detalle = []): array
    {
        $user->forceFill(['last_login' => now()])->save();
        // RN-SEG-09: la sesión web dura como máximo seg_session_max_hours, también con «Recordarme»
        // (que solo guarda la sesión en el navegador al cerrarlo).
        $token = $user->createToken('web', ['*'], Sesiones::vence('web'));
        // IP y dispositivo de la sesión, para SEG-07, SEG-09 y SEG-15.
        $token->accessToken->forceFill(['ip' => mb_substr((string) $request->ip(), 0, 40), 'device' => Bitacora::dispositivo((string) $request->userAgent())])->save();
        Bitacora::registrar('LOGIN_OK', ['user' => $user, 'details' => ['remember' => $recordar] + $detalle]);
        // RN-SEG-10: con más sesiones que el máximo se cierran las de uso más antiguo.
        Sesiones::limitar($user, $token->accessToken->id);

        return [
            'token' => $token->plainTextToken,
            'expires_at' => $token->accessToken->expires_at,
            'must_change_password' => PasswordPolicy::debeCambiar($user),
        ];
    }

    public function logout(Request $request)
    {
        Bitacora::registrar('LOGOUT', ['user' => $request->user()]);
        Sesiones::cerrando('REVOKED', 'Cierre de sesión', fn () => $request->user()->currentAccessToken()?->delete());

        return response()->noContent();
    }

    /** Un intento fallido (al ingresar o al cambiar la contraseña): al llegar al máximo bloquea y cierra sus sesiones. */
    public static function registrarFallo(User $user): void
    {
        $max = (int) (Params::get('seg_max_failed_logins') ?? 5);
        $fails = $user->failed_logins + 1;
        $patch = ['failed_logins' => $fails, 'last_failed_login_at' => now()];
        Bitacora::registrar('LOGIN_FAILED', ['user' => $user, 'email' => $user->email, 'details' => ['attempt' => $fails]], denegado: true);
        if ($fails >= $max) {
            $minutes = (int) (Params::get('seg_lockout_minutes') ?? 15);
            $patch = ['failed_logins' => 0, 'last_failed_login_at' => now(), 'locked_until' => now()->addMinutes($minutes),
                'lock_reason' => "{$fails} intentos fallidos seguidos", 'status' => $user->status === 'ACTIVE' ? 'LOCKED' : $user->status];
            // RN-SEG-18: bloquear cierra sus sesiones al instante.
            Sesiones::cerrando('REVOKED', 'Cuenta bloqueada por intentos fallidos', fn () => $user->tokens()->delete());
            Bitacora::registrar('LOCKED', ['user' => $user, 'details' => ['until' => $patch['locked_until']->toIso8601String(), 'attempts' => $fails]], denegado: true);
            Events::emit('user.locked', 'users', $user->id, ['until' => $patch['locked_until']->toIso8601String()]);
        }
        $user->forceFill($patch)->save();
    }
}
