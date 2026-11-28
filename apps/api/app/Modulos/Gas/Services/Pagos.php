<?php

namespace App\Modulos\Gas\Services;

use App\Models\User;
use App\Support\Access;
use App\Support\Events;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * GAS-04 Gastos por pagar y pagados. Un gasto aprobado «por pagar» se paga desde una cuenta de CAJ: el gasto guarda
 * la cuenta, el monto en soles (total menos la retención), la fecha y la referencia; CAJ lee esos pagos como egresos.
 * El reverso deja el gasto aprobado otra vez (RN-GAS-14: un pagado se anula solo con el reverso del pago).
 */
final class Pagos
{
    /** Pagan administración y gerencia. */
    public static function puede(User $u): bool
    {
        return Access::can($u, 'gas.petty_cash.manage') || Access::can($u, 'gas.expense.approve_admin');
    }

    public static function pagar(string $id, string $cuentaId, ?string $referencia, User $u, ?string $fecha = null): object
    {
        DB::transaction(function () use ($id, $cuentaId, $referencia, $u, $fecha) {
            $g = DB::table('expenses')->where('id', $id)->lockForUpdate()->first();
            if (! $g) {
                abort(404, 'No se encontró el gasto.');
            }
            if (! self::puede($u)) {
                RuleError::fail('RN-GAS-14', 'El pago de gastos lo registra administración.');
            }
            if ($g->status !== 'APPROVED' || $g->pay_source === 'PETTY') {
                RuleError::fail('RN-GAS-14', $g->pay_source === 'PETTY' ? 'Los gastos de caja chica se pagan con el fondo y se reponen con la rendición.' : 'Solo se paga un gasto aprobado.');
            }
            $cuenta = DB::table('cash_accounts')->where('id', $cuentaId)->where('status', 'ACTIVE')->first(['id', 'name', 'account_type']);
            if (! $cuenta) {
                RuleError::fail('RN-GAS-14', 'Elige una cuenta activa de donde sale el pago.');
            }
            if (in_array($cuenta->account_type, ['PETTY_CASH', 'DRIVER_CASH', 'GATEWAY', 'CARD_ACQUIRER'], true)) {
                RuleError::fail('RN-GAS-14', 'Ese tipo de cuenta no paga gastos por tesorería: elige un banco, una billetera o una caja.');
            }
            $ref = trim((string) $referencia);
            if (in_array($cuenta->account_type, ['BANK', 'WALLET'], true) && $ref === '') {
                RuleError::fail('RN-GAS-14', 'Un pago por banco o billetera lleva el número de operación.');
            }
            $cuando = $fecha && $fecha <= Base::hoy() ? $fecha.' '.now('America/Lima')->format('H:i:s') : now();
            $monto = Base::r((float) $g->amount_pen - (float) $g->withholding_amount * (float) $g->exchange_rate);
            DB::table('expenses')->where('id', $id)->update([
                'status' => 'PAID', 'paid_at' => $cuando, 'paid_from_account_id' => $cuenta->id, 'paid_amount' => $monto,
                'payment_reference' => $ref !== '' ? mb_substr($ref, 0, 40) : null, 'updated_at' => now(),
                'history' => Base::historia($g->history, $u, 'Registró el pago', Base::soles($monto).' desde '.$cuenta->name.($ref !== '' ? " · op. {$ref}" : '')),
            ]);
            Events::emit('expense.paid', 'expenses', $id, ['number' => $g->number, 'amount' => $monto, 'cash_account_id' => $cuenta->id, 'withholding' => (float) $g->withholding_amount]);
            if ($g->created_by) {
                Base::avisar(['user_id' => $g->created_by], "Gasto {$g->number} pagado", Base::soles($monto).' desde '.$cuenta->name.'.', 'GAS-02', $id, 'ok');
            }
        });

        return Gastos::fila($id);
    }

    public static function revertir(string $id, string $motivo, User $u): object
    {
        DB::transaction(function () use ($id, $motivo, $u) {
            $g = DB::table('expenses')->where('id', $id)->lockForUpdate()->first();
            if (! $g) {
                abort(404, 'No se encontró el gasto.');
            }
            if (! self::puede($u)) {
                RuleError::fail('RN-GAS-14', 'El reverso del pago lo registra administración.');
            }
            if ($g->status !== 'PAID' || $g->pay_source === 'PETTY') {
                RuleError::fail('RN-GAS-14', 'Solo se revierte el pago de un gasto pagado por tesorería.');
            }
            if (mb_strlen(trim($motivo)) < 5) {
                RuleError::fail('RN-GAS-14', 'Escribe el motivo del reverso.');
            }
            DB::table('expenses')->where('id', $id)->update([
                'status' => 'APPROVED', 'paid_at' => null, 'paid_from_account_id' => null, 'paid_amount' => null, 'payment_reference' => null, 'updated_at' => now(),
                'history' => Base::historia($g->history, $u, 'Revirtió el pago', trim($motivo)),
            ]);
            Events::emit('expense.payment_reversed', 'expenses', $id, ['number' => $g->number, 'amount' => (float) $g->paid_amount, 'cash_account_id' => $g->paid_from_account_id, 'reason' => trim($motivo)]);
        });

        return Gastos::fila($id);
    }

    /** Cuentas de CAJ desde donde se paga o se repone. */
    public static function cuentas(): array
    {
        return DB::table('cash_accounts')->where('status', 'ACTIVE')->orderBy('account_type')->orderBy('name')
            ->get(['id', 'name', 'account_type', 'establishment_id'])->all();
    }
}
