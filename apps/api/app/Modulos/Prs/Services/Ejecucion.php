<?php

namespace App\Modulos\Prs\Services;

use Illuminate\Support\Facades\DB;

/**
 * Presupuesto frente a real por línea (PRS-06, 07, 08 y 10). Cada fila del real se asigna a la línea más específica de su concepto
 * cuyas dimensiones coinciden (una línea sin marca recoge todas las marcas); lo que no cae en ninguna línea queda «sin línea
 * presupuestal». Así un documento cuenta una sola vez (RN-PRS-06).
 */
final class Ejecucion
{
    public static function clave(array|object $l): string
    {
        $l = (array) $l;

        return implode('|', [$l['concept_id'], $l['brand_id'] ?? '', $l['establishment_id'] ?? '', $l['cost_center_id'] ?? '']);
    }

    private static function coincide(array $s, array $r): bool
    {
        return (! $s['brand_id'] || $s['brand_id'] === ($r['brand_id'] ?? null))
            && (! $s['establishment_id'] || $s['establishment_id'] === ($r['establishment_id'] ?? null))
            && (! $s['cost_center_id'] || $s['cost_center_id'] === ($r['cost_center_id'] ?? null));
    }

    private static function especificidad(array $s): int
    {
        return ($s['brand_id'] ? 1 : 0) + ($s['establishment_id'] ? 1 : 0) + ($s['cost_center_id'] ? 1 : 0);
    }

    /**
     * @param  string|null  $versionId  versión con las líneas (null: solo real)
     * @param  string[]  $meses  meses (Y-m-01)
     * @return array{slots: array, sin_mapeo: array, estados: array}
     */
    public static function calcular(?string $versionId, array $meses, string $al, string $empresa, bool $conFilas = false, bool $sinLinea = true, ?array $alcance = null): array
    {
        $conceptos = Conceptos::porId();
        $slots = [];
        $nuevo = function (array $src, bool $sinLinea) use (&$slots, $conceptos) {
            $k = self::clave($src).($sinLinea ? '|*' : '');
            if (! isset($slots[$k])) {
                $c = $conceptos[$src['concept_id']] ?? null;
                $slots[$k] = ['key' => $k, 'concept_id' => $src['concept_id'], 'type' => $c['concept_type'] ?? 'EXPENSE', 'fixed' => ($c['behavior'] ?? null) === 'FIXED',
                    'brand_id' => $src['brand_id'] ?? null, 'establishment_id' => $src['establishment_id'] ?? null, 'cost_center_id' => $src['cost_center_id'] ?? null,
                    'budget' => 0.0, 'actual' => 0.0, 'forecast' => 0.0, 'unbudgeted' => $sinLinea, 'months' => [], 'rows' => []];
            }

            return $k;
        };
        $mes0 = fn () => ['budget' => 0.0, 'actual' => 0.0, 'forecast' => 0.0];
        if ($versionId) {
            foreach (DB::table('budget_lines')->where('version_id', $versionId)->whereIn('month', $meses)->get() as $l) {
                $l = (array) $l;
                if (! Base::visible($alcance, $l)) {
                    continue;
                }
                $k = $nuevo($l, false);
                $slots[$k]['budget'] += (float) $l['amount'];
                $slots[$k]['months'][$l['month']] ??= $mes0();
                $slots[$k]['months'][$l['month']]['budget'] += (float) $l['amount'];
            }
        }
        $porConcepto = [];
        foreach ($slots as $k => $s) {
            $porConcepto[$s['concept_id']][] = $k;
        }
        foreach ($porConcepto as &$ks) {
            usort($ks, fn ($a, $b) => self::especificidad($slots[$b]) <=> self::especificidad($slots[$a]));
        }
        unset($ks);

        $estados = [];
        $idx = Conceptos::indice();
        foreach ($meses as $m) {
            $estados[$m] = Real::estadoMes($m, $al, $empresa);
            if ($estados[$m] === 'FUTURE') {
                continue;
            }
            foreach (Real::filas($m, $al, $empresa, $idx) as $r) {
                if (! Base::visible($alcance, $r)) {
                    continue;
                }
                $k = null;
                foreach ($porConcepto[$r['concept_id']] ?? [] as $cand) {
                    if (self::coincide($slots[$cand], $r)) {
                        $k = $cand;
                        break;
                    }
                }
                if ($k === null) {
                    if (! $sinLinea && ! str_starts_with((string) $r['concept_id'], '__')) {
                        continue;
                    }
                    $k = $nuevo($r, true);
                }
                $slots[$k]['actual'] += $r['amount'];
                $slots[$k]['months'][$m] ??= $mes0();
                $slots[$k]['months'][$m]['actual'] += $r['amount'];
                if ($conFilas) {
                    $slots[$k]['rows'][] = ['month' => $m] + $r;
                }
            }
        }
        foreach ($slots as &$s) {
            foreach ($meses as $m) {
                $x = $s['months'][$m] ?? $mes0();
                $x['forecast'] = match ($estados[$m]) {
                    'FUTURE' => $x['budget'],
                    'CURRENT' => Base::proyeccion($x['actual'], $x['budget'], Base::transcurridos($m, $al), Base::diasDelMes($m), $s['fixed']),
                    default => $x['actual'],
                };
                $x['budget'] = Base::r($x['budget']);
                $x['actual'] = Base::r($x['actual']);
                $x['forecast'] = Base::r($x['forecast']);
                $s['forecast'] += $x['forecast'];
                $s['months'][$m] = $x;
            }
            $s['budget'] = Base::r($s['budget']);
            $s['actual'] = Base::r($s['actual']);
            $s['forecast'] = Base::r($s['forecast']);
        }
        unset($s);
        $todos = array_values($slots);

        return [
            'slots' => array_values(array_filter($todos, fn ($s) => ! str_starts_with((string) $s['concept_id'], '__'))),
            'sin_mapeo' => array_values(array_filter($todos, fn ($s) => str_starts_with((string) $s['concept_id'], '__'))),
            'estados' => $estados,
        ];
    }

