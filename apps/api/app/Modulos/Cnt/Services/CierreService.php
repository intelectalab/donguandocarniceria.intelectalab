<?php

namespace App\Modulos\Cnt\Services;

use App\Models\User;
use App\Modulos\Grj\Services\GranjaService;
use App\Modulos\Plt\Services\Periodos;
use App\Support\Access;
use App\Support\Events;
use App\Support\RuleError;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * CNT-11 Conciliación bancaria y CNT-12 Cierre mensual.
 *  RN-CNT-07  el período se cierra con todas sus tareas hechas o dispensadas con motivo, sin asientos en borrador o por aprobar
 *             y con la bandeja vacía; lo cierra un usuario con cnt.period.close.
 *  RN-CNT-08  reabrir exige cnt.period.reopen y motivo escrito (queda en el historial del período).
 *  RN-CNT-15  la conciliación bancaria cierra solo si saldo del extracto = saldo contable − partidas en tránsito.
 */
final class CierreService
{
    public const TAREAS = [
        ['DOCS_ENTRY', 'Comprobantes con asiento aprobado', true], ['INBOX_EMPTY', 'Bandeja de la contadora vacía', true], ['SIRE', 'SIRE de compras y ventas conciliado', true],
        ['BANKS', 'Bancos conciliados', true], ['PRODUCTION', 'Producción e inventario cerrados', true], ['FARM', 'Conciliación con la granja', false], ['FS', 'Estados financieros revisados', false],
    ];

    private static function fin(string $p): string
    {
        return CarbonImmutable::parse($p)->endOfMonth()->toDateString();
    }

    public static function empresa(?string $id = null): string
    {
        return $id ?? DB::table('companies')->orderBy('legal_name')->value('id');
    }

    /* ================================================================ bancos (CNT-11) */

    /** Líneas aprobadas de la cuenta contable del banco en el período. */
    public static function lineasLibro(string $caId, string $periodo): \Illuminate\Support\Collection
    {
        $gl = AsientosService::cuentaDeCaja($caId);

        return DB::table('journal_lines as l')->join('journal_entries as e', 'e.id', '=', 'l.entry_id')->where('e.status', 'APPROVED')->where('l.account_code', $gl)
            ->whereBetween('e.entry_date', [$periodo, self::fin($periodo)])->orderBy('e.entry_date')->orderBy('e.seq')
            ->get(['l.id', 'e.entry_date as date', DB::raw('round(l.debit - l.credit, 2) as amount'), 'e.description as label', 'e.number', 'e.id as entry_id'])
            ->map(function ($x) {
                $x->amount = (float) $x->amount;

                return $x;
            });
    }

    public static function saldoLibro(string $caId, string $hasta): float
    {
        $gl = AsientosService::cuentaDeCaja($caId);

        return round((float) DB::table('journal_lines as l')->join('journal_entries as e', 'e.id', '=', 'l.entry_id')->where('e.status', 'APPROVED')->where('l.account_code', $gl)
            ->where('e.entry_date', '<=', $hasta)->sum(DB::raw('l.debit - l.credit')), 2);
    }

