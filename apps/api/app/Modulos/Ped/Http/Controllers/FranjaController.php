<?php

namespace App\Modulos\Ped\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Ped\Services\Franjas;
use App\Modulos\Ped\Services\Pedidos;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/** PED-06 Franjas de entrega: calendario por local y zona con cupo, ocupación y hora de corte. */
class FranjaController extends Controller
{
    public function index(Request $request)
    {
        $d = $request->validate(['establishment_id' => ['nullable', 'uuid'], 'desde' => ['nullable', 'date_format:Y-m-d'], 'dias' => ['nullable', 'integer', 'min:1', 'max:14']]);
        $desde = CarbonImmutable::parse($d['desde'] ?? now('America/Lima')->toDateString(), 'America/Lima');
        $dias = (int) ($d['dias'] ?? 7);
        $franjas = DB::table('order_time_slots as s')->join('establishments as e', 'e.id', '=', 's.establishment_id')
            ->leftJoin('delivery_zones as z', 'z.id', '=', 's.zone_id')
            ->when($d['establishment_id'] ?? null, fn ($q, $v) => $q->where('s.establishment_id', $v))
            ->orderBy('e.name')->orderBy('s.slot_from')
            ->get(['s.*', 'e.name as local', 'z.name as zona']);
        $fechas = collect(range(0, $dias - 1))->map(fn ($i) => $desde->addDays($i));
        $ocupacion = DB::table('sales_orders')->whereIn('slot_id', $franjas->pluck('id'))
            ->whereBetween('delivery_date', [$desde->toDateString(), $desde->addDays($dias - 1)->toDateString()])
            ->whereIn('status', Pedidos::OCUPAN_FRANJA)->groupBy('slot_id', 'delivery_date')
            ->selectRaw('slot_id, delivery_date, count(*) as n')->get()
            ->mapWithKeys(fn ($r) => [$r->slot_id.'|'.substr($r->delivery_date, 0, 10) => (int) $r->n]);

        return response()->json([
            'fechas' => $fechas->map(fn ($f) => $f->toDateString())->values(),
            'franjas' => $franjas->map(fn ($s) => [
                'id' => $s->id, 'name' => $s->name, 'local' => $s->local, 'establishment_id' => $s->establishment_id, 'zona' => $s->zona, 'zone_id' => $s->zone_id,
                'slot_from' => substr($s->slot_from, 0, 5), 'slot_to' => substr($s->slot_to, 0, 5), 'cutoff' => substr($s->cutoff, 0, 5),
                'capacity' => (int) $s->capacity, 'weekdays' => Franjas::dias($s->weekdays), 'status' => $s->status,
                'dias' => $fechas->map(fn ($f) => [
                    'fecha' => $f->toDateString(), 'atiende' => in_array($f->dayOfWeek, array_map('intval', Franjas::dias($s->weekdays)), true),
                    'ocupados' => $ocupacion[$s->id.'|'.$f->toDateString()] ?? 0,
                ])->values(),
            ])->values(),
            'locales' => DB::table('establishments')->where('status', 'ACTIVE')->orderBy('name')->get(['id', 'name']),
            'zonas' => DB::table('delivery_zones')->where('status', 'ACTIVE')->orderByRaw('coalesce(priority, 100)')->get(['id', 'name', 'establishment_id']),
        ]);
    }

    public function store(Request $request)
    {
        return response()->json(Franjas::guardar(null, $this->datos($request)), 201);
    }

    public function update(Request $request, string $id)
    {
        DB::table('order_time_slots')->where('id', $id)->firstOrFail();

        return response()->json(Franjas::guardar($id, $this->datos($request)));
    }

    /** Pedidos de una franja en una fecha (al pulsar una celda del calendario). */
    public function pedidos(Request $request, string $id)
    {
        $d = $request->validate(['fecha' => ['required', 'date_format:Y-m-d']]);
        $q = DB::table('sales_orders as o')->leftJoin('customers as c', 'c.id', '=', 'o.customer_id')->leftJoin('delivery_zones as z', 'z.id', '=', 'o.zone_id')
            ->where('o.slot_id', $id)->where('o.delivery_date', $d['fecha'])->whereIn('o.status', Pedidos::OCUPAN_FRANJA);
        Pedidos::alcance($q, $request->user());

        return response()->json($q->orderBy('o.number')->get(['o.id', 'o.number', 'o.status', 'o.estimated_total', DB::raw('coalesce(c.trade_name, c.full_name) as cliente'), 'z.name as zona']));
    }

    private function datos(Request $request): array
    {
        return $request->validate([
            'establishment_id' => ['required', 'uuid'], 'zone_id' => ['nullable', 'uuid'], 'name' => ['nullable', 'string', 'max:40'],
            'slot_from' => ['required', 'date_format:H:i'], 'slot_to' => ['required', 'date_format:H:i'], 'cutoff' => ['required', 'date_format:H:i'],
            'capacity' => ['required', 'integer', 'min:1', 'max:999'], 'weekdays' => ['required', 'array', 'min:1'], 'weekdays.*' => ['integer', 'between:0,6'],
            'status' => ['nullable', Rule::in(['ACTIVE', 'INACTIVE'])],
        ]);
    }
}
