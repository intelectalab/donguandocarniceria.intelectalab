<?php

namespace App\Modulos\Pro\Services;

use App\Models\User;
use App\Support\Access;
use App\Support\RuleError;
use Carbon\CarbonImmutable;
use Closure;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

/**
 * Utilidades de los módulos de producción y calidad (PRO, DES, CAL y ETQ): números, fechas de Lima,
 * textos, avisos, alcance por local y traducción de las restricciones de la base a su regla.
 */
final class Comun
{
    /** Texto decimal para la API: «12.500». */
    public static function t(mixed $v, int $d = 3): ?string
    {
        return $v === null || $v === '' ? null : number_format(round((float) $v, $d), $d, '.', '');
    }

    public static function num(mixed $v, int $d = 3): ?float
    {
        if ($v === null || $v === '') {
            return null;
        }
        $v = is_string($v) ? str_replace(',', '.', trim($v)) : $v;

        return is_numeric($v) ? round((float) $v, $d) : null;
    }

    public static function texto(mixed $v, int $max = 255): ?string
    {
        $s = trim((string) $v);

        return $s === '' ? null : mb_substr($s, 0, $max);
    }

    public static function hoy(): string
    {
        return CarbonImmutable::now('America/Lima')->toDateString();
    }

    public static function ahora(): CarbonImmutable
    {
        return CarbonImmutable::now('America/Lima');
    }

    public static function fecha(?string $f): string
    {
        return $f ? CarbonImmutable::parse(substr($f, 0, 10), 'America/Lima')->toDateString() : self::hoy();
    }

    /** 30/09/2026 */
    public static function dmy(?string $f): string
    {
        return $f ? CarbonImmutable::parse(substr($f, 0, 10))->format('d/m/Y') : '—';
    }

    /** «1.234,50» para los mensajes. */
    public static function n(mixed $v, int $d = 2): string
    {
        return number_format((float) $v, $d, ',', '.');
    }

    /** Primer y último día del mes «2026-10» (o del mes actual). */
    public static function mes(?string $mes): array
    {
        $m = $mes && preg_match('/^\d{4}-\d{2}$/', $mes) ? CarbonImmutable::parse($mes.'-01', 'America/Lima') : CarbonImmutable::now('America/Lima')->startOfMonth();

        return [$m->toDateString(), $m->endOfMonth()->toDateString()];
    }

    /** Locales del usuario (vacío = todos). */
    public static function locales(User $u): array
    {
        return Access::for($u)['establishments'];
    }

    /** RN-PRO-09: escribir en un local fuera del alcance del usuario se rechaza. */
    public static function exigirLocal(User $u, ?string $localId, string $regla, string $que = 'Ese registro'): void
    {
        $locales = self::locales($u);
        if ($localId && $locales && ! in_array($localId, $locales, true)) {
            RuleError::fail($regla, "{$que} es de un local fuera de tu alcance.");
        }
    }

    /** Usuarios activos con alguno de los roles (para avisos). */
    public static function usuariosDeRol(array $roles, ?string $localId = null): array
    {
        return DB::table('users as u')->join('user_roles as ur', 'ur.user_id', '=', 'u.id')->join('roles as r', 'r.id', '=', 'ur.role_id')
            ->whereIn('r.code', $roles)->where('u.status', 'ACTIVE')
            ->when($localId, fn ($q) => $q->where(fn ($x) => $x->whereNotExists(fn ($s) => $s->from('user_scopes as us')->whereColumn('us.user_id', 'u.id')->whereNotNull('us.establishment_id'))
                ->orWhereExists(fn ($s) => $s->from('user_scopes as us')->whereColumn('us.user_id', 'u.id')->where('us.establishment_id', $localId))))
            ->distinct()->pluck('u.id')->all();
    }

