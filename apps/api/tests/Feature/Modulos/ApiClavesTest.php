<?php

namespace Tests\Feature\Modulos;

use App\Support\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/** API-01 Claves, API-02 Crear clave, API-03 Detalle de clave y API-11 Eventos y alcances (RN-API-01 a 04, 10 y 17). */
class ApiClavesTest extends TestCase
{
    private const ADMIN = 'lccahuana@donguando.pe';

    private const GERENTE = 'rquispe@donguando.pe';

    private const AUDITOR = 'aexterno@donguando.pe';

    private const VENDEDORA = 'ana.torres@donguando.pe';

    private array $tokens = [];

    private function como(string $email): static
    {
        return $this->desde(self::DG, $this->tokens[$email] ??= $this->ingresar(self::DG, $email));
    }

    private function enEmpresa(callable $f): mixed
    {
        TenantContext::set(['id' => DB::table('tenants')->where('short', 'Don Guando')->value('id')]);
        TenantContext::setUser(DB::table('users')->where('email', self::ADMIN)->value('id'));
        try {
            return $f();
        } finally {
            TenantContext::set(null);
        }
    }

    private function base(array $extra = []): array
    {
        return $extra + ['name' => 'ERP El Cuy Dorado', 'description' => 'Crea pedidos y consulta precios', 'environment' => 'LIVE',
            'scopes' => ['orders:read', 'orders:write', 'prices:read'], 'expires_at' => '2027-03-01', 'allowed_ips' => ['181.65.70.12', '181.65.70.0/24']];
    }

    public function test_crear_clave_con_secreto_una_sola_vez_y_sus_reglas(): void
    {
        $this->travelTo(Carbon::parse('2026-11-25 10:00', 'America/Lima'));
        $marca = $this->enEmpresa(fn () => DB::table('brands')->where('name', 'Don Guando')->value('id'));
        $cliente = $this->enEmpresa(fn () => DB::table('customers')->where('doc_type', 'RUC')->where('status', '<>', 'INACTIVE')->whereNull('merged_into_id')->value('id'));

        // Quién: crear lo hace el administrador o la gerencia; el auditor solo ve; la vendedora ni ve.
        $this->como(self::AUDITOR)->postJson('/api/v1/api/claves', $this->base())->assertForbidden();
        $this->como(self::AUDITOR)->getJson('/api/v1/api/claves')->assertOk();
        $this->como(self::VENDEDORA)->getJson('/api/v1/api/claves')->assertForbidden();

        $f = $this->como(self::ADMIN)->getJson('/api/v1/api/claves/formulario')->assertOk();
        $this->assertSame([180, 365, '2027-05-24', '2026-11-25'], [$f->json('dias_defecto'), $f->json('dias_maximo'), $f->json('vence_defecto'), $f->json('hoy')]);
        $this->assertCount(11, $f->json('alcances'));

        // Validaciones: vencimiento (siempre, y máximo 365 días), alcances del catálogo, IP válidas, marcas de la empresa.
        $this->como(self::ADMIN)->postJson('/api/v1/api/claves', $this->base(['expires_at' => '2026-11-25']))->assertStatus(422)->assertJsonPath('code', 'RN-API-02');
        $this->como(self::ADMIN)->postJson('/api/v1/api/claves', $this->base(['expires_at' => '2027-12-01']))->assertStatus(422)->assertJsonPath('code', 'RN-API-02');
        $this->como(self::ADMIN)->postJson('/api/v1/api/claves', $this->base(['scopes' => ['orders:delete']]))->assertStatus(422)->assertJsonPath('code', 'RN-API-03');
        $this->como(self::ADMIN)->postJson('/api/v1/api/claves', $this->base(['allowed_ips' => ['300.1.1.1']]))->assertStatus(422)->assertJsonPath('code', 'RN-API-11');
        $this->como(self::ADMIN)->postJson('/api/v1/api/claves', $this->base(['brand_ids' => ['00000000-0000-4000-8000-000000000000']]))->assertStatus(422)->assertJsonPath('code', 'RN-API-11');
        $this->como(self::ADMIN)->postJson('/api/v1/api/claves', $this->base(['name' => 'ab']))->assertStatus(422);

        $r = $this->como(self::ADMIN)->postJson('/api/v1/api/claves', $this->base(['brand_ids' => [$marca], 'customer_id' => $cliente, 'channel' => 'B2B']))->assertCreated();
        $token = $r->json('token');
        $this->assertMatchesRegularExpression('/^ak_live_[a-z0-9]{8}_[A-Za-z0-9]{40}$/', $token);
        $prefijo = substr($token, 0, 16);
        $this->assertSame([$prefijo, 'ACTIVE', 'Activa', ['Don Guando'], true, 96], [$r->json('clave.prefix'), $r->json('clave.status'), $r->json('clave.estado'),
            $r->json('clave.marcas'), $r->json('clave.escritura'), $r->json('clave.dias')]);
        // La base guarda la huella, nunca el secreto; el detalle tampoco lo devuelve.
        $fila = $this->enEmpresa(fn () => DB::table('api_keys')->where('prefix', $prefijo)->first());
        $this->assertSame(hash('sha256', substr($token, 17)), $fila->secret_hash);
        $id = $r->json('clave.id');
        $d = $this->como(self::AUDITOR)->getJson("/api/v1/api/claves/{$id}")->assertOk();
        $this->assertStringNotContainsString(substr($token, 17), $d->getContent());
        $this->assertSame([false, 'Venta a empresas'], [$d->json('puede'), $d->json('canal')]);

        $t = $this->como(self::ADMIN)->postJson('/api/v1/api/claves', $this->base(['environment' => 'TEST', 'name' => 'Pruebas del ERP', 'scopes' => ['products:read']]))->assertCreated();
        $this->assertStringStartsWith('ak_test_', $t->json('token'));

        $l = $this->como(self::ADMIN)->getJson('/api/v1/api/claves')->assertOk();
        $this->assertSame([2, 2, 1, 1], [$l->json('total'), $l->json('cifras.activas'), $l->json('cifras.produccion'), $l->json('cifras.pruebas')]);
        $this->assertSame(1, $this->como(self::ADMIN)->getJson('/api/v1/api/claves?entorno=TEST')->json('total'));
        $this->assertSame(1, $this->como(self::ADMIN)->getJson('/api/v1/api/claves?escritura=1')->json('total'));
        $this->assertSame(1, $this->como(self::ADMIN)->getJson('/api/v1/api/claves?buscar='.$prefijo)->json('total'));
        $this->assertSame(1, $this->como(self::ADMIN)->getJson('/api/v1/api/claves?alcance=orders:write')->json('total'));
        $this->assertGreaterThanOrEqual(1, count($this->como(self::ADMIN)->getJson('/api/v1/api/claves/clientes?buscar=SAC')->json('data')) + 1);
    }

