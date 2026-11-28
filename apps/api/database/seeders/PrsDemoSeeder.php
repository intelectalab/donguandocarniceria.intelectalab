<?php

namespace Database\Seeders;

use App\Modulos\Prs\Services\Alertas;
use App\Modulos\Prs\Services\Base;
use App\Modulos\Prs\Services\Ejecucion;
use App\Modulos\Prs\Services\Real;
use App\Modulos\Prs\Services\Versiones;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

/**
 * PRS · demo de presupuesto para Don Guando (como en el prototipo, aycha-proto/src/modules/PRS.js):
 * - 28 conceptos (8 grupos) con su mapeo a ventas, costo de ventas, categorías de GAS, personal (PER) y una cuenta de CNT.
 * - Presupuesto 2026: v1 reemplazada, v2 vigente (reproyección de julio) y v3 por aprobar (campaña navideña).
 * - Real congelado de enero a agosto (meses cerrados), con dos corridas en agosto (RN-PRS-09).
 * - Presupuesto 2027 en borrador, copiado del real 2026 con +8 %, más capacitación sin mapeo (no se puede enviar, RN-PRS-02).
 * - Proyección guardada y alertas de setiembre (al 30/09) y octubre (al 10/10, último día con datos de la demo).
 * Corre como el usuario de la aplicación (SET ROLE aycha_app) para que RLS separe las empresas, igual que en la app.
 * La semilla aleatoria es fija.
 */
class PrsDemoSeeder extends Seeder
{
    private const CONCEPTOS = [
        ['ING', 'Ingresos', null, 'INCOME'], ['ING-VTA', 'Ventas de productos', 'ING', 'INCOME', 'VARIABLE', 'VEN-DG'],
        ['COS', 'Costo de ventas', null, 'COST_OF_SALES'], ['COS-VTA', 'Costo de los productos vendidos', 'COS', 'COST_OF_SALES', 'VARIABLE', 'VEN-DG'],
        ['GPE', 'Gastos de personal', null, 'EXPENSE'], ['GPE-PLA', 'Planilla y cargas sociales', 'GPE', 'EXPENSE', 'FIXED', 'ADM'],
        ['GPE-COM', 'Comisiones y bonos por entrega', 'GPE', 'EXPENSE', 'VARIABLE', 'VEN-DG'], ['GPE-CAP', 'Capacitación del personal', 'GPE', 'EXPENSE', 'VARIABLE', 'RRHH'],
        ['PUB', 'Publicidad y marketing', null, 'EXPENSE'], ['PUB-PLA', 'Publicidad en plataformas', 'PUB', 'EXPENSE', 'VARIABLE', 'MKT-DG'],
        ['PUB-CRE', 'Creadores de contenido', 'PUB', 'EXPENSE', 'VARIABLE', 'MKT-DG'], ['PUB-MUE', 'Muestras y degustaciones', 'PUB', 'EXPENSE', 'VARIABLE', 'VEN-DG'],
        ['DLV', 'Delivery y reparto', null, 'EXPENSE'], ['DLV-COM', 'Combustible', 'DLV', 'EXPENSE', 'VARIABLE', 'DEL'],
        ['DLV-ALQ', 'Alquiler de vehículos', 'DLV', 'EXPENSE', 'FIXED', 'DEL'], ['DLV-VEH', 'Mantenimiento, SOAT, peajes y multas', 'DLV', 'EXPENSE', 'VARIABLE', 'DEL'],
        ['DLV-TER', 'Empresas de delivery y fletes a provincia', 'DLV', 'EXPENSE', 'VARIABLE', 'DEL'], ['DLV-REP', 'Alimentación, movilidad y jornales del reparto', 'DLV', 'EXPENSE', 'VARIABLE', 'DEL'],
        ['EMP', 'Empaques e insumos', null, 'EXPENSE'], ['EMP-EMP', 'Empaques e impresiones', 'EMP', 'EXPENSE', 'VARIABLE', 'PROD-L2'],
        ['EMP-INS', 'Insumos menores de producción', 'EMP', 'EXPENSE', 'VARIABLE', 'PROD-L2'],
        ['OCU', 'Ocupación y servicios', null, 'EXPENSE'], ['OCU-ALQ', 'Alquiler de locales', 'OCU', 'EXPENSE', 'FIXED', 'ADM'],
        ['OCU-SER', 'Luz, agua e internet', 'OCU', 'EXPENSE', 'FIXED', 'ADM'], ['OCU-MAN', 'Mantenimiento de equipos y cámaras', 'OCU', 'EXPENSE', 'VARIABLE', 'PROD-L2'],
        ['ADM', 'Administración', null, 'EXPENSE'], ['ADM-GEN', 'Útiles, limpieza, trámites y otros', 'ADM', 'EXPENSE', 'VARIABLE', 'ADM'],
        ['ADM-HON', 'Honorarios profesionales', 'ADM', 'EXPENSE', 'VARIABLE', 'ADM'],
    ];

