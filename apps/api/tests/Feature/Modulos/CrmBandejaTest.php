<?php

namespace Tests\Feature\Modulos;

use App\Modulos\Crm\Services\Conversaciones;
use App\Modulos\Crm\Services\Recepcion;
use App\Modulos\Int\Services\Salientes;
use App\Support\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/** CRM-01 Bandeja y CRM-02 Conversación (RN-CRM-02 a 06, 10 a 14, 21; CA-CRM-02, 03, 09, 11). */
class CrmBandejaTest extends TestCase
{
    private const ADMIN = 'lccahuana@donguando.pe';

    private const GERENTE = 'rquispe@donguando.pe';

    private const AUDITOR = 'aexterno@donguando.pe';

    private const SUPERVISORA = 'pleon@donguando.pe';

    private const A = 'ana.torres@donguando.pe';

    private const B = 'bramos@donguando.pe';

    private const OTRA = 'cnunez@donguando.pe';   // Marca 2 y 3

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

    private function id(string $email): string
    {
        return $this->enEmpresa(fn () => DB::table('users')->where('email', $email)->value('id'));
    }

    /**
     * Un número de prueba de Don Guando con el conector falso (los mensajes salen de verdad por INT), con A y B de turno
     * todo el día y A en línea. Devuelve su id.
     */
    private function numeroDePrueba(): string
    {
        $marca = $this->enEmpresa(fn () => DB::table('brands')->where('name', 'Don Guando')->value('id'));
        $conector = $this->enEmpresa(fn () => DB::table('integration_connectors')->where('code', 'WA-SBX')->value('id'));
        $canal = $this->como(self::ADMIN)->postJson('/api/v1/crm/canales', ['kind' => 'WHATSAPP', 'number' => '+15550001111', 'display_name' => 'Ventas de prueba', 'brand_id' => $marca,
            'connection_mode' => 'CLOUD_API', 'connector_id' => $conector, 'assignment_mode' => 'SHIFT_ROUND_ROBIN', 'status' => 'ACTIVE',
            'recording_notice_text' => 'Esta conversación queda registrada (Ley 29733).', 'auto_greeting' => '¡Hola! En un momento te atendemos.'])->assertCreated()->json('id');
        foreach ([self::A, self::B] as $e) {
            $m = $this->como(self::ADMIN)->postJson("/api/v1/crm/canales/{$canal}/miembros", ['user_id' => $this->id($e)])->assertCreated()->json('id');
            $this->como(self::ADMIN)->putJson("/api/v1/crm/miembros/{$m}/turnos", ['turnos' => array_map(fn ($d) => ['weekday' => $d, 'from' => '00:00', 'to' => '23:59'], range(1, 7))])->assertOk();
        }
        $this->como(self::ADMIN)->postJson("/api/v1/crm/canales/{$canal}/miembros", ['user_id' => $this->id(self::SUPERVISORA)])->assertCreated();
        $this->como(self::A)->postJson('/api/v1/crm/mi-estado', ['estado' => 'ONLINE'])->assertOk();
        $this->como(self::B)->postJson('/api/v1/crm/mi-estado', ['estado' => 'OFFLINE'])->assertOk();

        return $canal;
    }

    private function entra(string $canal, string $de, string $texto, array $mas = []): array
    {
        return $this->como(self::SUPERVISORA)->postJson('/api/v1/crm/simular', $mas + ['channel_id' => $canal, 'from' => $de, 'texto' => $texto])->assertCreated()->json();
    }

