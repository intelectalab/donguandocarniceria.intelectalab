<?php

namespace App\Modulos\Com\Services;

use App\Models\User;
use App\Modulos\Cnt\Services\AsientosService;
use App\Modulos\Com\Services\Soporte as C;
use App\Modulos\Plt\Services\Periodos;
use App\Support\Events;
use App\Support\RuleError;
use Carbon\CarbonImmutable;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * COM-09 Cuentas por pagar y COM-10 Pagos a proveedores.
 *  RN-COM-08  la suma de pagos aplicados a un comprobante no supera su total (también en la base).
 *  RN-COM-13  un pago por transferencia solo va a la cuenta registrada del proveedor; con un cambio pendiente no se paga.
 */
final class PagosService
{
    public const TRAMOS = ['NOT_DUE' => 'Por vencer', 'D0_30' => 'Vencido 0–30 días', 'D31_60' => 'Vencido 31–60 días', 'D60' => 'Vencido más de 60 días'];

    /** Comprobantes con saldo, con días de atraso y tramo de antigüedad a la fecha. */
    public static function porPagar(?string $aFecha = null, array $f = []): Collection
    {
        $hoy = C::fecha($aFecha);
        $q = DB::table('purchase_documents as d')->join('suppliers as s', 's.id', '=', 'd.supplier_id')
            ->whereNotIn('d.status', ['VOIDED'])->where('d.balance', '>', 0.004)->where('d.doc_type', '<>', 'CREDIT_NOTE')
            ->when($f['supplier_id'] ?? null, fn ($x, $v) => $x->where('d.supplier_id', $v))
            ->when($f['site'] ?? null, fn ($x, $v) => $x->where('d.establishment_id', $v))
            ->orderBy('d.due_date')
            ->get(['d.id', 'd.supplier_id', 'd.doc_type', 'd.series', 'd.number', 'd.issue_date', 'd.due_date', 'd.currency', 'd.exchange_rate', 'd.total', 'd.paid_amount',
                'd.balance', 'd.scheduled_pay_date', 'd.match_status', 'd.status', 'd.establishment_id', 's.legal_name as supplier_name', 's.trade_name as supplier_trade_name',
                's.bank_account', 's.payment_terms_days']);
        foreach ($q as $d) {
            $dias = $d->due_date ? (int) CarbonImmutable::parse($d->due_date)->diffInDays(CarbonImmutable::parse($hoy), false) : 0;
            $d->overdue_days = $dias;
            $d->bucket = ! $d->due_date || $dias <= 0 ? 'NOT_DUE' : ($dias <= 30 ? 'D0_30' : ($dias <= 60 ? 'D31_60' : 'D60'));
            $d->balance_pen = C::t((float) $d->balance * (float) $d->exchange_rate);
        }

        return $q;
    }

    /** Programa (o quita) la fecha de pago de un comprobante. */
    public static function programar(string $id, ?string $fecha): object
    {
        $d = DB::table('purchase_documents')->where('id', $id)->first() ?? abort(404);
        if ((float) $d->balance <= 0.004) {
            RuleError::fail('RN-COM-08', C::etiquetaDoc($d).' no tiene saldo por pagar.');
        }
        DB::table('purchase_documents')->where('id', $id)->update(['scheduled_pay_date' => $fecha, 'updated_at' => now()]);

        return DB::table('purchase_documents')->find($id);
    }

