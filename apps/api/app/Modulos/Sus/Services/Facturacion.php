<?php

namespace App\Modulos\Sus\Services;

use App\Modulos\Ops\Services\Consola;
use App\Modulos\Plt\Services\Ruc;
use App\Support\RuleError;
use App\Support\TenantContext;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * SUS-12 Facturación del SaaS (consola, rol con billing.manage: cobranza y administración).
 *  - Corrida mensual: un comprobante por suscripción viva y período (ACTIVE, PAST_DUE o READ_ONLY), con la cuota de su
 *    versión de plan menos el descuento pactado, más IGV (sus_igv_rate). Una nueva corrida del mismo período solo crea
 *    los que faltan (otra corrida, run_no). Sin precio aprobado (D-SUS-01) no se factura ese plan.
 *  - RN-SUS-19: factura con RUC, boleta con DNI. Sin sus_issuer_ruc (D-SUS-06) no se emite: quedan en borrador.
 *  - RN-SUS-12: series de Intelectalab; el correlativo se asigna al emitir, sin saltos (fila de la serie bloqueada).
 *  - RN-SUS-11: emitido no cambia (lo impide la base); se corrige con nota de crédito.
 *  - RN-SUS-14: pagado solo si los cobros aprobados (más las notas de crédito) cubren el total.
 */
final class Facturacion
{
    public const TIPOS = ['INVOICE' => 'Factura', 'RECEIPT' => 'Boleta', 'CREDIT_NOTE' => 'Nota de crédito'];

    public const PAGO = ['UNPAID' => 'Por cobrar', 'PAID' => 'Pagado', 'CREDITED' => 'Anulado con nota de crédito', 'NA' => '—'];

    public const SUNAT = ['NOT_SENT' => 'Sin emitir', 'PENDING' => 'Por enviar al OSE', 'ACCEPTED' => 'Aceptado', 'REJECTED' => 'Rechazado'];

    /* ------------------------------------------------------------------ corrida */

    public static function corrida(array $quien, string $periodo, bool $sistema = false): array
    {
        $sistema || Consola::exigir($quien, 'billing.manage');
        $inicio = Carbon::createFromFormat('Y-m-d', "{$periodo}-01")->startOfDay();
        $fin = $inicio->copy()->endOfMonth();
        if ($inicio->greaterThan(now()->startOfMonth()->addMonth())) {
            RuleError::fail('RN-SUS-10', 'Solo se factura el mes en curso o uno anterior (o el siguiente, por adelantado).');
        }
        $runNo = (int) DB::table('saas_billing_runs')->where('period', $periodo)->max('run_no') + 1;
        $run = DB::table('saas_billing_runs')->insertGetId(['period' => $periodo, 'run_no' => $runNo, 'created_by' => $quien['id'],
            'created_by_name' => $quien['full_name'], 'created_at' => now()], 'id');
        $notas = [];
        $creados = [];
        $subs = DB::table('subscriptions as s')->join('tenants as t', 't.id', '=', 's.tenant_id')->leftJoin('saas_plan_versions as v', 'v.id', '=', 's.plan_version_id')
            ->whereIn('s.status', ['ACTIVE', 'PAST_DUE', 'READ_ONLY'])->where('s.started_at', '<=', $fin)
            ->select('s.*', 't.short', 't.name as legal_name', 't.ruc', 'v.price_pen', 'v.name as plan_name')->get();
        foreach ($subs as $s) {
            if (DB::table('saas_invoices')->where('subscription_id', $s->id)->where('period', $periodo)->where('kind', 'PERIOD')->where('doc_type', '!=', 'CREDIT_NOTE')->exists()) {
                continue;
            }
            if (! $s->price_pen || (float) $s->price_pen <= 0) {
                $notas[] = "{$s->short}: el plan {$s->plan_code} no tiene precio aprobado; no se factura.";

                continue;
            }
            if (! $s->ruc) {
                $notas[] = "{$s->short}: sin RUC ni DNI registrado; no se factura.";

                continue;
            }
            $subtotal = round((float) $s->price_pen * (1 - (float) ($s->discount_pct ?? 0) / 100), 2);
            $descripcion = 'Suscripción GestionCarnica · plan '.($s->plan_name ?? $s->plan_code).' · '.mb_strtolower($inicio->translatedFormat('F Y'))
                .((float) $s->discount_pct > 0 ? ' (descuento '.rtrim(rtrim(number_format((float) $s->discount_pct, 2), '0'), '.').' %)' : '');
            $creados[] = self::borrador($s, $periodo, $inicio, $fin, $run, [[$descripcion, $subtotal]], $quien['id']);
        }

        $emitidos = 0;
        $cobrados = 0;
        if ($creados && ! self::emisor()) {
            $notas[] = 'Falta el RUC emisor de Intelectalab (parámetro sus_issuer_ruc): los comprobantes quedan en borrador y no se cobran.';
        } elseif ($creados) {
            foreach ($creados as $id) {
                self::emitir($id, $quien, sinPermiso: true);
                $emitidos++;
                if (Pagos::cobrarSiCorresponde($id, 'AUTO')) {
                    $cobrados++;
                }
            }
        }
        $total = (float) DB::table('saas_invoices')->whereIn('id', $creados ?: ['00000000-0000-0000-0000-000000000000'])->sum('total');
        DB::table('saas_billing_runs')->where('id', $run)->update(['drafts' => count($creados) - $emitidos, 'issued' => $emitidos, 'charged' => $cobrados,
            'total' => $total, 'notes' => json_encode($notas, JSON_UNESCAPED_UNICODE)]);
        Consola::bitacora('BILLING_RUN', $sistema ? null : $quien, ['actor' => 'Sistema', 'entity' => 'saas_billing_runs', 'entity_id' => $run, 'reason' => "Corrida {$runNo} de {$periodo}",
            'detail' => ['comprobantes' => count($creados), 'emitidos' => $emitidos, 'total' => $total]]);

        return array_merge((array) DB::table('saas_billing_runs')->where('id', $run)->first(), ['notes' => $notas]);
    }

