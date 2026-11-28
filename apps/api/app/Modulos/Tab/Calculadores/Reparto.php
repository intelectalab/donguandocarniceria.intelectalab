<?php

namespace App\Modulos\Tab\Calculadores;

use App\Modulos\Flo\Services\Base as FloBase;
use App\Modulos\Flo\Services\Costos as FloCostos;
use App\Modulos\Flo\Services\Temperatura;
use App\Support\Params;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * Calculadores de reparto y caja: DEL, CAJ y FLO.
 * El costo por entrega (KPI-DEL-04, 05, 07 y 08) sale del reparto de costos de DEL (delivery_cost_allocations, la última
 * corrida del mes); si el mes aún no tiene reparto (el mes en curso), de los costos de las rutas entre sus entregas.
 */
final class Reparto
{
    public const DIGITALES = ['CARD', 'GATEWAY', 'WALLET', 'BANK'];

    public static function todos(): array
    {
        return [
            'KPI-DEL-01' => fn (Periodo $p) => Periodo::total(self::paradas($p)->where('s.status', 'DELIVERED')->count(), 0),
            'KPI-DEL-02' => function (Periodo $p) {
                $q = fn () => self::paradas($p)->where('s.status', 'DELIVERED')->whereNotNull('o.slot_to')->whereNotNull('s.closed_at');
                $aTiempo = $q()->whereRaw("(s.closed_at AT TIME ZONE 'America/Lima') <= (o.delivery_date + o.slot_to)")->count();

                return Periodo::pct($aTiempo, $q()->count(), 1);
            },
            'KPI-DEL-03' => function (Periodo $p) {
                $f = self::paradas($p)->where('s.status', 'FAILED')->count();

                return Periodo::pct($f, $f + self::paradas($p)->where('s.status', 'DELIVERED')->count());
            },
            'KPI-DEL-04' => fn (Periodo $p) => self::costoPorEntrega($p),
            'KPI-DEL-05' => function (Periodo $p) {
                $a = self::reparto($p);
                if ($a) {
                    return Periodo::razon((float) (clone $a)->sum('a.total_cost'), (float) (clone $a)->sum('a.kg_delivered'));
                }
                $kg = (float) self::paradas($p)->where('s.status', 'DELIVERED')->sum('s.kg');

                return Periodo::razon(self::costoRutas($p), $kg);
            },
            'KPI-DEL-06' => fn (Periodo $p) => Periodo::razon(self::costoRutas($p, ['OWN', 'RENTED']), self::km($p)),
            'KPI-DEL-07' => fn (Periodo $p) => self::costoPorEntrega($p),
            'KPI-DEL-08' => function (Periodo $p) {
                $a = self::reparto($p);

                return Periodo::total($a ? (float) $a->sum('a.subsidy') : self::costoRutas($p) - (float) self::paradas($p)->where('s.status', 'DELIVERED')->sum('o.delivery_fee'));
            },
            'KPI-DEL-09' => fn (Periodo $p) => Periodo::razon(self::km($p), self::paradas($p, ['OWN', 'RENTED'])->where('s.status', 'DELIVERED')->count()),
            'KPI-DEL-10' => function (Periodo $p) {
                $gal = (float) $p->enFechas($p->filtrar(DB::table('delivery_costs as c'), null, 'c.establishment_id'), 'c.cost_date')
                    ->where('c.cost_type', 'FUEL')->where('c.status', 'ACTIVE')->sum('c.fuel_gallons');

                return Periodo::razon(self::km($p), $gal, 1);
            },
            'KPI-DEL-11' => function (Periodo $p) {
                $dias = self::rutas($p)->whereNotNull('r.vehicle_id')->distinct()->count(DB::raw("(r.vehicle_id::text || r.route_date::text)"));
                $vehiculos = DB::table('vehicles')->where('status', 'ACTIVE')->whereIn('ownership', ['OWN', 'RENTED'])
                    ->when($p->local, fn ($q, $v) => $q->where('establishment_id', $v))->count();

                return Periodo::pct($dias, $vehiculos * FloCostos::diasHabiles($p->desde, $p->hasta), 1);
            },
            'KPI-DEL-12' => fn (Periodo $p) => Periodo::total($p->marca || $p->local ? 0.0
                : (float) $p->enFechas(DB::table('carrier_invoices as i'), 'i.issue_date')->sum(DB::raw('abs(coalesce(i.difference, 0))'))),
            'KPI-DEL-13' => fn (Periodo $p) => Periodo::total((float) self::liquidaciones($p)->sum(DB::raw('abs(coalesce(l.difference, 0))'))),
            'KPI-DEL-14' => function (Periodo $p) {
                $q = fn () => self::paradas($p)->where('s.status', 'DELIVERED')->whereNotNull('s.pod_distance_m');

                return Periodo::pct($q()->where('s.pod_distance_m', '>', 300)->count(), $q()->count());
            },
            'KPI-DEL-15' => function (Periodo $p) {
                $c = (float) self::costos($p)->whereIn('c.cost_type', ['MAINTENANCE_PREVENTIVE', 'MAINTENANCE_CORRECTIVE'])->sum('c.amount');
                $v = DB::table('vehicles')->where('status', 'ACTIVE')->whereIn('ownership', ['OWN', 'RENTED'])->when($p->local, fn ($q, $x) => $q->where('establishment_id', $x))->count();

                return Periodo::razon($c, $v);
            },
            'KPI-DEL-16' => function (Periodo $p) {
                $c = (float) self::costos($p)->whereIn('c.cost_type', ['PROVINCE_FREIGHT', 'PACKAGING'])->sum('c.amount');
                $n = Ventas::porEntrega($p)->where('o.fulfillment', 'PROVINCE_SHIPPING')->whereNotIn('o.status', ['DRAFT', 'CANCELLED'])->count();

                return Periodo::razon($c, $n);
            },

            // CAJ
            'KPI-CAJ-01' => function (Periodo $p) {
                $l = fn () => self::liquidaciones($p);

                return Periodo::pct((float) $l()->sum(DB::raw('abs(coalesce(l.difference, 0))')), (float) $l()->sum('l.expected_cash'));
            },
            'KPI-CAJ-02' => function (Periodo $p) {
                $q = fn () => self::cobrosDigitales($p)->where('py.reconciliation_status', 'MATCHED');

                return Periodo::pct((float) $q()->sum(DB::raw('coalesce(py.fee_amount, 0) + coalesce(py.fee_igv, 0)')), (float) $q()->sum('py.amount'));
            },
            'KPI-CAJ-03' => function (Periodo $p) {
                $dias = (int) (Params::get('caj_reconciliation_alert_days') ?? 3);
                $corte = CarbonImmutable::parse($p->hasta)->subDays($dias)->toDateString().' 23:59:59-05';

                return Periodo::total((float) $p->filtrar(DB::table('payments as py')->join('payment_methods as m', 'm.id', '=', 'py.payment_method_id'), 'py.brand_id', 'py.establishment_id')
                    ->where('py.status', 'CONFIRMED')->whereIn('m.kind', self::DIGITALES)->whereIn('py.reconciliation_status', ['PENDING', 'DIFFERENCE'])
                    ->where('py.paid_at', '<=', $corte)->sum('py.amount'));
            },
            'KPI-CAJ-04' => function (Periodo $p) {
                $q = fn () => $p->filtrar(DB::table('sales_documents as d'), 'd.brand_id', 'd.establishment_id')->where('d.balance', '>', 0.005)
                    ->whereIn('d.doc_type', ['INVOICE', 'RECEIPT'])->whereNotIn('d.status', ['VOIDED'])->where('d.issue_date', '<=', $p->hasta);

                return Periodo::pct((float) $q()->whereNotNull('d.due_date')->where('d.due_date', '<', $p->hasta)->sum('d.balance'), (float) $q()->sum('d.balance'));
            },
            'KPI-CAJ-05' => fn (Periodo $p) => Periodo::total($p->marca || $p->local ? 0.0
                : (float) DB::table('customer_balance_movements')->where('at', '<', $p->fin())->sum('amount')),
            'KPI-CAJ-06' => function (Periodo $p) {
                $q = fn () => self::paradas($p)->where('s.status', 'DELIVERED')->where('s.cod_amount', '>', 0);

                return Periodo::pct($q()->whereRaw('coalesce(s.collected_amount, 0) < s.cod_amount - 0.01')->count(), $q()->count());
            },

            // FLO · con el costo mensual por vehículo de FLO (RN-FLO-16)
            'KPI-FLO-01' => function (Periodo $p) {
                $t = fn () => self::jornadas($p);

                return Periodo::razon((float) $t()->sum('t.km_odometer'), (float) $t()->sum('t.deliveries'));
            },
            'KPI-FLO-02' => function (Periodo $p) {
                $q = fn () => $p->enRango(DB::table('fuel_loads as f')->join('vehicles as v', 'v.id', '=', 'f.vehicle_id'), 'f.loaded_at')
                    ->where('f.status', 'ACTIVE')->where('f.full_tank', true)->where('f.gallons_since_full', '>', 0)->when($p->local, fn ($x, $v) => $x->where('v.establishment_id', $v));

                return Periodo::razon((float) $q()->sum('f.km_since_full'), (float) $q()->sum('f.gallons_since_full'), 1);
            },
            'KPI-FLO-03' => fn (Periodo $p) => self::flota($p, fn ($c) => Periodo::razon(array_sum(array_column($c, 'total')), array_sum(array_column($c, 'km')))),
            'KPI-FLO-04' => fn (Periodo $p) => self::flota($p, fn ($c) => Periodo::razon(array_sum(array_column($c, 'mantenimiento')), array_sum(array_column($c, 'km')))),
            'KPI-FLO-05' => function (Periodo $p) {
                $q = fn () => $p->enFechas(DB::table('vehicle_maintenances as m')->join('vehicles as v', 'v.id', '=', 'm.vehicle_id'), 'm.done_on')
                    ->where('m.kind', 'PREVENTIVE')->where('m.status', 'DONE')->when($p->local, fn ($x, $v) => $x->where('v.establishment_id', $v));

                return Periodo::pct($q()->where('m.on_time', true)->count(), $q()->count(), 1);
            },
            'KPI-FLO-06' => fn (Periodo $p) => Periodo::total(DB::table('vehicle_documents as d')->leftJoin('vehicles as v', 'v.id', '=', 'd.vehicle_id')
                ->where('d.status', 'ACTIVE')->whereNotNull('d.expires_on')->where('d.expires_on', '<', $p->hasta)
                ->where(fn ($q) => $q->whereNull('d.vehicle_id')->orWhere('v.status', 'ACTIVE'))
                ->when($p->local, fn ($q, $x) => $q->where('v.establishment_id', $x))->count(), 0),
            'KPI-FLO-07' => function (Periodo $p) {
                $min = 0;
                foreach (FloBase::flota()->where('v.refrigerated', true)->when($p->local, fn ($q, $x) => $q->where('v.establishment_id', $x))->pluck('v.id') as $id) {
                    $min += array_sum(array_column(Temperatura::excursiones($id, $p->desde, $p->hasta), 'minutos'));
                }

                return Periodo::total($min, 0);
            },
            'KPI-FLO-08' => fn (Periodo $p) => self::flota($p, fn ($c) => Periodo::valor($c ? array_sum(array_column($c, 'utilizacion')) / count($c) : null, null, count($c), 1)),
            'KPI-FLO-09' => fn (Periodo $p) => Periodo::total((float) $p->enFechas(DB::table('traffic_fines as f')->join('vehicles as v', 'v.id', '=', 'f.vehicle_id'), 'f.fine_date')
                ->where('f.status', 'PAID')->where('f.charged_to_driver', false)->when($p->local, fn ($q, $x) => $q->where('v.establishment_id', $x))->sum('f.paid_amount')),
            'KPI-FLO-10' => fn (Periodo $p) => self::flota($p, fn ($c) => Periodo::razon(array_sum(array_column($c, 'total')), array_sum(array_column($c, 'entregas')))),
        ];
    }

