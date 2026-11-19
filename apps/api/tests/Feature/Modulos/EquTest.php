<?php

namespace Tests\Feature\Modulos;

use App\Models\User;
use App\Modulos\Equ\Services\EquiposService;
use App\Support\RuleError;
use App\Support\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * EQU · Equipos, calibración y mantenimiento. CA-EQU-01 a 05 de la spec, RN-EQU-05 a 12, permisos,
 * KPI-EQU-01 a 04 y aislamiento entre empresas. Fecha de las pruebas: 10/10/2026, la de los criterios.
 * Datos de demo: BAL-L1-02 con calibración vencida el 30/09/2026, SEL-L1-01 activa, MOL-L1-01 fuera
 * de servicio por la correctiva OM-0032 y las preventivas OM-0001 (ahumador, vencida) y OM-0002 abiertas.
 */
class EquTest extends TestCase
{
    private const JEFE = 'olazo@donguando.pe';          // JEFE_PRODUCCION: equipos, órdenes y calibraciones

    private const CALIDAD = 'sramos@donguando.pe';      // CALIDAD: registra calibraciones

    private const OPERARIO = 'npoma@donguando.pe';      // OPERARIO_PRODUCCION: reporta fallas

    private const ALMACENERO = 'mtorres@donguando.pe'; // ALMACENERO: entra al módulo y reporta fallas

