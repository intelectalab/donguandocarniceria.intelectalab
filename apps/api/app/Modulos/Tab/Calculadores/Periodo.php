<?php

namespace App\Modulos\Tab\Calculadores;

use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Lo que recibe cada calculador: el rango de fechas (del primer día del mes hasta su último día, o hasta hoy si es el mes en
 * curso), y la marca y el local elegidos (null = todos). Las horas van en hora de Lima (UTC−5, sin horario de verano).
 */
final class Periodo
{
    public function __construct(
        public readonly string $desde,
        public readonly string $hasta,
        public readonly ?string $marca = null,
        public readonly ?string $local = null,
    ) {}

    /** Inicio del rango como momento (para columnas con hora). */
    public function ini(): string
    {
        return $this->desde.' 00:00:00-05';
    }

    /** Fin del rango, sin incluir (el día siguiente a las 00:00 de Lima). */
    public function fin(): string
    {
        return CarbonImmutable::parse($this->hasta)->addDay()->toDateString().' 00:00:00-05';
    }

    /** Primer día del mes del rango (Y-m-01). */
    public function mes(): string
    {
        return substr($this->desde, 0, 7).'-01';
    }

    /** Último día del mes (aunque el rango termine antes). */
    public function finDeMes(): string
    {
        return CarbonImmutable::parse($this->mes())->endOfMonth()->toDateString();
    }

    /** Filtra por marca y local en las columnas dadas (null: esa dimensión no aplica a la tabla). */
    public function filtrar(Builder $q, ?string $colMarca, ?string $colLocal): Builder
    {
        if ($this->marca) {
            $colMarca ? $q->where($colMarca, $this->marca) : $q->whereRaw('false');
        }
        if ($this->local) {
            $colLocal ? $q->where($colLocal, $this->local) : $q->whereRaw('false');
        }

        return $q;
    }

    /** Columna con hora dentro del rango. */
    public function enRango(Builder $q, string $col): Builder
    {
        return $q->where($col, '>=', $this->ini())->where($col, '<', $this->fin());
    }

    /** Columna de fecha (sin hora) dentro del rango. */
    public function enFechas(Builder $q, string $col): Builder
    {
        return $q->whereBetween($col, [$this->desde, $this->hasta]);
    }

    /** Pedidos (sales_orders as o) con la marca y el local elegidos. */
    public function pedidos(): Builder
    {
        return $this->filtrar(DB::table('sales_orders as o'), 'o.brand_id', 'o.establishment_id');
    }

    /** Valor de un indicador: valor, numerador y denominador. */
    public static function valor(?float $valor, ?float $num = null, ?float $den = null, int $dec = 2): array
    {
        return ['value' => $valor === null ? null : round($valor, $dec), 'numerator' => $num === null ? null : round($num, 4), 'denominator' => $den === null ? null : round($den, 4)];
    }

    /** a / b × 100 (null si b es 0). */
    public static function pct(float $a, float $b, int $dec = 2): array
    {
        return self::valor($b > 0 ? $a / $b * 100 : null, $a, $b, $dec);
    }

    /** a / b (null si b es 0). */
    public static function razon(float $a, float $b, int $dec = 2): array
    {
        return self::valor($b > 0 ? $a / $b : null, $a, $b, $dec);
    }

    /** Un total o un conteo, sin denominador. */
    public static function total(float $a, int $dec = 2): array
    {
        return self::valor($a, $a, null, $dec);
    }

    public static function mediana(array $xs): ?float
    {
        $xs = array_values(array_filter($xs, fn ($x) => $x !== null));
        sort($xs);
        $n = count($xs);
        if (! $n) {
            return null;
        }

        return $n % 2 ? (float) $xs[intdiv($n, 2)] : ((float) $xs[$n / 2 - 1] + (float) $xs[$n / 2]) / 2;
    }
}
