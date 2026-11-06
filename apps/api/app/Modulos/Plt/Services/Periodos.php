<?php

namespace App\Modulos\Plt\Services;

use App\Support\RuleError;
use Carbon\CarbonImmutable;
use DateTimeInterface;
use Illuminate\Support\Facades\DB;

/**
 * Períodos contables (meses) por empresa. Un mes cerrado no admite documentos con fecha de ese mes
 * (RN-PLT-05). Lo usan todos los módulos que registran algo con fecha: ventas, comprobantes, caja,
 * recepciones de almacén, compras, gastos…
 *
 * Dentro de la misma transacción que guarda el documento:
 *   DB::transaction(function () use ($datos) {
 *       Periodos::abierto($datos['received_at'], $datos['company_id']);
 *       // … guardar el documento
 *   });
 *
 * Un mes sin registro en accounting_periods cuenta como abierto (todavía nadie lo cerró).
 */
final class Periodos
{
    private const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'setiembre', 'octubre', 'noviembre', 'diciembre'];

    /**
     * Falla si el mes de la fecha está cerrado para esa empresa (RN-PLT-05).
     *
     * Bloquea la fila del período en modo compartido: si alguien está cerrando ese mes al mismo
     * tiempo, uno de los dos espera al otro y no entra un documento a un mes recién cerrado.
     */
    public static function abierto(DateTimeInterface|string $fecha, string $companyId): void
    {
        $mes = self::mes($fecha);
        $estado = DB::table('accounting_periods')->where('company_id', $companyId)->where('period', $mes->toDateString())
            ->sharedLock()->value('status');

        if ($estado === 'CLOSED') {
            RuleError::fail('RN-PLT-05', 'El período '.self::nombre($mes).' está cerrado: no se registran documentos con esa fecha. '
                .'Para registrarlo, alguien con permiso debe reabrir el mes, con su motivo, en Períodos.');
        }
    }

    /** Si el mes de la fecha está cerrado, sin fallar (para avisar en pantalla antes de guardar). */
    public static function cerrado(DateTimeInterface|string $fecha, string $companyId): bool
    {
        return DB::table('accounting_periods')->where('company_id', $companyId)
            ->where('period', self::mes($fecha)->toDateString())->value('status') === 'CLOSED';
    }

    /** «setiembre de 2026». */
    public static function nombre(DateTimeInterface|string $fecha): string
    {
        $mes = self::mes($fecha);

        return self::MESES[$mes->month - 1].' de '.$mes->year;
    }

    /** Primer día del mes, en hora de Lima (una fecha con hora se lleva a Lima antes de tomar el mes). */
    private static function mes(DateTimeInterface|string $fecha): CarbonImmutable
    {
        $f = is_string($fecha) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $fecha)
            ? CarbonImmutable::createFromFormat('!Y-m-d', $fecha, 'America/Lima')
            : CarbonImmutable::parse($fecha)->setTimezone('America/Lima');

        return $f->startOfMonth();
    }
}
