<?php

namespace Tests\Feature\Modulos;

use App\Models\User;
use App\Modulos\Flo\Services\Costos;
use App\Modulos\Flo\Services\Mantenimiento;
use App\Support\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/** FLO · Flota avanzada: un test por criterio CA-FLO-01 a CA-FLO-09 y las reglas que los rodean (RN-FLO-01 a RN-FLO-20). */
class FloTest extends TestCase
{
    private array $tokens = [];

    private CarbonImmutable $hoy;

    protected function setUp(): void
    {
        parent::setUp();
        // Mañana a las 10:00 (la demo deja jornadas abiertas «hoy»; se cancelan para empezar limpio).
        $this->hoy = CarbonImmutable::now('America/Lima')->addDay()->setTime(10, 0);
        $this->travelTo(Carbon::parse($this->hoy));
        $this->contexto();
        DB::table('vehicle_trips')->whereIn('status', ['OPEN', 'PLANNED'])->update(['status' => 'CANCELLED']);
        // Documentos al día para las unidades que se usan (las fechas de la demo vencen con el tiempo).
        $vence = $this->hoy->addYear()->toDateString();
        foreach (['MTA-123', 'MTC-789', 'BXR-871'] as $placa) {
            $id = $this->vehiculo($placa);
            DB::table('vehicles')->where('id', $id)->update(['soat_expires_on' => $vence, 'tech_inspection_expires_on' => $vence]);
            DB::table('vehicle_documents')->where('vehicle_id', $id)->whereIn('doc_type', ['SOAT', 'TECH_INSPECTION'])->where('status', 'ACTIVE')->update(['expires_on' => $vence]);
        }
        DB::table('vehicle_documents')->where('doc_type', 'DRIVER_LICENSE')->where('number', '<>', 'Q42210954')->update(['expires_on' => $vence]);   // Ronald sigue vencido
        DB::table('vehicle_maintenance_plans')->update(['next_due_km' => DB::raw('CASE WHEN next_due_km IS NULL THEN NULL ELSE next_due_km + 50000 END'),
            'next_due_on' => DB::raw("CASE WHEN next_due_on IS NULL THEN NULL ELSE next_due_on + 365 END")]);
        TenantContext::set(null);
    }

    private function como(string $email): static
    {
        return $this->desde(self::DG, $this->tokens[$email] ??= $this->ingresar(self::DG, $email));
    }

    private function gerente(): static
    {
        return $this->como('rquispe@donguando.pe');
    }

    private function coordinador(): static
    {
        return $this->como('rchavez@donguando.pe');
    }

    private function pedro(): static
    {
        return $this->como('pcondori@donguando.pe');
    }

    private function contexto(): void
    {
        $t = DB::selectOne('SELECT auth_tenants_for_email(?) AS t', ['rquispe@donguando.pe'])->t;
        TenantContext::set(TenantContext::find($t));
        TenantContext::setUser(DB::table('users')->where('email', 'rquispe@donguando.pe')->value('id'));
    }

    private function usuario(string $email, string $col = 'id'): ?string
    {
        $this->contexto();
        $v = DB::table('users')->where('email', $email)->value($col);
        TenantContext::set(null);

        return $v;
    }

    private function vehiculo(string $placa): string
    {
        return (string) DB::table('vehicles')->where('plate', $placa)->value('id');
    }

    private function odometro(string $placa): float
    {
        return (float) $this->coordinador()->getJson('/api/v1/flo/cargas/previa?vehicle_id='.$this->vehiculoConContexto($placa))->assertOk()->json('odometro');
    }

    private function vehiculoConContexto(string $placa): string
    {
        $this->contexto();
        $id = $this->vehiculo($placa);
        TenantContext::set(null);

        return $id;
    }

    private function carga(string $placa, float $km, float $gal, string $hora, array $extra = []): \Illuminate\Testing\TestResponse
    {
        return $this->coordinador()->postJson('/api/v1/flo/cargas', $extra + ['vehicle_id' => $this->vehiculoConContexto($placa), 'loaded_at' => $this->hoy->setTimeFromTimeString($hora)->toIso8601String(),
            'odometer_km' => $km, 'gallons' => $gal, 'price_per_gal' => 17.5, 'full_tank' => true, 'station_name' => 'Grifo de prueba']);
    }

