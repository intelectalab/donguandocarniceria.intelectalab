<?php

namespace Tests\Feature\Modulos;

use App\Models\User;
use App\Modulos\Ops\Services\Planes;
use App\Modulos\Ops\Services\Tickets;
use App\Modulos\Ops\Services\UsuariosPlataforma;
use App\Modulos\Plt\Services\Modulos;
use App\Modulos\Sus\Services\ModulosDelPlan;
use App\Modulos\Sus\Services\Pasarelas\PasarelaFake;
use App\Modulos\Sus\Services\Suscripcion;
use App\Support\RuleError;
use App\Support\TenantContext;
use App\Support\Totp;
use Illuminate\Database\QueryException;
use Illuminate\Http\UploadedFile;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/** OPS · consola de Intelectalab, tanda 1: OPS-01 Ingreso a la consola y OPS-12 Usuarios de plataforma. */
class OpsTest extends TestCase
{
    private const CLAVE_CONSOLA = 'Consola#Segura2026';

    /** Secreto TOTP del administrador, para volver a ingresar cuando la sesión vence en una prueba larga. */
    private string $secretoAdmin = '';

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
        $this->secretoAdmin = $secreto;

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

    /* ------------------------------------------------------------------ tanda 2: empresas y alta */

    private function datosAlta(array $cambios = []): array
    {
        return $cambios + [
            'ruc' => '20100047218', 'legal_name' => 'Distribuidora Cárnica del Norte SAC', 'trade_name' => 'Carnes del Norte', 'tax_regime' => 'MYPE',
            'fiscal_address' => 'Av. Industrial 123, Trujillo', 'business_type' => 'DISTRIBUIDORA', 'plan_code' => 'CRECIMIENTO',
            'admin_name' => 'Rosa Medina Paz', 'admin_email' => 'rosa.medina@carnesdelnorte.pe', 'admin_phone' => '987654321',
        ];
    }

    public function test_alta_de_empresa_crea_todo_y_su_administrador_puede_entrar(): void
    {
        [$token] = $this->admin();
        $r = $this->consola($token)->postJson('/api/v1/consola/empresas', $this->datosAlta())->assertCreated();
        $id = $r->json('id');
        $codigo = $r->json('codigo');

        $t = DB::table('tenants')->where('id', $id)->first();
        $this->assertSame('20100047218', $t->ruc);
        $this->assertSame('CRECIMIENTO', $t->plan);
        $s = DB::table('subscriptions')->where('tenant_id', $id)->first();
        $this->assertSame('TRIAL', $s->status);
        $this->assertSame('2026-12-03', Carbon::parse($s->trial_ends_at)->timezone('America/Lima')->toDateString(), '14 días de prueba (RN-SUS-15)');
        $this->assertDatabaseHas('subscription_events', ['subscription_id' => $s->id, 'event' => 'CREATED', 'to_status' => 'TRIAL', 'actor_type' => 'PLATFORM_USER']);
        $this->assertDatabaseHas('platform_audit_log', ['action' => 'TENANT_CREATED', 'target_tenant_id' => $id]);

        // Dentro de la empresa nueva (con su contexto, como la API): razón social, roles, permisos y módulos del plan.
        TenantContext::set(TenantContext::find($id));
        $this->assertSame(1, DB::table('companies')->count());
        $this->assertSame(22, DB::table('roles')->count());
        $this->assertTrue(DB::table('permissions')->where('code', 'equ.usage.record')->exists(), 'Incluye los permisos que agregaron los módulos');
        $encendidos = DB::table('tenant_modules')->where('enabled', true)->pluck('module_code')->all();
        $this->assertContains('CRM', $encendidos, 'CRM viene en Crecimiento');
        $this->assertNotContains('TEL', $encendidos, 'Telefonía no viene en Crecimiento');
        $this->assertSame('INVITED', DB::table('users')->where('email', 'rosa.medina@carnesdelnorte.pe')->value('status'));
        TenantContext::set(null);

        // La administradora crea su contraseña con el código y entra a su empresa.
        $this->desde(self::DG)->postJson('/api/v1/auth/reset', ['email' => 'rosa.medina@carnesdelnorte.pe', 'code' => $codigo, 'password' => 'Norte#Carnes2026'])->assertOk();
        $tokenEmpresa = $this->ingresar(self::DG, 'rosa.medina@carnesdelnorte.pe', 'Norte#Carnes2026');
        $this->desde(self::DG, $tokenEmpresa)->getJson('/api/v1/me')->assertOk()->assertJsonPath('tenant.id', $id);
        // Y no ve nada de Don Guando.
        TenantContext::set(TenantContext::find($id));
        $this->assertSame(0, DB::table('customers')->count());
        TenantContext::set(null);
    }

    public function test_alta_valida_ruc_unico_y_solo_la_hace_el_administrador(): void
    {
        [$token] = $this->admin();
        $this->consola($token)->postJson('/api/v1/consola/empresas', $this->datosAlta(['ruc' => '20100047219']))
            ->assertStatus(422)->assertJsonPath('code', 'RN-ONB-01');
        // El RUC de Don Guando ya es cliente (RN-ONB-02).
        $this->consola($token)->postJson('/api/v1/consola/empresas', $this->datosAlta(['ruc' => '20609147254']))
            ->assertStatus(422)->assertJsonPath('code', 'RN-ONB-02');
        $this->consola($token)->postJson('/api/v1/consola/empresas', $this->datosAlta(['trial_days' => 45]))
            ->assertStatus(422)->assertJsonPath('code', 'RN-SUS-15');
        [, $tokenL1] = $this->cuenta($token, 'karen.vilchez@intelectalab.com', 'SUPPORT_L1');
        $this->consola($tokenL1)->postJson('/api/v1/consola/empresas', $this->datosAlta())->assertStatus(422)->assertJsonPath('code', 'RN-OPS-10');
        $this->assertFalse(DB::table('tenants')->where('ruc', '20100047218')->exists());
    }

    public function test_lista_y_ficha_muestran_plan_estado_y_uso_sin_datos_de_negocio(): void
    {
        [$token] = $this->admin();
        $id = $this->consola($token)->postJson('/api/v1/consola/empresas', $this->datosAlta())->assertCreated()->json('id');
        $lista = collect($this->consola($token)->getJson('/api/v1/consola/empresas')->assertOk()->json('data'));
        $dg = $lista->firstWhere('ruc', '20609147254');
        $this->assertSame('Sin suscripción', $dg['subscription_status_name'], 'Don Guando es piloto (RN-SUS-21)');
        $this->assertGreaterThan(0, $dg['uso'][0]['usado']);
        $this->assertNull($dg['uso'][0]['limite']);
        $nueva = $lista->firstWhere('id', $id);
        $this->assertSame('TRIAL', $nueva['subscription_status']);
        $this->assertSame(15, $nueva['uso'][0]['limite']);
        $this->assertSame(0.0, (float) $nueva['mrr'], 'En prueba no suma al MRR');

        $f = $this->consola($token)->getJson("/api/v1/consola/empresas/{$id}")->assertOk();
        $f->assertJsonPath('suscripcion.status', 'TRIAL')->assertJsonPath('contact_email', 'rosa.medina@carnesdelnorte.pe');
        $this->assertNotEmpty($f->json('modulos_encendidos'));
        $this->assertSame('TENANT_CREATED', $f->json('acciones_consola.0.action'));
        $this->assertArrayNotHasKey('customers', $f->json());
    }

    /* ------------------------------------------------------------------ tanda 3: planes, suscripciones y suspender */

    /** Empresa nueva en prueba: [token de consola, id de la suscripción, id de la empresa, token de su administradora]. */
    private function empresaEnPrueba(): array
    {
        [$token] = $this->admin();
        $r = $this->consola($token)->postJson('/api/v1/consola/empresas', $this->datosAlta())->assertCreated();
        $this->desde(self::DG)->postJson('/api/v1/auth/reset', ['email' => 'rosa.medina@carnesdelnorte.pe', 'code' => $r->json('codigo'), 'password' => 'Norte#Carnes2026'])->assertOk();
        $tokenEmpresa = $this->ingresar(self::DG, 'rosa.medina@carnesdelnorte.pe', 'Norte#Carnes2026');

        return [$token, DB::table('subscriptions')->where('tenant_id', $r->json('id'))->value('id'), $r->json('id'), $tokenEmpresa];
    }

    public function test_planes_con_versiones_publicar_y_retirar(): void
    {
        [$token, $sub] = $this->empresaEnPrueba();
        $cat = collect($this->consola($token)->getJson('/api/v1/consola/planes')->assertOk()->json('planes'))->keyBy('code');
        $this->assertSame(1, $cat['CRECIMIENTO']['publicada']['version']);
        $this->assertSame(1, $cat['CRECIMIENTO']['publicada']['suscripciones'], 'La empresa nueva usa la versión 1');
        $this->assertNotEmpty($cat['INICIAL']['publicada']['faltan'], 'Inicial trae ONB sin los módulos de los que depende (RN-SUS-01)');

        // Versión 2 de Crecimiento: copia la publicada, se edita y se publica.
        $v2 = $this->consola($token)->postJson('/api/v1/consola/planes/borradores', ['plan_code' => 'CRECIMIENTO'])->assertCreated()->json();
        $this->assertSame(2, $v2['version']);
        $edicion = ['name' => 'Crecimiento', 'description' => 'Para distribuidoras con varios canales.', 'price_pen' => 349, 'users_max' => 20,
            'brands_max' => 3, 'sites_max' => 2, 'all_modules' => false, 'modules' => [...$v2['modules'], 'TEL'], 'highlights' => ['Hasta 20 usuarios']];
        $this->consola($token)->putJson("/api/v1/consola/planes/borradores/{$v2['id']}", $edicion)->assertOk();
        $this->consola($token)->postJson("/api/v1/consola/planes/borradores/{$v2['id']}/publicar")->assertOk();
        $this->assertSame('349.00', DB::table('saas_plans')->where('code', 'CRECIMIENTO')->value('price_pen'));
        $this->assertTrue(DB::table('saas_plan_modules')->where('plan_code', 'CRECIMIENTO')->where('module_code', 'TEL')->exists());
        $this->assertSame('RETIRED', DB::table('saas_plan_versions')->where('plan_code', 'CRECIMIENTO')->where('version', 1)->value('status'));
        // RN-SUS-02: la empresa conserva su versión (15 usuarios), y lo publicado no se puede cambiar ni en la base.
        $lista = collect($this->consola($token)->getJson('/api/v1/consola/empresas')->json('data'))->firstWhere('subscription_id', $sub);
        $this->assertSame(15, $lista['uso'][0]['limite']);
        $this->consola($token)->putJson("/api/v1/consola/planes/borradores/{$v2['id']}", $edicion)->assertStatus(422)->assertJsonPath('code', 'RN-SUS-02');
        DB::beginTransaction();
        try {
            DB::table('saas_plan_versions')->where('id', $v2['id'])->update(['price_pen' => 1]);
            $this->fail('Una versión publicada no debe cambiar');
        } catch (QueryException $e) {
            $this->assertSame('23514', $e->getCode());
        } finally {
            DB::rollBack();
        }

        // Plan nuevo: sin las dependencias no se publica (RN-SUS-01); con ellas sí, y la página pública lo muestra.
        $g = $this->consola($token)->postJson('/api/v1/consola/planes/borradores', ['plan_code' => 'GOURMET', 'name' => 'Gourmet', 'nuevo' => true])->assertCreated()->json();
        $base = ['name' => 'Gourmet', 'description' => 'Para tiendas gourmet.', 'price_pen' => 199, 'users_max' => 5, 'brands_max' => 1, 'sites_max' => 1, 'all_modules' => false];
        $this->consola($token)->putJson("/api/v1/consola/planes/borradores/{$g['id']}", $base + ['modules' => ['TEL']])->assertOk();
        $this->consola($token)->postJson("/api/v1/consola/planes/borradores/{$g['id']}/publicar")->assertStatus(422)->assertJsonPath('code', 'RN-SUS-01');
        $this->consola($token)->putJson("/api/v1/consola/planes/borradores/{$g['id']}", $base + ['modules' => ['TEL', 'CRM', 'CLI', 'PED', 'CAT']])->assertOk();
        $this->consola($token)->postJson("/api/v1/consola/planes/borradores/{$g['id']}/publicar")->assertOk();
        $this->assertContains('GOURMET', collect($this->consola()->getJson('/api/v1/publico/planes')->json())->flatten()->all());

        // Retirar: deja de venderse y no se puede dar de alta con él.
        $this->consola($token)->postJson('/api/v1/consola/planes/GOURMET/retirar', ['reason' => 'Se deja de vender'])->assertOk();
        $this->assertSame('INACTIVE', DB::table('saas_plans')->where('code', 'GOURMET')->value('status'));
        $this->consola($token)->postJson('/api/v1/consola/empresas', $this->datosAlta(['ruc' => '20131312955', 'plan_code' => 'GOURMET']))
            ->assertStatus(422)->assertJsonPath('code', 'RN-SUS-05');
    }

