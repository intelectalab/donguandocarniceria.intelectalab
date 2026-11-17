<?php

namespace Tests\Feature\Modulos;

use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/** CLI-07 Enlace de ubicación: un solo uso, vence, solo uno vivo por cliente; el cliente lo abre sin sesión. */
class CliEnlacesTest extends TestCase
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
        return $this->gerente()->postJson('/api/v1/cli/clientes', ['full_name' => 'Pedro Enlace', 'customer_type' => 'PERSON', 'doc_type' => 'NONE', 'phone' => '956555666'])
            ->assertCreated()->json('customer.id');
    }

    public function test_el_cliente_marca_su_pin_una_sola_vez(): void
    {
        $id = $this->cliente();
        $r = $this->gerente()->postJson("/api/v1/cli/clientes/{$id}/enlace")->assertCreated();
        $token = $r->json('token');
        $this->assertSame(32, strlen($token));
        // Solo se guarda el hash.
        $this->assertFalse(DB::table('customer_location_links')->where('token_hash', $token)->exists());

        $this->flushHeaders();
        $this->getJson("/api/v1/publico/ubicacion/{$token}")->assertOk()->assertJsonPath('nombre', 'Pedro');
        $this->postJson("/api/v1/publico/ubicacion/{$token}", ['address_line' => 'Av. Primavera 645', 'district' => 'Santiago de Surco', 'reference' => 'casa'])
            ->assertUnprocessable()->assertJsonPath('code', 'RN-CLI-02');
        $this->postJson("/api/v1/publico/ubicacion/{$token}", ['address_line' => 'Av. Primavera 645', 'district' => 'Santiago de Surco',
            'reference' => 'Torre empresarial, dejar en portería', 'lat' => -12.11, 'lng' => -76.99])->assertCreated()->assertJsonPath('zona.name', 'Surco B (Chacarilla – Primavera)');
        // De un solo uso.
        $this->getJson("/api/v1/publico/ubicacion/{$token}")->assertUnprocessable()->assertJsonPath('code', 'RN-CLI-05');
        // Enviarlo otra vez no deja una segunda dirección.
        $this->postJson("/api/v1/publico/ubicacion/{$token}", ['address_line' => 'Jr. Otro 123', 'district' => 'Santiago de Surco',
            'reference' => 'Segundo envío del mismo enlace', 'lat' => -12.11, 'lng' => -76.99])->assertUnprocessable()->assertJsonPath('code', 'RN-CLI-05');

        $dirs = $this->gerente()->getJson("/api/v1/cli/clientes/{$id}/direcciones")->json('direcciones');
        $this->assertCount(1, $dirs);
        $this->assertSame('LINK', $dirs[0]['pin_source']);
        $enlaces = $this->gerente()->getJson("/api/v1/cli/enlaces?customer_id={$id}")->assertOk()->json('data');
        $this->assertSame('USED', $enlaces[0]['estado']);
        $this->assertSame('Av. Primavera 645', $enlaces[0]['resultado']);
    }

    public function test_vence_y_generar_otro_anula_el_anterior(): void
    {
        $id = $this->cliente();
        $viejo = $this->gerente()->postJson("/api/v1/cli/clientes/{$id}/enlace")->json('token');
        $nuevo = $this->gerente()->postJson("/api/v1/cli/clientes/{$id}/enlace")->json('token');
        $this->flushHeaders();
        $this->getJson("/api/v1/publico/ubicacion/{$viejo}")->assertUnprocessable();
        $this->getJson("/api/v1/publico/ubicacion/{$nuevo}")->assertOk();

        $this->travel(25)->hours();
        $this->getJson("/api/v1/publico/ubicacion/{$nuevo}")->assertUnprocessable()->assertJsonPath('code', 'RN-CLI-05');
        $this->getJson('/api/v1/publico/ubicacion/'.str_repeat('a', 32))->assertUnprocessable();
    }
}
