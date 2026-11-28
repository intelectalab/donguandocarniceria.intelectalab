<?php

namespace App\Modulos\Flo\Services;

use App\Models\User;
use App\Modulos\Plt\Services\Periodos;
use App\Support\Access;
use App\Support\RuleError;
use Carbon\CarbonImmutable;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;

/** FLO-05 Cargas de combustible y FLO-06 Rendimiento (RN-FLO-06, 07, 08, 17; odómetro RN-FLO-04). */
final class Combustible
{
    /** RN-FLO-07: por debajo de esperado × (1 − tolerancia) se alerta. */
    public static function minimo(object $perfil): float
    {
        return round((float) $perfil->expected_km_per_gal * (1 - Base::num('flo_fuel_efficiency_tolerance_pct', 15) / 100), 1);
    }

    /**
     * RN-FLO-06: solo con tanque lleno. km desde la carga llena anterior / galones cargados desde esa carga
     * (sin incluirla, incluida la actual).
     */
    public static function rendimiento(string $vehiculoId, CarbonImmutable|string $en, float $odo, float $gal, bool $lleno, ?string $salvo = null): array
    {
        $nada = ['km_since_full' => null, 'gallons_since_full' => null, 'km_per_gal' => null, 'base_load_id' => null];
        if (! $lleno) {
            return $nada;
        }
        $base = DB::table('fuel_loads')->where('vehicle_id', $vehiculoId)->where('status', 'ACTIVE')->where('full_tank', true)->where('loaded_at', '<', $en)
            ->when($salvo, fn ($q) => $q->where('id', '<>', $salvo))->orderByDesc('loaded_at')->first();
        if (! $base) {
            return $nada;
        }
        $entre = (float) DB::table('fuel_loads')->where('vehicle_id', $vehiculoId)->where('status', 'ACTIVE')->where('loaded_at', '>', $base->loaded_at)->where('loaded_at', '<', $en)
            ->when($salvo, fn ($q) => $q->where('id', '<>', $salvo))->sum('gallons');
        $g = round($entre + $gal, 3);
        $km = round($odo - (float) $base->odometer_km, 1);

        return ['km_since_full' => $km, 'gallons_since_full' => $g, 'km_per_gal' => $g > 0 && $km > 0 ? round($km / $g, 1) : null, 'base_load_id' => $base->id];
    }

    /** Vista previa en el formulario: tope del tanque y rendimiento que daría. */
    public static function previa(array $d, User $u): array
    {
        $v = Base::vehiculo($d['vehicle_id'] ?? null, Access::can($u, 'flo.fuel.manage') ? $u : null, 'RN-FLO-08');
        $p = Base::perfil($v);
        $en = Base::momento($d['loaded_at'] ?? null);
        $r = isset($d['odometer_km'], $d['gallons']) && is_numeric($d['odometer_km']) && is_numeric($d['gallons'])
            ? self::rendimiento($v->id, $en, (float) $d['odometer_km'], (float) $d['gallons'], filter_var($d['full_tank'] ?? true, FILTER_VALIDATE_BOOLEAN)) : null;

        return ['tope' => round((float) $p->tank_capacity_gal * Base::num('flo_tank_overfill_factor', 1.05), 3), 'tanque' => (float) $p->tank_capacity_gal,
            'esperado' => (float) $p->expected_km_per_gal, 'minimo' => self::minimo($p), 'odometro' => Odometro::actual($v), 'rendimiento' => $r];
    }

