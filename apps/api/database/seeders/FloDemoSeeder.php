<?php

namespace Database\Seeders;

use Carbon\CarbonImmutable;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Ramsey\Uuid\Uuid;

/**
 * FLO · demo de flota avanzada para Don Guando (corre con el dueño de las tablas, después de la base y de DEL).
 *
 * - Perfiles de los 5 vehículos (código interno, tanque, rendimiento esperado, rango de frío del furgón).
 * - Jornadas del 01/09 al 10/10/2026 armadas desde las rutas de DEL de cada día (mismo vehículo, repartidor y
 *   odómetros), con sus lecturas de odómetro; así el odómetro del vehículo no cambia y DEL sigue cuadrando.
 * - Cargas de combustible con tanque lleno cada 2 a 6 días (una de MOT-01 con rendimiento bajo, RN-FLO-07).
 * - Posiciones GPS cada 30 s de los últimos 3 días con rutas (08 al 10/10) y de la jornada abierta de hoy;
 *   temperaturas del furgón cada 5 min, con una excursión de 25 min el 09/10 (RN-FLO-14).
 * - Planes y órdenes de mantenimiento, documentos (iguales a las fechas de vehicles), licencias, multas y otros
 *   costos. Nada deja un vehículo bloqueado por mantenimiento (las pruebas de DEL usan MTA-123 y MTB-456).
 * La semilla aleatoria es fija; solo cambia lo que depende de la hora en que corre (la jornada de hoy).
 */
class FloDemoSeeder extends Seeder
{
    private string $t;

    private array $n = ['JR' => 0, 'CG' => 0, 'PM' => 0, 'MV' => 0, 'AF' => 0];

    private CarbonImmutable $ahora;

    /** Placa => perfil. */
    private const PERFILES = [
        'MTA-123' => ['MOT-01', 'Honda', 'CB 190R', 2023, 'Rojo', 3, 70, null, 18500, 2000, 48, 'GPS-AND-01'],
        'MTB-456' => ['MOT-02', 'Honda', 'CB 190R', 2022, 'Negro', 3, 70, null, 17200, 1800, 48, 'GPS-AND-02'],
        'BXR-871' => ['FUR-01', 'Hyundai', 'H-100 furgón refrigerado', 2021, 'Blanco', 18, 30, 'CHILLED', 118000, 30000, 96, 'GPS-AND-03'],
        'MTC-789' => ['MOT-03', 'Bajaj', 'Pulsar NS 200', 2024, 'Azul', 3.2, 68, null, null, null, null, 'GPS-AND-04'],
        'BKZ-512' => ['AUT-01', 'Toyota', 'Yaris', 2020, 'Gris', 11.5, 38, null, null, null, null, 'GPS-AND-05'],
    ];

    public function run(): void
    {
        $this->t = (string) DB::table('tenants')->where('name', 'like', '%DON GUANDO%')->value('id');
        if (! $this->t) {
            return;
        }
        $this->accesoCalidad();
        if (DB::table('vehicle_profiles')->where('tenant_id', $this->t)->exists()) {
            return;
        }
        $this->ahora = CarbonImmutable::now('America/Lima');
        DB::select("SELECT set_config('app.tenant_id', ?, false)", [$this->t]);
        mt_srand(77);

        $veh = DB::table('vehicles')->where('tenant_id', $this->t)->get()->keyBy('plate');
        $u = DB::table('users')->where('tenant_id', $this->t)->get(['id', 'email', 'employee_id'])->keyBy(fn ($x) => strstr($x->email, '@', true));
        $coord = $u['rchavez']->id ?? null;
        $sup = DB::table('suppliers')->where('tenant_id', $this->t)->pluck('id', 'trade_name');

        $this->perfiles($veh);
        $this->documentos($veh, $u, $coord);
        $jornadas = $this->jornadas($veh, $coord);
        $this->combustible($veh, $jornadas, $sup, $coord);
        $this->mantenimiento($veh, $sup, $coord);
        $this->hoy($veh, $u, $coord);
        $this->gps($veh, $jornadas);
        $this->multasYCostos($veh, $u, $sup, $coord);

        DB::select("SELECT set_config('app.tenant_id', '', false)");
        $this->command?->info('FLO: '.count($jornadas).' jornadas, '.DB::table('vehicle_positions')->where('tenant_id', $this->t)->count().' posiciones y '
            .DB::table('fuel_loads')->where('tenant_id', $this->t)->count().' cargas (FLO-01 a FLO-15)');
    }

    /** Calidad revisa los pedidos de una excursión de temperatura (RN-FLO-14) desde FLO-14: necesita leer FLO. */
    private function accesoCalidad(): void
    {
        foreach (DB::table('roles')->where('code', 'CALIDAD')->get(['id', 'tenant_id']) as $r) {
            $ya = DB::table('role_module_access')->where('role_id', $r->id)->where('module_code', 'FLO')->exists();
            if (! $ya && DB::table('tenants')->where('id', $r->tenant_id)->exists()) {
                DB::table('role_module_access')->insert(['id' => (string) Uuid::uuid4(), 'tenant_id' => $r->tenant_id, 'role_id' => $r->id, 'module_code' => 'FLO', 'actions' => 'L']);
            }
        }
    }

    private function num(string $p, int $d): string
    {
        return "{$p}-".str_pad((string) ++$this->n[$p], $d, '0', STR_PAD_LEFT);
    }

    private function r(float $a, float $b): float
    {
        return $a + mt_rand() / mt_getrandmax() * ($b - $a);
    }

    private function ins(string $tabla, array $fila): string
    {
        $id = $fila['id'] ?? (string) Uuid::uuid4();
        DB::table($tabla)->insert(['id' => $id, 'tenant_id' => $this->t] + $fila);

        return $id;
    }

