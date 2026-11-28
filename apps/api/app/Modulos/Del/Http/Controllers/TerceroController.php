<?php

namespace App\Modulos\Del\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Del\Services\Base;
use App\Modulos\Del\Services\Terceros;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/** DEL-09 Empresas de delivery y tarifas y DEL-10 Conciliación de facturas (RN-DEL-11). */
class TerceroController extends Controller
{
    public function empresas(Request $request)
    {
        $hoy = Base::hoy();
        $tarifas = DB::table('carrier_rates as t')->leftJoin('delivery_zones as z', 'z.id', '=', 't.zone_id')->orderByDesc('t.valid_from')
            ->get(['t.*', 'z.name as zona'])->groupBy('supplier_id');
        $data = Terceros::empresas()->map(function ($e) use ($tarifas, $hoy) {
            $ts = ($tarifas[$e->id] ?? collect())->map(fn ($t) => (array) $t + ['base' => Terceros::BASES[$t->rate_basis] ?? $t->rate_basis,
                'vigente' => $t->status === 'ACTIVE' && $t->valid_from <= $hoy && (! $t->valid_to || $t->valid_to >= $hoy)])->values();
            $mes = substr($hoy, 0, 7);

            return (array) $e + ['tarifas' => $ts, 'vigente' => Terceros::tarifa($e->id, null, $hoy),
                'rutas_mes' => DB::table('delivery_routes')->where('carrier_supplier_id', $e->id)->where('route_date', 'like', $mes.'%')->where('status', '<>', 'CANCELLED')->count()];
        });

        return response()->json(['data' => $data, 'bases' => Terceros::BASES]);
    }

    private function datosTarifa(Request $request): array
    {
        return $request->validate(['supplier_id' => ['required', 'uuid'], 'zone_id' => ['nullable', 'uuid'], 'rate_basis' => ['required', Rule::in(array_keys(Terceros::BASES))],
            'amount' => ['required', 'numeric', 'min:0', 'max:99999'], 'valid_from' => ['required', 'date_format:Y-m-d'], 'valid_to' => ['nullable', 'date_format:Y-m-d']]);
    }

    public function crearTarifa(Request $request)
    {
        return response()->json(Terceros::guardarTarifa(null, $this->datosTarifa($request), $request->user()), 201);
    }

    public function editarTarifa(Request $request, string $id)
    {
        return response()->json(Terceros::guardarTarifa($id, $this->datosTarifa($request), $request->user()));
    }

    public function anularTarifa(Request $request, string $id)
    {
        $d = $request->validate(['reason' => ['required', 'string', 'min:3', 'max:255']]);
        Terceros::anularTarifa($id, $d['reason']);

        return response()->json(['ok' => true]);
    }

    public function facturas(Request $request)
    {
        $d = $request->validate(['supplier_id' => ['nullable', 'uuid']]);
        $f = DB::table('carrier_invoices as f')->join('suppliers as s', 's.id', '=', 'f.supplier_id')->leftJoin('users as u', 'u.id', '=', 'f.reconciled_by')
            ->when($d['supplier_id'] ?? null, fn ($w, $v) => $w->where('f.supplier_id', $v))
            ->orderByDesc('f.issue_date')->limit(200)->get(['f.*', 's.trade_name as empresa', 'u.name as conciliado_por']);

        return response()->json(['data' => $f, 'tolerancia' => Base::num('del_carrier_tolerance_pen', 2)]);
    }

    public function factura(string $id)
    {
        $f = DB::table('carrier_invoices as f')->join('suppliers as s', 's.id', '=', 'f.supplier_id')->where('f.id', $id)->first(['f.*', 's.trade_name as empresa']);
        if (! $f) {
            abort(404, 'No se encontró la factura.');
        }
        $lineas = DB::table('carrier_invoice_lines as l')->leftJoin('delivery_stops as st', 'st.id', '=', 'l.stop_id')->leftJoin('delivery_routes as r', 'r.id', '=', 'st.route_id')
            ->where('l.invoice_id', $id)->orderByRaw("CASE l.match_status WHEN 'MATCHED' THEN 3 ELSE 0 END")->orderBy('l.external_ref')
            ->get(['l.*', 'r.code as ruta', 'r.route_date']);

        return response()->json(['factura' => $f, 'lineas' => $lineas->map(fn ($l) => (array) $l + ['estado' => Terceros::LINEAS[$l->match_status] ?? $l->match_status])]);
    }

    /** Envíos de la empresa en el período con lo esperado (antes de registrar la factura). */
    public function envios(Request $request)
    {
        $d = $request->validate(['supplier_id' => ['required', 'uuid'], 'period_from' => ['required', 'date_format:Y-m-d'], 'period_to' => ['required', 'date_format:Y-m-d']]);
        $e = Terceros::envios($d['supplier_id'], $d['period_from'], $d['period_to']);
        $lista = $e->map(fn ($x) => (array) $x + ['esperado' => round(Terceros::esperadoDe($d['supplier_id'], $x, $e), 2)]);

        return response()->json(['data' => $lista, 'total' => round($lista->sum('esperado'), 2), 'envios' => $lista->count()]);
    }

    public function conciliar(Request $request)
    {
        $d = $request->validate(['supplier_id' => ['required', 'uuid'], 'invoice_number' => ['required', 'string', 'max:40'], 'issue_date' => ['nullable', 'date_format:Y-m-d'],
            'period_from' => ['required', 'date_format:Y-m-d'], 'period_to' => ['required', 'date_format:Y-m-d'], 'amount' => ['required', 'numeric', 'min:0', 'max:9999999'],
            'lines' => ['nullable', 'array', 'max:2000'], 'lines.*.ref' => ['required', 'string', 'max:40'], 'lines.*.amount' => ['required', 'numeric', 'min:0']]);

        return response()->json(Terceros::conciliar($d, $request->user()), 201);
    }
}
