<?php

namespace Tests\Feature\Modulos;

use App\Modulos\Int\Services\Credenciales;
use App\Modulos\Int\Services\Salientes;
use App\Modulos\Int\Services\Webhooks;
use App\Support\RuleError;
use App\Support\TenantContext;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/** INT · Integraciones. Conectores (INT-01, INT-02), credenciales (INT-03), mensajes salientes y cola muerta (INT-06, INT-07). */
class IntTest extends TestCase
{
    private const ADMIN = 'lccahuana@donguando.pe';     // administración del sistema

    private const SIN_PERMISO = 'chuaman@donguando.pe'; // administración: sin los permisos de INT

    private array $tokens = [];

    private function como(string $email, string $host = self::DG): static
    {
        return $this->desde($host, $this->tokens[$host.$email] ??= $this->ingresar($host, $email));
    }

    /** Lee y escribe como Don Guando (RLS), para revisar filas de la empresa desde la prueba. */
    private function enDonGuando(callable $f): mixed
    {
        TenantContext::set(['id' => DB::table('tenants')->where('short', 'Don Guando')->value('id')]);
        try {
            return $f();
        } finally {
            TenantContext::set(null);
        }
    }

    private function conector(callable $filtro): array
    {
        return collect($this->como(self::ADMIN)->getJson('/api/v1/int/conectores')->assertOk()->json('data'))->first($filtro);
    }

    public function test_lista_y_ficha_de_conectores_sin_secretos(): void
    {
        $r = $this->como(self::ADMIN)->getJson('/api/v1/int/conectores')->assertOk();
        $this->assertSame(28, $r->json('cifras.total'));
        $this->assertGreaterThanOrEqual(1, $r->json('cifras.en_error'), 'La balanza en error de la demostración');
        $this->assertSame(count(array_filter($r->json('data'), fn ($c) => $c['provider'] === 'WHATSAPP_CLOUD' && $c['environment'] === 'PRODUCTION')), $r->json('cifras.whatsapp'));
        $this->assertGreaterThan(0, $r->json('cifras.whatsapp'));
        $wa = collect($r->json('data'))->firstWhere('provider', 'WHATSAPP_CLOUD');
        $this->assertSame(['Mensajería', 'WhatsApp Cloud API (oficial)', 'CRM'], [$wa['kind_name'], $wa['adapter_name'], $wa['owner_module']]);

        $f = $this->como(self::ADMIN)->getJson("/api/v1/int/conectores/{$wa['id']}")->assertOk();
        $this->assertTrue($f->json('config.coexistence'), 'La configuración no secreta se muestra');
        $this->assertStringNotContainsString('enc:', $f->getContent(), 'Ningún secreto cifrado sale de la API');
        $this->assertStringNotContainsString('secret', $f->getContent());

        // Otra empresa no ve los conectores de Don Guando (RLS).
        $this->assertSame(0, $this->como('hsalas@carnesselectas.pe', self::CS)->getJson('/api/v1/int/conectores')->assertOk()->json('cifras.total'));
    }