    public static function registrar(array $d, UploadedFile|string|null $foto, User $u): object
    {
        $gestiona = Access::can($u, 'flo.fuel.manage');
        if (! $gestiona && ! Access::can($u, 'flo.trip.operate')) {
            abort(403, 'Registrar cargas es del conductor (desde la app), del coordinador o de administración.');
        }

        return DB::transaction(function () use ($d, $foto, $u, $gestiona) {
            $v = Base::vehiculo($d['vehicle_id'] ?? null, $gestiona ? $u : null, 'RN-FLO-08');
            DB::table('vehicles')->where('id', $v->id)->lockForUpdate()->first();
            $p = Base::perfil($v);
            $en = $gestiona ? Base::momento($d['loaded_at'] ?? null, 'RN-FLO-04', 'Indica la fecha y hora de la carga.') : Base::ahora();
            if ($en->greaterThan(Base::ahora()->addMinutes(5))) {
                RuleError::fail('RN-FLO-04', 'La carga no puede tener fecha futura.');
            }
            $trip = DB::table('vehicle_trips')->where('vehicle_id', $v->id)->whereNotNull('started_at')->where('started_at', '<=', $en)
                ->where(fn ($w) => $w->where('status', 'OPEN')->orWhere(fn ($x) => $x->where('status', 'CLOSED')->where('ended_at', '>=', $en)))->first();
            if (! $gestiona && (! $trip || $trip->driver_user_id !== $u->id || $trip->status !== 'OPEN')) {
                RuleError::fail('RN-FLO-02', "Desde la app registras la carga de tu jornada abierta con {$v->plate}.");
            }
            $gal = Base::decimal($d['gallons'] ?? null);
            if (! $gal || $gal <= 0) {
                RuleError::fail('RN-FLO-08', 'Indica los galones cargados.');
            }
            $fac = Base::num('flo_tank_overfill_factor', 1.05);
            $tope = round((float) $p->tank_capacity_gal * $fac, 3);
            if ($gal > $tope + 0.0005) {
                RuleError::fail('RN-FLO-08', Base::km($gal, 3)." galones superan el tanque de {$v->plate}: capacidad ".Base::km((float) $p->tank_capacity_gal, 2).' gal × '.Base::km($fac, 2).' = '.Base::km($tope, 3).' gal. Revisa el vale.');
            }
            $precio = Base::decimal($d['price_per_gal'] ?? null);
            $importe = Base::decimal($d['amount'] ?? null);
            if ((! $precio || $precio <= 0) && $importe && $importe > 0) {
                $precio = round($importe / $gal, 3);
            }
            if (! $precio || $precio <= 0) {
                RuleError::fail('RN-FLO-17', 'Indica el precio por galón o el importe.');
            }
            $importe = $importe && $importe > 0 ? round($importe, 2) : round($gal * $precio, 2);
            if (abs($importe - $gal * $precio) > max(1.0, $importe * 0.02)) {
                RuleError::fail('RN-FLO-17', 'El importe ('.Base::soles($importe).') no cuadra con galones × precio ('.Base::soles(round($gal * $precio, 2)).'). Revisa el vale.');
            }
            $empresa = DB::table('establishments')->where('id', $v->establishment_id)->value('company_id');
            if ($empresa) {
                Periodos::abierto($en->toDateString(), $empresa);
            }
            $odo = Odometro::exigir($v, $d['odometer_km'] ?? null, $en);
            $vale = ! empty($d['voucher_no']) ? mb_strtoupper(mb_substr(trim($d['voucher_no']), 0, 30)) : null;
            if ($vale && DB::table('fuel_loads')->where('vehicle_id', $v->id)->where('status', 'ACTIVE')->whereRaw('upper(voucher_no) = ?', [$vale])->exists()) {
                RuleError::fail('RN-FLO-17', "El vale {$vale} ya está registrado en otra carga de {$v->plate}.");
            }
            $lleno = filter_var($d['full_tank'] ?? true, FILTER_VALIDATE_BOOLEAN);
            $r = self::rendimiento($v->id, $en, $odo, $gal, $lleno);
            $estacion = ! empty($d['station_supplier_id']) ? DB::table('suppliers')->where('id', $d['station_supplier_id'])->first(['id', 'trade_name', 'legal_name']) : null;
            $uid = $trip?->driver_user_id ?? ($d['driver_user_id'] ?? null ?: null);
            $fotoId = Archivo::guardar($foto, null, null, $u, 'RN-FLO-17');
            $id = DB::table('fuel_loads')->insertGetId($r + [
                'number' => Base::numero('fuel_loads', 'CG-', 5), 'vehicle_id' => $v->id, 'trip_id' => $trip?->id, 'driver_user_id' => $uid, 'employee_id' => Base::empleadoDe($uid),
                'loaded_at' => $en, 'odometer_km' => $odo, 'gallons' => round($gal, 3), 'price_per_gal' => round($precio, 3), 'amount' => $importe, 'full_tank' => $lleno,
                'fuel_type' => $v->fuel_type, 'station_supplier_id' => $estacion?->id,
                'station_name' => $estacion ? ($estacion->trade_name ?: $estacion->legal_name) : (! empty($d['station_name']) ? mb_substr(trim($d['station_name']), 0, 120) : null),
                'voucher_no' => $vale, 'doc_type' => ! empty($d['doc_type']) ? mb_substr($d['doc_type'], 0, 20) : null,
                'doc_number' => ! empty($d['doc_number']) ? mb_substr(mb_strtoupper(trim(($d['doc_series'] ?? '') ? $d['doc_series'].'-'.$d['doc_number'] : $d['doc_number'])), 0, 30) : null,
                'photo_file_id' => $fotoId, 'expected_km_per_gal' => (float) $p->expected_km_per_gal,
                'efficiency_status' => $r['km_per_gal'] === null ? 'NA' : ($r['km_per_gal'] < self::minimo($p) ? 'LOW' : 'OK'),
                'source' => $gestiona && ($d['source'] ?? 'WEB') !== 'APP' ? 'WEB' : 'APP', 'recorded_by' => $u->id,
            ], 'id');
            Odometro::registrar($v, $odo, $en, 'FUEL', $id, $u);
            $carga = DB::table('fuel_loads')->where('id', $id)->first();
            self::alertaRendimiento($carga, $v, $p);
            Gastos::alRegistrar('fuel_loads', $id, $d, [
                'tipo' => 'FUEL', 'vehiculo' => $v, 'monto' => $importe, 'fecha' => $en->toDateString(), 'proveedor' => $estacion?->id, 'galones' => round($gal, 3), 'vale' => $vale,
                'odometro' => $odo, 'empleado' => Base::empleadoDe($uid), 'foto' => $fotoId,
                'descripcion' => "Combustible {$carga->number} · {$v->plate} · ".Base::km($gal, 3).' gal',
            ], $u);

            return DB::table('fuel_loads')->where('id', $id)->first();
        });
    }