    private function pdf(string $nombre): UploadedFile
    {
        return UploadedFile::fake()->createWithContent($nombre, "%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF ".$nombre);
    }

    private function checklist(): array
    {
        return ['lights' => true, 'tires' => true, 'brakes' => true, 'thermal_box' => true, 'documents' => true];
    }

    private function iniciar(string $quien, string $placa, float $km): \Illuminate\Testing\TestResponse
    {
        return $this->como($quien)->post('/api/v1/flo/jornadas', ['vehicle_id' => $this->vehiculoConContexto($placa), 'odometer' => $km, 'checklist' => $this->checklist(),
            'foto' => UploadedFile::fake()->image('tablero.jpg', 40, 40)], ['Accept' => 'application/json']);
    }

    /** CA-FLO-01: MOT-01 (70 km/gal), tanque lleno de 2,5 gal a 120 km de la carga llena anterior → 48 km/gal y alerta (48 < 59,5). */
    public function test_ca_flo_01_rendimiento_bajo_genera_alerta(): void
    {
        $km = $this->odometro('MTA-123');
        $this->carga('MTA-123', $km + 10, 2.0, '07:00')->assertCreated()->assertJsonPath('source', 'WEB');
        $r = $this->carga('MTA-123', $km + 130, 2.5, '09:00')->assertCreated()->json();
        $this->assertEquals(120.0, (float) $r['km_since_full']);
        $this->assertEquals(48.0, (float) $r['km_per_gal']);
        $this->assertSame('LOW', $r['efficiency_status']);
        $a = collect($this->coordinador()->getJson('/api/v1/flo/alertas?tipo=FUEL_EFFICIENCY')->assertOk()->json('data'))
            ->firstWhere('vehicle_id', $this->vehiculoConContexto('MTA-123'));
        $this->assertNotNull($a);
        $this->assertNotSame('CLOSED', $a['status']);
        $this->assertStringContainsString('48', $a['title']);
        // Sin tanque lleno no se calcula: la carga parcial queda «sin dato».
        $this->carga('MTA-123', $km + 150, 0.5, '09:30', ['full_tank' => false])->assertCreated()->assertJsonPath('efficiency_status', 'NA');
    }

    /** CA-FLO-02: última lectura 15 350 km; una carga a 15 200 km se rechaza (RN-FLO-04). */
    public function test_ca_flo_02_odometro_no_baja(): void
    {
        $km = $this->odometro('MTA-123');
        $this->carga('MTA-123', $km + 100, 1.5, '07:00')->assertCreated();
        $this->carga('MTA-123', $km - 50, 1.0, '08:00')->assertUnprocessable()->assertJsonPath('code', 'RN-FLO-04');
        // El cambio de tablero (solo gerencia, con motivo) es la única forma de bajar el odómetro.
        $id = $this->vehiculoConContexto('MTA-123');
        $this->coordinador()->postJson("/api/v1/flo/vehiculos/{$id}/cambio-tablero", ['km' => 120, 'reason' => 'Cambio de tablero en el taller'])->assertForbidden();
        $this->gerente()->postJson("/api/v1/flo/vehiculos/{$id}/cambio-tablero", ['km' => 120, 'reason' => 'corto'])->assertUnprocessable();
        $this->gerente()->postJson("/api/v1/flo/vehiculos/{$id}/cambio-tablero", ['km' => 120, 'reason' => 'Tablero nuevo instalado por Taller Motos Surco'])->assertOk();
        $this->travel(2)->minutes();
        $this->carga('MTA-123', 150, 1.0, '10:01')->assertCreated();
    }

