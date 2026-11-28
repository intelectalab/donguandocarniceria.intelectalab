<?php

namespace App\Modulos\Flo\Services;

use App\Models\User;
use App\Modulos\Del\Services\Rutas;
use App\Support\Access;
use App\Support\RuleError;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/** FLO-04 Ficha del vehículo: datos técnicos sobre el vehículo de DEL (placa, tipo y modalidad siguen en DEL-12). */
final class Vehiculos
{
    /** Crea o edita la ficha técnica (una por vehículo). */
    public static function guardarPerfil(string $vehiculoId, array $d, User $u): object
    {
        if (! Access::can($u, 'flo.maintenance.manage')) {
            abort(403, 'La ficha técnica la mantiene el coordinador de delivery.');
        }

        return DB::transaction(function () use ($vehiculoId, $d, $u) {
            $v = Base::vehiculo($vehiculoId, $u, 'RN-FLO-08');
            $antes = DB::table('vehicle_profiles')->where('vehicle_id', $v->id)->lockForUpdate()->first();
            $codigo = mb_strtoupper(Base::texto($d['internal_code'] ?? $v->plate, 'RN-FLO-08', 'Indica el código interno (por ejemplo MOT-01).', 2, 20));
            if (DB::table('vehicle_profiles')->whereRaw('upper(internal_code) = ?', [$codigo])->where('vehicle_id', '<>', $v->id)->exists()) {
                RuleError::fail('RN-FLO-08', "El código {$codigo} ya lo usa otro vehículo.");
            }
            $tanque = Base::decimal($d['tank_capacity_gal'] ?? null);
            $kmpg = Base::decimal($d['expected_km_per_gal'] ?? null);
            if (! $tanque || $tanque <= 0 || $tanque > 200) {
                RuleError::fail('RN-FLO-08', 'Indica la capacidad del tanque en galones (RN-FLO-08 usa este tope para cada carga).');
            }
            if (! $kmpg || $kmpg <= 0 || $kmpg > 200) {
                RuleError::fail('RN-FLO-07', 'Indica el rendimiento esperado en km por galón.');
            }
            $modo = $d['temp_mode'] ?? null ?: null;
            if ($modo !== null && ! in_array($modo, ['CHILLED', 'FROZEN'], true)) {
                RuleError::fail('RN-FLO-14', 'El rango es refrigerado o congelado.');
            }
            $tmin = Base::decimal($d['temp_min_c'] ?? null);
            $tmax = Base::decimal($d['temp_max_c'] ?? null);
            if ($modo === 'CHILLED') {
                $tmin ??= 0.0;
                $tmax ??= 4.0;
            } elseif ($modo === 'FROZEN') {
                $tmin = null;
                $tmax ??= -18.0;
            } else {
                $tmin = $tmax = null;
            }
            if ($tmin !== null && $tmax !== null && $tmin >= $tmax) {
                RuleError::fail('RN-FLO-14', 'La temperatura mínima debe ser menor que la máxima.');
            }
            if ($modo && ! $v->refrigerated) {
                RuleError::fail('RN-FLO-14', "{$v->plate} no está marcado como refrigerado en Vehículos (DEL-12): márcalo ahí antes de darle un rango.");
            }
            $anio = isset($d['year']) && $d['year'] !== '' && $d['year'] !== null ? (int) $d['year'] : null;
            if ($anio !== null && ($anio < 1980 || $anio > (int) Base::ahora()->format('Y') + 1)) {
                RuleError::fail('RN-FLO-08', 'El año no es válido.');
            }
            $gps = in_array($d['gps_source'] ?? 'APP_ANDROID', ['APP_ANDROID', 'DEVICE'], true) ? ($d['gps_source'] ?? 'APP_ANDROID') : 'APP_ANDROID';
            $costo = Base::decimal($d['purchase_cost'] ?? null);
            $residual = Base::decimal($d['residual_value'] ?? null);
            $vida = isset($d['useful_life_months']) && $d['useful_life_months'] !== '' && $d['useful_life_months'] !== null ? (int) $d['useful_life_months'] : null;
            if ($v->ownership === 'RENTED') {
                $costo = $residual = $vida = null;   // un alquilado no se deprecia (RN-FLO-16)
            }
            if (($costo !== null && $costo < 0) || ($residual !== null && $residual < 0) || ($vida !== null && $vida <= 0)) {
                RuleError::fail('RN-FLO-16', 'Revisa el costo de compra, el valor residual y la vida útil.');
            }
            if ($costo !== null && $residual !== null && $residual > $costo) {
                RuleError::fail('RN-FLO-16', 'El valor residual no puede ser mayor que el costo de compra.');
            }
            $t = fn ($k, $n) => ! empty($d[$k]) ? mb_substr(trim((string) $d[$k]), 0, $n) : null;
            $fila = [
                'internal_code' => $codigo, 'make' => $t('make', 60), 'model' => $t('model', 80), 'year' => $anio, 'color' => $t('color', 30),
                'tank_capacity_gal' => round($tanque, 3), 'expected_km_per_gal' => round($kmpg, 2), 'temp_mode' => $modo, 'temp_min_c' => $tmin, 'temp_max_c' => $tmax,
                'gps_source' => $gps, 'gps_device_id' => $t('gps_device_id', 120), 'temp_sensor_id' => $t('temp_sensor_id', 120),
                'purchase_date' => $v->ownership === 'OWN' ? ($d['purchase_date'] ?? null ?: null) : null, 'purchase_cost' => $costo, 'residual_value' => $residual,
                'useful_life_months' => $vida, 'notes' => $t('notes', 1000), 'updated_at' => now(),
            ];
            if ($antes) {
                DB::table('vehicle_profiles')->where('id', $antes->id)->update($fila);
            } else {
                DB::table('vehicle_profiles')->insert($fila + ['vehicle_id' => $v->id, 'op_status' => $v->status === 'MAINTENANCE' ? 'IN_MAINTENANCE' : ($v->status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE')]);
            }

            return DB::table('vehicle_profiles')->where('vehicle_id', $v->id)->first();
        });
    }

    /** Estado operativo de FLO, reflejado en el estado del vehículo de DEL (DEL-12 lo muestra y RN-DEL-03 lo respeta). */
    public static function estadoOperativo(object $v, string $estado): void
    {
        $p = DB::table('vehicle_profiles')->where('vehicle_id', $v->id)->first();
        if ($p) {
            DB::table('vehicle_profiles')->where('id', $p->id)->update(['op_status' => $estado, 'updated_at' => now()]);
        } else {
            $b = Base::perfil($v);
            DB::table('vehicle_profiles')->insert(['vehicle_id' => $v->id, 'internal_code' => mb_substr($v->plate, 0, 20), 'tank_capacity_gal' => $b->tank_capacity_gal,
                'expected_km_per_gal' => $b->expected_km_per_gal, 'temp_mode' => $b->temp_mode, 'temp_min_c' => $b->temp_min_c, 'temp_max_c' => $b->temp_max_c, 'op_status' => $estado]);
        }
        if ($estado === 'IN_MAINTENANCE' && $v->status === 'ACTIVE') {
            DB::table('vehicles')->where('id', $v->id)->update(['status' => 'MAINTENANCE', 'updated_at' => now()]);
        } elseif ($estado === 'ACTIVE' && DB::table('vehicles')->where('id', $v->id)->value('status') === 'MAINTENANCE') {
            DB::table('vehicles')->where('id', $v->id)->update(['status' => 'ACTIVE', 'updated_at' => now()]);
        }
    }

    /**
     * «Asignar a ruta» desde la ficha: revisa RN-FLO-11 (y la licencia, RN-FLO-12) y asigna la ruta de DEL elegida o deja
     * una jornada programada para ese día.
     */
    public static function programar(string $vehiculoId, array $d, User $u): array
    {
        if (! Access::can($u, 'flo.live.view') && ! Access::can($u, 'flo.maintenance.manage')) {
            abort(403, 'Asignar vehículos es del coordinador de delivery.');
        }

        return DB::transaction(function () use ($vehiculoId, $d, $u) {
            $v = Base::vehiculo($vehiculoId, $u);
            $fecha = (string) ($d['date'] ?? '');
            if (! preg_match('/^\d{4}-\d{2}-\d{2}$/', $fecha)) {
                RuleError::fail('RN-FLO-11', 'Elige la fecha.');
            }
            if ($fecha < Base::hoy()) {
                RuleError::fail('RN-FLO-11', 'Solo se programa desde hoy en adelante.');
            }
            Operable::exigir($v, $fecha);
            $chofer = $d['driver_user_id'] ?? null ?: null;
            if ($chofer) {
                Documentos::exigirLicencia($chofer, $fecha);
            }
            if (! empty($d['route_id'])) {
                if (! Access::can($u, 'del.route.plan')) {
                    abort(403, 'Asignar una ruta de reparto pide el permiso de planificar rutas.');
                }
                $r = Rutas::asignar($d['route_id'], ['mode' => $v->ownership, 'vehicle_id' => $v->id, 'driver_user_id' => $chofer], $u);

                return ['tipo' => 'RUTA', 'route' => $r['route'], 'warnings' => $r['warnings']];
            }
            $ya = DB::table('vehicle_trips')->where('vehicle_id', $v->id)->where('trip_date', $fecha)->whereIn('status', ['PLANNED', 'OPEN'])->first();
            if ($ya) {
                return ['tipo' => 'JORNADA', 'trip' => $ya, 'warnings' => ["{$v->plate} ya tiene la jornada {$ya->number} ese día."]];
            }
            $id = DB::table('vehicle_trips')->insertGetId([
                'number' => Base::numero('vehicle_trips', 'JR-', 6), 'vehicle_id' => $v->id, 'driver_user_id' => $chofer, 'driver_employee_id' => Base::empleadoDe($chofer),
                'establishment_id' => $v->establishment_id, 'trip_date' => $fecha, 'status' => 'PLANNED', 'source' => 'PLAN', 'created_by' => $u->id,
            ], 'id');

            return ['tipo' => 'JORNADA', 'trip' => DB::table('vehicle_trips')->where('id', $id)->first(), 'warnings' => []];
        });
    }

    /** Lista para selectores y para la cabecera de FLO-04. */
    public static function lista(User $u): array
    {
        $hoy = Base::hoy();

        return Base::flota($u)->leftJoin('vehicle_profiles as p', 'p.vehicle_id', '=', 'v.id')->leftJoin('establishments as e', 'e.id', '=', 'v.establishment_id')
            ->orderByRaw('coalesce(p.internal_code, v.plate)')
            ->get(['v.*', 'p.internal_code', 'p.op_status', 'p.tank_capacity_gal', 'p.expected_km_per_gal', 'p.temp_mode', 'e.name as local'])
            ->map(function ($v) use ($hoy) {
                $motivos = Operable::motivos($v, $hoy);

                return [
                    'id' => $v->id, 'plate' => $v->plate, 'internal_code' => $v->internal_code, 'etiqueta' => $v->internal_code && $v->internal_code !== $v->plate ? "{$v->internal_code} · {$v->plate}" : $v->plate,
                    'vehicle_type' => $v->vehicle_type, 'tipo' => Base::TIPOS[$v->vehicle_type] ?? $v->vehicle_type, 'ownership' => $v->ownership,
                    'modalidad' => Base::MODALIDAD[$v->ownership] ?? $v->ownership, 'refrigerated' => (bool) $v->refrigerated, 'status' => $v->status,
                    'op_status' => $v->op_status ?? ($v->status === 'MAINTENANCE' ? 'IN_MAINTENANCE' : $v->status), 'establishment_id' => $v->establishment_id, 'local' => $v->local,
                    'odometro' => Odometro::actual($v), 'tank_capacity_gal' => $v->tank_capacity_gal !== null ? (float) $v->tank_capacity_gal : (float) (Base::TANQUE[$v->vehicle_type] ?? 10),
                    'expected_km_per_gal' => $v->expected_km_per_gal !== null ? (float) $v->expected_km_per_gal : (float) (Base::KMPG[$v->vehicle_type] ?? 40),
                    'tiene_ficha' => $v->internal_code !== null, 'bloqueos' => array_column($motivos, 'msg'),
                ];
            })->all();
    }

    /** FLO-04: ficha completa con su historial. */
    public static function ficha(string $id, User $u): array
    {
        $v = Base::vehiculo($id, $u);
        $p = Base::perfil($v);
        $hoy = Base::hoy();
        $mes = CarbonImmutable::parse($hoy)->startOfMonth()->toDateString();
        $costo = Access::can($u, 'flo.cost.view') ? Costos::mensual($v, $mes) : null;
        $ultimaLlena = DB::table('fuel_loads')->where('vehicle_id', $v->id)->where('status', 'ACTIVE')->whereNotNull('km_per_gal')->orderByDesc('loaded_at')->first();
        $docs = [];
        foreach (array_keys(Base::DOCUMENTOS) as $t) {
            if ($t === 'DRIVER_LICENSE') {
                continue;
            }
            $d = Documentos::vigente($v->id, $t);
            if ($d || in_array($t, ['SOAT', 'TECH_INSPECTION'], true) || ($t === 'RENTAL_CONTRACT' && $v->ownership === 'RENTED')) {
                $docs[] = ['doc_type' => $t, 'tipo' => Base::DOCUMENTOS[$t][0], 'id' => $d?->id, 'number' => $d?->number, 'expires_on' => $d?->expires_on,
                    'semaforo' => $d ? Documentos::estado($d->expires_on) : 'MISSING'];
            }
        }
        $planes = Mantenimiento::planes($u, $v->id);
        $jornadas = DB::table('vehicle_trips as t')->leftJoin('users as u', 'u.id', '=', 't.driver_user_id')->where('t.vehicle_id', $v->id)
            ->orderByDesc('t.trip_date')->orderByDesc('t.started_at')->limit(10)
            ->get(['t.id', 't.number', 't.trip_date', 't.status', 't.km_odometer', 't.km_gps', 't.km_diff_pct', 't.deliveries', 'u.name as conductor'])->all();
        $cargas = DB::table('fuel_loads')->where('vehicle_id', $v->id)->where('status', 'ACTIVE')->orderByDesc('loaded_at')->limit(8)
            ->get(['id', 'number', 'loaded_at', 'odometer_km', 'gallons', 'amount', 'full_tank', 'km_per_gal', 'efficiency_status'])->all();
        $ordenes = DB::table('vehicle_maintenances')->where('vehicle_id', $v->id)->orderByDesc('opened_on')->limit(8)
            ->get(['id', 'number', 'kind', 'description', 'opened_on', 'done_on', 'status', 'total_amount'])->all();
        $multas = DB::table('traffic_fines')->where('vehicle_id', $v->id)->where('status', '<>', 'VOIDED')->orderByDesc('fine_date')->limit(8)
            ->get(['id', 'ballot_number', 'fine_date', 'infraction', 'amount', 'status', 'charged_to_driver'])->all();
        $alertas = DB::table('fleet_alerts')->where('vehicle_id', $v->id)->where('status', '<>', 'CLOSED')->orderByDesc('last_at')->get()->map(fn ($a) => Alertas::aFila($a))->all();

        return [
            'vehiculo' => array_replace((array) $v, [
                'etiqueta' => Base::etiqueta($v), 'tipo' => Base::TIPOS[$v->vehicle_type] ?? $v->vehicle_type, 'modalidad' => Base::MODALIDAD[$v->ownership] ?? $v->ownership,
                'local' => DB::table('establishments')->where('id', $v->establishment_id)->value('name'),
                'proveedor' => $v->provider_id ? DB::table('suppliers')->where('id', $v->provider_id)->value('trade_name') : null,
            ]),
            'perfil' => $p, 'odometro' => Odometro::actual($v), 'rango' => Base::rango($v, $p), 'bloqueos' => array_column(Operable::motivos($v, $hoy), 'msg'),
            'ultima_llena' => $ultimaLlena ? ['km_per_gal' => (float) $ultimaLlena->km_per_gal, 'loaded_at' => $ultimaLlena->loaded_at, 'efficiency_status' => $ultimaLlena->efficiency_status] : null,
            'minimo_kmpg' => Combustible::minimo($p), 'costo_mes' => $costo, 'documentos' => $docs, 'planes' => $planes, 'jornadas' => $jornadas, 'cargas' => $cargas,
            'ordenes' => $ordenes, 'multas' => $multas, 'alertas' => $alertas, 'lecturas' => Odometro::historial($v->id, 15),
            'jornada_abierta' => Jornadas::abiertaDe($v->id),
        ];
    }
}