    /** Emite un borrador: serie y correlativo de Intelectalab, fecha y vencimiento (RN-SUS-12, RN-SUS-19). */
    public static function emitir(string $id, array $quien, bool $sinPermiso = false): array
    {
        $sinPermiso || Consola::exigir($quien, 'billing.manage');
        $ruc = self::emisor();
        if (! $ruc) {
            RuleError::fail('RN-SUS-19', 'Falta el RUC emisor de Intelectalab (parámetro sus_issuer_ruc): no se puede emitir.');
        }
        DB::transaction(function () use ($id, $ruc) {
            $f = DB::table('saas_invoices')->where('id', $id)->lockForUpdate()->first() ?? abort(response()->json(['message' => 'No encontrado.', 'code' => 'NOT_FOUND'], 404));
            if ($f->status !== 'DRAFT') {
                RuleError::fail('RN-SUS-11', 'El comprobante ya está emitido.');
            }
            $original = $f->credit_note_for ? DB::table('saas_invoices')->where('id', $f->credit_note_for)->first() : null;
            $serie = DB::table('platform_document_series')->where('active', true)->where('doc_type', $f->doc_type)
                ->when($original, fn ($q) => $q->where('applies_to', $original->doc_type))->orderBy('code')->lockForUpdate()->first();
            if (! $serie) {
                RuleError::fail('RN-SUS-12', 'No hay una serie activa para '.mb_strtolower(self::TIPOS[$f->doc_type]).'.');
            }
            DB::table('platform_document_series')->where('code', $serie->code)->update(['next_number' => $serie->next_number + 1, 'updated_at' => now()]);
            $esNota = $f->doc_type === 'CREDIT_NOTE';
            DB::table('saas_invoices')->where('id', $id)->update([
                'status' => 'ISSUED', 'series_code' => $serie->code, 'number' => sprintf('%s-%08d', $serie->code, $serie->next_number), 'issuer_ruc' => $ruc,
                'issue_date' => today(), 'due_date' => $esNota ? null : today()->addDays((int) Consola::param('sus_invoice_due_days', 5)),
                'payment_status' => $esNota ? 'NA' : 'UNPAID', 'sunat_status' => 'PENDING', 'updated_at' => now(),
            ]);
            if ($original) {
                self::recalcular($original->id);
            }
        });

        return self::ver($id);
    }

