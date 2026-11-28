<?php

namespace App\Modulos\Gas\Services;

use App\Models\User;
use App\Support\Access;
use App\Support\Events;
use App\Support\Params;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * GAS-07 Caja chica y GAS-08 Rendición (RN-GAS-09). Cada local tiene un fondo con responsable, monto y máximo por
 * gasto. Los gastos de caja chica entran en la rendición abierta del fondo; la rendición suma sus gastos aprobados
 * y pide la reposición por ese total. La reposición la registra administración desde una cuenta de CAJ.
 */
final class CajaChica
{
    /** Gastos que ocupan el fondo hasta que se repone: enviados, aprobados o pagados en una rendición no repuesta. */
    private const OCUPAN = ['SUBMITTED', 'APPROVED', 'PAID'];

    public static function gestiona(User $u): bool
    {
        return Access::can($u, 'gas.petty_cash.manage');
    }

    public static function fondoDe(string $localId): ?object
    {
        return DB::table('petty_cash_funds')->where('establishment_id', $localId)->where('status', 'ACTIVE')->first();
    }

    public static function fondoDeGasto(object $g): ?object
    {
        if ($g->petty_cash_report_id && ($f = DB::table('petty_cash_reports')->where('id', $g->petty_cash_report_id)->value('fund_id'))) {
            return DB::table('petty_cash_funds')->where('id', $f)->first();
        }

        return self::fondoDe($g->establishment_id);
    }

    public static function maximo(object $fondo): float
    {
        return (float) ($fondo->max_expense_amount ?? Params::get('gas_petty_cash_max_expense') ?? 200);
    }

    /** Lo ocupado del fondo: gastos que aún no se reponen. */
    public static function ocupado(string $fondoId, ?string $sinGasto = null): float
    {
        return Base::r(DB::table('expenses as e')->join('petty_cash_reports as r', 'r.id', '=', 'e.petty_cash_report_id')
            ->where('r.fund_id', $fondoId)->whereIn('r.status', ['OPEN', 'SUBMITTED', 'APPROVED'])->whereIn('e.status', self::OCUPAN)
            ->when($sinGasto, fn ($w) => $w->where('e.id', '<>', $sinGasto))->sum('e.amount_pen'));
    }

    public static function saldo(object $fondo, ?string $sinGasto = null): float
    {
        return Base::r((float) $fondo->fund_amount - self::ocupado($fondo->id, $sinGasto));
    }

    /** RN-GAS-09: el local tiene fondo, el gasto no pasa el máximo por gasto ni el saldo disponible. */
    public static function validarGasto(string $localId, float $soles, ?string $gastoId = null): void
    {
        $f = self::fondoDe($localId);
        if (! $f) {
            RuleError::fail('RN-GAS-09', 'Este local no tiene un fondo de caja chica activo. Elige «por pagar» o pide a administración que cree el fondo.');
        }
        $max = self::maximo($f);
        if ($soles > $max + Base::EPS) {
            RuleError::fail('RN-GAS-09', 'Un gasto de caja chica no pasa de '.Base::soles($max).' y este es de '.Base::soles($soles).'. Regístralo «por pagar».');
        }
        $saldo = self::saldo($f, $gastoId);
        if ($soles > $saldo + Base::EPS) {
            RuleError::fail('RN-GAS-09', 'La caja chica tiene '.Base::soles(max(0, $saldo)).' disponibles y el gasto es de '.Base::soles($soles).'. Envía la rendición para reponer el fondo.');
        }
    }

    /** Pone el gasto de caja chica en la rendición abierta del fondo de su local. */
    public static function asignar(string $gastoId): void
    {
        $g = DB::table('expenses')->where('id', $gastoId)->first();
        $f = self::fondoDe($g->establishment_id);
        if (! $f) {
            return;
        }
        $actual = $g->petty_cash_report_id ? DB::table('petty_cash_reports')->where('id', $g->petty_cash_report_id)->first() : null;
        if ($actual && $actual->fund_id === $f->id && $actual->status === 'OPEN') {
            self::recalcular($actual->id);

            return;
        }
        $abierta = self::abierta($f);
        DB::table('expenses')->where('id', $gastoId)->update(['petty_cash_report_id' => $abierta->id]);
        self::recalcular($abierta->id);
        if ($actual) {
            self::recalcular($actual->id);
        }
    }

