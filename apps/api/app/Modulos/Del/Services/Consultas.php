<?php

namespace App\Modulos\Del\Services;

use App\Models\User;
use App\Modulos\Ped\Services\Estados;
use App\Support\Access;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * Lo que muestran las pantallas de DEL: opciones de los formularios, planificador, rutas del día,
 * hoja de ruta, rutas del repartidor y bandejas. Solo lectura.
 */
final class Consultas
{
    /** Opciones de los formularios: locales, franjas, zonas, vehículos, repartidores, empresas y catálogos. */
    public static function opciones(string $fecha, User $u): array
    {
        $locales = DB::table('establishments')->where('status', 'ACTIVE')->when(Base::locales($u), fn ($q, $l) => $q->whereIn('id', $l))
            ->orderBy('code')->get(['id', 'code', 'name', 'lat', 'lng']);
        $ids = $locales->pluck('id');
        $vehiculos = DB::table('vehicles')->whereIn('establishment_id', $ids)->orderBy('plate')->get()
            ->map(fn ($v) => ['id' => $v->id, 'plate' => $v->plate, 'vehicle_type' => $v->vehicle_type, 'ownership' => $v->ownership, 'status' => $v->status,
                'capacity_kg' => $v->capacity_kg !== null ? (float) $v->capacity_kg : null, 'refrigerated' => (bool) $v->refrigerated,
                'establishment_id' => $v->establishment_id, 'odometer_km' => (float) $v->odometer_km, 'docs' => Rutas::documentos($v, $fecha)]);

        return [
            'fecha' => $fecha, 'hoy' => Base::hoy(),
            'locales' => $locales,
            'franjas' => DB::table('order_time_slots')->whereIn('establishment_id', $ids)->where('status', 'ACTIVE')->orderBy('slot_from')
                ->get(['id', 'establishment_id', 'zone_id', 'name', 'slot_from', 'slot_to']),
            'zonas' => DB::table('delivery_zones')->where('status', 'ACTIVE')->orderBy('name')->get(['id', 'establishment_id', 'code', 'name', 'province', 'delivery_fee']),
            'vehiculos' => $vehiculos,
            'repartidores' => Rutas::repartidores()->map(fn ($r) => ['id' => $r->id, 'name' => $r->name, 'employee_id' => $r->employee_id, 'pago' => Rutas::pagoPorDefecto($r->id)]),
            'empresas' => Terceros::empresas()->map(fn ($e) => ['id' => $e->id, 'name' => $e->trade_name ?: $e->legal_name, 'status' => $e->status]),
            'agencias' => DB::table('suppliers')->where('supplier_type', 'DELIVERY_COMPANY')->where('status', 'ACTIVE')
                ->orderBy('trade_name')->get(['id', 'trade_name', 'legal_name', 'supplier_type']),
            'modos' => Base::MODOS, 'motivos' => array_map(fn ($m) => $m[0], Base::MOTIVOS), 'incidencias' => Base::INCIDENCIAS,
            'medios' => Base::MEDIOS_COBRO, 'costos' => Base::COSTOS, 'tipos_vehiculo' => Base::VEHICULOS, 'combustibles' => Base::COMBUSTIBLES,
            'estados_ruta' => Base::RUTA, 'estados_parada' => Base::PARADA, 'estados_provincia' => Base::PROVINCIA,
            'gastos' => array_map(fn ($g) => $g[0], Extras::GASTOS), 'pagado_con' => Extras::PAGADO_CON, 'destinos' => Extras::DESTINOS,
            'embalajes' => Provincia::EMBALAJES, 'bases_tarifa' => Terceros::BASES,
            'parametros' => ['radio_m' => Base::num('del_pod_max_distance_m', 300), 'intervalo_s' => (int) Base::num('del_position_interval_s', 120),
                'dias_aviso' => (int) Base::num('del_doc_alert_days', 15), 'tolerancia' => Base::num('del_carrier_tolerance_pen', 2)],
            'puede' => [
                'planificar' => Access::can($u, 'del.route.plan'), 'manejar' => Access::can($u, 'del.route.drive'), 'seguir' => Access::can($u, 'del.tracking.view'),
                'empresas' => Access::can($u, 'del.carrier.manage'), 'conciliar' => Access::can($u, 'del.carrier_invoice.reconcile'),
                'provincia' => Access::can($u, 'del.province.manage'), 'vehiculos' => Access::can($u, 'del.vehicle.manage'),
                'costos' => Access::can($u, 'del.cost.manage'), 'ver_costos' => Access::can($u, 'del.cost.view') || Access::can($u, 'del.cost.manage'),
                'liquidar' => Access::module($u, 'DEL', 'E'), 'solo_sus_rutas' => Base::soloSusRutas($u),
            ],
        ];
    }

