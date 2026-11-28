<?php

namespace App\Modulos\Flo\Services;

use App\Models\User;
use App\Support\Access;
use App\Support\RuleError;
use Carbon\CarbonImmutable;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;

/**
 * FLO-15 App · Jornada y FLO-03 Jornadas y km reales: inicio y cierre con odómetro, foto del tablero y checklist
 * (RN-FLO-02, 04, 05, 11, 12) y las posiciones GPS de la app (RN-FLO-01, 02, 03, 19).
 */
final class Jornadas
{
    public static function abiertaDe(string $vehiculoId): ?object
    {
        return DB::table('vehicle_trips')->where('vehicle_id', $vehiculoId)->where('status', 'OPEN')->first();
    }

    public static function abiertaDeConductor(string $userId): ?object
    {
        return DB::table('vehicle_trips')->where('driver_user_id', $userId)->where('status', 'OPEN')->first();
    }

    /** Ítems del checklist según el vehículo: la caja térmica, solo en motos y refrigerados. */
    public static function checklist(object $v): array
    {
        return array_filter(Base::CHECKLIST, fn ($k) => $k !== 'thermal_box' || $v->vehicle_type === 'MOTO' || $v->refrigerated, ARRAY_FILTER_USE_KEY);
    }

    /** El conductor de la jornada: el propio usuario, o el que elige el coordinador. */
    private static function conductor(array $d, User $u): string
    {
        $coordina = Access::can($u, 'flo.live.view');
        if (! $coordina && ! Access::can($u, 'flo.trip.operate')) {
            abort(403, 'Abrir y cerrar jornadas es del conductor (o del coordinador por él).');
        }
        $elegido = $d['driver_user_id'] ?? null ?: null;
        if ($elegido && $elegido !== $u->id && ! $coordina) {
            abort(403, 'Solo abres tu propia jornada.');
        }

        return $elegido ?? $u->id;
    }

    private static function visible(string $id, User $u, bool $bloquear = false): object
    {
        $q = DB::table('vehicle_trips')->where('id', $id);
        $t = $bloquear ? $q->lockForUpdate()->first() : $q->first();
        if (! $t) {
            abort(404, 'No se encontró la jornada.');
        }
        Base::vehiculo($t->vehicle_id, $u, 'RN-FLO-02');
        if (! Access::can($u, 'flo.live.view') && ! Access::can($u, 'flo.fuel.manage') && $t->driver_user_id !== $u->id) {
            abort(404, 'No se encontró la jornada.');
        }

        return $t;
    }