    public function test_un_numero_nuevo_crea_lead_aviso_de_registro_y_se_asigna(): void
    {
        $canal = $this->numeroDePrueba();
        $r = $this->entra($canal, '+15559900111', 'Hola, vi el anuncio DG-A12, ¿tienen lechón?', ['name' => 'Rocío Prueba']);
        $this->assertNotNull($r['lead_id'], 'Número desconocido: se crea un lead, no un cliente');
        $this->assertSame($this->id(self::A), $r['assigned'], 'A está en turno y en línea; B, desconectada');

        $c = $this->como(self::A)->getJson("/api/v1/crm/conversaciones/{$r['conversation_id']}")->assertOk();
        $this->assertSame(['Rocío Prueba', false, 'TRACKING_CODE', 'DG-A12', true], [$c->json('contacto'), $c->json('es_cliente'), $c->json('entry_point'), $c->json('ad_code'), $c->json('ventana.abierta')]);
        // Mensaje del cliente y aviso automático (no el saludo: el aviso va primero al contacto nuevo).
        $this->assertSame(['IN', 'OUT'], array_column($c->json('mensajes'), 'direction'));
        $this->assertSame('SYSTEM', $c->json('mensajes.1.origin'));
        $this->assertStringContainsString('Ley 29733', $c->json('mensajes.1.body'));
        $this->assertSame('En cola de envío', $c->json('mensajes.1.estado_name'));
        $this->enEmpresa(function () use ($r) {
            $this->assertTrue(DB::table('contact_consents')->where('purpose', 'RECORDING_NOTICE')->whereExists(fn ($q) => $q->from('conversations as v')
                ->whereColumn('v.contact_id', 'contact_consents.contact_id')->where('v.id', $r['conversation_id']))->exists());
            $this->assertSame('NEW', DB::table('leads')->where('id', $r['lead_id'])->value('status'));
            $this->assertTrue(DB::table('notifications')->where('user_id', DB::table('users')->where('email', self::A)->value('id'))->where('title', 'Chat asignado')->exists());
        });
        // El primer aviso no cuenta como primera respuesta.
        $this->assertNull($c->json('first_response_at'));

        // Un cliente conocido por su celular: la conversación queda con el cliente y sin lead.
        $tel = $this->enEmpresa(fn () => DB::table('customers')->whereNotNull('phone')->whereNotExists(fn ($q) => $q->from('channel_contacts')->whereColumn('channel_contacts.external_user_id', 'customers.phone'))->value('phone'));
        $k = $this->entra($canal, $tel, 'Buenas, quiero repetir mi pedido');
        $this->assertNull($k['lead_id']);
        $this->assertTrue($this->como(self::A)->getJson("/api/v1/crm/conversaciones/{$k['conversation_id']}")->json('es_cliente'));
    }

    public function test_responder_en_ventana_sale_por_int_cuenta_la_primera_respuesta_y_cobra(): void
    {
        $canal = $this->numeroDePrueba();
        $r = $this->entra($canal, '+15559900222', 'Hola, ¿cuánto cuesta el kilo de lomo?', ['anuncio' => 'DGGSR1']);
        $id = $r['conversation_id'];
        $c = $this->como(self::A)->getJson("/api/v1/crm/conversaciones/{$id}")->assertOk();
        $this->assertSame(['CTWA_AD', true, 'Gratis (ventana de anuncio de 72 h)'], [$c->json('entry_point'), $c->json('ventana.anuncio'), $c->json('costo_proximo.servicio.reason')]);

        // Solo A (asignada) o la supervisora responden.
        $this->como(self::B)->postJson("/api/v1/crm/conversaciones/{$id}/mensajes", ['texto' => 'Hola'])->assertStatus(422);
        $this->como(self::AUDITOR)->postJson("/api/v1/crm/conversaciones/{$id}/mensajes", ['texto' => 'Hola'])->assertForbidden();
        $m = $this->como(self::A)->postJson("/api/v1/crm/conversaciones/{$id}/mensajes", ['texto' => 'Hola, el kilo está a S/ 48.'])->assertCreated();
        $this->assertSame('QUEUED', $m->json('mensaje.estado'));
        $this->assertNotNull($m->json('conversacion.first_response_at'));
        $this->enEmpresa(fn () => $this->assertSame('CONTACTED', DB::table('leads')->where('id', $r['lead_id'])->value('status')));

        // INT lo despacha por el conector falso: queda «enviado» y con su costo (gratis por el anuncio).
        $this->enEmpresa(fn () => Salientes::procesar(true));
        $c = $this->como(self::A)->getJson("/api/v1/crm/conversaciones/{$id}")->json('mensajes');
        $mio = collect($c)->firstWhere('id', $m->json('mensaje.id'));
        $this->assertSame(['Enviado', 'Ana Torres Lazo'], [$mio['estado_name'], $mio['sender_name']]);
        $this->assertEquals([0, 'Gratis (ventana de anuncio de 72 h)'], [$mio['costo']['amount'], $mio['costo']['reason']]);
        $this->como(self::SUPERVISORA)->postJson("/api/v1/crm/conversaciones/{$id}/mensajes", ['texto' => 'Te ayudo yo también.'])->assertCreated();

        // CA-CRM-02: fuera de la ventana de 24 h no sale un texto libre.
        $this->travel(25)->hours();
        $this->tokens = [];
        $this->como(self::A)->postJson("/api/v1/crm/conversaciones/{$id}/mensajes", ['texto' => '¿Sigues interesada?'])->assertStatus(422)
            ->assertJsonFragment(['message' => 'Fuera de la ventana de 24 h desde el último mensaje del cliente: solo se envía una plantilla aprobada.']);
    }

