<?php

namespace App\Modulos\Caj\Services;

use App\Models\User;
use App\Support\Events;
use App\Support\RuleError;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * CAJ-08 Abonos de pasarela y adquirente y CAJ-09 Conciliación pendiente.
 *
 * Un abono es lo que la pasarela (Mercado Pago), el adquirente (POS Visa) o la billetera depositan en el banco:
 * bruto, comisión, IGV de la comisión y neto, con los cobros que incluye. RN-CAJ-12: se cierra conciliado cuando la
 * suma de los cobros cuadra con el bruto y el bruto menos la comisión y su IGV da el neto; si no, solo con motivo.
 * RN-CAJ-13: solo cobros vigentes de la misma cuenta, y cada cobro en un solo abono.
 */
final class Abonos
{
    public const ESTADOS = ['OPEN' => 'Abierto', 'MATCHED' => 'Conciliado', 'WITH_DIFFERENCE' => 'Con diferencia'];

    public const ORIGENES = ['GATEWAY', 'CARD_ACQUIRER', 'WALLET'];

    private static function abono(string $id, bool $bloquear = false): object
    {
        $q = DB::table('settlement_batches')->where('id', $id);

        return ($bloquear ? $q->lockForUpdate() : $q)->first() ?? abort(404, 'No se encontró el abono.');
    }

    /** Registra el abono que llegó al banco, con los cobros que incluye (puede quedar abierto para completarlo). */
    public static function crear(array $d, User $u): object
    {
        return DB::transaction(function () use ($d, $u) {
            $origen = Cuentas::activa($d['source_account_id'] ?? null);
            if (! in_array($origen->account_type, self::ORIGENES, true)) {
                RuleError::fail('RN-CAJ-13', 'El abono viene de la pasarela, del POS de tarjeta o de una billetera.');
            }
            $banco = Cuentas::activa($d['bank_account_id'] ?? null);
            if ($banco->account_type !== 'BANK') {
                RuleError::fail('RN-CAJ-12', 'El abono llega a una cuenta bancaria de la empresa.');
            }
            $ref = trim((string) ($d['reference'] ?? ''));
            if ($ref === '' || mb_strlen($ref) > 80) {
                RuleError::fail('RN-CAJ-12', 'Escribe la referencia del abono en el estado de cuenta (hasta 80 caracteres).');
            }
            if (DB::table('settlement_batches')->where('source_account_id', $origen->id)->whereRaw('upper(reference) = ?', [mb_strtoupper($ref)])->exists()) {
                RuleError::fail('RN-CAJ-12', "El abono {$ref} de {$origen->name} ya está registrado.");
            }
            $fecha = Base::fecha($d['deposit_date'] ?? null);
            if ($fecha > Base::hoy()) {
                RuleError::fail('RN-CAJ-12', 'La fecha del abono no puede ser futura.');
            }
            [$bruto, $comision, $igv, $neto] = self::montos($d, $origen->account_type === 'WALLET');
            $id = DB::table('settlement_batches')->insertGetId([
                'source_account_id' => $origen->id, 'bank_account_id' => $banco->id, 'deposit_date' => $fecha, 'reference' => mb_substr($ref, 0, 80),
                'gross_amount' => $bruto, 'fee_amount' => $comision, 'fee_igv' => $igv, 'net_amount' => $neto, 'status' => 'OPEN',
                'kind' => $origen->account_type === 'WALLET' ? 'STATEMENT' : 'SETTLEMENT', 'imported' => false, 'created_by' => mb_substr($u->name, 0, 40),
                'created_at' => now(),
            ], 'id');
            self::agregarEn(self::abono($id, true), $d['payment_ids'] ?? []);
            Events::emit('caj.settlement.created', 'settlement_batches', $id, ['reference' => $ref, 'gross' => $bruto]);

            return self::detalle($id);
        });
    }

