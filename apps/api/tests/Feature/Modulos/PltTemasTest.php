<?php

namespace Tests\Feature\Modulos;

use App\Modulos\Plt\Services\Temas;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/** PLT-06 Colores por marca (RN-PLT-15 contraste, RN-PLT-23 el de la empresa como respaldo). */
class PltTemasTest extends TestCase
{
    private ?string $token = null;

    private function gerente(): static
    {
        return $this->desde(self::DG, $this->token ??= $this->ingresar(self::DG, 'rquispe@donguando.pe'));
    }

    private function marca(string $code): string
    {
        $this->gerente()->getJson('/api/v1/me')->assertOk(); // contexto de la empresa para leer la base

        return DB::table('brands')->where('code', $code)->value('id');
    }

    public function test_contraste_wcag(): void
    {
        $this->assertSame(21.0, Temas::contraste('#000000', '#FFFFFF'));
        $this->assertSame(1.0, Temas::contraste('#922242', '#922242'));
        $this->assertGreaterThan(4.5, Temas::contraste('#1D1D1D', '#FBF8F0'));
    }

    public function test_una_marca_sin_tema_usa_el_de_la_empresa(): void
    {
        $m2 = $this->marca('M2');
        $r = $this->gerente()->getJson("/api/v1/plt/temas?brand_id={$m2}")->assertOk();
        $this->assertFalse($r->json('propio'));
        $this->assertSame('Tema de la empresa', $r->json('tema.name'));

        $dg = $this->marca('DG');
        $this->gerente()->getJson("/api/v1/plt/temas?brand_id={$dg}")->assertOk()
            ->assertJsonPath('propio', true)->assertJsonPath('tema.light.primary', '#922242');
    }

    public function test_guarda_una_version_nueva_si_el_texto_se_lee_bien(): void
    {
        $m2 = $this->marca('M2');
        $base = $this->gerente()->getJson("/api/v1/plt/temas?brand_id={$m2}")->json('tema');
        $claro = ['primary' => '#7a3b10'] + $base['light'];

        // Texto blanco sobre amarillo no se lee.
        $this->gerente()->postJson('/api/v1/plt/temas', ['brand_id' => $m2, 'light' => ['primary' => '#FFE14D', 'on_primary' => '#FFFFFF'] + $base['light'], 'dark' => $base['dark']])
            ->assertUnprocessable()->assertJsonPath('code', 'RN-PLT-15');
        $this->gerente()->postJson('/api/v1/plt/temas', ['brand_id' => $m2, 'light' => ['text' => 'rojo'] + $base['light'], 'dark' => $base['dark']])
            ->assertUnprocessable()->assertJsonPath('message', 'Texto (modo claro) no es un color #RRGGBB.');

        $this->gerente()->postJson('/api/v1/plt/temas', ['brand_id' => $m2, 'light' => $claro, 'dark' => $base['dark']])
            ->assertCreated()->assertJsonPath('light.primary', '#7A3B10')->assertJsonPath('status', 'ACTIVE');
        $this->gerente()->postJson('/api/v1/plt/temas', ['brand_id' => $m2, 'light' => ['primary' => '#6B3410'] + $claro, 'dark' => $base['dark']])->assertCreated();

        $r = $this->gerente()->getJson("/api/v1/plt/temas?brand_id={$m2}")->assertOk();
        $this->assertTrue($r->json('propio'));
        $this->assertSame(['ACTIVE', 'INACTIVE'], array_column($r->json('versiones'), 'status'));

        // Quitarlo: vuelve al de la empresa.
        $this->gerente()->postJson('/api/v1/plt/temas/quitar', ['brand_id' => $m2])->assertOk();
        $this->gerente()->getJson("/api/v1/plt/temas?brand_id={$m2}")->assertJsonPath('propio', false)->assertJsonPath('tema.name', 'Tema de la empresa');
        $this->gerente()->postJson('/api/v1/plt/temas/quitar', ['brand_id' => $m2])->assertUnprocessable();
    }

    public function test_sin_el_permiso_no_cambia_colores(): void
    {
        $admin = $this->desde(self::DG, $this->ingresar(self::DG, 'chuaman@donguando.pe'));
        $admin->getJson('/api/v1/plt/temas')->assertOk();
        $admin->postJson('/api/v1/plt/temas', ['light' => [], 'dark' => []])->assertForbidden();
    }
}
