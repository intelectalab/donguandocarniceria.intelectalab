<?php

namespace App\Modulos\Per\Services;

use App\Models\User;
use App\Support\Access;
use App\Support\Events;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * PER-12 Pagos al personal: liquidación por persona y período con comisiones, bonos, jornales, adelantos y multas (FLO).
 * RN-PER-14: neto = bruto − descuentos (también lo exige la base); no se paga sin aprobación; los adelantos aprobados se
 * descuentan en su período. RN-PER-20: con alertas graves abiertas el pago de comisiones queda retenido.
 */
final class Pagos
{
    /** Arma la liquidación del período (sin guardar). */
    public static function construir(string $empleado, string $periodo): array
    {
        $fin = Base::finDeMes($periodo);
        $t = Comisiones::totales($periodo, $empleado);
        $lineas = [];
        if ($t['neta'] > 0) {
            $lineas[] = ['concept' => 'COMMISSION', 'amount' => $t['neta'], 'note' => Base::soles($t['base']).' cobrados sin IGV'.($t['reversos'] ? '; reversos '.Base::soles($t['reversos']) : '')];
        }
        if ($t['bonos'] > 0) {
            $lineas[] = ['concept' => 'DELIVERY_BONUS', 'amount' => $t['bonos'], 'note' => "{$t['entregas']} entregas"];
        }
        $c = Personal::condicion($empleado, $fin);
        if ($c && in_array($c->pay_scheme, ['DAILY', 'HOURLY'], true)) {
            $dias = DB::table('attendance_days')->where('employee_id', $empleado)->whereBetween('work_date', [$periodo, $fin])->whereIn('status', ['PRESENT', 'LATE'])->get();
            if ($c->pay_scheme === 'DAILY' && $dias->count()) {
                $lineas[] = ['concept' => 'WAGE', 'amount' => Base::r($dias->count() * (float) $c->daily_rate), 'note' => $dias->count().' jornales × '.Base::soles((float) $c->daily_rate)];
            } elseif ($c->pay_scheme === 'HOURLY' && $dias->sum('worked_minutes') > 0) {
                $h = Base::r(($dias->sum('worked_minutes') - $dias->sum('unauthorized_minutes')) / 60, 2);   // RN-PER-08: el tiempo no autorizado no se paga
                $lineas[] = ['concept' => 'WAGE', 'amount' => Base::r($h * (float) $c->hourly_rate), 'note' => number_format($h, 2, ',', '.').' h × '.Base::soles((float) $c->hourly_rate)];
            }
        }
        foreach (DB::table('salary_advances')->where('employee_id', $empleado)->whereIn('status', ['APPROVED', 'PAID'])->where('deduct_period', '<=', $periodo)->get() as $a) {
            $lineas[] = ['concept' => 'ADVANCE_DEDUCTION', 'amount' => (float) $a->amount, 'ref_type' => 'salary_advance', 'ref_id' => $a->id, 'note' => "Adelanto {$a->number} del ".Base::fecha($a->requested_on)];
        }
        if (DB::getSchemaBuilder()->hasTable('traffic_fines')) {
            foreach (DB::table('traffic_fines')->where('employee_id', $empleado)->where('deduct_from_payout', true)->whereNull('deducted_payout_id')
                ->where('fine_date', '<=', $fin)->whereNotIn('status', ['VOIDED', 'APPEALED', 'ANNULLED'])->get() as $f) {
                $monto = (float) ($f->paid_amount ?: $f->amount);
                if ($monto > 0) {
                    $lineas[] = ['concept' => 'FINE_DEDUCTION', 'amount' => Base::r($monto), 'ref_type' => 'traffic_fine', 'ref_id' => $f->id, 'note' => "Papeleta {$f->ballot_number} (FLO)"];
                }
            }
        }
        if ($t['neta'] > 0) {
            $plan = Comisiones::plan('SELLER_COLLECTED', null, null, $fin);
            $n = Supervision::confirmadas($empleado, $periodo);
            $pct = $plan && $n ? min(50, $n * (float) $plan->alert_penalty_pct) : 0;
            if ($pct > 0) {
                $lineas[] = ['concept' => 'OTHER_DEDUCTION', 'amount' => Base::r($t['neta'] * $pct / 100), 'note' => "Penalidad {$pct} % por {$n} alerta(s) de control grave(s) con llamada de atención"];
            }
        }
        $bruto = Base::r(array_sum(array_map(fn ($l) => $l['amount'], array_filter($lineas, fn ($l) => ! in_array($l['concept'], Base::DESCUENTOS, true)))));
        $desc = Base::r(array_sum(array_map(fn ($l) => $l['amount'], array_filter($lineas, fn ($l) => in_array($l['concept'], Base::DESCUENTOS, true)))));
        // los descuentos nunca dejan el neto en negativo: lo que no alcanza queda para el mes siguiente
        if ($desc > $bruto) {
            $lineas = self::recortar($lineas, $bruto);
            $desc = Base::r(array_sum(array_map(fn ($l) => $l['amount'], array_filter($lineas, fn ($l) => in_array($l['concept'], Base::DESCUENTOS, true)))));
        }
        $tipos = array_unique(array_map(fn ($l) => $l['concept'], array_filter($lineas, fn ($l) => ! in_array($l['concept'], Base::DESCUENTOS, true))));
        $tipo = count($tipos) > 1 ? 'MIXED' : (in_array('COMMISSION', $tipos, true) ? 'COMMISSIONS' : (in_array('WAGE', $tipos, true) ? 'WAGES' : 'BONUS'));

        return ['employee_id' => $empleado, 'period' => $periodo, 'payout_type' => $tipo, 'gross_amount' => $bruto, 'deductions_amount' => $desc, 'net_amount' => Base::r($bruto - $desc), 'lines' => $lineas];
    }

