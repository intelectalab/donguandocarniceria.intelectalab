<?php

namespace Tests\Feature\Modulos;

use App\Models\User;
use App\Modulos\Alm\Services\InventarioService;
use App\Modulos\Rec\Services\RecetasService;
use App\Support\RuleError;
use App\Support\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * REC · Recetas y formulación. CA-REC-01 a 06 de la spec y RN-REC-01, 03, 04, 06, 08, 10, 11 y 12,
 * D-REC-02 (el operario ve solo los kg), costos con permiso y aislamiento entre empresas.
 * Datos de demo: «Chorizo parrillero» (RC-CHO) v1 aprobada y v2 en revisión con 10,3365 kg.
 */
class RecTest extends TestCase
{
    private const JEFE = 'olazo@donguando.pe';          // JEFE_PRODUCCION: edita (autor de las versiones de demo)

    private const CALIDAD = 'sramos@donguando.pe';      // CALIDAD: aprueba, no ve costos

    private const GERENTE = 'rquispe@donguando.pe';     // todo

    private const OPERARIO = 'npoma@donguando.pe';      // OPERARIO_PRODUCCION: solo lee el módulo


    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo(Carbon::parse('2026-11-12 10:00', 'America/Lima'));
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

    private function version(string $receta, int $n): object
    {
        $this->usuario();

        return DB::table('recipe_versions as v')->join('recipes as r', 'r.id', '=', 'v.recipe_id')->where('r.code', $receta)->where('v.version', $n)->first(['v.*']);
    }

