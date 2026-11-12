<?php

namespace Tests\Feature\Modulos;

use App\Support\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * SEG-14 Política de contraseñas y sesiones, SEG-15 Sesiones de la empresa y SEG-07 Mis sesiones:
 * RN-SEG-02 (correo, nombre y contraseñas comunes), RN-SEG-09 (inactividad y duración) y RN-SEG-10
 * (máximo de sesiones simultáneas).
 */
class SegSesionesTest extends TestCase
{
    private const ADMIN = 'lccahuana@donguando.pe';

    private const GERENTE = 'rquispe@donguando.pe';    // Rosa Quispe Huamán

    private const VENDEDORA = 'ana.torres@donguando.pe';   // sin acceso al módulo SEG

    private const CAJERO = 'jsalas@donguando.pe';

    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo(Carbon::parse('2026-11-10 09:00', 'America/Lima'));
    }

    private function como(string $email): static
    {
        return $this->desde(self::DG, $this->ingresar(self::DG, $email));
    }

    private function contexto(): void
    {
        $tenantId = DB::selectOne('SELECT auth_tenants_for_email(?) AS t', [self::ADMIN])->t;
        TenantContext::set(TenantContext::find($tenantId));
    }

    public function test_politica_con_sus_parametros_y_cifras_del_mes(): void
    {
        $r = $this->como(self::ADMIN)->getJson('/api/v1/seg/politica')->assertOk();
        $claves = collect($r->json('parametros'))->keyBy('key');
        $this->assertSame('10', $claves['seg_password_min_length']['value']);
        $this->assertArrayHasKey('seg_max_concurrent_sessions', $claves->all());
        $this->assertArrayHasKey('tasa_fallidos', $r->json('mes'));
        $this->como(self::CAJERO)->getJson('/api/v1/seg/politica')->assertForbidden();
    }

    public function test_historial_de_la_politica_paginado(): void
    {
        $api = $this->como(self::ADMIN);
        foreach ([45, 50, 55] as $v) {
            $api->putJson('/api/v1/plt/parametros/seg_session_idle_minutes', ['value' => $v, 'reason' => "Prueba de historial {$v}"])->assertOk();
        }
        $r = $api->getJson('/api/v1/seg/politica/historial?per_page=2&sort=key')->assertOk();
        $this->assertSame(2, $r->json('per_page'));
        $this->assertGreaterThanOrEqual(3, $r->json('total'));
        $claves = array_column($api->getJson('/api/v1/seg/politica/historial?per_page=100&sort=key')->json('data'), 'key');
        $ordenadas = $claves;
        sort($ordenadas);
        $this->assertSame($ordenadas, $claves, 'Ordena por clave sin error de columna ambigua');
        $filtrado = $api->getJson('/api/v1/seg/politica/historial?q=historial%2050')->assertOk()->json('data');
        $this->assertSame(['50'], array_column($filtrado, 'new_value'));
    }

    public function test_probar_la_politica_rn_seg_02(): void
    {
        $api = $this->como(self::GERENTE);
        $ok = fn (string $clave) => collect($api->postJson('/api/v1/seg/politica/probar', ['password' => $clave])->assertOk()->json('checks'))->pluck('ok', 'etiqueta');

        $this->assertNotContains(false, $ok('Carnes2026Segura')->all(), 'Una contraseña buena cumple todo');
        $this->assertFalse($ok('Quispe2026Tienda')['No contiene tu correo ni tu nombre'], 'Contiene el apellido');
        $this->assertFalse($ok('RQUISPE2026x')['No contiene tu correo ni tu nombre'], 'Contiene el correo');
        $this->assertFalse($ok('Password123')['No es una contraseña común']);
        $this->assertFalse($ok('corta1A')['Al menos 10 caracteres']);
    }

    public function test_la_politica_rige_al_cambiar_la_contrasena(): void
    {
        $this->como(self::GERENTE)->postJson('/api/v1/me/password', ['current_password' => self::CLAVE, 'password' => 'RosaQuispe2026', 'password_confirmation' => 'RosaQuispe2026'])
            ->assertUnprocessable();
    }

    public function test_rn_seg_09_la_sesion_web_vence_por_inactividad_y_dura_como_maximo_12_horas(): void
    {
        $r = $this->desde(self::DG)->postJson('/api/v1/auth/login', ['email' => self::GERENTE, 'password' => self::CLAVE, 'remember' => true])->assertOk();
        $this->assertEqualsWithDelta(12 * 3600, now()->diffInSeconds(Carbon::parse($r->json('expires_at'))), 5, 'También con Recordarme dura 12 horas');
        $token = $r->json('token');

        // Usada a los 29 minutos sigue viva; sin uso por más de 30 minutos vence.
        $this->travel(29)->minutes();
        $this->desde(self::DG, $token)->getJson('/api/v1/me')->assertOk();
        $this->travel(31)->minutes();
        $this->desde(self::DG, $token)->getJson('/api/v1/me')->assertUnauthorized();

        $this->contexto();
        $this->assertTrue(DB::table('access_log')->where('event', 'SESSION_EXPIRED')->exists());
    }

    public function test_rn_seg_10_al_abrir_una_cuarta_sesion_se_cierra_la_de_uso_mas_antiguo(): void
    {
        $tokens = [];
        for ($i = 0; $i < 4; $i++) {
            $this->travel(1)->minutes();
            $tokens[] = $this->ingresar(self::DG, self::VENDEDORA);
        }
        $this->desde(self::DG, $tokens[0])->getJson('/api/v1/me')->assertUnauthorized();
        foreach (array_slice($tokens, 1) as $t) {
            $this->desde(self::DG, $t)->getJson('/api/v1/me')->assertOk();
        }
    }

    public function test_seg_15_sesiones_de_la_empresa_con_permisos(): void
    {
        $tokenVendedora = $this->ingresar(self::DG, self::VENDEDORA);
        $api = $this->como(self::ADMIN);
        $r = $api->getJson('/api/v1/seg/sesiones?per_page=100')->assertOk();
        $fila = collect($r->json('data'))->firstWhere('email', self::VENDEDORA);
        $this->assertNotNull($fila);
        $this->assertSame('web', $fila['client']);
        $this->assertSame(3, $r->json('politica.max_sesiones'));
        $this->assertGreaterThanOrEqual(2, $r->json('resumen.usuarios'));
        $this->assertSame(1, $fila['sesiones_usuario']);
        $porRol = collect($api->getJson('/api/v1/seg/sesiones?per_page=100&role=VENDEDORA')->assertOk()->json('data'));
        $this->assertSame([self::VENDEDORA], $porRol->pluck('email')->unique()->values()->all(), 'El filtro por rol deja solo a la vendedora');

        // Cerrar la sesión de otra persona; la propia actual no.
        $this->como(self::CAJERO)->deleteJson("/api/v1/seg/sesiones/{$fila['id']}")->assertForbidden();
        $this->como(self::ADMIN)->deleteJson("/api/v1/seg/sesiones/{$fila['id']}")->assertOk();
        $this->desde(self::DG, $tokenVendedora)->getJson('/api/v1/me')->assertUnauthorized();
        // Con la misma sesión: la que está usando no se cierra desde aquí.
        $admin = $this->como(self::ADMIN);
        $propia = collect($admin->getJson('/api/v1/seg/sesiones?per_page=100')->json('data'))->firstWhere('actual', true);
        $admin->deleteJson("/api/v1/seg/sesiones/{$propia['id']}")->assertUnprocessable()->assertJsonPath('code', 'RN-SEG-09');

        $this->como(self::CAJERO)->getJson('/api/v1/seg/sesiones')->assertForbidden();
    }

    public function test_una_sesion_inactiva_no_se_lista_ni_cuenta(): void
    {
        $this->ingresar(self::DG, self::VENDEDORA);
        $this->travel(31)->minutes();
        $r = $this->como(self::ADMIN)->getJson('/api/v1/seg/sesiones?per_page=100')->assertOk();
        $this->assertNull(collect($r->json('data'))->firstWhere('email', self::VENDEDORA), 'Venció por inactividad: ya no está abierta');
        $this->contexto();
        $id = DB::table('users')->where('email', self::VENDEDORA)->value('id');
        $this->assertSame(0, $this->como(self::ADMIN)->getJson("/api/v1/seg/usuarios/{$id}")->json('sesiones'));
    }

    public function test_las_sesiones_cerradas_y_vencidas_quedan_como_anteriores_con_su_motivo(): void
    {
        // Una sesión que se cierra con «Salir» y otra que vence por inactividad.
        $salir = $this->ingresar(self::DG, self::VENDEDORA);
        $this->desde(self::DG, $salir)->postJson('/api/v1/auth/logout')->assertNoContent();
        $vence = $this->ingresar(self::DG, self::VENDEDORA);
        $this->travel(31)->minutes();
        $this->desde(self::DG, $vence)->getJson('/api/v1/me')->assertUnauthorized();

        $r = $this->como(self::VENDEDORA)->getJson('/api/v1/seg/mis-sesiones')->assertOk();
        $anteriores = collect($r->json('anteriores'));
        $this->assertCount(1, $r->json('sesiones'), 'Solo la actual sigue abierta');
        $this->assertNotNull($anteriores->first(fn ($s) => $s['estado'] === 'REVOKED' && $s['motivo'] === 'Cierre de sesión'));
        $this->assertNotNull($anteriores->first(fn ($s) => $s['estado'] === 'EXPIRED' && $s['motivo'] === 'Venció por inactividad'));

        // El archivo es de solo inserción para la app.
        $this->contexto();
        $this->expectException(QueryException::class);
        DB::table('user_sessions')->update(['revoke_reason' => 'cambiado']);
    }

    public function test_la_limpieza_cierra_las_vencidas_que_nadie_volvio_a_usar_con_la_hora_en_que_vencieron(): void
    {
        $inicio = now()->copy();
        $olvidada = $this->ingresar(self::DG, self::VENDEDORA);    // cierra el navegador y no vuelve
        $this->travel(2)->hours();
        $viva = $this->ingresar(self::DG, self::VENDEDORA);

        $this->artisan('seg:vencer-sesiones')->assertSuccessful();

        $this->contexto();
        $u = DB::table('users')->where('email', self::VENDEDORA)->first();
        $this->assertSame(1, DB::table('personal_access_tokens')->where('tokenable_id', $u->id)->count(), 'Solo queda la vigente');
        $archivada = DB::table('user_sessions')->where('user_id', $u->id)->where('status', 'EXPIRED')->first();
        $this->assertSame('Venció por inactividad', $archivada->revoke_reason);
        $vencio = $inicio->copy()->addMinutes(30);
        $this->assertEqualsWithDelta($vencio->timestamp, Carbon::parse($archivada->revoked_at)->timestamp, 5, 'Con la hora en que venció, no la de la limpieza');
        $log = DB::table('access_log')->where('event', 'SESSION_EXPIRED')->where('user_id', $u->id)->first();
        $this->assertNotNull($log);
        $this->assertEqualsWithDelta($vencio->timestamp, Carbon::parse($log->occurred_at)->timestamp, 5);

        $this->desde(self::DG, $viva)->getJson('/api/v1/me')->assertOk();
        $this->desde(self::DG, $olvidada)->getJson('/api/v1/me')->assertUnauthorized();
        $this->artisan('seg:vencer-sesiones')->assertSuccessful();
        $this->contexto();
        $this->assertSame(1, DB::table('user_sessions')->where('user_id', $u->id)->where('status', 'EXPIRED')->count(), 'Pasar otra vez no duplica');
    }

    public function test_seg_07_cada_persona_ve_y_cierra_sus_sesiones(): void
    {
        $otra = $this->ingresar(self::DG, self::VENDEDORA);
        $this->travel(1)->minutes();
        $actual = $this->ingresar(self::DG, self::VENDEDORA);

        // La vendedora no tiene el módulo de Seguridad, pero sus sesiones sí las ve.
        $r = $this->desde(self::DG, $actual)->getJson('/api/v1/seg/mis-sesiones')->assertOk();
        $this->assertCount(2, $r->json('sesiones'));
        $this->assertTrue(collect($r->json('sesiones'))->firstWhere('actual', true) !== null);
        $id = collect($r->json('sesiones'))->firstWhere('actual', true)['id'];
        $this->desde(self::DG, $actual)->deleteJson("/api/v1/seg/mis-sesiones/{$id}")->assertUnprocessable();

        $this->desde(self::DG, $actual)->deleteJson('/api/v1/seg/mis-sesiones')->assertOk()->assertJsonPath('cerradas', 1);
        $this->desde(self::DG, $otra)->getJson('/api/v1/me')->assertUnauthorized();
        $this->desde(self::DG, $actual)->getJson('/api/v1/me')->assertOk();
    }
}
