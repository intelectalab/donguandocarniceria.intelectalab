<?php

namespace Tests\Feature\Modulos;

use App\Support\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/** CRM-03 Crear pedido desde el chat, CRM-04 Ficha 360 y CRM-05 Leads (RN-CRM-09, 10, 22; CA-CRM-08). */
class CrmPedidosLeadsTest extends TestCase
{
    private const ADMIN = 'lccahuana@donguando.pe';

    private const GERENTE = 'rquispe@donguando.pe';

    private const AUDITOR = 'aexterno@donguando.pe';

    private const SUPERVISORA = 'pleon@donguando.pe';

    private const A = 'ana.torres@donguando.pe';

    private const B = 'bramos@donguando.pe';

    private const CLIENTE = '+51998800000';

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

    /** Número de prueba con A en turno y en línea (B miembro, desconectada). Devuelve el canal. */
    private function numero(): string
    {
        $marca = $this->enEmpresa(fn () => DB::table('brands')->where('name', 'Don Guando')->value('id'));
        $canal = $this->como(self::ADMIN)->postJson('/api/v1/crm/canales', ['kind' => 'WHATSAPP', 'number' => '+15550001111', 'display_name' => 'Ventas de prueba', 'brand_id' => $marca,
            'connection_mode' => 'CLOUD_API', 'connector_id' => $this->enEmpresa(fn () => DB::table('integration_connectors')->where('code', 'WA-SBX')->value('id')),
            'assignment_mode' => 'SHIFT_ROUND_ROBIN', 'status' => 'ACTIVE', 'recording_notice_text' => 'Esta conversación queda registrada (Ley 29733).'])->assertCreated()->json('id');
        foreach ([self::A, self::B, self::SUPERVISORA] as $e) {
            $m = $this->como(self::ADMIN)->postJson("/api/v1/crm/canales/{$canal}/miembros", ['user_id' => $this->id($e)])->assertCreated()->json('id');
            $this->como(self::ADMIN)->putJson("/api/v1/crm/miembros/{$m}/turnos", ['turnos' => array_map(fn ($d) => ['weekday' => $d, 'from' => '00:00', 'to' => '23:59'], range(1, 7))])->assertOk();
        }
        $this->como(self::A)->postJson('/api/v1/crm/mi-estado', ['estado' => 'ONLINE'])->assertOk();
        $this->como(self::B)->postJson('/api/v1/crm/mi-estado', ['estado' => 'OFFLINE'])->assertOk();

        return $canal;
    }

