<?php

namespace Tests\Feature\Modulos;

use Illuminate\Support\Carbon;
use Tests\TestCase;

/** CAT-09 Publicación web: RN-CAT-09 y KPI-CAT-02. */
class CatWebTest extends TestCase
{
    private ?string $token = null;

    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo(Carbon::parse('2026-11-07 10:00', 'America/Lima'));
    }

    private function marketing(): static
    {
        return $this->desde(self::DG, $this->token ??= $this->ingresar(self::DG, 'lparedes@donguando.pe'));
    }

    private function web(): array
    {
        return $this->marketing()->getJson('/api/v1/cat/web')->assertOk()->json();
    }

    private function producto(string $code): array
    {
        return collect($this->web()['filas'])->firstWhere('code', $code);
    }

    public function test_lista_los_productos_de_venta_con_su_estado_web(): void
    {
        $w = $this->web();
        $this->assertGreaterThan(0, $w['resumen']['publicados']);
        $this->assertGreaterThanOrEqual(1, $w['resumen']['bloqueados']); // la mermelada vencida
        $this->assertNotContains('INSUMO', array_column($w['filas'], 'product_type'));
        $cuy = $this->producto('CUY-ENT');
        $this->assertTrue($cuy['web_publishable']);
        $this->assertGreaterThan(0, $cuy['variantes_web']);
    }

    /** RN-CAT-09 */
    public function test_no_publica_con_registro_vencido_y_publicar_deja_pendiente(): void
    {
        $merm = $this->producto('MERM');
        $this->marketing()->putJson("/api/v1/cat/web/{$merm['id']}/publicar", ['web_publishable' => true])
            ->assertUnprocessable()->assertJsonPath('code', 'RN-CAT-09');

        $cuy = $this->producto('CUY-ENT');
        $this->marketing()->putJson("/api/v1/cat/web/{$cuy['id']}/publicar", ['web_publishable' => false])->assertNoContent();
        $cuy = $this->producto('CUY-ENT');
        $this->assertFalse($cuy['web_publishable']);
        $this->assertSame('PENDING', $cuy['web_sync_status']);

        $this->marketing()->postJson("/api/v1/cat/web/{$cuy['id']}/enviar")->assertNoContent();
        $this->assertSame('NOT_PUBLISHED', $this->producto('CUY-ENT')['web_sync_status']);
    }

    public function test_guarda_titulo_y_variantes_publicadas(): void
    {
        $cuy = $this->producto('CUY-ENT');
        $mit = collect($cuy['variantes'])->firstWhere('sku', 'DG-CUY-MIT');
        $this->marketing()->putJson("/api/v1/cat/web/{$cuy['id']}", ['web_title' => 'Cuy entero beneficiado listo para hornear', 'image_url' => 'cat/cuy-entero.jpg',
            'variantes' => [$mit['id'] => ! $mit['web_publishable']]])->assertNoContent();

        $cuy = $this->producto('CUY-ENT');
        $this->assertSame('Cuy entero beneficiado listo para hornear', $cuy['web_title']);
        $this->assertSame(! $mit['web_publishable'], collect($cuy['variantes'])->firstWhere('sku', 'DG-CUY-MIT')['web_publishable']);
        $this->assertSame('PENDING', $cuy['web_sync_status']);
    }

    public function test_la_vendedora_consulta_pero_no_publica(): void
    {
        $g = $this->desde(self::DG, $this->ingresar(self::DG, 'ana.torres@donguando.pe'));
        $cuy = collect($g->getJson('/api/v1/cat/web')->assertOk()->json('filas'))->firstWhere('code', 'CUY-ENT');
        $g->putJson("/api/v1/cat/web/{$cuy['id']}/publicar", ['web_publishable' => false])->assertForbidden();
    }
}
