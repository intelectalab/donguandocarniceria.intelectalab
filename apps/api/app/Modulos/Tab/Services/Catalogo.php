<?php

namespace App\Modulos\Tab\Services;

use App\Models\User;
use App\Modulos\Tab\Calculadores\Registro;
use App\Support\RuleError;
use App\Support\TenantContext;
use Illuminate\Support\Facades\DB;

/**
 * TAB-07 Catálogo de indicadores (kpi_definitions): lo registra cada módulo con kpi_register() (RN-TAB-08); aquí se lee,
 * se decide qué ve cada rol (RN-TAB-06, RN-TAB-07) y gerencia o sistemas lo activa o ajusta (tab.kpi.manage).
 */
final class Catalogo
{
    private static array $cache = [];

    public static function olvidar(): void
    {
        self::$cache = [];
    }

    /** @return array<string, object> por código */
    public static function defs(): array
    {
        $t = TenantContext::id() ?? '';
        if (! isset(self::$cache[$t])) {
            self::$cache[$t] = DB::table('kpi_definitions')->orderBy('code')->get()->map(function ($d) {
                $d->visible_roles = json_decode($d->visible_roles ?? '[]', true) ?: [];
                $d->dimensions = json_decode($d->dimensions ?? '[]', true) ?: [];

                return $d;
            })->keyBy('code')->all();
            self::$cache[$t.'|mods'] = Base::modulosEncendidos();
        }

        return self::$cache[$t];
    }

    public static function def(string $codigo): ?object
    {
        return self::defs()[$codigo] ?? null;
    }

    public static function moduloEncendido(object $d): bool
    {
        self::defs();

        return in_array($d->requires_module ?: $d->module_code, self::$cache[(TenantContext::id() ?? '').'|mods'], true);
    }

    /** RN-TAB-07: activo, con su módulo encendido. */
    public static function calculable(object $d): bool
    {
        return $d->status === 'ACTIVE' && self::moduloEncendido($d);
    }

    /** RN-TAB-06 y RN-TAB-07: además, visible para el rol (visible_roles vacío = todos; gerencia y auditoría ven todo). */
    public static function visible(?object $d, User $u): bool
    {
        if (! $d || ! self::calculable($d)) {
            return false;
        }

        return ! $d->visible_roles || Base::veTodo($u) || array_intersect(Base::roles($u), $d->visible_roles);
    }

    public static function presentar(object $d): array
    {
        return [
            'code' => $d->code, 'module_code' => $d->module_code, 'name' => $d->name, 'formula' => $d->formula, 'unit' => $d->unit,
            'unidad' => Base::UNIDADES[$d->unit] ?? $d->unit, 'direction' => $d->direction, 'sentido' => Base::SENTIDOS[$d->direction] ?? $d->direction,
            'frequency' => $d->frequency, 'frecuencia' => Base::FRECUENCIAS[$d->frequency] ?? $d->frequency, 'decimals' => (int) $d->decimals,
            'dimensions' => $d->dimensions, 'fuente' => $d->source, 'phase' => (int) $d->phase, 'calculator' => $d->calculator, 'drilldown' => $d->drilldown,
            'visible_roles' => $d->visible_roles, 'requires_module' => $d->requires_module ?: $d->module_code, 'status' => $d->status,
            'modulo_encendido' => self::moduloEncendido($d), 'con_calculo' => Registro::tiene($d->code),
        ];
    }

