<?php

namespace App\Modulos\Del\Services;

use App\Models\User;
use App\Modulos\Plt\Services\Periodos;
use App\Support\Events;
use App\Support\RuleError;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * DEL-13 Costos de reparto (RN-DEL-13), DEL-14 Costo por entrega (RN-DEL-14, RN-DEL-15) y DEL-15 Comparativo
 * por zona. El reparto del mes crea una corrida nueva de solo inserción; se usa siempre la última.
 */
final class Costos
{
    public const GRUPOS = ['direct' => 'Directo de la ruta', 'vehicle' => 'Vehículo', 'driver' => 'Repartidor', 'carrier' => 'Empresa de delivery', 'other' => 'Otros'];

    /** Empresa del local (o la primera) para validar el período abierto (RN-PLT-05). */
    public static function empresa(?string $establecimiento): ?string
    {
        return ($establecimiento ? DB::table('establishments')->where('id', $establecimiento)->value('company_id') : null)
            ?? DB::table('companies')->orderBy('created_at')->value('id');
    }

    /** RN-DEL-13: todo costo tiene fecha, tipo, monto y un destino; el combustible, vehículo, galones y vale. */
    public static function registrar(array $c, User $u, bool $validarPeriodo = true): object
    {
        return DB::transaction(function () use ($c, $u, $validarPeriodo) {
            $tipo = (string) ($c['cost_type'] ?? '');
            Base::exigirEn($tipo, Base::COSTOS, 'RN-DEL-13', 'Elige el tipo de costo.');
            if (empty($c['cost_date'])) {
                RuleError::fail('RN-DEL-13', 'Todo costo lleva fecha.');
            }
            if (! isset($c['amount']) || $c['amount'] === '' || ! is_numeric($c['amount'])) {
                RuleError::fail('RN-DEL-13', 'Todo costo lleva monto.');
            }
            $monto = round((float) $c['amount'], 2);
            if ($monto < 0) {
                RuleError::fail('RN-DEL-13', 'El monto no puede ser negativo.');
            }
            $destinos = ['route_id', 'vehicle_id', 'employee_id', 'employee_ref', 'supplier_id', 'zone_id', 'order_id'];
            $fila = [];
            foreach ($destinos as $k) {
                $fila[$k] = ! empty($c[$k]) ? $c[$k] : null;
            }
            if (! array_filter($fila)) {
                RuleError::fail('RN-DEL-13', 'Indica al menos un destino: ruta, vehículo, repartidor, empresa de delivery o zona.');
            }
            $ruta = $fila['route_id'] ? Rutas::ruta($fila['route_id']) : null;
            $kmGal = null;
            if ($tipo === 'FUEL') {
                $fila['vehicle_id'] ??= $ruta?->vehicle_id;
                if (! $fila['vehicle_id']) {
                    RuleError::fail('RN-DEL-13', 'El combustible exige el vehículo.');
                }
                if (! isset($c['fuel_gallons']) || (float) $c['fuel_gallons'] <= 0) {
                    RuleError::fail('RN-DEL-13', 'El combustible exige los galones cargados.');
                }
                if (trim((string) ($c['fuel_voucher_no'] ?? '')) === '') {
                    RuleError::fail('RN-DEL-13', 'El combustible exige el número de vale o comprobante.');
                }
                if (! empty($c['odometer_km'])) {
                    $prev = DB::table('delivery_costs')->where('cost_type', 'FUEL')->where('vehicle_id', $fila['vehicle_id'])->where('status', 'ACTIVE')
                        ->whereNotNull('odometer_km')->where('cost_date', '<=', $c['cost_date'])->orderByDesc('odometer_km')->first(['odometer_km']);
                    if ($prev && (float) $c['odometer_km'] < (float) $prev->odometer_km) {
                        RuleError::fail('RN-DEL-13', 'El odómetro ('.number_format((float) $c['odometer_km'], 1, ',', '.').') es menor que el de la carga anterior ('.number_format((float) $prev->odometer_km, 1, ',', '.').').');
                    }
                    if ($prev) {
                        $kmGal = round(((float) $c['odometer_km'] - (float) $prev->odometer_km) / (float) $c['fuel_gallons'], 3);
                    }
                }
            }
            foreach (['vehicle_id' => 'vehicles', 'employee_id' => 'employees', 'employee_ref' => 'employees', 'supplier_id' => 'suppliers', 'zone_id' => 'delivery_zones', 'order_id' => 'sales_orders'] as $k => $t) {
                if ($fila[$k] && ! DB::table($t)->where('id', $fila[$k])->exists()) {
                    RuleError::fail('RN-DEL-13', 'El destino elegido no existe.');
                }
            }
            if ($validarPeriodo) {
                $local = $ruta?->establishment_id ?? ($fila['vehicle_id'] ? DB::table('vehicles')->where('id', $fila['vehicle_id'])->value('establishment_id') : null);
                if ($empresa = self::empresa($local)) {
                    Periodos::abierto($c['cost_date'], $empresa);
                }
            }
            $id = DB::table('delivery_costs')->insertGetId($fila + [
                'cost_date' => $c['cost_date'], 'cost_type' => $tipo, 'amount' => $monto, 'notes' => isset($c['notes']) ? mb_substr(trim((string) $c['notes']), 0, 500) ?: null : null,
                'fuel_gallons' => $tipo === 'FUEL' ? round((float) $c['fuel_gallons'], 4) : null,
                'fuel_voucher_no' => $tipo === 'FUEL' ? mb_substr(trim((string) $c['fuel_voucher_no']), 0, 40) : null,
                'odometer_km' => ! empty($c['odometer_km']) ? round((float) $c['odometer_km'], 3) : null, 'km_per_gal' => $kmGal,
                'status' => 'ACTIVE', 'registered_by' => mb_substr($u->name, 0, 120), 'created_by' => $u->id, 'auto' => (bool) ($c['auto'] ?? false),
                'pay_mode' => $c['pay_mode'] ?? null, 'subtype' => $c['subtype'] ?? null, 'expense_id' => $c['expense_id'] ?? null,
                'source' => $c['source'] ?? null, 'establishment_id' => $c['establishment_id'] ?? $ruta?->establishment_id,
            ], 'id');
            Events::emit('delivery.cost_registered', 'delivery_costs', $id, ['type' => $tipo, 'amount' => $monto]);

            return DB::table('delivery_costs')->where('id', $id)->first();
        });
    }