    public function test_probar_conexion_falso_real_y_paso_a_error_con_aviso(): void
    {
        // En producción, sin adaptador real instalado: lo dice y no lo cuenta como falla (RN-INT-01).
        $real = $this->conector(fn ($c) => $c['environment'] === 'PRODUCTION' && $c['status'] === 'ACTIVE');
        $p = $this->como(self::ADMIN)->postJson("/api/v1/int/conectores/{$real['id']}/probar")->assertOk();
        $this->assertNull($p->json('resultado.ok'));
        $this->assertStringContainsString('todavía no está instalado', $p->json('resultado.mensaje'));
        $this->assertSame(0, $p->json('conector.consecutive_failures'));

        // En prueba, el adaptador falso responde.
        $falso = $this->conector(fn ($c) => $c['environment'] === 'SANDBOX' && $c['status'] === 'ACTIVE');
        $p = $this->como(self::ADMIN)->postJson("/api/v1/int/conectores/{$falso['id']}/probar")->assertOk();
        $this->assertTrue($p->json('resultado.ok'));
        $this->assertNotNull($p->json('conector.last_ok_at'));

        // Simular la caída solo en prueba; tras 3 fallos pasa a «En error» y avisa (RN-INT-19).
        $this->como(self::ADMIN)->postJson("/api/v1/int/conectores/{$real['id']}/simular-caida", ['down' => true])->assertStatus(422)->assertJsonPath('code', 'RN-INT-01');
        $this->como(self::ADMIN)->postJson("/api/v1/int/conectores/{$falso['id']}/simular-caida", ['down' => true])->assertOk();
        foreach ([1, 2] as $n) {
            $this->assertSame('ACTIVE', $this->como(self::ADMIN)->postJson("/api/v1/int/conectores/{$falso['id']}/probar")->json('conector.status'), "Fallo {$n}: sigue activo");
        }
        $e = $this->como(self::ADMIN)->postJson("/api/v1/int/conectores/{$falso['id']}/probar")->assertOk();
        $this->assertSame(['ERROR', 3, false], [$e->json('conector.status'), $e->json('conector.consecutive_failures'), $e->json('resultado.ok')]);
        $this->assertCount(3, $e->json('conector.errores'));
        $this->enDonGuando(fn () => $this->assertDatabaseHas('notifications', ['role' => 'ADMIN_SISTEMA', 'module' => 'INT', 'severity' => 'CRITICAL', 'title' => "{$falso['name']} en error"]));

        // Vuelve a responder: pasa a Activo y avisa que volvió.
        $this->como(self::ADMIN)->postJson("/api/v1/int/conectores/{$falso['id']}/simular-caida", ['down' => false])->assertOk();
        $ok = $this->como(self::ADMIN)->postJson("/api/v1/int/conectores/{$falso['id']}/probar")->assertOk();
        $this->assertSame(['ACTIVE', 0], [$ok->json('conector.status'), $ok->json('conector.consecutive_failures')]);
        $this->enDonGuando(fn () => $this->assertDatabaseHas('notifications', ['module' => 'INT', 'title' => "{$falso['name']} volvió a conectar"]));

        // Sin el permiso de conectores no se prueba.
        $this->como(self::SIN_PERMISO)->postJson("/api/v1/int/conectores/{$falso['id']}/probar")->assertForbidden();
    }

    public function test_activar_y_desactivar_con_motivo_y_modulo_dueno_apagado(): void
    {
        $c = $this->conector(fn ($x) => $x['environment'] === 'SANDBOX' && $x['status'] === 'ACTIVE');
        $ruta = "/api/v1/int/conectores/{$c['id']}";
        $this->como(self::ADMIN)->postJson("{$ruta}/estado", ['active' => false, 'reason' => 'corto'])->assertStatus(422)->assertJsonValidationErrors('reason');
        $d = $this->como(self::ADMIN)->postJson("{$ruta}/estado", ['active' => false, 'reason' => 'Se cambia de proveedor de prueba'])->assertOk();
        $this->assertSame(['DISABLED', 'Se cambia de proveedor de prueba'], [$d->json('status'), $d->json('status_reason')]);
        $this->como(self::ADMIN)->postJson("{$ruta}/probar")->assertStatus(422)->assertJsonPath('code', 'RN-INT-14');
        $this->como(self::ADMIN)->postJson("{$ruta}/estado", ['active' => true, 'reason' => 'Vuelve el proveedor de prueba'])->assertOk()->assertJsonPath('status', 'ACTIVE');

        // Telefonía viene apagada en Don Guando: su conector no se activa hasta encender el módulo (RN-INT-14).
        $tel = $this->conector(fn ($x) => $x['kind'] === 'TELEPHONY');
        $this->assertFalse($tel['module_on']);
        $this->como(self::ADMIN)->postJson("/api/v1/int/conectores/{$tel['id']}/estado", ['active' => true, 'reason' => 'Probar la central telefónica'])
            ->assertStatus(422)->assertJsonPath('code', 'RN-INT-14');
        $this->enDonGuando(fn () => $this->assertDatabaseHas('domain_events', ['event_name' => 'connector.disabled', 'aggregate_id' => $c['id']]));
    }

