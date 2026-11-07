<?php

namespace Tests\Feature\Modulos;

use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/** PLT-14 Asistente de configuración: el avance sale de los datos reales. */
class PltAsistenteTest extends TestCase
{
    private ?string $token = null;

    private function gerente(): static
    {
        return $this->desde(self::DG, $this->token ??= $this->ingresar(self::DG, 'rquispe@donguando.pe'));
    }

    private function check(array $r, string $paso, string $label): array
    {
        $p = collect($r['pasos'])->firstWhere('key', $paso);

        return collect($p['checks'])->firstWhere('label', $label);
    }

    public function test_calcula_los_pasos_con_los_datos_del_cliente(): void
    {
        $r = $this->gerente()->getJson('/api/v1/plt/asistente')->assertOk()->json();

        $this->assertCount(8, $r['pasos']);
        $this->assertSame(array_sum(array_column($r['pasos'], 'total')), $r['total']);
        $this->assertTrue($this->check($r, 'empresa', 'Razón social y RUC válido en cada empresa')['ok']);
        $this->assertTrue($this->check($r, 'locales', 'Todos con su ubicación en el mapa')['ok']);
        // NI09 está sobre el 95 %: la comprobación queda pendiente y dice cuál.
        $series = $this->check($r, 'series', 'Ninguna serie sobre el 95 % del rango');
        $this->assertFalse($series['ok']);
        $this->assertSame('NI09', $series['detalle']);
        $this->assertFalse($this->check($r, 'marcas', 'Logo general del cliente')['ok']);
    }

    public function test_una_comprobacion_se_marca_sola_al_completar_el_dato(): void
    {
        Storage::fake('local');
        $this->gerente()->post('/api/v1/plt/temas/logo', ['logo' => UploadedFile::fake()->image('logo.png', 300, 120)], ['Accept' => 'application/json'])->assertOk();

        $r = $this->gerente()->getJson('/api/v1/plt/asistente')->json();
        $this->assertTrue($this->check($r, 'marcas', 'Logo general del cliente')['ok']);
    }
}
