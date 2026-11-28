<?php

namespace App\Modulos\Pre\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Alm\Services\InventarioService;
use App\Modulos\Pre\Services\Base;
use App\Modulos\Pre\Services\Olas;
use App\Modulos\Pre\Services\Tareas;
use App\Support\Access;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** PRE-01 Planificador de olas y PRE-02 Lista consolidada. */
class OlaController extends Controller
{
    /** Locales del alcance del usuario (para el selector). */
    public static function locales($u): array
    {
        $a = Access::for($u);

        return DB::table('establishments')->where('status', 'ACTIVE')->when($a['establishments'], fn ($q, $v) => $q->whereIn('id', $v))
            ->orderBy('name')->get(['id', 'code', 'name'])->all();
    }

    /** PRE-01: pedidos confirmados sin ola, agrupados por local y franja, y las olas del día. */
    public function planificador(Request $request)
    {
        $d = $request->validate(['fecha' => ['nullable', 'date_format:Y-m-d'], 'establishment_id' => ['nullable', 'uuid'], 'brand' => ['nullable', 'string']]);
        $u = $request->user();
        $fecha = $d['fecha'] ?? Base::hoy();
        $local = $d['establishment_id'] ?? null;
        $marca = isset($d['brand']) && $d['brand'] !== 'ALL' ? $d['brand'] : null;

        $pedidos = fn () => Base::alcanceTareas(DB::table('sales_orders as o'), $u, 'o')->where('o.delivery_date', $fecha)
            ->when($local, fn ($q, $v) => $q->where('o.establishment_id', $v))->when($marca, fn ($q, $v) => $q->where('o.brand_id', $v));

        $libres = $pedidos()->whereIn('o.status', ['CONFIRMED', 'IN_PREPARATION'])->where('o.fulfillment', '<>', 'COUNTER')
            ->whereNotExists(fn ($x) => $x->from('picking_tasks as t')->join('picking_waves as w', 'w.id', '=', 't.wave_id')
                ->whereColumn('t.order_id', 'o.id')->where('t.status', '<>', 'CANCELLED')->whereNotIn('w.status', ['CANCELLED', 'CLOSED']))
            ->leftJoin('customers as c', 'c.id', '=', 'o.customer_id')->leftJoin('delivery_zones as z', 'z.id', '=', 'o.zone_id')
            ->leftJoin('establishments as e', 'e.id', '=', 'o.establishment_id')->leftJoin('brands as b', 'b.id', '=', 'o.brand_id')
            ->orderBy('o.slot_from')->orderBy('z.code')->orderBy('o.number')
            ->get(['o.id', 'o.number', 'o.status', 'o.fulfillment', 'o.establishment_id', 'o.slot_from', 'o.slot_to', 'o.units', 'o.est_kg', 'o.needs_stock',
                DB::raw('coalesce(c.trade_name, c.full_name) as cliente'), 'z.code as zona', 'e.name as local', 'b.name as marca']);
        $grupos = $libres->groupBy(fn ($o) => $o->establishment_id.'|'.($o->slot_from ?? '').'|'.($o->slot_to ?? ''))->map(function ($os, $k) {
            [$est, $de, $a] = explode('|', $k);

            return ['establishment_id' => $est, 'local' => $os->first()->local, 'slot_from' => $de ?: null, 'slot_to' => $a ?: null,
                'franja' => $de ? substr($de, 0, 5).'–'.substr($a, 0, 5) : 'Sin franja',
                'pedidos' => $os->map(fn ($o) => ['id' => $o->id, 'number' => $o->number, 'cliente' => $o->cliente, 'zona' => $o->fulfillment === 'PICKUP' ? 'Recojo' : ($o->fulfillment === 'PROVINCE_SHIPPING' ? 'Provincia' : $o->zona),
                    'marca' => $o->marca, 'unidades' => (int) $o->units, 'kg' => (float) $o->est_kg, 'estado' => $o->status, 'sin_stock' => (bool) $o->needs_stock])->values()];
        })->values();

        $olas = Base::alcanceOlas(DB::table('picking_waves as w'), $u)->where('w.wave_date', $fecha)
            ->when($local, fn ($q, $v) => $q->where('w.establishment_id', $v))->leftJoin('establishments as e', 'e.id', '=', 'w.establishment_id')
            ->leftJoin('warehouses as h', 'h.id', '=', 'w.warehouse_id')
            ->orderBy('w.slot_from')->orderBy('w.number')->get(['w.*', 'e.name as local', 'h.code as almacen']);

        return response()->json([
            'fecha' => $fecha, 'locales' => self::locales($u), 'grupos' => $grupos, 'olas' => $olas->map(fn ($w) => self::resumen($w))->values(),
            'cifras' => [
                'sin_ola' => $libres->count(),
                'olas' => $olas->where('status', '<>', 'CANCELLED')->count(), 'borradores' => $olas->where('status', 'DRAFT')->count(),
                'en_preparacion' => $pedidos()->whereIn('o.status', ['IN_PREPARATION', 'WEIGHED'])->count(),
                'listos' => $pedidos()->whereIn('o.status', ['READY', 'IN_ROUTE'])->count(),
            ],
        ]);
    }

