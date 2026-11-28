<?php

namespace App\Modulos\Tab\Services;

use App\Models\User;
use App\Support\Access;
use App\Support\Params;
use App\Support\RuleError;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/** Lo común de TAB: nombres, parámetros, fechas en hora de Lima, alcance del usuario (RN-TAB-06) y tableros por rol. */
final class Base
{
    public const UNIDADES = ['PEN' => 'Soles', 'PCT' => 'Porcentaje', 'COUNT' => 'Cantidad', 'KG' => 'Kilos', 'DAYS' => 'Días', 'HOURS' => 'Horas', 'MINUTES' => 'Minutos',
        'RATIO' => 'Razón', 'PEN_PER_KG' => 'S/ por kg', 'PEN_PER_UNIT' => 'S/ por unidad'];

    public const SENTIDOS = ['HIGHER_BETTER' => 'Más alto es mejor', 'LOWER_BETTER' => 'Más bajo es mejor', 'TARGET' => 'Objetivo (cerca de la meta)'];

    public const FRECUENCIAS = ['DAILY' => 'Diaria', 'WEEKLY' => 'Semanal', 'MONTHLY' => 'Mensual', 'INSTANT' => 'Al instante'];

    public const SEMAFOROS = ['GREEN' => 'Verde', 'AMBER' => 'Ámbar', 'RED' => 'Rojo'];

    /** Roles que ven todos los tableros y todos los indicadores (RN-TAB-06). */
    public const VEN_TODO = ['GERENTE', 'AUDITOR'];

    /**
     * Tableros del sistema (D-TAB-02: por rol, no personalizables): código, pantalla, nombre, roles, indicadores en tarjetas,
     * módulos cuyos demás indicadores van a la tabla. Es lo que siembra tab_seed_dashboards() en la base.
     */
    public const TABLEROS = [
        'GERENCIA' => ['TAB-01', 'Tablero de gerencia'], 'VENTAS' => ['TAB-02', 'Tablero de ventas'], 'SUPERVISORA' => ['TAB-03', 'Tablero de la supervisora'],
        'DELIVERY' => ['TAB-04', 'Tablero de delivery'], 'ALMACEN' => ['TAB-05', 'Tablero de almacén y preparación'], 'MARKETING' => ['TAB-06', 'Tablero de marketing'],
    ];

    public static function hoy(): string
    {
        return CarbonImmutable::now('America/Lima')->toDateString();
    }

    public static function ahora(): CarbonImmutable
    {
        return CarbonImmutable::now('America/Lima');
    }

    /** 'Y-m' o 'Y-m-d' → 'Y-m-01'. */
    public static function mes(string $m): string
    {
        if (! preg_match('/^\d{4}-\d{2}/', $m)) {
            RuleError::fail('RN-TAB-01', 'El mes no es válido.');
        }

        return substr($m, 0, 7).'-01';
    }

    public static function mesActual(): string
    {
        return substr(self::hoy(), 0, 7).'-01';
    }

    public static function finDeMes(string $mes): string
    {
        return CarbonImmutable::parse(self::mes($mes))->endOfMonth()->toDateString();
    }

    /** Rango que se calcula: del primer día al último, o hasta hoy si es el mes en curso. */
    public static function rango(string $mes): array
    {
        $fin = self::finDeMes($mes);

        return [self::mes($mes), min($fin, self::hoy())];
    }

    /** RN-TAB-03: terminado si su último día ya pasó (hora de Lima). */
    public static function terminado(string $mes): bool
    {
        return self::finDeMes($mes) < self::hoy();
    }

    public static function sumarMeses(string $mes, int $n): string
    {
        return CarbonImmutable::parse(self::mes($mes))->addMonths($n)->toDateString();
    }

    public static function nombreMes(string $mes): string
    {
        $n = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'setiembre', 'octubre', 'noviembre', 'diciembre'];

