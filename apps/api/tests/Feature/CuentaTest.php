<?php

namespace Tests\Feature;

use App\Support\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

/** Lo que usa el menú de usuario y el ingreso: cambiar contraseña, recuperarla y notificaciones. */
class CuentaTest extends TestCase
{
    private const NUEVA = 'Cuyes2026Nueva';

    public function test_cambiar_contrasena_valida_la_politica_y_la_actual(): void
    {
        $token = $this->ingresar(self::DG, 'rquispe@donguando.pe');

        $this->desde(self::DG, $token)->postJson('/api/v1/me/password', ['current_password' => 'mala', 'password' => self::NUEVA])
            ->assertUnprocessable()->assertJsonValidationErrors('current_password');
        $this->desde(self::DG, $token)->postJson('/api/v1/me/password', ['current_password' => self::CLAVE, 'password' => 'corta1A'])
            ->assertUnprocessable()->assertJsonValidationErrors('password');
        $this->desde(self::DG, $token)->postJson('/api/v1/me/password', ['current_password' => self::CLAVE, 'password' => self::CLAVE])
            ->assertUnprocessable()->assertJsonPath('errors.password.0', fn ($m) => str_contains($m, 'repetir'));

        $this->desde(self::DG, $token)->postJson('/api/v1/me/password', ['current_password' => self::CLAVE, 'password' => self::NUEVA])
            ->assertOk();
        $this->desde(self::DG)->postJson('/api/v1/auth/login', ['email' => 'rquispe@donguando.pe', 'password' => self::NUEVA])
            ->assertOk();
    }

    public function test_recuperar_contrasena_con_codigo(): void
    {
        $codigo = null;
        Mail::shouldReceive('raw')->once()->andReturnUsing(function (string $texto) use (&$codigo) {
            preg_match('/es ([A-Z0-9]{6})\./', $texto, $m);
            $codigo = $m[1];
        });

        $this->desde(self::DG)->postJson('/api/v1/auth/forgot', ['email' => 'ana.torres@donguando.pe'])->assertOk();
        // Un correo que no existe recibe la misma respuesta y no envía nada.
        $this->desde(self::DG)->postJson('/api/v1/auth/forgot', ['email' => 'nadie@donguando.pe'])->assertOk();

        $this->desde(self::DG)->postJson('/api/v1/auth/reset', ['email' => 'ana.torres@donguando.pe', 'code' => 'ZZZZZZ', 'password' => self::NUEVA])
            ->assertUnprocessable()->assertJsonValidationErrors('code');
        $this->desde(self::DG)->postJson('/api/v1/auth/reset', ['email' => 'ana.torres@donguando.pe', 'code' => $codigo, 'password' => self::NUEVA])
            ->assertOk();
        // El código es de un solo uso.
        $this->desde(self::DG)->postJson('/api/v1/auth/reset', ['email' => 'ana.torres@donguando.pe', 'code' => $codigo, 'password' => 'OtraClave2026x'])
            ->assertUnprocessable();
        $this->desde(self::DG)->postJson('/api/v1/auth/login', ['email' => 'ana.torres@donguando.pe', 'password' => self::NUEVA])
            ->assertOk();
    }

    public function test_notificaciones_propias_y_marcar_leidas(): void
    {
        $token = $this->ingresar(self::DG, 'rquispe@donguando.pe');
        $resumen = $this->desde(self::DG, $token)->getJson('/api/v1/me/notifications/summary')->assertOk();
        $this->assertGreaterThan(0, $resumen->json('unread'));
        $primera = $resumen->json('latest.0');
        $this->assertStringStartsWith('/m/', $primera['link']);

        $this->desde(self::DG, $token)->postJson("/api/v1/me/notifications/{$primera['id']}/read")->assertNoContent();
        $this->desde(self::DG, $token)->postJson('/api/v1/me/notifications/read-all')->assertNoContent();
        $this->desde(self::DG, $token)->getJson('/api/v1/me/notifications/summary')->assertJsonPath('unread', 0);

        // Las de la gerente no le llegan a la vendedora.
        $otra = $this->ingresar(self::DG, 'cnunez@donguando.pe');
        $ids = array_column($this->desde(self::DG, $otra)->getJson('/api/v1/me/notifications?per_page=100')->json('data'), 'id');
        $this->assertNotContains($primera['id'], $ids);
    }

    public function test_la_campana_cuenta_solo_las_importantes_para_el_puesto(): void
    {
        $email = 'ana.torres@donguando.pe';
        $token = $this->ingresar(self::DG, $email);
        $api = fn () => $this->desde(self::DG, $token);
        $api()->postJson('/api/v1/me/notifications/read-all')->assertNoContent();

        $tenantId = DB::selectOne('SELECT auth_tenants_for_email(?) AS t', [$email])->t;
        TenantContext::set(TenantContext::find($tenantId));
        $yo = DB::table('users')->where('email', $email)->value('id');
        $aviso = fn (string $titulo, string $tono, string $modulo, int $min) => ['user_id' => $yo, 'title' => $titulo, 'body' => 'Prueba', 'tone' => $tono,
            'module' => $modulo, 'at' => now()->subMinutes($min), 'type' => 'prueba', 'in_app' => true];
        DB::table('notifications')->insert([
            $aviso('Roja de otro módulo', 'bad', 'CNT', 5),
            $aviso('Ámbar de mi día', 'warn', 'CRM', 1),
            $aviso('Ámbar de otro módulo', 'warn', 'CNT', 2),
            $aviso('Informativa de mi día', 'info', 'CRM', 3),
        ]);

        $r = $api()->getJson('/api/v1/me/notifications/summary?dia=CRM,PED')->assertOk();
        $this->assertSame(4, $r->json('unread'));
        $this->assertSame(2, $r->json('importantes'), 'Lo rojo y lo ámbar de sus módulos del día');
        $this->assertSame(['Roja de otro módulo', 'Ámbar de mi día'], array_column($r->json('latest_importantes'), 'title'), 'Lo rojo primero');
        $this->assertSame('Ámbar de mi día', $r->json('latest.0.title'), 'Todas, de la más nueva a la más antigua');

        $api()->getJson('/api/v1/me/notifications/summary?dia=crm;drop')->assertUnprocessable();
    }
}