    /** DEL-01: pedidos de delivery del día (por preparar, listos o no entregados) y las rutas armadas. */
    public static function planificador(string $fecha, ?string $local, User $u): array
    {
        $pedidos = Base::alcance(DB::table('sales_orders as o'), $u, 'o.establishment_id')
            ->leftJoin('customer_addresses as a', 'a.id', '=', 'o.address_id')->leftJoin('delivery_zones as z', 'z.id', '=', 'o.zone_id')
            ->where('o.fulfillment', 'DELIVERY')->where('o.delivery_date', $fecha)
            ->whereIn('o.status', array_merge(Rutas::PEDIDO_PROGRAMABLE, ['IN_ROUTE', 'DELIVERED']))
            ->when($local, fn ($q) => $q->where('o.establishment_id', $local))
            ->where(fn ($w) => $w->whereNull('z.province')->orWhere('z.province', false))
            ->orderBy('o.slot_from')->orderBy('o.number')
            ->get(['o.*', 'a.address_line', 'a.district', 'a.reference', 'a.lat', 'a.lng', 'z.name as zona']);
        $paradas = DB::table('delivery_stops as s')->join('delivery_routes as r', 'r.id', '=', 's.route_id')
            ->whereIn('s.order_id', $pedidos->pluck('id'))->whereNotIn('s.status', ['FAILED', 'RESCHEDULED', 'CANCELLED'])
            ->get(['s.order_id', 's.id', 's.seq', 's.status', 'r.id as route_id', 'r.code'])->keyBy('order_id');
        $tareas = DB::table('picking_tasks')->whereIn('order_id', $pedidos->pluck('id'))->where('status', '<>', 'CANCELLED')->pluck('status', 'order_id');
        $lista = $pedidos->map(function ($o) use ($paradas, $tareas) {
            $s = $paradas[$o->id] ?? null;
            $p = Rutas::punto($o);

            return ['id' => $o->id, 'number' => $o->number, 'status' => $o->status, 'estado' => Estados::nombre($o->status), 'cliente' => Base::cliente($o->customer_id),
                'establishment_id' => $o->establishment_id, 'zone_id' => $o->zone_id, 'zona' => $o->zona, 'slot_id' => $o->slot_id,
                'franja' => $o->slot_from ? substr($o->slot_from, 0, 5).'–'.substr((string) $o->slot_to, 0, 5) : null,
                'direccion' => $o->address_line, 'distrito' => $o->district, 'referencia' => $o->reference,
                'lat' => $p[0], 'lng' => $p[1], 'con_pin' => $o->lat !== null, 'kg' => Rutas::kgPedido($o->id), 'cobrar' => Rutas::cobroPedido($o),
                'total' => Rutas::totalPedido($o), 'preparacion' => $tareas[$o->id] ?? null,
                'ruta' => $s ? ['id' => $s->route_id, 'code' => $s->code, 'seq' => $s->seq, 'stop_id' => $s->id, 'status' => $s->status] : null];
        })->values();

        return ['pedidos' => $lista, 'rutas' => self::rutas($fecha, $local, $u), 'local' => $local ? Rutas::puntoLocal($local) : null];
    }

