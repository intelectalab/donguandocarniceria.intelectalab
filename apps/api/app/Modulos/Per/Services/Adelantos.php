<?php

namespace App\Modulos\Per\Services;

use App\Models\User;
use App\Support\Access;
use App\Support\Events;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/** PER-09 Adelantos (RN-PER-09): tope del 30 % de la remuneración, uno abierto por trabajador, quien pide no aprueba. */
final class Adelantos
{
    public const ESTADOS = ['REQUESTED', 'APPROVED', 'REJECTED', 'PAID', 'DEDUCTED', 'CANCELLED'];

    public static function maximo(string $empleado, ?string $fecha = null): float
    {
        return Base::r(Personal::remuneracion($empleado, $fecha) * Base::num('per_advance_max_pct', 30) / 100);
    }

    public static function lista(User $u, ?string $estado = null): array
    {
        $vis = Base::visibles($u);
        $ve = Base::veSueldos($u);
        $yo = Base::yo($u);
        $filas = DB::table('salary_advances as a')->join('employees as e', 'e.id', '=', 'a.employee_id')->leftJoin('users as r', 'r.id', '=', 'a.requested_by')
            ->leftJoin('users as ap', 'ap.id', '=', 'a.approved_by')->leftJoin('cash_accounts as c', 'c.id', '=', 'a.cash_account_id')
            ->when($vis !== null, fn ($w) => $w->whereIn('a.employee_id', $vis))->when($estado, fn ($w) => $w->where('a.status', $estado))
            ->orderByDesc('a.requested_on')->orderByDesc('a.number')->limit(500)
            ->get(['a.*', 'e.full_name', 'r.name as pidio', 'ap.name as aprobo', 'c.name as cuenta'])
            ->map(fn ($a) => ['id' => $a->id, 'number' => $a->number, 'employee_id' => $a->employee_id, 'trabajador' => $a->full_name, 'requested_on' => $a->requested_on,
                'amount' => Base::monto($u, $a->employee_id, $a->amount), 'max_amount' => Base::monto($u, $a->employee_id, $a->max_amount), 'reason' => $a->reason, 'status' => $a->status,
                'pidio' => $a->pidio, 'aprobo' => $a->aprobo, 'approved_at' => Asistencia::iso($a->approved_at), 'decision_note' => $a->decision_note,
                'deduct_period' => $a->deduct_period, 'paid_at' => Asistencia::iso($a->paid_at), 'payment_reference' => $a->payment_reference, 'cuenta' => $a->cuenta,
                'puede_decidir' => $a->status === 'REQUESTED' && Access::can($u, 'per.advance.approve') && $a->requested_by !== $u->id && $a->employee_id !== $yo,
                'puede_pagar' => $a->status === 'APPROVED' && Access::can($u, 'per.payout.approve')])->all();
        $todos = DB::table('salary_advances')->when($vis !== null, fn ($w) => $w->whereIn('employee_id', $vis));

        return ['data' => $filas, 've_sueldos' => $ve, 'resumen' => [
            'por_aprobar' => (clone $todos)->where('status', 'REQUESTED')->count(),
            'por_pagar' => (clone $todos)->where('status', 'APPROVED')->count(),
            'abiertos' => (clone $todos)->whereIn('status', ['REQUESTED', 'APPROVED', 'PAID'])->count(),
            'monto_abierto' => $ve ? Base::r((clone $todos)->whereIn('status', ['APPROVED', 'PAID'])->sum('amount')) : null,
            'tope_pct' => Base::num('per_advance_max_pct', 30),
        ]];
    }

    public static function pedir(array $d, User $u): array
    {
        $emp = ($d['employee_id'] ?? null) ?: Base::yo($u);
        $e = Base::trabajador($emp);
        if ($e->id !== Base::yo($u) && ! Base::gestiona($u) && ! Access::can($u, 'per.advance.approve')) {
            RuleError::fail('RN-PER-19', 'Solo pides adelantos para ti.');
        }
        $monto = $d['amount'] ?? null;
        if (! is_numeric($monto) || (float) $monto <= 0) {
            RuleError::fail('RN-PER-09', 'El monto del adelanto debe ser mayor que cero.');
        }
        $monto = Base::r($monto);
        $hoy = Base::hoy();
        $max = self::maximo($e->id, $hoy);
        $pct = Base::num('per_advance_max_pct', 30);
        if ($monto > $max) {
            RuleError::fail('RN-PER-09', 'El adelanto de '.Base::soles($monto).' supera el '.rtrim(rtrim(number_format($pct, 2, ',', ''), '0'), ',').' % de la remuneración mensual ('
                .Base::soles(Personal::remuneracion($e->id, $hoy)).'): máximo '.Base::soles($max).'.');
        }
        $motivo = Base::obligatorio($d['reason'] ?? '', 'RN-PER-09', 'Indica el motivo del adelanto.', 3);
        $periodo = Base::mesValido($d['deduct_period'] ?? Base::mes($hoy));
        if ($periodo < Base::mes($hoy)) {
            RuleError::fail('RN-PER-09', 'El período de descuento no puede ser un mes pasado.');
        }

        return DB::transaction(function () use ($e, $monto, $max, $motivo, $periodo, $hoy, $u) {
            DB::select('SELECT pg_advisory_xact_lock(hashtext(?))', ['per:adelanto:'.$e->id]);
            $abierto = DB::table('salary_advances')->where('employee_id', $e->id)->whereIn('status', ['REQUESTED', 'APPROVED', 'PAID'])->first();
            if ($abierto) {
                RuleError::fail('RN-PER-09', "{$e->full_name} ya tiene un adelanto abierto ({$abierto->number}, ".Base::soles((float) $abierto->amount).'): se descuenta antes de pedir otro.');
            }
            $id = DB::table('salary_advances')->insertGetId(['number' => Base::numero('salary_advances', 'AD-'), 'employee_id' => $e->id, 'requested_by' => $u->id,
                'requested_on' => $hoy, 'amount' => $monto, 'max_amount' => $max, 'reason' => $motivo, 'status' => 'REQUESTED', 'deduct_period' => $periodo]);
            Base::avisar(['role' => 'RRHH'], 'Adelanto por aprobar', "{$e->full_name} pidió un adelanto de ".Base::soles($monto).'.', 'PER-09', $id);

            return ['id' => $id];
        });
    }