    /* ------------------------------------------------------------------ consultas comunes */

    /** Rutas del rango (no anuladas), del local elegido. */
    public static function rutas(Periodo $p, ?array $modos = null)
    {
        return $p->enFechas($p->filtrar(DB::table('delivery_routes as r'), null, 'r.establishment_id')->where('r.status', '<>', 'CANCELLED'), 'r.route_date')
            ->when($modos, fn ($q, $v) => $q->whereIn('r.mode', $v))
            ->when($p->marca, fn ($q) => $q->whereRaw('true'));
    }

    /** Paradas de las rutas del rango, con su pedido (la marca es la del pedido). */
    public static function paradas(Periodo $p, ?array $modos = null)
    {
        return self::rutas($p, $modos)->join('delivery_stops as s', 's.route_id', '=', 'r.id')->leftJoin('sales_orders as o', 'o.id', '=', 's.order_id')
            ->when($p->marca, fn ($q, $v) => $q->where('o.brand_id', $v));
    }

    /** Reparto de costos de DEL del mes (la última corrida), o null si el mes no tiene reparto. */
    public static function reparto(Periodo $p)
    {
        $ultima = DB::table('delivery_cost_allocations')->where('period', $p->mes())->max('run_no');
        if (! $ultima) {
            return null;
        }

        return DB::table('delivery_cost_allocations as a')->where('a.period', $p->mes())->where('a.run_no', $ultima)
            ->leftJoin('delivery_routes as r', 'r.id', '=', 'a.route_id')->leftJoin('sales_orders as o', 'o.id', '=', 'a.order_id')
            ->when($p->marca, fn ($q, $v) => $q->where('o.brand_id', $v))->when($p->local, fn ($q, $v) => $q->where('r.establishment_id', $v));
    }

