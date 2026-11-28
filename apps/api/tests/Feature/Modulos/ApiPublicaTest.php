<?php

namespace Tests\Feature\Modulos;

use App\Support\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/** API pública v1 (/api/publica/v1) y su uso (API-10; RN-API-02, 03, 09, 10, 11, 13, 15 y 16). */
class ApiPublicaTest extends TestCase
{
    private const ADMIN = 'lccahuana@donguando.pe';

    private const GERENTE = 'rquispe@donguando.pe';

    private const AUDITOR = 'aexterno@donguando.pe';

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

    /** Llamada a la API pública con una clave (sin la sesión de la app). */
    private function api(string $token, string $metodo, string $ruta, array $cuerpo = [], array $cabeceras = [], string $ip = '127.0.0.1')
    {
        $this->app['auth']->forgetGuards();
        $this->flushHeaders();
        $h = ['Accept' => 'application/json'] + ($token !== '' ? ['Authorization' => "Bearer {$token}"] : []) + $cabeceras;

        return $this->withServerVariables(['REMOTE_ADDR' => $ip])->withHeaders($h)->json($metodo, '/api/publica/v1'.$ruta, $cuerpo);
    }

    private function clave(array $extra = []): array
    {
        $r = $this->como(self::GERENTE)->postJson('/api/v1/api/claves', $extra + ['name' => 'ERP de pruebas', 'environment' => 'LIVE',
            'scopes' => ['orders:read', 'orders:write', 'products:read', 'prices:read', 'stock:read', 'customers:read', 'customers:write', 'documents:read', 'payments:read', 'deliveries:read'],
            'expires_at' => Carbon::now('America/Lima')->addDays(90)->toDateString()])->assertCreated();

        return [$r->json('token'), $r->json('clave.id')];
    }

