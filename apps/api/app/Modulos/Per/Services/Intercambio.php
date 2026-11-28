<?php

namespace App\Modulos\Per\Services;

use App\Models\User;
use App\Support\Access;
use App\Support\Events;
use App\Support\Importar;
use App\Support\RuleError;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;

/**
 * PER-15 Intercambio con Ayni HR (RN-PER-18): la planilla legal no se calcula aquí. Se importa el costo del mes
 * (de Ayni HR o del archivo del contador) y se exportan días trabajados, faltas, tardanzas, horas extra autorizadas,
 * comisiones, bonos y descuentos.
 */
final class Intercambio
{
    /** Columnas del archivo del contador. */
    public const COLUMNAS = [
        ['clave' => 'dni', 'titulo' => 'DNI', 'ancho' => 14, 'otros' => ['Documento', 'Nro documento']],
        ['clave' => 'sueldo', 'titulo' => 'Sueldo bruto', 'ancho' => 16, 'otros' => ['Remuneracion', 'Bruto']],
        ['clave' => 'aportes', 'titulo' => 'Aportes del empleador', 'ancho' => 20, 'otros' => ['EsSalud', 'Aportes']],
        ['clave' => 'provisiones', 'titulo' => 'Provisiones', 'ancho' => 16, 'otros' => ['CTS y gratificaciones']],
    ];

    private static function exige(User $u): void
    {
        if (! Access::can($u, 'per.payroll.exchange')) {
            RuleError::fail('RN-PER-18', 'Importar y exportar la planilla requiere per.payroll.exchange (RR. HH. o contadora).');
        }
    }

    public static function lista(): array
    {
        return DB::table('payroll_exchanges as x')->leftJoin('users as u', 'u.id', '=', 'x.created_by')->orderByDesc('x.period')->orderByDesc('x.created_at')->limit(60)
            ->get(['x.*', 'u.name as quien'])->map(fn ($x) => ['id' => $x->id, 'period' => $x->period, 'nombre' => Base::nombreMes($x->period), 'direction' => $x->direction,
                'direccion' => $x->direction === 'IMPORT_COST' ? 'Importa costo de planilla' : 'Exporta asistencia y variables', 'provider' => $x->provider,
                'proveedor' => Base::FUENTES[$x->provider], 'file_name' => $x->file_name, 'status' => $x->status, 'total_amount' => (float) $x->total_amount,
                'row_count' => (int) $x->row_count, 'error_message' => $x->error_message, 'processed_at' => Asistencia::iso($x->processed_at), 'quien' => $x->quien])->all();
    }