    private function lote(string $tabla, array $filas): void
    {
        foreach (array_chunk($filas, 500) as $l) {
            DB::table($tabla)->insert(array_map(fn ($f) => ['tenant_id' => $this->t] + $f, $l));
        }
    }

    private function lectura(string $vid, CarbonImmutable $en, float $km, string $origen, ?string $origenId, ?string $u): void
    {
        $this->ins('vehicle_odometer_readings', ['vehicle_id' => $vid, 'read_at' => $en, 'km' => round($km, 1), 'source' => $origen, 'source_id' => $origenId, 'recorded_by' => $u]);
    }

    private function perfiles($veh): void
    {
        foreach (self::PERFILES as $placa => [$cod, $marca, $modelo, $anio, $color, $tanque, $kmpg, $frio, $costo, $residual, $vida, $gps]) {
            if (! isset($veh[$placa])) {
                continue;
            }
            $this->ins('vehicle_profiles', [
                'vehicle_id' => $veh[$placa]->id, 'internal_code' => $cod, 'make' => $marca, 'model' => $modelo, 'year' => $anio, 'color' => $color,
                'tank_capacity_gal' => $tanque, 'expected_km_per_gal' => $kmpg, 'temp_mode' => $frio, 'temp_min_c' => $frio ? 0 : null, 'temp_max_c' => $frio ? 4 : null,
                'gps_source' => 'APP_ANDROID', 'gps_device_id' => $gps, 'temp_sensor_id' => $frio ? 'TERMO-FUR01' : null,
                'purchase_date' => $costo ? ($anio.'-03-15') : null, 'purchase_cost' => $costo, 'residual_value' => $residual, 'useful_life_months' => $vida, 'op_status' => 'ACTIVE',
            ]);
        }
    }

    /** Documentos con las mismas fechas que vehicles (DEL las lee de ahí) y licencias de los repartidores. */
    private function documentos($veh, $u, ?string $coord): void
    {
        foreach ($veh as $v) {
            if (! isset(self::PERFILES[$v->plate])) {
                continue;
            }
            if ($v->soat_expires_on) {
                $this->ins('vehicle_documents', ['vehicle_id' => $v->id, 'doc_type' => 'SOAT', 'number' => $v->soat_policy_no ?: 'SOAT-'.str_replace('-', '', $v->plate),
                    'issuer' => 'Rímac Seguros', 'issued_on' => CarbonImmutable::parse($v->soat_expires_on)->subYear()->toDateString(), 'expires_on' => $v->soat_expires_on, 'created_by' => $coord]);
            }
            if ($v->tech_inspection_expires_on) {
                $this->ins('vehicle_documents', ['vehicle_id' => $v->id, 'doc_type' => 'TECH_INSPECTION', 'number' => 'CITV-'.mt_rand(100000, 999999),
                    'issuer' => 'Revisiones Técnicas del Perú', 'issued_on' => CarbonImmutable::parse($v->tech_inspection_expires_on)->subYear()->toDateString(),
                    'expires_on' => $v->tech_inspection_expires_on, 'created_by' => $coord]);
            }
            if ($v->ownership === 'OWN') {
                $this->ins('vehicle_documents', ['vehicle_id' => $v->id, 'doc_type' => 'PROPERTY_CARD', 'number' => 'TIVE-'.mt_rand(1000000, 9999999), 'issuer' => 'SUNARP', 'created_by' => $coord]);
            } else {
                $this->ins('vehicle_documents', ['vehicle_id' => $v->id, 'doc_type' => 'RENTAL_CONTRACT', 'number' => 'CTR-'.$v->plate, 'issuer' => 'Motos Rápido',
                    'issued_on' => '2026-01-02', 'expires_on' => '2027-01-01', 'created_by' => $coord, 'notes' => 'Alquiler diario con mantenimiento a cargo del proveedor.']);
            }
        }
        $hoy = CarbonImmutable::now('America/Lima');
        $lic = ['pcondori' => ['Q45871236', 'A-IIb', '2028-06-30'], 'hticona' => ['Q40125587', 'A-IIb', $hoy->addDays(12)->toDateString()],
            'jchoque' => ['Q47788120', 'B-IIc', '2029-02-14'], 'rmena' => ['Q42210954', 'B-IIc', '2026-11-10']];
        foreach ($lic as $quien => [$nro, $clase, $vence]) {
            if (! empty($u[$quien]->employee_id)) {
                $this->ins('vehicle_documents', ['employee_id' => $u[$quien]->employee_id, 'doc_type' => 'DRIVER_LICENSE', 'number' => $nro, 'license_class' => $clase,
                    'issuer' => 'MTC', 'issued_on' => CarbonImmutable::parse($vence)->subYears(5)->toDateString(), 'expires_on' => $vence, 'created_by' => $coord]);
            }
        }
    }