    /** La rendición abierta del fondo (o una nueva). */
    public static function abierta(object $f): object
    {
        $r = DB::table('petty_cash_reports')->where('fund_id', $f->id)->where('status', 'OPEN')->lockForUpdate()->first();
        if ($r) {
            return $r;
        }
        $codigo = DB::table('establishments')->where('id', $f->establishment_id)->value('code') ?: 'CC';
        $hoy = Base::hoy();
        $id = DB::table('petty_cash_reports')->insertGetId([
            'fund_id' => $f->id, 'number' => Base::numero('petty_cash_reports', 'RCC-'.$codigo.'-', 4),
            'period_from' => $hoy, 'period_to' => $hoy, 'total_expenses' => 0, 'status' => 'OPEN',
        ], 'id');

        return DB::table('petty_cash_reports')->where('id', $id)->first();
    }

    /** La rendición suma sus gastos aprobados (y pagados); la abierta llega hasta hoy. */
    public static function recalcular(string $reportId): void
    {
        $r = DB::table('petty_cash_reports')->where('id', $reportId)->first();
        if (! $r || $r->status === 'REIMBURSED') {
            return;
        }
        $total = Base::r(DB::table('expenses')->where('petty_cash_report_id', $reportId)->whereIn('status', ['APPROVED', 'PAID'])->sum('amount_pen'));
        $cambios = ['total_expenses' => $total, 'updated_at' => now()];
        if ($r->status === 'OPEN') {
            $cambios['period_to'] = max($r->period_from, Base::hoy());
        }
        DB::table('petty_cash_reports')->where('id', $reportId)->update($cambios);
    }

    /** Usuarios que pueden custodiar un fondo: personal activo de la empresa (no clientes B2B ni soporte de la plataforma). */
    public static function personal()
    {
        return DB::table('users')->where('status', 'ACTIVE')
            ->where(fn ($w) => $w->whereNull('user_type')->orWhereNotIn('user_type', ['PLATFORM_SUPPORT', 'B2B_CUSTOMER']));
    }

    /** Total de la rendición: la abierta se suma en vivo (sus gastos cambian), las demás guardan su total. */
    public static function totalDe(object $r): float
    {
        return $r->status === 'OPEN'
            ? Base::r(DB::table('expenses')->where('petty_cash_report_id', $r->id)->whereIn('status', ['APPROVED', 'PAID'])->sum('amount_pen'))
            : (float) $r->total_expenses;
    }

    private static function rendicion(string $id): object
    {
        $r = DB::table('petty_cash_reports')->where('id', $id)->lockForUpdate()->first();
        if (! $r) {
            abort(404, 'No se encontró la rendición.');
        }

        return $r;
    }

    private static function esResponsable(object $r, User $u): bool
    {
        return DB::table('petty_cash_funds')->where('id', $r->fund_id)->value('custodian_user_id') === $u->id;
    }

