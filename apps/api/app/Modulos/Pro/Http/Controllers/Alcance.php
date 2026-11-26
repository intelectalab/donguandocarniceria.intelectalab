<?php

namespace App\Modulos\Pro\Http\Controllers;

use App\Support\Access;
use Illuminate\Database\Query\Builder;
use Illuminate\Http\Request;

/** Alcance por local para PRO, DES, CAL y ETQ (RN-PRO-09): cada usuario ve lo de sus locales. */
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

    /** Un registro fuera del alcance: 404, igual que en las listas. */
    protected function dentroDelAlcance(Request $r, ?string $localId): void
    {
        $locales = Access::for($r->user())['establishments'];
        if ($localId && $locales && ! in_array($localId, $locales, true)) {
            abort(404);
        }
    }

    protected function puede(Request $r, string $permiso): bool
    {
        return Access::can($r->user(), $permiso);
    }
}
