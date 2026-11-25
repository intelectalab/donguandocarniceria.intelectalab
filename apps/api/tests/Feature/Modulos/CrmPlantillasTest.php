<?php

namespace Tests\Feature\Modulos;

use App\Modulos\Crm\Services\Costos;
use App\Modulos\Crm\Services\Mensajes;
use App\Modulos\Int\Services\Salientes;
use App\Support\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/** CRM-09 Plantillas, CRM-10 Respuestas rápidas y catálogo, CRM-11 Costo de WhatsApp (RN-CRM-07, 08, 13; CA-CRM-04, 05, 12). */
class CrmPlantillasTest extends TestCase
{
    private const ADMIN = 'lccahuana@donguando.pe';

    private const GERENTE = 'rquispe@donguando.pe';

    private const MARKETING = 'lparedes@donguando.pe';

    private const SUPERVISORA = 'pleon@donguando.pe';

    private const A = 'ana.torres@donguando.pe';

    private const CLIENTE = '+51998800000';   // cliente de Don Guando con pedidos

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

    private function plantilla(string $nombre): string
    {
        return $this->enEmpresa(fn () => DB::table('message_templates as t')->join('brands as b', 'b.id', '=', 't.brand_id')->where('b.name', 'Don Guando')->where('t.name', $nombre)->value('t.id'));
    }

    /** Número de prueba (conector falso) con A en turno y en línea; entra un mensaje del cliente con pedidos. Devuelve la conversación. */
    private function conversacionConCliente(): string
    {
        $marca = $this->enEmpresa(fn () => DB::table('brands')->where('name', 'Don Guando')->value('id'));
        $canal = $this->como(self::ADMIN)->postJson('/api/v1/crm/canales', ['kind' => 'WHATSAPP', 'number' => '+15550001111', 'display_name' => 'Ventas de prueba', 'brand_id' => $marca,
            'connection_mode' => 'CLOUD_API', 'connector_id' => $this->enEmpresa(fn () => DB::table('integration_connectors')->where('code', 'WA-SBX')->value('id')),
            'assignment_mode' => 'SHIFT_ROUND_ROBIN', 'status' => 'ACTIVE', 'recording_notice_text' => 'Esta conversación queda registrada (Ley 29733).'])->assertCreated()->json('id');
        $m = $this->como(self::ADMIN)->postJson("/api/v1/crm/canales/{$canal}/miembros", ['user_id' => $this->id(self::A)])->assertCreated()->json('id');
        $this->como(self::ADMIN)->putJson("/api/v1/crm/miembros/{$m}/turnos", ['turnos' => array_map(fn ($d) => ['weekday' => $d, 'from' => '00:00', 'to' => '23:59'], range(1, 7))])->assertOk();
        $this->como(self::ADMIN)->postJson("/api/v1/crm/canales/{$canal}/miembros", ['user_id' => $this->id(self::SUPERVISORA)])->assertCreated();
        $this->como(self::A)->postJson('/api/v1/crm/mi-estado', ['estado' => 'ONLINE'])->assertOk();

        return $this->como(self::SUPERVISORA)->postJson('/api/v1/crm/simular', ['channel_id' => $canal, 'from' => self::CLIENTE, 'texto' => 'Hola, ¿cuánto debo de mi pedido?'])
            ->assertCreated()->json('conversation_id');
    }

