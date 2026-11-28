<?php

namespace Database\Seeders;

use App\Models\User;
use App\Modulos\Per\Services\Asistencia;
use App\Modulos\Per\Services\Base;
use App\Modulos\Per\Services\Comisiones;
use App\Modulos\Per\Services\Intercambio;
use App\Modulos\Per\Services\Pagos;
use App\Modulos\Per\Services\Supervision;
use App\Support\Access;
use Carbon\CarbonImmutable;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

/**
 * PER · demo de Personal para Don Guando (corre después de la base, de CAJ, DEL y FLO).
 *
 * - 23 puestos con funciones; asignaciones de los trabajadores con sus centros de costo (algunos repartidos) y supervisor.
 * - Condiciones de pago: sueldo de MAE; Julio Choque pasa a jornal en julio, Teodoro Mayta cobra por hora, Ana Torres subió en abril.
 * - Turnos de los 2 locales (uno nocturno) y programación del 01/09 hasta 2 semanas después de hoy.
 * - Asistencia consolidada desde el 01/09; las últimas dos semanas con marcaciones reales por QR (local) y GPS (reparto),
 *   una manual aprobada y una por GPS a 250 m (inválida, CA-PER-03).
 * - Planes: 2 % sobre lo cobrado sin IGV y S/ 1,50 por entrega; comisiones y bonos de los cobros y entregas de la base,
 *   procesados en su fecha (así cada uno cae en su mes, RN-PER-15).
 * - Supervisión: las alertas de control del CRM, las de FLO con conductor y las multas, más casos de ejemplo.
 * - Adelantos, planilla importada de agosto a octubre, variables de setiembre exportadas, pagos de setiembre pagados
 *   y los de octubre por aprobar (algunos retenidos por alertas graves abiertas, RN-PER-20).
 * La semilla aleatoria es fija; solo cambia lo que depende del día en que corre.
 */
class PerDemoSeeder extends Seeder
{
    private string $t;

    private array $emp = [];   // nombre corto => employee_id

    private User $gerente;

    private const PUESTOS = [
        ['GER', 'Gerente general', 'ADMIN', 'L1', 'GERENTE', ['Dirige la operación de las 5 marcas', 'Aprueba gastos de nivel 3 y presupuesto', 'Revisa indicadores semanales']],
        ['ADM', 'Jefa de administración', 'ADMIN', null, 'ADMINISTRACION', ['Paga proveedores y personal', 'Controla la caja chica y las rendiciones', 'Arma el presupuesto anual']],
        ['SIS', 'Administrador del sistema', 'ADMIN', null, 'ADMIN_SISTEMA', ['Usuarios, permisos y parámetros', 'Integraciones (WhatsApp, WooCommerce, OSE)']],
        ['SUPV', 'Supervisora de ventas', 'SALES', 'L1', 'SUPERVISORA_VENTAS', ['Reasigna chats y revisa alertas de control', 'Aprueba descuentos y gastos de nivel 1', 'Capacita a las vendedoras']],
        ['VEN', 'Vendedora', 'SALES', 'L1', 'VENDEDORA', ['Atiende WhatsApp y redes de sus marcas', 'Registra pedidos con datos completos', 'Confirma el cobro y el comprobante']],
        ['CAJ', 'Cajero de mostrador', 'SALES', 'L1', 'CAJERO', ['Vende en mostrador con balanza', 'Arqueo de caja']],
        ['ALM', 'Almacenero', 'WAREHOUSE', null, 'ALMACENERO', ['Recepción con control de calidad mínimo', 'Transferencias y conteos', 'FEFO y mermas']],
        ['PREP', 'Preparador de pedidos', 'WAREHOUSE', 'L1', 'PREPARADOR', ['Arma pedidos con escaneo', 'Pesa y embolsa', 'Verifica la carga']],
        ['COOR', 'Coordinador de delivery', 'DELIVERY', 'L1', 'COORDINADOR_DELIVERY', ['Arma rutas y asigna vehículos', 'Contrata empresas de delivery', 'Aprueba gastos de reparto de nivel 1']],
        ['REP', 'Repartidor', 'DELIVERY', null, 'REPARTIDOR', ['Entrega con prueba de entrega', 'Cobra contra entrega y liquida su caja', 'Registra combustible y peajes']],
        ['REPE', 'Repartidor eventual (jornal)', 'DELIVERY', 'L2', 'REPARTIDOR', ['Cubre la ruta de Lurín', 'Moto alquilada']],
        ['MKT', 'Analista de marketing', 'MARKETING', null, 'MARKETING', ['Campañas en Google, Meta y TikTok', 'Coordina creadores de contenido', 'Mide el costo por pedido']],
        ['JPRO', 'Jefe de producción', 'PRODUCTION', 'L2', 'JEFE_PRODUCCION', ['Planifica la producción diaria', 'Controla rendimientos y mermas']],
        ['OPE', 'Operario de producción', 'PRODUCTION', null, 'OPERARIO_PRODUCCION', ['Beneficio, despiece y cortes', 'Registra consumos']],
        ['EMP', 'Operario de empaque', 'PRODUCTION', 'L2', null, ['Envasado al vacío y etiquetado']],
        ['LIM', 'Limpieza y desinfección', 'PRODUCTION', 'L2', null, ['Limpieza nocturna de la planta', 'Registro de desinfección']],
        ['CAL', 'Responsable de calidad', 'QUALITY', 'L2', 'CALIDAD', ['Libera lotes', 'Controla temperaturas']],
        ['COM', 'Asistente de compras', 'ADMIN', null, 'COMPRAS', ['Órdenes de compra', 'Seguimiento a proveedores']],
        ['CONT', 'Contadora', 'FINANCE', null, 'CONTADORA', ['Cierre contable mensual', 'SIRE y libros electrónicos']],
        ['PRAC', 'Practicante contable', 'FINANCE', null, 'PRACTICANTE_CONTABLE', ['Clasifica comprobantes', 'Concilia bancos']],
        ['VIS', 'Visitador de consignación', 'SALES', null, 'VISITADOR_CONSIGNACION', ['Visita puntos de consignación', 'Liquida ventas en consignación']],
        ['RRHH', 'Asistente de RR. HH.', 'HR', null, 'RRHH', ['Asistencia y turnos', 'Comisiones, bonos y adelantos', 'Intercambio con Ayni HR']],
        ['AUD', 'Auditoría externa', 'FINANCE', null, 'AUDITOR', ['Revisión anual (servicio externo)']],
    ];

