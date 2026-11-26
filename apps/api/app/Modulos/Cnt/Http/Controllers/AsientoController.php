<?php

namespace App\Modulos\Cnt\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Cnt\Services\AsientosService as A;
use App\Modulos\Cnt\Services\BandejaService as B;
use App\Modulos\Cnt\Services\PlanService as P;
use App\Support\Listado;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** CNT-01 Plan de cuentas, CNT-02 Reglas, CNT-03 Asientos, CNT-04 Asiento manual y CNT-05 Bandeja de la contadora. */
class AsientoController extends Controller
{
    private static function empresa(Request $r): string
    {
        return $r->query('company_id') ?: $r->input('company_id') ?: DB::table('companies')->orderBy('legal_name')->value('id');
    }

    /* ---------------- CNT-01 plan de cuentas */

    public function cuentas(Request $r)
    {
        $emp = self::empresa($r);
        $q = DB::table('gl_accounts as a')->where('a.company_id', $emp)
            ->when($r->query('acc_type'), fn ($x, $v) => $x->where('a.acc_type', $v))
            ->when($r->query('postable') !== null && $r->query('postable') !== '', fn ($x) => $x->where('a.postable', filter_var($r->query('postable'), FILTER_VALIDATE_BOOLEAN)))
            ->when($r->query('status'), fn ($x, $v) => $x->where('a.status', $v))
            ->when(trim((string) $r->query('q')), fn ($x, $v) => $x->where(fn ($w) => $w->where('a.code', 'like', $v.'%')->orWhereRaw("translate(lower(a.name), 'áéíóúüñ', 'aeiouun') like translate(lower(?), 'áéíóúüñ', 'aeiouun')", ['%'.$v.'%'])))
            ->selectRaw('a.*, exists(select 1 from journal_lines l join journal_entries e on e.id = l.entry_id where l.account_code = a.code and e.company_id = a.company_id) as has_moves')
            ->orderBy('a.code');

        return response()->json(['data' => $q->get(), 'types' => P::TIPOS]);
    }

    public function guardarCuenta(Request $r, ?string $id = null)
    {
        $d = $r->validate(['company_id' => 'nullable|uuid', 'code' => ($id ? 'nullable' : 'required').'|string|max:10', 'name' => ($id ? 'nullable' : 'required').'|string|max:200',
            'acc_type' => 'nullable|in:'.implode(',', array_keys(P::TIPOS)), 'nature' => 'nullable|in:DEBIT,CREDIT', 'postable' => 'nullable|boolean',
            'requires_cost_center' => 'nullable|boolean', 'requires_third_party' => 'nullable|boolean', 'requires_brand' => 'nullable|boolean',
            'dest_debit_code' => 'nullable|string|max:10', 'dest_credit_code' => 'nullable|string|max:10', 'status' => 'nullable|in:ACTIVE,INACTIVE']);

        return response()->json(P::guardarCuenta($d, $id, $r->user()), $id ? 200 : 201);
    }

    /* ---------------- CNT-02 reglas */

