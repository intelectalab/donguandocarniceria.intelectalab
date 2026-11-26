<?php

namespace App\Modulos\Com\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Com\Services\IndicadoresService as I;
use App\Modulos\Com\Services\OrdenesService as O;
use App\Modulos\Com\Services\PagosService as P;
use App\Modulos\Com\Services\Soporte as C;
use App\Support\Access;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** Opciones de los formularios de COM, cifras de cabecera, COM-11 Evaluación y COM-12 Tablero. */
class PantallaController extends Controller
{
    public function opciones(Request $r)
    {
        $locales = Access::for($r->user())['establishments'];
        $marcas = Access::for($r->user())['brands'];
        $u = $r->user();

        return response()->json([
            'suppliers' => DB::table('suppliers')->orderByRaw("coalesce(nullif(trade_name, ''), legal_name)")
                ->get(['id', 'doc_type', 'doc_number', 'legal_name', 'trade_name', 'supplier_type', 'status', 'sunat_status', 'payment_terms_days', 'bank_account', 'default_cost_center_id'])
                ->map(function ($s) {
                    $s->name = $s->trade_name ?: $s->legal_name;
                    $s->can_order = $s->status === 'ACTIVE' && ! in_array($s->sunat_status, C::SUNAT_BLOQUEA, true);
                    $s->no_igv = O::sinIgv($s->id, C::hoy());

                    return $s;
                }),
            'warehouses' => DB::table('warehouses')->where('status', 'ACTIVE')->when($locales, fn ($q) => $q->where(fn ($y) => $y->whereIn('establishment_id', $locales)->orWhereNull('establishment_id')))
                ->orderBy('pick_priority')->orderBy('code')->get(['id', 'code', 'name', 'wh_type', 'establishment_id', 'max_temp_c']),
            'establishments' => DB::table('establishments')->when($locales, fn ($q) => $q->whereIn('id', $locales))->orderBy('name')->get(['id', 'name', 'short', 'company_id']),
            'brands' => DB::table('brands')->when($marcas, fn ($q) => $q->whereIn('id', $marcas))->orderBy('name')->get(['id', 'name']),
            'cost_centers' => DB::table('cost_centers')->where('status', 'ACTIVE')->orderBy('code')->get(['id', 'code', 'name', 'area', 'brand_id', 'establishment_id']),
            'cash_accounts' => DB::table('cash_accounts')->where('status', 'ACTIVE')->when($locales, fn ($q) => $q->where(fn ($y) => $y->whereIn('establishment_id', $locales)->orWhereNull('establishment_id')))
                ->orderBy('code')->get(['id', 'code', 'name', 'account_type', 'bank_name', 'currency']),
            'scales' => DB::table('equipment')->where('category', 'SCALE')->where('status', 'ACTIVE')->when($locales, fn ($q) => $q->whereIn('establishment_id', $locales))
                ->orderBy('code')->get(['id', 'code', 'name', 'establishment_id']),
            'companies' => DB::table('companies')->orderBy('legal_name')->get(['id', 'legal_name', 'ruc']),
            'lines' => DB::table('products')->whereNotNull('line')->distinct()->orderBy('line')->pluck('line'),
            'supplier_types' => C::TIPOS_PROVEEDOR,
            'doc_types' => collect(C::TIPOS_DOC)->map(fn ($v, $k) => ['code' => $k, 'name' => $v[0], 'sunat' => $v[1]])->values(),
            'methods' => C::METODOS,
            'params' => [
                'com_po_approval_threshold_pen' => C::param('com_po_approval_threshold_pen'), 'com_chilled_max_c' => C::param('com_chilled_max_c'),
                'com_frozen_max_c' => C::param('com_frozen_max_c'), 'com_over_receipt_tolerance_pct' => C::param('com_over_receipt_tolerance_pct'),
                'com_price_tolerance_pct' => C::param('com_price_tolerance_pct'), 'igv_rate' => C::igv(),
            ],
            'can' => [
                'order_create' => Access::can($u, 'com.order.create'), 'order_approve' => Access::can($u, 'com.order.approve'), 'receipt_record' => Access::can($u, 'com.receipt.record'),
                'document_record' => Access::can($u, 'com.document.record'), 'payment_record' => Access::can($u, 'com.payment.record'),
                'bank_change' => Access::can($u, 'com.supplier.bank_change'), 'approve_diff' => Access::module($u, 'COM', 'A') || Access::can($u, 'cnt.entry.approve'),
            ],
        ]);
    }

