<?php

namespace App\Support;

use Illuminate\Database\Query\Builder;
use Illuminate\Pagination\LengthAwarePaginator;

/**
 * Páginas con el mismo contrato que Listado ({ data, current_page, last_page, per_page, total }) para las listas que
 * tienen sus propios filtros y orden: se pagina la consulta ya armada (o una lista calculada en PHP) y cada fila se
 * presenta con $map. ?page=N&per_page=M (25 por defecto, máximo 100).
 *
 * Orden por columna: ?sort=campo o ?sort=-campo (descendente). Solo se aceptan los campos de la lista que pasa cada
 * pantalla, cada uno con su columna o expresión SQL fija: el valor de la URL nunca llega al SQL.
 */
final class Paginas
{
    public const POR_DEFECTO = 25;

    public static function porPagina(array $f = []): int
    {
        return max(1, min((int) ($f['per_page'] ?? request()->query('per_page', self::POR_DEFECTO)), Listado::MAX_POR_PAGINA));
    }

    /**
     * Aplica ?sort= si es uno de los campos permitidos (campo => columna o expresión SQL fija) y desempata con $desempate.
     * Sin ?sort= (o con uno desconocido) deja el orden que ya traía la consulta.
     */
    public static function ordenar(Builder $q, array $campos, string $desempate, array $f = []): Builder
    {
        $sort = (string) ($f['sort'] ?? request()->query('sort', ''));
        $campo = ltrim($sort, '-');
        if ($campo === '' || ! isset($campos[$campo])) {
            return $q;
        }
        $dir = str_starts_with($sort, '-') ? 'DESC' : 'ASC';

        return $q->reorder()->orderByRaw("{$campos[$campo]} {$dir} NULLS LAST")->orderBy($desempate);
    }

    /** Ordena una lista ya calculada por ?sort= si el campo está entre los permitidos. */
    public static function ordenarLista(array $filas, array $campos, array $f = []): array
    {
        $sort = (string) ($f['sort'] ?? request()->query('sort', ''));
        $campo = ltrim($sort, '-');
        if ($campo === '' || ! in_array($campo, $campos, true)) {
            return $filas;
        }
        $signo = str_starts_with($sort, '-') ? -1 : 1;
        usort($filas, function ($a, $b) use ($campo, $signo) {
            $x = $a[$campo] ?? null;
            $y = $b[$campo] ?? null;
            if ($x === $y) {
                return 0;
            }
            if ($x === null) {
                return 1;   // vacíos al final
            }
            if ($y === null) {
                return -1;
            }

            return (is_string($x) ? strcoll(mb_strtolower($x), mb_strtolower((string) $y)) : $x <=> $y) * $signo;
        });

        return $filas;
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