    public static function iniciar(array $d, UploadedFile|string|null $foto, User $u): object
    {
        $uid = self::conductor($d, $u);

        return DB::transaction(function () use ($d, $foto, $u, $uid) {
            $v = Base::vehiculo($d['vehicle_id'] ?? null, null, 'RN-FLO-02');
            DB::table('vehicles')->where('id', $v->id)->lockForUpdate()->first();
            $en = Base::ahora();
            $fecha = $en->toDateString();
            if ($t = self::abiertaDe($v->id)) {
                RuleError::fail('RN-FLO-02', "{$v->plate} ya tiene la jornada {$t->number} abierta desde las ".Base::hora($t->started_at).' del '.Base::fecha($t->trip_date).': un vehículo tiene una sola jornada abierta a la vez.');
            }
            if ($t = self::abiertaDeConductor($uid)) {
                $p = DB::table('vehicles')->where('id', $t->vehicle_id)->value('plate');
                RuleError::fail('RN-FLO-02', Base::nombre($uid)." ya tiene abierta la jornada {$t->number} con {$p}.");
            }
            Documentos::exigirLicencia($uid, $fecha);            // RN-FLO-12
            Operable::exigir($v, $fecha);                        // RN-FLO-11
            $items = self::checklist($v);
            $ch = (array) ($d['checklist'] ?? []);
            $faltan = array_filter($items, fn ($k) => ! array_key_exists($k, $ch) || $ch[$k] === null || $ch[$k] === '', ARRAY_FILTER_USE_KEY);
            if ($faltan) {
                RuleError::fail('RN-FLO-02', 'Completa el checklist: '.mb_strtolower(implode(', ', $faltan)).'.');
            }
            $limpio = [];
            foreach ($items as $k => $n) {
                $limpio[$k] = filter_var($ch[$k], FILTER_VALIDATE_BOOLEAN);
            }
            $malos = array_keys(array_filter($limpio, fn ($x) => ! $x));
            $nota = trim((string) ($d['notes'] ?? ''));
            if ($malos && mb_strlen($nota) < 5) {
                RuleError::fail('RN-FLO-02', 'Marcaste con observación: '.mb_strtolower(implode(', ', array_intersect_key($items, array_flip($malos)))).'. Describe la observación para el coordinador.');
            }
            $odo = Odometro::exigir($v, $d['odometer'] ?? null, $en);   // RN-FLO-04
            $fotoId = Archivo::guardar($foto, null, null, $u, 'RN-FLO-04', 'Toma la foto del tablero con el odómetro para iniciar la jornada.');
            $ruta = DB::table('delivery_routes')->where('vehicle_id', $v->id)->where('route_date', $fecha)->whereNotIn('status', ['CANCELLED'])->orderBy('slot_from')->value('id');
            $prog = DB::table('vehicle_trips')->where('vehicle_id', $v->id)->where('trip_date', $fecha)->where('status', 'PLANNED')->lockForUpdate()->first();
            $fila = [
                'vehicle_id' => $v->id, 'driver_user_id' => $uid, 'driver_employee_id' => Base::empleadoDe($uid), 'establishment_id' => $v->establishment_id,
                'route_id' => $ruta ?? $prog?->route_id, 'trip_date' => $fecha, 'status' => 'OPEN', 'source' => ($d['source'] ?? 'APP') === 'WEB' ? 'WEB' : 'APP',
                'started_at' => $en, 'odometer_start' => $odo, 'start_photo_file_id' => $fotoId, 'checklist_start' => json_encode($limpio),
                'notes' => $nota !== '' ? mb_substr($nota, 0, 1000) : null, 'updated_at' => now(),
            ];
            if ($prog) {
                DB::table('vehicle_trips')->where('id', $prog->id)->update($fila);
                $id = $prog->id;
            } else {
                $id = DB::table('vehicle_trips')->insertGetId($fila + ['number' => Base::numero('vehicle_trips', 'JR-', 6), 'created_by' => $u->id], 'id');
            }
            Odometro::registrar($v, $odo, $en, 'TRIP_START', $id, $u);
            if ($malos) {
                Base::avisar(['role' => 'COORDINADOR_DELIVERY'], "Checklist con observación · {$v->plate}",
                    Base::nombre($uid).': '.implode(', ', array_intersect_key($items, array_flip($malos))).' · '.$nota, 'FLO-03', $id, 'warn');
            }

            return DB::table('vehicle_trips')->where('id', $id)->first();
        });
    }