    /** Importa el extracto del mes y cruza automáticamente. */
    public static function importarExtracto(array $d, User $quien): object
    {
        if (! Access::can($quien, 'cnt.entry.prepare')) {
            RuleError::fail('RN-CNT-21', 'Importar extractos es del equipo contable.');
        }

        return DB::transaction(function () use ($d, $quien) {
            $periodo = substr($d['period'], 0, 7).'-01';
            $ca = DB::table('cash_accounts')->where('id', $d['cash_account_id'])->first() ?? RuleError::fail('RN-CNT-15', 'Elige la cuenta bancaria.');
            $rec = DB::table('bank_reconciliations')->where('cash_account_id', $ca->id)->where('period', $periodo)->lockForUpdate()->first();
            if ($rec && $rec->status === 'CLOSED') {
                RuleError::fail('RN-CNT-15', 'La conciliación de ese mes ya está cerrada.');
            }
            $apertura = isset($d['opening_balance']) && $d['opening_balance'] !== '' ? round((float) $d['opening_balance'], 2) : self::saldoLibro($ca->id, CarbonImmutable::parse($periodo)->subDay()->toDateString());
            if (! $rec) {
                $id = DB::table('bank_reconciliations')->insertGetId(['company_id' => self::empresa($d['company_id'] ?? null), 'cash_account_id' => $ca->id, 'period' => $periodo,
                    'opening_balance' => $apertura, 'statement_balance' => $apertura, 'status' => 'OPEN', 'file_name' => $d['file_name'] ?? null, 'imported_at' => now(), 'imported_by' => $quien->id], 'id');
            } else {
                $id = $rec->id;
                DB::table('bank_statement_lines')->where('reconciliation_id', $id)->whereNull('booked_entry_id')->delete();
                DB::table('bank_statement_lines')->where('reconciliation_id', $id)->delete();
                DB::table('bank_reconciliations')->where('id', $id)->update(['file_name' => $d['file_name'] ?? $rec->file_name, 'imported_at' => now(), 'imported_by' => $quien->id, 'opening_balance' => $apertura]);
            }
            $saldo = $apertura;
            foreach (array_values($d['lines'] ?? []) as $i => $l) {
                $saldo = round($saldo + (float) $l['amount'], 2);
                DB::table('bank_statement_lines')->insert(['reconciliation_id' => $id, 'cash_account_id' => $ca->id, 'seq' => $i + 1, 'line_date' => $l['date'],
                    'description' => $l['description'] ?? '', 'reference' => $l['reference'] ?? null, 'amount' => round((float) $l['amount'], 2), 'balance' => $saldo, 'match_status' => 'UNMATCHED']);
            }
            DB::table('bank_reconciliations')->where('id', $id)->update(['statement_balance' => $saldo, 'line_count' => count($d['lines'] ?? []), 'updated_at' => now()]);
            self::cruzarBanco($id);

            return self::resumenBanco($id);
        });
    }

    /** Cruce automático: mismo importe y fecha a ±3 días (la referencia desempata). */
    public static function cruzarBanco(string $recId): int
    {
        $rec = DB::table('bank_reconciliations')->find($recId);
        $libro = self::lineasLibro($rec->cash_account_id, $rec->period);
        $usadas = DB::table('bank_statement_lines')->where('reconciliation_id', $recId)->whereNotNull('matched_line_id')->pluck('matched_line_id')->flip()->all();
        $n = 0;
        foreach (DB::table('bank_statement_lines')->where('reconciliation_id', $recId)->whereNull('matched_line_id')->orderBy('line_date')->orderBy('seq')->get() as $s) {
            $c = $libro->filter(fn ($b) => ! isset($usadas[$b->id]) && abs($b->amount - (float) $s->amount) < 0.005
                && abs(CarbonImmutable::parse($s->line_date)->diffInDays(CarbonImmutable::parse($b->date))) <= 3);
            if ($c->isEmpty()) {
                continue;
            }
            $pick = ($s->reference ? $c->first(fn ($b) => str_contains((string) $b->label, $s->reference)) : null)
                ?? $c->sortBy(fn ($b) => abs(CarbonImmutable::parse($s->line_date)->diffInDays(CarbonImmutable::parse($b->date))))->first();
            $usadas[$pick->id] = true;
            DB::table('bank_statement_lines')->where('id', $s->id)->update(['matched_line_id' => $pick->id, 'match_status' => 'MATCHED', 'matched_by' => 'AUTO', 'updated_at' => now()]);
            $n++;
        }

        return $n;
    }