    public function test_plantillas_borrador_revision_y_aprobacion_con_texto_fijo(): void
    {
        $l = $this->como(self::GERENTE)->getJson('/api/v1/crm/plantillas')->assertOk();
        $this->assertSame([30, 5, 2, 2], [$l->json('cifras.aprobadas'), $l->json('cifras.revision'), $l->json('cifras.rechazadas'), $l->json('cifras.tope')]);
        $conf = collect($l->json('data'))->firstWhere('name', 'confirmacion_pedido');
        $this->assertEquals([0.0998, 0], [$conf['costo_fuera'], $conf['costo_dentro']]);
        $this->assertGreaterThan(0, $conf['envios']);
        $this->assertSame(5, $this->como(self::GERENTE)->getJson('/api/v1/crm/plantillas?estado=PENDING')->json('total'));
        $this->assertSame(['recompra_frecuente'], array_column($this->como(self::GERENTE)->getJson('/api/v1/crm/plantillas?buscar=recompra&marca='.$conf['brand_id'])->json('data'), 'name'));
        $this->como(self::A)->getJson('/api/v1/crm/plantillas')->assertForbidden();

        $marca = $conf['brand_id'];
        $base = ['brand_id' => $marca, 'name' => 'aviso_feriado', 'category' => 'UTILITY', 'purpose' => 'OTHER', 'body' => 'Hola {{cliente}}, el feriado atendemos de 9 a 1. {{marca}}'];
        $this->como(self::MARKETING)->postJson('/api/v1/crm/plantillas', ['name' => 'Aviso Feriado'] + $base)->assertStatus(422);
        $this->como(self::MARKETING)->postJson('/api/v1/crm/plantillas', ['name' => 'confirmacion_pedido'] + $base)->assertStatus(422);
        $this->como(self::SUPERVISORA)->postJson('/api/v1/crm/plantillas', $base)->assertForbidden();
        $t = $this->como(self::MARKETING)->postJson('/api/v1/crm/plantillas', $base)->assertCreated();
        $this->assertSame(['DRAFT', ['cliente', 'marca']], [$t->json('status'), $t->json('variables')]);
        $this->assertStringContainsString('Hola María', $t->json('ejemplo'));
        $id = $t->json('id');

        $this->como(self::MARKETING)->postJson("/api/v1/crm/plantillas/{$id}/revision")->assertOk()->assertJsonPath('status', 'PENDING');
        $this->como(self::MARKETING)->putJson("/api/v1/crm/plantillas/{$id}", ['body' => 'Otro texto para el feriado de octubre'] + $base)->assertStatus(422);
        $this->como(self::MARKETING)->postJson("/api/v1/crm/plantillas/{$id}/respuesta", ['aprobada' => false])->assertStatus(422);
        $this->como(self::MARKETING)->postJson("/api/v1/crm/plantillas/{$id}/respuesta", ['aprobada' => true])->assertOk()->assertJsonPath('status', 'APPROVED');
        // Ni por la base cambia el texto de una aprobada.
        $this->enEmpresa(function () use ($id) {
            try {
                DB::transaction(fn () => DB::table('message_templates')->where('id', $id)->update(['body' => 'cambiado']));
                $this->fail('Se cambió el texto de una plantilla aprobada');
            } catch (QueryException $e) {
                $this->assertStringContainsString('RN-CRM-07', $e->getMessage());
            }
        });
    }

