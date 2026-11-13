<?php

namespace App\Modulos\Rec\Http\Controllers;

use App\Support\Access;
use Illuminate\Database\Query\Builder;
use Illuminate\Http\Request;

/** Alcance por marca, costos con permiso y la receta reservada (D-REC-02) para las rutas de REC. */
trait Alcance
{
    /** Filtra por las marcas del usuario y por la marca elegida (?brand). */
    protected function porMarca(Builder $q, Request $r, string $columna): Builder
    {
        $marcas = Access::for($r->user())['brands'];
        $elegida = $r->query('brand_id') ?: $r->query('brand');

        return $q->when($marcas, fn ($x) => $x->whereIn($columna, $marcas))
            ->when($elegida && $elegida !== 'ALL', fn ($x) => $x->where($columna, $elegida));
    }

    /** Ficha de una marca fuera del alcance: 404, igual que en las listas. */
    protected function dentroDelAlcance(Request $r, ?string $brandId): void
    {
        $marcas = Access::for($r->user())['brands'];
        if ($brandId && $marcas && ! in_array($brandId, $marcas, true)) {
            abort(404);
        }
    }

    protected function verCostos(Request $r): bool
    {
        return Access::can($r->user(), 'rec.cost.view');
    }

    /**
     * D-REC-02: los operarios ven los kg de su orden (el escalado), no la receta completa ni el costo.
     * Ve la receta quien la edita, la aprueba o ve su costo, y el auditor (que lee todo).
     */
    protected function verReceta(Request $r): bool
    {
        $u = $r->user();

        return Access::can($u, 'rec.version.edit') || Access::can($u, 'rec.version.approve') || Access::can($u, 'rec.cost.view')
            || in_array('AUDITOR', Access::for($u)['roles'], true);
    }

    protected function exigirReceta(Request $r): void
    {
        if (! $this->verReceta($r)) {
            abort(response()->json(['message' => 'La receta completa es reservada: en producción ves los kg de tu orden.', 'code' => 'D-REC-02'], 403));
        }
    }

    /** @param  array<int, string>  $campos */
    protected function sinCostos(Request $r, iterable $filas, array $campos): void
    {
        if ($this->verCostos($r)) {
            return;
        }
        foreach ($filas as $f) {
            foreach ($campos as $c) {
                if (is_object($f) && property_exists($f, $c)) {
                    $f->{$c} = null;
                }
            }
        }
    }
}
