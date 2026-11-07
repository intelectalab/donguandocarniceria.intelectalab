<?php

namespace Tests\Feature\Modulos;

use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/** Logo del cliente (PLT-06, pestaña General): subir, ver en el armazón y en el ingreso por dominio. */
class PltLogoClienteTest extends TestCase
{
    private ?string $token = null;

    private function gerente(): static
    {
        return $this->desde(self::DG, $this->token ??= $this->ingresar(self::DG, 'rquispe@donguando.pe'));
    }

    private function subir(UploadedFile $archivo)
    {
        return $this->gerente()->post('/api/v1/plt/temas/logo', ['logo' => $archivo], ['Accept' => 'application/json']);
    }

    public function test_sube_cambia_y_quita_el_logo(): void
    {
        Storage::fake('local');
        $this->subir(UploadedFile::fake()->create('logo.svg', 5, 'image/svg+xml'))->assertUnprocessable()->assertJsonValidationErrors(['logo' => 'PNG, JPG o WEBP']);
        $this->subir(UploadedFile::fake()->image('logo.png', 400, 160)->size(2048))->assertUnprocessable()->assertJsonValidationErrors(['logo' => '1 MB']);
        $this->subir(UploadedFile::fake()->image('logo.png', 400, 160))->assertOk()->assertJsonPath('logo_url', 'logo.png');

        // El armazón lo recibe en /me y lo pide con la sesión.
        $url = $this->gerente()->getJson('/api/v1/me')->assertOk()->json('tenant.logo_url');
        $this->assertStringStartsWith('/api/v1/tenant/logo?v=', $url);
        $this->gerente()->get('/api/v1/tenant/logo')->assertOk()->assertHeader('X-Content-Type-Options', 'nosniff');

        $this->subir(UploadedFile::fake()->image('logo.webp', 400, 160))->assertOk()->assertJsonPath('logo_url', 'logo.webp');
        $this->assertCount(1, Storage::disk('local')->allFiles());

        $this->gerente()->deleteJson('/api/v1/plt/temas/logo')->assertOk()->assertJsonPath('logo_url', null);
        $this->assertCount(0, Storage::disk('local')->allFiles());
        $this->assertNull($this->gerente()->getJson('/api/v1/me')->json('tenant.logo_url'));
    }

    public function test_cada_cliente_tiene_su_logo(): void
    {
        Storage::fake('local');
        $this->subir(UploadedFile::fake()->image('logo.png', 400, 160))->assertOk();
        // La fila es del cliente de la sesión (RLS): una sola, de Don Guando.
        $this->assertSame(1, DB::table('tenant_branding')->count());

        // Ingreso general: sin cliente todavía, sin logo.
        $this->desde(self::DG)->getJson('/api/v1/tenant')->assertOk()->assertJsonPath('logo_url', null);

        // Por dominio: el logo de Don Guando sale en su ingreso y no en el de otro cliente.
        config(['aycha.tenant_por_dominio' => true]);
        $this->assertStringStartsWith('/api/v1/tenant/logo?v=', $this->desde(self::DG)->getJson('/api/v1/tenant')->json('logo_url'));
        $this->desde(self::DG)->get('/api/v1/tenant/logo')->assertOk()->assertHeader('Content-Type', 'image/png');
        $this->desde(self::CS)->getJson('/api/v1/tenant')->assertJsonPath('logo_url', null);
        $this->desde(self::CS)->get('/api/v1/tenant/logo')->assertNotFound();
    }

    public function test_sin_el_permiso_no_cambia_el_logo(): void
    {
        $admin = $this->desde(self::DG, $this->ingresar(self::DG, 'chuaman@donguando.pe'));
        $admin->post('/api/v1/plt/temas/logo', ['logo' => UploadedFile::fake()->image('logo.png', 100, 100)], ['Accept' => 'application/json'])->assertForbidden();
    }
}