    /** Jornadas cerradas desde las rutas de DEL (01/09 al 10/10). Devuelve [id, vehicle_id, fecha, inicio, fin, km0, km1, rutas]. */
    private function jornadas($veh, ?string $coord): array
    {
        $out = [];
        $porVehiculo = DB::table('delivery_routes')->where('tenant_id', $this->t)->whereNotNull('vehicle_id')->whereNotNull('departed_at')->whereNotNull('driver_user_id')
            ->whereNotNull('returned_at')->orderBy('departed_at')->get()->groupBy('vehicle_id');   // las que siguen en ruta (10/10) no cierran jornada
        foreach ($veh as $v) {
            if (! isset(self::PERFILES[$v->plate]) || ! isset($porVehiculo[$v->id])) {
                continue;
            }
            $dias = $porVehiculo[$v->id]->groupBy('route_date');
            $odo = null;
            foreach ($dias as $fecha => $rutas) {
                $chofer = $rutas->first()->driver_user_id;
                if ($rutas->pluck('driver_user_id')->unique()->count() > 1 || ($v->plate === 'MTB-456')) {
                    continue;   // MTB-456 salió un solo día con Pedro, que ese día también manejaba MTA-123
                }
                $ini = CarbonImmutable::parse($rutas->min('departed_at'))->setTimezone('America/Lima')->subMinutes(mt_rand(15, 30));
                $ultimo = $rutas->max('returned_at') ?? $rutas->max('departed_at');
                $fin = CarbonImmutable::parse($ultimo)->setTimezone('America/Lima')->addMinutes(mt_rand(10, 25));
                if ($fin->greaterThan($this->ahora)) {
                    continue;
                }
                $km0 = round(max((float) $rutas->min('odometer_start') - 0.3, $odo ?? 0), 1);
                $km1 = round(max((float) ($rutas->max('odometer_end') ?? ($km0 + (float) $rutas->sum('planned_km'))) + 0.3, $km0), 1);
                $km1 = min($km1, (float) $v->odometer_km);
                $km0 = min($km0, $km1);
                $odo = $km1;
                $kmOdo = round($km1 - $km0, 1);
                $kmGps = round($kmOdo * $this->r(0.94, 1.02), 1);
                $id = $this->ins('vehicle_trips', [
                    'number' => $this->num('JR', 6), 'vehicle_id' => $v->id, 'driver_user_id' => $chofer, 'driver_employee_id' => $rutas->first()->driver_employee_id,
                    'establishment_id' => $rutas->first()->establishment_id, 'route_id' => $rutas->first()->id, 'trip_date' => $fecha, 'status' => 'CLOSED', 'source' => 'APP',
                    'started_at' => $ini, 'ended_at' => $fin, 'odometer_start' => $km0, 'odometer_end' => $km1, 'km_odometer' => $kmOdo, 'km_gps' => $kmGps,
                    'km_diff_pct' => $kmGps > 0 ? round(($kmOdo - $kmGps) / $kmGps * 100, 1) : null,
                    'deliveries' => DB::table('delivery_stops')->whereIn('route_id', $rutas->pluck('id'))->whereIn('status', ['DELIVERED', 'HANDED_OFF'])->count(),
                    'checklist_start' => json_encode(['lights' => true, 'tires' => true, 'brakes' => true, 'thermal_box' => true, 'documents' => true]),
                    'checklist_end' => json_encode(['lights' => true, 'tires' => true, 'brakes' => true, 'thermal_box' => true, 'documents' => true]),
                    'created_by' => $chofer, 'created_at' => $ini, 'updated_at' => $fin,
                ]);
                $this->lectura($v->id, $ini, $km0, 'TRIP_START', $id, $chofer);
                $this->lectura($v->id, $fin, $km1, 'TRIP_END', $id, $chofer);
                $out[] = ['id' => $id, 'vehicle_id' => $v->id, 'plate' => $v->plate, 'fecha' => $fecha, 'ini' => $ini, 'fin' => $fin, 'km0' => $km0, 'km1' => $km1,
                    'chofer' => $chofer, 'empleado' => $rutas->first()->driver_employee_id, 'rutas' => $rutas->values()->all(), 'local' => $rutas->first()->establishment_id];
            }
        }
        // Una jornada con km del tablero muy distintos al GPS (RN-FLO-05), ya revisada.
        $j = collect($out)->firstWhere(fn ($x) => $x['plate'] === 'MTC-789' && $x['fecha'] === '2026-09-23');
        if ($j) {
            $kmOdo = $j['km1'] - $j['km0'];
            $gps = round($kmOdo * 0.78, 1);
            DB::table('vehicle_trips')->where('id', $j['id'])->update(['km_gps' => $gps, 'km_diff_pct' => round(($kmOdo - $gps) / $gps * 100, 1)]);
            $this->ins('fleet_alerts', ['number' => $this->num('AF', 5), 'alert_type' => 'ODOMETER', 'vehicle_id' => $j['vehicle_id'], 'employee_id' => $j['empleado'],
                'origin' => 'trip:'.$j['id'], 'title' => 'Km del tablero y del GPS no cuadran · MTC-789', 'severity' => 'warn',
                'detail' => 'RN-FLO-05: '.number_format($kmOdo, 1, ',', '.').' km por odómetro y '.number_format($gps, 1, ',', '.').' km por GPS ('.number_format(($kmOdo - $gps) / $gps * 100, 1, ',', '.').' %, tolerancia 15 %).',
                'first_at' => $j['fin'], 'last_at' => $j['fin'], 'status' => 'CLOSED', 'closed_by' => $coord, 'closed_at' => $j['fin']->addDay(),
                'resolution' => 'El celular de Julio estuvo sin datos dos horas; el odómetro es correcto.']);
        }

        return $out;
    }

