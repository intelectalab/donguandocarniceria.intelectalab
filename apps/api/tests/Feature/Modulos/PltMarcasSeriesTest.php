<?php

namespace Tests\Feature\Modulos;

use App\Modulos\Plt\Models\DocumentSeries;
use App\Modulos\Plt\Services\Correlativo;
use App\Modulos\Plt\Services\Marcas;
use App\Support\RuleError;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use RuntimeException;
use Tests\TestCase;

/** PLT-05 Marcas y PLT-08 Series, con el servicio de correlativo. */
class PltMarcasSeriesTest extends TestCase
{
    private function gerente(): static
    {
        return $this->desde(self::DG, $this->ingresar(self::DG, 'rquispe@donguando.pe'));
    }

    private function empresaDg(): string
    {
        return $this->gerente()->getJson('/api/v1/plt/empresas?q=agropecuaria')->json('data.0.id');
    }

    private function marca(string $empresa, array $cambios = []): array
    {
        return $cambios + [
            'company_id' => $empresa, 'code' => 'm6', 'name' => 'Marca 6', 'primary_color' => '#1a5c8a',
            'whatsapp_display_name' => 'Marca 6', 'legal_footer' => 'Representación impresa de la boleta electrónica.',
            'sort_order' => 6, 'status' => 'ACTIVE', 'print_show_logo' => true,
        ];
    }

    public function test_lista_las_marcas_en_orden_con_su_uso(): void
    {
        $marcas = $this->gerente()->getJson('/api/v1/plt/marcas')->assertOk()->json('data');

        $this->assertSame(['DG', 'M2', 'M3', 'M4', 'M5'], array_column($marcas, 'code'));
        $this->assertNotEmpty($marcas[0]['company_name']);
        $this->assertGreaterThan(0, $marcas[0]['series_count']);
        $this->assertGreaterThan(0, $marcas[0]['documents_count']);
    }

    public function test_crea_y_edita_una_marca(): void
    {
        $empresa = $this->empresaDg();
        $r = $this->gerente()->postJson('/api/v1/plt/marcas', $this->marca($empresa))->assertCreated();
        $this->assertSame('M6', $r->json('code'));
        $this->assertSame('#1A5C8A', $r->json('primary_color'));

        // El código no cambia al editar.
        $this->gerente()->putJson('/api/v1/plt/marcas/'.$r->json('id'), $this->marca($empresa, ['code' => 'XX', 'name' => 'Marca 6 · Lácteos']))
            ->assertOk()->assertJsonPath('code', 'M6')->assertJsonPath('name', 'Marca 6 · Lácteos');

        $this->gerente()->postJson('/api/v1/plt/marcas', $this->marca($empresa, ['code' => 'DG', 'legal_footer' => '']))
            ->assertUnprocessable()->assertJsonValidationErrors(['code' => 'Ya existe una marca', 'legal_footer' => 'pie legal']);
        $this->gerente()->postJson('/api/v1/plt/marcas', $this->marca($empresa, ['code' => 'M7', 'status' => 'SEPARATED']))
            ->assertUnprocessable()->assertJsonValidationErrors(['status']);
    }

    public function test_una_marca_inactiva_no_admite_documentos_nuevos(): void
    {
        $m2 = $this->gerente()->getJson('/api/v1/plt/marcas?q=cortes')->json('data.0');
        $this->gerente()->putJson("/api/v1/plt/marcas/{$m2['id']}", ['status' => 'INACTIVE'] + $m2)->assertOk();

        try {
            Marcas::activa($m2['id']);
            $this->fail('Debió rechazar la marca inactiva.');
        } catch (RuleError $e) {
            $this->assertSame('RN-PLT-14', $e->rule);
            $this->assertStringContainsString('está inactiva', $e->getMessage());
        }
    }

    public function test_sin_el_permiso_no_edita_marcas(): void
    {
        // ADMINISTRACION edita PLT pero no tiene plt.brand.manage.
        $admin = $this->desde(self::DG, $this->ingresar(self::DG, 'chuaman@donguando.pe'));
        $m2 = $admin->getJson('/api/v1/plt/marcas?q=cortes')->assertOk()->json('data.0');
        $admin->putJson("/api/v1/plt/marcas/{$m2['id']}", $m2)->assertForbidden();
    }