    /** CA-FLO-03: «aceite cada 3 000 km o 90 días» cerrado a 12 000 km el 01/09/2026 → próximo 15 000 km o 30/11/2026; aviso a 14 500 km. */
    public function test_ca_flo_03_plan_de_mantenimiento(): void
    {
        $plan = (object) ['interval_km' => 3000, 'interval_days' => 90, 'last_done_km' => 12000, 'last_done_on' => '2026-09-01', 'next_due_km' => 15000, 'next_due_on' => '2026-11-30', 'status' => 'ACTIVE'];
        $this->contexto();
        $e = Mantenimiento::estado($plan, 14400, '2026-11-01');
        $this->assertSame('OK', $e['estado']);
        $this->assertEquals(14500, $e['aviso_km']);
        $this->assertSame('DUE_SOON', Mantenimiento::estado($plan, 14500, '2026-11-01')['estado']);
        $this->assertSame('DUE_SOON', Mantenimiento::estado($plan, 13000, '2026-11-23')['estado']);   // 7 días antes del 30/11
        $this->assertSame('OVERDUE', Mantenimiento::estado($plan, 15200, '2026-11-01')['estado']);
        $this->assertSame('OVERDUE_BLOCK', Mantenimiento::estado($plan, 16001, '2026-11-01')['estado']);
        TenantContext::set(null);

        // De punta a punta: el plan nace, la orden preventiva se cierra con el km del servicio y el plan avanza (RN-FLO-10).
        $vid = $this->vehiculoConContexto('MTC-789');
        $km = $this->odometro('MTC-789');
        $p = $this->coordinador()->postJson('/api/v1/flo/planes', ['vehicle_id' => $vid, 'task' => 'Cambio de aceite', 'interval_km' => 3000, 'interval_days' => 90])->assertCreated()->json();
        $o = $this->coordinador()->postJson('/api/v1/flo/ordenes', ['vehicle_id' => $vid, 'kind' => 'PREVENTIVE', 'plan_id' => $p['id'], 'in_workshop' => false])->assertCreated()->json();
        $this->coordinador()->postJson('/api/v1/flo/ordenes', ['vehicle_id' => $vid, 'kind' => 'PREVENTIVE'])->assertUnprocessable();
        $this->coordinador()->postJson("/api/v1/flo/ordenes/{$o['id']}/cerrar", ['odometer_km' => $km - 10, 'done_on' => $this->hoy->toDateString()])
            ->assertUnprocessable()->assertJsonPath('code', 'RN-FLO-04');
        $c = $this->coordinador()->postJson("/api/v1/flo/ordenes/{$o['id']}/cerrar", ['odometer_km' => $km + 5, 'done_on' => $this->hoy->toDateString(), 'labor_amount' => 25,
            'parts' => [['description' => 'Aceite 1 L', 'qty' => 1, 'unit_cost' => 38], ['description' => 'Filtro', 'qty' => 1, 'unit_cost' => 22]]])->assertOk()->json();
        $this->assertEquals(85.0, (float) $c['total_amount']);
        $this->assertSame('DONE', $c['status']);
        $plan = collect($this->coordinador()->getJson("/api/v1/flo/planes?vehiculo={$vid}")->assertOk()->json('data'))->firstWhere('id', $p['id']);
        $this->assertEquals($km + 5 + 3000, (float) $plan['next_due_km']);
        $this->assertSame($this->hoy->addDays(90)->toDateString(), substr($plan['next_due_on'], 0, 10));
    }

