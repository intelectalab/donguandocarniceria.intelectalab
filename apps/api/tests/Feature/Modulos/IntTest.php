<?php

namespace Tests\Feature\Modulos;

use App\Modulos\Int\Services\Credenciales;
use App\Support\TenantContext;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/** INT · Integraciones. Tanda 1: conectores (INT-01, INT-02) y credenciales (INT-03). */
class IntTest extends TestCase
{
    private const ADMIN = 'lccahuana@donguando.pe';     // administración del sistema

    private const SIN_PERMISO = 'chuaman@donguando.pe'; // administración: sin los permisos de INT

    private array $tokens = [];

    private function como(string $email, string $host = self::DG): static
    {
        return $this->desde($host, $this->tokens[$host.$email] ??= $this->ingresar($host, $email));
    }

    /** Lee y escribe como Don Guando (RLS), para revisar filas de la empresa desde la prueba. */
    private function enDonGuando(callable $f): mixed
    {
        TenantContext::set(['id' => DB::table('tenants')->where('short', 'Don Guando')->value('id')]);
        try {
            return $f();
        } finally {
            TenantContext::set(null);
        }
    }

    private function conector(callable $filtro): array
    {
        return collect($this->como(self::ADMIN)->getJson('/api/v1/int/conectores')->assertOk()->json('data'))->first($filtro);
    }

    public function test_lista_y_ficha_de_conectores_sin_secretos(): void
    {
        $r = $this->como(self::ADMIN)->getJson('/api/v1/int/conectores')->assertOk();
        $this->assertSame(28, $r->json('cifras.total'));
        $this->assertGreaterThanOrEqual(1, $r->json('cifras.en_error'), 'La balanza en error de la demostración');
        $this->assertSame(count(array_filter($r->json('data'), fn ($c) => $c['provider'] === 'WHATSAPP_CLOUD' && $c['environment'] === 'PRODUCTION')), $r->json('cifras.whatsapp'));
        $this->assertGreaterThan(0, $r->json('cifras.whatsapp'));
        $wa = collect($r->json('data'))->firstWhere('provider', 'WHATSAPP_CLOUD');
        $this->assertSame(['Mensajería', 'WhatsApp Cloud API (oficial)', 'CRM'], [$wa['kind_name'], $wa['adapter_name'], $wa['owner_module']]);

        $f = $this->como(self::ADMIN)->getJson("/api/v1/int/conectores/{$wa['id']}")->assertOk();
        $this->assertTrue($f->json('config.coexistence'), 'La configuración no secreta se muestra');
        $this->assertStringNotContainsString('enc:', $f->getContent(), 'Ningún secreto cifrado sale de la API');
        $this->assertStringNotContainsString('secret', $f->getContent());

        // Otra empresa no ve los conectores de Don Guando (RLS).
        $this->assertSame(0, $this->como('hsalas@carnesselectas.pe', self::CS)->getJson('/api/v1/int/conectores')->assertOk()->json('cifras.total'));
    }

