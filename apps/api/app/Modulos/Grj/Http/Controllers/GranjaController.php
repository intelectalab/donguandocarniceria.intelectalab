<?php

namespace App\Modulos\Grj\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Com\Services\Soporte as C;
use App\Modulos\Grj\Services\GranjaService as G;
use App\Support\Access;
use App\Support\Listado;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** GRJ-01 a GRJ-07: vínculos, mapeo, envíos, recepción, conciliación, cambio a factura y tablero. */
class GranjaController extends Controller
{
    public function opciones(Request $r)
    {
        $s = G::granja();
        $u = $r->user();

        return response()->json([
            'farm' => $s ? ['id' => $s->id, 'name' => $s->trade_name ?: $s->legal_name, 'doc_number' => $s->doc_number] : null,
            'farms' => DB::table('suppliers')->where('supplier_type', 'RELATED_FARM')->orderBy('legal_name')->get(['id', 'legal_name', 'trade_name', 'doc_number']),
            'companies' => DB::table('companies')->orderBy('legal_name')->get(['id', 'legal_name', 'ruc']),
            'warehouses' => DB::table('warehouses')->where('status', 'ACTIVE')->whereIn('wh_type', ['COLD_ROOM', 'FREEZER', 'MAIN'])->orderBy('code')->get(['id', 'code', 'name', 'wh_type', 'establishment_id']),
            'scales' => DB::table('equipment')->where('category', 'SCALE')->where('status', 'ACTIVE')->orderBy('code')->get(['id', 'code', 'name', 'establishment_id']),
            'default_warehouse_id' => G::almacenDestino(),
            'tolerance_pct' => G::tolerancia(),
            'today' => C::hoy(),
            'expected_today' => $s ? G::documentoEsperado($s->id, C::hoy()) : null,
            'can' => ['link' => Access::can($u, 'grj.link.manage'), 'mapping' => Access::can($u, 'grj.mapping.manage'), 'receive' => Access::can($u, 'grj.dispatch.receive'),
                'close' => Access::can($u, 'grj.reconciliation.close'), 'agree' => Access::can($u, 'grj.reconciliation.close') || Access::module($u, 'GRJ', 'E')],
        ]);
    }