    public function test_numero_sin_proveedor_oficial_registra_sin_enviar_y_los_mensajes_no_se_editan(): void
    {
        // Ventas 1 (demostración): su conector de producción todavía no tiene el adaptador real instalado.
        $v1 = $this->enEmpresa(fn () => DB::table('messaging_channels')->where('number', '+51987650101')->value('id'));
        $id = $this->enEmpresa(fn () => DB::table('conversations')->where('channel_id', $v1)->where('status', '<>', 'CLOSED')->whereNotNull('assigned_user_id')->value('id'));
        $this->como(self::SUPERVISORA)->postJson("/api/v1/crm/conversaciones/{$id}/simular", ['tipo' => 'TEXT', 'texto' => 'Hola de nuevo'])->assertOk();
        $c = $this->como(self::SUPERVISORA)->getJson("/api/v1/crm/conversaciones/{$id}")->assertOk();
        $this->assertFalse($c->json('proveedor.conectado'));
        $m = $this->como(self::SUPERVISORA)->postJson("/api/v1/crm/conversaciones/{$id}/mensajes", ['texto' => 'Hola, te atiendo.'])->assertCreated();
        $this->assertSame('NOT_SENT', $m->json('mensaje.estado'));
        $this->assertStringContainsString('proveedor oficial', $m->json('mensaje.aviso'));
        $this->enEmpresa(fn () => $this->assertFalse(DB::table('outbox_messages')->where('ref', $m->json('mensaje.id'))->exists(), 'Sin proveedor no se encola: no va a la cola muerta'));

        // CA-CRM-09: ni la interfaz ni la API editan o borran un mensaje.
        $mid = $m->json('mensaje.id');
        $this->como(self::SUPERVISORA)->putJson("/api/v1/crm/conversaciones/{$id}/mensajes/{$mid}", ['body' => 'otro'])->assertStatus(422);
        $this->como(self::SUPERVISORA)->deleteJson("/api/v1/crm/conversaciones/{$id}/mensajes/{$mid}")->assertStatus(422);
        $this->enEmpresa(function () use ($mid) {
            foreach (["UPDATE conversation_messages SET body = 'x' WHERE id = '{$mid}'", "DELETE FROM conversation_messages WHERE id = '{$mid}'", 'DELETE FROM message_status_events', 'DELETE FROM contact_consents'] as $sql) {
                try {
                    DB::transaction(fn () => DB::statement($sql));
                    $this->fail("Se pudo: {$sql}");
                } catch (QueryException $e) {
                    $this->assertMatchesRegularExpression('/permission denied|permiso denegado/i', $e->getMessage());
                }
            }
        });
        // El cliente borra su mensaje: el original sigue visible con su estado.
        $this->como(self::SUPERVISORA)->postJson("/api/v1/crm/conversaciones/{$id}/simular", ['tipo' => 'DELETE'])->assertOk();
        $ultimoIn = collect($this->como(self::SUPERVISORA)->getJson("/api/v1/crm/conversaciones/{$id}")->json('mensajes'))->where('direction', 'IN')->last();
        $this->assertSame(['Hola de nuevo', true], [$ultimoIn['body'], $ultimoIn['borrado_cliente']]);
    }