    private const MAPEOS = [
        ['ING-VTA', 'SALES', null], ['COS-VTA', 'COST_OF_SALES', null], ['GPE-PLA', 'PAYROLL', 'PAYROLL'], ['GPE-COM', 'PAYROLL', 'COMMISSION'], ['GPE-COM', 'PAYROLL', 'BONUS'],
        ['PUB-PLA', 'EXPENSE_CATEGORY', 'PUB-ANUN'], ['PUB-CRE', 'EXPENSE_CATEGORY', 'PUB-CREA'], ['PUB-MUE', 'EXPENSE_CATEGORY', 'COM-MUE'],
        ['DLV-COM', 'EXPENSE_CATEGORY', 'DEL-COMB'], ['DLV-ALQ', 'EXPENSE_CATEGORY', 'DEL-ALQ'], ['DLV-VEH', 'EXPENSE_CATEGORY', 'DEL-MANT'], ['DLV-VEH', 'EXPENSE_CATEGORY', 'DEL-SOAT'],
        ['DLV-VEH', 'EXPENSE_CATEGORY', 'DEL-PEAJE'], ['DLV-VEH', 'EXPENSE_CATEGORY', 'DEL-MULTA'], ['DLV-TER', 'EXPENSE_CATEGORY', 'DEL-EMP'], ['DLV-TER', 'EXPENSE_CATEGORY', 'DEL-PROV'],
        ['DLV-REP', 'EXPENSE_CATEGORY', 'DEL-ALIM'], ['DLV-REP', 'EXPENSE_CATEGORY', 'DEL-MOV'], ['DLV-REP', 'EXPENSE_CATEGORY', 'DEL-JOR'],
        ['EMP-EMP', 'EXPENSE_CATEGORY', 'INS-EMP'], ['EMP-INS', 'EXPENSE_CATEGORY', 'PRO-INS'], ['OCU-ALQ', 'EXPENSE_CATEGORY', 'ALQ-LOC'],
        ['OCU-SER', 'EXPENSE_CATEGORY', 'SER-LUZ'], ['OCU-SER', 'EXPENSE_CATEGORY', 'SER-AGUA'], ['OCU-SER', 'EXPENSE_CATEGORY', 'SER-INT'], ['OCU-MAN', 'EXPENSE_CATEGORY', 'EQU-MAN'],
        ['ADM-GEN', 'EXPENSE_CATEGORY', 'ADM-UTI'], ['ADM-GEN', 'EXPENSE_CATEGORY', 'ADM-TRA'], ['ADM-GEN', 'EXPENSE_CATEGORY', 'OTR'], ['ADM-HON', 'ACCOUNT', '6321'],
    ];

