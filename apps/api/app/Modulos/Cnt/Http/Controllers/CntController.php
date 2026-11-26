<?php

namespace App\Modulos\Cnt\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Cnt\Services\AsientosService as A;
use App\Modulos\Cnt\Services\BandejaService as B;
use App\Modulos\Cnt\Services\CierreService as K;
use App\Modulos\Cnt\Services\PlanService as P;
use App\Modulos\Cnt\Services\ReportesService as R;
use App\Modulos\Cnt\Services\SireService as S;
use App\Modulos\Plt\Services\Periodos;
use App\Support\Access;
use App\Support\Params;
use App\Support\RuleError;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * CNT-06 a CNT-16: SIRE, libros y régimen, bancos, cierre, estados financieros, balance, planilla y tablero.
 * Además las opciones de los formularios y las cifras de cabecera de cada pantalla.
 */
class CntController extends Controller
{
    private static function empresa(Request $r): string
    {
        return $r->query('company_id') ?: $r->input('company_id') ?: K::empresa();
    }

    private static function mes(Request $r, string $k = 'period'): string
    {
        return substr((string) ($r->input($k) ?: $r->query($k) ?: A::hoy()), 0, 7).'-01';
    }

    private static function filtros(Request $r): array
    {
        return array_filter(['company_id' => self::empresa($r), 'brand' => $r->query('brand'), 'site' => $r->query('site'), 'from' => $r->query('from'), 'to' => $r->query('to')]);
    }

    public function opciones(Request $r)
    {
        $u = $r->user();
        $emp = self::empresa($r);

        return response()->json([
            'companies' => DB::table('companies')->orderBy('legal_name')->get(['id', 'legal_name', 'ruc']),
            'company_id' => $emp,
            'accounts' => DB::table('gl_accounts')->where('company_id', $emp)->where('postable', true)->where('status', 'ACTIVE')->orderBy('code')
                ->get(['code', 'name', 'acc_type', 'nature', 'requires_cost_center', 'requires_third_party', 'requires_brand']),
            'brands' => DB::table('brands')->orderBy('name')->get(['id', 'code', 'name']),
            'establishments' => DB::table('establishments')->where('company_id', $emp)->orderBy('name')->get(['id', 'code', 'name']),
            'cost_centers' => DB::table('cost_centers')->orderBy('code')->get(['id', 'code', 'name']),
            'cash_accounts' => DB::table('cash_accounts')->orderBy('code')->get(['id', 'code', 'name', 'bank_name', 'account_type']),
            'team' => DB::table('users as u')->join('user_roles as ur', 'ur.user_id', '=', 'u.id')->join('roles as ro', 'ro.id', '=', 'ur.role_id')
                ->whereIn('ro.code', ['CONTADORA', 'PRACTICANTE_CONTABLE'])->where('u.status', 'ACTIVE')->orderBy('u.name')->distinct()->get(['u.id', 'u.name']),
            'periods' => DB::table('accounting_periods')->where('company_id', $emp)->orderByDesc('period')->limit(18)->get(['period', 'status', 'closed_at']),
            'sources' => P::ORIGENES + ['SUPPLIER_PAYMENT' => 'Pago a proveedor', 'MANUAL' => 'Manual', 'OPENING' => 'Apertura'],
            'reasons' => B::MOTIVOS, 'types' => P::TIPOS, 'amounts' => P::IMPORTES, 'books' => collect(R::LIBROS)->map(fn ($x, $k) => ['code' => $k, 'name' => $x[0], 'via' => $x[1]])->values(),
            'resolutions' => S::RESOLUCIONES, 'tasks' => collect(K::TAREAS)->map(fn ($t) => ['code' => $t[0], 'name' => $t[1], 'auto' => $t[2]]),
            'today' => A::hoy(),
            'params' => ['sire_tolerance' => (float) (Params::get('cnt_sire_amount_tolerance_pen') ?? 1), 'threshold_uit' => (float) (Params::get('cnt_mype_books_threshold_uit') ?? 300),
                'inbox_max_age_days' => (int) (Params::get('cnt_inbox_max_age_days') ?? 3), 'interunit_account' => (string) (Params::get('cnt_interunit_account_code') ?? '4699')],
            'can' => ['accounts' => Access::can($u, 'cnt.account.manage'), 'rules' => Access::can($u, 'cnt.rule.manage'), 'prepare' => Access::can($u, 'cnt.entry.prepare'),
                'approve' => Access::can($u, 'cnt.entry.approve'), 'close' => Access::can($u, 'cnt.period.close'), 'reopen' => Access::can($u, 'cnt.period.reopen'),
                'sire' => Access::can($u, 'cnt.sire.manage'), 'submit' => Access::can($u, 'cnt.sire.submit'), 'reports' => Access::can($u, 'cnt.report.view')],
        ]);
    }