    public static function cerrar(string $id, array $d, UploadedFile|string|null $foto, User $u): object
    {
        return DB::transaction(function () use ($id, $d, $foto, $u) {
            $t = self::visible($id, $u, true);
            if ($t->driver_user_id !== $u->id && ! Access::can($u, 'flo.live.view')) {
                abort(403, 'Solo cierras tu propia jornada.');
            }
            if ($t->status !== 'OPEN') {
                RuleError::fail('RN-FLO-02', "La jornada {$t->number} no está abierta.");
            }
            $v = DB::table('vehicles')->where('id', $t->vehicle_id)->lockForUpdate()->first();
            $en = Base::ahora();
            if (! isset($d['odometer']) || ! is_numeric($d['odometer'])) {
                RuleError::fail('RN-FLO-04', 'Indica el odómetro final.');
            }
            if ((float) $d['odometer'] < (float) $t->odometer_start) {
                RuleError::fail('RN-FLO-04', 'El odómetro final ('.Base::km((float) $d['odometer']).' km) no puede ser menor que el inicial ('.Base::km((float) $t->odometer_start).' km).');
            }
            $odo = Odometro::exigir($v, $d['odometer'], $en);
            $fotoId = Archivo::guardar($foto, null, null, $u, 'RN-FLO-04', 'Toma la foto del tablero para cerrar la jornada.');
            $ch = [];
            foreach ((array) ($d['checklist'] ?? []) as $k => $x) {
                if (isset(Base::CHECKLIST[$k])) {
                    $ch[$k] = filter_var($x, FILTER_VALIDATE_BOOLEAN);
                }
            }
            self::guardarCierre($t, $odo, $en, $fotoId, $ch ?: null, trim((string) ($d['notes'] ?? '')) ?: null);
            Odometro::registrar($v, $odo, $en, 'TRIP_END', $t->id, $u);
            Alertas::cerrarPor('GPS_SILENT', ['trip:'.$t->id], 'Jornada cerrada', $u);

            return DB::table('vehicle_trips')->where('id', $t->id)->first();
        });
    }

    /** Cierre con km por odómetro y por GPS, entregas y la alerta de RN-FLO-05. También lo usa la demo. */
    public static function guardarCierre(object $t, float $odo, CarbonImmutable $en, ?string $fotoId, ?array $checklist, ?string $nota): void
    {
        $kmO = round($odo - (float) $t->odometer_start, 1);
        $kmG = self::kmGps($t->id);
        $dif = $kmG > 0 ? round(($kmO - $kmG) / $kmG * 100, 1) : null;
        DB::table('vehicle_trips')->where('id', $t->id)->update([
            'status' => 'CLOSED', 'ended_at' => $en, 'odometer_end' => $odo, 'km_odometer' => $kmO, 'km_gps' => $kmG > 0 ? $kmG : null, 'km_diff_pct' => $dif,
            'deliveries' => self::entregas($t), 'end_photo_file_id' => $fotoId, 'checklist_end' => $checklist ? json_encode($checklist) : null,
            'end_notes' => $nota ? mb_substr($nota, 0, 1000) : null, 'updated_at' => now(),
        ]);
        $tol = Base::num('flo_km_gps_tolerance_pct', 15);
        if ($dif !== null && abs($dif) > $tol) {
            Alertas::levantar([
                'type' => 'ODOMETER', 'vehicle_id' => $t->vehicle_id, 'employee_id' => $t->driver_employee_id, 'origin' => 'trip:'.$t->id, 'at' => $en, 'severity' => 'warn',
                'title' => 'Km de odómetro y GPS difieren '.Base::km(abs($dif), 1)." % ({$t->number})",
                'detail' => 'RN-FLO-05: odómetro '.Base::km($kmO, 1).' km, GPS '.Base::km($kmG, 1).' km en la jornada del '.Base::fecha($t->trip_date)."; la tolerancia es {$tol} %.",
            ]);
        }
    }

    /** Km por GPS: suma de tramos entre posiciones seguidas (sin saltos de más de 2 km entre dos lecturas de 30 s). */
    public static function kmGps(string $tripId): float
    {
        $ps = DB::table('vehicle_positions')->where('trip_id', $tripId)->orderBy('recorded_at')->get(['lat', 'lng']);
        $k = 0.0;
        for ($i = 1; $i < count($ps); $i++) {
            $k += Base::distancia((float) $ps[$i - 1]->lat, (float) $ps[$i - 1]->lng, (float) $ps[$i]->lat, (float) $ps[$i]->lng);
        }

        return round($k, 1);
    }

    /** Entregas del día: paradas entregadas en las rutas de DEL de ese vehículo y conductor. */
    public static function entregas(object $t): int
    {
        return (int) DB::table('delivery_stops as s')->join('delivery_routes as r', 'r.id', '=', 's.route_id')
            ->where('r.vehicle_id', $t->vehicle_id)->where('r.route_date', $t->trip_date)
            ->when($t->driver_user_id, fn ($w) => $w->where('r.driver_user_id', $t->driver_user_id))
            ->whereIn('s.status', ['DELIVERED', 'HANDED_OFF'])->count();
    }