    public function test_credenciales_cifradas_rotar_y_revocar_sin_mostrar_el_secreto(): void
    {
        $c = $this->conector(fn ($x) => $x['environment'] === 'SANDBOX' && $x['status'] === 'ACTIVE');
        $secreto = 'sk_test_SuperSecreto_7781';

        // Cargar: se cifra con la clave de la aplicación y solo vuelven los últimos 4 (RN-INT-02).
        $r = $this->como(self::ADMIN)->postJson('/api/v1/int/credenciales', ['connector_id' => $c['id'], 'name' => 'webhook_secret', 'secret' => $secreto,
            'expires_at' => now()->addDays(3)->toDateString()])->assertCreated();
        $this->assertSame(['••••7781', 1, 'ACTIVE'], [$r->json('value'), $r->json('version'), $r->json('status')]);
        $this->assertStringNotContainsString('SuperSecreto', $r->getContent());
        $this->enDonGuando(function () use ($r, $secreto, $c) {
            $enc = DB::table('integration_credentials')->where('id', $r->json('id'))->value('secret_enc');
            $this->assertStringStartsWith('enc:v2:', $enc);
            $this->assertSame($secreto, Crypt::decryptString(substr($enc, 7)));
            $this->assertSame($secreto, Credenciales::secreto($c['id'], 'webhook_secret'), 'Los adaptadores reales lo leen en claro');
            $this->assertStringNotContainsString('SuperSecreto', (string) DB::table('domain_events')->where('event_name', 'credential.loaded')->value('payload'), 'Ni la bitácora lo guarda');
        });

        // Por vencer (RN-INT-20) y la lista nunca trae el secreto.
        $l = $this->como(self::ADMIN)->getJson("/api/v1/int/credenciales?connector={$c['id']}")->assertOk();
        $this->assertContains($r->json('id'), array_column($l->json('por_vencer'), 'id'));
        $this->assertStringNotContainsString('enc:', $l->getContent());

        // Una sola vigente por nombre (RN-INT-03): cargar de nuevo pide rotar.
        $this->como(self::ADMIN)->postJson('/api/v1/int/credenciales', ['connector_id' => $c['id'], 'name' => 'webhook_secret', 'secret' => 'otro_secreto_99'])
            ->assertStatus(422)->assertJsonPath('code', 'RN-INT-03');
        $this->como(self::ADMIN)->postJson('/api/v1/int/credenciales', ['connector_id' => $c['id'], 'name' => 'Con Espacios', 'secret' => 'otro_secreto_99'])
            ->assertStatus(422)->assertJsonValidationErrors('name');

        // Rotar: versión 2 vigente, la 1 revocada por rotación.
        $n = $this->como(self::ADMIN)->postJson("/api/v1/int/credenciales/{$r->json('id')}/rotar", ['secret' => 'sk_test_Nuevo_0042'])->assertOk();
        $this->assertSame(['••••0042', 2], [$n->json('value'), $n->json('version')]);
        $this->enDonGuando(function () use ($r, $n) {
            $this->assertSame(['REVOKED', 'Rotación'], array_values((array) DB::table('integration_credentials')->where('id', $r->json('id'))->first(['status', 'revoked_reason'])));
            $this->assertSame($r->json('id'), DB::table('integration_credentials')->where('id', $n->json('id'))->value('rotated_from'));
        });
        $this->como(self::ADMIN)->postJson("/api/v1/int/credenciales/{$r->json('id')}/rotar", ['secret' => 'sk_test_Otra_1111'])->assertStatus(422)->assertJsonPath('code', 'RN-INT-03');

        // Revocar pide motivo; sin el permiso no se carga ni se revoca.
        $this->como(self::ADMIN)->postJson("/api/v1/int/credenciales/{$n->json('id')}/revocar", ['reason' => 'corto'])->assertStatus(422);
        $this->como(self::SIN_PERMISO)->postJson("/api/v1/int/credenciales/{$n->json('id')}/revocar", ['reason' => 'Se filtró el secreto'])->assertForbidden();
        $this->como(self::ADMIN)->postJson("/api/v1/int/credenciales/{$n->json('id')}/revocar", ['reason' => 'Se filtró el secreto en un chat'])->assertOk()
            ->assertJsonPath('status', 'REVOKED')->assertJsonPath('revoked_reason', 'Se filtró el secreto en un chat');
        $this->como(self::SIN_PERMISO)->postJson('/api/v1/int/credenciales', ['connector_id' => $c['id'], 'name' => 'api_key', 'secret' => 'otro_secreto_99'])->assertForbidden();
    }