    public function test_editar_solo_lo_permitido_y_revocar_sin_vuelta(): void
    {
        $this->travelTo(Carbon::parse('2026-11-25 10:00', 'America/Lima'));
        $r = $this->como(self::GERENTE)->postJson('/api/v1/api/claves', $this->base())->assertCreated();
        $id = $r->json('clave.id');

        // Editar: nombre, IP y acortar el vencimiento; extenderlo no.
        $e = $this->como(self::GERENTE)->putJson("/api/v1/api/claves/{$id}", ['name' => 'ERP nuevo del restaurante', 'allowed_ips' => [], 'expires_at' => '2027-01-15'])->assertOk();
        $this->assertSame(['ERP nuevo del restaurante', [], '2027-01-15'], [$e->json('name'), $e->json('allowed_ips'), $e->json('expires_at')]);
        $this->como(self::GERENTE)->putJson("/api/v1/api/claves/{$id}", ['expires_at' => '2027-02-01'])->assertStatus(422)->assertJsonPath('code', 'RN-API-02');

        // Revocar: con motivo de 10 caracteres; no se reactiva ni se edita.
        $this->como(self::AUDITOR)->postJson("/api/v1/api/claves/{$id}/revocar", ['motivo' => 'Se compartió por correo'])->assertForbidden();
        $this->como(self::GERENTE)->postJson("/api/v1/api/claves/{$id}/revocar", ['motivo' => 'corto'])->assertStatus(422);
        $v = $this->como(self::GERENTE)->postJson("/api/v1/api/claves/{$id}/revocar", ['motivo' => 'El restaurante cambió de ERP y la clave se compartió por correo'])->assertOk();
        $this->assertSame(['REVOKED', 'Rosa Quispe Huamán'], [$v->json('status'), $v->json('revoco')]);
        $this->como(self::GERENTE)->postJson("/api/v1/api/claves/{$id}/revocar", ['motivo' => 'Otra vez la misma clave'])->assertStatus(422)->assertJsonPath('code', 'RN-API-10');
        $this->como(self::GERENTE)->putJson("/api/v1/api/claves/{$id}", ['name' => 'Revivir'])->assertStatus(422)->assertJsonPath('code', 'RN-API-10');
        $this->assertSame(1, $this->como(self::GERENTE)->getJson('/api/v1/api/claves?estado=REVOKED')->json('total'));

        // Vencida: pasado su día, figura vencida y no se edita.
        $o = $this->como(self::GERENTE)->postJson('/api/v1/api/claves', $this->base(['name' => 'Corta', 'expires_at' => '2026-11-30']))->assertCreated();
        $this->travelTo(Carbon::parse('2026-12-01 09:00', 'America/Lima'));
        $this->tokens = [];
        $this->assertSame('EXPIRED', $this->como(self::GERENTE)->getJson('/api/v1/api/claves/'.$o->json('clave.id'))->json('status'));
        $this->assertSame(1, $this->como(self::GERENTE)->getJson('/api/v1/api/claves?estado=EXPIRED')->json('total'));

        // La base: el secreto, el prefijo y los alcances no cambian, una revocada no vuelve, no se borran, el prefijo es único.
        $this->enEmpresa(function () use ($id, $o) {
            $otra = $o->json('clave.id');
            foreach ([
                fn () => DB::table('api_keys')->where('id', $otra)->update(['secret_hash' => str_repeat('a', 64)]),
                fn () => DB::table('api_keys')->where('id', $otra)->update(['scopes' => json_encode(['orders:read', 'customers:write'])]),
                fn () => DB::table('api_keys')->where('id', $otra)->update(['expires_at' => '2027-06-01']),
                fn () => DB::table('api_keys')->where('id', $id)->update(['status' => 'ACTIVE', 'revoked_at' => null, 'revoked_by' => null, 'revoke_reason' => null]),
                fn () => DB::table('api_keys')->where('id', $otra)->delete(),
                fn () => DB::table('api_keys')->insert(['name' => 'Copia', 'environment' => 'LIVE', 'prefix' => DB::table('api_keys')->where('id', $otra)->value('prefix'),
                    'secret_hash' => str_repeat('b', 64), 'scopes' => '["orders:read"]', 'channel' => 'WEB', 'expires_at' => '2027-01-01',
                    'created_by' => DB::table('users')->where('email', self::GERENTE)->value('id')]),
                fn () => DB::table('api_keys')->insert(['name' => 'Mala', 'environment' => 'LIVE', 'prefix' => 'ak_test_abcdefgh', 'secret_hash' => str_repeat('c', 64),
                    'scopes' => '["orders:read"]', 'channel' => 'WEB', 'expires_at' => '2027-01-01', 'created_by' => DB::table('users')->where('email', self::GERENTE)->value('id')]),
                fn () => DB::table('api_scopes')->insert(['code' => 'all:write', 'name' => 'Todo', 'module_code' => 'API', 'description' => 'x', 'is_write' => true, 'sort_order' => 99]),
            ] as $i => $mal) {
                try {
                    DB::transaction($mal);
                    $this->fail("La base debía rechazar el cambio {$i}");
                } catch (QueryException) {
                    $this->assertTrue(true);
                }
            }
        });
    }

