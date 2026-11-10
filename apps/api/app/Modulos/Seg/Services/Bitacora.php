<?php

namespace App\Modulos\Seg\Services;

use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Bitácora de accesos (access_log, AUD-03): cada intento de ingreso, bloqueo, cierre de sesión y
 * acción de seguridad queda con IP y dispositivo (RN-SEG-19). La tabla es de solo inserción.
 *
 *   Bitacora::registrar('LOGIN_FAILED', ['user' => $user, 'details' => ['attempt' => 3]], denegado: true);
 *
 * Necesita la empresa en el contexto (RLS): un intento con un correo que no existe en ninguna
 * empresa no se puede anotar en la bitácora de nadie.
 */
final class Bitacora
{
    /** Eventos que se muestran con nombre en las pantallas. */
    public const EVENTOS = [
        'LOGIN_OK' => 'Ingreso', 'LOGIN_FAILED' => 'Ingreso fallido', 'LOGIN_BLOCKED' => 'Ingreso con cuenta bloqueada',
        'LOCKED' => 'Cuenta bloqueada', 'UNLOCKED' => 'Cuenta desbloqueada', 'LOGOUT' => 'Cierre de sesión',
        'SESSION_REVOKED' => 'Sesión cerrada por otro', 'USER_INVITED' => 'Usuario invitado', 'USER_UPDATED' => 'Rol o alcance cambiado',
        'USER_DEACTIVATED' => 'Usuario desactivado', 'USER_REACTIVATED' => 'Usuario reactivado', 'MFA_RESET' => 'Segundo factor reiniciado',
        'MFA_OK' => 'Segundo factor correcto', 'MFA_FAILED' => 'Segundo factor fallido', 'PASSWORD_RESET' => 'Contraseña restablecida',
        'PASSWORD_RESET_REQUESTED' => 'Pidió restablecer contraseña', 'PASSWORD_CHANGED' => 'Contraseña cambiada',
        'PERMISSION_DENIED' => 'Permiso denegado', 'MODULE_DISABLED' => 'Módulo apagado', 'DEVICE_PENDING' => 'Celular por aprobar',
        'DEVICE_APPROVED' => 'Celular aprobado', 'DEVICE_REVOKED' => 'Celular revocado', 'LOGIN_DENIED_DEVICE' => 'Celular no aprobado',
    ];

    /**
     * @param  array{user?: ?User, email?: ?string, details?: ?array, detail?: ?string, entity?: ?string, entity_id?: ?string, device_id?: ?string}  $o
     */
    public static function registrar(string $evento, array $o = [], bool $denegado = false): void
    {
        $r = request();
        $u = $o['user'] ?? null;
        $ua = (string) ($r?->userAgent() ?? '');

        DB::table('access_log')->insert([
            'user_id' => $u?->id,
            'email_attempted' => isset($o['email']) ? mb_substr(mb_strtolower(trim($o['email'])), 0, 80) : null,
            'event' => $evento,
            'module_code' => 'SEG',
            'ip' => mb_substr((string) ($r?->ip() ?: '0.0.0.0'), 0, 40),
            'user_agent' => $ua !== '' ? mb_substr($ua, 0, 80) : null,
            'details' => isset($o['details']) ? json_encode($o['details'], JSON_UNESCAPED_UNICODE) : null,
            'occurred_at' => now(),
            'at' => now(),
            'user_name' => mb_substr((string) ($u?->name ?: 'Desconocido'), 0, 40),
            'role' => $u?->role ? mb_substr((string) $u->role, 0, 80) : null,
            'device' => self::dispositivo($ua),
            'detail' => isset($o['detail']) ? mb_substr((string) $o['detail'], 0, 1000) : null,
            'result' => $denegado ? 'DENIED' : 'OK',
            'device_id' => $o['device_id'] ?? null,
            'entity' => $o['entity'] ?? null,
            'entity_id' => $o['entity_id'] ?? null,
        ]);
    }

    /** Navegador y sistema en pocas palabras («Chrome · Windows»), sin guardar el user agent completo. */
    public static function dispositivo(string $ua): string
    {
        if ($ua === '') {
            return 'Desconocido';
        }
        $nav = match (true) {
            str_contains($ua, 'Edg/') => 'Edge',
            str_contains($ua, 'OPR/') => 'Opera',
            str_contains($ua, 'Chrome/') => 'Chrome',
            str_contains($ua, 'Firefox/') => 'Firefox',
            str_contains($ua, 'Safari/') => 'Safari',
            str_contains($ua, 'okhttp') || str_contains($ua, 'Dart') => 'App',
            default => 'Otro',
        };
        $so = match (true) {
            str_contains($ua, 'Android') => 'Android',
            str_contains($ua, 'iPhone') || str_contains($ua, 'iPad') => 'iOS',
            str_contains($ua, 'Windows') => 'Windows',
            str_contains($ua, 'Mac OS') => 'macOS',
            str_contains($ua, 'Linux') => 'Linux',
            default => '',
        };

        return mb_substr(trim($nav.($so ? " · {$so}" : '')), 0, 80);
    }
}
