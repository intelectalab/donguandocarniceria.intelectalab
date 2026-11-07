<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\Access;
use App\Support\Events;
use App\Support\TenantContext;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/** La base sobre la que se construyen los módulos: empresa (por usuario o por dominio), ingreso, acceso y aislamiento. */
class PlataformaTest extends TestCase
{
    public function test_ingreso_general_sin_empresa_hasta_ingresar(): void
    {
        $this->desde(self::DG)->getJson('/api/v1/tenant')->assertOk()->assertJsonPath('general', true);

        // La empresa sale del correo: la gerente de CS entra por la misma dirección y ve solo CS.
        $token = $this->ingresar(self::DG, 'hsalas@carnesselectas.pe');
        $me = $this->desde(self::DG, $token)->getJson('/api/v1/me')->assertOk();
        $this->assertSame('Carnes Selectas', $me->json('tenant.short'));
        $this->assertSame(['CS'], array_column($me->json('brands'), 'code'));
    }

    public function test_el_mismo_correo_en_dos_empresas_entra_a_la_de_su_contrasena(): void
    {
        $cs = TenantContext::resolveHost(self::CS);
        TenantContext::set($cs);
        $empleado = DB::table('employees')->value('id');
        DB::table('users')->insert(['employee_id' => $empleado, 'name' => 'Rosa en CS', 'email' => 'rquispe@donguando.pe',
            'role' => 'GERENTE', 'status' => 'ACTIVE', 'twofa_enabled' => false, 'password' => bcrypt('OtraEmpresa2026'), 'failed_logins' => 0]);
        TenantContext::set(null);

        $enCs = $this->ingresar(self::DG, 'rquispe@donguando.pe', 'OtraEmpresa2026');
        $this->assertSame('Carnes Selectas', $this->desde(self::DG, $enCs)->getJson('/api/v1/me')->json('tenant.short'));
        $enDg = $this->ingresar(self::DG, 'rquispe@donguando.pe');
        $this->assertSame('Don Guando', $this->desde(self::DG, $enDg)->getJson('/api/v1/me')->json('tenant.short'));
    }

    public function test_por_dominio_la_empresa_se_resuelve_por_el_dominio(): void
    {
        config(['aycha.tenant_por_dominio' => true]);
        $this->desde(self::DG)->getJson('/api/v1/tenant')->assertOk()
            ->assertJsonPath('short', 'Don Guando')->assertJsonCount(5, 'brands');
        $this->desde(self::CS)->getJson('/api/v1/tenant')->assertOk()->assertJsonPath('short', 'Carnes Selectas');
        $this->desde('nadie.localhost')->getJson('/api/v1/tenant')->assertNotFound()->assertJsonPath('code', 'TENANT_NOT_FOUND');
    }

    public function test_la_gerente_ingresa_y_ve_todo(): void
    {
        $token = $this->ingresar(self::DG, 'rquispe@donguando.pe');

        $me = $this->desde(self::DG, $token)->getJson('/api/v1/me')->assertOk()
            ->assertJsonPath('roles', ['GERENTE'])
            ->assertJsonCount(40, 'modules')
            ->assertJsonCount(5, 'brands')
            ->assertJsonCount(2, 'establishments');
        // Todos los permisos, menos los de los módulos apagados (TEL llega apagado, RN-PLT-07).
        $this->assertContains('plt.period.reopen', $me->json('permissions'));
        $this->assertNotContains('tel.call.make', $me->json('permissions'));
    }

    public function test_la_vendedora_solo_ve_sus_marcas_y_sus_modulos(): void
    {
        $token = $this->ingresar(self::DG, 'cnunez@donguando.pe');
        $me = $this->desde(self::DG, $token)->getJson('/api/v1/me')->assertOk();

        $this->assertEqualsCanonicalizing(['M2', 'M3'], array_column($me->json('brands'), 'code'));
        $mods = collect($me->json('modules'))->keyBy('code');
        $this->assertSame('CLE', $mods['PED']['actions']);
        $this->assertFalse($mods['TEL']['enabled'], 'TEL viene incluida y apagada');
        $this->assertFalse($mods->has('CNT'), 'la vendedora no ve Contabilidad');

        $user = User::where('email', 'cnunez@donguando.pe')->first();
        $this->assertTrue(Access::module($user, 'PED', 'C'));
        $this->assertFalse(Access::module($user, 'PED', 'A'));
        $this->assertFalse(Access::module($user, 'TEL', 'L'), 'RN-PLT-07: módulo apagado');
    }

