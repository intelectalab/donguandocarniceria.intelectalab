<?php

namespace App\Modulos\Alm\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Alm\Services\ConteosService;
use App\Support\Listado;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** ALM-08 Conteos ciegos con aprobación y ajuste (RN-ALM-12). */
class ConteoController extends Controller
{
    use Alcance;

    public function index(Request $r)
    {
        $q = DB::table('stock_counts as c')->join('warehouses as w', 'w.id', '=', 'c.warehouse_id')->leftJoin('users as u', 'u.id', '=', 'c.counted_by')
            ->leftJoin('users as a', 'a.id', '=', 'c.approved_by')->when($r->query('status'), fn ($x, $s) => $x->where('c.status', $s));
        $this->porLocal($q, $r, 'c.establishment_id');
        $q->selectRaw('c.id, c.number, c.status, c.count_type, c.blind, c.counted_at, c.approved_at, c.created_at, w.code as warehouse_code, w.name as warehouse_name,
            u.name as counted_by_name, a.name as approved_by_name,
            (select count(*) from stock_count_lines l where l.count_id = c.id) as lines,
            (select count(*) from stock_count_lines l where l.count_id = c.id and l.counted_qty is not null) as counted_lines,
            (select count(*) from stock_count_lines l where l.count_id = c.id and l.counted_qty is not null and abs(l.counted_qty - l.system_qty) >= 0.0005) as diff_lines');

        return response()->json(Listado::de(DB::query()->fromSub($q, 's'), $r, buscar: ['number', 'warehouse_code', 'warehouse_name'],
            ordenar: ['number', 'created_at', 'status'], porDefecto: '-created_at'));
    }

    public function show(Request $r, string $id)
    {
        return response()->json(ConteosService::ver($id, $r->user()));
    }

    public function store(Request $r)
    {
        $d = $r->validate(['warehouse_id' => 'required|uuid', 'count_type' => 'nullable|in:CYCLE,SPOT,FULL', 'blind' => 'boolean',
            'variant_ids' => 'nullable|array', 'variant_ids.*' => 'uuid', 'notes' => 'nullable|string|max:500']);

        return response()->json(ConteosService::crear($d, $r->user()), 201);
    }

    public function contar(Request $r, string $lineId)
    {
        $d = $r->validate(['counted_qty' => 'nullable|numeric|min:0', 'counted_weight_kg' => 'nullable|numeric|min:0']);

        return response()->json(ConteosService::contar($lineId, $d['counted_qty'] ?? null, $d['counted_weight_kg'] ?? null, $r->user()));
    }

    public function cerrar(Request $r, string $id)
    {
        return response()->json(ConteosService::cerrar($id, $r->user()));
    }

    public function aprobar(Request $r, string $id)
    {
        return response()->json(['adjustments' => ConteosService::aprobar($id, $r->user()), 'count' => ConteosService::ver($id, $r->user())]);
    }

    public function cancelar(Request $r, string $id)
    {
        $d = $r->validate(['reason' => 'required|string|max:200']);

        return response()->json(ConteosService::cancelar($id, $d['reason'], $r->user()));
    }
}
