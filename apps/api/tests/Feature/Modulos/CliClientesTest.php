<?php

namespace Tests\Feature\Modulos;

use Illuminate\Support\Carbon;
use PhpOffice\PhpSpreadsheet\Spreadsheet;
use Tests\TestCase;

/** CLI-01 Clientes, CLI-02 Ficha y CLI-03 Alta rápida. */
class CliClientesTest extends TestCase
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

    public function test_ca_cli_01_alta_rapida_normaliza_el_celular_y_no_duplica(): void
    {
        $vendedora = $this->ingresar(self::DG, 'ana.torres@donguando.pe');
        $r = $this->desde(self::DG, $vendedora)->postJson('/api/v1/cli/clientes/rapida', ['phone' => '987654321', 'full_name' => 'Cliente Prueba Alta',
            'customer_type' => 'PERSON', 'source_channel' => 'WHATSAPP'])->assertCreated();
        $this->assertSame('+51987654321', $r->json('customer.phone'));
        $this->assertFalse($r->json('existente'));
        $id = $r->json('customer.id');

        // La vendedora queda asignada.
        $this->assertNotNull($this->gerente()->getJson("/api/v1/cli/clientes/{$id}")->assertOk()->json('vendedora'));

        // El mismo número escrito de otra forma abre el cliente existente.
        $r2 = $this->desde(self::DG, $vendedora)->postJson('/api/v1/cli/clientes/rapida', ['phone' => '+51 987 654 321', 'full_name' => 'Otro Nombre',
            'customer_type' => 'PERSON', 'source_channel' => 'WHATSAPP'])->assertOk();
        $this->assertTrue($r2->json('existente'));
        $this->assertSame($id, $r2->json('customer.id'));

        $this->gerente()->getJson('/api/v1/cli/clientes/celular?phone=987%20654%20321')->assertOk()
            ->assertJsonPath('normalizado', '+51987654321')->assertJsonPath('existente.id', $id);
    }

    public function test_rn_cli_01_y_03_rechaza_celular_y_documento_mal_escritos(): void
    {
        $base = ['full_name' => 'Rosa Prueba', 'customer_type' => 'PERSON', 'doc_type' => 'NONE'];
        $this->gerente()->postJson('/api/v1/cli/clientes', $base + ['phone' => '12345'])->assertUnprocessable()->assertJsonPath('code', 'RN-CLI-01');
        $this->gerente()->postJson('/api/v1/cli/clientes', ['doc_type' => 'DNI', 'doc_number' => '1234567', 'phone' => '956111222'] + $base)
            ->assertUnprocessable()->assertJsonPath('code', 'RN-CLI-03');
        $this->gerente()->postJson('/api/v1/cli/clientes', $base + ['phone' => null])->assertUnprocessable()->assertJsonPath('code', 'RN-CLI-11');
    }

    public function test_rn_cli_11_un_documento_es_de_un_solo_cliente(): void
    {
        $this->gerente()->postJson('/api/v1/cli/clientes', ['full_name' => 'Otra Empresa', 'customer_type' => 'BUSINESS', 'doc_type' => 'RUC',
            'doc_number' => '20601000009', 'phone' => '956111223'])->assertUnprocessable()->assertJsonPath('code', 'RN-CLI-11');
    }

    public function test_busca_por_celular_como_sea_que_se_escriba(): void
    {
        $r = $this->gerente()->getJson('/api/v1/cli/clientes?q=998%20800%20000')->assertOk();
        $this->assertSame('EL CUY DORADO SAC', $r->json('data.0.full_name'));
        $this->assertGreaterThan(0, $r->json('data.0.pedidos'));

        $this->assertSame(1, $this->gerente()->getJson('/api/v1/cli/clientes?vista=MERGED')->assertOk()->json('total'));
        $this->assertGreaterThanOrEqual(2, $this->gerente()->getJson('/api/v1/cli/clientes?vista=BLOCKED')->json('total'));

        $res = $this->gerente()->getJson('/api/v1/cli/clientes/resumen?mes=2026-10')->assertOk();
        $this->assertGreaterThan(0, $res->json('recurrentes.denominador'));
        $this->assertSame(3, $res->json('duplicados_abiertos'));
    }

    public function test_ficha_con_cifras_direcciones_y_alertas(): void
    {
        $id = $this->gerente()->getJson('/api/v1/cli/clientes?q=998800000')->json('data.0.id');
        $f = $this->gerente()->getJson("/api/v1/cli/clientes/{$id}")->assertOk();
        $this->assertGreaterThan(0, $f->json('cifras.pedidos'));
        $this->assertNotEmpty($f->json('por_marca'));
        $this->gerente()->getJson("/api/v1/cli/clientes/{$id}/pedidos")->assertOk()->assertJsonStructure(['data' => [['number', 'total', 'brand_name']]]);
        $this->gerente()->getJson("/api/v1/cli/clientes/{$id}/comprobantes")->assertOk();
    }

    public function test_rn_cli_09_bloquear_exige_motivo_y_permiso(): void
    {
        $id = $this->gerente()->getJson('/api/v1/cli/clientes?q=998800000')->json('data.0.id');
        $this->gerente()->postJson("/api/v1/cli/clientes/{$id}/bloquear", ['motivo' => ''])->assertUnprocessable();
        $this->gerente()->postJson("/api/v1/cli/clientes/{$id}/bloquear", ['motivo' => 'Deuda: tres facturas vencidas'])->assertOk()->assertJsonPath('status', 'BLOCKED');
        $this->gerente()->postJson("/api/v1/cli/clientes/{$id}/desbloquear", ['nota' => 'Pagó'])->assertOk()->assertJsonPath('status', 'ACTIVE');

        $vendedora = $this->ingresar(self::DG, 'ana.torres@donguando.pe');
        $this->desde(self::DG, $vendedora)->postJson("/api/v1/cli/clientes/{$id}/bloquear", ['motivo' => 'x'])->assertForbidden();
    }

    public function test_rn_cli_13_consentimiento_con_constancia(): void
    {
        $id = $this->gerente()->getJson('/api/v1/cli/clientes?q=998800000')->json('data.0.id');
        $this->gerente()->postJson("/api/v1/cli/clientes/{$id}/consentimiento", ['acepta' => true, 'canal' => 'WHATSAPP'])->assertOk()->assertJsonPath('marketing_opt_in', true);
        $this->travel(5)->minutes();
        $this->gerente()->postJson("/api/v1/cli/clientes/{$id}/consentimiento", ['acepta' => false, 'canal' => 'WHATSAPP', 'evidencia' => 'Escribió BAJA'])->assertOk();
        $f = $this->gerente()->getJson("/api/v1/cli/clientes/{$id}")->json();
        $this->assertFalse($f['marketing_opt_in']);
        $this->assertSame('Escribió BAJA', $f['consentimientos'][0]['evidence_text']);
    }

    public function test_marketing_solo_consulta(): void
    {
        $mk = $this->ingresar(self::DG, 'lparedes@donguando.pe');
        $this->desde(self::DG, $mk)->getJson('/api/v1/cli/clientes')->assertOk();
        $this->desde(self::DG, $mk)->postJson('/api/v1/cli/clientes/rapida', ['phone' => '956000111', 'full_name' => 'X', 'customer_type' => 'PERSON', 'source_channel' => 'WHATSAPP'])
            ->assertForbidden();
        $this->desde(self::DG, $mk)->get('/api/v1/cli/clientes/exportar')->assertForbidden();
        if (class_exists(Spreadsheet::class)) {
            $this->gerente()->get('/api/v1/cli/clientes/exportar')->assertOk();
        }
    }
}