    /** [nombre, puesto, [[centro, %]], supervisor, turnos (alternan por semana)]. */
    private const GENTE = [
        ['Rosa Quispe', 'GER', [['ADM', 100]], null, 'ADM'], ['Luis Ccahuana', 'SIS', [['ADM', 100]], 'Rosa Quispe', 'ADM'],
        ['Carmen Huamán', 'ADM', [['ADM', 70], ['FIN', 30]], 'Rosa Quispe', 'ADM'],
        ['Patricia León', 'SUPV', [['VEN-DG', 40], ['VEN-M2', 15], ['VEN-M3', 15], ['VEN-M4', 15], ['VEN-M5', 15]], 'Rosa Quispe', 'MAN'],
        ['Ana Torres', 'VEN', [['VEN-DG', 100]], 'Patricia León', 'MAN|TAR'], ['Betty Ramos', 'VEN', [['VEN-DG', 100]], 'Patricia León', 'TAR|MAN'],
        ['Carla Núñez', 'VEN', [['VEN-M2', 50], ['VEN-M3', 50]], 'Patricia León', 'MAN'], ['Diana Flores', 'VEN', [['VEN-M4', 50], ['VEN-M5', 50]], 'Patricia León', 'TAR'],
        ['Elena Vargas', 'VEN', [['VEN-DG', 50], ['VEN-M5', 50]], 'Patricia León', 'MAN'], ['Fiorella Campos', 'VEN', [['VEN-DG', 100]], 'Patricia León', 'TAR'],
        ['Fiorella Quispe', 'VEN', [['VEN-DG', 100]], 'Patricia León', 'MAN'],
        ['Jorge Salas', 'CAJ', [['VEN-MOS', 100]], 'Patricia León', 'MOS'], ['Miguel Torres', 'ALM', [['ALM-L1', 100]], 'Carmen Huamán', 'MAN'],
        ['Iván Rojas', 'ALM', [['ALM-L2', 100]], 'Óscar Lazo', 'PRD'], ['Sonia Mamani', 'PREP', [['ALM-L1', 100]], 'Miguel Torres', 'MAN'],
        ['Willy Huanca', 'PREP', [['ALM-L1', 100]], 'Miguel Torres', 'TAR'], ['Raúl Chávez', 'COOR', [['DEL', 100]], 'Rosa Quispe', 'REP'],
        ['Pedro Condori', 'REP', [['DEL', 100]], 'Raúl Chávez', 'REP'], ['Hugo Ticona', 'REP', [['DEL', 100]], 'Raúl Chávez', 'REP'],
        ['Julio Choque', 'REPE', [['DEL', 100]], 'Raúl Chávez', 'REP2'],
        ['Lucía Paredes', 'MKT', [['MKT-DG', 60], ['MKT-M2', 10], ['MKT-M3', 10], ['MKT-M4', 10], ['MKT-M5', 10]], 'Rosa Quispe', 'ADM'],
        ['Óscar Lazo', 'JPRO', [['PROD-L2', 100]], 'Rosa Quispe', 'PRD'], ['Nilda Poma', 'OPE', [['PROD-L2', 100]], 'Óscar Lazo', 'PRD'],
        ['Víctor Apaza', 'OPE', [['PROD-L1', 100]], 'Óscar Lazo', 'MAN'], ['Silvia Ramos', 'CAL', [['CAL', 100]], 'Rosa Quispe', 'ADM2'],
        ['Diego Flores', 'COM', [['ADM', 100]], 'Carmen Huamán', 'ADM'], ['CPC Marisol', 'CONT', [['FIN', 100]], 'Rosa Quispe', null],
        ['Kevin Huerta', 'PRAC', [['FIN', 100]], 'CPC Marisol', 'ADM'], ['Andrea Cusi', 'PRAC', [['FIN', 100]], 'CPC Marisol', 'ADM'],
        ['Marco Villa', 'VIS', [['VEN-DG', 100]], 'Patricia León', 'ADM'], ['Gabriela Soto', 'RRHH', [['RRHH', 100]], 'Carmen Huamán', 'ADM'],
        ['Auditor externo', 'AUD', [['FIN', 100]], null, null], ['Teodoro Mayta', 'EMP', [['PROD-L2', 100]], 'Óscar Lazo', 'PRD'],
        ['Rosa Inga', 'OPE', [['PROD-L2', 100]], 'Óscar Lazo', 'PRD'], ['Felipe Ñahui', 'ALM', [['ALM-L1', 100]], 'Miguel Torres', 'MAN'],
        ['Lidia Vilca', 'LIM', [['PROD-L2', 100]], 'Óscar Lazo', 'NOC'], ['Yorgelis Méndez', 'OPE', [['PROD-L2', 100]], 'Óscar Lazo', 'PRD'],
    ];