    public function test_autenticacion_alcances_y_lecturas(): void
    {
        $this->travelTo(Carbon::parse('2026-11-25 10:00', 'America/Lima'));
        $dg = $this->enEmpresa(fn () => DB::table('brands')->where('name', 'Don Guando')->value('id'));
        [$tk, $id] = $this->clave(['brand_ids' => [$dg]]);
        [$soloStock] = $this->clave(['name' => 'Tienda', 'scopes' => ['stock:read']]);
        [$prueba] = $this->clave(['name' => 'Pruebas', 'environment' => 'TEST', 'scopes' => ['orders:read']]);
        [$conIp] = $this->clave(['name' => 'Con IP', 'scopes' => ['orders:read'], 'allowed_ips' => ['181.65.70.0/24']]);

        // Sin clave, con formato malo, inexistente o con otro secreto: 401.
        $this->api('', 'GET', '/orders')->assertStatus(401)->assertJsonPath('code', 'RN-API-11');
        $this->api('hola', 'GET', '/orders')->assertStatus(401);
        $this->api('ak_live_zzzzzzzz_'.str_repeat('A', 40), 'GET', '/orders')->assertStatus(401)->assertJsonPath('code', 'RN-API-11');
        $this->api(substr($tk, 0, 17).str_repeat('B', 40), 'GET', '/orders')->assertStatus(401)->assertJsonPath('message', 'El secreto no corresponde a la clave.');
        // Pruebas: opera en el sandbox emparejado, nunca lee producción (RN-API-16).
        $this->api($prueba, 'GET', '/orders')->assertOk()->assertJsonPath('sandbox', true);
        $this->api($conIp, 'GET', '/orders')->assertStatus(403)->assertJsonPath('code', 'RN-API-11');
        $this->api($conIp, 'GET', '/orders', ip: '181.65.70.44')->assertOk();
        $this->api($soloStock, 'GET', '/orders')->assertStatus(403)->assertJsonPath('code', 'RN-API-03');
        // Versión o ruta que no existe.
        $this->api($tk, 'GET', '/nada')->assertStatus(404)->assertJsonPath('code', 'RN-API-15');
        $this->withHeaders(['Authorization' => "Bearer {$tk}"])->getJson('/api/publica/v2/orders')->assertStatus(404)->assertJsonPath('code', 'RN-API-15');

        // Lecturas: solo de las marcas de la clave, con cabeceras propias.
        $p = $this->api($tk, 'GET', '/orders?limit=100')->assertOk()->assertHeader('GestionCarnica-Api-Version', 'v1');
        $this->assertNotEmpty($p->json('data'));
        $this->assertTrue(collect($p->json('data'))->every(fn ($o) => $o['brand'] === $p->json('data.0.brand')));
        $this->assertNotEmpty($p->headers->get('X-Request-Id'));
        $n = $p->json('data.0.number');
        $this->api($tk, 'GET', "/orders/{$n}")->assertOk()->assertJsonPath('number', $n);
        $this->api($tk, 'GET', '/orders/P-999999')->assertNotFound()->assertJsonPath('code', 'RN-API-15');
        $prod = $this->api($tk, 'GET', '/products?limit=5')->assertOk();
        $this->assertCount(5, $prod->json('data'));
        $sku = $prod->json('data.0.sku');
        $this->assertSame($sku, $this->api($tk, 'GET', "/prices?sku={$sku}")->assertOk()->json('data.0.sku'));
        $this->assertArrayHasKey('available_qty', $this->api($tk, 'GET', "/stock?sku={$sku}")->assertOk()->json('data.0'));
        $this->assertNotEmpty($this->api($tk, 'GET', '/customers?limit=3')->assertOk()->json('data'));
        $this->api($tk, 'GET', '/documents')->assertOk();
        $this->api($tk, 'GET', '/payments')->assertOk();
        $this->assertSame('2026-11-25', $this->api($tk, 'GET', '/deliveries')->assertOk()->json('date'));

        // Revocada o vencida: 401 con su código.
        $this->como(self::GERENTE)->postJson("/api/v1/api/claves/{$id}/revocar", ['motivo' => 'Se terminó la prueba del ERP'])->assertOk();
        $this->api($tk, 'GET', '/orders')->assertStatus(401)->assertJsonPath('code', 'RN-API-10');
        $this->travelTo(Carbon::parse('2027-03-01 10:00', 'America/Lima'));
        $this->api($soloStock, 'GET', '/stock')->assertStatus(401)->assertJsonPath('code', 'RN-API-02');
    }