    private static function recortar(array $lineas, float $tope): array
    {
        $out = [];
        $resto = $tope;
        foreach ($lineas as $l) {
            if (! in_array($l['concept'], Base::DESCUENTOS, true)) {
                $out[] = $l;

                continue;
            }
            if ($resto <= 0 || $l['concept'] === 'OTHER_DEDUCTION' && $resto < $l['amount']) {
                continue;   // pasa al mes siguiente (el adelanto o la multa siguen pendientes)
            }
            if ($l['amount'] <= $resto) {
                $out[] = $l;
                $resto = Base::r($resto - $l['amount']);
            }
        }

        return $out;
    }

    /** RN-PER-14: valida montos y guarda el pago con sus líneas. */
    public static function guardar(array $d, User $u, ?string $estado = null, ?string $retencion = null): string
    {
        $bruto = Base::r($d['gross_amount'] ?? 0);
        $desc = Base::r($d['deductions_amount'] ?? 0);
        $neto = Base::r($d['net_amount'] ?? null);
        if ($bruto < 0 || $desc < 0) {
            RuleError::fail('RN-PER-14', 'Bruto y descuentos no son negativos.');
        }
        if (abs($neto - Base::r($bruto - $desc)) > 0.004) {
            RuleError::fail('RN-PER-14', 'El neto debe ser bruto − descuentos: '.Base::soles($bruto).' − '.Base::soles($desc).' = '.Base::soles(Base::r($bruto - $desc)).', no '.Base::soles($neto).'.');
        }
        $lineas = $d['lines'] ?? [];
        $sb = Base::r(array_sum(array_map(fn ($l) => (float) $l['amount'], array_filter($lineas, fn ($l) => ! in_array($l['concept'], Base::DESCUENTOS, true)))));
        $sd = Base::r(array_sum(array_map(fn ($l) => (float) $l['amount'], array_filter($lineas, fn ($l) => in_array($l['concept'], Base::DESCUENTOS, true)))));
        if ($lineas && (abs($sb - $bruto) > 0.004 || abs($sd - $desc) > 0.004)) {
            RuleError::fail('RN-PER-14', 'El bruto y los descuentos deben ser la suma de sus líneas.');
        }
        if (DB::table('staff_payouts')->where('employee_id', $d['employee_id'])->where('period', $d['period'])->where('status', '<>', 'VOIDED')->exists()) {
            RuleError::fail('RN-PER-14', Base::nombre($d['employee_id']).' ya tiene un pago de '.Base::nombreMes($d['period']).'.');
        }
        $id = DB::table('staff_payouts')->insertGetId(['number' => Base::numero('staff_payouts', 'PG-'), 'employee_id' => $d['employee_id'], 'period' => $d['period'],
            'payout_type' => $d['payout_type'] ?? 'MIXED', 'gross_amount' => $bruto, 'deductions_amount' => $desc, 'net_amount' => $neto,
            'status' => $estado ?? 'DRAFT', 'held_reason' => $retencion, 'created_by' => $u->id]);
        foreach ($lineas as $l) {
            DB::table('staff_payout_lines')->insert(['payout_id' => $id, 'concept' => $l['concept'], 'amount' => Base::r($l['amount']), 'ref_type' => $l['ref_type'] ?? null,
                'ref_id' => $l['ref_id'] ?? null, 'note' => isset($l['note']) ? mb_substr($l['note'], 0, 300) : null]);
        }

        return $id;
    }