    /** CA-FLO-04: un auto con SOAT vencido el 05/10/2026 asignado a una ruta del 10/10 se rechaza (RN-FLO-11). */
    public function test_ca_flo_04_vehiculo_no_operable(): void
    {
        $this->contexto();
        $u = User::where('email', 'rchavez@donguando.pe')->first();
        $v = DB::table('vehicles')->where('plate', 'BKZ-512')->first();
        $motivos = \App\Modulos\Flo\Services\Operable::motivos($v, '2026-10-10');
        $this->assertSame(['SOAT'], array_column($motivos, 'tipo'));
        $this->assertStringContainsString('05/10/2026', $motivos[0]['msg']);
        try {
            \App\Modulos\Flo\Services\Operable::paraDel($v->id, '2026-10-10', $u);
            $this->fail('Debió rechazar el vehículo');
        } catch (\App\Support\RuleError $e) {
            $this->assertSame('RN-FLO-11', $e->rule);
        }
        $this->assertSame([], \App\Modulos\Flo\Services\Operable::motivos($v, '2026-10-04'));
        TenantContext::set(null);

        // Programar desde la ficha también lo revisa; y un mantenimiento vencido por más de 1 000 km bloquea.
        $bkz = $this->vehiculoConContexto('BKZ-512');
        $this->coordinador()->postJson("/api/v1/flo/vehiculos/{$bkz}/programar", ['date' => $this->hoy->toDateString()])->assertUnprocessable()->assertJsonPath('code', 'RN-FLO-11');
        $mta = $this->vehiculoConContexto('MTA-123');
        $km = $this->odometro('MTA-123');
        $this->coordinador()->postJson('/api/v1/flo/planes', ['vehicle_id' => $mta, 'task' => 'Kit de arrastre', 'interval_km' => 1000, 'last_done_km' => $km - 2100,
            'last_done_on' => $this->hoy->subMonths(2)->toDateString()])->assertCreated()->assertJsonPath('estado.estado', 'OVERDUE_BLOCK');
        $this->coordinador()->postJson("/api/v1/flo/vehiculos/{$mta}/programar", ['date' => $this->hoy->toDateString(), 'driver_user_id' => $this->usuario('pcondori@donguando.pe', 'id')])
            ->assertUnprocessable()->assertJsonPath('code', 'RN-FLO-11');
        $this->iniciar('pcondori@donguando.pe', 'MTA-123', $km + 1)->assertUnprocessable()->assertJsonPath('code', 'RN-FLO-11');
    }

    /** CA-FLO-05: furgón refrigerado (0 a 4 °C) a 6 °C por 20 minutos → alerta y los pedidos de su ruta pasan a revisión. */
    public function test_ca_flo_05_cadena_de_frio(): void
    {
        $vid = $this->vehiculoConContexto('BXR-871');
        // Una ruta del furgón para hoy con dos pedidos aún por entregar.
        $this->contexto();
        $ruta = DB::table('delivery_routes as r')->where('r.vehicle_id', $vid)->whereNotNull('r.returned_at')
            ->whereRaw('(SELECT count(*) FROM delivery_stops s WHERE s.route_id = r.id) >= 2')->orderByDesc('r.route_date')->first(['r.*']);
        DB::table('delivery_routes')->where('id', $ruta->id)->update(['route_date' => $this->hoy->toDateString(), 'status' => 'IN_ROUTE']);
        $paradas = DB::table('delivery_stops')->where('route_id', $ruta->id)->limit(2)->pluck('id');
        DB::table('delivery_stops')->where('route_id', $ruta->id)->whereNotIn('id', $paradas)->update(['status' => 'CANCELLED']);
        DB::table('delivery_stops')->whereIn('id', $paradas)->update(['status' => 'PENDING', 'closed_at' => null]);
        TenantContext::set(null);

        $km = $this->odometro('BXR-871');
        $t = $this->iniciar('hticona@donguando.pe', 'BXR-871', $km + 2)->assertCreated()->json();
        $this->assertSame($ruta->id, $t['route_id']);
        $lectura = fn (int $min, float $c) => $this->coordinador()->postJson('/api/v1/flo/temperatura', ['vehicle_id' => $vid, 'read_at' => $this->hoy->addMinutes($min)->toIso8601String(), 'temp_c' => $c]);
        $this->travel(40)->minutes();
        $this->tokens = [];   // la sesión vence a los 30 min sin uso
        $lectura(5, 3.1)->assertCreated()->assertJsonPath('lectura.in_range', true);
        $lectura(10, 6.0)->assertCreated()->assertJsonPath('alerta', null);
        $lectura(20, 6.0)->assertCreated()->assertJsonPath('alerta', null);    // 10 min: aún no pasa los 15
        $a = $lectura(30, 6.0)->assertCreated()->json('alerta');               // 20 min fuera de rango
        $this->assertSame('TEMPERATURE', $a['alert_type']);
        $this->assertSame('bad', $a['severity']);
        $this->assertCount(2, $a['order_reviews']);
        $this->assertSame(2, $a['pendientes']);
        // Lecturas de solo inserción: una repetida a la misma hora se rechaza.
        $lectura(30, 5.0)->assertUnprocessable()->assertJsonPath('code', 'RN-FLO-03');
        // No se cierra con pedidos por revisar; calidad libera o rechaza (con motivo).
        $this->coordinador()->postJson("/api/v1/flo/alertas/{$a['id']}/cerrar", ['resolution' => 'Se revisó el equipo'])->assertUnprocessable()->assertJsonPath('code', 'RN-FLO-14');
        $calidad = $this->como('sramos@donguando.pe');
        $calidad->getJson('/api/v1/flo/alertas')->assertOk();
        [$o1, $o2] = array_column($a['order_reviews'], 'order_id');
        $this->como('sramos@donguando.pe')->postJson("/api/v1/flo/alertas/{$a['id']}/pedidos", ['order_id' => $o1, 'decision' => 'RELEASED'])->assertOk()->assertJsonPath('pendientes', 1);
        $this->como('sramos@donguando.pe')->postJson("/api/v1/flo/alertas/{$a['id']}/pedidos", ['order_id' => $o2, 'decision' => 'REJECTED'])->assertUnprocessable();
        $this->como('sramos@donguando.pe')->postJson("/api/v1/flo/alertas/{$a['id']}/pedidos", ['order_id' => $o2, 'decision' => 'REJECTED', 'note' => 'Reposición al cliente'])->assertOk();
        $this->coordinador()->postJson("/api/v1/flo/alertas/{$a['id']}/cerrar", ['resolution' => 'Termostato regulado por Frío Total'])->assertOk()->assertJsonPath('status', 'CLOSED');
        // El repartidor no ve la bandeja de alertas.
        $this->pedro()->getJson('/api/v1/flo/alertas')->assertForbidden();
    }

