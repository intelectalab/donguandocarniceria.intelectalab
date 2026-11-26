<?php

namespace App\Modulos\B2b\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\B2b\Services\Cobranza;
use App\Modulos\B2b\Services\Credito;
use App\Modulos\B2b\Services\Pedidos;
use App\Modulos\B2b\Services\Portal;
use App\Modulos\B2b\Services\PreciosCliente;
use App\Modulos\Canales\Soporte as S;
use App\Support\Access;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** B2B-01 clientes, B2B-02 ficha de crédito, B2B-03 precios del cliente y B2B-04 excepciones de crédito. */
class ClienteController extends Controller
{
    public const PERMISOS = ['b2b.credit.manage', 'b2b.exception.request', 'b2b.exception.approve', 'b2b.price.manage', 'b2b.price.approve_below_margin',
        'b2b.recurring.manage', 'b2b.collection.manage', 'b2b.claim.resolve', 'b2b.portal.manage_users', 'b2b.portal.access'];

    private function clientes()
    {
        return DB::table('customers as c')->leftJoin('customer_credit_profiles as f', 'f.customer_id', '=', 'c.id')
            ->where(fn ($q) => $q->whereIn('c.customer_type', Credito::TIPOS)->orWhereNotNull('f.id'))->where('c.status', '<>', 'INACTIVE');
    }

    public function opciones(Request $r)
    {
        $u = $r->user();

        return response()->json([
            'customers' => $this->clientes()->orderBy('c.full_name')->get(['c.id', 'c.full_name', 'c.doc_type', 'c.doc_number', 'c.customer_type', DB::raw('f.id IS NOT NULL AS has_credit')]),
            'sellers' => DB::table('users as u')->join('user_roles as ur', 'ur.user_id', '=', 'u.id')->join('roles as ro', 'ro.id', '=', 'ur.role_id')
                ->whereIn('ro.code', ['VENDEDORA', 'SUPERVISORA_VENTAS'])->where('u.status', 'ACTIVE')->distinct()->orderBy('u.name')->get(['u.id', 'u.name']),
            'brands' => DB::table('brands')->where('status', 'ACTIVE')->orderBy('sort_order')->get(['id', 'name']),
            'zones' => DB::table('delivery_zones')->where('status', 'ACTIVE')->orderBy('name')->get(['id', 'name']),
            'variants' => DB::table('product_variants')->where('status', 'ACTIVE')->where('sellable', true)->orderBy('name')->get(['id', 'name', 'sku', 'sale_mode', 'brand_id', 'nominal_weight_kg']),
            'params' => [
                'grace_days' => (int) S::num('b2b_grace_days', 5), 'min_margin_pct' => S::num('b2b_min_margin_pct', 10), 'exception_hours' => (int) S::num('b2b_exception_valid_hours', 48),
                'cutoff' => S::texto('b2b_cutoff_time', '16:00'), 'min_order' => S::num('b2b_min_order_amount', 150), 'run_time' => S::texto('b2b_recurring_run_time', '18:00'),
                'lead_days' => (int) S::num('b2b_recurring_lead_days', 1), 'reminder_days_before' => (int) S::num('b2b_reminder_days_before', 3),
                'claim_hours' => (int) S::num('b2b_claim_response_hours', 48),
            ],
            'can' => collect(self::PERMISOS)->mapWithKeys(fn ($p) => [$p => Access::can($u, $p)]),
            'today' => S::fecha(), 'me' => $u->id,
        ]);
    }

