<?php

namespace Tests\Feature\Modulos;

use Tests\TestCase;

/** PLT-03 Empresas y PLT-04 Locales. */
class PltTest extends TestCase
{
    private function gerente(): static
    {
        return $this->desde(self::DG, $this->ingresar(self::DG, 'rquispe@donguando.pe'));
    }

    private function empresa(array $cambios = []): array
    {
        return $cambios + [
            'legal_name' => 'Don Guando Express SAC', 'trade_name' => 'DG Express', 'ruc' => '20601234565',
            'tax_regime' => 'MYPE', 'fiscal_address' => 'Av. Benavides 100, Surco', 'fiscal_ubigeo' => '150140',
            'default_currency' => 'PEN', 'timezone' => 'America/Lima', 'status' => 'ACTIVE',
        ];
    }

    public function test_lista_las_empresas_propias_con_sus_conteos(): void
    {
        $r = $this->gerente()->getJson('/api/v1/plt/empresas')->assertOk();

        $this->assertSame(['AGROPECUARIA DON GUANDO SAC', 'DON GUANDO GOURMET SAC'], array_column($r->json('data'), 'legal_name'));
        $dg = $r->json('data.0');
        $this->assertGreaterThan(0, $dg['brands_count']);
        $this->assertGreaterThan(0, $dg['establishments_count']);
        $this->assertSame('Santiago de Surco', $dg['fiscal_district']);
        $this->assertCount($dg['brands_count'], $dg['brands']);
        $this->assertSame($dg['establishments_count'], count($dg['establishments']));
        $this->assertLessThanOrEqual($dg['series_count'], $dg['electronic_series_count']);
        $this->assertArrayHasKey('primary_color', $dg['brands'][0]);
        $this->assertArrayNotHasKey('einvoice_user', $dg);
    }

    public function test_otra_empresa_cliente_no_ve_las_de_don_guando(): void
    {
        $token = $this->ingresar(self::CS, 'hsalas@carnesselectas.pe');
        $r = $this->desde(self::CS, $token)->getJson('/api/v1/plt/empresas')->assertOk();

        $this->assertSame(['CARNES SELECTAS DEL SUR SAC'], array_column($r->json('data'), 'legal_name'));
    }

    public function test_crea_una_empresa_con_ruc_valido(): void
    {
        $r = $this->gerente()->postJson('/api/v1/plt/empresas', $this->empresa())->assertCreated();

        $this->assertSame('DON GUANDO EXPRESS SAC', $r->json('legal_name'));
        $this->assertSame('20601234565', $r->json('ruc'));
    }

    public function test_rechaza_ruc_con_digito_verificador_incorrecto_o_repetido(): void
    {
        $this->gerente()->postJson('/api/v1/plt/empresas', $this->empresa(['ruc' => '20601234566']))
            ->assertUnprocessable()->assertJsonValidationErrors(['ruc' => 'debería terminar en 5']);

        $this->gerente()->postJson('/api/v1/plt/empresas', $this->empresa(['ruc' => '20609147254']))
            ->assertUnprocessable()->assertJsonValidationErrors(['ruc' => 'Ya existe']);
    }

    public function test_sin_el_permiso_no_crea_empresas(): void
    {
        // ADMINISTRACION edita PLT pero no tiene plt.company.manage.
        $token = $this->ingresar(self::DG, 'chuaman@donguando.pe');
        $this->desde(self::DG, $token)->postJson('/api/v1/plt/empresas', $this->empresa())->assertForbidden();

        // VENDEDORA no tiene el módulo.
        $token = $this->ingresar(self::DG, 'ana.torres@donguando.pe');
        $this->desde(self::DG, $token)->getJson('/api/v1/plt/empresas')->assertForbidden();
    }

    public function test_edita_una_empresa(): void
    {
        $id = $this->gerente()->getJson('/api/v1/plt/empresas?q=gourmet')->json('data.0.id');
        $actual = $this->gerente()->getJson("/api/v1/plt/empresas/{$id}")->assertOk()->json();

        $this->gerente()->putJson("/api/v1/plt/empresas/{$id}", array_merge($actual, ['trade_name' => 'DG Gourmet']))
            ->assertOk()->assertJsonPath('trade_name', 'DG Gourmet');
    }

    public function test_locales_codigo_y_anexo_sunat_unicos(): void
    {
        $locales = $this->gerente()->getJson('/api/v1/plt/locales')->assertOk()->json('data');
        $this->assertSame(['L1', 'L2'], array_column($locales, 'code'));
        $this->assertGreaterThan(0, $locales[0]['warehouses_count']);
        $this->assertGreaterThan(0, $locales[0]['zones_count']);
        $l1 = $locales[0];

        $nuevo = [
            'company_id' => $l1['company_id'], 'code' => 'l3', 'name' => 'Local 3 · Miraflores', 'short' => 'Local 3',
            'est_type' => 'STORE', 'sunat_code' => '0002', 'address' => 'Av. Larco 500', 'ubigeo' => '150122',
            'has_counter' => true, 'status' => 'ACTIVE',
        ];
        $this->gerente()->postJson('/api/v1/plt/locales', $nuevo)->assertCreated()->assertJsonPath('code', 'L3');

        $this->gerente()->postJson('/api/v1/plt/locales', ['code' => 'L1', 'sunat_code' => '0000'] + $nuevo)
            ->assertUnprocessable()->assertJsonValidationErrors(['code' => 'Ya existe un local', 'sunat_code' => 'ya lo usa otro local']);
    }

    public function test_no_crea_un_local_en_una_empresa_de_otro_cliente(): void
    {
        $token = $this->ingresar(self::CS, 'hsalas@carnesselectas.pe');
        $empresaCs = $this->desde(self::CS, $token)->getJson('/api/v1/plt/empresas')->json('data.0.id');

        $this->gerente()->postJson('/api/v1/plt/locales', [
            'company_id' => $empresaCs, 'code' => 'X1', 'name' => 'Intruso', 'short' => 'Intruso', 'est_type' => 'STORE',
            'sunat_code' => '0009', 'address' => 'Calle 1', 'status' => 'ACTIVE',
        ])->assertUnprocessable()->assertJsonValidationErrors(['company_id']);
    }

    public function test_busca_distritos(): void
    {
        $r = $this->gerente()->getJson('/api/v1/plt/ubigeo?q=surco')->assertOk();

        $this->assertContains('150140', array_column($r->json(), 'code'));
    }
}