    /** Genera los pagos del período para quienes tienen comisiones, bonos, jornales o descuentos (los que ya tienen, no). */
    public static function generar(string $periodo, User $u): array
    {
        if (! Access::can($u, 'per.commission.manage') && ! Access::can($u, 'per.payout.approve')) {
            RuleError::fail('RN-PER-14', 'Generar los pagos requiere per.commission.manage.');
        }
        if (! Comisiones::cerrado($periodo)) {
            RuleError::fail('RN-PER-15', 'Las comisiones de '.Base::nombreMes($periodo).' cierran el '.Base::fecha(Comisiones::cierre($periodo)).': genera los pagos después del cierre.');
        }
        Comisiones::procesar($periodo);
        Supervision::vincular();
        $fin = Base::finDeMes($periodo);
        $ids = DB::table('commission_entries')->where('period', $periodo)->distinct()->pluck('employee_id')
            ->merge(DB::table('employment_terms')->whereIn('pay_scheme', ['DAILY', 'HOURLY'])->where('valid_from', '<=', $fin)
                ->where(fn ($w) => $w->whereNull('valid_to')->orWhere('valid_to', '>=', $periodo))->pluck('employee_id'))->unique()->values();
        $n = ['creados' => 0, 'retenidos' => 0, 'ya_tenian' => 0, 'sin_monto' => 0];

        return DB::transaction(function () use ($ids, $periodo, $u, &$n) {
            foreach ($ids as $id) {
                if (DB::table('staff_payouts')->where('employee_id', $id)->where('period', $periodo)->where('status', '<>', 'VOIDED')->exists()) {
                    $n['ya_tenian']++;

                    continue;
                }
                $d = self::construir($id, $periodo);
                if (! $d['lines'] || $d['gross_amount'] <= 0) {
                    $n['sin_monto']++;

                    continue;
                }
                $ret = null;
                if (Base::sino('per_block_commission_on_open_alerts', true) && collect($d['lines'])->contains('concept', 'COMMISSION') && ($g = Supervision::gravesAbiertas($id))) {
                    $ret = "RN-PER-20: {$g} alerta(s) de control grave(s) abierta(s); se retiene hasta su revisión en PER-13.";
                }
                self::guardar($d, $u, $ret ? 'HELD' : 'DRAFT', $ret);
                $n[$ret ? 'retenidos' : 'creados']++;
            }

            return $n;
        });
    }