    private const TURNOS = [['L1', 'MAN', 'Mañana', '08:00', '17:00', 60], ['L1', 'TAR', 'Tarde', '11:00', '20:00', 60], ['L1', 'MOS', 'Mostrador', '09:00', '18:00', 60],
        ['L1', 'ADM', 'Oficina', '08:30', '17:30', 60], ['L1', 'REP', 'Reparto Surco', '08:30', '17:30', 45], ['L2', 'PRD', 'Producción', '06:00', '15:00', 60],
        ['L2', 'REP2', 'Reparto Lurín', '08:00', '17:00', 45], ['L2', 'ADM2', 'Oficina Lurín', '07:30', '16:30', 60], ['L2', 'NOC', 'Limpieza nocturna', '22:00', '06:00', 30]];

    public function run(): void
    {
        $this->t = (string) DB::table('tenants')->where('name', 'like', '%DON GUANDO%')->value('id');
        $this->acceso();
        if (! $this->t || DB::table('job_positions')->where('tenant_id', $this->t)->exists()) {
            return;
        }
        DB::select("SELECT set_config('app.tenant_id', ?, false)", [$this->t]);
        mt_srand(66066);
        DB::statement('SET ROLE aycha_app');   // con RLS: todo lo que lee y escribe es de Don Guando
        try {
            $this->gerente = User::query()->where('tenant_id', $this->t)->where('email', 'rquispe@donguando.pe')->firstOrFail();
            Access::forget();
            foreach (DB::table('employees')->where('tenant_id', $this->t)->get(['id', 'full_name']) as $e) {
                foreach (self::GENTE as $g) {
                    if (str_starts_with($e->full_name, $g[0])) {
                        $this->emp[$g[0]] = $e->id;
                    }
                }
            }
            $puestos = $this->puestos();
            $this->personas($puestos);
            $turnos = $this->turnos();
            $this->permisos();
            $this->asistencia($turnos);
            $this->comisiones();
            $this->supervision();
            $this->adelantos();
            $this->planillaYPagos();
            $this->command?->info('PER: '.count($this->emp).' trabajadores, '.DB::table('attendance_days')->where('tenant_id', $this->t)->count().' días de asistencia, '
                .DB::table('commission_entries')->where('tenant_id', $this->t)->count().' comisiones y bonos y '.DB::table('staff_payouts')->where('tenant_id', $this->t)->count().' pagos (PER-01 a PER-15)');
        } finally {
            if (DB::transactionLevel() === 0 || ! $this->abortada()) {
                DB::statement('RESET ROLE');
                DB::select("SELECT set_config('app.tenant_id', '', false)");
            }
        }
    }

    private function abortada(): bool
    {
        try {
            DB::select('SELECT 1');

            return false;
        } catch (\Throwable) {
            return true;
        }
    }