    public static function cruzarManual(string $stmtId, ?string $lineId, User $quien): object
    {
        $s = DB::table('bank_statement_lines')->where('id', $stmtId)->first() ?? abort(404);
        $rec = DB::table('bank_reconciliations')->find($s->reconciliation_id);
        if ($rec->status === 'CLOSED') {
            RuleError::fail('RN-CNT-15', 'La conciliación está cerrada.');
        }
        if ($lineId && DB::table('bank_statement_lines')->where('matched_line_id', $lineId)->where('id', '<>', $stmtId)->exists()) {
            RuleError::fail('RN-CNT-15', 'Ese movimiento contable ya está cruzado.');
        }
        DB::table('bank_statement_lines')->where('id', $stmtId)->update(['matched_line_id' => $lineId, 'match_status' => $lineId ? 'MATCHED' : 'UNMATCHED',
            'matched_by' => mb_substr($quien->name, 0, 255), 'updated_at' => now()]);

        return self::resumenBanco($rec->id);
    }

    public static function resumenBanco(string $recId): object
    {
        $rec = DB::table('bank_reconciliations as r')->join('cash_accounts as c', 'c.id', '=', 'r.cash_account_id')->leftJoin('users as u', 'u.id', '=', 'r.closed_by')
            ->where('r.id', $recId)->first(['r.*', 'c.code as account_code', 'c.name as account_name', 'c.bank_name', 'u.name as closed_by_name']) ?? abort(404);
        $sl = DB::table('bank_statement_lines as s')->leftJoin('journal_entries as e', 'e.id', '=', 's.booked_entry_id')->where('s.reconciliation_id', $recId)
            ->orderBy('s.line_date')->orderBy('s.seq')->get(['s.*', 'e.number as booked_entry_number', 'e.status as booked_entry_status']);
        $bl = self::lineasLibro($rec->cash_account_id, $rec->period);
        $usadas = $sl->pluck('matched_line_id')->filter()->flip();
        $transito = $bl->filter(fn ($b) => ! $usadas->has($b->id))->values();
        $soloBanco = $sl->whereNull('matched_line_id')->values();
        $libro = self::saldoLibro($rec->cash_account_id, self::fin($rec->period));
        $sumT = round($transito->sum('amount'), 2);
        $rec->gl_account = AsientosService::cuentaDeCaja($rec->cash_account_id);
        $rec->statement = (float) $rec->statement_balance;
        $rec->book = $libro;
        $rec->transit = $transito;
        $rec->transit_sum = $sumT;
        $rec->bank_only = $soloBanco;
        $rec->bank_only_sum = round($soloBanco->sum(fn ($s) => (float) $s->amount), 2);
        $rec->unexplained = round((float) $rec->statement_balance - ($libro - $sumT), 2);
        $rec->matched = $sl->count() - $soloBanco->count();
        $rec->lines = $sl;
        $rec->book_lines = $bl;

        return $rec;
    }

    /** Registra el cargo que solo está en el extracto (comisión, ITF) como asiento manual por aprobar. */
    public static function registrarCargo(string $stmtId, array $d, User $quien): object
    {
        $s = DB::table('bank_statement_lines')->where('id', $stmtId)->first() ?? abort(404);
        if ($s->booked_entry_id) {
            RuleError::fail('RN-CNT-15', 'Ese movimiento del extracto ya tiene su asiento.');
        }
        $gl = AsientosService::cuentaDeCaja($s->cash_account_id);
        $m = abs((float) $s->amount);
        $cc = $d['cost_center_id'] ?? DB::table('cost_centers')->where('code', 'FIN')->value('id');
        $marca = $d['brand_id'] ?? DB::table('cost_centers')->where('id', $cc)->value('brand_id') ?? DB::table('brands')->orderBy('name')->value('id');
        $lineas = (float) $s->amount < 0
            ? [['account_code' => $d['account_code'] ?? '6391', 'debit' => $m, 'credit' => 0, 'cost_center_id' => $cc, 'brand_id' => $marca, 'description' => $s->description],
                ['account_code' => $gl, 'debit' => 0, 'credit' => $m, 'description' => $s->description]]
            : [['account_code' => $gl, 'debit' => $m, 'credit' => 0, 'description' => $s->description],
                ['account_code' => $d['account_code'] ?? '7599', 'debit' => 0, 'credit' => $m, 'brand_id' => $marca, 'description' => $s->description]];
        $cuenta = DB::table('cash_accounts')->where('id', $s->cash_account_id)->value('name');
        $e = AsientosService::manual(['entry_date' => $s->line_date, 'description' => "Extracto {$cuenta}: {$s->description}", 'reference' => $s->reference, 'lines' => $lineas,
            'bank_line_id' => $s->id], $quien);
        DB::table('bank_statement_lines')->where('id', $s->id)->update(['booked_entry_id' => $e->id, 'match_status' => 'BOOKED', 'updated_at' => now()]);

        return $e;
    }

