<?php

namespace App\Modulos\Cmp\Http\Controllers;

use App\Models\User;
use App\Support\Access;
use App\Support\RuleError;

/** RN-CMP-19: quien tiene marcas asignadas solo trabaja segmentos, campañas y cupones de esas marcas. */
final class Alcance
{
    /** @return string[]|null null = todas las marcas */
    public static function marcas(User $u): ?array
    {
        $m = Access::for($u)['brands'] ?? [];

        return $m ?: null;
    }

    public static function exigir(User $u, ?string $brandId): void
    {
        $m = self::marcas($u);
        if ($brandId && $m !== null && ! in_array($brandId, $m, true)) {
            RuleError::fail('RN-CMP-19', 'Esa marca no está en tu alcance.');
        }
    }

    public static function filtrar($q, User $u, string $col = 'brand_id')
    {
        $m = self::marcas($u);

        return $m === null ? $q : $q->where(fn ($w) => $w->whereIn($col, $m)->orWhereNull($col));
    }
}