    public function test_encolar_en_la_transaccion_despachar_con_espera_exponencial_y_cola_muerta(): void
    {
        $falso = $this->conector(fn ($c) => $c['environment'] === 'SANDBOX' && $c['kind'] === 'MESSAGING' && $c['status'] === 'ACTIVE');
        $tel = $this->conector(fn ($c) => $c['kind'] === 'TELEPHONY');

        $this->enDonGuando(function () use ($falso, $tel) {
            // RN-INT-08: si la transacción del cambio de negocio se revierte, el mensaje no existe.
            try {
                DB::transaction(function () use ($falso) {
                    Salientes::encolar($falso['id'], 'CRM', 'MESSAGE', 'order.confirmed', ['to' => '+51999000111'], 'P-REVERTIDO');
                    throw new \RuntimeException('falla el pedido');
                });
            } catch (\RuntimeException) {
            }
            $this->assertFalse(DB::table('outbox_messages')->where('ref', 'P-REVERTIDO')->exists());
            // RN-INT-14: con el módulo apagado (Telefonía) no se crea.
            $this->assertNull(Salientes::encolar($tel['id'], 'TEL', 'MESSAGE', 'call.missed', []));

            // Enviado por el adaptador falso, con su clave de idempotencia (RN-INT-11).
            $id = Salientes::encolar($falso['id'], 'CRM', 'MESSAGE', 'order.confirmed', ['to' => '+51999000111'], 'P-000900', 'ob-prueba-900');
            $m = Salientes::despachar($id);
            $this->assertSame(['SENT', 1], [$m->status, (int) $m->attempts]);
            $this->assertStringStartsWith('FAKE-', $m->provider_ref);
            $this->assertMatchesRegularExpression('/^OB-\d{6}$/', $m->number);
            $this->assertGreaterThan(167, (int) substr($m->number, 3), 'Sigue al último de la demostración (OB-000167)');
            $this->assertSame('SENT', Salientes::despachar($id)->status, 'Un enviado no se vuelve a enviar');
            try {
                Salientes::encolar($falso['id'], 'CRM', 'MESSAGE', 'order.confirmed', [], null, 'ob-prueba-900');
                $this->fail('La clave repetida debía rechazarse');
            } catch (RuleError $e) {
                $this->assertSame('RN-INT-11', $e->rule);
            }

            // RN-INT-09: espera 30 s × 2^(n−1) con tope de 1 hora.
            $this->assertSame([30, 60, 120, 3600], [Salientes::espera(1), Salientes::espera(2), Salientes::espera(3), Salientes::espera(8)]);
            DB::table('integration_connectors')->where('id', $falso['id'])->update(['simulate_down' => true]);
            $id2 = Salientes::encolar($falso['id'], 'CRM', 'MESSAGE', 'order.confirmed', ['to' => '+51999000222'], 'P-000901');
            $m = Salientes::despachar($id2);
            $this->assertSame(['RETRYING', 1], [$m->status, (int) $m->attempts]);
            $this->assertEqualsWithDelta(now()->addSeconds(30)->timestamp, Carbon::parse($m->next_attempt_at)->timestamp, 2);
            foreach (range(2, 8) as $n) {
                $m = Salientes::despachar($id2);
            }
            $this->assertSame(['DEAD', 8], [$m->status, (int) $m->attempts]);
            $this->assertCount(8, json_decode($m->tries, true));
            $this->assertDatabaseHas('notifications', ['module' => 'INT', 'severity' => 'CRITICAL', 'title' => "Mensaje {$m->number} en la cola muerta"]);
            $this->assertDatabaseHas('domain_events', ['event_name' => 'outbox.dead', 'aggregate_id' => $id2]);
            $this->assertSame('ERROR', DB::table('integration_connectors')->where('id', $falso['id'])->value('status'), 'Las caídas del proveedor cuentan para el conector');
        });
    }

