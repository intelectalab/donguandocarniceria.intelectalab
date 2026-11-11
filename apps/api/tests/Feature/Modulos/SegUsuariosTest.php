<?php

namespace Tests\Feature\Modulos;

use App\Models\User;
use App\Support\TenantContext;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

/**
 * SEG-08 Usuarios y SEG-09 Ficha: CA-SEG-02 (bloqueo por intentos), CA-SEG-06 (correo duplicado),
 * CA-SEG-07 (último administrador), RN-SEG-01, 13, 15, 17, 18, 19 y 20.
 */
class SegUsuariosTest extends TestCase
{
    private const ADMIN = 'lccahuana@donguando.pe';   // ADMIN_SISTEMA

    private const GERENTE = 'rquispe@donguando.pe';

    private const VENDEDORA = 'ana.torres@donguando.pe';

    private const CAJERO = 'jsalas@donguando.pe';     // sin acceso a SEG

    private function como(string $email): static
    {
        return $this->desde(self::DG, $this->ingresar(self::DG, $email));
    }

    /** Fija la empresa en la conexión (como una petición) y devuelve el usuario. */
    private function usuario(string $email): User
    {
        $tenantId = DB::selectOne('SELECT auth_tenants_for_email(?) AS t', [$email])->t;
        TenantContext::set(TenantContext::find($tenantId));

        return User::whereRaw('lower(email) = ?', [$email])->firstOrFail();
    }

    private function rol(string $code): string
    {
        return DB::table('roles')->where('code', $code)->value('id');
    }

    private function nuevaVendedora(array $cambios = []): array
    {
        $marca = DB::table('brands')->where('status', 'ACTIVE')->orderBy('sort_order')->value('id');

        return $cambios + ['name' => 'Rosa Prueba Quispe', 'email' => 'Rosa.Prueba@donguando.pe', 'role_id' => $this->rol('VENDEDORA'), 'brand_ids' => [$marca]];
    }

    public function test_lista_resumen_y_filtros(): void
    {
        $api = $this->como(self::ADMIN);
        $r = $api->getJson('/api/v1/seg/usuarios/resumen')->assertOk();
        $this->assertSame($r->json('total'), $api->getJson('/api/v1/seg/usuarios?per_page=100')->assertOk()->json('total'));
        $this->assertSame($r->json('activos') + $r->json('bloqueados') + $r->json('inactivos') + $r->json('invitados'), $r->json('total'));
        $this->assertGreaterThan(0, $r->json('exigen_2fa'));

        $bloqueados = $api->getJson('/api/v1/seg/usuarios?status=LOCKED')->assertOk()->json();
        $this->assertSame($r->json('bloqueados'), $bloqueados['total']);
        $this->assertTrue(collect($bloqueados['data'])->every(fn ($u) => $u['estado'] === 'LOCKED'));

        $fila = collect($api->getJson('/api/v1/seg/usuarios?role=VENDEDORA&q=torres')->assertOk()->json('data'))->firstWhere('email', self::VENDEDORA);
        $this->assertNotNull($fila);
        $this->assertStringContainsString('VENDEDORA', $fila['roles_codes']);
        $this->assertNotEmpty($fila['scope_brands'], 'La vendedora tiene marcas asignadas');

        // Sin acceso al módulo SEG no se ve nada; el cajero tampoco crea usuarios.
        $this->como(self::CAJERO)->getJson('/api/v1/seg/usuarios')->assertForbidden();
        $this->como(self::CAJERO)->postJson('/api/v1/seg/usuarios', $this->nuevaVendedora())->assertForbidden();
    }

