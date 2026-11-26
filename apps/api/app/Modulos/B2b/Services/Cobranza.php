<?php

namespace App\Modulos\B2b\Services;

use App\Models\User;
use App\Modulos\Canales\Soporte as S;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * B2B-07, B2B-08 y B2B-09: estado de cuenta, antigüedad de saldos, recordatorios de cobranza por WhatsApp
 * (RN-B2B-16) y promesas de pago (RN-B2B-19).
 */
final class Cobranza
{
    public const TRAMOS = ['Por vencer', '1–15', '16–30', '31–60', 'Más de 60'];

    public const TIPOS = ['BEFORE_DUE' => 'Antes del vencimiento', 'DUE_DAY' => 'Día del vencimiento', 'OVERDUE_3' => '3 días vencido', 'OVERDUE_7' => '7 días vencido'];

    public static function tramo(int $dias): string
    {
        return $dias <= 0 ? 'Por vencer' : ($dias <= 15 ? '1–15' : ($dias <= 30 ? '16–30' : ($dias <= 60 ? '31–60' : 'Más de 60')));
    }

    /** Fechas de los recordatorios de un comprobante con vencimiento (CA-B2B-06: vence el 16/10, el previo sale el 13/10). */
    public static function fechas(string $vence): array
    {
        $antes = (int) S::num('b2b_reminder_days_before', 3);

        return ['BEFORE_DUE' => S::masDias($vence, -$antes), 'DUE_DAY' => $vence, 'OVERDUE_3' => S::masDias($vence, 3), 'OVERDUE_7' => S::masDias($vence, 7)];
    }

    public static function programar(object $doc): int
    {
        if ($doc->payment_terms !== 'CREDIT' || ! $doc->due_date || (float) $doc->balance <= 0.009 || $doc->status !== 'ISSUED') {
            return 0;
        }
        $n = 0;
        foreach (self::fechas($doc->due_date) as $tipo => $fecha) {
            $n += DB::table('collection_reminders')->insertOrIgnore([
                'customer_id' => $doc->customer_id, 'document_id' => $doc->id, 'reminder_type' => $tipo, 'channel' => 'WHATSAPP',
                'scheduled_for' => $fecha, 'template_code' => 'cobranza_'.strtolower($tipo), 'status' => 'SCHEDULED',
            ]);
        }

        return $n;
    }

    /** Programa los recordatorios de todos los comprobantes a crédito abiertos que aún no los tienen. */
    public static function programarTodos(): int
    {
        $n = 0;
        $docs = DB::table('sales_documents')->where('payment_terms', 'CREDIT')->where('status', 'ISSUED')->where('balance', '>', 0)->whereNotNull('due_date')
            ->whereIn('doc_type', ['INVOICE', 'RECEIPT'])
            ->whereNotExists(fn ($q) => $q->from('collection_reminders as r')->whereColumn('r.document_id', 'sales_documents.id'))->get();
        foreach ($docs as $d) {
            $n += self::programar($d);
        }

        return $n;
    }

    /** RN-B2B-16: envía los recordatorios del día con plantilla de utilidad; los de comprobantes ya pagados se cancelan. */
    public static function enviarPendientes(?string $fecha = null): array
    {
        $fecha = S::fecha($fecha);
        $enviados = 0;
        $cancelados = 0;
        $fallidos = 0;
        $pend = DB::table('collection_reminders')->where('status', 'SCHEDULED')->where('scheduled_for', '<=', $fecha)->orderBy('scheduled_for')->get();
        foreach ($pend as $r) {
            $d = DB::table('sales_documents')->where('id', $r->document_id)->first();
            if (! $d || (float) $d->balance <= 0.009 || $d->status !== 'ISSUED') {
                DB::table('collection_reminders')->where('id', $r->id)->update(['status' => 'CANCELLED', 'updated_at' => now()]);
                $cancelados++;

                continue;
            }
            $cliente = DB::table('customers')->where('id', $r->customer_id)->value('full_name');
            $cuando = match ($r->reminder_type) {
                'BEFORE_DUE' => 'vence el '.S::dmy($d->due_date),
                'DUE_DAY' => 'vence hoy',
                default => 'está vencido desde el '.S::dmy($d->due_date),
            };
            try {
                S::whatsapp()->enviar([
                    'customer_id' => $r->customer_id, 'brand_id' => $d->brand_id, 'kind' => 'UTILITY', 'template' => $r->template_code,
                    'text' => "{$cliente}: {$d->full_number} por ".S::soles($d->balance)." {$cuando}. Las cuentas para el pago están en su estado de cuenta.",
                    'ref' => $d->id, 'cost' => S::num('crm_wa_rate_utility', 0.0998),
                ]);
                DB::table('collection_reminders')->where('id', $r->id)->update(['status' => 'SENT', 'sent_at' => now(), 'updated_at' => now()]);
                $enviados++;
            } catch (\Throwable $e) {
                report($e);
                DB::table('collection_reminders')->where('id', $r->id)->update(['status' => 'FAILED', 'updated_at' => now()]);
                $fallidos++;
            }
        }

        return ['sent' => $enviados, 'cancelled' => $cancelados, 'failed' => $fallidos];
    }

