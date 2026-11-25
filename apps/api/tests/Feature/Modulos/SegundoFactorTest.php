<?php

namespace Tests\Feature\Modulos;

use App\Support\TenantContext;
use App\Support\Totp;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/** SEG-02 Verificación del segundo factor, SEG-03 Activarlo y su parte de SEG-06 Mi cuenta. */
class SegundoFactorTest extends TestCase
{
    private const ADMIN = 'lccahuana@donguando.pe';      // administración del sistema (su rol lo exige)

    private const ADMINISTRACION = 'chuaman@donguando.pe';

    private const GERENTE = 'rquispe@donguando.pe';

    private function login(string $email)
    {
        return $this->desde(self::DG)->postJson('/api/v1/auth/login', ['email' => $email, 'password' => self::CLAVE]);
    }

    private function conToken(string $token): static
    {
        return $this->desde(self::DG, $token);
    }

    /** El código de la app ahora (cada prueba avanza el reloj 30 s para no repetir el mismo paso). */
    private function codigo(string $secreto): string
    {
        return Totp::codigo($secreto, Totp::pasoActual());
    }

    private function enDonGuando(callable $f): mixed
    {
        TenantContext::set(['id' => DB::table('tenants')->where('short', 'Don Guando')->value('id')]);
        try {
            return $f();
        } finally {
            TenantContext::set(null);
        }
    }

    /** Activa el segundo factor desde Mi cuenta y devuelve [secreto, códigos de recuperación]. */
    private function activar(string $email): array
    {
        $t = $this->login($email)->assertOk()->json('token');
        $p = $this->conToken($t)->postJson('/api/v1/seg/mi-cuenta/segundo-factor/preparar')->assertOk();
        $this->assertStringStartsWith('otpauth://totp/', $p->json('enlace'));
        $a = $this->conToken($t)->postJson('/api/v1/seg/mi-cuenta/segundo-factor/activar', ['codigo' => $this->codigo($p->json('secreto'))])->assertOk();
        $this->travel(31)->seconds();

        return [$p->json('secreto'), $a->json('codigos')];
    }