    /** Rutas del día con su avance, kg, asignación y avisos. */
    public static function rutas(string $fecha, ?string $local, User $u, bool $conCanceladas = false): array
    {
        $q = Base::alcance(DB::table('delivery_routes as r'), $u)->where('r.route_date', $fecha)
            ->when(! $conCanceladas, fn ($w) => $w->where('r.status', '<>', 'CANCELLED'))
            ->when($local, fn ($w) => $w->where('r.establishment_id', $local))
            ->when(Base::soloSusRutas($u), fn ($w) => $w->where('r.driver_user_id', $u->id))
            ->leftJoin('vehicles as v', 'v.id', '=', 'r.vehicle_id')->leftJoin('users as d', 'd.id', '=', 'r.driver_user_id')
            ->leftJoin('suppliers as c', 'c.id', '=', 'r.carrier_supplier_id')->leftJoin('establishments as e', 'e.id', '=', 'r.establishment_id')
            ->orderBy('r.slot_from')->orderBy('r.code')
            ->get(['r.*', 'v.plate', 'v.capacity_kg', 'v.vehicle_type', 'd.name as repartidor', 'c.trade_name as empresa', 'e.code as local']);

        return $q->map(fn ($r) => self::resumenRuta($r))->values()->all();
    }

    public static function resumenRuta(object $r): array
    {
        $paradas = Rutas::paradas($r->id);
        $bolsas = 0;
        $cargadas = 0;
        foreach ($paradas->whereIn('status', ['PENDING', 'ARRIVED']) as $s) {
            foreach (Rutas::bolsas($s) as $b) {
                $bolsas++;
                $cargadas += in_array($b['status'], ['LOADED', 'DELIVERED'], true) ? 1 : 0;
            }
        }
        $avisos = [];
        if ($r->vehicle_id && in_array($r->status, ['PLANNED', 'LOADING'], true)) {
            $v = DB::table('vehicles')->where('id', $r->vehicle_id)->first();
            foreach (Rutas::documentos($v, $r->route_date) as $w) {
                $avisos[] = ['level' => $w['level'], 'msg' => "{$v->plate}: {$w['msg']}"];
            }
            $kg = (float) $paradas->sum('kg');
            if ($v->capacity_kg && $kg > (float) $v->capacity_kg) {
                $avisos[] = ['level' => 'warn', 'msg' => 'Lleva '.number_format($kg, 1, ',', '.')." kg y {$v->plate} carga ".number_format((float) $v->capacity_kg, 0, ',', '.').' kg'];
            }
        }
        $sinAsignar = $r->mode === 'THIRD_PARTY' ? ! $r->carrier_supplier_id : (! $r->vehicle_id || ! $r->driver_user_id);
        if ($sinAsignar && in_array($r->status, ['PLANNED', 'LOADING'], true)) {
            $avisos[] = ['level' => 'warn', 'msg' => 'Falta asignar '.($r->mode === 'THIRD_PARTY' ? 'la empresa de delivery' : 'vehículo y repartidor')];
        }

        return [
            'id' => $r->id, 'code' => $r->code, 'route_date' => $r->route_date, 'status' => $r->status, 'estado' => Base::ruta($r->status), 'mode' => $r->mode,
            'establishment_id' => $r->establishment_id, 'local' => $r->local ?? null,
            'franja' => $r->slot_from ? substr($r->slot_from, 0, 5).'–'.substr((string) $r->slot_to, 0, 5) : null,
            'vehicle_id' => $r->vehicle_id, 'plate' => $r->plate ?? null, 'driver_user_id' => $r->driver_user_id, 'repartidor' => $r->repartidor ?? null,
            'carrier_supplier_id' => $r->carrier_supplier_id, 'empresa' => $r->empresa ?? null,
            'driver_pay_mode' => $r->driver_pay_mode, 'driver_pay_rate' => $r->driver_pay_rate !== null ? (float) $r->driver_pay_rate : null,
            'paradas' => $paradas->count(), 'hechas' => $paradas->whereIn('status', ['DELIVERED', 'FAILED', 'HANDED_OFF'])->count(),
            'entregadas' => $paradas->where('status', 'DELIVERED')->count(), 'kg' => round((float) $paradas->sum('kg'), 3),
            'cobrar' => round((float) $paradas->sum('cod_amount'), 2), 'cobrado' => round((float) $paradas->sum('collected_amount'), 2),
            'planned_km' => (float) $r->planned_km, 'bolsas' => $bolsas, 'cargadas' => $cargadas,
            'departed_at' => $r->departed_at, 'returned_at' => $r->returned_at, 'avisos' => $avisos,
        ];
    }