    public function test_suscripcion_prueba_estados_solo_lectura_y_suspension(): void
    {
        [$token, $sub, , $tokenEmpresa] = $this->empresaEnPrueba();
        // RN-SUS-15: 14 + 10 = 24 días sí; 10 más pasarían de 30.
        $this->consola($token)->postJson("/api/v1/consola/suscripciones/{$sub}/extender", ['days' => 10, 'reason' => 'Pidió más tiempo'])->assertOk()
            ->assertJsonPath('trial_days_granted', 24);
        $this->consola($token)->postJson("/api/v1/consola/suscripciones/{$sub}/extender", ['days' => 10, 'reason' => 'Otra vez'])->assertStatus(422)->assertJsonPath('code', 'RN-SUS-15');

        // RN-SUS-04: transiciones válidas.
        $estado = fn (string $a) => $this->consola($token)->postJson("/api/v1/consola/suscripciones/{$sub}/estado", ['status' => $a, 'reason' => "Pasa a {$a}"]);
        $estado('ACTIVE')->assertOk();
        $estado('READ_ONLY')->assertStatus(422)->assertJsonPath('code', 'RN-SUS-04');
        $estado('PAST_DUE')->assertOk();
        // Con deuda opera normal (la regla de negocio responde, no el bloqueo).
        $this->desde(self::DG, $tokenEmpresa)->postJson('/api/v1/plt/marcas', [])->assertStatus(422);
        $estado('READ_ONLY')->assertOk();
        // RN-SUS-07: en solo lectura consulta pero no registra.
        $this->desde(self::DG, $tokenEmpresa)->postJson('/api/v1/plt/marcas', [])->assertStatus(402)->assertJsonPath('code', 'RN-SUS-07');
        $this->desde(self::DG, $tokenEmpresa)->getJson('/api/v1/me')->assertOk();
        // Suspendida: nadie de la empresa entra; reactivada, vuelve a operar.
        $estado('SUSPENDED')->assertOk();
        $this->desde(self::DG, $tokenEmpresa)->getJson('/api/v1/me')->assertStatus(403)->assertJsonPath('code', 'TENANT_BLOCKED');
        $estado('ACTIVE')->assertOk();
        $this->desde(self::DG, $tokenEmpresa)->postJson('/api/v1/plt/marcas', [])->assertStatus(422);
        $this->assertSame(5, DB::table('subscription_events')->where('subscription_id', $sub)->where('event', 'STATUS_CHANGED')->count(), 'Cada cambio de estado deja su evento');
        $this->assertDatabaseHas('platform_audit_log', ['action' => 'TENANT_SUSPENDED']);
        $this->assertDatabaseHas('platform_audit_log', ['action' => 'TENANT_REACTIVATED']);

        // Descuento pactado: entra al MRR (299 − 10 % = 269,10).
        $this->consola($token)->postJson("/api/v1/consola/suscripciones/{$sub}/descuento", ['pct' => 10, 'reason' => 'Cliente fundador'])->assertOk()->assertJsonPath('mrr', 269.1);

        // Cancelada es final y queda en solo lectura.
        $estado('CANCELLED')->assertOk();
        $estado('ACTIVE')->assertStatus(422)->assertJsonPath('code', 'RN-SUS-04');
        $this->desde(self::DG, $tokenEmpresa)->postJson('/api/v1/plt/marcas', [])->assertStatus(402);
    }

    public function test_solo_administracion_y_cobranza_cambian_planes_y_suscripciones(): void
    {
        [$token, $sub] = $this->empresaEnPrueba();
        [, $tokenL1] = $this->cuenta($token, 'karen.vilchez@intelectalab.com', 'SUPPORT_L1');
        $this->consola($tokenL1)->postJson("/api/v1/consola/suscripciones/{$sub}/estado", ['status' => 'ACTIVE', 'reason' => 'Intento'])->assertStatus(422)->assertJsonPath('code', 'RN-OPS-10');
        $this->consola($tokenL1)->postJson('/api/v1/consola/planes/borradores', ['plan_code' => 'INICIAL'])->assertStatus(422)->assertJsonPath('code', 'RN-OPS-10');
        $this->consola($tokenL1)->getJson('/api/v1/consola/suscripciones')->assertOk();   // consultar sí
        [, $tokenCobranza] = $this->cuenta($token, 'oscar.delgado@intelectalab.com', 'BILLING');
        $this->consola($tokenCobranza)->postJson("/api/v1/consola/suscripciones/{$sub}/estado", ['status' => 'ACTIVE', 'reason' => 'Pagó la primera cuota'])->assertOk();
    }

    /* ------------------------------------------------------------------ tanda 4: bitácora, parámetros y catálogos */

    public function test_bitacora_de_la_consola_con_filtros(): void
    {
        [$token] = $this->admin();
        $this->consola($token)->postJson('/api/v1/consola/empresas', $this->datosAlta())->assertCreated();
        $r = $this->consola($token)->getJson('/api/v1/consola/bitacora?action=TENANT_CREATED')->assertOk();
        $this->assertSame(1, $r->json('total'));
        $this->assertSame('Alta de empresa', $r->json('data.0.action_name'));
        $this->assertSame('Carnes del Norte', $r->json('data.0.tenant_short'));
        $this->assertSame('20100047218', $r->json('data.0.detail.ruc'), 'El detalle llega como datos, no como texto');
        $this->assertGreaterThan(0, $this->consola($token)->getJson('/api/v1/consola/bitacora?search=ana')->json('total'));
        $this->assertNotEmpty($r->json('acciones'));
    }

    public function test_parametros_de_plataforma_con_motivo_historial_y_reglas(): void
    {
        [$token] = $this->admin();
        $this->consola($token)->putJson('/api/v1/consola/parametros/ops_console_session_minutes', ['value' => 45, 'reason' => 'Turnos largos de soporte'])
            ->assertOk()->assertJsonPath('value', 45)->assertJsonPath('historial.0.reason', 'Turnos largos de soporte');
        $this->assertSame(45, (int) json_decode(DB::table('platform_parameters')->where('key', 'ops_console_session_minutes')->value('value')));
        $this->consola($token)->putJson('/api/v1/consola/parametros/ops_console_session_minutes', ['value' => 500, 'reason' => 'Demasiado'])
            ->assertStatus(422)->assertJsonPath('code', 'RN-OPS-05');
        $this->consola($token)->putJson('/api/v1/consola/parametros/ops_console_session_minutes', ['value' => 60])->assertStatus(422)->assertJsonValidationErrors('reason');
        // RN-OPS-16: no puede dejarse afuera a sí mismo (las pruebas llegan desde 127.0.0.1).
        $this->consola($token)->putJson('/api/v1/consola/parametros/ops_console_ip_allowlist', ['value' => '10.0.0.0/8', 'reason' => 'Solo la oficina'])
            ->assertStatus(422)->assertJsonPath('code', 'RN-OPS-16');
        $this->consola($token)->putJson('/api/v1/consola/parametros/ops_console_ip_allowlist', ['value' => '10.0.0.0/8, 127.0.0.1', 'reason' => 'Oficina y local'])
            ->assertOk()->assertJsonPath('value', ['10.0.0.0/8', '127.0.0.1']);
        $this->consola($token)->putJson('/api/v1/consola/parametros/ops_console_ip_allowlist', ['value' => '999.1.1.1', 'reason' => 'Red errada'])
            ->assertStatus(422)->assertJsonPath('code', 'RN-OPS-16');
        $this->assertDatabaseHas('platform_audit_log', ['action' => 'PARAMETER_CHANGED', 'entity_id' => 'ops_console_session_minutes']);
        [, $tokenL1] = $this->cuenta($token, 'karen.vilchez@intelectalab.com', 'SUPPORT_L1');
        $this->consola($tokenL1)->getJson('/api/v1/consola/parametros')->assertOk();
        $this->consola($tokenL1)->putJson('/api/v1/consola/parametros/ops_console_session_minutes', ['value' => 20, 'reason' => 'Intento'])
            ->assertStatus(422)->assertJsonPath('code', 'RN-OPS-10');
    }

    public function test_catalogos_globales_se_revisan_antes_de_importar(): void
    {
        [$token] = $this->admin();
        $u = DB::table('ubigeo')->where('code', '150101')->first() ?? DB::table('ubigeo')->first();
        $existente = "{$u->code};{$u->department};{$u->province};{$u->district}";
        $archivo = fn (string $texto) => UploadedFile::fake()->createWithContent('ubigeo.txt', $texto);

        // Revisar: una igual, una nueva y una con error; no graba nada.
        $r = $this->consola($token)->post('/api/v1/consola/catalogos/revisar', ['tabla' => 'ubigeo', 'archivo' => $archivo("{$existente}\n999901;PRUEBA;PRUEBA;DISTRITO NUEVO\nabc;sin datos")])
            ->assertOk();
        $this->assertSame(2, $r->json('validas'));
        $this->assertSame(3, $r->json('errores.0.linea'));
        $this->assertSame(1, $r->json('previa.nuevas'));
        $this->assertSame(1, $r->json('previa.iguales'));
        $this->assertFalse(DB::table('ubigeo')->where('code', '999901')->exists());

        // Con errores no importa nada.
        $this->consola($token)->post('/api/v1/consola/catalogos/importar', ['tabla' => 'ubigeo', 'reason' => 'Actualización INEI', 'archivo' => $archivo("{$existente}\nabc;sin datos")])
            ->assertStatus(422)->assertJsonPath('code', 'RN-MAE-11');

        // Sin errores importa (con el dueño de la base) y queda en la bitácora. Se deshace al terminar la prueba.
        $owner = DB::connection('pgsql_owner');
        $owner->beginTransaction();
        try {
            $this->consola($token)->post('/api/v1/consola/catalogos/importar', ['tabla' => 'ubigeo', 'reason' => 'Actualización INEI', 'archivo' => $archivo("{$existente}\n999901;PRUEBA;PRUEBA;DISTRITO NUEVO")])
                ->assertOk()->assertJsonPath('previa.nuevas', 1);
            $this->assertTrue($owner->table('ubigeo')->where('code', '999901')->exists());
        } finally {
            $owner->rollBack();
        }
        $this->assertDatabaseHas('platform_audit_log', ['action' => 'CATALOG_IMPORTED', 'entity' => 'ubigeo']);

        [, $tokenL2] = $this->cuenta($token, 'soporte@intelectalab.com', 'SUPPORT_L2');
        $this->consola($tokenL2)->post('/api/v1/consola/catalogos/revisar', ['tabla' => 'ubigeo', 'archivo' => $archivo($existente)])
            ->assertStatus(422)->assertJsonPath('code', 'RN-OPS-10');
    }

