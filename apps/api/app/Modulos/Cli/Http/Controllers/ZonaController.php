<?php

namespace App\Modulos\Cli\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Cli\Models\DeliveryZone;
use App\Modulos\Cli\Services\Zonas;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * CLI-08 Zonas de reparto (polígono o distritos, local, tarifa, mínimo, gratis desde, prioridad,
 * provincia) y CLI-09 Simulador de zona y tarifa. Reglas en Services\Zonas.
 */
class ZonaController extends Controller
{
    public function index()
    {
        $mes = now('America/Lima')->startOfMonth();
        $zonas = DB::table('delivery_zones as z')->leftJoin('establishments as e', 'e.id', '=', 'z.establishment_id')
            ->orderByRaw('coalesce(z.priority, 100)')->orderBy('z.code')
            ->get(['z.*', 'e.name as local', 'e.code as local_code',
                DB::raw("(select count(*) from customer_addresses a where a.zone_id = z.id and a.status = 'ACTIVE') as direcciones"),
                DB::raw("(select count(*) from sales_orders o where o.zone_id = z.id and o.status <> 'CANCELLED' and o.created_at >= '{$mes->toIso8601String()}') as pedidos_mes"),
                DB::raw("(select count(*) from sales_orders o where o.zone_id = z.id and o.status <> 'CANCELLED') as pedidos")])
            ->map(function ($z) {
                foreach (['districts', 'polygon'] as $k) {
                    $z->{$k} = json_decode($z->{$k} ?? 'null', true);
                }
                foreach (['delivery_fee', 'min_order_amount', 'free_from_kg', 'free_from_amount', 'lat', 'lng'] as $k) {
                    $z->{$k} = $z->{$k} === null ? null : (float) $z->{$k};
                }
                foreach (['direcciones', 'pedidos_mes', 'pedidos'] as $k) {
                    $z->{$k} = (int) $z->{$k};
                }

                return $z;
            });
        $lima = $zonas->where('province', false)->where('status', 'ACTIVE');

        return response()->json([
            'zonas' => $zonas->values(),
            'locales' => DB::table('establishments')->orderBy('code')->get(['id', 'code', 'name', 'lat', 'lng']),
            'resumen' => [
                'activas' => $zonas->where('status', 'ACTIVE')->count(),
                'tarifa_promedio_lima' => $lima->count() ? round($lima->avg('delivery_fee'), 2) : 0,
                'fuera_de_cobertura' => DB::table('customer_addresses')->where('status', 'ACTIVE')->whereNull('zone_id')->count(),
            ],
        ]);
    }

    public function store(Request $request)
    {
        return response()->json(Zonas::guardar(null, $this->validar($request)), 201);
    }

    public function update(Request $request, string $id)
    {
        return response()->json(Zonas::guardar(DeliveryZone::findOrFail($id), $this->validar($request)));
    }

    /** CLI-09: zona, tarifa y si el carrito llega al delivery gratis. */
    public function simular(Request $request)
    {
        $d = $request->validate([
            'lat' => ['nullable', 'numeric'], 'lng' => ['nullable', 'numeric'], 'distrito' => ['nullable', 'string', 'max:80'], 'zone_id' => ['nullable', 'uuid'],
            'canal' => ['nullable', 'string', 'max:20'], 'lineas' => ['array', 'max:30'], 'lineas.*.variant_id' => ['required', 'uuid'], 'lineas.*.qty' => ['required', 'numeric', 'min:0', 'max:10000'],
        ]);
        $r = Zonas::tarifa($d);
        if ($r['zona']) {
            $r['zona']['local'] = DB::table('establishments')->where('id', $r['zona']['establishment_id'])->value('name');
        }

        return response()->json($r);
    }

    /** Productos que se pueden poner en el carrito del simulador. */
    public function variantes()
    {
        return response()->json(DB::table('product_variants as v')->join('products as p', 'p.id', '=', 'v.product_id')
            ->leftJoin('brands as b', 'b.id', '=', 'v.brand_id')
            ->where('v.status', 'ACTIVE')->where('v.sellable', true)->where('p.status', 'ACTIVE')
            ->orderBy('b.name')->orderBy('v.name')->get(['v.id', 'v.sku', 'v.name', 'v.sale_mode', 'v.nominal_weight_kg', 'b.name as brand_name']));
    }

    private function validar(Request $request): array
    {
        return $request->validate([
            'code' => ['required', 'string', 'max:30', 'regex:/^[A-Za-z0-9_-]+$/'], 'name' => ['required', 'string', 'max:80'],
            'establishment_id' => ['required', 'uuid', Rule::exists('establishments', 'id')], 'priority' => ['required', 'integer', 'between:1,999'],
            'delivery_fee' => ['required', 'numeric', 'min:0', 'max:9999'], 'min_order_amount' => ['nullable', 'numeric', 'min:0', 'max:99999'],
            'free_from_units' => ['nullable', 'integer', 'min:0', 'max:999'], 'free_from_kg' => ['nullable', 'numeric', 'min:0', 'max:999'],
            'free_from_amount' => ['nullable', 'numeric', 'min:0', 'max:99999'], 'districts' => ['array', 'max:60'], 'districts.*' => ['string', 'max:80'],
            'province' => ['boolean'], 'status' => ['required', Rule::in(['ACTIVE', 'INACTIVE'])],
            'polygon' => ['sometimes', 'nullable', 'array', 'max:200'], 'polygon.*' => ['array', 'size:2'], 'polygon.*.*' => ['numeric'],
        ]);
    }
}
