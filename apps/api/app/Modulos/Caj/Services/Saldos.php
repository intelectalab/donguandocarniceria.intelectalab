<?php

namespace App\Modulos\Caj\Services;

use App\Models\User;
use App\Support\Events;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * CAJ-10 Saldos a favor: clientes con saldo, sus movimientos, el uso en un pedido o comprobante y la devolución.
 * RN-CAJ-08: el saldo nunca queda negativo (también lo cuida la base). D-CAJ-04: se devuelve solo por
 * transferencia o Yape, con caj.balance.refund.
 */
final class Saldos
{
    public const TIPOS = [
        'OVERPAYMENT' => 'Pagó de más', 'CREDIT_NOTE' => 'Nota de crédito', 'MERGE_IN' => 'Fusión de clientes (entra)',
        'APPLIED' => 'Usado en una compra', 'REFUND' => 'Devolución', 'REVERSAL' => 'Reverso de cobro', 'MERGE_OUT' => 'Fusión de clientes (sale)',
    ];

    public static function saldo(string $clienteId): float
    {
        return Base::r(DB::table('customer_balance_movements')->where('customer_id', $clienteId)->sum('amount'));
    }

    /** Clientes con saldo a favor (para Listado). */
    public static function consulta()
    {
        $s = DB::table('customer_balance_movements')->groupBy('customer_id')
            ->selectRaw('customer_id, round(sum(amount), 2) as saldo, max(at) as ultimo, count(*) as movimientos')->havingRaw('sum(amount) > 0.005');

        return DB::table('customers as c')->joinSub($s, 's', 's.customer_id', '=', 'c.id')
            ->select(['c.id', 'c.full_name', 'c.doc_type', 'c.doc_number', 'c.phone', 's.saldo', 's.ultimo', 's.movimientos']);
    }

    public static function total(): float
    {
        return Base::r(DB::query()->fromSub(self::consulta(), 'x')->sum('saldo'));
    }

    public static function movimientos(string $clienteId): array
    {
        $c = DB::table('customers')->where('id', $clienteId)->first(['id', 'full_name', 'doc_type', 'doc_number', 'phone']) ?? abort(404, 'No se encontró el cliente.');
        $movs = DB::table('customer_balance_movements as m')->leftJoin('sales_orders as o', 'o.id', '=', 'm.order_id')
            ->leftJoin('payments as p', 'p.id', '=', 'm.payment_id')->leftJoin('sales_documents as d', 'd.id', '=', 'm.document_id')
            ->leftJoin('cash_accounts as a', 'a.id', '=', 'm.refund_account_id')
            ->where('m.customer_id', $clienteId)->orderByDesc('m.at')->orderByDesc('m.created_at')->limit(200)
            ->get(['m.id', 'm.movement_type', 'm.amount', 'm.reason', 'm.at', 'm.user', 'm.refund_reference', 'o.number as pedido', 'p.number as cobro',
                'd.full_number as comprobante', 'a.name as cuenta']);

        return ['cliente' => $c, 'saldo' => self::saldo($clienteId), 'movimientos' => $movs->map(fn ($m) => (array) $m + ['tipo' => self::TIPOS[$m->movement_type] ?? $m->movement_type])];
    }