    public function test_dominios_de_correo_permitidos_se_cambian_en_parametros(): void
    {
        [$token] = $this->admin();
        $alta = fn (string $email) => $this->consola($token)->postJson('/api/v1/consola/usuarios', ['email' => $email, 'full_name' => 'Persona de Prueba', 'role' => 'READ_ONLY']);
        $alta('persona@gmail.com')->assertStatus(422)->assertJsonPath('code', 'RN-OPS-01');
        $this->consola($token)->putJson('/api/v1/consola/parametros/ops_platform_email_domains', ['value' => "intelectalab.com\n@Gmail.com", 'reason' => 'Personal con Gmail'])
            ->assertOk()->assertJsonPath('value', ['intelectalab.com', 'gmail.com']);
        $alta('persona@gmail.com')->assertCreated();
        $this->consola($token)->putJson('/api/v1/consola/parametros/ops_platform_email_domains', ['value' => 'no es dominio', 'reason' => 'Prueba de error'])
            ->assertStatus(422)->assertJsonPath('code', 'RN-OPS-01');
        // Vacío: cualquier correo.
        $this->consola($token)->putJson('/api/v1/consola/parametros/ops_platform_email_domains', ['value' => '', 'reason' => 'Sin restricción de dominio'])->assertOk();
        $alta('otra@empresa.pe')->assertCreated();
    }

    public function test_la_primera_cuenta_puede_agregar_su_dominio_desde_el_servidor(): void
    {
        try {
            UsuariosPlataforma::primeraCuenta('yadira@gmail.com', 'Yadira Prueba');
            $this->fail('Sin --agregar-dominio, un correo de otro dominio no entra');
        } catch (RuleError $e) {
            $this->assertSame('RN-OPS-01', $e->rule);
        }
        $this->assertNotEmpty(UsuariosPlataforma::primeraCuenta('yadira@gmail.com', 'Yadira Prueba', true));
        $this->assertContains('gmail.com', json_decode(DB::table('platform_parameters')->where('key', 'ops_platform_email_domains')->value('value'), true));
        $this->assertDatabaseHas('platform_parameter_history', ['key' => 'ops_platform_email_domains', 'changed_by_name' => 'Servidor (ops:crear-admin)']);
    }

    /* ------------------------------------------------------------------ tanda 5: registros y pedidos de demo */

    public function test_registros_y_pedidos_de_demo_en_la_consola(): void
    {
        [$token] = $this->admin();
        // Un registro desde la página y un pedido de demo.
        $this->flushHeaders();
        $this->withHeaders(['Accept' => 'application/json'])->postJson('/api/v1/publico/registro', ['ruc' => '20100047218', 'legal_name' => 'Distribuidora del Norte SAC',
            'trade_name' => 'Carnes del Norte', 'business_type' => 'DISTRIBUIDORA', 'tax_regime' => 'MYPE', 'fiscal_address' => 'Av. Industrial 123, Trujillo',
            'plan_code' => 'INICIAL', 'contact_name' => 'Rosa Medina Paz', 'email' => 'rosa@carnesdelnorte.pe', 'phone' => '987654321',
            'password' => 'Norte#Carnes2026', 'password_confirmation' => 'Norte#Carnes2026', 'terms' => true])->assertCreated();
        $this->withHeaders(['Accept' => 'application/json'])->postJson('/api/v1/publico/demo', ['name' => 'Luis Pérez', 'phone' => '999888777',
            'business_type' => 'CARNICERIA', 'consent' => true])->assertCreated();

        $registros = $this->consola($token)->getJson('/api/v1/consola/registros')->assertOk()->json('data');
        $this->assertSame('Por verificar', $registros[0]['status_name']);
        $demos = $this->consola($token)->getJson('/api/v1/consola/demos')->assertOk()->json('data');
        $this->assertSame('Luis Pérez', $demos[0]['name']);
        $this->assertNull($demos[0]['attended_at']);

        $this->consola($token)->postJson("/api/v1/consola/demos/{$demos[0]['id']}/atender", ['attended' => true, 'note' => 'Demo agendada el lunes'])->assertNoContent();
        $this->assertSame('Demo agendada el lunes', $this->consola($token)->getJson('/api/v1/consola/demos')->json('data.0.attended_note'));

        // Rechazar un registro libera el RUC y deja constancia; solo el administrador.
        [, $tokenL1] = $this->cuenta($token, 'karen.vilchez@intelectalab.com', 'SUPPORT_L1');
        $this->consola($tokenL1)->postJson("/api/v1/consola/registros/{$registros[0]['id']}/rechazar", ['reason' => 'Datos falsos'])->assertStatus(422)->assertJsonPath('code', 'RN-OPS-10');
        $this->consola($token)->postJson("/api/v1/consola/registros/{$registros[0]['id']}/rechazar", ['reason' => 'RUC de otra persona'])->assertNoContent();
        $this->assertSame('REJECTED', DB::table('tenant_signups')->value('status'));
        $this->assertDatabaseHas('platform_audit_log', ['action' => 'SIGNUP_REJECTED']);
    }

    /* ---------------------------------------------------------------- tanda 6: tickets de soporte */

    private function ticket(string $token, array $cambios = []): array
    {
        return $this->desde(self::DG, $token)->postJson('/api/v1/soporte/tickets', $cambios + [
            'subject' => 'No sale la boleta del pedido', 'description' => 'Al emitir la boleta del pedido de ayer sale un error.', 'category' => 'EINVOICE', 'priority' => 'NORMAL',
        ])->assertCreated()->json();
    }

    public function test_tickets_de_la_empresa_y_bandeja_de_la_consola(): void
    {
        $contadora = $this->ingresar(self::DG, 'mcardenas@donguando.pe');
        $gerente = $this->ingresar(self::DG, 'rquispe@donguando.pe');
        $cajero = $this->ingresar(self::DG, 'jsalas@donguando.pe');

        // Sin los permisos de soporte, no entra; abrir valida los datos.
        $this->desde(self::DG, $cajero)->getJson('/api/v1/soporte/tickets')->assertStatus(403);
        $this->desde(self::DG, $contadora)->postJson('/api/v1/soporte/tickets', ['subject' => 'x', 'category' => 'NADA', 'priority' => 'YA'])
            ->assertStatus(422)->assertJsonValidationErrors(['subject', 'description', 'category', 'priority']);

        // Jueves 10:00 en Lima, prioridad normal (8 horas hábiles): vence a las 18:00 del mismo día.
        $t = $this->ticket($contadora);
        $this->assertMatchesRegularExpression('/^TK-\d{4}$/', $t['number']);
        $this->assertSame('OPEN', $t['status']);
        $this->assertSame('2026-11-19 18:00', Carbon::parse($t['plazo']['vence'])->timezone('America/Lima')->format('Y-m-d H:i'));
        $this->ticket($gerente, ['subject' => 'Duda con el plan', 'category' => 'BILLING', 'priority' => 'LOW']);

        // Cada quien ve los suyos; con «ver todos» (gerencia), los de toda la empresa.
        $this->assertCount(1, $this->desde(self::DG, $contadora)->getJson('/api/v1/soporte/tickets')->assertOk()->json('data'));
        $this->assertCount(2, $this->desde(self::DG, $gerente)->getJson('/api/v1/soporte/tickets')->assertOk()->json('data'));
        TenantContext::platform();
        $deGerente = DB::table('support_tickets')->where('subject', 'Duda con el plan')->value('id');
        TenantContext::set(null);
        $this->desde(self::DG, $contadora)->getJson("/api/v1/soporte/tickets/{$deGerente}")->assertStatus(404);

        // La consola ve los de todas las empresas; solo un rol de soporte responde.
        [$admin] = $this->admin();
        [, $soporte] = $this->cuenta($admin, 'luis.soporte@intelectalab.com', 'SUPPORT_L1');
        [, $lectura] = $this->cuenta($admin, 'eva.lectura@intelectalab.com', 'READ_ONLY');
        $b = $this->consola($lectura)->getJson('/api/v1/consola/tickets')->assertOk();
        $this->assertSame(2, $b->json('cifras.abiertos'));
        $this->assertSame(2, $b->json('cifras.sin_asignar'));
        $this->assertNotEmpty($b->json('data.0.tenant_short'));
        $this->consola($lectura)->postJson("/api/v1/consola/tickets/{$t['id']}/responder", ['body' => 'Hola', 'status' => 'RESOLVED'])
            ->assertStatus(422)->assertJsonPath('code', 'RN-OPS-10');
        $this->consola($soporte)->getJson('/api/v1/consola/tickets?status=OPEN&priority=LOW')->assertOk()->assertJsonCount(1, 'data');

        // Soporte responde a las 10:20: a tiempo, queda asignado y le avisa en la campana a quien lo abrió.
        $this->travelTo(Carbon::parse('2026-11-19 10:20:00', 'America/Lima'));
        $r = $this->consola($soporte)->postJson("/api/v1/consola/tickets/{$t['id']}/responder", ['body' => 'Ya corregimos la serie, prueba de nuevo.', 'status' => 'RESOLVED'])->assertOk();
        $this->assertSame('RESOLVED', $r->json('status'));
        $this->assertSame('CUMPLIDO', $r->json('plazo.estado'));
        $this->assertSame('Persona de Prueba', $r->json('assigned_name'));
        $this->assertDatabaseHas('platform_audit_log', ['action' => 'TICKET_ANSWERED', 'entity_id' => $t['id']]);
        $campana = $this->desde(self::DG, $contadora)->getJson('/api/v1/me/notifications')->assertOk()->json('data');
        $this->assertStringContainsString($t['number'], $campana[0]['title']);
        $this->assertSame("/soporte?ticket={$t['id']}", $campana[0]['link']);

        // El cliente escribe de nuevo: se reabre. Resuelto otra vez, lo cierra y califica.
        $this->desde(self::DG, $contadora)->postJson("/api/v1/soporte/tickets/{$t['id']}/responder", ['body' => 'Sigue saliendo el error.'])->assertOk()->assertJsonPath('status', 'IN_PROGRESS');
        $this->desde(self::DG, $contadora)->postJson("/api/v1/soporte/tickets/{$t['id']}/cerrar", ['satisfaction' => 5])->assertStatus(422)->assertJsonPath('code', 'RN-OPS-15');
        $this->consola($soporte)->postJson("/api/v1/consola/tickets/{$t['id']}/responder", ['body' => 'Era el certificado: renovado.', 'status' => 'RESOLVED'])->assertOk();
        $c = $this->desde(self::DG, $contadora)->postJson("/api/v1/soporte/tickets/{$t['id']}/cerrar", ['satisfaction' => 5])->assertOk();
        $this->assertSame(['CLOSED', 5], [$c->json('status'), $c->json('satisfaction')]);
        $this->assertSame(['PLATFORM', 'CUSTOMER', 'PLATFORM', 'SYSTEM'], array_column($c->json('mensajes'), 'author_type'));
        $this->desde(self::DG, $contadora)->postJson("/api/v1/soporte/tickets/{$t['id']}/responder", ['body' => 'Otra cosa'])->assertStatus(422);
        $this->consola($soporte)->postJson("/api/v1/consola/tickets/{$t['id']}/responder", ['body' => 'Hola', 'status' => 'IN_PROGRESS'])->assertStatus(422);

        // Asignar a alguien del equipo; la conversación no se puede cambiar en la base.
        $ana = DB::table('platform_users')->where('email', 'ana.rios@intelectalab.com')->value('id');
        $this->consola($soporte)->postJson("/api/v1/consola/tickets/{$deGerente}/asignar", ['platform_user_id' => $ana])
            ->assertOk()->assertJsonPath('assigned_name', 'Ana Ríos Paredes');
        $this->expectException(QueryException::class);
        DB::table('support_ticket_messages')->update(['body' => 'cambiado']);
    }

