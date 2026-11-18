<?php

namespace App\Modulos\Ped\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Ped\Services\Pedidos;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * PED-14 Tablero del día: pedidos de hoy por franja y estado, confirmados sin preparar pasada la
 * hora de corte y pedidos en ruta. Con las cifras del mes (KPI-PED-01 a KPI-PED-10).
 */
class TableroController extends Controller
{
    public function dia(Request $request)
    {
        $d = $request->validate(['fecha' => ['nullable', 'date_format:Y-m-d'], 'establishment_id' => ['nullable', 'uuid'], 'brand' => ['nullable', 'string']]);
        $fecha = $d['fecha'] ?? now('America/Lima')->toDateString();
        $ahora = CarbonImmutable::now('America/Lima');
        $esHoy = $fecha === $ahora->toDateString();
        $u = $request->user();

        $base = fn () => Pedidos::alcance(DB::table('sales_orders as o'), $u)->where('o.delivery_date', $fecha)->where('o.status', '<>', 'CANCELLED')
            ->when($d['establishment_id'] ?? null, fn ($q, $v) => $q->where('o.establishment_id', $v))
            ->when(isset($d['brand']) && $d['brand'] !== 'ALL' ? $d['brand'] : null, fn ($q, $v) => $q->where('o.brand_id', $v));

        $franjas = DB::table('order_time_slots as s')->join('establishments as e', 'e.id', '=', 's.establishment_id')->leftJoin('delivery_zones as z', 'z.id', '=', 's.zone_id')
            ->where('s.status', 'ACTIVE')->when($d['establishment_id'] ?? null, fn ($q, $v) => $q->where('s.establishment_id', $v))
            ->orderBy('s.slot_from')->orderBy('e.name')->get(['s.id', 's.name', 's.slot_from', 's.slot_to', 's.cutoff', 's.capacity', 'e.name as local', 'z.name as zona']);
        $conteo = $base()->whereNotNull('o.slot_id')->groupBy('o.slot_id', 'o.status')->selectRaw('o.slot_id, o.status, count(*) as n')->get()->groupBy('slot_id');

        $porFranja = $franjas->map(function ($s) use ($conteo, $esHoy, $ahora) {
            $estados = ($conteo[$s->id] ?? collect())->pluck('n', 'status')->map(fn ($n) => (int) $n);

            return ['id' => $s->id, 'franja' => substr($s->slot_from, 0, 5).'–'.substr($s->slot_to, 0, 5), 'local' => $s->local, 'zona' => $s->zona,
                'corte' => substr($s->cutoff, 0, 5), 'paso_corte' => $esHoy && $ahora->format('H:i:s') >= $s->cutoff, 'cupo' => (int) $s->capacity,
                'ocupados' => $estados->only(Pedidos::OCUPAN_FRANJA)->sum(), 'borradores' => $estados['DRAFT'] ?? 0, 'estados' => $estados];
        })->filter(fn ($f) => $f['ocupados'] + $f['borradores'] > 0 || true)->values();

        $porEstado = $base()->groupBy('o.status')->selectRaw('o.status, count(*) as n')->pluck('n', 'status');
        $cols = ['o.id', 'o.number', 'o.status', 'o.slot_from', 'o.slot_to', 'o.estimated_total', 'o.fulfillment', DB::raw('coalesce(c.trade_name, c.full_name) as cliente'), 'z.name as zona'];
        $atrasados = $base()->join('order_time_slots as s', 's.id', '=', 'o.slot_id')->leftJoin('customers as c', 'c.id', '=', 'o.customer_id')
            ->leftJoin('delivery_zones as z', 'z.id', '=', 'o.zone_id')->where('o.status', 'CONFIRMED')
            ->when($esHoy, fn ($q) => $q->where('s.cutoff', '<=', $ahora->format('H:i:s')), fn ($q) => $q->whereRaw($fecha < $ahora->toDateString() ? 'true' : 'false'))
            ->orderBy('o.slot_from')->get(array_merge($cols, ['s.cutoff']));
        $enRuta = $base()->leftJoin('customers as c', 'c.id', '=', 'o.customer_id')->leftJoin('delivery_zones as z', 'z.id', '=', 'o.zone_id')
            ->leftJoin('users as r', 'r.id', '=', 'o.driver_user_id')->where('o.status', 'IN_ROUTE')->orderBy('o.slot_from')->get(array_merge($cols, ['r.name as repartidor']));

        return response()->json([
            'fecha' => $fecha, 'es_hoy' => $esHoy, 'hora' => $ahora->format('H:i'),
            'por_estado' => $porEstado, 'por_franja' => $porFranja, 'sin_preparar' => $atrasados, 'en_ruta' => $enRuta,
            'sin_franja' => $base()->whereNull('o.slot_id')->count(),
            'total' => round((float) $base()->whereNotIn('o.status', ['DRAFT'])->sum(DB::raw('coalesce(o.final_total, o.estimated_total)')), 2),
        ]);
    }