    public function test_plantillas_en_la_conversacion_tope_de_utilidad_y_marketing_con_consentimiento(): void
    {
        $cv = $this->conversacionConCliente();
        $p = $this->como(self::A)->getJson("/api/v1/crm/conversaciones/{$cv}/plantillas")->assertOk();
        $pedido = $p->json('pedidos.0.value');
        $this->assertNotNull($pedido, 'El cliente tiene pedidos de la marca');
        $this->assertSame(2, $p->json('tope'));

        // Faltan datos sin pedido; con el pedido sale.
        $this->como(self::A)->postJson("/api/v1/crm/conversaciones/{$cv}/plantillas", ['template_id' => $this->plantilla('recordatorio_pago')])->assertStatus(422);
        $r1 = $this->como(self::A)->postJson("/api/v1/crm/conversaciones/{$cv}/plantillas", ['template_id' => $this->plantilla('recordatorio_pago'), 'order_id' => $pedido])->assertCreated();
        $this->assertSame('QUEUED', $r1->json('mensaje.estado'));
        $this->assertSame('TEMPLATE', collect($r1->json('conversacion.mensajes'))->last()['msg_type']);
        $this->assertSame('recordatorio_pago', collect($r1->json('conversacion.mensajes'))->last()['template_name']);
        $this->como(self::A)->postJson("/api/v1/crm/conversaciones/{$cv}/plantillas", ['template_id' => $this->plantilla('diferencia_peso'), 'order_id' => $pedido])->assertCreated();
        // RN-CRM-07: una tercera de utilidad para el mismo pedido solo la supervisora, como adicional.
        $antes = $this->enEmpresa(fn () => DB::table('conversation_messages')->where('order_id', $pedido)->where('category', 'UTILITY')->where('msg_type', 'TEMPLATE')->count());
        if ($antes >= 2) {
            $this->como(self::A)->postJson("/api/v1/crm/conversaciones/{$cv}/plantillas", ['template_id' => $this->plantilla('encuesta_posentrega'), 'order_id' => $pedido])->assertStatus(422);
            $this->como(self::A)->postJson("/api/v1/crm/conversaciones/{$cv}/plantillas", ['template_id' => $this->plantilla('encuesta_posentrega'), 'order_id' => $pedido, 'extra' => true])->assertStatus(422);
            $this->como(self::SUPERVISORA)->postJson("/api/v1/crm/conversaciones/{$cv}/plantillas", ['template_id' => $this->plantilla('encuesta_posentrega'), 'order_id' => $pedido, 'extra' => true])->assertCreated();
        }
        // Solo aprobadas y de la marca del número.
        $this->como(self::SUPERVISORA)->postJson("/api/v1/crm/conversaciones/{$cv}/plantillas", ['template_id' => $this->plantilla('promo_fin_de_semana')])->assertStatus(422);
        $otra = $this->enEmpresa(fn () => DB::table('message_templates as t')->join('brands as b', 'b.id', '=', 't.brand_id')->where('b.name', '<>', 'Don Guando')->where('t.provider_status', 'APPROVED')->value('t.id'));
        $this->como(self::SUPERVISORA)->postJson("/api/v1/crm/conversaciones/{$cv}/plantillas", ['template_id' => $otra])->assertStatus(422);

        // CA-CRM-12: marketing sin consentimiento no; con el «sí» registrado, sí (y lleva la baja); tras «BAJA», otra vez no.
        $mk = $this->plantilla('recompra_frecuente');
        $this->como(self::SUPERVISORA)->postJson("/api/v1/crm/conversaciones/{$cv}/consentimiento", ['otorgado' => false, 'evidencia' => 'Prueba: dejamos sin consentimiento'])->assertOk();
        $this->como(self::SUPERVISORA)->postJson("/api/v1/crm/conversaciones/{$cv}/plantillas", ['template_id' => $mk])->assertStatus(422)->assertJsonFragment(['message' => 'El cliente no tiene consentimiento de marketing vigente (último registro: dio de baja). Registra su «sí» con evidencia antes de enviar.']);
        $this->como(self::A)->postJson("/api/v1/crm/conversaciones/{$cv}/consentimiento", ['otorgado' => true, 'evidencia' => 'Escribió «sí, avísenme de ofertas» por WhatsApp'])->assertOk()
            ->assertJsonPath('cliente.marketing', true);
        $this->como(self::A)->postJson("/api/v1/crm/conversaciones/{$cv}/plantillas", ['template_id' => $mk])->assertStatus(422);   // la vendedora no envía marketing
        $m = $this->como(self::SUPERVISORA)->postJson("/api/v1/crm/conversaciones/{$cv}/plantillas", ['template_id' => $mk])->assertCreated();
        $this->assertStringEndsWith('Si no deseas recibir promociones, responde BAJA.', collect($m->json('conversacion.mensajes'))->last()['body']);
        $this->como(self::SUPERVISORA)->postJson("/api/v1/crm/conversaciones/{$cv}/simular", ['tipo' => 'TEXT', 'texto' => 'BAJA'])->assertOk();
        $this->como(self::SUPERVISORA)->postJson("/api/v1/crm/conversaciones/{$cv}/plantillas", ['template_id' => $mk])->assertStatus(422);

        // Costos: la utilidad dentro de la ventana es gratis; el marketing se cobra con su tarifa.
        $this->enEmpresa(fn () => Salientes::procesar(true));
        $cobros = $this->enEmpresa(fn () => DB::table('message_charges')->where('conversation_id', $cv)->pluck('reason', 'category')->all());
        $this->assertSame('FREE_UTILITY_IN_WINDOW', $cobros['UTILITY']);
        $this->assertSame('CHARGED', $cobros['MARKETING']);
        $this->enEmpresa(fn () => $this->assertEquals(0.2339, (float) DB::table('message_charges')->where('conversation_id', $cv)->where('category', 'MARKETING')->value('amount')));
        $this->enEmpresa(function () {
            try {
                DB::transaction(fn () => DB::statement('UPDATE message_charges SET amount = 0'));
                $this->fail('Se cambió un costo');
            } catch (QueryException $e) {
                $this->assertMatchesRegularExpression('/permission denied|permiso denegado/i', $e->getMessage());
            }
        });
    }

