<?php

namespace Tests\Feature\Modulos;

use App\Models\User;
use App\Modulos\Alm\Services\InventarioService;
use App\Modulos\Plt\Services\Periodos;
use App\Modulos\Pro\Services\ProduccionService as Pro;
use App\Modulos\Rec\Services\RecetasService;
use App\Support\RuleError;
use App\Support\TenantContext;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * PRO · Órdenes de producción. CA-PRO-01 a 08 de la spec, permisos del operario (RN-PRO-09), alcance por local,
 * anulación (RN-PRO-14) y las rutas de la API. Fecha de las pruebas: 10/10/2026, la de los criterios.
 * Datos de demo: líneas L1-EMB (embutidos, local 1) y L2-CAL (caldos, local 2); la receta «Chorizo parrillero»
 * tiene la v1 aprobada y la v2 en revisión; el caldo de huesos OP01-0109 está en curso.
 */
class ProTest extends TestCase
{
    private const JEFE = 'olazo@donguando.pe';         // JEFE_PRODUCCION

    private const OPERARIO = 'npoma@donguando.pe';     // OPERARIO_PRODUCCION

    private const CALIDAD = 'sramos@donguando.pe';     // CALIDAD: aprueba recetas

    private const GERENTE = 'rquispe@donguando.pe';

