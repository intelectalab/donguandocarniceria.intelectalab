<?php

namespace App\Modulos\Prs\Services;

use App\Models\User;
use App\Modulos\Plt\Services\Periodos;
use App\Support\Access;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;
use Ramsey\Uuid\Uuid;

/**
 * El real del presupuesto (RN-PRS-06), sin IGV y por fecha del documento:
 *  - ingresos: comprobantes aceptados − notas de crédito (FAC, subtotal);
 *  - costo de ventas: el costo de esos comprobantes;
 *  - gastos aprobados o pagados de GAS (net_pen), repartidos por centro de costo y marca si el gasto está repartido; ya incluyen
 *    combustible, mantenimientos, multas y otros costos de FLO, que se registran como gasto una sola vez (RN-FLO-17);
 *  - personal de PER (planilla, comisiones y bonos). Mientras PER no publique su costo, se estima con el sueldo × 1,215 de
 *    los trabajadores activos, en su centro de costo y prorrateado en el mes en curso;
 *  - las cuentas contables (CNT) se guardan en el mapeo y aportan cuando CNT exista.
 * Un mes cerrado (RN-PRS-09) toma la última corrida congelada en budget_actuals; si aún no tiene, se congela al consultarlo.
 */
final class Real
{
    public const CARGAS_SOCIALES = 1.215;

    /** CLOSED (período cerrado), COMPLETE (mes vencido y abierto), CURRENT o FUTURE, al corte. */
    public static function estadoMes(string $mes, string $al, string $empresa): string
    {
        $m = Base::mes($mes);
        if ($m > $al) {
            return 'FUTURE';
        }
        if (Periodos::cerrado($m, $empresa)) {
            return 'CLOSED';
        }

        return Base::finDeMes($m) < $al ? 'COMPLETE' : 'CURRENT';
    }

    public const ESTADOS_MES = ['CLOSED' => 'Cerrado', 'COMPLETE' => 'Vencido (abierto)', 'CURRENT' => 'En curso', 'FUTURE' => 'Futuro'];