    public function test_probar_conexion_falso_real_y_paso_a_error_con_aviso(): void
    {
        // En producción, sin adaptador real instalado: lo dice y no lo cuenta como falla (RN-INT-01).
        $real = $this->conector(fn ($c) => $c['environment'] === 'PRODUCTION' && $c['status'] === 'ACTIVE');
        $p = $this->como(self::ADMIN)->postJson("/api/v1/int/conectores/{$real['id']}/probar")->assertOk();
        $this->assertNull($p->json('resultado.ok'));
        $this->assertStringContainsString('todavía no está instalado', $p->json('resultado.mensaje'));
        $this->assertSame(0, $p->json('conector.consecutive_failures'));

        // En prueba, el adaptador falso responde.
        $falso = $this->conector(fn ($c) => $c['environment'] === 'SANDBOX' && $c['status'] === 'ACTIVE');
        $p = $this->como(self::ADMIN)->postJson("/api/v1/int/conectores/{$falso['id']}/probar")->assertOk();
        $this->assertTrue($p->json('resultado.ok'));
        $this->assertNotNull($p->json('conector.last_ok_at'));

        // Simular la caída solo en prueba; tras 3 fallos pasa a «En error» y avisa (RN-INT-19).
        $this->como(self::ADMIN)->postJson("/api/v1/int/conectores/{$real['id']}/simular-caida", ['down' => true])->assertStatus(422)->assertJsonPath('code', 'RN-INT-01');
        $this->como(self::ADMIN)->postJson("/api/v1/int/conectores/{$falso['id']}/simular-caida", ['down' => true])->assertOk();
        foreach ([1, 2] as $n) {
            $this->assertSame('ACTIVE', $this->como(self::ADMIN)->postJson("/api/v1/int/conectores/{$falso['id']}/probar")->json('conector.status'), "Fallo {$n}: sigue activo");
        }
        $e = $this->como(self::ADMIN)->postJson("/api/v1/int/conectores/{$falso['id']}/probar")->assertOk();
        $this->assertSame(['ERROR', 3, false], [$e->json('conector.status'), $e->json('conector.consecutive_failures'), $e->json('resultado.ok')]);
        $this->assertCount(3, $e->json('conector.errores'));
        $this->enDonGuando(fn () => $this->assertDatabaseHas('notifications', ['role' => 'ADMIN_SISTEMA', 'module' => 'INT', 'severity' => 'CRITICAL', 'title' => "{$falso['name']} en error"]));

        // Vuelve a responder: pasa a Activo y avisa que volvió.
        $this->como(self::ADMIN)->postJson("/api/v1/int/conectores/{$falso['id']}/simular-caida", ['down' => false])->assertOk();
        $ok = $this->como(self::ADMIN)->postJson("/api/v1/int/conectores/{$falso['id']}/probar")->assertOk();
        $this->assertSame(['ACTIVE', 0], [$ok->json('conector.status'), $ok->json('conector.consecutive_failures')]);
        $this->enDonGuando(fn () => $this->assertDatabaseHas('notifications', ['module' => 'INT', 'title' => "{$falso['name']} volvió a conectar"]));

        // Sin el permiso de conectores no se prueba.
        $this->como(self::SIN_PERMISO)->postJson("/api/v1/int/conectores/{$falso['id']}/probar")->assertForbidden();
    }

    public function test_activar_y_desactivar_con_motivo_y_modulo_dueno_apagado(): void
    {
        $c = $this->conector(fn ($x) => $x['environment'] === 'SANDBOX' && $x['status'] === 'ACTIVE');
        $ruta = "/api/v1/int/conectores/{$c['id']}";
        $this->como(self::ADMIN)->postJson("{$ruta}/estado", ['active' => false, 'reason' => 'corto'])->assertStatus(422)->assertJsonValidationErrors('reason');
        $d = $this->como(self::ADMIN)->postJson("{$ruta}/estado", ['active' => false, 'reason' => 'Se cambia de proveedor de prueba'])->assertOk();
        $this->assertSame(['DISABLED', 'Se cambia de proveedor de prueba'], [$d->json('status'), $d->json('status_reason')]);
        $this->como(self::ADMIN)->postJson("{$ruta}/probar")->assertStatus(422)->assertJsonPath('code', 'RN-INT-14');
        $this->como(self::ADMIN)->postJson("{$ruta}/estado", ['active' => true, 'reason' => 'Vuelve el proveedor de prueba'])->assertOk()->assertJsonPath('status', 'ACTIVE');

        // Telefonía viene apagada en Don Guando: su conector no se activa hasta encender el módulo (RN-INT-14).
        $tel = $this->conector(fn ($x) => $x['kind'] === 'TELEPHONY');
        $this->assertFalse($tel['module_on']);
        $this->como(self::ADMIN)->postJson("/api/v1/int/conectores/{$tel['id']}/estado", ['active' => true, 'reason' => 'Probar la central telefónica'])
            ->assertStatus(422)->assertJsonPath('code', 'RN-INT-14');
        $this->enDonGuando(fn () => $this->assertDatabaseHas('domain_events', ['event_name' => 'connector.disabled', 'aggregate_id' => $c['id']]));
    }

