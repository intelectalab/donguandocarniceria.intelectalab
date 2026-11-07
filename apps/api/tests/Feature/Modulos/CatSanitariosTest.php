<?php

namespace Tests\Feature\Modulos;

use Illuminate\Http\UploadedFile;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/** CAT-10 Registros sanitarios: RN-CAT-09 y CA-CAT-05. */
class CatSanitariosTest extends TestCase
{
    private ?string $token = null;

    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo(Carbon::parse('2026-11-07 10:00', 'America/Lima'));
    }

    private function admin(): static
    {
        return $this->desde(self::DG, $this->token ??= $this->ingresar(self::DG, 'chuaman@donguando.pe'));
    }

    private function fila(string $code): array
    {
        return collect($this->admin()->getJson('/api/v1/cat/sanitarios')->assertOk()->json('filas'))->firstWhere('code', $code);
    }

    public function test_lista_con_semaforo_y_los_vencidos_primero(): void
    {
        $r = $this->admin()->getJson('/api/v1/cat/sanitarios')->assertOk()->json();
        $this->assertSame('EXPIRED', $r['filas'][0]['sanitario']['code']);
        $this->assertGreaterThan(0, $r['resumen']['vencidos']);
        $this->assertSame(90, $r['resumen']['dias_aviso']);
        $this->assertSame('EXPIRED', $this->fila('MERM')['sanitario']['code']);
        $this->assertSame('MISSING', $this->fila('PATE')['sanitario']['code']);
    }

    public function test_renueva_un_registro_y_activa_el_producto(): void
    {
        $pate = $this->fila('PATE');
        $datos = ['sanitary_authority' => 'DIGESA', 'sanitary_registry' => 'R.S. N9999N-NADGAN', 'sanitary_registry_expires' => '2026-11-01', 'activar' => true];
        $this->admin()->putJson("/api/v1/cat/sanitarios/{$pate['id']}", $datos)->assertUnprocessable()->assertJsonPath('code', 'RN-CAT-09');

        // CA-CAT-05: vence en 60 días → ámbar.
        $this->admin()->putJson("/api/v1/cat/sanitarios/{$pate['id']}", ['sanitary_registry_expires' => '2027-01-06'] + $datos)
            ->assertOk()->assertJsonPath('sanitario.code', 'AMBER');
        $pate = $this->fila('PATE');
        $this->assertSame('ACTIVE', $pate['status']);
        $this->assertSame('Vence en 60 días', $pate['sanitario']['label']);
    }

    public function test_sube_y_descarga_el_certificado(): void
    {
        Storage::fake('local');
        $merm = $this->fila('MERM');
        $this->admin()->post("/api/v1/cat/sanitarios/{$merm['id']}/certificado", ['certificado' => UploadedFile::fake()->create('rs.pdf', 100, 'application/pdf')], ['Accept' => 'application/json'])
            ->assertOk()->assertJsonPath('sanitary_certificate', $merm['id'].'.pdf');
        $this->admin()->get("/api/v1/cat/sanitarios/{$merm['id']}/certificado")->assertOk();
        $this->admin()->post("/api/v1/cat/sanitarios/{$merm['id']}/certificado", ['certificado' => UploadedFile::fake()->create('rs.exe', 10)], ['Accept' => 'application/json'])
            ->assertUnprocessable();
    }

    public function test_la_vendedora_consulta_pero_no_renueva(): void
    {
        $merm = $this->fila('MERM');
        $ana = $this->desde(self::DG, $this->ingresar(self::DG, 'ana.torres@donguando.pe'));
        $ana->getJson('/api/v1/cat/sanitarios')->assertOk();
        $ana->putJson("/api/v1/cat/sanitarios/{$merm['id']}", [])->assertForbidden();
    }
}
