<?php

namespace App\Modulos\Com\Http\Controllers;

use App\Support\Access;
use Illuminate\Database\Query\Builder;
use Illuminate\Http\Request;

/** Alcance por local para las rutas de COM: órdenes, recepciones y comprobantes de los locales del usuario. */
trait Alcance
{
    protected function porLocal(Builder $q, Request $r, string $columna): Builder
    {
        $locales = Access::for($r->user())['establishments'];
        $elegido = $r->query('establishment_id') ?: $r->query('site');

        return $q->when($locales, fn ($x) => $x->where(fn ($y) => $y->whereIn($columna, $locales)->orWhereNull($columna)))
            ->when($elegido && $elegido !== 'ALL', fn ($x) => $x->where($columna, $elegido));
    }

    /** Ficha fuera del alcance: 404, igual que en las listas. */
    protected function dentroDelAlcance(Request $r, ?string $localId): void
    {
        $locales = Access::for($r->user())['establishments'];
        if ($localId && $locales && ! in_array($localId, $locales, true)) {
            abort(404);
        }
    }
}
