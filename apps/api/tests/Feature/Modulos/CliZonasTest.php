<?php

namespace Tests\Feature\Modulos;

use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/** CLI-08 Zonas de reparto y CLI-09 Simulador (RN-CLI-06, CA-CLI-03). */
class CliZonasTest extends TestCase
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

    private function variante(string $sku): string
    {
        return collect($this->gerente()->getJson('/api/v1/cli/simulador/variantes')->assertOk()->json())->firstWhere('sku', $sku)['id'];
    }

    public function test_ca_cli_03_delivery_gratis_desde_3_unidades_o_3_kg(): void
    {
        $cuy = $this->variante('DG-CUY-ENT');
        $conejo = $this->variante('DG-CON-TRZ');
        $pin = ['lat' => -12.135, 'lng' => -76.99];
        $dos = $this->gerente()->postJson('/api/v1/cli/simulador', $pin + ['lineas' => [['variant_id' => $cuy, 'qty' => 2]]])->assertOk();
        $this->assertSame('SURCO-B', $dos->json('zona.code'));
        $this->assertEquals(10, $dos->json('tarifa'));
        $this->assertEquals(0, $this->gerente()->postJson('/api/v1/cli/simulador', $pin + ['lineas' => [['variant_id' => $cuy, 'qty' => 3]]])->json('tarifa'));
        $kg = $this->gerente()->postJson('/api/v1/cli/simulador', $pin + ['lineas' => [['variant_id' => $conejo, 'qty' => 3.2]]])->assertOk();
        $this->assertEquals(0, $kg->json('tarifa'));
        $this->assertTrue($kg->json('gratis'));

        // Solo con el distrito; y fuera de cobertura.
        $this->assertSame('DISTRICT', $this->gerente()->postJson('/api/v1/cli/simulador', ['distrito' => 'Miraflores', 'lineas' => []])->json('por'));
        $this->assertFalse($this->gerente()->postJson('/api/v1/cli/simulador', ['lat' => -12.043, 'lng' => -76.928, 'distrito' => 'Ate', 'lineas' => []])->json('cubierto'));
    }

    public function test_crea_y_edita_una_zona_con_su_poligono(): void
    {
        $local = DB::table('establishments')->first()->id ?? null;
        $locales = $this->gerente()->getJson('/api/v1/cli/zonas')->assertOk()->json('locales');
        $datos = ['code' => 'ate-norte', 'name' => 'Ate norte', 'establishment_id' => $locales[0]['id'], 'priority' => 150, 'delivery_fee' => 15,
            'min_order_amount' => 40, 'free_from_units' => 4, 'districts' => [], 'status' => 'ACTIVE'];
        // RN-CLI-06: sin polígono ni distrito, no.
        $this->gerente()->postJson('/api/v1/cli/zonas', $datos)->assertUnprocessable()->assertJsonPath('code', 'RN-CLI-06');
        $poligono = [[-12.03, -76.94], [-12.03, -76.91], [-12.06, -76.91], [-12.06, -76.94]];
        $z = $this->gerente()->postJson('/api/v1/cli/zonas', $datos + ['polygon' => $poligono])->assertCreated();
        $this->assertSame('ATE-NORTE', $z->json('code'));
        $this->assertSame('ATE-NORTE', $this->gerente()->getJson('/api/v1/cli/zona-del-pin?lat=-12.043&lng=-76.928')->json('zona.code'));
        // Código único.
        $this->gerente()->postJson('/api/v1/cli/zonas', ['code' => 'SURCO-B', 'districts' => ['Surco']] + $datos)->assertUnprocessable();

        $this->gerente()->putJson('/api/v1/cli/zonas/'.$z->json('id'), ['delivery_fee' => 18, 'polygon' => $poligono] + $datos)->assertOk()->assertJsonPath('delivery_fee', 18);

        $coord = $this->ingresar(self::DG, 'rchavez@donguando.pe');
        $this->desde(self::DG, $coord)->getJson('/api/v1/cli/zonas')->assertOk();
        $vendedora = $this->ingresar(self::DG, 'ana.torres@donguando.pe');
        $this->desde(self::DG, $vendedora)->postJson('/api/v1/cli/zonas', $datos + ['code' => 'X1', 'districts' => ['Ate']])->assertForbidden();
    }
}
