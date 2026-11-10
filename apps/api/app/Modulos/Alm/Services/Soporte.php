<?php

namespace App\Modulos\Alm\Services;

use App\Support\RuleError;
use Carbon\CarbonImmutable;
use Closure;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

/** Utilidades internas de ALM: cantidades, fechas de Lima, números de documento y errores de la base. */
final class Soporte
{
    public const EPS = 0.0005;

    /** Tipos que suman y que restan; ADJUSTMENT y REVERSAL llevan su propio signo. */
    public const ENTRADAS = ['RECEIPT', 'RETURN', 'TRANSFER_IN', 'PRODUCTION_IN', 'CONSIGNMENT_RETURN'];

    public const SALIDAS = ['SALE', 'TRANSFER_OUT', 'PRODUCTION_OUT', 'WASTE', 'CONSIGNMENT_OUT'];

    /** Salidas que exigen lote liberado y vigente sin excepción (RN-ALM-02, RN-ALM-04). */
    public const SALIDAS_COMERCIALES = ['SALE', 'TRANSFER_OUT', 'CONSIGNMENT_OUT'];

    public static function q(mixed $v, int $d = 3): float
    {
        return round((float) $v, $d);
    }

    /** Texto decimal para la API: «12.500». */
    public static function t(mixed $v, int $d = 3): ?string
    {
        return $v === null ? null : number_format(round((float) $v, $d), $d, '.', '');
    }

    public static function hoy(): CarbonImmutable
    {
        return CarbonImmutable::now('America/Lima')->startOfDay();
    }

    public static function ahora(): CarbonImmutable
    {
        return CarbonImmutable::now('America/Lima');
    }

    /** Días de vida que le quedan a un lote a una fecha (negativo = vencido). */
    public static function diasDeVida(?string $vence, ?CarbonImmutable $a = null): ?int
    {
        if (! $vence) {
            return null;
        }
        $a ??= self::hoy();

        return (int) $a->startOfDay()->diffInDays(CarbonImmutable::parse(substr($vence, 0, 10), 'America/Lima')->startOfDay(), false);
    }

    /**
     * Siguiente número de un documento de ALM («REC-0006»), por empresa. Se toma con un candado
     * de la transacción: dos recepciones a la vez no reciben el mismo número.
     */
    public static function numero(string $tabla, string $prefijo): string
    {
        DB::select('SELECT pg_advisory_xact_lock(hashtext(?))', ['alm:'.$tabla.':'.DB::selectOne('SELECT app_tenant_id() AS t')->t]);
        $max = DB::table($tabla)->where('number', 'like', $prefijo.'%')
            ->selectRaw("max(nullif(regexp_replace(substr(number, ?), '\\D', '', 'g'), '')::int) AS n", [strlen($prefijo) + 1])->value('n');

        return $prefijo.str_pad((string) (((int) $max) + 1), 4, '0', STR_PAD_LEFT);
    }

    /** Las funciones de la base fallan con «RN-ALM-xx: mensaje»: se convierten en RuleError. */
    public static function base(Closure $fn): mixed
    {
        try {
            return $fn();
        } catch (QueryException $e) {
            if (preg_match('/(RN-ALM-\d{2}): ([^\n]+)/', $e->getMessage(), $m)) {
                RuleError::fail($m[1], ucfirst(trim(preg_replace('/\s*\(Connection:.*$/', '', $m[2]))));
            }
            throw $e;
        }
    }

    public static function unidad(?string $saleMode): string
    {
        return $saleMode === 'KG' ? 'kg' : 'u';
    }

    public static function cant(float $q, ?string $saleMode = null): string
    {
        $d = $saleMode === 'KG' || abs($q - round($q)) > self::EPS ? 3 : 0;

        return number_format($q, $d, ',', '.').' '.self::unidad($saleMode);
    }
}