    public function test_ca_crm_08_pedido_desde_el_chat_con_origen_fijo_lead_ganado_y_atribucion(): void
    {
        $canal = $this->numero();
        $r = $this->como(self::SUPERVISORA)->postJson('/api/v1/crm/simular', ['channel_id' => $canal, 'from' => '+15559900888', 'name' => 'Lucía Nueva', 'texto' => 'Hola, vi el anuncio', 'anuncio' => 'DGGSR1'])->assertCreated();
        $cv = $r->json('conversation_id');
        $p = $this->como(self::A)->getJson("/api/v1/crm/conversaciones/{$cv}/pedido")->assertOk();
        $this->assertSame(['WHATSAPP', '+15550001111', 'DGGSR1', 'Ana Torres Lazo', true], [$p->json('origen.canal'), $p->json('origen.numero'), $p->json('origen.anuncio'), $p->json('origen.vendedora'), $p->json('puede')]);
        $this->assertNull($p->json('cliente'));
        $this->assertSame('Lucía Nueva', $p->json('nuevo.full_name'));

        // Solo la asignada o la supervisora; la auditoría no.
        $this->como(self::B)->postJson("/api/v1/crm/conversaciones/{$cv}/pedido", [])->assertStatus(422);
        $this->como(self::AUDITOR)->postJson("/api/v1/crm/conversaciones/{$cv}/pedido", [])->assertForbidden();
        $o = $this->como(self::A)->postJson("/api/v1/crm/conversaciones/{$cv}/pedido", ['doc_number' => '12345678'])->assertCreated();
        $this->assertTrue($o->json('nuevo_cliente'));
        $oid = $o->json('id');

        $this->enEmpresa(function () use ($oid, $cv, $r) {
            $ped = DB::table('sales_orders')->where('id', $oid)->first();
            $this->assertSame(['DRAFT', 'WHATSAPP', '+15550001111', 'DGGSR1', true, $cv], [$ped->status, $ped->channel, $ped->origin_wa_number, $ped->origin_ad_code, (bool) $ped->origin_locked, $ped->conversation_id]);
            $this->assertSame(DB::table('users')->where('email', self::A)->value('id'), $ped->seller_id);
            $cliente = DB::table('customers')->where('id', $ped->customer_id)->first();
            $this->assertSame(['Lucía Nueva', '+15559900888', '12345678'], [$cliente->full_name, $cliente->phone, $cliente->doc_number]);
            $this->assertSame($cliente->id, DB::table('conversations')->where('id', $cv)->value('customer_id'));
            $lead = DB::table('leads')->where('id', $r->json('lead_id'))->first();
            $this->assertSame(['WON', $oid], [$lead->status, $lead->converted_order_id]);
            $att = DB::table('ad_attributions')->where('order_id', $oid)->first();
            $this->assertSame(['CTWA_REFERRAL', 'DGGSR1', true], [$att->method, $att->ad_code, (bool) $att->is_new_customer]);
            $this->assertNotNull($att->ad_id);
            // Un pedido pertenece a una sola conversación: el vínculo no se cambia.
            try {
                DB::transaction(fn () => DB::table('conversation_orders')->where('order_id', $oid)->delete());
                $this->fail('Se borró el vínculo del pedido');
            } catch (QueryException $e) {
                $this->assertMatchesRegularExpression('/permission denied|permiso denegado/i', $e->getMessage());
            }
        });
        // El panel de la conversación lo muestra; el resumen pide productos primero.
        $c = $this->como(self::A)->getJson("/api/v1/crm/conversaciones/{$cv}")->assertOk();
        $this->assertSame($o->json('number'), $c->json('pedidos_chat.0.number'));
        $this->assertTrue($c->json('es_cliente'));
        $this->como(self::A)->postJson("/api/v1/crm/conversaciones/{$cv}/resumen", ['order_id' => $oid])->assertStatus(422);
    }

    public function test_resumen_del_pedido_en_un_solo_mensaje_con_la_plantilla_de_confirmacion(): void
    {
        $canal = $this->numero();
        $cv = $this->como(self::SUPERVISORA)->postJson('/api/v1/crm/simular', ['channel_id' => $canal, 'from' => self::CLIENTE, 'texto' => 'Quiero lo de siempre'])->assertCreated()->json('conversation_id');
        $p = $this->como(self::A)->getJson("/api/v1/crm/conversaciones/{$cv}/pedido")->assertOk();
        $this->assertNotNull($p->json('cliente.id'));
        $this->assertNotEmpty($p->json('direcciones'), 'Toma la última dirección guardada');
        $oid = $this->como(self::A)->postJson("/api/v1/crm/conversaciones/{$cv}/pedido", [])->assertCreated()->json('id');
        $this->assertFalse($this->como(self::A)->getJson("/api/v1/crm/conversaciones/{$cv}")->json('pedidos_chat.0.resumen_enviado'));
        // Lo que se completa en Pedidos: un producto, la fecha y la franja.
        $this->enEmpresa(function () use ($oid) {
            $v = DB::table('product_variants as v')->join('brands as b', 'b.id', '=', 'v.brand_id')->where('b.name', 'Don Guando')->where('v.status', 'ACTIVE')->where('v.sellable', true)->value('v.id');
            DB::table('sales_order_lines')->insert(['sales_order_id' => $oid, 'line_no' => 1, 'variant_id' => $v, 'qty' => 2, 'unit_price' => 10, 'list_price' => 10, 'price_basis' => 'UNIT', 'est_amount' => 20,
                'price_list_id' => DB::table('price_lists')->value('id')]);
            DB::table('sales_orders')->where('id', $oid)->update(['delivery_date' => now()->addDay()->toDateString(), 'slot_from' => '09:00', 'slot_to' => '13:00', 'estimated_total' => 20]);
        });
        $r = $this->como(self::A)->postJson("/api/v1/crm/conversaciones/{$cv}/resumen", ['order_id' => $oid])->assertCreated();
        $ultimo = collect($r->json('conversacion.mensajes'))->last();
        $this->assertSame(['TEMPLATE', 'confirmacion_pedido'], [$ultimo['msg_type'], $ultimo['template_name']]);
        $this->assertStringContainsString('Yape', $ultimo['body']);
        $this->assertStringNotContainsString('{{', $ultimo['body']);
        $this->assertTrue($r->json('conversacion.pedidos_chat.0.resumen_enviado'));
    }