    /** Envía la rendición: los gastos aún sin aprobar pasan a la nueva rendición abierta. */
    public static function enviar(string $id, User $u): object
    {
        DB::transaction(function () use ($id, $u) {
            $r = self::rendicion($id);
            if (! self::gestiona($u) && ! self::esResponsable($r, $u)) {
                RuleError::fail('RN-GAS-09', 'La rendición la envía el responsable del fondo o administración.');
            }
            if ($r->status !== 'OPEN') {
                RuleError::fail('RN-GAS-09', 'Solo se envía una rendición abierta.');
            }
            self::recalcular($id);
            $total = (float) DB::table('petty_cash_reports')->where('id', $id)->value('total_expenses');
            if ($total <= Base::EPS) {
                RuleError::fail('RN-GAS-09', 'La rendición no tiene gastos aprobados que reponer.');
            }
            $pendientes = DB::table('expenses')->where('petty_cash_report_id', $id)->whereIn('status', ['DRAFT', 'SUBMITTED', 'REJECTED'])->pluck('id');
            DB::table('petty_cash_reports')->where('id', $id)->update([
                'status' => 'SUBMITTED', 'period_to' => max($r->period_from, Base::hoy()), 'replenishment_amount' => $total,
                'submitted_at' => now(), 'submitted_by' => $u->id, 'updated_at' => now(),
            ]);
            if ($pendientes->isNotEmpty()) {
                $nueva = self::abierta(DB::table('petty_cash_funds')->where('id', $r->fund_id)->first());
                DB::table('expenses')->whereIn('id', $pendientes)->update(['petty_cash_report_id' => $nueva->id, 'updated_at' => now()]);
                self::recalcular($nueva->id);
            }
            Events::emit('petty_cash.report_submitted', 'petty_cash_reports', $id, ['number' => $r->number, 'total' => $total]);
        });

        return DB::table('petty_cash_reports')->where('id', $id)->first();
    }

    public static function aprobar(string $id, User $u): object
    {
        DB::transaction(function () use ($id, $u) {
            $r = self::rendicion($id);
            if (! self::gestiona($u)) {
                RuleError::fail('RN-GAS-09', 'La rendición la aprueba administración.');
            }
            if ($r->status !== 'SUBMITTED') {
                RuleError::fail('RN-GAS-09', 'Solo se aprueba una rendición enviada.');
            }
            if ($r->submitted_by === $u->id) {
                RuleError::fail('RN-GAS-08', 'Quien envió la rendición no la aprueba: lo hace otra persona.');
            }
            DB::table('petty_cash_reports')->where('id', $id)->update(['status' => 'APPROVED', 'approved_by' => $u->id, 'approved_at' => now(), 'updated_at' => now()]);
            Events::emit('petty_cash.report_approved', 'petty_cash_reports', $id, ['number' => $r->number, 'amount' => (float) $r->replenishment_amount]);
        });

        return DB::table('petty_cash_reports')->where('id', $id)->first();
    }

    /** Devuelve la rendición con motivo: sus gastos vuelven a la rendición abierta para corregirla. */
    public static function devolver(string $id, string $motivo, User $u): object
    {
        DB::transaction(function () use ($id, $motivo, $u) {
            $r = self::rendicion($id);
            if (! self::gestiona($u)) {
                RuleError::fail('RN-GAS-09', 'La rendición la revisa administración.');
            }
            if ($r->status !== 'SUBMITTED') {
                RuleError::fail('RN-GAS-09', 'Solo se devuelve una rendición enviada.');
            }
            if (mb_strlen(trim($motivo)) < 5) {
                RuleError::fail('RN-GAS-09', 'Escribe el motivo de la devolución.');
            }
            $abierta = self::abierta(DB::table('petty_cash_funds')->where('id', $r->fund_id)->first());
            DB::table('expenses')->where('petty_cash_report_id', $id)->update(['petty_cash_report_id' => $abierta->id, 'updated_at' => now()]);
            DB::table('petty_cash_reports')->where('id', $abierta->id)->update(['period_from' => min($r->period_from, $abierta->period_from), 'updated_at' => now()]);
            DB::table('petty_cash_reports')->where('id', $id)->update(['status' => 'REJECTED', 'rejected_by' => $u->id, 'rejected_at' => now(),
                'rejection_reason' => mb_substr(trim($motivo), 0, 255), 'total_expenses' => 0, 'replenishment_amount' => null, 'updated_at' => now()]);
            self::recalcular($abierta->id);
        });

        return DB::table('petty_cash_reports')->where('id', $id)->first();
    }