    /** CA-FLO-06: moto propia con 600 + 150 + 90 + 160 + 1 500 en 2 500 km y 600 entregas → S/ 1,00 por km y S/ 4,17 por entrega. */
    public function test_ca_flo_06_costo_por_km_y_por_entrega(): void
    {
        $r = Costos::formula(['combustible' => 600, 'mantenimiento' => 150, 'multas' => 90, 'depreciacion' => 160, 'conductor' => 1500, 'km' => 2500, 'entregas' => 600]);
        $this->assertEquals(2500.0, $r['total']);
        $this->assertEquals(1.00, $r['por_km']);
        $this->assertEquals(4.17, $r['por_entrega']);

        // El tablero del mes (gerencia, administración y auditoría) con el comparativo contra tercero.
        $t = $this->gerente()->getJson('/api/v1/flo/tablero?mes=2026-09')->assertOk()->json();
        $mta = collect($t['filas'])->firstWhere('vehicle_id', $this->vehiculoConContexto('MTA-123'));
        $this->assertNotNull($mta);
        $this->assertGreaterThan(0, $mta['combustible']);
        $this->assertGreaterThan(1000, $mta['km']);
        $this->assertEqualsWithDelta($mta['total'] / $mta['km'], $mta['por_km'], 0.01);
        $this->como('aexterno@donguando.pe')->getJson('/api/v1/flo/tablero?mes=2026-09')->assertOk();
        $this->coordinador()->getJson('/api/v1/flo/tablero')->assertForbidden();
        $this->pedro()->getJson('/api/v1/flo/tablero')->assertForbidden();
        $this->gerente()->get('/api/v1/flo/tablero/exportar?mes=2026-09')->assertOk();
    }