    /** Líneas base (importe de octubre; las variables siguen la estacionalidad): concepto, marca, local, centro, importe. */
    private const BASE = [
        ['ING-VTA', 'DG', null, 'VEN-DG', 62000], ['ING-VTA', 'M2', null, 'VEN-M2', 10800], ['ING-VTA', 'M3', null, 'VEN-M3', 6800], ['ING-VTA', 'M4', null, 'VEN-M4', 3300], ['ING-VTA', 'M5', null, 'VEN-M5', 6600],
        ['COS-VTA', 'DG', null, 'VEN-DG', 44600], ['COS-VTA', 'M2', null, 'VEN-M2', 7800], ['COS-VTA', 'M3', null, 'VEN-M3', 3700], ['COS-VTA', 'M4', null, 'VEN-M4', 1750], ['COS-VTA', 'M5', null, 'VEN-M5', 3400],
        ['GPE-COM', null, 'L1', 'VEN-DG', 2400], ['GPE-COM', null, 'L1', 'DEL', 950],
        ['PUB-PLA', 'DG', null, 'MKT-DG', 6000], ['PUB-PLA', 'M2', null, 'MKT-M2', 600], ['PUB-PLA', 'M3', null, 'MKT-M3', 500], ['PUB-PLA', 'M4', null, 'MKT-M4', 400], ['PUB-PLA', 'M5', null, 'MKT-M5', 1100],
        ['PUB-CRE', 'DG', null, 'MKT-DG', 800], ['PUB-CRE', 'M2', null, 'MKT-M2', 1500], ['PUB-MUE', 'DG', 'L1', 'VEN-DG', 150],
        ['DLV-COM', null, 'L1', 'DEL', 1900], ['DLV-COM', null, 'L2', 'DEL', 350], ['DLV-ALQ', null, 'L2', 'DEL', 1170], ['DLV-VEH', null, 'L1', 'DEL', 520], ['DLV-VEH', null, 'L2', 'DEL', 80],
        ['DLV-TER', null, 'L1', 'DEL', 2600], ['DLV-REP', null, 'L1', 'DEL', 160], ['DLV-REP', null, 'L2', 'DEL', 110],
        ['EMP-EMP', null, 'L2', 'PROD-L2', 1500], ['EMP-INS', null, 'L2', 'PROD-L2', 100],
        ['OCU-ALQ', null, 'L1', 'ADM', 4500], ['OCU-ALQ', null, 'L2', 'PROD-L2', 3000], ['OCU-SER', null, 'L1', 'ADM', 470], ['OCU-SER', null, 'L1', 'PROD-L1', 1650], ['OCU-SER', null, 'L2', 'PROD-L2', 2620],
        ['OCU-MAN', null, 'L2', 'PROD-L2', 600], ['ADM-GEN', null, 'L1', 'ADM', 250],
    ];

    private const ESTACIONALIDAD = [0.90, 0.86, 0.93, 0.95, 1.00, 0.97, 1.03, 0.98, 0.99, 1.00, 1.03, 1.20];

    private int $semilla = 72072;

    private function azar(): float
    {
        $this->semilla = ($this->semilla * 1103515245 + 12345) % 2147483648;

        return $this->semilla / 2147483648;
    }

    public function run(): void
    {
        $t = (string) DB::table('tenants')->where('name', 'like', '%DON GUANDO%')->value('id');
        if (! $t) {
            return;
        }
        DB::select("SELECT set_config('app.tenant_id', ?, false)", [$t]);
        $rol = DB::selectOne('SELECT current_user AS u')->u;
        $cambiar = $rol !== 'aycha_app' && DB::selectOne("SELECT pg_has_role(current_user, 'aycha_app', 'MEMBER') OR (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS ok")->ok;
        if ($cambiar) {
            DB::statement('SET ROLE aycha_app');
        }
        try {
            if (! DB::table('budget_concepts')->exists()) {
                $this->sembrar();
            }
        } finally {
            if ($cambiar) {
                DB::statement('RESET ROLE');
            }
            DB::select("SELECT set_config('app.tenant_id', '', false)");
        }
    }