    /** Cargas con tanque lleno, al empezar la jornada, cuando gastó entre 55 % y 85 % del tanque. */
    private function combustible($veh, array $jornadas, $sup, ?string $coord): void
    {
        $precio = ['GASOLINE' => 17.45, 'DIESEL' => 16.20];
        foreach (collect($jornadas)->groupBy('vehicle_id') as $vid => $js) {
            $v = $veh->firstWhere('id', $vid);
            [, , , , , $tanque, $kmpg] = self::PERFILES[$v->plate];
            $base = null;
            $umbral = $tanque * $kmpg * $this->r(0.55, 0.85);
            foreach ($js as $i => $j) {
                $grifo = $j['local'] === DB::table('establishments')->where('code', 'L2')->where('tenant_id', $this->t)->value('id') ? 'Grifo Lurín' : 'Grifo Benavides';
                $en = $j['ini']->addMinutes(mt_rand(6, 14));
                if ($base === null) {
                    $g = round($tanque * $this->r(0.5, 0.8), 3);
                    $base = $this->carga($v, $j, $en, $j['km0'], $g, $precio[$v->fuel_type] ?? 17.45, $grifo, $sup, 'BASELINE', null, $kmpg, null);
                    continue;
                }
                // Carga al empezar la jornada si al terminarla ya habría gastado el umbral del tanque.
                $km = $j['km0'] - $base['km'];
                $bajo = $v->plate === 'MTA-123' && $j['fecha'] >= '2026-09-24' && ! isset($this->bajo) && $km >= 100 && $km <= 155;
                if (! $bajo && ($j['km1'] - $base['km'] < $umbral || $km <= 0)) {
                    continue;
                }
                $real = $bajo ? 52.0 : $kmpg * $this->r(0.9, 1.06);
                $g = round(min($km / $real, $tanque * 1.04), 3);
                $base = $this->carga($v, $j, $en, $j['km0'], $g, $precio[$v->fuel_type] ?? 17.45, $grifo, $sup, 'APP', $base, $kmpg, $bajo ? $coord : null);
                if ($bajo) {
                    $this->bajo = true;
                }
                $umbral = $tanque * $kmpg * $this->r(0.55, 0.85);
            }
        }
    }

    private bool $bajo;

    private function carga(object $v, array $j, CarbonImmutable $en, float $km, float $gal, float $precio, string $grifo, $sup, string $origen, ?array $base, float $kmpg, ?string $atiende): array
    {
        $kmDesde = $base ? round($km - $base['km'], 1) : null;
        $rend = $base && $gal > 0 ? round($kmDesde / $gal, 1) : null;
        $bajo = $rend !== null && $rend < $kmpg * 0.85;
        $id = $this->ins('fuel_loads', [
            'number' => $this->num('CG', 5), 'vehicle_id' => $v->id, 'trip_id' => $j['id'], 'driver_user_id' => $j['chofer'], 'employee_id' => $j['empleado'],
            'loaded_at' => $en, 'odometer_km' => $km, 'gallons' => $gal, 'price_per_gal' => $precio, 'amount' => round($gal * $precio, 2), 'full_tank' => true,
            'fuel_type' => $v->fuel_type, 'station_supplier_id' => $sup[$grifo] ?? null, 'station_name' => $grifo, 'voucher_no' => 'V'.mt_rand(100000, 999999),
            'doc_type' => 'TICKET', 'km_since_full' => $kmDesde, 'gallons_since_full' => $base ? $gal : null, 'km_per_gal' => $rend, 'base_load_id' => $base['id'] ?? null,
            'expected_km_per_gal' => $kmpg, 'efficiency_status' => $rend === null ? 'NA' : ($bajo ? 'LOW' : 'OK'), 'source' => $origen, 'recorded_by' => $j['chofer'], 'created_at' => $en,
        ]);
        $this->lectura($v->id, $en, $km, 'FUEL', $id, $j['chofer']);
        if ($bajo) {
            $this->ins('fleet_alerts', ['number' => $this->num('AF', 5), 'alert_type' => 'FUEL_EFFICIENCY', 'vehicle_id' => $v->id, 'employee_id' => $j['empleado'], 'origin' => 'kmpg',
                'title' => 'Rendimiento bajo '.number_format($rend, 1, ',', '.')." km/gal · {$v->plate}", 'severity' => 'warn',
                'detail' => 'RN-FLO-07: '.number_format($kmDesde, 1, ',', '.').' km con '.number_format($gal, 3, ',', '.').' gal; se espera '.number_format($kmpg, 1, ',', '.')
                    .' km/gal (mínimo '.number_format($kmpg * 0.85, 1, ',', '.').').',
                'first_at' => $en, 'last_at' => $en, 'max_value' => $rend, 'status' => 'ACK', 'ack_by' => $atiende, 'ack_at' => $en->addHours(5),
                'ack_note' => 'Se revisó la presión de llantas y el filtro de aire; seguimos la próxima carga.']);
        }

        return ['id' => $id, 'km' => $km];
    }