    /** Reposición del fondo desde una cuenta de CAJ (la rendición aprobada queda repuesta). */
    public static function reponer(string $id, string $cuentaId, User $u): object
    {
        DB::transaction(function () use ($id, $cuentaId, $u) {
            $r = self::rendicion($id);
            if (! self::gestiona($u)) {
                RuleError::fail('RN-GAS-09', 'La reposición la registra administración.');
            }
            if ($r->status !== 'APPROVED') {
                RuleError::fail('RN-GAS-09', 'Solo se repone una rendición aprobada.');
            }
            $fondo = DB::table('petty_cash_funds')->where('id', $r->fund_id)->first();
            $cuenta = DB::table('cash_accounts')->where('id', $cuentaId)->where('status', 'ACTIVE')->first(['id', 'name']);
            if (! $cuenta) {
                RuleError::fail('RN-GAS-09', 'Elige una cuenta activa de donde sale la reposición.');
            }
            if ($cuenta->id === $fondo->cash_account_id) {
                RuleError::fail('RN-GAS-09', 'La reposición sale de otra cuenta, no de la misma caja chica.');
            }
            DB::table('petty_cash_reports')->where('id', $id)->update(['status' => 'REIMBURSED', 'reimbursed_at' => now(), 'reimbursed_from' => $cuenta->id, 'updated_at' => now()]);
            Events::emit('petty_cash.replenished', 'petty_cash_reports', $id, ['number' => $r->number, 'amount' => (float) $r->replenishment_amount,
                'from_account_id' => $cuenta->id, 'to_account_id' => $fondo->cash_account_id]);
        });

        return DB::table('petty_cash_reports')->where('id', $id)->first();
    }

    /** Alta o cambio de un fondo. */
    public static function guardarFondo(array $d, User $u, ?string $id = null): object
    {
        return DB::transaction(function () use ($d, $id) {
            $local = DB::table('establishments')->where('id', $d['establishment_id'] ?? null)->first(['id']);
            if (! $local) {
                RuleError::fail('RN-GAS-09', 'Elige el local del fondo.');
            }
            if (! self::personal()->where('id', $d['custodian_user_id'] ?? null)->exists()) {
                RuleError::fail('RN-GAS-09', 'Elige un responsable activo.');
            }
            $monto = Base::r($d['fund_amount'] ?? 0);
            $max = Base::r($d['max_expense_amount'] ?? 0);
            if ($monto <= 0 || $max <= 0) {
                RuleError::fail('RN-GAS-09', 'El monto del fondo y el máximo por gasto deben ser mayores que cero.');
            }
            if ($max > $monto) {
                RuleError::fail('RN-GAS-09', 'El máximo por gasto no puede pasar el monto del fondo.');
            }
            $cuenta = ! empty($d['cash_account_id']) ? DB::table('cash_accounts')->where('id', $d['cash_account_id'])->first(['id', 'account_type']) : null;
            if (! empty($d['cash_account_id']) && (! $cuenta || $cuenta->account_type !== 'PETTY_CASH')) {
                RuleError::fail('RN-GAS-09', 'La cuenta del fondo debe ser una cuenta de caja chica.');
            }
            $estado = ($d['status'] ?? 'ACTIVE') === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE';
            if ($estado === 'ACTIVE' && DB::table('petty_cash_funds')->where('establishment_id', $local->id)->where('status', 'ACTIVE')->when($id, fn ($w) => $w->where('id', '<>', $id))->exists()) {
                RuleError::fail('RN-GAS-09', 'Ese local ya tiene un fondo de caja chica activo.');
            }
            $fila = ['establishment_id' => $local->id, 'custodian_user_id' => $d['custodian_user_id'], 'fund_amount' => $monto, 'max_expense_amount' => $max,
                'cash_account_id' => $cuenta->id ?? null, 'status' => $estado, 'updated_at' => now()];
            if ($id) {
                $f = DB::table('petty_cash_funds')->where('id', $id)->lockForUpdate()->first();
                if (! $f) {
                    abort(404, 'No se encontró el fondo.');
                }
                if ($estado === 'INACTIVE' && self::ocupado($id) > Base::EPS) {
                    RuleError::fail('RN-GAS-09', 'El fondo tiene gastos sin reponer: envía y repone la rendición antes de desactivarlo.');
                }
                if ($monto + Base::EPS < self::ocupado($id)) {
                    RuleError::fail('RN-GAS-09', 'El fondo no puede ser menor que lo ya gastado sin reponer ('.Base::soles(self::ocupado($id)).').');
                }
                DB::table('petty_cash_funds')->where('id', $id)->update($fila);
            } else {
                $id = DB::table('petty_cash_funds')->insertGetId($fila, 'id');
            }

            return DB::table('petty_cash_funds')->where('id', $id)->first();
        });
    }