    public function test_activar_en_mi_cuenta_e_ingresar_con_codigo_o_recuperacion(): void
    {
        // Sin segundo factor: entra directo (opcional por ahora).
        $t = $this->login(self::ADMIN)->assertOk()->json('token');
        $this->assertNotNull($t);
        $e = $this->conToken($t)->getJson('/api/v1/seg/mi-cuenta/segundo-factor')->assertOk();
        $this->assertSame([false, true, false], [$e->json('activo'), $e->json('rol_lo_exige'), $e->json('obligatorio')]);

        // Activar: un código equivocado no lo activa.
        $p = $this->conToken($t)->postJson('/api/v1/seg/mi-cuenta/segundo-factor/preparar')->assertOk();
        $this->conToken($t)->postJson('/api/v1/seg/mi-cuenta/segundo-factor/activar', ['codigo' => '000000'])->assertStatus(422)->assertJsonValidationErrors('codigo');
        $a = $this->conToken($t)->postJson('/api/v1/seg/mi-cuenta/segundo-factor/activar', ['codigo' => $this->codigo($p->json('secreto'))])->assertOk();
        $codigos = $a->json('codigos');
        $this->assertCount(10, $codigos);
        $this->assertMatchesRegularExpression('/^[A-Z2-9]{4}-[A-Z2-9]{4}$/', $codigos[0]);
        $this->assertSame([true, 10], [$a->json('estado.activo'), $a->json('estado.codigos_disponibles')]);
        $secreto = $p->json('secreto');
        $this->enDonGuando(function () use ($secreto) {
            $u = DB::table('users')->where('email', self::ADMIN)->first();
            $this->assertStringNotContainsString($secreto, (string) $u->totp_secret_enc, 'El secreto se guarda cifrado');
            $this->assertSame(64, strlen(DB::table('mfa_recovery_codes')->where('user_id', $u->id)->whereNull('used_at')->value('code_hash')), 'De los códigos, solo la huella');
        });
        $this->assertStringNotContainsString('totp', $this->conToken($t)->getJson('/api/v1/me')->getContent(), 'El secreto nunca sale en la API');
        $this->travel(31)->seconds();

        // SEG-02: la contraseña correcta ya no da la sesión: pide el código.
        $l = $this->login(self::ADMIN)->assertOk();
        $this->assertSame('VERIFY', $l->json('mfa'));
        $this->assertNull($l->json('token'));
        $desafio = $l->json('desafio');
        $this->desde(self::DG)->postJson('/api/v1/auth/mfa/verificar', ['desafio' => $desafio, 'codigo' => '123456'])->assertStatus(422);
        $v = $this->desde(self::DG)->postJson('/api/v1/auth/mfa/verificar', ['desafio' => $desafio, 'codigo' => $this->codigo($secreto)])->assertOk();
        $this->conToken($v->json('token'))->getJson('/api/v1/me')->assertOk();
        // El desafío ya se usó; y el mismo código no sirve otra vez.
        $this->desde(self::DG)->postJson('/api/v1/auth/mfa/verificar', ['desafio' => $desafio, 'codigo' => $this->codigo($secreto)])->assertStatus(422);
        $otro = $this->login(self::ADMIN)->json('desafio');
        $this->desde(self::DG)->postJson('/api/v1/auth/mfa/verificar', ['desafio' => $otro, 'codigo' => $this->codigo($secreto)])->assertStatus(422);

        // Con un código de recuperación (una sola vez).
        $r = $this->desde(self::DG)->postJson('/api/v1/auth/mfa/verificar', ['desafio' => $otro, 'codigo' => strtolower($codigos[3])])->assertOk();
        $this->assertNotNull($r->json('token'));
        $otro = $this->login(self::ADMIN)->json('desafio');
        $this->desde(self::DG)->postJson('/api/v1/auth/mfa/verificar', ['desafio' => $otro, 'codigo' => $codigos[3]])->assertStatus(422);
        $this->assertSame(9, $this->conToken($r->json('token'))->getJson('/api/v1/seg/mi-cuenta/segundo-factor')->json('codigos_disponibles'));

        // El desafío vence a los 5 minutos.
        $this->travel(6)->minutes();
        $this->desde(self::DG)->postJson('/api/v1/auth/mfa/verificar', ['desafio' => $otro, 'codigo' => $this->codigo($secreto)])->assertStatus(422);
        $this->enDonGuando(function () {
            foreach (['MFA_ENABLED', 'MFA_CHALLENGE', 'MFA_OK', 'MFA_FAILED', 'RECOVERY_CODE_USED'] as $ev) {
                $this->assertTrue(DB::table('access_log')->where('event', $ev)->exists(), "Bitácora: {$ev}");
            }
        });
    }

    public function test_cinco_codigos_malos_cuentan_para_el_bloqueo_y_regenerar_o_desactivar_piden_codigo(): void
    {
        [$secreto, $codigos] = $this->activar(self::ADMIN);

        $desafio = $this->login(self::ADMIN)->json('desafio');
        foreach (range(1, 4) as $n) {
            $this->desde(self::DG)->postJson('/api/v1/auth/mfa/verificar', ['desafio' => $desafio, 'codigo' => '11111'.$n])->assertStatus(422);
        }
        $this->desde(self::DG)->postJson('/api/v1/auth/mfa/verificar', ['desafio' => $desafio, 'codigo' => '111115'])->assertStatus(422)
            ->assertJsonPath('errors.codigo.0', 'Demasiados códigos incorrectos. Vuelve a escribir tu correo y contraseña.');
        $this->enDonGuando(fn () => $this->assertSame(1, (int) DB::table('users')->where('email', self::ADMIN)->value('failed_logins'), 'Cuenta para el bloqueo'));
        $this->desde(self::DG)->postJson('/api/v1/auth/mfa/verificar', ['desafio' => $desafio, 'codigo' => $this->codigo($secreto)])->assertStatus(422);

        $this->travel(61)->seconds();   // el límite de 10 intentos por minuto de la ruta
        // Códigos nuevos: piden un código de la app y anulan los anteriores.
        $t = $this->desde(self::DG)->postJson('/api/v1/auth/mfa/verificar', ['desafio' => $this->login(self::ADMIN)->json('desafio'), 'codigo' => $codigos[0]])->assertOk()->json('token');
        $this->conToken($t)->postJson('/api/v1/seg/mi-cuenta/segundo-factor/codigos', ['codigo' => $codigos[1]])->assertStatus(422);
        $n = $this->conToken($t)->postJson('/api/v1/seg/mi-cuenta/segundo-factor/codigos', ['codigo' => $this->codigo($secreto)])->assertOk();
        $this->assertNotSame($codigos, $n->json('codigos'));
        $this->assertSame(10, $n->json('estado.codigos_disponibles'));
        $this->desde(self::DG)->postJson('/api/v1/auth/mfa/verificar', ['desafio' => $this->login(self::ADMIN)->json('desafio'), 'codigo' => $codigos[2]])->assertStatus(422);

        // Desactivarlo (es opcional): pide un código; después entra directo.
        $this->travel(31)->seconds();
        $this->conToken($t)->postJson('/api/v1/seg/mi-cuenta/segundo-factor/desactivar', ['codigo' => '999999'])->assertStatus(422);
        $this->conToken($t)->postJson('/api/v1/seg/mi-cuenta/segundo-factor/desactivar', ['codigo' => $this->codigo($secreto)])->assertOk()->assertJsonPath('activo', false);
        $this->assertNotNull($this->login(self::ADMIN)->assertOk()->json('token'));
    }

