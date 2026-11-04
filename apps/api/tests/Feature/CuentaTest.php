<?php

namespace Tests\Feature;

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
}