    /**
     * RN-FLO-01/02: una posición de la app. Solo dentro de una jornada abierta del vehículo (o ya cerrada, si la
     * hora cae entre su inicio y su cierre: la app sube en lote al recuperar señal); vehículo y hora no se repiten.
     */
    public static function posicion(array $p, User $u, ?string $origen = null): array
    {
        $v = DB::table('vehicles')->where('id', $p['vehicle_id'] ?? null)->first();
        if (! $v) {
            RuleError::fail('RN-FLO-02', 'Vehículo no encontrado.');
        }
        $en = Base::momento($p['recorded_at'] ?? null, 'RN-FLO-01', 'Cada posición lleva su hora.');
        if ($en->greaterThan(Base::ahora()->addMinutes(5))) {
            RuleError::fail('RN-FLO-01', 'La hora de la posición está en el futuro: revisa la hora del teléfono.');
        }
        if (DB::table('vehicle_positions')->where('vehicle_id', $v->id)->where('recorded_at', $en)->exists()) {
            return ['duplicada' => true];
        }
        $t = DB::table('vehicle_trips')->where('vehicle_id', $v->id)->whereNotNull('started_at')->where('started_at', '<=', $en)
            ->where(fn ($w) => $w->where('status', 'OPEN')->orWhere(fn ($x) => $x->where('status', 'CLOSED')->where('ended_at', '>=', $en)))->first();
        if (! $t) {
            RuleError::fail('RN-FLO-02', "{$v->plate} no tiene una jornada abierta a las ".$en->format('H:i').' del '.$en->format('d/m/Y').': fuera de la jornada no se rastrea.');
        }
        if ($t->driver_user_id !== $u->id && ! Access::can($u, 'flo.live.view')) {
            abort(403, 'Solo envías la posición de tu propia jornada.');
        }
        $lat = Base::decimal($p['lat'] ?? null);
        $lng = Base::decimal($p['lng'] ?? null);
        if ($lat === null || $lng === null || abs($lat) > 90 || abs($lng) > 180) {
            RuleError::fail('RN-FLO-01', 'La posición necesita latitud y longitud.');
        }
        $vel = max(0, min(250, (float) ($p['speed_kmh'] ?? 0)));
        DB::table('vehicle_positions')->insertOrIgnore([
            'tenant_id' => DB::selectOne('SELECT app_tenant_id() AS t')->t, 'vehicle_id' => $v->id, 'trip_id' => $t->id, 'recorded_at' => $en, 'lat' => round($lat, 7), 'lng' => round($lng, 7),
            'speed_kmh' => round($vel, 1), 'heading' => isset($p['heading']) && is_numeric($p['heading']) ? (int) $p['heading'] % 360 : null,
            'accuracy_m' => isset($p['accuracy_m']) && is_numeric($p['accuracy_m']) ? (int) $p['accuracy_m'] : null,
            'source' => $origen ?? 'APP', 'received_at' => now(),
        ]);
        self::velocidad($t, $en);
        if ($t->status === 'OPEN') {
            Alertas::cerrarPor('GPS_SILENT', ['trip:'.$t->id], 'Volvió a enviar posición', $u);
        }

        return ['duplicada' => false, 'trip_id' => $t->id];
    }