    public static function cerrarBanco(string $recId, User $quien): object
    {
        if (! Access::can($quien, 'cnt.entry.approve')) {
            RuleError::fail('RN-CNT-15', 'Cerrar la conciliación es de la contadora.');
        }
        self::cruzarBanco($recId);
        $s = self::resumenBanco($recId);
        if ($s->status === 'CLOSED') {
            RuleError::fail('RN-CNT-15', 'La conciliación ya está cerrada.');
        }
        if (abs($s->unexplained) > 0.004) {
            $f = fn ($v) => 'S/ '.number_format($v, 2, ',', ' ');
            RuleError::fail('RN-CNT-15', "No cierra: saldo del extracto {$f($s->statement)} ≠ saldo contable {$f($s->book)} − partidas en tránsito {$f($s->transit_sum)}. Diferencia no explicada "
                .$f($s->unexplained).($s->bank_only->count() ? ' ('.$s->bank_only->count().' movimiento(s) del banco sin asiento aprobado)' : '').'.');
        }
        DB::table('bank_reconciliations')->where('id', $recId)->update(['status' => 'CLOSED', 'closed_by' => $quien->id, 'closed_at' => now(), 'updated_at' => now()]);

        return self::resumenBanco($recId);
    }

    /* ================================================================ cierre mensual (CNT-12) */

    public static function tareas(string $periodo, ?string $companyId = null): \Illuminate\Support\Collection
    {
        $p = substr($periodo, 0, 7).'-01';
        $emp = self::empresa($companyId);
        $hay = DB::table('period_close_tasks')->where('company_id', $emp)->where('period', $p)->pluck('code')->all();
        foreach (self::TAREAS as $i => [$codigo, $nombre, $auto]) {
            if (! in_array($codigo, $hay, true)) {
                DB::table('period_close_tasks')->insert(['company_id' => $emp, 'period' => $p, 'seq' => $i + 1, 'code' => $codigo, 'name' => $nombre, 'auto_check' => $auto, 'status' => 'PENDING']);
            }
        }

        return DB::table('period_close_tasks as t')->leftJoin('users as u', 'u.id', '=', 't.done_by')->where('t.company_id', $emp)->where('t.period', $p)->orderBy('t.seq')
            ->get(['t.*', 'u.name as done_by_name'])->map(function ($t) {
                $t->name = preg_replace('/\s*\(enlace \d+\)/', '', $t->name);

                return $t;
            });
    }