    /** B2B-01 */
    public function index(Request $r)
    {
        $hoy = S::fecha();
        $filas = $this->clientes()
            ->when($r->query('type'), fn ($q, $v) => $q->where('c.customer_type', $v))
            ->when($r->query('seller_id'), fn ($q, $v) => $q->where(fn ($w) => $w->where('f.seller_user_id', $v)->orWhere('c.seller_user_id', $v)))
            ->when($r->query('q'), fn ($q, $v) => $q->where(fn ($w) => $w->where('c.full_name', 'ilike', "%{$v}%")->orWhere('c.doc_number', 'like', "%{$v}%")))
            ->orderBy('c.full_name')
            ->get(['c.id', 'c.full_name', 'c.trade_name', 'c.doc_number', 'c.customer_type', 'c.segment_brands', DB::raw('coalesce(f.seller_user_id, c.seller_user_id) AS seller_id')])
            ->map(function ($c) use ($hoy) {
                $s = Credito::resumen($c->id);
                $zona = DB::table('customer_addresses')->where('customer_id', $c->id)->where('status', 'ACTIVE')->orderByDesc('is_default')->value('zone_id');
                $c->zone_id = $zona;
                $c->seller_name = S::nombre($c->seller_id);
                $c->age = $s['overdue_days'] > 0 ? Cobranza::tramo($s['overdue_days']) : 'Por vencer';
                $c->brands = json_decode($c->segment_brands ?? '[]', true) ?: [];
                unset($c->segment_brands);

                return (object) ((array) $c + $s);
            })
            ->when($r->query('status'), fn ($c, $v) => $c->filter(fn ($x) => $x->status === $v))
            ->when($r->query('zone_id'), fn ($c, $v) => $c->filter(fn ($x) => $x->zone_id === $v))
            ->when($r->query('age'), fn ($c, $v) => $c->filter(fn ($x) => $x->age === $v && $x->balance > 0))
            ->when($r->query('brand_id'), fn ($c, $v) => $c->filter(fn ($x) => in_array($v, $x->brands, true) || $x->customer_type === 'CONSIGNMENT_POINT'))
            ->values();
        $conCredito = $filas->filter(fn ($x) => $x->credit_limit !== null);

        return response()->json(['data' => $filas, 'summary' => [
            'customers' => $filas->count(), 'with_credit' => $conCredito->count(), 'balance' => S::r($filas->sum('balance')),
            'overdue' => S::r($filas->sum('overdue')), 'blocked' => $filas->where('status', 'BLOCKED')->count(),
        ], 'buckets' => Cobranza::TRAMOS]);
    }

    /** B2B-02 */
    public function show(string $id)
    {
        $c = DB::table('customers')->where('id', $id)->first(['id', 'full_name', 'trade_name', 'doc_type', 'doc_number', 'customer_type', 'phone', 'email', 'seller_user_id']) ?? abort(404);
        $f = Credito::ficha($id);
        if ($f) {
            $f->history = array_reverse(json_decode($f->history ?? '[]', true) ?: []);
            $f->seller_name = S::nombre($f->seller_user_id);
        }
        $prom = DB::table('payment_promises')->where('customer_id', $id)->selectRaw("count(*) FILTER (WHERE status = 'KEPT') AS kept, count(*) FILTER (WHERE status = 'BROKEN') AS broken, count(*) FILTER (WHERE status = 'OPEN') AS open")->first();

        return response()->json([
            'customer' => $c, 'profile' => $f, 'summary' => Credito::resumen($id), 'promises' => $prom,
            'eligible' => $c->doc_type === 'RUC' && preg_match('/^(10|15|17|20)\d{9}$/', (string) $c->doc_number) === 1 && in_array($c->customer_type, Credito::TIPOS, true),
            'open_documents' => Credito::abiertos($id)->values(),
            'exceptions' => DB::table('credit_exceptions as x')->join('sales_orders as o', 'o.id', '=', 'x.order_id')->where('x.customer_id', $id)
                ->orderByDesc('x.created_at')->limit(10)->get(['x.*', 'o.number as order_number'])->map(fn ($x) => tap($x, fn ($x) => $x->state = Credito::estadoExcepcion($x))),
            'portal_users' => count(Portal::usuarios($id)),
        ]);
    }