    /**
     * Filas del real vivo de un mes hasta el corte: concept_id (o __UNMAPPED), brand_id, establishment_id, cost_center_id, amount,
     * source, ref_type, ref_id, label, detail, date.
     */
    public static function vivo(string $mes, string $al, string $empresa, ?array $idx = null): array
    {
        $m = Base::mes($mes);
        $fin = Base::finDeMes($m);
        $hasta = $fin < $al ? $fin : $al;
        if ($hasta < $m) {
            return [];
        }
        $idx ??= Conceptos::indice();
        $out = [];
        $ventas = self::centrosDeVenta();

        // Ingresos y costo de ventas (FAC): comprobantes aceptados; las notas de crédito restan.
        $docs = DB::table('sales_documents')->where('company_id', $empresa)->whereBetween('issue_date', [$m, $hasta])
            ->where('sunat_status', 'ACCEPTED')->whereIn('doc_type', ['INVOICE', 'RECEIPT', 'CREDIT_NOTE', 'DEBIT_NOTE'])
            ->get(['id', 'doc_type', 'full_number', 'issue_date', 'brand_id', 'establishment_id', 'subtotal', 'cost', 'customer_name']);
        $nombres = ['INVOICE' => 'Factura', 'RECEIPT' => 'Boleta', 'CREDIT_NOTE' => 'Nota de crédito', 'DEBIT_NOTE' => 'Nota de débito'];
        foreach ($docs as $d) {
            $sg = $d->doc_type === 'CREDIT_NOTE' ? -1 : 1;
            $dims = ['brand_id' => $d->brand_id, 'establishment_id' => $d->establishment_id, 'cost_center_id' => $ventas[$d->brand_id] ?? null];
            $base = ['source' => 'FAC', 'ref_type' => 'sales_documents', 'ref_id' => $d->id, 'label' => trim(($nombres[$d->doc_type] ?? $d->doc_type).' '.$d->full_number),
                'detail' => $d->customer_name, 'date' => $d->issue_date];
            $out[] = ['concept_id' => $idx['SALES'] ?? '__UNMAPPED', 'amount' => Base::r($sg * (float) $d->subtotal)] + $dims + $base;
            if ((float) $d->cost !== 0.0) {
                $out[] = ['concept_id' => $idx['COST_OF_SALES'] ?? '__UNMAPPED', 'amount' => Base::r($sg * (float) $d->cost)] + $dims + ['detail' => 'Costo de lo vendido'] + $base;
            }
        }

        // Gastos aprobados o pagados (GAS), sin IGV; si están repartidos, cada parte a su centro y marca.
        $gastos = DB::table('expenses as e')->leftJoin('expense_categories as c', 'c.id', '=', 'e.category_id')
            ->where('e.company_id', $empresa)->whereIn('e.status', ['APPROVED', 'PAID'])->whereBetween('e.issue_date', [$m, $hasta])
            ->get(['e.id', 'e.number', 'e.issue_date', 'e.category_id', 'e.brand_id', 'e.establishment_id', 'e.cost_center_id', 'e.net_pen', 'e.amount_pen',
                'e.description', 'e.allocated', 'c.name as categoria']);
        $partes = DB::table('expense_allocations')->whereIn('expense_id', $gastos->where('allocated', true)->pluck('id')->all() ?: ['00000000-0000-0000-0000-000000000000'])
            ->get(['expense_id', 'cost_center_id', 'brand_id', 'pct', 'amount'])->groupBy('expense_id');
        foreach ($gastos as $g) {
            $neto = (float) $g->net_pen;
            if (abs($neto) <= Base::EPS) {
                continue;
            }
            $base = ['concept_id' => $idx['EXPENSE_CATEGORY'][$g->category_id] ?? '__UNMAPPED', 'source' => 'GAS', 'ref_type' => 'expenses', 'ref_id' => $g->id,
                'label' => $g->number, 'detail' => $g->description, 'date' => $g->issue_date, 'category_id' => $g->category_id, 'categoria' => $g->categoria];
            $ps = $g->allocated ? ($partes[$g->id] ?? collect()) : collect();
            if ($ps->isEmpty()) {
                $out[] = $base + ['brand_id' => $g->brand_id, 'establishment_id' => $g->establishment_id, 'cost_center_id' => $g->cost_center_id, 'amount' => Base::r($neto)];

                continue;
            }
            // Reparto: la parte de cada centro sobre el total, aplicada al neto (sin IGV). La última parte cierra el redondeo.
            $total = (float) $g->amount_pen;
            $resto = $neto;
            foreach ($ps->values() as $i => $p) {
                $f = $total > Base::EPS && (float) $p->amount > 0 ? (float) $p->amount / $total : (float) $p->pct / 100;
                $monto = $i === $ps->count() - 1 ? Base::r($resto) : Base::r($neto * $f);
                $resto -= $monto;
                $out[] = $base + ['brand_id' => $p->brand_id ?? $g->brand_id, 'establishment_id' => $g->establishment_id, 'cost_center_id' => $p->cost_center_id ?? $g->cost_center_id, 'amount' => $monto];
            }
        }

        // Personal (PER): planilla, comisiones y bonos.
        foreach (self::personal($m, $hasta, $al) as $p) {
            $out[] = ['concept_id' => $idx['PAYROLL'][$p['kind']] ?? '__UNMAPPED', 'brand_id' => $p['brand_id'] ?? null, 'establishment_id' => $p['establishment_id'] ?? null,
                'cost_center_id' => $p['cost_center_id'] ?? null, 'amount' => Base::r($p['amount']), 'source' => $p['est'] ? 'PER_EST' : 'PER',
                'ref_type' => $p['ref_type'] ?? 'employees', 'ref_id' => $p['ref_id'] ?? $p['employee_id'] ?? null,
                'label' => ($p['label'] ?? (Base::PERSONAL[$p['kind']] ?? $p['kind'])).($p['est'] ? ' (estimado)' : ''), 'detail' => $p['detail'] ?? null, 'date' => $hasta];
        }

        return array_values(array_filter($out, fn ($r) => abs($r['amount']) > Base::EPS));
    }

