<?php

namespace App\Modulos\Flo\Services;

use App\Models\User;
use App\Support\Access;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/** FLO-01 Mapa en vivo y las opciones comunes de las pantallas. */
final class Consultas
{
    public const ESTADOS_VIVO = ['MOVING' => 'En movimiento', 'STOPPED' => 'Detenido', 'SILENT' => 'GPS silencioso', 'BLOCKED' => 'Bloqueado', 'IDLE' => 'Sin jornada', 'MAINT' => 'En mantenimiento'];

    public static function opciones(User $u): array
    {
        $proveedores = DB::table('suppliers')->where('status', 'ACTIVE')->orderBy('trade_name')->get(['id', 'trade_name', 'legal_name', 'supplier_type', 'doc_number'])
            ->map(fn ($s) => ['id' => $s->id, 'nombre' => $s->trade_name ?: $s->legal_name, 'tipo' => $s->supplier_type, 'ruc' => $s->doc_number])->all();
        $conductores = DB::table('users as u')->join('user_roles as ur', 'ur.user_id', '=', 'u.id')->join('roles as ro', 'ro.id', '=', 'ur.role_id')
            ->where('ro.code', 'REPARTIDOR')->where('u.status', 'ACTIVE')->distinct()->orderBy('u.name')->get(['u.id', 'u.name', 'u.employee_id'])->map(fn ($x) => (array) $x)->all();
        $empleados = DB::table('employees')->where('status', 'ACTIVE')->orderBy('full_name')->when(Base::locales($u), fn ($q, $l) => $q->where(fn ($w) => $w->whereIn('establishment_id', $l)->orWhereNull('establishment_id')))
            ->get(['id', 'full_name', 'position'])->map(fn ($x) => (array) $x)->all();
        $locales = DB::table('establishments')->where('status', 'ACTIVE')->when(Base::locales($u), fn ($q, $l) => $q->whereIn('id', $l))->orderBy('code')->get(['id', 'code', 'name'])->map(fn ($x) => (array) $x)->all();

        return [
            'vehiculos' => Vehiculos::lista($u), 'conductores' => $conductores, 'empleados' => $empleados, 'proveedores' => $proveedores, 'locales' => $locales,
            'documentos' => array_map(fn ($k, $d) => ['code' => $k, 'nombre' => $d[0], 'duenio' => $d[1], 'vence' => $d[2]], array_keys(Base::DOCUMENTOS), Base::DOCUMENTOS),
            'costos' => Base::COSTOS, 'entidades' => Base::ENTIDADES, 'alertas' => Base::ALERTAS, 'checklist' => Base::CHECKLIST, 'hoy' => Base::hoy(),
            'parametros' => [
                'gps_segundos' => (int) Base::num('flo_gps_interval_seconds', 30), 'tolerancia_km' => Base::num('flo_km_gps_tolerance_pct', 15),
                'tolerancia_rendimiento' => Base::num('flo_fuel_efficiency_tolerance_pct', 15), 'factor_tanque' => Base::num('flo_tank_overfill_factor', 1.05),
                'aviso_km' => Base::num('flo_maint_alert_km', 500), 'aviso_dias' => Base::num('flo_maint_alert_days', 7), 'bloqueo_km' => Base::num('flo_maint_overdue_block_km', 1000),
                'avisos_documentos' => Base::diasAviso(), 'excursion_minutos' => Base::num('flo_temp_excursion_minutes', 15), 'gps_silencio' => Base::num('flo_gps_silent_minutes', 10),
                'limite_velocidad' => Base::num('flo_speed_limit_kmh', 80),
            ],
            'permisos' => [
                'vivo' => Access::can($u, 'flo.live.view'), 'jornada' => Access::can($u, 'flo.trip.operate'), 'combustible' => Access::can($u, 'flo.fuel.manage'),
                'mantenimiento' => Access::can($u, 'flo.maintenance.manage'), 'documentos' => Access::can($u, 'flo.document.manage'), 'multas' => Access::can($u, 'flo.fine.manage'),
                'tablero' => Access::can($u, 'flo.odometer.reset'), 'costos' => Access::can($u, 'flo.cost.view'), 'descuento' => Multas::apruebaDescuento($u),
                'gastos' => Access::can($u, 'gas.expense.create') && in_array('GAS', Access::for($u)['enabled_modules'], true), 'planificar' => Access::can($u, 'del.route.plan'),
            ],
        ];
    }

