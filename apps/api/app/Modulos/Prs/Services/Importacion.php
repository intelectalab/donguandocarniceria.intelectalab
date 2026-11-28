<?php

namespace App\Modulos\Prs\Services;

use App\Models\User;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * PRS-04: carga de líneas desde Excel o CSV con validación fila por fila (RN-PRS-01, 11 y 13).
 * Columnas: concepto; mes; marca; local; centro_costo; importe; nota. El mes es 1–12 (del año presupuestal) o AAAA-MM.
 * Solo se graba si todas las filas son válidas; si una fila repite concepto, mes y dimensiones de una línea ya existente, la reemplaza.
 */
final class Importacion
{
    public const MAX_FILAS = 3000;

    public const COLUMNAS = [
        ['clave' => 'concepto', 'titulo' => 'Concepto', 'ancho' => 14, 'otros' => ['codigo', 'codigo_concepto']],
        ['clave' => 'mes', 'titulo' => 'Mes', 'ancho' => 10, 'otros' => ['periodo']],
        ['clave' => 'marca', 'titulo' => 'Marca', 'ancho' => 10, 'otros' => ['codigo_marca']],
        ['clave' => 'local', 'titulo' => 'Local', 'ancho' => 10, 'otros' => ['codigo_local']],
        ['clave' => 'centro_costo', 'titulo' => 'Centro de costo', 'ancho' => 16, 'otros' => ['centro_de_costo', 'cc', 'centro']],
        ['clave' => 'importe', 'titulo' => 'Importe sin IGV', 'ancho' => 16, 'otros' => ['importe', 'monto', 'importe_sin_igv']],
        ['clave' => 'nota', 'titulo' => 'Nota', 'ancho' => 30, 'otros' => ['notas', 'comentario']],
    ];

    public static function columnasConListas(): array
    {
        $listas = [
            'concepto' => DB::table('budget_concepts')->where('is_group', false)->where('status', 'ACTIVE')->orderBy('sort_order')->pluck('code')->all(),
            'marca' => DB::table('brands')->orderBy('code')->pluck('code')->all(),
            'local' => DB::table('establishments')->orderBy('code')->pluck('code')->all(),
            'centro_costo' => DB::table('cost_centers')->where('status', 'ACTIVE')->orderBy('code')->pluck('code')->all(),
        ];

        return array_map(fn ($c) => isset($listas[$c['clave']]) ? $c + ['lista' => $listas[$c['clave']]] : $c, self::COLUMNAS);
    }

