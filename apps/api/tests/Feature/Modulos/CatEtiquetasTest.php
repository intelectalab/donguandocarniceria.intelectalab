<?php

namespace Tests\Feature\Modulos;

use App\Modulos\Cat\Services\Balanza;
use Illuminate\Support\Carbon;
use Tests\TestCase;

/** CAT-11 Etiquetas de balanza: RN-CAT-12 y CA-CAT-04. */
class CatEtiquetasTest extends TestCase
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

    /** CA-CAT-04 */
    public function test_lee_la_etiqueta_de_la_spec_y_rechaza_el_digito_cambiado(): void
    {
        $r = $this->gerente()->postJson('/api/v1/cat/etiquetas/leer', ['codigo' => '2012345012509'])->assertOk();
        $r->assertJson(['ok' => true, 'plu' => '12345', 'weight_kg' => 1.25]);

        $mal = $this->gerente()->postJson('/api/v1/cat/etiquetas/leer', ['codigo' => '2012345012508'])->assertOk();
        $this->assertFalse($mal->json('ok'));
        $this->assertStringContainsString('dígito de control', $mal->json('error'));
        $this->assertFalse($this->gerente()->postJson('/api/v1/cat/etiquetas/leer', ['codigo' => '123'])->json('ok'));
    }

    public function test_genera_y_lee_una_etiqueta_del_cuy_con_precio_y_rango(): void
    {
        $cuy = collect($this->gerente()->getJson('/api/v1/cat/etiquetas')->assertOk()->json('variantes'))->firstWhere('scale_plu', '10001');
        $codigo = $this->gerente()->postJson('/api/v1/cat/etiquetas/generar', ['variant_id' => $cuy['id'], 'valor' => 0.965])->assertOk()->json('codigo');
        $this->assertSame('201000100965', substr($codigo, 0, 12)); // prefijo 2, PLU 10001, 965 g
        $this->assertSame(13, strlen($codigo));

        $r = $this->gerente()->postJson('/api/v1/cat/etiquetas/leer', ['codigo' => $codigo])->assertOk()->json();
        $this->assertSame('DG-CUY-ENT', $r['variant']['sku']);
        $this->assertEquals(0.965, $r['weight_kg']);
        $this->assertFalse($r['fuera_de_rango']);
        $this->assertEquals(round(0.965 * $r['precio']['price'], 2), $r['importe']);

        $pesado = $this->gerente()->postJson('/api/v1/cat/etiquetas/generar', ['variant_id' => $cuy['id'], 'valor' => 1.4])->json('codigo');
        $this->assertTrue($this->gerente()->postJson('/api/v1/cat/etiquetas/leer', ['codigo' => $pesado])->json('fuera_de_rango'));
    }

    public function test_cambia_el_formato_con_motivo_y_valida_superposiciones(): void
    {
        $f = ['prefix' => '2', 'plu_start' => 3, 'plu_len' => 5, 'value_start' => 6, 'value_len' => 5, 'value_type' => 'WEIGHT_G', 'reason' => 'Balanzas nuevas'];
        $this->gerente()->putJson('/api/v1/cat/etiquetas/formato', $f)->assertUnprocessable()->assertJsonPath('code', 'RN-CAT-12');

        $this->gerente()->putJson('/api/v1/cat/etiquetas/formato', ['value_start' => 8, 'value_type' => 'PRICE_CENTS'] + $f)->assertOk()
            ->assertJsonPath('formato.value_type', 'PRICE_CENTS');
        $r = $this->gerente()->postJson('/api/v1/cat/etiquetas/leer', ['codigo' => Balanza::armar('10001', 42.5, Balanza::formato())])->json();
        $this->assertEquals(42.5, $r['amount']);
        $this->assertNull($r['weight_kg']);
    }

    public function test_la_vendedora_prueba_pero_no_cambia_el_formato(): void
    {
        $ana = $this->desde(self::DG, $this->ingresar(self::DG, 'ana.torres@donguando.pe'));
        $ana->postJson('/api/v1/cat/etiquetas/leer', ['codigo' => '2012345012509'])->assertOk();
        $ana->putJson('/api/v1/cat/etiquetas/formato', [])->assertForbidden();
    }
}