    public function test_cuota_de_respuestas_gratis_y_simulador_del_mes(): void
    {
        // CA-CRM-04 con una cuota pequeña: agotadas las respuestas gratis, la siguiente cuesta S/ 0,0998.
        $cv = $this->conversacionConCliente();
        $canal = $this->enEmpresa(fn () => DB::table('conversations')->where('id', $cv)->value('channel_id'));
        $this->enEmpresa(fn () => DB::statement('UPDATE messaging_channels SET free_service_quota = 2 WHERE id = ?', [$canal]));
        $this->enEmpresa(fn () => Salientes::procesar(true));   // el aviso de registro: 1 de 2
        $this->como(self::A)->postJson("/api/v1/crm/conversaciones/{$cv}/mensajes", ['texto' => 'Hola, ya te reviso.'])->assertCreated();   // 2 de 2
        $this->enEmpresa(fn () => Salientes::procesar(true));
        $c = $this->como(self::A)->getJson("/api/v1/crm/conversaciones/{$cv}")->json('costo_proximo');
        $this->assertSame([2, 2], [$c['usadas'], $c['cuota']]);
        $this->assertEquals(0.0998, $c['servicio']['amount']);
        $this->assertEquals(0.2339, $c['marketing']['amount']);
        $this->assertEquals(0, $c['utilidad']['amount']);
        $this->como(self::A)->postJson("/api/v1/crm/conversaciones/{$cv}/mensajes", ['texto' => 'Tu saldo es S/ 0.'])->assertCreated();
        $this->enEmpresa(fn () => Salientes::procesar(true));
        $this->enEmpresa(fn () => $this->assertSame(1, DB::table('message_charges')->where('conversation_id', $cv)->where('category', 'SERVICE')->where('reason', 'CHARGED')->count(), 'La tercera respuesta, ya sin cuota, se cobra'));

        // CA-CRM-05: 1000 pedidos por 2 números, 10 respuestas y 2 utilidades fuera de ventana: ≈ S/ 1000; con la mitad por anuncio, ≈ S/ 400.
        $s = Costos::simular(1000, 2, 10, 2, 0);
        $this->assertSame([798.4, 199.6, 998.0], [$s['servicio'], $s['utilidad'], $s['total']]);
        $this->assertEqualsWithDelta(400, Costos::simular(1000, 2, 10, 2, 0.5)['total'], 2);
        $this->como(self::GERENTE)->getJson('/api/v1/crm/costos/simular?pedidos=1000&numeros=2&respuestas=10&utilidades=2&por_anuncio=0')->assertOk()->assertJsonPath('total', 998);
    }

    public function test_costo_del_mes_por_numero_marca_vendedora_y_pedido(): void
    {
        $c = $this->como(self::GERENTE)->getJson('/api/v1/crm/costos')->assertOk();
        $this->assertSame('2026-10', $c->json('mes'));
        $this->assertGreaterThan(0, $c->json('cifras.mensajes'));
        $this->assertGreaterThan(0, $c->json('cifras.gratis_anuncio'));
        $this->assertGreaterThan(0, $c->json('cifras.ahorro_anuncio'));
        $num = collect($c->json('por_numero'))->first();
        $this->assertArrayHasKey('usadas', $num);
        $this->assertNotEmpty($c->json('por_marca'));
        $this->assertContains('Automáticos (sistema)', array_column($c->json('por_vendedora'), 'nombre'));
        $this->assertEquals(0.2339, $c->json('tarifas.marketing'));
        $this->assertSame(31, $c->json('cifras.dias'));
        $this->como(self::A)->getJson('/api/v1/crm/costos')->assertForbidden();
        $this->como('mcardenas@donguando.pe')->getJson('/api/v1/crm/costos')->assertForbidden();
    }