        return $n[(int) substr($mes, 5, 2) - 1].' de '.substr($mes, 0, 4);
    }

    public static function param(string $clave, float $defecto): float
    {
        $v = Params::get($clave);

        return is_numeric($v) ? (float) $v : $defecto;
    }

    public static function tolerancia(): float
    {
        return self::param('tab_default_tolerance_pct', 10);
    }

    /** Clave de la dimensión del valor congelado: ALL, B:<marca>, S:<local> o las dos. */
    public static function dimension(?string $marca, ?string $local): string
    {
        return implode('|', array_filter([$marca ? 'B:'.$marca : null, $local ? 'S:'.$local : null])) ?: 'ALL';
    }

    public static function roles(User $u): array
    {
        return Access::for($u)['roles'];
    }

    public static function veTodo(User $u): bool
    {
        return (bool) array_intersect(self::roles($u), self::VEN_TODO);
    }

    /**
     * RN-TAB-06: la marca y el local con que se calcula, dentro del alcance del usuario (SEG). Si el usuario tiene un alcance
     * limitado y pide «todas», se usa su primera marca o su local, y se le avisa. Nunca se amplía su alcance.
     *
     * @return array{marca: ?string, local: ?string, notas: string[]}
     */
    public static function alcance(User $u, ?string $marca, ?string $local): array
    {
        $a = Access::for($u);
        $marca = $marca && $marca !== 'ALL' ? $marca : null;
        $local = $local && $local !== 'ALL' ? $local : null;
        $notas = [];
        if ($a['brands']) {
            if ($marca && ! in_array($marca, $a['brands'], true)) {
                RuleError::fail('RN-TAB-06', 'Esa marca no está en tu alcance.');
            }
            if (! $marca) {
                $marca = $a['brands'][0];
                if (count($a['brands']) > 1) {
                    $notas[] = 'Tu alcance tiene '.count($a['brands']).' marcas: se muestra '.self::nombreMarca($marca).'. Elige otra arriba.';
                }
            }
        }
        if ($a['establishments']) {
            if ($local && ! in_array($local, $a['establishments'], true)) {
                RuleError::fail('RN-TAB-06', 'Ese local no está en tu alcance.');
            }
            if (! $local) {
                $local = $a['establishments'][0];
                $notas[] = 'Tu alcance es solo '.self::nombreLocal($local).': no ves rutas, costos ni ventas de otros locales.';
            }
        }

        return ['marca' => $marca, 'local' => $local, 'notas' => $notas];
    }

    public static function nombreMarca(?string $id): string
    {
        return $id ? (string) DB::table('brands')->where('id', $id)->value('name') : 'Todas las marcas';
    }

    public static function nombreLocal(?string $id): string
    {
        return $id ? (string) (DB::table('establishments')->where('id', $id)->value('short') ?: DB::table('establishments')->where('id', $id)->value('name')) : 'Todos los locales';
    }

    /** Módulos encendidos para la empresa (RN-TAB-07). */
    public static function modulosEncendidos(): array
    {
        return DB::table('tenant_modules')->where('enabled', true)->pluck('module_code')->all();
    }

    /**
     * Corre $fn dentro de una empresa, como el usuario de la aplicación (RLS), aunque se llame desde una migración o una
     * semilla con el dueño de las tablas. Deja el contexto limpio al terminar.
     */
    public static function enEmpresa(string $tenantId, callable $fn): mixed
    {
        $antes = \App\Support\TenantContext::tenant();
        \App\Support\TenantContext::set(\App\Support\TenantContext::find($tenantId));
        $rol = DB::selectOne('SELECT current_user AS u')->u;
        $cambiar = $rol !== 'aycha_app' && DB::selectOne("SELECT pg_has_role(current_user, 'aycha_app', 'MEMBER') OR (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS ok")->ok;
        if ($cambiar) {
            DB::statement('SET ROLE aycha_app');
        }
        try {
            Catalogo::olvidar();
            Motor::olvidar();

            return $fn();
        } finally {
            if ($cambiar) {
                DB::statement('RESET ROLE');
            }
            \App\Support\TenantContext::set($antes);
            Catalogo::olvidar();
            Motor::olvidar();
        }
    }

    public static function r(mixed $n, int $d = 2): float
    {
        return round((float) $n, $d);
    }
}
