<?php

namespace App\Modulos\Plt\Services;

use App\Modulos\Plt\Models\CostCenter;
use App\Support\Params;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * Centros de costo en árbol (RN-PLT-21). Otros módulos (gastos, planilla, equipos…) imputan a un
 * centro activo:
 *   CentrosCosto::activo($costCenterId);
 */
final class CentrosCosto
{
    /** El centro existe y está activo: se le puede imputar un gasto o costo nuevo. */
    public static function activo(string $id): CostCenter
    {
        $cc = CostCenter::find($id) ?? RuleError::fail('RN-PLT-21', 'El centro de costo no existe.');
        if ($cc->status !== 'ACTIVE') {
            RuleError::fail('RN-PLT-21', "El centro de costo {$cc->code} · {$cc->name} está inactivo: no admite gastos ni costos nuevos.");
        }

        return $cc;
    }

    /** Niveles que admite el árbol (plt_cost_center_max_depth, 4 por defecto). */
    public static function maximo(): int
    {
        return (int) (Params::get('plt_cost_center_max_depth') ?? 4);
    }

    /**
     * Nivel de cada centro (1 = raíz) en un solo recorrido: [id => nivel]. Un ciclo o un padre que
     * no existe cuenta como raíz, para no quedar en un bucle.
     */
    public static function niveles(): array
    {
        $padres = DB::table('cost_centers')->pluck('parent_id', 'id')->all();
        $niveles = [];
        foreach (array_keys($padres) as $id) {
            $nivel = 0;
            $visto = [];
            for ($actual = $id; $actual !== null && array_key_exists($actual, $padres); $actual = $padres[$actual]) {
                if (isset($visto[$actual])) {
                    break;
                }
                $visto[$actual] = true;
                $nivel++;
            }
            $niveles[$id] = max($nivel, 1);
        }

        return $niveles;
    }

    /**
     * Revisa que el padre elegido no forme un ciclo ni pase el máximo de niveles, contando los
     * hijos que ya tiene el centro que se mueve.
     */
    public static function validarPadre(?string $id, ?string $parentId): void
    {
        if (! $parentId) {
            return;
        }
        $padres = DB::table('cost_centers')->pluck('parent_id', 'id')->all();
        if ($id !== null && $parentId === $id) {
            RuleError::fail('RN-PLT-21', 'Un centro de costo no puede depender de sí mismo.');
        }
        // Subir desde el padre: si aparece el mismo centro, el padre está debajo de él.
        $nivelPadre = 0;
        for ($actual = $parentId; $actual !== null && array_key_exists($actual, $padres); $actual = $padres[$actual]) {
            if ($actual === $id) {
                RuleError::fail('RN-PLT-21', 'El centro elegido como padre está debajo de este: se formaría un ciclo.');
            }
            if (++$nivelPadre > 50) {
                break;
            }
        }
        // Bajar desde el centro: cuántos niveles de hijos lleva consigo.
        $debajo = 0;
        if ($id !== null) {
            $hijos = [];
            foreach ($padres as $hijo => $padre) {
                $hijos[$padre][] = $hijo;
            }
            $medir = function (string $nodo, int $prof) use (&$medir, $hijos): int {
                if ($prof > 50 || empty($hijos[$nodo])) {
                    return 0;
                }

                return 1 + max(array_map(fn ($h) => $medir($h, $prof + 1), $hijos[$nodo]));
            };
            $debajo = $medir($id, 0);
        }
        $total = $nivelPadre + 1 + $debajo;
        $max = self::maximo();
        if ($total > $max) {
            RuleError::fail('RN-PLT-21', "El árbol admite como máximo {$max} niveles: así quedaría con {$total}.");
        }
    }
}