    /** Buscador de variantes (los usuarios de COM no siempre tienen ALM). */
    public function variantes(Request $r)
    {
        $t = '%'.mb_strtolower(trim((string) $r->query('q', ''))).'%';
        $q = DB::table('product_variants as v')->join('products as p', 'p.id', '=', 'v.product_id')->where('v.status', 'ACTIVE')
            ->when($r->query('id'), fn ($x, $id) => $x->where('v.id', $id))
            ->where(fn ($x) => $x->whereRaw('lower(v.sku) like ?', [$t])->orWhereRaw('lower(v.name) like ?', [$t]));

        return response()->json(['data' => $q->orderBy('v.sku')->limit(30)
            ->get(['v.id', 'v.sku', 'v.name', 'v.sale_mode', 'v.nominal_weight_kg', 'v.std_cost', 'v.brand_id', 'p.requires_lot', 'p.storage', 'p.line', 'p.shelf_life_days'])
            ->map(function ($v) {
                $v->price_basis = O::base($v->id);

                return $v;
            })]);
    }

    public function cifras(Request $r, string $pantalla)
    {
        $hoy = C::hoy();
        [$de, $a] = I::mes(null);
        $locales = Access::for($r->user())['establishments'];
        $local = fn ($q, $c) => $q->when($locales, fn ($x) => $x->where(fn ($y) => $y->whereIn($c, $locales)->orWhereNull($c)));
        $c = match ($pantalla) {
            '01' => [
                'active' => DB::table('suppliers')->where('status', 'ACTIVE')->count(),
                'blocked' => DB::table('suppliers')->whereIn('sunat_status', C::SUNAT_BLOQUEA)->count(),
                'bank_pending' => DB::table('suppliers')->whereNotNull('pending_bank_change')->count(),
                'farms' => DB::table('suppliers')->where('supplier_type', 'RELATED_FARM')->count(),
            ],
            '02' => [
                'items' => DB::table('supplier_catalog')->where('status', 'ACTIVE')->count(),
                'variants' => DB::table('supplier_catalog')->where('status', 'ACTIVE')->distinct()->count('variant_id'),
                'single_source' => DB::table('supplier_catalog')->where('status', 'ACTIVE')->groupBy('variant_id')->havingRaw('count(*) = 1')->select('variant_id')->get()->count(),
                'stale' => DB::table('supplier_catalog')->where('status', 'ACTIVE')->where(fn ($q) => $q->whereNull('updated_at')->orWhere('updated_at', '<', now()->subDays(60)))->count(),
            ],
            '03' => [
                'pending' => $local(DB::table('purchase_requisitions')->where('status', 'PENDING'), 'establishment_id')->count(),
                'due_soon' => $local(DB::table('purchase_requisitions')->where('status', 'PENDING')->where('needed_date', '<=', now('America/Lima')->addDays(2)->toDateString()), 'establishment_id')->count(),
                'ordered_month' => $local(DB::table('purchase_requisitions')->where('status', 'ORDERED')->whereBetween(DB::raw('requested_at::date'), [$de, $a]), 'establishment_id')->count(),
            ],
            '04', '05' => [
                'draft' => $local(DB::table('purchase_orders')->where('status', 'DRAFT'), 'establishment_id')->count(),
                'pending_approval' => $local(DB::table('purchase_orders')->where('status', 'PENDING_APPROVAL'), 'establishment_id')->count(),
                'pending_amount' => C::t($local(DB::table('purchase_orders')->where('status', 'PENDING_APPROVAL'), 'establishment_id')->sum('total')),
                'open' => $local(DB::table('purchase_orders')->whereIn('status', O::ABIERTAS), 'establishment_id')->count(),
                'late' => $local(DB::table('purchase_orders')->whereIn('status', O::ABIERTAS)->where('expected_date', '<', $hoy), 'establishment_id')->count(),
                'month_total' => C::t($local(DB::table('purchase_orders')->whereNotIn('status', ['DRAFT', 'VOIDED'])->whereBetween('order_date', [$de, $a]), 'establishment_id')->sum('total')),
                'threshold' => C::t(C::param('com_po_approval_threshold_pen')),
            ],
            '06' => [
                'today' => $local(DB::table('purchase_receipts')->where('status', 'POSTED')->whereRaw("(received_at AT TIME ZONE 'America/Lima')::date = ?", [$hoy]), 'establishment_id')->count(),
                'month' => $local(DB::table('purchase_receipts')->where('status', 'POSTED')->whereRaw("(received_at AT TIME ZONE 'America/Lima')::date BETWEEN ? AND ?", [$de, $a]), 'establishment_id')->count(),
                'kg_month' => C::t(DB::table('purchase_receipt_lines as l')->join('purchase_receipts as r', 'r.id', '=', 'l.receipt_id')->where('r.status', 'POSTED')->where('l.accepted', true)
                    ->whereRaw("(r.received_at AT TIME ZONE 'America/Lima')::date BETWEEN ? AND ?", [$de, $a])->when($locales, fn ($x) => $x->whereIn('r.establishment_id', $locales))->sum('l.weight_kg'), 1),
                'observed' => DB::table('purchase_receipt_lines as l')->join('purchase_receipts as r', 'r.id', '=', 'l.receipt_id')->where('r.status', 'POSTED')
                    ->where(fn ($q) => $q->where('l.accepted', false)->orWhere('l.quality_hold', true))
                    ->whereRaw("(r.received_at AT TIME ZONE 'America/Lima')::date BETWEEN ? AND ?", [$de, $a])->when($locales, fn ($x) => $x->whereIn('r.establishment_id', $locales))->count(),
                'open_orders' => $local(DB::table('purchase_orders')->whereIn('status', O::ABIERTAS), 'establishment_id')->count(),
            ],
            '07', '08' => [
                'month' => $local(DB::table('purchase_documents')->where('status', '<>', 'VOIDED')->whereBetween('accounting_date', [$de, $a]), 'establishment_id')->count(),
                'month_total' => C::t($local(DB::table('purchase_documents')->where('status', '<>', 'VOIDED')->whereBetween('accounting_date', [$de, $a]), 'establishment_id')
                    ->sum(DB::raw('total * exchange_rate'))),
                'observed' => $local(DB::table('purchase_documents')->where('match_status', 'OBSERVED')->where('status', '<>', 'VOIDED'), 'establishment_id')->count(),
                'approved_diff' => $local(DB::table('purchase_documents')->where('match_status', 'APPROVED_DIFF')->whereBetween('accounting_date', [$de, $a]), 'establishment_id')->count(),
                'receipts_without_doc' => $local(DB::table('purchase_receipts as r')->where('r.status', 'POSTED')->where('r.receipt_type', 'PURCHASE')->whereNull('r.document_id')
                    ->whereNotExists(fn ($e) => $e->from('purchase_document_lines as dl')->join('purchase_receipt_lines as rl', 'rl.id', '=', 'dl.receipt_line_id')->whereColumn('rl.receipt_id', 'r.id')), 'r.establishment_id')->count(),
            ],
            '09', '10' => $this->c09($hoy, $de, $a),
            '11' => ['evaluated' => count(I::evaluacion($r->query('month')))],
            '12' => I::tablero($r->query('month'))['kpis'],
            default => abort(404),
        };

        return response()->json($c);
    }