    /** CA-FLO-07: una posición enviada sin jornada abierta se rechaza (RN-FLO-02); con jornada, un reenvío no duplica (RN-FLO-01). */
    public function test_ca_flo_07_posiciones_solo_en_jornada(): void
    {
        $vid = $this->vehiculoConContexto('MTA-123');
        $p = fn (int $s, float $vel = 25) => ['vehicle_id' => $vid, 'recorded_at' => $this->hoy->addSeconds($s)->toIso8601String(), 'lat' => -12.1385 + $s / 100000, 'lng' => -76.9905, 'speed_kmh' => $vel];
        $r = $this->pedro()->postJson('/api/v1/flo/posiciones', ['posiciones' => [$p(0)]])->assertOk()->json();
        $this->assertSame(0, $r['guardadas']);
        $this->assertSame('RN-FLO-02', $r['rechazadas'][0]['code']);

        $km = $this->odometro('MTA-123');
        $this->iniciar('pcondori@donguando.pe', 'MTA-123', $km + 1)->assertCreated()->assertJsonPath('status', 'OPEN');
        $this->iniciar('pcondori@donguando.pe', 'MTA-123', $km + 1)->assertUnprocessable()->assertJsonPath('code', 'RN-FLO-02');
        $this->travel(5)->minutes();
        $lote = [$p(30), $p(60), $p(90, 92), $p(120, 95), $p(150, 96), $p(180, 30)];
        $r = $this->pedro()->postJson('/api/v1/flo/posiciones', ['posiciones' => $lote])->assertOk()->json();
        $this->assertSame(6, $r['guardadas']);
        $r = $this->pedro()->postJson('/api/v1/flo/posiciones', ['posiciones' => array_slice($lote, 0, 2)])->assertOk()->json();
        $this->assertSame(2, $r['repetidas']);
        // Más de 80 km/h por más de 1 minuto → alerta de exceso (RN-FLO-19).
        $speed = collect($this->coordinador()->getJson('/api/v1/flo/alertas?tipo=SPEED')->assertOk()->json('data'))->firstWhere('vehicle_id', $vid);
        $this->assertNotNull($speed);
        // El mapa en vivo la muestra en jornada con su última posición.
        $m = collect($this->coordinador()->getJson('/api/v1/flo/mapa')->assertOk()->json('vehiculos'))->firstWhere('id', $vid);
        $this->assertNotNull($m['posicion']);
        $this->pedro()->getJson('/api/v1/flo/mapa')->assertForbidden();
        // Cierre con odómetro: km reales = final − inicial (RN-FLO-05).
        $t = $this->pedro()->getJson('/api/v1/flo/app')->assertOk()->json('jornada');
        $this->pedro()->postJson("/api/v1/flo/jornadas/{$t['id']}/cerrar", ['odometer' => $km - 5, 'checklist' => $this->checklist()])->assertUnprocessable();
        $c = $this->pedro()->post("/api/v1/flo/jornadas/{$t['id']}/cerrar", ['odometer' => $km + 41, 'checklist' => $this->checklist(),
            'foto' => UploadedFile::fake()->image('cierre.jpg', 40, 40)], ['Accept' => 'application/json'])->assertOk()->json();
        $this->assertSame('CLOSED', $c['status']);
        $this->assertEquals(40.0, (float) $c['km_odometer']);
        $this->travel(5)->minutes();
        $r = $this->pedro()->postJson('/api/v1/flo/posiciones', ['posiciones' => [['vehicle_id' => $vid, 'recorded_at' => now()->toIso8601String(), 'lat' => -12.1, 'lng' => -76.9]]])->assertOk()->json();
        $this->assertSame('RN-FLO-02', $r['rechazadas'][0]['code']);
    }

    /** CA-FLO-08: con tanque de 3 galones, una carga de 3,5 galones se rechaza (RN-FLO-08). */
    public function test_ca_flo_08_tope_del_tanque(): void
    {
        $km = $this->odometro('MTA-123');
        $this->carga('MTA-123', $km + 20, 3.5, '07:00')->assertUnprocessable()->assertJsonPath('code', 'RN-FLO-08');
        $this->carga('MTA-123', $km + 20, 3.15, '07:00')->assertCreated();     // 3 × 1,05 = 3,15 sí entra
        // El repartidor solo registra la carga de su jornada abierta.
        $this->pedro()->postJson('/api/v1/flo/cargas', ['vehicle_id' => $this->vehiculoConContexto('MTA-123'), 'odometer_km' => $km + 30, 'gallons' => 1, 'price_per_gal' => 17])
            ->assertUnprocessable()->assertJsonPath('code', 'RN-FLO-02');
        // Un vale no se registra dos veces.
        $this->carga('MTA-123', $km + 40, 0.5, '08:00', ['voucher_no' => 'V-7788', 'full_tank' => false])->assertCreated();
        $this->carga('MTA-123', $km + 45, 0.5, '08:30', ['voucher_no' => 'v-7788', 'full_tank' => false])->assertUnprocessable()->assertJsonPath('code', 'RN-FLO-17');
    }