    public function test_crea_un_usuario_invitado_y_el_correo_es_unico_sin_distinguir_mayusculas(): void
    {
        Mail::fake();
        $api = $this->como(self::ADMIN);

        $r = $api->postJson('/api/v1/seg/usuarios', $this->nuevaVendedora())->assertCreated();
        $this->assertSame('rosa.prueba@donguando.pe', $r->json('email'), 'RN-SEG-01: se guarda en minúsculas');
        $this->assertSame('INVITED', $r->json('status'));
        $this->assertSame('Vendedora', $r->json('roles_names'));
        $this->assertNotEmpty($r->json('scope_brands'));
        $this->usuario(self::ADMIN);
        $this->assertSame(1, DB::table('password_reset_tokens')->where('user_id', $r->json('id'))->where('kind', 'INVITE')->whereNull('used_at')->count(), 'Se generó el código de la invitación');

        // CA-SEG-06: el mismo correo con otras mayúsculas se rechaza.
        $api->postJson('/api/v1/seg/usuarios', $this->nuevaVendedora(['email' => 'ANA.TORRES@donguando.pe']))
            ->assertUnprocessable()->assertJsonPath('code', 'RN-SEG-01');
        // RN-SEG-13: un rol de alcance asignado necesita local o marca.
        $api->postJson('/api/v1/seg/usuarios', $this->nuevaVendedora(['email' => 'otra@donguando.pe', 'brand_ids' => []]))
            ->assertUnprocessable()->assertJsonPath('code', 'RN-SEG-13');
        // El rol de la plataforma no se asigna desde la empresa.
        $api->postJson('/api/v1/seg/usuarios', $this->nuevaVendedora(['email' => 'otra@donguando.pe', 'role_id' => $this->rol('SOPORTE_PLATAFORMA')]))
            ->assertUnprocessable()->assertJsonPath('code', 'RN-SEG-12');
        // Validación de entrada.
        $api->postJson('/api/v1/seg/usuarios', $this->nuevaVendedora(['email' => 'no-es-correo']))->assertUnprocessable()->assertJsonValidationErrors(['email']);

        // La invitada no entra con contraseña (no tiene) y el mensaje le dice qué hacer.
        $this->desde(self::DG)->postJson('/api/v1/auth/login', ['email' => 'rosa.prueba@donguando.pe', 'password' => 'Cualquiera123'])
            ->assertUnprocessable();
    }

    public function test_el_invitado_fija_su_contrasena_con_el_codigo_y_queda_activo(): void
    {
        Mail::fake();
        $id = $this->como(self::ADMIN)->postJson('/api/v1/seg/usuarios', $this->nuevaVendedora())->assertCreated()->json('id');

        // El código viaja por correo: aquí se reemplaza por uno conocido.
        $this->usuario(self::ADMIN);
        DB::table('password_reset_tokens')->where('user_id', $id)->whereNull('used_at')->whereNull('voided_at')->update(['token_hash' => Hash::make('ABC234')]);

        $this->desde(self::DG)->postJson('/api/v1/auth/reset', ['email' => 'rosa.prueba@donguando.pe', 'code' => 'ABC234', 'password' => 'Carnes2026segura'])->assertOk();
        $this->usuario(self::ADMIN);
        $this->assertSame('ACTIVE', DB::table('users')->where('id', $id)->value('status'));
        $this->ingresar(self::DG, 'rosa.prueba@donguando.pe', 'Carnes2026segura');
    }

    public function test_cambiar_rol_y_alcance_rige_en_la_siguiente_peticion_y_queda_en_la_bitacora(): void
    {
        $u = $this->usuario(self::VENDEDORA);
        $local = DB::table('establishments')->where('status', 'ACTIVE')->orderBy('code')->value('id');
        $token = $this->ingresar(self::DG, self::VENDEDORA);
        $this->desde(self::DG, $token)->getJson('/api/v1/seg/usuarios')->assertForbidden();

        $this->como(self::ADMIN)->putJson("/api/v1/seg/usuarios/{$u->id}", ['role_id' => $this->rol('ADMIN_SISTEMA'), 'establishment_ids' => [$local]])
            ->assertOk()->assertJsonPath('roles_codes', 'ADMIN_SISTEMA');

        // RN-SEG-20: con el nuevo rol, su siguiente petición ya puede.
        $this->desde(self::DG, $token)->getJson('/api/v1/seg/usuarios')->assertOk();
        $log = $this->como(self::ADMIN)->getJson("/api/v1/seg/usuarios/{$u->id}/accesos")->assertOk()->json('data');
        $this->assertContains('USER_UPDATED', array_column($log, 'event'));
        $this->assertContains('LOGIN_OK', array_column($log, 'event'));
    }

    public function test_un_solo_rol_y_el_alcance_depende_del_rol(): void
    {
        Mail::fake();
        $api = $this->como(self::ADMIN);
        $marca = DB::table('brands')->where('status', 'ACTIVE')->orderBy('sort_order')->value('id');

        // Rol de alcance total: las marcas que vengan no se guardan y ve todo.
        $r = $api->postJson('/api/v1/seg/usuarios', $this->nuevaVendedora(['role_id' => $this->rol('MARKETING')]))->assertCreated();
        $this->assertSame('MARKETING', $r->json('roles_codes'));
        $this->assertNull($r->json('scope_brands'));
        $this->assertFalse($r->json('alcance_asignado'));

        // Varios roles ya no se aceptan: el campo es uno.
        $api->postJson('/api/v1/seg/usuarios', $this->nuevaVendedora(['email' => 'dos@donguando.pe', 'role_id' => [$this->rol('VENDEDORA'), $this->rol('MARKETING')]]))
            ->assertUnprocessable()->assertJsonValidationErrors(['role_id']);

        // Pasar a un rol de alcance asignado exige marca o local, y entonces sí se guardan.
        $api->putJson("/api/v1/seg/usuarios/{$r->json('id')}", ['role_id' => $this->rol('VENDEDORA')])->assertUnprocessable()->assertJsonPath('code', 'RN-SEG-13');
        $f = $api->putJson("/api/v1/seg/usuarios/{$r->json('id')}", ['role_id' => $this->rol('VENDEDORA'), 'brand_ids' => [$marca]])->assertOk();
        $this->assertSame('VENDEDORA', $f->json('roles_codes'));
        $this->assertNotNull($f->json('scope_brands'));
    }