    private function sembrar(): void
    {
        $empresa = DB::table('cost_centers')->whereNotNull('company_id')->groupBy('company_id')->orderByRaw('count(*) DESC')->value('company_id')
            ?? DB::table('companies')->orderBy('created_at')->value('id');
        $cc = DB::table('cost_centers')->pluck('id', 'code');
        $marca = DB::table('brands')->pluck('id', 'code');
        $local = DB::table('establishments')->pluck('id', 'code');
        $cat = DB::table('expense_categories')->pluck('id', 'code');
        $porRol = fn (string $r) => DB::table('users as u')->join('user_roles as ur', 'ur.user_id', '=', 'u.id')->join('roles as r', 'r.id', '=', 'ur.role_id')
            ->where('r.code', $r)->where('u.status', 'ACTIVE')->orderBy('u.name')->first(['u.id', 'u.name']);
        $adm = $porRol('ADMINISTRACION');
        $ger = $porRol('GERENTE');
        $cnt = $porRol('CONTADORA');
        $mkt = $porRol('MARKETING');
        $coo = $porRol('COORDINADOR_DELIVERY');
        $pro = $porRol('JEFE_PRODUCCION');
        if (! $adm || ! $ger || ! $empresa) {
            return;
        }

        // Conceptos y mapeos
        $id = [];
        foreach (self::CONCEPTOS as $i => $c) {
            [$code, $name, $padre, $tipo] = $c;
            $id[$code] = DB::table('budget_concepts')->insertGetId(['code' => $code, 'name' => $name, 'parent_id' => $padre ? $id[$padre] : null, 'is_group' => ! $padre,
                'concept_type' => $tipo, 'behavior' => $padre ? $c[4] : null, 'default_cost_center_id' => isset($c[5]) ? ($cc[$c[5]] ?? null) : null,
                'status' => 'ACTIVE', 'sort_order' => ($i + 1) * 10, 'created_at' => '2025-11-20 09:00:00-05'], 'id');
        }
        foreach (self::MAPEOS as [$c, $src, $ref]) {
            $r = $src === 'EXPENSE_CATEGORY' ? ($cat[$ref] ?? null) : $ref;
            if ($src === 'EXPENSE_CATEGORY' && ! $r) {
                continue;
            }
            DB::table('budget_concept_mappings')->insert(['concept_id' => $id[$c], 'source' => $src, 'ref' => $r, 'status' => 'ACTIVE', 'created_by' => $cnt?->id,
                'note' => $src === 'ACCOUNT' ? 'Asesoría y consultoría (PCGE 6321); aporta al real cuando exista CNT' : null, 'created_at' => '2025-11-20 09:00:00-05']);
        }

        // Planilla presupuestada por centro de costo (sueldo × 1,215 de los trabajadores activos).
        $base = self::BASE;
        $pla = DB::table('employees as e')->leftJoin('cost_centers as c', 'c.id', '=', 'e.cost_center_id')->where('e.status', 'ACTIVE')->where('e.monthly_salary', '>', 0)
            ->whereNotNull('e.cost_center_id')->groupBy('c.code', 'c.establishment_id')->orderBy('c.code')
            ->selectRaw('c.code, c.establishment_id, sum(e.monthly_salary) AS s')->get();
        $codLocal = array_flip($local->all());
        foreach ($pla as $p) {
            $base[] = ['GPE-PLA', null, $p->establishment_id ? ($codLocal[$p->establishment_id] ?? null) : null, $p->code, round($p->s * Real::CARGAS_SOCIALES / 10) * 10];
        }
        $meses26 = Base::meses(2026);
        $monto = function (array $b, int $i, int $ver) {
            [$code, $br] = $b;
            $a = $b[4];
            $fijo = in_array($code, ['GPE-PLA', 'DLV-ALQ', 'OCU-ALQ', 'OCU-SER'], true);
            if (! $fijo) {
                $a *= self::ESTACIONALIDAD[$i];
            }
            if ($ver === 1 || ($ver >= 2 && $i < 6)) {
                if ($code === 'PUB-PLA' && $br === 'DG') {
                    $a = 4500 * self::ESTACIONALIDAD[$i];
                }
                if ($code === 'ING-VTA' && $br === 'DG') {
                    $a *= 0.95;
                }
                if ($code === 'DLV-TER') {
                    $a = 2200 * self::ESTACIONALIDAD[$i];
                }
            }
            if ($ver === 3 && $i >= 10) {
                if ($code === 'PUB-PLA' && $br === 'DG') {
                    $a = 7500 * self::ESTACIONALIDAD[$i];
                }
                if ($code === 'ING-VTA' && $br === 'DG') {
                    $a *= 1.06;
                }
                if ($code === 'DLV-TER') {
                    $a = 3200 * self::ESTACIONALIDAD[$i];
                }
                if ($code === 'GPE-COM' && $b[3] === 'VEN-DG') {
                    $a = 2800 * self::ESTACIONALIDAD[$i];
                }
            }

            return round($a / 10) * 10;
        };

        $hist = fn (array $pasos) => json_encode(array_map(fn ($p) => array_filter(['at' => $p[0], 'action' => $p[1], 'user' => $p[2], 'note' => $p[3] ?? null]), $pasos), JSON_UNESCAPED_UNICODE);
        $b26 = DB::table('budgets')->insertGetId(['company_id' => $empresa, 'year' => 2026, 'name' => 'Presupuesto 2026', 'status' => 'ACTIVE', 'created_by' => $adm->id,
            'created_at' => '2025-11-20 09:00:00-05'], 'id');
        $versiones = [
            1 => ['Presupuesto inicial 2026', '2025-11-20 09:00:00-05', 'COPY_ACTUAL', 6, null],
            2 => ['Reproyección de julio: más pauta para Don Guando', '2026-07-06 10:00:00-05', 'COPY_VERSION', 0, 1],
            3 => ['Ajuste de campaña navideña (nov–dic)', '2026-10-06 09:30:00-05', 'COPY_VERSION', 0, 2],
        ];
        $vid = [];
        foreach ($versiones as $no => [$nombre, $creada, $fuente, $pct, $basada]) {
            $vid[$no] = DB::table('budget_versions')->insertGetId(['budget_id' => $b26, 'version_no' => $no, 'name' => $nombre, 'status' => 'DRAFT', 'source' => $fuente,
                'adjust_pct' => $pct, 'based_on_version_id' => $basada ? $vid[$basada] : null, 'created_by' => $adm->id, 'created_at' => $creada], 'id');
            $filas = [];
            foreach ($base as $b) {
                foreach ($meses26 as $i => $m) {
                    $filas[] = ['version_id' => $vid[$no], 'concept_id' => $id[$b[0]], 'month' => $m, 'brand_id' => $b[1] ? $marca[$b[1]] : null,
                        'establishment_id' => $b[2] ? $local[$b[2]] : null, 'cost_center_id' => $cc[$b[3]] ?? null, 'amount' => $monto($b, $i, $no), 'created_at' => $creada];
                }
            }
            foreach (array_chunk($filas, 400) as $lote) {
                DB::table('budget_lines')->insert($lote);
            }
        }
        DB::table('budget_versions')->where('id', $vid[1])->update(['status' => 'SUPERSEDED', 'submitted_by' => $adm->id, 'submitted_at' => '2025-12-12 17:40:00-05',
            'approved_by' => $ger->id, 'approved_at' => '2025-12-18 10:15:00-05', 'decision_comment' => 'Aprobado. Revisar publicidad a mitad de año según resultados de Meta.',
            'superseded_at' => '2026-07-14 11:20:00-05', 'superseded_by_version_id' => $vid[2],
            'history' => $hist([['2025-11-20T09:00', 'Creada desde el real 2025 +6 %', $adm->name], ['2025-12-12T17:40', 'Enviada a aprobación', $adm->name],
                ['2025-12-18T10:15', 'Aprobada · versión vigente', $ger->name, 'Revisar publicidad a mitad de año.'], ['2026-07-14T11:20', 'Reemplazada por 2026 · v2', $ger->name]])]);
        DB::table('budget_versions')->where('id', $vid[2])->update(['status' => 'APPROVED', 'submitted_by' => $adm->id, 'submitted_at' => '2026-07-10 16:05:00-05',
            'approved_by' => $ger->id, 'approved_at' => '2026-07-14 11:20:00-05', 'decision_comment' => 'Sube Meta y Google de Don Guando a S/ 6 000 desde julio; ventas +5 %.',
            'history' => $hist([['2026-07-06T10:00', 'Creada como revisión de 2026 · v1', $adm->name],
                ['2026-07-10T16:05', 'Enviada a aprobación', $adm->name, 'Publicidad DG de 4 500 a 6 000; tercerizado de delivery 2 600'], ['2026-07-14T11:20', 'Aprobada · versión vigente', $ger->name]])]);
        DB::table('budget_versions')->where('id', $vid[3])->update(['status' => 'SUBMITTED', 'submitted_by' => $adm->id, 'submitted_at' => '2026-10-08 18:10:00-05',
            'history' => $hist([['2026-10-06T09:30', 'Creada como revisión de 2026 · v2', $adm->name],
                ['2026-10-08T18:10', 'Enviada a aprobación', $adm->name, 'Navidad: pauta DG 7 500, ventas DG +6 %, más tercerizado y comisiones en nov–dic']])]);
        DB::table('budgets')->where('id', $b26)->update(['current_version_id' => $vid[2]]);
        DB::table('notifications')->insert(['role' => 'GERENTE', 'title' => 'Presupuesto por aprobar 2026 · v3', 'body' => "{$adm->name} envió 2026 · v3 (Ajuste de campaña navideña).",
            'ref' => json_encode(['screen' => 'PRS-05', 'id' => $vid[3]]), 'tone' => 'warn', 'severity' => 'WARNING', 'module' => 'PRS', 'type' => 'APPROVALS',
            'at' => '2026-10-08 18:10:00-05', 'in_app' => true]);

        // Real congelado de enero a agosto (meses cerrados): el presupuesto de la v2 con su desvío (RN-PRS-09).
        $tipos = DB::table('budget_concepts')->get(['id', 'code', 'concept_type', 'behavior'])->keyBy('id');
        $v2 = DB::table('budget_lines')->where('version_id', $vid[2])->orderBy('month')->orderBy('id')->get();
        $cerrados = DB::table('accounting_periods')->where('company_id', $empresa)->where('status', 'CLOSED')->pluck('period')->map(fn ($p) => substr($p, 0, 10))->all();
        foreach (array_slice($meses26, 0, 8) as $mi => $m) {
            if (! in_array($m, $cerrados, true)) {
                continue;
            }
            $ventas = [];
            $filas = [];
            foreach ($v2->where('month', $m) as $l) {
                $c = $tipos[$l->concept_id];
                if ($c->concept_type === 'INCOME') {
                    $f = $ventas[$l->brand_id] = 0.92 + $this->azar() * 0.15;
                } elseif ($c->concept_type === 'COST_OF_SALES') {
                    $f = ($ventas[$l->brand_id] ?? 1) * (0.98 + $this->azar() * 0.05);
                } elseif ($c->behavior === 'FIXED') {
                    $f = $c->code === 'OCU-SER' ? 0.9 + $this->azar() * 0.18 : ($c->code === 'GPE-PLA' ? 0.97 + $this->azar() * 0.04 : 1);
                } else {
                    $f = 0.8 + $this->azar() * 0.38;
                }
                if ($c->code === 'PUB-PLA' && $l->brand_id === $marca['DG'] && $mi >= 5) {
                    $f = 1.04 + $this->azar() * 0.12;
                }
                $filas[] = ['concept_id' => $l->concept_id, 'brand_id' => $l->brand_id, 'establishment_id' => $l->establishment_id, 'cost_center_id' => $l->cost_center_id,
                    'amount' => round($l->amount * $f, 2), 'source' => $c->concept_type === 'EXPENSE' ? (str_starts_with($c->code, 'GPE') ? 'PER' : 'GAS') : 'FAC'];
            }
            $cuando = date('Y-m-d', strtotime(Base::finDeMes($m).' +8 days')).' 18:00:00-05';
            Real::congelar($m, $empresa, null, 'Cierre del período '.Base::nombreMes($m).' (period.closed)', null, $filas, $cuando);
            if ($mi === 7) {
                $filas2 = array_map(fn ($x) => $x['concept_id'] === $id['OCU-SER'] && $x['cost_center_id'] === ($cc['PROD-L2'] ?? null) ? ['amount' => round($x['amount'] + 380, 2)] + $x : $x, $filas);
                Real::congelar($m, $empresa, null, 'Recálculo: factura de luz de agosto del Local 2 registrada después del cierre', null, $filas2, '2026-09-15 12:30:00-05');
            }
        }

        // Presupuesto 2027 en borrador: real 2026 +8 %, y capacitación sin mapeo (RN-PRS-02).
        $b27 = DB::table('budgets')->insertGetId(['company_id' => $empresa, 'year' => 2027, 'name' => 'Presupuesto 2027', 'status' => 'ACTIVE', 'created_by' => $adm->id,
            'created_at' => '2026-10-09 15:00:00-05'], 'id');
        $v27 = DB::table('budget_versions')->insertGetId(['budget_id' => $b27, 'version_no' => 1, 'name' => 'Borrador 2027 desde el real 2026 +8 %', 'status' => 'DRAFT',
            'source' => 'COPY_ACTUAL', 'adjust_pct' => 8, 'created_by' => $adm->id, 'created_at' => '2026-10-09 15:00:00-05'], 'id');
        $meses27 = Base::meses(2027);
        $agg = [];
        foreach (Versiones::baseDelReal(2026, $empresa, Base::hoy()) as $b) {
            $k = Ejecucion::clave($b).'|'.$b['i'];
            $agg[$k] ??= $b + ['suma' => 0.0];
            $agg[$k]['suma'] += $b['amount'];
        }
        $nombres = ['CLOSED' => 'cerrado', 'COMPLETE' => 'real', 'CURRENT' => 'proyección', 'FUTURE' => 'presupuesto'];
        $filas = [];
        $total = 0.0;
        foreach ($agg as $b) {
            $x = round(Versiones::aplicarPct($b['suma'], 8));
            if ($x > 0) {
                $total += $x;
                $filas[] = ['version_id' => $v27, 'concept_id' => $b['concept_id'], 'month' => $meses27[$b['i']], 'brand_id' => $b['brand_id'], 'establishment_id' => $b['establishment_id'],
                    'cost_center_id' => $b['cost_center_id'], 'amount' => $x, 'note' => 'Real 2026 ('.$nombres[$b['estado']].') +8 %', 'created_at' => '2026-10-09 15:05:00-05'];
            }
        }
        foreach ([3, 8] as $mo) {
            $filas[] = ['version_id' => $v27, 'concept_id' => $id['GPE-CAP'], 'month' => $meses27[$mo - 1], 'brand_id' => null, 'establishment_id' => null,
                'cost_center_id' => $cc['RRHH'] ?? $cc['ADM'], 'amount' => 1800, 'note' => 'Curso BPM y manipulación de alimentos (sin mapeo aún)', 'created_at' => '2026-10-09 15:20:00-05'];
        }
        foreach (array_chunk($filas, 400) as $lote) {
            DB::table('budget_lines')->insert($lote);
        }
        DB::table('budget_versions')->where('id', $v27)->update(['history' => $hist([['2026-10-09T15:00', 'Creada', $adm->name],
            ['2026-10-09T15:05', 'Copiado el real 2026 con +8 % ('.count($filas).' líneas, '.Base::soles($total).')', $adm->name]])]);

        // Alertas de setiembre (al 30/09) y de octubre (al 10/10), con los comentarios de los responsables.
        $this->alertas($vid[2], '2026-09-01', '2026-09-30', $empresa, '2026-10-01 07:00:00-05');
        $txt = ['PUB-CRE' => [$mkt, 'Serie de 4 videos de Renzo Parrillero para Marca 2 aprobada fuera de presupuesto; en octubre solo un video.', 'CLOSED'],
            'DLV-VEH' => [$coo, 'Papeleta SAT de la furgoneta y cambio de cadena de MTB-456; se descuenta la multa al conductor (PER).', 'CLOSED'],
            'OCU-MAN' => [$pro, 'Mantenimiento correctivo de la cámara de frío de Lurín; no se repite en el trimestre.', 'CLOSED'],
            'EMP-EMP' => [$pro, 'Compra de bolsas impresas para 2 meses (stock hasta noviembre).', 'ACK'],
            'DLV-COM' => [$coo, 'Más rutas a Lurín por los pedidos de Fiestas Patrias atrasados; en octubre vuelve a lo normal.', 'ACK']];
        foreach (DB::table('budget_alerts')->where('period', '2026-09-01')->get() as $a) {
            $code = $tipos[$a->concept_id]->code;
            if (isset($txt[$code]) && $txt[$code][0]) {
                $this->comentar($a, $txt[$code][0]->name, $txt[$code][1], $txt[$code][2], '2026-10-03 10:30:00-05');
            }
        }
        $this->alertas($vid[2], '2026-10-01', '2026-10-10', $empresa, '2026-10-10 07:00:00-05');
        $pa = DB::table('budget_alerts')->where('period', '2026-10-01')->where('concept_id', $id['PUB-PLA'])->where('brand_id', $marca['DG'])->first();
        if ($pa && $mkt) {
            $this->comentar($pa, $mkt->name, 'Adelantamos pauta por el Día de la Canción Criolla (31/10). Desde el 15/10 bajamos el diario de Meta a S/ 120 para cerrar cerca de S/ 6 300.', 'ACK', '2026-10-10 09:20:00-05');
        }
        // Proyecciones guardadas de octubre (al 05/10 y al 10/10).
        foreach ([['2026-10-05', '2026-10-05 19:00:00-05'], ['2026-10-10', '2026-10-10 19:00:00-05']] as [$al, $cuando]) {
            $this->proyeccion($vid[2], '2026-10-01', $al, $empresa, $cnt?->id ?? $adm->id, $cuando);
        }
        $this->command?->info('PRS: '.DB::table('budget_lines')->count().' líneas en 4 versiones, '.DB::table('budget_actuals')->count().' filas de real congelado y '
            .DB::table('budget_alerts')->count().' alertas (PRS-01 a PRS-10)');
    }