    /** Bruto, comisión, IGV de la comisión y neto. El neto debe ser el bruto menos la comisión y su IGV. */
    private static function montos(array $d, bool $sinComision): array
    {
        $bruto = Base::r($d['gross_amount'] ?? 0);
        $comision = $sinComision ? 0.0 : Base::r($d['fee_amount'] ?? 0);
        $igv = $sinComision ? 0.0 : (array_key_exists('fee_igv', $d) && $d['fee_igv'] !== null && $d['fee_igv'] !== '' ? Base::r($d['fee_igv'])
            : Base::r($comision * Base::num('caj_mp_fee_igv_rate', 0.18)));
        if ($bruto <= 0 || $comision < 0 || $igv < 0) {
            RuleError::fail('RN-CAJ-12', 'Escribe el bruto (mayor que cero), la comisión y su IGV.');
        }
        $neto = array_key_exists('net_amount', $d) && $d['net_amount'] !== null && $d['net_amount'] !== '' ? Base::r($d['net_amount']) : Base::r($bruto - $comision - $igv);
        if (abs(Base::r($bruto - $comision - $igv) - $neto) > 0.011) {
            RuleError::fail('RN-CAJ-12', 'El neto ('.Base::soles($neto).') no es el bruto menos la comisión y su IGV ('.Base::soles($bruto - $comision - $igv).').');
        }

        return [$bruto, $comision, $igv, $neto];
    }

    public static function agregar(string $id, array $ids, User $u): object
    {
        return DB::transaction(function () use ($id, $ids) {
            $b = self::abono($id, true);
            self::agregarEn($b, $ids);

            return self::detalle($id);
        });
    }

    /** RN-CAJ-13: cobros vigentes de la misma cuenta, sin otro abono. */
    private static function agregarEn(object $b, array $ids): void
    {
        $ids = array_values(array_unique(array_filter($ids, 'is_string')));
        if (! $ids) {
            return;
        }
        if ($b->status !== 'OPEN') {
            RuleError::fail('RN-CAJ-12', "El abono {$b->reference} ya está cerrado.");
        }
        $cobros = DB::table('payments')->whereIn('id', $ids)->lockForUpdate()->get();
        if ($cobros->count() !== count($ids)) {
            RuleError::fail('RN-CAJ-13', 'Algún cobro elegido no existe.');
        }
        foreach ($cobros as $p) {
            if ($p->status !== 'CONFIRMED') {
                RuleError::fail('RN-CAJ-13', "El cobro {$p->number} está revertido: solo se incluyen cobros vigentes.");
            }
            if ($p->cash_account_id !== $b->source_account_id) {
                RuleError::fail('RN-CAJ-13', "El cobro {$p->number} es de otra cuenta: un abono solo incluye cobros de su pasarela o adquirente.");
            }
            if ($p->settlement_batch_id || DB::table('settlement_batch_items')->where('payment_id', $p->id)->exists()) {
                RuleError::fail('RN-CAJ-13', "El cobro {$p->number} ya está en otro abono.");
            }
            DB::table('settlement_batch_items')->insert(['batch_id' => $b->id, 'payment_id' => $p->id, 'gross_amount' => $p->amount, 'fee_amount' => $p->fee_amount, 'created_at' => now()]);
            DB::table('payments')->where('id', $p->id)->update(['settlement_batch_id' => $b->id, 'updated_at' => now()]);
        }
    }

    public static function quitar(string $id, string $paymentId, User $u): object
    {
        return DB::transaction(function () use ($id, $paymentId) {
            $b = self::abono($id, true);
            if ($b->status !== 'OPEN') {
                RuleError::fail('RN-CAJ-12', "El abono {$b->reference} ya está cerrado: un cobro conciliado no cambia.");
            }
            DB::table('settlement_batch_items')->where('batch_id', $b->id)->where('payment_id', $paymentId)->delete();
            DB::table('payments')->where('id', $paymentId)->where('settlement_batch_id', $b->id)->update(['settlement_batch_id' => null, 'updated_at' => now()]);

            return self::detalle($id);
        });
    }

