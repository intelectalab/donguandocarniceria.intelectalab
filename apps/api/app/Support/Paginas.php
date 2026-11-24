<?php

namespace App\Support;

use Illuminate\Database\Query\Builder;
use Illuminate\Pagination\LengthAwarePaginator;

/**
 * Páginas con el mismo contrato que Listado ({ data, current_page, last_page, per_page, total }) para las listas que
 * tienen sus propios filtros y orden: se pagina la consulta ya armada (o una lista calculada en PHP) y cada fila se
 * presenta con $map. ?page=N&per_page=M (25 por defecto, máximo 100).
 */
final class Paginas
{
    public const POR_DEFECTO = 25;

    public static function porPagina(array $f = []): int
    {
        return max(1, min((int) ($f['per_page'] ?? request()->query('per_page', self::POR_DEFECTO)), Listado::MAX_POR_PAGINA));
    }

    /** Pagina una consulta y presenta cada fila. */
    public static function de(Builder $q, callable $map, array $f = []): array
    {
        return self::arreglo($q->paginate(self::porPagina($f))->through($map));
    }

    /** Pagina una lista ya calculada (por ejemplo, la cola de mora). */
    public static function deLista(array $filas, array $f = []): array
    {
        $porPagina = self::porPagina($f);
        $pagina = max(1, (int) request()->query('page', 1));

        return self::arreglo(new LengthAwarePaginator(array_slice($filas, ($pagina - 1) * $porPagina, $porPagina), count($filas), $porPagina, $pagina));
    }

    private static function arreglo(LengthAwarePaginator $p): array
    {
        return ['data' => array_values($p->items()), 'current_page' => $p->currentPage(), 'last_page' => $p->lastPage(), 'per_page' => $p->perPage(), 'total' => $p->total()];
    }
}