    /** RN-FLO-07: alerta de rendimiento (una abierta por vehículo; las repeticiones se suman). */
    public static function alertaRendimiento(object $carga, object $v, object $p, bool $silencio = false): void
    {
        if ($carga->km_per_gal === null || (float) $carga->km_per_gal >= self::minimo($p)) {
            return;
        }
        Alertas::levantar([
            'type' => 'FUEL_EFFICIENCY', 'vehicle_id' => $v->id, 'employee_id' => $carga->employee_id, 'origin' => 'kmpg', 'at' => CarbonImmutable::parse($carga->loaded_at), 'severity' => 'bad',
            'title' => 'Rendimiento '.Base::km((float) $carga->km_per_gal, 1)." km/gal · {$v->plate}",
            'detail' => 'RN-FLO-07: '.Base::km((float) $carga->km_since_full).' km / '.Base::km((float) $carga->gallons_since_full, 3)." gal en la carga {$carga->number}; esperado "
                .Base::km((float) $p->expected_km_per_gal).' km/gal, mínimo '.Base::km(self::minimo($p), 1).' (tolerancia '.Base::num('flo_fuel_efficiency_tolerance_pct', 15).' %).',
            'silencio' => $silencio,
        ]);
    }

    /** Anula una carga con motivo (no se borra) y recalcula los rendimientos del vehículo. */
    public static function anular(string $id, string $motivo, User $u): object
    {
        if (! Access::can($u, 'flo.fuel.manage')) {
            abort(403, 'Corregir cargas es del coordinador o de administración.');
        }

        return DB::transaction(function () use ($id, $motivo, $u) {
            $f = DB::table('fuel_loads')->where('id', $id)->lockForUpdate()->first();
            if (! $f) {
                abort(404, 'No se encontró la carga.');
            }
            $v = Base::vehiculo($f->vehicle_id, $u, 'RN-FLO-17');
            if ($f->status === 'VOIDED') {
                RuleError::fail('RN-FLO-17', 'La carga ya está anulada.');
            }
            $m = Base::texto($motivo, 'RN-FLO-17', 'Anular una carga exige un motivo de al menos 10 caracteres (no se borra).', 10, 500);
            DB::table('fuel_loads')->where('id', $id)->update(['status' => 'VOIDED', 'void_reason' => $m, 'voided_at' => now(), 'voided_by' => $u->id, 'updated_at' => now()]);
            self::recalcular($v);

            return DB::table('fuel_loads')->where('id', $id)->first();
        });
    }