    public static function costoPorEntrega(Periodo $p): array
    {
        $a = self::reparto($p);
        if ($a) {
            return Periodo::razon((float) (clone $a)->sum('a.total_cost'), (clone $a)->count());
        }

        return Periodo::razon(self::costoRutas($p), self::paradas($p)->where('s.status', 'DELIVERED')->count());
    }

    /** Costos de reparto vigentes (delivery_costs) cargados a las rutas del rango. */
    public static function costoRutas(Periodo $p, ?array $modos = null): float
    {
        return (float) DB::table('delivery_costs as c')->where('c.status', 'ACTIVE')->whereIn('c.route_id', self::rutas($p, $modos)->select('r.id'))->sum('c.amount');
    }

    /** Costos de reparto del rango por fecha (también los que no van a una ruta: fletes, empaques, mantenimiento). */
    public static function costos(Periodo $p)
    {
        return $p->enFechas($p->filtrar(DB::table('delivery_costs as c'), null, 'c.establishment_id'), 'c.cost_date')->where('c.status', 'ACTIVE')
            ->when($p->marca, fn ($q) => $q->whereRaw('false'));
    }

    /** Km de las rutas propias y alquiladas (odómetro final − inicial). */
    public static function km(Periodo $p): float
    {
        return (float) self::rutas($p, ['OWN', 'RENTED'])->whereNotNull('r.odometer_end')->whereNotNull('r.odometer_start')
            ->whereColumn('r.odometer_end', '>=', 'r.odometer_start')->sum(DB::raw('r.odometer_end - r.odometer_start'));
    }