    /**
     * DEL-03 y DEL-04/05: la ruta con sus paradas en orden. Para quien planifica trae el código de entrega
     * y el enlace de seguimiento (van en el aviso «va en camino»); al repartidor nunca se le muestra el código.
     */
    public static function hoja(string $routeId, User $u): array
    {
        $r = Base::rutaVisible($routeId, $u);
        $planifica = Access::can($u, 'del.route.plan');
        $fila = DB::table('delivery_routes as r')->where('r.id', $r->id)
            ->leftJoin('vehicles as v', 'v.id', '=', 'r.vehicle_id')->leftJoin('users as d', 'd.id', '=', 'r.driver_user_id')
            ->leftJoin('suppliers as c', 'c.id', '=', 'r.carrier_supplier_id')->leftJoin('establishments as e', 'e.id', '=', 'r.establishment_id')
            ->first(['r.*', 'v.plate', 'v.capacity_kg', 'v.vehicle_type', 'd.name as repartidor', 'c.trade_name as empresa', 'e.code as local', 'e.name as local_nombre']);
        $paradas = DB::table('delivery_stops as s')->join('sales_orders as o', 'o.id', '=', 's.order_id')
            ->leftJoin('customer_addresses as a', 'a.id', '=', 'o.address_id')->leftJoin('delivery_zones as z', 'z.id', '=', 's.zone_id')
            ->where('s.route_id', $r->id)->whereIn('s.status', Base::EN_RUTA)->orderBy('s.seq')
            ->get(['s.*', 'o.number', 'o.customer_id', 'o.contact_phone', 'o.status as order_status', 'o.slot_from', 'o.slot_to', 'o.address_id', 'o.zone_id as order_zone',
                'o.establishment_id', 'o.notes as order_notes', 'o.payment_method_id', 'o.final_total', 'o.estimated_total', 'o.paid_amount', 'o.delivery_date', 'o.brand_id',
                'a.address_line', 'a.reference', 'a.district', 'a.lat', 'a.lng', 'a.call_signal', 'a.contact_phone as address_phone', 'z.name as zona']);
        $medios = DB::table('payment_methods')->pluck('code', 'id');
        $enlaces = $planifica ? DB::table('tracking_links')->whereIn('order_id', $paradas->pluck('order_id'))->where('revoked', false)->pluck('token', 'order_id') : collect();
        $lista = $paradas->map(function ($s) use ($planifica, $medios, $enlaces) {
            $tel = $s->contact_phone ?: $s->address_phone ?: DB::table('customers')->where('id', $s->customer_id)->value('phone');
            $p = Rutas::punto($s);

            return [
                'id' => $s->id, 'seq' => $s->seq, 'status' => $s->status, 'estado' => Base::parada($s->status), 'order_id' => $s->order_id, 'pedido' => $s->number,
                'order_status' => $s->order_status, 'cliente' => Base::cliente($s->customer_id), 'direccion' => $s->address_line, 'referencia' => $s->reference,
                'distrito' => $s->district, 'zona' => $s->zona, 'lat' => $p[0], 'lng' => $p[1], 'con_pin' => $s->lat !== null,
                'franja' => $s->slot_from ? substr($s->slot_from, 0, 5).'–'.substr((string) $s->slot_to, 0, 5) : null,
                'eta' => $s->eta, 'kg' => (float) $s->kg, 'bolsas' => Rutas::bolsas($s), 'cobrar' => (float) $s->cod_amount, 'cobrado' => (float) $s->collected_amount,
                'pendiente' => max(0, round((float) $s->cod_amount - (float) $s->collected_amount, 2)), 'medio' => $medios[$s->payment_method_id] ?? null,
                'telefono' => Base::enmascarar($tel), 'senal' => $s->call_signal, 'notas' => $s->order_notes,
                'arrived_at' => $s->arrived_at, 'closed_at' => $s->closed_at, 'fail_reason' => $s->fail_reason,
                'motivo' => $s->fail_reason ? (Base::MOTIVOS[$s->fail_reason][0] ?? $s->fail_reason) : null,
                'pod_distance_m' => $s->pod_distance_m !== null ? (float) $s->pod_distance_m : null, 'distance_km' => $s->distance_km !== null ? (float) $s->distance_km : null,
                'support_from' => $s->support_from, 'handoff_id' => $s->handoff_id,
                'codigo' => $planifica ? $s->delivery_code : null, 'token' => $planifica ? ($enlaces[$s->order_id] ?? null) : null,
            ];
        })->values();
        $eventos = DB::table('delivery_events as e')->leftJoin('users as us', 'us.id', '=', 'e.user_id')->where('e.route_id', $r->id)
            ->where('e.event_type', '<>', 'POSITION')->orderByDesc('e.occurred_at')->limit(60)
            ->get(['e.id', 'e.stop_id', 'e.event_type', 'e.occurred_at', 'e.notes', 'e.amount', 'e.reason_code', 'e.incident_type', 'us.name as usuario']);

        return [
            'ruta' => self::resumenRuta($fila) + ['local_nombre' => $fila->local_nombre, 'capacity_kg' => $fila->capacity_kg !== null ? (float) $fila->capacity_kg : null,
                'odometer_start' => $fila->odometer_start !== null ? (float) $fila->odometer_start : null, 'odometer_end' => $fila->odometer_end !== null ? (float) $fila->odometer_end : null,
                'sequence_method' => $fila->sequence_method, 'cancel_reason' => $fila->cancel_reason,
                'odometro_vehiculo' => $fila->vehicle_id ? (float) DB::table('vehicles')->where('id', $fila->vehicle_id)->value('odometer_km') : null],
            'paradas' => $lista, 'eventos' => $eventos, 'local' => Rutas::puntoLocal($r->establishment_id), 'posicion' => Seguimiento::ultimaPosicion($r->id),
            'riesgo' => Extras::riesgo($r), 'liquidacion' => Liquidaciones::deRuta($r->id),
            'puede_salir' => self::puedeSalir($r, $lista->all()),
        ];
    }