    public static function lista(string $periodo, User $u): array
    {
        $vis = Base::visibles($u);
        $ve = Base::veSueldos($u);
        $yo = Base::yo($u);
        $pagos = DB::table('staff_payouts as p')->join('employees as e', 'e.id', '=', 'p.employee_id')->leftJoin('users as a', 'a.id', '=', 'p.approved_by')
            ->leftJoin('cash_accounts as c', 'c.id', '=', 'p.cash_account_id')->where('p.period', $periodo)
            ->when($vis !== null, fn ($w) => $w->whereIn('p.employee_id', $ve ? $vis : array_filter([$yo])))->orderBy('e.full_name')
            ->get(['p.*', 'e.full_name', 'a.name as aprobo', 'c.name as cuenta']);
        $lineas = DB::table('staff_payout_lines')->whereIn('payout_id', $pagos->pluck('id'))->orderBy('concept')->get()->groupBy('payout_id');
        $aprueba = Access::can($u, 'per.payout.approve');
        $filas = $pagos->map(function ($p) use ($u, $lineas, $aprueba, $yo) {
            $v = fn ($x) => Base::monto($u, $p->employee_id, $x);

            return ['id' => $p->id, 'number' => $p->number, 'employee_id' => $p->employee_id, 'trabajador' => $p->full_name, 'payout_type' => $p->payout_type,
                'gross_amount' => $v($p->gross_amount), 'deductions_amount' => $v($p->deductions_amount), 'net_amount' => $v($p->net_amount), 'status' => $p->status,
                'held_reason' => $p->held_reason, 'aprobo' => $p->aprobo, 'approved_at' => Asistencia::iso($p->approved_at), 'paid_at' => Asistencia::iso($p->paid_at),
                'payment_reference' => $p->payment_reference, 'cuenta' => $p->cuenta,
                'lineas' => ($lineas[$p->id] ?? collect())->map(fn ($l) => ['concept' => $l->concept, 'concepto' => Base::CONCEPTOS[$l->concept], 'amount' => $v($l->amount),
                    'descuento' => in_array($l->concept, Base::DESCUENTOS, true), 'note' => $l->note])->values()->all(),
                'puede_aprobar' => $aprueba && $p->status === 'DRAFT' && $p->employee_id !== $yo, 'puede_pagar' => $aprueba && $p->status === 'APPROVED',
                'puede_liberar' => $p->status === 'HELD' && (Access::can($u, 'per.commission.manage') || $aprueba)];
        })->all();
        $activos = $pagos->where('status', '<>', 'VOIDED');

        return ['periodo' => $periodo, 'nombre' => Base::nombreMes($periodo), 'cerrado' => Comisiones::cerrado($periodo), 'cierre' => Comisiones::cierre($periodo), 'data' => $filas,
            'resumen' => ['pagos' => $activos->count(), 'borrador' => $activos->where('status', 'DRAFT')->count(), 'retenidos' => $activos->where('status', 'HELD')->count(),
                'aprobados' => $activos->where('status', 'APPROVED')->count(), 'pagados' => $activos->where('status', 'PAID')->count(),
                'neto' => $ve ? Base::r($activos->sum('net_amount')) : null, 'bruto' => $ve ? Base::r($activos->sum('gross_amount')) : null]];
    }

    /** ¿Cuántos pagos retenidos del trabajador ya se pueden liberar? */
    public static function liberables(string $empleado): int
    {
        return Supervision::gravesAbiertas($empleado) ? 0 : DB::table('staff_payouts')->where('employee_id', $empleado)->where('status', 'HELD')->count();
    }

    public static function liberar(string $id, ?string $nota, User $u): array
    {
        $p = DB::table('staff_payouts')->where('id', $id)->first() ?? abort(404, 'No se encontró el pago.');
        if ($p->status !== 'HELD') {
            RuleError::fail('RN-PER-20', 'El pago no está retenido.');
        }
        if (! Access::can($u, 'per.commission.manage') && ! Access::can($u, 'per.payout.approve')) {
            RuleError::fail('RN-PER-20', 'Liberar un pago retenido requiere per.commission.manage.');
        }
        if ($g = Supervision::gravesAbiertas($p->employee_id)) {
            RuleError::fail('RN-PER-20', Base::nombre($p->employee_id)." aún tiene {$g} alerta(s) grave(s) abierta(s): registra la acción en PER-13 antes de liberar el pago.");
        }
        DB::table('staff_payouts')->where('id', $id)->update(['status' => 'DRAFT', 'held_reason' => mb_substr($p->held_reason.' · Liberado: '.(trim((string) $nota) ?: 'alertas revisadas'), 0, 500), 'updated_at' => now()]);

        return ['id' => $id, 'status' => 'DRAFT'];
    }