    public function test_tickets_aislados_entre_empresas_y_en_solo_lectura_igual_pide_ayuda(): void
    {
        [$admin, $sub, $norte, $tokenNorte] = $this->empresaEnPrueba();
        foreach (['ACTIVE' => 'Pagó la prueba', 'PAST_DUE' => 'Tiene deuda', 'READ_ONLY' => 'Sigue debiendo'] as $estado => $motivo) {
            $this->consola($admin)->postJson("/api/v1/consola/suscripciones/{$sub}/estado", ['status' => $estado, 'reason' => $motivo])->assertOk();
        }
        // En solo lectura no registra nada, pero sí puede pedir ayuda.
        $deNorte = $this->ticket($tokenNorte, ['category' => 'BILLING', 'subject' => 'Quiero regularizar el pago']);
        $gerente = $this->ingresar(self::DG, 'rquispe@donguando.pe');
        $this->ticket($gerente);

        TenantContext::set(TenantContext::find($norte));
        $this->assertSame(['Quiero regularizar el pago'], DB::table('support_tickets')->pluck('subject')->all(), 'Cada empresa ve solo sus tickets');
        TenantContext::set(null);
        $this->assertSame(0, DB::table('support_tickets')->count(), 'Sin empresa ni consola, ninguno');
        $this->desde(self::DG, $gerente)->getJson("/api/v1/soporte/tickets/{$deNorte['id']}")->assertStatus(404);
        $this->assertCount(2, $this->consola($admin)->getJson('/api/v1/consola/tickets')->assertOk()->json('data'));
    }

    public function test_plazo_en_horario_habil_y_cierre_automatico_de_resueltos(): void
    {
        $lima = fn (Carbon $t) => $t->timezone('America/Lima')->format('D H:i');
        // Sábado 17:00, normal (8 h): 1 h el sábado, el domingo no cuenta, 7 h el lunes desde las 9 → lunes 16:00.
        $this->assertSame('Mon 16:00', $lima(Tickets::vencimiento(Carbon::parse('2026-11-21 17:00', 'America/Lima'), 'NORMAL')));
        // Abierto de noche, alta (4 h): empieza a contar a las 9 del día siguiente.
        $this->assertSame('Fri 13:00', $lima(Tickets::vencimiento(Carbon::parse('2026-11-19 22:00', 'America/Lima'), 'HIGH')));
        // Urgente cuenta las 24 horas.
        $this->assertSame('Sun 00:30', $lima(Tickets::vencimiento(Carbon::parse('2026-11-21 23:30', 'America/Lima'), 'URGENT')));

        $t = $this->ticket($this->ingresar(self::DG, 'mcardenas@donguando.pe'));
        [$admin] = $this->admin();
        $this->consola($admin)->postJson("/api/v1/consola/tickets/{$t['id']}/responder", ['body' => 'Listo, ya quedó.', 'status' => 'RESOLVED'])->assertOk();
        $estado = function () use ($t) {
            TenantContext::platform();
            $s = DB::table('support_tickets')->where('id', $t['id'])->value('status');
            TenantContext::set(null);

            return $s;
        };
        $this->travel(6)->days();
        $this->artisan('ops:cerrar-tickets')->assertSuccessful();
        $this->assertSame('RESOLVED', $estado(), 'A los 6 días sigue resuelto');
        $this->travel(2)->days();
        $this->artisan('ops:cerrar-tickets')->expectsOutput('1 ticket cerrado.')->assertSuccessful();
        $this->assertSame('CLOSED', $estado());
    }

    /* ---------------------------------------------------------------- tanda 7: accesos de soporte */

    private function dg(): string
    {
        return DB::table('tenants')->where('short', 'Don Guando')->value('id');
    }

    private function pedirAcceso(string $token, array $cambios = []): TestResponse
    {
        return $this->consola($token)->postJson('/api/v1/consola/accesos', $cambios + [
            'tenant_id' => $this->dg(), 'reason' => 'Revisar la boleta rechazada del ticket', 'level' => 'RO', 'modules' => ['CLI'], 'can_export' => false, 'hours' => 8,
        ]);
    }

    public function test_acceso_de_soporte_se_pide_se_aprueba_y_se_revoca(): void
    {
        [$admin] = $this->admin();
        [, $soporte] = $this->cuenta($admin, 'luis.soporte@intelectalab.com', 'SUPPORT_L1');
        $ticket = $this->ticket($this->ingresar(self::DG, 'mcardenas@donguando.pe'));

        // RN-OPS-10: nivel 1 pide solo lectura; RN-OPS-02: tope de 72 horas.
        $this->pedirAcceso($soporte, ['level' => 'RW'])->assertStatus(422)->assertJsonPath('code', 'RN-OPS-10');
        $this->pedirAcceso($soporte, ['hours' => 100])->assertStatus(422)->assertJsonPath('code', 'RN-OPS-02');
        $a = $this->pedirAcceso($soporte, ['ticket_id' => $ticket['id']])->assertCreated()->json();
        $this->assertSame(['PENDING', 'TK'], [$a['status'], substr($a['ticket_number'], 0, 2)]);
        $this->pedirAcceso($soporte)->assertStatus(422)->assertJsonPath('code', 'RN-OPS-03');
        // Nace pendiente: todavía no puede entrar.
        $this->consola($soporte)->postJson("/api/v1/consola/accesos/{$a['id']}/entrar")->assertStatus(422)->assertJsonPath('code', 'RN-OPS-04');

        // La empresa: quien no tiene el permiso no aprueba; el gerente recibió el aviso y aprueba sin horas → 8 h.
        $cajero = $this->ingresar(self::DG, 'jsalas@donguando.pe');
        $gerente = $this->ingresar(self::DG, 'rquispe@donguando.pe');
        $this->desde(self::DG, $cajero)->postJson("/api/v1/soporte/accesos/{$a['id']}/aprobar")->assertStatus(403);
        $this->assertSame('GestionCarnica pide acceso de soporte', $this->desde(self::DG, $gerente)->getJson('/api/v1/me/notifications')->json('data.0.title'));
        $ok = $this->desde(self::DG, $gerente)->postJson("/api/v1/soporte/accesos/{$a['id']}/aprobar", [])->assertOk();
        $this->assertSame(['ACTIVE', 8], [$ok->json('status'), $ok->json('hours')]);
        $this->assertSame(now()->addHours(8)->format('Y-m-d H:i'), Carbon::parse($ok->json('expires_at'))->timezone('America/Lima')->format('Y-m-d H:i'));
        $this->desde(self::DG, $gerente)->postJson("/api/v1/soporte/accesos/{$a['id']}/aprobar", [])->assertStatus(422)->assertJsonPath('code', 'RN-OPS-03');

        // Es personal: otra persona de la consola no entra. Quien lo pidió, sí.
        $this->consola($admin)->postJson("/api/v1/consola/accesos/{$a['id']}/entrar")->assertStatus(422)->assertJsonPath('code', 'RN-OPS-04');
        $sesion = $this->consola($soporte)->postJson("/api/v1/consola/accesos/{$a['id']}/entrar")->assertOk()->json('token');

        // RN-OPS-04: consulta su módulo; no modifica (solo lectura), no exporta y no ve otros módulos.
        $this->desde(self::DG, $sesion)->getJson('/api/v1/me')->assertOk()->assertJsonPath('soporte.level', 'RO')->assertJsonPath('roles', ['SOPORTE_TECNICO']);
        $this->desde(self::DG, $sesion)->getJson('/api/v1/cli/clientes')->assertOk();
        $this->desde(self::DG, $sesion)->postJson('/api/v1/cli/clientes', [])->assertStatus(403)->assertJsonPath('code', 'RN-OPS-04');
        $this->desde(self::DG, $sesion)->getJson('/api/v1/cli/clientes/exportar')->assertStatus(403)->assertJsonPath('code', 'RN-OPS-04');
        $this->desde(self::DG, $sesion)->getJson('/api/v1/ped/pedidos')->assertStatus(403);
        // Ni aprueba accesos ni ve los tickets de la empresa.
        $this->desde(self::DG, $sesion)->getJson('/api/v1/soporte/accesos')->assertStatus(403);

        // CA-OPS-03: la empresa y la consola ven lo mismo que hizo el soporte.
        $empresa = $this->desde(self::DG, $gerente)->getJson("/api/v1/soporte/accesos/{$a['id']}")->assertOk();
        $tipos = array_column($empresa->json('eventos'), 'kind');
        $this->assertContains('READ', $tipos);
        $this->assertSame(3, $empresa->json('resumen.DENIED'), 'Modificar, exportar y otro módulo quedan como rechazados');
        $this->assertSame($tipos, array_column($this->consola($soporte)->getJson("/api/v1/consola/accesos/{$a['id']}")->assertOk()->json('eventos'), 'kind'));
        $this->assertDatabaseHas('platform_audit_log', ['action' => 'ACCESS_SESSION_STARTED', 'entity_id' => $a['id']]);

        // Revocado: el usuario técnico queda inactivo y su sesión ya no sirve; un acceso cerrado no se reabre.
        $this->desde(self::DG, $gerente)->postJson("/api/v1/soporte/accesos/{$a['id']}/revocar", ['reason' => 'Ya se resolvió'])->assertOk()->assertJsonPath('status', 'REVOKED');
        $this->desde(self::DG, $sesion)->getJson('/api/v1/cli/clientes')->assertStatus(401);
        TenantContext::set(TenantContext::find($this->dg()));
        $this->assertSame('INACTIVE', DB::table('users')->where('email', 'luis.soporte+soporte@intelectalab.com')->value('status'));
        TenantContext::set(null);
        $this->desde(self::DG, $gerente)->postJson("/api/v1/soporte/accesos/{$a['id']}/aprobar", [])->assertStatus(422)->assertJsonPath('code', 'RN-OPS-03');
        // El usuario técnico no ingresa con contraseña.
        $this->desde(self::DG)->postJson('/api/v1/auth/login', ['email' => 'luis.soporte+soporte@intelectalab.com', 'password' => 'cualquiera'])->assertStatus(422);
        // La bitácora del acceso no se puede cambiar.
        $this->expectException(QueryException::class);
        TenantContext::platform();
        DB::table('support_access_events')->delete();
    }