    /** PER-06: los roles que solo marcan asistencia leen PER (en una base nueva la migración corre antes que los roles). */
    private function acceso(): void
    {
        DB::statement(<<<'SQL'
            INSERT INTO role_module_access (tenant_id, role_id, module_code, actions, created_at)
            SELECT r.tenant_id, r.id, 'PER', 'L', now() FROM roles r
            WHERE r.code NOT IN ('GERENTE', 'AUDITOR', 'CLIENTE_B2B', 'SOPORTE_PLATAFORMA', 'SOPORTE_TECNICO')
            ON CONFLICT (tenant_id, role_id, module_code) DO NOTHING
        SQL);
    }

    private function local(string $code): string
    {
        return (string) DB::table('establishments')->where('tenant_id', $this->t)->where('code', $code)->value('id');
    }

    private function usuario(string $nombre): ?string
    {
        return isset($this->emp[$nombre]) ? DB::table('users')->where('employee_id', $this->emp[$nombre])->value('id') : null;
    }

    private function puestos(): array
    {
        $ids = [];
        foreach (self::PUESTOS as [$code, $name, $area, $est, $rol, $fns]) {
            $ids[$code] = DB::table('job_positions')->insertGetId(['code' => $code, 'name' => $name, 'area' => $area, 'establishment_id' => $est ? $this->local($est) : null,
                'functions' => json_encode($fns, JSON_UNESCAPED_UNICODE), 'default_role' => $rol, 'pay_scheme' => $code === 'REPE' ? 'DAILY' : ($code === 'EMP' ? 'HOURLY' : 'MONTHLY')]);
        }

        return $ids;
    }

    private function personas(array $puestos): void
    {
        $cc = DB::table('cost_centers')->where('tenant_id', $this->t)->pluck('id', 'code');
        foreach (self::GENTE as [$n, $pos, $centros, $sup]) {
            if (! isset($this->emp[$n])) {
                continue;
            }
            $e = DB::table('employees')->where('id', $this->emp[$n])->first();
            $p = DB::table('job_positions')->where('id', $puestos[$pos])->first();
            $local = $p->establishment_id ?? $e->establishment_id ?? $this->local('L1');
            foreach ($centros as $i => [$c, $pct]) {
                DB::table('employee_assignments')->insert(['employee_id' => $e->id, 'position_id' => $p->id, 'establishment_id' => $local, 'cost_center_id' => $cc[$c],
                    'supervisor_employee_id' => $sup ? ($this->emp[$sup] ?? null) : null, 'allocation_pct' => $pct, 'is_primary' => $i === 0, 'valid_from' => $e->hire_date ?? '2024-01-01']);
            }
            $ref = 'AYNI-'.substr((string) $e->doc_number, -5);
            $desde = $e->hire_date ?? '2024-01-01';
            $c = fn ($f) => DB::table('employment_terms')->insert($f + ['employee_id' => $e->id, 'external_ref' => $pos === 'AUD' ? null : $ref, 'payroll_source' => 'AYNI_HR']);
            if ($n === 'Julio Choque') {
                $c(['pay_scheme' => 'MONTHLY', 'monthly_amount' => 1400, 'valid_from' => $desde, 'valid_to' => '2026-06-30']);
                $c(['pay_scheme' => 'DAILY', 'daily_rate' => 62, 'valid_from' => '2026-07-01']);
            } elseif ($n === 'Teodoro Mayta') {
                $c(['pay_scheme' => 'HOURLY', 'hourly_rate' => 6.2, 'valid_from' => $desde]);
            } elseif ($n === 'Ana Torres') {
                $c(['pay_scheme' => 'MONTHLY', 'monthly_amount' => 1400, 'valid_from' => $desde, 'valid_to' => '2026-03-31']);
                $c(['pay_scheme' => 'MONTHLY', 'monthly_amount' => 1500, 'valid_from' => '2026-04-01']);
            } else {
                $c(['pay_scheme' => 'MONTHLY', 'monthly_amount' => $pos === 'AUD' ? 0 : (float) $e->monthly_salary, 'valid_from' => $desde,
                    'payroll_source' => $pos === 'AUD' ? 'NONE' : ($pos === 'PRAC' ? 'ACCOUNTANT_FILE' : 'AYNI_HR')]);
            }
        }
    }

    private function turnos(): array
    {
        $ids = [];
        foreach (self::TURNOS as [$l, $code, $name, $a, $b, $brk]) {
            $ids[$code] = DB::table('shifts')->insertGetId(['establishment_id' => $this->local($l), 'code' => $code, 'name' => $name, 'start_time' => $a, 'end_time' => $b,
                'break_minutes' => $brk, 'crosses_midnight' => $b <= $a]);
        }

        return $ids;
    }

