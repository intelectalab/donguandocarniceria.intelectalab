<?php

namespace Tests\Feature\Modulos;

use App\Support\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/** CRM-06 Supervisión en vivo, CRM-17 Mis tareas y CRM-18 Consentimientos y avisos (RN-CRM-02, 03, 08, 14, 19 y 21). */
class CrmSupervisionTest extends TestCase
{
    private const ADMIN = 'lccahuana@donguando.pe';

    private const GERENTE = 'rquispe@donguando.pe';

    private const AUDITOR = 'aexterno@donguando.pe';

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

    /** Número de prueba con A en turno y en línea, B miembro desconectada y la supervisora. */
    private function numero(): string
    {
        $marca = $this->enEmpresa(fn () => DB::table('brands')->where('name', 'Don Guando')->value('id'));
        $canal = $this->como(self::ADMIN)->postJson('/api/v1/crm/canales', ['kind' => 'WHATSAPP', 'number' => '+15550002222', 'display_name' => 'Supervisión de prueba', 'brand_id' => $marca,
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

    private function barrer(): void
    {
        Artisan::call('crm:barrido');
    }

    public function test_supervision_en_vivo_cola_sin_responder_tomar_y_estado_de_la_vendedora(): void
    {
        // Martes 10:00 (dentro del horario de atención).
        $this->travelTo(Carbon::parse('2026-11-24 10:00:00', 'America/Lima'));
        $canal = $this->numero();
        $c1 = $this->como(self::SUPERVISORA)->postJson('/api/v1/crm/simular', ['channel_id' => $canal, 'from' => '+15559900101', 'name' => 'Rosa Espera', 'texto' => 'Hola, ¿tienen lomo?'])
            ->assertCreated()->json('conversation_id');
        // A se desconecta: el siguiente chat queda en la cola.
        $this->como(self::A)->postJson('/api/v1/crm/mi-estado', ['estado' => 'OFFLINE'])->assertOk();
        $c2 = $this->como(self::SUPERVISORA)->postJson('/api/v1/crm/simular', ['channel_id' => $canal, 'from' => '+15559900102', 'name' => 'Pedro Cola', 'texto' => 'Buenas'])
            ->assertCreated()->json('conversation_id');
        $this->assertNull($this->enEmpresa(fn () => DB::table('conversations')->where('id', $c2)->value('assigned_user_id')));

        $this->travel(20)->minutes();
        $p = $this->como(self::SUPERVISORA)->getJson("/api/v1/crm/supervision?canal={$canal}")->assertOk();
        $this->assertSame([2, 1, 1, 2], [$p->json('cifras.abiertos'), $p->json('cifras.en_cola'), $p->json('cifras.cola_vencida'), $p->json('cifras.sin_responder')]);
        $this->assertSame([0, 2], [$p->json('cifras.en_linea'), $p->json('cifras.vendedoras')]);
        $this->assertSame([15, 5], [$p->json('limites.sin_responder'), $p->json('limites.cola')]);

        $cola = $this->como(self::SUPERVISORA)->getJson("/api/v1/crm/supervision/cola?canal={$canal}")->assertOk();
        $this->assertSame([1, 'Pedro Cola', true], [$cola->json('total'), $cola->json('data.0.contacto'), $cola->json('data.0.soy_miembro')]);
        $this->assertCount(3, $cola->json('data.0.miembros'));
        $sin = $this->como(self::SUPERVISORA)->getJson("/api/v1/crm/supervision/sin-responder?canal={$canal}&buscar=rosa")->assertOk();
        $this->assertSame([1, 'Rosa Espera', 'Ana Torres Lazo', 20], [$sin->json('total'), $sin->json('data.0.contacto'), $sin->json('data.0.atiende'), $sin->json('data.0.espera')]);

        $v = $this->como(self::SUPERVISORA)->getJson("/api/v1/crm/supervision/vendedoras?canal={$canal}")->assertOk();
        $a = collect($v->json('data'))->firstWhere('nombre', 'Ana Torres Lazo');
        // Los abiertos suman todos sus números (el tope es por persona); sin responder, solo los del filtro.
        $this->assertSame(['OFFLINE', 1, 25], [$a['estado'], $a['sin_responder'], $a['tope']]);
        $this->assertGreaterThanOrEqual(1, $a['abiertos']);
        $this->assertSame(1, $this->como(self::SUPERVISORA)->getJson("/api/v1/crm/supervision/vendedoras?canal={$canal}&buscar=ramos")->json('total'));

        // Solo la supervisión entra; la vendedora y la contadora no. La gerencia y la auditoría la consultan.
        $this->como(self::A)->getJson('/api/v1/crm/supervision')->assertForbidden();
        $this->como(self::CONTADORA)->getJson('/api/v1/crm/supervision')->assertForbidden();
        $this->como(self::AUDITOR)->getJson('/api/v1/crm/supervision')->assertOk()->assertJsonPath('puede.reasignar', false);

        // La supervisora toma el chat de la cola (queda en el historial) y pone en línea a B.
        $this->como(self::SUPERVISORA)->postJson("/api/v1/crm/conversaciones/{$c2}/asignar", ['user_id' => $this->id(self::SUPERVISORA)])->assertOk();
        $this->assertSame('TAKEN', $this->enEmpresa(fn () => DB::table('conversation_assignments')->where('conversation_id', $c2)->orderByDesc('assigned_at')->value('reason')));
        $this->como(self::SUPERVISORA)->postJson('/api/v1/crm/vendedoras/'.$this->id(self::B).'/estado', ['estado' => 'ONLINE'])->assertOk()->assertJsonPath('estado_name', 'En línea');
        $this->assertSame(1, $this->como(self::SUPERVISORA)->getJson("/api/v1/crm/supervision?canal={$canal}")->json('cifras.en_linea'));
        // La vendedora no cambia el estado de otra; nadie cambia el de quien no está en sus números; el estado es uno de los tres.
        $this->como(self::A)->postJson('/api/v1/crm/vendedoras/'.$this->id(self::B).'/estado', ['estado' => 'OFFLINE'])->assertForbidden();
        $this->como(self::SUPERVISORA)->postJson('/api/v1/crm/vendedoras/'.$this->id(self::CONTADORA).'/estado', ['estado' => 'ONLINE'])->assertNotFound();
        $this->como(self::SUPERVISORA)->postJson('/api/v1/crm/vendedoras/'.$this->id(self::B).'/estado', ['estado' => 'BUSY'])->assertStatus(422);
        // Un día futuro no se consulta.
        $this->como(self::SUPERVISORA)->getJson('/api/v1/crm/supervision?dia=2027-01-01')->assertStatus(422);
    }

    public function test_barrido_crea_la_tarea_de_chat_sin_responder_una_vez_y_avisa_a_la_supervision(): void
    {
        $this->travelTo(Carbon::parse('2026-11-24 10:00:00', 'America/Lima'));
        $canal = $this->numero();
        $this->barrer();   // los chats de la demostración quedan avisados antes de empezar
        $cv = $this->como(self::SUPERVISORA)->postJson('/api/v1/crm/simular', ['channel_id' => $canal, 'from' => '+15559900201', 'name' => 'Marta Apurada', 'texto' => '¿Me atienden?'])
            ->assertCreated()->json('conversation_id');
        $this->como(self::A)->postJson('/api/v1/crm/mi-estado', ['estado' => 'OFFLINE'])->assertOk();
        $cola = $this->como(self::SUPERVISORA)->postJson('/api/v1/crm/simular', ['channel_id' => $canal, 'from' => '+15559900202', 'name' => 'Luis Cola', 'texto' => 'Hola'])
            ->assertCreated()->json('conversation_id');
        $tareas = fn () => $this->enEmpresa(fn () => DB::table('crm_tasks')->where('task_type', 'UNANSWERED_CHAT')->whereIn('conversation_id', [$cv, $cola])->count());
        $avisos = fn () => $this->enEmpresa(fn () => DB::table('notifications')->where('module', 'CRM')->where('role', 'SUPERVISORA_VENTAS')->where('title', 'not like', 'Alerta de control%')->count());
        $antes = $avisos();

        // A los 10 min todavía no; a los 16 min sí: tarea para la vendedora asignada y aviso a la supervisión.
        $this->travel(10)->minutes();
        $this->barrer();
        $this->assertSame(0, $tareas());
        $this->assertSame($antes + 1, $avisos(), 'El chat en cola más de 5 min avisa');
        $this->travel(6)->minutes();
        $this->barrer();
        $this->assertSame(2, $tareas());
        $t = $this->enEmpresa(fn () => DB::table('crm_tasks')->where('conversation_id', $cv)->first());
        $this->assertSame([$this->id(self::A), 'OPEN'], [$t->assigned_user_id, $t->status]);
        $this->assertStringContainsString('Sin respuesta desde las 10:00', $t->note);
        $this->assertNull($this->enEmpresa(fn () => DB::table('crm_tasks')->where('conversation_id', $cola)->value('assigned_user_id')), 'El de la cola queda sin responsable');
        $this->assertSame($antes + 2, $avisos(), 'Un aviso con los chats sin responder; la cola no se vuelve a avisar');
        // Otra pasada no duplica nada.
        $this->travel(5)->minutes();
        $this->barrer();
        $this->assertSame([2, $antes + 2], [$tareas(), $avisos()]);
        // La base no deja dos tareas abiertas de «sin responder» para el mismo chat.
        $this->expectException(QueryException::class);
        $this->enEmpresa(fn () => DB::table('crm_tasks')->insert(['task_type' => 'UNANSWERED_CHAT', 'status' => 'OPEN', 'conversation_id' => $cv, 'brand_id' => $t->brand_id, 'due_at' => now(), 'note' => 'x']));
    }

    public function test_mis_tareas_la_vendedora_las_suyas_la_supervision_el_equipo_y_hecha_no_cambia(): void
    {
        $this->travelTo(Carbon::parse('2026-11-24 10:00:00', 'America/Lima'));
        [$marca, $cliente] = $this->enEmpresa(fn () => [DB::table('brands')->where('name', 'Don Guando')->value('id'), DB::table('customers')->whereNotNull('phone')->orderBy('full_name')->value('id')]);
        $nueva = fn (string $tipo, ?string $quien, string $vence, string $nota) => $this->enEmpresa(fn () => DB::table('crm_tasks')->insertGetId(['task_type' => $tipo, 'status' => 'OPEN',
            'customer_id' => $cliente, 'brand_id' => $marca, 'assigned_user_id' => $quien, 'due_at' => Carbon::parse($vence, 'America/Lima'), 'note' => $nota], 'id'));
        $deA = $nueva('CALLBACK', $this->id(self::A), '2026-11-24 09:00', 'Llamar por pedido grande');
        $hoyA = $nueva('FOLLOW_UP', $this->id(self::A), '2026-11-24 18:00', 'Enviar resumen de prueba');
        $deB = $nueva('FOLLOW_UP', $this->id(self::B), '2026-11-25 09:00', 'Recompra de prueba');
        $sinNadie = $nueva('CALLBACK', null, '2026-11-26 09:00', 'Llamada sin vendedora');

        $a = $this->como(self::A)->getJson('/api/v1/crm/tareas?buscar=prueba')->assertOk();
        $this->assertSame([1, false], [$a->json('total'), $a->json('equipo')]);
        $this->assertSame([$hoyA, 'Seguimiento'], [$a->json('data.0.id'), $a->json('data.0.tipo')]);
        $todasA = collect($this->como(self::A)->getJson('/api/v1/crm/tareas?per_page=100')->json('data'))->pluck('id');
        $this->assertTrue($todasA->contains($deA) && ! $todasA->contains($deB) && ! $todasA->contains($sinNadie));
        // «alcance=equipo» no le abre las del equipo a la vendedora.
        $this->assertFalse(collect($this->como(self::A)->getJson('/api/v1/crm/tareas?alcance=equipo&per_page=100')->json('data'))->pluck('id')->contains($deB));
        $c = $this->como(self::A)->getJson('/api/v1/crm/tareas?vence=vencidas&buscar=pedido grande')->json();
        $this->assertTrue(collect($c['data'])->pluck('id')->contains($deA));
        $this->assertTrue(collect($c['data'])->every(fn ($t) => $t['vencida']));

        // La supervisora: las suyas y las sin responsable; con «equipo», todas, y filtra por responsable.
        $s = collect($this->como(self::SUPERVISORA)->getJson('/api/v1/crm/tareas?per_page=100')->json('data'))->pluck('id');
        $this->assertTrue($s->contains($sinNadie) && ! $s->contains($deA));
        $e = $this->como(self::SUPERVISORA)->getJson('/api/v1/crm/tareas?alcance=equipo&responsable='.$this->id(self::B).'&buscar=prueba')->assertOk();
        $this->assertSame([1, $deB], [$e->json('total'), $e->json('data.0.id')]);
        $this->assertSame(1, $this->como(self::SUPERVISORA)->getJson('/api/v1/crm/tareas?alcance=equipo&responsable=none&buscar=llamada sin vendedora')->json('total'));

        // Completar: con resultado; B no completa la de A (no la ve); la supervisora sí completa la sin responsable.
        $this->como(self::A)->postJson("/api/v1/crm/tareas/{$deA}/hecha", ['resultado' => ''])->assertStatus(422);
        $this->como(self::B)->postJson("/api/v1/crm/tareas/{$deA}/hecha", ['resultado' => 'Hecho'])->assertNotFound();
        $this->como(self::AUDITOR)->postJson("/api/v1/crm/tareas/{$deA}/hecha", ['resultado' => 'Hecho'])->assertStatus(422);
        $h = $this->como(self::A)->postJson("/api/v1/crm/tareas/{$deA}/hecha", ['resultado' => 'Llamé y quedó para el domingo'])->assertOk();
        $this->assertSame(['DONE', 'Ana Torres Lazo', false], [$h->json('status'), $h->json('hecha_por'), $h->json('puede_completar')]);
        $this->como(self::A)->postJson("/api/v1/crm/tareas/{$deA}/hecha", ['resultado' => 'Otra vez'])->assertStatus(422)->assertJsonPath('code', 'RN-CRM-19');
        $this->como(self::SUPERVISORA)->postJson("/api/v1/crm/tareas/{$sinNadie}/hecha", ['resultado' => 'Le escribí por WhatsApp'])->assertOk();
        $this->assertSame(1, $this->como(self::A)->getJson('/api/v1/crm/tareas?estado=DONE&buscar=pedido grande')->json('total'));

        // La base: una tarea hecha no se reabre ni cambia su resultado, y las tareas no se borran.
        $this->assertSame('Llamé y quedó para el domingo', $this->enEmpresa(fn () => DB::table('crm_tasks')->where('id', $deA)->value('result')));
        $falla = function (callable $f) {
            try {
                // En un punto de guardado: el error no deja abortada la transacción de la prueba.
                $this->enEmpresa(fn () => DB::transaction($f));
                $this->fail('La base debió rechazarlo');
            } catch (QueryException) {
                $this->assertTrue(true);
            }
        };
        $falla(fn () => DB::table('crm_tasks')->where('id', $deA)->update(['status' => 'OPEN']));
        $falla(fn () => DB::table('crm_tasks')->where('id', $deA)->update(['result' => 'Cambiado']));
        $falla(fn () => DB::table('crm_tasks')->where('id', $deB)->delete());
        $falla(fn () => DB::table('crm_tasks')->where('id', $deB)->update(['status' => 'DONE']));
    }

    public function test_consentimientos_historial_registro_con_evidencia_y_baja_de_marketing(): void
    {
        [$marca, $cli] = $this->enEmpresa(fn () => [DB::table('brands')->where('name', 'Don Guando')->value('id'),
            DB::table('customers')->where('status', 'ACTIVE')->whereNull('merged_into_id')->whereNotNull('phone')->orderBy('full_name')->first(['id', 'full_name', 'phone'])]);

        $h = $this->como(self::SUPERVISORA)->getJson('/api/v1/crm/consentimientos')->assertOk();
        $this->assertGreaterThan(0, $h->json('cifras.avisos'));
        $this->assertGreaterThan(0, $h->json('cifras.otorgados') + $h->json('cifras.bajas'));
        $this->assertTrue($h->json('puede.registrar'));
        $bajas = $this->como(self::SUPERVISORA)->getJson('/api/v1/crm/consentimientos?proposito=MARKETING&estado=0&per_page=100')->json('data');
        $this->assertTrue(collect($bajas)->every(fn ($k) => $k['purpose'] === 'MARKETING' && $k['granted'] === false));
        $this->assertCount(4, $this->como(self::SUPERVISORA)->getJson('/api/v1/crm/consentimientos')->json('opciones.propositos'));

        // Quién entra: la contadora no; marketing sí y registra; la auditoría consulta pero no registra.
        $this->como(self::CONTADORA)->getJson('/api/v1/crm/consentimientos')->assertForbidden();
        $this->como(self::AUDITOR)->getJson('/api/v1/crm/consentimientos')->assertOk()->assertJsonPath('puede.registrar', false);
        $this->como(self::AUDITOR)->postJson('/api/v1/crm/consentimientos', [])->assertForbidden();

        // Buscar el cliente y registrar: sin evidencia, para el aviso de registro o por un canal no válido, no.
        $busca = $this->como(self::MARKETING)->getJson('/api/v1/crm/consentimientos/clientes?buscar='.urlencode(mb_substr($cli->full_name, 0, 6)))->assertOk();
        $this->assertTrue(collect($busca->json('data'))->pluck('value')->contains($cli->id));
        $base = ['customer_id' => $cli->id, 'purpose' => 'MARKETING', 'granted' => true, 'channel' => 'COUNTER', 'brand_id' => $marca];
        $this->como(self::MARKETING)->postJson('/api/v1/crm/consentimientos', $base + ['evidence_text' => 'sí'])->assertStatus(422);
        $this->como(self::MARKETING)->postJson('/api/v1/crm/consentimientos', ['purpose' => 'RECORDING_NOTICE', 'evidence_text' => 'Firmó la hoja'] + $base)->assertStatus(422);
        $this->como(self::MARKETING)->postJson('/api/v1/crm/consentimientos', ['channel' => 'TIKTOK', 'evidence_text' => 'Firmó la hoja'] + $base)->assertStatus(422);

        $this->como(self::MARKETING)->postJson('/api/v1/crm/consentimientos', $base + ['evidence_text' => 'Firmó la hoja de promociones en el local'])->assertCreated()->assertJsonPath('marketing', true);
        $this->travel(1)->seconds();
        $this->como(self::MARKETING)->postJson('/api/v1/crm/consentimientos', ['granted' => false, 'channel' => 'PHONE', 'evidence_text' => 'Llamó para pedir que no le escriban'] + $base)
            ->assertCreated()->assertJsonPath('marketing', false);
        $this->assertFalse($this->enEmpresa(fn () => (bool) DB::table('customers')->where('id', $cli->id)->value('marketing_opt_in')), 'El cliente guarda la baja');
        $this->assertTrue($this->enEmpresa(fn () => DB::table('domain_events')->where('event_name', 'consent.opted_out')->where('aggregate_id', $cli->id)->exists()));
        $ultimo = $this->como(self::MARKETING)->getJson('/api/v1/crm/consentimientos?buscar='.urlencode($cli->phone))->json('data.0');
        $this->assertSame([false, 'Teléfono', 'Don Guando', 'Llamó para pedir que no le escriban', 'Registrado por el equipo'],
            [$ultimo['granted'], $ultimo['canal'], $ultimo['marca'], $ultimo['evidencia'], $ultimo['origen']]);

        // La vendedora solo ve y registra para los clientes de sus chats.
        $vend = $this->como(self::A)->getJson('/api/v1/crm/consentimientos?buscar='.urlencode($cli->phone))->assertOk();
        $idA = $this->id(self::A);
        $deSusChats = $this->enEmpresa(fn () => DB::table('conversations as v')->join('channel_members as m', 'm.channel_id', '=', 'v.channel_id')
            ->where('m.user_id', $idA)->where('m.active', true)->where('v.customer_id', $cli->id)->exists());
        $this->assertSame($deSusChats, $vend->json('total') > 0);
        // Un cliente que no es de sus chats: no lo ve ni registra para él.
        $ajeno = $this->enEmpresa(fn () => DB::table('customers as c')->where('c.status', 'ACTIVE')->whereNull('c.merged_into_id')
            ->whereNotExists(fn ($x) => $x->from('conversations as v')->join('channel_members as m', 'm.channel_id', '=', 'v.channel_id')->whereColumn('v.customer_id', 'c.id')->where('m.user_id', $idA))
            ->value('c.id'));
        $this->como(self::A)->postJson('/api/v1/crm/consentimientos', ['customer_id' => $ajeno] + $base + ['evidence_text' => 'Firmó la hoja de promociones'])->assertNotFound();
        $this->assertLessThan($this->como(self::SUPERVISORA)->getJson('/api/v1/crm/consentimientos')->json('total'), $this->como(self::A)->getJson('/api/v1/crm/consentimientos')->json('total'));

        // Los textos del aviso por número.
        $av = $this->como(self::SUPERVISORA)->getJson('/api/v1/crm/consentimientos/avisos')->assertOk()->json('data');
        $this->assertNotEmpty($av);
        $this->assertTrue(collect($av)->where('kind', 'WHATSAPP')->every(fn ($c) => $c['texto'] !== null || ! $c['exigido']));

        // La base: sin evidencia ni de quién no entra, y el historial no se cambia ni se borra.
        $falla = function (callable $f) {
            try {
                // En un punto de guardado: el error no deja abortada la transacción de la prueba.
                $this->enEmpresa(fn () => DB::transaction($f));
                $this->fail('La base debió rechazarlo');
            } catch (QueryException) {
                $this->assertTrue(true);
            }
        };
        $falla(fn () => DB::table('contact_consents')->insert(['customer_id' => $cli->id, 'purpose' => 'MARKETING', 'granted' => true, 'channel' => 'WHATSAPP', 'evidence_text' => '  ', 'recorded_at' => now()]));
        $falla(fn () => DB::table('contact_consents')->insert(['purpose' => 'MARKETING', 'granted' => true, 'channel' => 'WHATSAPP', 'evidence_text' => 'Dijo que sí', 'recorded_at' => now()]));
        $falla(fn () => DB::table('contact_consents')->where('customer_id', $cli->id)->update(['granted' => true]));
        $falla(fn () => DB::table('contact_consents')->where('customer_id', $cli->id)->delete());
    }

    public function test_encargar_actividad_la_supervisora_a_su_equipo_la_vendedora_para_si_y_el_tablero(): void
    {
        $this->travelTo(Carbon::parse('2026-11-24 10:00:00', 'America/Lima'));
        [$a, $b, $sup] = [$this->id(self::A), $this->id(self::B), $this->id(self::SUPERVISORA)];
        [$marca, $deA] = $this->enEmpresa(fn () => [DB::table('brands')->where('name', 'Don Guando')->value('id'),
            DB::table('conversations as v')->join('customers as c', 'c.id', '=', 'v.customer_id')->where('v.assigned_user_id', DB::table('users')->where('email', self::A)->value('id'))->first(['c.id', 'c.full_name'])]);
        $this->assertNotNull($deA);

        // Lo que ofrece el formulario: la vendedora solo se ve a sí misma; la supervisora, al equipo activo.
        $op = $this->como(self::A)->getJson('/api/v1/crm/tareas/encargables')->assertOk();
        $this->assertSame([[$a], false], [array_column($op->json('personas'), 'value'), $op->json('a_otras')]);
        $this->assertSame(['FOLLOW_UP', 'CALLBACK', 'REBUY'], array_column($op->json('tipos'), 'value'));
        $ops = collect($this->como(self::SUPERVISORA)->getJson('/api/v1/crm/tareas/encargables')->json('personas'))->pluck('value');
        $this->assertTrue($ops->contains($a) && $ops->contains($b));
        $this->como(self::AUDITOR)->getJson('/api/v1/crm/tareas/encargables')->assertForbidden();
        $this->como(self::MARKETING)->postJson('/api/v1/crm/tareas', [])->assertForbidden();
        // El buscador de clientes de la vendedora solo trae los de sus chats.
        $this->assertContains($deA->id, array_column($this->como(self::A)->getJson('/api/v1/crm/tareas/clientes?buscar='.urlencode(mb_substr($deA->full_name, 0, 6)))->json('data'), 'value'));

        $base = ['task_type' => 'FOLLOW_UP', 'brand_id' => $marca, 'assigned_user_id' => $b, 'customer_id' => $deA->id, 'due_at' => '2026-11-24T17:00', 'note' => 'Enviar cotización del lechón'];
        // La vendedora no le encarga a otra; sí para sí misma.
        $this->como(self::A)->postJson('/api/v1/crm/tareas', $base)->assertStatus(422)->assertJsonPath('code', 'RN-CRM-03');
        $mia = $this->como(self::A)->postJson('/api/v1/crm/tareas', ['assigned_user_id' => $a] + $base)->assertCreated();
        $this->assertSame(['OPEN', 'Seguimiento', null], [$mia->json('status'), $mia->json('tipo'), $mia->json('encargada_por')]);
        // Validaciones: en el pasado, sin indicación, recompra sin cliente, marca ajena o cliente inventado.
        $this->como(self::SUPERVISORA)->postJson('/api/v1/crm/tareas', ['due_at' => '2026-11-23T17:00'] + $base)->assertStatus(422)->assertJsonPath('code', 'RN-CRM-19');
        $this->como(self::SUPERVISORA)->postJson('/api/v1/crm/tareas', ['note' => ''] + $base)->assertStatus(422);
        $this->como(self::SUPERVISORA)->postJson('/api/v1/crm/tareas', ['task_type' => 'REBUY', 'customer_id' => null] + $base)->assertStatus(422)->assertJsonPath('code', 'RN-CRM-19');
        $this->como(self::SUPERVISORA)->postJson('/api/v1/crm/tareas', ['task_type' => 'ALERT_REVIEW'] + $base)->assertStatus(422);
        $this->como(self::SUPERVISORA)->postJson('/api/v1/crm/tareas', ['customer_id' => '00000000-0000-4000-8000-000000000000'] + $base)->assertStatus(422)->assertJsonPath('code', 'RN-CRM-03');
        $this->como(self::SUPERVISORA)->postJson('/api/v1/crm/tareas', ['brand_id' => '00000000-0000-4000-8000-000000000000'] + $base)->assertStatus(422)->assertJsonPath('code', 'RN-CRM-03');

        // La supervisora le encarga a B: queda quién la encargó y B recibe el aviso.
        $avisos = fn () => $this->enEmpresa(fn () => DB::table('notifications')->where('user_id', $b)->where('title', 'Nueva actividad encargada')->count());
        $antes = $avisos();
        $t = $this->como(self::SUPERVISORA)->postJson('/api/v1/crm/tareas', $base)->assertCreated();
        $this->assertSame(['Patricia León Vera', $antes + 1], [$t->json('encargada_por'), $avisos()]);
        $this->assertSame($sup, $this->enEmpresa(fn () => DB::table('crm_tasks')->where('id', $t->json('id'))->value('assigned_by')));
        // Una sola recompra abierta por cliente y marca.
        $this->enEmpresa(fn () => DB::table('crm_tasks')->where('task_type', 'REBUY')->where('customer_id', $deA->id)->where('brand_id', $marca)->where('status', 'OPEN')
            ->update(['status' => 'DONE', 'done_at' => now(), 'result' => 'Cierre de prueba']));
        $this->como(self::SUPERVISORA)->postJson('/api/v1/crm/tareas', ['task_type' => 'REBUY'] + $base)->assertCreated();
        $this->como(self::SUPERVISORA)->postJson('/api/v1/crm/tareas', ['task_type' => 'REBUY', 'assigned_user_id' => $a] + $base)->assertStatus(422)->assertJsonPath('code', 'RN-CRM-19');

        // El tablero trae abiertas y hechas juntas, sin páginas; B ve la que le encargaron.
        $tab = $this->como(self::B)->getJson('/api/v1/crm/tareas?tablero=1&buscar=lechón')->assertOk();
        $this->assertSame(1, $tab->json('last_page'));
        $this->assertContains($t->json('id'), array_column($tab->json('data'), 'id'));
        $this->assertSame(['puede' => true, 'a_otras' => false], $tab->json('encargar'));
    }
}