    public static function recordatorios(array $f = []): array
    {
        return DB::table('collection_reminders as r')->join('sales_documents as d', 'd.id', '=', 'r.document_id')->join('customers as c', 'c.id', '=', 'r.customer_id')
            ->when($f['status'] ?? null, fn ($q, $s) => $q->where('r.status', $s))
            ->when($f['customer_id'] ?? null, fn ($q, $s) => $q->where('r.customer_id', $s))
            ->when($f['desde'] ?? null, fn ($q, $s) => $q->where('r.scheduled_for', '>=', $s))
            ->when($f['hasta'] ?? null, fn ($q, $s) => $q->where('r.scheduled_for', '<=', $s))
            ->orderBy('r.scheduled_for')->orderBy('c.full_name')->limit(500)
            ->get(['r.*', 'c.full_name as customer_name', 'd.full_number', 'd.due_date', 'd.balance'])->all();
    }

    /* ------------------------------------------------------------ promesas (RN-B2B-19) */

    public static function prometer(array $d, User $quien): object
    {
        $monto = (float) ($d['amount'] ?? 0);
        $monto > 0 || RuleError::fail('RN-B2B-19', 'El monto debe ser mayor que cero.');
        ! empty($d['promised_date']) || RuleError::fail('RN-B2B-19', 'Indica la fecha prometida.');
        $doc = ! empty($d['document_id']) ? (DB::table('sales_documents')->where('id', $d['document_id'])->first() ?? abort(404)) : null;
        $cliente = $doc->customer_id ?? ($d['customer_id'] ?? null);
        $cliente || RuleError::fail('RN-B2B-19', 'Elige el comprobante o el cliente.');
        S::fecha($d['promised_date']) >= S::fecha() || RuleError::fail('RN-B2B-19', 'La fecha prometida no puede ser pasada.');
        $id = DB::table('payment_promises')->insertGetId([
            'customer_id' => $cliente, 'document_id' => $doc->id ?? null, 'promised_date' => S::fecha($d['promised_date']), 'amount' => S::r($monto),
            'recorded_by' => $quien->id, 'status' => 'OPEN', 'notes' => isset($d['notes']) ? mb_substr((string) $d['notes'], 0, 500) : null,
        ], 'id');

        return DB::table('payment_promises')->where('id', $id)->first();
    }

    /** Pagada → cumplida; vencida la fecha sin pago → incumplida. Una promesa no levanta el bloqueo. */
    public static function evaluarPromesas(?string $hoy = null): int
    {
        $hoy = S::fecha($hoy);
        $n = 0;
        foreach (DB::table('payment_promises')->where('status', 'OPEN')->get() as $p) {
            $pagada = $p->document_id ? (float) DB::table('sales_documents')->where('id', $p->document_id)->value('balance') <= 0.009
                : Credito::vencido($p->customer_id, $hoy) <= 0.009;
            $nuevo = $pagada ? 'KEPT' : ($p->promised_date < $hoy ? 'BROKEN' : null);
            if ($nuevo) {
                DB::table('payment_promises')->where('id', $p->id)->update(['status' => $nuevo, 'updated_at' => now()]);
                $n++;
            }
        }

        return $n;
    }

    public static function promesas(array $f = []): array
    {
        return DB::table('payment_promises as p')->join('customers as c', 'c.id', '=', 'p.customer_id')->leftJoin('sales_documents as d', 'd.id', '=', 'p.document_id')
            ->when($f['status'] ?? null, fn ($q, $s) => $q->where('p.status', $s))
            ->when($f['customer_id'] ?? null, fn ($q, $s) => $q->where('p.customer_id', $s))
            ->orderByRaw("CASE p.status WHEN 'OPEN' THEN 0 ELSE 1 END")->orderBy('p.promised_date')
            ->get(['p.*', 'c.full_name as customer_name', 'd.full_number', 'd.balance'])
            ->map(function ($p) {
                $p->recorded_name = S::nombre($p->recorded_by);

                return $p;
            })->all();
    }

    public static function cancelarPromesa(string $id, User $quien): object
    {
        $p = DB::table('payment_promises')->where('id', $id)->first() ?? abort(404);
        $p->status === 'OPEN' || RuleError::fail('RN-B2B-19', 'Solo se cancela una promesa abierta.');
        DB::table('payment_promises')->where('id', $id)->update(['status' => 'CANCELLED', 'updated_at' => now()]);

        return DB::table('payment_promises')->where('id', $id)->first();
    }

    /* ------------------------------------------------------------ cartera */