    public function cifras(Request $r, string $pantalla)
    {
        $emp = self::empresa($r);
        $p = self::mes($r);
        $fin = \Carbon\CarbonImmutable::parse($p)->endOfMonth()->toDateString();
        $ent = fn () => DB::table('journal_entries')->where('company_id', $emp)->where('period', $p);

        return response()->json(match ($pantalla) {
            '01' => DB::table('gl_accounts')->where('company_id', $emp)->selectRaw("count(*) as accounts, count(*) filter (where postable) as postable,
                count(*) filter (where requires_cost_center) as with_cost_center, count(*) filter (where status <> 'ACTIVE') as inactive")->first(),
            '02' => DB::table('journal_rules')->where('company_id', $emp)->whereNull('valid_to')->selectRaw("count(*) filter (where status = 'ACTIVE') as active,
                count(*) filter (where auto_approve and status = 'ACTIVE') as auto_approve, count(distinct source) filter (where status = 'ACTIVE') as sources")->first(),
            '03' => $ent()->selectRaw("count(*) filter (where status = 'APPROVED') as approved, count(*) filter (where status = 'PENDING_APPROVAL') as pending,
                count(*) filter (where status = 'DRAFT') as drafts, coalesce(sum(total_debit) filter (where status = 'APPROVED'), 0) as amount")->first(),
            '04' => ['mine_pending' => $ent()->where('source_kind', 'MANUAL')->where('prepared_by', $r->user()->id)->whereIn('status', ['DRAFT', 'PENDING_APPROVAL'])->count(),
                'manual_month' => $ent()->where('source_kind', 'MANUAL')->where('status', '<>', 'VOIDED')->count(), 'period_open' => ! Periodos::cerrado($p, $emp)],
            '05' => ['open' => DB::table('accountant_inbox_items')->where('company_id', $emp)->whereIn('status', B::ABIERTOS)->count(),
                'classified' => DB::table('accountant_inbox_items')->where('company_id', $emp)->where('status', 'CLASSIFIED')->count(),
                'returned' => DB::table('accountant_inbox_items')->where('company_id', $emp)->where('status', 'RETURNED')->count(),
                'overdue' => DB::table('accountant_inbox_items')->where('company_id', $emp)->whereIn('status', ['PENDING', 'CLASSIFIED'])->where('created_at', '<', now()->subDays((int) (Params::get('cnt_inbox_max_age_days') ?? 3)))->count()],
            '06', '07' => (function () use ($pantalla, $p, $emp) {
                $v = S::vigente($pantalla === '06' ? 'PURCHASES' : 'SALES', $p, $emp);

                return ['proposal' => $v ? S::ver($v->id) : null, 'system' => ($pantalla === '06' ? S::compras($p, $emp) : S::ventas($p, $emp))->count()];
            })(),
            '08' => DB::table('sire_submissions')->where('company_id', $emp)->selectRaw("count(*) filter (where status = 'PREPARED') as prepared, count(*) filter (where status = 'SUBMITTED') as submitted,
                count(*) filter (where status = 'ACCEPTED') as accepted, count(*) filter (where status = 'REJECTED') as rejected")->first(),
            '09' => ['exports' => DB::table('ledger_exports')->where('company_id', $emp)->count(), 'last' => DB::table('ledger_exports')->where('company_id', $emp)->max('generated_at')],
            '10' => DB::table('cnt_fiscal_years')->where('company_id', $emp)->orderByDesc('year')->first(),
            '11' => DB::table('bank_reconciliations')->where('company_id', $emp)->selectRaw("count(*) filter (where status = 'OPEN') as open, count(*) filter (where status = 'CLOSED') as closed")->first(),
            '12' => ['period' => $p, 'status' => Periodos::cerrado($p, $emp) ? 'CLOSED' : 'OPEN', 'blockers' => count(K::bloqueos($p, $emp))],
            '13', '14' => ['entries' => $ent()->where('status', 'APPROVED')->count(), 'from' => $p, 'to' => $fin],
            '15' => ['imports' => DB::table('payroll_journal_imports')->where('company_id', $emp)->where('status', '<>', 'VOIDED')->count(),
                'last_period' => DB::table('payroll_journal_imports')->where('company_id', $emp)->where('status', '<>', 'VOIDED')->max('period')],
            '16' => R::tablero($p, $emp)['kpis'],
            default => abort(404),
        });
    }

    /* ---------------- CNT-06, 07 y 08 SIRE */

    public function propuestas(Request $r)
    {
        $emp = self::empresa($r);
        $q = DB::table('sire_proposals as p')->leftJoin('users as u', 'u.id', '=', 'p.imported_by')->where('p.company_id', $emp)
            ->when($r->query('register'), fn ($x, $v) => $x->where('p.register', $v))
            ->when($r->query('period'), fn ($x, $v) => $x->where('p.period', substr($v, 0, 7).'-01'))
            ->orderByDesc('p.period')->orderByDesc('p.imported_at')->limit(60)->get(['p.*', 'u.name as imported_by_name']);

        return response()->json(['data' => $q->map(function ($x) {
            $x->summary = json_decode($x->summary ?: '{}', true);

            return $x;
        })]);
    }

    public function propuesta(Request $r, string $id)
    {
        $p = S::ver($id);
        $lineas = DB::table('sire_proposal_lines as l')->leftJoin('users as u', 'u.id', '=', 'l.resolved_by')->where('l.proposal_id', $id)
            ->when($r->query('status'), fn ($x, $v) => $v === 'DIFF' ? $x->where('l.match_status', '<>', 'MATCHED') : $x->where('l.match_status', $v))
            ->when(trim((string) $r->query('q')), fn ($x, $v) => $x->where(fn ($w) => $w->where('l.issuer_ruc', 'like', "%{$v}%")->orWhere('l.issuer_name', 'ilike', "%{$v}%")
                ->orWhere('l.series', 'ilike', "%{$v}%")->orWhereRaw('l.number::text like ?', ["%{$v}%"])))
            ->orderByRaw("case l.match_status when 'MATCHED' then 1 else 0 end")->orderBy('l.seq')->limit((int) $r->query('limit', 300))
            ->get(['l.*', 'u.name as resolved_by_name']);

        return response()->json(['proposal' => $p, 'lines' => $lineas]);
    }

    public function sistema(Request $r)
    {
        $p = self::mes($r);
        $emp = self::empresa($r);
        $l = $r->query('register', 'PURCHASES') === 'SALES' ? S::ventas($p, $emp) : S::compras($p, $emp);

        return response()->json(['period' => $p, 'count' => $l->count(), 'total' => round($l->sum('total'), 2), 'data' => $l->take(300)->values()]);
    }

    public function importarPropuesta(Request $r)
    {
        $d = $r->validate(['company_id' => 'nullable|uuid', 'register' => 'required|in:PURCHASES,SALES', 'period' => 'required|date', 'text' => 'required_without:lines|nullable|string',
            'file_name' => 'nullable|string|max:200', 'inbox' => 'nullable|boolean', 'lines' => 'nullable|array']);

        return response()->json(S::importar($d, $r->user()), 201);
    }

    public function cruzar(Request $r, string $id)
    {
        S::ver($id);

        return response()->json(['summary' => S::cruzar($id, $r->boolean('inbox')), 'proposal' => S::ver($id)]);
    }

    public function resolver(Request $r, string $lineId)
    {
        $d = $r->validate(['resolution' => 'required|string|max:30', 'note' => 'nullable|string|max:500']);

        return response()->json(S::resolver($lineId, $d['resolution'], (string) ($d['note'] ?? ''), $r->user()));
    }

    public function ejemplo(Request $r)
    {
        $reg = $r->query('register', 'PURCHASES') === 'SALES' ? 'SALES' : 'PURCHASES';

        return response(S::ejemplo($reg, self::mes($r)), 200, ['Content-Type' => 'text/plain; charset=utf-8']);
    }

    public function envios(Request $r)
    {
        $emp = self::empresa($r);
        $q = DB::table('sire_submissions as s')->leftJoin('users as p', 'p.id', '=', 's.prepared_by')->leftJoin('users as u', 'u.id', '=', 's.submitted_by')->where('s.company_id', $emp)
            ->when($r->query('register'), fn ($x, $v) => $x->where('s.register', $v))
            ->when($r->query('status'), fn ($x, $v) => $x->where('s.status', $v))
            ->orderByDesc('s.period')->orderByDesc('s.generated_at')->limit(60)->get(['s.*', 'p.name as prepared_by_name', 'u.name as submitted_by_name']);
        $pend = [];
        foreach (['PURCHASES', 'SALES'] as $reg) {
            foreach ([self::mes($r), \Carbon\CarbonImmutable::parse(self::mes($r))->subMonth()->toDateString()] as $per) {
                $v = S::vigente($reg, $per, $emp);
                if ($v && ! $q->where('proposal_id', $v->id)->whereIn('status', ['PREPARED', 'SUBMITTED', 'ACCEPTED'])->count()) {
                    $pend[] = ['register' => $reg, 'period' => $per, 'proposal_id' => $v->id, 'unresolved' => S::sinResolver($v->id)->count()];
                }
            }
        }

        return response()->json(['data' => $q, 'ready' => $pend]);
    }

    public function preparar(Request $r)
    {
        $d = $r->validate(['company_id' => 'nullable|uuid', 'register' => 'required|in:PURCHASES,SALES', 'period' => 'required|date', 'action' => 'nullable|in:ACCEPT,REPLACE,ADJUST']);

        return response()->json(S::preparar($d, $r->user()), 201);
    }

    public function enviado(Request $r, string $id)
    {
        $d = $r->validate(['ticket' => 'required|string|max:60']);

        return response()->json(S::marcarEnviado($id, $d['ticket'], $r->user()));
    }

    public function resultado(Request $r, string $id)
    {
        $d = $r->validate(['accepted' => 'required|boolean', 'reference' => 'required|string|max:80']);

        return response()->json(S::marcarResultado($id, (bool) $d['accepted'], $d['reference'], $r->user()));
    }

    /* ---------------- CNT-09 libros y CNT-10 régimen */

    public function libros(Request $r)
    {
        $emp = self::empresa($r);
        $anio = (int) ($r->query('year') ?: substr(A::hoy(), 0, 4));
        try {
            $reg = R::regimen($anio, $emp);
        } catch (RuleError $e) {
            $reg = ['year' => $anio, 'result' => null, 'books' => ['RV', 'RC', 'LDS'], 'error' => $e->getMessage()];
        }
        $codigos = json_decode((string) Params::get('cnt_ple_book_codes'), true);
        $libros = collect(R::LIBROS)->map(fn ($x, $k) => ['code' => $k, 'name' => $x[0], 'via' => $x[1], 'required' => in_array($k, $reg['books'], true),
            'ple_code' => is_array($codigos) ? ($codigos[$k] ?? null) : null])->values();
        $exp = DB::table('ledger_exports as x')->leftJoin('users as u', 'u.id', '=', 'x.generated_by')->where('x.company_id', $emp)
            ->whereRaw('extract(year from x.period) = ?', [$anio])->orderByDesc('x.generated_at')->limit(100)->get(['x.*', 'u.name as generated_by_name']);

        return response()->json(['regime' => $reg, 'books' => $libros, 'exports' => $exp]);
    }

    public function vistaLibro(Request $r)
    {
        $codigo = (string) $r->query('book', 'LDS');
        isset(R::LIBROS[$codigo]) || abort(404);
        $filas = R::filasLibro($codigo, self::mes($r), self::empresa($r));

        return response()->json(['book' => $codigo, 'name' => R::LIBROS[$codigo][0], 'count' => count($filas), 'rows' => array_slice($filas, 0, 200)]);
    }

    public function generarLibro(Request $r)
    {
        $d = $r->validate(['company_id' => 'nullable|uuid', 'book_code' => 'required|string|max:5', 'period' => 'required|date', 'format' => 'required|in:PDF,XLSX,TXT']);

        return response()->json(R::generarLibro($d, $r->user()), 201);
    }

    public function anios(Request $r)
    {
        $emp = self::empresa($r);
        $filas = DB::table('cnt_fiscal_years as y')->leftJoin('users as u', 'u.id', '=', 'y.uit_confirmed_by')->where('y.company_id', $emp)->orderByDesc('y.year')
            ->get(['y.*', 'u.name as confirmed_by_name'])->map(function ($y) use ($emp) {
                $y->books = json_decode($y->books ?: '[]', true) ?: [];
                $y->ledger_revenue = R::ingresosNetos((int) $y->year, $emp);

                return $y;
            });

        return response()->json(['data' => $filas, 'threshold_uit' => (float) (Params::get('cnt_mype_books_threshold_uit') ?? 300)]);
    }

    public function regimen(Request $r)
    {
        $d = $r->validate(['year' => 'required|integer|min:2020|max:2100', 'revenue' => 'nullable|numeric|min:0']);

        return response()->json(R::regimen((int) $d['year'], self::empresa($r), isset($d['revenue']) ? (float) $d['revenue'] : null));
    }

    public function guardarAnio(Request $r)
    {
        $d = $r->validate(['company_id' => 'nullable|uuid', 'year' => 'required|integer|min:2020|max:2100', 'uit_value_pen' => 'nullable|numeric|gt:0', 'revenue_pen' => 'nullable|numeric|min:0',
            'uit_source' => 'nullable|string|max:200', 'notes' => 'nullable|string|max:500']);

        return response()->json(R::guardarAnio($d, $r->user()));
    }

    /* ---------------- CNT-11 conciliación bancaria */

    public function bancos(Request $r)
    {
        $emp = self::empresa($r);
        $q = DB::table('bank_reconciliations as b')->join('cash_accounts as c', 'c.id', '=', 'b.cash_account_id')->leftJoin('users as u', 'u.id', '=', 'b.closed_by')
            ->where('b.company_id', $emp)->orderByDesc('b.period')->orderBy('c.code')
            ->get(['b.*', 'c.code as account_code', 'c.name as account_name', 'c.bank_name', 'u.name as closed_by_name',
                DB::raw("(select count(*) from bank_statement_lines s where s.reconciliation_id = b.id and s.matched_line_id is null) as unmatched")]);

        return response()->json(['data' => $q, 'accounts' => DB::table('cash_accounts')->where('account_type', 'BANK')->where('status', 'ACTIVE')->orderBy('code')->get(['id', 'code', 'name', 'bank_name'])]);
    }

    public function banco(string $id)
    {
        return response()->json(K::resumenBanco($id));
    }

    public function importarExtracto(Request $r)
    {
        $d = $r->validate(['company_id' => 'nullable|uuid', 'cash_account_id' => 'required|uuid', 'period' => 'required|date', 'opening_balance' => 'nullable|numeric',
            'file_name' => 'nullable|string|max:200', 'lines' => 'required|array|min:1', 'lines.*.date' => 'required|date', 'lines.*.description' => 'nullable|string|max:300',
            'lines.*.reference' => 'nullable|string|max:80', 'lines.*.amount' => 'required|numeric']);

        return response()->json(K::importarExtracto($d, $r->user()), 201);
    }

    public function recruzar(string $id)
    {
        $n = K::cruzarBanco($id);

        return response()->json(['matched' => $n, 'reconciliation' => K::resumenBanco($id)]);
    }

    public function cruzarLinea(Request $r, string $lineId)
    {
        $d = $r->validate(['book_line_id' => 'nullable|uuid']);
        Access::can($r->user(), 'cnt.entry.prepare') || RuleError::fail('RN-CNT-21', 'Conciliar bancos es del equipo contable.');

        return response()->json(K::cruzarManual($lineId, $d['book_line_id'] ?? null, $r->user()));
    }

    public function cargo(Request $r, string $lineId)
    {
        $d = $r->validate(['account_code' => 'nullable|string|max:10', 'cost_center_id' => 'nullable|uuid', 'brand_id' => 'nullable|uuid']);
        Access::can($r->user(), 'cnt.entry.prepare') || RuleError::fail('RN-CNT-21', 'Registrar cargos bancarios es del equipo contable.');

        return response()->json(K::registrarCargo($lineId, $d, $r->user()), 201);
    }

    public function cerrarBanco(Request $r, string $id)
    {
        return response()->json(K::cerrarBanco($id, $r->user()));
    }

    /* ---------------- CNT-12 cierre mensual */

    public function cierre(Request $r)
    {
        $p = self::mes($r);
        $emp = self::empresa($r);
        $tareas = K::tareas($p, $emp)->map(function ($t) use ($p, $emp) {
            if ($t->auto_check && ! in_array($t->status, ['DONE', 'WAIVED'], true)) {
                [$ok, $det] = K::verificar($t->code, $p, $emp);
                $t->check_ok = $ok;
                $t->check_detail = $det;
            } else {
                $t->check_ok = null;
                $t->check_detail = $t->last_check;
            }

            return $t;
        });
        $fila = DB::table('accounting_periods as a')->leftJoin('users as u', DB::raw('u.id::text'), '=', 'a.closed_by')->where('a.company_id', $emp)->where('a.period', $p)->first(['a.*', 'u.name as closed_by_name']);

        return response()->json(['period' => $p, 'name' => Periodos::nombre($p), 'status' => Periodos::cerrado($p, $emp) ? 'CLOSED' : 'OPEN', 'row' => $fila,
            'tasks' => $tareas, 'blockers' => K::bloqueos($p, $emp),
            'history' => DB::table('accounting_periods as a')->leftJoin('users as u', DB::raw('u.id::text'), '=', 'a.closed_by')->where('a.company_id', $emp)->orderByDesc('a.period')->limit(12)
                ->get(['a.period', 'a.status', 'a.closed_at', 'u.name as closed_by_name'])]);
    }

    public function marcar(Request $r, string $id)
    {
        $d = $r->validate(['waive' => 'nullable|boolean', 'reason' => 'nullable|string|max:500', 'evidence' => 'nullable|string|max:500']);

        return response()->json(K::marcar($id, $d, $r->user()));
    }

    public function desmarcar(Request $r, string $id)
    {
        Access::can($r->user(), 'cnt.entry.prepare') || RuleError::fail('RN-CNT-21', 'Las tareas del cierre las marca el equipo contable.');

        return response()->json(K::desmarcar($id));
    }

    public function cerrar(Request $r)
    {
        $d = $r->validate(['period' => 'required|date', 'company_id' => 'nullable|uuid']);

        return response()->json(K::cerrar($d['period'], $r->user(), $d['company_id'] ?? null));
    }

    public function reabrir(Request $r)
    {
        $d = $r->validate(['period' => 'required|date', 'reason' => 'required|string|max:500', 'company_id' => 'nullable|uuid']);

        return response()->json(K::reabrir($d['period'], $d['reason'], $r->user(), $d['company_id'] ?? null));
    }

    /* ---------------- CNT-13 estados financieros y CNT-14 balance */

    public function estado(Request $r, string $codigo)
    {
        in_array($codigo, ['ESF', 'ERF', 'ERN'], true) || abort(404);

        return response()->json(R::estado($codigo, self::filtros($r)));
    }

    public function comparativo(Request $r, string $codigo)
    {
        in_array($codigo, ['ERF', 'ERN'], true) || abort(404);
        $hasta = (string) ($r->query('to') ?: A::hoy());

        return response()->json(['code' => $codigo, 'columns' => R::comparativo($codigo, $hasta, max(2, min(12, (int) $r->query('months', 6))), array_diff_key(self::filtros($r), ['from' => 1, 'to' => 1])),
            'labels' => DB::table('fs_template_lines as l')->join('fs_templates as t', 't.id', '=', 'l.template_id')->where('t.code', $codigo)->where('t.company_id', self::empresa($r))
                ->orderBy('l.seq')->get(['l.code', 'l.label', 'l.kind'])]);
    }

    public function balance(Request $r)
    {
        $f = self::filtros($r);
        $b = R::balance($f);

        return response()->json(['from' => $f['from'] ?? substr(A::hoy(), 0, 7).'-01', 'to' => $f['to'] ?? A::hoy(), 'data' => $b,
            'totals' => ['opening' => round($b->sum('opening'), 2), 'debit' => round($b->sum('debit'), 2), 'credit' => round($b->sum('credit'), 2), 'closing' => round($b->sum('closing'), 2)]]);
    }

    public function mayor(Request $r, string $codigo)
    {
        return response()->json(R::mayor($codigo, self::filtros($r)));
    }

    /* ---------------- CNT-15 planilla y CNT-16 tablero */

    public function planillas(Request $r)
    {
        $emp = self::empresa($r);

        return response()->json(['data' => DB::table('payroll_journal_imports as p')->leftJoin('users as u', 'u.id', '=', 'p.imported_by')->leftJoin('journal_entries as e', 'e.id', '=', 'p.entry_id')
            ->where('p.company_id', $emp)->orderByDesc('p.period')->orderByDesc('p.imported_at')->limit(36)
            ->get(['p.*', 'u.name as imported_by_name', 'e.number as entry_number', 'e.status as entry_status'])->map(function ($x) {
                $x->lines = json_decode($x->lines ?: '[]', true) ?: [];

                return $x;
            })]);
    }

    public function planillaPrevia(Request $r)
    {
        return response()->json(R::planillaPrevia(self::mes($r)) + ['period' => self::mes($r)]);
    }

    public function importarPlanilla(Request $r)
    {
        $d = $r->validate(['company_id' => 'nullable|uuid', 'period' => 'required|date', 'source' => 'nullable|in:AYNI,FILE', 'file_name' => 'nullable|string|max:200']);

        return response()->json(R::importarPlanilla($d, $r->user()), 201);
    }

    public function tablero(Request $r)
    {
        return response()->json(R::tablero($r->query('month'), self::empresa($r)));
    }
}
