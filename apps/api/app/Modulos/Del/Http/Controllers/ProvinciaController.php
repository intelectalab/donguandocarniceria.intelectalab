<?php

namespace App\Modulos\Del\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Del\Services\Base;
use App\Modulos\Del\Services\Provincia;
use App\Modulos\Del\Services\Rutas;
use App\Modulos\Ped\Services\Estados;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/** DEL-11 Envíos a provincia: agencia, embalaje, GRE (FAC), seguimiento, flete y empaque (RN-DEL-12). */
class ProvinciaController extends Controller
{
    public function index(Request $request)
    {
        $d = $request->validate(['estado' => ['nullable', Rule::in(array_keys(Base::PROVINCIA))]]);
        $u = $request->user();
        $envios = DB::table('province_shipments as p')->join('sales_orders as o', 'o.id', '=', 'p.order_id')->leftJoin('suppliers as s', 's.id', '=', 'p.agency_supplier_id')
            ->leftJoin('dispatch_guides as g', 'g.id', '=', 'p.dispatch_guide_id')
            ->when(Base::locales($u), fn ($w, $l) => $w->whereIn('o.establishment_id', $l))
            ->when($d['estado'] ?? null, fn ($w, $e) => $w->where('p.status', $e))
            ->orderByDesc('p.created_at')->limit(300)
            ->get(['p.*', 'o.number as pedido', 'o.customer_id', 'o.status as order_status', 'o.delivery_date', 's.trade_name as agencia', 'g.full_number as guia']);
        $pendientes = DB::table('sales_orders as o')->where('o.fulfillment', 'PROVINCE_SHIPPING')
            ->whereNotIn('o.status', ['DRAFT', 'CANCELLED', 'DELIVERED', 'CLOSED'])
            ->whereNotExists(fn ($q) => $q->from('province_shipments as p')->whereColumn('p.order_id', 'o.id'))
            ->when(Base::locales($u), fn ($w, $l) => $w->whereIn('o.establishment_id', $l))
            ->orderBy('o.delivery_date')->limit(200)->get(['o.id', 'o.number', 'o.customer_id', 'o.status', 'o.delivery_date', 'o.province_destination', 'o.province_agency', 'o.thermal_packaging']);

        return response()->json([
            'data' => $envios->map(fn ($p) => (array) $p + ['cliente' => Base::cliente($p->customer_id), 'estado' => Base::PROVINCIA[$p->status] ?? $p->status,
                'guias' => Provincia::guias($p->order_id), 'siguientes' => Provincia::FLUJO[$p->status] ?? []]),
            'pedidos' => $pendientes->map(fn ($o) => (array) $o + ['cliente' => Base::cliente($o->customer_id), 'estado' => Estados::nombre($o->status),
                'kg' => Rutas::kgPedido($o->id), 'guias' => Provincia::guias($o->id)]),
        ]);
    }

    private function datos(Request $request, bool $nuevo): array
    {
        return $request->validate(($nuevo ? ['order_id' => ['required', 'uuid']] : []) + [
            'agency_supplier_id' => ['nullable', 'uuid'], 'destination' => ['nullable', 'string', 'max:120'], 'destination_ubigeo' => ['nullable', 'digits:6'],
            'packaging' => ['nullable', Rule::in(array_keys(Provincia::EMBALAJES))], 'packages' => ['nullable', 'integer', 'min:1', 'max:50'],
            'weight_kg' => ['nullable', 'numeric', 'min:0', 'max:5000'], 'freight_cost' => ['nullable', 'numeric', 'min:0', 'max:99999'],
            'packaging_cost' => ['nullable', 'numeric', 'min:0', 'max:9999'], 'charged_to_customer' => ['nullable', 'numeric', 'min:0', 'max:99999'],
            'dispatch_guide_id' => ['nullable', 'uuid'], 'tracking_number' => ['nullable', 'string', 'max:60'], 'notes' => ['nullable', 'string', 'max:500'],
        ]);
    }

    public function store(Request $request)
    {
        return response()->json(Provincia::crear($this->datos($request, true), $request->user()), 201);
    }

    public function update(Request $request, string $id)
    {
        return response()->json(Provincia::editar($id, $this->datos($request, false), $request->user()));
    }

    public function agencia(Request $request, string $id)
    {
        $d = $request->validate(['tracking_number' => ['nullable', 'string', 'max:60']]);

        return response()->json(Provincia::entregarAgencia($id, $d['tracking_number'] ?? null, $request->user()));
    }

    public function estado(Request $request, string $id)
    {
        $d = $request->validate(['status' => ['required', Rule::in(['IN_TRANSIT', 'DELIVERED', 'RETURNED', 'LOST'])], 'note' => ['nullable', 'string', 'max:255']]);

        return response()->json(Provincia::cambiarEstado($id, $d['status'], $d['note'] ?? null, $request->user()));
    }
}