    /** Subida en lote desde la app sin conexión: un reenvío no duplica (RN-FLO-01). */
    public static function lote(array $lista, User $u): array
    {
        if (! Access::can($u, 'flo.trip.operate') && ! Access::can($u, 'flo.live.view')) {
            abort(403, 'Enviar posiciones es de la app del conductor.');
        }
        usort($lista, fn ($a, $b) => strcmp((string) ($a['recorded_at'] ?? ''), (string) ($b['recorded_at'] ?? '')));
        $r = ['guardadas' => 0, 'repetidas' => 0, 'rechazadas' => []];
        foreach (array_slice($lista, 0, 500) as $p) {
            try {
                $x = DB::transaction(fn () => self::posicion((array) $p, $u, count($lista) > 1 ? 'BATCH' : 'APP'));
                $x['duplicada'] ? $r['repetidas']++ : $r['guardadas']++;
            } catch (RuleError $e) {
                $r['rechazadas'][] = ['recorded_at' => $p['recorded_at'] ?? null, 'code' => $e->rule, 'message' => $e->getMessage()];
            }
        }

        return $r;
    }

    /** RN-FLO-19: más de flo_speed_limit_kmh durante más de 1 minuto (posiciones seguidas sobre el límite). */
    private static function velocidad(object $t, CarbonImmutable $en): void
    {
        $lim = Base::num('flo_speed_limit_kmh', 80);
        $ps = DB::table('vehicle_positions')->where('trip_id', $t->id)->where('recorded_at', '<=', $en)->orderByDesc('recorded_at')->limit(120)->get(['recorded_at', 'speed_kmh']);
        if ($ps->isEmpty() || (float) $ps[0]->speed_kmh <= $lim) {
            return;
        }
        $inicio = $ps[0]->recorded_at;
        $max = 0.0;
        foreach ($ps as $p) {
            if ((float) $p->speed_kmh <= $lim) {
                break;
            }
            $inicio = $p->recorded_at;
            $max = max($max, (float) $p->speed_kmh);
        }
        $seg = CarbonImmutable::parse($inicio)->diffInSeconds($en);
        if ($seg < 60) {
            return;
        }
        $detalle = "RN-FLO-19: más de {$lim} km/h entre las ".Base::hora($inicio).' y las '.$en->format('H:i').' ('.Base::km($seg / 60, 1).' min, máx. '.Base::km($max).' km/h) · '.Base::nombre($t->driver_user_id).'.';
        $abierta = DB::table('fleet_alerts')->where('vehicle_id', $t->vehicle_id)->where('alert_type', 'SPEED')->where('origin', 'trip:'.$t->id)->where('status', '<>', 'CLOSED')->first();
        if ($abierta && $abierta->episode_start && CarbonImmutable::parse($abierta->episode_start)->equalTo(CarbonImmutable::parse($inicio))) {
            DB::table('fleet_alerts')->where('id', $abierta->id)->update(['last_at' => $en, 'max_value' => max((float) $abierta->max_value, $max), 'detail' => $detalle, 'updated_at' => now()]);

            return;
        }
        Alertas::levantar([
            'type' => 'SPEED', 'vehicle_id' => $t->vehicle_id, 'employee_id' => $t->driver_employee_id, 'origin' => 'trip:'.$t->id, 'at' => $en, 'severity' => 'bad',
            'title' => 'Exceso de velocidad: '.Base::km($max)." km/h ({$t->number})", 'detail' => $detalle, 'extra' => ['episode_start' => $inicio, 'max_value' => $max],
        ]);
    }

