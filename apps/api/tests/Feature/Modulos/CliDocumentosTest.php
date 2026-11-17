<?php

namespace Tests\Feature\Modulos;

use Illuminate\Support\Carbon;
use Tests\TestCase;

/** CLI-04 Validar documento (RN-CLI-03, RN-CLI-12, CA-CLI-04). */
class CliDocumentosTest extends TestCase
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

    private function nuevo(): string
    {
        return $this->gerente()->postJson('/api/v1/cli/clientes', ['full_name' => 'Restaurante Prueba', 'customer_type' => 'RESTAURANT', 'doc_type' => 'NONE',
            'phone' => '956777888'])->assertCreated()->json('customer.id');
    }

    public function test_ca_cli_04_el_ruc_con_digito_verificador(): void
    {
        $this->gerente()->postJson('/api/v1/cli/documentos/consultar', ['doc_type' => 'RUC', 'doc_number' => '20100070970'])->assertOk()
            ->assertJsonPath('ok', true)->assertJsonPath('source', 'SUNAT');
        $this->gerente()->postJson('/api/v1/cli/documentos/consultar', ['doc_type' => 'RUC', 'doc_number' => '20100070971'])->assertOk()
            ->assertJsonPath('ok', false);

        $id = $this->nuevo();
        $this->gerente()->postJson("/api/v1/cli/clientes/{$id}/documento", ['doc_type' => 'RUC', 'doc_number' => '20100070971'])
            ->assertUnprocessable()->assertJsonPath('code', 'RN-CLI-03');
    }

    public function test_rn_cli_12_guarda_fuente_fecha_y_bitacora(): void
    {
        $id = $this->nuevo();
        $r = $this->gerente()->postJson("/api/v1/cli/clientes/{$id}/documento", ['doc_type' => 'RUC', 'doc_number' => '20100070970'])->assertOk();
        $this->assertSame('SUNAT', $r->json('customer.doc_validation_source'));
        $this->assertNotNull($r->json('customer.doc_validated_at'));
        $this->assertNotNull($r->json('customer.fiscal_address'));
        $this->assertSame('HABIDO', $r->json('customer.taxpayer_condition'));

        $p = $this->gerente()->getJson('/api/v1/cli/documentos/pendientes')->assertOk();
        $this->assertSame('RUC 20100070970', $p->json('bitacora.0.doc'));

        // El documento de otro cliente no se puede tomar (RN-CLI-11).
        $otro = $this->nuevoCon('956777889');
        $this->gerente()->postJson("/api/v1/cli/clientes/{$otro}/documento", ['doc_type' => 'RUC', 'doc_number' => '20100070970'])
            ->assertUnprocessable()->assertJsonPath('code', 'RN-CLI-11');
    }

    public function test_validacion_manual_exige_permiso_y_nota(): void
    {
        $id = $this->nuevo();
        $this->gerente()->postJson("/api/v1/cli/clientes/{$id}/documento", ['doc_type' => 'CE', 'doc_number' => 'AB1234567', 'manual' => true])
            ->assertUnprocessable()->assertJsonPath('code', 'RN-CLI-12');
        $this->gerente()->postJson("/api/v1/cli/clientes/{$id}/documento", ['doc_type' => 'CE', 'doc_number' => 'AB1234567', 'manual' => true, 'nota' => 'Vi el carné en el mostrador'])
            ->assertOk()->assertJsonPath('customer.doc_validation_source', 'MANUAL');

        $vendedora = $this->ingresar(self::DG, 'ana.torres@donguando.pe');
        $this->desde(self::DG, $vendedora)->postJson("/api/v1/cli/clientes/{$id}/documento", ['doc_type' => 'DNI', 'doc_number' => '45879632', 'manual' => true, 'nota' => 'x'])
            ->assertUnprocessable()->assertJsonPath('code', 'RN-CLI-12');
    }

    private function nuevoCon(string $cel): string
    {
        return $this->gerente()->postJson('/api/v1/cli/clientes', ['full_name' => 'Otro', 'customer_type' => 'BUSINESS', 'doc_type' => 'NONE', 'phone' => $cel])
            ->assertCreated()->json('customer.id');
    }
}
