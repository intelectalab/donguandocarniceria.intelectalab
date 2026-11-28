<?php

namespace App\Modulos\Tab\Services;

use App\Models\User;
use App\Support\RuleError;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

/** TAB-08 Metas y semáforo: una meta vigente por indicador, marca y local en cada fecha (RN-TAB-05); semáforo con tolerancia (RN-TAB-04). */
final class Metas
{
    private const EPS = 1e-9;

    /**
     * RN-TAB-04. Más alto es mejor: verde si valor ≥ meta, ámbar si ≥ meta × (1 − tolerancia), rojo si menos.
     * Más bajo es mejor: verde si ≤ meta, ámbar si ≤ meta × (1 + tolerancia), rojo si más.
     * Objetivo: verde si la distancia a la meta es ≤ meta × tolerancia, ámbar si es ≤ el doble, rojo si más.
     */
    public static function semaforo(?float $valor, ?float $meta, string $sentido, ?float $tolPct = null): ?string
    {
        if ($valor === null || $meta === null) {
            return null;
        }
        $tol = ($tolPct ?? Base::tolerancia()) / 100;
        if ($sentido === 'LOWER_BETTER') {
            return $valor <= $meta + self::EPS ? 'GREEN' : ($valor <= $meta * (1 + $tol) + self::EPS ? 'AMBER' : 'RED');
        }
        if ($sentido === 'TARGET') {
            $d = abs($valor - $meta);
            $banda = abs($meta) * $tol;

            return $d <= $banda + self::EPS ? 'GREEN' : ($d <= 2 * $banda + self::EPS ? 'AMBER' : 'RED');
        }

        return $valor >= $meta - self::EPS ? 'GREEN' : ($valor >= $meta * (1 - $tol) - self::EPS ? 'AMBER' : 'RED');
    }

    /** Metas vigentes en una fecha, por indicador (todas sus combinaciones de marca y local). */
    private static array $vigentes = [];

    public static function olvidar(): void
    {
        self::$vigentes = [];
    }

    private static function vigentesAl(string $fecha): array
    {
        return self::$vigentes[(\App\Support\TenantContext::id() ?? '').'|'.$fecha] ??= DB::table('kpi_targets')->where('valid_from', '<=', $fecha)
            ->where(fn ($q) => $q->whereNull('valid_to')->orWhere('valid_to', '>=', $fecha))->get()->groupBy('kpi_code')->all();
    }

    /** La meta vigente más específica: marca y local, marca, local, general. */
    public static function vigente(string $codigo, ?string $marca, ?string $local, string $fecha): ?object
    {
        $ts = self::vigentesAl($fecha)[$codigo] ?? collect();
        $de = fn (?string $b, ?string $s) => $ts->first(fn ($t) => $t->brand_id === $b && $t->establishment_id === $s);

        return ($marca && $local ? $de($marca, $local) : null) ?? ($marca ? $de($marca, null) : null) ?? ($local ? $de(null, $local) : null) ?? $de(null, null);
    }

    /** Semáforo de un valor con la meta vigente de su indicador. */
    public static function estado(object $def, ?float $valor, ?string $marca, ?string $local, string $fecha): array
    {
        $m = self::vigente($def->code, $marca, $local, $fecha);
        $tol = $m ? (float) $m->tolerance_pct : null;

        return ['meta' => $m ? (float) $m->target : null, 'tolerancia' => $tol, 'meta_id' => $m?->id,
            'semaforo' => $m ? self::semaforo($valor, (float) $m->target, $def->direction, $tol) : null];
    }