    public static function anular(string $id, string $motivo, User $u): object
    {
        return DB::transaction(function () use ($id, $motivo, $u) {
            $c = DB::table('delivery_costs')->where('id', $id)->lockForUpdate()->first();
            if (! $c) {
                abort(404, 'No se encontró el costo.');
            }
            if ($c->status === 'VOIDED') {
                RuleError::fail('RN-DEL-13', 'El costo ya está anulado.');
            }
            if (mb_strlen(trim($motivo)) < 5) {
                RuleError::fail('RN-DEL-13', 'Anular un costo exige el motivo.');
            }
            if ($empresa = self::empresa($c->establishment_id)) {
                Periodos::abierto($c->cost_date, $empresa);
            }
            if (DB::table('driver_expenses')->where('cost_id', $c->id)->where('status', 'ACTIVE')->exists()) {
                RuleError::fail('RN-DEL-13', 'Este costo viene de un gasto del repartidor: anula el gasto en la app (Gastos de la ruta).');
            }
            DB::table('delivery_costs')->where('id', $id)->update(['status' => 'VOIDED', 'void_reason' => mb_substr(trim($motivo), 0, 255), 'voided_at' => now(), 'voided_by' => $u->id, 'updated_at' => now()]);

            return DB::table('delivery_costs')->where('id', $id)->first();
        });
    }

