<?php

namespace App\Modulos\Alm\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Alm\Services\MermasService;
use App\Support\Listado;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

/** ALM-09 Mermas (RN-ALM-13, RN-ALM-14) y ALM-13 Motivos de merma. */
class MermaController extends Controller
{
    use Alcance;

    public function index(Request $r)
    {
        $q = DB::table('stock_waste_records as m')->join('waste_reasons as wr', 'wr.id', '=', 'm.reason_id')->join('product_variants as v', 'v.id', '=', 'm.variant_id')
            ->join('warehouses as w', 'w.id', '=', 'm.warehouse_id')->leftJoin('lots as l', 'l.id', '=', 'm.lot_id')->leftJoin('users as u', 'u.id', '=', 'm.requested_by')
            ->when($r->query('status'), fn ($x, $s) => $x->where('m.status', $s))->when($r->query('reason_id'), fn ($x, $s) => $x->where('m.reason_id', $s));
        $this->porLocal($q, $r, 'm.establishment_id');
        $this->porMarca($q, $r, 'v.brand_id');
        $q->selectRaw('m.id, m.number, m.status, m.qty, m.weight_kg, m.estimated_cost, m.actual_cost, m.requested_at, m.requested_by, m.approved_at,
            (m.photo_url is not null) as has_photo, wr.name as reason_name, wr.code as reason_code, wr.approval_above_pen,
            (m.estimated_cost > wr.approval_above_pen) as above_threshold, v.sku, v.name as variant_name, v.sale_mode, w.code as warehouse_code,
            l.code as lot_code, u.name as requested_by_name');

        return response()->json(Listado::de(DB::query()->fromSub($q, 's'), $r, buscar: ['number', 'sku', 'variant_name', 'lot_code', 'reason_name'],
            ordenar: ['number', 'requested_at', 'estimated_cost', 'status'], porDefecto: '-requested_at'));
    }

    public function show(string $id)
    {
        $m = MermasService::ver($id);
        $m->has_photo = $m->photo_url !== null;

        return response()->json($m);
    }

    public function store(Request $r)
    {
        $d = $r->validate([
            'warehouse_id' => 'required|uuid', 'variant_id' => 'required|uuid', 'lot_id' => 'nullable|uuid', 'reason_id' => 'required|uuid',
            'qty' => 'required|numeric|gt:0', 'weight_kg' => 'nullable|numeric|min:0', 'notes' => 'nullable|string|max:500',
            // Misma regla que los logos (App\Support\Logos): PNG, JPG o WEBP de hasta 1 MB, sin SVG.
            'photo' => ['nullable', 'file', 'max:1024', 'mimes:png,jpg,jpeg,webp'],
        ], ['photo.max' => 'La foto no puede pesar más de 1 MB.', 'photo.mimes' => 'La foto debe ser PNG, JPG o WEBP.']);
        if ($r->hasFile('photo')) {
            $d['photo_url'] = $r->file('photo')->store('alm/mermas/'.$r->attributes->get('tenant_id'), 'local');
        }
        unset($d['photo']);

        return response()->json(MermasService::registrar($d, $r->user()), 201);
    }

    public function foto(string $id)
    {
        $ruta = DB::table('stock_waste_records')->where('id', $id)->value('photo_url');
        abort_unless($ruta && Storage::disk('local')->exists($ruta), 404);

        return response()->file(Storage::disk('local')->path($ruta), ['Cache-Control' => 'private, max-age=3600', 'X-Content-Type-Options' => 'nosniff']);
    }

    public function aprobar(Request $r, string $id)
    {
        return response()->json(MermasService::aprobar($id, $r->user()));
    }

    public function rechazar(Request $r, string $id)
    {
        $d = $r->validate(['reason' => 'required|string|max:200']);

        return response()->json(MermasService::rechazar($id, $d['reason'], $r->user()));
    }

    public function motivos(Request $r)
    {
        $filas = DB::table('waste_reasons as wr')->when(! $r->boolean('todos'), fn ($x) => $x->where('wr.status', 'ACTIVE'))
            ->selectRaw("wr.*, (select count(*) from stock_waste_records m where m.reason_id = wr.id) as uses,
                (select coalesce(sum(coalesce(m.actual_cost, m.estimated_cost)),0) from stock_waste_records m where m.reason_id = wr.id and m.status = 'APPROVED') as approved_cost")
            ->orderBy('wr.name')->get();

        return response()->json(['data' => $filas]);
    }

    public function guardarMotivo(Request $r, ?string $id = null)
    {
        $d = $r->validate(['code' => 'required|string|max:10', 'name' => 'required|string|max:80', 'requires_photo' => 'boolean',
            'approval_above_pen' => 'required|numeric|min:0', 'counts_as_expired' => 'boolean', 'status' => 'nullable|in:ACTIVE,INACTIVE']);

        return response()->json(MermasService::guardarMotivo($d, $id), $id ? 200 : 201);
    }
}