    /** Aviso en la campana para cada usuario de los roles. Con $clave, no se repite. */
    public static function avisar(string $modulo, array $roles, string $titulo, string $cuerpo, string $pantalla, ?string $id, string $tono = 'warn', ?string $clave = null, ?string $localId = null): int
    {
        if ($clave && DB::table('notifications')->where('module', $modulo)->whereRaw("ref->>'key' = ?", [$clave])->exists()) {
            return 0;
        }
        $n = 0;
        foreach (self::usuariosDeRol($roles, $localId) as $userId) {
            DB::table('notifications')->insert([
                'user_id' => $userId, 'role' => null, 'title' => mb_substr($titulo, 0, 255), 'body' => $cuerpo,
                'ref' => json_encode(array_filter(['screen' => $pantalla, 'id' => $id, 'key' => $clave])),
                'tone' => $tono, 'module' => $modulo, 'at' => now(), 'type' => 'ALERTS', 'in_app' => true,
            ]);
            $n++;
        }

        return $n;
    }

    /** Siguiente número «PREFIJO-0001» de una tabla, por empresa, con candado de la transacción. */
    public static function numero(string $tabla, string $prefijo, int $digitos = 4): string
    {
        DB::select('SELECT pg_advisory_xact_lock(hashtext(?))', ['num:'.$tabla.':'.$prefijo.':'.DB::selectOne('SELECT app_tenant_id() AS t')->t]);
        $max = DB::table($tabla)->where('number', 'like', $prefijo.'%')
            ->selectRaw("max(nullif(regexp_replace(substr(number, ?), '\\D', '', 'g'), '')::int) AS n", [strlen($prefijo) + 1])->value('n');

        return $prefijo.str_pad((string) (((int) $max) + 1), $digitos, '0', STR_PAD_LEFT);
    }

    /** Agrega un paso al historial (jsonb) de una fila. */
    public static function historial(?string $json, string $accion, string $detalle, User $quien): string
    {
        $h = json_decode($json ?? '[]', true) ?: [];
        $h[] = ['at' => self::ahora()->format('Y-m-d\TH:i'), 'action' => $accion, 'detail' => $detalle, 'user' => $quien->name];

        return json_encode($h, JSON_UNESCAPED_UNICODE);
    }

    /**
     * Las restricciones de la base se traducen a la regla que las pide. Los disparadores responden
     * «RN-XXX-00: mensaje» y se devuelven tal cual.
     *
     * @param  array<string, array{0: string, 1: string}>  $mapa  restricción => [regla, mensaje]
     */
    public static function base(Closure $fn, array $mapa = []): mixed
    {
        try {
            return $fn();
        } catch (QueryException $e) {
            $msg = $e->getMessage();
            if (preg_match('/(RN-[A-Z]{3}-\d{2}): ([^\n(]+)/', $msg, $m)) {
                RuleError::fail($m[1], ucfirst(trim($m[2])));
            }
            foreach ($mapa as $restriccion => [$regla, $texto]) {
                if (str_contains($msg, $restriccion)) {
                    RuleError::fail($regla, $texto);
                }
            }
            throw $e;
        }
    }

    /**
     * Empaques de la receta escalada con la variante resuelta: los datos de demo guardan algunos con el id del
     * prototipo («va-EM-VAC-2030»), que se busca por SKU. Los que no se encuentran se dejan fuera.
     */
    public static function empaques(array $empaques): array
    {
        $out = [];
        foreach ($empaques as $p) {
            $id = (string) ($p['variant_id'] ?? '');
            if (! \Illuminate\Support\Str::isUuid($id)) {
                $id = (string) DB::table('product_variants')->where('sku', preg_replace('/^va-/', '', $id))->value('id');
            }
            if ($id !== '') {
                $out[] = ['variant_id' => $id] + $p;
            }
        }

        return $out;
    }

    /** Dentro de la transacción: el cambio de lots.qc_status lo hace una decisión de calidad o un retiro (RN-CAL-01). */
    public static function decisionDeCalidad(): void
    {
        DB::statement("SELECT set_config('app.cal_decision', 'on', true)");
    }
}