    /** @return array{filas: array, errores: array, validas: int, total: float} */
    public static function revisar(string $versionId, string $texto): array
    {
        $v = Versiones::version($versionId);
        $lineas = array_values(array_filter(preg_split('/\r\n|\r|\n/', $texto), fn ($l) => trim($l) !== '' && ! str_starts_with(ltrim($l), '#')));
        if ($lineas && preg_match('/^\s*"?concepto/i', $lineas[0])) {
            array_shift($lineas);
        }
        if (! $lineas) {
            RuleError::fail('RN-PRS-01', 'No hay filas para cargar.');
        }
        if (count($lineas) > self::MAX_FILAS) {
            RuleError::fail('RN-PRS-01', 'El archivo tiene más de '.self::MAX_FILAS.' filas: divídelo en partes.');
        }
        $conceptos = DB::table('budget_concepts')->get()->keyBy(fn ($c) => strtoupper($c->code));
        $marcas = DB::table('brands')->get(['id', 'code'])->keyBy(fn ($x) => strtoupper($x->code));
        $locales = DB::table('establishments')->get(['id', 'code'])->keyBy(fn ($x) => strtoupper($x->code));
        $centros = DB::table('cost_centers')->get(['id', 'code'])->keyBy(fn ($x) => strtoupper($x->code));
        $meses = Base::meses((int) $v->year);
        $sep = str_contains($lineas[0], ';') ? ';' : (str_contains($lineas[0], "\t") ? "\t" : ',');
        $filas = [];
        $errores = [];
        $vistos = [];
        $total = 0.0;
        foreach ($lineas as $k => $linea) {
            $n = $k + 1;
            [$cod, $mes, $marca, $local, $cc, $importe, $nota] = array_pad(array_map(fn ($s) => trim($s, " \t\"'"), explode($sep, $linea)), 7, '');
            $err = function (string $code, string $msg) use (&$errores, $n) {
                $errores[] = ['fila' => $n, 'code' => $code, 'mensaje' => $msg];
            };
            $c = $conceptos[strtoupper($cod)] ?? null;
            $mesIso = null;
            if (preg_match('/^\d{1,2}$/', $mes) && (int) $mes >= 1 && (int) $mes <= 12) {
                $mesIso = $meses[array_search(sprintf('%02d', (int) $mes), array_map(fn ($m) => substr($m, 5, 2), $meses), true)];
            } elseif (preg_match('/^(\d{4})-(\d{1,2})(-\d{1,2})?$/', $mes, $mm)) {
                $mesIso = sprintf('%04d-%02d-01', $mm[1], $mm[2]);
            } elseif (preg_match('/^(\d{1,2})\/(\d{4})$/', $mes, $mm)) {
                $mesIso = sprintf('%04d-%02d-01', $mm[2], $mm[1]);
            }
            $monto = str_replace([' ', 'S/', 's/'], '', $importe);
            if (preg_match('/^-?\d{1,3}(\.\d{3})+(,\d+)?$/', $monto)) {
                $monto = str_replace(['.', ','], ['', '.'], $monto);
            } elseif (preg_match('/^-?\d+,\d{1,2}$/', $monto)) {
                $monto = str_replace(',', '.', $monto);
            } else {
                $monto = str_replace(',', '', $monto);
            }
            $antes = count($errores);
            if (! $c || $c->is_group) {
                $err('RN-PRS-01', $cod === '' ? 'Falta el concepto.' : "El concepto «{$cod}» no existe o es un grupo.");
            } elseif ($c->status !== 'ACTIVE') {
                $err('RN-PRS-01', "El concepto {$c->code} está inactivo.");
            }
            if (! $mesIso || ! in_array($mesIso, $meses, true)) {
                $err('RN-PRS-01', "El mes «{$mes}» no es del año presupuestal {$v->year} (usa 1 a 12 o AAAA-MM).");
            }
            if ($monto === '' || ! is_numeric($monto)) {
                $err('RN-PRS-11', "El importe «{$importe}» no es un número.");
            } elseif ((float) $monto < 0) {
                $err('RN-PRS-11', 'El importe '.Base::soles((float) $monto, 2).' es negativo: los importes son en soles, sin IGV y no negativos.');
            }
            $dims = ['brand_id' => null, 'establishment_id' => null, 'cost_center_id' => null];
            foreach ([[$marca, $marcas, 'brand_id', 'La marca'], [$local, $locales, 'establishment_id', 'El local'], [$cc, $centros, 'cost_center_id', 'El centro de costo']] as [$val, $lista, $campo, $nombre]) {
                if ($val !== '') {
                    $x = $lista[strtoupper($val)] ?? null;
                    $x ? $dims[$campo] = $x->id : $err('RN-PRS-01', "{$nombre} «{$val}» no existe.");
                }
            }
            if ($marca === '' && $local === '' && $cc === '') {
                $err('RN-PRS-01', 'Falta al menos una dimensión: marca, local o centro de costo.');
            }
            if (count($errores) > $antes) {
                continue;
            }
            $fila = ['concept_id' => $c->id, 'month' => $mesIso, 'amount' => Base::r((float) $monto), 'note' => $nota !== '' ? mb_substr($nota, 0, 500) : null] + $dims;
            $k2 = Ejecucion::clave($fila).'|'.$mesIso;
            if (isset($vistos[$k2])) {
                $err('RN-PRS-13', "Repite concepto, mes y dimensiones de la fila {$vistos[$k2]}: una sola línea por combinación.");

                continue;
            }
            $vistos[$k2] = $n;
            $total += $fila['amount'];
            $filas[] = ['fila' => $n, 'concepto' => $c->code.' · '.$c->name, 'mes' => $mesIso, 'marca' => $marca ?: null, 'local' => $local ?: null, 'centro' => $cc ?: null] + $fila;
        }

        return ['filas' => $filas, 'errores' => $errores, 'validas' => count($filas), 'total' => Base::r($total)];
    }

    /** Graba las filas si todas son válidas. */
    public static function importar(string $versionId, string $texto, User $u): array
    {
        $v = Versiones::version($versionId);
        if (! Versiones::editable($v)) {
            RuleError::fail('RN-PRS-04', Versiones::etiqueta($v).' no está en borrador: no se cargan líneas.');
        }
        if (! \App\Support\Access::can($u, 'prs.budget.edit')) {
            RuleError::fail('RN-PRS-04', 'Cargar líneas es de Administración (prs.budget.edit).');
        }
        $r = self::revisar($versionId, $texto);
        if ($r['errores']) {
            $e = $r['errores'][0];
            RuleError::fail($e['code'], count($r['errores'])." fila(s) con error. Fila {$e['fila']}: {$e['mensaje']}");
        }

        return DB::transaction(function () use ($v, $r, $u) {
            foreach ($r['filas'] as $f) {
                Versiones::guardarLinea($v->id, $f, $u);
            }
            $fresca = Versiones::version($v->id);
            DB::table('budget_versions')->where('id', $v->id)->update(['source' => 'IMPORT',
                'history' => Base::historia($fresca->history, $u, "Cargadas {$r['validas']} líneas desde Excel (".Base::soles($r['total']).')'), 'updated_at' => now()]);

            return ['lineas' => $r['validas'], 'total' => $r['total']];
        });
    }
}