    public function test_acceso_de_lectura_y_escritura_exporta_y_vence_solo(): void
    {
        [$admin] = $this->admin();
        $gerente = $this->ingresar(self::DG, 'rquispe@donguando.pe');
        $a = $this->pedirAcceso($admin, ['level' => 'RW', 'can_export' => true, 'hours' => 4])->assertCreated()->json();
        // RN-OPS-02: quien aprueba no pasa del tope.
        $this->desde(self::DG, $gerente)->postJson("/api/v1/soporte/accesos/{$a['id']}/aprobar", ['hours' => 80])->assertStatus(422)->assertJsonPath('code', 'RN-OPS-02');
        $this->desde(self::DG, $gerente)->postJson("/api/v1/soporte/accesos/{$a['id']}/aprobar", ['hours' => 2])->assertOk();
        $sesion = $this->consola($admin)->postJson("/api/v1/consola/accesos/{$a['id']}/entrar")->assertOk()->json('token');

        // Lectura y escritura: llega a la regla del negocio (no la corta el acceso) y exporta.
        $this->desde(self::DG, $sesion)->postJson('/api/v1/cli/clientes', [])->assertStatus(422);
        $this->desde(self::DG, $sesion)->get('/api/v1/cli/clientes/exportar')->assertOk();
        TenantContext::platform();
        $this->assertSame(['EXPORT', 'WRITE'], DB::table('support_access_events')->where('access_id', $a['id'])->whereIn('kind', ['EXPORT', 'WRITE'])->orderBy('kind')->pluck('kind')->all());
        TenantContext::set(null);

        // RN-OPS-09: a las 2 horas vence solo y la sesión deja de servir.
        $this->travel(2)->hours();
        $this->artisan('ops:vencer-accesos')->expectsOutput('1 acceso vencido.')->assertSuccessful();
        $this->desde(self::DG, $sesion)->getJson('/api/v1/cli/clientes')->assertStatus(401);
        $this->assertSame('EXPIRED', $this->desde(self::DG, $this->ingresar(self::DG, 'rquispe@donguando.pe'))->getJson('/api/v1/soporte/accesos')->assertOk()->json('data.0.status'));
    }

    /* ---------------------------------------------------------------- tanda 8: salud, incidentes y anuncios */

    public function test_salud_lee_componentes_y_una_caida_abre_un_incidente(): void
    {
        $this->artisan('ops:leer-salud')->expectsOutput('4 lecturas registradas.')->assertSuccessful();
        [$admin] = $this->admin();
        [, $l1] = $this->cuenta($admin, 'luis.soporte@intelectalab.com', 'SUPPORT_L1');
        [, $ing] = $this->cuenta($admin, 'iris.ingenieria@intelectalab.com', 'ENGINEER');

        $s = collect($this->consola($l1)->getJson('/api/v1/consola/salud')->assertOk()->json('data'))->keyBy('code');
        $this->assertCount(13, $s);
        $this->assertSame(['UP', 'UP', 'UNKNOWN'], [$s['DB']['status'], $s['APP']['status'], $s['OSE']['status']]);
        $this->assertEquals(100, $s['DB']['disponibilidad_24h']);
        $this->assertNull($s['OSE']['disponibilidad_24h'], 'Sin lecturas no hay disponibilidad (no se inventa)');

        // Solo ingeniería y administración registran a mano. CA-OPS-07: OSE caído abre un SEV2 (uno solo).
        $lectura = ['status' => 'DOWN', 'latency_ms' => 30000, 'detail' => 'El proveedor del OSE no responde'];
        $this->consola($l1)->postJson('/api/v1/consola/salud/OSE/lecturas', $lectura)->assertStatus(422)->assertJsonPath('code', 'RN-OPS-10');
        $this->consola($ing)->postJson('/api/v1/consola/salud/OSE/lecturas', $lectura)->assertOk()->assertJsonPath('status', 'DOWN');
        $this->consola($ing)->postJson('/api/v1/consola/salud/OSE/lecturas', $lectura)->assertOk();
        $inc = $this->consola($ing)->getJson('/api/v1/consola/incidentes?status=ABIERTOS')->assertOk()->json('data');
        $this->assertCount(1, $inc);
        $this->assertSame(['SEV2', 'OSE', 'AUTO', 'PENDIENTE'], [$inc[0]['severity'], $inc[0]['component_code'], $inc[0]['source'], $inc[0]['aviso']['estado']]);

        // Vuelve: la disponibilidad del día baja en proporción (2 caídas de 3 lecturas → 33,33 %).
        $this->consola($ing)->postJson('/api/v1/consola/salud/OSE/lecturas', ['status' => 'UP', 'detail' => 'El proveedor normalizó'])->assertOk();
        $this->assertEquals(33.33, collect($this->consola($ing)->getJson('/api/v1/consola/salud')->json('data'))->firstWhere('code', 'OSE')['disponibilidad_24h']);

        // Las lecturas son de solo inserción.
        $this->expectException(QueryException::class);
        TenantContext::platform();
        DB::table('platform_health_readings')->delete();
    }

    public function test_incidente_avisa_a_los_afectados_y_se_resuelve_con_causa_raiz(): void
    {
        [$admin, , $norte, $tokenNorte] = $this->empresaEnPrueba();
        [, $ing] = $this->cuenta($admin, 'iris.ingenieria@intelectalab.com', 'ENGINEER');
        $gerente = $this->ingresar(self::DG, 'rquispe@donguando.pe');
        $dg = $this->dg();

        $i = $this->consola($ing)->postJson('/api/v1/consola/incidentes', ['title' => 'Boletas sin respuesta del OSE', 'severity' => 'SEV1', 'component_code' => 'OSE',
            'affects_all' => false, 'tenants' => [$dg]])->assertCreated()->json();
        $this->assertSame(['INC-', 'PENDIENTE'], [substr($i['number'], 0, 4), $i['aviso']['estado']]);

        // A los 10 minutos se publica el mensaje: a tiempo (30 min), anuncio y aviso solo a la empresa afectada.
        $this->travel(10)->minutes();
        $u = $this->consola($ing)->postJson("/api/v1/consola/incidentes/{$i['id']}/actualizaciones", ['status' => 'IDENTIFIED', 'public' => true,
            'message' => 'Las boletas se están enviando con demora; no hace falta volver a emitirlas.'])->assertOk();
        $this->assertSame(['IDENTIFIED', 'A_TIEMPO'], [$u->json('status'), $u->json('aviso.estado')]);
        $this->assertSame('Incidente en GestionCarnica: Boletas sin respuesta del OSE', $this->desde(self::DG, $gerente)->getJson('/api/v1/me/notifications')->json('data.0.title'));
        $this->assertSame('INCIDENT', $this->desde(self::DG, $gerente)->getJson('/api/v1/anuncios')->assertOk()->json('data.0.kind'));
        $this->assertSame([], $this->desde(self::DG, $tokenNorte)->getJson('/api/v1/anuncios')->assertOk()->json('data'), 'Otra empresa no ve el incidente');

        // RN-OPS-14: el ticket que abrieron por esa causa se vincula.
        $t = $this->ticket($this->ingresar(self::DG, 'mcardenas@donguando.pe'));
        $this->consola($ing)->postJson("/api/v1/consola/tickets/{$t['id']}/incidente", ['incident_id' => $i['id']])->assertNoContent();
        $this->assertSame($t['number'], $this->consola($ing)->getJson("/api/v1/consola/incidentes/{$i['id']}")->json('tickets.0.number'));

        // RN-OPS-08: sin causa raíz no se resuelve; la hora de cierre va después del inicio.
        $this->consola($ing)->postJson("/api/v1/consola/incidentes/{$i['id']}/resolver", [])->assertStatus(422)->assertJsonValidationErrors(['root_cause']);
        $this->consola($ing)->postJson("/api/v1/consola/incidentes/{$i['id']}/resolver", ['root_cause' => 'Caída del proveedor', 'resolved_at' => now()->subHour()->toIso8601String()])
            ->assertStatus(422)->assertJsonPath('code', 'RN-OPS-08');
        $r = $this->consola($ing)->postJson("/api/v1/consola/incidentes/{$i['id']}/resolver", ['root_cause' => 'Caída del proveedor del OSE', 'message' => 'Las boletas pendientes ya se enviaron.'])->assertOk();
        $this->assertSame(['RESOLVED', 10], [$r->json('status'), $r->json('duracion_min')]);
        $this->assertSame('Resuelto: Boletas sin respuesta del OSE', $this->desde(self::DG, $gerente)->getJson('/api/v1/anuncios')->json('data.0.title'));
        $this->assertDatabaseHas('platform_audit_log', ['action' => 'INCIDENT_RESOLVED', 'entity_id' => $i['id']]);
        unset($norte);
    }

    public function test_anuncios_por_plan_programados_y_mantenimiento_con_anticipacion(): void
    {
        [$admin, $sub, , $tokenNorte] = $this->empresaEnPrueba();
        [, $l1] = $this->cuenta($admin, 'luis.soporte@intelectalab.com', 'SUPPORT_L1');
        $gerente = $this->ingresar(self::DG, 'rquispe@donguando.pe');
        TenantContext::platform();
        $plan = DB::table('subscriptions')->where('id', $sub)->value('plan_code');
        TenantContext::set(null);
        $nuevo = fn (array $d) => $this->consola($admin)->postJson('/api/v1/consola/anuncios', $d + ['body' => 'Texto del anuncio para las empresas.', 'kind' => 'INFO', 'audience' => 'ALL']);

        // Solo ingeniería y administración; un borrador no se ve.
        $this->consola($l1)->postJson('/api/v1/consola/anuncios', ['title' => 'Novedad', 'body' => 'Texto del anuncio.', 'kind' => 'INFO', 'audience' => 'ALL'])
            ->assertStatus(422)->assertJsonPath('code', 'RN-OPS-10');
        $porPlan = $nuevo(['title' => "Novedades del plan {$plan}", 'audience' => 'PLANS', 'audience_plans' => [$plan], 'kind' => 'FEATURE'])->assertCreated()->json();
        $this->assertSame('DRAFT', $porPlan['status']);
        $this->assertSame([], $this->desde(self::DG, $tokenNorte)->getJson('/api/v1/anuncios')->json('data'));

        // Publicado por plan: lo ve la empresa del plan, no Don Guando.
        $this->consola($admin)->postJson("/api/v1/consola/anuncios/{$porPlan['id']}/publicar")->assertOk()->assertJsonPath('status', 'ACTIVE');
        $this->assertSame([$porPlan['id']], array_column($this->desde(self::DG, $tokenNorte)->getJson('/api/v1/anuncios')->json('data'), 'id'));
        $this->assertSame([], $this->desde(self::DG, $gerente)->getJson('/api/v1/anuncios')->json('data'));

        // RN-OPS-18: un mantenimiento en 24 h no se publica; en 72 h, sí.
        $mant = fn (int $h) => $nuevo(['title' => 'Mantenimiento programado', 'kind' => 'MAINTENANCE',
            'maintenance_starts_at' => now()->addHours($h)->toIso8601String(), 'maintenance_ends_at' => now()->addHours($h + 2)->toIso8601String()])->assertCreated()->json('id');
        $this->consola($admin)->postJson('/api/v1/consola/anuncios/'.$mant(24).'/publicar')->assertStatus(422)->assertJsonPath('code', 'RN-OPS-18');
        $m = $mant(72);
        $this->consola($admin)->postJson("/api/v1/consola/anuncios/{$m}/publicar")->assertOk();
        $this->assertSame('MAINTENANCE', $this->desde(self::DG, $gerente)->getJson('/api/v1/anuncios')->json('data.0.kind'));

        // Programado para mañana: hoy no se ve. Cancelado, deja de verse.
        $prog = $nuevo(['title' => 'Nueva pantalla de reportes', 'starts_at' => now()->addDay()->toIso8601String()])->assertCreated()->json('id');
        $this->consola($admin)->postJson("/api/v1/consola/anuncios/{$prog}/publicar")->assertOk()->assertJsonPath('status', 'SCHEDULED');
        $this->assertCount(1, $this->desde(self::DG, $gerente)->getJson('/api/v1/anuncios')->json('data'));
        $this->consola($admin)->postJson("/api/v1/consola/anuncios/{$m}/cancelar")->assertOk()->assertJsonPath('status', 'CANCELLED');
        $this->assertSame([], $this->desde(self::DG, $gerente)->getJson('/api/v1/anuncios')->json('data'));
    }

