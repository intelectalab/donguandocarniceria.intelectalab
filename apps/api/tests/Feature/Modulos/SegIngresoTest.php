<?php

namespace Tests\Feature\Modulos;

use App\Support\TenantContext;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

/**
 * Ingreso y recuperación: RN-SEG-02 (Argon2id y vencimiento de la contraseña), RN-SEG-08 (código de
 * recuperación que vence y cierra las sesiones) y RN-SEG-19 (el bloqueo no revela que el correo existe).
 */
class SegIngresoTest extends TestCase
{
    private const ADMIN = 'lccahuana@donguando.pe';

    private const VENDEDORA = 'ana.torres@donguando.pe';

    private const NUEVA = 'Carnes2026Segura';

    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo(Carbon::parse('2026-11-10 09:00', 'America/Lima'));
    }

    private function contexto(): void
    {
        $tenantId = DB::selectOne('SELECT auth_tenants_for_email(?) AS t', [self::VENDEDORA])->t;
        TenantContext::set(TenantContext::find($tenantId));
    }

    private function usuario(string $email): object
    {
        $this->contexto();

        return DB::table('users')->where('email', $email)->first();
    }

    private function login(string $clave)
    {
        return $this->desde(self::DG)->postJson('/api/v1/auth/login', ['email' => self::VENDEDORA, 'password' => $clave]);
    }

    public function test_bloqueada_el_aviso_solo_sale_con_la_contrasena_correcta(): void
    {
        for ($i = 0; $i < 5; $i++) {
            $this->login('mala-'.$i)->assertUnprocessable();
        }
        // Con una contraseña incorrecta: el mensaje de siempre, sin decir que la cuenta existe y está bloqueada.
        $this->assertSame('El correo o la contraseña no son correctos.', $this->login('otra-mala')->assertUnprocessable()->json('errors.email.0'));
        $this->assertSame('El correo o la contraseña no son correctos.',
            $this->desde(self::DG)->postJson('/api/v1/auth/login', ['email' => 'nadie@donguando.pe', 'password' => 'otra-mala'])->assertUnprocessable()->json('errors.email.0'),
            'Igual que un correo que no existe');
        // Con la correcta se le dice que está bloqueada, y tampoco entra.
        $this->assertStringContainsString('bloqueada', $this->login(self::CLAVE)->assertUnprocessable()->json('errors.email.0'));
    }

    public function test_la_contrasena_se_guarda_con_argon2id_y_la_antigua_se_convierte_al_ingresar(): void
    {
        $u = $this->usuario(self::VENDEDORA);
        DB::table('users')->where('id', $u->id)->update(['password' => password_hash(self::CLAVE, PASSWORD_BCRYPT)]);
        $historial = DB::table('password_history')->where('user_id', $u->id)->count();

        $this->login(self::CLAVE)->assertOk();
        $this->assertSame('argon2id', password_get_info($this->usuario(self::VENDEDORA)->password)['algoName']);
        $this->assertSame($historial, DB::table('password_history')->where('user_id', $u->id)->count(), 'No cuenta como cambio de contraseña');
        $this->login(self::CLAVE)->assertOk();

        // Una contraseña nueva también queda con Argon2id.
        $token = $this->ingresar(self::DG, self::VENDEDORA);
        $this->desde(self::DG, $token)->postJson('/api/v1/me/password', ['current_password' => self::CLAVE, 'password' => self::NUEVA, 'password_confirmation' => self::NUEVA])->assertOk();
        $this->assertSame('argon2id', password_get_info($this->usuario(self::VENDEDORA)->password)['algoName']);
    }

    public function test_con_la_contrasena_vencida_solo_puede_cambiarla(): void
    {
        $this->desde(self::DG, $this->ingresar(self::DG, self::ADMIN))
            ->putJson('/api/v1/plt/parametros/seg_password_max_age_days', ['value' => 90, 'reason' => 'Prueba de vencimiento'])->assertOk();
        $u = $this->usuario(self::VENDEDORA);
        DB::table('users')->where('id', $u->id)->update(['password_changed_at' => now()->subDays(91)]);

        $r = $this->login(self::CLAVE)->assertOk();
        $this->assertTrue($r->json('must_change_password'));
        $api = $this->desde(self::DG, $r->json('token'));
        $this->assertTrue($api->getJson('/api/v1/me')->assertOk()->json('user.password_vencida'));
        $api->getJson('/api/v1/seg/mi-cuenta')->assertOk();
        $api->getJson('/api/v1/seg/mis-sesiones')->assertForbidden()->assertJsonPath('code', 'PASSWORD_CHANGE_REQUIRED');
        $api->getJson('/api/v1/plt/parametros')->assertForbidden();

        $api->postJson('/api/v1/me/password', ['current_password' => self::CLAVE, 'password' => self::NUEVA, 'password_confirmation' => self::NUEVA])->assertOk();
        $nuevo = $this->desde(self::DG)->postJson('/api/v1/auth/login', ['email' => self::VENDEDORA, 'password' => self::NUEVA])->assertOk();
        $this->assertFalse($nuevo->json('must_change_password'));
        $this->desde(self::DG, $nuevo->json('token'))->getJson('/api/v1/seg/mis-sesiones')->assertOk();
    }

    public function test_el_codigo_de_recuperacion_vence_a_los_30_minutos_y_al_usarlo_se_cierran_las_sesiones(): void
    {
        $codigos = [];
        Mail::shouldReceive('raw')->twice()->andReturnUsing(function (string $texto) use (&$codigos) {
            preg_match('/es ([A-Z0-9]{6})\./', $texto, $m);
            $codigos[] = $m[1];
        });
        $reset = fn (string $codigo) => $this->desde(self::DG)->postJson('/api/v1/auth/reset', ['email' => self::VENDEDORA, 'code' => $codigo, 'password' => self::NUEVA]);

        // Usado a los 31 minutos: vencido.
        $this->desde(self::DG)->postJson('/api/v1/auth/forgot', ['email' => self::VENDEDORA])->assertOk();
        $this->travel(31)->minutes();
        $reset($codigos[0])->assertUnprocessable()->assertJsonValidationErrors('code');

        // A tiempo: fija la contraseña y se cierran las sesiones que tenía abiertas.
        $abierta = $this->ingresar(self::DG, self::VENDEDORA);
        $this->desde(self::DG)->postJson('/api/v1/auth/forgot', ['email' => self::VENDEDORA])->assertOk();
        $this->travel(10)->minutes();
        $reset($codigos[1])->assertOk();
        $this->desde(self::DG, $abierta)->getJson('/api/v1/me')->assertUnauthorized();
        $this->assertSame('Contraseña restablecida', DB::table('user_sessions')->where('user_id', $this->usuario(self::VENDEDORA)->id)->latest('revoked_at')->value('revoke_reason'));
    }
}
