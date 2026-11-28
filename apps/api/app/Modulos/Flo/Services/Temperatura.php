<?php

namespace App\Modulos\Flo\Services;

use App\Models\User;
use App\Support\Access;
use App\Support\RuleError;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * FLO-13 Temperatura de vehículos refrigerados (RN-FLO-14): cada lectura fuera de rango queda marcada; si la excursión
 * dura más de flo_temp_excursion_minutes se alerta y los pedidos de la ruta pasan a revisión de calidad.
 * Las lecturas son de solo inserción (RN-FLO-03).
 */
final class Temperatura
{
    public static function registrar(array $d, User $u, string $fuente = 'SENSOR'): array
    {
        if (! Access::can($u, 'flo.live.view') && ! Access::can($u, 'flo.trip.operate')) {
            abort(403, 'Registrar temperaturas es del coordinador o de la app del conductor.');
        }

        return DB::transaction(function () use ($d, $u, $fuente) {
            $v = Base::vehiculo($d['vehicle_id'] ?? null, Access::can($u, 'flo.live.view') ? $u : null, 'RN-FLO-14');
            $p = Base::perfil($v);
            $rango = Base::rango($v, $p);
            if (! $rango) {
                RuleError::fail('RN-FLO-14', "{$v->plate} no es refrigerado: configura su rango de temperatura en la ficha del vehículo.");
            }
            $en = Base::momento($d['read_at'] ?? null, 'RN-FLO-14', 'Indica la hora de la lectura.');
            if ($en->greaterThan(Base::ahora()->addMinutes(5))) {
                RuleError::fail('RN-FLO-14', 'La hora de la lectura está en el futuro.');
            }
            if (! isset($d['temp_c']) || ! is_numeric($d['temp_c']) || (float) $d['temp_c'] < -50 || (float) $d['temp_c'] > 60) {
                RuleError::fail('RN-FLO-14', 'Indica la temperatura en °C.');
            }
            $c = round((float) $d['temp_c'], 1);
            if (DB::table('vehicle_temperature_readings')->where('vehicle_id', $v->id)->where('read_at', $en)->exists()) {
                RuleError::fail('RN-FLO-03', 'Ya hay una lectura de ese vehículo a esa hora.');
            }
            $t = DB::table('vehicle_trips')->where('vehicle_id', $v->id)->whereNotNull('started_at')->where('started_at', '<=', $en)
                ->where(fn ($w) => $w->where('status', 'OPEN')->orWhere(fn ($x) => $x->where('status', 'CLOSED')->where('ended_at', '>=', $en)))->first();
            $dentro = ($rango['min'] === null || $c >= $rango['min']) && ($rango['max'] === null || $c <= $rango['max']);
            $id = DB::table('vehicle_temperature_readings')->insertGetId([
                'vehicle_id' => $v->id, 'trip_id' => $t?->id, 'read_at' => $en, 'temp_c' => $c, 'in_range' => $dentro, 'range_min' => $rango['min'], 'range_max' => $rango['max'],
                'sensor_id' => $p->temp_sensor_id, 'source' => $fuente === 'MANUAL' ? 'MANUAL' : 'SENSOR', 'recorded_by' => $u->id,
            ], 'id');
            $alerta = (! $dentro && $t) ? self::revisarExcursion($v, $t, $en) : null;

            return ['lectura' => DB::table('vehicle_temperature_readings')->where('id', $id)->first(), 'alerta' => $alerta];
        });
    }

