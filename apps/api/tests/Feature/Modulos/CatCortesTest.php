<?php

namespace Tests\Feature\Modulos;

use Illuminate\Support\Carbon;
use Tests\TestCase;

/** CAT-04 Tipos de corte: catálogo editable con las líneas a las que aplica. */
class CatCortesTest extends TestCase
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

    private function corte(string $code): array
    {
        return collect($this->gerente()->getJson('/api/v1/cat/tipos-corte')->assertOk()->json())->firstWhere('code', $code);
    }

    public function test_lista_los_cortes_con_sus_lineas_y_uso(): void
    {
        $entero = $this->corte('ENTERO');
        $this->assertContains('CUY', $entero['applies_to_lines']);
        $this->assertGreaterThan(0, $entero['variantes_activas']);
    }

    public function test_crea_un_corte_y_se_ofrece_solo_en_su_linea(): void
    {
        $this->gerente()->postJson('/api/v1/cat/tipos-corte', ['code' => 'mariposa', 'name' => 'En mariposa', 'applies_to_lines' => ['AVES'], 'status' => 'ACTIVE'])
            ->assertCreated();
        $this->assertSame('En mariposa', $this->corte('MARIPOSA')['name']);

        $cuy = collect($this->gerente()->getJson('/api/v1/cat/productos?tipo=ALL&q=CUY-ENT')->json('data'))->firstWhere('code', 'CUY-ENT');
        $cortes = array_column($this->gerente()->getJson("/api/v1/cat/cortes?product_id={$cuy['id']}")->json(), 'code');
        $this->assertNotContains('MARIPOSA', $cortes);

        // Código único y al menos una línea.
        $this->gerente()->postJson('/api/v1/cat/tipos-corte', ['code' => 'ENTERO', 'name' => 'Otro', 'applies_to_lines' => [], 'status' => 'ACTIVE'])
            ->assertUnprocessable()->assertJsonValidationErrors(['code', 'applies_to_lines']);
    }

    public function test_no_se_inactiva_ni_se_quita_una_linea_en_uso(): void
    {
        $entero = $this->corte('ENTERO');
        $datos = ['code' => 'ENTERO', 'name' => $entero['name'], 'applies_to_lines' => $entero['applies_to_lines'], 'status' => 'INACTIVE'];
        $this->gerente()->putJson("/api/v1/cat/tipos-corte/{$entero['id']}", $datos)->assertUnprocessable()->assertJsonPath('code', 'CAT-04');

        $sinCuy = array_values(array_diff($entero['applies_to_lines'], ['CUY']));
        $this->gerente()->putJson("/api/v1/cat/tipos-corte/{$entero['id']}", ['applies_to_lines' => $sinCuy, 'status' => 'ACTIVE'] + $datos)
            ->assertUnprocessable()->assertJsonPath('code', 'CAT-04');

        $this->gerente()->putJson("/api/v1/cat/tipos-corte/{$entero['id']}", ['name' => 'Entero (pieza)', 'status' => 'ACTIVE'] + $datos)->assertOk();
        $this->assertSame('Entero (pieza)', $this->corte('ENTERO')['name']);
    }

    public function test_la_vendedora_consulta_pero_no_edita(): void
    {
        $ana = $this->desde(self::DG, $this->ingresar(self::DG, 'ana.torres@donguando.pe'));
        $ana->getJson('/api/v1/cat/tipos-corte')->assertOk();
        $ana->postJson('/api/v1/cat/tipos-corte', ['code' => 'X1', 'name' => 'X', 'applies_to_lines' => ['CUY'], 'status' => 'ACTIVE'])->assertForbidden();
    }
}
