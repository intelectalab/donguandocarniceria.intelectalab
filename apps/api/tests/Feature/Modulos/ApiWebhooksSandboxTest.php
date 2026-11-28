<?php

namespace Tests\Feature\Modulos;

use App\Modulos\Api\Services\Webhooks;
use App\Support\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * API-04 Destinos de webhooks, API-05 Crear o editar destino, API-06 Entregas, API-07 Detalle de entrega,
 * API-08 Documentación y API-09 Sandbox (RN-API-05 a 08, 12, 14, 16, 17 y 18; CA-API-03, 04, 06 y 07).
 */
class ApiWebhooksSandboxTest extends TestCase
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

    private function api(string $token, string $metodo, string $ruta, array $cuerpo = [], array $cabeceras = [])
    {
        $this->app['auth']->forgetGuards();
        $this->flushHeaders();
        $h = ['Accept' => 'application/json', 'Authorization' => "Bearer {$token}"] + $cabeceras;

        return $this->withHeaders($h)->json($metodo, '/api/publica/v1'.$ruta, $cuerpo);
    }

    public function test_destinos_ssrf_rotacion_de_secreto_y_firma_hmac(): void
    {
        $this->travelTo(Carbon::parse('2026-11-26 10:00:00', 'America/Lima'));

        // RN-API-05: protección contra SSRF (http, localhost, .local y direcciones IP privadas o loopback).
        foreach (['http://erp.cliente.pe/hook', 'https://localhost/hook', 'https://servidor.local/hook', 'https://10.0.0.5/hook', 'https://192.168.1.20/hook', 'https://127.0.0.1/hook'] as $urlMala) {
            $this->como(self::ADMIN)->postJson('/api/v1/api/destinos', [
                'name' => 'Receptor malo',
                'url' => $urlMala,
                'events' => ['order.delivered'],
            ])->assertStatus(422)->assertJsonPath('code', 'RN-API-05');
        }

        // RN-API-06: un evento retirado (order.updated) o inexistente se rechaza.
        $this->como(self::ADMIN)->postJson('/api/v1/api/destinos', [
            'name' => 'Receptor evento retirado',
            'url' => 'https://erp.elcuydorado.pe/hooks/gestioncarnica',
            'events' => ['order.updated'],
        ])->assertStatus(422)->assertJsonPath('code', 'RN-API-06');

        // Crear destino válido: devuelve el secreto whsec_ una sola vez y en la vista solo los últimos 4 caracteres.
        $r = $this->como(self::ADMIN)->postJson('/api/v1/api/destinos', [
            'name' => 'ERP El Cuy Dorado',
            'url' => 'https://erp.elcuydorado.pe/hooks/gestioncarnica',
            'events' => ['order.confirmed', 'order.delivered'],
            'sim_mode' => 'OK',
        ])->assertCreated();
        $secreto1 = $r->json('secret');
        $id = $r->json('destino.id');
        $this->assertStringStartsWith('whsec_', $secreto1);
        $this->assertSame(substr($secreto1, -4), $r->json('destino.secret_last4'));
        $this->assertSame(1, $r->json('destino.secret_version'));

        // CA-API-06 y RN-API-07: calculadora de firma y convivencia de 24 h al rotar el secreto.
        $calc = $this->como(self::AUDITOR)->postJson('/api/v1/api/documentacion/firma', [
            'secret' => 'whsec_prueba',
            't' => '1760090400',
            'body' => '{"id":1}',
        ])->assertOk();
        $esperada = hash_hmac('sha256', '1760090400.{"id":1}', 'whsec_prueba');
        $this->assertSame($esperada, $calc->json('v1'));
        $this->assertSame("GestionCarnica-Signature: t=1760090400, v1={$esperada}", $calc->json('header'));

        // Rotar secreto: durante 24 horas firma con el nuevo y con el anterior (dos v1).
        $rot = $this->como(self::ADMIN)->postJson("/api/v1/api/destinos/{$id}/rotar-secreto")->assertOk();
        $secreto2 = $rot->json('secret');
        $this->assertNotSame($secreto1, $secreto2);
        $this->assertSame(2, $rot->json('destino.secret_version'));
        $this->assertTrue($rot->json('destino.prev_vigente'));

        $prueba = $this->como(self::ADMIN)->postJson("/api/v1/api/destinos/{$id}/probar")->assertOk();
        $this->assertSame('DELIVERED', $prueba->json('status'));
        $firmaCabecera = $prueba->json('signature');
        $this->assertSame(2, substr_count($firmaCabecera, 'v1='));
        $cuerpoCrudo = $prueba->json('payload');
        $tEnvio = (int) preg_replace('/^t=(\d+).*/', '$1', $firmaCabecera);
        $this->assertTrue(Webhooks::verificarFirma($firmaCabecera, $secreto2, $cuerpoCrudo, $tEnvio + 30)['ok']);
        $this->assertTrue(Webhooks::verificarFirma($firmaCabecera, $secreto1, $cuerpoCrudo, $tEnvio + 30)['ok']);
        $this->assertFalse(Webhooks::verificarFirma($firmaCabecera, $secreto2, $cuerpoCrudo, $tEnvio + 600)['ok']);
    }

    public function test_reintentos_cola_muerta_reenvio_y_desactivacion_por_racha(): void
    {
        $this->travelTo(Carbon::parse('2026-11-26 10:00:00', 'America/Lima'));

        // Destino caído (DOWN): 8 intentos con backoff [1, 5, 30, 120, 360, 720, 1440] -> DEAD (CA-API-03, CA-API-04, RN-API-08).
        $ep = $this->como(self::ADMIN)->postJson('/api/v1/api/destinos', [
            'name' => 'Receptor caído',
            'url' => 'https://tienda.marca5gourmet.pe/hooks/gestioncarnica',
            'events' => ['stock.low'],
            'sim_mode' => 'DOWN',
        ])->assertCreated()->json('destino');

        $entrega = $this->como(self::ADMIN)->postJson("/api/v1/api/destinos/{$ep['id']}/probar")->assertOk();
        $delId = $entrega->json('id');
        $this->assertSame(['RETRYING', 1], [$entrega->json('status'), $entrega->json('attempts')]);

        // Adelantar los 7 reintentos restantes hasta llegar a 8 -> DEAD.
        for ($i = 2; $i <= 8; $i++) {
            $this->como(self::ADMIN)->postJson('/api/v1/api/entregas/procesar', ['all' => true, 'endpoint' => $ep['id']])->assertOk();
        }
        $muerta = $this->como(self::AUDITOR)->getJson("/api/v1/api/entregas/{$delId}")->assertOk();
        $this->assertSame(['DEAD', 8], [$muerta->json('status'), $muerta->json('attempts')]);
        $this->assertCount(8, $muerta->json('intentos'));
        $this->assertSame([1, 5, 30, 120, 360, 720, 1440, null], array_column($muerta->json('intentos'), 'wait_next_min'));

        // Los intentos son de solo inserción (append-only).
        $this->enEmpresa(function () use ($delId) {
            try {
                DB::transaction(fn () => DB::table('api_webhook_attempts')->where('delivery_id', $delId)->update(['ok' => true]));
                $this->fail('api_webhook_attempts no debía permitir UPDATE');
            } catch (QueryException) {
                $this->assertTrue(true);
            }
        });

        // El destino vuelve a responder OK -> reenviar desde API-07 crea una nueva entrega con el mismo event_id y queda DELIVERED.
        $this->como(self::ADMIN)->putJson("/api/v1/api/destinos/{$ep['id']}", [
            'name' => 'Receptor caído',
            'url' => 'https://tienda.marca5gourmet.pe/hooks/gestioncarnica',
            'events' => ['stock.low'],
            'sim_mode' => 'OK',
        ])->assertOk();
        $reenviada = $this->como(self::ADMIN)->postJson("/api/v1/api/entregas/{$delId}/reenviar")->assertOk();
        $this->assertSame(['DELIVERED', $muerta->json('event_id'), $delId], [$reenviada->json('status'), $reenviada->json('event_id'), $reenviada->json('resent_from')]);

        // RN-API-12: al llegar al límite de fallos seguidos el destino se desactiva y exige motivo de >= 10 caracteres para reactivarse.
        $this->como(self::ADMIN)->putJson('/api/v1/plt/parametros/api_webhook_disable_after_failures', ['value' => 3, 'reason' => 'Probar desactivación por racha'])->assertOk();
        $epLegacy = $this->como(self::ADMIN)->postJson('/api/v1/api/destinos', [
            'name' => 'ERP interno legacy',
            'url' => 'https://erp-legacy.donguando.pe/hooks/gestioncarnica', // resuelve a 10.20.0.15 (bloqueado por SSRF al enviar)
            'events' => ['order.confirmed'],
        ])->assertCreated()->json('destino');

        $this->como(self::ADMIN)->postJson("/api/v1/api/destinos/{$epLegacy['id']}/probar")->assertOk();
        $this->como(self::ADMIN)->postJson('/api/v1/api/entregas/procesar', ['all' => true, 'endpoint' => $epLegacy['id']])->assertOk();
        $this->como(self::ADMIN)->postJson('/api/v1/api/entregas/procesar', ['all' => true, 'endpoint' => $epLegacy['id']])->assertOk();

        $desactivado = $this->como(self::ADMIN)->getJson("/api/v1/api/destinos/{$epLegacy['id']}")->assertOk();
        $this->assertSame(['DISABLED', 3], [$desactivado->json('status'), $desactivado->json('failure_streak')]);

        $this->como(self::ADMIN)->postJson("/api/v1/api/destinos/{$epLegacy['id']}/estado", ['status' => 'ACTIVE', 'reason' => 'corto'])->assertStatus(422)->assertJsonPath('code', 'RN-API-12');
        $reactivado = $this->como(self::ADMIN)->postJson("/api/v1/api/destinos/{$epLegacy['id']}/estado", [
            'status' => 'ACTIVE',
            'reason' => 'Se actualizó el registro DNS del servidor del cliente a una IP pública.',
        ])->assertOk();
        $this->assertSame(['ACTIVE', 0], [$reactivado->json('status'), $reactivado->json('failure_streak')]);
    }

    public function test_sandbox_aislado_ose_fake_y_documentacion_openapi(): void
    {
        $this->travelTo(Carbon::parse('2026-11-26 10:00:00', 'America/Lima'));

        // Crear una clave de pruebas (TEST) con alcances de pedidos, comprobantes y webhooks.
        $claveTest = $this->como(self::GERENTE)->postJson('/api/v1/api/claves', [
            'name' => 'Integración Sandbox',
            'environment' => 'TEST',
            'scopes' => ['orders:read', 'orders:write', 'products:read', 'prices:read', 'stock:read', 'customers:read', 'customers:write', 'documents:read', 'webhooks:write'],
            'expires_at' => '2027-04-01',
        ])->assertCreated();
        $tkTest = $claveTest->json('token');

        $pedidosProdAntes = $this->enEmpresa(fn () => DB::table('sales_orders')->count());
        $docsProdAntes = $this->enEmpresa(fn () => DB::table('sales_documents')->count());

        // CA-API-07 y RN-API-16: crear pedido y emitir comprobante en el sandbox con ak_test_ no toca producción y usa OSE FAKE.
        $sbx = $this->como(self::AUDITOR)->getJson('/api/v1/api/sandbox')->assertOk();
        $cuerpoPedido = $sbx->json('ejemplo_pedido');

        $nuevoPedido = $this->api($tkTest, 'POST', '/orders', $cuerpoPedido, ['Idempotency-Key' => 'sbx-ord-1'])->assertCreated();
        $numSbx = $nuevoPedido->json('number');
        $this->assertStringStartsWith('SBX-', $numSbx);
        $this->assertTrue($nuevoPedido->json('sandbox'));

        $docSbx = $this->api($tkTest, 'POST', "/orders/{$numSbx}/documents", [], ['Idempotency-Key' => 'sbx-doc-1'])->assertCreated();
        $this->assertSame(['ACCEPTED', 'FAKE', false, true], [
            $docSbx->json('sunat_status'),
            $docSbx->json('ose'),
            $docSbx->json('sent_to_sunat'),
            $docSbx->json('sandbox'),
        ]);

        // Un pedido de producción no existe en el sandbox.
        $numProd = $this->enEmpresa(fn () => DB::table('sales_orders')->value('number'));
        $this->api($tkTest, 'GET', "/orders/{$numProd}")->assertNotFound()->assertJsonPath('code', 'RN-API-16');

        // Las tablas reales de producción no cambiaron.
        $this->assertSame($pedidosProdAntes, $this->enEmpresa(fn () => DB::table('sales_orders')->count()));
        $this->assertSame($docsProdAntes, $this->enEmpresa(fn () => DB::table('sales_documents')->count()));

        // Crear un destino de webhook por la API pública con el alcance webhooks:write.
        $epApi = $this->api($tkTest, 'POST', '/webhook-endpoints', [
            'name' => 'Webhook desde API',
            'url' => 'https://webhook.site/7d1c2e9a-4b8f-4c55-9a51-3e0f1f6b2c11',
            'events' => ['order.created'],
        ], ['Idempotency-Key' => 'sbx-wh-1'])->assertCreated();
        $this->assertStringStartsWith('whsec_', $epApi->json('secret'));
        $this->assertNotEmpty($this->api($tkTest, 'GET', '/webhook-endpoints')->assertOk()->json('data'));

        // Reiniciar el sandbox restaura los 5 pedidos y 1 comprobante de demostración.
        $reiniciado = $this->como(self::ADMIN)->postJson('/api/v1/api/sandbox/reiniciar')->assertOk();
        $this->assertSame([5, 1, 0], [
            $reiniciado->json('cifras.pedidos'),
            $reiniciado->json('cifras.comprobantes'),
            $reiniciado->json('cifras.mensajes'),
        ]);

        // API-08 Documentación y consola de prueba integrada.
        $doc = $this->como(self::AUDITOR)->getJson('/api/v1/api/documentacion')->assertOk();
        $this->assertSame('3.0.3', $doc->json('openapi.openapi'));
        $this->assertCount(14, $doc->json('operaciones'));

        $consola = $this->como(self::AUDITOR)->postJson('/api/v1/api/consola/probar', [
            'key_id' => $claveTest->json('clave.id'),
            'method' => 'GET',
            'path' => '/orders?limit=2',
            'ip' => '181.65.70.12',
        ])->assertOk();
        $this->assertSame(200, $consola->json('status'));
        $this->assertTrue($consola->json('body.sandbox'));
    }
}
