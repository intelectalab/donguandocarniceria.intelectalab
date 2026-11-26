<?php

namespace Tests\Feature\Modulos;

use App\Models\User;
use App\Modulos\Alm\Services\InventarioService;
use App\Modulos\Des\Services\DespieceService as Des;
use App\Modulos\Pro\Services\ProduccionService as Pro;
use App\Support\RuleError;
use App\Support\TenantContext;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * DES · Despiece y costeo conjunto. CA-DES-01 a 05 de la spec, versiones de plantilla (RN-DES-08), precios
 * de referencia (RN-DES-07) y las rutas de la API. Fecha de las pruebas: 10/10/2026.
 * Datos de demo: plantilla activa PL-COR «Cordero en canal» (pierna 31, costillar 20, paleta 22, cuello 10,
 * huesos 12, grasa 3 y merma 2 %) en la sala de cortes L1-COR, y PL-CUY v2 «Cuy entero en canal».
 */
class DesTest extends TestCase
{
    private const JEFE = 'olazo@donguando.pe';

    private const OPERARIO = 'npoma@donguando.pe';

    private const GERENTE = 'rquispe@donguando.pe';

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

    private function variante(string $sku): object
    {
        return DB::table('product_variants')->where('sku', $sku)->first();
    }

    private function plantilla(string $codigo): object
    {
        $this->usuario();

        return DB::table('cutting_templates')->where('code', $codigo)->where('status', 'ACTIVE')->first();
    }

    /** Precio de referencia vigente desde hoy (reemplaza los de la demo). */
    private function precio(string $sku, float $porKg): void
    {
        $v = $this->variante($sku);
        DB::table('cut_reference_prices')->where('variant_id', $v->id)->update(['status' => 'REPLACED', 'valid_to' => '2026-10-09']);
        DB::table('cut_reference_prices')->where('variant_id', $v->id)->where('valid_from', '>', '2026-10-09')->delete();
        DB::table('cut_reference_prices')->insert(['variant_id' => $v->id, 'price_per_kg' => $porKg, 'valid_from' => '2026-10-10', 'status' => 'ACTIVE']);
    }

    /**
     * Despiece de CA-DES-02: canal de 20,0 kg a S/ 22,00, 1 h de mano de obra a S/ 12,50 y 0,5 h de sierra a S/ 5,00.
     * $cortes: kg por nombre de corte de la plantilla.
     */
    private function despiece(string $plantilla, string $canalSku, float $kg, float $costo, array $cortes): object
    {
        $jefe = $this->usuario();
        $linea = DB::table('production_lines')->where('code', 'L1-COR')->first();
        $pl = $this->plantilla($plantilla);
        $o = Pro::liberar(Pro::crearOrden(['order_type' => 'CUTTING', 'line_id' => $linea->id, 'cutting_template_id' => $pl->id, 'planned_output_kg' => $kg], $jefe)->id, $jefe);
        $v = $this->variante($canalSku);
        DB::statement("SELECT set_config('app.cal_decision', 'on', true)");
        DB::table('lots')->where('variant_id', $v->id)->where('qc_status', 'RELEASED')->update(['qc_status' => 'BLOCKED']);
        $lot = DB::table('lots')->insertGetId(['product_id' => $v->product_id, 'variant_id' => $v->id, 'code' => 'T-CANAL-01', 'origin' => 'PURCHASE',
            'production_date' => '2026-10-09', 'expiry_date' => '2026-10-16', 'qc_status' => 'RELEASED', 'unit_cost' => $costo], 'id');
        InventarioService::mover(['type' => 'RECEIPT', 'warehouse_id' => $linea->input_warehouse_id, 'variant_id' => $v->id, 'lot_id' => $lot,
            'qty' => $kg, 'weight_kg' => $kg, 'unit_cost' => $costo, 'source_type' => 'TEST', 'reason' => 'Prueba'], $jefe);
        Pro::consumir($o->id, ['lot_id' => $lot, 'qty' => $kg, 'weight_kg' => $kg], $jefe);
        Pro::personal($o->id, ['employee_id' => DB::table('employees')->where('status', 'ACTIVE')->value('id'), 'task_role' => 'CUTTER', 'hours' => 1, 'hourly_rate' => 12.5], $jefe);
        DB::table('equipment')->where('code', 'SIE-L1-01')->update(['hourly_rate' => 5]);
        Pro::equipo($o->id, ['equipment_id' => DB::table('equipment')->where('code', 'SIE-L1-01')->value('id'), 'hours' => 0.5], $jefe);
        $lineas = DB::table('cutting_template_lines')->where('template_id', $pl->id)->get()->keyBy('name');
        foreach ($cortes as $nombre => $kgCorte) {
            Pro::producir($o->id, ['template_line_id' => $lineas[$nombre]->id, 'weight_kg' => $kgCorte], $jefe);
        }

        return Pro::orden($o->id);
    }

