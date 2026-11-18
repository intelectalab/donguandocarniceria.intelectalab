<?php

namespace App\Modulos\Ped\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Ped\Services\Pedidos;
use App\Support\Events;
use App\Support\RuleError;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * PED-11 Pedidos de provincia: agencia, destino, embalaje térmico, guía de remisión y número de
 * seguimiento (RN-PED-08). Sin guía y seguimiento no pasa a EN RUTA.
 */
class ProvinciaController extends Controller
{
    public function index(Request $request)
    {
        $d = $request->validate(['vista' => ['nullable', Rule::in(['POR_DESPACHAR', 'DESPACHADOS', 'TODOS'])]]);
        $q = DB::table('sales_orders as o')->leftJoin('customers as c', 'c.id', '=', 'o.customer_id')->leftJoin('brands as b', 'b.id', '=', 'o.brand_id')
            ->leftJoin('suppliers as s', 's.id', '=', 'o.province_agency')->leftJoin('customer_addresses as a', 'a.id', '=', 'o.address_id')
            ->where('o.fulfillment', 'PROVINCE_SHIPPING');
        match ($d['vista'] ?? 'POR_DESPACHAR') {
            'POR_DESPACHAR' => $q->whereIn('o.status', ['DRAFT', 'CONFIRMED', 'IN_PREPARATION', 'WEIGHED', 'READY']),
            'DESPACHADOS' => $q->whereIn('o.status', ['IN_ROUTE', 'DELIVERED', 'NOT_DELIVERED', 'CLOSED']),
            default => $q->where('o.status', '<>', 'CANCELLED'),
        };
        Pedidos::alcance($q, $request->user());

        return response()->json($q->orderBy('o.delivery_date')->limit(200)->get([
            'o.id', 'o.number', 'o.status', 'o.delivery_date', 'o.estimated_total', 'o.final_total', 'o.paid_amount', 'o.province_agency', 'o.province_destination',
            'o.thermal_packaging', 'o.tracking_number', 'o.dispatch_guide_number', DB::raw('coalesce(s.trade_name, s.legal_name) as agencia'),
            DB::raw('coalesce(c.trade_name, c.full_name) as cliente'), 'c.phone as celular', 'b.name as marca', 'a.address_line', 'a.district',
        ]));
    }

    public function update(Request $request, string $id)
    {
        $d = $request->validate([
            'province_agency' => ['nullable', 'uuid'], 'province_destination' => ['nullable', 'string', 'max:20'], 'thermal_packaging' => ['nullable', 'boolean'],
            'tracking_number' => ['nullable', 'string', 'max:40'], 'dispatch_guide_number' => ['nullable', 'string', 'max:40'],
        ]);
        $o = Pedidos::visible($id, $request->user());
        if ($o->fulfillment !== 'PROVINCE_SHIPPING') {
            RuleError::fail('RN-PED-08', 'Este pedido no es un envío a provincia.');
        }
        if (in_array($o->status, ['DELIVERED', 'CLOSED', 'CANCELLED'], true)) {
            RuleError::fail('RN-PED-08', 'El envío ya se cerró: no se cambian sus datos.');
        }
        if (! empty($d['province_agency']) && ! DB::table('suppliers')->where('id', $d['province_agency'])->where('supplier_type', 'DELIVERY_COMPANY')->exists()) {
            RuleError::fail('RN-PED-08', 'Elige una agencia de envío registrada.');
        }
        $datos = array_intersect_key($d, array_flip(['province_agency', 'province_destination', 'thermal_packaging', 'tracking_number', 'dispatch_guide_number']));
        if (in_array($o->status, ['IN_ROUTE', 'NOT_DELIVERED'], true) && array_key_exists('province_agency', $datos) && $datos['province_agency'] !== $o->province_agency) {
            RuleError::fail('RN-PED-08', 'El pedido ya salió con su agencia: no se cambia.');
        }
        foreach (['tracking_number', 'dispatch_guide_number', 'province_destination'] as $k) {
            if (array_key_exists($k, $datos)) {
                $datos[$k] = trim((string) $datos[$k]) ?: null;
            }
        }
        DB::table('sales_orders')->where('id', $o->id)->update($datos + ['last_activity_at' => now(), 'updated_at' => now()]);
        if (! empty($datos['tracking_number']) && $datos['tracking_number'] !== $o->tracking_number) {
            Events::emit('order.tracking_set', 'sales_orders', $o->id, ['number' => $o->number, 'tracking' => $datos['tracking_number']]);
        }

        return response()->json(Pedidos::pedido($o->id));
    }
}