    /** Agrupa por concepto y una dimensión (concepto, marca, local o centro). */
    public static function agrupar(array $slots, string $dim = 'concepto'): array
    {
        $campo = ['marca' => 'brand_id', 'local' => 'establishment_id', 'centro' => 'cost_center_id'][$dim] ?? null;
        $conceptos = Conceptos::porId();
        $g = [];
        foreach ($slots as $s) {
            $dv = $campo ? ($s[$campo] ?? '') : '';
            $k = $s['concept_id'].'|'.$dv;
            $g[$k] ??= ['key' => $k, 'concept_id' => $s['concept_id'], 'type' => $s['type'], 'dim' => $dim, 'dim_value' => $dv ?: null,
                'budget' => 0.0, 'actual' => 0.0, 'forecast' => 0.0, 'sin_linea' => 0.0];
            $g[$k]['budget'] += $s['budget'];
            $g[$k]['actual'] += $s['actual'];
            $g[$k]['forecast'] += $s['forecast'];
            if ($s['unbudgeted']) {
                $g[$k]['sin_linea'] += $s['actual'];
            }
        }
        $out = array_map(function ($x) {
            foreach (['budget', 'actual', 'forecast', 'sin_linea'] as $c) {
                $x[$c] = Base::r($x[$c]);
            }
            $x['diff'] = Base::r($x['actual'] - $x['budget']);
            $x['pct'] = Base::pct($x['actual'], $x['budget']);
            $x['fpct'] = Base::pct($x['forecast'], $x['budget']);
            $x['light'] = Base::semaforoDe($x['budget'], $x['forecast'], $x['type']);   // en el mes en curso, con la proyección

            return $x;
        }, array_values($g));
        usort($out, fn ($a, $b) => (($conceptos[$a['concept_id']]['sort_order'] ?? 999) <=> ($conceptos[$b['concept_id']]['sort_order'] ?? 999))
            ?: strcmp((string) $a['dim_value'], (string) $b['dim_value']));

        return $out;
    }

    /** Totales de ingreso y de gasto (costo de ventas + gastos). */
    public static function totales(array $slots): array
    {
        $t = ['ingreso' => ['budget' => 0.0, 'actual' => 0.0, 'forecast' => 0.0], 'gasto' => ['budget' => 0.0, 'actual' => 0.0, 'forecast' => 0.0]];
        foreach ($slots as $s) {
            $k = $s['type'] === 'INCOME' ? 'ingreso' : 'gasto';
            foreach (['budget', 'actual', 'forecast'] as $c) {
                $t[$k][$c] += $s[$c];
            }
        }
        foreach ($t as &$x) {
            foreach ($x as &$v) {
                $v = Base::r($v);
            }
        }

        return $t;
    }
}
