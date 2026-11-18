<?php

namespace App\Modulos\Alm\Http\Controllers;

use App\Support\Access;
use Illuminate\Database\Query\Builder;
use Illuminate\Http\Request;

/** Alcance del usuario (locales y marcas) y filtros comunes de las listas de ALM. */
trait Alcance
{
    /** Filtra por los locales del usuario y por el local elegido (?establishment_id o ?site). */
    protected function porLocal(Builder $q, Request $r, string $columna): Builder
    {
        $locales = Access::for($r->user())['establishments'];
        $elegido = $r->query('establishment_id') ?: $r->query('site');

        return $q->when($locales, fn ($x) => $x->where(fn ($y) => $y->whereIn($columna, $locales)->orWhereNull($columna)))
            ->when($elegido && $elegido !== 'ALL', fn ($x) => $x->where($columna, $elegido));
    }

    /** Filtra por las marcas del usuario y por la marca elegida (?brand_id o ?brand). */
    protected function porMarca(Builder $q, Request $r, string $columna): Builder
    {
        $marcas = Access::for($r->user())['brands'];
        $elegida = $r->query('brand_id') ?: $r->query('brand');

        return $q->when($marcas, fn ($x) => $x->whereIn($columna, $marcas))
            ->when($elegida && $elegida !== 'ALL', fn ($x) => $x->where($columna, $elegida));
    }

    protected function verCostos(Request $r): bool
    {
        return Access::can($r->user(), 'alm.stock.view_cost');
    }

    /** @param  array<int, string>  $campos */
    protected function sinCostos(Request $r, iterable $filas, array $campos): void
    {
        if ($this->verCostos($r)) {
            return;
        }
        foreach ($filas as $f) {
            foreach ($campos as $c) {
                if (is_array($f)) {
                    continue;
                }
                $f->{$c} = null;
            }
        }
    }
}