    private static function resumen(object $w): array
    {
        $ts = DB::table('picking_tasks')->where('wave_id', $w->id)->where('status', '<>', 'CANCELLED')->get();
        $w->local ??= DB::table('establishments')->where('id', $w->establishment_id)->value('name');
        $w->almacen ??= DB::table('warehouses')->where('id', $w->warehouse_id)->value('code');

        return ['id' => $w->id, 'number' => $w->number, 'status' => $w->status, 'local' => $w->local, 'almacen' => $w->almacen,
            'wave_date' => $w->wave_date, 'franja' => $w->slot_from ? substr($w->slot_from, 0, 5).'–'.substr((string) $w->slot_to, 0, 5) : 'Sin franja',
            'route_code' => $w->route_code, 'pedidos' => $ts->count(), 'verificados' => $ts->whereIn('status', ['VERIFIED', 'LOADED'])->count(),
            'avance' => $ts->count() ? (int) round($ts->avg(fn ($t) => Tareas::avance($t))) : 0, 'cancel_reason' => $w->cancel_reason ?? null];
    }

    /** Olas para los selectores de PRE-02 a PRE-08 (de ayer en adelante, o de una fecha). */
    public function lista(Request $request)
    {
        $d = $request->validate(['fecha' => ['nullable', 'date_format:Y-m-d']]);
        $q = Base::alcanceOlas(DB::table('picking_waves as w'), $request->user())->where('w.status', '<>', 'CANCELLED')
            ->leftJoin('establishments as e', 'e.id', '=', 'w.establishment_id')
            ->when($d['fecha'] ?? null, fn ($x, $v) => $x->where('w.wave_date', $v), fn ($x) => $x->where('w.wave_date', '>=', now('America/Lima')->subDay()->toDateString()))
            ->orderByDesc('w.wave_date')->orderByDesc('w.number')->limit(100);

        return response()->json($q->get(['w.id', 'w.number', 'w.status', 'w.wave_date', 'w.slot_from', 'w.slot_to', 'e.name as local'])->map(fn ($w) => [
            'id' => $w->id, 'number' => $w->number, 'status' => $w->status, 'wave_date' => $w->wave_date, 'local' => $w->local,
            'etiqueta' => "{$w->number} · {$w->local} · ".Base::fecha($w->wave_date).($w->slot_from ? ' '.substr($w->slot_from, 0, 5).'–'.substr((string) $w->slot_to, 0, 5) : '').' · '.Base::ola($w->status),
        ]));
    }

    public function show(Request $request, string $id)
    {
        $w = Olas::visible($id, $request->user());
        $ts = DB::table('picking_tasks as t')->join('sales_orders as o', 'o.id', '=', 't.order_id')->leftJoin('users as p', 'p.id', '=', 't.preparer_user_id')
            ->where('t.wave_id', $w->id)->orderBy('t.route_key')->orderBy('t.stop_seq')->orderBy('t.order_number')
            ->get(['t.*', 'o.customer_id', 'o.status as order_status', 'p.name as preparador']);

        return response()->json(self::resumen($w) + [
            'tareas' => $ts->map(fn ($t) => ['id' => $t->id, 'order_id' => $t->order_id, 'pedido' => $t->order_number, 'cliente' => Base::cliente($t->customer_id),
                'estado' => $t->status, 'estado_pedido' => $t->order_status, 'ruta' => $t->route_code, 'parada' => $t->stop_seq, 'preparador' => $t->preparador,
                'avance' => Tareas::avance($t)])->values(),
        ]);
    }