    /** CA-FLO-09: un conductor con licencia vencida no inicia jornada (RN-FLO-12). */
    public function test_ca_flo_09_licencia_vencida(): void
    {
        $emp = $this->usuario('jchoque@donguando.pe', 'employee_id');
        $this->contexto();
        DB::table('vehicle_documents')->where('employee_id', $emp)->where('doc_type', 'DRIVER_LICENSE')->where('status', 'ACTIVE')->update(['expires_on' => $this->hoy->subDay()->toDateString()]);
        TenantContext::set(null);
        $km = $this->odometro('MTC-789');
        $this->iniciar('jchoque@donguando.pe', 'MTC-789', $km + 1)->assertUnprocessable()->assertJsonPath('code', 'RN-FLO-12');
        // RR. HH. renueva la licencia (el documento anterior queda reemplazado) y ya puede.
        $this->como('gsoto@donguando.pe')->post('/api/v1/flo/documentos', ['doc_type' => 'DRIVER_LICENSE', 'employee_id' => $emp, 'number' => 'Q47788121', 'license_class' => 'B-IIc',
            'expires_on' => $this->hoy->addYears(5)->toDateString(), 'archivo' => $this->pdf('licencia.pdf')], ['Accept' => 'application/json'])->assertCreated();
        $this->iniciar('jchoque@donguando.pe', 'MTC-789', $km + 1)->assertCreated();
        $docs = $this->como('gsoto@donguando.pe')->getJson('/api/v1/flo/documentos?tipo=DRIVER_LICENSE')->assertOk()->json('data');
        $this->assertSame(1, collect($docs)->where('employee_id', $emp)->count());
    }

    /** RN-FLO-13: el SOAT exige vencimiento; renovarlo actualiza el vehículo (DEL lo lee de ahí) y destraba la unidad. */
    public function test_documentos_renuevan_y_sincronizan(): void
    {
        $bkz = $this->vehiculoConContexto('BKZ-512');
        $this->coordinador()->postJson('/api/v1/flo/documentos', ['doc_type' => 'SOAT', 'vehicle_id' => $bkz, 'number' => 'SOAT-NUEVO'])->assertUnprocessable()->assertJsonPath('code', 'RN-FLO-13');
        $nuevo = $this->hoy->addYear()->toDateString();
        $this->coordinador()->postJson('/api/v1/flo/documentos', ['doc_type' => 'SOAT', 'vehicle_id' => $bkz, 'number' => 'SOAT-NUEVO', 'expires_on' => $nuevo])->assertCreated();
        $this->contexto();
        $this->assertSame($nuevo, (string) DB::table('vehicles')->where('id', $bkz)->value('soat_expires_on'));
        $this->assertSame(1, DB::table('vehicle_documents')->where('vehicle_id', $bkz)->where('doc_type', 'SOAT')->where('status', 'ACTIVE')->count());
        TenantContext::set(null);
        $this->coordinador()->postJson("/api/v1/flo/vehiculos/{$bkz}/programar", ['date' => $this->hoy->toDateString(), 'driver_user_id' => $this->usuario('jchoque@donguando.pe', 'id')])->assertOk();
        // El repartidor no gestiona documentos.
        $this->pedro()->postJson('/api/v1/flo/documentos', ['doc_type' => 'SOAT', 'vehicle_id' => $bkz, 'number' => 'X', 'expires_on' => $nuevo])->assertForbidden();
    }