    public function test_la_lista_dice_que_marcas_tienen_tema_propio(): void
    {
        $marcas = collect($this->gerente()->getJson('/api/v1/plt/marcas')->json('data'))->keyBy('code');

        $this->assertNotNull($marcas['DG']['theme_name']);
        $this->assertNull($marcas['M2']['theme_name']); // usa el tema de la empresa
    }

    public function test_desactiva_y_activa_varias_marcas(): void
    {
        $marcas = collect($this->gerente()->getJson('/api/v1/plt/marcas')->json('data'))->keyBy('code');
        $ids = [$marcas['M3']['id'], $marcas['M4']['id']];

        $this->gerente()->putJson('/api/v1/plt/marcas/estado', ['ids' => $ids, 'status' => 'INACTIVE'])
            ->assertOk()->assertJsonPath('cambiadas', 2);
        $this->assertSame(['INACTIVE'], collect($this->gerente()->getJson('/api/v1/plt/marcas?status=INACTIVE')->json('data'))
            ->pluck('status')->unique()->values()->all());
        $this->gerente()->putJson('/api/v1/plt/marcas/estado', ['ids' => $ids, 'status' => 'ACTIVE'])
            ->assertOk()->assertJsonPath('cambiadas', 2);

        $this->gerente()->putJson('/api/v1/plt/marcas/estado', ['ids' => [], 'status' => 'INACTIVE'])
            ->assertUnprocessable()->assertJsonValidationErrors(['ids']);
        $admin = $this->desde(self::DG, $this->ingresar(self::DG, 'chuaman@donguando.pe'));
        $admin->putJson('/api/v1/plt/marcas/estado', ['ids' => $ids, 'status' => 'INACTIVE'])->assertForbidden();
    }

    public function test_sube_cambia_y_quita_el_logo_de_una_marca(): void
    {
        Storage::fake('local');
        $id = $this->gerente()->getJson('/api/v1/plt/marcas?q=cortes')->json('data.0.id');

        $this->gerente()->post("/api/v1/plt/marcas/{$id}/logo", ['logo' => UploadedFile::fake()->create('logo.pdf', 10, 'application/pdf')], ['Accept' => 'application/json'])
            ->assertUnprocessable()->assertJsonValidationErrors(['logo' => 'PNG, JPG o WEBP']);
        $this->gerente()->post("/api/v1/plt/marcas/{$id}/logo", ['logo' => UploadedFile::fake()->image('logo.png', 200, 80)], ['Accept' => 'application/json'])
            ->assertOk()->assertJsonPath('logo_url', 'M2.png');
        $this->gerente()->get("/api/v1/plt/marcas/{$id}/logo")->assertOk()->assertHeader('Content-Type', 'image/png');

        // Cambiarlo por un JPG borra el PNG anterior.
        $this->gerente()->post("/api/v1/plt/marcas/{$id}/logo", ['logo' => UploadedFile::fake()->image('logo.jpg', 200, 80)], ['Accept' => 'application/json'])
            ->assertOk()->assertJsonPath('logo_url', 'M2.jpg');
        $this->assertCount(1, Storage::disk('local')->allFiles());

        $this->gerente()->deleteJson("/api/v1/plt/marcas/{$id}/logo")->assertOk()->assertJsonPath('logo_url', null);
        $this->assertCount(0, Storage::disk('local')->allFiles());
        $this->gerente()->getJson("/api/v1/plt/marcas/{$id}/logo")->assertNotFound();
    }

    public function test_desactiva_varias_series_con_un_motivo(): void
    {
        $ids = collect($this->gerente()->getJson('/api/v1/plt/series?q=NI')->json('data'))->pluck('id')->all();
        $this->assertNotEmpty($ids);

        $this->gerente()->putJson('/api/v1/plt/series/estado', ['ids' => $ids, 'status' => 'INACTIVE'])
            ->assertUnprocessable()->assertJsonValidationErrors(['reason']);
        $this->gerente()->putJson('/api/v1/plt/series/estado', ['ids' => $ids, 'status' => 'INACTIVE', 'reason' => 'Notas internas pasan a ALM'])
            ->assertOk()->assertJsonPath('cambiadas', count($ids));
        $this->assertSame(['INACTIVE'], collect($this->gerente()->getJson('/api/v1/plt/series?q=NI')->json('data'))->pluck('status')->unique()->values()->all());
    }