    /** Cierra el abono (RN-CAJ-12): conciliado si cuadra; si no, con motivo. Traslada el neto al banco. */
    public static function cerrar(string $id, ?string $motivo, User $u): object
    {
        return DB::transaction(function () use ($id, $motivo, $u) {
            $b = self::abono($id, true);
            if ($b->status !== 'OPEN') {
                RuleError::fail('RN-CAJ-12', "El abono {$b->reference} ya está cerrado.");
            }
            $items = DB::table('settlement_batch_items as i')->join('payments as p', 'p.id', '=', 'i.payment_id')->where('i.batch_id', $b->id)
                ->get(['i.id', 'p.id as payment_id', 'p.amount', 'p.status']);
            if ($items->isEmpty()) {
                RuleError::fail('RN-CAJ-12', 'Elige los cobros que incluye el abono antes de cerrarlo.');
            }
            if ($items->contains('status', 'REVERSED')) {
                RuleError::fail('RN-CAJ-13', 'El abono tiene un cobro revertido: quítalo antes de cerrar.');
            }
            $suma = Base::r($items->sum('amount'));
            $cuadra = abs($suma - (float) $b->gross_amount) <= 0.011
                && abs(Base::r((float) $b->gross_amount - (float) $b->fee_amount - (float) $b->fee_igv) - (float) $b->net_amount) <= 0.011;
            $motivo = trim((string) $motivo);
            if (! $cuadra && mb_strlen($motivo) < 5) {
                RuleError::fail('RN-CAJ-12', 'Los cobros suman '.Base::soles($suma).' y el bruto del abono es '.Base::soles((float) $b->gross_amount).': para cerrarlo con diferencia escribe el motivo.');
            }
            $estado = $cuadra ? 'MATCHED' : 'WITH_DIFFERENCE';
            // La comisión real del abono se reparte entre sus cobros según su monto (el monto del cobro no cambia).
            $restoFee = (float) $b->fee_amount;
            $restoIgv = (float) $b->fee_igv;
            $n = $items->count();
            foreach ($items->values() as $i => $it) {
                $ultimo = $i === $n - 1;
                $fee = $ultimo ? Base::r($restoFee) : Base::r((float) $b->fee_amount * (float) $it->amount / max($suma, 0.01));
                $igv = $ultimo ? Base::r($restoIgv) : Base::r((float) $b->fee_igv * (float) $it->amount / max($suma, 0.01));
                $restoFee -= $fee;
                $restoIgv -= $igv;
                DB::table('settlement_batch_items')->where('id', $it->id)->update(['fee_amount' => max(0, $fee), 'updated_at' => now()]);
                DB::table('payments')->where('id', $it->payment_id)->update([
                    'reconciliation_status' => $cuadra ? 'MATCHED' : 'DIFFERENCE', 'matched_at' => now(), 'fee_amount' => max(0, $fee), 'fee_igv' => max(0, $igv), 'updated_at' => now(),
                ]);
            }
            DB::table('settlement_batches')->where('id', $b->id)->update([
                'status' => $estado, 'difference_reason' => $motivo !== '' ? mb_substr($motivo, 0, 255) : null,
                'closed_at' => now(), 'closed_by' => mb_substr($u->name, 0, 40), 'updated_at' => now(),
            ]);
            if ((float) $b->net_amount > Base::EPS) {
                DB::table('cash_transfers')->insert([
                    'from_account_id' => $b->source_account_id, 'to_account_id' => $b->bank_account_id, 'amount' => $b->net_amount,
                    'transferred_at' => CarbonImmutable::parse($b->deposit_date.' 12:00', 'America/Lima'), 'reference' => mb_substr($b->reference, 0, 40),
                    'reason' => 'Abono conciliado', 'status' => 'CONFIRMED', 'batch_id' => $b->id, 'created_by' => $u->id, 'created_at' => now(),
                ]);
            }
            Events::emit('caj.settlement.closed', 'settlement_batches', $b->id, ['status' => $estado, 'sum' => $suma, 'gross' => (float) $b->gross_amount]);

            return self::detalle($b->id);
        });
    }