    /** FLO-03: jornadas por vehículo y día. */
    public static function lista(User $u, array $f): array
    {
        $vs = Base::flota($u)->pluck('v.id')->all();
        $desde = $f['desde'] ?? CarbonImmutable::parse(Base::hoy())->subDays(13)->toDateString();
        $hasta = $f['hasta'] ?? Base::hoy();
        $tol = Base::num('flo_km_gps_tolerance_pct', 15);
        $filas = DB::table('vehicle_trips as t')->join('vehicles as v', 'v.id', '=', 't.vehicle_id')->leftJoin('vehicle_profiles as p', 'p.vehicle_id', '=', 't.vehicle_id')
            ->leftJoin('users as u', 'u.id', '=', 't.driver_user_id')->leftJoin('delivery_routes as r', 'r.id', '=', 't.route_id')
            ->whereIn('t.vehicle_id', $vs ?: ['00000000-0000-0000-0000-000000000000'])->whereBetween('t.trip_date', [$desde, $hasta])
            ->when($f['vehiculo'] ?? null, fn ($w) => $w->where('t.vehicle_id', $f['vehiculo']))
            ->when($f['estado'] ?? null, fn ($w) => $w->where('t.status', $f['estado']))
            ->orderByDesc('t.trip_date')->orderByRaw('coalesce(p.internal_code, v.plate)')->limit(500)
            ->get(['t.*', 'v.plate', 'p.internal_code', 'u.name as conductor', 'r.code as ruta'])
            ->map(function ($t) use ($tol) {
                $km = $t->km_odometer !== null ? (float) $t->km_odometer : null;
                $ent = $t->status === 'OPEN' ? self::entregas($t) : ($t->deliveries !== null ? (int) $t->deliveries : null);

                return [
                    'id' => $t->id, 'number' => $t->number, 'trip_date' => $t->trip_date, 'status' => $t->status, 'vehicle_id' => $t->vehicle_id,
                    'vehiculo' => $t->internal_code && $t->internal_code !== $t->plate ? "{$t->internal_code} · {$t->plate}" : $t->plate, 'conductor' => $t->conductor,
                    'ruta' => $t->ruta, 'started_at' => $t->started_at, 'ended_at' => $t->ended_at,
                    'odometer_start' => $t->odometer_start !== null ? (float) $t->odometer_start : null, 'odometer_end' => $t->odometer_end !== null ? (float) $t->odometer_end : null,
                    'km_odometer' => $km, 'km_gps' => $t->km_gps !== null ? (float) $t->km_gps : ($t->status === 'OPEN' ? self::kmGps($t->id) : null),
                    'km_diff_pct' => $t->km_diff_pct !== null ? (float) $t->km_diff_pct : null, 'fuera_tolerancia' => $t->km_diff_pct !== null && abs((float) $t->km_diff_pct) > $tol,
                    'deliveries' => $ent, 'km_por_entrega' => $km !== null && $ent ? round($km / $ent, 2) : null,
                    'checklist_start' => json_decode($t->checklist_start ?? 'null', true), 'checklist_end' => json_decode($t->checklist_end ?? 'null', true),
                    'notes' => $t->notes, 'end_notes' => $t->end_notes, 'start_photo_file_id' => $t->start_photo_file_id, 'end_photo_file_id' => $t->end_photo_file_id,
                    'tiene_recorrido' => DB::table('vehicle_positions')->where('trip_id', $t->id)->exists(),
                ];
            })->all();
        $cerradas = array_filter($filas, fn ($x) => $x['status'] === 'CLOSED');
        $km = array_sum(array_column($cerradas, 'km_odometer'));
        $ent = array_sum(array_column($cerradas, 'deliveries'));

        return ['data' => $filas, 'desde' => $desde, 'hasta' => $hasta, 'tolerancia' => $tol, 'resumen' => [
            'jornadas' => count($filas), 'km' => round($km, 1), 'entregas' => $ent, 'km_por_entrega' => $ent ? round($km / $ent, 2) : null,
            'fuera_tolerancia' => count(array_filter($filas, fn ($x) => $x['fuera_tolerancia'])), 'abiertas' => count(array_filter($filas, fn ($x) => $x['status'] === 'OPEN')),
        ]];
    }

