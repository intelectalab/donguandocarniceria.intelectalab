<?php

namespace App\Modulos\Del\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Del\Services\Base;
use App\Modulos\Del\Services\Vehiculos;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/** DEL-12 Vehículos propios y alquilados con SOAT y revisión técnica (RN-DEL-03). */
class VehiculoController extends Controller
{
    public function index(Request $request)
    {
        $hoy = Base::hoy();
        $v = DB::table('vehicles')->when(Base::locales($request->user()), fn ($w, $l) => $w->whereIn('establishment_id', $l))->orderBy('plate')->get();

        return response()->json(['data' => $v->map(fn ($x) => Vehiculos::ficha($x, $hoy)),
            'proveedores' => DB::table('suppliers')->where('status', 'ACTIVE')->whereIn('supplier_type', ['VEHICLE_RENTAL', 'SERVICES', 'DELIVERY_COMPANY'])
                ->orderBy('trade_name')->get(['id', 'trade_name', 'legal_name', 'supplier_type'])]);
    }

    private function datos(Request $request): array
    {
        return $request->validate([
            'plate' => ['required', 'string', 'max:12'], 'vehicle_type' => ['required', Rule::in(array_keys(Base::VEHICULOS))], 'ownership' => ['required', Rule::in(['OWN', 'RENTED'])],
            'provider_id' => ['nullable', 'uuid'], 'establishment_id' => ['required', 'uuid'], 'capacity_kg' => ['nullable', 'numeric', 'min:0', 'max:50000'],
            'refrigerated' => ['nullable', 'boolean'], 'status' => ['nullable', Rule::in(['ACTIVE', 'MAINTENANCE', 'INACTIVE'])],
            'fuel_type' => ['nullable', Rule::in(array_keys(Base::COMBUSTIBLES))], 'soat_policy_no' => ['nullable', 'string', 'max:40'],
            'soat_expires_on' => ['nullable', 'date_format:Y-m-d'], 'tech_inspection_expires_on' => ['nullable', 'date_format:Y-m-d'],
            'odometer_km' => ['nullable', 'numeric', 'min:0', 'max:9999999'], 'rental_daily_rate' => ['nullable', 'numeric', 'min:0', 'max:99999'],
            'notes' => ['nullable', 'string', 'max:500'],
        ]);
    }

    public function store(Request $request)
    {
        $v = Vehiculos::guardar(null, $this->datos($request), $request->user());

        return response()->json(Vehiculos::ficha($v, Base::hoy()), 201);
    }

    public function update(Request $request, string $id)
    {
        $v = Vehiculos::guardar($id, $this->datos($request), $request->user());

        return response()->json(Vehiculos::ficha($v, Base::hoy()));
    }
}