    private function preciosCordero(): void
    {
        $this->usuario();
        foreach (['DG-COR-PIE' => 45, 'DG-COR-COS' => 38, 'DG-COR-PAL' => 35, 'DG-COR-CUE' => 20, 'MP-HUE-KG' => 6, 'MP-COR-GRA' => 3] as $sku => $p) {
            $this->precio($sku, $p);
        }
    }

    private const CORDERO = ['Pierna' => 6.0, 'Costillar' => 4.0, 'Paleta' => 4.5, 'Cuello y falda' => 2.0, 'Huesos para caldo' => 2.5,
        'Grasa para manteca' => 0.5, 'Merma (hueso astillado, sangre, recortes)' => 0.5];

    /* ------------------------------------------------------------ criterios de aceptación */

    public function test_ca_des_01_la_plantilla_se_activa_solo_si_suma_100(): void
    {
        $jefe = $this->usuario();
        $actual = $this->plantilla('PL-COR');
        $borrador = Des::nuevaVersion($actual->id, $jefe);
        $this->assertSame('DRAFT', $borrador->status);
        $this->assertSame('100.000', $borrador->sum['total']);

        // Con merma 1 % la suma da 99 %: no se activa.
        $lineas = collect($borrador->lines)->map(fn ($l) => ['seq' => $l->seq, 'name' => $l->name, 'role' => $l->role, 'output_variant_id' => $l->output_variant_id,
            'standard_yield_pct' => $l->role === 'WASTE' ? 1 : $l->standard_yield_pct, 'nrv_cost_per_kg' => $l->nrv_cost_per_kg])->all();
        Des::guardarPlantilla(['lines' => $lineas], $borrador->id, $jefe);
        $e = $this->falla('RN-DES-01', fn () => Des::activar($borrador->id, $this->usuario()));
        $this->assertStringContainsString('99,00 %', $e->getMessage());

        $lineas = array_map(fn ($l) => $l['role'] === 'WASTE' ? ['standard_yield_pct' => 2] + $l : $l, $lineas);
        Des::guardarPlantilla(['lines' => $lineas], $borrador->id, $jefe);
        $activa = Des::activar($borrador->id, $this->usuario());
        $this->assertSame('ACTIVE', $activa->status);
        $this->assertSame(2, (int) $activa->version);
        // RN-DES-08: la anterior queda retirada; solo una activa por producto de entrada.
        $this->assertSame('RETIRED', DB::table('cutting_templates')->where('id', $actual->id)->value('status'));
        $this->assertSame(1, DB::table('cutting_templates')->where('input_variant_id', $actual->input_variant_id)->where('status', 'ACTIVE')->count());
    }