    /**
     * Importa el costo de planilla del mes. ACCOUNTANT_FILE: el Excel o CSV del contador (DNI, sueldo, aportes, provisiones),
     * repartido según los centros de costo vigentes de cada trabajador. AYNI_HR: mientras el conector de INT no esté
     * activo, se toma de las condiciones de pago (sueldo + 9 % + 12,5 %) y queda marcado como simulado.
     */
    public static function importar(string $periodo, string $proveedor, ?UploadedFile $archivo, User $u, ?string $procesado = null): array
    {
        self::exige($u);
        if (! in_array($proveedor, ['AYNI_HR', 'ACCOUNTANT_FILE'], true)) {
            RuleError::fail('RN-PER-18', 'Proveedor de planilla no válido.');
        }
        if ($periodo > Base::mes()) {
            RuleError::fail('RN-PER-18', 'No se importa la planilla de un mes futuro.');
        }
        $fin = Base::finDeMes($periodo);
        $costos = [];   // employee_id => [bruto, aportes, provisiones]
        $avisos = [];
        if ($proveedor === 'ACCOUNTANT_FILE') {
            if (! $archivo) {
                RuleError::fail('RN-PER-18', 'Sube el archivo del contador (Excel o CSV).');
            }
            $texto = Importar::aTexto($archivo, self::COLUMNAS, 2000);
            $lineas = array_values(array_filter(explode("\n", str_replace("\r", '', $texto))));
            array_shift($lineas);
            $porDni = DB::table('employees')->pluck('id', 'doc_number');
            foreach ($lineas as $i => $l) {
                [$dni, $s, $a, $p] = array_pad(array_map('trim', str_getcsv($l, ';')), 4, '');
                $num = fn ($v) => (float) str_replace([',', ' '], ['.', ''], preg_replace('/[^\d,.\- ]/', '', $v));
                if ($dni === '') {
                    continue;
                }
                $id = $porDni[$dni] ?? null;
                if (! $id) {
                    $avisos[] = 'Fila '.($i + 2).": el DNI {$dni} no es de ningún trabajador.";

                    continue;
                }
                $costos[$id] = [$num($s), $num($a), $num($p)];
            }
            if (! $costos) {
                RuleError::fail('RN-PER-18', 'El archivo no trae filas con DNI de trabajadores.'.($avisos ? ' '.implode(' ', array_slice($avisos, 0, 3)) : ''));
            }
        } else {
            foreach (DB::table('employees')->where('status', 'ACTIVE')->where(fn ($w) => $w->whereNull('hire_date')->orWhere('hire_date', '<=', $fin))->pluck('id') as $id) {
                $t = Personal::condicion($id, $fin);
                if (! $t || $t->payroll_source === 'NONE') {
                    continue;
                }
                $g = Personal::remuneracion($id, $fin);
                $costos[$id] = [$g, Base::r($g * 0.09), Base::r($g * 0.125)];
            }
        }

        return DB::transaction(function () use ($periodo, $proveedor, $archivo, $costos, $avisos, $fin, $u, $procesado) {
            DB::table('payroll_exchanges')->where('period', $periodo)->where('direction', 'IMPORT_COST')->where('status', 'DONE')->update(['status' => 'SUPERSEDED', 'updated_at' => now()]);
            $id = DB::table('payroll_exchanges')->insertGetId(['period' => $periodo, 'direction' => 'IMPORT_COST', 'provider' => $proveedor,
                'file_name' => $archivo ? mb_substr($archivo->getClientOriginalName(), 0, 160) : null, 'status' => 'PENDING', 'created_by' => $u->id,
                'created_at' => $procesado ?? now()]);
            $tot = 0.0;
            $n = 0;
            foreach ($costos as $emp => [$s, $a, $p]) {
                $as = Personal::asignaciones($emp, $fin) ?: array_filter([Personal::principal($emp)]);
                if (! $as) {
                    $avisos[] = Base::nombre($emp).' no tiene centro de costo (PER-02): no se importó.';

                    continue;
                }
                $resto = [$s, $a, $p];
                foreach (array_values($as) as $k => $x) {
                    $ult = $k === count($as) - 1;
                    $f = (float) $x->allocation_pct / 100;
                    $fila = $ult ? array_map(fn ($v) => Base::r($v), $resto) : [Base::r($s * $f), Base::r($a * $f), Base::r($p * $f)];
                    $resto = [$resto[0] - $fila[0], $resto[1] - $fila[1], $resto[2] - $fila[2]];
                    $total = Base::r($fila[0] + $fila[1] + $fila[2]);
                    DB::table('payroll_cost_lines')->insert(['exchange_id' => $id, 'employee_id' => $emp, 'cost_center_id' => $x->cost_center_id,
                        'gross_salary' => $fila[0], 'employer_contributions' => $fila[1], 'provisions' => $fila[2], 'total_cost' => $total]);
                    $tot += $total;
                    $n++;
                }
            }
            DB::table('payroll_exchanges')->where('id', $id)->update(['status' => 'DONE', 'total_amount' => Base::r($tot), 'row_count' => $n, 'processed_at' => $procesado ?? now(),
                'error_message' => $avisos ? mb_substr(implode(' ', $avisos), 0, 2000) : ($proveedor === 'AYNI_HR' && ! self::conectorAyni() ? 'Simulado: el conector de Ayni HR (INT) aún no está activo; se usaron las condiciones de pago.' : null)]);
            Events::emit('payroll.imported', 'payroll_exchanges', $id, ['period' => $periodo, 'provider' => $proveedor, 'total' => Base::r($tot)]);

            return ['id' => $id, 'total' => Base::r($tot), 'filas' => $n, 'avisos' => $avisos];
        });
    }

