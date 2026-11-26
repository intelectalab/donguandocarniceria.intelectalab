<?php

namespace App\Modulos\Cnt\Services;

use App\Models\User;
use App\Modulos\Plt\Services\Periodos;
use App\Support\Access;
use App\Support\Params;
use App\Support\RuleError;
use Carbon\CarbonImmutable;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * CNT-09 Libros y PLE, CNT-10 Régimen y libros del año, CNT-13 Estados financieros, CNT-14 Balance de comprobación,
 * CNT-15 Importación de planilla y CNT-16 Tablero contable (KPI-CNT-01 a 06).
 *  RN-CNT-12  libros simplificados si los ingresos netos del año no superan cnt_mype_books_threshold_uit UIT; si no, contabilidad completa.
 *  RN-CNT-13  sin el valor de la UIT del año cargado y confirmado por la contadora, el régimen no se calcula.
 *  RN-CNT-17  en PLE solo los libros que el régimen exige y que no se llevan en SIRE, con el código que confirma la contadora.
 */
final class ReportesService
{
    public const LIBROS = ['RV' => ['Registro de Ventas e Ingresos', 'SIRE'], 'RC' => ['Registro de Compras', 'SIRE'], 'LDS' => ['Libro Diario de Formato Simplificado', 'PLE'],
        'LD' => ['Libro Diario', 'PLE'], 'LM' => ['Libro Mayor', 'PLE'], 'LCB' => ['Libro Caja y Bancos', 'PLE'], 'LIB' => ['Libro de Inventarios y Balances', 'PLE']];

    private static function fin(string $p): string
    {
        return CarbonImmutable::parse($p)->endOfMonth()->toDateString();
    }

    private static function empresa(?string $id): string
    {
        return $id ?? DB::table('companies')->orderBy('legal_name')->value('id');
    }

    private static function n($v): string
    {
        return number_format((float) $v, 2, '.', '');
    }

    /** Líneas aprobadas, con filtros de marca y local. */
    public static function aprobadas(array $o = [])
    {
        return DB::table('journal_lines as l')->join('journal_entries as e', 'e.id', '=', 'l.entry_id')->where('e.status', 'APPROVED')
            ->where('e.company_id', self::empresa($o['company_id'] ?? null))
            ->when($o['brand'] ?? null, fn ($q, $v) => $q->where('l.brand_id', $v))
            ->when($o['site'] ?? null, fn ($q, $v) => $q->where('l.establishment_id', $v));
    }

    /* ================================================================ balance y mayor (CNT-14) */

