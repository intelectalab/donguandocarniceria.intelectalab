<?php

namespace App\Support;

use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Database\Eloquent\Builder as EloquentBuilder;
use Illuminate\Database\Query\Builder;
use Illuminate\Http\Request;

/**
 * Listas paginadas con el mismo contrato en todos los módulos (lo consume useListado en la web):
 *   ?q=texto        busca sin distinguir mayúsculas ni tildes en las columnas de $buscar
 *   ?sort=campo     orden ascendente; ?sort=-campo descendente. Solo columnas de $ordenar
 *   ?page=2&per_page=20 (máximo 100)
 * Responde el paginador de Laravel: { data, current_page, last_page, per_page, total, ... }.
 *
 *   return response()->json(Listado::de($query, $request, buscar: ['legal_name', 'ruc'],
 *       ordenar: ['legal_name', 'ruc', 'created_at'], porDefecto: 'legal_name'));
 */
final class Listado
{
    public const MAX_POR_PAGINA = 100;

    /**
     * @param  string[]  $buscar  columnas donde busca ?q
     * @param  string[]  $ordenar  columnas por las que se permite ordenar (lo demás se ignora)
     * @param  string  $porDefecto  orden sin ?sort, con el mismo formato ('campo' o '-campo')
     */
    public static function de(
        Builder|EloquentBuilder $query,
        Request $request,
        array $buscar = [],
        array $ordenar = [],
        string $porDefecto = '-created_at',
    ): LengthAwarePaginator {
        $q = trim((string) $request->query('q', ''));
        if ($q !== '' && $buscar) {
            $patron = '%'.addcslashes(mb_strtolower($q), '%_\\').'%';
            $query->where(function ($w) use ($buscar, $patron) {
                foreach ($buscar as $columna) {
                    // unaccent no está instalado: se compara en minúsculas y sin tildes con translate.
                    $w->orWhereRaw(
                        "translate(lower({$columna}::text), 'áéíóúüñ', 'aeiouun') like translate(?, 'áéíóúüñ', 'aeiouun')",
                        [$patron]
                    );
                }
            });
        }

        [$campo, $direccion] = self::orden((string) $request->query('sort', ''), $ordenar)
            ?? self::orden($porDefecto, [ltrim($porDefecto, '-')]);
        $query->orderBy($campo, $direccion);

        $porPagina = max(1, min((int) $request->query('per_page', 20), self::MAX_POR_PAGINA));

        return $query->paginate($porPagina)->withQueryString();
    }

    /** @return array{0: string, 1: string}|null */
    private static function orden(string $sort, array $permitidas): ?array
    {
        $campo = ltrim($sort, '-');

        return $campo !== '' && in_array($campo, $permitidas, true)
            ? [$campo, str_starts_with($sort, '-') ? 'desc' : 'asc']
            : null;
    }
}