    public function test_credenciales_cifradas_rotar_y_revocar_sin_mostrar_el_secreto(): void
    {
        $c = $this->conector(fn ($x) => $x['environment'] === 'SANDBOX' && $x['status'] === 'ACTIVE');
        $secreto = 'sk_test_SuperSecreto_7781';

        // Cargar: se cifra con la clave de la aplicación y solo vuelven los últimos 4 (RN-INT-02).
        $r = $this->como(self::ADMIN)->postJson('/api/v1/int/credenciales', ['connector_id' => $c['id'], 'name' => 'webhook_secret', 'secret' => $secreto,
            'expires_at' => now()->addDays(3)->toDateString()])->assertCreated();
        $this->assertSame(['••••7781', 1, 'ACTIVE'], [$r->json('value'), $r->json('version'), $r->json('status')]);
        $this->assertStringNotContainsString('SuperSecreto', $r->getContent());
        $this->enDonGuando(function () use ($r, $secreto, $c) {
            $enc = DB::table('integration_credentials')->where('id', $r->json('id'))->value('secret_enc');
            $this->assertStringStartsWith('enc:v2:', $enc);
            $this->assertSame($secreto, Crypt::decryptString(substr($enc, 7)));
            $this->assertSame($secreto, Credenciales::secreto($c['id'], 'webhook_secret'), 'Los adaptadores reales lo leen en claro');
            $this->assertStringNotContainsString('SuperSecreto', (string) DB::table('domain_events')->where('event_name', 'credential.loaded')->value('payload'), 'Ni la bitácora lo guarda');
        });

        // Por vencer (RN-INT-20) y la lista nunca trae el secreto.
        $l = $this->como(self::ADMIN)->getJson("/api/v1/int/credenciales?connector={$c['id']}")->assertOk();
        $this->assertContains($r->json('id'), array_column($l->json('por_vencer'), 'id'));
        $this->assertStringNotContainsString('enc:', $l->getContent());

        // Una sola vigente por nombre (RN-INT-03): cargar de nuevo pide rotar.
        $this->como(self::ADMIN)->postJson('/api/v1/int/credenciales', ['connector_id' => $c['id'], 'name' => 'webhook_secret', 'secret' => 'otro_secreto_99'])
            ->assertStatus(422)->assertJsonPath('code', 'RN-INT-03');
        $this->como(self::ADMIN)->postJson('/api/v1/int/credenciales', ['connector_id' => $c['id'], 'name' => 'Con Espacios', 'secret' => 'otro_secreto_99'])
            ->assertStatus(422)->assertJsonValidationErrors('name');

        // Rotar: versión 2 vigente, la 1 revocada por rotación.
        $n = $this->como(self::ADMIN)->postJson("/api/v1/int/credenciales/{$r->json('id')}/rotar", ['secret' => 'sk_test_Nuevo_0042'])->assertOk();
        $this->assertSame(['••••0042', 2], [$n->json('value'), $n->json('version')]);
        $this->enDonGuando(function () use ($r, $n) {
            $this->assertSame(['REVOKED', 'Rotación'], array_values((array) DB::table('integration_credentials')->where('id', $r->json('id'))->first(['status', 'revoked_reason'])));
            $this->assertSame($r->json('id'), DB::table('integration_credentials')->where('id', $n->json('id'))->value('rotated_from'));
        });
        $this->como(self::ADMIN)->postJson("/api/v1/int/credenciales/{$r->json('id')}/rotar", ['secret' => 'sk_test_Otra_1111'])->assertStatus(422)->assertJsonPath('code', 'RN-INT-03');

        // Revocar pide motivo; sin el permiso no se carga ni se revoca.
        $this->como(self::ADMIN)->postJson("/api/v1/int/credenciales/{$n->json('id')}/revocar", ['reason' => 'corto'])->assertStatus(422);
        $this->como(self::SIN_PERMISO)->postJson("/api/v1/int/credenciales/{$n->json('id')}/revocar", ['reason' => 'Se filtró el secreto'])->assertForbidden();
        $this->como(self::ADMIN)->postJson("/api/v1/int/credenciales/{$n->json('id')}/revocar", ['reason' => 'Se filtró el secreto en un chat'])->assertOk()
            ->assertJsonPath('status', 'REVOKED')->assertJsonPath('revoked_reason', 'Se filtró el secreto en un chat');
        $this->como(self::SIN_PERMISO)->postJson('/api/v1/int/credenciales', ['connector_id' => $c['id'], 'name' => 'api_key', 'secret' => 'otro_secreto_99'])->assertForbidden();
    }
}