    public function test_series_con_formato_sunat_y_sin_repetir(): void
    {
        $base = ['company_id' => $this->empresaDg(), 'doc_type' => 'RECEIPT', 'is_electronic' => true, 'next_number' => 1];

        $this->gerente()->postJson('/api/v1/plt/series', ['series' => 'b011'] + $base)->assertCreated()->assertJsonPath('series', 'B011');
        $this->gerente()->postJson('/api/v1/plt/series', ['series' => 'F011'] + $base)
            ->assertUnprocessable()->assertJsonValidationErrors(['series' => 'formato que pide SUNAT']);
        $this->gerente()->postJson('/api/v1/plt/series', ['series' => 'B001'] + $base)
            ->assertUnprocessable()->assertJsonValidationErrors(['series' => 'ya existe']);
        $this->gerente()->postJson('/api/v1/plt/series', ['series' => 'FC09', 'doc_type' => 'CREDIT_NOTE'] + $base)
            ->assertCreated()->assertJsonPath('applies_to', 'INVOICE');
        $this->gerente()->postJson('/api/v1/plt/series', ['series' => 'OC09', 'doc_type' => 'PURCHASE_ORDER'] + $base)
            ->assertUnprocessable()->assertJsonValidationErrors(['is_electronic']);
        $this->gerente()->postJson('/api/v1/plt/series', ['series' => 'OC09', 'doc_type' => 'PURCHASE_ORDER', 'is_electronic' => false] + $base)
            ->assertCreated();

        // NI09 (notas internas migradas) está en el 96 % del rango.
        $resumen = $this->gerente()->getJson('/api/v1/plt/series/resumen')->assertOk();
        $this->assertSame(1, $resumen->json('sobre_aviso'));
        // KPI-PLT-02: la serie más cargada es NI09; las series migradas no suman documentos numerados.
        $this->assertSame(['series' => 'NI09', 'uso' => 96], $resumen->json('mas_cargada'));
        $this->assertLessThan(90_000_000, $resumen->json('numerados'));
        $this->assertGreaterThan(0, $resumen->json('numerados'));
    }

    public function test_el_correlativo_no_salta_si_una_emision_falla(): void
    {
        $this->gerente()->getJson('/api/v1/me')->assertOk(); // deja el contexto de la empresa en la conexión
        $serie = DocumentSeries::where('series', 'B002')->firstOrFail();
        $inicio = $serie->next_number;

        $numeros = [];
        for ($i = 1; $i <= 10; $i++) {
            try {
                $numeros[] = Correlativo::emitir($serie->id, function (DocumentSeries $s, int $n) use ($i) {
                    if ($i === 5) {
                        throw new RuntimeException('falla simulada');
                    }

                    return $n;
                });
            } catch (RuntimeException $e) {
                $this->assertSame('falla simulada', $e->getMessage());
            }
        }

        $this->assertSame(range($inicio, $inicio + 8), $numeros);
        $this->assertSame($inicio + 9, $serie->fresh()->next_number);
        $this->assertSame('B002-00000147', Correlativo::numeroCompleto('B002', 147));
    }

    public function test_una_serie_desactivada_no_numera(): void
    {
        $id = $this->gerente()->getJson('/api/v1/plt/series?q=B002')->json('data.0.id');
        $this->gerente()->putJson("/api/v1/plt/series/{$id}/estado", ['status' => 'INACTIVE', 'reason' => 'corto'])
            ->assertUnprocessable()->assertJsonValidationErrors(['reason']);
        $this->gerente()->putJson("/api/v1/plt/series/{$id}/estado", ['status' => 'INACTIVE', 'reason' => 'Marca 2 deja la tienda'])
            ->assertOk()->assertJsonPath('status', 'INACTIVE');

        $this->expectException(RuleError::class);
        $this->expectExceptionMessage('está desactivada');
        Correlativo::emitir($id, fn (DocumentSeries $s, int $n) => $n);
    }
}