    public function test_con_un_rol_de_alcance_total_ve_todo_aunque_queden_marcas_guardadas(): void
    {
        // Datos antiguos: Diana Flores tiene Vendedora y Compras (alcance total) con dos marcas guardadas.
        $u = $this->usuario('dflores@donguando.pe');
        $this->assertGreaterThan(0, DB::table('user_scopes')->where('user_id', $u->id)->count());
        $todas = DB::table('brands')->where('status', 'ACTIVE')->count();
        $me = $this->como('dflores@donguando.pe')->getJson('/api/v1/me')->assertOk();
        $this->assertCount($todas, $me->json('brands'), 'RN-SEG-13: con un rol de alcance total ve todas las marcas');
    }

    public function test_ca_seg_07_el_ultimo_administrador_no_se_desactiva_ni_pierde_el_rol(): void
    {
        $admin = $this->usuario(self::ADMIN);
        $api = $this->como(self::GERENTE);
        $api->postJson("/api/v1/seg/usuarios/{$admin->id}/desactivar", ['reason' => 'Prueba de regla'])->assertUnprocessable()->assertJsonPath('code', 'RN-SEG-15');
        $api->putJson("/api/v1/seg/usuarios/{$admin->id}", ['role_id' => $this->rol('VENDEDORA'), 'brand_ids' => [DB::table('brands')->value('id')]])
            ->assertUnprocessable()->assertJsonPath('code', 'RN-SEG-15');
        $api->postJson("/api/v1/seg/usuarios/{$admin->id}/bloquear", ['reason' => 'Prueba de regla'])->assertUnprocessable()->assertJsonPath('code', 'RN-SEG-15');
        // Nadie se desactiva a sí mismo.
        $gerente = $this->usuario(self::GERENTE);
        $api->postJson("/api/v1/seg/usuarios/{$gerente->id}/desactivar", ['reason' => 'Prueba de regla'])->assertUnprocessable()->assertJsonPath('code', 'RN-SEG-15');
    }

    public function test_desactivar_cierra_sesiones_y_revoca_celulares_y_reactivar_vuelve_a_invitar(): void
    {
        Mail::fake();
        $u = $this->usuario(self::VENDEDORA);
        $token = $this->ingresar(self::DG, self::VENDEDORA);
        $this->desde(self::DG, $token)->getJson('/api/v1/me')->assertOk();
        DB::table('user_devices')->insert(['user_id' => $u->id, 'fingerprint_hash' => 'fp-prueba', 'fingerprint_hint' => 'prueba', 'name' => 'Celular de prueba',
            'platform' => 'ANDROID', 'status' => 'APPROVED', 'requested_at' => now(), 'last_seen_at' => now()]);

        $api = $this->como(self::ADMIN);
        $api->postJson("/api/v1/seg/usuarios/{$u->id}/desactivar", ['reason' => 'x'])->assertUnprocessable()->assertJsonValidationErrors(['reason']);
        $r = $api->postJson("/api/v1/seg/usuarios/{$u->id}/desactivar", ['reason' => 'Dejó de trabajar en la empresa'])->assertOk();
        $this->assertSame('INACTIVE', $r->json('status'));
        $this->assertSame(0, $r->json('sesiones'));
        $this->assertSame('REVOKED', $r->json('devices.0.status'));

        // RN-SEG-18: su token ya no sirve; RN-SEG-17: no se borró.
        $this->desde(self::DG, $token)->getJson('/api/v1/me')->assertUnauthorized();
        $this->usuario(self::ADMIN);
        $this->assertNotNull(DB::table('users')->where('id', $u->id)->first());

        $r = $this->como(self::ADMIN)->postJson("/api/v1/seg/usuarios/{$u->id}/reactivar")->assertOk();
        $this->assertSame('INVITED', $r->json('status'));
        $this->usuario(self::ADMIN);
        $this->assertSame(1, DB::table('password_reset_tokens')->where('user_id', $u->id)->where('kind', 'INVITE')->whereNull('used_at')->whereNull('voided_at')->count());
    }