    /** Fondos con su saldo, la rendición abierta y la antigüedad sin rendir (KPI-GAS-06). */
    public static function fondos(User $u): array
    {
        $ver = self::gestiona($u) || Access::can($u, 'gas.expense.view_all');

        return DB::table('petty_cash_funds as f')->leftJoin('establishments as l', 'l.id', '=', 'f.establishment_id')
            ->leftJoin('users as u', 'u.id', '=', 'f.custodian_user_id')->leftJoin('cash_accounts as c', 'c.id', '=', 'f.cash_account_id')
            ->when(! $ver, fn ($w) => $w->where('f.custodian_user_id', $u->id))
            ->orderBy('l.code')->get(['f.*', 'l.name as local', 'l.code as local_codigo', 'u.name as responsable', 'c.name as cuenta'])
            ->map(function ($f) {
                $abierta = DB::table('petty_cash_reports')->where('fund_id', $f->id)->where('status', 'OPEN')->first(['id', 'number', 'status', 'total_expenses']);
                $antiguo = $abierta ? DB::table('expenses')->where('petty_cash_report_id', $abierta->id)->whereIn('status', self::OCUPAN)->min('issue_date') : null;
                $ocupado = self::ocupado($f->id);

                return [
                    'id' => $f->id, 'establishment_id' => $f->establishment_id, 'local' => $f->local, 'custodian_user_id' => $f->custodian_user_id,
                    'responsable' => $f->responsable, 'cash_account_id' => $f->cash_account_id, 'cuenta' => $f->cuenta, 'status' => $f->status,
                    'fund_amount' => (float) $f->fund_amount, 'max_expense_amount' => (float) self::maximo($f), 'ocupado' => $ocupado,
                    'saldo' => Base::r((float) $f->fund_amount - $ocupado), 'abierta' => $abierta ? ['id' => $abierta->id, 'number' => $abierta->number, 'total' => self::totalDe($abierta)] : null,
                    'dias_sin_rendir' => $antiguo ? (int) floor((strtotime(Base::hoy()) - strtotime($antiguo)) / 86400) : null,
                    'por_reponer' => Base::r(DB::table('petty_cash_reports')->where('fund_id', $f->id)->whereIn('status', ['SUBMITTED', 'APPROVED'])->sum('replenishment_amount')),
                    // Sin acceso a Gastos el responsable no ve su fondo ni envía la rendición (la envía administración por él).
                    'responsable_con_acceso' => ($c = User::find($f->custodian_user_id)) !== null && Access::module($c, 'GAS'),
                ];
            })->all();
    }

    public static function puedeVerFondo(string $fondoId, User $u): bool
    {
        return self::gestiona($u) || Access::can($u, 'gas.expense.view_all')
            || DB::table('petty_cash_funds')->where('id', $fondoId)->value('custodian_user_id') === $u->id;
    }