    public static function lista(User $u, array $f): array
    {
        [$desde, $hasta] = [Base::fecha($f['desde'] ?? null, CarbonImmutable::parse(Base::hoy())->subDays(60)->toDateString()), Base::fecha($f['hasta'] ?? null)];
        $abonos = DB::table('settlement_batches as b')->join('cash_accounts as o', 'o.id', '=', 'b.source_account_id')->join('cash_accounts as k', 'k.id', '=', 'b.bank_account_id')
            ->where(fn ($w) => $w->whereBetween('b.deposit_date', [$desde, $hasta])->orWhere('b.status', 'OPEN'))
            ->when($f['estado'] ?? null, fn ($w, $v) => $w->where('b.status', $v))
            ->when($f['cuenta'] ?? null, fn ($w, $v) => $w->where('b.source_account_id', $v))
            ->orderByRaw("b.status = 'OPEN' desc")->orderByDesc('b.deposit_date')->limit(300)
            ->get(['b.*', 'o.name as origen', 'o.account_type as origen_tipo', 'k.name as banco',
                DB::raw('(select count(*) from settlement_batch_items i where i.batch_id = b.id) as cobros'),
                DB::raw('(select coalesce(sum(i.gross_amount), 0) from settlement_batch_items i where i.batch_id = b.id) as suma')]);

        return ['abonos' => $abonos, 'estados' => self::ESTADOS,
            'origenes' => DB::table('cash_accounts')->where('status', 'ACTIVE')->whereIn('account_type', self::ORIGENES)->orderBy('code')->get(['id', 'code', 'name', 'account_type', 'fee_pct', 'settlement_days']),
            'bancos' => DB::table('cash_accounts')->where('status', 'ACTIVE')->where('account_type', 'BANK')->orderBy('code')->get(['id', 'code', 'name']),
            'igv' => Base::num('caj_mp_fee_igv_rate', 0.18)];
    }

    public static function detalle(string $id): object
    {
        $b = DB::table('settlement_batches as b')->join('cash_accounts as o', 'o.id', '=', 'b.source_account_id')->join('cash_accounts as k', 'k.id', '=', 'b.bank_account_id')
            ->where('b.id', $id)->first(['b.*', 'o.name as origen', 'o.account_type as origen_tipo', 'k.name as banco']) ?? abort(404, 'No se encontró el abono.');
        $b->cobros = DB::table('settlement_batch_items as i')->join('payments as p', 'p.id', '=', 'i.payment_id')->join('payment_methods as m', 'm.id', '=', 'p.payment_method_id')
            ->leftJoin('customers as c', 'c.id', '=', 'p.customer_id')->where('i.batch_id', $id)->orderBy('p.paid_at')
            ->get(['p.id', 'p.number', 'p.paid_at', 'p.amount', 'p.reference', 'p.status', 'p.reconciliation_status', 'i.fee_amount', 'm.name as medio', 'c.full_name as cliente']);
        $b->suma = Base::r($b->cobros->sum('amount'));
        $b->diferencia = Base::r($b->suma - (float) $b->gross_amount);

        return $b;
    }