    public function test_ca_des_02_costeo_conjunto_por_valor_de_mercado(): void
    {
        $this->preciosCordero();
        $o = $this->despiece('PL-COR', 'MP-COR-CAN', 20.0, 22.0, self::CORDERO);
        $c = Des::costeo($o);
        $this->assertSame('455.00', $c['joint_cost']);
        $this->assertSame('13.50', $c['nrv_total']);
        $por = collect($c['rows'])->pluck('allocated_cost', 'cut');
        $this->assertSame('192.41', $por['Pierna']);
        $this->assertSame('108.33', $por['Costillar']);
        $this->assertSame('112.25', $por['Paleta']);
        $this->assertSame('28.51', $por['Cuello y falda']);
        $this->assertSame('12.50', $por['Huesos para caldo']);
        $this->assertSame('1.00', $por['Grasa para manteca']);
        $this->assertSame('0.00', $por['Merma (hueso astillado, sangre, recortes)']);
        $this->assertSame('455.00', $c['allocated_total']);

        $cerrada = Pro::cerrar($o->id, [], $this->usuario());
        $this->assertSame('CLOSED', $cerrada->status);
        $this->assertEqualsWithDelta(455.0, (float) $cerrada->joint_cost, 0.001);
        $pierna = DB::table('production_order_outputs as s')->join('cutting_template_lines as l', 'l.id', '=', 's.template_line_id')
            ->where('s.order_id', $o->id)->where('l.name', 'Pierna')->first(['s.allocated_cost', 's.lot_id']);
        $this->assertEqualsWithDelta(192.41, (float) $pierna->allocated_cost, 0.001);
        $this->assertEqualsWithDelta(192.41 / 6, (float) DB::table('lots')->where('id', $pierna->lot_id)->value('unit_cost'), 0.0001);
        $this->assertSame('CUTTING', DB::table('lots')->where('id', $pierna->lot_id)->value('origin'));
    }

    public function test_ca_des_03_balance_fuera_de_tolerancia_no_se_cierra_sin_el_permiso(): void
    {
        $this->preciosCordero();
        $cortes = self::CORDERO;
        unset($cortes['Merma (hueso astillado, sangre, recortes)']);
        $cortes['Paleta'] = 4.4;   // 19,4 kg registrados de 20,0 (3 %)
        $o = $this->despiece('PL-COR', 'MP-COR-CAN', 20.0, 22.0, $cortes);
        $b = Des::balance($o);
        $this->assertSame('19.400', $b['registered_kg']);
        $this->assertSame('3.00', $b['difference_pct']);
        $this->assertFalse($b['ok']);

        $this->falla('RN-DES-04', fn () => Pro::cerrar($o->id, [], $this->usuario()));
        // Con el permiso des.mass_balance.override, el jefe lo cierra igual y queda registrado.
        $c = Pro::cerrar($o->id, ['mass_balance_override' => true], $this->usuario());
        $this->assertSame('CLOSED', $c->status);
        $this->assertNotNull($c->mass_balance_override_by);
    }

    public function test_ca_des_04_corte_a_un_punto_del_estandar_no_avisa(): void
    {
        $this->preciosCordero();
        $o = $this->despiece('PL-COR', 'MP-COR-CAN', 20.0, 22.0, self::CORDERO);
        $c = Pro::cerrar($o->id, [], $this->usuario());
        $this->assertSame([], collect($c->cut_alerts)->where('cut', 'Pierna')->values()->all(), 'Pierna 30 % frente a 31 %: sin alerta.');
    }

    public function test_ca_des_04_corte_a_cuatro_puntos_del_estandar_avisa(): void
    {
        $this->preciosCordero();
        $cortes = self::CORDERO;
        $cortes['Pierna'] = 5.4;   // 27 %
        $cortes['Merma (hueso astillado, sangre, recortes)'] = 1.1;
        $o = $this->despiece('PL-COR', 'MP-COR-CAN', 20.0, 22.0, $cortes);
        $this->assertTrue(Des::alertaCorte($o->id, DB::table('cutting_template_lines')->where('template_id', $o->cutting_template_id)->where('name', 'Pierna')->value('id'))['out_of_standard'],
            'DES-04 avisa al pesar.');
        $antes = DB::table('notifications')->where('module', 'DES')->count();
        $c = Pro::cerrar($o->id, ['yield_deviation_reason' => 'Canal con pierna corta'], $this->usuario());
        $alertas = collect($c->cut_alerts)->where('cut', 'Pierna')->values();
        $this->assertCount(1, $alertas);
        $this->assertEqualsWithDelta(-4.0, $alertas[0]['deviation_pp'], 0.001);
        $this->assertGreaterThan($antes, DB::table('notifications')->where('module', 'DES')->count());
    }

