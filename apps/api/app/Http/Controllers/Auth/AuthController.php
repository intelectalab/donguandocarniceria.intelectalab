<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\Params;
use App\Support\PasswordPolicy;
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
            if ($user->locked_until && $user->locked_until->isFuture()) {
                $motivo = 'Tu cuenta está bloqueada por intentos fallidos hasta las '.$user->locked_until->format('H:i').'.';

                return null;
            }
            if (! Hash::check($data['password'], $user->password)) {
                $this->registerFailure($user);

                return null;
            }
            if ($user->status !== 'ACTIVE') {
                $motivo = 'Tu usuario no está activo. Pide al administrador que lo revise.';

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

        return response()->json([
            'token' => $token->plainTextToken,
            'expires_at' => $token->accessToken->expires_at,
            'must_change_password' => (bool) $user->must_change_password,
        ]);
    }

    public function logout(Request $request)
    {
        $request->user()->currentAccessToken()?->delete();

        return response()->noContent();
    }

    private function registerFailure(User $user): void
    {
        $max = (int) (Params::get('seg_max_failed_logins') ?? 5);
        $fails = $user->failed_logins + 1;
        $patch = ['failed_logins' => $fails, 'last_failed_login_at' => now()];
        if ($fails >= $max) {
            $minutes = (int) (Params::get('seg_lockout_minutes') ?? 15);
            $patch = ['failed_logins' => 0, 'last_failed_login_at' => now(), 'locked_until' => now()->addMinutes($minutes),
                'lock_reason' => "{$fails} intentos fallidos seguidos"];
        }
        $user->forceFill($patch)->save();
    }
}