    /** Excursiones: lecturas seguidas fuera de rango en la misma jornada; dura hasta la siguiente lectura en rango (o la última). */
    public static function excursiones(string $vehiculoId, string $desde, string $hasta): array
    {
        $rs = DB::table('vehicle_temperature_readings')->where('vehicle_id', $vehiculoId)
            ->whereBetween('read_at', [CarbonImmutable::parse($desde, 'America/Lima')->startOfDay(), CarbonImmutable::parse($hasta, 'America/Lima')->endOfDay()])
            ->orderBy('read_at')->get(['read_at', 'temp_c', 'in_range', 'trip_id']);
        $out = [];
        $cur = null;
        foreach ($rs as $x) {
            if (! $x->in_range) {
                if (! $cur || $cur['trip_id'] !== $x->trip_id) {
                    if ($cur) {
                        $out[] = $cur;
                    }
                    $cur = ['trip_id' => $x->trip_id, 'inicio' => $x->read_at, 'fin' => $x->read_at, 'max' => (float) $x->temp_c, 'min' => (float) $x->temp_c, 'lecturas' => 1, 'sigue' => true];
                } else {
                    $cur['fin'] = $x->read_at;
                    $cur['lecturas']++;
                    $cur['max'] = max($cur['max'], (float) $x->temp_c);
                    $cur['min'] = min($cur['min'], (float) $x->temp_c);
                }
            } elseif ($cur) {
                if ($cur['trip_id'] === $x->trip_id) {
                    $cur['fin'] = $x->read_at;
                    $cur['sigue'] = false;
                }
                $out[] = $cur;
                $cur = null;
            }
        }
        if ($cur) {
            $out[] = $cur;
        }
        foreach ($out as &$e) {
            $e['minutos'] = (int) round(CarbonImmutable::parse($e['inicio'])->diffInSeconds(CarbonImmutable::parse($e['fin'])) / 60);
        }

        return $out;
    }

    /** Si la excursión de la jornada pasa el límite: alerta (una por jornada) y pedidos de la ruta a revisión. */
    public static function revisarExcursion(object $v, object $t, CarbonImmutable $en, bool $silencio = false): ?object
    {
        $lim = Base::num('flo_temp_excursion_minutes', 15);
        $ex = collect(self::excursiones($v->id, $t->trip_date, $en->toDateString()))->where('trip_id', $t->id)->last();
        if (! $ex || $ex['minutos'] <= $lim) {
            return null;
        }
        $rango = Base::rango($v);
        $afectados = DB::table('delivery_stops as s')->join('delivery_routes as r', 'r.id', '=', 's.route_id')->join('sales_orders as o', 'o.id', '=', 's.order_id')
            ->where('r.vehicle_id', $v->id)->where('r.route_date', $t->trip_date)->whereNotIn('s.status', ['CANCELLED', 'RESCHEDULED'])
            ->where(fn ($w) => $w->whereNull('s.closed_at')->orWhere('s.closed_at', '>=', $ex['inicio']))
            ->get(['o.id', 'o.number']);
        $prev = DB::table('fleet_alerts')->where('vehicle_id', $v->id)->where('alert_type', 'TEMPERATURE')->where('origin', 'trip:'.$t->id)->where('status', '<>', 'CLOSED')->first();
        [$a] = Alertas::levantar([
            'type' => 'TEMPERATURE', 'vehicle_id' => $v->id, 'employee_id' => $t->driver_employee_id, 'origin' => 'trip:'.$t->id, 'at' => $en, 'severity' => 'bad',
            'title' => "Temperatura fuera de rango {$ex['minutos']} min · {$v->plate}",
            'detail' => 'RN-FLO-14: '.Base::km($ex['min'], 1).' a '.Base::km($ex['max'], 1).' °C desde las '.Base::hora($ex['inicio']).' (rango '.($rango['min'] ?? '—').' a '.$rango['max']." °C, límite {$lim} min). "
                .$afectados->count().' pedido(s) de la ruta pasan a revisión de calidad.',
            'extra' => ['excursion_start' => $ex['inicio'], 'excursion_minutes' => $ex['minutos'], 'max_value' => $ex['max']], 'silencio' => $silencio,
        ]);
        $lista = json_decode($a->order_reviews ?: '[]', true);
        $ya = array_column($lista, 'order_id');
        foreach ($afectados as $o) {
            if (! in_array($o->id, $ya, true)) {
                $lista[] = ['order_id' => $o->id, 'number' => $o->number, 'status' => 'PENDING', 'decided_by' => null, 'decided_at' => null, 'note' => null];
            }
        }
        DB::table('fleet_alerts')->where('id', $a->id)->update(['order_reviews' => json_encode($lista, JSON_UNESCAPED_UNICODE), 'updated_at' => now()]);
        if (! $prev && ! $silencio) {
            Base::avisar(['role' => 'CALIDAD'], "Revisar pedidos por temperatura · {$v->plate}", count($lista)." pedido(s) de la jornada {$t->number}", 'FLO-14', $a->id, 'bad');
        }

        return DB::table('fleet_alerts')->where('id', $a->id)->first();
    }

