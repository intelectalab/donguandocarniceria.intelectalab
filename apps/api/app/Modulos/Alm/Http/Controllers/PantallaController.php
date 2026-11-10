<?php

namespace App\Modulos\Alm\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Alm\Services\AlertasService;
use App\Modulos\Alm\Services\KpiService;
use App\Modulos\Alm\Services\ReservasService;
use App\Modulos\Alm\Services\Soporte as S;
use App\Support\Access;
use App\Support\Listado;
use App\Support\Params;
use App\Support\RuleError;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Datos de apoyo de las pantallas de ALM: las cifras de arriba de cada pantalla, las fichas
 * (almacén, saldo, movimiento, pedido), el historial de estados de lotes, el saldo en tránsito,
 * los pedidos con faltante y el aviso de promoción. Solo lee, salvo reintentar y promoción.
 */
class PantallaController extends Controller
{
    use Alcance;

    /** Cifras de la cabecera de una pantalla (01 a 13). Los montos van vacíos sin alm.stock.view_cost. */
    public function cifras(Request $r, string $pantalla)
    {
        $c = match ($pantalla) {
            '01' => $this->c01($r), '03' => $this->c03($r), '04' => $this->c04($r), '05' => $this->c05($r), '07' => $this->c07($r),
            '08' => $this->c08($r), '09' => $this->c09($r), '10' => $this->c10($r), '12' => $this->c12($r), '13' => $this->c13(),
            default => abort(404),
        };

        return response()->json($c);
    }

    private function dinero(Request $r, mixed $v): ?string
    {
        return $this->verCostos($r) ? S::t($v, 2) : null;
    }

    private function kpi(Request $r): array
    {
        $site = $r->query('site');
        $brand = $r->query('brand');

        return KpiService::todos([
            'establishment_id' => $site && $site !== 'ALL' ? $site : null, 'brand_id' => $brand && $brand !== 'ALL' ? $brand : null,
        ]);
    }

    private function mes(): array
    {
        return [S::hoy()->startOfMonth(), S::ahora()];
    }

    private function c01(Request $r): array
    {
        $q = DB::table('warehouses as w')->where('w.status', 'ACTIVE');
        $this->porLocal($q, $r, 'w.establishment_id');
        $ws = $q->get(['w.id', 'w.wh_type', 'w.allows_sale']);
        $temps = $this->ultimasTemperaturas($ws->pluck('id')->all());
        $valor = DB::table('stock_balances')->whereIn('warehouse_id', $ws->pluck('id'))->where('qty', '>', 0)->sum(DB::raw('qty * avg_cost'));

        return [
            'active' => $ws->count(), 'selling' => $ws->where('allows_sale', true)->count(),
            'cold' => $ws->whereIn('wh_type', ['COLD_ROOM', 'FREEZER'])->count(),
            'out_of_range' => collect($temps)->where('out_of_range', true)->count(), 'with_readings' => count($temps),
            'value' => $this->dinero($r, $valor),
        ];
    }

    private function c03(Request $r): array
    {
        [$ini] = $this->mes();
        $q = DB::table('stock_movements as m')->join('warehouses as w', 'w.id', '=', 'm.warehouse_id')->join('product_variants as v', 'v.id', '=', 'm.variant_id');
        $this->porLocal($q, $r, 'w.establishment_id');
        $this->porMarca($q, $r, 'v.brand_id');
        $hoy = S::hoy();
        $t = $q->selectRaw("count(*) total,
            count(*) filter (where m.moved_at >= ? and m.qty > 0) in_today, count(*) filter (where m.moved_at >= ? and m.qty < 0) out_today,
            coalesce(-sum(m.total_cost) filter (where m.movement_type = 'WASTE' and m.moved_at >= ?), 0) waste_month,
            count(*) filter (where m.movement_type = 'WASTE' and m.moved_at >= ?) waste_count,
            count(*) filter (where m.movement_type = 'ADJUSTMENT' and m.moved_at >= ?) adjust_count,
            coalesce(sum(m.total_cost) filter (where m.movement_type = 'ADJUSTMENT' and m.moved_at >= ?), 0) adjust_month",
            [$hoy, $hoy, $ini, $ini, $ini, $ini])->first();

        return [
            'total' => (int) $t->total, 'in_today' => (int) $t->in_today, 'out_today' => (int) $t->out_today,
            'waste_month' => $this->dinero($r, $t->waste_month), 'waste_count' => (int) $t->waste_count,
            'adjust_month' => $this->dinero($r, $t->adjust_month), 'adjust_count' => (int) $t->adjust_count,
        ];
    }