    public function test_ficha_360_por_persona_con_pedidos_chats_consentimientos_y_recompra(): void
    {
        $id = $this->enEmpresa(fn () => DB::table('customers')->where('phone', self::CLIENTE)->value('id'));
        $l = $this->como(self::GERENTE)->getJson('/api/v1/crm/clientes?buscar=998800000')->assertOk();
        $this->assertContains($id, array_column($l->json('data'), 'id'));
        $f = $this->como(self::GERENTE)->getJson("/api/v1/crm/clientes/{$id}")->assertOk();
        $this->assertGreaterThan(0, $f->json('cifras.pedidos'));
        $this->assertGreaterThanOrEqual(0, $f->json('cifras.valor_vida'));
        $this->assertNotEmpty($f->json('pedidos'));
        $this->assertNotEmpty($f->json('direcciones'));
        $this->assertNull($f->json('llamadas'), 'Telefonía apagada en Don Guando');
        $this->assertIsArray($f->json('consentimientos'));
        $this->assertIsArray($f->json('recompra'));

        // La vendedora ve solo clientes de las conversaciones de sus números.
        $suyos = $this->como(self::A)->getJson('/api/v1/crm/clientes?per_page=200')->assertOk();
        $deSusChats = $this->enEmpresa(fn () => DB::table('conversations as v')->join('channel_members as m', 'm.channel_id', '=', 'v.channel_id')
            ->where('m.user_id', DB::table('users')->where('email', self::A)->value('id'))->where('m.active', true)->whereNotNull('v.customer_id')->distinct()->pluck('v.customer_id')->all());
        $this->assertEmpty(array_diff(array_column($suyos->json('data'), 'id'), $deSusChats));
        $ajeno = $this->enEmpresa(fn () => DB::table('customers')->whereNotIn('id', $deSusChats)->where('status', '<>', 'INACTIVE')->whereNull('merged_into_id')->value('id'));
        $this->como(self::A)->getJson("/api/v1/crm/clientes/{$ajeno}")->assertNotFound();
        $this->como('mcardenas@donguando.pe')->getJson('/api/v1/crm/clientes')->assertForbidden();
    }