    /** RN-SUS-11: nota de crédito sobre un comprobante emitido, por un monto (con IGV) que no pase lo que queda sin acreditar. */
    public static function notaCredito(string $id, array $quien, float $monto, string $motivo): array
    {
        Consola::exigir($quien, 'billing.manage');
        $f = self::fila($id);
        if ($f->status !== 'ISSUED' || $f->doc_type === 'CREDIT_NOTE') {
            RuleError::fail('RN-SUS-11', 'La nota de crédito va sobre una factura o boleta emitida.');
        }
        $acreditado = (float) DB::table('saas_invoices')->where('credit_note_for', $id)->sum('total');
        $libre = round((float) $f->total - $acreditado, 2);
        if ($monto <= 0 || $monto > $libre) {
            RuleError::fail('RN-SUS-11', 'El monto de la nota va de S/ 0,01 a S/ '.number_format($libre, 2, ',', '.').'.');
        }
        if (! self::emisor()) {
            RuleError::fail('RN-SUS-19', 'Falta el RUC emisor de Intelectalab (parámetro sus_issuer_ruc): no se puede emitir.');
        }
        $tasa = (float) $f->igv_rate;
        $subtotal = round($monto / (1 + $tasa), 2);
        $nota = DB::table('saas_invoices')->insertGetId([
            'tenant_id' => $f->tenant_id, 'subscription_id' => $f->subscription_id, 'doc_type' => 'CREDIT_NOTE', 'period' => $f->period,
            'period_start' => $f->period_start, 'period_end' => $f->period_end, 'customer_doc_type' => $f->customer_doc_type,
            'customer_doc_number' => $f->customer_doc_number, 'customer_name' => $f->customer_name, 'customer_address' => $f->customer_address,
            'subtotal' => $subtotal, 'igv' => round($monto - $subtotal, 2), 'total' => round($monto, 2), 'igv_rate' => $tasa, 'credit_note_for' => $id,
            'reason' => mb_substr(trim($motivo), 0, 300), 'kind' => 'OTHER', 'payment_status' => 'NA', 'created_by' => $quien['id'], 'created_at' => now(), 'updated_at' => now(),
        ], 'id');
        DB::table('saas_invoice_lines')->insert(['invoice_id' => $nota, 'tenant_id' => $f->tenant_id, 'description' => mb_substr("Nota de crédito de {$f->number}: ".trim($motivo), 0, 200),
            'quantity' => 1, 'unit_price' => $subtotal, 'subtotal' => $subtotal, 'igv' => round($monto - $subtotal, 2), 'total' => round($monto, 2)]);
        self::emitir($nota, $quien, sinPermiso: true);
        Consola::bitacora('CREDIT_NOTE_ISSUED', $quien, ['tenant' => $f->tenant_id, 'entity' => 'saas_invoices', 'entity_id' => $nota, 'reason' => trim($motivo),
            'detail' => ['de' => $f->number, 'monto' => $monto]]);

        return self::ver($id);
    }

    public static function borrarBorrador(string $id, array $quien): void
    {
        Consola::exigir($quien, 'billing.manage');
        $f = self::fila($id);
        if ($f->status !== 'DRAFT') {
            RuleError::fail('RN-SUS-11', 'Solo se borra un borrador.');
        }
        DB::table('saas_invoices')->where('id', $id)->delete();
        Consola::bitacora('INVOICE_DRAFT_DELETED', $quien, ['tenant' => $f->tenant_id, 'entity' => 'saas_invoices', 'entity_id' => $id, 'reason' => "Borrador de {$f->customer_name}"]);
    }

    /** RN-SUS-14: estado de pago según cobros aprobados y notas de crédito emitidas. Devuelve si quedó saldado. */
    public static function recalcular(string $id): bool
    {
        $f = self::fila($id);
        if ($f->doc_type === 'CREDIT_NOTE' || $f->status !== 'ISSUED') {
            return false;
        }
        $pagado = (float) DB::table('saas_payments')->where('invoice_id', $id)->where('status', 'APPROVED')->sum('amount');
        $acreditado = (float) DB::table('saas_invoices')->where('credit_note_for', $id)->where('status', 'ISSUED')->sum('total');
        $saldado = round($pagado + $acreditado, 2) >= (float) $f->total;
        $estado = $saldado ? ($pagado > 0 ? 'PAID' : 'CREDITED') : 'UNPAID';
        if ($estado !== $f->payment_status) {
            DB::table('saas_invoices')->where('id', $id)->update(['payment_status' => $estado, 'paid_at' => $saldado ? now() : null, 'updated_at' => now()]);
        }

        return $saldado;
    }

