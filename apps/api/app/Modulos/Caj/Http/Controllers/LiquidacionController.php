<?php

namespace App\Modulos\Caj\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Caj\Services\Base;
use App\Modulos\Caj\Services\Liquidaciones;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** CAJ-06 Caja del repartidor y CAJ-07 Liquidación del repartidor. */
class LiquidacionController extends Controller
{
    public function caja(Request $request)
    {
        $d = $request->validate(['fecha' => ['nullable', 'date_format:Y-m-d'], 'establishment_id' => ['nullable', 'uuid']]);

        return response()->json(Liquidaciones::cajaDelDia($d['fecha'] ?? Base::hoy(), $request->user(), $d['establishment_id'] ?? null));
    }

    public function index(Request $request)
    {
        $d = $request->validate(['desde' => ['nullable', 'date_format:Y-m-d'], 'hasta' => ['nullable', 'date_format:Y-m-d'], 'estado' => ['nullable', 'in:SETTLED,WITH_DIFFERENCE,APPROVED']]);
        $desde = $d['desde'] ?? CarbonImmutable::parse(Base::hoy())->subDays(14)->toDateString();

        return response()->json(Liquidaciones::lista($request->user(), $desde, $d['hasta'] ?? Base::hoy(), $d['estado'] ?? null));
    }

    public function ruta(Request $request, string $routeId)
    {
        $r = DB::table('delivery_routes as r')->leftJoin('users as d', 'd.id', '=', 'r.driver_user_id')->where('r.id', $routeId)
            ->first(['r.id', 'r.code', 'r.route_date', 'r.status', 'r.mode', 'r.establishment_id', 'r.driver_user_id', 'd.name as repartidor']);
        $l = Base::locales($request->user());
        if (! $r || ($l && ! in_array($r->establishment_id, $l, true))) {
            abort(404, 'No se encontró la ruta.');
        }

        return response()->json(['ruta' => $r, 'esperado' => Liquidaciones::esperado($r->id), 'liquidacion' => Liquidaciones::deRuta($r->id),
            'tolerancia' => Liquidaciones::tolerancia($r->establishment_id), 'cajas' => Liquidaciones::receptoras($r->establishment_id)]);
    }

    public function liquidar(Request $request, string $routeId)
    {
        $d = $request->validate(['counted_cash' => ['required', 'numeric', 'min:0', 'max:999999'], 'reason' => ['nullable', 'string', 'max:255'],
            'receiving_account_id' => ['nullable', 'uuid']]);

        return response()->json(Liquidaciones::registrar($routeId, (float) $d['counted_cash'], $d['reason'] ?? null, $request->user(), $d['receiving_account_id'] ?? null), 201);
    }

    public function aprobar(Request $request, string $id)
    {
        $d = $request->validate(['note' => ['nullable', 'string', 'max:255']]);

        return response()->json(Liquidaciones::aprobar($id, $d['note'] ?? null, $request->user()));
    }
}