    private function alertas(string $version, string $mes, string $al, string $empresa, string $cuando): void
    {
        $ex = Ejecucion::calcular($version, [$mes], $al, $empresa, false, false);
        foreach ($ex['slots'] as $s) {
            if ($s['type'] === 'INCOME' || $s['budget'] <= 0) {
                continue;
            }
            Alertas::evaluar(['version_id' => $version, 'period' => $mes, 'concept_id' => $s['concept_id'], 'brand_id' => $s['brand_id'], 'establishment_id' => $s['establishment_id'],
                'cost_center_id' => $s['cost_center_id'], 'budget' => $s['budget'], 'actual' => $s['actual'], 'forecast' => $s['forecast'], 'type' => $s['type'], 'fixed' => $s['fixed'], 'al' => $al], true, $cuando);
        }
    }

    private function comentar(object $a, string $quien, string $texto, string $estado, string $cuando): void
    {
        $c = json_decode($a->comments, true) ?: [];
        $c[] = ['at' => substr(str_replace(' ', 'T', $cuando), 0, 16), 'user' => $quien, 'text' => $texto];
        DB::table('budget_alerts')->where('id', $a->id)->update(['comments' => json_encode($c, JSON_UNESCAPED_UNICODE), 'status' => $estado,
            'closed_at' => $estado === 'CLOSED' ? $cuando : null]);
    }