    public function test_cola_muerta_se_reintenta_o_cancela_a_mano_con_motivo(): void
    {
        $l = $this->como(self::ADMIN)->getJson('/api/v1/int/salientes?muertos=1')->assertOk();
        $muertos = $l->json('cifras.muertos');
        $this->assertGreaterThanOrEqual(2, $muertos, 'La demostración trae mensajes en la cola muerta');
        $this->assertSame(8, $l->json('max_intentos'));
        $this->assertNotNull($l->json('cifras.exito'));
        $vivos = array_values(array_filter($l->json('data'), fn ($m) => $m['status'] === 'DEAD'));
        [$a, $b] = $vivos;

        $this->como(self::SIN_PERMISO)->postJson("/api/v1/int/salientes/{$a['id']}/reintentar", ['reason' => 'Ya se corrigió la plantilla'])->assertForbidden();
        $this->como(self::ADMIN)->postJson("/api/v1/int/salientes/{$a['id']}/reintentar", ['reason' => 'corto'])->assertStatus(422);

        // Reintento a mano: si su conector es real y sin adaptador instalado, vuelve a fallar y sigue en la cola muerta.
        $r = $this->como(self::ADMIN)->postJson("/api/v1/int/salientes/{$a['id']}/reintentar", ['reason' => 'Ya se corrigió la plantilla en Meta'])->assertOk();
        $this->assertContains($r->json('status'), ['DEAD', 'SENT']);
        $this->assertSame(['RETRY', 'Ya se corrigió la plantilla en Meta'], [$r->json('manual.0.action'), $r->json('manual.0.reason')]);

        // Cancelar con motivo; uno cancelado ya no se toca.
        $c = $this->como(self::ADMIN)->postJson("/api/v1/int/salientes/{$b['id']}/cancelar", ['reason' => 'El comprobante se anuló con nota de crédito'])->assertOk();
        $this->assertSame(['CANCELLED', 'El comprobante se anuló con nota de crédito'], [$c->json('status'), $c->json('cancel_reason')]);
        $this->como(self::ADMIN)->postJson("/api/v1/int/salientes/{$b['id']}/cancelar", ['reason' => 'Otra vez cancelado'])->assertStatus(422)->assertJsonPath('code', 'RN-INT-10');

        // La cola muerta muestra también los atendidos a mano.
        $l2 = $this->como(self::ADMIN)->getJson('/api/v1/int/salientes?muertos=1&per_page=100')->assertOk();
        $this->assertSame($muertos - 1 - ($r->json('status') === 'SENT' ? 1 : 0), $l2->json('cifras.muertos'));
        $this->assertContains($b['id'], array_column($l2->json('data'), 'id'));
        $this->enDonGuando(fn () => $this->assertDatabaseHas('domain_events', ['event_name' => 'outbox.cancelled', 'aggregate_id' => $b['id']]));

        // Filtros, detalle y eventos de dominio.
        $estados = array_unique(array_column($this->como(self::ADMIN)->getJson('/api/v1/int/salientes?status=RETRYING')->assertOk()->json('data'), 'status'));
        $this->assertContains(array_values($estados), [[], ['RETRYING']]);
        $v = $this->como(self::ADMIN)->getJson("/api/v1/int/salientes/{$a['id']}")->assertOk();
        $this->assertNotEmpty($v->json('kind_name'));
        $this->assertIsArray($v->json('tries'));
        $this->assertContains('outbox.cancelled', $this->como(self::ADMIN)->getJson('/api/v1/int/salientes/eventos')->assertOk()->json('eventos'));
    }

    private function endpoint(string $nombre): array
    {
        return collect($this->como(self::ADMIN)->getJson('/api/v1/int/webhooks')->assertOk()->json('data'))->firstWhere('name', $nombre);
    }

    /** Envía al receptor público, sin sesión, firmado (o no) con el secreto. */
    private function enviarWebhook(string $url, array $cuerpo, ?string $secreto, string $cabecera = 'x-signature')
    {
        $crudo = json_encode($cuerpo);
        $cab = ['Content-Type' => 'application/json', 'Accept' => 'application/json'];
        if ($secreto) {
            $cab[$cabecera] = 'sha256='.hash_hmac('sha256', $crudo, $secreto);
        }
        $this->app['auth']->forgetGuards();
        TenantContext::set(null);

        return $this->call('POST', parse_url($url, PHP_URL_PATH), [], [], [], $this->transformHeadersToServerVars($cab), $crudo);
    }

