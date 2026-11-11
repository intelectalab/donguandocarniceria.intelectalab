<?php

namespace Tests\Feature\Modulos;

use App\Support\TenantContext;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/** SEG-06 Mi cuenta: datos, preferencias y política al cambiar la contraseña, para cualquier persona. */
class SegMiCuentaTest extends TestCase
{
    private const VENDEDORA = 'ana.torres@donguando.pe';   // sin módulo SEG, alcance asignado

    private function como(string $email): static
    {
        return $this->desde(self::DG, $this->ingresar(self::DG, $email));
    }

    private function contexto(): void
    {
        $tenantId = DB::selectOne('SELECT auth_tenants_for_email(?) AS t', [self::VENDEDORA])->t;
        TenantContext::set(TenantContext::find($tenantId));
    }

    public function test_cualquier_persona_ve_su_cuenta(): void
    {
        $r = $this->como(self::VENDEDORA)->getJson('/api/v1/seg/mi-cuenta')->assertOk();
        $this->assertSame(self::VENDEDORA, $r->json('datos.email'));
        $this->assertNotSame('Todo', $r->json('datos.alcance'), 'La vendedora tiene alcance asignado');
        $this->assertStringNotContainsString('Local', $r->json('datos.alcance'), 'Sin locales asignados: no se listan');
        $this->assertSame('SYSTEM', $r->json('preferencias.ui_theme_mode'));
        $this->assertNotEmpty($r->json('marcas'));
        $this->assertSame(3, $r->json('seguridad.max_sesiones'));
    }

    public function test_preferencias_solo_con_una_de_sus_marcas_y_quedan_en_la_bitacora(): void
    {
        $this->contexto();
        $u = DB::table('users')->where('email', self::VENDEDORA)->first();
        $suya = DB::table('user_scopes')->where('user_id', $u->id)->whereNotNull('brand_id')->value('brand_id');
        $ajena = DB::table('brands')->where('status', 'ACTIVE')->whereNotIn('id', DB::table('user_scopes')->where('user_id', $u->id)->whereNotNull('brand_id')->pluck('brand_id'))->value('id');

        $api = $this->como(self::VENDEDORA);
        $api->putJson('/api/v1/seg/mi-cuenta/preferencias', ['default_brand_id' => $ajena])->assertUnprocessable()->assertJsonValidationErrors(['default_brand_id']);
        $api->putJson('/api/v1/seg/mi-cuenta/preferencias', ['ui_theme_mode' => 'OSCURO'])->assertUnprocessable();
        $r = $api->putJson('/api/v1/seg/mi-cuenta/preferencias', ['default_brand_id' => $suya, 'ui_theme_mode' => 'DARK', 'avisos_push' => true])->assertOk();
        $this->assertSame('DARK', $r->json('preferencias.ui_theme_mode'));
        $this->assertTrue($r->json('preferencias.avisos_push'));
        $this->assertSame($suya, $this->como(self::VENDEDORA)->getJson('/api/v1/me')->json('user.default_brand_id'));

        $this->contexto();
        $this->assertTrue(DB::table('access_log')->where('event', 'PROFILE_UPDATED')->where('user_id', $u->id)->exists());
    }

    public function test_probar_la_clave_y_el_cambio_queda_en_la_bitacora(): void
    {
        $api = $this->como(self::VENDEDORA);
        $checks = collect($api->postJson('/api/v1/seg/mi-cuenta/probar-clave', ['password' => 'Torres2026Lima'])->assertOk()->json('checks'))->pluck('ok', 'etiqueta');
        $this->assertFalse($checks['No contiene tu correo ni tu nombre']);

        $api->postJson('/api/v1/me/password', ['current_password' => self::CLAVE, 'password' => 'Carnes2026Segura', 'password_confirmation' => 'Carnes2026Segura'])->assertOk();
        $this->contexto();
        $this->assertTrue(DB::table('access_log')->where('event', 'PASSWORD_CHANGED')->exists());
    }
}