    public function test_bloquear_y_desbloquear_exigen_sus_permisos(): void
    {
        $u = $this->usuario(self::VENDEDORA);
        $token = $this->ingresar(self::DG, self::VENDEDORA);
        $api = $this->como(self::ADMIN);

        $r = $api->postJson("/api/v1/seg/usuarios/{$u->id}/bloquear", ['reason' => 'Revisión de accesos'])->assertOk();
        $this->assertSame('LOCKED', $r->json('estado'));
        $this->desde(self::DG, $token)->getJson('/api/v1/me')->assertUnauthorized();
        $this->desde(self::DG)->postJson('/api/v1/auth/login', ['email' => self::VENDEDORA, 'password' => self::CLAVE])->assertUnprocessable();

        // El gerente tiene todos los permisos; el cajero no.
        $this->como(self::CAJERO)->postJson("/api/v1/seg/usuarios/{$u->id}/desbloquear")->assertForbidden();
        $this->como(self::GERENTE)->postJson("/api/v1/seg/usuarios/{$u->id}/desbloquear")->assertOk()->assertJsonPath('estado', 'ACTIVE');
        $this->ingresar(self::DG, self::VENDEDORA);
    }

    public function test_ca_seg_02_cinco_intentos_fallidos_bloquean_quince_minutos_y_queda_en_la_bitacora(): void
    {
        $this->travelTo(Carbon::parse('2026-11-10 10:00', 'America/Lima'));
        $login = fn (string $clave) => $this->desde(self::DG)->postJson('/api/v1/auth/login', ['email' => self::VENDEDORA, 'password' => $clave]);
        for ($i = 0; $i < 5; $i++) {
            $login('mala-'.$i)->assertUnprocessable();
        }
        $u = $this->usuario(self::VENDEDORA);
        $this->assertSame('LOCKED', $u->status);
        $this->assertNotNull($u->locked_until);

        // El sexto intento, con la contraseña correcta, también se rechaza (RN-SEG-04).
        $this->assertStringContainsString('bloqueada', $login(self::CLAVE)->assertUnprocessable()->json('errors.email.0'));

        $log = $this->como(self::ADMIN)->getJson("/api/v1/seg/usuarios/{$u->id}/accesos?per_page=20")->assertOk()->json('data');
        $eventos = array_count_values(array_column($log, 'event'));
        $this->assertSame(5, $eventos['LOGIN_FAILED'] ?? 0);
        $this->assertSame(1, $eventos['LOCKED'] ?? 0);
        $this->assertSame(1, $eventos['LOGIN_BLOCKED'] ?? 0);
        $this->assertSame('LOCKED', $this->como(self::ADMIN)->getJson("/api/v1/seg/usuarios/{$u->id}")->json('estado'));

        // Vencido el plazo entra, con el contador en cero.
        $this->travelTo(Carbon::parse('2026-11-10 10:16', 'America/Lima'));
        $login(self::CLAVE)->assertOk();
        $u = $this->usuario(self::VENDEDORA);
        $this->assertSame('ACTIVE', $u->status);
        $this->assertSame(0, $u->failed_logins);
        $this->assertNull($u->locked_until);
    }

    public function test_la_sesion_guarda_ip_y_dispositivo_y_se_marca_la_actual(): void
    {
        $u = $this->usuario(self::ADMIN);
        $token = $this->ingresar(self::DG, self::ADMIN);
        $sesiones = $this->withHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/129.0 Safari/537.36')
            ->desde(self::DG, $token)->getJson("/api/v1/seg/usuarios/{$u->id}")->assertOk()->json('sessions');
        $actual = collect($sesiones)->firstWhere('actual', true);
        $this->assertNotNull($actual, 'Se marca la sesión con la que se mira la ficha');
        $this->assertNotEmpty($actual['ip']);
        $this->assertNotEmpty($actual['device']);
        $this->assertSame(1, collect($sesiones)->where('actual', true)->count());
    }