    private function proyeccion(string $version, string $mes, string $al, string $empresa, string $usuario, string $cuando): void
    {
        $ex = Ejecucion::calcular($version, [$mes], $al, $empresa, false, false);
        $run = (string) \Ramsey\Uuid\Uuid::uuid4();
        $filas = [];
        foreach ($ex['slots'] as $s) {
            $x = $s['months'][$mes];
            $filas[] = ['version_id' => $version, 'period' => $mes, 'run_id' => $run, 'as_of' => $al, 'method' => 'LINEAR_DAYS', 'concept_id' => $s['concept_id'],
                'brand_id' => $s['brand_id'], 'establishment_id' => $s['establishment_id'], 'cost_center_id' => $s['cost_center_id'], 'budget' => $x['budget'], 'actual' => $x['actual'],
                'forecast' => $x['forecast'], 'forecast_pct' => Base::pct($x['forecast'], $x['budget']), 'light' => Base::semaforoDe($x['budget'], $x['forecast'], $s['type']),
                'days_elapsed' => Base::transcurridos($mes, $al), 'days_in_month' => Base::diasDelMes($mes), 'created_by' => $usuario, 'created_at' => $cuando];
        }
        foreach (array_chunk($filas, 300) as $lote) {
            DB::table('budget_forecasts')->insert($lote);
        }
    }
}