    /** Usa el saldo a favor en un pedido o comprobante del cliente. */
    public static function usar(string $clienteId, array $d, User $u): array
    {
        return DB::transaction(function () use ($clienteId, $d, $u) {
            Base::candadoCliente($clienteId);
            $monto = Base::r($d['amount'] ?? 0);
            if ($monto <= 0) {
                RuleError::fail('RN-CAJ-08', 'Escribe el monto que usas del saldo a favor.');
            }
            $saldo = self::saldo($clienteId);
            if ($monto > $saldo + Base::EPS) {
                RuleError::fail('RN-CAJ-08', 'El cliente tiene '.Base::soles(max(0, $saldo)).' de saldo a favor: no alcanza para '.Base::soles($monto).'.');
            }
            $doc = ! empty($d['document_id']) ? DB::table('sales_documents')->where('id', $d['document_id'])->lockForUpdate()->first() : null;
            $orderId = ($d['order_id'] ?? null) ?: $doc?->order_id;
            $o = $orderId ? DB::table('sales_orders')->where('id', $orderId)->lockForUpdate()->first() : null;
            if (! $doc && ! $o) {
                RuleError::fail('RN-CAJ-08', 'Elige el pedido o comprobante donde se usa el saldo.');
            }
            if ($doc) {
                if ($doc->customer_id !== $clienteId || $doc->status !== 'ISSUED' || ! in_array($doc->doc_type, ['INVOICE', 'RECEIPT'], true) || $doc->sunat_status === 'REJECTED') {
                    RuleError::fail('RN-CAJ-07', 'El comprobante no es una boleta o factura vigente del cliente.');
                }
                if ($monto > Cobros::saldoComprobante($doc->id) + Base::EPS) {
                    RuleError::fail('RN-CAJ-07', "A {$doc->full_number} le quedan ".Base::soles(max(0, Cobros::saldoComprobante($doc->id))).' por cobrar.');
                }
            }
            if ($o) {
                if ($o->status === 'CANCELLED' || ($o->customer_id !== $clienteId && $o->billing_customer_id !== $clienteId)) {
                    RuleError::fail('RN-CAJ-08', 'El pedido no es del cliente o está anulado.');
                }
                if (! Base::enAlcance($u, $o->brand_id, $o->establishment_id)) {
                    abort(404, 'No se encontró el pedido.');
                }
                if ($monto > Cobros::pendientePedido($o) + Base::EPS) {
                    RuleError::fail('RN-CAJ-05', "Al pedido {$o->number} le faltan ".Base::soles(max(0, Cobros::pendientePedido($o))).'.');
                }
            }
            $nota = trim((string) ($d['note'] ?? ''));
            DB::table('customer_balance_movements')->insert([
                'customer_id' => $clienteId, 'movement_type' => 'APPLIED', 'amount' => -$monto, 'order_id' => $o?->id, 'document_id' => $doc?->id,
                'reason' => mb_substr('Saldo a favor usado en '.($doc ? $doc->full_number : "el pedido {$o->number}").($nota !== '' ? ": {$nota}" : ''), 0, 255),
                'at' => now(), 'user' => mb_substr($u->name, 0, 40),
            ]);
            if ($o) {
                Cobros::sumarPagado($o->id, $monto);
            }
            if ($doc) {
                Cobros::recalcularComprobante($doc->id);
            }
            Events::emit('customer.balance.applied', 'customers', $clienteId, ['amount' => $monto, 'order_id' => $o?->id, 'document_id' => $doc?->id]);

            return self::movimientos($clienteId);
        });
    }

    /** Devuelve saldo a favor por transferencia o Yape (D-CAJ-04, caj.balance.refund). */
    public static function devolver(string $clienteId, array $d, User $u): array
    {
        return DB::transaction(function () use ($clienteId, $d, $u) {
            Base::candadoCliente($clienteId);
            $monto = Base::r($d['amount'] ?? 0);
            if ($monto <= 0) {
                RuleError::fail('RN-CAJ-08', 'Escribe el monto que devuelves.');
            }
            $saldo = self::saldo($clienteId);
            if ($monto > $saldo + Base::EPS) {
                RuleError::fail('RN-CAJ-08', 'El cliente tiene '.Base::soles(max(0, $saldo)).' de saldo a favor: no se devuelve '.Base::soles($monto).'.');
            }
            $cuenta = Cuentas::activa($d['refund_account_id'] ?? null);
            if (! in_array($cuenta->account_type, ['BANK', 'WALLET'], true)) {
                RuleError::fail('RN-CAJ-08', 'El saldo a favor se devuelve solo por transferencia o Yape: elige una cuenta bancaria o la billetera de la empresa.');
            }
            $ref = trim((string) ($d['refund_reference'] ?? ''));
            if ($ref === '' || mb_strlen($ref) > 40) {
                RuleError::fail('RN-CAJ-02', 'Escribe el número de operación de la devolución (hasta 40 caracteres).');
            }
            $motivo = Base::motivo($d['reason'] ?? null, 'RN-CAJ-08', 'Escribe el motivo de la devolución (al menos 5 letras).');
            $id = DB::table('customer_balance_movements')->insertGetId([
                'customer_id' => $clienteId, 'movement_type' => 'REFUND', 'amount' => -$monto, 'refund_account_id' => $cuenta->id, 'refund_reference' => $ref,
                'reason' => mb_substr("Devolución por {$cuenta->name}: {$motivo}", 0, 255), 'at' => now(), 'user' => mb_substr($u->name, 0, 40),
            ], 'id');
            Events::emit('customer.balance.refunded', 'customer_balance_movements', $id, ['customer_id' => $clienteId, 'amount' => $monto, 'account' => $cuenta->code]);

            return self::movimientos($clienteId);
        });
    }
}