    /**
     * Registra un pago desde una cuenta bancaria o caja, aplicado a uno o varios comprobantes del proveedor.
     *
     * @param  array{supplier_id: string, cash_account_id: string, paid_at?: ?string, method?: string, reference?: ?string, paid_to_account?: ?string,
     *               is_detraction?: bool, allocations: array<int, array{document_id: string, amount: mixed}>}  $d
     */
    public static function registrar(array $d, User $quien): object
    {
        return DB::transaction(function () use ($d, $quien) {
            $s = DB::table('suppliers')->where('id', $d['supplier_id'] ?? null)->lockForUpdate()->first() ?? RuleError::fail('RN-COM-08', 'Elige el proveedor.');
            $cuenta = DB::table('cash_accounts')->where('id', $d['cash_account_id'] ?? null)->first() ?? RuleError::fail('RN-COM-08', 'Elige la cuenta o caja de pago.');
            $cuando = isset($d['paid_at']) ? CarbonImmutable::parse($d['paid_at'], 'America/Lima') : C::ahora();
            $aplica = array_values(array_filter($d['allocations'] ?? [], fn ($a) => ! empty($a['document_id']) && (float) $a['amount'] > 0));
            if (! $aplica) {
                RuleError::fail('RN-COM-08', 'Aplica el pago a al menos un comprobante.');
            }
            $empresa = null;
            $docs = [];
            foreach ($aplica as $a) {
                $doc = DB::table('purchase_documents')->where('id', $a['document_id'])->lockForUpdate()->first();
                if (! $doc || $doc->supplier_id !== $s->id) {
                    RuleError::fail('RN-COM-08', 'El comprobante no es de este proveedor.');
                }
                if ($doc->status === 'VOIDED') {
                    RuleError::fail('RN-COM-08', C::etiquetaDoc($doc).' está anulado.');
                }
                $saldo = C::r((float) $doc->balance);
                if ((float) $a['amount'] > $saldo + 0.004) {
                    RuleError::fail('RN-COM-08', 'A '.C::etiquetaDoc($doc).' (total '.C::soles($doc->total).') ya se aplicaron '.C::soles($doc->total - $doc->balance)
                        .': el saldo es '.C::soles($saldo).' y no se puede aplicar '.C::soles($a['amount']).'.');
                }
                $empresa ??= $doc->company_id;
                $docs[] = [$doc, C::r($a['amount'])];
            }
            Periodos::abierto($cuando, $empresa);
            $metodo = $d['method'] ?? 'TRANSFER';
            $detraccion = (bool) ($d['is_detraction'] ?? false);
            if ($metodo === 'TRANSFER' && ! $detraccion) {
                if (! $s->bank_account) {
                    RuleError::fail('RN-COM-13', C::nombreProveedor($s).' no tiene cuenta bancaria registrada: regístrala (la aprueba el gerente) antes de transferir.');
                }
                if ($s->pending_bank_change) {
                    RuleError::fail('RN-COM-13', C::nombreProveedor($s).' tiene un cambio de cuenta pendiente: el gerente debe aprobarlo o rechazarlo antes de pagar.');
                }
                $destino = preg_replace('/\s/', '', (string) ($d['paid_to_account'] ?? $s->bank_account));
                if ($destino !== preg_replace('/\s/', '', (string) $s->bank_account)) {
                    RuleError::fail('RN-COM-13', "La cuenta destino {$d['paid_to_account']} no es la registrada de ".C::nombreProveedor($s)." ({$s->bank_account}). Solo se paga a la cuenta registrada.");
                }
            }
            $monto = C::r(array_sum(array_column($docs, 1)));
            $id = DB::table('supplier_payments')->insertGetId([
                'number' => C::numero('supplier_payments', 'PP-', 5), 'company_id' => $empresa, 'supplier_id' => $s->id, 'cash_account_id' => $cuenta->id, 'paid_at' => $cuando,
                'amount' => $monto, 'method' => $metodo, 'reference' => $d['reference'] ?? null,
                'paid_to_account' => $detraccion ? ($d['paid_to_account'] ?? 'Banco de la Nación · cuenta de detracciones') : ($metodo === 'TRANSFER' ? $s->bank_account : null),
                'status' => 'CONFIRMED', 'is_detraction' => $detraccion, 'registered_by' => $quien->id, 'currency' => 'PEN',
            ], 'id');
            foreach ($docs as [$doc, $importe]) {
                DB::table('supplier_payment_allocations')->insert(['payment_id' => $id, 'document_id' => $doc->id, 'amount' => $importe]);
                DB::table('purchase_documents')->where('id', $doc->id)->update([
                    'paid_amount' => C::r((float) $doc->paid_amount + $importe), 'balance' => C::r((float) $doc->balance - $importe), 'last_paid_at' => $cuando,
                    'scheduled_pay_date' => null, 'updated_at' => now(),
                ]);
            }
            AsientosService::alRegistrar('SUPPLIER_PAYMENT', $id, $quien);
            Events::emit('supplier_payment.registered', 'supplier_payments', $id, ['supplier_id' => $s->id, 'amount' => C::t($monto), 'cash_account_id' => $cuenta->id]);

            return self::ver($id);
        });
    }

    /** Revierte un pago confirmado: devuelve el saldo a los comprobantes y reversa su asiento. */
    public static function revertir(string $id, string $motivo, User $quien): object
    {
        return DB::transaction(function () use ($id, $motivo, $quien) {
            $p = DB::table('supplier_payments')->where('id', $id)->lockForUpdate()->first() ?? abort(404);
            if ($p->status !== 'CONFIRMED') {
                RuleError::fail('RN-COM-08', "El pago {$p->number} ya está revertido.");
            }
            Periodos::abierto(C::ahora(), $p->company_id);
            foreach (DB::table('supplier_payment_allocations')->where('payment_id', $id)->get() as $a) {
                $doc = DB::table('purchase_documents')->where('id', $a->document_id)->lockForUpdate()->first();
                DB::table('purchase_documents')->where('id', $doc->id)->update([
                    'paid_amount' => C::r((float) $doc->paid_amount - (float) $a->amount), 'balance' => C::r((float) $doc->balance + (float) $a->amount), 'updated_at' => now(),
                ]);
            }
            DB::table('supplier_payments')->where('id', $id)->update(['status' => 'REVERSED', 'reversed_by' => $quien->id, 'reverse_reason' => $motivo, 'updated_at' => now()]);
            AsientosService::alAnular('SUPPLIER_PAYMENT', $id, $quien, "Pago {$p->number} revertido: {$motivo}");

            return self::ver($id);
        });
    }

    public static function ver(string $id): object
    {
        $p = DB::table('supplier_payments as p')->join('suppliers as s', 's.id', '=', 'p.supplier_id')->join('cash_accounts as c', 'c.id', '=', 'p.cash_account_id')
            ->leftJoin('users as u', 'u.id', '=', 'p.registered_by')->where('p.id', $id)
            ->first(['p.*', 's.legal_name as supplier_name', 's.trade_name as supplier_trade_name', 'c.code as account_code', 'c.name as account_name', 'u.name as registered_by_name']) ?? abort(404);
        $p->allocations = DB::table('supplier_payment_allocations as a')->join('purchase_documents as d', 'd.id', '=', 'a.document_id')->where('a.payment_id', $id)
            ->get(['a.amount', 'd.id as document_id', 'd.doc_type', 'd.series', 'd.number', 'd.total', 'd.balance', 'd.issue_date']);
        $p->entries = DB::table('journal_entries')->where('source_id', $id)->where('source_kind', 'SUPPLIER_PAYMENT')->get(['id', 'number', 'status']);

        return $p;
    }
}