    /* ---------------------------------------------------------------- tanda 9a: facturación, cobros y mora del SaaS */

    /** Empresa en plan activo (sin prueba) y el precio de su versión de plan. */
    private function empresaActiva(): array
    {
        [$admin, $sub, $norte, $tokenNorte] = $this->empresaEnPrueba();
        $this->consola($admin)->postJson("/api/v1/consola/suscripciones/{$sub}/estado", ['status' => 'ACTIVE', 'reason' => 'Contrató el plan'])->assertOk();
        TenantContext::platform();
        $precio = (float) DB::table('subscriptions as s')->join('saas_plan_versions as v', 'v.id', '=', 's.plan_version_id')->where('s.id', $sub)->value('v.price_pen');
        TenantContext::set(null);

        return [$admin, $sub, $norte, $tokenNorte, $precio];
    }

    private function emisor(string $admin): void
    {
        $ruc = DB::table('tenants')->where('short', 'Don Guando')->value('ruc');
        $this->consola($admin)->putJson('/api/v1/consola/parametros/sus_issuer_ruc', ['value' => '20123456780', 'reason' => 'RUC de prueba'])->assertStatus(422);
        $this->consola($admin)->putJson('/api/v1/consola/parametros/sus_issuer_ruc', ['value' => $ruc, 'reason' => 'RUC de Intelectalab'])->assertOk();
    }

    private function medioDePago(string $tenant, string $token): void
    {
        TenantContext::platform();
        DB::table('saas_payment_methods')->where('tenant_id', $tenant)->update(['active' => false]);
        DB::table('saas_payment_methods')->insert(['tenant_id' => $tenant, 'gateway' => 'FAKE', 'token' => $token, 'brand' => 'Visa', 'last4' => '4242',
            'exp_month' => 12, 'exp_year' => 2030, 'auto_pay' => true, 'created_at' => now(), 'updated_at' => now()]);
        TenantContext::set(null);
    }

    public function test_corrida_sin_emisor_deja_borradores_y_con_emisor_emite_cobra_y_concilia(): void
    {
        [$admin, $sub, $norte, , $precio] = $this->empresaActiva();
        [, $l1] = $this->cuenta($admin, 'luis.soporte@intelectalab.com', 'SUPPORT_L1');
        $this->consola($l1)->postJson('/api/v1/consola/facturacion/corridas', ['period' => '2026-11'])->assertStatus(422)->assertJsonPath('code', 'RN-OPS-10');

        // D-SUS-06: sin RUC emisor la corrida arma el borrador y no emite. Una segunda corrida no duplica.
        $r = $this->consola($admin)->postJson('/api/v1/consola/facturacion/corridas', ['period' => '2026-11'])->assertCreated();
        $this->assertSame([1, 0, 1], [$r->json('drafts'), $r->json('issued'), $r->json('run_no')]);
        $this->assertStringContainsString('RUC emisor', implode(' ', $r->json('notes')));
        $this->assertSame(0, $this->consola($admin)->postJson('/api/v1/consola/facturacion/corridas', ['period' => '2026-11'])->assertCreated()->json('drafts'));
        $f = $this->consola($admin)->getJson("/api/v1/consola/facturacion?tenant={$norte}")->assertOk()->json('data.0');
        $igv = round($precio * 0.18, 2);
        $this->assertSame(['DRAFT', 'INVOICE', 'RUC', round($precio + $igv, 2)], [$f['status'], $f['doc_type'], $f['customer_doc_type'], $f['total']]);
        $this->consola($admin)->postJson("/api/v1/consola/facturacion/{$f['id']}/emitir")->assertStatus(422)->assertJsonPath('code', 'RN-SUS-19');

        // Con RUC emisor: serie F001, correlativo desde 1, vence en 5 días.
        $this->emisor($admin);
        $e = $this->consola($admin)->postJson("/api/v1/consola/facturacion/{$f['id']}/emitir")->assertOk();
        $this->assertSame(['ISSUED', 'F001-00000001', today()->addDays(5)->toDateString()], [$e->json('status'), $e->json('number'), substr($e->json('due_date'), 0, 10)]);

        // Cobro rechazado: queda con deuda. Con otra tarjeta, aprobado: pagado y activa (RN-SUS-14, RN-SUS-10).
        $this->medioDePago($norte, 'fake_tok_declined');
        $this->consola($admin)->postJson("/api/v1/consola/facturacion/{$f['id']}/cobrar")->assertOk()->assertJsonPath('status', 'DECLINED');
        $this->assertSame('PAST_DUE', DB::table('subscriptions')->where('id', $sub)->value('status'));
        $this->medioDePago($norte, 'fake_tok_ok');
        $this->consola($admin)->postJson("/api/v1/consola/facturacion/{$f['id']}/cobrar")->assertOk()->assertJsonPath('status', 'APPROVED');
        $v = $this->consola($admin)->getJson("/api/v1/consola/facturacion/{$f['id']}")->assertOk();
        $this->assertSame(['PAID', 0, 2], [$v->json('payment_status'), $v->json('saldo'), count($v->json('cobros'))]);
        $this->assertSame('ACTIVE', DB::table('subscriptions')->where('id', $sub)->value('status'));

        // RN-SUS-13: el aviso repetido no tiene efecto; uno sin firma válida tampoco.
        $cobros = $this->consola($admin)->getJson('/api/v1/consola/cobros?status=APPROVED')->assertOk()->json('data');
        $evento = json_encode($cobros[0]['raw_event']);
        $this->postJson('/api/v1/publico/pasarela/fake', json_decode($evento, true), ['X-Firma' => str_repeat('0', 64)])
            ->assertStatus(401)->assertJsonPath('result', 'Firma inválida: sin efecto');
        $this->call('POST', '/api/v1/publico/pasarela/fake', [], [], [], ['HTTP_X_FIRMA' => PasarelaFake::firmar($evento), 'CONTENT_TYPE' => 'application/json'], $evento)
            ->assertOk()->assertJsonPath('result', 'Aviso repetido: sin efecto');
        TenantContext::platform();
        $this->assertSame(1, DB::table('saas_payments')->where('invoice_id', $f['id'])->where('status', 'APPROVED')->count());
        TenantContext::set(null);

        // Conciliación: el abono menor que lo cobrado deja la comisión.
        $abono = $this->consola($admin)->postJson('/api/v1/consola/cobros/conciliar', ['payments' => [$cobros[0]['id']], 'reference' => 'ABONO-001',
            'settled_on' => today()->toDateString(), 'amount' => round($cobros[0]['amount'] - 10, 2)])->assertCreated();
        $this->assertEquals(10, $abono->json('fee'));
        $this->consola($admin)->postJson('/api/v1/consola/cobros/conciliar', ['payments' => [$cobros[0]['id']], 'reference' => 'ABONO-002',
            'settled_on' => today()->toDateString(), 'amount' => 1])->assertStatus(422)->assertJsonPath('code', 'RN-SUS-13');

        // RN-SUS-11: se corrige con nota de crédito (serie FC01) que no pasa lo que queda; el emitido no cambia.
        $this->consola($admin)->postJson("/api/v1/consola/facturacion/{$f['id']}/nota-credito", ['amount' => 9999, 'reason' => 'Monto mayor'])
            ->assertStatus(422)->assertJsonPath('code', 'RN-SUS-11');
        $n = $this->consola($admin)->postJson("/api/v1/consola/facturacion/{$f['id']}/nota-credito", ['amount' => 59, 'reason' => 'Días sin servicio por el incidente'])->assertOk();
        $this->assertSame('FC01-00000001', $n->json('notas.0.number'));
        $this->expectException(QueryException::class);
        TenantContext::platform();
        DB::table('saas_invoices')->where('id', $f['id'])->update(['total' => 1]);
    }

    public function test_mora_pasa_a_solo_lectura_y_suspension_y_el_pago_la_reactiva(): void
    {
        [$admin, $sub, $norte] = $this->empresaActiva();
        $this->emisor($admin);
        $this->consola($admin)->postJson('/api/v1/consola/facturacion/corridas', ['period' => now()->format('Y-m')])->assertCreated()->assertJsonPath('issued', 1);
        $estado = fn () => DB::table('subscriptions')->where('id', $sub)->value('status');
        $mora = fn () => $this->artisan('sus:mora')->assertSuccessful();

        // Vence a los 5 días; al día siguiente, con deuda (opera normal).
        $this->travel(6)->days();
        $mora();
        $this->assertSame('PAST_DUE', $estado());

        // Prórroga hasta el día 9 de mora: a los 7 no pasa a solo lectura; a los 10, sí.
        DB::table('subscriptions')->where('id', $sub)->update(['grace_until' => today()->addDays(8)->toDateString()]);
        $this->travel(6)->days();
        $mora();
        $this->assertSame('PAST_DUE', $estado(), 'La prórroga pospone el paso');
        $this->travel(3)->days();
        $mora();
        $this->assertSame('READ_ONLY', $estado());
        $empresa = $this->ingresar(self::DG, 'rosa.medina@carnesdelnorte.pe', 'Norte#Carnes2026');
        $this->desde(self::DG, $empresa)->postJson('/api/v1/plt/marcas', [])->assertStatus(402)->assertJsonPath('code', 'RN-SUS-07');

        // A los 22 días de mora (7 + 15), suspendida: la empresa no entra.
        $this->travel(12)->days();
        $mora();
        $this->assertSame('SUSPENDED', $estado());
        $this->assertSame('SUSPENDED', DB::table('tenants')->where('id', $norte)->value('status'));

        // CA-SUS-04: el pago confirmado la devuelve a activa en el momento.
        $this->medioDePago($norte, 'fake_tok_ok');
        $token = $this->entrar('ana.rios@intelectalab.com', $this->secretoAdmin);
        $cola = $this->consola($token)->getJson('/api/v1/consola/mora')->assertOk()->json('data.0');
        $this->assertSame(['SUSPENDED', 22], [$cola['status'], $cola['dias']]);
        $this->consola($token)->postJson("/api/v1/consola/mora/{$sub}/cobrar")->assertOk()->assertJsonPath('status', 'APPROVED');
        $this->assertSame('ACTIVE', $estado());
        $this->assertSame('ACTIVE', DB::table('tenants')->where('id', $norte)->value('status'));
        $this->assertSame(['PAST_DUE', 'READ_ONLY', 'SUSPENDED', 'ACTIVE'], DB::table('subscription_events')->where('subscription_id', $sub)->where('event', 'STATUS_CHANGED')
            ->where('actor_type', 'SYSTEM')->orderBy('occurred_at')->pluck('to_status')->all());
        $this->assertSame([], $this->consola($token)->getJson('/api/v1/consola/mora')->json('data'));
    }

