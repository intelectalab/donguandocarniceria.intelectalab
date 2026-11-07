<?php

namespace Tests\Feature\Modulos;

use Illuminate\Support\Carbon;
use Tests\TestCase;

/** CAT-07 Simulador de precio: RN-CAT-05 con la traza, CA-CAT-01 y CA-CAT-02. */
class CatSimuladorTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo(Carbon::parse('2026-11-07 10:00', 'America/Lima'));
    }

    private ?string $token = null;

    private function gerente(): static
    {
        return $this->desde(self::DG, $this->token ??= $this->ingresar(self::DG, 'rquispe@donguando.pe'));
    }

    private function simular(string $sku, array $caso): array
    {
        $id = collect($this->gerente()->getJson('/api/v1/cat/variantes?q='.$sku)->json('data'))->firstWhere('sku', $sku)['id'];
        $q = http_build_query($caso + ['variant_id' => $id, 'canal' => 'WHATSAPP', 'tipo_cliente' => 'PERSON', 'fecha' => '2026-11-07', 'cantidad' => 1]);

        return $this->gerente()->getJson('/api/v1/cat/simulador?'.$q)->assertOk()->json();
    }

    /** CA-CAT-02 */
    public function test_restaurante_y_persona_eligen_listas_distintas_con_la_traza(): void
    {
        $res = $this->simular('DG-CON-DES', ['tipo_cliente' => 'RESTAURANT', 'cantidad' => 2]);
        $this->assertEquals(44, $res['elegido']['price']);
        $this->assertSame('DG-RES', $res['elegido']['list_code']);
        $this->assertSame('DG-RES', collect($res['traza'])->firstWhere('elegida', true)['list_code']);

        $per = $this->simular('DG-CON-DES', ['tipo_cliente' => 'PERSON', 'cantidad' => 2]);
        $this->assertEquals(48, $per['elegido']['price']);
        $res = collect($per['traza'])->firstWhere('list_code', 'DG-RES');
        $this->assertFalse($res['aplica']);
        $this->assertSame('Solo para otros tipos de cliente', $res['porque']);
    }

    /** CA-CAT-01 con el precio vigente desde el 01/11 (S/ 44,00). */
    public function test_estima_peso_e_importe_del_peso_variable(): void
    {
        $r = $this->simular('DG-CUY-ENT', ['cantidad' => 2]);
        $this->assertEquals(1.8, $r['kg_estimado']);
        $this->assertEquals(44, $r['elegido']['price']);
        $this->assertEquals(79.2, $r['importe_estimado']);

        // Antes del cambio de precio: S/ 42,00 → S/ 75,60.
        $antes = $this->simular('DG-CUY-ENT', ['cantidad' => 2, 'fecha' => '2026-10-15']);
        $this->assertEquals(75.6, $antes['importe_estimado']);
    }

    public function test_coincide_con_el_precio_vigente_y_avisa_la_cantidad(): void
    {
        foreach (['DG-CUY-ENT', 'DG-CON-DES', 'DG-CAL-1L'] as $sku) {
            foreach (['WHATSAPP', 'WEB', 'COUNTER', 'B2B'] as $canal) {
                $r = $this->simular($sku, ['canal' => $canal]);
                $id = $r['variante']['id'];
                $v = collect($this->gerente()->getJson('/api/v1/cat/variantes?q='.$sku)->json('data'))->firstWhere('id', $id);
                if ($canal === 'WHATSAPP') {
                    $this->assertEquals($v['precio_whatsapp']['price'] ?? null, $r['elegido']['price'] ?? null, "{$sku} {$canal}");
                }
                $this->assertSame($r['elegido'] !== null, collect($r['traza'])->contains('elegida', true));
            }
        }

        $r = $this->simular('DG-CON-DES', ['cantidad' => 0.3]);
        $this->assertStringContainsString('RN-CAT-07', $r['aviso_cantidad']);
    }
}
