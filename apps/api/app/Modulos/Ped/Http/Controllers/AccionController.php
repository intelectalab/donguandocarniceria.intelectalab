<?php

namespace App\Modulos\Ped\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Ped\Services\Estados;
use App\Modulos\Ped\Services\Franjas;
use App\Modulos\Ped\Services\Mensajes;
use App\Modulos\Ped\Services\Pedidos;
use App\Modulos\Ped\Services\Pesos;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * Acciones sobre un pedido: confirmar (RN-PED-01), volver a borrador, siguiente estado (RN-PED-03),
 * peso real (RN-PED-04/05), PED-05 confirmación con el cliente, PED-08 reprogramar, PED-09 cancelar
 * o no entrega, PED-12 saldo y cierre.
 */
class AccionController extends Controller
{
    public function faltantes(Request $request, string $id)
    {
        $o = Pedidos::visible($id, $request->user());

        return response()->json(['faltan' => $o->status === 'DRAFT' ? Pedidos::faltantes($o) : []]);
    }

    public function confirmar(Request $request, string $id)
    {
        Pedidos::visible($id, $request->user());
        $r = Pedidos::confirmar($id, $request->user());

        return response()->json(PedidoController::detalle($r['pedido'], $request->user()) + ['sin_stock' => $r['sin_stock']]);
    }

    public function borrador(Request $request, string $id)
    {
        $d = $request->validate(['reason' => ['nullable', 'string', 'max:255']]);
        Pedidos::visible($id, $request->user());

        return response()->json(PedidoController::detalle(Estados::aBorrador($id, $d['reason'] ?? null, $request->user()), $request->user()));
    }

    public function estado(Request $request, string $id)
    {
        $d = $request->validate(['to' => ['required', Rule::in(Estados::DIRECTOS)], 'note' => ['nullable', 'string', 'max:255']]);
        Pedidos::visible($id, $request->user());

        return response()->json(PedidoController::detalle(Estados::cambiar($id, $d['to'], $d['note'] ?? null, $request->user()), $request->user()));
    }

    public function pesos(Request $request, string $id)
    {
        $d = $request->validate(['pesos' => ['required', 'array', 'min:1'], 'pesos.*.line_id' => ['required', 'uuid'],
            'pesos.*.weighed_kg' => ['required', 'numeric', 'gt:0', 'max:9999'], 'fuente' => ['nullable', Rule::in(['SCALE', 'MANUAL'])]]);
        Pedidos::visible($id, $request->user());

        return response()->json(PedidoController::detalle(Pesos::registrar($id, $d['pesos'], $request->user(), $d['fuente'] ?? 'MANUAL'), $request->user()));
    }

    /** PED-08 */
    public function reprogramar(Request $request, string $id)
    {
        $d = $request->validate(['delivery_date' => ['required', 'date_format:Y-m-d'], 'slot_id' => ['required', 'uuid'], 'reason' => ['required', 'string', 'max:255']]);
        Pedidos::visible($id, $request->user());

        return response()->json(PedidoController::detalle(Estados::reprogramar($id, $d['delivery_date'], $d['slot_id'], $d['reason'], $request->user()), $request->user()));
    }

    /** Franjas del local del pedido para una fecha (PED-02 y PED-08). */
    public function franjas(Request $request)
    {
        $d = $request->validate(['establishment_id' => ['required', 'uuid'], 'fecha' => ['required', 'date_format:Y-m-d'], 'zone_id' => ['nullable', 'uuid']]);

        return response()->json(Franjas::disponibles($d['establishment_id'], $d['fecha'], $d['zone_id'] ?? null));
    }

    /** PED-09: motivos del catálogo. */
    public function motivos(Request $request)
    {
        $d = $request->validate(['para' => ['nullable', Rule::in(['CANCEL', 'NOT_DELIVERED'])]]);

        return response()->json(DB::table('order_cancel_reasons')->where('status', 'ACTIVE')
            ->when($d['para'] ?? null, fn ($q, $p) => $q->whereIn('applies_to', [$p, 'BOTH']))
            ->orderBy('name')->get(['code', 'name', 'applies_to', 'requires_note', 'counts_as_loss']));
    }

    public function cancelar(Request $request, string $id)
    {
        $d = $request->validate(['reason_code' => ['required', 'string', 'max:40'], 'note' => ['nullable', 'string', 'max:255']]);
        Pedidos::visible($id, $request->user());

        return response()->json(PedidoController::detalle(Estados::cancelar($id, $d['reason_code'], $d['note'] ?? null, $request->user()), $request->user()));
    }