    public function test_limites_por_minuto_y_por_dia_y_uso_registrado(): void
    {
        $this->travelTo(Carbon::parse('2026-11-25 10:00', 'America/Lima'));
        [$tk, $id] = $this->clave(['scopes' => ['stock:read']]);
        $this->como(self::ADMIN)->putJson('/api/v1/plt/parametros/api_rate_limit_per_minute', ['value' => 3, 'reason' => 'Prueba del límite por minuto'])->assertOk();
        foreach (range(1, 3) as $i) {
            $this->api($tk, 'GET', '/stock?limit=1')->assertOk();
        }
        $r = $this->api($tk, 'GET', '/stock?limit=1')->assertStatus(429)->assertJsonPath('code', 'RN-API-09');
        $this->assertNotNull($r->headers->get('Retry-After'));
        $this->api($tk, 'GET', '/orders')->assertStatus(429, 'La ráfaga cuenta toda la clave, también lo que no tiene permitido');

        // Límite del día: las rechazadas no consumen.
        $this->travel(2)->minutes();
        $this->como(self::ADMIN)->putJson('/api/v1/plt/parametros/api_rate_limit_per_minute', ['value' => 100, 'reason' => 'Volver al valor normal'])->assertOk();
        // Hasta aquí hubo 3 aceptadas (las 2 rechazadas no consumen): con límite 4 pasa una más, con 3 ya no.
        $this->como(self::ADMIN)->putJson('/api/v1/plt/parametros/api_calls_per_day', ['value' => 3, 'reason' => 'Prueba del límite diario'])->assertOk();
        $this->api($tk, 'GET', '/stock?limit=1')->assertStatus(429)->assertJsonPath('message', 'Llegaste al límite de 3 llamadas del día de tu empresa.');

        $u = $this->enEmpresa(fn () => DB::table('api_usage_daily')->where('key_id', $id)->first());
        $this->assertSame([6, 3, 3, 3], [(int) $u->calls, (int) $u->ok_2xx, (int) $u->err_4xx, (int) $u->rejected_limit]);
        $this->assertSame(['GET /stock' => 5, 'GET /orders' => 1], json_decode($u->by_route, true));
        $this->assertSame(6, $this->enEmpresa(fn () => DB::table('api_requests')->where('key_id', $id)->count()));

        // Las pantallas: uso en la lista, el detalle y el panel; la bitácora de llamadas es solo de inserción.
        $l = $this->como(self::AUDITOR)->getJson('/api/v1/api/claves')->assertOk();
        $this->assertSame([3, 3], [$l->json('uso.hoy'), $l->json('uso.limite')]);
        $d = $this->como(self::AUDITOR)->getJson("/api/v1/api/claves/{$id}")->assertOk();
        $this->assertSame([6, 3], [$d->json('uso.totales.llamadas'), $d->json('uso.totales.rechazadas')]);
        $this->assertCount(6, $d->json('uso.ultimas'));
        $this->assertNotNull($d->json('last_used_at'));
        $p = $this->como(self::AUDITOR)->getJson('/api/v1/api/uso')->assertOk();
        $this->assertSame([6, 3, 50.0], [$p->json('cifras.llamadas'), $p->json('cifras.rechazadas'), (float) $p->json('cifras.rechazadas_pct')]);
        $this->assertSame('GET /stock', $p->json('rutas.0.ruta'));
        $this->assertSame(1, count($p->json('claves')));
        $this->como(self::AUDITOR)->getJson('/api/v1/api/uso?desde=2026-01-01&hasta=2026-11-25')->assertStatus(422);
        $this->enEmpresa(function () use ($id) {
            try {
                DB::transaction(fn () => DB::table('api_requests')->where('key_id', $id)->update(['status' => 200]));
                $this->fail('La bitácora de llamadas no debía cambiar');
            } catch (QueryException) {
                $this->assertTrue(true);
            }
        });
    }