    public function test_obligatorio_para_su_rol_activa_al_ingresar_y_no_se_desactiva(): void
    {
        $this->enDonGuando(fn () => DB::table('parameters')->insert(['key' => 'seg_mfa_enforce', 'scope' => 'TENANT', 'value' => 'true',
            'reason' => 'Prueba del segundo factor obligatorio', 'description' => 'Exigir el segundo factor']));

        // Administración: su rol lo exige y no lo tiene: primero activarlo, sin sesión hasta terminar.
        $l = $this->login(self::ADMINISTRACION)->assertOk();
        $this->assertSame('ENROLL', $l->json('mfa'));
        $this->assertNull($l->json('token'));
        $p = $this->desde(self::DG)->postJson('/api/v1/auth/mfa/preparar', ['desafio' => $l->json('desafio')])->assertOk();
        $this->desde(self::DG)->postJson('/api/v1/auth/mfa/verificar', ['desafio' => $l->json('desafio'), 'codigo' => '123456'])->assertStatus(422);
        $a = $this->desde(self::DG)->postJson('/api/v1/auth/mfa/activar', ['desafio' => $l->json('desafio'), 'codigo' => $this->codigo($p->json('secreto'))])->assertOk();
        $this->assertCount(10, $a->json('codigos'));
        $t = $a->json('token');
        $this->conToken($t)->getJson('/api/v1/me')->assertOk();
        $this->assertTrue($this->conToken($t)->getJson('/api/v1/seg/mi-cuenta/segundo-factor')->json('obligatorio'));

        // RN-SEG-07: no lo puede desactivar.
        $this->travel(31)->seconds();
        $this->conToken($t)->postJson('/api/v1/seg/mi-cuenta/segundo-factor/desactivar', ['codigo' => $this->codigo($p->json('secreto'))])
            ->assertStatus(422)->assertJsonPath('code', 'RN-SEG-07');

        // Un rol que no lo exige entra directo aunque esté encendido (la vendedora).
        $this->assertNotNull($this->login('evargas@donguando.pe')->assertOk()->json('token'));
    }

    public function test_el_administrador_lo_reinicia_y_borra_el_secreto(): void
    {
        $this->activar(self::ADMIN);
        $g = $this->login(self::GERENTE)->assertOk()->json('token');
        $id = $this->enDonGuando(fn () => DB::table('users')->where('email', self::ADMIN)->value('id'));
        $this->conToken($g)->postJson("/api/v1/seg/usuarios/{$id}/reiniciar-2fa")->assertOk();
        $this->enDonGuando(fn () => $this->assertNull(DB::table('users')->where('id', $id)->value('totp_secret_enc')));
        $this->assertNotNull($this->login(self::ADMIN)->assertOk()->json('token'), 'Vuelve a entrar solo con la contraseña');
    }
}
