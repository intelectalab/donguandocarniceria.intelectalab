<?php

namespace Tests\Feature\Modulos;

use App\Modulos\Plt\Services\Dominios;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/** PLT-13 Dominio de acceso (RN-PLT-19). tenant_hostnames es global: se prueba el aislamiento a mano. */
class PltDominiosTest extends TestCase
{
    private ?string $token = null;

    private function gerente(): static
    {
        return $this->desde(self::DG, $this->token ??= $this->ingresar(self::DG, 'rquispe@donguando.pe'));
    }

    protected function tearDown(): void
    {
        Dominios::$resolverTxt = null;
        parent::tearDown();
    }

    public function test_solo_ve_los_dominios_de_su_empresa(): void
    {
        $r = $this->gerente()->getJson('/api/v1/plt/dominios')->assertOk();
        $hosts = array_column($r->json('dominios'), 'hostname');

        $this->assertContains('donguando.aycha.pe', $hosts);
        $this->assertContains('sistema.donguando.com', $hosts);
        $this->assertNotContains('carnesselectas.aycha.pe', $hosts);
        $this->assertSame('ACTIVE', $r->json('empresa.status'));

        // Uno asignado por la plataforma no se desactiva desde aquí.
        $local = collect($r->json('dominios'))->firstWhere('hostname', 'donguando.localhost');
        $this->assertTrue($local['plataforma']);
        $this->gerente()->postJson("/api/v1/plt/dominios/{$local['id']}/desactivar")->assertUnprocessable()->assertJsonPath('code', 'RN-PLT-19');
    }

    public function test_no_agrega_dominios_de_aycha_ni_ajenos_ni_invalidos(): void
    {
        $agregar = fn (string $h) => $this->gerente()->postJson('/api/v1/plt/dominios', ['hostname' => $h]);

        $agregar('otra.aycha.pe')->assertUnprocessable()->assertJsonPath('code', 'RN-PLT-19');
        $agregar('carnesselectas.aycha.pe')->assertUnprocessable();
        $agregar('donguando.localhost')->assertUnprocessable();
        $agregar('no es un dominio')->assertUnprocessable();
        $agregar('192.168.0.10')->assertUnprocessable();
        // Ya registrado: no dice de qué empresa es.
        $agregar('sistema.donguando.com')->assertUnprocessable()
            ->assertJsonPath('message', 'sistema.donguando.com ya está registrado: cada dominio identifica a una sola empresa.');

        $nuevo = $agregar('Pedidos.DonGuando.pe')->assertCreated();
        $this->assertSame('pedidos.donguando.pe', $nuevo->json('hostname'));
        $this->assertSame('PENDING_DNS', $nuevo->json('status'));
        $this->assertStringStartsWith('aycha-verify=', $nuevo->json('verify_token'));
    }

    public function test_verifica_con_el_registro_txt_y_cambia_el_principal(): void
    {
        $nuevo = $this->gerente()->postJson('/api/v1/plt/dominios', ['hostname' => 'pedidos.donguando.pe'])->assertCreated()->json();

        Dominios::$resolverTxt = fn () => ['v=spf1 -all'];
        $this->gerente()->postJson("/api/v1/plt/dominios/{$nuevo['id']}/verificar")->assertUnprocessable()->assertJsonPath('code', 'RN-PLT-19');

        Dominios::$resolverTxt = fn (string $h) => $h === 'pedidos.donguando.pe' ? [$nuevo['verify_token']] : [];
        $this->gerente()->postJson("/api/v1/plt/dominios/{$nuevo['id']}/verificar", ['primary' => true])->assertOk()
            ->assertJsonPath('status', 'ACTIVE')->assertJsonPath('is_primary', true);

        $principales = array_values(array_filter($this->gerente()->getJson('/api/v1/plt/dominios')->json('dominios'), fn ($d) => $d['is_primary']));
        $this->assertSame(['pedidos.donguando.pe'], array_column($principales, 'hostname'));
        $this->gerente()->postJson("/api/v1/plt/dominios/{$nuevo['id']}/desactivar")->assertUnprocessable(); // es el principal
    }

    public function test_no_toca_dominios_de_otra_empresa(): void
    {
        $this->gerente()->getJson('/api/v1/me')->assertOk();
        $ajeno = DB::table('tenant_hostnames')->where('hostname', 'carnesselectas.aycha.pe')->value('id');

        foreach (['verificar', 'principal', 'desactivar'] as $accion) {
            $this->gerente()->postJson("/api/v1/plt/dominios/{$ajeno}/{$accion}")->assertUnprocessable()->assertJsonPath('message', 'Dominio no encontrado.');
        }
        $this->assertSame('ACTIVE', DB::table('tenant_hostnames')->where('id', $ajeno)->value('status'));
    }

    public function test_sin_el_permiso_solo_ve(): void
    {
        $admin = $this->desde(self::DG, $this->ingresar(self::DG, 'chuaman@donguando.pe'));
        $admin->getJson('/api/v1/plt/dominios')->assertOk();
        $admin->postJson('/api/v1/plt/dominios', ['hostname' => 'pedidos.donguando.pe'])->assertForbidden();
    }
}