    public static function conectorAyni(): bool
    {
        return DB::getSchemaBuilder()->hasTable('integration_connectors')
            && DB::table('integration_connectors')->where('adapter', 'AyniHrAdapter')->where('status', 'ACTIVE')->where('simulate_down', false)->exists();
    }

    /** Variables del mes por trabajador (lo que se exporta a Ayni HR o al contador). */
    public static function variables(string $periodo): array
    {
        $fin = Base::finDeMes($periodo);
        $emps = DB::table('employees')->where('status', 'ACTIVE')->orderBy('full_name')->get(['id', 'full_name', 'doc_number']);
        $dias = DB::table('attendance_days')->whereBetween('work_date', [$periodo, $fin])->get()->groupBy('employee_id');
        $adel = DB::table('salary_advances')->whereIn('status', ['APPROVED', 'PAID', 'DEDUCTED'])->where('deduct_period', $periodo)->groupBy('employee_id')
            ->selectRaw('employee_id, sum(amount) s')->pluck('s', 'employee_id');
        $multas = DB::getSchemaBuilder()->hasTable('traffic_fines') ? DB::table('traffic_fines')->where('deduct_from_payout', true)->whereBetween('fine_date', [$periodo, $fin])
            ->whereNotIn('status', ['VOIDED', 'APPEALED'])->groupBy('employee_id')->selectRaw('employee_id, sum(coalesce(nullif(paid_amount, 0), amount)) s')->pluck('s', 'employee_id') : collect();
        $refs = DB::table('employment_terms')->where('valid_from', '<=', $fin)->where(fn ($w) => $w->whereNull('valid_to')->orWhere('valid_to', '>=', $periodo))->pluck('external_ref', 'employee_id');
        $out = [];
        foreach ($emps as $e) {
            $ds = $dias[$e->id] ?? collect();
            $t = Comisiones::totales($periodo, $e->id);
            if ($ds->isEmpty() && ! $t['n'] && ! isset($adel[$e->id])) {
                continue;
            }
            $out[] = ['employee_id' => $e->id, 'dni' => $e->doc_number, 'codigo' => $refs[$e->id] ?? null, 'nombre' => $e->full_name,
                'trabajados' => $ds->whereIn('status', ['PRESENT', 'LATE'])->count(), 'faltas' => $ds->where('status', 'ABSENT')->count(), 'permisos' => $ds->where('status', 'LEAVE')->count(),
                'tardanzas' => $ds->where('status', 'LATE')->count(), 'min_tardanza' => (int) $ds->where('status', 'LATE')->sum('late_minutes'),
                'horas_extra' => Base::r($ds->sum('overtime_minutes') / 60, 2), 'comisiones' => $t['neta'], 'bonos' => $t['bonos'],
                'descuentos' => Base::r(($adel[$e->id] ?? 0) + ($multas[$e->id] ?? 0))];
        }

        return $out;
    }

    public static function registrarExportacion(string $periodo, string $proveedor, array $filas, User $u): string
    {
        self::exige($u);

        return DB::transaction(function () use ($periodo, $proveedor, $filas, $u) {
            DB::table('payroll_exchanges')->where('period', $periodo)->where('direction', 'EXPORT_VARIABLES')->where('status', 'DONE')->update(['status' => 'SUPERSEDED', 'updated_at' => now()]);
            $id = DB::table('payroll_exchanges')->insertGetId(['period' => $periodo, 'direction' => 'EXPORT_VARIABLES', 'provider' => $proveedor,
                'file_name' => 'variables-'.substr($periodo, 0, 7).'.xlsx', 'status' => 'DONE', 'total_amount' => Base::r(array_sum(array_map(fn ($f) => $f['comisiones'] + $f['bonos'], $filas))),
                'row_count' => count($filas), 'processed_at' => now(), 'created_by' => $u->id]);
            Events::emit('payroll.exported', 'payroll_exchanges', $id, ['period' => $periodo, 'provider' => $proveedor, 'rows' => count($filas)]);

            return $id;
        });
    }
}