    public function test_prueba_vencida_sin_medio_de_pago_pasa_a_solo_lectura(): void
    {
        [, $sub, $norte] = $this->empresaEnPrueba();
        $this->travel(15)->days();
        $this->artisan('sus:mora')->assertSuccessful();
        $this->assertSame('READ_ONLY', DB::table('subscriptions')->where('id', $sub)->value('status'));
        $this->assertSame('Terminó la prueba sin medio de pago', DB::table('subscription_events')->where('subscription_id', $sub)->orderByDesc('occurred_at')->value('reason'));
        unset($norte);
    }

    /* ---------------------------------------------------------------- tanda 9b: la suscripción vista por la empresa */

    private function tarjeta(string $token, string $resultado, string $ultimos): void
    {
        $this->desde(self::DG, $token)->putJson('/api/v1/suscripcion/medio-de-pago', ['gateway' => 'FAKE', 'token' => "fake_tok_{$resultado}_abcdefgh12345678",
            'brand' => 'Visa', 'last4' => $ultimos, 'exp_month' => 12, 'exp_year' => 2030, 'auto_pay' => true, 'billing_email' => 'pagos@carnesdelnorte.pe'])->assertOk();
    }

    public function test_mi_suscripcion_tarjeta_pago_de_comprobantes_y_franja_de_mora(): void
    {
        [$admin, $sub, $norte, $empresa] = $this->empresaActiva();

        // SUS-01 y SUS-04: plan, estado y uso. Don Guando opera sin suscripción (RN-SUS-21).
        $r = $this->desde(self::DG, $empresa)->getJson('/api/v1/suscripcion')->assertOk();
        $this->assertSame([false, 'ACTIVE', 'CRECIMIENTO'], [$r->json('sin_suscripcion'), $r->json('status'), $r->json('plan_code')]);
        $this->assertSame(['users', 'brands', 'sites'], array_column($r->json('uso'), 'clave'));
        $this->assertSame(1, $r->json('uso.0.usado'));
        $gerenteDg = $this->ingresar(self::DG, 'rquispe@donguando.pe');
        $this->desde(self::DG, $gerenteDg)->getJson('/api/v1/suscripcion')->assertOk()->assertJsonPath('sin_suscripcion', true);
        $this->desde(self::DG, $gerenteDg)->getJson('/api/v1/me')->assertOk()->assertJsonPath('suscripcion', null);

        // SUS-06 (RN-SUS-20): llega el token de la pasarela, nunca el número de la tarjeta.
        $this->desde(self::DG, $empresa)->putJson('/api/v1/suscripcion/medio-de-pago', ['gateway' => 'FAKE', 'token' => '4111111111111111', 'brand' => 'Visa',
            'last4' => '1111', 'exp_month' => 12, 'exp_year' => 2030, 'auto_pay' => true])->assertStatus(422)->assertJsonValidationErrors('token');
        $this->tarjeta($empresa, 'declined', '0002');

        // La corrida cobra con esa tarjeta: rechazada → con deuda y franja en /me.
        $this->emisor($admin);
        $this->consola($admin)->postJson('/api/v1/consola/facturacion/corridas', ['period' => now()->format('Y-m')])->assertCreated()->assertJsonPath('charged', 1);
        $this->assertSame('PAST_DUE', DB::table('subscriptions')->where('id', $sub)->value('status'));
        $this->desde(self::DG, $empresa)->getJson('/api/v1/me')->assertOk()->assertJsonPath('suscripcion.status', 'PAST_DUE');

        // SUS-05: ve solo sus comprobantes emitidos; otra empresa no los ve.
        $lista = $this->desde(self::DG, $empresa)->getJson('/api/v1/suscripcion/comprobantes')->assertOk()->json('data');
        $this->assertCount(1, $lista);
        $this->assertArrayNotHasKey('tenant_id', $lista[0]);
        $contadoraDg = $this->ingresar(self::DG, 'mcardenas@donguando.pe');
        $this->assertSame([], $this->desde(self::DG, $contadoraDg)->getJson('/api/v1/suscripcion/comprobantes')->assertOk()->json('data'));
        $this->desde(self::DG, $contadoraDg)->getJson("/api/v1/suscripcion/comprobantes/{$lista[0]['id']}")->assertStatus(404);

        // Cambia la tarjeta y paga el vencido: vuelve a activa y la franja desaparece.
        $this->tarjeta($empresa, 'ok', '4242');
        $p = $this->desde(self::DG, $empresa)->postJson("/api/v1/suscripcion/comprobantes/{$lista[0]['id']}/pagar")->assertOk();
        $this->assertSame(['APPROVED', 'PAID'], [$p->json('status'), $p->json('comprobante.payment_status')]);
        $this->assertSame('ACTIVE', DB::table('subscriptions')->where('id', $sub)->value('status'));
        $this->desde(self::DG, $empresa)->getJson('/api/v1/me')->assertOk()->assertJsonPath('suscripcion', null);
        $this->assertSame('Visa', $this->desde(self::DG, $empresa)->getJson('/api/v1/suscripcion')->json('medio_pago.brand'));
        TenantContext::platform();
        $this->assertSame(1, DB::table('saas_payment_methods')->where('tenant_id', $norte)->where('active', true)->count(), 'Una sola tarjeta activa');
        $this->assertStringNotContainsString('4111', (string) DB::table('saas_payment_methods')->where('tenant_id', $norte)->pluck('token')->implode(','));
        TenantContext::set(null);
    }

    public function test_cancelar_al_fin_del_periodo_deshacer_y_conservar_en_solo_lectura(): void
    {
        [, $sub, , $empresa] = $this->empresaActiva();
        $this->desde(self::DG, $empresa)->postJson('/api/v1/suscripcion/cancelar', ['reason' => 'Cerramos la tienda', 'survey' => 'CLOSING'])
            ->assertStatus(422)->assertJsonValidationErrors('exported');
        $datos = ['reason' => 'Cerramos la tienda por remodelación', 'survey' => 'CLOSING', 'exported' => true];

        // RN-SUS-17: al fin del período (el primer día del mes siguiente), y se puede deshacer antes.
        $c = $this->desde(self::DG, $empresa)->postJson('/api/v1/suscripcion/cancelar', $datos)->assertOk();
        $this->assertSame([true, now()->startOfMonth()->addMonth()->toDateString()], [$c->json('cancel_at_period_end'), $c->json('cancel_effective_on')]);
        $this->desde(self::DG, $empresa)->getJson('/api/v1/me')->assertJsonPath('suscripcion.cancel_effective_on', now()->startOfMonth()->addMonth()->toDateString());
        $this->desde(self::DG, $empresa)->postJson('/api/v1/suscripcion/cancelar/deshacer')->assertOk()->assertJsonPath('cancel_at_period_end', false);
        $this->desde(self::DG, $empresa)->postJson('/api/v1/suscripcion/cancelar', $datos)->assertOk();

        // Llega la fecha: cancelada, en solo lectura, con sus datos guardados 90 días.
        $this->travelTo(now()->startOfMonth()->addMonth()->setTime(6, 20));
        $this->artisan('sus:mora')->assertSuccessful();
        $this->assertSame('CANCELLED', DB::table('subscriptions')->where('id', $sub)->value('status'));
        $empresa = $this->ingresar(self::DG, 'rosa.medina@carnesdelnorte.pe', 'Norte#Carnes2026');
        $this->desde(self::DG, $empresa)->postJson('/api/v1/plt/marcas', [])->assertStatus(402);
        $r = $this->desde(self::DG, $empresa)->getJson('/api/v1/suscripcion')->assertOk();
        $this->assertSame(['CANCELLED', today()->addDays(90)->toDateString()], [$r->json('status'), $r->json('conservacion_hasta')]);
        // Sus rutas siguen respondiendo en solo lectura (con la regla, no con el bloqueo).
        $this->desde(self::DG, $empresa)->postJson('/api/v1/suscripcion/cancelar/deshacer')->assertStatus(422)->assertJsonPath('code', 'RN-SUS-17');
    }

    public function test_contrato_de_limites_del_plan(): void
    {
        [, , $norte] = $this->empresaActiva();
        TenantContext::set(TenantContext::find($norte));
        $limite = Suscripcion::limite('users');
        $this->assertNotNull($limite);
        Suscripcion::exigirLimite('users', $limite - 1);   // cabe
        try {
            Suscripcion::exigirLimite('users', $limite);
            $this->fail('Debió rechazar por el límite');
        } catch (RuleError $e) {
            $this->assertSame('RN-SUS-06', $e->rule);
            $this->assertStringContainsString("permite {$limite} usuarios", $e->getMessage());
        }
        TenantContext::set(TenantContext::find($this->dg()));
        $this->assertNull(Suscripcion::limite('users'), 'Sin suscripción no hay límites (RN-SUS-21)');
        $this->assertTrue(Suscripcion::operativa());
        TenantContext::set(null);
    }

    /* ---------------------------------------------------------------- tanda 9c: cambio de plan y complementos */

    private function enEmpresa(string $tenant, \Closure $fn): mixed
    {
        TenantContext::set(TenantContext::find($tenant));
        try {
            return $fn();
        } finally {
            TenantContext::set(null);
        }
    }

    private function modulosEncendidos(string $tenant): array
    {
        return $this->enEmpresa($tenant, fn () => DB::table('tenant_modules')->where('enabled', true)->orderBy('module_code')->pluck('module_code')->all());
    }

