<?php

namespace App\Modulos\Del\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Del\Services\Base;
use App\Modulos\Del\Services\Consultas;
use App\Modulos\Del\Services\Extras;
use App\Modulos\Del\Services\NoEntregados;
use App\Modulos\Int\Services\Archivos;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * Bandejas de la coordinación: DEL-16 No entregados, DEL-19 Calidad de direcciones, DEL-20 Apoyo y
 * derivaciones, DEL-22 Mensajes del reparto y anulación de gastos del repartidor.
 */
class ControlController extends Controller
{
    use Entrada;

    /* ---------- DEL-16 ---------- */

    public function noEntregados(Request $request)
    {
        $d = $request->validate(['estado' => ['nullable', Rule::in(['PENDIENTES', 'TODOS'])], 'desde' => ['nullable', 'date_format:Y-m-d'], 'hasta' => ['nullable', 'date_format:Y-m-d']]);
        [$desde, $hasta] = Consultas::ventana($d['desde'] ?? null, $d['hasta'] ?? null);

        return response()->json(['data' => Consultas::noEntregados($request->user(), $d['estado'] ?? 'PENDIENTES', $desde, $hasta)]);
    }

    public function recibirBolsas(Request $request, string $id)
    {
        $d = $request->validate(['note' => ['nullable', 'string', 'max:200']]);

        return response()->json(NoEntregados::recibirBolsas($id, $d['note'] ?? null, $request->user()));
    }

    public function reprogramar(Request $request, string $id)
    {
        $d = $request->validate(['date' => ['required', 'date_format:Y-m-d'], 'slot_id' => ['required', 'uuid'], 'reason' => ['required', 'string', 'min:3', 'max:255']]);

        return response()->json(NoEntregados::reprogramar($id, $d['date'], $d['slot_id'], $d['reason'], $request->user()));
    }

    /* ---------- DEL-19 ---------- */

    public function direcciones(Request $request)
    {
        $d = $request->validate(['fecha' => ['nullable', 'date_format:Y-m-d'], 'nivel' => ['nullable', Rule::in(['OK', 'REVIEW', 'BAD'])]]);

        return response()->json(['data' => Consultas::direcciones($d['fecha'] ?? Base::hoy(), $request->user(), $d['nivel'] ?? null)]);
    }

    private function direccionVisible(string $addressId, Request $request): void
    {
        $ok = DB::table('sales_orders')->where('address_id', $addressId)->when(Base::locales($request->user()), fn ($w, $l) => $w->whereIn('establishment_id', $l))->exists();
        if (! $ok) {
            abort(404, 'No se encontró la dirección.');
        }
    }

    public function confirmarDireccion(Request $request, string $id)
    {
        $d = $request->validate(['note' => ['nullable', 'string', 'max:255']]);
        $this->direccionVisible($id, $request);
        Extras::confirmarDireccion($id, $d['note'] ?? null, $request->user());

        return response()->json(['ok' => true]);
    }

    public function senal(Request $request, string $id)
    {
        $d = $request->validate(['call_signal' => ['nullable', Rule::in(['OK', 'WHATSAPP_ONLY', 'NO_SIGNAL'])]]);
        $this->direccionVisible($id, $request);
        Extras::senal($id, $d['call_signal'] ?? null);

        return response()->json(['ok' => true]);
    }

    public function pedirUbicacion(Request $request, string $orderId)
    {
        $o = DB::table('sales_orders')->where('id', $orderId)->first(['id', 'establishment_id']);
        if (! $o || ! Base::veLocal($request->user(), $o->establishment_id)) {
            abort(404, 'No se encontró el pedido.');
        }

        return response()->json(Extras::pedirUbicacion($orderId, $request->user()));
    }

    /* ---------- DEL-20 ---------- */

    public function apoyos(Request $request)
    {
        $d = $request->validate(['fecha' => ['nullable', 'date_format:Y-m-d']]);
        $fecha = $d['fecha'] ?? Base::hoy();
        $u = $request->user();
        $rutas = Base::alcance(DB::table('delivery_routes as r'), $u)->leftJoin('users as d', 'd.id', '=', 'r.driver_user_id')
            ->where('r.route_date', $fecha)->where('r.status', 'IN_ROUTE')->orderBy('r.code')->get(['r.*', 'd.name as repartidor']);
        $pedidos = DB::table('support_requests as q')->join('delivery_routes as r', 'r.id', '=', 'q.route_id')->leftJoin('users as d', 'd.id', '=', 'q.requested_by')
            ->leftJoin('delivery_routes as t', 't.id', '=', 'q.target_route_id')->leftJoin('users as rs', 'rs.id', '=', 'q.resolved_by')
            ->when(Base::locales($u), fn ($w, $l) => $w->whereIn('r.establishment_id', $l))
            ->where(fn ($w) => $w->where('q.status', 'REQUESTED')->orWhere('r.route_date', $fecha))
            ->orderByRaw("CASE q.status WHEN 'REQUESTED' THEN 0 ELSE 1 END")->orderByDesc('q.requested_at')
            ->get(['q.*', 'r.code as ruta', 'd.name as pedido_por', 't.code as ruta_apoyo', 'rs.name as resuelto_por']);
        $derivaciones = DB::table('external_handoffs as h')->join('delivery_routes as r', 'r.id', '=', 'h.route_id')->join('sales_orders as o', 'o.id', '=', 'h.order_id')
            ->leftJoin('users as c', 'c.id', '=', 'h.closed_by')
            ->when(Base::locales($u), fn ($w, $l) => $w->whereIn('r.establishment_id', $l))
            ->where(fn ($w) => $w->where('h.status', 'HANDED')->orWhere('r.route_date', $fecha))
            ->orderByRaw("CASE h.status WHEN 'HANDED' THEN 0 ELSE 1 END")->orderByDesc('h.handed_at')
            ->get(['h.*', 'r.code as ruta', 'o.number as pedido', 'o.customer_id', 'c.name as cerrado_por']);
        $paradas = DB::table('delivery_stops')->whereIn('id', $pedidos->pluck('stop_ids')->flatMap(fn ($x) => json_decode($x ?: '[]', true) ?: [])->unique()->values())
            ->get(['id', 'seq', 'status', 'route_id'])->keyBy('id');

        return response()->json([
            'rutas' => $rutas->map(fn ($r) => ['id' => $r->id, 'code' => $r->code, 'repartidor' => $r->repartidor, 'riesgo' => Extras::riesgo($r)]),
            'pedidos' => $pedidos->map(fn ($q) => (array) $q + ['paradas' => collect(json_decode($q->stop_ids ?: '[]', true) ?: [])->map(fn ($i) => $paradas[$i] ?? null)->filter()->values()]),
            'derivaciones' => $derivaciones->map(fn ($h) => (array) $h + ['cliente' => Base::cliente($h->customer_id)]),
        ]);
    }