    /* ------------------------------------------------------------------ consultas */

    public static function lista(array $f): array
    {
        $q = DB::table('saas_invoices as f')->join('tenants as t', 't.id', '=', 'f.tenant_id')->select('f.*', 't.short as tenant_short');
        foreach (['status' => 'f.status', 'payment_status' => 'f.payment_status', 'tenant' => 'f.tenant_id', 'period' => 'f.period', 'doc_type' => 'f.doc_type'] as $k => $col) {
            if (! empty($f[$k])) {
                $q->where($col, $f[$k]);
            }
        }
        $filas = $q->orderByRaw("f.status = 'DRAFT' DESC")->orderByDesc('f.issue_date')->orderByDesc('f.created_at')->limit(500)->get();
        $saldos = self::saldos($filas->pluck('id')->all());

        return $filas->map(fn ($x) => self::presentar($x, $saldos[$x->id] ?? null))->all();
    }

    public static function ver(string $id): array
    {
        $f = DB::table('saas_invoices as f')->join('tenants as t', 't.id', '=', 'f.tenant_id')->where('f.id', $id)->select('f.*', 't.short as tenant_short')->first()
            ?? abort(response()->json(['message' => 'No encontrado.', 'code' => 'NOT_FOUND'], 404));

        return self::presentar($f, self::saldos([$id])[$id] ?? null) + [
            'lineas' => DB::table('saas_invoice_lines')->where('invoice_id', $id)->orderBy('sort')->get(['description', 'quantity', 'unit_price', 'subtotal', 'igv', 'total']),
            'cobros' => DB::table('saas_payments')->where('invoice_id', $id)->orderByDesc('created_at')->get(['id', 'gateway_ref', 'amount', 'status', 'origin', 'error', 'created_at', 'confirmed_at']),
            'notas' => DB::table('saas_invoices')->where('credit_note_for', $id)->orderBy('created_at')->get(['id', 'number', 'total', 'reason', 'issue_date']),
            'original' => $f->credit_note_for ? DB::table('saas_invoices')->where('id', $f->credit_note_for)->value('number') : null,
        ];
    }

    public static function corridas(): array
    {
        return DB::table('saas_billing_runs')->orderByDesc('created_at')->limit(60)->get()
            ->map(fn ($r) => array_merge((array) $r, ['notes' => json_decode($r->notes, true)]))->all();
    }

    public static function series(): array
    {
        return DB::table('platform_document_series')->orderBy('code')->get()
            ->map(fn ($s) => (array) $s + ['doc_type_name' => self::TIPOS[$s->doc_type], 'ultimo' => $s->next_number > 1 ? sprintf('%s-%08d', $s->code, $s->next_number - 1) : null])->all();
    }

    public static function emisor(): ?string
    {
        $ruc = trim((string) Consola::param('sus_issuer_ruc', ''));

        return Ruc::valido($ruc) ? $ruc : null;
    }

    /* ------------------------------------------------------------------ internos */

    /** @param  array<int, array{0: string, 1: float}>  $lineas  descripción y subtotal (sin IGV) */
    private static function borrador(object $s, string $periodo, Carbon $inicio, Carbon $fin, string $run, array $lineas, ?string $quien): string
    {
        $tasa = (float) Consola::param('sus_igv_rate', 0.18);
        $esRuc = strlen($s->ruc) === 11;
        $filas = array_map(fn ($l) => ['description' => mb_substr($l[0], 0, 200), 'subtotal' => round($l[1], 2), 'igv' => round($l[1] * $tasa, 2)], $lineas);
        $subtotal = round(array_sum(array_column($filas, 'subtotal')), 2);
        $igv = round(array_sum(array_column($filas, 'igv')), 2);
        $id = DB::table('saas_invoices')->insertGetId([
            'tenant_id' => $s->tenant_id, 'subscription_id' => $s->id, 'run_id' => $run, 'doc_type' => $esRuc ? 'INVOICE' : 'RECEIPT', 'period' => $periodo,
            'period_start' => $inicio->toDateString(), 'period_end' => $fin->toDateString(), 'customer_doc_type' => $esRuc ? 'RUC' : 'DNI',
            'customer_doc_number' => $s->ruc, 'customer_name' => mb_substr($s->legal_name, 0, 200), 'customer_address' => self::direccion($s->tenant_id),
            'subtotal' => $subtotal, 'igv' => $igv, 'total' => round($subtotal + $igv, 2), 'igv_rate' => $tasa, 'created_by' => $quien, 'created_at' => now(), 'updated_at' => now(),
        ], 'id');
        foreach ($filas as $i => $l) {
            DB::table('saas_invoice_lines')->insert($l + ['invoice_id' => $id, 'tenant_id' => $s->tenant_id, 'sort' => $i + 1, 'quantity' => 1, 'unit_price' => $l['subtotal'],
                'total' => round($l['subtotal'] + $l['igv'], 2)]);
        }

        return $id;
    }