    /** Al volver: pago del repartidor (jornal o por entrega) y alquiler diario del vehículo alquilado. */
    public static function automaticos(object $r, User $u): void
    {
        if ($r->mode === 'THIRD_PARTY' || ! $r->vehicle_id) {
            return;
        }
        $entregas = DB::table('delivery_stops')->where('route_id', $r->id)->where('status', 'DELIVERED')->count();
        if ($r->driver_pay_mode === 'PER_DELIVERY' && (float) $r->driver_pay_rate > 0 && $entregas > 0) {
            self::registrar(['cost_date' => $r->route_date, 'cost_type' => 'DRIVER_WAGE', 'amount' => round($entregas * (float) $r->driver_pay_rate, 2), 'route_id' => $r->id,
                'employee_ref' => $r->driver_employee_id, 'notes' => "{$entregas} entregas × ".Base::soles((float) $r->driver_pay_rate), 'auto' => true, 'pay_mode' => 'PER_DELIVERY'], $u, false);
        } elseif ($r->driver_pay_mode === 'DAILY' && (float) $r->driver_pay_rate > 0) {
            // El jornal se paga una vez al día aunque el repartidor haga varias rutas.
            $ya = DB::table('delivery_costs')->where('cost_date', $r->route_date)->where('cost_type', 'DRIVER_WAGE')->where('auto', true)->where('pay_mode', 'DAILY')
                ->where('status', 'ACTIVE')->where(fn ($q) => $q->where('employee_ref', $r->driver_employee_id)->orWhereIn('route_id',
                    DB::table('delivery_routes')->where('route_date', $r->route_date)->where('driver_user_id', $r->driver_user_id)->select('id')))->exists();
            if (! $ya) {
                self::registrar(['cost_date' => $r->route_date, 'cost_type' => 'DRIVER_WAGE', 'amount' => (float) $r->driver_pay_rate, 'route_id' => $r->id,
                    'employee_ref' => $r->driver_employee_id, 'notes' => 'Jornal del día', 'auto' => true, 'pay_mode' => 'DAILY'], $u, false);
            }
        }
        $v = DB::table('vehicles')->where('id', $r->vehicle_id)->first();
        if ($v && $v->ownership === 'RENTED' && (float) $v->rental_daily_rate > 0) {
            $ya = DB::table('delivery_costs')->where('cost_date', $r->route_date)->where('cost_type', 'RENT')->where('vehicle_id', $v->id)->where('status', 'ACTIVE')->exists();
            if (! $ya) {
                self::registrar(['cost_date' => $r->route_date, 'cost_type' => 'RENT', 'amount' => (float) $v->rental_daily_rate, 'vehicle_id' => $v->id, 'route_id' => $r->id,
                    'supplier_id' => $v->provider_id, 'notes' => 'Alquiler diario', 'auto' => true], $u, false);
            }
        }
    }

    /** Primer y último día del mes «2026-09». */
    public static function mes(string $periodo): array
    {
        $d = CarbonImmutable::parse(substr($periodo, 0, 7).'-01');

        return [$d->toDateString(), $d->endOfMonth()->toDateString()];
    }