    /** TAB-07: todos los indicadores registrados, con su meta vigente de hoy (general). */
    public static function lista(): array
    {
        $hoy = Base::hoy();
        $metas = DB::table('kpi_targets')->whereNull('brand_id')->whereNull('establishment_id')->where('valid_from', '<=', $hoy)
            ->where(fn ($q) => $q->whereNull('valid_to')->orWhere('valid_to', '>=', $hoy))->pluck('target', 'kpi_code');
        $conMeta = DB::table('kpi_targets')->where('valid_from', '<=', $hoy)->where(fn ($q) => $q->whereNull('valid_to')->orWhere('valid_to', '>=', $hoy))
            ->distinct()->pluck('kpi_code')->flip();
        $filas = array_map(fn ($d) => self::presentar($d) + ['meta' => isset($metas[$d->code]) ? (float) $metas[$d->code] : null, 'con_meta' => isset($conMeta[$d->code])],
            array_values(self::defs()));

        return [
            'filas' => $filas,
            'cifras' => [
                'registrados' => count($filas), 'activos' => count(array_filter($filas, fn ($f) => $f['status'] === 'ACTIVE')),
                'con_calculo' => count(array_filter($filas, fn ($f) => $f['con_calculo'])), 'con_meta' => count(array_filter($filas, fn ($f) => $f['con_meta'])),
                'apagados' => count(array_filter($filas, fn ($f) => ! $f['modulo_encendido'])),
            ],
            'modulos' => array_values(array_unique(array_column($filas, 'module_code'))),
            'unidades' => Base::UNIDADES, 'sentidos' => Base::SENTIDOS, 'frecuencias' => Base::FRECUENCIAS,
            'roles' => DB::table('roles')->where('status', 'ACTIVE')->orderBy('name')->get(['code', 'name']),
        ];
    }

    /** TAB-07: activar o desactivar, roles que lo ven, pantalla de detalle, decimales y frecuencia (tab.kpi.manage). */
    public static function editar(string $codigo, array $d): array
    {
        $def = self::def($codigo) ?? RuleError::fail('RN-TAB-08', 'Ese indicador no está registrado.');
        $cambios = [];
        if (isset($d['status'])) {
            $cambios['status'] = $d['status'] === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE';
        }
        if (array_key_exists('visible_roles', $d)) {
            $roles = array_values(array_unique(array_filter(array_map('trim', (array) $d['visible_roles']))));
            $validos = DB::table('roles')->whereIn('code', $roles)->pluck('code')->all();
            if ($malos = array_diff($roles, $validos)) {
                RuleError::fail('RN-TAB-06', 'Estos roles no existen: '.implode(', ', $malos).'.');
            }
            $cambios['visible_roles'] = json_encode($roles);
        }
        if (array_key_exists('drilldown', $d)) {
            $cambios['drilldown'] = mb_substr(trim((string) $d['drilldown']), 0, 40) ?: 'TAB-10';
        }
        if (isset($d['decimals'])) {
            $cambios['decimals'] = max(0, min(6, (int) $d['decimals']));
        }
        if (isset($d['frequency'])) {
            isset(Base::FRECUENCIAS[$d['frequency']]) || RuleError::fail('RN-TAB-08', 'La frecuencia no es válida.');
            $cambios['frequency'] = $d['frequency'];
        }
        if ($cambios) {
            DB::table('kpi_definitions')->where('code', $codigo)->update($cambios + ['updated_at' => now()]);
            self::olvidar();
            Motor::refrescar();
        }

        return self::presentar(self::def($codigo));
    }

    /**
     * RN-TAB-08: registro idempotente de un indicador desde la semilla de un módulo (llama a kpi_register de la base y
     * luego a tab_seed_dashboards() para sumarlo a los tableros de su rol).
     */
    public static function registrar(string $codigo, string $modulo, string $nombre, string $formula, string $unidad, string $sentido, string $frecuencia = 'MONTHLY',
        array $dimensiones = [], ?string $fuente = null, int $fase = 1, ?string $calculador = null, ?string $detalle = null, array $roles = [], ?string $requiere = null): object
    {
        DB::select('SELECT kpi_register(?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?, ?, ?, ?, ?::jsonb, ?)', [$codigo, $modulo, $nombre, $formula, $unidad, $sentido, $frecuencia,
            json_encode($dimensiones), $fuente, $fase, $calculador, $detalle, json_encode($roles), $requiere]);
        DB::select('SELECT tab_seed_dashboards()');
        self::olvidar();

        return self::def($codigo);
    }
}