    /** Planes de mantenimiento al día o por vencer (ninguno bloquea) y las órdenes que los cerraron. */
    private function mantenimiento($veh, $sup, ?string $coord): void
    {
        $planes = [
            // placa, tarea, cada km, cada días, hecho en km, hecho el, taller, repuestos, mano de obra
            ['MTA-123', 'Cambio de aceite y filtro', 3000, 90, 15500, '2026-09-10', 'Taller Motos Surco', [['Aceite 20W-50 1 L', 1, 38], ['Filtro de aceite', 1, 22]], 25],
            ['MTA-123', 'Ajuste de cadena y frenos', 1500, null, 17200, '2026-09-29', 'Taller Motos Surco', [['Pastillas de freno', 1, 45]], 30],
            ['MTB-456', 'Cambio de aceite y filtro', 3000, 90, 22400, '2026-09-05', 'Taller Motos Surco', [['Aceite 20W-50 1 L', 1, 38], ['Filtro de aceite', 1, 22]], 25],
            ['BXR-871', 'Cambio de aceite y filtros', 5000, 120, 60000, '2026-08-10', 'Inversiones Los Próceres', [['Aceite 15W-40 6 L', 1, 210], ['Filtro de aceite', 1, 48], ['Filtro de aire', 1, 65]], 120],
            ['BXR-871', 'Mantenimiento del equipo de frío', null, 90, 61500, '2026-08-25', 'Frío Total', [['Gas refrigerante R-404A', 1, 180]], 220],
            ['MTC-789', 'Revisión general (proveedor)', 3000, null, 7500, '2026-09-08', 'Taller Motos Surco', [], 0],
        ];
        foreach ($planes as [$placa, $tarea, $cadaKm, $cadaDias, $km, $fecha, $taller, $partes, $mo]) {
            $v = $veh[$placa] ?? null;
            if (! $v) {
                continue;
            }
            // El km del servicio es el del odómetro ese día (la última lectura hasta esa noche), para que nunca baje.
            $leido = DB::table('vehicle_odometer_readings')->where('vehicle_id', $v->id)->where('read_at', '<=', $fecha.' 23:59:59-05')->max('km');
            $km = $leido !== null ? (float) $leido : $km;
            $pid = $this->ins('vehicle_maintenance_plans', ['code' => $this->num('PM', 3), 'vehicle_id' => $v->id, 'task' => $tarea, 'interval_km' => $cadaKm, 'interval_days' => $cadaDias,
                'last_done_km' => $km, 'last_done_on' => $fecha, 'next_due_km' => $cadaKm ? $km + $cadaKm : null,
                'next_due_on' => $cadaDias ? CarbonImmutable::parse($fecha)->addDays($cadaDias)->toDateString() : null, 'status' => 'ACTIVE']);
            if ($fecha < '2026-09-01') {
                continue;   // hecho antes de que FLO llevara registro
            }
            $p = round(array_sum(array_map(fn ($x) => $x[1] * $x[2], $partes)), 2);
            $this->ins('vehicle_maintenances', ['number' => $this->num('MV', 4), 'vehicle_id' => $v->id, 'plan_id' => $pid, 'kind' => 'PREVENTIVE', 'description' => $tarea,
                'workshop_supplier_id' => $sup[$taller] ?? null, 'workshop_name' => $taller, 'opened_on' => $fecha, 'in_workshop' => false, 'due_km' => $cadaKm ? $km : null,
                'odometer_km' => $km, 'done_on' => $fecha, 'days_out_of_service' => 0,
                'parts' => json_encode(array_map(fn ($x) => ['description' => $x[0], 'qty' => $x[1], 'unit_cost' => $x[2]], $partes), JSON_UNESCAPED_UNICODE),
                'parts_amount' => $p, 'labor_amount' => $mo, 'total_amount' => $p + $mo, 'doc_type' => ($p + $mo) > 0 ? 'INVOICE' : null,
                'doc_number' => ($p + $mo) > 0 ? 'F001-'.mt_rand(1000, 9999) : null, 'on_time' => true, 'status' => 'DONE', 'opened_by' => $coord, 'closed_by' => $coord]);
            $this->lectura($v->id, CarbonImmutable::parse($fecha.' 19:30', 'America/Lima'), $km, 'MAINTENANCE', null, $coord);
        }
        // Correctivo: llanta trasera de MOT-02.
        if (isset($veh['MTB-456'])) {
            $this->ins('vehicle_maintenances', ['number' => $this->num('MV', 4), 'vehicle_id' => $veh['MTB-456']->id, 'kind' => 'CORRECTIVE', 'description' => 'Cambio de llanta trasera (pinchazo con corte lateral)',
                'workshop_supplier_id' => $sup['Taller Motos Surco'] ?? null, 'workshop_name' => 'Taller Motos Surco', 'opened_on' => '2026-09-17', 'in_workshop' => true,
                'odometer_km' => (float) $veh['MTB-456']->odometer_km, 'done_on' => '2026-09-18', 'days_out_of_service' => 1,
                'parts' => json_encode([['description' => 'Llanta 130/70-17', 'qty' => 1, 'unit_cost' => 165], ['description' => 'Cámara', 'qty' => 1, 'unit_cost' => 25]], JSON_UNESCAPED_UNICODE),
                'parts_amount' => 190, 'labor_amount' => 20, 'total_amount' => 210, 'doc_type' => 'INVOICE', 'doc_number' => 'F001-3321', 'status' => 'DONE', 'opened_by' => $coord, 'closed_by' => $coord]);
        }
    }

    /** La jornada abierta de hoy de las tres unidades que salen (si ya pasaron las 08:20). */
    private function hoy($veh, $u, ?string $coord): void
    {
        $this->hoy = [];
        $ini = $this->ahora->setTime(8, 10);
        if ($this->ahora->dayOfWeek === 0 || $this->ahora->lessThan($ini->addMinutes(10))) {
            return;
        }
        foreach (['MTA-123' => 'pcondori', 'BXR-871' => 'hticona', 'MTC-789' => 'jchoque'] as $placa => $quien) {
            $v = $veh[$placa] ?? null;
            if (! $v || empty($u[$quien])) {
                continue;
            }
            $empleado = $u[$quien]->employee_id;
            $id = $this->ins('vehicle_trips', [
                'number' => $this->num('JR', 6), 'vehicle_id' => $v->id, 'driver_user_id' => $u[$quien]->id, 'driver_employee_id' => $empleado, 'establishment_id' => $v->establishment_id,
                'trip_date' => $this->ahora->toDateString(), 'status' => 'OPEN', 'source' => 'APP', 'started_at' => $ini->addMinutes(mt_rand(0, 9)), 'odometer_start' => (float) $v->odometer_km,
                'checklist_start' => json_encode(['lights' => true, 'tires' => true, 'brakes' => true, 'thermal_box' => true, 'documents' => true]), 'created_by' => $u[$quien]->id,
            ]);
            $t = DB::table('vehicle_trips')->where('id', $id)->first();
            $this->lectura($v->id, CarbonImmutable::parse($t->started_at), (float) $v->odometer_km, 'TRIP_START', $id, $u[$quien]->id);
            $tramos = [];
            foreach ([[8, 35, 9, 55], [12, 35, 14, 0], [16, 35, 17, 55]] as $k => [$h0, $m0, $h1, $m1]) {
                $tramos[] = ['departed_at' => $this->ahora->setTime($h0, $m0), 'returned_at' => $this->ahora->setTime($h1, $m1), 'km' => $placa === 'MTC-789' ? 34 : 21];
            }
            $this->hoy[] = ['id' => $id, 'vehicle_id' => $v->id, 'plate' => $placa, 'fecha' => $this->ahora->toDateString(), 'ini' => CarbonImmutable::parse($t->started_at),
                'fin' => $this->ahora, 'local' => $v->establishment_id, 'tramos' => $tramos, 'abierta' => true, 'empleado' => $empleado];
        }
    }

