<?php

namespace App\Modulos\Tab\Services;

use App\Models\User;
use App\Modulos\Tab\Calculadores\Registro;
use App\Support\Events;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * TAB-09 Cierre de indicadores (RN-TAB-03, RN-TAB-10).
 *  - Solo se congela un mes terminado (hora de Lima).
 *  - Cada congelamiento es una corrida numerada; recalcular un mes ya congelado crea la siguiente y pide un motivo de al
 *    menos 10 caracteres. Los valores congelados (kpi_snapshots) son de solo inserción.
 *  - Se congela cada indicador activo con calculador y módulo encendido, para la empresa, cada marca y cada local.
 *  - Si la corrida falla queda FAILED con su error y no reemplaza a la anterior.
 *  - El congelamiento automático (tab:congelar) corre el día tab_snapshot_day (3) del mes siguiente a las 02:00 de Lima.
 */
final class Cierre
{
    public const AUTOMATICO = 'Programador de tareas';

    public static function congelar(string $mes, ?string $motivo, ?User $u, bool $automatico = false): object
    {
        $mes = Base::mes($mes);
        if (! Base::terminado($mes)) {
            RuleError::fail('RN-TAB-03', 'Solo se congela un mes terminado: '.Base::nombreMes($mes).' termina el '.date('d/m/Y', strtotime(Base::finDeMes($mes))).' (hora de Lima).');
        }
        $motivo = trim((string) $motivo);
        $previa = DB::table('kpi_snapshot_runs')->where('period', $mes)->where('status', 'OK')->orderByDesc('run_no')->first();
        if ($previa && mb_strlen($motivo) < 10) {
            RuleError::fail('RN-TAB-03', Base::nombreMes($mes)." ya está congelado (corrida {$previa->run_no}): para recalcularlo escribe un motivo de al menos 10 caracteres.");
        }
        @set_time_limit(600);
        $quien = $automatico ? self::AUTOMATICO : mb_substr($u?->name ?? self::AUTOMATICO, 0, 80);
        $inicio = now();
        // La corrida se numera con un candado por empresa y mes, para que dos personas no saquen el mismo número.
        $run = DB::transaction(function () use ($mes, $motivo, $quien, $inicio, $automatico) {
            DB::select("SELECT pg_advisory_xact_lock(hashtext('kpi_snapshot_runs:' || coalesce(app_tenant_id()::text, '') || ?))", [$mes]);
            $no = (int) DB::table('kpi_snapshot_runs')->where('period', $mes)->max('run_no') + 1;
            $id = DB::table('kpi_snapshot_runs')->insertGetId([
                'period' => $mes, 'run_no' => $no, 'reason' => mb_substr($motivo !== '' ? $motivo : ($automatico ? 'Congelamiento automático (día '.(int) Base::param('tab_snapshot_day', 3).', 02:00)' : 'Congelamiento del mes'), 0, 255),
                'kpis_count' => 0, 'status' => 'RUNNING', 'started_at' => $inicio, 'finished_at' => null, 'user' => $quien, 'created_at' => $inicio,
            ]);

            return DB::table('kpi_snapshot_runs')->where('id', $id)->first();
        });

        try {
            $n = DB::transaction(fn () => self::fotografiar($run, $mes));
        } catch (\Throwable $e) {
            DB::table('kpi_snapshot_runs')->where('id', $run->id)->update(['status' => 'FAILED', 'error' => mb_substr($e->getMessage(), 0, 255), 'finished_at' => now(), 'updated_at' => now()]);
            Motor::refrescar();
            RuleError::fail('RN-TAB-10', "La corrida {$run->run_no} de ".Base::nombreMes($mes).' falló y no reemplaza a la anterior: '.mb_substr($e->getMessage(), 0, 160));
        }
        DB::table('kpi_snapshot_runs')->where('id', $run->id)->update(['status' => 'OK', 'kpis_count' => $n, 'finished_at' => now(), 'updated_at' => now()]);
        Motor::refrescar();
        Events::emit('kpi.period_frozen', 'kpi_snapshot_runs', $run->id, ['period' => $mes, 'run_no' => $run->run_no, 'kpis' => $n, 'by' => $quien]);
        self::avisar($mes, $run->run_no, $n, $motivo, $u);

        return DB::table('kpi_snapshot_runs')->where('id', $run->id)->first();
    }

