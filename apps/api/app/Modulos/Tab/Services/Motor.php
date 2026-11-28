<?php

namespace App\Modulos\Tab\Services;

use App\Modulos\Tab\Calculadores\Almacen;
use App\Modulos\Tab\Calculadores\Periodo;
use App\Modulos\Tab\Calculadores\Registro;
use App\Support\TenantContext;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Motor de TAB (RN-TAB-01): un mes cerrado se lee de kpi_snapshots (la última corrida OK del mes); el mes en curso, o uno
 * terminado que aún no se congela, se calcula al vuelo con su calculador y se guarda en caché tab_cache_minutes (15) minutos.
 * Los valores nunca se digitan: salen de los datos de cada módulo.
 */
final class Motor
{
    private static array $corridas = [];

    private static array $fotos = [];

    public static function olvidar(): void
    {
        self::$corridas = [];
        self::$fotos = [];
        Almacen::olvidar();
    }

    /** Vacía la caché de la empresa (botón Actualizar, metas o catálogo cambiados, mes congelado). */
    public static function refrescar(): void
    {
        $t = TenantContext::id() ?? '';
        Cache::forever("tab:{$t}:version", (int) Cache::get("tab:{$t}:version", 0) + 1);
        self::olvidar();
        Metas::olvidar();
    }

    /** La última corrida OK de un mes, o null. */
    public static function corridaVigente(string $mes): ?object
    {
        $k = (TenantContext::id() ?? '').'|'.$mes;
        if (! array_key_exists($k, self::$corridas)) {
            self::$corridas[$k] = DB::table('kpi_snapshot_runs')->where('period', $mes)->where('status', 'OK')->orderByDesc('run_no')->first();
        }

        return self::$corridas[$k];
    }

    /** Valores congelados de una corrida, por indicador y dimensión. */
    private static function foto(object $run): array
    {
        return self::$fotos[$run->id] ??= DB::table('kpi_snapshots')->where('period', $run->period)->where('run_no', $run->run_no)
            ->get(['kpi_code', 'dimension_key', 'value', 'numerator', 'denominator', 'computed_at'])
            ->keyBy(fn ($s) => $s->kpi_code.'|'.$s->dimension_key)->all();
    }

    /** Calcula sin caché con el calculador registrado. Nunca lanza: si falla, el valor queda vacío con el error. */
    public static function calcular(string $codigo, string $desde, string $hasta, ?string $marca, ?string $local): array
    {
        $f = Registro::de($codigo);
        if (! $f) {
            return ['value' => null, 'numerator' => null, 'denominator' => null, 'nocalc' => true];
        }
        try {
            return $f(new Periodo($desde, $hasta, $marca, $local)) + ['numerator' => null, 'denominator' => null];
        } catch (\Throwable $e) {
            Log::warning("TAB: {$codigo} no se pudo calcular", ['error' => $e->getMessage()]);

            return ['value' => null, 'numerator' => null, 'denominator' => null, 'error' => mb_substr($e->getMessage(), 0, 200)];
        }
    }

    /**
     * Valor de un indicador en un mes, para una marca y un local (null = todos).
     *
     * @return array{value: ?float, numerator: ?float, denominator: ?float, source: string, run_no: ?int, hidden?: bool, nocalc?: bool, error?: string}
     */
    public static function valor(string $codigo, string $mes, ?string $marca = null, ?string $local = null, bool $vivo = false): array
    {
        $mes = Base::mes($mes);
        $d = Catalogo::def($codigo);
        if ($d && ! Catalogo::moduloEncendido($d)) {
            return ['value' => null, 'numerator' => null, 'denominator' => null, 'source' => 'HIDDEN', 'run_no' => null, 'hidden' => true];   // RN-TAB-07
        }
        $run = $vivo ? null : self::corridaVigente($mes);
        if ($run) {
            $s = self::foto($run)[$codigo.'|'.Base::dimension($marca, $local)] ?? null;
            if ($s) {
                return ['value' => $s->value === null ? null : (float) $s->value, 'numerator' => $s->numerator === null ? null : (float) $s->numerator,
                    'denominator' => $s->denominator === null ? null : (float) $s->denominator, 'source' => 'SNAPSHOT', 'run_no' => (int) $run->run_no, 'computed_at' => $s->computed_at];
            }
        }
        if (! Registro::tiene($codigo)) {
            return ['value' => null, 'numerator' => null, 'denominator' => null, 'source' => 'NONE', 'run_no' => null, 'nocalc' => true];
        }
        [$desde, $hasta] = Base::rango($mes);
        if ($desde > Base::hoy()) {
            return ['value' => null, 'numerator' => null, 'denominator' => null, 'source' => 'NONE', 'run_no' => null];
        }
        $t = TenantContext::id() ?? '';
        $ver = (int) Cache::get("tab:{$t}:version", 0);
        $clave = "tab:{$t}:{$ver}:{$codigo}:{$desde}:{$hasta}:".Base::dimension($marca, $local);
        $min = max(1, (int) Base::param('tab_cache_minutes', 15));
        $enCache = Cache::get($clave);
        if (is_array($enCache)) {
            return $enCache + ['source' => 'CACHE', 'run_no' => null];
        }
        $v = self::calcular($codigo, $desde, $hasta, $marca, $local);
        if (! isset($v['error'])) {
            Cache::put($clave, $v, now()->addMinutes($min));
        }

        return $v + ['source' => 'LIVE', 'run_no' => null];
    }

    /** Valor con su meta, semáforo y el mes anterior, listo para una tarjeta o una fila de tablero. */
    public static function tarjeta(object $d, string $mes, ?string $marca, ?string $local): array
    {
        $v = self::valor($d->code, $mes, $marca, $local);
        $antes = self::valor($d->code, Base::sumarMeses($mes, -1), $marca, $local);
        $al = min(Base::finDeMes($mes), Base::hoy());

        return Catalogo::presentar($d) + [
            'value' => $v['value'], 'numerator' => $v['numerator'], 'denominator' => $v['denominator'], 'source' => $v['source'], 'run_no' => $v['run_no'],
            'nocalc' => (bool) ($v['nocalc'] ?? false), 'error' => $v['error'] ?? null, 'anterior' => $antes['value'],
        ] + Metas::estado($d, $v['value'], $marca, $local, $al);
    }
}