    private function c09(string $hoy, string $de, string $a): array
    {
        $docs = P::porPagar();

        return [
            'payable' => C::t($docs->sum(fn ($d) => (float) $d->balance_pen)),
            'overdue' => C::t($docs->where('bucket', '<>', 'NOT_DUE')->sum(fn ($d) => (float) $d->balance_pen)),
            'due_7' => C::t($docs->filter(fn ($d) => $d->due_date && $d->due_date >= $hoy && $d->due_date <= now('America/Lima')->addDays(7)->toDateString())->sum(fn ($d) => (float) $d->balance_pen)),
            'scheduled' => C::t($docs->whereNotNull('scheduled_pay_date')->sum(fn ($d) => (float) $d->balance_pen)),
            'paid_month' => C::t(DB::table('supplier_payments')->where('status', 'CONFIRMED')->whereRaw("(paid_at AT TIME ZONE 'America/Lima')::date BETWEEN ? AND ?", [$de, $a])->sum('amount')),
            'payments_month' => DB::table('supplier_payments')->where('status', 'CONFIRMED')->whereRaw("(paid_at AT TIME ZONE 'America/Lima')::date BETWEEN ? AND ?", [$de, $a])->count(),
        ];
    }

    public function evaluacion(Request $r)
    {
        [$de, $a] = I::mes($r->query('month'));

        return response()->json(['month' => substr($de, 0, 7), 'from' => $de, 'to' => $a, 'data' => I::evaluacion($r->query('month'))]);
    }

    public function fijarCalificaciones(Request $r)
    {
        $d = $r->validate(['month' => 'nullable|date_format:Y-m']);

        return response()->json(['updated' => I::fijarCalificaciones($d['month'] ?? null)]);
    }

    public function tablero(Request $r)
    {
        return response()->json(I::tablero($r->query('month')));
    }
}