    public static function balance(array $o = []): Collection
    {
        $de = $o['from'] ?? substr(AsientosService::hoy(), 0, 7).'-01';
        $a = $o['to'] ?? AsientosService::hoy();
        $emp = self::empresa($o['company_id'] ?? null);
        $nombres = DB::table('gl_accounts')->where('company_id', $emp)->pluck('name', 'code');

        return self::aprobadas($o)->where('e.entry_date', '<=', $a)->groupBy('l.account_code')
            ->selectRaw('l.account_code as code, round(sum(case when e.entry_date < ? then l.debit - l.credit else 0 end), 2) as opening,
                round(sum(case when e.entry_date >= ? then l.debit else 0 end), 2) as debit, round(sum(case when e.entry_date >= ? then l.credit else 0 end), 2) as credit', [$de, $de, $de])
            ->orderBy('l.account_code')->get()->map(function ($r) use ($nombres) {
                $r->name = $nombres[$r->code] ?? $r->code;
                $r->opening = (float) $r->opening;
                $r->debit = (float) $r->debit;
                $r->credit = (float) $r->credit;
                $r->closing = round($r->opening + $r->debit - $r->credit, 2);

                return $r;
            })->filter(fn ($r) => abs($r->opening) > 0.004 || $r->debit > 0 || $r->credit > 0)->values();
    }

    public static function mayor(string $codigo, array $o = []): array
    {
        $de = $o['from'] ?? substr(AsientosService::hoy(), 0, 7).'-01';
        $a = $o['to'] ?? AsientosService::hoy();
        $apertura = round((float) self::aprobadas($o)->where('l.account_code', $codigo)->where('e.entry_date', '<', $de)->sum(DB::raw('l.debit - l.credit')), 2);
        $saldo = $apertura;
        $filas = self::aprobadas($o)->where('l.account_code', $codigo)->whereBetween('e.entry_date', [$de, $a])->orderBy('e.entry_date')->orderBy('e.seq')->orderBy('l.seq')->limit(2000)
            ->get(['e.id as entry_id', 'e.number', 'e.entry_date', 'e.description', 'e.source_label', 'l.description as line_description', 'l.debit', 'l.credit', 'l.third_party_name'])
            ->map(function ($r) use (&$saldo) {
                $saldo = round($saldo + (float) $r->debit - (float) $r->credit, 2);
                $r->balance = $saldo;

                return $r;
            });
        $emp = self::empresa($o['company_id'] ?? null);

        return ['code' => $codigo, 'name' => DB::table('gl_accounts')->where('company_id', $emp)->where('code', $codigo)->value('name'), 'opening' => $apertura, 'closing' => $saldo, 'rows' => $filas];
    }

    /* ================================================================ estados financieros (CNT-13) */

    /** Calcula una plantilla (ESF, ERF o ERN) sobre las líneas aprobadas. */
    public static function estado(string $codigo, array $o = []): array
    {
        $emp = self::empresa($o['company_id'] ?? null);
        $t = DB::table('fs_templates')->where('company_id', $emp)->where('code', $codigo)->first() ?? abort(404);
        $esBalance = $t->kind === 'BALANCE';
        $a = $o['to'] ?? AsientosService::hoy();
        $de = $esBalance ? '1900-01-01' : ($o['from'] ?? substr($a, 0, 7).'-01');
        $q = self::aprobadas($esBalance ? ['company_id' => $emp] : $o)->whereBetween('e.entry_date', [$de, $a])->groupBy('l.account_code')
            ->selectRaw('l.account_code as code, sum(l.debit - l.credit) as v')->pluck('v', 'code');
        $suma = fn (array $pref) => collect($q)->filter(fn ($v, $c) => collect($pref)->contains(fn ($p) => str_starts_with((string) $c, (string) $p)))->sum();
        $resultado = 0.0;
        if ($esBalance) {
            $inicio = substr($a, 0, 4).'-01-01';
            $resultado = -(float) self::aprobadas(['company_id' => $emp])->whereBetween('e.entry_date', [$inicio, $a])
                ->where(fn ($x) => $x->where('l.account_code', 'like', '6%')->orWhere(fn ($y) => $y->where('l.account_code', 'like', '7%')->where('l.account_code', 'not like', '79%')))
                ->sum(DB::raw('l.debit - l.credit'));
        }
        $vals = [];
        $out = [];
        foreach (DB::table('fs_template_lines')->where('template_id', $t->id)->orderBy('seq')->get() as $ln) {
            $refs = json_decode($ln->refs ?: '[]', true) ?: [];
            $v = match ($ln->kind) {
                'ACC' => round($suma($refs) * (int) $ln->sign, 2),
                'SUM' => round(array_sum(array_map(fn ($r) => $vals[$r] ?? 0, $refs)), 2),
                'RESULT' => round($resultado, 2),
                default => null,
            };
            $vals[$ln->code] = $v;
            $out[] = ['code' => $ln->code, 'label' => $ln->label, 'kind' => $ln->kind, 'value' => $v, 'refs' => $refs];
        }

        return ['code' => $t->code, 'name' => $t->name, 'kind' => $t->kind, 'from' => $de, 'to' => $a, 'lines' => $out];
    }

    /** Comparativo de los últimos meses (estado de resultados). */
    public static function comparativo(string $codigo, string $hasta, int $meses = 6, array $o = []): array
    {
        $cols = [];
        $fin = CarbonImmutable::parse(substr($hasta, 0, 7).'-01');
        for ($i = $meses - 1; $i >= 0; $i--) {
            $m = $fin->subMonths($i);
            $e = self::estado($codigo, $o + ['from' => $m->toDateString(), 'to' => $m->endOfMonth()->toDateString()]);
            $cols[] = ['month' => $m->format('Y-m'), 'values' => collect($e['lines'])->pluck('value', 'code')->all()];
        }

        return $cols;
    }

    /* ================================================================ régimen y libros (CNT-09, CNT-10) */

    /** Ingresos netos del año: cuentas 70 y 75 de los asientos aprobados. */
    public static function ingresosNetos(int $anio, ?string $companyId = null): float
    {
        return round((float) self::aprobadas(['company_id' => $companyId])->whereBetween('e.entry_date', ["{$anio}-01-01", "{$anio}-12-31"])
            ->where(fn ($q) => $q->where('l.account_code', 'like', '70%')->orWhere('l.account_code', 'like', '75%'))->sum(DB::raw('l.credit - l.debit')), 2);
    }

    /** cnt_books_regime(empresa, año). */
    public static function regimen(int $anio, ?string $companyId = null, ?float $ingresos = null): array
    {
        $emp = self::empresa($companyId);
        $fy = DB::table('cnt_fiscal_years')->where('company_id', $emp)->where('year', $anio)->first();
        $uit = (float) ($fy->uit_value_pen ?? 0);
        if (! ($uit > 0) || ! ($fy->uit_confirmed_at ?? null)) {
            RuleError::fail('RN-CNT-13', "Falta el valor de la UIT de {$anio} cargado y confirmado por la contadora: sin ese dato no se calcula el régimen de libros.");
        }
        $tope = (float) (Params::get('cnt_mype_books_threshold_uit') ?? 300);
        $origen = $ingresos !== null ? 'indicado' : ($fy->revenue_pen !== null ? 'cargado por la contadora' : 'cuentas 70 y 75 del año');
        $ing = round($ingresos ?? ($fy->revenue_pen !== null ? (float) $fy->revenue_pen : self::ingresosNetos($anio, $emp)), 2);
        $limite = round($tope * $uit, 2);
        $res = $ing <= $limite + 1e-9 ? 'SIMPLIFIED' : 'FULL';

        return ['year' => $anio, 'uit' => $uit, 'threshold_uit' => $tope, 'limit' => $limite, 'revenue' => $ing, 'revenue_source' => $origen, 'result' => $res,
            'books' => $res === 'SIMPLIFIED' ? ['RV', 'RC', 'LDS'] : ['RV', 'RC', 'LD', 'LM', 'LCB', 'LIB']];
    }

    public static function guardarAnio(array $d, User $quien): object
    {
        if (! Access::can($quien, 'cnt.account.manage')) {
            RuleError::fail('RN-CNT-13', 'La UIT y los ingresos del año los carga y confirma la contadora.');
        }
        $anio = (int) ($d['year'] ?? 0);
        if ($anio < 2020 || $anio > 2100) {
            RuleError::fail('RN-CNT-13', 'Indica el año.');
        }
        $uit = isset($d['uit_value_pen']) && $d['uit_value_pen'] !== '' ? (float) $d['uit_value_pen'] : null;
        if ($uit !== null && $uit <= 0) {
            RuleError::fail('RN-CNT-13', 'La UIT debe ser mayor que cero.');
        }
        $emp = self::empresa($d['company_id'] ?? null);
        $fila = ['uit_value_pen' => $uit, 'revenue_pen' => isset($d['revenue_pen']) && $d['revenue_pen'] !== '' ? (float) $d['revenue_pen'] : null, 'uit_source' => $d['uit_source'] ?? null,
            'notes' => $d['notes'] ?? null, 'uit_confirmed_by' => $uit ? $quien->id : null, 'uit_confirmed_at' => $uit ? now() : null, 'updated_at' => now()];
        $ex = DB::table('cnt_fiscal_years')->where('company_id', $emp)->where('year', $anio)->first();
        $id = $ex ? $ex->id : DB::table('cnt_fiscal_years')->insertGetId($fila + ['company_id' => $emp, 'year' => $anio], 'id');
        if ($ex) {
            DB::table('cnt_fiscal_years')->where('id', $id)->update($fila);
        }
        if ($uit) {
            $r = self::regimen($anio, $emp);
            DB::table('cnt_fiscal_years')->where('id', $id)->update(['regime_result' => $r['result'], 'books' => json_encode($r['books'])]);
        } else {
            DB::table('cnt_fiscal_years')->where('id', $id)->update(['regime_result' => null, 'books' => null]);
        }

        return DB::table('cnt_fiscal_years')->find($id);
    }

    /** @return array<int, array<int, string>> filas del libro */
    public static function filasLibro(string $codigo, string $periodo, ?string $companyId = null): array
    {
        $fin = self::fin($periodo);
        $emp = self::empresa($companyId);
        $f = fn ($d) => CarbonImmutable::parse($d)->format('d/m/Y');
        if ($codigo === 'RV') {
            return SireService::ventas($periodo, $emp)->map(fn ($s) => [$f($s->date), $s->type, $s->series, (string) $s->number, (string) ($s->cust ?? ''), (string) $s->name, self::n($s->base), self::n($s->igv), self::n($s->total)])->all();
        }
        if ($codigo === 'RC') {
            return SireService::compras($periodo, $emp)->map(fn ($s) => [$f($s->date), $s->type, $s->series, (string) $s->number, $s->ruc, (string) $s->name, self::n($s->base), self::n($s->igv), self::n($s->total)])->all();
        }
        $ap = self::aprobadas(['company_id' => $emp])->whereBetween('e.entry_date', [$periodo, $fin])->orderBy('e.seq')->orderBy('l.seq')
            ->get(['e.id', 'e.number', 'e.entry_date', 'e.description', 'l.account_code', 'l.debit', 'l.credit']);
        if ($codigo === 'LDS') {
            return $ap->groupBy('id')->map(fn ($g) => [$g[0]->number, $f($g[0]->entry_date), (string) $g[0]->description,
                $g->groupBy(fn ($l) => substr($l->account_code, 0, 2))->map(fn ($x, $k) => [$k, round($x->sum(fn ($l) => (float) $l->debit - (float) $l->credit), 2)])
                    ->filter(fn ($x) => abs($x[1]) > 0.004)->map(fn ($x) => "{$x[0]}: ".self::n($x[1]))->implode(' · ')])->values()->all();
        }
        $nombres = DB::table('gl_accounts')->where('company_id', $emp)->pluck('name', 'code');
        if ($codigo === 'LD') {
            return $ap->map(fn ($l) => [$l->number, $f($l->entry_date), (string) $l->description, $l->account_code, (string) ($nombres[$l->account_code] ?? ''), self::n($l->debit), self::n($l->credit)])->all();
        }
        if ($codigo === 'LCB') {
            return $ap->filter(fn ($l) => str_starts_with($l->account_code, '10'))->map(fn ($l) => [$f($l->entry_date), $l->number, $l->account_code, (string) $l->description, self::n($l->debit), self::n($l->credit)])->values()->all();
        }

        return self::balance(['from' => $periodo, 'to' => $fin, 'company_id' => $emp])->map(fn ($r) => [$r->code, $r->name, self::n($r->opening), self::n($r->debit), self::n($r->credit), self::n($r->closing)])->all();
    }

    public static function generarLibro(array $d, User $quien): object
    {
        if (! Access::can($quien, 'cnt.report.view') && ! Access::can($quien, 'cnt.entry.prepare')) {
            RuleError::fail('RN-CNT-17', 'Generar libros es del equipo contable.');
        }
        $periodo = substr($d['period'], 0, 7).'-01';
        $emp = self::empresa($d['company_id'] ?? null);
        $codigo = $d['book_code'];
        if (! isset(self::LIBROS[$codigo])) {
            RuleError::fail('RN-CNT-12', 'Elige el libro.');
        }
        $r = self::regimen((int) substr($periodo, 0, 4), $emp);
        if (! in_array($codigo, $r['books'], true)) {
            RuleError::fail('RN-CNT-12', self::LIBROS[$codigo][0].' no lo exige el régimen de '.substr($periodo, 0, 4).' ('.($r['result'] === 'SIMPLIFIED' ? 'libros simplificados' : 'contabilidad completa').').');
        }
        $formato = $d['format'];
        $ple = null;
        if ($formato === 'TXT') {
            if (self::LIBROS[$codigo][1] === 'SIRE') {
                RuleError::fail('RN-CNT-17', self::LIBROS[$codigo][0].' se lleva en SIRE: no se exporta en PLE.');
            }
            $codigos = json_decode((string) Params::get('cnt_ple_book_codes'), true);
            $ple = is_array($codigos) ? ($codigos[$codigo] ?? null) : null;
            if (! $ple) {
                RuleError::fail('RN-CNT-17', 'Falta el código PLE de '.self::LIBROS[$codigo][0].': la contadora lo confirma en los parámetros antes de la primera exportación.');
            }
        }
        $filas = self::filasLibro($codigo, $periodo, $emp);
        $contenido = implode("\n", array_map(fn ($f) => implode('|', $f), $filas));
        $ruc = DB::table('companies')->where('id', $emp)->value('ruc');
        $archivo = $formato === 'TXT' ? 'LE'.$ruc.substr($periodo, 0, 4).substr($periodo, 5, 2).'00'.$ple.'00111.txt' : $codigo.'-'.substr($periodo, 0, 7).'.'.strtolower($formato === 'XLSX' ? 'xlsx' : 'pdf');
        $id = DB::table('ledger_exports')->insertGetId(['company_id' => $emp, 'book_code' => $codigo, 'book_name' => self::LIBROS[$codigo][0], 'period' => $periodo, 'format' => $formato,
            'ple_code' => $ple, 'file_name' => $archivo, 'row_count' => count($filas), 'hash' => hash('sha256', $contenido), 'generated_at' => now(), 'generated_by' => $quien->id], 'id');

        return DB::table('ledger_exports')->find($id);
    }

    /* ================================================================ planilla (CNT-15) */

    /** Resumen por centro de costo (EsSalud 9 %, CTS 9,72 %, vacaciones 8,33 %, pensión 13 % retenida). */
    public static function planillaPrevia(string $periodo): array
    {
        $fin = self::fin($periodo);
        $por = [];
        foreach (DB::table('employees')->where('status', 'ACTIVE')->where(fn ($q) => $q->whereNull('hire_date')->orWhere('hire_date', '<=', $fin))->where('monthly_salary', '>', 0)
            ->get(['cost_center_id', 'monthly_salary']) as $e) {
            $cc = $e->cost_center_id ?? DB::table('cost_centers')->where('code', 'ADM')->value('id');
            $x = $por[$cc] ??= ['cost_center_id' => $cc, 'employees' => 0, 'gross' => 0.0];
            $x['employees']++;
            $x['gross'] += (float) $e->monthly_salary;
            $por[$cc] = $x;
        }
        $lineas = array_values(array_map(fn ($x) => $x + ['essalud' => round($x['gross'] * 0.09, 2), 'cts' => round($x['gross'] * 0.0972, 2), 'vac' => round($x['gross'] * 0.0833, 2),
            'pension' => round($x['gross'] * 0.13, 2), 'gross' => round($x['gross'], 2)], $por));
        $cc = DB::table('cost_centers')->pluck('name', 'id');
        foreach ($lineas as &$l) {
            $l['cost_center_name'] = $cc[$l['cost_center_id']] ?? '—';
        }
        $s = fn ($k) => round(array_sum(array_column($lineas, $k)), 2);

        return ['lines' => $lineas, 'source_hint' => 'FILE', 'gross_total' => $s('gross'), 'essalud_total' => $s('essalud'), 'cts_total' => $s('cts'), 'vac_total' => $s('vac'),
            'pension_total' => $s('pension'), 'net_total' => round($s('gross') - $s('pension'), 2), 'employees' => array_sum(array_column($lineas, 'employees'))];
    }

    public static function importarPlanilla(array $d, User $quien): object
    {
        if (! Access::can($quien, 'cnt.entry.prepare')) {
            RuleError::fail('RN-CNT-21', 'Importar la planilla es del equipo contable.');
        }

        return DB::transaction(function () use ($d, $quien) {
            $periodo = substr($d['period'], 0, 7).'-01';
            $emp = self::empresa($d['company_id'] ?? null);
            if (Periodos::cerrado($periodo, $emp)) {
                RuleError::fail('RN-CNT-06', 'El período de '.Periodos::nombre($periodo).' está cerrado.');
            }
            $prev = DB::table('payroll_journal_imports')->where('company_id', $emp)->where('period', $periodo)->where('status', '<>', 'VOIDED')->first();
            if ($prev) {
                $vivo = DB::table('journal_entries')->where('source_kind', 'PAYROLL')->where('source_id', $prev->id)->whereIn('status', AsientosService::ESTADOS_VIVOS)->first();
                if ($vivo) {
                    RuleError::fail('RN-CNT-20', 'La planilla de '.Periodos::nombre($periodo).' ya tiene el asiento '.($vivo->number ?? 'por aprobar').': revérsalo o anúlalo antes de importar otra.');
                }
                DB::table('payroll_journal_imports')->where('id', $prev->id)->update(['status' => 'VOIDED', 'updated_at' => now()]);
            }
            $pv = self::planillaPrevia($periodo);
            $lineas = array_map(fn ($l) => array_diff_key($l, ['cost_center_name' => 1]), $pv['lines']);
            $id = DB::table('payroll_journal_imports')->insertGetId(['company_id' => $emp, 'period' => $periodo, 'source' => $d['source'] ?? 'FILE',
                'file_name' => $d['file_name'] ?? 'planilla-'.substr($periodo, 0, 7).'.xlsx', 'imported_at' => now(), 'imported_by' => $quien->id, 'status' => 'POSTED',
                'lines' => json_encode($lineas), 'source_hint' => $pv['source_hint'], 'gross_total' => $pv['gross_total'], 'essalud_total' => $pv['essalud_total'], 'cts_total' => $pv['cts_total'],
                'vac_total' => $pv['vac_total'], 'pension_total' => $pv['pension_total'], 'net_total' => $pv['net_total'], 'employees' => $pv['employees']], 'id');
            $r = AsientosService::generar('PAYROLL', $id, $quien, ['prepared_by' => $quien->id]);
            DB::table('payroll_journal_imports')->where('id', $id)->update(['entry_id' => $r['entry']->id ?? null]);

            return DB::table('payroll_journal_imports')->find($id);
        });
    }

    /* ================================================================ tablero (CNT-16) */

    public static function tablero(?string $mes, ?string $companyId = null): array
    {
        $p = substr($mes ?: AsientosService::hoy(), 0, 7).'-01';
        $fin = self::fin($p);
        $emp = self::empresa($companyId);
        $sin = AsientosService::sinAsiento($p, $emp)->count();
        $pend = DB::table('journal_entries')->where('company_id', $emp)->where('status', 'PENDING_APPROVAL')->whereBetween('entry_date', [$p, $fin])->count();
        $sire = DB::table('sire_proposals')->where('company_id', $emp)->where('period', $p)->where('superseded', false)->pluck('id')->sum(fn ($id) => SireService::sinResolver($id)->count());
        $cerr = DB::table('accounting_periods')->where('company_id', $emp)->where('status', 'CLOSED')->whereNotNull('closed_at')->orderByDesc('period')->limit(6)->get();
        $dias = $cerr->map(fn ($x) => CarbonImmutable::parse(self::fin(substr($x->period, 0, 10)))->diffInDays(CarbonImmutable::parse($x->closed_at)->setTimezone('America/Lima')->startOfDay(), false));
        $gastos = DB::table('expenses')->whereIn('status', ['APPROVED', 'PAID', 'SUBMITTED'])->whereBetween('issue_date', [$p, $fin])->get(['accounting_flag', 'doc_type', 'amount_pen']);
        $docs = DB::table('purchase_documents')->where('status', '<>', 'VOIDED')->where('doc_type', '<>', 'INTERNAL_TRANSFER')->whereBetween('accounting_date', [$p, $fin])
            ->get(['doc_type', 'igv_is_credit', 'total', 'exchange_rate']);
        $malo = $gastos->filter(fn ($e) => $e->accounting_flag === 'NO_VALID_RECEIPT' || in_array($e->doc_type, ['TICKET', 'SIMPLE_RECEIPT', 'MOBILITY_SHEET', 'NONE'], true))->sum('amount_pen')
            + $docs->filter(fn ($d) => $d->doc_type === 'RECEIPT' || (! $d->igv_is_credit && $d->doc_type === 'INVOICE'))->sum(fn ($d) => (float) $d->total * (float) $d->exchange_rate);
        $tot = $gastos->sum('amount_pen') + $docs->sum(fn ($d) => (float) $d->total * (float) $d->exchange_rate);
        $max = (int) (Params::get('cnt_inbox_max_age_days') ?? 3);
        $viejos = DB::table('accountant_inbox_items')->where('company_id', $emp)->whereIn('status', ['PENDING', 'CLASSIFIED'])->where('created_at', '<', now()->subDays($max))->count();
        $erf = self::estado('ERF', ['from' => $p, 'to' => $fin, 'company_id' => $emp]);

        return [
            'month' => substr($p, 0, 7), 'from' => $p, 'to' => $fin,
            'kpis' => ['docs_without_entry' => $sin, 'pending_approval' => $pend, 'sire_diffs' => $sire, 'close_days' => $dias->count() ? round($dias->avg(), 1) : null,
                'invalid_receipts_pct' => $tot > 0 ? round($malo / $tot * 100, 1) : null, 'inbox_overdue' => $viejos],
            'detail' => ['inbox_open' => DB::table('accountant_inbox_items')->where('company_id', $emp)->whereIn('status', BandejaService::ABIERTOS)->count(),
                'entries_month' => DB::table('journal_entries')->where('company_id', $emp)->where('status', 'APPROVED')->whereBetween('entry_date', [$p, $fin])->count(),
                'period_status' => DB::table('accounting_periods')->where('company_id', $emp)->where('period', $p)->value('status') ?? 'OPEN', 'inbox_max_age_days' => $max],
            'by_source' => DB::table('journal_entries')->where('company_id', $emp)->whereBetween('entry_date', [$p, $fin])->where('status', '<>', 'VOIDED')
                ->groupBy('source_type')->selectRaw("source_type, count(*) as entries, count(*) filter (where status = 'APPROVED') as approved, round(sum(total_debit), 2) as amount")
                ->orderByDesc('entries')->get(),
            'inbox_by_reason' => DB::table('accountant_inbox_items')->where('company_id', $emp)->whereIn('status', BandejaService::ABIERTOS)->groupBy('reason')
                ->selectRaw('reason, count(*) as items')->get()->map(fn ($x) => ['reason' => $x->reason, 'label' => BandejaService::MOTIVOS[$x->reason] ?? $x->reason, 'items' => $x->items]),
            'income' => collect($erf['lines'])->whereIn('code', ['F1', 'FB', 'FR'])->values(),
            'close_history' => $cerr->map(fn ($x, $i) => ['period' => substr($x->period, 0, 7), 'closed_at' => $x->closed_at, 'days' => $dias[$i]])->values(),
        ];
    }
}