    /** Lo que falta para que la ruta salga (RN-DEL-01, RN-DEL-03, RN-DEL-04), para mostrarlo antes de intentar. */
    private static function puedeSalir(object $r, array $paradas): array
    {
        if (! in_array($r->status, ['PLANNED', 'LOADING'], true)) {
            return ['ok' => false, 'faltas' => []];
        }
        $faltas = [];
        if ($r->mode === 'THIRD_PARTY' ? ! $r->carrier_supplier_id : (! $r->vehicle_id || ! $r->driver_user_id)) {
            $faltas[] = 'Asignar '.($r->mode === 'THIRD_PARTY' ? 'la empresa de delivery' : 'vehículo y repartidor');
        }
        $pend = array_filter($paradas, fn ($p) => $p['status'] === 'PENDING');
        if (! $pend) {
            $faltas[] = 'Agregar paradas';
        }
        $sin = 0;
        $noListos = [];
        foreach ($pend as $p) {
            foreach ($p['bolsas'] as $b) {
                $sin += in_array($b['status'], ['LOADED', 'DELIVERED'], true) ? 0 : 1;
            }
            if (! in_array($p['order_status'], ['READY', 'NOT_DELIVERED'], true)) {
                $noListos[] = $p['pedido'];
            }
        }
        if ($sin) {
            $faltas[] = "Cargar {$sin} bolsa(s) por escaneo";
        }
        if ($noListos) {
            $faltas[] = 'Esperar la verificación de '.implode(', ', array_slice($noListos, 0, 3)).(count($noListos) > 3 ? '…' : '');
        }

        return ['ok' => ! $faltas, 'faltas' => $faltas];
    }