    public function test_leads_embudo_estados_con_motivo_y_lead_manual(): void
    {
        $l = $this->como(self::GERENTE)->getJson('/api/v1/crm/leads?per_page=200')->assertOk();
        $embudo = collect($l->json('embudo'))->keyBy('estado');
        $this->assertSame($l->json('total'), collect($l->json('embudo'))->sum('n'));
        $this->assertGreaterThan(0, $embudo['LOST']['n']);
        $this->assertSame($embudo['LOST']['n'], $this->como(self::GERENTE)->getJson('/api/v1/crm/leads?estado=LOST')->json('total'));
        $perdido = collect($this->como(self::GERENTE)->getJson('/api/v1/crm/leads?estado=LOST')->json('data'))->first();
        $this->assertNotNull($perdido['lost_name']);

        // Estados: ganado solo con pedido; perdido con motivo; un ganado ya no cambia.
        $nuevo = collect($l->json('data'))->firstWhere('status', 'NEW') ?? collect($l->json('data'))->firstWhere('status', 'CONTACTED');
        $this->como(self::SUPERVISORA)->postJson("/api/v1/crm/leads/{$nuevo['id']}/estado", ['estado' => 'WON'])->assertStatus(422);
        $this->como(self::SUPERVISORA)->postJson("/api/v1/crm/leads/{$nuevo['id']}/estado", ['estado' => 'LOST'])->assertStatus(422);
        $this->como(self::SUPERVISORA)->postJson("/api/v1/crm/leads/{$nuevo['id']}/estado", ['estado' => 'QUALIFIED', 'nota' => 'Pide precio por mayor'])->assertOk()->assertJsonPath('status_name', 'Calificado');
        $x = $this->como(self::SUPERVISORA)->postJson("/api/v1/crm/leads/{$nuevo['id']}/estado", ['estado' => 'LOST', 'motivo' => 'PRICE'])->assertOk();
        $this->assertSame(['LOST', 'Precio'], [$x->json('status'), $x->json('lost_name')]);
        $this->assertStringContainsString('Pide precio por mayor', $x->json('notes'));
        $ganado = collect($l->json('data'))->firstWhere('status', 'WON');
        $this->como(self::SUPERVISORA)->postJson("/api/v1/crm/leads/{$ganado['id']}/estado", ['estado' => 'DISCARDED'])->assertStatus(422);
        $this->como(self::AUDITOR)->postJson("/api/v1/crm/leads/{$nuevo['id']}/estado", ['estado' => 'QUALIFIED'])->assertForbidden();

        // Lead a mano: no si ya es cliente; formato del celular; uno abierto por celular.
        $marca = $this->enEmpresa(fn () => DB::table('brands')->where('name', 'Don Guando')->value('id'));
        $base = ['full_name' => 'Restaurante El Buen Sabor', 'brand_id' => $marca, 'source' => 'PHONE'];
        $this->como(self::A)->postJson('/api/v1/crm/leads', $base + ['phone' => self::CLIENTE])->assertStatus(422);
        $this->como(self::A)->postJson('/api/v1/crm/leads', $base + ['phone' => '12345'])->assertStatus(422);
        $m = $this->como(self::A)->postJson('/api/v1/crm/leads', $base + ['phone' => '955000111'])->assertCreated();
        $this->assertSame(['NEW', '+51955000111', 'Teléfono', 'Ana Torres Lazo'], [$m->json('status'), $m->json('phone'), $m->json('source_name'), $m->json('vendedora')]);
        $this->como(self::A)->postJson('/api/v1/crm/leads', $base + ['phone' => '+51955000111'])->assertStatus(422);
        $this->assertContains($m->json('id'), array_column($this->como(self::A)->getJson('/api/v1/crm/leads?buscar=Buen%20Sabor')->json('data'), 'id'));
        $this->assertNotNull($l->json('conversion'));

        // Tablero kanban: hasta 25 por columna, sin descartados, sin páginas; el estado de la URL no lo recorta.
        $t = $this->como(self::GERENTE)->getJson('/api/v1/crm/leads?tablero=1&estado=LOST')->assertOk();
        $porEstado = collect($t->json('data'))->countBy('status');
        $this->assertSame(1, $t->json('last_page'));
        $this->assertFalse($porEstado->has('DISCARDED'));
        $this->assertTrue($porEstado->every(fn ($n) => $n <= 25));
        $this->assertGreaterThan(1, $porEstado->count());
        $this->assertArrayHasKey('conversacion', $t->json('data.0'));
    }
}