    public function guardarFicha(Request $r, string $id)
    {
        $d = $r->validate(['credit_limit' => 'required|numeric|min:0', 'term_days' => 'required|integer|min:0|max:120', 'grace_days' => 'nullable|integer|min:0|max:60',
            'block_on_overdue' => 'nullable|boolean', 'review_on' => 'nullable|date', 'seller_user_id' => 'nullable|uuid', 'reason' => 'nullable|string|max:255']);

        return response()->json(Credito::guardarFicha($id, $d, $d['reason'] ?? null, $r->user()));
    }

    public function bloquear(Request $r, string $id)
    {
        $d = $r->validate(['reason' => 'nullable|string|max:255', 'unblock' => 'nullable|boolean']);

        return response()->json(! empty($d['unblock']) ? Credito::desbloquear($id, $d['reason'] ?? null, $r->user()) : Credito::bloquear($id, $d['reason'] ?? null, $r->user()));
    }

    /** B2B-03 */
    public function precios(Request $r, string $id)
    {
        $hoy = S::fecha();
        $rows = DB::table('customer_prices as p')->join('product_variants as v', 'v.id', '=', 'p.variant_id')->where('p.customer_id', $id)
            ->orderByRaw("CASE p.status WHEN 'PENDING_APPROVAL' THEN 0 WHEN 'ACTIVE' THEN 1 ELSE 2 END")->orderBy('v.name')->orderByDesc('p.valid_from')
            ->get(['p.*', 'v.name as variant_name', 'v.sku', 'v.sale_mode'])
            ->map(function ($p) use ($id, $hoy) {
                $l = PreciosCliente::deLista($id, $p->variant_id, $hoy);
                $p->list_price = $l['price'] ?? null;
                $p->cost = PreciosCliente::costo($p->variant_id);
                $p->margin_pct = $p->cost > 0 ? S::r(((float) $p->unit_price - $p->cost) / (float) $p->unit_price * 100, 1) : null;
                $p->vs_list_pct = $p->list_price ? S::r(((float) $p->unit_price - $p->list_price) / $p->list_price * 100, 1) : null;
                $p->current = $p->status === 'ACTIVE' && $p->valid_from <= $hoy && (! $p->valid_to || $p->valid_to >= $hoy);
                $p->requested_name = S::nombre($p->requested_by);
                $p->approved_name = S::nombre($p->below_margin_approved_by);

                return $p;
            });

        return response()->json(['data' => $rows, 'customer' => DB::table('customers')->where('id', $id)->first(['id', 'full_name', 'customer_type'])]);
    }

    /** Precios bajo margen por aprobar, de todos los clientes. */
    public function preciosPorAprobar()
    {
        return response()->json(DB::table('customer_prices as p')->join('product_variants as v', 'v.id', '=', 'p.variant_id')->join('customers as c', 'c.id', '=', 'p.customer_id')
            ->where('p.status', 'PENDING_APPROVAL')->orderBy('p.created_at')->get(['p.*', 'v.name as variant_name', 'c.full_name as customer_name'])
            ->map(fn ($p) => tap($p, fn ($p) => $p->requested_name = S::nombre($p->requested_by))));
    }

    public function referenciaPrecio(Request $r, string $id)
    {
        $v = $r->validate(['variant_id' => 'required|uuid'])['variant_id'];
        $l = PreciosCliente::deLista($id, $v);

        return response()->json(['list_price' => $l['price'] ?? null, 'basis' => $l['basis'] ?? null, 'cost' => PreciosCliente::costo($v), 'min_price' => PreciosCliente::minimo($v)]);
    }

    public function guardarPrecio(Request $r, string $id)
    {
        $d = $r->validate(['variant_id' => 'required|uuid', 'unit_price' => 'required|numeric|gt:0', 'price_basis' => 'nullable|in:UNIT,KG',
            'valid_from' => 'required|date', 'valid_to' => 'nullable|date', 'notes' => 'nullable|string|max:500']);

        return response()->json(PreciosCliente::guardar($d + ['customer_id' => $id], $r->user()), 201);
    }

