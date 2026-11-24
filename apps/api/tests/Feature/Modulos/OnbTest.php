<?php

namespace Tests\Feature\Modulos;

use App\Modulos\Onb\Services\Registro;
use App\Support\TenantContext;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/** ONB-01 · registro de una empresa desde la página pública: código al correo y alta en prueba al verificarlo. */
class OnbTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo(Carbon::parse('2026-11-19 10:00:00', 'America/Lima'));
        $this->withoutMiddleware(ThrottleRequests::class);
    }

    private function publico(): static
    {
        $this->flushHeaders();

        return $this->withHeaders(['Accept' => 'application/json']);
    }

    private function datos(array $cambios = []): array
    {
        return $cambios + [
            'ruc' => '20100047218', 'legal_name' => 'Distribuidora Cárnica del Norte SAC', 'trade_name' => 'Carnes del Norte', 'business_type' => 'DISTRIBUIDORA',
            'tax_regime' => 'MYPE', 'fiscal_address' => 'Av. Industrial 123, Trujillo', 'plan_code' => 'CRECIMIENTO', 'contact_name' => 'Rosa Medina Paz',
            'email' => 'Rosa.Medina@CarnesDelNorte.pe', 'phone' => '987654321', 'password' => 'Norte#Carnes2026', 'password_confirmation' => 'Norte#Carnes2026', 'terms' => true,
        ];
    }

    public function test_registro_verificacion_y_alta_en_prueba(): void
    {
        $this->publico()->postJson('/api/v1/publico/registro', $this->datos())->assertCreated()->assertJsonPath('email', 'rosa.medina@carnesdelnorte.pe');
        $codigo = Registro::$ultimoCodigo;
        $this->assertDatabaseHas('tenant_signups', ['ruc' => '20100047218', 'status' => 'PENDING']);
        $this->assertNull(DB::table('tenants')->where('ruc', '20100047218')->value('id'), 'Sin verificar no hay empresa');

        // Código errado: avisa cuántos intentos quedan.
        $this->publico()->postJson('/api/v1/publico/registro/verificar', ['email' => 'rosa.medina@carnesdelnorte.pe', 'codigo' => 'ZZZZZZ'])
            ->assertStatus(422)->assertJsonFragment(['El código no es correcto. Te quedan 4 intento(s).']);
        $r = $this->publico()->postJson('/api/v1/publico/registro/verificar', ['email' => 'rosa.medina@carnesdelnorte.pe', 'codigo' => strtolower($codigo)])
            ->assertOk()->assertJsonPath('dias', 14);
        $id = $r->json('tenant_id');

        $s = DB::table('tenant_signups')->where('ruc', '20100047218')->first();
        $this->assertSame('PROVISIONED', $s->status);
        $this->assertNull($s->password_hash, 'La contraseña no queda en el registro');
        $this->assertSame('TRIAL', DB::table('subscriptions')->where('tenant_id', $id)->value('status'));
        TenantContext::set(TenantContext::find($id));
        $this->assertSame('ACTIVE', DB::table('users')->where('email', 'rosa.medina@carnesdelnorte.pe')->value('status'));
        $this->assertSame('Av. Industrial 123, Trujillo', DB::table('companies')->value('fiscal_address'));
        TenantContext::set(null);

        // Entra a su sistema con la contraseña que eligió.
        $token = $this->ingresar(self::DG, 'rosa.medina@carnesdelnorte.pe', 'Norte#Carnes2026');
        $this->desde(self::DG, $token)->getJson('/api/v1/me')->assertOk()->assertJsonPath('tenant.id', $id);
        $this->assertDatabaseHas('platform_audit_log', ['action' => 'TENANT_SIGNUP', 'target_tenant_id' => $id]);

        // El mismo RUC ya no se puede registrar.
        $this->publico()->postJson('/api/v1/publico/registro', $this->datos(['email' => 'otra@carnesdelnorte.pe']))->assertStatus(422)->assertJsonValidationErrors('ruc');
    }

    public function test_validaciones_del_registro(): void
    {
        $this->publico()->postJson('/api/v1/publico/registro', $this->datos(['ruc' => '20100047219']))->assertStatus(422)->assertJsonValidationErrors('ruc');
        $this->publico()->postJson('/api/v1/publico/registro', $this->datos(['ruc' => '20609147254']))->assertStatus(422)->assertJsonValidationErrors('ruc');
        $this->publico()->postJson('/api/v1/publico/registro', $this->datos(['password' => 'corta', 'password_confirmation' => 'corta']))->assertStatus(422)->assertJsonValidationErrors('password');
        $this->publico()->postJson('/api/v1/publico/registro', $this->datos(['terms' => false]))->assertStatus(422)->assertJsonValidationErrors('terms');
        // La trampa para robots responde igual pero no guarda.
        $this->publico()->postJson('/api/v1/publico/registro', $this->datos(['sitio_web' => 'http://spam']))->assertCreated();
        $this->assertSame(0, DB::table('tenant_signups')->count());

        // Un registro en curso con otro correo bloquea el RUC; con el mismo correo manda un código nuevo.
        $this->publico()->postJson('/api/v1/publico/registro', $this->datos())->assertCreated();
        $primero = Registro::$ultimoCodigo;
        $this->publico()->postJson('/api/v1/publico/registro', $this->datos(['email' => 'otra@carnesdelnorte.pe']))->assertStatus(422)->assertJsonValidationErrors('ruc');
        $this->publico()->postJson('/api/v1/publico/registro', $this->datos())->assertCreated();
        $this->assertSame(1, DB::table('tenant_signups')->count());
        $this->publico()->postJson('/api/v1/publico/registro/verificar', ['email' => 'rosa.medina@carnesdelnorte.pe', 'codigo' => $primero === Registro::$ultimoCodigo ? 'ZZZZZZ' : $primero])
            ->assertStatus(422);
    }

    public function test_cinco_intentos_y_vencimiento(): void
    {
        $this->publico()->postJson('/api/v1/publico/registro', $this->datos())->assertCreated();
        for ($i = 0; $i < 5; $i++) {
            $this->publico()->postJson('/api/v1/publico/registro/verificar', ['email' => 'rosa.medina@carnesdelnorte.pe', 'codigo' => 'ZZZZZZ'])->assertStatus(422);
        }
        $this->assertSame('EXPIRED', DB::table('tenant_signups')->value('status'));

        // Otro registro vence a las 48 horas del código.
        $this->publico()->postJson('/api/v1/publico/registro', $this->datos())->assertCreated();
        $codigo = Registro::$ultimoCodigo;
        $this->travel(49)->hours();
        $this->publico()->postJson('/api/v1/publico/registro/verificar', ['email' => 'rosa.medina@carnesdelnorte.pe', 'codigo' => $codigo])
            ->assertStatus(422)->assertJsonFragment(['El código venció. Vuelve a registrarte para recibir uno nuevo.']);
    }
}