    public static function aprobar(string $id, User $u): array
    {
        $p = DB::table('staff_payouts')->where('id', $id)->first() ?? abort(404, 'No se encontró el pago.');
        if (! Access::can($u, 'per.payout.approve')) {
            RuleError::fail('RN-PER-14', 'Aprobar pagos al personal requiere per.payout.approve.');
        }
        if ($p->status === 'HELD') {
            RuleError::fail('RN-PER-20', 'El pago está retenido por alertas de control graves abiertas.');
        }
        if ($p->status !== 'DRAFT') {
            RuleError::fail('RN-PER-14', 'Solo se aprueba un pago en borrador.');
        }
        if ($p->employee_id === Base::yo($u)) {
            RuleError::fail('RN-PER-14', 'Nadie aprueba su propio pago.');
        }
        DB::table('staff_payouts')->where('id', $id)->update(['status' => 'APPROVED', 'approved_by' => $u->id, 'approved_at' => now(), 'updated_at' => now()]);
        Events::emit('payout.approved', 'staff_payouts', $id, ['employee_id' => $p->employee_id, 'period' => $p->period, 'net_amount' => (float) $p->net_amount]);

        return ['id' => $id, 'status' => 'APPROVED'];
    }

    public static function pagar(string $id, array $d, User $u): array
    {
        $p = DB::table('staff_payouts')->where('id', $id)->first() ?? abort(404, 'No se encontró el pago.');
        if ($p->status !== 'APPROVED') {
            RuleError::fail('RN-PER-14', 'No se paga sin aprobación.');
        }
        if (! Access::can($u, 'per.payout.approve')) {
            RuleError::fail('RN-PER-14', 'Registrar el pago requiere per.payout.approve.');
        }
        if (empty($d['cash_account_id']) || ! DB::table('cash_accounts')->where('id', $d['cash_account_id'])->exists()) {
            RuleError::fail('RN-PER-14', 'Elige la cuenta de la que sale el pago.');
        }
        $ref = Base::obligatorio($d['reference'] ?? '', 'RN-CAJ-02', 'Indica el número de operación de la transferencia.', 3, 60);

        return DB::transaction(function () use ($p, $d, $ref) {
            DB::table('staff_payouts')->where('id', $p->id)->update(['status' => 'PAID', 'cash_account_id' => $d['cash_account_id'], 'paid_at' => now(), 'payment_reference' => $ref, 'updated_at' => now()]);
            foreach (DB::table('staff_payout_lines')->where('payout_id', $p->id)->whereNotNull('ref_id')->get() as $l) {
                if ($l->ref_type === 'salary_advance') {
                    DB::table('salary_advances')->where('id', $l->ref_id)->update(['status' => 'DEDUCTED', 'deducted_payout_id' => $p->id, 'updated_at' => now()]);
                } elseif ($l->ref_type === 'traffic_fine') {
                    DB::table('traffic_fines')->where('id', $l->ref_id)->whereNull('deducted_payout_id')->update(['deducted_payout_id' => $p->id, 'updated_at' => now()]);
                }
            }
            Events::emit('payout.paid', 'staff_payouts', $p->id, ['employee_id' => $p->employee_id, 'period' => $p->period, 'net_amount' => (float) $p->net_amount, 'cash_account_id' => $d['cash_account_id']]);

            return ['id' => $p->id, 'status' => 'PAID'];
        });
    }

    public static function anular(string $id, string $motivo, User $u): array
    {
        $p = DB::table('staff_payouts')->where('id', $id)->first() ?? abort(404, 'No se encontró el pago.');
        if (! in_array($p->status, ['DRAFT', 'HELD', 'APPROVED'], true)) {
            RuleError::fail('RN-PER-14', 'Un pago pagado no se anula.');
        }
        if (! Access::can($u, 'per.payout.approve') && ! Access::can($u, 'per.commission.manage')) {
            RuleError::fail('RN-PER-14', 'Anular un pago requiere per.payout.approve.');
        }
        $motivo = Base::obligatorio($motivo, 'RN-PER-14', 'Indica el motivo (al menos 10 letras).', 10);
        DB::table('staff_payouts')->where('id', $id)->update(['status' => 'VOIDED', 'void_reason' => $motivo, 'updated_at' => now()]);

        return ['id' => $id, 'status' => 'VOIDED'];
    }
}