    /**
     * RN-DEL-14 y RN-DEL-15: reparte los costos del mes entre sus entregas y crea una corrida nueva.
     * El de una ruta entre sus paradas entregadas; el de un vehículo, repartidor o empresa entre las entregas
     * de sus rutas del mes; el de una zona entre las entregas de la zona; el resto entre todas.
     */
    public static function calcular(string $periodo, User $u): array
    {
        return DB::transaction(function () use ($periodo, $u) {
            [$desde, $hasta] = self::mes($periodo);
            DB::select('SELECT pg_advisory_xact_lock(hashtext(?))', ['del:corrida:'.DB::selectOne('SELECT app_tenant_id() AS t')->t.':'.$desde]);
            $metodo = strtoupper(Base::texto('del_cost_split_method', 'EQUAL')) === 'KG' ? 'KG' : 'EQUAL';
            $entregas = DB::table('delivery_stops as s')->join('delivery_routes as r', 'r.id', '=', 's.route_id')->join('sales_orders as o', 'o.id', '=', 's.order_id')
                ->whereBetween('r.route_date', [$desde, $hasta])->where('r.status', '<>', 'CANCELLED')->where('s.status', 'DELIVERED')
                ->get(['s.id', 's.route_id', 's.order_id', 's.zone_id', 's.kg', 'r.mode', 'r.vehicle_id', 'r.driver_employee_id', 'r.carrier_supplier_id', 'o.delivery_fee'])
                ->keyBy('id');
            if ($entregas->isEmpty()) {
                RuleError::fail('RN-DEL-14', 'No hay entregas en '.self::nombreMes($desde).': no hay entre quiénes repartir el costo.');
            }
            $costos = DB::table('delivery_costs')->whereBetween('cost_date', [$desde, $hasta])->where('status', 'ACTIVE')
                ->whereNotIn('cost_type', ['PROVINCE_FREIGHT', 'PACKAGING'])->get();
            $acum = [];
            foreach ($entregas as $id => $e) {
                $acum[$id] = array_fill_keys(array_keys(self::GRUPOS), 0.0);
            }
            foreach ($costos as $c) {
                $grupo = Base::GRUPO[$c->cost_type] ?? 'other';
                $empleado = $c->employee_id ?? $c->employee_ref;
                $destino = collect();
                foreach ([
                    fn () => $c->route_id ? $entregas->where('route_id', $c->route_id) : collect(),
                    fn () => $c->vehicle_id ? $entregas->where('vehicle_id', $c->vehicle_id) : collect(),
                    fn () => $empleado ? $entregas->where('driver_employee_id', $empleado) : collect(),
                    fn () => $c->supplier_id ? $entregas->where('carrier_supplier_id', $c->supplier_id) : collect(),
                    fn () => $c->zone_id ? $entregas->where('zone_id', $c->zone_id) : collect(),
                ] as $paso) {
                    $destino = $paso();
                    if ($destino->isNotEmpty()) {
                        break;
                    }
                }
                if ($destino->isEmpty()) {
                    $destino = $entregas;
                }
                $pesos = $destino->map(fn ($e) => $metodo === 'KG' ? max(0.0, (float) $e->kg) : 1.0);
                $suma = $pesos->sum();
                if ($suma <= 0) {
                    $pesos = $destino->map(fn () => 1.0);
                    $suma = $pesos->count();
                }
                foreach ($pesos as $id => $p) {
                    $acum[$id][$grupo] += (float) $c->amount * $p / $suma;
                }
            }
            $corrida = (int) DB::table('delivery_cost_allocations')->where('period', $desde)->max('run_no') + 1;
            $ahora = now();
            $filas = [];
            foreach ($entregas as $id => $e) {
                $a = $acum[$id];
                $total = round(array_sum($a), 4);
                $cobrado = round((float) ($e->delivery_fee ?? 0), 2);
                $filas[] = [
                    'period' => $desde, 'run_no' => $corrida, 'stop_id' => $id, 'route_id' => $e->route_id, 'order_id' => $e->order_id, 'zone_id' => $e->zone_id,
                    'mode' => $e->mode, 'direct_cost' => round($a['direct'], 4), 'vehicle_cost' => round($a['vehicle'], 4), 'driver_cost' => round($a['driver'], 4),
                    'carrier_cost' => round($a['carrier'], 4), 'other_cost' => round($a['other'], 4), 'total_cost' => $total, 'kg_delivered' => round((float) $e->kg, 3),
                    // RN-DEL-15: con delivery gratis (cobrado 0) el subsidio es el costo completo.
                    'fee_charged' => $cobrado, 'subsidy' => round($total - $cobrado, 4), 'method' => $metodo, 'run_at' => $ahora, 'run_by' => mb_substr($u->name, 0, 120),
                ];
            }
            foreach (array_chunk($filas, 500) as $parte) {
                DB::table('delivery_cost_allocations')->insert($parte);
            }
            Events::emit('delivery.cost_allocated', null, null, ['period' => $desde, 'run_no' => $corrida, 'deliveries' => count($filas)]);

            return ['period' => $desde, 'run_no' => $corrida, 'entregas' => count($filas), 'costo_total' => round(array_sum(array_column($filas, 'total_cost')), 2), 'metodo' => $metodo];
        });
    }

    public static function nombreMes(string $fecha): string
    {
        $m = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
        $d = CarbonImmutable::parse($fecha);

        return $m[$d->month - 1].' de '.$d->year;
    }

    public static function ultimaCorrida(string $desde): ?int
    {
        $n = DB::table('delivery_cost_allocations')->where('period', $desde)->max('run_no');

        return $n !== null ? (int) $n : null;
    }

