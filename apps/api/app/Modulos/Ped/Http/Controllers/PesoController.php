<?php

namespace App\Modulos\Ped\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Ped\Services\Mensajes;
use App\Modulos\Ped\Services\Pedidos;
use App\Modulos\Ped\Services\Pesos;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/** PED-07 Diferencia de peso: pesados sobre la tolerancia, mensaje sugerido, envío y respuesta (RN-PED-05). */
class PesoController extends Controller
{
    public function index(Request $request)
    {
        $d = $request->validate(['vista' => ['nullable', Rule::in(['PENDIENTES', 'AVISADOS', 'TODOS'])]]);
        $q = DB::table('sales_orders as o')->leftJoin('customers as c', 'c.id', '=', 'o.customer_id')->leftJoin('brands as b', 'b.id', '=', 'o.brand_id')
            ->whereNotIn('o.status', ['CANCELLED']);
        match ($d['vista'] ?? 'PENDIENTES') {
            'PENDIENTES' => $q->where('o.weight_diff_status', 'NOTICE_REQUIRED'),
            'AVISADOS' => $q->where('o.weight_diff_status', 'NOTICE_SENT'),
            default => $q->whereIn('o.weight_diff_status', ['NOTICE_REQUIRED', 'NOTICE_SENT']),
        };
        Pedidos::alcance($q, $request->user());
        $filas = $q->orderByDesc('o.delivery_date')->orderBy('o.slot_from')->limit(200)
            ->get(['o.id', 'o.number', 'o.status', 'o.delivery_date', 'o.slot_from', 'o.slot_to', 'o.estimated_total', 'o.final_total', 'o.weight_diff_status',
                DB::raw('coalesce(c.trade_name, c.full_name) as cliente'), 'c.phone as celular', 'b.name as marca']);
        $avisos = DB::table('order_weight_notices')->whereIn('order_id', $filas->pluck('id'))->orderByDesc('sent_at')->get()->groupBy('order_id');

        return response()->json($filas->map(fn ($o) => (array) $o + [
            'diferencia_pct' => (float) $o->estimated_total > 0 && $o->final_total !== null ? round(((float) $o->final_total - (float) $o->estimated_total) / (float) $o->estimated_total * 100, 1) : null,
            'avisos' => ($avisos[$o->id] ?? collect())->values(),
        ])->values());
    }

    public function show(Request $request, string $id)
    {
        $o = Pedidos::visible($id, $request->user());
        $texto = Mensajes::avisoPeso($o);

        return response()->json([
            'evaluacion' => Pesos::evaluar($o), 'mensaje' => $texto, 'whatsapp' => Mensajes::enlaceWhatsapp($o, $texto),
            'avisos' => DB::table('order_weight_notices')->where('order_id', $o->id)->orderBy('sent_at')->get(),
            'plantillas_enviadas' => DB::table('order_weight_notices')->where('order_id', $o->id)->where('channel', 'WHATSAPP')->count(),
            'espera_respuesta' => strtolower((string) \App\Support\Params::get('ped_weight_notice_wait_response', ['brand' => $o->brand_id])) === 'true',
        ]);
    }

    public function avisar(Request $request, string $id)
    {
        $d = $request->validate(['channel' => ['required', Rule::in(['WHATSAPP', 'PHONE'])], 'message' => ['nullable', 'string', 'max:1500']]);
        Pedidos::visible($id, $request->user());

        return response()->json(Pesos::avisar($id, $d['channel'], $d['message'] ?? null, $request->user()), 201);
    }

    public function respuesta(Request $request, string $id)
    {
        $d = $request->validate(['response' => ['required', Rule::in(['ACCEPTED', 'REJECTED', 'NO_RESPONSE'])]]);
        $n = DB::table('order_weight_notices')->where('id', $id)->first() ?? abort(404);
        Pedidos::visible($n->order_id, $request->user());

        return response()->json(Pesos::respuesta($id, $d['response'], $request->user()));
    }
}