    /** TAB-08: metas con su valor del mes y semáforo. */
    public static function lista(User $u, ?string $marca): array
    {
        $hoy = Base::hoy();
        $mes = Base::mesActual();
        $nombres = ['b' => DB::table('brands')->pluck('name', 'id'), 's' => DB::table('establishments')->pluck('short', 'id')];
        $filas = [];
        foreach (DB::table('kpi_targets')->when($marca && $marca !== 'ALL', fn ($q) => $q->where(fn ($w) => $w->whereNull('brand_id')->orWhere('brand_id', $marca)))
            ->orderBy('kpi_code')->orderByDesc('valid_from')->get() as $t) {
            $d = Catalogo::def($t->kpi_code);
            if (! $d) {
                continue;
            }
            $vigente = $t->valid_from <= $hoy && (! $t->valid_to || $t->valid_to >= $hoy);
            $v = $vigente ? Motor::valor($d->code, $mes, $t->brand_id, $t->establishment_id) : null;
            $filas[] = [
                'id' => $t->id, 'code' => $d->code, 'name' => $d->name, 'module_code' => $d->module_code, 'unit' => $d->unit, 'decimals' => (int) $d->decimals,
                'direction' => $d->direction, 'sentido' => Base::SENTIDOS[$d->direction] ?? $d->direction,
                'brand_id' => $t->brand_id, 'marca' => $t->brand_id ? ($nombres['b'][$t->brand_id] ?? '') : 'Todas', 'establishment_id' => $t->establishment_id,
                'local' => $t->establishment_id ? ($nombres['s'][$t->establishment_id] ?? '') : 'Todos', 'target' => (float) $t->target, 'tolerance_pct' => (float) $t->tolerance_pct,
                'valid_from' => $t->valid_from, 'valid_to' => $t->valid_to, 'vigente' => $vigente, 'created_by' => $t->created_by, 'note' => $t->note,
                'valor' => $v['value'] ?? null, 'oculto' => (bool) ($v['hidden'] ?? false), 'sin_calculo' => (bool) ($v['nocalc'] ?? false),
                'semaforo' => $vigente && $v ? self::semaforo($v['value'], (float) $t->target, $d->direction, (float) $t->tolerance_pct) : null,
            ];
        }
        $vig = array_filter($filas, fn ($f) => $f['vigente']);
        $cuenta = fn ($s) => count(array_filter($vig, fn ($f) => $f['semaforo'] === $s));

        return ['filas' => $filas, 'cifras' => ['vigentes' => count($vig), 'verde' => $cuenta('GREEN'), 'ambar' => $cuenta('AMBER'), 'rojo' => $cuenta('RED'),
            'tolerancia' => Base::tolerancia()], 'puede' => ['editar' => \App\Support\Access::can($u, 'tab.target.manage')],
            'marcas' => DB::table('brands')->where('status', 'ACTIVE')->orderBy('name')->get(['id', 'name']),
            'locales' => DB::table('establishments')->where('status', 'ACTIVE')->orderBy('code')->get(['id', 'short as name']),
            'indicadores' => array_values(array_map(fn ($d) => ['code' => $d->code, 'name' => $d->name, 'unit' => $d->unit, 'direction' => $d->direction, 'decimals' => (int) $d->decimals],
                array_filter(Catalogo::defs(), fn ($d) => Catalogo::visible($d, $u)))), 'hoy' => $hoy];
    }

    /** RN-TAB-04 y RN-TAB-05: guarda una meta; no se solapa con otra vigente de la misma marca y local. */
    public static function guardar(array $d, User $u): object
    {
        $def = Catalogo::def((string) ($d['code'] ?? '')) ?? RuleError::fail('RN-TAB-05', 'Elige un indicador del catálogo.');
        if (! is_numeric($d['target'] ?? null)) {
            RuleError::fail('RN-TAB-04', 'La meta debe ser un número.');
        }
        $tol = isset($d['tolerance_pct']) && $d['tolerance_pct'] !== '' && $d['tolerance_pct'] !== null ? (float) $d['tolerance_pct'] : Base::tolerancia();
        if ($tol < 0 || $tol > 100) {
            RuleError::fail('RN-TAB-04', 'La tolerancia va de 0 % a 100 %.');
        }
        $desde = $d['valid_from'] ?? null ?: RuleError::fail('RN-TAB-05', 'Indica desde cuándo vale la meta.');
        $hasta = ($d['valid_to'] ?? null) ?: null;
        if ($hasta && $hasta < $desde) {
            RuleError::fail('RN-TAB-05', 'La vigencia termina antes de empezar.');
        }
        $marca = ($d['brand_id'] ?? null) ?: null;
        $local = ($d['establishment_id'] ?? null) ?: null;
        $choque = DB::table('kpi_targets')->where('kpi_code', $def->code)
            ->where(fn ($q) => $marca ? $q->where('brand_id', $marca) : $q->whereNull('brand_id'))
            ->where(fn ($q) => $local ? $q->where('establishment_id', $local) : $q->whereNull('establishment_id'))
            ->where('valid_from', '<=', $hasta ?? '9999-12-31')->where(fn ($q) => $q->whereNull('valid_to')->orWhere('valid_to', '>=', $desde))->first();
        if ($choque) {
            self::solapada($def->code, $marca, $local, $choque);
        }
        try {
            $id = DB::table('kpi_targets')->insertGetId([
                'kpi_id' => $def->id, 'kpi_code' => $def->code, 'brand_id' => $marca, 'establishment_id' => $local, 'target' => round((float) $d['target'], 2),
                'tolerance_pct' => $tol, 'valid_from' => $desde, 'valid_to' => $hasta, 'created_by' => mb_substr($u->name, 0, 40),
                'note' => isset($d['note']) ? mb_substr(trim((string) $d['note']), 0, 80) ?: null : null, 'created_at' => now(),
            ]);
        } catch (QueryException $e) {
            if (str_contains($e->getMessage(), 'kpi_targets_rn_tab_05_no_overlap')) {
                RuleError::fail('RN-TAB-05', "Ya hay una meta vigente de {$def->code} para esa marca y local en esas fechas. Cierra esa vigencia primero.");
            }
            throw $e;
        }
        self::olvidar();

        return DB::table('kpi_targets')->where('id', $id)->first();
    }

