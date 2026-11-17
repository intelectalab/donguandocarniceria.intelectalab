<?php

namespace Tests\Feature\Modulos;

use Illuminate\Support\Carbon;
use Tests\TestCase;

/** CLI-05 Direcciones y CLI-06 Mapa (RN-CLI-02, 04, 05, 06, 10; CA-CLI-02 y CA-CLI-06). */
class CliDireccionesTest extends TestCase
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

    private function cliente(): string
    {
        return $this->gerente()->postJson('/api/v1/cli/clientes', ['full_name' => 'Lucía Prueba', 'customer_type' => 'PERSON', 'doc_type' => 'NONE', 'phone' => '956333444'])
            ->assertCreated()->json('customer.id');
    }

    private function dir(array $extra = []): array
    {
        return $extra + ['label' => 'Casa', 'address_line' => 'Av. Los Próceres 1250', 'district' => 'Santiago de Surco', 'reference' => 'Frente al parque',
            'lat' => -12.135, 'lng' => -76.990, 'pin_source' => 'MAP'];
    }

    public function test_ca_cli_02_la_zona_sale_del_poligono_y_la_referencia_es_obligatoria(): void
    {
        $id = $this->cliente();
        $r = $this->gerente()->postJson("/api/v1/cli/clientes/{$id}/direcciones", $this->dir())->assertCreated();
        $this->assertSame('SURCO-B', $r->json('zona.code'));
        $this->assertSame('POLYGON', $r->json('por'));
        $this->assertTrue($r->json('direccion.is_default'));

        $this->gerente()->postJson("/api/v1/cli/clientes/{$id}/direcciones", $this->dir(['reference' => 'casa']))
            ->assertUnprocessable()->assertJsonPath('code', 'RN-CLI-02');
        $this->gerente()->postJson("/api/v1/cli/clientes/{$id}/direcciones", $this->dir(['lat' => null, 'lng' => null]))
            ->assertUnprocessable()->assertJsonPath('code', 'RN-CLI-02');
    }

    public function test_ca_cli_06_pin_en_cero_cero_se_rechaza(): void
    {
        $id = $this->cliente();
        $this->gerente()->postJson("/api/v1/cli/clientes/{$id}/direcciones", $this->dir(['lat' => 0, 'lng' => 0, 'district' => 'Miraflores']))
            ->assertUnprocessable()->assertJsonPath('code', 'RN-CLI-04');
    }

    public function test_rn_cli_05_pin_geocodificado_con_poca_confianza(): void
    {
        $id = $this->cliente();
        $g = $this->gerente()->getJson('/api/v1/cli/geocodificar?q=Calle%20Las%20Gaviotas,%20Chorrillos')->assertOk();
        $this->assertLessThan(0.8, $g->json('confidence'));
        $v = $this->dir(['lat' => $g->json('lat'), 'lng' => $g->json('lng'), 'district' => 'Chorrillos', 'pin_source' => 'GEOCODE', 'geocode_confidence' => $g->json('confidence')]);
        $this->gerente()->postJson("/api/v1/cli/clientes/{$id}/direcciones", $v)->assertUnprocessable()->assertJsonPath('code', 'RN-CLI-05');
        // Moverlo en el mapa lo confirma.
        $this->gerente()->postJson("/api/v1/cli/clientes/{$id}/direcciones", $v + ['pin_confirmed' => true])->assertCreated()->assertJsonPath('direccion.pin_source', 'MAP');
    }

    public function test_rn_cli_10_una_sola_predeterminada_y_fuera_de_cobertura(): void
    {
        $id = $this->cliente();
        $a = $this->gerente()->postJson("/api/v1/cli/clientes/{$id}/direcciones", $this->dir())->json('direccion.id');
        // Ate: fuera de todas las zonas.
        $b = $this->gerente()->postJson("/api/v1/cli/clientes/{$id}/direcciones", $this->dir(['label' => 'Mamá', 'district' => 'Ate', 'lat' => -12.043, 'lng' => -76.928, 'is_default' => true]))
            ->assertCreated()->assertJsonPath('zona', null)->json('direccion.id');
        $lista = collect($this->gerente()->getJson("/api/v1/cli/clientes/{$id}/direcciones")->assertOk()->json('direcciones'))->keyBy('id');
        $this->assertTrue($lista[$b]['is_default']);
        $this->assertFalse($lista[$a]['is_default']);

        $this->gerente()->postJson("/api/v1/cli/direcciones/{$a}/predeterminar")->assertNoContent();
        $this->gerente()->postJson("/api/v1/cli/direcciones/{$b}/desactivar")->assertNoContent();
        $lista = $this->gerente()->getJson("/api/v1/cli/clientes/{$id}/direcciones")->json('direcciones');
        $this->assertCount(1, $lista);
        $this->assertTrue($lista[0]['is_default']);

        $this->gerente()->getJson('/api/v1/cli/direcciones/revisar?mes=2026-10')->assertOk()->assertJsonStructure(['pins_confirmados' => ['valor'], 'lista']);
        $this->gerente()->getJson('/api/v1/cli/zona-del-pin?lat=-12.135&lng=-76.99')->assertOk()->assertJsonPath('zona.code', 'SURCO-B');
    }
}