    public function test_cerrar_las_sesiones_propias_deja_abierta_la_actual(): void
    {
        $u = $this->usuario(self::GERENTE);
        $otra = $this->ingresar(self::DG, self::GERENTE);
        $actual = $this->ingresar(self::DG, self::GERENTE);

        $this->desde(self::DG, $actual)->deleteJson("/api/v1/seg/usuarios/{$u->id}/sesiones")->assertOk();
        $this->desde(self::DG, $actual)->getJson('/api/v1/me')->assertOk();
        $this->desde(self::DG, $otra)->getJson('/api/v1/me')->assertUnauthorized();

        // La actual tampoco se cierra pidiéndola sola.
        $id = collect($this->desde(self::DG, $actual)->getJson("/api/v1/seg/usuarios/{$u->id}")->json('sessions'))->firstWhere('actual', true)['id'];
        $this->desde(self::DG, $actual)->deleteJson("/api/v1/seg/usuarios/{$u->id}/sesiones/{$id}")->assertUnprocessable()->assertJsonPath('code', 'RN-SEG-09');
    }

    public function test_aprobar_y_revocar_dispositivos_y_revocar_cierra_sus_sesiones(): void
    {
        $repartidor = $this->usuario('pcondori@donguando.pe');
        $nuevo = DB::table('user_devices')->insertGetId(['user_id' => $repartidor->id, 'fingerprint_hash' => 'fp-prueba-1', 'fingerprint_hint' => 'prueba',
            'name' => 'Celular de prueba', 'platform' => 'ANDROID', 'status' => 'PENDING', 'requested_at' => now(), 'last_seen_at' => now()], 'id');
        $token = $this->ingresar(self::DG, 'pcondori@donguando.pe');
        $this->usuario(self::ADMIN);
        DB::table('personal_access_tokens')->where('tokenable_id', $repartidor->id)->update(['device_id' => $nuevo]);

        // Sin el permiso no se aprueba ni se revoca.
        $this->como(self::CAJERO)->postJson("/api/v1/seg/dispositivos/{$nuevo}/aprobar")->assertForbidden();

        $api = $this->como(self::ADMIN);
        $api->postJson("/api/v1/seg/dispositivos/{$nuevo}/aprobar")->assertOk()->assertJsonPath('status', 'APPROVED');
        $this->usuario(self::ADMIN);
        $this->assertTrue(DB::table('notifications')->where('user_id', $repartidor->id)->where('title', 'Celular aprobado')->exists(), 'Se avisa al dueño');
        $api->postJson("/api/v1/seg/dispositivos/{$nuevo}/aprobar")->assertUnprocessable()->assertJsonPath('code', 'RN-SEG-11');
        $api->postJson("/api/v1/seg/dispositivos/{$nuevo}/revocar", ['reason' => 'x'])->assertUnprocessable()->assertJsonValidationErrors(['reason']);

        // RN-SEG-11: revocar cierra al instante las sesiones abiertas desde ese dispositivo.
        $r = $api->postJson("/api/v1/seg/dispositivos/{$nuevo}/revocar", ['reason' => 'Celular perdido en ruta'])->assertOk();
        $this->assertSame('REVOKED', $r->json('device.status'));
        $this->assertSame(1, $r->json('sesiones_cerradas'));
        $this->desde(self::DG, $token)->getJson('/api/v1/me')->assertUnauthorized();
        $this->assertContains('DEVICE_REVOKED', array_column($this->como(self::ADMIN)->getJson("/api/v1/seg/usuarios/{$repartidor->id}/accesos")->json('data'), 'event'));
    }

    public function test_nadie_aprueba_su_propio_dispositivo(): void
    {
        $admin = $this->usuario(self::ADMIN);
        $propio = DB::table('user_devices')->insertGetId(['user_id' => $admin->id, 'fingerprint_hash' => 'fp-prueba-2', 'fingerprint_hint' => 'prueba',
            'name' => 'Celular del administrador', 'platform' => 'ANDROID', 'status' => 'PENDING', 'requested_at' => now(), 'last_seen_at' => now()], 'id');
        $this->como(self::ADMIN)->postJson("/api/v1/seg/dispositivos/{$propio}/aprobar")->assertUnprocessable()->assertJsonPath('code', 'RN-SEG-16');
        $this->como(self::GERENTE)->postJson("/api/v1/seg/dispositivos/{$propio}/aprobar")->assertOk();
    }

    public function test_cerrar_sesiones_de_otro_exige_permiso(): void
    {
        $u = $this->usuario(self::VENDEDORA);
        $token = $this->ingresar(self::DG, self::VENDEDORA);
        $this->como(self::CAJERO)->deleteJson("/api/v1/seg/usuarios/{$u->id}/sesiones")->assertForbidden();
        $r = $this->como(self::GERENTE)->deleteJson("/api/v1/seg/usuarios/{$u->id}/sesiones")->assertOk();
        $this->assertGreaterThanOrEqual(1, $r->json('cerradas'));
        $this->desde(self::DG, $token)->getJson('/api/v1/me')->assertUnauthorized();
    }
}