    private array $hoy = [];

    /** Posiciones cada 30 s (en ruta) y cada 5 min (en el local) de los últimos 3 días con rutas y de hoy; temperatura del furgón. */
    private function gps($veh, array $jornadas): void
    {
        $locales = DB::table('establishments')->where('tenant_id', $this->t)->get(['id', 'lat', 'lng'])->keyBy('id');
        $fechas = collect($jornadas)->pluck('fecha')->unique()->sort()->values()->slice(-3)->values()->all();
        $lista = [];
        foreach ($jornadas as $j) {
            if (in_array($j['fecha'], $fechas, true)) {
                $j['tramos'] = array_map(fn ($r) => ['departed_at' => CarbonImmutable::parse($r->departed_at)->setTimezone('America/Lima'),
                    'returned_at' => CarbonImmutable::parse($r->returned_at ?? $r->departed_at)->setTimezone('America/Lima'),
                    'km' => max(1, (float) $r->odometer_end - (float) $r->odometer_start)], $j['rutas']);
                $lista[] = $j;
            }
        }
        $lista = array_merge($lista, $this->hoy);
        foreach ($lista as $j) {
            $loc = $locales[$j['local']] ?? $locales->first();
            [$la0, $lo0] = [(float) $loc->lat, (float) $loc->lng];
            $filas = [];
            $gpsKm = 0;
            $t = $j['ini'];
            $hasta = ($j['abierta'] ?? false) ? $this->ahora->subMinutes(1) : $j['fin'];
            $exceso = $j['plate'] === 'MTC-789' && $j['fecha'] === end($fechas);
            foreach ($j['tramos'] as $k => $r) {
                // En el local hasta la salida: un punto cada 5 min
                for (; $t->lessThan($r['departed_at']) && $t->lessThanOrEqualTo($hasta); $t = $t->addMinutes(5)) {
                    $filas[] = $this->punto($j, $t, $la0 + $this->r(-0.00005, 0.00005), $lo0 + $this->r(-0.00005, 0.00005), 0);
                }
                $t = $t->max($r['departed_at']);
                $camino = $this->camino($la0, $lo0, $r['km'], mt_rand(5, 9));
                $pasos = max(2, intdiv((int) $t->diffInSeconds($r['returned_at']->max($t->addMinutes(10))), 30));
                $total = array_sum(array_column($camino, 2));
                for ($s = 0; $s <= $pasos && $t->lessThanOrEqualTo($hasta); $s++, $t = $t->addSeconds(30)) {
                    $f = $s / $pasos;
                    [$la, $lo, $vel] = $this->en($camino, $f * $total, $r['km'] / max(1, $r['departed_at']->diffInMinutes($r['returned_at'])) * 60 * 1.6);
                    if ($exceso && $k === 1 && $s >= 20 && $s < 25) {
                        $vel = round($this->r(88, 94), 1);
                    }
                    $filas[] = $this->punto($j, $t, $la, $lo, $vel);
                }
                $gpsKm += $r['km'];
                $t = $t->max($r['returned_at'])->addSeconds(30);
            }
            for (; $t->lessThanOrEqualTo($hasta); $t = $t->addMinutes(5)) {
                $filas[] = $this->punto($j, $t, $la0, $lo0, 0);
            }
            $filas = collect($filas)->unique(fn ($f) => $f['recorded_at']->format('U'))->values()->all();
            $this->lote('vehicle_positions', $filas);
            if ($exceso) {
                $p = collect($filas)->where('speed_kmh', '>', 80)->values();
                if ($p->count()) {
                    $this->ins('fleet_alerts', ['number' => $this->num('AF', 5), 'alert_type' => 'SPEED', 'vehicle_id' => $j['vehicle_id'], 'employee_id' => $j['empleado'],
                        'origin' => 'trip:'.$j['id'], 'title' => 'Exceso de velocidad '.number_format($p->max('speed_kmh'), 0)." km/h · {$j['plate']}", 'severity' => 'bad',
                        'detail' => 'RN-FLO-19: más de 80 km/h por '.round($p->count() * 0.5, 1).' min desde las '.$p->first()['recorded_at']->format('H:i').' en la Panamericana Sur.',
                        'first_at' => $p->first()['recorded_at'], 'last_at' => $p->last()['recorded_at'], 'episode_start' => $p->first()['recorded_at'], 'max_value' => $p->max('speed_kmh'),
                        'occurrences' => 1, 'status' => 'OPEN']);
                }
            }
            if ($j['plate'] === 'BXR-871') {
                $this->temperaturas($veh['BXR-871'], $j, $hasta, $fechas);
            }
        }
    }

    private function punto(array $j, CarbonImmutable $t, float $la, float $lo, float $vel): array
    {
        return ['id' => (string) Uuid::uuid4(), 'vehicle_id' => $j['vehicle_id'], 'trip_id' => $j['id'], 'recorded_at' => $t, 'lat' => round($la, 7), 'lng' => round($lo, 7),
            'speed_kmh' => round($vel, 1), 'heading' => mt_rand(0, 359), 'accuracy_m' => mt_rand(4, 18), 'source' => 'APP', 'received_at' => $t->addSeconds(mt_rand(1, 6)), 'created_at' => $t];
    }