    /** Domicilio fiscal de la empresa (está en sus propios datos: se lee con su contexto y se vuelve a la consola). */
    private static function direccion(string $tenant): ?string
    {
        TenantContext::set(TenantContext::find($tenant));
        try {
            return DB::table('companies')->orderBy('created_at')->value('fiscal_address');
        } finally {
            TenantContext::platform();
        }
    }

    private static function saldos(array $ids): array
    {
        if (! $ids) {
            return [];
        }
        $pagos = DB::table('saas_payments')->whereIn('invoice_id', $ids)->where('status', 'APPROVED')->selectRaw('invoice_id, sum(amount) AS s')->groupBy('invoice_id')->pluck('s', 'invoice_id');
        $notas = DB::table('saas_invoices')->whereIn('credit_note_for', $ids)->where('status', 'ISSUED')->selectRaw('credit_note_for, sum(total) AS s')->groupBy('credit_note_for')->pluck('s', 'credit_note_for');

        return collect($ids)->mapWithKeys(fn ($id) => [$id => ['pagado' => (float) ($pagos[$id] ?? 0), 'acreditado' => (float) ($notas[$id] ?? 0)]])->all();
    }

    private static function fila(string $id): object
    {
        return DB::table('saas_invoices')->where('id', $id)->first() ?? abort(response()->json(['message' => 'No encontrado.', 'code' => 'NOT_FOUND'], 404));
    }

    private static function presentar(object $f, ?array $s): array
    {
        $pagado = $s['pagado'] ?? 0.0;
        $acreditado = $s['acreditado'] ?? 0.0;
        $vencido = $f->doc_type !== 'CREDIT_NOTE' && $f->payment_status === 'UNPAID' && $f->due_date && Carbon::parse($f->due_date)->lt(today());

        return [
            'id' => $f->id, 'tenant_id' => $f->tenant_id, 'tenant_short' => $f->tenant_short ?? null, 'subscription_id' => $f->subscription_id,
            'doc_type' => $f->doc_type, 'doc_type_name' => self::TIPOS[$f->doc_type], 'number' => $f->number, 'status' => $f->status,
            'payment_status' => $f->payment_status, 'payment_status_name' => self::PAGO[$f->payment_status], 'sunat_status' => $f->sunat_status,
            'sunat_status_name' => self::SUNAT[$f->sunat_status], 'period' => $f->period, 'period_start' => $f->period_start, 'period_end' => $f->period_end,
            'issue_date' => $f->issue_date, 'due_date' => $f->due_date, 'vencido' => $vencido, 'customer_doc_type' => $f->customer_doc_type,
            'customer_doc_number' => $f->customer_doc_number, 'customer_name' => $f->customer_name, 'customer_address' => $f->customer_address,
            'subtotal' => (float) $f->subtotal, 'igv' => (float) $f->igv, 'total' => (float) $f->total, 'pagado' => $pagado, 'acreditado' => $acreditado,
            'saldo' => $f->doc_type === 'CREDIT_NOTE' ? 0.0 : max(0, round((float) $f->total - $pagado - $acreditado, 2)), 'reason' => $f->reason,
            'credit_note_for' => $f->credit_note_for, 'paid_at' => $f->paid_at, 'created_at' => $f->created_at,
        ];
    }
}