    public function store(Request $request)
    {
        $d = $request->validate([
            'order_ids' => ['required', 'array', 'min:1', 'max:200'], 'order_ids.*' => ['uuid'], 'establishment_id' => ['nullable', 'uuid'],
            'wave_date' => ['nullable', 'date_format:Y-m-d'], 'slot_from' => ['nullable', 'date_format:H:i:s,H:i'], 'slot_to' => ['nullable', 'date_format:H:i:s,H:i'],
            'route_code' => ['nullable', 'string', 'max:40'], 'liberar' => ['boolean'],
        ]);

        return response()->json(Olas::crear($d, $request->user()), 201);
    }

    public function liberar(Request $request, string $id)
    {
        return response()->json(Olas::liberar($id, $request->user()));
    }

    public function cancelar(Request $request, string $id)
    {
        $d = $request->validate(['reason' => ['nullable', 'string', 'max:255']]);

        return response()->json(Olas::cancelar($id, $d['reason'] ?? null, $request->user()));
    }

    public function quitar(Request $request, string $id, string $taskId)
    {
        return response()->json(Olas::quitar($id, $taskId, $request->user()));
    }

    public function cerrar(Request $request, string $id)
    {
        return response()->json(Olas::cerrar($id, $request->user()));
    }

    /** PRE-02: por producto y corte, cantidad, kg estimados, lote sugerido por FEFO y su ubicación. */
    public function consolidada(Request $request, string $id)
    {
        $w = Olas::visible($id, $request->user());
        $lineas = DB::table('picking_task_lines as l')->join('picking_tasks as t', 't.id', '=', 'l.task_id')->join('product_variants as v', 'v.id', '=', 'l.variant_id')
            ->where('t.wave_id', $w->id)->where('t.status', '<>', 'CANCELLED')
            ->get(['l.variant_id', 'l.qty_required', 'l.qty_picked', 'l.est_weight_kg', 'l.weighed_kg', 'l.status', 'l.cut_notes', 't.order_number', 'v.sku', 'v.name', 'v.sale_mode']);
        $filas = $lineas->groupBy('variant_id')->map(function ($g, $variant) use ($w) {
            $v = $g->first();
            $cand = InventarioService::lotesDisponibles($variant, ['establishment_id' => $w->establishment_id, 'delivery_date' => max($w->wave_date, Base::hoy()), 'incluir_reservado' => true]);
            $primero = $cand->first();
            $tipoAlm = $primero ? DB::table('warehouses')->where('id', $primero->warehouse_id)->value('wh_type') : null;
            $qty = $g->sum(fn ($l) => (float) $l->qty_required);
            $hecho = $g->sum(fn ($l) => in_array($l->status, ['DONE', 'SHORT_APPROVED'], true) ? (float) $l->qty_required : ($v->sale_mode === 'KG' ? (float) ($l->weighed_kg ?? 0) : (float) $l->qty_picked));
            $stock = $cand->sum(fn ($c) => (float) $c->qty);

            return [
                'variant_id' => $variant, 'sku' => $v->sku, 'name' => $v->name, 'sale_mode' => $v->sale_mode, 'qty' => Base::q($qty),
                'kg' => Base::q($g->sum(fn ($l) => (float) ($l->est_weight_kg ?? 0))), 'hecho' => Base::q(min($qty, $hecho)),
                'pedidos' => $g->pluck('order_number')->unique()->values(), 'cortes' => $g->pluck('cut_notes')->filter()->unique()->values(),
                'lote' => $primero?->lot_code, 'vence' => $primero?->expiry_date, 'almacen' => $primero?->warehouse_code, 'tipo_almacen' => $tipoAlm,
                'stock' => Base::q($stock), 'sin_stock' => $stock + Base::EPS < $qty - min($qty, $hecho),
            ];
        })->sortBy([['almacen', 'asc'], ['name', 'asc']])->values();

        return response()->json([
            'ola' => self::resumen($w), 'filas' => $filas,
            'cifras' => ['productos' => $filas->count(), 'kg' => Base::q($filas->sum('kg')), 'sin_stock' => $filas->where('sin_stock', true)->count()],
        ]);
    }
}