    public function test_crear_pedido_y_cliente_con_idempotency_key(): void
    {
        $this->travelTo(Carbon::parse('2026-12-01 08:00', 'America/Lima'));   // martes
        $base = $this->enEmpresa(fn () => DB::table('sales_orders as o')->join('brands as b', 'b.id', '=', 'o.brand_id')->where('b.name', 'Don Guando')
            ->where('o.fulfillment', 'DELIVERY')->whereNotNull('o.address_id')->whereNotNull('o.slot_id')->whereNotNull('o.payment_method_id')
            ->where('o.status', '<>', 'DRAFT')->orderByDesc('o.created_at')->first(['o.customer_id', 'o.address_id', 'o.slot_id', 'o.payment_method_id', 'o.id', 'b.code']));
        $lineas = $this->enEmpresa(fn () => DB::table('sales_order_lines as l')->join('product_variants as v', 'v.id', '=', 'l.variant_id')->where('l.sales_order_id', $base->id)
            ->get(['v.sku', 'l.qty', 'l.est_weight_kg'])->map(fn ($l) => ['sku' => $l->sku, 'qty' => (float) $l->qty, 'est_weight_kg' => $l->est_weight_kg !== null ? (float) $l->est_weight_kg : null])->all());
        $pago = $this->enEmpresa(fn () => DB::table('payment_methods')->where('id', $base->payment_method_id)->value('code'));
        [$tk, $id] = $this->clave();
        $cuerpo = ['brand' => $base->code, 'customer_id' => $base->customer_id, 'address_id' => $base->address_id, 'slot_id' => $base->slot_id, 'delivery_date' => '2026-12-02',
            'payment_method' => $pago, 'external_ref' => 'OC-88213', 'lines' => $lineas];

        $this->api($tk, 'POST', '/orders', $cuerpo)->assertStatus(422)->assertJsonPath('code', 'RN-API-13');
        $r = $this->api($tk, 'POST', '/orders', $cuerpo, ['Idempotency-Key' => 'oc-88213']);
        $this->assertSame(201, $r->status(), $r->getContent());
        $numero = $r->json('number');
        $this->assertSame(['CONFIRMED', 'OC-88213'], [$r->json('status'), $r->json('external_ref')]);
        // Repetida con el mismo cuerpo: la misma respuesta y ningún pedido nuevo; con otro cuerpo, 409.
        $otra = $this->api($tk, 'POST', '/orders', $cuerpo, ['Idempotency-Key' => 'oc-88213'])->assertCreated()->assertHeader('Idempotent-Replayed', 'true');
        $this->assertSame($numero, $otra->json('number'));
        $this->assertSame(1, $this->enEmpresa(fn () => DB::table('sales_orders')->where('external_ref', 'OC-88213')->count()));
        $this->api($tk, 'POST', '/orders', ['external_ref' => 'OC-1'] + $cuerpo, ['Idempotency-Key' => 'oc-88213'])->assertStatus(409)->assertJsonPath('code', 'RN-API-13');
        $this->assertSame(1, $this->enEmpresa(fn () => DB::table('api_key_orders')->where('key_id', $id)->count()));
        $this->assertSame(1, $this->como(self::GERENTE)->getJson("/api/v1/api/claves/{$id}")->json('uso.totales.pedidos'));
        // Las reglas de Pedidos: un SKU que no existe y la falta de líneas no crean nada.
        $this->api($tk, 'POST', '/orders', ['lines' => [['sku' => 'NO-EXISTE', 'qty' => 1]]] + $cuerpo, ['Idempotency-Key' => 'mal-1'])->assertStatus(422)->assertJsonPath('code', 'RN-PED-02');
        $this->api($tk, 'POST', '/orders', ['lines' => []] + $cuerpo, ['Idempotency-Key' => 'mal-2'])->assertStatus(422)->assertJsonPath('code', 'RN-PED-01');
        // El comprobante por la API solo se emite cuando el pedido está entregado (RN-API-14).
        $this->api($tk, 'POST', "/orders/{$numero}/documents", [], ['Idempotency-Key' => 'doc-1'])->assertStatus(422)->assertJsonPath('code', 'RN-API-14');

        // Cliente nuevo con RUC; una clave con cliente vinculado no registra clientes ni pide para otros.
        $c = $this->api($tk, 'POST', '/customers', ['doc_type' => 'DNI', 'doc_number' => '45879632', 'name' => 'Rosa Elena Pinto', 'phone' => '987654210'], ['Idempotency-Key' => 'cli-1']);
        $this->assertSame(201, $c->status(), $c->getContent());
        [$b2b] = $this->clave(['name' => 'ERP del restaurante', 'customer_id' => $base->customer_id, 'channel' => 'B2B']);
        $this->api($b2b, 'POST', '/customers', ['doc_type' => 'DNI', 'doc_number' => '45879633', 'name' => 'Otro'], ['Idempotency-Key' => 'cli-2'])->assertStatus(422)->assertJsonPath('code', 'RN-API-11');
        $otro = $this->enEmpresa(fn () => DB::table('customers')->where('id', '<>', $base->customer_id)->whereNull('merged_into_id')->value('id'));
        $this->api($b2b, 'POST', '/orders', ['customer_id' => $otro] + $cuerpo, ['Idempotency-Key' => 'b2b-1'])->assertStatus(422)->assertJsonPath('code', 'RN-API-11');
        $this->assertTrue(collect($this->api($b2b, 'GET', '/orders?limit=100')->json('data'))->every(fn ($o) => $o['customer']['id'] === $base->customer_id));
    }
}
