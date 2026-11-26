<?php

namespace Tests\Feature\Modulos;

use App\Models\User;
use App\Modulos\Cal\Services\CalidadService as Cal;
use App\Support\RuleError;
use App\Support\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * CAL · Calidad e inocuidad. CA-CAL-01 a 08 de la spec, RN-CAL-06/07/12/13/14/15/17, permisos y rutas.
 * Fecha de las pruebas: 10/10/2026. Datos de demo: el lote CH-2026-0412 de chorizo en cuarentena (orden OP01-0412,
 * supervisada por el jefe de producción, con la inspección de proceso INS-00106 conforme), la mermelada artesanal
 * con su registro DIGESA vencido el 30/09/2026 y su lote ME-2026-1010, y la cámara 1 del local 1 (0 a 4 °C).
 */
class CalTest extends TestCase
{
    private const CALIDAD = 'sramos@donguando.pe';      // CALIDAD

    private const JEFE = 'olazo@donguando.pe';          // JEFE_PRODUCCION

    private const OPERARIO = 'npoma@donguando.pe';      // OPERARIO_PRODUCCION, local 2

    private const SUPERVISORA = 'pleon@donguando.pe';   // SUPERVISORA_VENTAS: resuelve reclamos

    /** @var array<string, string> */
    private array $tokens = [];

    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo(Carbon::parse('2026-10-10 10:00', 'America/Lima'));
    }

    /* ------------------------------------------------------------ ayudas */

    private function como(string $email): static
    {
        return $this->desde(self::DG, $this->tokens[$email] ??= $this->ingresar(self::DG, $email));
    }

    private function usuario(string $email = self::CALIDAD): User
    {
        $tenantId = DB::selectOne('SELECT auth_tenants_for_email(?) AS t', [$email])->t;
        TenantContext::set(TenantContext::find($tenantId));
        $u = User::where('email', $email)->firstOrFail();
        TenantContext::setUser($u->id);

        return $u;
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

    private function lote(string $codigo): object
    {
        $this->usuario();

        return DB::table('lots')->where('code', $codigo)->orderByDesc('created_at')->first();
    }

    private function punto(string $codigo): object
    {
        $this->usuario();

        return DB::table('temperature_points')->where('code', $codigo)->first();
    }

    /** Respuestas del checklist: todas conformes salvo los ítems indicados por su orden. */
    private function respuestas(string $checklistId, array $noConformes = []): array
    {
        return DB::table('qc_checklist_items')->where('checklist_id', $checklistId)->orderBy('seq')->get()->map(function ($it) use ($noConformes) {
            $no = in_array($it->seq, $noConformes, true);

            return match ($it->answer_type) {
                'NUMBER' => ['item_id' => $it->id, 'answer_num' => $no ? (float) ($it->max_value ?? 0) + 10 : (float) ($it->min_value ?? 0)],
                'PHOTO' => ['item_id' => $it->id, 'photo_url' => 'fotos/prueba.jpg', 'is_conforming' => ! $no],
                'TEXT' => ['item_id' => $it->id, 'answer_text' => 'Conforme', 'is_conforming' => ! $no, 'photo_url' => $it->requires_photo ? 'fotos/prueba.jpg' : null],
                default => ['item_id' => $it->id, 'answer_bool' => ! $no, 'photo_url' => $it->requires_photo ? 'fotos/prueba.jpg' : null],
            };
        })->all();
    }

    /* ------------------------------------------------------------ criterios de aceptación */

    public function test_ca_cal_01_quien_supervisó_la_orden_no_libera_el_lote_y_calidad_sí(): void
    {
        $lot = $this->lote('CH-2026-0412');
        $this->assertSame('QUARANTINE', $lot->qc_status);
        $this->assertTrue(DB::table('qc_inspections')->where('lot_id', $lot->id)->where('result', 'PASS')->exists());

        $this->falla('RN-CAL-02', fn () => Cal::decidir($lot->id, ['decision' => 'RELEASE'], $this->usuario(self::JEFE)));
        $d = Cal::decidir($lot->id, ['decision' => 'RELEASE'], $this->usuario());
        $this->assertSame('RELEASED', $d->new_status);
        $this->assertSame('QUARANTINE', $d->previous_status);
        $this->assertSame('RELEASED', DB::table('lots')->where('id', $lot->id)->value('qc_status'));
        $this->assertDatabaseHas('domain_events', ['event_name' => 'lot.quality_decided', 'aggregate_id' => $lot->id]);
    }

    public function test_ca_cal_02_update_directo_de_qc_status_se_rechaza(): void
    {
        $lot = $this->lote('CH-2026-0412');
        try {
            DB::transaction(fn () => DB::table('lots')->where('id', $lot->id)->update(['qc_status' => 'RELEASED']));
            $this->fail('El UPDATE directo debió rechazarse.');
        } catch (QueryException $e) {
            $this->assertStringContainsString('RN-CAL-01', $e->getMessage());
        }
        // Desde ALM, también.
        $this->falla('RN-CAL-01', fn () => \App\Modulos\Alm\Services\LotesService::cambiarEstado($lot->id, 'RELEASED', null, $this->usuario('rquispe@donguando.pe')));
    }

    public function test_ca_cal_03_excursion_de_temperatura_y_su_cierre(): void
    {
        $p = $this->punto('TP-CAM-L1');
        DB::table('temperature_excursions')->where('point_id', $p->id)->where('status', 'OPEN')->update(['status' => 'CLOSED', 'action_taken' => 'Cerrada para la prueba']);

        $r = Cal::leer(['point_id' => $p->id, 'value_c' => 6.5], $this->usuario());
        $this->assertFalse((bool) $r['reading']->in_range);
        $this->assertTrue($r['opened']);
        $this->assertSame('2.50', number_format((float) $r['excursion']->max_deviation_c, 2));
        $this->assertTrue(DB::table('notifications')->where('module', 'CAL')->where('title', 'like', '%Cámara 1%')->exists());

        $r2 = Cal::leer(['point_id' => $p->id, 'value_c' => 3.0], $this->usuario());
        $this->assertTrue($r2['ended']);
        $this->assertNotNull($r2['excursion']->ended_at);
        $this->assertSame('OPEN', $r2['excursion']->status);

        $this->falla('RN-CAL-05', fn () => Cal::cerrarExcursion($r['excursion']->id, [], $this->usuario()));
        $c = Cal::cerrarExcursion($r['excursion']->id, ['action_taken' => 'Se cerró la puerta mal ajustada y se revisó el producto', 'create_nc' => true], $this->usuario());
        $this->assertSame('CLOSED', $c->status);
        $this->assertNotNull($c->nonconformity_id);

        // RN-CAL-16: las lecturas no se borran ni se editan.
        $this->expectException(QueryException::class);
        DB::table('temperature_readings')->where('id', $r['reading']->id)->update(['value_c' => 3]);
    }

    public function test_ca_cal_04_no_conformidad_con_accion_pendiente_no_se_cierra(): void
    {
        $q = $this->usuario();
        $nc = Cal::crearNC(['source' => 'PROCESS', 'severity' => 'MINOR', 'description' => 'Etiquetas con la fecha corrida en la selladora 2'], $q);
        $this->falla('RN-CAL-06', fn () => Cal::cerrarNC($nc->id, ['root_cause' => 'Rodillo de la fechadora desgastado'], $this->usuario()));
        $a = Cal::agregarAccion($nc->id, ['action_type' => 'CORRECTIVE', 'description' => 'Cambiar el rodillo de la fechadora'], $q);
        $e = $this->falla('RN-CAL-06', fn () => Cal::cerrarNC($nc->id, ['root_cause' => 'Rodillo de la fechadora desgastado'], $this->usuario()));
        $this->assertStringContainsString('pendiente', $e->getMessage());

        Cal::avanzarAccion($a->id, 'DONE', ['evidence_url' => 'evidencias/rodillo.jpg'], $this->usuario());
        $this->falla('RN-CAL-06', fn () => Cal::cerrarNC($nc->id, [], $this->usuario()));   // sin causa raíz
        $c = Cal::cerrarNC($nc->id, ['root_cause' => 'Rodillo de la fechadora desgastado'], $this->usuario());
        $this->assertSame('CLOSED', $c->status);
    }

    public function test_ca_cal_05_item_critico_no_conforme_da_fail_aunque_el_puntaje_llegue(): void
    {
        $this->usuario();
        $chk = DB::table('qc_checklists')->where('code', 'CHK-EMP')->where('status', 'ACTIVE')->first();
        $this->assertSame(10, DB::table('qc_checklist_items')->where('checklist_id', $chk->id)->count());
        $critico = DB::table('qc_checklist_items')->where('checklist_id', $chk->id)->where('is_critical', true)->value('seq');

        $i = Cal::inspeccionar(['checklist_id' => $chk->id, 'establishment_id' => DB::table('establishments')->where('short', 'Local 2')->value('id'),
            'answers' => $this->respuestas($chk->id, [$critico])], $this->usuario());
        $this->assertSame('90.00', number_format((float) $i->score_pct, 2));
        $this->assertSame('FAIL', $i->result);
        $this->assertCount(1, $i->critical_failed);

        // Con un ítem no crítico no conforme (90 %), es PASS.
        $otro = DB::table('qc_checklist_items')->where('checklist_id', $chk->id)->where('is_critical', false)->value('seq');
        $ok = Cal::inspeccionar(['checklist_id' => $chk->id, 'establishment_id' => DB::table('establishments')->where('short', 'Local 2')->value('id'),
            'answers' => $this->respuestas($chk->id, [$otro])], $this->usuario());
        $this->assertSame('PASS', $ok->result);
    }

    public function test_ca_cal_06_reclamo_por_producto_en_mal_estado_crea_no_conformidad_mayor(): void
    {
        $lot = $this->lote('CH-2026-0412');
        $cliente = DB::table('customers')->value('id');
        $c = Cal::registrarReclamo(['customer_id' => $cliente, 'lot_id' => $lot->id, 'claim_type' => 'SPOILED', 'description' => 'El chorizo llegó con olor ácido'], $this->usuario());
        $this->assertNotNull($c->nonconformity_id);
        $nc = DB::table('nonconformities')->where('id', $c->nonconformity_id)->first();
        $this->assertSame('MAJOR', $nc->severity);
        $this->assertSame('CUSTOMER_CLAIM', $nc->source);
        $this->assertSame($lot->id, $nc->lot_id);
        $this->assertSame($c->id, $nc->claim_id);

        // Un reclamo de sabor no crea no conformidad.
        $s = Cal::registrarReclamo(['customer_id' => $cliente, 'lot_id' => $lot->id, 'claim_type' => 'TASTE', 'description' => 'Muy salado'], $this->usuario());
        $this->assertNull($s->nonconformity_id);
    }

    public function test_ca_cal_07_producto_digesa_con_registro_vencido_no_se_libera(): void
    {
        $lot = $this->lote('ME-2026-1010');
        $this->assertSame('2026-09-30', DB::table('products')->where('id', $lot->product_id)->value('sanitary_registry_expires'));
        $e = $this->falla('RN-CAL-10', fn () => Cal::decidir($lot->id, ['decision' => 'RELEASE'], $this->usuario()));
        $this->assertStringContainsString('30/09/2026', $e->getMessage());

        // Con el registro renovado en CAL-10, se libera.
        Cal::registrarSanitario(['product_id' => $lot->product_id, 'authority' => 'DIGESA', 'number' => 'R.S. N4999N-NADGAN', 'issued_on' => '2026-10-08',
            'expires_on' => '2031-10-08', 'file_url' => 'sanitarios/merm-2026.pdf'], $this->usuario());
        $this->assertSame('RELEASED', Cal::decidir($lot->id, ['decision' => 'RELEASE'], $this->usuario())->new_status);
    }

    public function test_ca_cal_08_reclamos_cada_mil_pedidos(): void
    {
        $this->usuario();
        // Septiembre de la demo: 965 pedidos entregados y 2 reclamos. Se completan 1000 pedidos y 3 reclamos.
        $base = DB::table('sales_orders')->whereIn('status', ['DELIVERED', 'CLOSED'])->whereBetween('delivery_date', ['2026-09-01', '2026-09-30'])->value('id');
        $faltan = 1000 - DB::table('sales_orders')->whereIn('status', ['DELIVERED', 'CLOSED'])->whereBetween('delivery_date', ['2026-09-01', '2026-09-30'])->count();
        DB::statement("INSERT INTO sales_orders SELECT (jsonb_populate_record(NULL::sales_orders, to_jsonb(s) || jsonb_build_object('id', gen_random_uuid(), 'number', s.number || '-P' || g))).*
            FROM sales_orders s, generate_series(1, ?) g WHERE s.id = ?", [$faltan, $base]);
        $reclamos = DB::table('quality_claims')->whereBetween('received_at', ['2026-09-01', '2026-09-30 23:59:59'])->count();
        for ($i = $reclamos; $i < 3; $i++) {
            Cal::registrarReclamo(['customer_id' => DB::table('customers')->value('id'), 'product_id' => DB::table('products')->value('id'), 'claim_type' => 'WRONG_WEIGHT',
                'description' => 'Peso menor al pedido', 'received_at' => '2026-09-20 10:00'], $this->usuario());
        }
        $k = Cal::kpis('2026-09-01', '2026-09-30');
        $this->assertSame(1000, $k['delivered_orders']);
        $this->assertSame(3, $k['claims']);
        $this->assertSame('3.0', $k['claims_per_1000']);
    }

    /* ------------------------------------------------------------ reglas y permisos */

    public function test_no_conformidad_critica_bloquea_el_lote(): void
    {
        $lot = $this->lote('CG-2026-1009');
        $nc = Cal::crearNC(['source' => 'CCP', 'severity' => 'CRITICAL', 'description' => 'Cocción por debajo de 90 °C', 'lot_id' => $lot->id], $this->usuario());
        $this->assertSame('BLOCKED', DB::table('lots')->where('id', $lot->id)->value('qc_status'));
        $this->falla('RN-CAL-03', fn () => Cal::decidir($lot->id, ['decision' => 'RELEASE'], $this->usuario()));
        $this->assertSame($nc->lot_previous_status, 'QUARANTINE');
    }

    public function test_rechazo_exige_motivo_y_destino(): void
    {
        $lot = $this->lote('CH-2026-0412');
        $this->falla('RN-CAL-17', fn () => Cal::decidir($lot->id, ['decision' => 'REJECT', 'reason' => 'Contaminación'], $this->usuario()));
        $d = Cal::decidir($lot->id, ['decision' => 'REJECT', 'reason' => 'Contaminación cruzada', 'reject_destination' => 'WASTE'], $this->usuario());
        $this->assertSame('REJECTED', $d->new_status);
        // RN-CAL-16: una decisión no se edita.
        $this->expectException(QueryException::class);
        DB::table('lot_quality_decisions')->where('id', $d->id)->update(['reason' => 'otra']);
    }

    public function test_reclamo_resuelto_con_nota_de_credito_exige_el_comprobante(): void
    {
        $this->usuario();
        $c = Cal::registrarReclamo(['customer_id' => DB::table('customers')->value('id'), 'product_id' => DB::table('products')->value('id'), 'claim_type' => 'WRONG_WEIGHT',
            'description' => 'Faltaron 200 g'], $this->usuario());
        $this->falla('RN-CAL-12', fn () => Cal::resolverReclamo($c->id, ['status' => 'RESOLVED'], $this->usuario(self::SUPERVISORA)));
        $this->falla('RN-CAL-12', fn () => Cal::resolverReclamo($c->id, ['status' => 'RESOLVED', 'resolution' => 'CREDIT_NOTE'], $this->usuario(self::SUPERVISORA)));
        $r = Cal::resolverReclamo($c->id, ['status' => 'RESOLVED', 'resolution' => 'REPLACEMENT', 'resolution_notes' => 'Se repuso en el siguiente pedido'], $this->usuario(self::SUPERVISORA));
        $this->assertSame('RESOLVED', $r->status);
        $this->falla('RN-CAL-12', fn () => Cal::resolverReclamo($c->id, ['status' => 'RESOLVED', 'resolution' => 'NONE'], $this->usuario(self::OPERARIO)));
    }

    public function test_vehiculo_fuera_de_rango_necesita_aprobacion_para_cargar(): void
    {
        $p = $this->punto('TP-VAN-BXR871');
        $r = Cal::leer(['point_id' => $p->id, 'value_c' => 9, 'context' => 'Carga ruta Miraflores'], $this->usuario());
        $this->assertTrue($r['needs_approval']);
        $this->assertFalse(Cal::cargaPermitida($p->vehicle_id)['ok']);
        Cal::aprobarLectura($r['reading']->id, $this->usuario());
        $this->assertTrue(Cal::cargaPermitida($p->vehicle_id)['ok']);
    }

    public function test_tareas_del_dia_y_cal_diario(): void
    {
        $this->usuario();
        $antes = DB::table('qc_schedule_tasks')->where('task_date', '2026-10-11')->count();
        Artisan::call('cal:diario', ['--fecha' => '2026-10-11']);
        $this->usuario();
        $this->assertGreaterThan($antes, DB::table('qc_schedule_tasks')->where('task_date', '2026-10-11')->count());
        $this->assertSame(0, DB::table('qc_schedule_tasks')->where('task_date', '<', '2026-10-11')->where('status', 'PENDING')->count(), 'Lo pendiente de días anteriores queda incumplido.');
        Artisan::call('cal:diario', ['--fecha' => '2026-10-11']);
        $this->usuario();
        $n = DB::table('qc_schedule_tasks')->where('task_date', '2026-10-11')->count();
        Artisan::call('cal:diario', ['--fecha' => '2026-10-11']);
        $this->usuario();
        $this->assertSame($n, DB::table('qc_schedule_tasks')->where('task_date', '2026-10-11')->count(), 'Correrla otra vez no duplica.');
    }

    public function test_api_calidad(): void
    {
        $this->como(self::CALIDAD)->getJson('/api/v1/cal/lotes')->assertOk()->assertJsonFragment(['code' => 'CH-2026-0412']);
        $lot = $this->lote('ME-2026-1010');
        $this->como(self::CALIDAD)->getJson("/api/v1/cal/lotes/{$lot->id}")->assertOk()->assertJsonFragment(['code' => 'RN-CAL-10']);
        $this->como(self::JEFE)->postJson("/api/v1/cal/lotes/{$lot->id}/decision", ['decision' => 'HOLD', 'reason' => 'x'])->assertStatus(403);
        $this->como(self::CALIDAD)->getJson('/api/v1/cal/puntos')->assertOk()->assertJsonStructure(['data' => [['code', 'light', 'overdue']]]);
        $this->como(self::OPERARIO)->postJson('/api/v1/cal/lecturas', ['point_id' => $this->punto('TP-MAR-L2')->id, 'value_c' => 92])->assertCreated()->assertJsonPath('reading.in_range', true);
        $this->como(self::CALIDAD)->getJson('/api/v1/cal/checklists')->assertOk()->assertJsonFragment(['code' => 'CHK-EMP']);
        $this->como(self::CALIDAD)->getJson('/api/v1/cal/programacion')->assertOk();
        $this->como(self::CALIDAD)->getJson('/api/v1/cal/inspecciones?result=PASS')->assertOk();
        $this->como(self::CALIDAD)->getJson('/api/v1/cal/excursiones')->assertOk();
        $this->como(self::CALIDAD)->getJson('/api/v1/cal/no-conformidades')->assertOk();
        $this->como(self::CALIDAD)->getJson('/api/v1/cal/acciones')->assertOk();
        $this->como(self::CALIDAD)->getJson('/api/v1/cal/sanitarios')->assertOk()->assertJsonPath('can_manage', true);
        $this->como(self::CALIDAD)->getJson('/api/v1/cal/reclamos')->assertOk();
        $this->como(self::CALIDAD)->getJson('/api/v1/cal/limpieza?month=2026-10')->assertOk()->assertJsonStructure(['summary', 'data', 'today']);
        $this->como(self::CALIDAD)->getJson('/api/v1/cal/tablero?month=2026-10')->assertOk()
            ->assertJsonStructure(['first_pass_release_pct', 'rejected_or_held_pct', 'out_of_range_pct', 'open_nc', 'checklist_compliance_pct', 'cleaning_compliance_pct', 'claims_per_1000', 'digesa_without_registry']);
        $this->como(self::CALIDAD)->getJson('/api/v1/cal/opciones')->assertOk()->assertJsonPath('can.release', true)->assertJsonStructure(['customers' => [['id', 'name']]]);
        // CAL-11: la ficha del reclamo trae las notas de crédito del cliente para elegir la compensación (RN-CAL-12).
        $rec = DB::table('quality_claims')->value('id');
        $this->como(self::CALIDAD)->getJson("/api/v1/cal/reclamos/{$rec}")->assertOk()->assertJsonStructure(['credit_notes']);
    }
}