    private static function solapada(string $codigo, ?string $marca, ?string $local, object $t): never
    {
        RuleError::fail('RN-TAB-05', "Ya hay una meta vigente de {$codigo} para ".($marca ? Base::nombreMarca($marca) : 'todas las marcas').' y '
            .($local ? Base::nombreLocal($local) : 'todos los locales').' entre el '.date('d/m/Y', strtotime($t->valid_from)).' y '
            .($t->valid_to ? 'el '.date('d/m/Y', strtotime($t->valid_to)) : 'sin fin').'. Cierra esa vigencia primero.');
    }

    /** Cierra la vigencia de una meta en una fecha (hoy por defecto). */
    public static function cerrar(string $id, ?string $fecha): object
    {
        $t = DB::table('kpi_targets')->where('id', $id)->first() ?? RuleError::fail('RN-TAB-05', 'Meta no encontrada.');
        $fecha = $fecha ?: Base::hoy();
        if ($t->valid_to && $t->valid_to < $fecha) {
            RuleError::fail('RN-TAB-05', 'Esa meta ya no está vigente.');
        }
        DB::table('kpi_targets')->where('id', $id)->update(['valid_to' => max($fecha, $t->valid_from), 'updated_at' => now()]);
        self::olvidar();

        return DB::table('kpi_targets')->where('id', $id)->first();
    }

    /**
     * D-TAB-01: con el primer mes congelado se proponen metas iguales al valor real, para los indicadores del tablero sin meta.
     * Solo propone; gerencia las guarda.
     */
    public static function propuestas(User $u): array
    {
        $mes = DB::table('kpi_snapshot_runs')->where('status', 'OK')->max('period');
        if (! $mes) {
            return ['mes' => null, 'filas' => []];
        }
        $hoy = Base::hoy();
        $con = DB::table('kpi_targets')->where('valid_from', '<=', $hoy)->where(fn ($q) => $q->whereNull('valid_to')->orWhere('valid_to', '>=', $hoy))
            ->whereNull('brand_id')->whereNull('establishment_id')->pluck('kpi_code')->flip();
        $filas = [];
        foreach (DB::table('dashboard_widgets')->where('viz', 'TILE')->distinct()->pluck('kpi_code') as $c) {
            $d = Catalogo::def($c);
            if (! $d || isset($con[$c]) || ! Catalogo::visible($d, $u)) {
                continue;
            }
            $v = Motor::valor($c, $mes, null, null);
            if ($v['value'] !== null) {
                $filas[] = ['code' => $c, 'name' => $d->name, 'unit' => $d->unit, 'decimals' => (int) $d->decimals, 'valor' => $v['value']];
            }
        }

        return ['mes' => $mes, 'nombre' => Base::nombreMes($mes), 'filas' => $filas];
    }
}