    /** FLO-02: el recorrido de un vehículo en una fecha, con paradas (detenciones de 2 minutos o más) y velocidad. */
    public static function recorrido(string $vehiculoId, string $fecha, User $u): array
    {
        $v = Base::vehiculo($vehiculoId, $u);
        $lim = Base::num('flo_speed_limit_kmh', 80);
        $trips = DB::table('vehicle_trips')->where('vehicle_id', $v->id)->where('trip_date', $fecha)->whereIn('status', ['OPEN', 'CLOSED'])->orderBy('started_at')->get();
        $puntos = [];
        $paradas = [];
        $max = 0.0;
        foreach ($trips as $t) {
            $ps = DB::table('vehicle_positions')->where('trip_id', $t->id)->orderBy('recorded_at')->get(['recorded_at', 'lat', 'lng', 'speed_kmh']);
            $quieto = null;
            foreach ($ps as $i => $p) {
                $vel = (float) $p->speed_kmh;
                $max = max($max, $vel);
                $puntos[] = ['t' => $p->recorded_at, 'lat' => (float) $p->lat, 'lng' => (float) $p->lng, 'v' => $vel];
                if ($vel < 3) {
                    $quieto ??= $p;
                }
                if (($vel >= 3 || $i === count($ps) - 1) && $quieto) {
                    $min = CarbonImmutable::parse($quieto->recorded_at)->diffInSeconds(CarbonImmutable::parse($p->recorded_at)) / 60;
                    if ($min >= 2) {
                        $paradas[] = ['desde' => $quieto->recorded_at, 'hasta' => $p->recorded_at, 'minutos' => round($min), 'lat' => (float) $quieto->lat, 'lng' => (float) $quieto->lng];
                    }
                    $quieto = null;
                }
            }
        }
        $km = 0.0;
        for ($i = 1; $i < count($puntos); $i++) {
            $km += Base::distancia($puntos[$i - 1]['lat'], $puntos[$i - 1]['lng'], $puntos[$i]['lat'], $puntos[$i]['lng']);
        }
        $local = DB::table('establishments')->where('id', $v->establishment_id)->first(['name', 'lat', 'lng']);
        $entregas = DB::table('delivery_stops as s')->join('delivery_routes as r', 'r.id', '=', 's.route_id')->join('sales_orders as o', 'o.id', '=', 's.order_id')
            ->leftJoin('customer_addresses as a', 'a.id', '=', 'o.address_id')->where('r.vehicle_id', $v->id)->where('r.route_date', $fecha)
            ->orderBy('s.seq')->get(['s.seq', 's.status', 's.closed_at', 'o.number', 'a.lat', 'a.lng'])
            ->filter(fn ($x) => $x->lat !== null)->map(fn ($x) => ['seq' => $x->seq, 'status' => $x->status, 'number' => $x->number, 'lat' => (float) $x->lat, 'lng' => (float) $x->lng, 'closed_at' => $x->closed_at])->values()->all();
        $dias = DB::table('vehicle_trips as t')->where('t.vehicle_id', $v->id)->whereExists(fn ($q) => $q->from('vehicle_positions as p')->whereColumn('p.trip_id', 't.id'))
            ->orderByDesc('t.trip_date')->limit(30)->distinct()->pluck('t.trip_date')->all();

        return [
            'vehiculo' => ['id' => $v->id, 'etiqueta' => Base::etiqueta($v)], 'fecha' => $fecha, 'limite' => $lim,
            'jornadas' => $trips->map(fn ($t) => ['id' => $t->id, 'number' => $t->number, 'status' => $t->status, 'started_at' => $t->started_at, 'ended_at' => $t->ended_at,
                'conductor' => Base::nombre($t->driver_user_id), 'km_odometer' => $t->km_odometer !== null ? (float) $t->km_odometer : null])->all(),
            'puntos' => $puntos, 'paradas' => $paradas, 'entregas' => $entregas, 'dias_con_recorrido' => $dias,
            'local' => $local && $local->lat !== null ? ['name' => $local->name, 'lat' => (float) $local->lat, 'lng' => (float) $local->lng] : null,
            'resumen' => ['km' => round($km, 1), 'max' => $max, 'paradas' => count($paradas), 'excesos' => count(array_filter($puntos, fn ($p) => $p['v'] > $lim)),
                'minutos' => count($puntos) > 1 ? (int) round(CarbonImmutable::parse($puntos[0]['t'])->diffInMinutes(CarbonImmutable::parse(end($puntos)['t']))) : 0],
        ];
    }