    /** DEL-14: costo por entrega del mes, agrupado por zona, modalidad, vehículo, repartidor o ruta (de la última corrida). */
    public static function resumen(string $periodo, string $por): array
    {
        [$desde] = self::mes($periodo);
        $corrida = self::ultimaCorrida($desde);
        if ($corrida === null) {
            return ['period' => $desde, 'run_no' => null, 'filas' => [], 'total' => null, 'corridas' => []];
        }
        $base = DB::table('delivery_cost_allocations as a')->join('delivery_routes as r', 'r.id', '=', 'a.route_id')
            ->where('a.period', $desde)->where('a.run_no', $corrida);
        [$clave, $nombre, $joins] = match ($por) {
            'mode' => ['a.mode', 'a.mode', fn ($q) => $q],
            'vehicle' => ['r.vehicle_id', "coalesce(v.plate, 'Sin vehículo')", fn ($q) => $q->leftJoin('vehicles as v', 'v.id', '=', 'r.vehicle_id')],
            'driver' => ['coalesce(r.driver_user_id::text, r.carrier_supplier_id::text)', "coalesce(u.name, c.trade_name, '—')",
                fn ($q) => $q->leftJoin('users as u', 'u.id', '=', 'r.driver_user_id')->leftJoin('suppliers as c', 'c.id', '=', 'r.carrier_supplier_id')],
            'route' => ['a.route_id', "r.code || ' · ' || to_char(r.route_date, 'DD/MM')", fn ($q) => $q],
            default => ['a.zone_id', "coalesce(z.name, '—')", fn ($q) => $q->leftJoin('delivery_zones as z', 'z.id', '=', 'a.zone_id')],
        };
        $filas = $joins(clone $base)->groupByRaw("{$clave}, {$nombre}")
            ->selectRaw("{$clave} AS clave, {$nombre} AS nombre, count(*) AS entregas, sum(a.total_cost) AS costo, sum(a.kg_delivered) AS kg, sum(a.subsidy) AS subsidio,
                sum(a.fee_charged) AS cobrado, sum(a.direct_cost) AS directo, sum(a.vehicle_cost) AS vehiculo, sum(a.driver_cost) AS repartidor, sum(a.carrier_cost) AS tercero, sum(a.other_cost) AS otros")
            ->orderByRaw('sum(a.total_cost) / count(*) DESC')->get();
        // Km de las rutas propias y alquiladas del grupo (odómetro final − inicial, o lo planificado).
        $kmPorRuta = DB::table('delivery_routes')->whereIn('id', (clone $base)->select('a.route_id'))->whereIn('mode', ['OWN', 'RENTED'])
            ->get(['id', 'vehicle_id', 'driver_user_id', 'mode', 'odometer_start', 'odometer_end', 'planned_km'])
            ->mapWithKeys(fn ($r) => [$r->id => ['km' => $r->odometer_end !== null && $r->odometer_start !== null && $r->odometer_end > $r->odometer_start
                ? (float) $r->odometer_end - (float) $r->odometer_start : (float) $r->planned_km, 'vehicle' => $r->vehicle_id, 'driver' => $r->driver_user_id, 'mode' => $r->mode]]);
        $kmGrupo = [];
        foreach ($kmPorRuta as $rid => $x) {
            $g = match ($por) {
                'mode' => $x['mode'], 'vehicle' => $x['vehicle'], 'driver' => $x['driver'], 'route' => $rid, default => null,
            };
            if ($g !== null) {
                $kmGrupo[$g] = ($kmGrupo[$g] ?? 0) + $x['km'];
            }
        }
        $out = $filas->map(function ($f) use ($kmGrupo, $por) {
            $n = (int) $f->entregas;
            $costo = (float) $f->costo;
            $km = $por === 'zone' ? null : ($kmGrupo[$f->clave] ?? null);

            return [
                'clave' => $f->clave, 'nombre' => $por === 'mode' ? (Base::MODOS[$f->nombre] ?? $f->nombre) : $f->nombre, 'entregas' => $n, 'costo' => round($costo, 2),
                'por_entrega' => $n ? round($costo / $n, 2) : null, 'kg' => round((float) $f->kg, 3), 'por_kg' => (float) $f->kg > 0 ? round($costo / (float) $f->kg, 2) : null,
                'km' => $km !== null ? round($km, 1) : null, 'por_km' => $km ? round($costo / $km, 2) : null, 'subsidio' => round((float) $f->subsidio, 2),
                'cobrado' => round((float) $f->cobrado, 2),
                'grupos' => ['direct' => round((float) $f->directo, 2), 'vehicle' => round((float) $f->vehiculo, 2), 'driver' => round((float) $f->repartidor, 2),
                    'carrier' => round((float) $f->tercero, 2), 'other' => round((float) $f->otros, 2)],
            ];
        })->values()->all();
        $t = (clone $base)->selectRaw('count(*) n, sum(a.total_cost) c, sum(a.kg_delivered) kg, sum(a.subsidy) s, max(a.run_at) at, max(a.run_by) por, max(a.method) metodo')->first();
        $kmTotal = array_sum(array_column($kmPorRuta->all(), 'km'));
        $costoPropio = (float) (clone $base)->whereIn('a.mode', ['OWN', 'RENTED'])->sum('a.total_cost');
        $corridas = DB::table('delivery_cost_allocations')->where('period', $desde)->groupBy('run_no')
            ->selectRaw('run_no, max(run_at) AS at, max(run_by) AS por, sum(total_cost) AS costo, count(*) AS entregas')->orderByDesc('run_no')->get();

        return [
            'period' => $desde, 'run_no' => $corrida, 'filas' => $out,
            'total' => ['entregas' => (int) $t->n, 'costo' => round((float) $t->c, 2), 'por_entrega' => $t->n ? round((float) $t->c / $t->n, 2) : null,
                'por_kg' => (float) $t->kg > 0 ? round((float) $t->c / (float) $t->kg, 2) : null, 'km' => round($kmTotal, 1),
                'por_km' => $kmTotal > 0 ? round($costoPropio / $kmTotal, 2) : null, 'subsidio' => round((float) $t->s, 2), 'metodo' => $t->metodo, 'at' => $t->at, 'por' => $t->por],
            'corridas' => $corridas->map(fn ($c) => ['run_no' => (int) $c->run_no, 'at' => $c->at, 'por' => $c->por, 'costo' => round((float) $c->costo, 2), 'entregas' => (int) $c->entregas])->all(),
        ];
    }

    /** DEL-15: costo por entrega propio y alquilado frente a la tarifa del tercero, por zona, con la sugerencia. */
    public static function comparativo(string $periodo): array
    {
        [$desde, $hasta] = self::mes($periodo);
        $corrida = self::ultimaCorrida($desde);
        if ($corrida === null) {
            return ['period' => $desde, 'run_no' => null, 'zonas' => []];
        }
        $filas = DB::table('delivery_cost_allocations as a')->leftJoin('delivery_zones as z', 'z.id', '=', 'a.zone_id')
            ->where('a.period', $desde)->where('a.run_no', $corrida)->groupBy('a.zone_id', 'z.name', 'a.mode')
            ->selectRaw('a.zone_id, z.name, a.mode, count(*) n, sum(a.total_cost) c, avg(a.kg_delivered) kg')->get()->groupBy('zone_id');
        $zonas = [];
        foreach ($filas as $zona => $porModo) {
            $m = $porModo->keyBy('mode');
            $pe = fn ($k) => isset($m[$k]) && $m[$k]->n ? round((float) $m[$k]->c / $m[$k]->n, 2) : null;
            $kgProm = (float) $porModo->avg('kg');
            $tarifa = Terceros::mejorTarifa($zona, $hasta, $kgProm);
            $propio = $pe('OWN') ?? $pe('RENTED');
            $dif = $propio !== null && $tarifa ? round($propio - $tarifa['por_entrega'], 2) : null;
            $zonas[] = [
                'zone_id' => $zona, 'zona' => $porModo->first()->name ?? '—', 'entregas' => (int) $porModo->sum('n'),
                'propia' => $pe('OWN'), 'alquilada' => $pe('RENTED'), 'tercero' => $pe('THIRD_PARTY'),
                'tarifa' => $tarifa, 'diferencia' => $dif,
                'sugerencia' => $dif === null ? 'SIN_DATOS' : ($dif > Base::EPS ? 'EVALUAR_TERCERIZAR' : 'MANTENER_PROPIO'),
            ];
        }
        usort($zonas, fn ($a, $b) => ($b['diferencia'] ?? -INF) <=> ($a['diferencia'] ?? -INF));

        return ['period' => $desde, 'run_no' => $corrida, 'zonas' => $zonas];
    }
}
