<?php

namespace Tests\Feature\Modulos;

use Illuminate\Support\Carbon;
use Tests\TestCase;

/** CAT-08 Combos: RN-CAT-08 (CA-CAT-06). */
class CatCombosTest extends TestCase
{
    private ?string $token = null;

    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo(Carbon::parse('2026-11-07 10:00', 'America/Lima'));
    }

    private function gerente(): static
    {
        return $this->desde(self::DG, $this->token ??= $this->ingresar(self::DG, 'rquispe@donguando.pe'));
    }

    private function combo(string $sku): array
    {
        return collect($this->gerente()->getJson('/api/v1/cat/combos')->assertOk()->json())->firstWhere('sku', $sku);
    }

    private function variante(string $sku): array
    {
        return collect($this->gerente()->getJson('/api/v1/cat/variantes?q='.$sku)->json('data'))->firstWhere('sku', $sku);
    }

    public function test_lista_el_pack_familiar_con_reparto_importes_y_stock(): void
    {
        $pack = $this->combo('DG-PACK-FAM');
        $this->assertTrue($pack['revision']['ok']);
        $this->assertEquals(100, $pack['revision']['suma']);
        $this->assertCount(3, $pack['componentes']);
        $cuy = collect($pack['componentes'])->firstWhere('sku', 'DG-CUY-ENT');
        $this->assertEquals(60, $cuy['price_share_pct']);
        $this->assertEquals(round($pack['precio_whatsapp']['price'] * 0.6, 2), $cuy['importe']);
        $this->assertIsInt($pack['alcanza']);
    }

    /** CA-CAT-06 */
    public function test_no_admite_otro_combo_ni_pasar_de_100(): void
    {
        $pack = $this->combo('DG-PACK-FAM');
        $nuevo = $this->gerente()->postJson('/api/v1/cat/combos', ['brand_id' => $this->variante('DG-CUY-ENT')['brand_id'], 'code' => 'PACK-FIESTA', 'name' => 'Pack fiesta', 'price' => 120])
            ->assertCreated();
        $this->assertSame('DG-PACK-FIESTA', $nuevo->json('sku'));

        $this->gerente()->postJson("/api/v1/cat/combos/{$nuevo->json('id')}/componentes", ['component_variant_id' => $pack['id'], 'qty' => 1, 'price_share_pct' => 50])
            ->assertUnprocessable()->assertJsonPath('code', 'RN-CAT-08');

        $con = $this->variante('DG-CON-ENT');
        $r = $this->gerente()->postJson("/api/v1/cat/combos/{$nuevo->json('id')}/componentes", ['component_variant_id' => $con['id'], 'qty' => 2, 'price_share_pct' => 70])->assertCreated();
        $this->assertEquals(3.2, $r->json('est_weight_kg')); // 2 u × 1,600 kg nominal
        $this->gerente()->postJson("/api/v1/cat/combos/{$nuevo->json('id')}/componentes", ['component_variant_id' => $con['id'], 'qty' => 1, 'price_share_pct' => 10])
            ->assertUnprocessable()->assertJsonPath('code', 'RN-CAT-08'); // repetido
        $this->gerente()->postJson("/api/v1/cat/combos/{$nuevo->json('id')}/componentes", ['component_variant_id' => $this->variante('DG-CHO-500')['id'], 'qty' => 1, 'price_share_pct' => 40])
            ->assertUnprocessable()->assertJsonPath('code', 'RN-CAT-08'); // 110 %

        $c = collect($this->combo('DG-PACK-FIESTA'));
        $this->assertFalse($c['revision']['ok']);
        $this->assertEquals(120, $c['precio_whatsapp']['price']);

        $this->gerente()->putJson("/api/v1/cat/combos/{$nuevo->json('id')}/componentes/{$r->json('id')}", ['qty' => 2, 'price_share_pct' => 100])->assertOk();
        $this->assertTrue($this->combo('DG-PACK-FIESTA')['revision']['ok']);

        $this->gerente()->deleteJson("/api/v1/cat/combos/{$nuevo->json('id')}/componentes/{$r->json('id')}")->assertNoContent();
        $this->assertSame(['El combo no tiene componentes.'], $this->combo('DG-PACK-FIESTA')['revision']['problemas']);
    }

    public function test_la_vendedora_consulta_pero_no_arma_combos(): void
    {
        $ana = $this->desde(self::DG, $this->ingresar(self::DG, 'ana.torres@donguando.pe'));
        $skus = array_column($ana->getJson('/api/v1/cat/combos')->assertOk()->json(), 'sku');
        $this->assertSame(['DG-PACK-FAM'], $skus);
        $ana->postJson('/api/v1/cat/combos', [])->assertForbidden();
    }
}