    /** RN-FLO-15: el descuento al conductor exige el acta firmada, lo aprueba RR. HH. y no se repite. */
    public function test_multa_descontada_una_sola_vez(): void
    {
        $mtc = $this->vehiculoConContexto('MTC-789');
        $m = $this->coordinador()->postJson('/api/v1/flo/multas', ['ballot_number' => 'SAT-TEST-1', 'fine_date' => $this->hoy->toDateString(), 'entity' => 'SAT',
            'infraction' => 'Estacionar en zona prohibida', 'vehicle_id' => $mtc, 'amount' => 220, 'driver_user_id' => $this->usuario('jchoque@donguando.pe', 'id')])->assertCreated()->json();
        $this->assertNotNull($m['employee_id']);    // el trabajador sale del usuario conductor
        $this->coordinador()->postJson('/api/v1/flo/multas', ['ballot_number' => 'sat-test-1', 'fine_date' => $this->hoy->toDateString(), 'entity' => 'SAT',
            'infraction' => 'Repetida', 'vehicle_id' => $mtc, 'amount' => 220])->assertUnprocessable();
        $this->coordinador()->post("/api/v1/flo/multas/{$m['id']}/descontar", ['acta' => $this->pdf('acta.pdf')], ['Accept' => 'application/json'])->assertForbidden();
        $this->como('gsoto@donguando.pe')->postJson("/api/v1/flo/multas/{$m['id']}/descontar")->assertUnprocessable()->assertJsonPath('code', 'RN-FLO-15');
        $this->como('gsoto@donguando.pe')->post("/api/v1/flo/multas/{$m['id']}/descontar", ['acta' => $this->pdf('acta.pdf')], ['Accept' => 'application/json'])
            ->assertOk()->assertJsonPath('charged_to_driver', true);
        $this->como('gsoto@donguando.pe')->post("/api/v1/flo/multas/{$m['id']}/descontar", ['acta' => $this->pdf('acta2.pdf')], ['Accept' => 'application/json'])
            ->assertUnprocessable()->assertJsonPath('code', 'RN-FLO-15');
    }

    /** RN-FLO-03: posiciones y temperaturas de solo inserción en la base (ni la app puede cambiarlas). */
    public function test_posiciones_de_solo_insercion(): void
    {
        $this->contexto();
        $this->expectException(\Illuminate\Database\QueryException::class);
        DB::table('vehicle_positions')->limit(1)->update(['speed_kmh' => 0]);
    }

    /** Pantallas: cada rol entra a lo suyo (opciones, ficha, jornadas, rendimiento, otros costos). */
    public function test_pantallas_por_rol(): void
    {
        $o = $this->gerente()->getJson('/api/v1/flo/opciones')->assertOk()->json();
        $this->assertCount(5, $o['vehiculos']);
        $this->assertTrue($o['permisos']['costos']);
        $mta = $this->vehiculoConContexto('MTA-123');
        $f = $this->coordinador()->getJson("/api/v1/flo/vehiculos/{$mta}")->assertOk()->json();
        $this->assertSame('MOT-01', $f['perfil']['internal_code']);
        $this->coordinador()->getJson('/api/v1/flo/jornadas?desde=2026-09-01&hasta=2026-09-30')->assertOk();
        $this->coordinador()->getJson('/api/v1/flo/rendimiento?desde=2026-09-01&hasta=2026-10-10')->assertOk();
        $this->coordinador()->getJson('/api/v1/flo/costos')->assertOk();
        $this->coordinador()->getJson('/api/v1/flo/vehiculos/'.$mta.'/recorrido?fecha=2026-10-09')->assertOk();
        $this->coordinador()->getJson('/api/v1/flo/temperatura')->assertOk();
        $this->pedro()->getJson('/api/v1/flo/app')->assertOk();
        $this->pedro()->getJson('/api/v1/flo/costos')->assertForbidden();
        $this->como('gsoto@donguando.pe')->getJson('/api/v1/flo/documentos')->assertOk();
        $this->como('gsoto@donguando.pe')->getJson('/api/v1/flo/cargas')->assertForbidden();
    }
}