    /** Liquidaciones de repartidores del rango, del local de su ruta. */
    public static function liquidaciones(Periodo $p)
    {
        return $p->enFechas(DB::table('driver_settlements as l')->leftJoin('delivery_routes as r', 'r.id', '=', 'l.route_ref'), 'l.settlement_date')
            ->when($p->local, fn ($q, $v) => $q->where('r.establishment_id', $v))->when($p->marca, fn ($q) => $q->whereRaw('false'));
    }

    public static function cobrosDigitales(Periodo $p)
    {
        return $p->enRango($p->filtrar(DB::table('payments as py')->join('payment_methods as m', 'm.id', '=', 'py.payment_method_id'), 'py.brand_id', 'py.establishment_id'), 'py.paid_at')
            ->where('py.status', 'CONFIRMED')->whereIn('m.kind', self::DIGITALES);
    }

    private static function jornadas(Periodo $p)
    {
        return $p->enFechas(DB::table('vehicle_trips as t'), 't.trip_date')->where('t.status', 'CLOSED')
            ->when($p->local, fn ($q, $v) => $q->where('t.establishment_id', $v))->when($p->marca, fn ($q) => $q->whereRaw('false'));
    }

    /** Costo mensual de cada vehículo de la flota (FLO) y una fórmula sobre todos. */
    private static function flota(Periodo $p, callable $f): array
    {
        if ($p->marca) {
            return Periodo::valor(null);
        }
        $c = [];
        foreach (FloBase::flota()->where('v.status', 'ACTIVE')->when($p->local, fn ($q, $x) => $q->where('v.establishment_id', $x))->get(['v.*']) as $v) {
            $c[] = FloCostos::mensual($v, $p->mes());
        }

        return $f($c);
    }
}
