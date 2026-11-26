<?php

namespace Tests\Feature\Modulos;

use App\Support\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/** CRM-12 Alertas de control, CRM-13 Reglas e identificadores y CRM-14 Revisión por muestreo (RN-CRM-15 a 18; CA-CRM-06 y 07). */
class CrmControlTest extends TestCase
{
    private const ADMIN = 'lccahuana@donguando.pe';

    private const GERENTE = 'rquispe@donguando.pe';

    private const SUPERVISORA = 'pleon@donguando.pe';

    private const AUDITOR = 'aexterno@donguando.pe';

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

    /** Número de prueba con A en turno y en línea, B miembro desconectada y la supervisora. */
    private function numero(): string
    {
        $marca = $this->enEmpresa(fn () => DB::table('brands')->where('name', 'Don Guando')->value('id'));
        $canal = $this->como(self::ADMIN)->postJson('/api/v1/crm/canales', ['kind' => 'WHATSAPP', 'number' => '+15550003333', 'display_name' => 'Control de prueba', 'brand_id' => $marca,
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

    private function chat(string $canal, string $de, string $nombre): string
    {
        return $this->como(self::SUPERVISORA)->postJson('/api/v1/crm/simular', ['channel_id' => $canal, 'from' => $de, 'name' => $nombre, 'texto' => 'Hola, quiero hacer un pedido'])
            ->assertCreated()->json('conversation_id');
    }

    private function alertasDe(string $cv): array
    {
        return $this->enEmpresa(fn () => DB::table('control_alerts')->where('conversation_id', $cv)->orderBy('rule_code')->pluck('rule_code')->all());
    }

    public function test_ca_crm_06_frases_y_numero_ajeno_alertan_y_el_yape_oficial_o_el_celular_del_cliente_no(): void
    {
        $canal = $this->numero();
        $cv = $this->chat($canal, '+51955500111', 'Cliente de prueba');
        $m = $this->como(self::A)->postJson("/api/v1/crm/conversaciones/{$cv}/mensajes", ['texto' => 'Mejor escríbeme a mi número 987 654 321, te lo dejo más barato por fuera'])
            ->assertCreated()->json('mensaje.id');
        $this->assertSame(['CTL-01', 'CTL-02', 'CTL-07'], $this->alertasDe($cv));
        $a = $this->enEmpresa(fn () => DB::table('control_alerts')->where('conversation_id', $cv)->where('rule_code', 'CTL-07')->first());
        $this->assertSame([$m, $this->id(self::A), 'HIGH', 'OPEN', '987 654 321'], [$a->message_id, $a->user_id, $a->severity, $a->status, $a->matched_text]);
        $this->assertTrue($this->enEmpresa(fn () => DB::table('notifications')->where('role', 'SUPERVISORA_VENTAS')->where('ref->href', "/m/crm/crm-12?id={$a->id}")->exists()));

        // El Yape oficial, el celular del propio cliente, una plantilla o un texto normal no alertan.
        $this->como(self::A)->postJson("/api/v1/crm/conversaciones/{$cv}/mensajes", ['texto' => 'Puedes pagar al Yape 987650001 de la empresa'])->assertCreated();
        $this->como(self::A)->postJson("/api/v1/crm/conversaciones/{$cv}/mensajes", ['texto' => 'Te confirmo tu número: 955 500 111'])->assertCreated();
        $this->como(self::A)->postJson("/api/v1/crm/conversaciones/{$cv}/mensajes", ['texto' => 'Tenemos cuy entero beneficiado para mañana'])->assertCreated();
        $this->assertCount(3, $this->alertasDe($cv));
        // Una cuenta ajena alerta; la cuenta oficial no.
        $this->como(self::A)->postJson("/api/v1/crm/conversaciones/{$cv}/mensajes", ['texto' => 'Deposita a la 191-23456789-0-12'])->assertCreated();
        $this->como(self::A)->postJson("/api/v1/crm/conversaciones/{$cv}/mensajes", ['texto' => 'O a la cuenta 193-2284719-0-55 de la empresa'])->assertCreated();
        $this->assertSame(['CTL-01', 'CTL-02', 'CTL-07', 'CTL-08'], $this->alertasDe($cv));

        // La vendedora no ve las alertas (ni la pantalla ni las marcas en el chat); la supervisora sí.
        $this->como(self::A)->getJson('/api/v1/crm/alertas')->assertForbidden();
        $hiloA = collect($this->como(self::A)->getJson("/api/v1/crm/conversaciones/{$cv}")->assertOk()->json('mensajes'))->firstWhere('id', $m);
        $this->assertSame([], $hiloA['alertas']);
        $this->assertNull($this->como(self::A)->getJson("/api/v1/crm/conversaciones/{$cv}")->json('alertas_abiertas'));
        $hiloS = $this->como(self::SUPERVISORA)->getJson("/api/v1/crm/conversaciones/{$cv}")->assertOk();
        $this->assertCount(3, collect($hiloS->json('mensajes'))->firstWhere('id', $m)['alertas']);
        $this->assertSame(4, $hiloS->json('alertas_abiertas'));
        $l = $this->como(self::SUPERVISORA)->getJson("/api/v1/crm/alertas?conversacion={$cv}")->assertOk();
        $this->assertSame([4, 'Cliente de prueba'], [$l->json('total'), $l->json('conversacion')]);
        $this->assertGreaterThanOrEqual(4, $l->json('cifras.abiertas'));
        $this->assertSame(3, $this->como(self::SUPERVISORA)->getJson("/api/v1/crm/alertas?conversacion={$cv}&buscar=987 654")->json('total'), 'Las tres del mismo mensaje');
        $this->assertSame(1, $this->como(self::SUPERVISORA)->getJson("/api/v1/crm/alertas?conversacion={$cv}&buscar=191-2345")->json('total'));

        // Una respuesta rápida con lo que alertaría se rechaza.
        $this->como(self::A)->postJson('/api/v1/crm/respuestas', ['shortcut' => '/pago', 'body' => 'Págame a mi yape y listo', 'alcance' => 'ME', 'status' => 'ACTIVE'])
            ->assertStatus(422)->assertJsonPath('code', 'RN-CRM-16');
    }

    public function test_ca_crm_07_termino_fuera_del_catalogo_y_reglas_e_identificadores(): void
    {
        // «lechón» no está en el catálogo: alerta; «cuy» sí está: un término de cuy no alerta.
        $p = $this->como(self::SUPERVISORA)->postJson('/api/v1/crm/reglas/probar', ['texto' => 'Te ofrezco lechón para el sábado'])->assertOk()->json('data');
        $this->assertSame(['CTL-09'], array_column($p, 'code'));
        $this->como(self::ADMIN)->postJson('/api/v1/crm/reglas', ['code' => 'ctl-90', 'name' => 'Cuy', 'rule_type' => 'OFF_CATALOG_TERM', 'pattern' => 'cuy', 'severity' => 'MEDIUM'])->assertCreated()
            ->assertJsonPath('code', 'CTL-90');
        $this->assertSame([], $this->como(self::SUPERVISORA)->postJson('/api/v1/crm/reglas/probar', ['texto' => 'Tenemos cuyes para el domingo'])->json('data'));
        $r = $this->como(self::SUPERVISORA)->getJson('/api/v1/crm/reglas?buscar=CTL-90')->assertOk();
        $this->assertSame([true, false], [$r->json('data.0.en_catalogo'), $r->json('puede')]);

        // Solo quien administra las reglas las cambia; código único; las señales del sistema no se crean; el tipo no cambia.
        $nueva = ['code' => 'CTL-91', 'name' => 'Venta en casa', 'rule_type' => 'KEYWORD', 'pattern' => 'en mi casa', 'severity' => 'HIGH'];
        $this->como(self::SUPERVISORA)->postJson('/api/v1/crm/reglas', $nueva)->assertForbidden();
        $id = $this->como(self::ADMIN)->postJson('/api/v1/crm/reglas', $nueva)->assertCreated()->json('id');
        $this->como(self::ADMIN)->postJson('/api/v1/crm/reglas', $nueva)->assertStatus(422);
        $this->como(self::ADMIN)->postJson('/api/v1/crm/reglas', ['code' => 'CTL-92', 'rule_type' => 'APP_DELETION'] + $nueva)->assertStatus(422);
        $this->como(self::ADMIN)->putJson("/api/v1/crm/reglas/{$id}", ['rule_type' => 'OFF_CATALOG_TERM'])->assertStatus(422);
        $this->assertSame(['CTL-91'], array_column($this->como(self::SUPERVISORA)->postJson('/api/v1/crm/reglas/probar', ['texto' => 'Recógelo EN MI CASA'])->json('data'), 'code'));
        $this->como(self::ADMIN)->putJson("/api/v1/crm/reglas/{$id}", ['active' => false])->assertOk();
        $this->assertSame([], $this->como(self::SUPERVISORA)->postJson('/api/v1/crm/reglas/probar', ['texto' => 'Recógelo en mi casa'])->json('data'));

        // Un celular agregado a la lista oficial deja de alertar; valores inválidos o repetidos no entran.
        $texto = ['texto' => 'Llama al 912 345 678 para coordinar'];
        $this->assertSame(['CTL-07'], array_column($this->como(self::SUPERVISORA)->postJson('/api/v1/crm/reglas/probar', $texto)->json('data'), 'code'));
        $ident = ['identifier_type' => 'PHONE', 'value' => '912 345 678', 'label' => 'Celular del local nuevo', 'brand_id' => null, 'status' => 'ACTIVE'];
        $this->como(self::SUPERVISORA)->postJson('/api/v1/crm/identificadores', $ident)->assertForbidden();
        $this->como(self::ADMIN)->postJson('/api/v1/crm/identificadores', $ident)->assertCreated()->assertJsonPath('value', '+51912345678');
        $this->como(self::ADMIN)->postJson('/api/v1/crm/identificadores', $ident)->assertStatus(422);
        $this->como(self::ADMIN)->postJson('/api/v1/crm/identificadores', ['identifier_type' => 'CCI', 'value' => '123'] + $ident)->assertStatus(422);
        $this->assertSame([], $this->como(self::SUPERVISORA)->postJson('/api/v1/crm/reglas/probar', $texto)->json('data'));
        $this->assertSame(1, $this->como(self::SUPERVISORA)->getJson('/api/v1/crm/identificadores?buscar=local nuevo')->json('total'));

        // La base: sin borrar reglas ni identificadores, código único y tipos válidos.
        $this->falla(fn () => DB::table('control_alert_rules')->where('id', $id)->delete());
        $this->falla(fn () => DB::table('official_identifiers')->where('label', 'Celular del local nuevo')->delete());
        $this->falla(fn () => DB::table('control_alert_rules')->insert(['code' => 'CTL-93', 'rule_type' => 'MAGIA', 'pattern' => 'abc', 'severity' => 'HIGH', 'name' => 'x', 'applies_to' => '[]', 'active' => true]));
        $this->como(self::AUDITOR)->getJson('/api/v1/crm/reglas')->assertForbidden();
    }

    public function test_revisar_alertas_con_nota_nadie_la_suya_y_cerrada_no_cambia(): void
    {
        $canal = $this->numero();
        $cv = $this->chat($canal, '+15559900401', 'Cliente revisión');
        $this->como(self::A)->postJson("/api/v1/crm/conversaciones/{$cv}/mensajes", ['texto' => 'Págame directo conmigo'])->assertCreated();
        $a = $this->enEmpresa(fn () => DB::table('control_alerts')->where('conversation_id', $cv)->value('id'));

        $this->como(self::SUPERVISORA)->postJson("/api/v1/crm/alertas/{$a}/revision", ['estado' => 'UNDER_REVIEW'])->assertOk()->assertJsonPath('status', 'UNDER_REVIEW');
        $this->como(self::SUPERVISORA)->postJson("/api/v1/crm/alertas/{$a}/revision", ['estado' => 'CONFIRMED', 'nota' => ''])->assertStatus(422)->assertJsonPath('code', 'RN-CRM-17');
        $f = $this->como(self::SUPERVISORA)->postJson("/api/v1/crm/alertas/{$a}/revision", ['estado' => 'CONFIRMED', 'nota' => 'Se habló con la vendedora y se le recordó la política'])->assertOk();
        $this->assertSame(['CONFIRMED', 'Patricia León Vera', false], [$f->json('status'), $f->json('reviso'), $f->json('puede_revisar')]);
        $this->assertTrue($this->enEmpresa(fn () => DB::table('notifications')->where('role', 'GERENTE')->where('title', 'Alerta de control confirmada')->where('ref->href', "/m/crm/crm-12?id={$a}")->exists()));
        $this->como(self::SUPERVISORA)->postJson("/api/v1/crm/alertas/{$a}/revision", ['estado' => 'DISMISSED', 'nota' => 'Cambio de opinión'])->assertStatus(422);
        $this->assertSame(1, $this->como(self::SUPERVISORA)->getJson("/api/v1/crm/alertas?conversacion={$cv}&estado=CONFIRMED")->json('total'));
        $this->assertSame(0, $this->como(self::SUPERVISORA)->getJson("/api/v1/crm/alertas?conversacion={$cv}")->json('total'), 'Por defecto solo las abiertas y en revisión');

        // Una alerta sobre la supervisora la revisa la gerencia, no ella.
        $this->como(self::SUPERVISORA)->postJson("/api/v1/crm/conversaciones/{$cv}/mensajes", ['texto' => 'Mándalo a mi plin'])->assertCreated();
        $propia = $this->enEmpresa(fn () => DB::table('control_alerts')->where('conversation_id', $cv)->where('rule_code', 'CTL-05')->value('id'));
        $this->como(self::SUPERVISORA)->postJson("/api/v1/crm/alertas/{$propia}/revision", ['estado' => 'DISMISSED', 'nota' => 'Era una broma interna'])->assertStatus(422);
        $this->como(self::GERENTE)->postJson("/api/v1/crm/alertas/{$propia}/revision", ['estado' => 'DISMISSED', 'nota' => 'Falso positivo: era el plin de la empresa'])->assertOk();
        $this->como(self::AUDITOR)->postJson("/api/v1/crm/alertas/{$propia}/revision", ['estado' => 'UNDER_REVIEW'])->assertForbidden();

        // La base: lo detectado no cambia, la cerrada no se reabre y nada se borra.
        $this->falla(fn () => DB::table('control_alerts')->where('id', $a)->update(['status' => 'OPEN']));
        $this->falla(fn () => DB::table('control_alerts')->where('id', $a)->update(['matched_text' => 'otra cosa']));
        $this->falla(fn () => DB::table('control_alerts')->where('id', $a)->delete());
        $this->falla(fn () => DB::table('control_alerts')->insert(['rule_id' => DB::table('control_alert_rules')->value('id'), 'rule_code' => 'X', 'source_type' => 'MESSAGE',
            'user_id' => DB::table('users')->value('id'), 'severity' => 'HIGH', 'matched_text' => 'x', 'excerpt' => 'x', 'status' => 'CONFIRMED', 'raised_at' => now()]));
    }

    public function test_muestreo_semanal_de_cerradas_sin_pedido_con_nota_y_una_vez_por_semana(): void
    {
        // Martes 17/11: A cierra 4 chats sin pedido. La revisión es del lunes 23/11.
        $this->travelTo(Carbon::parse('2026-11-17 10:00:00', 'America/Lima'));
        $canal = $this->numero();
        $chats = [];
        foreach (range(1, 4) as $i) {
            $chats[] = $cv = $this->chat($canal, '+1555990050'.$i, "Muestra {$i}");
            $this->como(self::A)->postJson("/api/v1/crm/conversaciones/{$cv}/cerrar", ['motivo' => 'NO_PURCHASE'])->assertOk();
        }
        $this->travelTo(Carbon::parse('2026-11-24 09:00:00', 'America/Lima'));
        $this->tokens = [];   // las sesiones de hace una semana ya vencieron
        $s = $this->como(self::SUPERVISORA)->getJson('/api/v1/crm/muestreo?semana=2026-11-23&vendedora='.$this->id(self::A))->assertOk();
        $this->assertSame(['2026-11-23', '2026-11-16', '2026-11-22'], [$s->json('semana'), $s->json('desde'), $s->json('hasta')]);
        $porA = collect($s->json('por_vendedora'))->firstWhere('id', $this->id(self::A));
        $this->assertSame([4, 3, 0], [$porA['universo'], $porA['muestra'], $porA['revisadas']]);
        $muestra = collect($s->json('data'))->pluck('id')->all();
        $this->assertCount(3, $muestra);
        $this->assertSame($muestra, collect($this->como(self::SUPERVISORA)->getJson('/api/v1/crm/muestreo?semana=2026-11-23&vendedora='.$this->id(self::A))->json('data'))->pluck('id')->all(), 'La muestra no cambia');
        $fuera = collect($chats)->first(fn ($c) => ! in_array($c, $muestra, true));

        $this->como(self::SUPERVISORA)->postJson("/api/v1/crm/muestreo/{$muestra[0]}", ['semana' => '2026-11-23', 'resultado' => 'OK'])->assertCreated();
        $this->como(self::SUPERVISORA)->postJson("/api/v1/crm/muestreo/{$muestra[0]}", ['semana' => '2026-11-23', 'resultado' => 'OK'])->assertStatus(422);
        $this->como(self::SUPERVISORA)->postJson("/api/v1/crm/muestreo/{$muestra[1]}", ['semana' => '2026-11-23', 'resultado' => 'OBSERVED'])->assertStatus(422)->assertJsonPath('code', 'RN-CRM-18');
        $this->como(self::SUPERVISORA)->postJson("/api/v1/crm/muestreo/{$muestra[1]}", ['semana' => '2026-11-23', 'resultado' => 'OBSERVED', 'nota' => 'No ofreció alternativa al producto'])->assertCreated();
        $this->como(self::SUPERVISORA)->postJson("/api/v1/crm/muestreo/{$fuera}", ['semana' => '2026-11-23', 'resultado' => 'OK'])->assertStatus(422);
        $this->como(self::SUPERVISORA)->postJson("/api/v1/crm/muestreo/{$muestra[2]}", ['semana' => '2026-11-24', 'resultado' => 'OK'])->assertStatus(422);
        $this->como(self::SUPERVISORA)->postJson("/api/v1/crm/muestreo/{$muestra[2]}", ['semana' => '2026-11-30', 'resultado' => 'OK'])->assertStatus(422);

        $s = $this->como(self::SUPERVISORA)->getJson('/api/v1/crm/muestreo?semana=2026-11-23&vendedora='.$this->id(self::A))->json();
        $this->assertSame([2, 1], [collect($s['data'])->whereNotNull('resultado')->count(), collect($s['data'])->where('resultado', 'OBSERVED')->count()]);
        $this->assertSame(1, $this->como(self::SUPERVISORA)->getJson('/api/v1/crm/muestreo?semana=2026-11-23&resultado=PENDING&vendedora='.$this->id(self::A))->json('total'));

        // Quién entra: la vendedora no; la gerencia consulta pero no registra.
        $this->como(self::A)->getJson('/api/v1/crm/muestreo')->assertForbidden();
        $this->como(self::GERENTE)->getJson('/api/v1/crm/muestreo?semana=2026-11-23')->assertOk();
        // La base: una por semana, nota si no es OK, solo lunes, y no se cambia ni se borra.
        $rev = $this->enEmpresa(fn () => DB::table('conversation_reviews')->where('conversation_id', $muestra[0])->value('id'));
        $this->falla(fn () => DB::table('conversation_reviews')->where('id', $rev)->update(['result' => 'INCIDENT']));
        $this->falla(fn () => DB::table('conversation_reviews')->where('id', $rev)->delete());
        $this->falla(fn () => DB::table('conversation_reviews')->insert(['conversation_id' => $muestra[2], 'reviewer_user_id' => $this->id(self::SUPERVISORA), 'sample_week' => '2026-11-24', 'result' => 'OK', 'reviewed_at' => now()]));
    }

    public function test_borrado_en_el_celular_y_chat_sin_responder_son_senales_del_sistema(): void
    {
        $this->travelTo(Carbon::parse('2026-11-24 10:00:00', 'America/Lima'));
        $canal = $this->numero();
        \Illuminate\Support\Facades\Artisan::call('crm:barrido');
        $cv = $this->chat($canal, '+15559900601', 'Cliente señal');
        $m = $this->como(self::A)->postJson("/api/v1/crm/conversaciones/{$cv}/mensajes", ['texto' => 'Hola, ¿qué deseas?'])->assertCreated()->json('mensaje.id');
        $ext = $this->enEmpresa(fn () => DB::table('conversation_messages')->where('id', $m)->value('external_id'));
        $this->enEmpresa(fn () => \App\Modulos\Crm\Services\Recepcion::borradoEnApp($ext));
        $this->enEmpresa(fn () => \App\Modulos\Crm\Services\Recepcion::borradoEnApp($ext));
        $this->assertSame(['CTL-14'], $this->alertasDe($cv), 'Una sola alerta aunque llegue dos veces');
        $this->assertTrue($this->como(self::SUPERVISORA)->getJson("/api/v1/crm/conversaciones/{$cv}")->json('mensajes') !== null);
        $this->assertTrue(collect($this->como(self::SUPERVISORA)->getJson("/api/v1/crm/conversaciones/{$cv}")->json('mensajes'))->firstWhere('id', $m)['borrado_app']);

        // El cliente vuelve a escribir y nadie responde: a los 16 min, tarea y alerta de baja gravedad.
        $this->travel(1)->minutes();
        $this->como(self::SUPERVISORA)->postJson("/api/v1/crm/conversaciones/{$cv}/simular", ['texto' => '¿Hola?', 'tipo' => 'TEXT'])->assertOk();
        $this->travel(16)->minutes();
        \Illuminate\Support\Facades\Artisan::call('crm:barrido');
        $this->assertSame(['CTL-14', 'CTL-15'], $this->alertasDe($cv));
        $this->assertSame('LOW', $this->enEmpresa(fn () => DB::table('control_alerts')->where('conversation_id', $cv)->where('rule_code', 'CTL-15')->value('severity')));
    }
}