    public function test_un_token_solo_da_acceso_a_su_empresa(): void
    {
        $token = $this->ingresar(self::DG, 'rquispe@donguando.pe');
        // En modo general la empresa sale del token: aunque el navegador diga otro dominio, ve DG.
        $this->assertSame('Don Guando', $this->desde(self::CS, $token)->getJson('/api/v1/me')->json('tenant.short'));
        // Un token inventado con el id de otro no sirve.
        $falso = strtok($token, '|').'|'.str_repeat('x', 40);
        $this->desde(self::DG, $falso)->getJson('/api/v1/me')->assertUnauthorized();
    }

    public function test_por_dominio_un_token_no_sirve_en_otra_empresa(): void
    {
        config(['aycha.tenant_por_dominio' => true]);
        $token = $this->ingresar(self::DG, 'rquispe@donguando.pe');

        $this->desde(self::CS, $token)->getJson('/api/v1/me')->assertUnauthorized();
        $this->desde(self::DG, $token)->getJson('/api/v1/me')->assertOk();
    }

    public function test_por_dominio_un_usuario_no_ingresa_por_el_dominio_de_otra_empresa(): void
    {
        config(['aycha.tenant_por_dominio' => true]);
        $this->desde(self::CS)->postJson('/api/v1/auth/login', ['email' => 'rquispe@donguando.pe', 'password' => self::CLAVE])
            ->assertUnprocessable();
    }

    public function test_contrasena_incorrecta_y_bloqueo(): void
    {
        $max = (int) DB::table('parameter_definitions')->where('key', 'seg_max_failed_logins')->value('default_value');
        for ($i = 1; $i <= $max; $i++) {
            $this->desde(self::DG)->postJson('/api/v1/auth/login', ['email' => 'ana.torres@donguando.pe', 'password' => 'mala'])
                ->assertUnprocessable();
        }
        $this->desde(self::DG)->postJson('/api/v1/auth/login', ['email' => 'ana.torres@donguando.pe', 'password' => self::CLAVE])
            ->assertUnprocessable()->assertJsonPath('errors.email.0', fn ($m) => str_contains($m, 'bloqueada'));
    }

    public function test_cerrar_sesion_invalida_el_token(): void
    {
        $token = $this->ingresar(self::DG, 'rquispe@donguando.pe');
        $this->desde(self::DG, $token)->postJson('/api/v1/auth/logout')->assertNoContent();
        $this->desde(self::DG, $token)->getJson('/api/v1/me')->assertUnauthorized();
    }

    public function test_rls_cada_empresa_solo_ve_y_escribe_lo_suyo(): void
    {
        $cs = TenantContext::resolveHost(self::CS);
        TenantContext::set($cs);
        $this->assertSame(['CS'], DB::table('brands')->pluck('code')->all());

        $dg = TenantContext::resolveHost(self::DG);
        $this->expectExceptionMessage('row-level security');
        DB::table('brands')->insert(['tenant_id' => $dg['id'], 'company_id' => DB::table('companies')->value('id'),
            'code' => 'X', 'name' => 'X', 'primary_color' => '#000000', 'status' => 'ACTIVE', 'sort_order' => 9]);
    }

    public function test_sin_empresa_no_se_ve_ninguna_fila(): void
    {
        TenantContext::set(null);
        $this->assertSame(0, DB::table('users')->count());
        $this->assertSame(0, DB::table('sales_orders')->count());
    }

    public function test_ninguna_tabla_con_tenant_queda_sin_rls(): void
    {
        $this->assertSame([], DB::connection('pgsql_owner')->select('SELECT * FROM rls_gaps'));
    }

    public function test_la_bitacora_registra_quien_cambio_que(): void
    {
        TenantContext::set(TenantContext::resolveHost(self::DG));
        $user = User::where('email', 'rquispe@donguando.pe')->first();
        TenantContext::setUser($user->id);

        DB::table('brands')->where('code', 'M2')->update(['name' => 'Cortes Don Guando']);

        $log = DB::table('audit.change_log')->where('table_name', 'brands')->where('action', 'U')->latest('id')->first();
        $this->assertSame($user->id, $log->changed_by);
        $this->assertSame('{name}', $log->changed_columns);
    }

    public function test_los_eventos_quedan_con_su_empresa_y_su_usuario(): void
    {
        $dg = TenantContext::resolveHost(self::DG);
        TenantContext::set($dg);
        $user = User::where('email', 'rquispe@donguando.pe')->first();
        TenantContext::setUser($user->id);

        Events::emit('order.confirmed', 'sales_orders', null, ['number' => 'P-000001']);
        $e = DB::table('domain_events')->latest('id')->first();
        $this->assertSame([$dg['id'], $user->id, 'P-000001'], [$e->tenant_id, $e->user_id, json_decode($e->payload)->number]);

        TenantContext::set(TenantContext::resolveHost(self::CS));
        $this->assertSame(0, DB::table('domain_events')->count(), 'CS no ve los eventos de DG');
    }
}