    /** Centro de costo de ventas de cada marca (VEN-<código de marca>), para ubicar los comprobantes. */
    private static function centrosDeVenta(): array
    {
        return DB::table('cost_centers as c')->join('brands as b', 'b.id', '=', 'c.brand_id')->where('c.area', 'SALES')
            ->whereRaw("upper(c.code) = 'VEN-' || upper(b.code)")->pluck('c.id', 'c.brand_id')->all();
    }

    /** Costo de personal del mes: de PER si ya lo publica; si no, estimado (sueldo × 1,215 en el centro de costo del trabajador). */
    public static function personal(string $mes, string $hasta, string $al): array
    {
        $per = 'App\\Modulos\\Per\\Services\\CostoPersonal';
        if (class_exists($per) && method_exists($per, 'filasDelMes') && DB::getSchemaBuilder()->hasTable('employment_terms')) {
            $nombres = DB::table('employees')->pluck('full_name', 'id');

            return array_map(fn ($r) => $r + ['est' => ($r['ref_type'] ?? '') === 'employment_terms', 'detail' => $nombres[$r['employee_id'] ?? ''] ?? null],
                $per::filasDelMes($mes, $hasta));
        }
        $f = Base::finDeMes($mes) <= $al ? 1 : Base::transcurridos($mes, $al) / Base::diasDelMes($mes);
        if ($f <= 0) {
            return [];
        }
        $centros = DB::table('cost_centers')->get(['id', 'establishment_id', 'brand_id'])->keyBy('id');

        return DB::table('employees')->where('status', 'ACTIVE')->where('monthly_salary', '>', 0)
            ->where(fn ($q) => $q->whereNull('hire_date')->orWhere('hire_date', '<=', $hasta))
            ->orderBy('full_name')->get(['id', 'full_name', 'position', 'establishment_id', 'cost_center_id', 'monthly_salary'])
            ->map(function ($e) use ($centros, $f) {
                $cc = $centros[$e->cost_center_id] ?? null;

                return ['kind' => 'PAYROLL', 'est' => true, 'employee_id' => $e->id, 'cost_center_id' => $e->cost_center_id,
                    'establishment_id' => $cc?->establishment_id ?? $e->establishment_id, 'brand_id' => $cc?->brand_id, 'amount' => (float) $e->monthly_salary * self::CARGAS_SOCIALES * $f,
                    'ref_type' => 'employees', 'ref_id' => $e->id, 'label' => 'Planilla y cargas', 'detail' => $e->full_name.($e->position ? ' · '.$e->position : '')];
            })->all();
    }

    /** Corridas congeladas de un mes (la última es la que vale). */
    public static function corridas(string $mes, string $empresa): array
    {
        $users = DB::table('users')->pluck('name', 'id');

        return DB::table('budget_actuals')->where('company_id', $empresa)->where('period', Base::mes($mes))
            ->groupBy('run_id', 'run_no', 'frozen_at', 'frozen_by', 'reason')->orderBy('run_no')
            ->selectRaw('run_id, run_no, frozen_at, frozen_by, reason, sum(amount) AS total, count(*) AS filas')->get()
            ->map(fn ($r) => ['run_id' => $r->run_id, 'run_no' => (int) $r->run_no, 'frozen_at' => $r->frozen_at, 'por' => $users[$r->frozen_by] ?? 'Sistema',
                'reason' => $r->reason, 'total' => Base::r($r->total), 'filas' => (int) $r->filas])->all();
    }

    /** Filas del real de un mes al corte: congelado si el mes está cerrado (RN-PRS-09), vivo si no. */
    public static function filas(string $mes, string $al, string $empresa, ?array $idx = null): array
    {
        $m = Base::mes($mes);
        $estado = self::estadoMes($m, $al, $empresa);
        if ($estado === 'FUTURE') {
            return [];
        }
        if ($estado !== 'CLOSED') {
            return self::vivo($m, $al, $empresa, $idx);
        }
        $run = DB::table('budget_actuals')->where('company_id', $empresa)->where('period', $m)->max('run_no');
        if (! $run) {
            self::congelar($m, $empresa, null, 'Cierre del período '.Base::nombreMes($m).' (congelado al consultarlo por primera vez)', $idx);
            $run = 1;
        }

        return DB::table('budget_actuals')->where('company_id', $empresa)->where('period', $m)->where('run_no', $run)->get()
            ->map(fn ($a) => ['concept_id' => $a->concept_id ?? '__UNMAPPED', 'brand_id' => $a->brand_id, 'establishment_id' => $a->establishment_id,
                'cost_center_id' => $a->cost_center_id, 'amount' => (float) $a->amount, 'source' => 'SNAPSHOT', 'origin' => $a->source, 'ref_type' => 'budget_actuals',
                'ref_id' => $a->id, 'label' => "Corrida {$a->run_no}", 'detail' => $a->reason, 'date' => Base::finDeMes($m)])->all();
    }

