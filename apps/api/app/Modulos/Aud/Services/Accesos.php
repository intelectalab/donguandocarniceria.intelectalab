<?php

namespace App\Modulos\Aud\Services;

use App\Models\User;
use App\Modulos\Seg\Services\Bitacora;
use App\Support\Paginas;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * AUD-03 Bitácora de accesos (access_log, solo inserción, RN-AUD-03): ingresos correctos y fallidos, segundo factor,
 * bloqueos, cierres, recuperaciones y accesos denegados (403), por usuario, IP y dispositivo.
 * Los accesos a datos sensibles (descargas, vistas sin enmascarar, exportaciones) van en AUD-04, no aquí.
 */
final class Accesos
{
    /** Eventos de AUD-04 (datos sensibles): no se listan aquí. */
    public const SENSIBLES = ['SENSITIVE_VIEW', 'EXPORT_DOWNLOADED', 'FILE_DOWNLOADED', 'RECORDING_PLAYED'];

    /** Tono de cada evento en la pantalla. */
    public const TONOS = [
        'LOGIN_OK' => 'ok', 'MFA_OK' => 'ok', 'MFA_ENABLED' => 'ok', 'LOGIN_FAILED' => 'warn', 'MFA_FAILED' => 'warn', 'LOGIN_BLOCKED' => 'warn',
        'RECOVERY_CODE_USED' => 'warn', 'SESSION_REVOKED' => 'warn', 'LOCKED' => 'bad', 'PERMISSION_DENIED' => 'bad', 'MODULE_DISABLED' => 'bad',
        'LOGIN_DENIED_DEVICE' => 'bad', 'MFA_DISABLED' => 'warn', 'MFA_RESET' => 'warn',
    ];

    public const FALLIDOS = ['LOGIN_FAILED', 'MFA_FAILED', 'LOGIN_BLOCKED'];

    public const DENEGADOS = ['PERMISSION_DENIED', 'MODULE_DISABLED'];

    public static function nombreEvento(string $e): string
    {
        return Bitacora::EVENTOS[$e] ?? ucfirst(mb_strtolower(str_replace('_', ' ', $e)));
    }

    public static function lista(array $f, User $quien): array
    {
        $hasta = ! empty($f['hasta']) ? Carbon::parse($f['hasta'], 'America/Lima')->endOfDay() : now('America/Lima')->endOfDay();
        $desde = ! empty($f['desde']) ? Carbon::parse($f['desde'], 'America/Lima')->startOfDay() : $hasta->copy()->subDays(13)->startOfDay();
        $q = DB::table('access_log')->whereNotIn('event', self::SENSIBLES)->whereBetween('at', [$desde, $hasta]);
        if (! empty($f['evento'])) {
            $q->where('event', $f['evento']);
        }
        if (! empty($f['usuario'])) {
            $q->where('user_id', $f['usuario']);
            Bitacora::registrar('AUDIT_VIEWED', ['user' => $quien, 'detail' => 'Bitácora de accesos filtrada por usuario: '.(DB::table('users')->where('id', $f['usuario'])->value('name') ?? '?')]);
        }
        if (! empty($f['ip'])) {
            $q->where('ip', 'like', addcslashes(trim($f['ip']), '%_\\').'%');
        }
        if (! empty($f['resultado'])) {
            $q->where('result', $f['resultado']);
        }
        $q->orderByDesc('at')->orderByDesc('id');
        Paginas::ordenar($q, ['at' => 'at', 'user_name' => 'user_name', 'event' => 'event', 'ip' => 'ip', 'device' => 'device'], 'id', $f);

        // Cifras en vivo: hoy y los últimos 7 días (es la vigilancia de seguridad: se miden desde hoy).
        $c = DB::table('access_log')->selectRaw("
            count(*) FILTER (WHERE event = 'LOGIN_OK' AND (at AT TIME ZONE 'America/Lima')::date = (now() AT TIME ZONE 'America/Lima')::date) AS ingresos_hoy,
            count(*) FILTER (WHERE event IN ('LOGIN_FAILED','MFA_FAILED','LOGIN_BLOCKED') AND at >= now() - interval '7 days') AS fallidos_7,
            count(*) FILTER (WHERE event = 'LOCKED' AND at >= now() - interval '7 days') AS bloqueos_7,
            count(*) FILTER (WHERE event IN ('PERMISSION_DENIED','MODULE_DISABLED') AND at >= now() - interval '7 days') AS denegados_7")->first();

        // KPI-AUD-03: accesos denegados por usuario y semana, en el rango elegido.
        $semanas = DB::table('access_log')->whereIn('event', self::DENEGADOS)->whereBetween('at', [$desde, $hasta])
            ->selectRaw("date_trunc('week', at AT TIME ZONE 'America/Lima')::date AS semana, user_id, max(user_name) AS usuario, max(role) AS rol,
                count(*) FILTER (WHERE event = 'PERMISSION_DENIED') AS sin_permiso, count(*) FILTER (WHERE event = 'MODULE_DISABLED') AS modulo_apagado, count(*) AS total")
            ->groupByRaw('1, user_id')->orderByDesc('semana')->orderByDesc('total')->limit(50)->get();

        $roles = DB::table('roles')->pluck('name', 'code')->all();

        return Paginas::de($q, fn ($x) => self::presentar($x, $roles), $f) + [
            'cifras' => ['ingresos_hoy' => (int) $c->ingresos_hoy, 'fallidos_7' => (int) $c->fallidos_7, 'bloqueos_7' => (int) $c->bloqueos_7, 'denegados_7' => (int) $c->denegados_7],
            'semanas' => $semanas->map(fn ($s) => (array) $s + ['rol_nombre' => $s->rol ? ($roles[$s->rol] ?? $s->rol) : null])->values(),
            'desde' => $desde->toDateString(), 'hasta' => $hasta->toDateString(),
            'eventos' => collect(Bitacora::EVENTOS)->except(self::SENSIBLES)->map(fn ($n, $k) => ['value' => $k, 'label' => $n])->sortBy('label')->values(),
            'usuarios' => DB::table('users')->orderBy('name')->get(['id as value', 'name as label']),
        ];
    }

    private static function presentar(object $x, array $roles): array
    {
        $detalles = json_decode($x->details ?? 'null', true);

        return [
            'id' => $x->id, 'at' => $x->at, 'user_id' => $x->user_id, 'user_name' => $x->user_name, 'email' => $x->email_attempted, 'rol' => $x->role ? ($roles[$x->role] ?? $x->role) : null,
            'event' => $x->event, 'event_name' => self::nombreEvento($x->event), 'tono' => self::TONOS[$x->event] ?? 'neutral', 'result' => $x->result,
            'ip' => $x->ip, 'device' => $x->device, 'session_id' => $x->session_id,
            'detalle' => $x->detail ?: (is_array($detalles) && $detalles ? collect($detalles)->map(fn ($v, $k) => "{$k}: ".(is_scalar($v) ? (is_bool($v) ? ($v ? 'sí' : 'no') : $v) : json_encode($v)))->implode(' · ') : null),
        ];
    }
}
