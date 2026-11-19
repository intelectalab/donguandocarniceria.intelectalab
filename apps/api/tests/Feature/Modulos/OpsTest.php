<?php

namespace Tests\Feature\Modulos;

use App\Modulos\Ops\Services\UsuariosPlataforma;
use App\Support\Totp;
use Illuminate\Database\QueryException;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/** OPS · consola de Intelectalab, tanda 1: OPS-01 Ingreso a la consola y OPS-12 Usuarios de plataforma. */
class OpsTest extends TestCase
{
    private const CLAVE_CONSOLA = 'Consola#Segura2026';

    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo(Carbon::parse('2026-11-19 10:00:00', 'America/Lima'));
        // Muchas activaciones e ingresos seguidos desde la misma IP: el límite por minuto se prueba aparte.
        $this->withoutMiddleware(ThrottleRequests::class);
    }

    private function consola(?string $token = null): static
    {
        $this->app['auth']->forgetGuards();
        $this->flushHeaders();

        return $this->withHeaders(['Accept' => 'application/json'] + ($token ? ['Authorization' => "Bearer {$token}"] : []));
    }

    /** Activa una cuenta invitada (contraseña + app autenticadora) y devuelve su secreto TOTP. */
    private function activar(string $email, string $codigo): string
    {
        $prep = $this->consola()->postJson('/api/v1/consola/activar/preparar', [
            'email' => $email, 'codigo' => $codigo, 'password' => self::CLAVE_CONSOLA, 'password_confirmation' => self::CLAVE_CONSOLA,
        ])->assertOk();
        $secreto = $prep->json('secreto');
        $this->assertStringStartsWith('otpauth://totp/', $prep->json('enlace'));
        $this->consola()->postJson('/api/v1/consola/activar', [
            'email' => $email, 'codigo' => $codigo, 'password' => self::CLAVE_CONSOLA, 'password_confirmation' => self::CLAVE_CONSOLA,
            'totp' => Totp::codigo($secreto, Totp::pasoActual()),
        ])->assertOk();

        return $secreto;
    }

    /** Ingresa con un código de un paso nuevo (el mismo código no sirve dos veces). */
    private function entrar(string $email, string $secreto): string
    {
        $this->travel(31)->seconds();

        return $this->consola()->postJson('/api/v1/consola/ingreso', ['email' => $email, 'password' => self::CLAVE_CONSOLA,
            'codigo' => Totp::codigo($secreto, Totp::pasoActual())])->assertOk()->json('token');
    }

    /** Administrador activo con sesión: [token, secreto]. */
    private function admin(): array
    {
        $secreto = $this->activar('ana.rios@intelectalab.com', UsuariosPlataforma::primeraCuenta('ana.rios@intelectalab.com', 'Ana Ríos Paredes'));

        return [$this->entrar('ana.rios@intelectalab.com', $secreto), $secreto];
    }

    /** Crea desde OPS-12 una cuenta con ese rol, la activa y devuelve [id, token]. */
    private function cuenta(string $tokenAdmin, string $email, string $rol): array
    {
        $id = $this->consola($tokenAdmin)->postJson('/api/v1/consola/usuarios', ['email' => $email, 'full_name' => 'Persona de Prueba', 'role' => $rol])
            ->assertCreated()->json('id');
        $secreto = $this->activar($email, UsuariosPlataforma::$ultimoCodigo);

        return [$id, $this->entrar($email, $secreto)];
    }

    public function test_totp_cumple_el_vector_de_la_rfc_6238(): void
    {
        // Secreto «12345678901234567890» en base32; a los 59 s el código de 8 dígitos es 94287082 → 287082 con 6.
        $secreto = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
        $this->assertSame('287082', Totp::codigo($secreto, Totp::pasoActual(59)));
        $this->assertSame(1, Totp::verificar($secreto, '287082', null, 59));
        $this->assertNull(Totp::verificar($secreto, '287082', 1, 59), 'El mismo paso no sirve dos veces');
        $this->assertSame(32, strlen(Totp::secreto()));
    }

    public function test_primera_cuenta_activacion_e_ingreso_con_segundo_factor(): void
    {
        $codigo = UsuariosPlataforma::primeraCuenta('ana.rios@intelectalab.com', 'Ana Ríos Paredes');
        // Invitada: no entra aunque escriba algo.
        $this->consola()->postJson('/api/v1/consola/ingreso', ['email' => 'ana.rios@intelectalab.com', 'password' => self::CLAVE_CONSOLA, 'codigo' => '000000'])
            ->assertStatus(422);
        // Contraseña débil o con el nombre.
        $this->consola()->postJson('/api/v1/consola/activar/preparar', ['email' => 'ana.rios@intelectalab.com', 'codigo' => $codigo,
            'password' => 'corta1A', 'password_confirmation' => 'corta1A'])->assertStatus(422)->assertJsonValidationErrors('password');
        $this->consola()->postJson('/api/v1/consola/activar/preparar', ['email' => 'ana.rios@intelectalab.com', 'codigo' => 'MALCODIG',
            'password' => self::CLAVE_CONSOLA, 'password_confirmation' => self::CLAVE_CONSOLA])->assertStatus(422)->assertJsonValidationErrors('codigo');

        $secreto = $this->activar('ana.rios@intelectalab.com', $codigo);
        $u = DB::table('platform_users')->where('email', 'ana.rios@intelectalab.com')->first();
        $this->assertSame('ACTIVE', $u->status);
        $this->assertNotSame($secreto, $u->totp_secret, 'El secreto se guarda cifrado');
        // El código de la invitación ya no sirve.
        $this->consola()->postJson('/api/v1/consola/activar/preparar', ['email' => 'ana.rios@intelectalab.com', 'codigo' => $codigo,
            'password' => self::CLAVE_CONSOLA, 'password_confirmation' => self::CLAVE_CONSOLA])->assertStatus(422);

        // Sin el código de la app, o con el ya usado en la activación, no entra.
        $this->consola()->postJson('/api/v1/consola/ingreso', ['email' => 'ana.rios@intelectalab.com', 'password' => self::CLAVE_CONSOLA,
            'codigo' => Totp::codigo($secreto, Totp::pasoActual())])->assertStatus(422);
        $token = $this->entrar('ana.rios@intelectalab.com', $secreto);
        $this->consola($token)->getJson('/api/v1/consola/yo')->assertOk()->assertJsonPath('role', 'PLATFORM_ADMIN')
            ->assertJsonMissingPath('password')->assertJsonMissingPath('totp_secret');
        $this->assertTrue($this->consola($token)->getJson('/api/v1/consola/yo')->json('puede')['users.manage']);
        $this->assertDatabaseHas('platform_audit_log', ['action' => 'CONSOLE_LOGIN', 'platform_user_id' => $u->id]);

        $this->consola($token)->postJson('/api/v1/consola/salir')->assertNoContent();
        $this->consola($token)->getJson('/api/v1/consola/yo')->assertStatus(401);
    }

    public function test_bloqueo_al_quinto_intento_y_reactivacion_con_motivo(): void
    {
        [$tokenAdmin] = $this->admin();
        [$id] = $this->cuenta($tokenAdmin, 'karen.vilchez@intelectalab.com', 'SUPPORT_L1');
        for ($i = 0; $i < 5; $i++) {
            $this->consola()->postJson('/api/v1/consola/ingreso', ['email' => 'karen.vilchez@intelectalab.com', 'password' => 'Equivocada#2026', 'codigo' => '123456'])
                ->assertStatus(422);
        }
        $this->assertSame('LOCKED', DB::table('platform_users')->where('id', $id)->value('status'));
        $this->assertSame(0, DB::table('platform_sessions')->where('platform_user_id', $id)->whereNull('ended_at')->count(), 'Bloquear cierra sus sesiones');
        // Con la contraseña correcta se le dice que está bloqueada.
        $this->consola()->postJson('/api/v1/consola/ingreso', ['email' => 'karen.vilchez@intelectalab.com', 'password' => self::CLAVE_CONSOLA, 'codigo' => '123456'])
            ->assertStatus(422)->assertJsonFragment(['Tu cuenta está bloqueada. Un administrador de plataforma la reactiva en Usuarios de plataforma.']);

        $this->consola($tokenAdmin)->postJson("/api/v1/consola/usuarios/{$id}/estado", ['status' => 'ACTIVE'])->assertStatus(422)->assertJsonValidationErrors('reason');
        $this->consola($tokenAdmin)->postJson("/api/v1/consola/usuarios/{$id}/estado", ['status' => 'ACTIVE', 'reason' => 'Se equivocó de contraseña'])
            ->assertOk()->assertJsonPath('status', 'ACTIVE');
    }

    public function test_solo_el_administrador_maneja_usuarios_y_con_correo_de_intelectalab(): void
    {
        [$tokenAdmin] = $this->admin();
        $this->consola($tokenAdmin)->postJson('/api/v1/consola/usuarios', ['email' => 'alguien@gmail.com', 'full_name' => 'Alguien', 'role' => 'SUPPORT_L1'])
            ->assertStatus(422)->assertJsonPath('code', 'RN-OPS-01');
        $this->consola($tokenAdmin)->postJson('/api/v1/consola/usuarios', ['email' => 'ana.rios@intelectalab.com', 'full_name' => 'Repetida', 'role' => 'SUPPORT_L1'])
            ->assertStatus(422)->assertJsonPath('code', 'RN-OPS-01');

        [, $tokenL1] = $this->cuenta($tokenAdmin, 'karen.vilchez@intelectalab.com', 'SUPPORT_L1');
        $this->consola($tokenL1)->getJson('/api/v1/consola/usuarios')->assertOk();   // puede consultar
        $this->consola($tokenL1)->postJson('/api/v1/consola/usuarios', ['email' => 'otro@intelectalab.com', 'full_name' => 'Otro', 'role' => 'READ_ONLY'])
            ->assertStatus(422)->assertJsonPath('code', 'RN-OPS-10');
    }

    public function test_no_se_queda_sin_administrador_ni_se_bloquea_a_si_mismo(): void
    {
        [$tokenAdmin] = $this->admin();
        $anaId = DB::table('platform_users')->where('email', 'ana.rios@intelectalab.com')->value('id');
        $this->consola($tokenAdmin)->postJson("/api/v1/consola/usuarios/{$anaId}/estado", ['status' => 'DISABLED', 'reason' => 'Prueba de baja'])
            ->assertStatus(422)->assertJsonPath('code', 'RN-OPS-10');
        $this->consola($tokenAdmin)->putJson("/api/v1/consola/usuarios/{$anaId}", ['full_name' => 'Ana Ríos', 'role' => 'READ_ONLY'])
            ->assertStatus(422)->assertJsonPath('code', 'RN-OPS-10');

        // Reiniciar el segundo factor deja la cuenta invitada, sin sesiones y con un código nuevo.
        [$id, $tokenL2] = $this->cuenta($tokenAdmin, 'soporte@intelectalab.com', 'SUPPORT_L2');
        $this->consola($tokenAdmin)->postJson("/api/v1/consola/usuarios/{$id}/reiniciar-2fa", ['reason' => 'Perdió su celular'])->assertOk()->assertJsonPath('status', 'INVITED');
        $this->consola($tokenL2)->getJson('/api/v1/consola/yo')->assertStatus(401);
        $this->assertNotNull(UsuariosPlataforma::$ultimoCodigo);
    }

    public function test_la_sesion_vence_por_inactividad_y_respeta_las_redes_permitidas(): void
    {
        [$token] = $this->admin();
        $this->travel(31)->minutes();
        $this->consola($token)->getJson('/api/v1/consola/yo')->assertStatus(401);
        $this->assertDatabaseHas('platform_sessions', ['end_reason' => 'Inactividad de más de 30 minutos']);

        // Con lista de redes, una IP fuera de ella no entra (las pruebas llegan desde 127.0.0.1).
        DB::table('platform_parameters')->where('key', 'ops_console_ip_allowlist')->update(['value' => json_encode(['10.0.0.0/8'])]);
        $this->travel(31)->seconds();
        $u = DB::table('platform_users')->where('email', 'ana.rios@intelectalab.com')->first();
        $secreto = Crypt::decryptString($u->totp_secret);
        $this->consola()->postJson('/api/v1/consola/ingreso', ['email' => 'ana.rios@intelectalab.com', 'password' => self::CLAVE_CONSOLA,
            'codigo' => Totp::codigo($secreto, Totp::pasoActual())])->assertStatus(422)->assertJsonPath('code', 'RN-OPS-16');
        DB::table('platform_parameters')->where('key', 'ops_console_ip_allowlist')->update(['value' => json_encode(['127.0.0.0/8'])]);
        $this->entrar('ana.rios@intelectalab.com', $secreto);
    }

    public function test_la_consola_y_las_empresas_no_comparten_sesiones_ni_datos(): void
    {
        [$token] = $this->admin();
        $tokenEmpresa = $this->ingresar(self::DG, 'rquispe@donguando.pe');
        // Token de empresa en la consola, y de consola en la API de empresa: ninguno sirve.
        $this->consola($tokenEmpresa)->getJson('/api/v1/consola/yo')->assertStatus(401);
        $this->desde(self::DG, $token)->getJson('/api/v1/me')->assertStatus(401);
        // Sin empresa fijada (como en la consola), RLS no devuelve datos de negocio.
        $this->assertSame(0, DB::table('customers')->count());
    }

    public function test_la_base_protege_la_bitacora_y_el_segundo_factor(): void
    {
        $this->admin();
        // RN-OPS-05: la aplicación no puede cambiar ni borrar la bitácora de la consola.
        DB::beginTransaction();
        try {
            DB::table('platform_audit_log')->update(['reason' => 'cambiado']);
            $this->fail('La bitácora de la consola no debe poder cambiarse');
        } catch (QueryException $e) {
            $this->assertSame('42501', $e->getCode());
        } finally {
            DB::rollBack();
        }
        // RN-OPS-01: activo sin segundo factor lo rechaza la base.
        DB::beginTransaction();
        try {
            DB::table('platform_users')->insert(['email' => 'sin2fa@intelectalab.com', 'full_name' => 'Sin Segundo', 'role' => 'READ_ONLY', 'status' => 'ACTIVE', 'password' => 'x']);
            $this->fail('Un usuario activo sin segundo factor no debe guardarse');
        } catch (QueryException $e) {
            $this->assertSame('23514', $e->getCode());
        } finally {
            DB::rollBack();
        }
    }
}