    /**
     * Congela el real de un mes en una corrida nueva (nunca edita la anterior, RN-PRS-09). $filas permite congelar un real
     * calculado aparte (la demo); si no, se toma el real vivo del mes completo.
     */
    public static function congelar(string $mes, string $empresa, ?User $u, string $motivo, ?array $idx = null, ?array $filas = null, ?string $cuando = null): array
    {
        $m = Base::mes($mes);
        $hoy = Base::hoy();
        $filas ??= self::vivo($m, Base::finDeMes($m) > $hoy ? $hoy : Base::finDeMes($m), $empresa, $idx);
        $agg = [];
        foreach ($filas as $r) {
            $concepto = str_starts_with((string) $r['concept_id'], '__') ? null : $r['concept_id'];
            $k = implode('|', [$concepto, $r['brand_id'] ?? '', $r['establishment_id'] ?? '', $r['cost_center_id'] ?? '', $r['source']]);
            $agg[$k] ??= ['concept_id' => $concepto, 'brand_id' => $r['brand_id'] ?? null, 'establishment_id' => $r['establishment_id'] ?? null,
                'cost_center_id' => $r['cost_center_id'] ?? null, 'source' => $r['source'], 'amount' => 0.0];
            $agg[$k]['amount'] += $r['amount'];
        }

        return DB::transaction(function () use ($m, $empresa, $u, $motivo, $agg, $cuando) {
            DB::select('SELECT pg_advisory_xact_lock(hashtext(?))', ["prs:snapshot:{$empresa}:{$m}"]);
            $no = ((int) DB::table('budget_actuals')->where('company_id', $empresa)->where('period', $m)->max('run_no')) + 1;
            $run = (string) Uuid::uuid4();
            $cuando ??= now()->toIso8601String();
            $filas = array_map(fn ($a) => $a + ['company_id' => $empresa, 'period' => $m, 'run_id' => $run, 'run_no' => $no, 'amount' => Base::r($a['amount']),
                'frozen_at' => $cuando, 'frozen_by' => $u?->id, 'reason' => mb_substr($motivo, 0, 500), 'created_at' => $cuando], array_values($agg));
            foreach (array_chunk($filas, 300) as $lote) {
                DB::table('budget_actuals')->insert($lote);
            }

            return ['run_id' => $run, 'run_no' => $no, 'filas' => count($filas), 'total' => Base::r(array_sum(array_column($filas, 'amount')))];
        });
    }

    /** Recalcular un mes cerrado: nueva corrida (RN-PRS-09). */
    public static function recalcular(string $mes, string $empresa, User $u, ?string $motivo): array
    {
        if (! Access::can($u, 'prs.concept.manage') && ! Access::can($u, 'prs.budget.approve')) {
            RuleError::fail('RN-PRS-09', 'Recalcular el real congelado lo hacen la Contadora, Administración o Gerencia.');
        }
        $m = Base::mes($mes);
        if (! Periodos::cerrado($m, $empresa)) {
            RuleError::fail('RN-PRS-09', Base::nombreMes($m).' no está cerrado: su real se calcula en vivo y no se congela.');
        }
        $motivo = trim((string) $motivo);
        if (mb_strlen($motivo) < 10) {
            RuleError::fail('RN-PRS-09', 'Escribe por qué se recalcula (al menos 10 letras): queda en la corrida.');
        }

        return self::congelar($m, $empresa, $u, $motivo);
    }
}
