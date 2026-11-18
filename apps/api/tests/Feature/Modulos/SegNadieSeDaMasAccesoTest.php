<?php

namespace Tests\Feature\Modulos;

use App\Support\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * Nadie se da más acceso a sí mismo (RN-SEG-16): ni su rol, ni su alcance, ni los permisos de su rol,
 * ni su segundo factor. El rol Gerente solo lo da o lo quita la gerencia. Los fallos al cambiar la
 * contraseña cuentan para el bloqueo (RN-SEG-04) y la base solo acepta correos en minúsculas (RN-SEG-01).
 */
class SegNadieSeDaMasAccesoTest extends TestCase
{
    private const ADMIN = 'lccahuana@donguando.pe';   // ADMIN_SISTEMA

    private const GERENTE = 'rquispe@donguando.pe';

    private const VENDEDORA = 'ana.torres@donguando.pe';

    private function como(string $email): static
    {
        return $this->desde(self::DG, $this->ingresar(self::DG, $email));
    }

    private function contexto(): void
    {
        $tenantId = DB::selectOne('SELECT auth_tenants_for_email(?) AS t', [self::ADMIN])->t;
        TenantContext::set(TenantContext::find($tenantId));
    }

    private function id(string $email): string
    {
        $this->contexto();

        return DB::table('users')->where('email', $email)->value('id');
    }

    private function rol(string $code): string
    {
        $this->contexto();

        return DB::table('roles')->where('code', $code)->value('id');
    }

    public function test_nadie_cambia_su_propio_rol_ni_su_alcance_pero_si_su_nombre(): void
    {
        $admin = $this->id(self::ADMIN);
        $api = $this->como(self::ADMIN);
        $api->putJson("/api/v1/seg/usuarios/{$admin}", ['role_id' => $this->rol('GERENTE')])->assertUnprocessable()->assertJsonPath('code', 'RN-SEG-16');
        $api->putJson("/api/v1/seg/usuarios/{$admin}", ['role_id' => $this->rol('AUDITOR')])->assertUnprocessable()->assertJsonPath('code', 'RN-SEG-16');
        $api->putJson("/api/v1/seg/usuarios/{$admin}", ['role_id' => $this->rol('ADMIN_SISTEMA'), 'name' => 'Luis Ccahuana Prueba'])->assertOk();
        $this->contexto();
        $this->assertSame('Luis Ccahuana Prueba', DB::table('users')->where('id', $admin)->value('name'));
    }

    public function test_el_rol_gerente_solo_lo_da_o_lo_quita_la_gerencia(): void
    {
        $vendedora = $this->id(self::VENDEDORA);
        $gerente = $this->id(self::GERENTE);
        $marca = DB::table('brands')->where('status', 'ACTIVE')->orderBy('sort_order')->value('id');
        $admin = $this->como(self::ADMIN);

        $admin->putJson("/api/v1/seg/usuarios/{$vendedora}", ['role_id' => $this->rol('GERENTE')])->assertUnprocessable()->assertJsonPath('code', 'RN-SEG-16');
        $admin->putJson("/api/v1/seg/usuarios/{$gerente}", ['role_id' => $this->rol('AUDITOR')])->assertUnprocessable()->assertJsonPath('code', 'RN-SEG-16');
        $admin->postJson('/api/v1/seg/usuarios', ['name' => 'Gerente Nueva Prueba', 'email' => 'gerente.nueva@donguando.pe', 'role_id' => $this->rol('GERENTE')])
            ->assertUnprocessable()->assertJsonPath('code', 'RN-SEG-16');
        // Otros roles sí los asigna el administrador.
        $admin->putJson("/api/v1/seg/usuarios/{$vendedora}", ['role_id' => $this->rol('CAJERO'), 'brand_ids' => [$marca]])->assertOk();

        // La gerencia sí.
        $this->como(self::GERENTE)->putJson("/api/v1/seg/usuarios/{$vendedora}", ['role_id' => $this->rol('GERENTE')])->assertOk();
    }

    public function test_nadie_cambia_los_permisos_de_su_propio_rol(): void
    {
        $propio = $this->rol('ADMIN_SISTEMA');
        $api = $this->como(self::ADMIN);
        $api->putJson("/api/v1/seg/roles/{$propio}/permisos", ['permission_code' => 'plt.period.close', 'granted' => true])
            ->assertUnprocessable()->assertJsonPath('code', 'RN-SEG-16');
        $api->putJson("/api/v1/seg/roles/{$propio}/acceso", ['module_code' => 'CAJ', 'actions' => 'CLEA'])
            ->assertUnprocessable()->assertJsonPath('code', 'RN-SEG-16');
        // El de otro rol, sí.
        $api->putJson('/api/v1/seg/roles/'.$this->rol('AUDITOR').'/acceso', ['module_code' => 'CAJ', 'actions' => 'L'])->assertOk();
    }

    public function test_nadie_reinicia_su_propio_segundo_factor(): void
    {
        $admin = $this->id(self::ADMIN);
        DB::table('users')->where('id', $admin)->update(['twofa_enabled' => true, 'mfa_enrolled_at' => now()]);
        $this->como(self::ADMIN)->postJson("/api/v1/seg/usuarios/{$admin}/reiniciar-2fa")->assertUnprocessable()->assertJsonPath('code', 'RN-SEG-16');
    }

    public function test_fallar_la_contrasena_actual_al_cambiarla_cuenta_para_el_bloqueo(): void
    {
        $this->travelTo(Carbon::parse('2026-11-10 10:00', 'America/Lima'));
        $token = $this->ingresar(self::DG, self::VENDEDORA);
        $cambiar = fn () => $this->desde(self::DG, $token)->postJson('/api/v1/me/password', ['current_password' => 'mala-clave', 'password' => 'Carnes2026Segura']);
        for ($i = 0; $i < 4; $i++) {
            $this->assertSame('La contraseña actual no es correcta.', $cambiar()->assertUnprocessable()->json('errors.current_password.0'));
        }
        // El quinto fallo bloquea la cuenta y cierra sus sesiones, también esta.
        $this->assertStringContainsString('bloqueada', $cambiar()->assertUnprocessable()->json('errors.current_password.0'));
        $this->desde(self::DG, $token)->getJson('/api/v1/me')->assertUnauthorized();
        $this->desde(self::DG)->postJson('/api/v1/auth/login', ['email' => self::VENDEDORA, 'password' => self::CLAVE])->assertUnprocessable();
        $this->contexto();
        $this->assertTrue(DB::table('access_log')->where('event', 'LOCKED')->where('user_id', $this->id(self::VENDEDORA))->exists());
    }

    public function test_la_base_solo_acepta_correos_en_minusculas(): void
    {
        $this->contexto();
        $this->expectException(QueryException::class);
        DB::table('users')->where('id', $this->id(self::VENDEDORA))->update(['email' => 'Ana.Torres@donguando.pe']);
    }
}