    /** KPI-PED-01 a 10 del mes. */
    public function kpis(Request $request)
    {
        $d = $request->validate(['mes' => ['nullable', 'date_format:Y-m']]);
        $desde = CarbonImmutable::parse(($d['mes'] ?? now('America/Lima')->format('Y-m')).'-01', 'America/Lima');
        $hasta = $desde->addMonth();
        $u = $request->user();
        $mes = fn () => Pedidos::alcance(DB::table('sales_orders as o'), $u)->where('o.delivery_date', '>=', $desde->toDateString())->where('o.delivery_date', '<', $hasta->toDateString());
        $entregados = fn () => $mes()->whereIn('o.status', ['DELIVERED', 'CLOSED']);
        $confirmados = fn () => $mes()->whereNotNull('o.confirmed_at');

        $ventas = (float) $entregados()->sum(DB::raw('coalesce(o.final_total, o.estimated_total)'));
        $nEnt = $entregados()->count();
        $nConf = $confirmados()->count();
        $incompletos = $confirmados()->whereRaw('coalesce(o.imported, false)')->where(fn ($q) => $q->whereNull('o.payment_method_id')
            ->orWhere(fn ($w) => $w->where('o.fulfillment', 'DELIVERY')->whereNull('o.address_id')))->count();
        $kg = DB::table('sales_order_lines as l')->joinSub($entregados()->select('o.id'), 'e', 'e.id', '=', 'l.sales_order_id')
            ->where('l.price_basis', 'KG')->whereNotNull('l.weighed_kg')->selectRaw('coalesce(sum(l.weighed_kg),0) r, coalesce(sum(l.est_weight_kg),0) e')->first();
        $cancel = $confirmados()->where('o.status', 'CANCELLED')->count();
        $repro = $confirmados()->where('o.reschedule_count', '>', 0)->count();
        $desc = (float) $entregados()->sum('o.discount_total');
        $pesados = $mes()->whereIn('o.weight_diff_status', ['WITHIN_TOLERANCE', 'NOTICE_REQUIRED', 'NOTICE_SENT'])->count();
        $avisos = $mes()->whereIn('o.weight_diff_status', ['NOTICE_REQUIRED', 'NOTICE_SENT'])->count();
        $dias = max(1, $confirmados()->distinct()->count('o.delivery_date'));
        $mediana = $confirmados()->whereColumn('o.confirmed_at', '>=', 'o.created_at')
            ->selectRaw('percentile_cont(0.5) within group (order by extract(epoch from (o.confirmed_at - o.created_at)) / 60) as m')->value('m');
        $pct = fn ($a, $b) => $b ? round($a / $b * 100, 1) : 0.0;

        return response()->json([
            'mes' => $desde->format('Y-m'),
            'ventas' => round($ventas, 2),
            'por_canal' => $entregados()->groupBy('o.channel')->selectRaw('o.channel as canal, count(*) as n, round(sum(coalesce(o.final_total, o.estimated_total)), 2) as ventas')->orderByDesc('ventas')->get(),
            'por_marca' => $entregados()->join('brands as b', 'b.id', '=', 'o.brand_id')->groupBy('b.name')->selectRaw('b.name as marca, count(*) as n, round(sum(coalesce(o.final_total, o.estimated_total)), 2) as ventas')->orderByDesc('ventas')->get(),
            'ticket' => $nEnt ? round($ventas / $nEnt, 2) : 0.0,
            'entregados' => $nEnt, 'confirmados' => $nConf,
            'incompletos_pct' => $pct($incompletos, $nConf),
            'peso_pct' => (float) $kg->e > 0 ? round(((float) $kg->r - (float) $kg->e) / (float) $kg->e * 100, 1) : 0.0,
            'cancelados_pct' => $pct($cancel, $nConf),
            'cancelados_por_motivo' => $confirmados()->where('o.status', 'CANCELLED')->leftJoin('order_cancel_reasons as m', 'm.code', '=', 'o.cancel_reason')
                ->groupBy('m.name')->selectRaw("coalesce(m.name, 'Sin motivo') as motivo, count(*) as n")->orderByDesc('n')->get(),
            'reprogramados_pct' => $pct($repro, $nConf),
            'descuentos_pct' => $pct($desc, $ventas + $desc),
            'por_dia' => round($nConf / $dias, 1),
            'avisos_pct' => $pct($avisos, $pesados),
            'confirmacion_min' => $mediana !== null ? round((float) $mediana, 0) : null,
        ]);
    }
}