    private const GERENTE = 'rquispe@donguando.pe';

    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo(Carbon::parse('2026-10-10 10:00', 'America/Lima'));
    }

    /* ------------------------------------------------------------ ayudas */

    private function como(string $email, string $host = self::DG): static
    {
        return $this->desde($host, $this->ingresar($host, $email));
    }

    private function usuario(string $email = self::GERENTE): User
    {
        $tenantId = DB::selectOne('SELECT auth_tenants_for_email(?) AS t', [$email])->t;
        TenantContext::set(TenantContext::find($tenantId));
        $u = User::where('email', $email)->firstOrFail();
        TenantContext::setUser($u->id);

        return $u;
    }

    private function equipo(string $codigo): object
    {
        $this->usuario();

        return DB::table('equipment')->where('code', $codigo)->first();
    }

    private function falla(string $regla, callable $fn): RuleError
    {
        try {
            $fn();
        } catch (RuleError $e) {
            $this->assertSame($regla, $e->rule, $e->getMessage());

            return $e;
        }
        $this->fail("Se esperaba el rechazo {$regla} y la acción pasó.");
    }

    private function calibracion(string $equipo, array $cambios = []): array
    {
        return $cambios + [
            'equipment_id' => $this->equipo($equipo)->id, 'calibrated_on' => '2026-10-10', 'valid_until' => '2027-04-09',
            'certificate_number' => 'CC-2026-118', 'certificate_url' => 'certificados/CC-2026-118.pdf',
            'provider_name' => 'Metrología y Balanzas del Perú SAC', 'max_error_g' => 0.5, 'result' => 'PASS', 'cost' => 180,
        ];
    }

    /* ------------------------------------------------------------ criterios de aceptación */

    public function test_ca_equ_01_balanza_con_calibracion_vencida_no_se_registra_en_un_lote(): void
    {
        $b = $this->equipo('BAL-L1-02');
        $this->assertSame('2026-09-30', EquiposService::ultimaCalibracion($b->id)->valid_until);

        $e = $this->falla('RN-EQU-03', fn () => EquiposService::exigirBalanza($b->id, '2026-10-10'));
        $this->assertStringContainsString('30/09/2026', $e->getMessage());
        $this->assertFalse(EquiposService::apto($b->id, '2026-10-10'));
        // Antes del vencimiento sí estaba apta.
        $this->assertTrue(EquiposService::apto($b->id, '2026-09-30'));

        $this->como(self::JEFE)->getJson("/api/v1/equ/equipos/{$b->id}/apto?fecha=2026-10-10")->assertOk()
            ->assertJsonPath('usable', false)->assertJsonPath('rule', 'RN-EQU-03');
        // Tampoco se registran horas con ella.
        $this->como(self::JEFE)->postJson('/api/v1/equ/uso', ['equipment_id' => $b->id, 'hours' => 1, 'order_ref' => 'OP01-0420'])
            ->assertStatus(422)->assertJsonPath('code', 'RN-EQU-03');
        // Un equipo que no es balanza no sirve como balanza de un lote.
        $this->falla('RN-EQU-03', fn () => EquiposService::exigirBalanza($this->equipo('SEL-L1-01')->id, '2026-10-10'));
    }

    public function test_ca_equ_02_calibracion_pass_del_10_10_vuelve_a_dejarla_usar(): void
    {
        $b = $this->equipo('BAL-L1-02');
        $c = $this->como(self::CALIDAD)->postJson('/api/v1/equ/calibraciones', $this->calibracion('BAL-L1-02'))->assertCreated()->json();
        $this->assertSame('CC-2026-118', $c['certificate_number']);
        $this->assertSame('Silvia Ramos Tello', $c['recorded_by']);

        $this->usuario();
        $this->assertSame($b->id, EquiposService::exigirBalanza($b->id, '2026-10-10')->id);
        $this->assertSame('2027-04-09', EquiposService::calibracionVigente($b->id, '2026-10-10')->valid_until);
        $this->como(self::JEFE)->getJson("/api/v1/equ/equipos/{$b->id}/apto?fecha=2026-10-10")->assertJsonPath('usable', true);
        // Vence el 09/04/2027: al día siguiente ya no.
        $this->usuario();
        $this->assertFalse(EquiposService::apto($b->id, '2027-04-10'));
    }

    public function test_ca_equ_03_correctiva_de_la_selladora_cuesta_225_y_vuelve_a_activa(): void
    {
        $s = $this->equipo('SEL-L1-01');
        $this->assertSame('ACTIVE', $s->status);
        $jefe = $this->como(self::JEFE);
        $o = $jefe->postJson('/api/v1/equ/ordenes', ['equipment_id' => $s->id, 'kind' => 'CORRECTIVE', 'description' => 'Falla de la resistencia de sellado'])
            ->assertCreated()->json();
        $this->assertSame('OM-0033', $o['number']);
        $this->assertSame('OUT_OF_SERVICE', $this->equipo('SEL-L1-01')->status);
        $this->assertSame('CORRECTIVE', $this->equipo('SEL-L1-01')->oos_reason);

        // RN-EQU-04: no se registra en una orden de producción.
        $this->como(self::JEFE)->postJson('/api/v1/equ/uso', ['equipment_id' => $s->id, 'hours' => 1, 'order_ref' => 'OP01-0420'])
            ->assertStatus(422)->assertJsonPath('code', 'RN-EQU-04');
        $this->usuario();
        $this->falla('RN-EQU-04', fn () => EquiposService::exigirApto($s->id));

        $r = $this->como(self::JEFE)->postJson("/api/v1/equ/ordenes/{$o['id']}/terminar", [
            'diagnosis' => 'Resistencia quemada', 'labor_hours' => 4, 'labor_cost' => 80,
            'parts' => [['description' => 'Resistencia de sellado 42 cm', 'qty' => 1, 'unit_cost' => 145]], 'external_cost' => 0,
        ])->assertOk()->json();
        $this->assertSame('DONE', $r['status']);
        $this->assertSame('225.00', $r['total_cost']);
        $this->assertSame('145.00', $r['parts_cost']);
        $this->assertSame($s->cost_center_id, $r['cost_center_id']);   // RN-EQU-06: al centro de costo del equipo
        $this->assertSame('ACTIVE', $this->equipo('SEL-L1-01')->status);
        $this->assertTrue(EquiposService::apto($s->id));
    }

    public function test_ca_equ_04_calibracion_sin_numero_de_certificado_se_rechaza(): void
    {
        $api = $this->como(self::CALIDAD);
        $api->postJson('/api/v1/equ/calibraciones', $this->calibracion('BAL-L1-02', ['certificate_number' => '']))
            ->assertStatus(422)->assertJsonPath('code', 'RN-EQU-02');
        $api->postJson('/api/v1/equ/calibraciones', $this->calibracion('BAL-L1-02', ['certificate_url' => null]))
            ->assertStatus(422)->assertJsonPath('code', 'RN-EQU-02');
        $api->postJson('/api/v1/equ/calibraciones', $this->calibracion('BAL-L1-02', ['valid_until' => '2026-10-10']))
            ->assertStatus(422)->assertJsonPath('code', 'RN-EQU-02');
        // La base también lo rechaza.
        $this->usuario();
        try {
            DB::transaction(fn () => DB::table('equipment_calibrations')->insert(['equipment_id' => $this->equipo('BAL-L1-02')->id, 'calibrated_on' => '2026-10-10',
                'valid_until' => '2027-04-09', 'provider_name' => 'X', 'certificate_number' => ' ', 'certificate_url' => 'a.pdf', 'result' => 'PASS', 'cost' => 0, 'recorded_by' => 'X']));
            $this->fail('La base debió rechazar el certificado vacío');
        } catch (QueryException $e) {
            $this->assertStringContainsString('equipment_calibrations_certificado', $e->getMessage());
        }
    }

    public function test_ca_equ_05_balanza_sin_exigir_calibracion_se_rechaza(): void
    {
        $this->usuario();
        $local = DB::table('establishments')->where('code', 'like', '%1%')->orderBy('code')->value('id');
        $this->como(self::JEFE)->postJson('/api/v1/equ/equipos', [
            'code' => 'BAL-L1-09', 'name' => 'Balanza nueva', 'category' => 'SCALE', 'establishment_id' => $local, 'requires_calibration' => false,
        ])->assertStatus(422)->assertJsonPath('code', 'RN-EQU-01');
        $e = $this->como(self::JEFE)->postJson('/api/v1/equ/equipos', [
            'code' => 'bal-l1-09', 'name' => 'Balanza nueva', 'category' => 'SCALE', 'establishment_id' => $local, 'requires_calibration' => true,
        ])->assertCreated()->json();
        $this->assertSame('BAL-L1-09', $e['code']);
        $this->assertSame('EQ-BAL-L1-09', $e['qr_code']);
        $this->assertNotNull($e['cost_center_id']);
        // Nace sin calibración: no se usa hasta calibrarla (RN-EQU-03).
        $this->usuario();
        $this->falla('RN-EQU-03', fn () => EquiposService::exigirBalanza($e['id']));
        // Y no se puede quitar la exigencia después.
        $this->como(self::JEFE)->putJson("/api/v1/equ/equipos/{$e['id']}", ['requires_calibration' => false])->assertStatus(422)->assertJsonPath('code', 'RN-EQU-01');
    }

    /* ------------------------------------------------------------ reglas */

    public function test_rn_equ_05_vuelve_a_activo_solo_sin_otra_correctiva_abierta(): void
    {
        $s = $this->equipo('SIE-L1-01');
        $jefe = $this->como(self::JEFE);
        $a = $jefe->postJson('/api/v1/equ/ordenes', ['equipment_id' => $s->id, 'kind' => 'CORRECTIVE', 'description' => 'Cinta desalineada'])->assertCreated()->json();
        $b = $this->como(self::JEFE)->postJson('/api/v1/equ/ordenes', ['equipment_id' => $s->id, 'kind' => 'CORRECTIVE', 'description' => 'Ruido en el motor'])->assertCreated()->json();
        // No se activa a mano con una correctiva abierta.
        $this->como(self::JEFE)->putJson("/api/v1/equ/equipos/{$s->id}", ['status' => 'ACTIVE'])->assertStatus(422)->assertJsonPath('code', 'RN-EQU-05');
        $this->como(self::JEFE)->postJson("/api/v1/equ/ordenes/{$a['id']}/terminar", ['labor_cost' => 40])->assertOk();
        $this->assertSame('OUT_OF_SERVICE', $this->equipo('SIE-L1-01')->status);
        $this->como(self::JEFE)->postJson("/api/v1/equ/ordenes/{$b['id']}/anular", ['reason' => 'Era la misma falla de la cinta'])->assertOk()->assertJsonPath('status', 'VOIDED');
        $this->assertSame('ACTIVE', $this->equipo('SIE-L1-01')->status);
        // El servicio externo necesita el proveedor.
        $c = $this->como(self::JEFE)->postJson('/api/v1/equ/ordenes', ['equipment_id' => $s->id, 'kind' => 'CORRECTIVE', 'description' => 'Motor quemado'])->json();
        $this->como(self::JEFE)->postJson("/api/v1/equ/ordenes/{$c['id']}/terminar", ['external_cost' => 300])->assertStatus(422)->assertJsonPath('code', 'RN-EQU-06');
    }

    public function test_rn_equ_06_la_base_exige_que_el_total_sume_sus_partes(): void
    {
        $this->usuario();
        $o = DB::table('maintenance_orders')->where('number', 'OM-0027')->first();
        $this->assertEquals(225, $o->total_cost);   // la correctiva de la selladora en la demo
        try {
            DB::transaction(fn () => DB::table('maintenance_orders')->where('id', $o->id)->update(['total_cost' => 300]));
            $this->fail('La base debió rechazar un total que no suma');
        } catch (QueryException $e) {
            $this->assertStringContainsString('maintenance_orders_total', $e->getMessage());
        }
    }

    public function test_rn_equ_07_el_plan_crea_la_orden_por_horas_sin_duplicarla_y_avisa_atrasos(): void
    {
        $t = $this->equipo('TOS-L2-01');
        $plan = DB::table('maintenance_plans')->where('equipment_id', $t->id)->first();
        $this->assertSame('OK', EquiposService::estadoPlan($plan, '2026-10-10'));
        // La lectura de 500 h pasa las 495 h del plan.
        $r = $this->como(self::JEFE)->postJson("/api/v1/equ/equipos/{$t->id}/horometro", ['hours' => 500])->assertOk()->json();
        $this->assertCount(1, $r['due_plans']);
        $this->como(self::JEFE)->postJson("/api/v1/equ/equipos/{$t->id}/horometro", ['hours' => 480])->assertStatus(422)->assertJsonPath('code', 'RN-EQU-07');

        $g = $this->como(self::JEFE)->postJson('/api/v1/equ/planes/generar')->assertOk()->json();
        $this->assertCount(1, $g['created']);   // la del tostador; ahumador y cámara ya tenían su orden abierta
        $this->assertNotEmpty(array_filter($g['overdue'], fn ($x) => str_starts_with($x, 'AHU-L2-01')));   // el ahumador, vencido el 30/09
        $this->assertSame([], $this->como(self::JEFE)->postJson('/api/v1/equ/planes/generar')->assertOk()->json('created'));
        $this->usuario();
        $this->assertSame(1, DB::table('notifications')->where('module', 'EQU')->where('role', 'JEFE_PRODUCCION')->where('title', 'like', '%atraso%')->count());

        // Al cerrar la preventiva, el plan corre sus próximas horas.
        $o = DB::table('maintenance_orders')->where('plan_id', $plan->id)->where('status', 'OPEN')->first();
        $this->como(self::JEFE)->postJson("/api/v1/equ/ordenes/{$o->id}/terminar", ['labor_cost' => 20, 'labor_hours' => 1])->assertOk();
        $this->usuario();
        $p = DB::table('maintenance_plans')->where('id', $plan->id)->first();
        $this->assertEquals(540, $p->next_due_hours);
        $this->assertSame('2026-10-10', $p->last_done_on);
    }

    public function test_rn_equ_08_avisa_las_calibraciones_por_vencer_una_sola_vez(): void
    {
        $this->usuario();
        $r = EquiposService::avisarCalibraciones('2026-10-10');
        // BAL-L1-03 vence el 20/10 y TER-L2-01 el 22/10: dentro de los 15 días.
        $this->assertSame(2, $r['expiring']);
        $this->assertSame(1, $r['blocked']);   // BAL-L1-02
        $this->assertSame(4, DB::table('notifications')->where('module', 'EQU')->where('title', 'like', 'Calibración de%')->count());
        $this->assertSame(0, EquiposService::avisarCalibraciones('2026-10-10')['expiring']);
    }

    public function test_rn_equ_09_carga_sugerida_y_la_fija_el_jefe(): void
    {
        $s = $this->equipo('SEL-L2-01');
        $f = $this->como(self::JEFE)->getJson("/api/v1/equ/equipos/{$s->id}")->assertOk()->json();
        $sug = $f['suggested_rate'];
        $this->assertNotNull($sug['rate']);
        $esperado = ((float) $s->purchase_cost / $s->useful_life_months + (float) $sug['monthly_maintenance']) / (float) $sug['monthly_hours'];
        $this->assertEqualsWithDelta($esperado, (float) $sug['rate'], 0.2);   // las horas del mensaje van redondeadas a 1 decimal
        $this->como(self::CALIDAD)->putJson("/api/v1/equ/equipos/{$s->id}/carga", ['hourly_rate' => $sug['rate']])->assertForbidden();
        $this->como(self::JEFE)->putJson("/api/v1/equ/equipos/{$s->id}/carga", ['hourly_rate' => $sug['rate']])->assertOk()->assertJsonPath('hourly_rate', number_format((float) $sug['rate'], 4, '.', ''));
        // Las horas nuevas se cuestan con la carga del momento.
        $u = $this->como(self::JEFE)->postJson('/api/v1/equ/uso', ['equipment_id' => $s->id, 'hours' => 2, 'order_ref' => 'op01-0500'])->assertCreated()->json();
        $this->assertSame('OP01-0500', $u['order_ref']);
        $this->assertEqualsWithDelta(2 * (float) $sug['rate'], (float) $u['cost'], 0.01);
        $this->assertEquals((float) $s->hour_meter + 2, (float) $this->equipo('SEL-L2-01')->hour_meter);
    }

    public function test_rn_equ_10_calibracion_fail_lo_deja_fuera_de_servicio_hasta_una_pass(): void
    {
        $b = $this->equipo('BAL-L2-01');
        $this->como(self::CALIDAD)->postJson('/api/v1/equ/calibraciones', $this->calibracion('BAL-L2-01', ['result' => 'FAIL', 'certificate_number' => 'CC-2026-120', 'max_error_g' => 6]))->assertCreated();
        $e = $this->equipo('BAL-L2-01');
        $this->assertSame('OUT_OF_SERVICE', $e->status);
        $this->assertSame('CALIBRATION', $e->oos_reason);
        $this->assertFalse(EquiposService::apto($b->id));
        $this->como(self::JEFE)->putJson("/api/v1/equ/equipos/{$b->id}", ['status' => 'ACTIVE'])->assertStatus(422)->assertJsonPath('code', 'RN-EQU-10');
        $this->como(self::CALIDAD)->postJson('/api/v1/equ/calibraciones', $this->calibracion('BAL-L2-01', ['certificate_number' => 'CC-2026-121']))->assertCreated();
        $this->assertSame('ACTIVE', $this->equipo('BAL-L2-01')->status);
        $this->assertTrue(EquiposService::apto($b->id));
    }

    public function test_rn_equ_11_camara_sin_punto_de_temperatura_no_queda_activa(): void
    {
        $this->usuario();
        $l2 = DB::table('warehouses')->where('code', 'CAM-L2')->first();
        $sinPunto = DB::table('warehouses')->where('establishment_id', $l2->establishment_id)
            ->whereNotIn('id', DB::table('temperature_points')->whereNotNull('warehouse_id')->pluck('warehouse_id'))->value('id');
        $datos = ['code' => 'CAM-L2-B', 'name' => 'Cámara nueva', 'category' => 'COLD_ROOM', 'establishment_id' => $l2->establishment_id, 'warehouse_id' => $sinPunto];
        $this->como(self::JEFE)->postJson('/api/v1/equ/equipos', $datos)->assertStatus(422)->assertJsonPath('code', 'RN-EQU-11');
        $e = $this->como(self::JEFE)->postJson('/api/v1/equ/equipos', $datos + ['status' => 'OUT_OF_SERVICE'])->assertCreated()->json();
        $this->assertSame('MANUAL', $e['oos_reason']);
        $this->como(self::JEFE)->putJson("/api/v1/equ/equipos/{$e['id']}", ['status' => 'ACTIVE'])->assertStatus(422)->assertJsonPath('code', 'RN-EQU-11');
        // Con el almacén que ya tiene su punto (CAM-L2), sí.
        $this->como(self::JEFE)->putJson("/api/v1/equ/equipos/{$e['id']}", ['status' => 'ACTIVE', 'warehouse_id' => $l2->id])->assertOk()->assertJsonPath('status', 'ACTIVE');
    }

    public function test_rn_equ_12_las_calibraciones_no_se_cambian_ni_se_borran(): void
    {
        $this->usuario();
        $c = DB::table('equipment_calibrations')->where('certificate_number', 'CC-2026-094')->value('id');
        foreach ([
            fn () => DB::table('equipment_calibrations')->where('id', $c)->update(['valid_until' => '2027-12-31']),
            fn () => DB::table('equipment_calibrations')->where('id', $c)->delete(),
        ] as $i => $fn) {
            try {
                DB::transaction($fn);
                $this->fail("El intento {$i} debió rechazarse (RN-EQU-12)");
            } catch (QueryException $e) {
                $this->assertSame('42501', $e->getCode(), $e->getMessage());
            }
        }
        $this->assertSame('2026-09-30', DB::table('equipment_calibrations')->where('id', $c)->value('valid_until'));
    }

    public function test_el_operario_reporta_la_falla_por_qr_y_no_cierra_ordenes(): void
    {
        $op = $this->como(self::OPERARIO);
        $r = $op->postJson('/api/v1/equ/fallas', ['code' => 'eq-reb-l2-01', 'description' => 'La cuchilla no gira', 'urgency' => 'HIGH'])->assertCreated()->json();
        $this->assertTrue($r['created']);
        $this->assertSame('OUT_OF_SERVICE', $this->equipo('REB-L2-01')->status);
        // Un segundo reporte del mismo equipo se suma a la orden abierta.
        $r2 = $this->como(self::OPERARIO)->postJson('/api/v1/equ/fallas', ['code' => 'REB-L2-01', 'description' => 'Huele a quemado'])->assertOk()->json();
        $this->assertFalse($r2['created']);
        $this->assertSame($r['order']['id'], $r2['order']['id']);
        $this->assertStringContainsString('Huele a quemado', $r2['order']['description']);
        $this->como(self::OPERARIO)->postJson("/api/v1/equ/ordenes/{$r['order']['id']}/terminar", ['labor_cost' => 10])->assertForbidden();
        // El operario no abre preventivas ni crea equipos.
        $this->usuario();
        $plan = DB::table('maintenance_plans')->where('equipment_id', $this->equipo('SEL-L2-01')->id)->first();
        $this->como(self::OPERARIO)->postJson('/api/v1/equ/ordenes', ['equipment_id' => $plan->equipment_id, 'kind' => 'PREVENTIVE', 'plan_id' => $plan->id, 'description' => 'x'])
            ->assertStatus(422)->assertJsonPath('code', 'RN-EQU-06');
        $this->como(self::OPERARIO)->postJson('/api/v1/equ/equipos', ['code' => 'X', 'name' => 'X', 'category' => 'OTHER', 'establishment_id' => $plan->equipment_id])->assertForbidden();
        $this->como(self::JEFE)->getJson('/api/v1/equ/equipos/codigo?code=NO-EXISTE')->assertNotFound()->assertJsonPath('code', 'RN-EQU-05');
    }

    public function test_registrar_uso_y_reportar_fallas_piden_su_propio_permiso(): void
    {
        $emb = $this->equipo('EMB-L2-01');
        $uso = ['equipment_id' => $emb->id, 'order_ref' => 'OP01-0500', 'hours' => 1.5, 'used_on' => '2026-10-10'];
        // El operario tiene equ.usage.record: registra horas y lecturas de horómetro.
        $this->como(self::OPERARIO)->postJson('/api/v1/equ/uso', $uso)->assertCreated();
        $this->como(self::OPERARIO)->getJson('/api/v1/equ/opciones')->assertJsonPath('can.usage', true);
        // El almacenero entra al módulo y reporta fallas, pero no registra uso. El mensaje no muestra códigos internos.
        $r = $this->como(self::ALMACENERO)->postJson('/api/v1/equ/uso', $uso)->assertForbidden()->json();
        $this->assertSame('No tienes permiso para esta acción: registrar horas de uso y lecturas de horómetro.', $r['message']);
        $this->como(self::ALMACENERO)->postJson("/api/v1/equ/equipos/{$emb->id}/horometro", ['hours' => 9999])->assertForbidden();
        $this->como(self::ALMACENERO)->getJson('/api/v1/equ/opciones')->assertJsonPath('can.usage', false);
        // Calidad registra calibraciones, pero no reporta fallas ni abre órdenes.
        $falla = ['equipment_id' => $emb->id, 'description' => 'No arranca'];
        $this->como(self::CALIDAD)->postJson('/api/v1/equ/fallas', $falla)->assertForbidden();
        $this->como(self::CALIDAD)->postJson('/api/v1/equ/ordenes', $falla + ['kind' => 'CORRECTIVE'])->assertForbidden();
        $this->como(self::JEFE)->postJson('/api/v1/equ/fallas', $falla)->assertCreated();
    }

    public function test_kpi_equ_01_a_04_del_mes(): void
    {
        $k = $this->como(self::JEFE)->getJson('/api/v1/equ/tablero')->assertOk()->json();
        $this->assertSame(['from' => '2026-10-01', 'to' => '2026-10-10'], $k['period']);
        // KPI-EQU-02: BAL-L1-02 vencida; las otras 4 balanzas activas, vigentes.
        $this->assertSame(['value' => '80.0', 'ok' => 4, 'total' => 5], $k['scales']);
        // KPI-EQU-03: OM-0029 (30) + OM-0030 (130) + OM-0031 (600) cerradas en octubre.
        $this->assertSame('760.00', $k['maintenance_cost']);
        // KPI-EQU-01: hubo paradas (cámara 1, molino), así que no llega al 100 %.
        $this->assertLessThan(100, (float) $k['availability']['value']);
        $this->assertGreaterThan(0, (float) $k['availability']['down_hours']);
        // KPI-EQU-04: vencían en octubre OM-0029 y OM-0030 (cerradas a tiempo) y OM-0002 (cámara 1, vence hoy, abierta).
        $this->assertSame(['value' => '66.7', 'on_time' => 2, 'total' => 3], $k['preventive']);
        $this->assertCount(5, $k['scales_list']);
        $this->assertCount(6, $k['cost_by_month']);
    }

    public function test_cada_empresa_ve_solo_sus_equipos(): void
    {
        $s = $this->equipo('SEL-L1-01');
        $cs = $this->como('hsalas@carnesselectas.pe', self::CS);
        $cs->getJson('/api/v1/equ/equipos')->assertOk()->assertJsonPath('total', 0);
        $cs->getJson("/api/v1/equ/equipos/{$s->id}")->assertNotFound();
        $cs->postJson('/api/v1/equ/ordenes', ['equipment_id' => $s->id, 'kind' => 'CORRECTIVE', 'description' => 'x'])->assertNotFound();
        $this->como(self::GERENTE)->getJson('/api/v1/equ/equipos')->assertOk()->assertJsonPath('total', 27);
    }

    public function test_las_pantallas_responden_con_datos_de_demo(): void
    {
        $api = $this->como(self::GERENTE);
        $api->getJson('/api/v1/equ/opciones')->assertOk()->assertJsonPath('can.manage', true)->assertJsonPath('params.calibration_alert_days', 15);
        foreach (['01', '03', '05', '06', '08'] as $p) {
            $api->getJson("/api/v1/equ/cifras/{$p}")->assertOk();
        }
        $api->getJson('/api/v1/equ/cifras/01')->assertJsonPath('out_of_service', 1)->assertJsonPath('scales_not_usable', 1);
        $m = $this->equipo('MOL-L1-01');
        $f = $this->como(self::GERENTE)->getJson("/api/v1/equ/equipos/{$m->id}")->assertOk()->json();
        $this->assertSame('RN-EQU-04', $f['not_usable']['rule']);
        $this->assertStringContainsString('OM-0032', $f['not_usable']['msg']);
        $api = $this->como(self::GERENTE);
        $api->getJson('/api/v1/equ/equipos?apto=NO')->assertOk()->assertJsonPath('total', 2);
        $api->getJson('/api/v1/equ/calibraciones')->assertOk()->assertJsonPath('total', 12);
        $cal = $api->getJson('/api/v1/equ/calendario')->assertOk()->json();
        $this->assertSame(1, $cal['summary']['blocked']);
        $this->assertSame('BAL-L1-02', $cal['rows'][0]['code']);
        $planes = $api->getJson('/api/v1/equ/planes')->assertOk()->json();
        $this->assertSame(10, $planes['total']);
        $this->assertContains('OVERDUE', array_column($planes['data'], 'state'));
        $api->getJson('/api/v1/equ/ordenes?status=ABIERTAS')->assertOk()->assertJsonPath('total', 3);
        $o = DB::table('maintenance_orders')->where('number', 'OM-0027')->value('id');
        $api->getJson("/api/v1/equ/ordenes/{$o}")->assertOk()->assertJsonPath('total_cost', '225.00');
        $api->getJson('/api/v1/equ/uso')->assertOk()->assertJsonPath('total', 179);
        $api->getJson('/api/v1/equ/uso/por-equipo?desde=2026-10-01')->assertOk();
        $api->getJson('/api/v1/equ/equipos/codigo?code=EQ-SEL-L1-01')->assertOk()->assertJsonPath('code', 'SEL-L1-01');
    }
}
