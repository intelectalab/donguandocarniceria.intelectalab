<?php

namespace App\Modulos\Equ\Http\Controllers;

use App\Support\Access;
use Illuminate\Database\Query\Builder;
use Illuminate\Http\Request;

/** Alcance por local para las rutas de EQU: cada usuario ve los equipos de sus locales. */
trait Alcance
{
    /** Filtra por los locales del usuario y por el local elegido (?establishment_id o ?site). */
    protected function porLocal(Builder $q, Request $r, string $columna): Builder
    {
        $locales = Access::for($r->user())['establishments'];
        $elegido = $r->query('establishment_id') ?: $r->query('site');

        return $q->when($locales, fn ($x) => $x->whereIn($columna, $locales))
            ->when($elegido && $elegido !== 'ALL', fn ($x) => $x->where($columna, $elegido));
    }

    /** Locales que cuentan para las cifras: el elegido, o los del usuario (vacío = todos). */
    protected function locales(Request $r): array
    {
        $locales = Access::for($r->user())['establishments'];
        $elegido = $r->query('establishment_id') ?: $r->query('site');
        if ($elegido && $elegido !== 'ALL') {
            return ! $locales || in_array($elegido, $locales, true) ? [$elegido] : ['00000000-0000-0000-0000-000000000000'];
        }

        return $locales;
    }

    /** Ficha de un equipo fuera del alcance: 404, igual que en las listas. */
    protected function dentroDelAlcance(Request $r, ?string $localId): void
    {
        $locales = Access::for($r->user())['establishments'];
        if ($localId && $locales && ! in_array($localId, $locales, true)) {
            abort(404);
        }
    }
}