    /** FLO-13: lecturas de una jornada (o de un día) con el rango y las excursiones de los últimos 45 días. */
    public static function vista(?string $vehiculoId, ?string $fecha, User $u): array
    {
        $refrigerados = Base::flota($u)->where('v.refrigerated', true)->get(['v.*']);
        $v = $vehiculoId ? Base::vehiculo($vehiculoId, $u) : $refrigerados->first();
        if (! $v) {
            return ['vehiculos' => [], 'vehiculo' => null];
        }
        $fecha ??= DB::table('vehicle_temperature_readings')->where('vehicle_id', $v->id)->max(DB::raw("(read_at AT TIME ZONE 'America/Lima')::date")) ?? Base::hoy();
        $rango = Base::rango($v);
        $lecturas = DB::table('vehicle_temperature_readings')->where('vehicle_id', $v->id)
            ->whereBetween('read_at', [CarbonImmutable::parse($fecha, 'America/Lima')->startOfDay(), CarbonImmutable::parse($fecha, 'America/Lima')->endOfDay()])
            ->orderBy('read_at')->get(['read_at', 'temp_c', 'in_range', 'trip_id', 'source'])
            ->map(fn ($r) => ['t' => $r->read_at, 'c' => (float) $r->temp_c, 'ok' => (bool) $r->in_range, 'trip_id' => $r->trip_id, 'source' => $r->source])->all();
        // Excursiones de los 45 días previos al día elegido (o a hoy) hasta hoy.
        $desde = CarbonImmutable::parse(min($fecha, Base::hoy()))->subDays(45)->toDateString();
        $lim = Base::num('flo_temp_excursion_minutes', 15);
        $ex = array_reverse(self::excursiones($v->id, $desde, Base::hoy()));
        $alertas = DB::table('fleet_alerts')->where('vehicle_id', $v->id)->where('alert_type', 'TEMPERATURE')->get()->keyBy('origin');
        $numeros = DB::table('vehicle_trips')->whereIn('id', array_filter(array_column($ex, 'trip_id')))->pluck('number', 'id');
        foreach ($ex as &$e) {
            $a = $e['trip_id'] ? ($alertas['trip:'.$e['trip_id']] ?? null) : null;
            $e['jornada'] = $numeros[$e['trip_id']] ?? null;
            $e['alerta'] = $a ? Alertas::aFila($a) : null;
            $e['grave'] = $e['minutos'] > $lim;
        }
        unset($e);
        $fuera = 0.0;
        $m = CarbonImmutable::parse($fecha);  // minutos fuera de rango del mes del día elegido
        foreach (self::excursiones($v->id, $m->startOfMonth()->toDateString(), min($m->endOfMonth()->toDateString(), Base::hoy())) as $e) {
            $fuera += $e['minutos'];
        }
        $dias = DB::table('vehicle_temperature_readings')->where('vehicle_id', $v->id)->selectRaw("DISTINCT (read_at AT TIME ZONE 'America/Lima')::date AS d")
            ->orderByDesc('d')->limit(45)->pluck('d')->all();

        return [
            'vehiculos' => $refrigerados->map(fn ($x) => ['id' => $x->id, 'etiqueta' => Base::etiqueta($x)])->all(),
            'vehiculo' => ['id' => $v->id, 'etiqueta' => Base::etiqueta($v), 'sensor' => Base::perfil($v)->temp_sensor_id], 'fecha' => $fecha, 'rango' => $rango, 'limite' => $lim,
            'lecturas' => $lecturas, 'excursiones' => $ex, 'dias' => $dias,
            'resumen' => ['lecturas' => count($lecturas), 'fuera' => count(array_filter($lecturas, fn ($x) => ! $x['ok'])),
                'max' => $lecturas ? max(array_column($lecturas, 'c')) : null, 'min' => $lecturas ? min(array_column($lecturas, 'c')) : null,
                'minutos_mes' => (int) $fuera, 'excursiones_graves' => count(array_filter($ex, fn ($x) => $x['grave']))],
        ];
    }
}