    public function test_catalogo_de_eventos_y_alcances(): void
    {
        $c = $this->como(self::AUDITOR)->getJson('/api/v1/api/catalogo')->assertOk();
        $this->assertCount(12, $c->json('eventos'));
        $this->assertCount(11, $c->json('alcances'));
        $retirado = collect($c->json('eventos'))->firstWhere('code', 'order.updated');
        $this->assertSame(['RETIRED', 'Retirado', '2026-08-01'], [$retirado['status'], $retirado['estado'], $retirado['retired_at']]);
        $entregado = collect($c->json('eventos'))->firstWhere('code', 'order.delivered');
        $this->assertSame(['order.delivered', 'v1', 'DELIVERED'], [$entregado['ejemplo']['type'], $entregado['ejemplo']['version'], $entregado['ejemplo']['data']['status']]);
        $pedidos = collect($c->json('alcances'))->firstWhere('code', 'orders:write');
        $this->assertSame([true, 'Pedidos'], [$pedidos['is_write'], $pedidos['modulo']]);
        $this->assertContains('/api/v1/orders', array_column($pedidos['rutas'], 'ruta'));
        $this->assertSame(2, count($this->como(self::AUDITOR)->getJson('/api/v1/api/catalogo?modulo=FAC')->json('eventos')));
        $this->assertSame(1, count($this->como(self::AUDITOR)->getJson('/api/v1/api/catalogo?estado=RETIRED')->json('eventos')));
        $this->assertSame(1, count($this->como(self::AUDITOR)->getJson('/api/v1/api/catalogo?buscar=stock')->json('eventos')));
        $this->como(self::VENDEDORA)->getJson('/api/v1/api/catalogo')->assertForbidden();
    }
}
