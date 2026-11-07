<?php

namespace App\Modulos\Plt\Services;

use App\Models\User;
use App\Support\Events;
use App\Support\Params;
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
 * Cerrar y reabrir (PLT-09, y CNT cuando esté encendido) también pasan por aquí.
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

    /**
     * Cierra un mes (RN-PLT-17): ya terminado y con el anterior cerrado. Si el mes no tenía
     * registro, lo crea. Deja el cierre en el historial y emite period.closed.
     */
    public static function cerrar(string $companyId, DateTimeInterface|string $periodo, User $quien, ?string $nota = null): object
    {
        $mes = self::mes($periodo);

        return DB::transaction(function () use ($companyId, $mes, $quien, $nota) {
            $filas = DB::table('accounting_periods')->where('company_id', $companyId)->where('period', '<=', $mes->toDateString())
                ->orderBy('period')->lockForUpdate()->get()->keyBy(fn ($p) => substr($p->period, 0, 10));
            $fila = $filas->get($mes->toDateString());

            if ($fila?->status === 'CLOSED') {
                RuleError::fail('RN-PLT-17', ucfirst(self::nombre($mes)).' ya está cerrado.');
            }
            if ($mes->greaterThanOrEqualTo(self::hoy()->startOfMonth())) {
                RuleError::fail('RN-PLT-17', ucfirst(self::nombre($mes)).' aún está en curso: se cierra desde el mes siguiente.');
            }
            // El mes anterior debe estar cerrado. Si no tiene registro pero hay meses antes, cuenta como abierto.
            $anterior = $mes->subMonth();
            $filaAnterior = $filas->get($anterior->toDateString());
            $hayAntes = $filas->keys()->contains(fn ($k) => $k < $mes->toDateString());
            if ($filaAnterior ? $filaAnterior->status !== 'CLOSED' : $hayAntes) {
                RuleError::fail('RN-PLT-17', 'Primero cierra '.self::nombre($anterior).': los períodos se cierran en orden.');
            }

            $ahora = now();
            // La fecha límite vigente hoy queda guardada: si después cambia el día de cierre, este mes no se reevalúa.
            $datos = ['status' => 'CLOSED', 'closed_at' => $ahora, 'closed_by' => mb_substr($quien->name, 0, 40), 'close_due_date' => self::meta($mes)->toDateString(), 'updated_at' => $ahora];
            if ($fila) {
                DB::table('accounting_periods')->where('id', $fila->id)->update($datos);
                $id = $fila->id;
            } else {
                $id = DB::table('accounting_periods')->insertGetId(['company_id' => $companyId, 'period' => $mes->toDateString()] + $datos, 'id');
            }
            self::evento($id, $mes, 'CLOSE', trim((string) $nota) ?: 'Cierre mensual', $quien, $ahora);
            Events::emit('period.closed', 'accounting_periods', $id, ['company_id' => $companyId, 'period' => $mes->toDateString()]);

            return DB::table('accounting_periods')->find($id);
        });
    }

    /**
     * Reabre un mes cerrado (RN-PLT-18): con motivo y sin meses posteriores cerrados. Queda en el
     * historial y emite period.reopened.
     */
    public static function reabrir(string $periodoId, User $quien, string $motivo): object
    {
        $minimo = (int) (Params::get('plt_parameter_reason_min_length') ?? 10);
        $motivo = trim($motivo);
        if (mb_strlen($motivo) < $minimo) {
            RuleError::fail('RN-PLT-18', "Reabrir exige un motivo de al menos {$minimo} caracteres.");
        }

        return DB::transaction(function () use ($periodoId, $quien, $motivo) {
            $p = DB::table('accounting_periods')->where('id', $periodoId)->lockForUpdate()->first()
                ?? RuleError::fail('RN-PLT-18', 'Período no encontrado.');
            $mes = self::mes(substr($p->period, 0, 10));
            if ($p->status !== 'CLOSED') {
                RuleError::fail('RN-PLT-18', ucfirst(self::nombre($mes)).' no está cerrado.');
            }
            $posterior = DB::table('accounting_periods')->where('company_id', $p->company_id)->where('period', '>', $p->period)
                ->where('status', 'CLOSED')->orderByDesc('period')->value('period');
            if ($posterior) {
                RuleError::fail('RN-PLT-18', 'No se puede reabrir: '.self::nombre(substr($posterior, 0, 10)).' (posterior) está cerrado. Reabre primero los meses posteriores.');
            }

            $ahora = now();
            DB::table('accounting_periods')->where('id', $p->id)
                ->update(['status' => 'OPEN', 'closed_at' => null, 'closed_by' => null, 'close_due_date' => null, 'updated_at' => $ahora]);
            self::evento($p->id, $mes, 'REOPEN', mb_substr($motivo, 0, 255), $quien, $ahora);
            Events::emit('period.reopened', 'accounting_periods', $p->id, ['company_id' => $p->company_id, 'period' => $mes->toDateString(), 'reason' => $motivo]);

            return DB::table('accounting_periods')->find($p->id);
        });
    }

    /**
     * Último día para cerrar un mes a tiempo (KPI-PLT-01): el día plt_period_close_day del mes
     * siguiente.
     */
    public static function meta(DateTimeInterface|string $periodo): CarbonImmutable
    {
        $dia = (int) (Params::get('plt_period_close_day') ?? 5);

        return self::mes($periodo)->addMonth()->addDays(max($dia, 1) - 1);
    }

    /** «setiembre de 2026». */
    public static function nombre(DateTimeInterface|string $fecha): string
    {
        $mes = self::mes($fecha);

        return self::MESES[$mes->month - 1].' de '.$mes->year;
    }

    /** Hoy en Lima. */
    public static function hoy(): CarbonImmutable
    {
        return CarbonImmutable::now('America/Lima')->startOfDay();
    }

    private static function evento(string $periodoId, CarbonImmutable $mes, string $accion, string $motivo, User $quien, $cuando): void
    {
        DB::table('accounting_period_events')->insert([
            'period_id' => $periodoId, 'period' => $mes->toDateString(), 'action' => $accion, 'reason' => $motivo,
            'acted_by' => $quien->id, 'acted_by_name' => mb_substr($quien->name, 0, 40), 'acted_at' => $cuando,
        ]);
    }

    /** Primer día del mes, en hora de Lima (una fecha con hora se lleva a Lima antes de tomar el mes). */
    private static function mes(DateTimeInterface|string $fecha): CarbonImmutable
    {
        $f = is_string($fecha) && preg_match('/^\d{4}-\d{2}(-\d{2})?$/', $fecha)
            ? CarbonImmutable::createFromFormat('!Y-m-d', strlen($fecha) === 7 ? "{$fecha}-01" : $fecha, 'America/Lima')
            : CarbonImmutable::parse($fecha)->setTimezone('America/Lima');

        return $f->startOfMonth();
    }
}