    /** Verificación automática de una tarea: [ok, detalle]. */
    public static function verificar(string $codigo, string $periodo, ?string $companyId = null): array
    {
        $p = substr($periodo, 0, 7).'-01';
        $fin = self::fin($p);
        $emp = self::empresa($companyId);
        switch ($codigo) {
            case 'DOCS_ENTRY':
                $n = AsientosService::sinAsiento($p, $emp)->count() + DB::table('journal_entries')->where('company_id', $emp)->where('period', $p)->whereNotNull('source_id')
                    ->whereIn('status', ['DRAFT', 'PENDING_APPROVAL'])->count();

                return [! $n, $n ? "{$n} comprobante(s) sin asiento aprobado" : 'Todos los comprobantes tienen asiento aprobado'];
            case 'INBOX_EMPTY':
                $n = DB::table('accountant_inbox_items')->where('company_id', $emp)->where('period', $p)->whereIn('status', BandejaService::ABIERTOS)->count();

                return [! $n, $n ? "{$n} ítem(s) abiertos en la bandeja" : 'Bandeja vacía'];
            case 'SIRE':
                $out = [];
                foreach (['PURCHASES' => 'compras', 'SALES' => 'ventas'] as $reg => $txt) {
                    $pr = SireService::vigente($reg, $p, $emp);
                    if (! $pr) {
                        $out[] = "falta la propuesta de {$txt}";
                    } elseif ($n = SireService::sinResolver($pr->id)->count()) {
                        $out[] = "{$n} diferencia(s) en {$txt}";
                    }
                }

                return [! $out, $out ? implode(' · ', $out) : 'Ambos registros conciliados'];
            case 'BANKS':
                $out = [];
                foreach (DB::table('cash_accounts')->where('account_type', 'BANK')->get() as $ca) {
                    if (self::lineasLibro($ca->id, $p)->isEmpty()) {
                        continue;
                    }
                    $r = DB::table('bank_reconciliations')->where('cash_account_id', $ca->id)->where('period', $p)->first();
                    if (! $r || $r->status !== 'CLOSED') {
                        $out[] = $ca->name.': '.($r ? 'conciliación abierta' : 'sin extracto');
                    }
                }

                return [! $out, $out ? implode(' · ', $out) : 'Cuentas bancarias conciliadas'];
            case 'PRODUCTION':
                $op = Schema::hasTable('production_orders') ? DB::table('production_orders')->whereNotIn('status', ['CLOSED', 'CANCELLED', 'VOIDED'])
                    ->whereBetween(DB::raw('created_at::date'), [$p, $fin])->count() : 0;
                $sc = DB::table('stock_counts')->whereNotIn('status', ['APPROVED', 'VOIDED', 'CANCELLED'])->where(DB::raw('created_at::date'), '<=', $fin)->count();

                return [! $op && ! $sc, $op || $sc ? "{$op} orden(es) de producción abiertas · {$sc} inventario(s) abiertos" : 'Sin órdenes ni inventarios abiertos'];
            case 'FARM':
                $g = GranjaService::conciliacionOk($p);

                return [$g['ok'], $g['detail']];
            default:
                $esf = ReportesService::estado('ESF', ['to' => $fin, 'company_id' => $emp]);
                $v = collect($esf['lines'])->pluck('value', 'code');
                $ok = abs((float) ($v['AT'] ?? 0) - (float) ($v['PP'] ?? 0)) < 0.01;

                return [$ok, $ok ? 'Activo = pasivo + patrimonio' : 'El estado de situación no cuadra'];
        }
    }

    public static function marcar(string $id, array $d, User $quien): object
    {
        $t = DB::table('period_close_tasks')->where('id', $id)->first() ?? abort(404);
        if (Periodos::cerrado($t->period, $t->company_id)) {
            RuleError::fail('RN-CNT-06', 'El período ya está cerrado.');
        }
        if (! empty($d['waive'])) {
            if (! Access::can($quien, 'cnt.period.close')) {
                RuleError::fail('RN-CNT-07', 'Dispensar una tarea es de la contadora.');
            }
            if (mb_strlen(trim((string) ($d['reason'] ?? ''))) < 10) {
                RuleError::fail('RN-CNT-07', 'Dispensar una tarea exige un motivo de al menos 10 caracteres.');
            }
            DB::table('period_close_tasks')->where('id', $id)->update(['status' => 'WAIVED', 'waive_reason' => mb_substr($d['reason'], 0, 255), 'done_by' => $quien->id, 'done_at' => now(), 'updated_at' => now()]);

            return DB::table('period_close_tasks')->find($id);
        }
        if (! Access::can($quien, 'cnt.entry.prepare')) {
            RuleError::fail('RN-CNT-21', 'Marcar tareas del cierre es del equipo contable.');
        }
        if ($t->auto_check || $t->code === 'FS') {
            [$ok, $det] = self::verificar($t->code, $t->period, $t->company_id);
            DB::table('period_close_tasks')->where('id', $id)->update(['last_check' => mb_substr($det, 0, 255), 'last_check_at' => now()]);
            if (! $ok) {
                RuleError::fail('RN-CNT-07', preg_replace('/\s*\(enlace \d+\)/', '', $t->name).": {$det}.");
            }
        }
        DB::table('period_close_tasks')->where('id', $id)->update(['status' => 'DONE', 'done_by' => $quien->id, 'done_at' => now(), 'evidence' => $d['evidence'] ?? null, 'waive_reason' => null, 'updated_at' => now()]);

        return DB::table('period_close_tasks')->find($id);
    }