    public function noEntregado(Request $request, string $id)
    {
        $d = $request->validate(['reason_code' => ['required', 'string', 'max:40'], 'note' => ['nullable', 'string', 'max:255']]);
        Pedidos::visible($id, $request->user());

        return response()->json(PedidoController::detalle(Estados::noEntregado($id, $d['reason_code'], $d['note'] ?? null, $request->user()), $request->user()));
    }

    /** PED-05: resumen listo para enviar (RN-PED-12). */
    public function resumen(Request $request, string $id)
    {
        $o = Pedidos::visible($id, $request->user());
        $texto = Mensajes::resumen($o);

        return response()->json(['texto' => $texto, 'whatsapp' => Mensajes::enlaceWhatsapp($o, $texto),
            'confirmado_en' => $o->customer_confirmed_at, 'canal' => $o->confirmation_channel]);
    }

    public function confirmoCliente(Request $request, string $id)
    {
        $d = $request->validate(['channel' => ['required', Rule::in(['WHATSAPP', 'PHONE', 'WEB'])]]);
        Pedidos::visible($id, $request->user());

        return response()->json(PedidoController::detalle(Mensajes::confirmoCliente($id, $d['channel'], $request->user()), $request->user()));
    }

    /** PED-12 */
    public function saldo(Request $request, string $id)
    {
        $d = $request->validate(['mode' => ['required', Rule::in(['CUSTOMER_CREDIT', 'REFUND', 'COLLECT_ON_DELIVERY', 'PAYMENT_LINK', 'WAIVE'])],
            'note' => ['nullable', 'string', 'max:255']]);
        Pedidos::visible($id, $request->user());

        return response()->json(PedidoController::detalle(Estados::decidirSaldo($id, $d['mode'], $d['note'] ?? null, $request->user()), $request->user()));
    }

    public function cerrar(Request $request, string $id)
    {
        Pedidos::visible($id, $request->user());

        return response()->json(PedidoController::detalle(Estados::cerrar($id, $request->user()), $request->user()));
    }

    /** PED-12: pedidos entregados (o pesados) con diferencia entre lo pagado y el total. */
    public function saldos(Request $request)
    {
        $d = $request->validate(['vista' => ['nullable', Rule::in(['PENDIENTES', 'DECIDIDOS', 'TODOS'])]]);
        $q = DB::table('sales_orders as o')->leftJoin('customers as c', 'c.id', '=', 'o.customer_id')->leftJoin('brands as b', 'b.id', '=', 'o.brand_id')
            ->leftJoin('payment_methods as m', 'm.id', '=', 'o.payment_method_id')
            ->whereIn('o.status', ['WEIGHED', 'READY', 'IN_ROUTE', 'DELIVERED', 'CLOSED'])
            ->whereRaw('abs(o.paid_amount - coalesce(o.final_total, o.estimated_total)) > 0.005');
        Pedidos::alcance($q, $request->user());
        match ($d['vista'] ?? 'PENDIENTES') {
            'PENDIENTES' => $q->whereNull('o.balance_mode')->where('o.status', '<>', 'CLOSED'),
            'DECIDIDOS' => $q->whereNotNull('o.balance_mode'),
            default => $q,
        };
        $filas = $q->orderByDesc('o.delivery_date')->limit(300)->get([
            'o.id', 'o.number', 'o.status', 'o.delivery_date', 'o.estimated_total', 'o.final_total', 'o.paid_amount', 'o.balance_mode', 'o.balance_amount',
            'o.balance_decided_by_name', 'o.balance_decided_at', 'o.balance_note', DB::raw('coalesce(c.trade_name, c.full_name) as cliente'), 'b.name as marca', 'm.name as forma_pago',
            DB::raw('round(o.paid_amount - coalesce(o.final_total, o.estimated_total), 2) as diferencia'),
        ]);

        return response()->json([
            'filas' => $filas,
            'a_favor' => round($filas->where('diferencia', '>', 0)->sum('diferencia'), 2),
            'por_cobrar' => round(abs($filas->where('diferencia', '<', 0)->sum('diferencia')), 2),
            'max_condonar' => (float) (\App\Support\Params::get('ped_max_waive_amount') ?? 1),
        ]);
    }
}