    private const CONTADORA = 'mcardenas@donguando.pe';

    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo(Carbon::parse('2026-10-10 10:00', 'America/Lima'));
    }

    /* ------------------------------------------------------------ ayudas */

    /** @var array<string, string> */
    private array $tokens = [];

    private function como(string $email): static
    {
        return $this->desde(self::DG, $this->tokens[$email] ??= $this->ingresar(self::DG, $email));
    }

    private function usuario(string $email = self::JEFE): User
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

    private function linea(string $codigo): object
    {
        $this->usuario();

        return DB::table('production_lines')->where('code', $codigo)->first();
    }

    private function variante(string $sku): object
    {
        return DB::table('product_variants')->where('sku', $sku)->first();
    }

    private function receta(string $codigo): object
    {
        return DB::table('recipes')->where('code', $codigo)->first();
    }

    /** Orden de chorizo en la línea de embutidos, liberada. */
    private function ordenChorizo(float $kg = 25.0, string $linea = 'L1-EMB'): object
    {
        $jefe = $this->usuario();
        $o = Pro::crearOrden(['order_type' => 'RECIPE', 'line_id' => $this->linea($linea)->id, 'recipe_id' => $this->receta('RC-CHO')->id, 'planned_output_kg' => $kg], $jefe);

        return Pro::liberar($o->id, $jefe);
    }

    /** Lote de compra con stock en el almacén de insumos del local 1. */
    private function loteConStock(string $sku, string $codigo, string $vence, float $kg, float $costo, string $estado = 'RELEASED', string $linea = 'L1-EMB'): string
    {
        $jefe = $this->usuario();
        $v = $this->variante($sku);
        $lot = DB::table('lots')->insertGetId(['product_id' => $v->product_id, 'variant_id' => $v->id, 'code' => $codigo, 'origin' => 'PURCHASE',
            'production_date' => '2026-10-01', 'expiry_date' => $vence, 'qc_status' => 'RELEASED', 'unit_cost' => $costo], 'id');
        InventarioService::mover(['type' => 'RECEIPT', 'warehouse_id' => $this->linea($linea)->input_warehouse_id, 'variant_id' => $v->id, 'lot_id' => $lot,
            'qty' => $kg, 'weight_kg' => $kg, 'unit_cost' => $costo, 'source_type' => 'TEST', 'reason' => 'Prueba'], $jefe);
        if ($estado !== 'RELEASED') {
            DB::table('lots')->where('id', $lot)->update(['qc_status' => $estado]);
        }

        return $lot;
    }

    /** Ningún otro lote de la variante queda disponible, para que FEFO solo vea los de la prueba. */
    private function bloquearLotesDe(string $sku): void
    {
        $this->usuario();
        DB::statement("SELECT set_config('app.cal_decision', 'on', true)");
        DB::table('lots')->where('variant_id', $this->variante($sku)->id)->where('qc_status', 'RELEASED')->update(['qc_status' => 'BLOCKED']);
    }

    /**
     * Fija el registro de CA-PRO-02: materia prima S/ 370,60 (18,53 kg), insumos S/ 41,80 (7,31 kg), empaques S/ 18,60,
     * 2 operarios × 4 h × S/ 9,50, embutidora 3 h × S/ 4, selladora 1 h × S/ 2,50, molino 1 h × S/ 3 y 24,2 kg de chorizo.
     */
    private function registroChorizo(object $o): void
    {
        $this->usuario();
        $mov = DB::table('stock_movements')->value('id');
        $wh = $this->linea('L1-EMB')->input_warehouse_id;
        foreach ([['MP-CER-REC', 'RAW_MATERIAL', 13.53, 270.60], ['MP-CER-GRA', 'RAW_MATERIAL', 5.00, 100.00], ['IN-AGUA-KG', 'INPUT', 6.31, 6.31],
            ['IN-AJI-KG', 'INPUT', 1.00, 35.49], ['EM-VAC-2030', 'PACKAGING', 24, 18.60]] as [$sku, $rol, $kg, $costo]) {
            DB::table('production_order_consumptions')->insert(['order_id' => $o->id, 'warehouse_id' => $wh, 'variant_id' => $this->variante($sku)->id, 'role' => $rol,
                'qty' => $kg, 'weight_kg' => $rol === 'PACKAGING' ? null : $kg, 'unit_cost' => round($costo / $kg, 4), 'total_cost' => $costo, 'consumed_at' => now(), 'stock_movement_id' => $mov]);
        }
        $emp = DB::table('employees')->where('status', 'ACTIVE')->limit(2)->pluck('id');
        foreach ($emp as $e) {
            DB::table('production_order_labor')->insert(['order_id' => $o->id, 'employee_id' => $e, 'task_role' => 'SAUSAGE_MAKER', 'work_date' => '2026-10-10', 'hours' => 4, 'hourly_rate' => 9.5, 'cost' => 38]);
        }
        $eq = DB::table('equipment')->limit(3)->pluck('id');
        foreach ([[3, 4.00], [1, 2.50], [1, 3.00]] as $i => [$h, $t]) {
            DB::table('production_order_equipment')->insert(['order_id' => $o->id, 'equipment_id' => $eq[$i], 'hours' => $h, 'hourly_rate' => $t, 'cost' => $h * $t, 'used_on' => '2026-10-10']);
        }
        $lot = DB::table('lots')->value('id');
        DB::table('production_order_outputs')->insert(['order_id' => $o->id, 'output_role' => 'MAIN', 'variant_id' => $o->output_variant_id, 'lot_id' => $lot,
            'qty' => 24.2, 'weight_kg' => 24.2, 'at' => now()]);
        DB::table('production_orders')->where('id', $o->id)->update(['status' => 'IN_PROGRESS', 'expected_yield_pct' => 96.74]);
    }

    /* ------------------------------------------------------------ criterios de aceptación */

    public function test_ca_pro_01_orden_de_25_kg_escala_la_receta_aprobada(): void
    {
        $this->usuario();
        $v2 = DB::table('recipe_versions')->where('recipe_id', $this->receta('RC-CHO')->id)->where('version', 2)->first();
        RecetasService::aprobar($v2->id, $this->usuario(self::CALIDAD));

        $o = $this->ordenChorizo(25.0);
        $this->assertSame($v2->id, $o->recipe_version_id, 'La versión aprobada queda fija en la orden (RN-PRO-01).');
        $this->assertEqualsWithDelta(2.5, (float) $o->scale_factor, 0.000001);
        $teo = Pro::teoricos($o);
        $this->assertSame('17.500', $teo[$this->variante('MP-CER-REC')->id]['kg']);

        // RN-PRO-01: sin versión aprobada no se crea.
        $this->falla('RN-PRO-01', fn () => Pro::crearOrden(['order_type' => 'RECIPE', 'line_id' => $this->linea('L1-EMB')->id,
            'recipe_id' => $this->receta('RC-CHC')->id, 'planned_output_kg' => 10], $this->usuario()));
    }

    public function test_ca_pro_02_costo_de_la_orden_y_costo_por_kg(): void
    {
        $o = $this->ordenChorizo();
        $this->registroChorizo($o);

        $r = Pro::resumen($o->id);
        $this->assertSame('370.60', $r['raw_material_cost']);
        $this->assertSame('41.80', $r['input_cost']);
        $this->assertSame('18.60', $r['packaging_cost']);
        $this->assertSame('76.00', $r['labor_cost']);
        $this->assertSame('17.50', $r['equipment_cost']);
        $this->assertSame('524.50', $r['total_cost']);
        $this->assertSame('21.6736', $r['cost_per_kg']);
    }

    public function test_ca_pro_03_desviacion_de_rendimiento_sin_motivo_se_rechaza(): void
    {
        $o = $this->ordenChorizo();
        $this->registroChorizo($o);
        $r = Pro::resumen($o->id);
        $this->assertSame('25.840', $r['input_kg']);
        $this->assertSame('93.65', $r['actual_yield_pct']);
        $this->assertSame('-3.09', $r['yield_deviation_pp']);
        $this->assertTrue($r['needs_yield_reason']);

        $e = $this->falla('RN-PRO-06', fn () => Pro::cerrar($o->id, [], $this->usuario()));
        $this->assertStringContainsString('93,65 %', $e->getMessage());

        $c = Pro::cerrar($o->id, ['yield_deviation_reason' => 'Recortes con más agua de lo habitual'], $this->usuario());
        $this->assertSame('CLOSED', $c->status);
        $this->assertSame('21.6736', number_format((float) $c->cost_per_kg, 4, '.', ''));
        $this->assertDatabaseHas('domain_events', ['event_name' => 'production_order.closed', 'aggregate_id' => $o->id]);
    }

    public function test_ca_pro_04_lote_en_cuarentena_no_se_consume(): void
    {
        // El operario de la demo trabaja en el local 2.
        $o = $this->ordenChorizo(25.0, 'L2-MAN');
        $lot = $this->loteConStock('MP-CER-REC', 'T-CER-Q01', '2026-10-20', 20, 18, 'QUARANTINE', 'L2-MAN');
        $e = $this->falla('RN-PRO-02', fn () => Pro::consumir($o->id, ['lot_id' => $lot, 'qty' => 5], $this->usuario(self::OPERARIO)));
        $this->assertStringContainsString('T-CER-Q01', $e->getMessage());
        $this->assertSame(0, DB::table('production_order_consumptions')->where('order_id', $o->id)->count());
    }

    public function test_ca_pro_05_fefo_exige_motivo_para_el_lote_que_vence_despues(): void
    {
        $this->bloquearLotesDe('MP-CER-REC');
        $o = $this->ordenChorizo();
        $this->loteConStock('MP-CER-REC', 'T-CER-1410', '2026-10-14', 20, 18);
        $tarde = $this->loteConStock('MP-CER-REC', 'T-CER-1810', '2026-10-18', 20, 19);

        $e = $this->falla('RN-PRO-03', fn () => Pro::consumir($o->id, ['lot_id' => $tarde, 'qty' => 5], $this->usuario()));
        $this->assertStringContainsString('T-CER-1410', $e->getMessage());
        $this->assertStringContainsString('14/10/2026', $e->getMessage());
        $c = Pro::consumir($o->id, ['lot_id' => $tarde, 'qty' => 5, 'fefo_override_reason' => 'El lote del 14/10 está reservado para pedidos'], $this->usuario());
        $this->assertSame('RAW_MATERIAL', $c->role);
        $this->assertEqualsWithDelta(95.0, (float) $c->total_cost, 0.001);
        $this->assertNotNull($c->stock_movement_id, 'El consumo guarda su movimiento de ALM (RN-PRO-13).');
        $this->assertSame('IN_PROGRESS', DB::table('production_orders')->where('id', $o->id)->value('status'));

        // Por FEFO, el del 14/10 entra sin motivo.
        $ok = Pro::consumir($o->id, ['lot_code' => 'T-CER-1410', 'qty' => 2], $this->usuario());
        $this->assertNull($ok->fefo_override_reason);
    }

    public function test_el_operario_no_toma_otro_lote_que_el_fefo(): void
    {
        $this->bloquearLotesDe('MP-CER-REC');
        $o = $this->ordenChorizo(25.0, 'L2-MAN');
        $this->loteConStock('MP-CER-REC', 'T-CER-1410', '2026-10-14', 20, 18, 'RELEASED', 'L2-MAN');
        $tarde = $this->loteConStock('MP-CER-REC', 'T-CER-1810', '2026-10-18', 20, 19, 'RELEASED', 'L2-MAN');
        $e = $this->falla('RN-PRO-03', fn () => Pro::consumir($o->id, ['lot_id' => $tarde, 'qty' => 5, 'fefo_override_reason' => 'Pedido del cliente'], $this->usuario(self::OPERARIO)));
        $this->assertStringContainsString('jefe de producción', $e->getMessage());
    }

    public function test_alcance_por_local(): void
    {
        // El operario es del local 2: no registra en una orden del local 1 ni la ve en la lista.
        $o = $this->ordenChorizo();
        $this->falla('RN-PRO-09', fn () => Pro::producir($o->id, ['output_role' => 'WASTE', 'weight_kg' => 1, 'waste_reason' => 'x'], $this->usuario(self::OPERARIO)));
        $lista = $this->como(self::OPERARIO)->getJson('/api/v1/pro/ordenes?per_page=200')->assertOk()->json('data');
        $locales = array_unique(array_column($lista, 'establishment_name'));
        $this->assertSame(['Local 2'], array_values($locales));
        $this->como(self::OPERARIO)->getJson("/api/v1/pro/ordenes/{$o->id}")->assertNotFound();
    }

    public function test_ca_pro_06_lote_producido_como_liberado_queda_en_cuarentena(): void
    {
        $o = $this->ordenChorizo();
        // La demo ya trae un CH-2026-0412: se renombra para registrar el del criterio.
        DB::table('lots')->where('code', 'CH-2026-0412')->update(['code' => 'CH-2026-0412-D']);
        $s = Pro::producir($o->id, ['output_role' => 'MAIN', 'weight_kg' => 24.2, 'lot_code' => 'CH-2026-0412', 'qc_status' => 'RELEASED'], $this->usuario());
        $this->assertSame('CH-2026-0412', $s->lot_code);
        $this->assertSame('QUARANTINE', $s->qc_status);
        $this->assertSame('RELEASED', $s->requested_qc_status);
        $this->assertNotNull($s->stock_movement_id, 'El lote entra al stock con PRODUCTION_IN (RN-PRO-13).');
        $this->assertSame('PRODUCTION', DB::table('lots')->where('id', $s->lot_id)->value('origin'));

        // La base hace lo mismo con un INSERT directo, y un UPDATE sin decisión de calidad se rechaza (RN-CAL-01).
        $v = DB::table('lots')->where('id', $s->lot_id)->first();
        $otro = DB::table('lots')->insertGetId(['product_id' => $v->product_id, 'variant_id' => $v->variant_id, 'code' => 'CH-2026-0413', 'origin' => 'PRODUCTION',
            'expiry_date' => '2026-10-30', 'qc_status' => 'RELEASED', 'unit_cost' => 0], 'id');
        $this->assertSame('QUARANTINE', DB::table('lots')->where('id', $otro)->value('qc_status'));
        try {
            DB::transaction(fn () => DB::table('lots')->where('id', $otro)->update(['qc_status' => 'RELEASED']));
            $this->fail('El lote de producción no se libera sin decisión de calidad.');
        } catch (\Illuminate\Database\QueryException $e) {
            $this->assertStringContainsString('RN-CAL-01', $e->getMessage());
        }
    }

    public function test_ca_pro_07_punto_critico_fuera_de_rango_exige_accion_correctiva(): void
    {
        $this->usuario();
        $o = DB::table('production_orders')->where('number', 'OP01-0109')->first();
        $pc = DB::table('recipe_control_points')->where('version_id', $o->recipe_version_id)->where('code', 'PC1')->first();
        $this->assertTrue((bool) $pc->is_critical);

        $e = $this->falla('RN-PRO-11', fn () => Pro::lectura($o->id, ['control_point_id' => $pc->id, 'value' => 82], $this->usuario(self::OPERARIO)));
        $this->assertStringContainsString('90,0–100,0', $e->getMessage());

        $l = Pro::lectura($o->id, ['control_point_id' => $pc->id, 'value' => 82, 'corrective_action' => 'Se prolonga la cocción 20 min y se vuelve a medir'], $this->usuario(self::OPERARIO));
        $this->assertFalse((bool) $l->in_range);
        $this->assertTrue((bool) DB::table('production_orders')->where('id', $o->id)->value('critical_deviation'));
        $this->assertTrue(DB::table('notifications')->where('module', 'PRO')->where('title', 'like', '%OP01-0109%')->exists());
    }

    public function test_ca_pro_08_no_se_cierra_en_un_periodo_cerrado(): void
    {
        $o = $this->ordenChorizo();
        $this->registroChorizo($o);
        $g = $this->usuario(self::GERENTE);
        $empresa = DB::table('production_orders')->where('id', $o->id)->value('company_id');
        DB::table('accounting_periods')->where('company_id', $empresa)->where('period', '<', '2026-09-01')->update(['status' => 'CLOSED']);
        if (! Periodos::cerrado('2026-09-30', $empresa)) {
            Periodos::cerrar($empresa, '2026-09-01', $g);
        }

        $e = $this->falla('RN-PRO-10', fn () => Pro::cerrar($o->id, ['close_date' => '2026-09-30', 'yield_deviation_reason' => 'x'], $this->usuario()));
        $this->assertStringContainsString('30/09/2026', $e->getMessage());
    }

    /* ------------------------------------------------------------ reglas y permisos */

    public function test_el_operario_no_crea_ni_cierra_ni_cambia_tarifas(): void
    {
        $op = $this->usuario(self::OPERARIO);
        $this->falla('RN-PRO-09', fn () => Pro::crearOrden(['order_type' => 'RECIPE', 'line_id' => $this->linea('L1-EMB')->id,
            'recipe_id' => $this->receta('RC-CHO')->id, 'planned_output_kg' => 10], $this->usuario(self::OPERARIO)));
        $o = $this->ordenChorizo(25.0, 'L2-MAN');
        $this->falla('RN-PRO-09', fn () => Pro::cerrar($o->id, [], $this->usuario(self::OPERARIO)));
        $emp = DB::table('employees')->where('status', 'ACTIVE')->value('id');
        $this->falla('RN-PRO-09', fn () => Pro::personal($o->id, ['employee_id' => $emp, 'hours' => 4, 'hourly_rate' => 15], $this->usuario(self::OPERARIO)));
        $l = Pro::personal($o->id, ['employee_id' => $emp, 'hours' => 4, 'task_role' => 'SAUSAGE_MAKER'], $this->usuario(self::OPERARIO));
        $this->assertSame('PARAM', $l->rate_source);
        $this->assertEqualsWithDelta(38.0, (float) $l->cost, 0.001);
        // RN-PRO-16
        $this->falla('RN-PRO-16', fn () => Pro::personal($o->id, ['employee_id' => $emp, 'hours' => 13], $this->usuario(self::OPERARIO)));
        $this->assertNotNull($op);
    }

    public function test_equipo_fuera_de_servicio_no_se_registra(): void
    {
        $o = $this->ordenChorizo();
        $mol = DB::table('equipment')->where('code', 'MOL-L1-01')->value('id');
        $this->falla('RN-EQU-04', fn () => Pro::equipo($o->id, ['equipment_id' => $mol, 'hours' => 1], $this->usuario()));
        $sel = DB::table('equipment')->where('code', 'SEL-L1-01')->value('id');
        $e = Pro::equipo($o->id, ['equipment_id' => $sel, 'hours' => 1.5], $this->usuario());
        $this->assertNotNull($e->equipment_usage_id, 'EQU registra el uso (fuente PRO).');
        $this->assertSame('PRO', DB::table('equipment_usage')->where('id', $e->equipment_usage_id)->value('source'));
    }

    public function test_anulacion_solo_sin_movimientos_y_con_motivo(): void
    {
        $o = $this->ordenChorizo();
        $this->falla('RN-PRO-14', fn () => Pro::anular($o->id, '', $this->usuario()));
        $a = Pro::anular($o->id, 'Se canceló el pedido del cliente', $this->usuario());
        $this->assertSame('VOIDED', $a->status);
        $this->falla('RN-PRO-04', fn () => Pro::producir($o->id, ['weight_kg' => 1], $this->usuario()));

        $this->usuario();
        $conMov = DB::table('production_orders')->where('number', 'OP01-0107')->value('id');
        $this->falla('RN-PRO-14', fn () => Pro::anular($conMov, 'Ya no se necesita', $this->usuario()));
    }

    public function test_merma_sin_motivo_se_rechaza(): void
    {
        $o = $this->ordenChorizo(25.0, 'L2-MAN');
        $this->falla('RN-PRO-08', fn () => Pro::producir($o->id, ['output_role' => 'WASTE', 'weight_kg' => 0.4], $this->usuario(self::OPERARIO)));
        $s = Pro::producir($o->id, ['output_role' => 'WASTE', 'weight_kg' => 0.4, 'waste_reason' => 'Tripa rota'], $this->usuario(self::OPERARIO));
        $this->assertNull($s->lot_id);
    }

    /* ------------------------------------------------------------ API */

    public function test_api_lista_ficha_y_registro_desde_la_tableta(): void
    {
        $lista = $this->como(self::JEFE)->getJson('/api/v1/pro/ordenes?status=CLOSED&per_page=5')->assertOk();
        $this->assertNotEmpty($lista->json('data'));
        $this->assertArrayHasKey('yield_light', $lista->json('data.0'));

        $o = $this->como(self::JEFE)->postJson('/api/v1/pro/ordenes', ['order_type' => 'RECIPE', 'line_id' => $this->linea('L2-MAN')->id,
            'recipe_id' => $this->receta('RC-CHO')->id, 'planned_output_kg' => 25])->assertCreated()->json();
        $this->assertSame('PLANNED', $o['status']);
        $this->como(self::OPERARIO)->postJson("/api/v1/pro/ordenes/{$o['id']}/liberar")->assertStatus(403);
        $this->como(self::JEFE)->postJson("/api/v1/pro/ordenes/{$o['id']}/liberar")->assertOk()->assertJsonPath('status', 'RELEASED');

        $this->como(self::OPERARIO)->postJson("/api/v1/pro/ordenes/{$o['id']}/produccion", ['output_role' => 'WASTE', 'weight_kg' => 0.3])
            ->assertStatus(422)->assertJsonPath('code', 'RN-PRO-08');
        $this->como(self::OPERARIO)->getJson("/api/v1/pro/ordenes/{$o['id']}/consumo-teorico")->assertOk()->assertJsonFragment(['sku' => 'MP-CER-REC']);

        $ficha = $this->como(self::JEFE)->getJson("/api/v1/pro/ordenes/{$o['id']}")->assertOk();
        $this->assertSame('RC-CHO', $ficha->json('order.recipe_code'));
        $this->assertArrayHasKey('summary', $ficha->json());

        // El operario no ve costos (pro.cost.view).
        $op = $this->como(self::OPERARIO)->getJson("/api/v1/pro/ordenes/{$o['id']}")->assertOk();
        $this->assertNull($op->json('summary.total_cost'));

        $this->como(self::JEFE)->getJson('/api/v1/pro/tablero?month=2026-09')->assertOk()->assertJsonStructure(['kpis' => ['produced_kg', 'yield_vs_expected_pp', 'waste_pct', 'cost_per_kg', 'productivity_kg_h', 'plan_compliance_pct']]);
        $this->como(self::JEFE)->getJson('/api/v1/pro/plan?from=2026-10-12')->assertOk()->assertJsonStructure(['data', 'from', 'to']);
        $this->como(self::JEFE)->getJson('/api/v1/pro/requerimiento?from=2026-10-12')->assertOk()->assertJsonStructure(['data']);
        $this->como(self::JEFE)->getJson('/api/v1/pro/lineas')->assertOk()->assertJsonFragment(['code' => 'L1-EMB']);
        $this->como(self::CONTADORA)->getJson('/api/v1/pro/ordenes')->assertStatus(403);
    }
}