    public function test_ca_des_05_vnr_mayor_que_el_costo_conjunto_se_rechaza(): void
    {
        $this->usuario();
        foreach (['DG-CUY-DES' => 60, 'MP-HUE-KG' => 6, 'MP-CUY-MEN' => 950] as $sku => $p) {   // menudencia mal cargada
            $this->precio($sku, $p);
        }
        $o = $this->despiece('PL-CUY', 'MP-CUY-CAN', 2.0, 30.0, ['Cuy deshuesado' => 1.32, 'Huesos y carcasa' => 0.44, 'Menudencia' => 0.16, 'Merma' => 0.08]);
        $e = $this->falla('RN-DES-06', fn () => Pro::cerrar($o->id, [], $this->usuario()));
        $this->assertStringContainsString('costo conjunto', $e->getMessage());
    }

    /* ------------------------------------------------------------ reglas y API */

    public function test_sin_precio_de_referencia_no_se_costea(): void
    {
        $this->preciosCordero();
        DB::table('cut_reference_prices')->where('variant_id', $this->variante('DG-COR-CUE')->id)->delete();
        $o = $this->despiece('PL-COR', 'MP-COR-CAN', 20.0, 22.0, self::CORDERO);
        $this->falla('RN-DES-07', fn () => Pro::cerrar($o->id, [], $this->usuario()));
    }

    public function test_precio_desde_la_lista_web_sin_igv(): void
    {
        $jefe = $this->usuario();
        $v = $this->variante('DG-COR-PIE');
        DB::table('cut_reference_prices')->where('variant_id', $v->id)->where('valid_from', '>=', '2026-10-11')->delete();
        $web = \App\Modulos\Cat\Services\Precios::vigente($v->id, ['canal' => 'WEB', 'fecha' => '2026-10-11']);
        if (! $web) {
            $this->markTestSkipped('La variante no tiene precio web en la demo.');
        }
        $p = Des::guardarPrecio(['variant_id' => $v->id, 'source' => 'WEB_LIST', 'valid_from' => '2026-10-11'], $jefe);
        $this->assertEqualsWithDelta(round((float) $web['price'] / 1.18, 4), (float) $p->price_per_kg, 0.0001);
        $this->assertSame('WEB_LIST', $p->source);
        // La vigencia anterior se cierra el día antes.
        $this->assertSame(0, DB::table('cut_reference_prices')->where('variant_id', $v->id)->where('status', 'ACTIVE')->where('id', '<>', $p->id)->count());
    }

    public function test_api_plantillas_despiece_y_tablero(): void
    {
        $this->como(self::JEFE)->getJson('/api/v1/des/plantillas')->assertOk()->assertJsonFragment(['code' => 'PL-COR']);
        $id = $this->plantilla('PL-COR')->id;
        $this->como(self::JEFE)->getJson("/api/v1/des/plantillas/{$id}")->assertOk()->assertJsonPath('sum.ok', true);
        $this->como(self::OPERARIO)->postJson("/api/v1/des/plantillas/{$id}/version")->assertStatus(403);
        $this->como(self::JEFE)->getJson('/api/v1/des/precios')->assertOk()->assertJsonStructure(['data', 'missing']);
        $this->como(self::GERENTE)->getJson('/api/v1/des/tablero?month=2026-09')->assertOk()
            ->assertJsonStructure(['yield_vs_standard_pp', 'waste_pct', 'cost_per_useful_kg', 'cuts_out_of_standard_pct', 'by_species']);
        $this->como(self::GERENTE)->getJson('/api/v1/des/cortes?month=2026-09&group=species')->assertOk()->assertJsonPath('group', 'species');
        $this->como(self::GERENTE)->getJson('/api/v1/des/proveedores?month=2026-09')->assertOk()->assertJsonStructure(['data']);
        $d = $this->como(self::JEFE)->getJson('/api/v1/des/despieces?status=CLOSED')->assertOk()->json('data.0.id');
        $this->como(self::JEFE)->getJson("/api/v1/des/despieces/{$d}")->assertOk()->assertJsonStructure(['mass_balance', 'costing' => ['joint_cost', 'rows'], 'lines']);
    }
}
