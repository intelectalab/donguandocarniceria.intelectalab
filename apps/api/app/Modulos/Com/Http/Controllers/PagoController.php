<?php

namespace App\Modulos\Com\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Com\Services\PagosService as P;
use App\Modulos\Com\Services\Soporte as C;
use App\Support\Listado;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** COM-09 Cuentas por pagar y COM-10 Pagos a proveedores. */
class PagoController extends Controller
{
    use Alcance;

    public function porPagar(Request $r)
    {
        $f = ['supplier_id' => $r->query('supplier_id'), 'site' => $r->query('site') !== 'ALL' ? $r->query('site') : null];
        $docs = P::porPagar($r->query('date'), $f);
        $locales = \App\Support\Access::for($r->user())['establishments'];
        if ($locales) {
            $docs = $docs->filter(fn ($d) => ! $d->establishment_id || in_array($d->establishment_id, $locales, true))->values();
        }
        if ($b = $r->query('bucket')) {
            $docs = $docs->where('bucket', $b)->values();
        }
        if ($r->boolean('scheduled')) {
            $docs = $docs->whereNotNull('scheduled_pay_date')->values();
        }
        if ($s = mb_strtolower((string) $r->query('q'))) {
            $docs = $docs->filter(fn ($d) => str_contains(mb_strtolower($d->supplier_name.' '.$d->supplier_trade_name.' '.$d->series.'-'.$d->number), $s))->values();
        }
        foreach ($docs as $d) {
            $d->label = C::etiquetaDoc($d);
        }
        $porProveedor = $docs->groupBy('supplier_id')->map(fn ($g) => [
            'supplier_id' => $g[0]->supplier_id, 'supplier_name' => $g[0]->supplier_trade_name ?: $g[0]->supplier_name, 'docs' => $g->count(),
            'balance' => C::t($g->sum(fn ($d) => (float) $d->balance_pen)),
            'overdue' => C::t($g->where('bucket', '<>', 'NOT_DUE')->sum(fn ($d) => (float) $d->balance_pen)),
            'max_overdue_days' => max(0, (int) $g->max('overdue_days')),
        ])->sortByDesc(fn ($x) => (float) $x['balance'])->values();
        $tramos = collect(P::TRAMOS)->map(fn ($n, $k) => ['bucket' => $k, 'label' => $n, 'docs' => $docs->where('bucket', $k)->count(),
            'amount' => C::t($docs->where('bucket', $k)->sum(fn ($d) => (float) $d->balance_pen))])->values();

        return response()->json(['data' => $docs->values(), 'suppliers' => $porProveedor, 'buckets' => $tramos, 'total' => C::t($docs->sum(fn ($d) => (float) $d->balance_pen))]);
    }

    public function programar(Request $r, string $id)
    {
        $d = $r->validate(['date' => 'nullable|date']);

        return response()->json(P::programar($id, $d['date'] ?? null));
    }

    public function index(Request $r)
    {
        $q = DB::table('supplier_payments as p')->join('suppliers as s', 's.id', '=', 'p.supplier_id')->join('cash_accounts as c', 'c.id', '=', 'p.cash_account_id')
            ->leftJoin('users as u', 'u.id', '=', 'p.registered_by')
            ->when($r->query('status'), fn ($x, $v) => $x->where('p.status', $v))
            ->when($r->query('method'), fn ($x, $v) => $x->where('p.method', $v))
            ->when($r->query('supplier_id'), fn ($x, $v) => $x->where('p.supplier_id', $v))
            ->when($r->query('from'), fn ($x, $v) => $x->whereRaw("(p.paid_at AT TIME ZONE 'America/Lima')::date >= ?", [$v]))
            ->when($r->query('to'), fn ($x, $v) => $x->whereRaw("(p.paid_at AT TIME ZONE 'America/Lima')::date <= ?", [$v]))
            ->selectRaw("p.id, p.number, p.paid_at, p.amount, p.method, p.reference, p.status, p.is_detraction, p.paid_to_account, p.supplier_id,
                coalesce(nullif(s.trade_name, ''), s.legal_name) as supplier_name, c.code as account_code, c.name as account_name, u.name as registered_by_name,
                (select string_agg(d.series || '-' || d.number, ', ') from supplier_payment_allocations a join purchase_documents d on d.id = a.document_id where a.payment_id = p.id) as documents,
                (select e.number from journal_entries e where e.source_id = p.id and e.source_kind = 'SUPPLIER_PAYMENT' and e.status <> 'VOIDED' order by e.created_at desc limit 1) as entry_number");

        return response()->json(Listado::de(DB::query()->fromSub($q, 'p'), $r, buscar: ['number', 'supplier_name', 'reference', 'documents'],
            ordenar: ['number', 'paid_at', 'amount', 'supplier_name', 'method'], porDefecto: '-paid_at'));
    }

    public function show(string $id)
    {
        return response()->json(P::ver($id));
    }

    public function store(Request $r)
    {
        $d = $r->validate([
            'supplier_id' => 'required|uuid', 'cash_account_id' => 'required|uuid', 'paid_at' => 'nullable|date', 'method' => 'nullable|in:'.implode(',', C::METODOS),
            'reference' => 'nullable|string|max:60', 'paid_to_account' => 'nullable|string|max:60', 'is_detraction' => 'nullable|boolean',
            'allocations' => 'required|array|min:1', 'allocations.*.document_id' => 'required|uuid', 'allocations.*.amount' => 'required|numeric|min:0',
        ]);

        return response()->json(P::registrar($d, $r->user()), 201);
    }

    public function revertir(Request $r, string $id)
    {
        $d = $r->validate(['reason' => 'required|string|min:5|max:300']);

        return response()->json(P::revertir($id, $d['reason'], $r->user()));
    }
}