    private function permisos(): void
    {
        $rrhh = $this->usuario('Gabriela Soto');
        $hoy = CarbonImmutable::parse(Base::hoy());
        $lista = [['Betty Ramos', 'VACATION', '2026-09-21', '2026-09-26', 'Vacaciones programadas', 'APPROVED'], ['Willy Huanca', 'MEDICAL', '2026-10-06', '2026-10-06', 'Descanso médico (gastroenteritis)', 'APPROVED'],
            ['Diana Flores', 'VACATION', $hoy->addDays(10)->toDateString(), $hoy->addDays(15)->toDateString(), 'Viaje familiar a Cusco', 'REQUESTED'],
            ['Nilda Poma', 'PERMISSION', $hoy->addDays(3)->toDateString(), $hoy->addDays(3)->toDateString(), 'Trámite en RENIEC', 'REQUESTED'],
            ['Carla Núñez', 'PERMISSION', $hoy->subDays(6)->toDateString(), $hoy->subDays(6)->toDateString(), 'Cita médica de su hijo', 'APPROVED']];
        foreach ($lista as [$n, $t, $a, $b, $why, $st]) {
            DB::table('leave_requests')->insert(['employee_id' => $this->emp[$n], 'leave_type' => $t, 'date_from' => $a, 'date_to' => $b,
                'days' => CarbonImmutable::parse($a)->diffInDays(CarbonImmutable::parse($b)) + 1, 'reason' => $why, 'status' => $st,
                'requested_by' => $this->usuario($n) ?? $rrhh, 'approved_by' => $st === 'APPROVED' ? $rrhh : null,
                'decided_at' => $st === 'APPROVED' ? CarbonImmutable::parse($a)->subDays(5)->setTime(10, 0)->toIso8601String() : null]);
        }
    }

