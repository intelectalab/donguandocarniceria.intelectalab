<?php

namespace App\Modulos\Del\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Del\Services\Base;
use App\Modulos\Del\Services\Costos;
use App\Support\RuleError;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/** DEL-13 Costos de reparto, DEL-14 Costo por entrega (corridas) y DEL-15 Comparativo por zona. */
class CostoController extends Controller
{
    private function mes(Request $request): string
    {
        $d = $request->validate(['mes' => ['nullable', 'regex:/^\d{4}-(0[1-9]|1[0-2])$/']]);

        return $d['mes'] ?? substr(Base::hoy(), 0, 7);
    }

    public function index(Request $request)
    {
        $mes = $this->mes($request);
        $f = $request->validate(['tipo' => ['nullable', Rule::in(array_keys(Base::COSTOS))], 'vehicle_id' => ['nullable', 'uuid'], 'anulados' => ['nullable', 'boolean']]);
        [$desde, $hasta] = Costos::mes($mes);
        $l = Base::locales($request->user());
        $c = DB::table('delivery_costs as c')->leftJoin('vehicles as v', 'v.id', '=', 'c.vehicle_id')->leftJoin('delivery_routes as r', 'r.id', '=', 'c.route_id')
            ->leftJoin('employees as e', 'e.id', '=', DB::raw('coalesce(c.employee_id, c.employee_ref)'))->leftJoin('suppliers as s', 's.id', '=', 'c.supplier_id')
            ->leftJoin('delivery_zones as z', 'z.id', '=', 'c.zone_id')
            ->whereBetween('c.cost_date', [$desde, $hasta])
            ->when($l, fn ($w) => $w->where(fn ($x) => $x->whereNull('c.establishment_id')->orWhereIn('c.establishment_id', $l)))
            ->when($f['tipo'] ?? null, fn ($w, $t) => $w->where('c.cost_type', $t))->when($f['vehicle_id'] ?? null, fn ($w, $v) => $w->where('c.vehicle_id', $v))
            ->when(empty($f['anulados']), fn ($w) => $w->where('c.status', 'ACTIVE'))
            ->orderByDesc('c.cost_date')->orderByDesc('c.created_at')->limit(500)
            ->get(['c.*', 'v.plate', 'r.code as ruta', 'e.full_name as trabajador', 's.trade_name as proveedor', 'z.name as zona']);
        $activos = $c->where('status', 'ACTIVE');

        return response()->json(['data' => $c->map(fn ($x) => (array) $x + ['tipo' => Base::COSTOS[$x->cost_type] ?? $x->cost_type]), 'mes' => $mes,
            'total' => round((float) $activos->sum('amount'), 2),
            'por_tipo' => $activos->groupBy('cost_type')->map(fn ($g, $k) => ['tipo' => Base::COSTOS[$k] ?? $k, 'total' => round((float) $g->sum('amount'), 2), 'n' => $g->count()])->values(),
            // Para el formulario: quien registra costos puede no tener el módulo DEL (administración).
            'rutas' => DB::table('delivery_routes')->whereBetween('route_date', [$desde, $hasta])->where('status', '<>', 'CANCELLED')
                ->when($l, fn ($w) => $w->whereIn('establishment_id', $l))->orderByDesc('route_date')->orderBy('code')->limit(300)->get(['id', 'code', 'route_date', 'vehicle_id']),
            'trabajadores' => DB::table('employees')->where('status', 'ACTIVE')->when($l, fn ($w) => $w->whereIn('establishment_id', $l))->orderBy('full_name')->get(['id', 'full_name']),
            'proveedores' => DB::table('suppliers')->where('status', 'ACTIVE')->orderBy('trade_name')->get(['id', 'trade_name', 'legal_name'])]);
    }

    public function store(Request $request)
    {
        $d = $request->validate([
            'cost_date' => ['required', 'date_format:Y-m-d'], 'cost_type' => ['required', Rule::in(array_keys(Base::COSTOS))], 'amount' => ['required', 'numeric', 'min:0', 'max:999999'],
            'route_id' => ['nullable', 'uuid'], 'vehicle_id' => ['nullable', 'uuid'], 'employee_id' => ['nullable', 'uuid'], 'supplier_id' => ['nullable', 'uuid'],
            'zone_id' => ['nullable', 'uuid'], 'fuel_gallons' => ['nullable', 'numeric', 'min:0', 'max:1000'], 'fuel_voucher_no' => ['nullable', 'string', 'max:40'],
            'odometer_km' => ['nullable', 'numeric', 'min:0', 'max:9999999'], 'notes' => ['nullable', 'string', 'max:500'], 'establishment_id' => ['nullable', 'uuid'],
        ]);
        if ($d['cost_date'] > Base::hoy()) {
            RuleError::fail('RN-DEL-13', 'El costo no puede tener fecha futura.');
        }

        return response()->json(Costos::registrar($d + ['source' => 'MANUAL'], $request->user()), 201);
    }

    public function anular(Request $request, string $id)
    {
        $d = $request->validate(['reason' => ['required', 'string', 'min:3', 'max:255']]);

        return response()->json(Costos::anular($id, $d['reason'], $request->user()));
    }

    public function resumen(Request $request)
    {
        $d = $request->validate(['por' => ['nullable', Rule::in(['zone', 'mode', 'vehicle', 'driver', 'route'])]]);

        return response()->json(Costos::resumen($this->mes($request), $d['por'] ?? 'zone'));
    }

    public function calcular(Request $request)
    {
        return response()->json(Costos::calcular($this->mes($request), $request->user()), 201);
    }

    public function comparativo(Request $request)
    {
        return response()->json(Costos::comparativo($this->mes($request)));
    }
}
