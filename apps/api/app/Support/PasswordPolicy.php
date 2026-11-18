<?php

namespace App\Support;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

/**
 * Política de contraseñas de SEG: largo mínimo (seg_password_min_length), mayúscula, minúscula y
 * número, y que no repita las últimas seg_password_history_count. Toda contraseña nueva pasa por aquí.
 */
final class PasswordPolicy
{
    public static function min(): int
    {
        return (int) (Params::get('seg_password_min_length') ?? 10);
    }

    public static function rule(): string
    {
        return 'Mínimo '.self::min().' caracteres, con mayúsculas, minúsculas y un número.';
    }

    /** Devuelve el motivo por el que no sirve, o null si cumple. */
    public static function problem(User $user, string $password): ?string
    {
        if (mb_strlen($password) < self::min() || ! preg_match('/[a-z]/', $password)
            || ! preg_match('/[A-Z]/', $password) || ! preg_match('/\d/', $password)) {
            return 'La contraseña debe tener '.lcfirst(self::rule());
        }
        $n = (int) (Params::get('seg_password_history_count') ?? 5);
        $previas = DB::table('password_history')->where('user_id', $user->id)
            ->orderByDesc('set_at')->limit($n)->pluck('password_hash')->push($user->password);
        foreach ($previas as $hash) {
            // Un hash que no es del algoritmo actual (dato heredado o migrado) no se puede comparar: se ignora.
            if (! $hash || password_get_info($hash)['algoName'] === 'unknown') {
                continue;
            }
            if (Hash::check($password, $hash)) {
                return "No puedes repetir ninguna de tus últimas {$n} contraseñas.";
            }
        }

        return null;
    }

    public static function store(User $user, string $password): void
    {
        DB::table('password_history')->insert(['user_id' => $user->id, 'password_hash' => $user->password, 'set_at' => now()]);
        $user->forceFill([
            'password' => $password,
            'password_changed_at' => now(),
            'must_change_password' => false,
            'failed_logins' => 0,
            'locked_until' => null,
        ])->save();
    }
}
