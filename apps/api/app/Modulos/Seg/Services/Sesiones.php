<?php

namespace App\Modulos\Seg\Services;

use App\Models\PersonalAccessToken;
use App\Models\User;
use App\Support\Params;
use App\Support\RuleError;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Sesiones (tokens de Sanctum) y su política (SEG-07, SEG-14, SEG-15).
 *  RN-SEG-09  la sesión web vence tras seg_session_idle_minutes sin uso o seg_session_max_hours de
 *             duración; la de la app móvil, tras seg_mobile_session_days sin uso. Una vencida responde 401.
 *  RN-SEG-10  como máximo seg_max_concurrent_sessions sesiones por usuario: al abrir otra se cierra
 *             la de uso más antiguo.
 * El nombre del token es su cliente: «web», «android» o «ios».
 */
final class Sesiones
{
    public const MOVILES = ['android', 'ios'];

    /**
     * Cierra sesiones dejando su estado y motivo para el archivo de sesiones anteriores (el disparador
     * seg_archivar_sesion los lee al borrar cada token). Estado: REVOKED (cerrada) o EXPIRED (vencida).
     *   Sesiones::cerrando('REVOKED', 'Usuario desactivado', fn () => $u->tokens()->delete());
     */
    public static function cerrando(string $estado, string $motivo, \Closure $fn): mixed
    {
        DB::select("SELECT set_config('app.cierre_estado', ?, false), set_config('app.cierre_motivo', ?, false)", [$estado, mb_substr($motivo, 0, 255)]);
        try {
            return $fn();
        } finally {
            DB::select("SELECT set_config('app.cierre_estado', '', false), set_config('app.cierre_motivo', '', false)");
        }
    }

    /** Hasta cuándo dura una sesión nueva de ese cliente. */
    public static function vence(string $cliente = 'web'): \DateTimeInterface
    {
        return in_array($cliente, self::MOVILES, true)
            ? now()->addDays(self::param('seg_mobile_session_days', 7))
            : now()->addHours(self::param('seg_session_max_hours', 12));
    }

    /**
     * Se llama al validar cada token (AppServiceProvider): una sesión sin uso por más del límite se
     * cierra y se rechaza. Se evalúa antes de que Sanctum anote el uso de esta petición.
     */
    public static function vigente(PersonalAccessToken $t): bool
    {
        $ultimo = $t->last_used_at ?? $t->created_at;
        $limite = in_array($t->name, self::MOVILES, true)
            ? now()->subDays(self::param('seg_mobile_session_days', 7))
            : now()->subMinutes(self::param('seg_session_idle_minutes', 30));
        if ($ultimo && $ultimo->lt($limite)) {
            self::registrar('SESSION_EXPIRED', $t, 'Venció por inactividad');
            self::cerrando('EXPIRED', 'Venció por inactividad', fn () => $t->delete());

            return false;
        }

        return true;
    }

    /**
     * Solo las sesiones vigentes: sin vencer por fecha ni por inactividad (RN-SEG-09). Una sesión
     * inactiva se borra recién cuando alguien intenta usarla; hasta entonces no cuenta ni se lista.
     *
     * @param  string  $t  alias de personal_access_tokens en la consulta ('' sin alias)
     */
    public static function vigentes($query, string $t = '')
    {
        $c = $t !== '' ? "{$t}." : '';
        $movil = now()->subDays(self::param('seg_mobile_session_days', 7));
        $web = now()->subMinutes(self::param('seg_session_idle_minutes', 30));

        return $query->where(fn ($w) => $w->whereNull("{$c}expires_at")->orWhere("{$c}expires_at", '>', now()))
            ->where(fn ($w) => $w->where(fn ($x) => $x->whereIn("{$c}name", self::MOVILES)->whereRaw("coalesce({$c}last_used_at, {$c}created_at) >= ?", [$movil]))
                ->orWhere(fn ($x) => $x->whereNotIn("{$c}name", self::MOVILES)->whereRaw("coalesce({$c}last_used_at, {$c}created_at) >= ?", [$web])));
    }

    /** RN-SEG-10: si el usuario pasa del máximo, cierra las de uso más antiguo (nunca la nueva). */
    public static function limitar(User $u, string $nueva): int
    {
        $max = max(1, self::param('seg_max_concurrent_sessions', 3));
        $sobran = self::vigentes(DB::table('personal_access_tokens'))->where('tokenable_id', $u->id)->where('id', '<>', $nueva)
            ->orderByRaw('coalesce(last_used_at, created_at) desc')->offset($max - 1)->limit(1000)->pluck('id');
        foreach ($sobran as $id) {
            $t = PersonalAccessToken::find($id);
            if ($t) {
                self::registrar('SESSION_REVOKED', $t, 'Cerrada al abrir otra: se superó el máximo de sesiones simultáneas', $u);
                self::cerrando('REVOKED', 'Se superó el máximo de sesiones simultáneas', fn () => $t->delete());
            }
        }

        return $sobran->count();
    }