    public function decidirPrecio(Request $r, string $id)
    {
        $d = $r->validate(['approve' => 'required|boolean', 'note' => 'nullable|string|max:500']);

        return response()->json(PreciosCliente::decidir($id, $d['approve'], $d['note'] ?? null, $r->user()));
    }

    public function cerrarPrecio(Request $r, string $id)
    {
        $d = $r->validate(['valid_to' => 'required|date']);

        return response()->json(PreciosCliente::cerrar($id, $d['valid_to'], $r->user()));
    }

    /** B2B-04: bandeja de excepciones y pedidos a crédito retenidos que pueden pedirla. */
    public function excepciones(Request $r)
    {
        $rows = DB::table('credit_exceptions as x')->join('sales_orders as o', 'o.id', '=', 'x.order_id')->join('customers as c', 'c.id', '=', 'x.customer_id')
            ->when($r->query('customer_id'), fn ($q, $v) => $q->where('x.customer_id', $v))
            ->orderByRaw("CASE x.status WHEN 'PENDING' THEN 0 WHEN 'APPROVED' THEN 1 ELSE 2 END")->orderByDesc('x.created_at')->limit(200)
            ->get(['x.*', 'o.number as order_number', 'o.status as order_status', 'o.delivery_date', 'c.full_name as customer_name'])
            ->map(function ($x) {
                $x->state = Credito::estadoExcepcion($x);
                $x->requested_name = S::nombre($x->requested_by);
                $x->decided_name = S::nombre($x->decided_by);

                return $x;
            })
            ->when($r->query('status'), fn ($c, $v) => $c->filter(fn ($x) => $x->state === $v))->values();
        $credito = Credito::metodoCredito();
        $retenidos = DB::table('sales_orders as o')->join('customers as c', 'c.id', '=', 'o.customer_id')->where('o.channel', 'B2B')->where('o.status', 'DRAFT')
            ->where('o.payment_method_id', $credito)
            ->whereNotExists(fn ($q) => $q->from('credit_exceptions as x')->whereColumn('x.order_id', 'o.id')->whereIn('x.status', ['PENDING', 'APPROVED']))
            ->orderBy('o.delivery_date')->get(['o.*', 'c.full_name as customer_name'])
            ->map(function ($o) {
                $chk = Credito::revisar($o);

                return ['id' => $o->id, 'number' => $o->number, 'customer_id' => $o->customer_id, 'customer_name' => $o->customer_name, 'delivery_date' => $o->delivery_date,
                    'amount' => (float) ($o->final_total ?? $o->estimated_total), 'ok' => $chk['ok'], 'message' => $chk['message'] ?? null, 'exceeded' => $chk['exceeded'] ?? null,
                    'missing' => Pedidos::faltantes($o)];
            })->values();

        return response()->json(['data' => $rows, 'held_orders' => $retenidos]);
    }

    public function solicitarExcepcion(Request $r)
    {
        $d = $r->validate(['order_id' => 'required|uuid', 'reason' => 'nullable|string|max:500']);

        return response()->json(Credito::solicitarExcepcion($d['order_id'], $d['reason'] ?? null, $r->user()), 201);
    }

    public function decidirExcepcion(Request $r, string $id)
    {
        $d = $r->validate(['approve' => 'required|boolean', 'note' => 'nullable|string|max:500']);

        return response()->json(Credito::decidirExcepcion($id, $d['approve'], $d['note'] ?? null, $r->user()));
    }

    /** Confirma un pedido B2B en borrador pasando el control de crédito (lo usa la bandeja de excepciones). */
    public function confirmarPedido(Request $r, string $id)
    {
        return response()->json(Credito::confirmar($id, $r->user()));
    }
}