    /** FLO-15: lo que ve el conductor en la app. */
    public static function app(User $u, ?string $conductor = null): array
    {
        $coordina = Access::can($u, 'flo.live.view');
        if (! $coordina && ! Access::can($u, 'flo.trip.operate')) {
            abort(403, 'La app de jornada es del conductor.');
        }
        $uid = $conductor && $coordina ? $conductor : $u->id;
        $hoy = Base::hoy();
        $abierta = self::abiertaDeConductor($uid);
        $lic = Documentos::licencia(Base::empleadoDe($uid));
        $vehiculos = [];
        foreach (Base::flota($coordina ? $u : null)->where('v.status', '<>', 'INACTIVE')->get(['v.*']) as $v) {
            $ruta = DB::table('delivery_routes')->where('vehicle_id', $v->id)->where('route_date', $hoy)->where('status', '<>', 'CANCELLED')->first(['code', 'driver_user_id']);
            $prog = DB::table('vehicle_trips')->where('vehicle_id', $v->id)->where('trip_date', $hoy)->where('status', 'PLANNED')->first(['number', 'driver_user_id']);
            $ocupado = self::abiertaDe($v->id);
            $vehiculos[] = [
                'id' => $v->id, 'etiqueta' => Base::etiqueta($v), 'tipo' => Base::TIPOS[$v->vehicle_type] ?? $v->vehicle_type, 'odometro' => Odometro::actual($v),
                'checklist' => self::checklist($v), 'bloqueos' => array_column(Operable::motivos($v, $hoy), 'msg'),
                'ocupado' => $ocupado && $ocupado->driver_user_id !== $uid ? Base::nombre($ocupado->driver_user_id) : null,
                'mio' => ($ruta && $ruta->driver_user_id === $uid) || ($prog && $prog->driver_user_id === $uid), 'ruta' => $ruta?->code, 'programada' => $prog?->number,
            ];
        }
        usort($vehiculos, fn ($a, $b) => [! $a['mio'], $a['etiqueta']] <=> [! $b['mio'], $b['etiqueta']]);
        $j = null;
        if ($abierta) {
            $v = DB::table('vehicles')->where('id', $abierta->vehicle_id)->first();
            $ultima = DB::table('vehicle_positions')->where('trip_id', $abierta->id)->orderByDesc('recorded_at')->first(['recorded_at', 'lat', 'lng', 'speed_kmh']);
            $j = array_replace((array) $abierta, [
                'vehiculo' => Base::etiqueta($v), 'odometro' => Odometro::actual($v), 'km_gps' => self::kmGps($abierta->id), 'entregas' => self::entregas($abierta),
                'posiciones' => DB::table('vehicle_positions')->where('trip_id', $abierta->id)->count(), 'ultima' => $ultima, 'checklist' => self::checklist($v),
                'cargas' => DB::table('fuel_loads')->where('trip_id', $abierta->id)->where('status', 'ACTIVE')->get(['number', 'gallons', 'amount', 'loaded_at'])->all(),
                'tanque' => (float) Base::perfil($v)->tank_capacity_gal,
            ]);
        }
        $conductores = $coordina ? DB::table('users as u')->join('user_roles as ur', 'ur.user_id', '=', 'u.id')->join('roles as ro', 'ro.id', '=', 'ur.role_id')
            ->where('ro.code', 'REPARTIDOR')->where('u.status', 'ACTIVE')->distinct()->orderBy('u.name')->get(['u.id', 'u.name'])->all() : [];

        return [
            'conductor' => ['id' => $uid, 'nombre' => Base::nombre($uid)], 'coordina' => $coordina, 'conductores' => $conductores,
            'licencia' => $lic ? ['number' => $lic->number, 'expires_on' => $lic->expires_on, 'license_class' => $lic->license_class, 'semaforo' => Documentos::estado($lic->expires_on)] : null,
            'jornada' => $j, 'vehiculos' => $vehiculos, 'intervalo' => (int) Base::num('flo_gps_interval_seconds', 30), 'hoy' => $hoy,
        ];
    }
}