    /** Recorrido de ida y vuelta al local por $n puntos, escalado para medir $km. Cada punto: [lat, lng, km del tramo]. */
    private function camino(float $la0, float $lo0, float $km, int $n): array
    {
        $pts = [[$la0, $lo0]];
        $ang = $this->r(0, 2 * M_PI);
        for ($i = 0; $i < $n; $i++) {
            $ang += $this->r(-0.9, 0.9);
            $d = $this->r(0.4, 1.0);
            $pts[] = [$pts[$i][0] + cos($ang) * $d, $pts[$i][1] + sin($ang) * $d];
        }
        $pts[] = [$la0, $lo0];
        $largo = 0;
        for ($i = 1; $i < count($pts); $i++) {
            $largo += hypot($pts[$i][0] - $pts[$i - 1][0], $pts[$i][1] - $pts[$i - 1][1]);
        }
        $escala = $km / max(0.001, $largo);   // unidades → km
        $out = [[$la0, $lo0, 0]];
        for ($i = 1; $i < count($pts); $i++) {
            $la = $la0 + ($pts[$i][0] - $la0) * $escala / 111.0;
            $lo = $lo0 + ($pts[$i][1] - $lo0) * $escala / 108.5;
            $out[] = [$la, $lo, hypot($pts[$i][0] - $pts[$i - 1][0], $pts[$i][1] - $pts[$i - 1][1]) * $escala];
        }

        return $out;
    }

    /** Punto a $d km del inicio del camino, con una velocidad cercana a la media (detenido en las paradas). */
    private function en(array $camino, float $d, float $media): array
    {
        $acum = 0;
        for ($i = 1; $i < count($camino); $i++) {
            $tramo = $camino[$i][2];
            if ($acum + $tramo >= $d || $i === count($camino) - 1) {
                $f = $tramo > 0 ? min(1, max(0, ($d - $acum) / $tramo)) : 1;
                $cerca = $f < 0.04 || $f > 0.96;

                return [$camino[$i - 1][0] + ($camino[$i][0] - $camino[$i - 1][0]) * $f, $camino[$i - 1][1] + ($camino[$i][1] - $camino[$i - 1][1]) * $f,
                    $cerca ? $this->r(0, 4) : min(70, max(8, $media * $this->r(0.6, 1.3)))];
            }
            $acum += $tramo;
        }

        return [$camino[0][0], $camino[0][1], 0];
    }

    /** Lecturas del furgón cada 5 min; el penúltimo día de la muestra, 25 min sobre 4 °C a media mañana. */
    private function temperaturas(object $v, array $j, CarbonImmutable $hasta, array $fechas): void
    {
        $exc = count($fechas) >= 2 && $j['fecha'] === $fechas[count($fechas) - 2] && empty($j['abierta']);
        $x0 = $j['ini']->setTime(10, 50);
        $filas = [];
        $temp = 2.4;
        for ($t = $j['ini']; $t->lessThanOrEqualTo($hasta); $t = $t->addMinutes(5)) {
            $dentro = $exc && $t->greaterThanOrEqualTo($x0) && $t->lessThan($x0->addMinutes(30));
            $temp = $dentro ? round($this->r(5.1, 6.8), 1) : round(min(3.8, max(0.8, $temp + $this->r(-0.4, 0.4))), 1);
            $filas[] = ['id' => (string) Uuid::uuid4(), 'vehicle_id' => $v->id, 'trip_id' => $j['id'], 'read_at' => $t, 'temp_c' => $temp, 'in_range' => $temp >= 0 && $temp <= 4,
                'range_min' => 0, 'range_max' => 4, 'sensor_id' => 'TERMO-FUR01', 'source' => 'SENSOR', 'created_at' => $t];
        }
        $this->lote('vehicle_temperature_readings', $filas);
        if (! $exc) {
            return;
        }
        $fuera = collect($filas)->where('in_range', false)->values();
        $pedidos = DB::table('delivery_stops as s')->join('sales_orders as o', 'o.id', '=', 's.order_id')->whereIn('s.route_id', array_map(fn ($r) => $r->id, $j['rutas']))
            ->whereNotIn('s.status', ['CANCELLED', 'RESCHEDULED'])->where(fn ($w) => $w->whereNull('s.closed_at')->orWhere('s.closed_at', '>=', $fuera->first()['read_at']))
            ->orderBy('o.number')->get(['o.id', 'o.number']);
        $rev = [];
        foreach ($pedidos as $i => $o) {
            $rev[] = $i === 0
                ? ['order_id' => $o->id, 'number' => $o->number, 'status' => 'RELEASED', 'decided_by' => DB::table('users')->where('email', 'sramos@donguando.pe')->value('name'),
                    'decided_at' => $j['fin']->toIso8601String(), 'note' => 'Producto entregado antes de la excursión: termómetro del cliente en 3 °C.']
                : ['order_id' => $o->id, 'number' => $o->number, 'status' => 'PENDING', 'decided_by' => null, 'decided_at' => null, 'note' => null];
        }
        $min = $fuera->count() * 5;
        $this->ins('fleet_alerts', ['number' => $this->num('AF', 5), 'alert_type' => 'TEMPERATURE', 'vehicle_id' => $v->id, 'employee_id' => $j['empleado'], 'origin' => 'trip:'.$j['id'],
            'title' => "Temperatura fuera de rango {$min} min · BXR-871", 'severity' => 'bad',
            'detail' => 'RN-FLO-14: '.number_format($fuera->min('temp_c'), 1, ',', '.').' a '.number_format($fuera->max('temp_c'), 1, ',', '.').' °C desde las '.$fuera->first()['read_at']->format('H:i')
                .' (rango 0 a 4 °C, límite 15 min). '.count($rev).' pedido(s) de la ruta pasan a revisión de calidad.',
            'first_at' => $fuera->last()['read_at'], 'last_at' => $fuera->last()['read_at'], 'excursion_start' => $fuera->first()['read_at'], 'excursion_minutes' => $min,
            'max_value' => $fuera->max('temp_c'), 'status' => 'OPEN', 'order_reviews' => json_encode($rev, JSON_UNESCAPED_UNICODE)]);
    }