    public function cifras(string $pantalla)
    {
        $s = G::granja();
        $hoy = C::hoy();

        return response()->json(match ($pantalla) {
            '01' => ['links' => DB::table('farm_links')->where('status', 'ACTIVE')->count(), 'mode_today' => $s ? G::documentoEsperado($s->id, $hoy) : null,
                'last_webhook_at' => DB::table('farm_links')->max('last_webhook_at'), 'scheduled' => DB::table('farm_links')->where('status', 'ACTIVE')->where('valid_from', '>', $hoy)->count()],
            '02' => ['mapped' => DB::table('farm_product_mappings')->where('status', 'ACTIVE')->count(), 'unmapped' => G::sinMapear()->count()],
            '03', '04' => DB::table('farm_dispatches')->selectRaw("count(*) filter (where status = 'RECEIVED_PENDING') as pending, count(*) filter (where status = 'DISPUTED') as disputed,
                count(*) filter (where status = 'ERROR') as errors, count(*) filter (where (dispatched_at AT TIME ZONE 'America/Lima')::date >= date_trunc('month', ?::date)) as month,
                coalesce(sum(total_sent_kg) filter (where (dispatched_at AT TIME ZONE 'America/Lima')::date >= date_trunc('month', ?::date)), 0) as month_kg,
                sum(duplicates_received) as duplicates", [$hoy, $hoy])->first(),
            '05' => collect(G::conciliacion($hoy))->only(['sent_kg', 'received_kg', 'difference_kg', 'difference_value', 'dispatches'])->put('issues', count(G::conciliacion($hoy)['issues'])),
            '06' => ['mode_today' => $s ? G::documentoEsperado($s->id, $hoy) : null],
            '07' => G::tablero($hoy)['kpis'],
            default => abort(404),
        });
    }

    /* ---------------- GRJ-01 vínculos */

    public function vinculos(Request $r)
    {
        $q = DB::table('farm_links as l')->join('suppliers as s', 's.id', '=', 'l.supplier_id')->join('companies as c', 'c.id', '=', 'l.company_id')
            ->leftJoin('users as u', 'u.id', '=', 'l.created_by')
            ->selectRaw("l.*, coalesce(nullif(s.trade_name, ''), s.legal_name) as supplier_name, s.doc_number as supplier_doc, c.legal_name as company_name, c.ruc as company_ruc, u.name as created_by_name,
                (select count(*) from farm_dispatches d where d.farm_link_id = l.id) as dispatches,
                case when l.status = 'CLOSED' then 'CLOSED' when l.valid_from > ? then 'SCHEDULED' when l.valid_to is not null and l.valid_to < ? then 'ENDED' else 'ACTIVE' end as state",
                [C::hoy(), C::hoy()])->orderByDesc('l.valid_from');

        return response()->json(['data' => $q->get()]);
    }

    public function crearVinculo(Request $r)
    {
        $d = $r->validate(['supplier_id' => 'required|uuid', 'company_id' => 'nullable|uuid', 'mode' => 'required|in:NTI,INVOICE', 'valid_from' => 'required|date', 'valid_to' => 'nullable|date',
            'farm_ruc' => 'nullable|string|max:11', 'farm_legal_name' => 'nullable|string|max:200', 'farm_tenant_ref' => 'nullable|string|max:80', 'notes' => 'nullable|string|max:300']);

        return response()->json(G::crearVinculo($d, $r->user()), 201);
    }

    public function cerrarVinculo(Request $r, string $id)
    {
        $d = $r->validate(['valid_to' => 'required|date']);

        return response()->json(G::cerrarVinculo($id, $d['valid_to'], $r->user()));
    }

    public function esperado(Request $r)
    {
        $d = $r->validate(['date' => 'required|date', 'supplier_id' => 'nullable|uuid']);
        $s = G::granja($d['supplier_id'] ?? null) ?? abort(404);

        return response()->json(['date' => $d['date'], 'expected_doc_type' => G::documentoEsperado($s->id, $d['date']), 'link' => G::vinculoEn($s->id, $d['date'])]);
    }

    /* ---------------- GRJ-02 mapeo */

    public function mapeos(Request $r)
    {
        $q = DB::table('farm_product_mappings as m')->join('product_variants as v', 'v.id', '=', 'm.variant_id')
            ->when($r->query('status'), fn ($x, $v) => $x->where('m.status', $v))
            ->selectRaw('m.*, v.sku, v.name as variant_name, v.sale_mode,
                (select count(*) from farm_dispatch_lines l where l.mapping_id = m.id) as lines,
                (select coalesce(sum(l.received_weight_kg), 0) from farm_dispatch_lines l where l.mapping_id = m.id) as received_kg');

        return response()->json(['data' => $q->orderBy('m.farm_item_code')->get(), 'unmapped' => G::sinMapear()]);
    }

    public function mapear(Request $r)
    {
        $d = $r->validate(['supplier_id' => 'nullable|uuid', 'farm_item_code' => 'required|string|max:40', 'farm_item_name' => 'nullable|string|max:200', 'variant_id' => 'required|uuid',
            'conversion_factor' => 'nullable|numeric|gt:0', 'transfer_price' => 'nullable|numeric|min:0', 'status' => 'nullable|in:ACTIVE,INACTIVE']);

        return response()->json(G::mapear($d, $r->user()));
    }

    /* ---------------- GRJ-03 envíos y GRJ-04 recepción */

    public function envios(Request $r)
    {
        $q = DB::table('farm_dispatches as d')->leftJoin('purchase_receipts as r', 'r.id', '=', 'd.purchase_receipt_id')->leftJoin('purchase_documents as pd', 'pd.id', '=', 'd.purchase_document_id')
            ->when($r->query('status'), fn ($x, $v) => $x->whereIn('d.status', explode(',', $v)))
            ->when($r->query('source'), fn ($x, $v) => $x->where('d.source', $v))
            ->when($r->query('month'), fn ($x, $v) => $x->whereRaw("to_char(d.dispatched_at AT TIME ZONE 'America/Lima', 'YYYY-MM') = ?", [substr($v, 0, 7)]))
            ->selectRaw("d.id, d.farm_document_type, d.farm_document_number, d.dispatched_at, d.expected_doc_type, d.total_sent_kg, d.total_value, d.status, d.error_message, d.source,
                d.arrived_at, d.received_at, d.order_ref, d.duplicates_received, d.was_disputed, r.number as receipt_number, pd.series || '-' || pd.number as document_label,
                (select count(*) from farm_dispatch_lines l where l.dispatch_id = d.id) as line_count,
                (select coalesce(sum(l.received_weight_kg), 0) from farm_dispatch_lines l where l.dispatch_id = d.id) as received_kg");

        return response()->json(Listado::de(DB::query()->fromSub($q, 'd'), $r, buscar: ['farm_document_number', 'order_ref', 'receipt_number'],
            ordenar: ['dispatched_at', 'farm_document_number', 'total_sent_kg', 'total_value', 'status'], porDefecto: '-dispatched_at'));
    }

    public function envio(string $id)
    {
        return response()->json(G::ver($id));
    }

    /** Carga manual de un envío (el webhook de la granja entra por INT con la misma forma). */
    public function ingresar(Request $r)
    {
        $p = $r->validate([
            'farm_tenant' => 'nullable|string|max:80', 'document_type' => 'required|in:NTI,INVOICE', 'document_number' => 'required|string|max:30', 'dispatched_at' => 'required|date',
            'order_ref' => 'nullable|string|max:30', 'lines' => 'required|array|min:1', 'lines.*.item_code' => 'required|string|max:40', 'lines.*.item_name' => 'nullable|string|max:200',
            'lines.*.lot_code' => 'nullable|string|max:60', 'lines.*.qty' => 'nullable|numeric|min:0', 'lines.*.weight_kg' => 'required|numeric|gt:0', 'lines.*.unit_price' => 'nullable|numeric|min:0',
            'lines.*.origin' => 'nullable|array', 'source' => 'nullable|in:MANUAL,WEBHOOK',
        ]);
        $p['farm_tenant'] ??= DB::table('farm_links')->where('status', 'ACTIVE')->orderByDesc('valid_from')->value('farm_tenant_ref');
        $x = G::ingresar($p, $r->user(), $p['source'] ?? 'MANUAL');

        return response()->json($x, $x['duplicate'] ? 200 : 201);
    }

    public function reprocesar(Request $r, string $id)
    {
        G::procesar($id, $r->user(), true);

        return response()->json(G::ver($id));
    }

    public function recibir(Request $r, string $id)
    {
        $d = $r->validate(['warehouse_id' => 'nullable|uuid', 'received_at' => 'nullable|date', 'vehicle_temp_c' => 'nullable|numeric|min:-40|max:40', 'scale_equipment_id' => 'nullable|uuid',
            'inspection_result' => 'nullable|in:OK,PENDING,OBSERVED', 'lines' => 'required|array|min:1', 'lines.*.id' => 'required|uuid', 'lines.*.received_weight_kg' => 'required|numeric|min:0',
            'lines.*.received_qty' => 'nullable|numeric|min:0', 'lines.*.temp_c' => 'nullable|numeric|min:-40|max:40', 'lines.*.reason' => 'nullable|string|max:200',
            'lines.*.decision' => 'nullable|in:ACCEPT,REJECT,QUALITY_HOLD']);

        return response()->json(G::recibir($id, $d, $r->user()));
    }

    public function disputa(Request $r, string $id)
    {
        $d = $r->validate(['decision' => 'required|in:ACCEPT_RECEIVED,ACCEPT_SENT,CREDIT_NOTE', 'note' => 'required|string|min:5|max:300']);

        return response()->json(G::resolverDisputa($id, $d['decision'], $d['note'], $r->user()));
    }

    /* ---------------- GRJ-05 conciliación, GRJ-06 cambio a factura, GRJ-07 tablero */

    public function conciliacion(Request $r)
    {
        $m = $r->query('month', C::hoy());

        return response()->json(G::conciliacion($m) + ['history' => DB::table('farm_reconciliations')->orderByDesc('period')->get()]);
    }

    public function acordar(Request $r)
    {
        $d = $r->validate(['month' => 'required|date_format:Y-m', 'note' => 'required|string|min:5|max:500']);

        return response()->json(G::acordar($d['month'], $d['note'], $r->user()));
    }

    public function cerrarConciliacion(Request $r)
    {
        $d = $r->validate(['month' => 'required|date_format:Y-m']);

        return response()->json(G::cerrarConciliacion($d['month'], $r->user()));
    }

    public function cambioAFactura(Request $r)
    {
        $d = $r->validate(['cut_date' => 'required|date', 'new_ruc' => 'required|digits:11', 'legal_name' => 'nullable|string|max:200', 'supplier_id' => 'nullable|uuid']);

        return response()->json(G::cambioAFactura($d, $r->user()), 201);
    }

    public function deshacerCambio(Request $r)
    {
        return response()->json(G::deshacerCambio($r->user()));
    }

    public function tablero(Request $r)
    {
        return response()->json(G::tablero($r->query('month')));
    }
}