    /** Programación y asistencia: días consolidados directamente hasta hace 15 días; después, marcaciones reales y consolidado del servicio. */
    private function asistencia(array $turnos): void
    {
        $hoy = Base::hoy();
        $fin = CarbonImmutable::parse($hoy)->addDays(14)->toDateString();
        $reales = CarbonImmutable::parse($hoy)->subDays(14)->toDateString();
        $sh = DB::table('shifts')->whereIn('id', $turnos)->get()->keyBy('code');
        $est = DB::table('establishments')->where('tenant_id', $this->t)->get()->keyBy('id');
        $coord = $this->usuario('Raúl Chávez');
        $faltas = ['Hugo Ticona|2026-09-14', 'Felipe Ñahui|2026-09-28', 'Willy Huanca|2026-10-02', 'Hugo Ticona|'.CarbonImmutable::parse($hoy)->subDays(4)->toDateString()];
        $lic = DB::table('leave_requests')->where('status', 'APPROVED')->get();
        $dias = [];
        $lote = [];
        foreach (self::GENTE as [$n, , , , $codes]) {
            if (! $codes || ! isset($this->emp[$n])) {
                continue;
            }
            $id = $this->emp[$n];
            $ops = explode('|', $codes);
            for ($d = CarbonImmutable::parse('2026-09-01'); $d->toDateString() <= $fin; $d = $d->addDay()) {
                $f = $d->toDateString();
                $wk = intdiv((int) CarbonImmutable::parse('2026-08-31')->diffInDays($d), 7);
                $code = $ops[$wk % count($ops)];
                $s = $sh[$code];
                $dow = $d->dayOfWeek;
                $descanso = $n === 'Elena Vargas' ? $dow === 3 : ($n === 'Lidia Vilca' ? $dow === 6 : $dow === 0);
                $he = ! $descanso && in_array($code, ['REP', 'REP2'], true) && $dow === 5 ? 60 : 0;
                $sa = DB::table('shift_assignments')->insertGetId(['employee_id' => $id, 'shift_id' => $s->id, 'work_date' => $f, 'status' => $descanso ? 'REST' : 'PLANNED',
                    'overtime_authorized_minutes' => $he, 'overtime_authorized_by' => $he ? $coord : null]);
                if ($f > $hoy) {
                    continue;
                }
                $oficina = in_array($code, ['ADM', 'ADM2'], true);
                $vacio = ['employee_id' => $id, 'work_date' => $f, 'shift_assignment_id' => $sa, 'first_in' => null, 'last_out' => null, 'worked_minutes' => 0, 'late_minutes' => 0,
                    'overtime_minutes' => 0, 'unauthorized_minutes' => 0, 'justification' => null, 'justification_approved' => false, 'approved_by' => null];
                $l = $lic->first(fn ($x) => $x->employee_id === $id && $x->date_from <= $f && $x->date_to >= $f);
                if ($descanso || (Base::feriado($f) && $oficina) || $l) {
                    if ($f < $reales) {
                        $lote[] = $vacio + ['status' => $descanso ? 'REST' : ($l ? 'LEAVE' : 'HOLIDAY')];
                    } else {
                        $dias[] = [$id, $f];
                    }

                    continue;
                }
                if (in_array("{$n}|{$f}", $faltas, true)) {
                    $just = $n === 'Felipe Ñahui';
                    if ($f < $reales) {
                        $lote[] = ['status' => $just ? 'LEAVE' : 'ABSENT', 'justification' => $just ? 'Avisó por WhatsApp a las 10:00: emergencia familiar' : null,
                            'justification_approved' => $just, 'approved_by' => $just ? $this->usuario('Gabriela Soto') : null] + $vacio;
                    } else {
                        $dias[] = [$id, $f];
                    }

                    continue;
                }
                $tarde = mt_rand(0, 999) < ($n === 'Hugo Ticona' ? 250 : 70);
                $inOff = $tarde ? mt_rand(12, 34) : -mt_rand(0, 12);
                $reparto = in_array($code, ['REP', 'REP2'], true);
                $outOff = $reparto ? mt_rand(-5, $dow === 5 ? 75 : 35) : mt_rand(0, 25);
                $ent = CarbonImmutable::parse("{$f} {$s->start_time}", 'America/Lima')->addMinutes($inOff)->addSeconds(mt_rand(0, 59));
                $sal = CarbonImmutable::parse(($s->crosses_midnight ? $d->addDay()->toDateString() : $f).' '.$s->end_time, 'America/Lima')->addMinutes($outOff)->addSeconds(mt_rand(0, 59));
                if ($f < $reales) {
                    $tol = (int) Base::num('per_late_tolerance_minutes', 10);
                    $fin2 = CarbonImmutable::parse(($s->crosses_midnight ? $d->addDay()->toDateString() : $f).' '.$s->end_time, 'America/Lima');
                    $extra = max(0, (int) round(($sal->getTimestamp() - $fin2->getTimestamp()) / 60));
                    $late = Asistencia::tardanza(substr($s->start_time, 0, 5), $ent->format('H:i'), $tol);
                    $lote[] = ['first_in' => $ent->toIso8601String(), 'last_out' => $sal->toIso8601String(),
                        'worked_minutes' => max(0, (int) round(($sal->getTimestamp() - $ent->getTimestamp()) / 60) - (int) $s->break_minutes), 'late_minutes' => $late,
                        'overtime_minutes' => min($extra, $he), 'unauthorized_minutes' => $extra - min($extra, $he), 'status' => $late > 0 ? 'LATE' : 'PRESENT'] + $vacio;
                    continue;
                }
                // marcaciones reales de las últimas dos semanas
                $e = $est[$s->establishment_id];
                $marca = function (string $tipo, CarbonImmutable $en) use ($id, $s, $e, $reparto, $n, $f) {
                    $fila = ['employee_id' => $id, 'establishment_id' => $s->establishment_id, 'mark_type' => $tipo, 'marked_at' => $en->toIso8601String(),
                        'device_id' => 'cel-'.substr(md5($n), 0, 4), 'offline_uuid' => 'seed-'.substr($id, -8).'-'.$en->format('YmdHis').$tipo, 'is_valid' => true];
                    if ($reparto) {
                        $lat = (float) $e->lat + (mt_rand(-40, 40) / 100000);
                        $lng = (float) $e->lng + (mt_rand(-40, 40) / 100000);
                        $fila += ['method' => 'GEO', 'lat' => $lat, 'lng' => $lng, 'distance_m' => round(Base::metros($lat, $lng, (float) $e->lat, (float) $e->lng), 1)];
                    } else {
                        $fila += ['method' => 'QR', 'qr_token_id' => Asistencia::qr($s->establishment_id, $en)->id];
                    }
                    DB::table('attendance_marks')->insert($fila);
                };
                $esHoy = $f === $hoy;
                if ($esHoy && $ent->greaterThan(Base::ahora())) {
                    continue;   // aún no llega su hora de entrada
                }
                if ($n === 'Pedro Condori' && $f === CarbonImmutable::parse($hoy)->subDays(3)->toDateString()) {
                    DB::table('attendance_marks')->insert(['employee_id' => $id, 'establishment_id' => $s->establishment_id, 'mark_type' => 'IN', 'marked_at' => $ent->toIso8601String(),
                        'method' => 'MANUAL', 'manual_reason' => 'Se le descargó el celular; marcó en la tablet del coordinador', 'approved_by_employee_id' => $this->emp['Raúl Chávez'],
                        'offline_uuid' => 'seed-man-'.$f, 'recorded_by' => $coord]);
                } else {
                    $marca('IN', $ent);
                }
                if ($n === 'Julio Choque' && $f === CarbonImmutable::parse($hoy)->subDays(2)->toDateString()) {
                    $e2 = $est[$s->establishment_id];
                    DB::table('attendance_marks')->insert(['employee_id' => $id, 'establishment_id' => $s->establishment_id, 'mark_type' => 'IN', 'marked_at' => $ent->subMinutes(20)->toIso8601String(),
                        'method' => 'GEO', 'lat' => (float) $e2->lat + 0.002248, 'lng' => (float) $e2->lng, 'distance_m' => 250, 'is_valid' => false,
                        'invalid_reason' => "RN-PER-03: marcación a 250 m de {$e2->short}; el radio permitido es 100 m.", 'device_id' => 'cel-julio', 'offline_uuid' => 'seed-inv-'.$f]);
                }
                if (! $esHoy || $sal->lessThan(Base::ahora())) {
                    if ((int) $s->break_minutes >= 45 && ! $reparto) {
                        $bo = CarbonImmutable::parse("{$f} 13:00", 'America/Lima')->addMinutes(mt_rand(-20, 20));
                        if ($bo->greaterThan($ent) && $bo->lessThan($sal)) {
                            $marca('BREAK_OUT', $bo);
                            $marca('BREAK_IN', $bo->addMinutes((int) $s->break_minutes + mt_rand(-5, 8)));
                        }
                    }
                    $marca('OUT', $sal);
                }
                $dias[] = [$id, $f];
            }
        }
        foreach (array_chunk($lote, 500) as $c) {
            DB::table('attendance_days')->insert($c);
        }
        foreach ($dias as [$id, $f]) {
            Asistencia::consolidar($id, $f);
        }
    }

