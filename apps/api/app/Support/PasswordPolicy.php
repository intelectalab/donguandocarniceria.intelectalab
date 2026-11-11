<?php

namespace App\Support;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

/**
 * Política de contraseñas de SEG (RN-SEG-02 y 03): largo mínimo (seg_password_min_length),
 * mayúscula, minúscula y número, que no contenga el correo ni el nombre, que no sea una contraseña
 * común y que no repita las últimas seg_password_history_count. Toda contraseña nueva pasa por aquí;
 * SEG-14 usa checks() para probarla sin guardarla.
 */
final class PasswordPolicy
{
    /** Contraseñas comunes que nunca se aceptan (sin distinguir mayúsculas ni tildes). */
    private const COMUNES = [
        '123456', '1234567', '12345678', '123456789', '1234567890', '0123456789', '987654321', '111111', '000000', '123123',
        'password', 'password1', 'password123', 'passw0rd', 'qwerty', 'qwerty123', 'qwertyuiop', 'abc123', 'abcd1234', 'asdfgh',
        'iloveyou', 'admin', 'admin123', 'administrador', 'contrasena', 'contrasena1', 'contrasena123', 'clave', 'clave123',
        'peru', 'peru123', 'peru2026', 'lima', 'lima123', 'lima2026', 'bienvenido', 'bienvenido1', 'teamo', 'teamo123',
        'carniceria', 'carniceria1', 'carniceria2026', 'cambiame', 'cambiame1', 'temporal', 'temporal1', 'aycha', 'aycha123', 'aycha2026',
    ];

    public static function min(): int
    {
        return (int) (Params::get('seg_password_min_length') ?? 10);
    }

    public static function rule(): string
    {
        return 'Mínimo '.self::min().' caracteres, con mayúsculas, minúsculas y un número, sin tu correo ni tu nombre y que no sea una contraseña común.';
    }

    /** Devuelve el motivo por el que no sirve, o null si cumple. */
    public static function problem(User $user, string $password): ?string
    {
        foreach (self::checks($user, $password) as $c) {
            if (! $c['ok']) {
                return $c['mensaje'];
            }
        }

        return null;
    }

    /**
     * Cada condición de la política con si la contraseña la cumple (SEG-14 «Probar la política»).
     *
     * @return array<int, array{clave: string, etiqueta: string, ok: bool, mensaje: string}>
     */
    public static function checks(User $user, string $password): array
    {
        $min = self::min();
        $n = (int) (Params::get('seg_password_history_count') ?? 5);
        $plano = self::plano($password);
        $local = self::plano(explode('@', (string) $user->email)[0]);
        $partes = array_filter(preg_split('/\s+/', self::plano((string) $user->name)) ?: [], fn ($p) => mb_strlen($p) >= 4);
        $personal = $password !== '' && ((mb_strlen($local) >= 4 && str_contains($plano, $local)) || collect($partes)->contains(fn ($p) => str_contains($plano, $p)));

        return [
            ['clave' => 'largo', 'etiqueta' => "Al menos {$min} caracteres", 'ok' => mb_strlen($password) >= $min,
                'mensaje' => "La contraseña debe tener al menos {$min} caracteres."],
            ['clave' => 'letras', 'etiqueta' => 'Mayúsculas, minúsculas y un número', 'ok' => (bool) (preg_match('/[a-z]/', $password) && preg_match('/[A-Z]/', $password) && preg_match('/\d/', $password)),
                'mensaje' => 'La contraseña debe tener mayúsculas, minúsculas y al menos un número.'],
            ['clave' => 'personal', 'etiqueta' => 'No contiene tu correo ni tu nombre', 'ok' => $password !== '' && ! $personal,
                'mensaje' => 'La contraseña no puede contener tu correo ni tu nombre.'],
            ['clave' => 'comun', 'etiqueta' => 'No es una contraseña común', 'ok' => $password !== '' && ! in_array($plano, self::COMUNES, true),
                'mensaje' => 'Esa contraseña es demasiado común: elige otra.'],
            ['clave' => 'historial', 'etiqueta' => "No repite tus últimas {$n} contraseñas", 'ok' => $password !== '' && ! self::repetida($user, $password, $n),
                'mensaje' => "No puedes repetir ninguna de tus últimas {$n} contraseñas."],
        ];
    }

    private static function repetida(User $user, string $password, int $n): bool
    {
        $previas = DB::table('password_history')->where('user_id', $user->id)
            ->orderByDesc('set_at')->limit($n)->pluck('password_hash')->push($user->password);
        foreach ($previas as $hash) {
            // Un hash que no es del algoritmo actual (dato heredado o migrado) no se puede comparar: se ignora.
            if (! $hash || password_get_info($hash)['algoName'] === 'unknown') {
                continue;
            }
            if (Hash::check($password, $hash)) {
                return true;
            }
        }

        return false;
    }

    /** En minúsculas y sin tildes, para comparar. */
    private static function plano(string $texto): string
    {
        return strtr(mb_strtolower($texto), ['á' => 'a', 'é' => 'e', 'í' => 'i', 'ó' => 'o', 'ú' => 'u', 'ü' => 'u', 'ñ' => 'n']);
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