    public function test_webhook_firmado_una_sola_vez_rechazado_e_ignorado(): void
    {
        $ep = $this->endpoint('Mercado Pago · prueba');
        $this->assertFalse($ep['con_secreto'], 'Los de la demostración traen un secreto de ejemplo que no sirve');
        $this->assertStringEndsWith('/api/hooks/'.basename($ep['url']), $ep['url']);
        $secreto = 'whsec_prueba_8821';

        // Sin secreto cargado: rechazado aunque venga firmado.
        $this->enviarWebhook($ep['url'], ['id' => 'mp-1', 'type' => 'payment'], $secreto)->assertStatus(401)->assertExactJson(['status' => 'REJECTED']);

        // Cargar el secreto: cifrado y nunca vuelve; sin el permiso no se carga.
        $this->como(self::SIN_PERMISO)->postJson("/api/v1/int/webhooks/{$ep['id']}/secreto", ['secret' => $secreto])->assertForbidden();
        $r = $this->como(self::ADMIN)->postJson("/api/v1/int/webhooks/{$ep['id']}/secreto", ['secret' => $secreto])->assertOk();
        $this->assertTrue($r->json('con_secreto'));
        $this->assertStringNotContainsString($secreto, $r->getContent());

        // Firma inválida: 401, guardado como rechazado, con aviso de seguridad (uno por hora).
        $this->enviarWebhook($ep['url'], ['id' => 'mp-2'], 'otro_secreto_x')->assertStatus(401);
        $this->enviarWebhook($ep['url'], ['id' => 'mp-3'], null)->assertStatus(401);
        $this->enDonGuando(fn () => $this->assertSame(1, DB::table('notifications')->where('title', 'Webhook rechazado por firma inválida')->where('at', '>=', now()->subMinute())->count()));

        // Firmado: se recibe, se guarda crudo y, sin procesador instalado, queda recibido (no es una falla).
        $cuerpo = ['id' => 'mp-100', 'type' => 'payment', 'data' => ['status' => 'approved', 'transaction_amount' => 96.5]];
        $this->enviarWebhook($ep['url'], $cuerpo, $secreto)->assertOk()->assertJson(['status' => 'RECEIVED']);
        // Repetido (RN-INT-05): 200 y suma al contador, sin otro registro. Con otra cabecera de firma también vale.
        $this->enviarWebhook($ep['url'], $cuerpo, $secreto, 'X-Hub-Signature-256')->assertOk()->assertJson(['duplicate' => true]);

        $l = $this->como(self::ADMIN)->getJson("/api/v1/int/webhooks/eventos?endpoint={$ep['id']}")->assertOk();
        $e = collect($l->json('data'))->firstWhere('event_key', 'mp-100');
        $this->assertSame(['RECEIVED', 1], [$e['status'], $e['duplicates']]);
        $this->assertCount(4, $l->json('data'), 'El repetido no crea otro registro');
        $this->assertSame(3, collect($l->json('data'))->where('status', 'REJECTED')->count());
        $v = $this->como(self::ADMIN)->getJson("/api/v1/int/webhooks/eventos/{$e['id']}")->assertOk();
        $this->assertSame(json_encode($cuerpo), $v->json('body'), 'El crudo se guarda tal cual');
        $this->assertArrayHasKey('x-signature', $v->json('headers'));
        $this->assertStringContainsString('procesará cuando el módulo', $v->json('result'));
        $this->assertSame(1, $this->endpoint('Mercado Pago · prueba')['received_count']);

        // Otra empresa no ve la bitácora de Don Guando.
        $this->assertSame(0, $this->como('hsalas@carnesselectas.pe', self::CS)->getJson('/api/v1/int/webhooks/eventos')->assertOk()->json('total'));

        // Token desconocido: 404 sin decir nada más.
        $this->enviarWebhook(url('/api/hooks/'.str_repeat('Z', 32)), ['id' => 'x'], $secreto)->assertNotFound()->assertExactJson(['status' => 'NOT_FOUND']);

        // Telefonía apagada (RN-INT-14): se guarda como ignorado y responde 200.
        $tel = $this->endpoint('Telefonía · llamadas y grabaciones');
        $this->como(self::ADMIN)->postJson("/api/v1/int/webhooks/{$tel['id']}/secreto", ['secret' => $secreto])->assertOk();
        $this->enviarWebhook($tel['url'], ['id' => 'call-1'], $secreto)->assertOk()->assertJson(['status' => 'IGNORED']);
    }