    private function comisiones(): void
    {
        DB::table('commission_plans')->insert([
            ['code' => 'COM-VEN-2', 'name' => 'Comisión vendedoras 2 % sobre lo cobrado', 'plan_type' => 'SELLER_COLLECTED', 'rate_pct' => 2, 'per_delivery_amount' => null,
                'tiers' => '[]', 'alert_penalty_pct' => 10, 'valid_from' => '2026-01-01', 'status' => 'ACTIVE'],
            ['code' => 'COM-VEN-TRAMOS', 'name' => 'Comisión con tramos (propuesta 2027)', 'plan_type' => 'SELLER_COLLECTED', 'rate_pct' => 2, 'per_delivery_amount' => null,
                'tiers' => json_encode([['from' => 15000, 'rate_pct' => 2.5], ['from' => 25000, 'rate_pct' => 3]]), 'alert_penalty_pct' => 10, 'valid_from' => '2027-01-01', 'status' => 'INACTIVE'],
            ['code' => 'BON-REP-150', 'name' => 'Bono por entrega S/ 1,50', 'plan_type' => 'DRIVER_DELIVERY', 'rate_pct' => null, 'per_delivery_amount' => 1.5,
                'tiers' => '[]', 'alert_penalty_pct' => 10, 'valid_from' => '2026-01-01', 'status' => 'ACTIVE'],
        ]);
        // cada cobro y entrega se procesa en su fecha: así cae en su mes, como si el evento hubiera llegado al momento
        foreach (DB::table('payments')->where('tenant_id', $this->t)->whereIn('status', ['CONFIRMED', 'REVERSED'])->orderBy('paid_at')->get(['id', 'status', 'paid_at', 'reversed_at']) as $p) {
            $dia = CarbonImmutable::parse($p->paid_at)->setTimezone('America/Lima')->toDateString();
            if ($p->status === 'REVERSED') {
                Comisiones::cobro($p->id, $dia, true);
                Comisiones::reverso($p->id, null, CarbonImmutable::parse($p->reversed_at ?? $p->paid_at)->setTimezone('America/Lima')->toDateString());
            } else {
                Comisiones::cobro($p->id, $dia);
            }
        }
        foreach (DB::table('sales_orders')->where('tenant_id', $this->t)->whereIn('status', ['DELIVERED', 'CLOSED'])->where('fulfillment', 'DELIVERY')->whereNotNull('delivered_at')
            ->orderBy('delivered_at')->get(['id', 'delivered_at']) as $o) {
            Comisiones::entrega($o->id, CarbonImmutable::parse($o->delivered_at)->setTimezone('America/Lima')->toDateString());
        }
    }