    public static function desmarcar(string $id): object
    {
        $t = DB::table('period_close_tasks')->where('id', $id)->first() ?? abort(404);
        if (Periodos::cerrado($t->period, $t->company_id)) {
            RuleError::fail('RN-CNT-06', 'El período ya está cerrado.');
        }
        DB::table('period_close_tasks')->where('id', $id)->update(['status' => 'PENDING', 'done_by' => null, 'done_at' => null, 'waive_reason' => null, 'updated_at' => now()]);

        return DB::table('period_close_tasks')->find($id);
    }

    /** @return string[] lo que impide cerrar el período */
    public static function bloqueos(string $periodo, ?string $companyId = null): array
    {
        $p = substr($periodo, 0, 7).'-01';
        $emp = self::empresa($companyId);
        $out = [];
        $ts = self::tareas($p, $emp)->whereNotIn('status', ['DONE', 'WAIVED']);
        if ($ts->isNotEmpty()) {
            $out[] = $ts->count().' tarea(s) pendientes: '.$ts->pluck('name')->implode(', ');
        }
        $es = DB::table('journal_entries')->where('company_id', $emp)->where('period', $p)->whereIn('status', ['DRAFT', 'PENDING_APPROVAL'])->count();
        if ($es) {
            $out[] = "{$es} asiento(s) en borrador o por aprobar";
        }
        $ib = DB::table('accountant_inbox_items')->where('company_id', $emp)->where('period', $p)->whereIn('status', BandejaService::ABIERTOS)->count();
        if ($ib) {
            $out[] = "{$ib} ítem(s) en la bandeja";
        }

        return $out;
    }

    public static function cerrar(string $periodo, User $quien, ?string $companyId = null): object
    {
        if (! Access::can($quien, 'cnt.period.close')) {
            RuleError::fail('RN-CNT-07', 'Cerrar el período es de la contadora.');
        }
        $p = substr($periodo, 0, 7).'-01';
        $emp = self::empresa($companyId);
        if (Periodos::cerrado($p, $emp)) {
            RuleError::fail('RN-CNT-07', ucfirst(Periodos::nombre($p)).' ya está cerrado.');
        }
        if ($b = self::bloqueos($p, $emp)) {
            RuleError::fail('RN-CNT-07', 'No se cierra '.Periodos::nombre($p).': '.implode(' · ', $b).'.');
        }
        $r = Periodos::cerrar($emp, $p, $quien, 'Cierre contable');
        Events::emit('cnt.period_closed', 'accounting_periods', $r->id, ['period' => $p]);

        return $r;
    }

    public static function reabrir(string $periodo, string $motivo, User $quien, ?string $companyId = null): object
    {
        if (! Access::can($quien, 'cnt.period.reopen')) {
            RuleError::fail('RN-CNT-08', 'Reabrir un período es de la contadora o del gerente.');
        }
        if (mb_strlen(trim($motivo)) < 10) {
            RuleError::fail('RN-CNT-08', 'Reabrir exige un motivo escrito de al menos 10 caracteres.');
        }
        $p = substr($periodo, 0, 7).'-01';
        $emp = self::empresa($companyId);
        $fila = DB::table('accounting_periods')->where('company_id', $emp)->where('period', $p)->first() ?? RuleError::fail('RN-CNT-08', 'Período no encontrado.');
        $r = Periodos::reabrir($fila->id, $quien, $motivo);
        DB::table('period_close_tasks')->where('company_id', $emp)->where('period', $p)->where('code', 'FS')->update(['status' => 'PENDING', 'done_by' => null, 'done_at' => null]);

        return $r;
    }
}
