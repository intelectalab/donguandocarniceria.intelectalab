<?php

namespace App\Modulos\Del\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Del\Services\Base;
use App\Modulos\Del\Services\Consultas;
use App\Modulos\Del\Services\Liquidaciones;
use App\Modulos\Del\Services\Seguimiento;
use App\Support\RuleError;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** DEL-07 Seguimiento en mapa, DEL-08 Enlace de seguimiento (público) y DEL-06 Liquidación del repartidor. */
class SeguimientoController extends Controller
{
    use Entrada;

    public function mapa(Request $request)
    {
        $d = $request->validate(['fecha' => ['nullable', 'date_format:Y-m-d'], 'establishment_id' => ['nullable', 'uuid']]);

        return response()->json(Seguimiento::mapa($d['fecha'] ?? Base::hoy(), $request->user(), $d['establishment_id'] ?? null));
    }

    /** Enlace del pedido para compartirlo; la web arma la dirección completa con el token. */
    public function enlace(Request $request, string $orderId)
    {
        $o = DB::table('sales_orders')->where('id', $orderId)->first(['id', 'number', 'establishment_id', 'fulfillment', 'status']);
        if (! $o || ! Base::veLocal($request->user(), $o->establishment_id)) {
            abort(404, 'No se encontró el pedido.');
        }
        if ($o->fulfillment !== 'DELIVERY') {
            RuleError::fail('RN-DEL-08', "El pedido {$o->number} no es de delivery.");
        }
        $t = Seguimiento::enlace($o->id);

        return response()->json(['token' => $t->token, 'expires_at' => $t->expires_at, 'pedido' => $o->number]);
    }

    public function anular(Request $request, string $orderId)
    {
        $o = DB::table('sales_orders')->where('id', $orderId)->first(['id', 'establishment_id']);
        if (! $o || ! Base::veLocal($request->user(), $o->establishment_id)) {
            abort(404, 'No se encontró el pedido.');
        }
        Seguimiento::anular($o->id);

        return response()->json(['ok' => true]);
    }

    /** Sin sesión: la empresa sale del token. Solo estado, hora estimada y nombre de pila (RN-DEL-08). */
    public function publico(string $token)
    {
        return response()->json(Seguimiento::publico($token));
    }

    /* ---------- DEL-06 Liquidación ---------- */

    public function liquidaciones(Request $request)
    {
        $d = $request->validate(['desde' => ['nullable', 'date_format:Y-m-d'], 'hasta' => ['nullable', 'date_format:Y-m-d'], 'estado' => ['nullable', 'string', 'max:20']]);
        [$desde, $hasta] = Consultas::ventana($d['desde'] ?? null, $d['hasta'] ?? null);
        $u = $request->user();
        $porLiquidar = Base::alcance(DB::table('delivery_routes as r'), $u)->leftJoin('users as d', 'd.id', '=', 'r.driver_user_id')
            ->where('r.status', 'RETURNED')->where('r.mode', '<>', 'THIRD_PARTY')
            ->when(Base::soloSusRutas($u), fn ($w) => $w->where('r.driver_user_id', $u->id))
            ->orderBy('r.route_date')->get(['r.id', 'r.code', 'r.route_date', 'r.returned_at', 'd.name as repartidor'])
            ->map(fn ($r) => (array) $r + ['esperado' => Liquidaciones::esperado($r->id), 'liquidacion' => Liquidaciones::deRuta($r->id)]);
        $hechas = DB::table('driver_settlements as l')->join('delivery_routes as r', 'r.id', '=', 'l.route_ref')->leftJoin('users as d', 'd.id', '=', 'l.driver_user_id')
            ->leftJoin('users as rc', 'rc.id', '=', 'l.received_by')->leftJoin('users as ap', 'ap.id', '=', 'l.approved_by')
            ->whereBetween('l.settlement_date', [$desde, $hasta])->when(Base::locales($u), fn ($w, $l) => $w->whereIn('r.establishment_id', $l))
            ->when(Base::soloSusRutas($u), fn ($w) => $w->where('l.driver_user_id', $u->id))
            ->when($d['estado'] ?? null, fn ($w, $e) => $w->where('l.status', $e))
            ->orderByDesc('l.settled_at')->limit(200)
            ->get(['l.*', 'r.code as ruta', 'd.name as repartidor', 'rc.name as recibido_por', 'ap.name as aprobado_por']);

        return response()->json(['por_liquidar' => $porLiquidar, 'liquidaciones' => $hechas, 'estados' => Liquidaciones::ESTADOS]);
    }

    public function liquidacion(Request $request, string $routeId)
    {
        $r = Base::rutaVisible($routeId, $request->user());

        return response()->json(['ruta' => ['id' => $r->id, 'code' => $r->code, 'status' => $r->status, 'mode' => $r->mode, 'route_date' => $r->route_date,
            'repartidor' => $r->driver_user_id ? DB::table('users')->where('id', $r->driver_user_id)->value('name') : null, 'es_mia' => $r->driver_user_id === $request->user()->id],
            'esperado' => Liquidaciones::esperado($r->id), 'liquidacion' => Liquidaciones::deRuta($r->id)]);
    }

    public function liquidar(Request $request, string $routeId)
    {
        $d = $request->validate(['counted_cash' => ['required', 'numeric', 'min:0', 'max:999999'], 'reason' => ['nullable', 'string', 'max:255']]);

        return response()->json(Liquidaciones::liquidar($routeId, (float) $d['counted_cash'], $d['reason'] ?? null, $request->user()), 201);
    }

    public function aprobar(Request $request, string $id)
    {
        $d = $request->validate(['note' => ['nullable', 'string', 'max:255']]);

        return response()->json(Liquidaciones::aprobar($id, $d['note'] ?? null, $request->user()));
    }
}