    /** Recalcula los rendimientos de las cargas posteriores (tras anular una). */
    public static function recalcular(object $v): void
    {
        $p = Base::perfil($v);
        foreach (DB::table('fuel_loads')->where('vehicle_id', $v->id)->where('status', 'ACTIVE')->orderBy('loaded_at')->get() as $f) {
            $r = self::rendimiento($v->id, $f->loaded_at, (float) $f->odometer_km, (float) $f->gallons, (bool) $f->full_tank, $f->id);
            DB::table('fuel_loads')->where('id', $f->id)->update($r + ['efficiency_status' => $r['km_per_gal'] === null ? 'NA' : ($r['km_per_gal'] < self::minimo($p) ? 'LOW' : 'OK')]);
        }
    }

    /** Enlaza después un gasto de GAS (o crea su borrador). */
    public static function enlazarGasto(string $id, array $d, User $u): object
    {
        if (! Access::can($u, 'flo.fuel.manage')) {
            abort(403, 'Enlazar gastos es del coordinador o de administración.');
        }

        return DB::transaction(function () use ($id, $d, $u) {
            $f = DB::table('fuel_loads')->where('id', $id)->lockForUpdate()->first();
            if (! $f || $f->status !== 'ACTIVE') {
                abort(404, 'No se encontró la carga.');
            }
            $v = Base::vehiculo($f->vehicle_id, $u, 'RN-FLO-17');
            if ($f->expense_id) {
                RuleError::fail('RN-FLO-17', "La carga {$f->number} ya tiene su gasto.");
            }
            if (empty($d['expense_id']) && ! filter_var($d['create_expense'] ?? false, FILTER_VALIDATE_BOOLEAN)) {
                RuleError::fail('RN-FLO-17', 'Elige el gasto a enlazar o crea su borrador.');
            }
            Gastos::alRegistrar('fuel_loads', $id, $d, [
                'tipo' => 'FUEL', 'vehiculo' => $v, 'monto' => (float) $f->amount, 'fecha' => CarbonImmutable::parse($f->loaded_at)->toDateString(), 'proveedor' => $f->station_supplier_id,
                'galones' => (float) $f->gallons, 'vale' => $f->voucher_no, 'odometro' => (float) $f->odometer_km, 'empleado' => $f->employee_id, 'foto' => $f->photo_file_id,
                'descripcion' => "Combustible {$f->number} · {$v->plate} · ".Base::km((float) $f->gallons, 3).' gal',
            ], $u);

            return DB::table('fuel_loads')->where('id', $id)->first();
        });
    }