    private function multasYCostos($veh, $u, $sup, ?string $coord): void
    {
        $emp = fn ($q) => $u[$q]->employee_id ?? null;
        $uid = fn ($q) => $u[$q]->id ?? null;
        if (isset($veh['MTA-123'])) {
            $this->ins('traffic_fines', ['ballot_number' => 'SAT-0458712', 'fine_date' => '2026-09-18', 'entity' => 'SAT', 'infraction_code' => 'G58', 'infraction' => 'Estacionar en zona prohibida o rígida',
                'vehicle_id' => $veh['MTA-123']->id, 'driver_user_id' => $uid('pcondori'), 'employee_id' => $emp('pcondori'), 'amount' => 220, 'early_discount_pct' => 83,
                'early_discount_until' => '2026-09-25', 'discount_amount' => 182.6, 'paid_amount' => 37.4, 'paid_on' => '2026-09-22', 'status' => 'PAID', 'created_by' => $coord,
                'notes' => 'Pagada con descuento por pronto pago.']);
        }
        if (isset($veh['MTC-789'])) {
            $this->ins('traffic_fines', ['ballot_number' => 'PNP-2026-118844', 'fine_date' => '2026-10-10', 'entity' => 'PNP', 'infraction_code' => 'M20', 'infraction' => 'Exceder la velocidad máxima permitida',
                'vehicle_id' => $veh['MTC-789']->id, 'driver_user_id' => $uid('jchoque'), 'employee_id' => $emp('jchoque'), 'amount' => 462, 'early_discount_pct' => 0,
                'status' => 'PENDING', 'created_by' => $coord, 'notes' => 'Coincide con la alerta de exceso de velocidad del 10/10.']);
        }
        if (isset($veh['BXR-871'])) {
            $this->ins('traffic_fines', ['ballot_number' => 'ATU-77120', 'fine_date' => '2026-09-25', 'entity' => 'ATU', 'infraction_code' => 'G40', 'infraction' => 'Carga y descarga fuera del horario permitido',
                'vehicle_id' => $veh['BXR-871']->id, 'driver_user_id' => $uid('hticona'), 'employee_id' => $emp('hticona'), 'amount' => 330, 'status' => 'APPEALED', 'created_by' => $coord,
                'appeal_note' => 'El cliente tiene permiso municipal de carga en ese horario; se presentó el descargo.']);
        }
        $costos = [];
        foreach (['2026-09-01', '2026-10-01'] as $mes) {
            $dias = $mes === '2026-09-01' ? 26 : 9;
            foreach (['MTC-789' => 45, 'BKZ-512' => 90] as $placa => $tarifa) {
                if (isset($veh[$placa]) && ($placa === 'MTC-789' || $mes === '2026-09-01')) {
                    $d = $placa === 'BKZ-512' ? 4 : $dias;   // el auto se usó 4 días de septiembre como refuerzo
                    $costos[] = [$placa, 'RENT', CarbonImmutable::parse($mes)->endOfMonth()->min(CarbonImmutable::parse('2026-10-10'))->toDateString(), $mes, $d * $tarifa,
                        $veh[$placa]->provider_id, 'INVOICE', 'E001-'.mt_rand(100, 999), "Alquiler {$d} días × S/ {$tarifa}"];
                }
            }
            if (isset($veh['BXR-871'])) {
                $costos[] = ['BXR-871', 'TOLL', CarbonImmutable::parse($mes)->addDays(14)->toDateString(), $mes, $mes === '2026-09-01' ? 86.4 : 32.4, $sup['Peaje Panamericana Sur'] ?? null, 'TICKET', null, 'Peajes Lurín – Surco del mes'];
                $costos[] = ['BXR-871', 'PARKING', CarbonImmutable::parse($mes)->addDays(4)->toDateString(), $mes, 120, null, 'SIMPLE_RECEIPT', null, 'Cochera nocturna'];
                $costos[] = ['BXR-871', 'WASH', CarbonImmutable::parse($mes)->addDays(7)->toDateString(), $mes, 35, null, 'SIMPLE_RECEIPT', null, 'Lavado y desinfección de la caja'];
            }
        }
        if (isset($veh['MTA-123'])) {
            $costos[] = ['MTA-123', 'INSURANCE', '2026-09-05', '2026-09-01', 45, null, 'INVOICE', 'F005-11871', 'Seguro contra robo (cuota mensual)'];
            $costos[] = ['MTA-123', 'INSURANCE', '2026-10-05', '2026-10-01', 45, null, 'INVOICE', 'F005-12406', 'Seguro contra robo (cuota mensual)'];
        }
        foreach ($costos as [$placa, $tipo, $fecha, $mes, $monto, $prov, $doc, $nro, $nota]) {
            $this->ins('vehicle_costs', ['vehicle_id' => $veh[$placa]->id, 'cost_type' => $tipo, 'cost_date' => $fecha, 'period' => $mes, 'amount' => $monto, 'supplier_id' => $prov,
                'doc_type' => $doc, 'doc_number' => $nro, 'notes' => $nota, 'status' => 'ACTIVE', 'created_by' => $coord]);
        }
    }
}