    /** FLO-01: vehículos con su jornada de hoy, última posición, velocidad, ruta, próxima parada, temperatura y alertas. */
    public static function mapa(User $u, ?string $local, ?string $modalidad): array
    {
        $hoy = Base::hoy();
        $ahora = Base::ahora();
        $silencio = Base::num('flo_gps_silent_minutes', 10);
        $out = [];
        $vs = Base::flota($u)->where('v.status', '<>', 'INACTIVE')->when($local, fn ($q) => $q->where('v.establishment_id', $local))
            ->when($modalidad, fn ($q) => $q->where('v.ownership', $modalidad))->get(['v.*']);
        foreach ($vs as $v) {
            $t = Jornadas::abiertaDe($v->id);
            $ultima = $t ? DB::table('vehicle_positions')->where('trip_id', $t->id)->orderByDesc('recorded_at')->first() : null;
            $rastro = $t ? DB::table('vehicle_positions')->where('trip_id', $t->id)->orderByDesc('recorded_at')->limit(40)->get(['lat', 'lng'])->reverse()
                ->map(fn ($p) => [(float) $p->lat, (float) $p->lng])->values()->all() : [];
            $motivos = Operable::motivos($v, $hoy);
            $min = $t ? (int) floor(CarbonImmutable::parse($ultima->recorded_at ?? $t->started_at)->diffInMinutes($ahora, false)) : null;
            $estado = match (true) {
                $t !== null && $min > $silencio => 'SILENT',
                $t !== null && $ultima && (float) $ultima->speed_kmh >= 3 => 'MOVING',
                $t !== null => 'STOPPED',
                (bool) array_filter($motivos, fn ($m) => $m['tipo'] === 'MAINT') => 'MAINT',
                (bool) $motivos => 'BLOCKED',
                default => 'IDLE',
            };
            $ruta = DB::table('delivery_routes')->where('vehicle_id', $v->id)->where('route_date', $hoy)->where('status', '<>', 'CANCELLED')
                ->orderByRaw("CASE status WHEN 'IN_ROUTE' THEN 0 ELSE 1 END")->first(['id', 'code', 'status']);
            $proxima = $ruta ? DB::table('delivery_stops as s')->join('sales_orders as o', 'o.id', '=', 's.order_id')->where('s.route_id', $ruta->id)
                ->whereIn('s.status', ['PENDING', 'ARRIVED'])->orderBy('s.seq')->first(['s.seq', 's.eta', 'o.number']) : null;
            $temp = $v->refrigerated ? DB::table('vehicle_temperature_readings')->where('vehicle_id', $v->id)->orderByDesc('read_at')->first(['read_at', 'temp_c', 'in_range']) : null;
            $alertas = DB::table('fleet_alerts')->where('vehicle_id', $v->id)->where('status', '<>', 'CLOSED')->orderByRaw("CASE severity WHEN 'bad' THEN 0 ELSE 1 END")
                ->get(['id', 'number', 'alert_type', 'title', 'severity']);
            $out[] = [
                'id' => $v->id, 'etiqueta' => Base::etiqueta($v), 'plate' => $v->plate, 'tipo' => Base::TIPOS[$v->vehicle_type] ?? $v->vehicle_type,
                'ownership' => $v->ownership, 'modalidad' => Base::MODALIDAD[$v->ownership] ?? $v->ownership, 'refrigerated' => (bool) $v->refrigerated,
                'estado' => $estado, 'bloqueos' => array_column($motivos, 'msg'),
                'jornada' => $t ? ['id' => $t->id, 'number' => $t->number, 'started_at' => $t->started_at, 'conductor' => Base::nombre($t->driver_user_id), 'odometer_start' => (float) $t->odometer_start] : null,
                'posicion' => $ultima ? ['lat' => (float) $ultima->lat, 'lng' => (float) $ultima->lng, 'speed_kmh' => (float) $ultima->speed_kmh, 'recorded_at' => $ultima->recorded_at] : null,
                'minutos_sin_senal' => $min, 'rastro' => $rastro, 'km_gps' => $t ? Jornadas::kmGps($t->id) : null,
                'ruta' => $ruta ? ['code' => $ruta->code, 'status' => $ruta->status] : null,
                'proxima' => $proxima ? ['seq' => $proxima->seq, 'number' => $proxima->number, 'eta' => $proxima->eta] : null,
                'temperatura' => $temp ? ['temp_c' => (float) $temp->temp_c, 'in_range' => (bool) $temp->in_range, 'read_at' => $temp->read_at] : null,
                'rango' => Base::rango($v), 'alertas' => $alertas->map(fn ($a) => array_replace((array) $a, ['tipo' => Base::ALERTAS[$a->alert_type] ?? $a->alert_type]))->all(),
            ];
        }
        usort($out, fn ($a, $b) => [array_search($a['estado'], ['SILENT', 'MOVING', 'STOPPED', 'BLOCKED', 'MAINT', 'IDLE'], true), $a['etiqueta']]
            <=> [array_search($b['estado'], ['SILENT', 'MOVING', 'STOPPED', 'BLOCKED', 'MAINT', 'IDLE'], true), $b['etiqueta']]);
        $locales = DB::table('establishments')->where('status', 'ACTIVE')->whereNotNull('lat')->when(Base::locales($u), fn ($q, $l) => $q->whereIn('id', $l))
            ->get(['id', 'code', 'name', 'lat', 'lng'])->map(fn ($e) => ['id' => $e->id, 'code' => $e->code, 'name' => $e->name, 'lat' => (float) $e->lat, 'lng' => (float) $e->lng])->all();

        return ['vehiculos' => $out, 'locales' => $locales, 'ahora' => $ahora->toIso8601String(), 'resumen' => [
            'en_jornada' => count(array_filter($out, fn ($x) => $x['jornada'])), 'movimiento' => count(array_filter($out, fn ($x) => $x['estado'] === 'MOVING')),
            'silenciosos' => count(array_filter($out, fn ($x) => $x['estado'] === 'SILENT')), 'bloqueados' => count(array_filter($out, fn ($x) => in_array($x['estado'], ['BLOCKED', 'MAINT'], true))),
            'alertas' => array_sum(array_map(fn ($x) => count($x['alertas']), $out)),
        ], 'parametros' => ['gps_segundos' => (int) Base::num('flo_gps_interval_seconds', 30), 'silencio' => $silencio]];
    }
}