    public function reglas(Request $r)
    {
        $emp = self::empresa($r);
        $hoy = A::hoy();
        $q = DB::table('journal_rules as r')->leftJoin('users as u', 'u.id', '=', 'r.approved_by')->where('r.company_id', $emp)
            ->when($r->query('source'), fn ($x, $v) => $x->where('r.source', $v))
            ->when($r->query('status'), fn ($x, $v) => $x->where('r.status', $v))
            ->when(! $r->boolean('history'), fn ($x) => $x->where(fn ($w) => $w->whereNull('r.valid_to')->orWhere('r.valid_to', '>=', $hoy)))
            ->selectRaw('r.*, u.name as approved_by_name, (select count(*) from journal_rule_lines l where l.rule_id = r.id) as line_count,
                (select count(*) from journal_entries e where e.rule_id = r.id) as entries')
            ->orderBy('r.source')->orderBy('r.subtype')->orderByDesc('r.version');

        return response()->json(['data' => $q->get()->map(function ($x) {
            $x->source_label = P::ORIGENES[$x->source] ?? $x->source;
            $x->account_map = json_decode($x->account_map ?: '[]', true) ?: [];

            return $x;
        }), 'sources' => P::ORIGENES, 'amounts' => P::IMPORTES]);
    }

    public function regla(string $id)
    {
        return response()->json(P::verRegla($id));
    }

    public function guardarRegla(Request $r, ?string $id = null)
    {
        $d = $r->validate(['company_id' => 'nullable|uuid', 'code' => 'nullable|string|max:20', 'source' => ($id ? 'nullable' : 'required').'|string', 'subtype' => 'nullable|string|max:40',
            'name' => ($id ? 'nullable' : 'required').'|string|max:200', 'auto_approve' => 'nullable|boolean', 'allocate_common' => 'nullable|boolean', 'valid_from' => 'nullable|date',
            'valid_to' => 'nullable|date', 'account_map' => 'nullable|array', 'lines' => 'required|array|min:2', 'lines.*.side' => 'required|in:D,C',
            'lines.*.account_from' => 'nullable|string|max:20', 'lines.*.account_code' => 'nullable|string|max:10', 'lines.*.param_key' => 'nullable|string|max:60',
            'lines.*.amount_key' => 'required|string', 'lines.*.third' => 'nullable|string|max:20']);

        return response()->json(P::guardarRegla($d, $id, $r->user()), $id ? 200 : 201);
    }

    public function estadoRegla(Request $r, string $id)
    {
        $d = $r->validate(['status' => 'required|in:ACTIVE,INACTIVE']);

        return response()->json(P::estadoRegla($id, $d['status'], $r->user()));
    }

    /* ---------------- CNT-03 asientos */

    public function asientos(Request $r)
    {
        $emp = self::empresa($r);
        $q = DB::table('journal_entries as e')->leftJoin('users as up', 'up.id', '=', 'e.prepared_by')->leftJoin('users as ua', 'ua.id', '=', 'e.approved_by')
            ->leftJoin('brands as b', 'b.id', '=', 'e.brand_id')->leftJoin('establishments as s', 's.id', '=', 'e.establishment_id')->where('e.company_id', $emp)
            ->when($r->query('status'), fn ($x, $v) => $x->whereIn('e.status', explode(',', $v)))
            ->when($r->query('source'), fn ($x, $v) => $x->where('e.source_type', $v))
            ->when($r->query('period'), fn ($x, $v) => $x->where('e.period', substr($v, 0, 7).'-01'))
            ->when($r->query('from'), fn ($x, $v) => $x->where('e.entry_date', '>=', $v))
            ->when($r->query('to'), fn ($x, $v) => $x->where('e.entry_date', '<=', $v))
            ->when($r->query('brand'), fn ($x, $v) => $x->where(fn ($w) => $w->where('e.brand_id', $v)->orWhereExists(fn ($s) => $s->from('journal_lines as l')->whereColumn('l.entry_id', 'e.id')->where('l.brand_id', $v))))
            ->when($r->query('site'), fn ($x, $v) => $x->where(fn ($w) => $w->where('e.establishment_id', $v)->orWhereExists(fn ($s) => $s->from('journal_lines as l')->whereColumn('l.entry_id', 'e.id')->where('l.establishment_id', $v))))
            ->when($r->query('account'), fn ($x, $v) => $x->whereExists(fn ($s) => $s->from('journal_lines as l')->whereColumn('l.entry_id', 'e.id')->where('l.account_code', 'like', $v.'%')))
            ->when($r->boolean('mine'), fn ($x) => $x->where('e.prepared_by', $r->user()->id))
            ->selectRaw("e.id, e.number, e.seq, e.period, e.entry_date, e.source_kind, e.source_type, e.source_subtype, e.source_id, e.source_label, e.rule_code, e.description, e.status,
                e.total_debit, e.total_credit, e.blocked, e.auto_approved, e.prepared_by, e.approved_at, e.reversal_of, e.reversed_by_id, e.created_at,
                coalesce(up.name, case when e.prepared_by is null then 'Sistema' end) as prepared_by_name, ua.name as approved_by_name, b.name as brand_name, s.name as establishment_name");
        $p = Listado::de(DB::query()->fromSub($q, 'd'), $r, buscar: ['number', 'description', 'source_label', 'rule_code'],
            ordenar: ['entry_date', 'number', 'total_debit', 'status', 'source_type', 'created_at'], porDefecto: '-entry_date');
        $p->getCollection()->transform(function ($x) {
            $x->source_name = A::ORIGENES[$x->source_type] ?? (P::ORIGENES[$x->source_type] ?? ($x->source_type === 'MANUAL' ? 'Manual' : $x->source_type));

            return $x;
        });

        return response()->json($p);
    }

    public function asiento(Request $r, string $id)
    {
        $e = A::ver($id);
        $e->source_name = A::ORIGENES[$e->source_type] ?? (P::ORIGENES[$e->source_type] ?? ($e->source_type === 'MANUAL' ? 'Manual' : $e->source_type));
        $u = $r->user();
        $e->can = ['approve' => \App\Support\Access::can($u, 'cnt.entry.approve') && $e->prepared_by !== $u->id && $e->status === 'PENDING_APPROVAL' && ! $e->blocked,
            'reverse' => \App\Support\Access::can($u, 'cnt.entry.prepare') && $e->status === 'APPROVED' && ! $e->reversed_by_id,
            'edit' => \App\Support\Access::can($u, 'cnt.entry.prepare') && in_array($e->status, ['DRAFT', 'PENDING_APPROVAL'], true),
            'void' => \App\Support\Access::can($u, 'cnt.entry.prepare') && in_array($e->status, ['DRAFT', 'PENDING_APPROVAL'], true)];
        $e->inbox = DB::table('accountant_inbox_items')->where('entry_id', $id)->whereIn('status', B::ABIERTOS)->get(['id', 'reason', 'status']);

        return response()->json($e);
    }

    public function crearAsiento(Request $r)
    {
        $d = $r->validate(['company_id' => 'nullable|uuid', 'entry_date' => 'required|date', 'description' => 'required|string|max:300', 'reference' => 'nullable|string|max:255',
            'brand_id' => 'nullable|uuid', 'establishment_id' => 'nullable|uuid', 'draft' => 'nullable|boolean', 'destination' => 'nullable|boolean', 'bank_line_id' => 'nullable|uuid',
            'lines' => 'required|array|min:2', 'lines.*.account_code' => 'nullable|string|max:10', 'lines.*.description' => 'nullable|string|max:300',
            'lines.*.debit' => 'nullable|numeric|min:0', 'lines.*.credit' => 'nullable|numeric|min:0', 'lines.*.cost_center_id' => 'nullable|uuid', 'lines.*.brand_id' => 'nullable|uuid',
            'lines.*.establishment_id' => 'nullable|uuid', 'lines.*.third_party_type' => 'nullable|in:SUPPLIER,CUSTOMER,EMPLOYEE', 'lines.*.third_party_id' => 'nullable|uuid',
            'lines.*.third_party_doc' => 'nullable|string|max:20', 'lines.*.third_party_name' => 'nullable|string|max:200']);

        return response()->json(A::manual($d, $r->user(), (bool) ($d['draft'] ?? false)), 201);
    }

    public function enviar(Request $r, string $id)
    {
        return response()->json(A::enviar($id, $r->user()));
    }

    public function aprobar(Request $r, string $id)
    {
        return response()->json(A::ver(A::aprobar($id, $r->user())->id ?? $id));
    }

    public function cambiarLinea(Request $r, string $lineId)
    {
        $d = $r->validate(['account_code' => 'sometimes|string|max:10', 'debit' => 'sometimes|numeric|min:0', 'credit' => 'sometimes|numeric|min:0',
            'cost_center_id' => 'sometimes|nullable|uuid', 'brand_id' => 'sometimes|nullable|uuid', 'description' => 'sometimes|nullable|string|max:300']);

        return response()->json(A::cambiarLinea($lineId, $d, $r->user()));
    }

    public function anular(Request $r, string $id)
    {
        $d = $r->validate(['reason' => 'required|string|min:5|max:255']);

        return response()->json(A::anular($id, $d['reason'], $r->user()));
    }

    public function reversar(Request $r, string $id)
    {
        $d = $r->validate(['reason' => 'required|string|min:5|max:255']);

        return response()->json(A::reversar($id, $d['reason'], $r->user()), 201);
    }

    public function sinAsiento(Request $r)
    {
        $p = substr((string) ($r->query('period') ?: A::hoy()), 0, 7).'-01';
        $docs = A::sinAsiento($p, self::empresa($r));

        return response()->json(['period' => $p, 'count' => $docs->count(), 'data' => $docs->take(200)->values()]);
    }

    public function generarPendientes(Request $r)
    {
        $d = $r->validate(['period' => 'required|date', 'company_id' => 'nullable|uuid']);

        return response()->json(A::generarPendientes(substr($d['period'], 0, 7).'-01', $d['company_id'] ?? self::empresa($r), $r->user()));
    }

    /* ---------------- CNT-05 bandeja */

    public function bandeja(Request $r)
    {
        $emp = self::empresa($r);
        $q = DB::table('accountant_inbox_items as i')->leftJoin('users as c', 'c.id', '=', 'i.classified_by')->leftJoin('users as s', 's.id', '=', 'i.assigned_to')
            ->leftJoin('journal_entries as e', 'e.id', '=', 'i.entry_id')->where('i.company_id', $emp)
            ->when($r->query('status', 'OPEN'), fn ($x, $v) => $v === 'OPEN' ? $x->whereIn('i.status', B::ABIERTOS) : ($v === 'ALL' ? $x : $x->where('i.status', $v)))
            ->when($r->query('reason'), fn ($x, $v) => $x->where('i.reason', $v))
            ->when($r->query('period'), fn ($x, $v) => $x->where('i.period', substr($v, 0, 7).'-01'))
            ->when($r->boolean('mine'), fn ($x) => $x->where('i.assigned_to', $r->user()->id))
            ->selectRaw("i.id, i.period, i.source_type, i.source_id, i.reason, i.missing, i.status, i.ref_label, i.amount, i.notes, i.entry_id, i.created_at, i.classified_by, i.classified_at,
                i.returned_reason, c.name as classified_by_name, s.name as assigned_to_name, e.number as entry_number, extract(day from now() - i.created_at)::int as age_days");
        $p = Listado::de(DB::query()->fromSub($q, 'd'), $r, buscar: ['ref_label', 'notes'], ordenar: ['created_at', 'amount', 'reason', 'status'], porDefecto: 'created_at');
        $p->getCollection()->transform(function ($x) {
            $x->missing = json_decode($x->missing ?: '[]', true) ?: [];
            $x->reason_label = B::MOTIVOS[$x->reason] ?? $x->reason;

            return $x;
        });
        $res = $p->toArray();
        $res['by_reason'] = DB::table('accountant_inbox_items')->where('company_id', $emp)->whereIn('status', B::ABIERTOS)->groupBy('reason')->selectRaw('reason, count(*) as items')->pluck('items', 'reason');
        $res['reasons'] = B::MOTIVOS;

        return response()->json($res);
    }

    public function item(Request $r, string $id)
    {
        $it = B::ver($id);
        $u = $r->user();
        $it->can = ['classify' => \App\Support\Access::can($u, 'cnt.entry.prepare') && in_array($it->status, ['PENDING', 'RETURNED'], true),
            'approve' => \App\Support\Access::can($u, 'cnt.entry.approve') && $it->classified_by !== $u->id && in_array($it->status, ['PENDING', 'CLASSIFIED'], true),
            'return' => \App\Support\Access::can($u, 'cnt.entry.approve') && $it->status === 'CLASSIFIED'];

        return response()->json($it);
    }

    public function clasificar(Request $r, string $id)
    {
        $d = $r->validate(['account_code' => 'nullable|string|max:10', 'cost_center_id' => 'nullable|uuid', 'brand_id' => 'nullable|uuid', 'note' => 'nullable|string|max:500',
            'remember' => 'nullable|boolean', 'action' => 'nullable|string|max:30']);

        return response()->json(B::clasificar($id, $d, $r->user()));
    }

    public function aprobarItem(Request $r, string $id)
    {
        $d = $r->validate(['note' => 'nullable|string|max:500']);

        return response()->json(B::aprobar($id, $r->user(), $d['note'] ?? null));
    }

    public function devolverItem(Request $r, string $id)
    {
        $d = $r->validate(['reason' => 'required|string|min:5|max:300']);

        return response()->json(B::devolver($id, $d['reason'], $r->user()));
    }

    public function asignarItem(Request $r, string $id)
    {
        $d = $r->validate(['user_id' => 'nullable|uuid']);

        return response()->json(B::asignar($id, $d['user_id'] ?? null, $r->user()));
    }
}
