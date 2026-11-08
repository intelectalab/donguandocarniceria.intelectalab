<?php

namespace Tests\Feature\Modulos;

use Illuminate\Support\Carbon;
use Tests\TestCase;

/** CAT-03 Variantes y cortes: RN-CAT-01, 02, 03, 04, 09 y 11. */
class CatVariantesTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo(Carbon::parse('2026-11-07 10:00', 'America/Lima'));
    }

    private function gerente(): static
    {
        return $this->desde(self::DG, $this->ingresar(self::DG, 'rquispe@donguando.pe'));
    }

    private function producto(string $code): array
    {
        return collect($this->gerente()->getJson('/api/v1/cat/productos?tipo=ALL&q='.$code)->assertOk()->json('data'))->firstWhere('code', $code);
    }

    private function variante(string $sku): array
    {
        return collect($this->gerente()->getJson('/api/v1/cat/variantes?q='.$sku)->assertOk()->json('data'))->firstWhere('sku', $sku);
    }

    private function nueva(array $cambios = []): array
    {
        return $cambios + [
            'product_id' => $this->producto('CUY-ENT')['id'], 'sku' => 'dg-cuy-xl', 'name' => 'Cuy entero extra grande',
            'sale_mode' => 'UNIT_VARIABLE_WEIGHT', 'nominal_weight_kg' => 1.2, 'min_weight_kg' => 1.05, 'max_weight_kg' => 1.4,
            'min_order_qty' => 1, 'qty_step' => 1, 'std_cost' => 30, 'status' => 'ACTIVE',
        ];
    }

    public function test_lista_las_variantes_de_un_producto_y_busca_por_plu(): void
    {
        $cuy = $this->producto('CUY-ENT');
        $filas = $this->gerente()->getJson("/api/v1/cat/variantes?product_id={$cuy['id']}")->assertOk()->json('data');
        $this->assertSame(['DG-CUY-DES', 'DG-CUY-ENT', 'DG-CUY-MIT'], array_column($filas, 'sku'));
        $ent = collect($filas)->firstWhere('sku', 'DG-CUY-ENT');
        $this->assertSame('Entero', $ent['cut_name']);
        $this->assertEquals(44, $ent['precio_whatsapp']['price']);

        $this->assertSame(['DG-CUY-ENT'], array_column($this->gerente()->getJson('/api/v1/cat/variantes?q=10001')->json('data'), 'sku'));

        $r = $this->gerente()->getJson('/api/v1/cat/variantes/resumen')->assertOk();
        $this->assertGreaterThan(0, $r->json('peso_variable'));
    }

    public function test_crea_una_variante_de_peso_variable_con_la_marca_y_linea_de_su_producto(): void
    {
        $r = $this->gerente()->postJson('/api/v1/cat/variantes', $this->nueva())->assertCreated();

        $this->assertSame('DG-CUY-XL', $r->json('sku'));
        $this->assertSame('CUY', $r->json('line'));
        $this->assertSame($this->producto('CUY-ENT')['brand_id'], $r->json('brand_id'));
        $this->assertTrue($r->json('sellable'));

        // RN-CAT-01: SKU único.
        $this->gerente()->postJson('/api/v1/cat/variantes', $this->nueva(['sku' => 'DG-CUY-ENT']))
            ->assertUnprocessable()->assertJsonValidationErrors(['sku' => 'Ya existe']);
    }

    public function test_reglas_de_peso(): void
    {
        // RN-CAT-02
        $this->gerente()->postJson('/api/v1/cat/variantes', $this->nueva(['nominal_weight_kg' => null]))
            ->assertUnprocessable()->assertJsonPath('code', 'RN-CAT-02');
        // RN-CAT-03
        $this->gerente()->postJson('/api/v1/cat/variantes', $this->nueva(['min_weight_kg' => 1.5]))
            ->assertUnprocessable()->assertJsonPath('code', 'RN-CAT-03');
        $this->gerente()->postJson('/api/v1/cat/variantes', $this->nueva(['nominal_weight_kg' => 1.5]))
            ->assertUnprocessable()->assertJsonPath('message', 'El peso nominal (1,500 kg) es mayor que el máximo (1,400 kg).');
        // Por unidad no lleva pesos: se ignoran.
        $r = $this->gerente()->postJson('/api/v1/cat/variantes', $this->nueva(['sale_mode' => 'UNIT', 'nominal_weight_kg' => null, 'min_weight_kg' => 9]))
            ->assertCreated();
        $this->assertNull($r->json('min_weight_kg'));
    }

    /** RN-CAT-04 */
    public function test_el_plu_es_unico_entre_las_activas(): void
    {
        $this->gerente()->postJson('/api/v1/cat/variantes', $this->nueva(['scale_plu' => '10001']))
            ->assertUnprocessable()->assertJsonPath('code', 'RN-CAT-04');

        // Inactiva sí puede repetirlo, pero no se activa mientras la otra lo use.
        $id = $this->gerente()->postJson('/api/v1/cat/variantes', $this->nueva(['scale_plu' => '10001', 'status' => 'INACTIVE']))->assertCreated()->json('id');
        $this->gerente()->putJson("/api/v1/cat/variantes/{$id}/estado", ['status' => 'ACTIVE'])
            ->assertUnprocessable()->assertJsonPath('code', 'RN-CAT-04');
    }

    /** RN-CAT-11 */
    public function test_con_movimientos_no_se_borra_y_sin_ellos_si(): void
    {
        $ent = $this->variante('DG-CUY-ENT');
        $this->gerente()->deleteJson("/api/v1/cat/variantes/{$ent['id']}")->assertUnprocessable()->assertJsonPath('code', 'RN-CAT-11');

        $id = $this->gerente()->postJson('/api/v1/cat/variantes', $this->nueva())->assertCreated()->json('id');
        $this->gerente()->deleteJson("/api/v1/cat/variantes/{$id}")->assertNoContent();
        $this->gerente()->getJson("/api/v1/cat/variantes/{$id}")->assertNotFound();
    }

    public function test_no_se_activa_con_el_producto_inactivo_ni_se_publica_con_registro_vencido(): void
    {
        $cuy = $this->producto('CUY-ENT');
        $this->gerente()->putJson("/api/v1/cat/productos/{$cuy['id']}/estado", ['status' => 'INACTIVE'])->assertOk();
        $ent = $this->variante('DG-CUY-ENT');
        $this->gerente()->putJson("/api/v1/cat/variantes/{$ent['id']}/estado", ['status' => 'ACTIVE'])
            ->assertUnprocessable()->assertJsonPath('code', 'RN-CAT-11');

        // La mermelada tiene el registro DIGESA vencido (30/09).
        $merm = $this->producto('MERM');
        $this->gerente()->postJson('/api/v1/cat/variantes', $this->nueva(['product_id' => $merm['id'], 'sku' => 'M5-MERM-500',
            'sale_mode' => 'UNIT', 'web_publishable' => true]))
            ->assertUnprocessable()->assertJsonPath('code', 'RN-CAT-09');
    }

    public function test_los_cortes_se_ofrecen_segun_la_linea_del_producto(): void
    {
        $cuy = $this->producto('CUY-ENT');
        $cortes = array_column($this->gerente()->getJson("/api/v1/cat/cortes?product_id={$cuy['id']}")->assertOk()->json(), 'code');

        $this->assertContains('ENTERO', $cortes);
        $this->assertContains('MITADES', $cortes);
        $this->assertNotContains('PECHUGA', $cortes); // solo aves
    }
}