    /** B2B-08: saldos por tramo de antigüedad, por cliente, vendedora o marca. */
    public static function antiguedad(string $por = 'customer', ?string $hoy = null, ?string $sellerId = null): array
    {
        $hoy = S::fecha($hoy);
        $docs = DB::table('b2b_receivables_v as r')->join('customers as c', 'c.id', '=', 'r.customer_id')->leftJoin('brands as b', 'b.id', '=', 'r.brand_id')
            ->leftJoin('customer_credit_profiles as f', 'f.customer_id', '=', 'r.customer_id')
            ->whereIn('r.doc_type', ['INVOICE', 'RECEIPT'])
            ->when($sellerId, fn ($q, $s) => $q->where(fn ($w) => $w->where('f.seller_user_id', $s)->orWhere(fn ($x) => $x->whereNull('f.seller_user_id')->where('c.seller_user_id', $s))))
            ->get(['r.*', 'c.full_name as customer_name', 'b.name as brand_name', DB::raw('coalesce(f.seller_user_id, c.seller_user_id) AS seller')]);
        $grupos = [];
        $tot = array_fill_keys(self::TRAMOS, 0.0);
        foreach ($docs as $d) {
            [$k, $nombre] = match ($por) {
                'seller' => [$d->seller ?? '-', S::nombre($d->seller) ?? 'Sin vendedora'],
                'brand' => [$d->brand_id ?? '-', $d->brand_name ?? 'Sin marca'],
                default => [$d->customer_id, $d->customer_name],
            };
            $g = $grupos[$k] ??= ['key' => $k, 'name' => $nombre, 'total' => 0.0, 'buckets' => array_fill_keys(self::TRAMOS, 0.0)];
            $t = self::tramo($d->due_date ? S::dias($d->due_date, $hoy) : 0);
            $g['buckets'][$t] = S::r($g['buckets'][$t] + (float) $d->balance);
            $g['total'] = S::r($g['total'] + (float) $d->balance);
            $grupos[$k] = $g;
            $tot[$t] = S::r($tot[$t] + (float) $d->balance);
        }
        $rows = array_values($grupos);
        usort($rows, fn ($a, $b) => $b['total'] <=> $a['total']);

        return ['rows' => $rows, 'totals' => $tot, 'total' => S::r(array_sum($tot)), 'buckets' => self::TRAMOS];
    }

    /** B2B-07 y B2B-15: comprobantes a crédito, notas de crédito y cobros con saldo corrido. */
    public static function estadoDeCuenta(string $customerId, ?string $hoy = null): array
    {
        $hoy = S::fecha($hoy);
        $docs = DB::table('sales_documents')->where('customer_id', $customerId)->where('payment_terms', 'CREDIT')->where('status', '<>', 'VOIDED')
            ->whereIn('doc_type', ['INVOICE', 'RECEIPT', 'DEBIT_NOTE'])->get();
        $ids = $docs->pluck('id')->all();
        $mov = [];
        foreach ($docs as $d) {
            $mov[] = ['date' => $d->issue_date, 'kind' => 'DOC', 'ref' => $d->full_number, 'document_id' => $d->id, 'due_date' => $d->due_date,
                'charge' => (float) $d->total, 'credit' => 0.0, 'open' => (float) $d->balance, 'sunat_status' => $d->sunat_status,
                'days_overdue' => $d->due_date && (float) $d->balance > 0.009 ? max(0, S::dias($d->due_date, $hoy)) : 0];
        }
        if ($ids) {
            foreach (DB::table('sales_documents')->where('doc_type', 'CREDIT_NOTE')->whereIn('related_document_id', $ids)->where('status', '<>', 'VOIDED')->get() as $n) {
                $mov[] = ['date' => $n->issue_date, 'kind' => 'NC', 'ref' => $n->full_number, 'document_id' => $n->id, 'charge' => 0.0, 'credit' => (float) $n->total];
            }
            $pagos = DB::table('payment_allocations as a')->join('payments as p', 'p.id', '=', 'a.payment_id')->leftJoin('payment_methods as m', 'm.id', '=', 'p.payment_method_id')
                ->whereIn('a.document_id', $ids)->where('p.status', 'CONFIRMED')
                ->groupBy('p.id', 'p.number', 'p.paid_at', 'p.reference', 'm.name')
                ->get(['p.id', 'p.number', 'p.paid_at', 'p.reference', 'm.name as method', DB::raw('sum(a.amount) AS amount')]);
            foreach ($pagos as $p) {
                $mov[] = ['date' => substr((string) $p->paid_at, 0, 10), 'kind' => 'PAY', 'ref' => trim("Cobro {$p->number} · {$p->method}".($p->reference ? " · {$p->reference}" : '')),
                    'payment_id' => $p->id, 'charge' => 0.0, 'credit' => S::r($p->amount)];
            }
        }
        usort($mov, fn ($a, $b) => strcmp($a['date'], $b['date']) ?: (($a['kind'] === 'DOC' ? 0 : 1) <=> ($b['kind'] === 'DOC' ? 0 : 1)));
        $saldo = 0.0;
        foreach ($mov as &$m) {
            $saldo = S::r($saldo + $m['charge'] - $m['credit']);
            $m['balance'] = $saldo;
        }
        unset($m);

        return ['movements' => $mov, 'summary' => Credito::resumen($customerId),
            'promises' => self::promesas(['customer_id' => $customerId]),
            'customer' => DB::table('customers')->where('id', $customerId)->first(['id', 'full_name', 'doc_number', 'customer_type'])];
    }
}