    public function test_bandeja_por_persona_filtros_y_cifras(): void
    {
        $canal = $this->numeroDePrueba();
        $r = $this->entra($canal, '+15559900333', 'Quiero cotizar un pedido para el sábado');
        $a = $this->como(self::A)->getJson('/api/v1/crm/conversaciones?asignada=me')->assertOk();
        $this->assertContains($r['conversation_id'], array_column($a->json('data'), 'id'));
        $fila = collect($a->json('data'))->firstWhere('id', $r['conversation_id']);
        $this->assertSame(['WhatsApp', 'Ventas de prueba', 'Ana Torres Lazo', true], [$fila['kind_name'], $fila['channel_name'], $fila['assigned_name'], $fila['ventana_abierta']]);
        $this->assertStringContainsString('Automático', $fila['ultimo']['texto']);

        // La vendedora solo ve los números donde es miembro; la supervisora, los de su marca; la auditoría, sin responder.
        $soloA = collect($this->como(self::A)->getJson('/api/v1/crm/conversaciones?estado=ALL&per_page=200')->json('data'))->pluck('channel_id')->unique();
        $suyos = $this->enEmpresa(fn () => DB::table('channel_members')->where('user_id', DB::table('users')->where('email', self::A)->value('id'))->where('active', true)->pluck('channel_id'));
        $this->assertEmpty($soloA->diff($suyos)->all());
        $otra = $this->como(self::OTRA)->getJson("/api/v1/crm/conversaciones/{$r['conversation_id']}")->assertNotFound();
        $aud = $this->como(self::AUDITOR)->getJson("/api/v1/crm/conversaciones/{$r['conversation_id']}")->assertOk();
        $this->assertFalse($aud->json('puede.responder'));
        $this->assertGreaterThan(0, $this->como(self::GERENTE)->getJson('/api/v1/crm/conversaciones')->json('cifras.abiertas'));

        // Filtros y buscador.
        $this->assertSame([$r['conversation_id']], array_column($this->como(self::SUPERVISORA)->getJson("/api/v1/crm/conversaciones?canal={$canal}")->json('data'), 'id'));
        $this->assertSame([$r['conversation_id']], array_column($this->como(self::SUPERVISORA)->getJson('/api/v1/crm/conversaciones?buscar=9900333')->json('data'), 'id'));
        $this->assertSame(0, $this->como(self::SUPERVISORA)->getJson("/api/v1/crm/conversaciones?canal={$canal}&por_anuncio=1")->json('total'));
        $this->assertSame(0, $this->como(self::SUPERVISORA)->getJson("/api/v1/crm/conversaciones?canal={$canal}&asignada=none")->json('total'));
        // Sin responder: pasados 20 minutos en horario.
        $this->travelTo(now('America/Lima')->next('Tuesday')->setTime(10, 0));
        $this->tokens = [];
        $this->entra($canal, '+15559900444', 'Hola');
        $this->travel(20)->minutes();
        $this->tokens = [];
        $this->assertGreaterThanOrEqual(1, $this->como(self::SUPERVISORA)->getJson("/api/v1/crm/conversaciones?canal={$canal}&sin_responder=1")->json('total'));
    }

    public function test_reasignar_cerrar_reabrir_notas_y_etiquetas(): void
    {
        $canal = $this->numeroDePrueba();
        $id = $this->entra($canal, '+15559900555', 'Hola')['conversation_id'];
        // CA-CRM-11: la supervisora la pasa de A a B; B responde y A ya no. A una vendedora de otra marca, no.
        $this->como(self::A)->postJson("/api/v1/crm/conversaciones/{$id}/asignar", ['user_id' => $this->id(self::B)])->assertForbidden();
        $this->como(self::SUPERVISORA)->postJson("/api/v1/crm/conversaciones/{$id}/asignar", ['user_id' => $this->id(self::B), 'nota' => 'A sale a almorzar'])->assertOk()->assertJsonPath('assigned_name', 'Betty Ramos Cruz');
        $this->como(self::B)->postJson("/api/v1/crm/conversaciones/{$id}/mensajes", ['texto' => 'Hola, soy Betty.'])->assertCreated();
        $this->como(self::A)->postJson("/api/v1/crm/conversaciones/{$id}/mensajes", ['texto' => 'Hola'])->assertStatus(422);
        $this->como(self::SUPERVISORA)->postJson("/api/v1/crm/conversaciones/{$id}/asignar", ['user_id' => $this->id(self::OTRA)])->assertStatus(422);
        $this->enEmpresa(fn () => $this->assertSame(['AUTO_SHIFT', 'MANUAL_REASSIGN'], DB::table('conversation_assignments')->where('conversation_id', $id)->orderBy('assigned_at')->pluck('reason')->all()));
        // Devolver a la cola.
        $this->como(self::SUPERVISORA)->postJson("/api/v1/crm/conversaciones/{$id}/asignar", ['user_id' => null])->assertOk()->assertJsonPath('assigned_user_id', null);
        $this->como(self::SUPERVISORA)->postJson("/api/v1/crm/conversaciones/{$id}/asignar", ['user_id' => $this->id(self::B)])->assertOk();

        // Notas internas y etiquetas.
        $n = $this->como(self::B)->postJson("/api/v1/crm/conversaciones/{$id}/notas", ['texto' => 'Pide factura con RUC'])->assertOk();
        $this->assertSame(['Pide factura con RUC', 'Betty Ramos Cruz'], [$n->json('notas.0.text'), $n->json('notas.0.user_name')]);
        $this->como(self::B)->putJson("/api/v1/crm/conversaciones/{$id}/etiquetas", ['tags' => ['Mayorista', 'Evento']])->assertOk()->assertJsonPath('tags', ['Mayorista', 'Evento']);
        $this->como(self::B)->putJson("/api/v1/crm/conversaciones/{$id}/etiquetas", ['tags' => ['Inventada']])->assertStatus(422);

        // Cerrar con motivo: «pedido creado» exige un pedido vinculado; reabrir.
        $this->como(self::B)->postJson("/api/v1/crm/conversaciones/{$id}/cerrar", ['motivo' => 'ORDER_CREATED'])->assertStatus(422);
        $this->como(self::B)->postJson("/api/v1/crm/conversaciones/{$id}/cerrar", ['motivo' => 'INFO_ONLY'])->assertOk()->assertJsonPath('close_name', 'Solo información');
        $this->como(self::B)->postJson("/api/v1/crm/conversaciones/{$id}/mensajes", ['texto' => 'Hola'])->assertStatus(422);
        $this->como(self::B)->postJson("/api/v1/crm/conversaciones/{$id}/reabrir")->assertOk()->assertJsonPath('status', 'OPEN');
    }

