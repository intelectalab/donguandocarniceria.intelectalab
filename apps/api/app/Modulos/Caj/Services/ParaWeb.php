<?php

namespace App\Modulos\Caj\Services;

use Illuminate\Support\Facades\DB;

/**
 * Lo que la tienda web (WEB-06) necesita de CAJ para registrar el cobro de un pago aprobado de Mercado Pago.
 * El cobro se registra con Cobros::registrar (mismas reglas de CAJ); aquí solo se marca como cobro de la pasarela.
 */
final class ParaWeb
{
    /** La cuenta de pasarela de Mercado Pago (tipo GATEWAY) de la marca, o la general. */
    public static function cuentaPasarela(?string $marca): ?object
    {
        return DB::table('cash_accounts')->where('account_type', 'GATEWAY')->where('status', 'ACTIVE')
            ->where(fn ($q) => $q->where('brand_id', $marca)->orWhereNull('brand_id'))
            ->orderByRaw('brand_id is null')->orderByRaw("code <> 'MP'")->orderBy('code')->first();
    }

    /**
     * Marca el cobro como de la tienda web: origen WEB, la transacción de la pasarela y la comisión real que
     * informó Mercado Pago (la que usa la conciliación de CAJ-12). Un cobro automático no tiene quién lo recibió.
     */
    public static function marcarPasarela(string $paymentId, string $txId, float $comision, float $igv, bool $automatico): void
    {
        $cambios = ['source' => 'WEB', 'gateway_transaction_id' => $txId, 'fee_amount' => round($comision, 2), 'fee_igv' => round($igv, 2), 'updated_at' => now()];
        if ($automatico) {
            $cambios += ['received_by' => null, 'collected_by_user_id' => null];
        }
        DB::table('payments')->where('id', $paymentId)->update($cambios);
    }

    /** Estado del cobro para la transacción: número, estado y conciliación. */
    public static function cobro(?string $paymentId): ?object
    {
        return $paymentId ? DB::table('payments as p')->leftJoin('settlement_batches as b', 'b.id', '=', 'p.settlement_batch_id')->where('p.id', $paymentId)
            ->first(['p.id', 'p.number', 'p.status', 'p.amount', 'p.reconciliation_status', 'p.settlement_batch_id', 'p.reversal_reason', 'b.reference as batch_reference', 'b.status as batch_status']) : null;
    }
}