    public function test_respuestas_rapidas_personales_y_de_marca_y_catalogo(): void
    {
        $marca = $this->enEmpresa(fn () => DB::table('brands')->where('name', 'Don Guando')->value('id'));
        $this->como(self::A)->postJson('/api/v1/crm/respuestas', ['shortcut' => 'hola', 'body' => 'Hola', 'status' => 'ACTIVE', 'alcance' => 'ME'])->assertStatus(422);
        $mia = $this->como(self::A)->postJson('/api/v1/crm/respuestas', ['shortcut' => '/gracias_compra', 'body' => '¡Gracias por tu compra!', 'status' => 'ACTIVE', 'alcance' => 'ME'])->assertCreated()->json('id');
        $this->como(self::A)->postJson('/api/v1/crm/respuestas', ['shortcut' => '/gracias_compra', 'body' => 'Otra', 'status' => 'ACTIVE', 'alcance' => 'ME'])->assertStatus(422);
        $this->como(self::A)->postJson('/api/v1/crm/respuestas', ['shortcut' => '/horario_feriado', 'body' => 'Atendemos de 8 a 8', 'status' => 'ACTIVE', 'alcance' => $marca])->assertStatus(422);
        $deMarca = $this->como(self::SUPERVISORA)->postJson('/api/v1/crm/respuestas', ['shortcut' => '/horario_feriado', 'body' => 'Atendemos de 8 a 8', 'status' => 'ACTIVE', 'alcance' => $marca])->assertCreated()->json('id');
        $this->como(self::A)->putJson("/api/v1/crm/respuestas/{$deMarca}", ['shortcut' => '/horario_feriado', 'body' => 'cambio', 'status' => 'ACTIVE', 'alcance' => $marca])->assertStatus(422);
        $l = $this->como(self::A)->getJson('/api/v1/crm/respuestas?per_page=200')->assertOk();
        $this->assertContains($mia, array_column($l->json('data'), 'id'));
        $this->assertContains($deMarca, array_column($l->json('data'), 'id'));
        $this->assertSame(['/gracias_compra'], array_column($this->como(self::A)->getJson('/api/v1/crm/respuestas?alcance=ME&buscar=gracias_compra')->json('data'), 'shortcut'));
        // La de otra persona no aparece.
        $this->assertNotContains($mia, array_column($this->como(self::SUPERVISORA)->getJson('/api/v1/crm/respuestas?per_page=200')->json('data'), 'id'));

        // Catálogo: publicado = activo con precio de WhatsApp vigente; se envía en la conversación dentro de la ventana.
        $cat = $this->como(self::A)->getJson('/api/v1/crm/catalogo?marca='.$marca.'&estado=PUBLICADO&per_page=200')->assertOk();
        $this->assertGreaterThan(0, $cat->json('cifras.publicados'));
        $producto = $cat->json('data.0');
        $this->assertNotNull($producto['precio']);
        $cv = $this->conversacionConCliente();
        $this->assertNotEmpty($this->como(self::A)->getJson("/api/v1/crm/conversaciones/{$cv}/catalogo")->json('data'));
        $e = $this->como(self::A)->postJson("/api/v1/crm/conversaciones/{$cv}/producto", ['variant_id' => $producto['id']])->assertCreated();
        $ultimo = collect($e->json('conversacion.mensajes'))->last();
        $this->assertSame('PRODUCT', $ultimo['msg_type']);
        $this->assertStringContainsString($producto['name'], $ultimo['body']);
        $inactivo = $this->enEmpresa(fn () => DB::table('product_variants')->where('brand_id', $marca)->where('status', '<>', 'ACTIVE')->value('id'));
        if ($inactivo) {
            $this->como(self::A)->postJson("/api/v1/crm/conversaciones/{$cv}/producto", ['variant_id' => $inactivo])->assertStatus(422);
        }
        $this->como(self::A)->postJson('/api/v1/crm/catalogo/sincronizar')->assertForbidden();
        $this->assertGreaterThan(0, $this->como(self::ADMIN)->postJson('/api/v1/crm/catalogo/sincronizar')->assertOk()->json('numeros'));
    }

    public function test_tarifa_desde_la_app_del_celular_no_se_cobra(): void
    {
        $this->enEmpresa(function () {
            $cv = DB::table('conversations')->first();
            $ch = DB::table('messaging_channels')->where('kind', 'WHATSAPP')->first();
            $cv->free_entry_expires_at = null;
            $this->assertSame('BUSINESS_APP', Mensajes::tarifa('SERVICE', $cv, $ch, 'BUSINESS_APP')['reason']);
        });
    }
}