    public function test_tiktok_48_horas_y_diez_seguidos_grupos_y_no_disponibles(): void
    {
        // CA-CRM-03 en la cuenta de TikTok de Don Guando (la supervisora responde todo).
        $tt = $this->enEmpresa(fn () => DB::table('messaging_channels')->where('kind', 'TIKTOK')->where('connection_mode', 'DM_API')->value('id'));
        $r = $this->enEmpresa(fn () => Recepcion::recibir(['channel_id' => $tt, 'from' => 'tt_user_998', 'name' => 'Usuario TikTok', 'text' => 'Precio del chancho?']));
        $id = $r['conversation_id'];
        for ($i = 1; $i <= 10; $i++) {
            $this->como(self::SUPERVISORA)->postJson("/api/v1/crm/conversaciones/{$id}/mensajes", ['texto' => "Mensaje {$i}"])->assertCreated();
        }
        $this->como(self::SUPERVISORA)->postJson("/api/v1/crm/conversaciones/{$id}/mensajes", ['texto' => 'El undécimo'])->assertStatus(422)
            ->assertJsonFragment(['message' => 'En TikTok se envían como máximo 10 mensajes seguidos sin respuesta del cliente.']);
        $this->enEmpresa(fn () => Recepcion::recibir(['channel_id' => $tt, 'from' => 'tt_user_998', 'text' => 'Ok']));
        $this->como(self::SUPERVISORA)->postJson("/api/v1/crm/conversaciones/{$id}/mensajes", ['texto' => 'Gracias'])->assertCreated();
        $this->travel(49)->hours();
        $this->tokens = [];
        $this->como(self::SUPERVISORA)->postJson("/api/v1/crm/conversaciones/{$id}/mensajes", ['texto' => '¿Sigues ahí?'])->assertStatus(422)
            ->assertJsonFragment(['message' => 'En TikTok solo se responde dentro de 48 h desde el último mensaje del cliente.']);

        // Grupos (coexistencia): se descartan y se cuentan. «Ver una vez»: queda como mensaje no disponible.
        $canal = $this->numeroDePrueba();
        $antes = $this->enEmpresa(fn () => (int) DB::table('messaging_channels')->where('id', $canal)->value('group_msgs_discarded'));
        $g = $this->enEmpresa(fn () => Recepcion::recibir(['channel_id' => $canal, 'from' => '+15559900666', 'group' => true]));
        $this->assertTrue($g['discarded']);
        $this->enEmpresa(fn () => $this->assertSame($antes + 1, (int) DB::table('messaging_channels')->where('id', $canal)->value('group_msgs_discarded')));
        $v = $this->enEmpresa(fn () => Recepcion::recibir(['channel_id' => $canal, 'from' => '+15559900666', 'type' => 'VIEW_ONCE']));
        $this->enEmpresa(fn () => $this->assertSame(['UNSUPPORTED', 'VIEW_ONCE'], array_values((array) DB::table('conversation_messages')->where('id', $v['message_id'])->first(['msg_type', 'unsupported_kind']))));
        // «BAJA» registra la baja de marketing.
        $b = $this->enEmpresa(fn () => Recepcion::recibir(['channel_id' => $canal, 'from' => '+15559900666', 'text' => 'BAJA']));
        $this->enEmpresa(fn () => $this->assertFalse((bool) DB::table('contact_consents')->where('purpose', 'MARKETING')->where('evidence_message_id', $b['message_id'])->value('granted')));
    }