    public static function decidir(string $id, bool $aprobar, ?string $nota, User $u): array
    {
        $a = DB::table('salary_advances')->where('id', $id)->first() ?? abort(404, 'No se encontró el adelanto.');
        if ($a->status !== 'REQUESTED') {
            RuleError::fail('RN-PER-09', 'El adelanto ya fue resuelto.');
        }
        if (! Access::can($u, 'per.advance.approve')) {
            RuleError::fail('RN-PER-09', 'Aprobar adelantos requiere per.advance.approve.');
        }
        if ($a->requested_by === $u->id || $a->employee_id === Base::yo($u)) {
            RuleError::fail('RN-PER-09', 'Lo aprueba una persona distinta de quien lo pide.');
        }
        if (! $aprobar) {
            Base::obligatorio($nota, 'RN-PER-09', 'Indica por qué se rechaza.', 5);
        }
        DB::table('salary_advances')->where('id', $id)->update(['status' => $aprobar ? 'APPROVED' : 'REJECTED', 'approved_by' => $u->id, 'approved_at' => now(),
            'decision_note' => trim((string) $nota) ?: null, 'updated_at' => now()]);
        Events::emit($aprobar ? 'advance.approved' : 'advance.rejected', 'salary_advances', $id, ['employee_id' => $a->employee_id, 'amount' => (float) $a->amount]);

        return ['id' => $id, 'status' => $aprobar ? 'APPROVED' : 'REJECTED'];
    }

    public static function pagar(string $id, array $d, User $u): array
    {
        $a = DB::table('salary_advances')->where('id', $id)->first() ?? abort(404, 'No se encontró el adelanto.');
        if ($a->status !== 'APPROVED') {
            RuleError::fail('RN-PER-09', 'Solo se paga un adelanto aprobado.');
        }
        if (! Access::can($u, 'per.payout.approve')) {
            RuleError::fail('RN-PER-14', 'Registrar el pago requiere per.payout.approve.');
        }
        if (empty($d['cash_account_id']) || ! DB::table('cash_accounts')->where('id', $d['cash_account_id'])->exists()) {
            RuleError::fail('RN-PER-14', 'Elige la cuenta de la que sale el pago.');
        }
        $ref = Base::obligatorio($d['reference'] ?? '', 'RN-CAJ-02', 'Indica el número de operación de la transferencia.', 3, 60);
        DB::table('salary_advances')->where('id', $id)->update(['status' => 'PAID', 'cash_account_id' => $d['cash_account_id'], 'paid_at' => now(), 'payment_reference' => $ref, 'updated_at' => now()]);
        Events::emit('advance.paid', 'salary_advances', $id, ['employee_id' => $a->employee_id, 'amount' => (float) $a->amount, 'cash_account_id' => $d['cash_account_id']]);

        return ['id' => $id, 'status' => 'PAID'];
    }

    public static function anular(string $id, User $u): array
    {
        $a = DB::table('salary_advances')->where('id', $id)->first() ?? abort(404, 'No se encontró el adelanto.');
        if ($a->status !== 'REQUESTED') {
            RuleError::fail('RN-PER-09', 'Solo se anula un adelanto que aún no se aprueba.');
        }
        if ($a->requested_by !== $u->id && ! Access::can($u, 'per.advance.approve')) {
            RuleError::fail('RN-PER-09', 'Lo anula quien lo pidió o quien aprueba adelantos.');
        }
        DB::table('salary_advances')->where('id', $id)->update(['status' => 'CANCELLED', 'updated_at' => now()]);

        return ['id' => $id, 'status' => 'CANCELLED'];
    }
}
