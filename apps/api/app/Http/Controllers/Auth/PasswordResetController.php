<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Modulos\Seg\Services\Bitacora;
use App\Modulos\Seg\Services\Sesiones;
use App\Support\Params;
use App\Support\PasswordPolicy;
use App\Support\TenantContext;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Illuminate\Validation\ValidationException;

/**
 * Recuperar contraseña con un código de 6 caracteres enviado al correo (como en erp-saas).
 * El código vale seg_reset_token_minutes y 5 intentos; se guarda solo su hash en
 * password_reset_tokens. En local el correo va al log (storage/logs/laravel.log).
 */
class PasswordResetController extends Controller
{
    private const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

    private const MAX_INTENTOS = 5;

    private const RESPUESTA = 'Si el correo existe, enviamos un código de 6 caracteres.';

    public function forgot(Request $request)
    {
        $data = $request->validate(['email' => ['required', 'email']]);

        // Misma respuesta exista o no la cuenta: no revela qué correos están registrados.
        // Devuelve null para seguir con las demás empresas donde exista el correo.
        TenantContext::forEmail($data['email'], fn () => $this->enviarCodigo($data['email'], $request));

        return response()->json(['message' => self::RESPUESTA]);
    }

    private function enviarCodigo(string $email, Request $request): null
    {
        $user = User::whereRaw('lower(email) = ?', [strtolower(trim($email))])->first();
        if ($user && in_array($user->status, ['ACTIVE', 'INVITED'], true)) {
            Bitacora::registrar('PASSWORD_RESET_REQUESTED', ['user' => $user, 'email' => $email]);
            $minutos = (int) (Params::get('seg_reset_token_minutes') ?? 30);
            $codigo = '';
            for ($i = 0; $i < 6; $i++) {
                $codigo .= self::ALFABETO[random_int(0, strlen(self::ALFABETO) - 1)];
            }
            DB::transaction(function () use ($user, $codigo, $minutos, $request) {
                DB::table('password_reset_tokens')->where('user_id', $user->id)->whereNull('used_at')->whereNull('voided_at')
                    ->update(['voided_at' => 'REEMPLAZADO', 'updated_at' => now()]);
                DB::table('password_reset_tokens')->insert([
                    'user_id' => $user->id, 'token_hash' => Hash::make($codigo), 'kind' => 'RESET_CODE',
                    'expires_at' => now()->addMinutes($minutos), 'requested_at' => now(), 'requested_ip' => $request->ip(),
                ]);
            });
            Mail::raw(
                "Hola {$user->name}:\n\nTu código para crear una nueva contraseña es {$codigo}.\n"
                ."Vence en {$minutos} minutos. Si no lo pediste, ignora este correo.",
                fn ($m) => $m->to($user->email)->subject('Código para recuperar tu contraseña')
            );
        }

        return null;
    }

    public function reset(Request $request)
    {
        $data = $request->validate([
            'email' => ['required', 'email'],
            'code' => ['required', 'string', 'size:6'],
            'password' => ['required', 'string'],
        ]);
        $fail = fn (string $campo, string $msg) => throw ValidationException::withMessages([$campo => [$msg]]);

        // La empresa cuyo código coincide (el correo puede existir en más de una).
        $motivo = 'El código venció o no existe. Pide uno nuevo.';
        $hallado = TenantContext::forEmail($data['email'], function () use ($data, &$motivo) {
            $user = User::whereRaw('lower(email) = ?', [strtolower(trim($data['email']))])->first();
            $token = $user ? DB::table('password_reset_tokens')->where('user_id', $user->id)
                ->whereNull('used_at')->whereNull('voided_at')->where('expires_at', '>', now())
                ->latest('requested_at')->first() : null;
            if (! $token) {
                return null;
            }
            if (! Hash::check(strtoupper(trim($data['code'])), $token->token_hash)) {
                $motivo = 'El código no es correcto.';
                if (cache()->increment("reset-intentos:{$token->id}") >= self::MAX_INTENTOS) {
                    DB::table('password_reset_tokens')->where('id', $token->id)->update(['voided_at' => 'INTENTOS', 'updated_at' => now()]);
                    $motivo = 'Demasiados intentos. Pide un código nuevo.';
                }

                return null;
            }

            return [$user, $token];
        });

        if (! $hallado) {
            $fail('code', $motivo);
        }
        [$user, $token] = $hallado;
        if ($problema = PasswordPolicy::problem($user, $data['password'])) {
            $fail('password', $problema);
        }

        DB::transaction(function () use ($user, $token, $data) {
            PasswordPolicy::store($user, $data['password']);
            // Un usuario invitado (SEG-08) queda activo al fijar su primera contraseña.
            if ($user->status === 'INVITED') {
                $user->forceFill(['status' => 'ACTIVE'])->save();
            }
            DB::table('password_reset_tokens')->where('id', $token->id)->update(['used_at' => now(), 'updated_at' => now()]);
            // Con la contraseña nueva se cierran las sesiones abiertas en otros equipos.
            Sesiones::cerrando('REVOKED', 'Contraseña restablecida', fn () => $user->tokens()->delete());
            Bitacora::registrar('PASSWORD_RESET', ['user' => $user, 'details' => ['kind' => $token->kind]]);
        });

        return response()->json(['message' => 'Contraseña actualizada. Ya puedes iniciar sesión.']);
    }
}