    private function supervision(): void
    {
        Supervision::vincular();
        $pat = $this->usuario('Patricia León');
        $casos = [['Betty Ramos', 'OTHER', 'HIGH', 'Pidió al cliente pagar por Yape a un número personal («yapéame a mi número»)', null, null, '2026-10-08 16:20'],
            ['Elena Vargas', 'OTHER', 'HIGH', 'Prometió 20 % de descuento sin aprobación de la supervisora', 'WRITTEN_WARNING', 'Se revisó la conversación; llamada de atención escrita y se anuló el descuento', '2026-09-17 11:05'],
            ['Carla Núñez', 'OTHER', 'MEDIUM', 'Demoró 48 min en responder un chat con pedido de restaurante', 'OBSERVATION', 'Coincidió con caída de WhatsApp Business; se reforzó la cobertura', '2026-10-03 13:40'],
            ['Ana Torres', 'OTHER', 'LOW', 'Lenguaje informal con un cliente B2B', 'NO_ACTION', null, '2026-09-22 10:15'],
            ['Hugo Ticona', 'ATTENDANCE', 'MEDIUM', '3 tardanzas en la semana', null, null, CarbonImmutable::parse(Base::hoy())->subDays(2)->toDateString().' 09:00']];
        foreach ($casos as [$n, $src, $sev, $sum, $act, $nota, $at]) {
            $id = $this->emp[$n];
            DB::table('supervision_actions')->insert(['employee_id' => $id, 'supervisor_employee_id' => $this->emp['Patricia León'] === $id ? null : \App\Modulos\Per\Services\Personal::supervisorDe($id),
                'source' => $src, 'severity' => $sev, 'summary' => $sum, 'action' => $act, 'action_note' => $nota, 'action_by' => $act ? $pat : null,
                'action_at' => $act ? CarbonImmutable::parse($at, 'America/Lima')->addDay()->setTime(10, 0)->toIso8601String() : null, 'status' => $act ? 'CLOSED' : 'OPEN',
                'raised_at' => CarbonImmutable::parse($at, 'America/Lima')->toIso8601String()]);
        }
    }

    private function adelantos(): void
    {
        $rosa = $this->gerente->id;
        $n = 0;
        $hoy = CarbonImmutable::parse(Base::hoy());
        $lista = [['Hugo Ticona', 300, '2026-09-10', 'Pago de matrícula escolar', 'APPROVED', '2026-09-01'], ['Sonia Mamani', 400, '2026-10-02', 'Reparación de su cocina', 'PAID', '2026-10-01'],
            ['Ana Torres', 450, $hoy->subDays(2)->toDateString(), 'Medicinas para su madre', 'REQUESTED', Base::mes()], ['Teodoro Mayta', 600, '2026-09-25', 'Compra de terreno', 'REJECTED', '2026-10-01'],
            ['Willy Huanca', 350, $hoy->subDays(5)->toDateString(), 'Pasajes para viajar a Puno', 'APPROVED', Base::mes()]];
        foreach ($lista as [$p, $monto, $on, $why, $st, $per]) {
            $id = $this->emp[$p];
            $pagado = $st === 'PAID';
            DB::table('salary_advances')->insert(['number' => 'AD-'.str_pad((string) ++$n, 5, '0', STR_PAD_LEFT), 'employee_id' => $id, 'requested_by' => $this->usuario($p) ?? $this->usuario('Gabriela Soto'),
                'requested_on' => $on, 'amount' => $monto, 'max_amount' => \App\Modulos\Per\Services\Adelantos::maximo($id, $on), 'reason' => $why, 'status' => $st,
                'approved_by' => $st === 'REQUESTED' ? null : $rosa, 'approved_at' => $st === 'REQUESTED' ? null : CarbonImmutable::parse($on)->addDay()->setTime(12, 0)->toIso8601String(),
                'decision_note' => $st === 'REJECTED' ? 'RN-PER-09: supera el 30 % de su remuneración' : null, 'deduct_period' => $per,
                'cash_account_id' => $pagado ? DB::table('cash_accounts')->where('tenant_id', $this->t)->where('code', 'BCP-CTE')->value('id') : null,
                'paid_at' => $pagado ? CarbonImmutable::parse($on)->addDay()->setTime(16, 0)->toIso8601String() : null, 'payment_reference' => $pagado ? 'TR-'.mt_rand(100000, 999999) : null]);
        }
    }

    private function planillaYPagos(): void
    {
        $g = $this->gerente;
        foreach (['2026-08-01', '2026-09-01', '2026-10-01'] as $m) {
            Intercambio::importar($m, 'AYNI_HR', null, $g, CarbonImmutable::parse(Base::sumarMeses($m, 1))->addDays(3)->setTime(17, 30)->toIso8601String());
        }
        Intercambio::registrarExportacion('2026-09-01', 'AYNI_HR', Intercambio::variables('2026-09-01'), $g);
        $cuenta = DB::table('cash_accounts')->where('tenant_id', $this->t)->where('code', 'BCP-CTE')->value('id');
        foreach (['2026-09-01', '2026-10-01'] as $m) {
            if (Comisiones::cerrado($m)) {
                Pagos::generar($m, $g);
            }
        }
        // setiembre: aprobados y pagados (los retenidos siguen retenidos)
        foreach (DB::table('staff_payouts')->where('period', '2026-09-01')->where('status', 'DRAFT')->get() as $p) {
            if ($p->employee_id === $g->employee_id) {
                continue;
            }
            Pagos::aprobar($p->id, $g);
            Pagos::pagar($p->id, ['cash_account_id' => $cuenta, 'reference' => 'TR-'.mt_rand(100000, 999999)], $g);
        }
    }
}