    private function c04(Request $r): array
    {
        [$ini] = $this->mes();
        $q = DB::table('stock_receipts as r');
        $this->porLocal($q, $r, 'r.establishment_id');
        $t = $q->selectRaw("count(*) filter (where r.received_at >= ? and r.status = 'CONFIRMED') mes, count(*) filter (where r.status = 'DRAFT') drafts", [$ini])->first();
        $k = $this->kpi($r)['KPI-ALM-06'];

        return [
            'month' => (int) $t->mes, 'drafts' => (int) $t->drafts, 'observed_pct' => $k['value'], 'observed' => $k['numerator'], 'lines' => $k['denominator'],
            'max_chilled' => (float) (Params::get('alm_max_temp_chilled_c') ?? 4), 'max_frozen' => (float) (Params::get('alm_max_temp_frozen_c') ?? -18),
        ];
    }

    private function c05(Request $r): array
    {
        $hoy = S::hoy()->toDateString();
        $q = DB::table('lots as l')->join('product_variants as v', 'v.id', '=', 'l.variant_id')
            ->whereExists(fn ($e) => $e->from('stock_balances as b')->whereColumn('b.lot_id', 'l.id')->where('b.qty', '>', 0));
        $this->porMarca($q, $r, 'v.brand_id');
        $t = $q->selectRaw("count(*) total, count(*) filter (where l.qc_status = 'QUARANTINE') quarantine,
            count(*) filter (where l.qc_status = 'BLOCKED') blocked, count(*) filter (where l.expiry_date - ?::date between 0 and 7) expiring,
            count(*) filter (where l.expiry_date < ?::date) expired", [$hoy, $hoy])->first();

        return ['with_stock' => (int) $t->total, 'quarantine' => (int) $t->quarantine, 'blocked' => (int) $t->blocked, 'expiring' => (int) $t->expiring, 'expired' => (int) $t->expired];
    }

    private function c07(Request $r): array
    {
        [$ini] = $this->mes();
        $locales = Access::for($r->user())['establishments'];
        $site = $r->query('site');
        $t = DB::table('stock_transfers as t')
            ->when($locales, fn ($x) => $x->where(fn ($y) => $y->whereIn('t.from_site', $locales)->orWhereIn('t.to_site', $locales)))
            ->when($site && $site !== 'ALL', fn ($x) => $x->where(fn ($y) => $y->where('t.from_site', $site)->orWhere('t.to_site', $site)))
            ->selectRaw("count(*) filter (where t.status = 'DRAFT') draft, count(*) filter (where t.status = 'DISPATCHED') dispatched,
                count(*) filter (where t.status = 'RECEIVED_WITH_DIFF') with_diff, count(*) filter (where t.guide_number is not null and t.guide_issued_at >= ?) guides,
                count(*) filter (where t.status = 'DRAFT' and t.requires_guide and t.guide_number is null) need_guide", [$ini])->first();

        return ['draft' => (int) $t->draft, 'dispatched' => (int) $t->dispatched, 'with_diff' => (int) $t->with_diff, 'guides_month' => (int) $t->guides, 'need_guide' => (int) $t->need_guide];
    }

    private function c08(Request $r): array
    {
        [$ini] = $this->mes();
        $q = DB::table('stock_counts as c');
        $this->porLocal($q, $r, 'c.establishment_id');
        $t = $q->selectRaw("count(*) filter (where c.status = 'OPEN') open, count(*) filter (where c.status = 'COUNTED') counted,
            count(*) filter (where c.status = 'APPROVED' and c.approved_at >= ?) approved_month", [$ini])->first();
        $aj = DB::table('stock_movements as m')->join('warehouses as w', 'w.id', '=', 'm.warehouse_id')->where('m.movement_type', 'ADJUSTMENT')
            ->where('m.source_type', 'STOCK_COUNT')->where('m.moved_at', '>=', $ini);
        $this->porLocal($aj, $r, 'w.establishment_id');
        $aj = $aj->selectRaw('count(*) n, coalesce(sum(m.total_cost), 0) v')->first();
        $k = $this->kpi($r)['KPI-ALM-05'];

        return ['open' => (int) $t->open, 'to_approve' => (int) $t->counted, 'approved_month' => (int) $t->approved_month,
            'accuracy' => $k['value'], 'exact_lines' => $k['numerator'], 'counted_lines' => $k['denominator'],
            'adjust_count' => (int) $aj->n, 'adjust_value' => $this->dinero($r, $aj->v)];
    }

    private function c09(Request $r): array
    {
        [$ini] = $this->mes();
        $q = fn () => tap(DB::table('stock_waste_records as m')->join('product_variants as v', 'v.id', '=', 'm.variant_id')->join('waste_reasons as wr', 'wr.id', '=', 'm.reason_id'),
            fn ($x) => $this->porMarca($this->porLocal($x, $r, 'm.establishment_id'), $r, 'v.brand_id'));
        $t = $q()->selectRaw("count(*) filter (where m.status = 'PENDING') pending, coalesce(sum(m.estimated_cost) filter (where m.status = 'PENDING'), 0) pending_value,
            count(*) filter (where m.status = 'APPROVED' and coalesce(m.approved_at, m.requested_at) >= ?) mes,
            coalesce(sum(coalesce(m.actual_cost, m.estimated_cost)) filter (where m.status = 'APPROVED' and coalesce(m.approved_at, m.requested_at) >= ?), 0) month_value", [$ini, $ini])->first();
        $k = $this->kpi($r);
        $porMotivo = $q()->where('m.status', 'APPROVED')->where(DB::raw('coalesce(m.approved_at, m.requested_at)'), '>=', $ini)->groupBy('wr.name')
            ->selectRaw('wr.name as label, round(sum(coalesce(m.actual_cost, m.estimated_cost)), 2) as value, count(*) as n')->orderByDesc('value')->get();
        if (! $this->verCostos($r)) {
            $porMotivo->each(fn ($x) => $x->value = null);
        }

        return ['pending' => (int) $t->pending, 'pending_value' => $this->dinero($r, $t->pending_value), 'month' => (int) $t->mes,
            'month_value' => $this->dinero($r, $t->month_value), 'waste_pct' => $k['KPI-ALM-02']['value'], 'expired_value' => $this->dinero($r, $k['KPI-ALM-03']['value']),
            'by_reason' => $porMotivo];
    }

    private function c10(Request $r): array
    {
        $q = DB::table('stock_reservations as r')->join('stock_balances as b', 'b.id', '=', 'r.balance_id')->where('r.status', 'ACTIVE');
        $this->porLocal($q, $r, 'r.establishment_id');
        $this->porMarca($q, $r, 'r.brand_id');
        $t = $q->selectRaw('count(distinct r.order_id) orders, count(*) lines, coalesce(sum(r.qty * b.avg_cost), 0) value')->first();
        $k = $this->kpi($r)['KPI-ALM-07'];

        return ['orders' => (int) $t->orders, 'lines' => (int) $t->lines, 'value' => $this->dinero($r, $t->value),
            'short_orders' => count($this->faltantesDe($r)), 'stockout_pct' => $k['value'], 'stockout_orders' => $k['numerator'], 'confirmed_orders' => $k['denominator']];
    }

    private function c12(Request $r): array
    {
        $tr = DB::table('stock_transfers')->where('status', 'DISPATCHED')->selectRaw('count(*) n, max(extract(epoch from (now() - dispatched_at)) / 3600) h')->first();
        $b = DB::table('stock_balances as b')->join('warehouses as w', 'w.id', '=', 'b.warehouse_id')->where('w.wh_type', 'TRANSIT')->where('b.qty', '>', S::EPS)
            ->selectRaw('coalesce(sum(b.qty * b.avg_cost), 0) v, count(distinct b.lot_id) lots')->first();

        return ['transfers' => (int) $tr->n, 'oldest_hours' => $tr->h === null ? null : round((float) $tr->h, 1), 'value' => $this->dinero($r, $b->v), 'lots' => (int) $b->lots];
    }

    private function c13(): array
    {
        $t = DB::table('waste_reasons')->selectRaw("count(*) filter (where status = 'ACTIVE') active, count(*) filter (where status = 'ACTIVE' and requires_photo) photo,
            count(*) filter (where status = 'ACTIVE' and counts_as_expired) expired")->first();
        $usos = DB::table('stock_waste_records')->groupBy('reason_id')->selectRaw('reason_id, count(*) n')->pluck('n', 'reason_id');

        return ['active' => (int) $t->active, 'photo' => (int) $t->photo, 'expired' => (int) $t->expired,
            'default_threshold' => (float) (Params::get('alm_waste_approval_pen') ?? 100), 'uses' => $usos];
    }

    /** Última lectura de temperatura de cada almacén (puntos de CAL ligados al almacén). Solo lectura. */
    private function ultimasTemperaturas(array $almacenes): array
    {
        if (! $almacenes) {
            return [];
        }
        $filas = DB::table('temperature_points as p')->whereIn('p.warehouse_id', $almacenes)
            ->joinSub(DB::table('temperature_readings')->selectRaw('distinct on (point_id) point_id, value_c, read_at, in_range')->orderBy('point_id')->orderByDesc('read_at'),
                't', 't.point_id', '=', 'p.id')
            ->get(['p.warehouse_id', 'p.min_c', 'p.max_c', 't.value_c', 't.read_at', 't.in_range']);
        $out = [];
        foreach ($filas->sortByDesc('read_at') as $f) {
            $out[$f->warehouse_id] ??= ['temp_c' => (float) $f->value_c, 'read_at' => $f->read_at,
                'out_of_range' => (float) $f->value_c < (float) $f->min_c || (float) $f->value_c > (float) $f->max_c];
        }

        return $out;
    }

    /** Temperaturas de todos los almacenes del usuario (para el árbol de ALM-01 y la pestaña de ALM-11). */
    public function temperaturas(Request $r)
    {
        $q = DB::table('warehouses as w')->where('w.status', 'ACTIVE');
        $this->porLocal($q, $r, 'w.establishment_id');
        $ws = $q->get(['w.id', 'w.code', 'w.name', 'w.wh_type', 'w.min_temp_c', 'w.max_temp_c']);
        $ultimas = $this->ultimasTemperaturas($ws->pluck('id')->all());
        $fuera = DB::table('temperature_readings as t')->join('temperature_points as p', 'p.id', '=', 't.point_id')->join('warehouses as w', 'w.id', '=', 'p.warehouse_id')
            ->whereIn('p.warehouse_id', $ws->pluck('id'))->whereRaw('(t.value_c < p.min_c or t.value_c > p.max_c)')
            ->orderByDesc('t.read_at')->limit(30)->get(['t.id', 't.read_at', 't.value_c', 't.source', 'p.min_c', 'p.max_c', 'w.id as warehouse_id', 'w.code as warehouse_code', 'w.name as warehouse_name']);
        $desde = now()->subDay();
        $fuera24 = $fuera->filter(fn ($x) => $x->read_at >= $desde)->countBy('warehouse_id');

        return response()->json([
            'warehouses' => $ws->filter(fn ($w) => $w->max_temp_c !== null || isset($ultimas[$w->id]))->map(fn ($w) => (array) $w + [
                'last' => $ultimas[$w->id] ?? null, 'out_24h' => (int) ($fuera24[$w->id] ?? 0),
            ])->values(),
            'out_of_range' => $fuera,
        ]);
    }

    /** Ficha de un almacén: datos, lotes, valor y sus lecturas de temperatura recientes (ALM-01). */
    public function almacen(Request $r, string $id)
    {
        $w = DB::table('warehouses as w')->leftJoin('establishments as e', 'e.id', '=', 'w.establishment_id')->leftJoin('warehouses as p', 'p.id', '=', 'w.parent_id')
            ->leftJoin('vehicles as ve', 've.id', '=', 'w.vehicle_id')->where('w.id', $id)
            ->first(['w.*', 'e.name as establishment_name', 'p.code as parent_code', 'p.name as parent_name', 've.plate as vehicle_plate']);
        abort_unless($w, 404);
        $this->dentroDelAlcance($r, $w->establishment_id);
        $s = DB::table('stock_balances')->where('warehouse_id', $id)->where('qty', '>', 0)
            ->selectRaw('count(*) saldos, count(distinct lot_id) lotes, count(distinct variant_id) variantes, coalesce(sum(qty * avg_cost), 0) valor')->first();
        $w->balances = (int) $s->saldos;
        $w->lots = (int) $s->lotes;
        $w->variants = (int) $s->variantes;
        $w->stock_value = $this->dinero($r, $s->valor);
        $w->readings = DB::table('temperature_readings as t')->join('temperature_points as p', 'p.id', '=', 't.point_id')->where('p.warehouse_id', $id)
            ->leftJoin('users as u', 'u.id', '=', 't.read_by')->orderByDesc('t.read_at')->limit(30)
            ->get(['t.id', 't.read_at', 't.value_c', 't.source', 'p.min_c', 'p.max_c', 'p.name as point_name', 'u.name as read_by_name'])
            ->map(function ($x) {
                $x->out_of_range = (float) $x->value_c < (float) $x->min_c || (float) $x->value_c > (float) $x->max_c;

                return $x;
            });
        $w->last_temp = $this->ultimasTemperaturas([$id])[$id] ?? null;

        return response()->json($w);
    }

    /** Ficha de un saldo (ALM-02): el saldo, para qué pedidos está reservado y su kardex. */
    public function saldo(Request $r, string $id)
    {
        $b = DB::table('stock_balances as b')->join('warehouses as w', 'w.id', '=', 'b.warehouse_id')->join('product_variants as v', 'v.id', '=', 'b.variant_id')
            ->join('products as p', 'p.id', '=', 'v.product_id')->leftJoin('lots as l', 'l.id', '=', 'b.lot_id')->leftJoin('brands as br', 'br.id', '=', 'v.brand_id')
            ->leftJoin('suppliers as s', 's.id', '=', 'l.supplier_id')->where('b.id', $id)
            ->first(['b.*', 'w.code as warehouse_code', 'w.name as warehouse_name', 'w.wh_type', 'w.allows_sale', 'v.sku', 'v.name as variant_name', 'v.sale_mode',
                'br.name as brand_name', 'p.line', 'p.storage', 'l.code as lot_code', 'l.qc_status', 'l.expiry_date', 'l.production_date', 's.trade_name as supplier_name',
                'w.establishment_id', 'v.brand_id']);
        abort_unless($b, 404);
        $this->dentroDelAlcance($r, $b->establishment_id, $b->brand_id);
        $b->days_left = S::diasDeVida($b->expiry_date);
        $b->available_qty = S::t(max(0, (float) $b->qty - (float) $b->reserved_qty));
        $b->value = $this->dinero($r, (float) $b->qty * (float) $b->avg_cost);
        if (! $this->verCostos($r)) {
            $b->avg_cost = null;
        }
        $b->reservations = DB::table('stock_reservations as x')->leftJoin('sales_orders as o', 'o.id', '=', 'x.order_id')->leftJoin('customers as c', 'c.id', '=', 'o.customer_id')
            ->where('x.balance_id', $id)->where('x.status', 'ACTIVE')->orderBy('x.delivery_date')
            ->get(['x.id', 'x.order_id', 'x.order_number', 'x.qty', 'x.delivery_date', 'x.reserved_at', 'o.status as order_status', 'c.full_name as customer_name']);
        $b->movements = DB::table('stock_movements')->where('warehouse_id', $b->warehouse_id)->where('variant_id', $b->variant_id)
            ->when($b->lot_id, fn ($q) => $q->where('lot_id', $b->lot_id), fn ($q) => $q->whereNull('lot_id'))
            ->orderByDesc('moved_at')->limit(30)->get(['id', 'moved_at', 'movement_type', 'source_type', 'reason', 'user as user_name', 'qty', 'bal_qty']);

        return response()->json($b);
    }

    /** Ficha de un movimiento del kardex (ALM-03): documento de origen, reverso de / reversado por. */
    public function movimiento(Request $r, string $id)
    {
        $m = DB::table('stock_movements as m')->join('warehouses as w', 'w.id', '=', 'm.warehouse_id')->join('product_variants as v', 'v.id', '=', 'm.variant_id')
            ->leftJoin('lots as l', 'l.id', '=', 'm.lot_id')->where('m.id', $id)
            ->first(['m.*', 'm.user as user_name', 'w.code as warehouse_code', 'w.name as warehouse_name', 'v.sku', 'v.name as variant_name', 'v.sale_mode', 'l.code as lot_code',
                'w.establishment_id', 'v.brand_id']);
        abort_unless($m, 404);
        $this->dentroDelAlcance($r, $m->establishment_id, $m->brand_id);
        $m->document = self::documento($m->source_type, $m->source_id);
        $m->reversal_of_move = $m->reversal_of ? DB::table('stock_movements')->where('id', $m->reversal_of)->first(['id', 'moved_at', 'movement_type', 'qty', 'reason']) : null;
        $m->reversed_by = DB::table('stock_movements')->where('reversal_of', $id)->first(['id', 'moved_at', 'qty', 'reason', 'user as user_name']);
        if (! $this->verCostos($r)) {
            $m->unit_cost = $m->total_cost = null;
        }

        return response()->json($m);
    }

    /** SQL que pone el número del documento de origen de un movimiento (para el kardex). */
    public static function documentoSql(string $m = 'm'): string
    {
        $tablas = ['STOCK_RECEIPT' => 'stock_receipts', 'STOCK_TRANSFER' => 'stock_transfers', 'STOCK_COUNT' => 'stock_counts', 'STOCK_WASTE' => 'stock_waste_records', 'SALES_ORDER' => 'sales_orders', 'POS_SALE' => 'sales_orders'];
        $casos = collect($tablas)->map(fn ($t, $k) => "when '{$k}' then (select d.number from {$t} d where d.id::text = {$m}.source_id::text)")->implode(' ');

        return "(case {$m}.source_type {$casos} when 'LOT_RELEASE' then (select d.code from lots d where d.id::text = {$m}.source_id::text) when 'EXPIRY' then (select d.code from lots d where d.id::text = {$m}.source_id::text) when 'INITIAL_LOAD' then (select d.code from lots d where d.id::text = {$m}.source_id::text) end)";
    }

    private static function documento(?string $tipo, ?string $id): ?string
    {
        if (! $tipo || ! $id) {
            return null;
        }

        return DB::selectOne('select '.self::documentoSql('x').' as n from (select ?::text as source_type, ?::text as source_id) x', [$tipo, $id])->n ?? null;
    }

    /** Historial de cambios de estado de todos los lotes (ALM-06). */
    public function historialLotes(Request $r)
    {
        $q = DB::table('lot_status_changes as c')->join('lots as l', 'l.id', '=', 'c.lot_id')->join('product_variants as v', 'v.id', '=', 'l.variant_id')
            ->leftJoin('users as u', 'u.id', '=', 'c.changed_by')->when($r->query('to_status'), fn ($x, $s) => $x->where('c.to_status', $s));
        $this->porMarca($q, $r, 'v.brand_id');
        $q->selectRaw('c.id, c.lot_id, l.code as lot_code, v.sku, v.name as variant_name, c.from_status, c.to_status, c.reason, c.changed_at, u.name as changed_by_name');

        return response()->json(Listado::de(DB::query()->fromSub($q, 's'), $r, buscar: ['lot_code', 'sku', 'variant_name', 'reason', 'changed_by_name'],
            ordenar: ['changed_at', 'lot_code'], porDefecto: '-changed_at'));
    }

    /** Lo que hay en el almacén de tránsito (ALM-12). */
    public function transito(Request $r)
    {
        $hoy = S::hoy()->toDateString();
        $filas = DB::table('stock_balances as b')->join('warehouses as w', 'w.id', '=', 'b.warehouse_id')->join('product_variants as v', 'v.id', '=', 'b.variant_id')
            ->leftJoin('lots as l', 'l.id', '=', 'b.lot_id')->where('w.wh_type', 'TRANSIT')->where('b.qty', '>', S::EPS)
            ->orderBy('v.sku')->selectRaw('b.id, w.code as warehouse_code, v.sku, v.name as variant_name, v.sale_mode, l.code as lot_code, b.lot_id, l.expiry_date,
                (l.expiry_date - ?::date) as days_left, b.qty, b.weight_kg, round(b.qty * b.avg_cost, 2) as value', [$hoy])->get();
        $this->sinCostos($r, $filas, ['value']);

        return response()->json(['data' => $filas]);
    }

    /** Pedidos con reservas activas, uno por fila (ALM-10). */
    public function pedidos(Request $r)
    {
        $q = DB::table('stock_reservations as r')->join('stock_balances as b', 'b.id', '=', 'r.balance_id')->join('warehouses as w', 'w.id', '=', 'r.warehouse_id')
            ->leftJoin('sales_orders as o', 'o.id', '=', 'r.order_id')->leftJoin('customers as c', 'c.id', '=', 'o.customer_id')->leftJoin('establishments as e', 'e.id', '=', 'r.establishment_id')
            ->where('r.status', 'ACTIVE')->when($r->query('warehouse_id'), fn ($x, $w) => $x->where('r.warehouse_id', $w))
            ->when($r->query('order_status'), fn ($x, $s) => $x->where('o.status', $s));
        $this->porLocal($q, $r, 'r.establishment_id');
        $this->porMarca($q, $r, 'r.brand_id');
        $q->groupBy('r.order_id', 'r.order_number', 'o.status', 'c.full_name', 'e.short')
            ->selectRaw("r.order_id, r.order_number, o.status as order_status, c.full_name as customer_name, e.short as establishment_short, min(r.delivery_date) as delivery_date,
                count(*) as lines, round(sum(r.qty * b.avg_cost), 2) as value, string_agg(distinct w.code, ', ') as warehouses, min(r.reserved_at) as reserved_at");
        $pagina = Listado::de(DB::query()->fromSub($q, 's'), $r, buscar: ['order_number', 'customer_name'],
            ordenar: ['order_number', 'delivery_date', 'lines', 'value'], porDefecto: 'delivery_date');
        $this->sinCostos($r, $pagina->getCollection(), ['value']);

        return response()->json($pagina);
    }

    /** Ficha del pedido en ALM-10: sus reservas (activas y cerradas). */
    public function pedido(Request $r, string $orderId)
    {
        $o = DB::table('sales_orders as o')->leftJoin('customers as c', 'c.id', '=', 'o.customer_id')->where('o.id', $orderId)
            ->first(['o.id', 'o.number', 'o.status', 'o.delivery_date', 'c.full_name as customer_name', 'o.establishment_id', 'o.brand_id']);
        abort_unless($o, 404);
        $this->dentroDelAlcance($r, $o->establishment_id, $o->brand_id);
        $o->reservations = DB::table('stock_reservations as r')->join('product_variants as v', 'v.id', '=', 'r.variant_id')->join('warehouses as w', 'w.id', '=', 'r.warehouse_id')
            ->leftJoin('lots as l', 'l.id', '=', 'r.lot_id')->leftJoin('users as u', 'u.id', '=', 'r.released_by')->where('r.order_id', $orderId)->orderBy('r.reserved_at')
            ->get(['r.id', 'r.status', 'r.qty', 'r.reserved_at', 'r.closed_at', 'r.released_reason', 'u.name as released_by_name', 'v.sku', 'v.name as variant_name', 'v.sale_mode',
                'w.code as warehouse_code', 'l.code as lot_code', 'l.expiry_date']);
        $o->short = collect($this->faltantesDe($r, $orderId))->first()['short'] ?? [];

        return response()->json($o);
    }

    /** Pedidos confirmados y sin despachar con líneas que no alcanzaron reserva (ALM-10). */
    public function faltantes(Request $r)
    {
        return response()->json(['data' => $this->faltantesDe($r)]);
    }

    private function faltantesDe(Request $r, ?string $orderId = null): array
    {
        $q = DB::table('sales_order_lines as ol')->join('sales_orders as o', 'o.id', '=', 'ol.sales_order_id')->join('product_variants as v', 'v.id', '=', 'ol.variant_id')
            ->leftJoin('customers as c', 'c.id', '=', 'o.customer_id')->leftJoin('establishments as e', 'e.id', '=', 'o.establishment_id')
            ->whereIn('o.status', ['CONFIRMED', 'IN_PREPARATION', 'WEIGHED', 'READY'])->when($orderId, fn ($x) => $x->where('o.id', $orderId))
            ->whereRaw("ol.qty > coalesce((select sum(x.qty) from stock_reservations x where x.order_line_id = ol.id and x.status in ('ACTIVE','CONSUMED')), 0) + 0.0005");
        $this->porLocal($q, $r, 'o.establishment_id');
        $this->porMarca($q, $r, 'o.brand_id');
        $filas = $q->orderBy('o.delivery_date')->orderBy('o.number')
            ->get(['o.id as order_id', 'o.number as order_number', 'o.status as order_status', 'o.delivery_date', 'c.full_name as customer_name', 'e.short as establishment_short',
                'v.sku', 'v.name as variant_name', 'v.sale_mode', 'ol.qty',
                DB::raw("ol.qty - coalesce((select sum(x.qty) from stock_reservations x where x.order_line_id = ol.id and x.status in ('ACTIVE','CONSUMED')), 0) as short_qty")]);

        return $filas->groupBy('order_id')->map(fn ($g) => [
            'order_id' => $g[0]->order_id, 'order_number' => $g[0]->order_number, 'order_status' => $g[0]->order_status, 'delivery_date' => $g[0]->delivery_date,
            'customer_name' => $g[0]->customer_name, 'establishment_short' => $g[0]->establishment_short,
            'short' => $g->map(fn ($x) => ['sku' => $x->sku, 'variant_name' => $x->variant_name, 'sale_mode' => $x->sale_mode, 'qty' => S::t($x->short_qty)])->values(),
        ])->values()->all();
    }

    /** Vuelve a reservar un pedido con sus líneas (después de una recepción o una liberación). */
    public function reintentar(Request $r, string $orderId)
    {
        $o = DB::table('sales_orders')->where('id', $orderId)->first(['id', 'number', 'brand_id', 'establishment_id', 'delivery_date', 'status'])
            ?? RuleError::fail('RN-ALM-09', 'Pedido no encontrado.');
        $this->dentroDelAlcance($r, $o->establishment_id, $o->brand_id);
        if (! in_array($o->status, ['CONFIRMED', 'IN_PREPARATION', 'WEIGHED', 'READY'], true)) {
            RuleError::fail('RN-ALM-09', 'Solo se reserva un pedido confirmado y sin despachar.');
        }
        $lineas = DB::table('sales_order_lines')->where('sales_order_id', $orderId)->get(['id', 'variant_id', 'qty', 'est_weight_kg'])
            ->map(fn ($l) => ['line_id' => $l->id, 'variant_id' => $l->variant_id, 'qty' => (float) $l->qty, 'weight_kg' => $l->est_weight_kg])->all();

        return response()->json(ReservasService::reservar(['order_id' => $o->id, 'order_number' => $o->number, 'brand_id' => $o->brand_id,
            'establishment_id' => $o->establishment_id, 'delivery_date' => $o->delivery_date ? substr((string) $o->delivery_date, 0, 10) : null, 'lines' => $lineas], $r->user()));
    }

    /** Promoción sugerida de un lote por vencer (ALM-11): avisa a MARKETING y a las vendedoras. */
    public function promocion(Request $r, string $lotId)
    {
        $a = AlertasService::vencimientos()->firstWhere('lot_id', $lotId) ?? RuleError::fail('RN-ALM-15', 'El lote no está por vencer o ya no tiene stock.');
        if ($a->days_left < 0) {
            RuleError::fail('RN-ALM-15', 'El lote ya venció: va a merma, no a promoción.');
        }
        $libre = S::cant(max(0, (float) $a->qty - (float) $a->reserved_qty), $a->sale_mode);
        $vence = substr($a->expiry_date, 8, 2).'/'.substr($a->expiry_date, 5, 2);
        $ref = json_encode(['screen' => 'ALM-11', 'lot_id' => $lotId]);
        // Un aviso por lote y día: repetirlo solo llena las notificaciones de marketing y ventas.
        if (DB::table('notifications')->where('type', 'stock.promo_suggested')->where('ref', $ref)->where('at', '>=', S::hoy())->exists()) {
            RuleError::fail('RN-ALM-15', "La promoción del lote {$a->lot_code} ya se avisó hoy.");
        }
        DB::transaction(function () use ($a, $libre, $vence, $ref) {
            DB::table('notifications')->insert([
                ['role' => 'MARKETING', 'title' => "Promoción sugerida: {$a->variant_name}", 'body' => "Lote {$a->lot_code} vence el {$vence} · {$libre} libres · S/ ".number_format((float) $a->value, 2),
                    'ref' => $ref, 'tone' => 'warn', 'module' => 'ALM', 'at' => now(), 'type' => 'stock.promo_suggested', 'in_app' => true],
                ['role' => 'VENDEDORA', 'title' => "Vender primero: {$a->variant_name}", 'body' => "Lote {$a->lot_code} vence el {$vence} · {$libre} libres. Ofrécelo primero.",
                    'ref' => $ref, 'tone' => 'warn', 'module' => 'ALM', 'at' => now(), 'type' => 'stock.promo_suggested', 'in_app' => true],
            ]);
        });

        return response()->json(['ok' => true, 'lot_code' => $a->lot_code]);
    }
}