    /** DEL-04: rutas del repartidor (de hoy y las abiertas de días anteriores). */
    public static function misRutas(string $fecha, User $u): array
    {
        $ids = DB::table('delivery_routes')->where('driver_user_id', $u->id)
            ->where(fn ($w) => $w->where('route_date', $fecha)->orWhere(fn ($x) => $x->where('route_date', '<', $fecha)->whereIn('status', ['LOADING', 'IN_ROUTE', 'RETURNED'])))
            ->where('status', '<>', 'CANCELLED')->orderBy('route_date')->orderBy('slot_from')->pluck('id');
        $out = [];
        foreach ($ids as $id) {
            $r = DB::table('delivery_routes as r')->where('r.id', $id)->leftJoin('vehicles as v', 'v.id', '=', 'r.vehicle_id')
                ->leftJoin('users as d', 'd.id', '=', 'r.driver_user_id')->leftJoin('suppliers as c', 'c.id', '=', 'r.carrier_supplier_id')
                ->leftJoin('establishments as e', 'e.id', '=', 'r.establishment_id')
                ->first(['r.*', 'v.plate', 'v.capacity_kg', 'v.vehicle_type', 'd.name as repartidor', 'c.trade_name as empresa', 'e.code as local']);
            $res = self::resumenRuta($r);
            $sig = DB::table('delivery_stops as s')->join('sales_orders as o', 'o.id', '=', 's.order_id')->leftJoin('customer_addresses as a', 'a.id', '=', 'o.address_id')
                ->where('s.route_id', $id)->whereIn('s.status', Base::ABIERTAS)->orderBy('s.seq')->first(['s.id', 's.seq', 's.eta', 'o.number', 'o.customer_id', 'a.address_line', 'a.district']);
            $res['siguiente'] = $sig ? ['id' => $sig->id, 'seq' => $sig->seq, 'eta' => $sig->eta, 'pedido' => $sig->number, 'cliente' => Base::cliente($sig->customer_id),
                'direccion' => $sig->address_line, 'distrito' => $sig->district] : null;
            $out[] = $res;
        }

        return $out;
    }

