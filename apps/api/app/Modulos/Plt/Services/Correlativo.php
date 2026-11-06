<?php

namespace App\Modulos\Plt\Services;

use App\Modulos\Plt\Models\DocumentSeries;
use App\Support\RuleError;
use Closure;
use Illuminate\Support\Facades\DB;

/**
 * Numeración de documentos (RN-PLT-03). El número se toma al emitir, en la misma transacción que
 * guarda el documento: si la emisión falla, el número no se consume y lo usa el siguiente. Dos
 * emisiones a la vez en la misma serie esperan su turno (bloqueo de la fila), así no hay saltos
 * ni duplicados.
 *
 *   $boleta = Correlativo::emitir($serieId, function (DocumentSeries $serie, int $numero) use ($datos) {
 *       return SalesDocument::create($datos + [
 *           'series_id' => $serie->id, 'series' => $serie->series, 'number' => $numero,
 *           'full_number' => Correlativo::numeroCompleto($serie->series, $numero),
 *       ]);
 *   });
 */
final class Correlativo
{
    /** Último número que admite una serie (8 dígitos, como SUNAT). */
    public const MAXIMO = 99_999_999;

    /**
     * Toma el siguiente número de la serie y llama a $emitir con él. Devuelve lo que devuelva $emitir.
     *
     * @template T
     *
     * @param  Closure(DocumentSeries, int): T  $emitir
     * @return T
     */
    public static function emitir(string $serieId, Closure $emitir): mixed
    {
        return DB::transaction(function () use ($serieId, $emitir) {
            $serie = DocumentSeries::whereKey($serieId)->lockForUpdate()->first()
                ?? RuleError::fail('RN-PLT-03', 'La serie no existe.');
            if ($serie->status !== 'ACTIVE') {
                RuleError::fail('RN-PLT-03', "La serie {$serie->series} está desactivada: no numera documentos nuevos.");
            }
            $numero = $serie->next_number;
            if ($numero > self::MAXIMO) {
                // RN-PLT-20
                RuleError::fail('RN-PLT-20', "La serie {$serie->series} llegó al último número (99 999 999). Crea otra serie.");
            }
            $serie->update(['next_number' => $numero + 1]);

            return $emitir($serie, $numero);
        });
    }

    /** B001 y 694 → B001-00000694. */
    public static function numeroCompleto(string $serie, int $numero): string
    {
        return $serie.'-'.str_pad((string) $numero, 8, '0', STR_PAD_LEFT);
    }

    /** Porcentaje del rango usado (RN-PLT-20 avisa al llegar a plt_series_alert_pct). */
    public static function uso(int $siguiente): float
    {
        return round(($siguiente - 1) / self::MAXIMO * 100, 4);
    }
}