    public function test_subir_de_plan_con_prorrateo_y_bajar_al_fin_del_periodo(): void
    {
        [$admin, $sub, $norte, $empresa] = $this->empresaActiva();
        $this->emisor($admin);
        $this->tarjeta($empresa, 'ok', '4242');
        $multi = DB::table('saas_plan_versions')->where('plan_code', 'MULTIMARCA')->where('status', 'PUBLISHED')->value('id');
        $inicial = DB::table('saas_plan_versions')->where('plan_code', 'INICIAL')->where('status', 'PUBLISHED')->value('id');
        $antes = $this->modulosEncendidos($norte);

        // CA-SUS-06: el 19 de noviembre quedan 12 de 30 días: (599 − 299) × 12 / 30 = 120,00.
        $planes = collect($this->desde(self::DG, $empresa)->getJson('/api/v1/suscripcion/planes')->assertOk()->json('planes'))->keyBy('plan_code');
        $this->assertSame(['ACTUAL', 'SUBE', 'BAJA'], [$planes['CRECIMIENTO']['tipo'], $planes['MULTIMARCA']['tipo'], $planes['INICIAL']['tipo']]);
        $this->assertEquals(120, $planes['MULTIMARCA']['prorrateo']['monto']);
        $this->desde(self::DG, $empresa)->postJson('/api/v1/suscripcion/plan', ['plan_version_id' => $multi])->assertOk();
        $this->assertSame('MULTIMARCA', DB::table('subscriptions')->where('id', $sub)->value('plan_code'));
        TenantContext::platform();
        $p = DB::table('saas_invoices')->where('tenant_id', $norte)->where('kind', 'PRORATION')->first();
        TenantContext::set(null);
        $this->assertSame(['141.60', 'PAID'], [$p->total, $p->payment_status], 'Comprobante aparte, emitido y cobrado');
        $despues = $this->modulosEncendidos($norte);
        $this->assertGreaterThan(count($antes), count($despues), 'RN-SUS-08: el plan nuevo enciende sus módulos en el momento');

        // CA-SUS-07: con 6 usuarios no se baja a Inicial (5).
        $this->enEmpresa($norte, function () {
            foreach (range(1, 5) as $i) {
                DB::table('users')->insert(['name' => "Persona {$i}", 'email' => "persona{$i}@carnesdelnorte.pe", 'role' => 'VENDEDORA', 'status' => 'ACTIVE',
                    'password' => 'x', 'failed_logins' => 0]);
            }
        });
        $this->desde(self::DG, $empresa)->postJson('/api/v1/suscripcion/plan', ['plan_version_id' => $inicial])->assertStatus(422)
            ->assertJsonPath('code', 'RN-SUS-18')->assertJsonFragment(['message' => 'Con tu uso actual no entras en el plan Inicial: Usuarios del personal 6 de 5 (te sobran 1).']);

        // Sin esos usuarios cabe: se programa para el 1 de diciembre, se puede deshacer, y la tarea lo aplica ese día.
        $this->enEmpresa($norte, fn () => DB::table('users')->where('email', 'like', 'persona%')->update(['status' => 'INACTIVE']));
        $this->desde(self::DG, $empresa)->postJson('/api/v1/suscripcion/plan', ['plan_version_id' => $inicial])->assertOk()->assertJsonPath('pendiente_desde', '2026-12-01');
        $this->desde(self::DG, $empresa)->postJson('/api/v1/suscripcion/plan/deshacer')->assertOk()->assertJsonPath('pendiente', null);
        $this->desde(self::DG, $empresa)->postJson('/api/v1/suscripcion/plan', ['plan_version_id' => $inicial])->assertOk();
        $this->travelTo(Carbon::parse('2026-12-01 06:20', 'America/Lima'));
        $this->artisan('sus:mora')->assertSuccessful();
        $this->assertSame('INICIAL', DB::table('subscriptions')->where('id', $sub)->value('plan_code'));
        $this->assertLessThan(count($antes), count($this->modulosEncendidos($norte)), 'Al bajar se apagan los módulos que el plan no incluye');
    }

    public function test_complementos_se_publican_con_precio_suben_limites_y_encienden_modulos(): void
    {
        [$admin, $sub, $norte, $empresa] = $this->empresaActiva();
        [, $l1] = $this->cuenta($admin, 'luis.soporte@intelectalab.com', 'SUPPORT_L1');

        // SUS-10: nacen en borrador sin precio; se publican con precio; solo administración y cobranza.
        $lista = collect($this->consola($admin)->getJson('/api/v1/consola/complementos')->assertOk()->json('data'))->keyBy('code');
        $this->assertSame('DRAFT', $lista['USERS_5']['status']);
        $this->consola($admin)->postJson('/api/v1/consola/complementos/USERS_5/publicar')->assertStatus(422)->assertJsonPath('code', 'RN-SUS-01');
        $this->consola($l1)->putJson('/api/v1/consola/complementos/USERS_5', ['name' => '5 usuarios más', 'kind' => 'LIMIT', 'limit_key' => 'users', 'unit_qty' => 5, 'price_pen' => 25])
            ->assertStatus(422)->assertJsonPath('code', 'RN-OPS-10');
        $this->consola($admin)->putJson('/api/v1/consola/complementos/USERS_5', ['name' => '5 usuarios más', 'kind' => 'LIMIT', 'limit_key' => 'users', 'unit_qty' => 5, 'price_pen' => 25])->assertOk();
        $this->consola($admin)->postJson('/api/v1/consola/complementos/USERS_5/publicar')->assertOk()->assertJsonPath('status', 'PUBLISHED');

        // Un módulo que Crecimiento no trae y cuyas dependencias sí trae.
        $deseados = $this->enEmpresa($norte, fn () => ModulosDelPlan::deseados(Suscripcion::vigente()));
        $catalogo = Planes::modulos();
        $modulo = collect($catalogo)->first(fn ($m) => ! isset($deseados[$m['code']]) && ! $m['is_core'] && ! array_diff($m['depends_on'], array_keys($deseados)))['code'];
        $this->consola($admin)->postJson('/api/v1/consola/complementos', ['code' => 'MOD_X', 'name' => 'Módulo extra', 'kind' => 'MODULE', 'module_code' => $modulo, 'price_pen' => 30])->assertCreated();
        $this->consola($admin)->postJson('/api/v1/consola/complementos/MOD_X/publicar')->assertOk();

        // SUS-03: la empresa contrata 2 × 5 usuarios (15 + 10 = 25) y el módulo, que se enciende como complemento.
        $this->desde(self::DG, $empresa)->postJson('/api/v1/suscripcion/complementos/USERS_5', ['quantity' => 2])->assertOk();
        $this->assertSame(25, $this->enEmpresa($norte, fn () => Suscripcion::limite('users')));
        $this->desde(self::DG, $empresa)->postJson('/api/v1/suscripcion/complementos/MOD_X')->assertOk();
        $this->assertSame('ADDON', $this->enEmpresa($norte, fn () => DB::table('tenant_modules')->where('module_code', $modulo)->where('enabled', true)->value('sus_source')));
        $this->desde(self::DG, $empresa)->postJson('/api/v1/suscripcion/complementos/MOD_X')->assertStatus(422)->assertJsonPath('code', 'RN-SUS-01');

        // La corrida cobra el plan y los complementos.
        $this->emisor($admin);
        $this->consola($admin)->postJson('/api/v1/consola/facturacion/corridas', ['period' => '2026-11'])->assertCreated();
        $f = $this->consola($admin)->getJson("/api/v1/consola/facturacion?tenant={$norte}")->json('data.0.id');
        $lineas = $this->consola($admin)->getJson("/api/v1/consola/facturacion/{$f}")->json('lineas');
        $this->assertCount(3, $lineas);
        $this->assertEquals(50, collect($lineas)->firstWhere('description', 'Complemento 5 usuarios más × 2')['subtotal']);

        // Quitar: baja el límite y apaga el módulo; RN-SUS-09: la empresa ya no lo enciende a mano.
        $this->desde(self::DG, $empresa)->deleteJson('/api/v1/suscripcion/complementos/USERS_5', ['quantity' => 1])->assertOk();
        $this->assertSame(20, $this->enEmpresa($norte, fn () => Suscripcion::limite('users')));
        $this->desde(self::DG, $empresa)->deleteJson('/api/v1/suscripcion/complementos/MOD_X')->assertOk();
        $this->assertNotContains($modulo, $this->modulosEncendidos($norte));
        $this->enEmpresa($norte, function () use ($modulo) {
            $gerente = User::where('email', 'rosa.medina@carnesdelnorte.pe')->first();
            try {
                Modulos::cambiar($modulo, true, 'Lo quiero encender sin contratarlo', $gerente);
                $this->fail('Debió rechazar un módulo no contratado');
            } catch (RuleError $e) {
                $this->assertSame('RN-SUS-09', $e->rule);
            }
        });
        unset($sub);
    }

    /* ---------------------------------------------------------------- tanda 9d: métricas del negocio e historial de uso */

    public function test_metricas_del_mes_churn_y_congelar_el_cierre(): void
    {
        [$admin, , , $empresa] = $this->empresaActiva();
        // Otra empresa en el plan Inicial, activa: MRR 299 + 149 = 448, 2 clientes, ingreso promedio 224.
        $otra = $this->consola($admin)->postJson('/api/v1/consola/empresas', $this->datosAlta(['ruc' => '20555000007', 'legal_name' => 'Carnicería La Española EIRL',
            'trade_name' => 'La Española', 'plan_code' => 'INICIAL', 'admin_email' => 'gerencia@laespanola.pe']))->assertCreated()->json('id');
        $subOtra = DB::table('subscriptions')->where('tenant_id', $otra)->value('id');
        $this->consola($admin)->postJson("/api/v1/consola/suscripciones/{$subOtra}/estado", ['status' => 'ACTIVE', 'reason' => 'Contrató el plan'])->assertOk();

        $mes = collect($this->consola($admin)->getJson('/api/v1/consola/metricas')->assertOk()->json('meses'))->last();
        $this->assertSame(['2026-11', false, 448, 2, 224], [$mes['period'], $mes['congelado'], (int) $mes['mrr'], $mes['clientes_activos'], (int) $mes['ingreso_promedio']]);
        $this->assertNull($mes['tiempo_de_alta'], 'Sin el primer comprobante aceptado no se inventa');

        // SUS-04: la foto de uso del mes llega al historial de la empresa.
        $this->artisan('ops:metricas uso')->assertSuccessful();
        $h = $this->desde(self::DG, $empresa)->getJson('/api/v1/suscripcion')->assertOk()->json('historial');
        $this->assertSame(['2026-11', 1, 15], [$h[0]['period'], $h[0]['users'], $h[0]['users_limit']]);

        // En diciembre cancela La Española: churn de clientes 1/2 = 50 %, de MRR 149/448, retención neta 299/448.
        $this->travelTo(Carbon::parse('2026-12-10 10:00', 'America/Lima'));
        $token = $this->entrar('ana.rios@intelectalab.com', $this->secretoAdmin);
        $this->consola($token)->postJson("/api/v1/consola/suscripciones/{$subOtra}/estado", ['status' => 'CANCELLED', 'reason' => 'Cerró el negocio'])->assertOk();
        $dic = collect($this->consola($token)->getJson('/api/v1/consola/metricas')->json('meses'))->last();
        $this->assertSame(['2026-12', 50.0, 33.26, 66.74, 299, 1], [$dic['period'], (float) $dic['churn_clientes'], (float) $dic['churn_mrr'], (float) $dic['retencion_neta'],
            (int) $dic['mrr'], $dic['clientes_activos']]);

        // RN-OPS-17: noviembre se congela; recalcular pide motivo y crea otra corrida; el mes en curso no se congela.
        [, $l1] = $this->cuenta($token, 'luis.soporte@intelectalab.com', 'SUPPORT_L1');
        $this->consola($l1)->postJson('/api/v1/consola/metricas/congelar', ['period' => '2026-11'])->assertStatus(422)->assertJsonPath('code', 'RN-OPS-10');
        $this->consola($token)->postJson('/api/v1/consola/metricas/congelar', ['period' => '2026-11'])->assertCreated()->assertJsonPath('run_no', 1);
        $this->consola($token)->postJson('/api/v1/consola/metricas/congelar', ['period' => '2026-11'])->assertStatus(422)->assertJsonPath('code', 'RN-OPS-17');
        $this->consola($token)->postJson('/api/v1/consola/metricas/congelar', ['period' => '2026-11', 'reason' => 'Se corrigió un descuento'])->assertCreated()->assertJsonPath('run_no', 2);
        $this->consola($token)->postJson('/api/v1/consola/metricas/congelar', ['period' => '2026-12'])->assertStatus(422)->assertJsonPath('code', 'RN-OPS-17');
        $meses = collect($this->consola($token)->getJson('/api/v1/consola/metricas')->json('meses'))->keyBy('period');
        $this->assertSame([true, 2, 448], [$meses['2026-11']['congelado'], $meses['2026-11']['run_no'], (int) $meses['2026-11']['mrr']]);

        // Las corridas congeladas no se cambian.
        $this->expectException(QueryException::class);
        TenantContext::platform();
        DB::table('platform_metric_runs')->delete();
    }
}