    /** Inserta los valores del mes de cada indicador, para la empresa, cada marca y cada local. Devuelve cuántos indicadores congeló. */
    private static function fotografiar(object $run, string $mes): int
    {
        Catalogo::olvidar();
        Motor::olvidar();
        $desde = $mes;
        $hasta = Base::finDeMes($mes);
        $dims = [[null, null]];
        foreach (DB::table('brands')->orderBy('code')->pluck('id') as $b) {
            $dims[] = [$b, null];
        }
        foreach (DB::table('establishments')->orderBy('code')->pluck('id') as $s) {
            $dims[] = [null, $s];
        }
        $ahora = now();
        $n = 0;
        foreach (Catalogo::defs() as $d) {
            if (! Catalogo::calculable($d) || ! Registro::tiene($d->code)) {
                continue;
            }
            $filas = [];
            foreach ($dims as [$b, $s]) {
                $v = Motor::calcular($d->code, $desde, $hasta, $b, $s);
                if (isset($v['error'])) {
                    throw new \RuntimeException("{$d->code}: {$v['error']}");
                }
                $filas[] = ['kpi_id' => $d->id, 'kpi_code' => $d->code, 'period' => $mes, 'dimension_key' => Base::dimension($b, $s),
                    'value' => $v['value'], 'numerator' => $v['numerator'], 'denominator' => $v['denominator'], 'run_no' => $run->run_no,
                    'computed_at' => $ahora, 'snapshot_run_id' => $run->id, 'created_at' => $ahora];
            }
            DB::table('kpi_snapshots')->insert($filas);
            $n++;
        }

        return $n;
    }

    private static function avisar(string $mes, int $no, int $n, string $motivo, ?User $u): void
    {
        $gerentes = DB::table('users as u')->join('user_roles as ur', 'ur.user_id', '=', 'u.id')->join('roles as r', 'r.id', '=', 'ur.role_id')
            ->whereIn('r.code', ['GERENTE', 'ADMINISTRACION'])->where('u.status', 'ACTIVE')->when($u, fn ($q) => $q->where('u.id', '<>', $u->id))->distinct()->pluck('u.id');
        foreach ($gerentes as $id) {
            DB::table('notifications')->insert(['user_id' => $id, 'module' => 'TAB', 'tone' => 'info', 'severity' => 'INFO', 'type' => 'SYSTEM', 'at' => now(),
                'title' => 'Indicadores de '.Base::nombreMes($mes)." congelados (corrida {$no})", 'body' => mb_substr("{$n} indicadores.".($motivo !== '' ? " Motivo: {$motivo}" : ''), 0, 1000),
                'ref' => json_encode(['href' => '/m/tab/tab-09'])]);
        }
    }

    /** TAB-09: meses con su corrida vigente, y todas las corridas. */
    public static function meses(int $cuantos = 8): array
    {
        $actual = Base::mesActual();
        $runs = DB::table('kpi_snapshot_runs')->orderByDesc('period')->orderByDesc('run_no')->get();
        $primero = $runs->min('period');
        $meses = [];
        for ($i = 0; $i < $cuantos; $i++) {
            $m = Base::sumarMeses($actual, -$i);
            if ($primero && $m < $primero && $i >= 3) {
                break;
            }
            $de = $runs->where('period', $m);
            $ok = $de->where('status', 'OK')->sortByDesc('run_no')->first();
            $prim = $de->where('status', 'OK')->sortBy('finished_at')->first();
            $meses[] = ['mes' => $m, 'nombre' => Base::nombreMes($m), 'terminado' => Base::terminado($m),
                'estado' => $ok ? 'FROZEN' : (Base::terminado($m) ? 'OPEN' : 'CURRENT'), 'corrida' => $ok?->run_no, 'congelado' => $ok?->finished_at, 'indicadores' => $ok?->kpis_count,
                'motivo' => $ok?->reason, 'corridas' => $de->count(),
                'dias' => $prim ? (int) \Carbon\CarbonImmutable::parse(Base::finDeMes($m))->diffInDays(\Carbon\CarbonImmutable::parse($prim->finished_at)->setTimezone('America/Lima')->startOfDay(), false) : null];
        }

        return ['meses' => $meses, 'corridas' => $runs->map(fn ($r) => (array) $r + ['nombre' => Base::nombreMes($r->period)])->values(),
            'dia' => (int) Base::param('tab_snapshot_day', 3)];
    }

    /** RN-TAB-10: congelamiento automático del mes anterior, el día tab_snapshot_day. Devuelve la corrida o null si no tocaba. */
    public static function automatico(?string $hoy = null, bool $forzar = false): ?object
    {
        $hoy ??= Base::hoy();
        $dia = (int) Base::param('tab_snapshot_day', 3);
        if (! $forzar && (int) substr($hoy, 8, 2) !== $dia) {
            return null;
        }
        $mes = Base::sumarMeses(substr($hoy, 0, 7).'-01', -1);
        if (DB::table('kpi_snapshot_runs')->where('period', $mes)->where('status', 'OK')->exists()) {
            return null;
        }

        return self::congelar($mes, null, null, true);
    }
}