    public function test_regenerar_token_con_gracia_de_24_horas_y_reprocesar_fallidos(): void
    {
        $ep = $this->endpoint('Mercado Pago · prueba');
        $secreto = 'whsec_prueba_8821';
        $this->como(self::ADMIN)->postJson("/api/v1/int/webhooks/{$ep['id']}/secreto", ['secret' => $secreto])->assertOk();

        $this->como(self::SIN_PERMISO)->postJson("/api/v1/int/webhooks/{$ep['id']}/regenerar")->assertForbidden();
        $n = $this->como(self::ADMIN)->postJson("/api/v1/int/webhooks/{$ep['id']}/regenerar")->assertOk();
        $this->assertNotSame($ep['url'], $n->json('url'));
        $this->assertNotNull($n->json('anterior_vale_hasta'));
        // La URL anterior sigue valiendo 24 horas; después, no.
        $this->enviarWebhook($ep['url'], ['id' => 'mp-200'], $secreto)->assertOk();
        $this->enviarWebhook($n->json('url'), ['id' => 'mp-201'], $secreto)->assertOk();
        $this->travel(25)->hours();
        $this->enviarWebhook($ep['url'], ['id' => 'mp-202'], $secreto)->assertNotFound();
        $this->travelBack();

        // Con un procesador que falla: 5 intentos y queda fallido (RN-INT-07); se reprocesa a mano con el permiso.
        $falla = true;
        Webhooks::$procesadores['MERCADOPAGO'] = function (array $b) use (&$falla) {
            if ($falla) {
                throw new \RuntimeException("No existe el pedido {$b['ref']}.");
            }

            return "Cobro aplicado a {$b['ref']}";
        };
        try {
            $this->enviarWebhook($n->json('url'), ['id' => 'mp-300', 'ref' => 'P-099871'], $secreto)->assertOk()->assertJson(['status' => 'FAILED']);
            $l = $this->como(self::ADMIN)->getJson('/api/v1/int/webhooks/eventos?status=FAILED')->assertOk();
            $f = collect($l->json('data'))->firstWhere('event_key', 'mp-300');
            $this->assertSame([5, 'No existe el pedido P-099871.'], [$f['attempts'], $f['last_error']]);
            $this->assertGreaterThanOrEqual(2, $l->json('cifras.fallidos'), 'Con el de la demostración');
            $this->assertStringNotContainsString('RN-INT', $l->getContent(), 'Sin códigos de reglas en pantalla');

            $this->como(self::SIN_PERMISO)->postJson("/api/v1/int/webhooks/eventos/{$f['id']}/reprocesar")->assertForbidden();
            $falla = false;
            $r = $this->como(self::ADMIN)->postJson("/api/v1/int/webhooks/eventos/{$f['id']}/reprocesar")->assertOk();
            $this->assertSame(['PROCESSED', 6, 'Cobro aplicado a P-099871'], [$r->json('status'), $r->json('attempts'), $r->json('result')]);
            $this->como(self::ADMIN)->postJson("/api/v1/int/webhooks/eventos/{$f['id']}/reprocesar")->assertStatus(422)->assertJsonPath('code', 'RN-INT-07');
            $this->enDonGuando(fn () => $this->assertDatabaseHas('domain_events', ['event_name' => 'webhook.reprocessed', 'aggregate_id' => $f['id']]));
        } finally {
            Webhooks::$procesadores = [];
        }
    }

    public function test_el_despacho_programado_envia_lo_que_toca(): void
    {
        $falso = $this->conector(fn ($c) => $c['environment'] === 'SANDBOX' && $c['kind'] === 'MESSAGING' && $c['status'] === 'ACTIVE');
        $id = $this->enDonGuando(fn () => Salientes::encolar($falso['id'], 'CRM', 'MESSAGE', 'order.confirmed', ['to' => '+51999000333'], 'P-000902'));
        $this->artisan('int:despachar')->assertSuccessful();
        $this->assertSame('SENT', $this->enDonGuando(fn () => DB::table('outbox_messages')->where('id', $id)->value('status')));
        // «Procesar ahora» desde la pantalla: solo con el permiso de la cola.
        $this->como(self::SIN_PERMISO)->postJson('/api/v1/int/salientes/procesar')->assertForbidden();
        $this->como(self::ADMIN)->postJson('/api/v1/int/salientes/procesar')->assertOk();
    }
}
