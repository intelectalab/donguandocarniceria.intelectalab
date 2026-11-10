<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Modulos\Seg\Services\Bitacora;
use App\Support\Events;
use App\Support\Params;
use App\Support\TenantContext;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;

/**
 * Ingreso con correo y contraseña. La empresa sale del correo (modo general) o del dominio
 * (modo por dominio): TenantContext::forEmail recorre las empresas donde existe ese correo.
 * Bloqueo tras seg_max_failed_logins intentos durante seg_lockout_minutes.
 * Pendiente del módulo SEG: segundo factor (TOTP según la spec o código por correo), registro en
 * access_log y sesiones por dispositivo (user_sessions).
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
            if ($user->status === 'LOCKED' || ($user->locked_until && $user->locked_until->isFuture())) {
                $motivo = $user->locked_until
                    ? 'Tu cuenta está bloqueada por intentos fallidos hasta las '.$user->locked_until->format('H:i').'.'
                    : 'Tu cuenta está bloqueada. Pide el desbloqueo al administrador.';
                Bitacora::registrar('LOGIN_BLOCKED', ['user' => $user, 'email' => $data['email']], denegado: true);

                return null;
            }
            if (! Hash::check($data['password'], $user->password)) {
                $this->registerFailure($user);

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

        $user->forceFill(['failed_logins' => 0, 'locked_until' => null, 'last_login' => now()])->save();
        TenantContext::setUser($user->id);

        $hours = ($data['remember'] ?? false) ? 24 * 30 : 12;
        $token = $user->createToken('web', ['*'], now()->addHours($hours));
        // IP y dispositivo de la sesión, para SEG-07, SEG-09 y SEG-15.
        $token->accessToken->forceFill(['ip' => mb_substr((string) $request->ip(), 0, 40), 'device' => Bitacora::dispositivo((string) $request->userAgent())])->save();
        Bitacora::registrar('LOGIN_OK', ['user' => $user, 'details' => ['remember' => (bool) ($data['remember'] ?? false)]]);

        return response()->json([
            'token' => $token->plainTextToken,
            'expires_at' => $token->accessToken->expires_at,
            'must_change_password' => (bool) $user->must_change_password,
        ]);
    }

    public function logout(Request $request)
    {
        Bitacora::registrar('LOGOUT', ['user' => $request->user()]);
        $request->user()->currentAccessToken()?->delete();

        return response()->noContent();
    }

    private function registerFailure(User $user): void
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
            $user->tokens()->delete();
            Bitacora::registrar('LOCKED', ['user' => $user, 'details' => ['until' => $patch['locked_until']->toIso8601String(), 'attempts' => $fails]], denegado: true);
            Events::emit('user.locked', 'users', $user->id, ['until' => $patch['locked_until']->toIso8601String()]);
        }
        $user->forceFill($patch)->save();
    }
}
