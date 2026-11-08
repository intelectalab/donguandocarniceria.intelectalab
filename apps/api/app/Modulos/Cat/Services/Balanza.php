<?php

namespace App\Modulos\Cat\Services;

use App\Support\Params;
use Illuminate\Support\Facades\DB;

/**
 * Etiquetas de balanza EAN-13 con prefijo 2 (CAT-11, RN-CAT-12). El formato está en el parámetro
 * cat_scale_barcode_layout (posiciones desde 1): prefijo, posición y largo del PLU y del valor, y si el
 * valor es peso en gramos (WEIGHT_G) o precio en céntimos (PRICE_CENTS). Lo usan POS y ALM:
 *   Balanza::leer('2012345012509');   // ['ok' => true, 'plu' => '12345', 'weight_kg' => 1.25, ...]
 */
final class Balanza
{
    public const POR_DEFECTO = ['prefix' => '2', 'plu_start' => 3, 'plu_len' => 5, 'value_start' => 8, 'value_len' => 5, 'value_type' => 'WEIGHT_G'];

    public static function formato(): array
    {
        $v = Params::get('cat_scale_barcode_layout');
        $f = is_array($v) ? $v : (json_decode((string) $v, true) ?: []);

        return array_merge(self::POR_DEFECTO, array_intersect_key($f, self::POR_DEFECTO));
    }

    /** Dígito de control EAN-13 de los 12 primeros dígitos. */
    public static function digito(string $d12): int
    {
        $s = 0;
        for ($i = 0; $i < 12; $i++) {
            $s += (int) $d12[$i] * ($i % 2 === 0 ? 1 : 3);
        }

        return (10 - $s % 10) % 10;
    }

    /** Problema del formato o null si sirve: PLU y valor sin superponerse y dentro de los 12 primeros dígitos. */
    public static function problemaFormato(array $f): ?string
    {
        $pIni = $f['plu_start'] - 1;
        $vIni = $f['value_start'] - 1;
        if (strlen((string) $f['prefix']) >= min($f['plu_start'], $f['value_start'])) {
            return 'El prefijo se superpone con el PLU o el valor.';
        }
        if ($pIni + $f['plu_len'] > 12 || $vIni + $f['value_len'] > 12) {
            return 'El PLU y el valor deben caber en los primeros 12 dígitos (el 13.º es el control).';
        }
        if ($pIni < $vIni + $f['value_len'] && $vIni < $pIni + $f['plu_len']) {
            return 'El PLU y el valor se superponen en el código.';
        }

        return null;
    }

    /** Lee una etiqueta. Nunca lanza: devuelve ok = false con el motivo. */
    public static function leer(string $codigo, ?array $f = null): array
    {
        $f ??= self::formato();
        $c = preg_replace('/\s+/', '', $codigo);
        $mal = fn (string $error) => ['ok' => false, 'plu' => null, 'variant' => null, 'weight_kg' => null, 'amount' => null, 'value_type' => $f['value_type'], 'error' => $error];
        if (! preg_match('/^\d{13}$/', $c)) {
            return $mal('RN-CAT-12: la etiqueta de balanza debe tener 13 dígitos.');
        }
        if (! str_starts_with($c, (string) $f['prefix'])) {
            return $mal("RN-CAT-12: la etiqueta no empieza con el prefijo {$f['prefix']} de balanza.");
        }
        $esperado = self::digito(substr($c, 0, 12));
        if ($esperado !== (int) $c[12]) {
            return $mal("RN-CAT-12: dígito de control EAN-13 inválido (esperado {$esperado}, leído {$c[12]}).");
        }
        $plu = substr($c, $f['plu_start'] - 1, $f['plu_len']);
        $valor = (int) substr($c, $f['value_start'] - 1, $f['value_len']);
        $v = DB::table('product_variants')->where('status', 'ACTIVE')->whereNotNull('scale_plu')
            ->whereRaw('lpad(scale_plu, ?, \'0\') = ?', [$f['plu_len'], $plu])
            ->first(['id', 'sku', 'name', 'brand_id', 'sale_mode', 'min_weight_kg', 'max_weight_kg']);

        return [
            'ok' => true, 'plu' => $plu, 'variant' => $v,
            'weight_kg' => $f['value_type'] === 'WEIGHT_G' ? round($valor / 1000, 3) : null,
            'amount' => $f['value_type'] === 'PRICE_CENTS' ? round($valor / 100, 2) : null,
            'value_type' => $f['value_type'], 'error' => null,
        ];
    }

    /** Arma una etiqueta: PLU más peso (kg) o importe (S/) según el formato. */
    public static function armar(string $plu, float $valor, ?array $f = null): string
    {
        $f ??= self::formato();
        $a = array_fill(0, 12, '0');
        foreach (str_split((string) $f['prefix']) as $i => $ch) {
            $a[$i] = $ch;
        }
        foreach (str_split(substr(str_pad($plu, $f['plu_len'], '0', STR_PAD_LEFT), -$f['plu_len'])) as $i => $ch) {
            $a[$f['plu_start'] - 1 + $i] = $ch;
        }
        $n = (int) round($valor * ($f['value_type'] === 'WEIGHT_G' ? 1000 : 100));
        foreach (str_split(substr(str_pad((string) $n, $f['value_len'], '0', STR_PAD_LEFT), -$f['value_len'])) as $i => $ch) {
            $a[$f['value_start'] - 1 + $i] = $ch;
        }
        $d12 = implode('', $a);

        return $d12.self::digito($d12);
    }
}