    public function test_webhook_de_whatsapp_recibe_una_vez_y_actualiza_estados(): void
    {
        $canal = $this->numeroDePrueba();
        $conector = $this->enEmpresa(fn () => DB::table('integration_connectors')->where('code', 'WA-SBX')->first());
        $cuerpo = ['object' => 'whatsapp_business_account', 'entry' => [['id' => 'X', 'changes' => [['field' => 'messages', 'value' => [
            'messaging_product' => 'whatsapp', 'metadata' => ['display_phone_number' => '15550001111'],
            'contacts' => [['wa_id' => '15559900777', 'profile' => ['name' => 'Luis Webhook']]],
            'messages' => [['from' => '15559900777', 'id' => 'wamid.PRUEBA777', 'timestamp' => (string) now()->timestamp, 'type' => 'text', 'text' => ['body' => 'Hola desde WhatsApp'],
                'referral' => ['source_id' => 'DGGSR2', 'headline' => 'Promo de lomo']]],
        ]]]]]];
        $txt = $this->enEmpresa(fn () => Recepcion::webhookWhatsApp($cuerpo, $conector, (object) []));
        $this->assertStringContainsString('1 mensaje(s) recibido(s)', $txt);
        $this->enEmpresa(fn () => Recepcion::webhookWhatsApp($cuerpo, $conector, (object) []));   // repetido: no duplica
        $this->enEmpresa(function () use ($canal) {
            $this->assertSame(1, DB::table('conversation_messages')->where('external_id', 'wamid.PRUEBA777')->count());
            $cv = DB::table('conversations')->where('channel_id', $canal)->where('entry_point', 'CTWA_AD')->first();
            $this->assertSame('DGGSR2', $cv->ad_code);
            $this->assertNotNull($cv->free_entry_expires_at);
            $this->assertSame('Luis Webhook', DB::table('channel_contacts')->where('external_user_id', '+15559900777')->value('display_name'));
        });
        // El estado «leído» del aviso automático, por la referencia del proveedor.
        $this->enEmpresa(fn () => Salientes::procesar(true));
        $ref = $this->enEmpresa(fn () => DB::table('outbox_messages')->where('module', 'CRM')->whereNotNull('provider_ref')->orderByDesc('created_at')->value('provider_ref'));
        $estados = ['object' => 'whatsapp_business_account', 'entry' => [['changes' => [['value' => ['metadata' => ['display_phone_number' => '15550001111'],
            'statuses' => [['id' => $ref, 'status' => 'read', 'timestamp' => (string) now()->timestamp]]]]]]]];
        $this->assertStringContainsString('1 estado(s)', $this->enEmpresa(fn () => Recepcion::webhookWhatsApp($estados, $conector, (object) [])));
    }

    public function test_tiempo_sin_respuesta_solo_en_horario(): void
    {
        // Sábado 19:50 a lunes 08:10: 10 min del sábado, 5 h del domingo (09:00 a 14:00) y 10 min del lunes.
        $sab = Carbon::parse('2026-11-28 19:50', 'America/Lima');
        $lun = Carbon::parse('2026-11-30 08:10', 'America/Lima');
        $this->assertSame(320, $this->enEmpresa(fn () => Conversaciones::minutosHabiles($sab, $lun)));
        $this->assertSame(0, $this->enEmpresa(fn () => Conversaciones::minutosHabiles(Carbon::parse('2026-11-28 21:00', 'America/Lima'), Carbon::parse('2026-11-29 08:59', 'America/Lima'))));
    }
}