    /** FLO-05: cargas con filtros. */
    public static function lista(User $u, array $f): array
    {
        $vs = Base::flota($u)->pluck('v.id')->all();
        $desde = $f['desde'] ?? CarbonImmutable::parse(Base::hoy())->subDays(30)->toDateString();
        $hasta = $f['hasta'] ?? Base::hoy();
        $filas = DB::table('fuel_loads as f')->join('vehicles as v', 'v.id', '=', 'f.vehicle_id')->leftJoin('vehicle_profiles as p', 'p.vehicle_id', '=', 'f.vehicle_id')
            ->leftJoin('users as u', 'u.id', '=', 'f.driver_user_id')->leftJoin('expenses as e', 'e.id', '=', 'f.expense_id')->leftJoin('vehicle_trips as t', 't.id', '=', 'f.trip_id')
            ->whereIn('f.vehicle_id', $vs ?: ['00000000-0000-0000-0000-000000000000'])
            ->whereBetween('f.loaded_at', [CarbonImmutable::parse($desde, 'America/Lima')->startOfDay(), CarbonImmutable::parse($hasta, 'America/Lima')->endOfDay()])
            ->when($f['vehiculo'] ?? null, fn ($w) => $w->where('f.vehicle_id', $f['vehiculo']))
            ->when(($f['estado'] ?? 'ACTIVE') !== 'TODAS', fn ($w) => $w->where('f.status', $f['estado'] ?? 'ACTIVE'))
            ->when(($f['gasto'] ?? null) === 'SIN', fn ($w) => $w->whereNull('f.expense_id'))
            ->orderByDesc('f.loaded_at')->limit(500)
            ->get(['f.*', 'v.plate', 'p.internal_code', 'u.name as conductor', 'e.number as gasto', 'e.status as estado_gasto', 't.number as jornada'])
            ->map(fn ($x) => array_replace((array) $x, [
                'vehiculo' => $x->internal_code && $x->internal_code !== $x->plate ? "{$x->internal_code} · {$x->plate}" : $x->plate,
                'gallons' => (float) $x->gallons, 'price_per_gal' => (float) $x->price_per_gal, 'amount' => (float) $x->amount, 'odometer_km' => (float) $x->odometer_km,
                'km_per_gal' => $x->km_per_gal !== null ? (float) $x->km_per_gal : null, 'km_since_full' => $x->km_since_full !== null ? (float) $x->km_since_full : null,
                'gallons_since_full' => $x->gallons_since_full !== null ? (float) $x->gallons_since_full : null,
                'expected_km_per_gal' => $x->expected_km_per_gal !== null ? (float) $x->expected_km_per_gal : null,
            ]))->all();
        $activas = array_filter($filas, fn ($x) => $x['status'] === 'ACTIVE');

        return ['data' => $filas, 'desde' => $desde, 'hasta' => $hasta, 'resumen' => [
            'cargas' => count($activas), 'galones' => round(array_sum(array_column($activas, 'gallons')), 3), 'importe' => round(array_sum(array_column($activas, 'amount')), 2),
            'sin_gasto' => count(array_filter($activas, fn ($x) => ! $x['expense_id'])), 'bajas' => count(array_filter($activas, fn ($x) => $x['efficiency_status'] === 'LOW')),
        ]];
    }