    /** Cobros que se pueden incluir en un abono de la cuenta: vigentes, sin abono, hasta la fecha del depósito. */
    public static function candidatos(string $cuentaId, ?string $hasta): array
    {
        $c = DB::table('cash_accounts')->where('id', $cuentaId)->first(['id', 'settlement_days', 'account_type']) ?? abort(404, 'No se encontró la cuenta.');
        $limite = Base::fecha($hasta);
        $cobros = DB::table('payments as p')->join('payment_methods as m', 'm.id', '=', 'p.payment_method_id')->leftJoin('customers as cu', 'cu.id', '=', 'p.customer_id')
            ->where('p.cash_account_id', $c->id)->where('p.status', 'CONFIRMED')->whereNull('p.settlement_batch_id')
            ->whereIn('p.reconciliation_status', ['PENDING', 'DIFFERENCE'])
            ->whereNotExists(fn ($x) => $x->from('settlement_batch_items as i')->whereColumn('i.payment_id', 'p.id'))
            ->whereRaw("(p.paid_at at time zone 'America/Lima')::date <= ?", [$limite])
            ->orderBy('p.paid_at')->limit(500)
            ->get(['p.id', 'p.number', 'p.paid_at', 'p.amount', 'p.fee_amount', 'p.reference', 'm.name as medio', 'cu.full_name as cliente']);
        // Sugeridos: los que ya deberían haberse abonado según los días de abono de la cuenta.
        $corte = CarbonImmutable::parse($limite)->subDays((int) ($c->settlement_days ?? 0))->toDateString();

        return ['cobros' => $cobros->map(fn ($p) => (array) $p + ['sugerido' => substr((string) CarbonImmutable::parse($p->paid_at)->setTimezone('America/Lima')->toDateString(), 0, 10) <= $corte])];
    }

    /** CAJ-09: cobros digitales sin conciliar, con su antigüedad y alerta a los caj_reconciliation_alert_days días. */
    public static function pendientes(User $u, array $f)
    {
        $dias = (int) Base::num('caj_reconciliation_alert_days', 3);
        $q = DB::table('payments as p')->join('payment_methods as m', 'm.id', '=', 'p.payment_method_id')->join('cash_accounts as c', 'c.id', '=', 'p.cash_account_id')
            ->leftJoin('customers as cu', 'cu.id', '=', 'p.customer_id')->leftJoin('brands as b', 'b.id', '=', 'p.brand_id')
            ->where('p.status', 'CONFIRMED')->where('p.reconciliation_status', 'PENDING')->where('m.kind', '<>', 'CASH')
            ->when($f['cuenta'] ?? null, fn ($w, $v) => $w->where('p.cash_account_id', $v))
            ->when(($f['alerta'] ?? null) === '1', fn ($w) => $w->whereRaw("current_date - (p.paid_at at time zone 'America/Lima')::date >= ?", [$dias]));

        return Base::alcance($q, $u)->select(['p.id', 'p.number', 'p.paid_at', 'p.amount', 'p.reference', 'p.settlement_batch_id', 'm.name as medio', 'c.name as cuenta', 'c.id as cuenta_id',
            'cu.full_name as cliente', 'b.name as marca', DB::raw("current_date - (p.paid_at at time zone 'America/Lima')::date as dias")]);
    }

    public static function resumenPendientes(User $u): array
    {
        $dias = (int) Base::num('caj_reconciliation_alert_days', 3);
        $base = self::pendientes($u, []);
        $porCuenta = DB::query()->fromSub($base, 'x')->groupBy('cuenta_id', 'cuenta')
            ->selectRaw('cuenta_id, cuenta, count(*) as n, sum(amount) as monto, sum(amount) filter (where dias >= ?) as vencido, count(*) filter (where dias >= ?) as n_vencido, max(dias) as max_dias', [$dias, $dias])
            ->orderBy('cuenta')->get()->map(fn ($r) => ['cuenta_id' => $r->cuenta_id, 'cuenta' => $r->cuenta, 'n' => (int) $r->n, 'monto' => Base::r($r->monto),
                'vencido' => Base::r($r->vencido ?? 0), 'n_vencido' => (int) $r->n_vencido, 'max_dias' => (int) $r->max_dias]);

        return ['dias_alerta' => $dias, 'por_cuenta' => $porCuenta, 'total' => Base::r($porCuenta->sum('monto')), 'vencido' => Base::r($porCuenta->sum('vencido'))];
    }
}