    /** Rendiciones de los fondos que el usuario ve. */
    public static function rendiciones(User $u, ?string $fondoId = null): array
    {
        $ver = self::gestiona($u) || Access::can($u, 'gas.expense.view_all');

        return DB::table('petty_cash_reports as r')->join('petty_cash_funds as f', 'f.id', '=', 'r.fund_id')
            ->leftJoin('establishments as l', 'l.id', '=', 'f.establishment_id')
            ->when(! $ver, fn ($w) => $w->where('f.custodian_user_id', $u->id))
            ->when($fondoId, fn ($w) => $w->where('r.fund_id', $fondoId))
            ->orderByRaw("CASE r.status WHEN 'OPEN' THEN 0 WHEN 'SUBMITTED' THEN 1 WHEN 'APPROVED' THEN 2 ELSE 3 END")->orderByDesc('r.period_to')->orderByDesc('r.number')
            ->limit(200)->get(['r.id', 'r.number', 'r.status', 'r.period_from', 'r.period_to', 'r.total_expenses', 'r.replenishment_amount', 'r.fund_id', 'l.name as local'])
            ->map(fn ($r) => ['id' => $r->id, 'number' => $r->number, 'status' => $r->status, 'estado' => Base::RENDICIONES[$r->status] ?? $r->status,
                'period_from' => $r->period_from, 'period_to' => $r->period_to, 'total' => self::totalDe($r),
                'replenishment_amount' => $r->replenishment_amount !== null ? (float) $r->replenishment_amount : null, 'fund_id' => $r->fund_id, 'local' => $r->local])->all();
    }

    /** Detalle de una rendición con sus gastos y lo que el usuario puede hacer. */
    public static function rendicionFicha(string $id, User $u): array
    {
        $r = DB::table('petty_cash_reports')->where('id', $id)->first();
        if (! $r) {
            abort(404, 'No se encontró la rendición.');
        }
        if (! self::puedeVerFondo($r->fund_id, $u)) {
            abort(403, 'Esta rendición no es de tu fondo.');
        }
        $f = DB::table('petty_cash_funds as f')->leftJoin('establishments as l', 'l.id', '=', 'f.establishment_id')->leftJoin('users as u', 'u.id', '=', 'f.custodian_user_id')
            ->where('f.id', $r->fund_id)->first(['f.*', 'l.name as local', 'u.name as responsable']);
        $nombre = fn (?string $uid) => $uid ? DB::table('users')->where('id', $uid)->value('name') : null;
        $gastos = Gastos::consulta()->where('e.petty_cash_report_id', $id)->orderBy('e.issue_date')->orderBy('e.number')->get()->map(fn ($g) => Gastos::aLista($g));
        $gestiona = self::gestiona($u);

        return [
            'id' => $r->id, 'number' => $r->number, 'status' => $r->status, 'estado' => Base::RENDICIONES[$r->status] ?? $r->status,
            'period_from' => $r->period_from, 'period_to' => $r->period_to, 'total' => self::totalDe($r),
            'replenishment_amount' => $r->replenishment_amount !== null ? (float) $r->replenishment_amount : null,
            'fondo' => ['id' => $f->id, 'local' => $f->local, 'responsable' => $f->responsable, 'fund_amount' => (float) $f->fund_amount, 'saldo' => self::saldo($f)],
            'envio' => $nombre($r->submitted_by), 'submitted_at' => $r->submitted_at, 'aprobo' => $nombre($r->approved_by), 'approved_at' => $r->approved_at,
            'reimbursed_at' => $r->reimbursed_at, 'cuenta_reposicion' => $r->reimbursed_from ? DB::table('cash_accounts')->where('id', $r->reimbursed_from)->value('name') : null,
            'devolvio' => $nombre($r->rejected_by ?? null), 'rejection_reason' => $r->rejection_reason ?? null,
            'gastos' => $gastos, 'pendientes' => $gastos->whereIn('status', ['DRAFT', 'SUBMITTED', 'REJECTED'])->count(),
            'puede' => [
                'enviar' => $r->status === 'OPEN' && ($gestiona || $f->custodian_user_id === $u->id),
                'aprobar' => $r->status === 'SUBMITTED' && $gestiona && $r->submitted_by !== $u->id,
                'devolver' => $r->status === 'SUBMITTED' && $gestiona,
                'reponer' => $r->status === 'APPROVED' && $gestiona,
            ],
        ];
    }
}
