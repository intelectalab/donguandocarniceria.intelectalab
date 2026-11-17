<?php

namespace App\Modulos\Mae\Services;

use App\Models\User;
use App\Support\Events;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * MAE-06 y MAE-07: unidades, conversiones y vigencia de los códigos SUNAT.
 *
 *  RN-MAE-09  factor > 0, una sola conversión por par (la inversa es 1 / factor y no se registra); sin conversión, se rechaza.
 *  RN-MAE-10  una cantidad no tiene más decimales de los que admite su unidad (NIU 0, KGM 3, GRM 0, LTR 3).
 *  RN-MAE-12  un código SUNAT se usa solo si está vigente en la fecha del documento.
 *
 * Para otros módulos: Unidades::convertir(1.25, 'KGM', 'GRM'), Unidades::validarDecimales($cantidad, 'NIU') y
 * Unidades::sunatVigente('01', '03', $fecha).
 */
final class Unidades
{
    public static function unidad(string $codigo): object
    {
        return DB::table('units_of_measure')->where('code', $codigo)->first() ?? RuleError::fail('RN-MAE-10', "La unidad {$codigo} no existe.");
    }

    /** Decimales de un número tal como se escribió (1.250 → 2, porque se guarda 1.25). */
    private static function decimalesDe(float|string $n): int
    {
        $s = rtrim(rtrim(number_format((float) $n, 9, '.', ''), '0'), '.');

        return str_contains($s, '.') ? strlen(substr($s, strpos($s, '.') + 1)) : 0;
    }

    /** RN-MAE-10 */
    public static function validarDecimales(float|string $cantidad, string $codigo): void
    {
        $u = self::unidad($codigo);
        $max = (int) ($u->decimals ?? 0);
        if (self::decimalesDe($cantidad) > $max) {
            $admite = $max === 0 ? 'solo cantidades enteras' : "hasta {$max} decimales";
            $texto = str_replace('.', ',', rtrim(rtrim(number_format((float) $cantidad, 9, '.', ''), '0'), '.'));
            RuleError::fail('RN-MAE-10', "{$u->name} ({$u->code}) admite {$admite}: {$texto} no es válido.");
        }
    }

    /** Factor para pasar de una unidad a otra (directa o inversa), o null si no hay conversión. */
    public static function factor(string $de, string $a): ?float
    {
        if ($de === $a) {
            return 1.0;
        }
        $c = DB::table('unit_conversions')->where('status', 'ACTIVE')
            ->where(fn ($q) => $q->where(['from_uom' => $de, 'to_uom' => $a])->orWhere(fn ($w) => $w->where(['from_uom' => $a, 'to_uom' => $de])))->first();
        if (! $c) {
            return null;
        }

        return $c->from_uom === $de ? (float) $c->factor : 1 / (float) $c->factor;
    }

    /** RN-MAE-09 y RN-MAE-10: convierte y redondea a los decimales de la unidad destino. */
    public static function convertir(float $cantidad, string $de, string $a): float
    {
        $f = self::factor($de, $a) ?? RuleError::fail('RN-MAE-09', "No hay conversión definida entre {$de} y {$a}: la operación se rechaza.");

        return round($cantidad * $f, (int) (self::unidad($a)->decimals ?? 0) ?: 0) + 0.0;
    }

    /** RN-MAE-09: nueva conversión (la base rechaza también el par repetido en cualquier sentido). */
    public static function agregarConversion(array $d, User $quien): object
    {
        $de = self::unidad($d['from_uom']);
        $a = self::unidad($d['to_uom']);
        if ($de->code === $a->code) {
            RuleError::fail('RN-MAE-09', 'Una conversión va entre dos unidades distintas.');
        }
        if ((float) $d['factor'] <= 0) {
            RuleError::fail('RN-MAE-09', 'El factor es mayor que cero.');
        }
        if (self::factor($de->code, $a->code) !== null) {
            RuleError::fail('RN-MAE-09', "Ya hay una conversión entre {$de->code} y {$a->code} (la inversa se calcula, no se registra aparte).");
        }
        $id = DB::table('unit_conversions')->insertGetId([
            'from_uom' => $de->code, 'to_uom' => $a->code, 'factor' => $d['factor'], 'status' => 'ACTIVE',
            'note' => ($n = trim((string) ($d['note'] ?? ''))) === '' ? null : mb_substr($n, 0, 80),
        ]);
        Events::emit('unit_conversion.created', 'unit_conversions', $id, ['by' => $quien->id]);

        return DB::table('unit_conversions')->find($id);
    }

    public static function sunatItem(string $catalogo, string $codigo): ?object
    {
        return DB::table('sunat_catalog_items')->where(['catalog' => $catalogo, 'code' => $codigo])->first();
    }

    /** RN-MAE-12 */
    public static function sunatVigente(string $catalogo, string $codigo, ?string $fecha = null): object
    {
        $fecha ??= TiposDeCambio::hoy();
        $x = self::sunatItem($catalogo, $codigo) ?? RuleError::fail('RN-MAE-12', "El código {$codigo} no existe en el catálogo {$catalogo}.");
        if ($x->valid_from > $fecha || ($x->valid_to && $x->valid_to < $fecha)) {
            $fin = $x->valid_to ? date('d/m/Y', strtotime($x->valid_to)) : 'sin fin';
            RuleError::fail('RN-MAE-12', "El código {$codigo} del catálogo {$catalogo} ({$x->description}) no está vigente el ".date('d/m/Y', strtotime($fecha))
                .' (vigencia '.date('d/m/Y', strtotime($x->valid_from))." – {$fin}).");
        }

        return $x;
    }
}