    private function variante(string $sku): string
    {
        $this->usuario();

        return DB::table('product_variants')->where('sku', $sku)->value('id');
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

    /** Receta nueva de Bondiola con su versión 1 en borrador, creada por $email. */
    private function nuevaReceta(string $email = self::JEFE, string $tipo = 'OTHER', float $base = 10): array
    {
        $this->usuario();
        $producto = DB::table('products')->where('code', 'BOND')->value('id');

        return $this->como($email)->postJson('/api/v1/rec/recetas', [
            'product_id' => $producto, 'code' => 'RC-BON', 'name' => 'Bondiola curada', 'recipe_type' => $tipo, 'base_output_kg' => $base,
        ])->assertCreated()->json();
    }

    /* ------------------------------------------------------------ criterios de aceptación */

    public function test_ca_rec_01_aprobar_la_version_2_del_chorizo_da_96_74_y_retira_la_version_1(): void
    {
        $v2 = $this->version('RC-CHO', 2);
        $this->assertSame('IN_REVIEW', $v2->status);
        $this->assertEquals(10.3365, RecetasService::totalKg($v2->id));

        $r = $this->como(self::CALIDAD)->postJson("/api/v1/rec/versiones/{$v2->id}/aprobar")->assertOk()->json();

        $this->assertSame('APPROVED', $r['status']);
        $this->assertEquals(96.74, (float) $r['expected_yield_pct']);
        $this->assertSame('RETIRED', $this->version('RC-CHO', 1)->status);
        $this->assertNotNull($this->version('RC-CHO', 1)->retired_at);
        // Sin límite cargado para nitrito y eritorbato: aprueba con advertencia registrada (RN-REC-05, D-REC-01).
        $this->assertStringContainsString('RN-REC-05', $r['approval_warnings']);
        // CALIDAD no ve costos, pero el costo estándar quedó guardado (RN-REC-09).
        $this->assertNull($r['standard_cost_per_kg']);
        $this->assertGreaterThan(0, (float) $this->version('RC-CHO', 2)->standard_cost_per_kg);
        // RN-REC-01: una sola aprobada.
        $this->usuario();
        $this->assertSame(1, DB::table('recipe_versions')->where('recipe_id', $v2->recipe_id)->where('status', 'APPROVED')->count());
        $this->assertSame(1, DB::table('domain_events')->where('event_name', 'recipe_version.approved')->where('aggregate_id', $v2->id)->count());
    }

    public function test_ca_rec_02_la_autora_de_la_version_no_la_aprueba(): void
    {
        $api = $this->como(self::GERENTE);
        $cal = $this->version('RC-CAL', 2);
        $nueva = $api->postJson("/api/v1/rec/recetas/{$cal->recipe_id}/versiones")->assertCreated()->json();

        $api->postJson("/api/v1/rec/versiones/{$nueva['id']}/aprobar")->assertStatus(422)->assertJsonPath('code', 'RN-REC-02');
        $this->falla('RN-REC-02', fn () => RecetasService::aprobar($nueva['id'], $this->usuario(self::GERENTE)));
        // El jefe de producción no tiene el permiso de aprobar.
        $this->como(self::JEFE)->postJson("/api/v1/rec/versiones/{$nueva['id']}/aprobar")->assertForbidden()->assertJsonPath('code', 'PERMISSION_DENIED');
        // Otra persona con el permiso sí.
        $this->como(self::CALIDAD)->postJson("/api/v1/rec/versiones/{$nueva['id']}/aprobar")->assertOk()->assertJsonPath('status', 'APPROVED');
    }

    public function test_ca_rec_03_nitrito_de_145_ppm_con_limite_de_100_no_se_aprueba(): void
    {
        $this->usuario();
        DB::table('food_additives')->where('sin_code', '250')->update(['max_ppm' => 100, 'max_ppm_source' => 'Prueba']);
        $v2 = $this->version('RC-CHO', 2);
        $nitrito = collect(RecetasService::validar($v2->id))->firstWhere('level', 'error');
        $this->assertSame('RN-REC-05', $nitrito['code']);
        $this->assertStringContainsString('145 ppm', $nitrito['msg']);
        $this->assertEquals(145.1, RecetasService::ppm(0.0015, 10.3365));

        $this->como(self::CALIDAD)->postJson("/api/v1/rec/versiones/{$v2->id}/aprobar")->assertStatus(422)->assertJsonPath('code', 'RN-REC-05');
        $this->assertSame('IN_REVIEW', $this->version('RC-CHO', 2)->status);
        $this->assertSame('APPROVED', $this->version('RC-CHO', 1)->status);
    }

    public function test_ca_rec_04_caldo_de_huesos_sin_punto_critico_de_temperatura_no_se_aprueba(): void
    {
        $jefe = $this->como(self::JEFE);
        $cal = $this->version('RC-CAL', 2);
        $nueva = $jefe->postJson("/api/v1/rec/recetas/{$cal->recipe_id}/versiones")->assertCreated()->json();
        $puntos = $jefe->getJson("/api/v1/rec/versiones/{$nueva['id']}/puntos")->assertOk()->json('data');
        $this->assertTrue($jefe->getJson("/api/v1/rec/versiones/{$nueva['id']}/puntos")->json('needs_critical'));
        foreach ($puntos as $p) {
            if (in_array($p['variable'], ['CORE_TEMP', 'TIME'], true)) {
                $jefe->putJson("/api/v1/rec/versiones/{$nueva['id']}/puntos/{$p['id']}", ['is_critical' => false])->assertOk();
            }
        }
        $jefe->postJson("/api/v1/rec/versiones/{$nueva['id']}/enviar")->assertOk()->assertJsonPath('status', 'IN_REVIEW');

        $this->como(self::CALIDAD)->postJson("/api/v1/rec/versiones/{$nueva['id']}/aprobar")->assertStatus(422)->assertJsonPath('code', 'RN-REC-06');
    }

    public function test_ca_rec_05_en_una_version_aprobada_no_cambian_los_kg_de_un_ingrediente(): void
    {
        $v1 = $this->version('RC-CHO', 1);
        $this->usuario();
        $ing = DB::table('recipe_ingredients')->where('version_id', $v1->id)->orderBy('seq')->first();

        $this->como(self::JEFE)->putJson("/api/v1/rec/versiones/{$v1->id}/ingredientes/{$ing->id}", ['qty_kg' => 7.5])
            ->assertStatus(422)->assertJsonPath('code', 'RN-REC-03');
        $this->como(self::JEFE)->deleteJson("/api/v1/rec/ingredientes/{$ing->id}")->assertStatus(422)->assertJsonPath('code', 'RN-REC-03');
        $this->como(self::JEFE)->putJson("/api/v1/rec/versiones/{$v1->id}", ['shelf_life_days' => 30])->assertStatus(422)->assertJsonPath('code', 'RN-REC-03');
        $this->como(self::JEFE)->postJson("/api/v1/rec/versiones/{$v1->id}/pasos", ['description' => 'Paso nuevo'])->assertStatus(422)->assertJsonPath('code', 'RN-REC-03');

        // La base también lo impide, aunque alguien salte el servicio.
        $this->usuario();
        try {
            DB::transaction(fn () => DB::table('recipe_ingredients')->where('id', $ing->id)->update(['qty_kg' => 7.5]));
            $this->fail('La base debió rechazar el cambio.');
        } catch (QueryException $e) {
            $this->assertStringContainsString('RN-REC-03', $e->getMessage());
        }
        try {
            DB::transaction(fn () => DB::table('recipe_versions')->where('id', $v1->id)->update(['base_output_kg' => 12]));
            $this->fail('La base debió rechazar el cambio.');
        } catch (QueryException $e) {
            $this->assertStringContainsString('RN-REC-03', $e->getMessage());
        }
        $this->assertEquals($ing->qty_kg, DB::table('recipe_ingredients')->where('id', $ing->id)->value('qty_kg'));
    }

    public function test_ca_rec_06_costo_estandar_de_15_370_por_kg(): void
    {
        $nueva = $this->nuevaReceta();
        $vid = $nueva['version']['id'];
        $jefe = $this->como(self::JEFE);
        [$carne, $grasa, $sal] = [$this->variante('MP-CER-REC'), $this->variante('MP-CER-GRA'), $this->variante('IN-SAL-KG')];
        $jefe->postJson("/api/v1/rec/versiones/{$vid}/ingredientes", ['variant_id' => $carne, 'qty_kg' => 7])->assertCreated();
        $jefe->postJson("/api/v1/rec/versiones/{$vid}/ingredientes", ['variant_id' => $grasa, 'qty_kg' => 2])->assertCreated();
        $jefe->postJson("/api/v1/rec/versiones/{$vid}/ingredientes", ['variant_id' => $sal, 'qty_kg' => 1])->assertCreated();

        $this->usuario();
        $c = RecetasService::costo($vid, [$carne => 18.50, $grasa => 9.00, $sal => 6.20]);
        $this->assertSame('153.70', $c['total']);
        $this->assertSame('15.3700', $c['per_kg']);
        // Sin simulación, usa el costo promedio vigente de ALM o el estándar de la variante.
        $this->assertNotNull(RecetasService::costo($vid)['per_kg']);
        $this->como(self::JEFE)->getJson("/api/v1/rec/versiones/{$vid}/costo")->assertOk()->assertJsonCount(3, 'rows');
        $this->como(self::CALIDAD)->getJson("/api/v1/rec/versiones/{$vid}/costo")->assertForbidden();
    }

    /* ------------------------------------------------------------ reglas */

    public function test_rn_rec_04_un_aditivo_exige_el_catalogo_con_codigo_sin(): void
    {
        $vid = $this->nuevaReceta()['version']['id'];
        $jefe = $this->como(self::JEFE);
        $jefe->postJson("/api/v1/rec/versiones/{$vid}/ingredientes", ['variant_id' => $this->variante('IN-NIT-KG'), 'qty_kg' => 0.0015, 'is_additive' => true])
            ->assertStatus(422)->assertJsonPath('code', 'RN-REC-04');
        $this->usuario();
        $nitrito = DB::table('food_additives')->where('sin_code', '250')->value('id');
        $ing = $this->como(self::JEFE)->postJson("/api/v1/rec/versiones/{$vid}/ingredientes", ['variant_id' => $this->variante('IN-NIT-KG'), 'qty_kg' => 0.0015,
            'is_additive' => true, 'additive_id' => $nitrito])->assertCreated()->json();
        $this->assertSame('0.0015', $ing['qty_kg']);
        // El catálogo valida el formato del SIN y que no se repita.
        $this->como(self::CALIDAD)->postJson('/api/v1/rec/aditivos', ['sin_code' => 'E-250', 'name' => 'X', 'function_class' => 'PRESERVATIVE'])
            ->assertStatus(422)->assertJsonPath('code', 'RN-REC-04');
        $this->como(self::CALIDAD)->postJson('/api/v1/rec/aditivos', ['sin_code' => '250', 'name' => 'X', 'function_class' => 'PRESERVATIVE'])
            ->assertStatus(422)->assertJsonPath('code', 'RN-REC-04');
        $this->como(self::CALIDAD)->postJson('/api/v1/rec/aditivos', ['sin_code' => '471', 'name' => 'Mono y diglicéridos', 'function_class' => 'EMULSIFIER', 'max_ppm' => 5000])
            ->assertStatus(422)->assertJsonPath('code', 'RN-REC-05');
        $this->como(self::CALIDAD)->postJson('/api/v1/rec/aditivos', ['sin_code' => '471', 'name' => 'Mono y diglicéridos', 'function_class' => 'EMULSIFIER', 'max_ppm' => 5000,
            'max_ppm_source' => 'Codex CXS 192'])->assertCreated()->assertJsonPath('sin_code', '471');
        $this->como(self::OPERARIO)->postJson('/api/v1/rec/aditivos', ['sin_code' => '472', 'name' => 'X', 'function_class' => 'EMULSIFIER'])->assertForbidden();
    }

    public function test_rn_rec_10_11_y_12_vida_util_rendimiento_y_puntos_de_control(): void
    {
        $vid = $this->nuevaReceta(self::JEFE, 'SAUSAGE', 10)['version']['id'];
        $jefe = $this->como(self::JEFE);
        $jefe->postJson("/api/v1/rec/versiones/{$vid}/ingredientes", ['variant_id' => $this->variante('MP-CER-REC'), 'qty_kg' => 2])->assertCreated();
        $jefe->putJson("/api/v1/rec/versiones/{$vid}", ['shelf_life_days' => null])->assertOk();
        $jefe->postJson("/api/v1/rec/versiones/{$vid}/puntos", ['code' => 'PC1', 'variable' => 'CORE_TEMP', 'min_value' => 72, 'max_value' => 68, 'unit' => '°C',
            'is_critical' => true, 'corrective_action' => 'Seguir cocinando'])->assertStatus(422)->assertJsonPath('code', 'RN-REC-12');
        $jefe->postJson("/api/v1/rec/versiones/{$vid}/puntos", ['code' => 'PC1', 'variable' => 'CORE_TEMP', 'min_value' => 68, 'max_value' => 72, 'unit' => '°C',
            'is_critical' => true, 'corrective_action' => ' '])->assertStatus(422);

        $this->usuario();
        $codigos = collect(RecetasService::validar($vid))->where('level', 'error')->pluck('code')->all();
        // Sin vida útil (RN-REC-10), 10 kg de 2 kg es 500 % (RN-REC-11) y sin punto crítico (RN-REC-06).
        $this->assertEqualsCanonicalizing(['RN-REC-10', 'RN-REC-11', 'RN-REC-06'], $codigos);
        $this->como(self::CALIDAD)->postJson("/api/v1/rec/versiones/{$vid}/aprobar")->assertStatus(422)->assertJsonPath('code', 'RN-REC-10');

        $jefe = $this->como(self::JEFE);
        $jefe->putJson("/api/v1/rec/versiones/{$vid}", ['shelf_life_days' => 21, 'base_output_kg' => 1.9])->assertOk();
        $jefe->postJson("/api/v1/rec/versiones/{$vid}/pasos", ['description' => 'Cocinar', 'duration_min' => 30, 'equipment_category' => 'POT'])->assertCreated();
        $jefe->postJson("/api/v1/rec/versiones/{$vid}/puntos", ['code' => 'PC1', 'variable' => 'CORE_TEMP', 'min_value' => 68, 'max_value' => 72, 'unit' => '°C',
            'is_critical' => true, 'corrective_action' => 'Seguir cocinando hasta 68 °C', 'step_seq' => 1])->assertCreated();
        $this->como(self::CALIDAD)->postJson("/api/v1/rec/versiones/{$vid}/aprobar")->assertOk()->assertJsonPath('expected_yield_pct', '95.0000');
    }

    public function test_rn_rec_07_los_alergenos_se_calculan_de_los_ingredientes_al_aprobar(): void
    {
        $vid = $this->nuevaReceta()['version']['id'];
        $jefe = $this->como(self::JEFE);
        $jefe->postJson("/api/v1/rec/versiones/{$vid}/ingredientes", ['variant_id' => $this->variante('MP-CER-REC'), 'qty_kg' => 9])->assertCreated();
        $jefe->postJson("/api/v1/rec/versiones/{$vid}/ingredientes", ['variant_id' => $this->variante('IN-ESP-KG'), 'qty_kg' => 0.5, 'allergen' => 'Mostaza'])->assertCreated();
        $jefe->putJson("/api/v1/rec/versiones/{$vid}", ['shelf_life_days' => 30])->assertOk();
        $r = $this->como(self::CALIDAD)->postJson("/api/v1/rec/versiones/{$vid}/aprobar")->assertOk()->json();
        $this->assertSame(['Mostaza'], $r['allergens']);
        $this->assertEquals(105.26, (float) $r['expected_yield_pct']);
    }

    public function test_rn_rec_08_el_escalado_es_lineal_a_tres_decimales(): void
    {
        $v1 = $this->version('RC-CHO', 1);
        $e = $this->como(self::JEFE)->getJson("/api/v1/rec/versiones/{$v1->id}/escalado?kg=25")->assertOk()->json();
        $this->assertSame('2.500000', $e['factor']);
        $this->usuario();
        foreach (RecetasService::ingredientes($v1->id) as $i => $ing) {
            $this->assertSame(number_format(round((float) $ing->qty_kg * 2.5, 3), 3, '.', ''), $e['lines'][$i]['kg']);
        }
        $this->assertSame(number_format(round(0.0015 * 2.5, 3), 3, '.', ''), '0.004');
    }

    public function test_nueva_version_copia_la_vigente_y_solo_hay_una_en_curso(): void
    {
        $jefe = $this->como(self::JEFE);
        $cho = $this->version('RC-CHO', 1);
        // La v2 sigue en revisión: no se crea otra.
        $jefe->postJson("/api/v1/rec/recetas/{$cho->recipe_id}/versiones")->assertStatus(422)->assertJsonPath('code', 'RN-REC-03');

        $mag = $this->version('RC-MAG', 1);
        $n = $this->como(self::JEFE)->postJson("/api/v1/rec/recetas/{$mag->recipe_id}/versiones")->assertCreated()->json();
        $this->assertSame(2, $n['version']);
        $this->assertSame('DRAFT', $n['status']);
        $this->usuario();
        foreach (['recipe_ingredients', 'recipe_steps', 'recipe_control_points'] as $t) {
            $this->assertSame(DB::table($t)->where('version_id', $mag->id)->count(), DB::table($t)->where('version_id', $n['id'])->count(), $t);
        }
        // Devolver a borrador exige comentario; el borrador se puede borrar.
        $jefe = $this->como(self::JEFE);
        $jefe->postJson("/api/v1/rec/versiones/{$n['id']}/enviar")->assertOk();
        $jefe->postJson("/api/v1/rec/versiones/{$n['id']}/devolver", ['reason' => 'x'])->assertStatus(422);
        $this->como(self::CALIDAD)->postJson("/api/v1/rec/versiones/{$n['id']}/devolver", ['reason' => 'Falta el punto de °Brix'])->assertOk()->assertJsonPath('status', 'DRAFT');
        $this->como(self::JEFE)->deleteJson("/api/v1/rec/versiones/{$n['id']}")->assertNoContent();
        $this->usuario();
        $this->assertFalse(DB::table('recipe_versions')->where('id', $n['id'])->exists());
    }

    public function test_los_pasos_se_reordenan_con_sus_puntos_de_control(): void
    {
        $vid = $this->nuevaReceta()['version']['id'];
        $jefe = $this->como(self::JEFE);
        $a = $jefe->postJson("/api/v1/rec/versiones/{$vid}/pasos", ['description' => 'Moler'])->assertCreated()->json();
        $jefe->postJson("/api/v1/rec/versiones/{$vid}/pasos", ['description' => 'Cocinar', 'duration_min' => 40])->assertCreated();
        $jefe->postJson("/api/v1/rec/versiones/{$vid}/puntos", ['code' => 'PC1', 'variable' => 'CORE_TEMP', 'min_value' => 0, 'max_value' => 4, 'unit' => '°C',
            'corrective_action' => 'Enfriar', 'step_seq' => 1])->assertCreated();
        $jefe->postJson("/api/v1/rec/pasos/{$a['id']}/mover", ['dir' => 1])->assertNoContent();
        $p = $jefe->getJson("/api/v1/rec/versiones/{$vid}/pasos")->assertOk()->json('data');
        $this->assertSame(['Cocinar', 'Moler'], array_column($p, 'description'));
        $this->assertSame('PC1', $p[1]['control_points'][0]['code']);
    }

    public function test_d_rec_02_el_operario_ve_los_kg_pero_no_la_receta_ni_el_costo(): void
    {
        $v1 = $this->version('RC-CHO', 1);
        $op = $this->como(self::OPERARIO);
        $op->getJson('/api/v1/rec/recetas')->assertForbidden()->assertJsonPath('code', 'D-REC-02');
        $op->getJson("/api/v1/rec/versiones/{$v1->id}/ingredientes")->assertForbidden();
        $e = $op->getJson("/api/v1/rec/versiones/{$v1->id}/escalado?kg=20")->assertOk()->json();
        $this->assertNull($e['batch_cost']);
        $this->assertArrayNotHasKey('packaging', $e);
        $op->getJson('/api/v1/rec/costos')->assertForbidden();
    }

    public function test_los_costos_solo_se_ven_con_permiso_y_el_recalculo_avisa(): void
    {
        $this->como(self::CALIDAD)->getJson('/api/v1/rec/recetas?per_page=50')->assertOk()->assertJsonPath('data.0.current_cost_per_kg', null);
        $con = $this->como(self::JEFE)->getJson('/api/v1/rec/recetas?per_page=50')->assertOk()->json('data');
        $this->assertNotNull(collect($con)->firstWhere('code', 'RC-CHO')['current_cost_per_kg']);

        $this->usuario();
        // Entra agua cara por ALM (la única puerta del stock): sube el costo promedio vigente del chorizo.
        InventarioService::mover(['type' => 'RECEIPT', 'warehouse_id' => DB::table('warehouses')->where('code', 'ALM-L1')->value('id'),
            'variant_id' => $this->variante('IN-AGUA-KG'), 'qty' => 1000, 'unit_cost' => 50, 'source_type' => 'TEST', 'reason' => 'Prueba de REC'], $this->usuario());
        $r = $this->como(self::JEFE)->postJson('/api/v1/rec/costos/recalcular')->assertOk()->json();
        $this->assertGreaterThan(0, $r['alerts']);
        $this->usuario();
        $this->assertTrue(DB::table('notifications')->where('role', 'JEFE_PRODUCCION')->where('module', 'REC')->where('title', 'like', 'Costo de Chorizo%')->exists());
        $lista = $this->como(self::JEFE)->getJson('/api/v1/rec/costos')->assertOk()->json();
        $this->assertTrue(collect($lista['data'])->firstWhere('code', 'RC-CHO')['alert']);
    }

    public function test_cada_empresa_ve_solo_sus_recetas(): void
    {
        $v1 = $this->version('RC-CHO', 1);
        $cs = $this->como('hsalas@carnesselectas.pe', self::CS);
        $cs->getJson('/api/v1/rec/recetas')->assertOk()->assertJsonPath('total', 0);
        $cs->getJson("/api/v1/rec/versiones/{$v1->id}")->assertNotFound();
        $cs->getJson("/api/v1/rec/recetas/{$v1->recipe_id}")->assertNotFound();
        $cs->postJson("/api/v1/rec/versiones/{$v1->id}/aprobar")->assertNotFound();
        $this->como(self::GERENTE)->getJson('/api/v1/rec/recetas')->assertOk()->assertJsonPath('total', 12);
    }

    public function test_las_pantallas_responden_con_datos_de_demo(): void
    {
        $api = $this->como(self::GERENTE);
        $v1 = $this->version('RC-CHO', 1);
        $api->getJson('/api/v1/rec/opciones')->assertOk()->assertJsonPath('see_cost', true);
        foreach (['01', '04', '07'] as $p) {
            $api->getJson("/api/v1/rec/cifras/{$p}")->assertOk();
        }
        $api->getJson("/api/v1/rec/recetas/{$v1->recipe_id}")->assertOk()->assertJsonCount(2, 'versions');
        $api->getJson('/api/v1/rec/versiones?status=APPROVED')->assertOk();
        $api->getJson("/api/v1/rec/versiones/{$v1->id}")->assertOk()->assertJsonPath('status', 'APPROVED');
        $api->getJson("/api/v1/rec/versiones/{$v1->id}/ingredientes")->assertOk()->assertJsonPath('total_kg', '10.4515');
        $api->getJson("/api/v1/rec/versiones/{$v1->id}/pasos")->assertOk();
        $api->getJson("/api/v1/rec/versiones/{$v1->id}/puntos")->assertOk()->assertJsonPath('has_critical', true);
        $v2 = $this->version('RC-CHO', 2);
        $rev = $api->getJson("/api/v1/rec/versiones/{$v2->id}/revision")->assertOk()->json();
        $this->assertSame(1, $rev['previous']['version']);
        $api->getJson("/api/v1/rec/versiones/{$v1->id}/ficha")->assertOk()->assertJsonPath('recipe_code', 'RC-CHO');
        $api->getJson('/api/v1/rec/aditivos')->assertOk()->assertJsonPath('total', 11);
        $this->usuario();
        $api->getJson('/api/v1/rec/aditivos/'.DB::table('food_additives')->where('sin_code', '250')->value('id'))->assertOk();
        $this->como(self::GERENTE)->getJson('/api/v1/rec/costos')->assertOk()->assertJsonPath('kpi.approved', 11);
    }
}