    /** FLO-06: km por galón por vehículo y por conductor frente al esperado, con tendencia semanal (KPI-FLO-02). */
    public static function rendimientos(User $u, ?string $desde, ?string $hasta): array
    {
        $desde ??= CarbonImmutable::parse(Base::hoy())->subDays(59)->toDateString();
        $hasta ??= Base::hoy();
        $vs = Base::flota($u)->get(['v.*'])->keyBy('id');
        $cargas = DB::table('fuel_loads as f')->leftJoin('users as u', 'u.id', '=', 'f.driver_user_id')
            ->whereIn('f.vehicle_id', $vs->keys()->all() ?: ['00000000-0000-0000-0000-000000000000'])->where('f.status', 'ACTIVE')->whereNotNull('f.km_per_gal')
            ->whereBetween('f.loaded_at', [CarbonImmutable::parse($desde, 'America/Lima')->startOfDay(), CarbonImmutable::parse($hasta, 'America/Lima')->endOfDay()])
            ->orderBy('f.loaded_at')->get(['f.*', 'u.name as conductor']);
        $porV = [];
        $porC = [];
        $semanas = [];
        foreach ($cargas as $c) {
            $v = $vs[$c->vehicle_id];
            $p = $porV[$v->id]['perfil'] ?? Base::perfil($v);
            $min = self::minimo($p);
            $porV[$v->id] ??= ['vehicle_id' => $v->id, 'vehiculo' => Base::etiqueta($v), 'perfil' => $p, 'esperado' => (float) $p->expected_km_per_gal, 'minimo' => $min, 'n' => 0, 'km' => 0.0, 'gal' => 0.0, 'bajas' => 0, 'serie' => []];
            $x = &$porV[$v->id];
            $x['n']++;
            $x['km'] += (float) $c->km_since_full;
            $x['gal'] += (float) $c->gallons_since_full;
            $x['bajas'] += $c->efficiency_status === 'LOW' ? 1 : 0;
            $x['serie'][] = ['t' => $c->loaded_at, 'kmpg' => (float) $c->km_per_gal, 'numero' => $c->number];
            unset($x);
            $k = ($c->driver_user_id ?? 'sin').'|'.$v->id;
            $porC[$k] ??= ['conductor' => $c->conductor ?? 'Sin conductor', 'vehiculo' => Base::etiqueta($v), 'esperado' => (float) $p->expected_km_per_gal, 'minimo' => $min, 'n' => 0, 'km' => 0.0, 'gal' => 0.0, 'bajas' => 0];
            $porC[$k]['n']++;
            $porC[$k]['km'] += (float) $c->km_since_full;
            $porC[$k]['gal'] += (float) $c->gallons_since_full;
            $porC[$k]['bajas'] += $c->efficiency_status === 'LOW' ? 1 : 0;
            $sem = CarbonImmutable::parse($c->loaded_at)->setTimezone('America/Lima')->startOfWeek()->toDateString();
            $semanas[$sem] ??= ['semana' => $sem, 'km' => 0.0, 'gal' => 0.0];
            $semanas[$sem]['km'] += (float) $c->km_since_full;
            $semanas[$sem]['gal'] += (float) $c->gallons_since_full;
        }
        $cerrar = function (array $x) {
            unset($x['perfil']);
            $x['kmpg'] = $x['gal'] > 0 ? round($x['km'] / $x['gal'], 1) : null;
            $x['desvio_pct'] = $x['kmpg'] !== null ? round(($x['kmpg'] - $x['esperado']) / $x['esperado'] * 100, 1) : null;
            $x['km'] = round($x['km'], 1);
            $x['gal'] = round($x['gal'], 3);
            $x['bajo'] = $x['kmpg'] !== null && $x['kmpg'] < $x['minimo'];

            return $x;
        };
        $km = array_sum(array_column($porV, 'km'));
        $gal = array_sum(array_column($porV, 'gal'));

        return [
            'desde' => $desde, 'hasta' => $hasta, 'tolerancia' => Base::num('flo_fuel_efficiency_tolerance_pct', 15),
            'flota' => ['kmpg' => $gal > 0 ? round($km / $gal, 1) : null, 'km' => round($km, 1), 'gal' => round($gal, 3), 'cargas' => $cargas->count(), 'bajas' => $cargas->where('efficiency_status', 'LOW')->count(),
                'alertas' => DB::table('fleet_alerts')->where('alert_type', 'FUEL_EFFICIENCY')->where('status', '<>', 'CLOSED')->whereIn('vehicle_id', $vs->keys()->all() ?: ['00000000-0000-0000-0000-000000000000'])->count()],
            'vehiculos' => array_values(array_map($cerrar, $porV)), 'conductores' => array_values(array_map($cerrar, $porC)),
            'semanas' => array_values(array_map(fn ($s) => ['semana' => $s['semana'], 'kmpg' => $s['gal'] > 0 ? round($s['km'] / $s['gal'], 1) : null], $semanas)),
        ];
    }
}