    public function resolverApoyo(Request $request, string $id)
    {
        $d = $request->validate(['action' => ['required', Rule::in(['ASSIGN', 'EXTERNAL', 'REJECT'])], 'to_route_id' => ['nullable', 'uuid'], 'note' => ['nullable', 'string', 'max:255']]);

        return response()->json(Extras::resolverApoyo($id, $d, $request->user()));
    }

    public function cerrarDerivacion(Request $request, string $id)
    {
        $d = $request->validate(['delivered' => ['required', 'boolean'], 'note' => ['nullable', 'string', 'max:255'],
            'method' => ['nullable', Rule::in(array_keys(Base::MEDIOS_COBRO))], 'reference' => ['nullable', 'string', 'max:60'], 'card_last4' => ['nullable', 'digits:4']]);

        return response()->json(Extras::cerrarDerivacion($id, $d, $request->user()));
    }

    /* ---------- DEL-22 ---------- */

    public function mensajes(Request $request)
    {
        $d = $request->validate(['estado' => ['nullable', Rule::in(['SENT', 'READ', 'CONFIRMED', 'REJECTED', 'ABIERTOS'])], 'fecha' => ['nullable', 'date_format:Y-m-d']]);
        $u = $request->user();
        $estado = $d['estado'] ?? 'ABIERTOS';
        $m = DB::table('driver_messages as m')->join('delivery_routes as r', 'r.id', '=', 'm.route_id')->leftJoin('users as f', 'f.id', '=', 'm.from_user_id')
            ->leftJoin('delivery_stops as s', 's.id', '=', 'm.stop_id')->leftJoin('sales_orders as o', 'o.id', '=', 's.order_id')->leftJoin('users as a', 'a.id', '=', 'm.ack_by')
            ->when(Base::locales($u), fn ($w, $l) => $w->whereIn('r.establishment_id', $l))
            ->when($estado === 'ABIERTOS', fn ($w) => $w->where('m.status', 'SENT'), fn ($w) => $w->where('m.status', $estado))
            ->when($d['fecha'] ?? null, fn ($w, $f) => $w->where('r.route_date', $f))
            ->orderByDesc('m.created_at')->limit(200)
            ->get(['m.*', 'r.code as ruta', 'f.name as de', 's.seq', 'o.number as pedido', 'a.name as atendido_por']);

        return response()->json(['data' => $m->map(fn ($x) => (array) $x + ['para' => Extras::DESTINOS[$x->to_role] ?? $x->to_role]),
            'pendientes' => DB::table('driver_messages as m')->join('delivery_routes as r', 'r.id', '=', 'm.route_id')->where('m.status', 'SENT')
                ->when(Base::locales($u), fn ($w, $l) => $w->whereIn('r.establishment_id', $l))->count()]);
    }

    public function responder(Request $request, string $id)
    {
        $d = $request->validate(['status' => ['required', Rule::in(['READ', 'CONFIRMED', 'REJECTED'])], 'reply' => ['nullable', 'string', 'max:500'],
            'confirmed_amount' => ['nullable', 'numeric', 'min:0']]);

        return response()->json(Extras::responder($id, $d, $request->user()));
    }

    public function anularGasto(Request $request, string $id)
    {
        $d = $request->validate(['reason' => ['required', 'string', 'min:3', 'max:255']]);

        return response()->json(Extras::anularGasto($id, $d['reason'], $request->user()));
    }

    /* ---------- Fotos y audios del reparto ---------- */

    /** Enlace temporal a una foto, firma o audio del reparto, solo si es de una ruta que el usuario ve. */
    public function archivo(Request $request, string $id)
    {
        $ruta = DB::table('delivery_events')->where(fn ($w) => $w->where('photo_file_id', $id)->orWhere('signature_file_id', $id))->value('route_id')
            ?? DB::table('driver_expenses')->where('photo_file_id', $id)->value('route_id')
            ?? DB::table('driver_messages')->where(fn ($w) => $w->where('audio_file_id', $id)->orWhere('photo_file_id', $id))->value('route_id')
            ?? DB::table('external_handoffs')->where(fn ($w) => $w->where('photo_courier', $id)->orWhere('photo_plate', $id)->orWhere('photo_product', $id))->value('route_id');
        if (! $ruta) {
            abort(404, 'No se encontró el archivo.');
        }
        Base::rutaVisible($ruta, $request->user());

        return response()->json(Archivos::enlace($id, $request->user()));
    }
}