    /** DEL-16: paradas no entregadas con su motivo, foto y estado de las bolsas y del pedido. */
    public static function noEntregados(User $u, string $estado, ?string $desde, ?string $hasta): array
    {
        $q = Base::alcance(DB::table('delivery_stops as s'), $u)->join('delivery_routes as r', 'r.id', '=', 's.route_id')
            ->join('sales_orders as o', 'o.id', '=', 's.order_id')->leftJoin('customer_addresses as a', 'a.id', '=', 'o.address_id')
            ->leftJoin('users as d', 'd.id', '=', 'r.driver_user_id')
            ->whereIn('s.status', $estado === 'PENDIENTES' ? ['FAILED'] : ['FAILED', 'RESCHEDULED'])
            ->when($estado === 'PENDIENTES', fn ($w) => $w->where('o.status', 'NOT_DELIVERED'))
            ->when($desde, fn ($w) => $w->where('r.route_date', '>=', $desde))->when($hasta, fn ($w) => $w->where('r.route_date', '<=', $hasta))
            ->orderByDesc('s.closed_at')->limit(300)
            ->get(['s.id', 's.seq', 's.status', 's.fail_reason', 's.closed_at', 's.bags_returned', 's.bags_returned_at', 's.rescheduled_to', 's.order_id', 's.cod_amount', 's.collected_amount',
                'r.id as route_id', 'r.code as ruta', 'r.route_date', 'r.establishment_id', 'd.name as repartidor', 'o.number', 'o.customer_id', 'o.status as order_status',
                'o.reschedule_count', 'o.delivery_date', 'a.address_line', 'a.district']);
        $fotos = DB::table('delivery_events')->whereIn('stop_id', $q->pluck('id'))->where('event_type', 'FAILED')->get(['stop_id', 'photo_file_id', 'notes'])->keyBy('stop_id');

        return $q->map(fn ($s) => [
            'id' => $s->id, 'seq' => $s->seq, 'status' => $s->status, 'estado' => Base::parada($s->status), 'motivo' => Base::MOTIVOS[$s->fail_reason][0] ?? $s->fail_reason,
            'fail_reason' => $s->fail_reason, 'nota' => $fotos[$s->id]->notes ?? null, 'foto_id' => $fotos[$s->id]->photo_file_id ?? null, 'closed_at' => $s->closed_at,
            'bolsas_devueltas' => (bool) $s->bags_returned, 'bags_returned_at' => $s->bags_returned_at, 'reprogramado_a' => $s->rescheduled_to,
            'order_id' => $s->order_id, 'pedido' => $s->number, 'order_status' => $s->order_status, 'estado_pedido' => Estados::nombre($s->order_status),
            'reprogramaciones' => (int) $s->reschedule_count, 'cliente' => Base::cliente($s->customer_id), 'direccion' => $s->address_line, 'distrito' => $s->district,
            'route_id' => $s->route_id, 'ruta' => $s->ruta, 'route_date' => $s->route_date, 'repartidor' => $s->repartidor, 'establishment_id' => $s->establishment_id,
            'cobrado' => (float) $s->collected_amount,
        ])->values()->all();
    }

    /** DEL-19: direcciones de los pedidos de delivery de la fecha, con su puntaje y lo que les falta. */
    public static function direcciones(string $fecha, User $u, ?string $nivel): array
    {
        $pedidos = Base::alcance(DB::table('sales_orders as o'), $u, 'o.establishment_id')->where('o.fulfillment', 'DELIVERY')->where('o.delivery_date', $fecha)
            ->whereIn('o.status', array_merge(Rutas::PEDIDO_PROGRAMABLE, ['IN_ROUTE']))->orderBy('o.slot_from')->orderBy('o.number')->get();
        $out = [];
        foreach ($pedidos as $o) {
            $p = Extras::puntaje($o);
            if ($nivel && $p['level'] !== $nivel) {
                continue;
            }
            $out[] = ['order_id' => $o->id, 'pedido' => $o->number, 'cliente' => Base::cliente($o->customer_id), 'customer_id' => $o->customer_id, 'status' => $o->status,
                'franja' => $o->slot_from ? substr($o->slot_from, 0, 5).'–'.substr((string) $o->slot_to, 0, 5) : null] + $p;
        }
        usort($out, fn ($a, $b) => $a['score'] <=> $b['score']);

        return $out;
    }

    /** Ventana de fechas por defecto de las bandejas: los últimos 30 días hasta mañana. */
    public static function ventana(?string $desde, ?string $hasta): array
    {
        $hoy = CarbonImmutable::parse(Base::hoy());

        return [$desde ?: $hoy->subDays(30)->toDateString(), $hasta ?: $hoy->addDay()->toDateString()];
    }
}
