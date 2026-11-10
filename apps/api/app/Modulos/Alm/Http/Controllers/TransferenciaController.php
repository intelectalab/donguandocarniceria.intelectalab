<?php

namespace App\Modulos\Alm\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Alm\Services\TransferenciasService;
use App\Support\Access;
use App\Support\Listado;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** ALM-07 Transferencias y ALM-12 Stock en tránsito (?status=DISPATCHED, con antigüedad). */
class TransferenciaController extends Controller
{
    public function index(Request $r)
    {
        $locales = Access::for($r->user())['establishments'];
        $q = DB::table('stock_transfers as t')->join('warehouses as a', 'a.id', '=', 't.from_warehouse_id')->join('warehouses as b', 'b.id', '=', 't.to_warehouse_id')
            ->leftJoin('users as u', 'u.id', '=', 't.dispatched_by')
            ->when($r->query('status'), fn ($x, $s) => $x->whereIn('t.status', explode(',', $s)))
            ->when($locales, fn ($x) => $x->where(fn ($y) => $y->whereIn('t.from_site', $locales)->orWhereIn('t.to_site', $locales)))
            ->when($r->query('site') && $r->query('site') !== 'ALL', fn ($x) => $x->where(fn ($y) => $y->where('t.from_site', $r->query('site'))->orWhere('t.to_site', $r->query('site'))))
            ->selectRaw("t.id, t.number, t.status, t.requires_guide, t.guide_number, t.requested_at, t.dispatched_at, t.received_at, t.notes,
                a.code as from_code, a.name as from_name, b.code as to_code, b.name as to_name, u.name as dispatched_by_name,
                (select count(*) from stock_transfer_lines l where l.transfer_id = t.id) as lines,
                (select coalesce(sum(l.qty), 0) from stock_transfer_lines l where l.transfer_id = t.id) as total_qty,
                case when t.status = 'DISPATCHED' then round(extract(epoch from (now() - t.dispatched_at)) / 3600, 1) end as hours_in_transit,
                (select coalesce(sum((m->>'qty')::numeric * (m->>'unit_cost')::numeric), 0) from stock_transfer_lines l, jsonb_array_elements(l.moved) m where l.transfer_id = t.id) as value,
                t.created_at");

        return response()->json(Listado::de(DB::query()->fromSub($q, 's'), $r, buscar: ['number', 'guide_number', 'from_code', 'to_code'],
            ordenar: ['number', 'requested_at', 'dispatched_at', 'status', 'hours_in_transit'], porDefecto: '-requested_at'));
    }

    public function show(string $id)
    {
        return response()->json(TransferenciasService::ver($id));
    }

    public function store(Request $r)
    {
        $d = $r->validate([
            'from_warehouse_id' => 'required|uuid', 'to_warehouse_id' => 'required|uuid', 'notes' => 'nullable|string|max:500',
            'lines' => 'required|array|min:1', 'lines.*.variant_id' => 'required|uuid', 'lines.*.lot_id' => 'nullable|uuid',
            'lines.*.qty' => 'required|numeric|gt:0', 'lines.*.weight_kg' => 'nullable|numeric|min:0',
        ]);

        return response()->json(TransferenciasService::crear($d, $r->user()), 201);
    }

    public function guia(Request $r, string $id)
    {
        $d = $r->validate(['guide_number' => 'nullable|string|max:20']);

        return response()->json(TransferenciasService::emitirGuia($id, $r->user(), $d));
    }

    public function despachar(Request $r, string $id)
    {
        return response()->json(TransferenciasService::despachar($id, $r->user()));
    }

    public function recibir(Request $r, string $id)
    {
        $d = $r->validate([
            'lines' => 'required|array|min:1', 'lines.*.line_id' => 'required|uuid', 'lines.*.received_qty' => 'required|numeric|min:0',
            'lines.*.received_weight_kg' => 'nullable|numeric|min:0', 'lines.*.difference_reason' => 'nullable|string|max:200',
        ]);

        return response()->json(TransferenciasService::recibir($id, $d['lines'], $r->user()));
    }

    public function cancelar(Request $r, string $id)
    {
        $d = $r->validate(['reason' => 'required|string|max:200']);

        return response()->json(TransferenciasService::cancelar($id, $d['reason'], $r->user()));
    }
}
