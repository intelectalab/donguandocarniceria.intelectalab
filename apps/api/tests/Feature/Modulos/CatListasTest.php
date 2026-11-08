<?php

namespace Tests\Feature\Modulos;

use Illuminate\Support\Carbon;
use Tests\TestCase;

/** CAT-05 Listas de precio y CAT-06 Precios de la lista: RN-CAT-05 y RN-CAT-06 (CA-CAT-03). */
class CatListasTest extends TestCase
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

    private function lista(string $code): array
    {
        return collect($this->gerente()->getJson('/api/v1/cat/listas')->assertOk()->json())->firstWhere('code', $code);
    }

    private function variante(string $sku): array
    {
        return collect($this->gerente()->getJson('/api/v1/cat/variantes?q='.$sku)->json('data'))->firstWhere('sku', $sku);
    }

    private function precios(string $listaId, string $cuando = 'NOW', string $q = ''): array
    {
        return $this->gerente()->getJson("/api/v1/cat/listas/{$listaId}/precios?cuando={$cuando}&q={$q}")->assertOk()->json();
    }

    public function test_lista_las_listas_con_sus_conteos_y_la_vendedora_solo_ve_su_marca(): void
    {
        $wa = $this->lista('DG-WA');
        $this->assertSame(['WHATSAPP'], $wa['channels']);
        $this->assertSame(90, $wa['priority']);
        $this->assertGreaterThan(0, $wa['vigentes']);

        $ana = $this->desde(self::DG, $this->ingresar(self::DG, 'ana.torres@donguando.pe'));
        $codigos = array_column($ana->getJson('/api/v1/cat/listas')->assertOk()->json(), 'code');
        $this->assertContains('DG-WA', $codigos);
        $this->assertContains('MOS-L1', $codigos); // de todas las marcas
        $this->assertNotContains('M2-PUB', $codigos);
        $ana->postJson('/api/v1/cat/listas', [])->assertForbidden();
    }

    public function test_crea_una_lista_y_valida_codigo_y_vigencia(): void
    {
        $dg = $this->lista('DG-WA')['brand_id'];
        $datos = ['code' => 'dg-tik', 'name' => 'TikTok DG', 'brand_id' => $dg, 'channels' => ['TIKTOK'], 'customer_types' => [],
            'includes_igv' => true, 'priority' => 85, 'valid_from' => '2026-11-10', 'status' => 'DRAFT'];
        $r = $this->gerente()->postJson('/api/v1/cat/listas', $datos)->assertCreated();
        $this->assertSame('DG-TIK', $r->json('code'));

        $this->gerente()->postJson('/api/v1/cat/listas', ['code' => 'DG-WA', 'valid_to' => '2026-11-01'] + $datos)
            ->assertUnprocessable()->assertJsonValidationErrors(['code', 'valid_to']);
    }

    /** CA-CAT-03 */
    public function test_no_se_superponen_vigencias_y_al_cambiar_se_cierra_la_anterior(): void
    {
        $wa = $this->lista('DG-WA');
        $ent = $this->variante('DG-CUY-ENT');
        $nuevo = ['variant_id' => $ent['id'], 'price' => 46, 'valid_from' => '2026-11-15'];

        $this->gerente()->postJson("/api/v1/cat/listas/{$wa['id']}/precios", $nuevo)
            ->assertUnprocessable()->assertJsonPath('code', 'RN-CAT-06');

        $r = $this->gerente()->postJson("/api/v1/cat/listas/{$wa['id']}/precios", $nuevo + ['cerrar_anterior' => true, 'reason' => 'Alza del proveedor'])->assertCreated();
        $this->assertEquals(44, $r->json('previous_price'));
        $this->assertSame('KG', $r->json('basis'));

        $hoy = collect($this->precios($wa['id'], 'NOW', 'DG-CUY-ENT')['filas'])->firstWhere('sku', 'DG-CUY-ENT');
        $this->assertEquals(44, $hoy['price']);
        $this->assertSame('2026-11-14', $hoy['valid_to']);
        $this->assertEquals(46, collect($this->precios($wa['id'], 'FUTURE')['filas'])->firstWhere('sku', 'DG-CUY-ENT')['price']);
    }

    public function test_copia_una_lista_con_ajuste_y_programa_una_nueva_vigencia(): void
    {
        $wa = $this->lista('DG-WA');
        $r = $this->gerente()->postJson("/api/v1/cat/listas/{$wa['id']}/copiar", ['code' => 'DG-WA-26', 'name' => 'WhatsApp 2026', 'pct' => 10, 'valid_from' => '2026-12-01'])
            ->assertCreated();
        $this->assertSame($wa['vigentes'], $r->json('items'));
        $copia = $this->lista('DG-WA-26');
        $this->assertSame('DRAFT', $copia['status']);
        $this->assertEquals(48.4, collect($this->precios($copia['id'], 'FUTURE')['filas'])->firstWhere('sku', 'DG-CUY-ENT')['price']);

        // Programar: desde mañana en adelante y con motivo.
        $this->gerente()->postJson("/api/v1/cat/listas/{$wa['id']}/programar", ['valid_from' => '2026-11-07', 'pct' => 5, 'reason' => 'Ajuste anual'])
            ->assertUnprocessable()->assertJsonPath('code', 'RN-CAT-06');
        $n = $this->gerente()->postJson("/api/v1/cat/listas/{$wa['id']}/programar", ['valid_from' => '2026-12-01', 'pct' => 5, 'reason' => 'Ajuste anual'])
            ->assertOk()->json('items');
        $this->assertSame($wa['vigentes'], $n);
        $this->assertEquals(46.2, collect($this->precios($wa['id'], 'FUTURE')['filas'])->firstWhere('sku', 'DG-CUY-ENT')['price']);
    }

    public function test_importa_un_csv_con_vista_previa(): void
    {
        $wa = $this->lista('DG-WA');
        $csv = "sku;precio;desde;cant_min\nDG-CUY-ENT;45,50;2026-11-20;0\nNO-EXISTE;10;2026-11-20;0\nM5-ALM-GRA;80;2026-11-20;0\nDG-CON-ENT;0;2026-11-20;0";

        $vista = $this->gerente()->postJson("/api/v1/cat/listas/{$wa['id']}/csv/vista", ['texto' => $csv])->assertOk()->json();
        $this->assertCount(4, $vista);
        $this->assertNull($vista[0]['error']);
        $this->assertEquals(44, $vista[0]['current']);
        $this->assertEquals(3.4, $vista[0]['diff_pct']);
        $this->assertSame('El SKU no existe', $vista[1]['error']);
        $this->assertSame('Es de otra marca', $vista[2]['error']);
        $this->assertSame('Precio no válido', $vista[3]['error']);

        $this->gerente()->postJson("/api/v1/cat/listas/{$wa['id']}/csv", ['texto' => $csv])->assertOk()
            ->assertJson(['aplicadas' => 1, 'con_error' => 3]);
        $this->assertEquals(45.5, collect($this->precios($wa['id'], 'FUTURE')['filas'])->firstWhere('sku', 'DG-CUY-ENT')['price']);
    }

    public function test_cierra_un_precio_y_ya_no_esta_vigente(): void
    {
        $wa = $this->lista('DG-WA');
        $item = collect($this->precios($wa['id'], 'NOW', 'DG-CUY-ENT')['filas'])->firstWhere('sku', 'DG-CUY-ENT');
        $this->gerente()->putJson("/api/v1/cat/listas/{$wa['id']}/precios/{$item['id']}/cerrar", ['valid_to' => '2026-10-01'])
            ->assertUnprocessable()->assertJsonPath('code', 'RN-CAT-06');
        $this->gerente()->putJson("/api/v1/cat/listas/{$wa['id']}/precios/{$item['id']}/cerrar", ['valid_to' => '2026-11-06'])->assertNoContent();
        $this->assertNull(collect($this->precios($wa['id'], 'NOW', 'DG-CUY-ENT')['filas'])->firstWhere('sku', 'DG-CUY-ENT'));
    }
}