    /** Cierra una sesión propia que no es la actual. */
    public static function cerrarPropia(User $u, string $id): void
    {
        if ($id === $u->currentAccessToken()?->id) {
            RuleError::fail('RN-SEG-09', 'Esa es tu sesión actual: para salir usa «Salir».');
        }
        $t = PersonalAccessToken::where('tokenable_id', $u->id)->find($id) ?? abort(404, 'Sesión no encontrada.');
        self::registrar('SESSION_REVOKED', $t, 'Cerrada por el usuario', $u);
        self::cerrando('REVOKED', 'Cerrada por el usuario', fn () => $t->delete());
    }

    /** Cierra todas las sesiones propias menos la actual. */
    public static function cerrarLasDemas(User $u): int
    {
        $actual = $u->currentAccessToken()?->id;
        $n = self::cerrando('REVOKED', 'Cerrada por el usuario', fn () => $u->tokens()->when($actual, fn ($q) => $q->where('id', '<>', $actual))->delete());
        if ($n) {
            Bitacora::registrar('SESSION_REVOKED', ['user' => $u, 'entity' => 'users', 'entity_id' => $u->id,
                'detail' => 'Cerró sus otras sesiones', 'details' => ['sessions_closed' => $n]]);
        }

        return $n;
    }

    /**
     * Sesiones de un usuario para las pantallas: las abiertas (vigentes) y las anteriores (archivadas al
     * cerrarse o vencer, y los tokens vencidos que aún no se borraron), con el mismo formato.
     * Estado: OPEN, EXPIRED o REVOKED.
     *
     * @return array{abiertas: Collection, anteriores: Collection}
     */
    public static function delUsuario(string $userId, ?string $actual, int $anteriores = 20): array
    {
        $vigentes = self::vigentes(DB::table('personal_access_tokens'))->where('tokenable_id', $userId)->pluck('id')->flip();
        $tokens = DB::table('personal_access_tokens')->where('tokenable_id', $userId)->orderByRaw('coalesce(last_used_at, created_at) desc')
            ->get(['id', 'name', 'ip', 'device', 'created_at', 'last_used_at', 'expires_at']);
        $fila = fn ($t, string $estado, ?string $motivo, ?string $cerrada) => [
            'id' => $t->id, 'client' => $t->name, 'ip' => $t->ip ?: null, 'device' => $t->device ?: null, 'created_at' => $t->created_at,
            'last_used_at' => $t->last_used_at ?? $t->created_at, 'expires_at' => $t->expires_at, 'estado' => $estado, 'motivo' => $motivo,
            'cerrada_en' => $cerrada, 'actual' => $t->id === $actual,
        ];
        $abiertas = $tokens->filter(fn ($t) => isset($vigentes[$t->id]))->map(fn ($t) => $fila($t, 'OPEN', null, null))->values();
        $sinBorrar = $tokens->reject(fn ($t) => isset($vigentes[$t->id]))->map(fn ($t) => $fila($t, 'EXPIRED', $t->expires_at && now()->gt($t->expires_at) ? 'Venció por duración' : 'Venció por inactividad', null));
        $archivo = DB::table('user_sessions')->where('user_id', $userId)->orderByDesc('revoked_at')->limit($anteriores)
            ->get(['id', 'client as name', 'ip', 'user_agent as device', 'started_at as created_at', 'last_seen_at as last_used_at', 'expires_at', 'status', 'revoke_reason', 'revoked_at'])
            ->map(fn ($s) => $fila($s, $s->status === 'EXPIRED' ? 'EXPIRED' : 'REVOKED', $s->revoke_reason, $s->revoked_at));

        return ['abiertas' => $abiertas, 'anteriores' => $sinBorrar->concat($archivo)->take($anteriores)->values()];
    }

    /** La política vigente, para las pantallas. */
    public static function politica(): array
    {
        return [
            'max_sesiones' => self::param('seg_max_concurrent_sessions', 3),
            'inactividad_minutos' => self::param('seg_session_idle_minutes', 30),
            'duracion_horas' => self::param('seg_session_max_hours', 12),
            'movil_dias' => self::param('seg_mobile_session_days', 7),
        ];
    }

    private static function param(string $key, int $porDefecto): int
    {
        $v = Params::get($key);

        return is_numeric($v) ? (int) $v : $porDefecto;
    }

    private static function registrar(string $evento, PersonalAccessToken $t, string $detalle, ?User $quien = null): void
    {
        // La bitácora no debe impedir cerrar la sesión (por ejemplo, si aún no hay empresa en el contexto).
        try {
            Bitacora::registrar($evento, ['user' => $quien ?? User::find($t->tokenable_id), 'entity' => 'users', 'entity_id' => $t->tokenable_id,
                'detail' => $detalle, 'details' => ['ip' => $t->ip, 'device' => $t->device]]);
        } catch (\Throwable) {
        }
    }
}
