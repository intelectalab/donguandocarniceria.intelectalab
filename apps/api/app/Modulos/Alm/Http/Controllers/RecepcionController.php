<?php

namespace App\Modulos\Alm\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Alm\Services\RecepcionService;
use App\Support\Listado;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** ALM-04 Recepción con control de calidad mínimo. */
class RecepcionController extends Controller
{
    use Alcance;

    public function index(Request $r)
    {
        $q = DB::table('stock_receipts as r')->join('warehouses as w', 'w.id', '=', 'r.warehouse_id')->leftJoin('suppliers as s', 's.id', '=', 'r.supplier_id')
            ->leftJoin('users as u', 'u.id', '=', 'r.received_by')
            ->when($r->query('status'), fn ($x, $s) => $x->where('r.status', $s))->when($r->query('source_type'), fn ($x, $s) => $x->where('r.source_type', $s));
        $this->porLocal($q, $r, 'r.establishment_id');
        $q->selectRaw('r.id, r.number, r.status, r.source_type, r.received_at, r.supplier_doc, r.vehicle_temp_c, w.code as warehouse_code, w.name as warehouse_name,
            s.trade_name as supplier_name, u.name as received_by_name, (select count(*) from stock_receipt_lines l where l.receipt_id = r.id) as lines,
            (select count(*) from stock_receipt_lines l where l.receipt_id = r.id and l.qc_result = \'FAIL\') as rejected_lines, r.created_at');

        return response()->json(Listado::de(DB::query()->fromSub($q, 's'), $r, buscar: ['number', 'supplier_name', 'supplier_doc'],
            ordenar: ['number', 'received_at', 'status', 'created_at'], porDefecto: '-received_at'));
    }

    public function show(string $id)
    {
        abort_unless(DB::table('stock_receipts')->where('id', $id)->exists(), 404);

        return response()->json(RecepcionService::ver($id));
    }

    public function store(Request $r)
    {
        return response()->json(RecepcionService::crear($this->datos($r), $r->user()), 201);
    }

    public function update(Request $r, string $id)
    {
        return response()->json(RecepcionService::actualizar($id, $this->datos($r, false), $r->user()));
    }

    public function confirmar(Request $r, string $id)
    {
        return response()->json(RecepcionService::confirmar($id, $r->user()));
    }

    public function anular(Request $r, string $id)
    {
        $d = $r->validate(['reason' => 'required|string|max:200']);

        return response()->json(RecepcionService::anular($id, $d['reason'], $r->user()));
    }

    private function datos(Request $r, bool $nuevo = true): array
    {
        return $r->validate([
            'warehouse_id' => ($nuevo ? 'required' : 'sometimes').'|uuid', 'source_type' => ($nuevo ? 'required' : 'sometimes').'|string',
            'supplier_id' => 'nullable|uuid', 'supplier_doc' => 'nullable|string|max:60', 'received_at' => 'nullable|date', 'vehicle_temp_c' => 'nullable|numeric',
            'lines' => ($nuevo ? 'required' : 'sometimes').'|array|min:1', 'lines.*.variant_id' => 'required|uuid', 'lines.*.qty' => 'required|numeric',
            'lines.*.weight_kg' => 'nullable|numeric|min:0', 'lines.*.unit_cost' => 'nullable|numeric|min:0', 'lines.*.expiry_date' => 'nullable|date',
            'lines.*.production_date' => 'nullable|date', 'lines.*.product_temp_c' => 'nullable|numeric', 'lines.*.appearance' => 'nullable|in:OK,OBSERVED,REJECTED',
            'lines.*.qc_result' => 'nullable|in:PENDING,PASS,FAIL', 'lines.*.qc_notes' => 'nullable|string|max:500',
        ]);
    }
}
