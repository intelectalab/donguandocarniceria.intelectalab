<?php

namespace Tests\Feature\Modulos;

use App\Modulos\Crm\Services\Recompra;
use App\Support\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/** CRM-15 Recompra y CRM-16 Encuesta posentrega (RN-CRM-19 y 20; CA-CRM-10 y 12). */
class CrmPosventaTest extends TestCase
{
    private const ADMIN = 'lccahuana@donguando.pe';

    private const SUPERVISORA = 'pleon@donguando.pe';

    private const MARKETING = 'lparedes@donguando.pe';

    private const CONTADORA = 'mcardenas@donguando.pe';

    private const A = 'ana.torres@donguando.pe';

    private const B = 'bramos@donguando.pe';

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

    private function falla(callable $f): void
    {
        try {
            // En un punto de guardado: el error no deja abortada la transacción de la prueba.
            $this->enEmpresa(fn () => DB::transaction($f));
            $this->fail('La base debió rechazarlo');
        } catch (QueryException) {
            $this->assertTrue(true);
        }
    }

    private function numero(): string
    {
        $marca = $this->enEmpresa(fn () => DB::table('brands')->where('name', 'Don Guando')->value('id'));
        $canal = $this->como(self::ADMIN)->postJson('/api/v1/crm/canales', ['kind' => 'WHATSAPP', 'number' => '+15550004444', 'display_name' => 'Posventa de prueba', 'brand_id' => $marca,
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

    /** Un pedido creado desde un chat nuevo y marcado como entregado hace 3 h. Devuelve [conversación, pedido]. */
    private function entregado(string $canal, string $de): array
    {
        $cv = $this->como(self::SUPERVISORA)->postJson('/api/v1/crm/simular', ['channel_id' => $canal, 'from' => $de, 'name' => 'Cliente posventa', 'texto' => 'Quiero un pedido'])
            ->assertCreated()->json('conversation_id');
        $o = $this->como(self::A)->postJson("/api/v1/crm/conversaciones/{$cv}/pedido", [])->assertCreated()->json('id');
        $this->enEmpresa(fn () => DB::table('sales_orders')->where('id', $o)->update(['status' => 'DELIVERED', 'delivered_at' => now()->subHours(3), 'imported' => true]));   // importado: sin los datos de entrega que exige Pedidos

        return [$cv, $o];
    }

    public function test_ca_crm_10_frecuencia_fecha_esperada_y_tarea(): void
    {
        $p = $this->enEmpresa(fn () => Recompra::calcular(['2026-01-01', '2026-01-16', '2026-01-31', '2026-01-31'], Carbon::parse('2026-02-10')));
        $this->assertSame([3, 15.0, '2026-02-15', '2026-02-12', 'ACTIVE'], [$p['orders_count'], $p['median_interval_days'], $p['next_expected_at'], $p['due_task_at'], $p['status']]);
        $this->assertSame('DUE', $this->enEmpresa(fn () => Recompra::calcular(['2026-01-01', '2026-01-16', '2026-01-31'], Carbon::parse('2026-02-13')))['status']);
        $this->assertSame('AT_RISK', $this->enEmpresa(fn () => Recompra::calcular(['2026-01-01', '2026-01-16', '2026-01-31'], Carbon::parse('2026-02-24')))['status']);
        $this->assertSame('LOST', $this->enEmpresa(fn () => Recompra::calcular(['2026-01-01', '2026-01-16', '2026-01-31'], Carbon::parse('2026-03-20')))['status']);
        $nuevo = $this->enEmpresa(fn () => Recompra::calcular(['2026-01-01', '2026-01-16'], Carbon::parse('2026-02-10')));
        $this->assertSame(['NEW', null, null], [$nuevo['status'], $nuevo['median_interval_days'], $nuevo['due_task_at']]);
    }

    public function test_recalcular_una_sola_tarea_por_cliente_y_marca_y_quien_ve(): void
    {
        // La migración cerró la tarea de recompra repetida de la demostración y dejó la más reciente.
        $this->assertSame(0, $this->enEmpresa(fn () => DB::table('crm_tasks')->where('task_type', 'REBUY')->where('status', 'OPEN')
            ->selectRaw('customer_id, brand_id')->groupBy('customer_id', 'brand_id')->havingRaw('count(*) > 1')->get()->count()));
        $this->assertSame(1, $this->enEmpresa(fn () => DB::table('crm_tasks')->where('result', 'like', 'Tarea duplicada%')->count()));

        $this->travelTo(Carbon::parse('2026-10-11 07:00', 'America/Lima'));
        $this->como(self::A)->postJson('/api/v1/crm/recompra/recalcular')->assertForbidden();
        $r = $this->como(self::SUPERVISORA)->postJson('/api/v1/crm/recompra/recalcular')->assertOk();
        $this->assertGreaterThan(100, $r->json('perfiles'));
        $this->assertSame(0, $this->como(self::SUPERVISORA)->postJson('/api/v1/crm/recompra/recalcular')->assertOk()->json('tareas'), 'La segunda vez no duplica tareas');
        $this->assertSame(0, $this->enEmpresa(fn () => DB::table('crm_tasks')->where('task_type', 'REBUY')->where('status', 'OPEN')
            ->selectRaw('customer_id, brand_id')->groupBy('customer_id', 'brand_id')->havingRaw('count(*) > 1')->get()->count()));
        $this->falla(function () {
            $t = DB::table('crm_tasks')->where('task_type', 'REBUY')->where('status', 'OPEN')->first();
            DB::table('crm_tasks')->insert(['task_type' => 'REBUY', 'status' => 'OPEN', 'customer_id' => $t->customer_id, 'brand_id' => $t->brand_id, 'due_at' => now(), 'note' => 'otra']);
        });

        $l = $this->como(self::SUPERVISORA)->getJson('/api/v1/crm/recompra?estado=ACTIVE')->assertOk();
        $c = $l->json('cifras');
        $this->assertGreaterThan(0, $c['ACTIVE'] + $c['DUE'] + $c['AT_RISK'] + $c['LOST']);
        $this->assertNotNull($c['frecuencia_mediana']);
        $this->assertTrue(collect($l->json('data'))->every(fn ($p) => $p['status'] === 'ACTIVE' && $p['frecuencia'] !== null));
        // La vendedora ve menos que la supervisora; la contadora no entra.
        $sup = array_sum(array_intersect_key($this->como(self::SUPERVISORA)->getJson('/api/v1/crm/recompra')->json('cifras'), array_flip(['DUE', 'AT_RISK', 'LOST', 'ACTIVE', 'NEW'])));
        $ven = array_sum(array_intersect_key($this->como(self::A)->getJson('/api/v1/crm/recompra')->json('cifras'), array_flip(['DUE', 'AT_RISK', 'LOST', 'ACTIVE', 'NEW'])));
        $this->assertLessThan($sup, $ven);
        $this->como(self::CONTADORA)->getJson('/api/v1/crm/recompra')->assertForbidden();
    }

    public function test_ca_crm_12_plantilla_de_recompra_solo_con_consentimiento(): void
    {
        $this->travelTo(Carbon::parse('2026-10-11 07:00', 'America/Lima'));
        $this->como(self::SUPERVISORA)->postJson('/api/v1/crm/recompra/recalcular')->assertOk();
        $p = $this->enEmpresa(fn () => DB::table('customer_rebuy_profiles as p')->join('conversations as v', fn ($j) => $j->on('v.customer_id', '=', 'p.customer_id')->on('v.brand_id', '=', 'p.brand_id'))
            ->join('messaging_channels as c', 'c.id', '=', 'v.channel_id')->where('c.kind', 'WHATSAPP')->where('p.status', '<>', 'NEW')->first(['p.id', 'p.customer_id', 'p.brand_id']));
        $base = ['customer_id' => $p->customer_id, 'purpose' => 'MARKETING', 'channel' => 'WHATSAPP', 'brand_id' => $p->brand_id];
        $this->como(self::MARKETING)->postJson('/api/v1/crm/consentimientos', $base + ['granted' => false, 'evidence_text' => 'Respondió BAJA a una promoción'])->assertCreated();
        $this->como(self::SUPERVISORA)->postJson("/api/v1/crm/recompra/{$p->id}/plantilla")->assertStatus(422)->assertJsonPath('code', 'RN-CRM-08');
        $this->como(self::A)->postJson("/api/v1/crm/recompra/{$p->id}/plantilla")->assertForbidden();
        $this->travel(1)->seconds();
        $this->como(self::MARKETING)->postJson('/api/v1/crm/consentimientos', $base + ['granted' => true, 'evidence_text' => 'Respondió SÍ quiero las promociones'])->assertCreated();
        $r = $this->como(self::SUPERVISORA)->postJson("/api/v1/crm/recompra/{$p->id}/plantilla")->assertCreated();
        $m = $this->enEmpresa(fn () => DB::table('conversation_messages as m')->join('message_templates as t', 't.id', '=', 'm.template_id')->where('m.id', $r->json('mensaje.id'))->first(['t.purpose', 'm.category']));
        $this->assertSame(['REBUY', 'MARKETING'], [$m->purpose, $m->category]);
    }

    public function test_encuesta_posentrega_en_ventana_como_plantilla_o_no_enviada_y_respuesta(): void
    {
        $canal = $this->numero();
        [$cv1, $o1] = $this->entregado($canal, '+15559900701');
        [$cv2, $o2] = $this->entregado($canal, '+15559900702');
        [$cv3, $o3] = $this->entregado($canal, '+15559900703');
        $this->enEmpresa(fn () => DB::table('conversations')->whereIn('id', [$cv2, $cv3])->update(['service_window_expires_at' => now()->subHour()]));
        // Al tercero ya le enviaron sus dos plantillas de utilidad: la encuesta queda sin enviar.
        foreach ([1, 2] as $i) {
            $this->enEmpresa(fn () => DB::table('conversation_messages')->insert(['conversation_id' => $cv3, 'channel_id' => $canal, 'brand_id' => DB::table('conversations')->where('id', $cv3)->value('brand_id'),
                'direction' => 'OUT', 'origin' => 'SYSTEM', 'msg_type' => 'TEMPLATE', 'body' => "Plantilla {$i}", 'category' => 'UTILITY', 'order_id' => $o3,
                'sent_at' => now(), 'cost' => 0, 'external_id' => "crm-prueba-{$i}"]));
        }
        Artisan::call('crm:posventa', ['que' => 'encuestas']);
        Artisan::call('crm:posventa', ['que' => 'encuestas']);
        $s = fn ($o) => $this->enEmpresa(fn () => DB::table('delivery_surveys')->where('order_id', $o)->get());
        $this->assertSame([1, 1, 1], [$s($o1)->count(), $s($o2)->count(), $s($o3)->count()], 'Una encuesta por pedido aunque el comando corra dos veces');
        $this->assertSame(['SESSION', 'TEMPLATE', 'NOT_SENT'], [$s($o1)[0]->send_mode, $s($o2)[0]->send_mode, $s($o3)[0]->send_mode]);
        $this->assertNotNull($s($o1)[0]->message_id);
        $m2 = $s($o2)[0]->message_id;
        $this->assertSame('POST_DELIVERY_SURVEY', $this->enEmpresa(fn () => DB::table('conversation_messages as m')->join('message_templates as t', 't.id', '=', 'm.template_id')
            ->where('m.id', $m2)->value('t.purpose')));
        $this->assertSame($this->id(self::A), $s($o1)[0]->seller_user_id);

        // Quién ve: la supervisora sí; la vendedora no (no tiene crm.survey.view).
        $l = $this->como(self::SUPERVISORA)->getJson('/api/v1/crm/encuestas?buscar=Cliente posventa')->assertOk();
        $this->assertSame([3, 1], [$l->json('total'), $l->json('cifras.no_enviadas')]);
        $this->como(self::A)->getJson('/api/v1/crm/encuestas')->assertForbidden();

        // Respuesta: «no recibí» y «compré fuera de la web» → tarea de seguimiento y alerta de control; una sola vez.
        $id = $s($o1)[0]->id;
        $resp = ['rating_service' => 3, 'rating_product' => 4, 'received_as_ordered' => false, 'bought_outside_catalog' => true, 'comments' => 'Me ofrecieron lechón por fuera'];
        $this->como(self::SUPERVISORA)->postJson("/api/v1/crm/encuestas/{$id}/respuesta", ['rating_service' => 7] + $resp)->assertStatus(422);
        $this->como(self::SUPERVISORA)->postJson("/api/v1/crm/encuestas/{$id}/respuesta", $resp)->assertOk()->assertJsonPath('rating_service', 3);
        $this->como(self::SUPERVISORA)->postJson("/api/v1/crm/encuestas/{$id}/respuesta", $resp)->assertStatus(422)->assertJsonPath('code', 'RN-CRM-20');
        $s3 = $s($o3)[0]->id;
        $this->como(self::SUPERVISORA)->postJson("/api/v1/crm/encuestas/{$s3}/respuesta", $resp)->assertStatus(422);
        $t = $this->enEmpresa(fn () => DB::table('crm_tasks')->where('order_id', $o1)->where('task_type', 'SURVEY_FOLLOW_UP')->first());
        $this->assertSame([$this->id(self::A), 'Respondió «no recibí lo que pedí»'], [$t->assigned_user_id, $t->note]);
        $a = $this->enEmpresa(fn () => DB::table('control_alerts')->where('conversation_id', $cv1)->where('rule_code', 'CTL-16')->first());
        $this->assertSame(['SURVEY', $this->id(self::A), 'HIGH'], [$a->source_type, $a->user_id, $a->severity]);
        $this->assertSame(1, $this->como(self::SUPERVISORA)->getJson('/api/v1/crm/encuestas?senal=FUERA_WEB&buscar=Cliente posventa')->json('total'));
        $this->assertSame(3.0, (float) $this->como(self::SUPERVISORA)->getJson('/api/v1/crm/encuestas?buscar=Cliente posventa')->json('cifras.atencion'));

        // La base: la respuesta no cambia, el envío tampoco, y no se borra.
        $this->falla(fn () => DB::table('delivery_surveys')->where('id', $id)->update(['rating_service' => 5]));
        $this->falla(fn () => DB::table('delivery_surveys')->where('order_id', $o2)->update(['send_mode' => 'SESSION']));
        $this->falla(fn () => DB::table('delivery_surveys')->where('id', $id)->delete());
    }
}
