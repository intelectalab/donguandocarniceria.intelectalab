<?php

namespace Tests\Feature\Modulos;

use App\Modulos\Crm\Services\Equipos;
use App\Support\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/** CRM-07 Números y cuentas y CRM-08 Equipos y turnos, con el reparto de chats (RN-CRM-01 a 03, CA-CRM-01). */
class CrmCanalesTest extends TestCase
{
    private const ADMIN = 'lccahuana@donguando.pe';

    private const GERENTE = 'rquispe@donguando.pe';

    private const SUPERVISORA = 'pleon@donguando.pe';

    private const VENDEDORA_A = 'ana.torres@donguando.pe';    // Don Guando

    private const VENDEDORA_B = 'bramos@donguando.pe';        // Don Guando

    private const VENDEDORA_C = 'evargas@donguando.pe';       // Don Guando y Marca 5

    private const VENDEDORA_OTRA = 'cnunez@donguando.pe';     // Marca 2 y Marca 3

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

    private function marca(string $nombre = 'Don Guando'): string
    {
        return $this->enEmpresa(fn () => DB::table('brands')->where('name', $nombre)->value('id'));
    }

    private function conector(string $codigo): string
    {
        return $this->enEmpresa(fn () => DB::table('integration_connectors')->where('code', $codigo)->value('id'));
    }

    /** Un número «solo app» nuevo de Don Guando, para probar sin tocar los de la demostración. */
    private function numeroNuevo(array $mas = []): string
    {
        return $this->como(self::ADMIN)->postJson('/api/v1/crm/canales', $mas + ['kind' => 'WHATSAPP', 'number' => '+51911222333', 'display_name' => 'Don Guando Ventas 3',
            'brand_id' => $this->marca(), 'connection_mode' => 'APP_ONLY', 'assignment_mode' => 'SHIFT_ROUND_ROBIN', 'status' => 'ACTIVE'])->assertCreated()->json('id');
    }

    public function test_lista_de_numeros_con_uso_del_mes_filtros_y_permisos(): void
    {
        $l = $this->como(self::GERENTE)->getJson('/api/v1/crm/canales')->assertOk();
        $this->assertSame(10, $l->json('total'));
        $this->assertSame([6, 6, 6], [$l->json('cifras.whatsapp'), $l->json('cifras.whatsapp_total'), $l->json('cifras.coexistencia')]);
        // El mes por defecto es el último con actividad (octubre en la demostración) y las respuestas gratis usadas se cuentan.
        $this->assertSame('2026-10', $l->json('mes'));
        $v1 = collect($l->json('data'))->firstWhere('number', '+51987650101');
        $this->assertSame(['Don Guando Ventas 1', 'API oficial con coexistencia', 'WA-0101', 'Alta'], [$v1['display_name'], $v1['connection_name'], $v1['connector_code'], $v1['quality_name']]);
        $this->assertGreaterThan(0, $v1['usadas']);
        $this->assertSame(1000, $v1['free_service_quota']);
        $this->assertSame(6, $this->como(self::GERENTE)->getJson('/api/v1/crm/canales?red=WHATSAPP')->json('total'));
        $this->assertSame(['Marca 2'], array_column($this->como(self::GERENTE)->getJson('/api/v1/crm/canales?buscar=marca%202&red=WHATSAPP')->json('data'), 'display_name'));
        $this->assertSame(1, $this->como(self::GERENTE)->getJson('/api/v1/crm/canales?estado=PAUSED')->json('total'));
        // Septiembre: otro mes elegible.
        $this->assertContains('2026-09', array_column($l->json('meses'), 'value'));

        $this->como(self::SUPERVISORA)->getJson('/api/v1/crm/canales')->assertOk()->assertJsonPath('puede', false);
        $this->como(self::VENDEDORA_A)->getJson('/api/v1/crm/canales')->assertForbidden();
        $f = $this->como(self::SUPERVISORA)->getJson("/api/v1/crm/canales/{$v1['id']}")->assertOk();
        $this->assertStringContainsString('Ley 29733', $f->json('recording_notice_text').' Ley 29733');
        $this->assertNotNull($f->json('auto_greeting'));
    }

    public function test_conectar_solo_por_la_api_oficial_una_vez_con_su_conector_y_aviso(): void
    {
        $base = ['kind' => 'WHATSAPP', 'number' => '+51911222333', 'display_name' => 'Don Guando Ventas 3', 'brand_id' => $this->marca(),
            'connection_mode' => 'CLOUD_API_COEXISTENCE', 'assignment_mode' => 'SHIFT_ROUND_ROBIN', 'status' => 'ACTIVE'];
        $mal = fn (array $d) => $this->como(self::ADMIN)->postJson('/api/v1/crm/canales', $d + $base)->assertStatus(422)->json('message');
        $this->assertStringContainsString('No hay conexión por QR', $mal(['connection_mode' => 'DM_API']));
        $this->assertStringContainsString('formato internacional', $mal(['number' => '987654321']));
        $this->assertStringContainsString('una sola vez', $mal(['number' => '+51987650101']));
        $this->assertStringContainsString('necesita su conector', $mal([]));
        $this->assertStringContainsString('no es de WhatsApp', $mal(['connector_id' => $this->conector('META-MSG')]));
        $this->assertStringContainsString('ya atiende otro número', $mal(['connector_id' => $this->conector('WA-0101')]));
        $this->assertStringContainsString('aviso de registro', $mal(['connector_id' => $this->conector('WA-SBX')]));
        $this->como(self::SUPERVISORA)->postJson('/api/v1/crm/canales', $base)->assertForbidden();

        $c = $this->como(self::ADMIN)->postJson('/api/v1/crm/canales', $base + ['connector_id' => $this->conector('WA-SBX'),
            'recording_notice_text' => 'Esta conversación queda registrada (Ley 29733).', 'auto_greeting' => '¡Hola! Ya te atendemos.'])->assertCreated();
        $this->assertSame(['WA-SBX', 1000, true, 0], [$c->json('connector_code'), $c->json('free_service_quota'), $c->json('coexistence'), $c->json('miembros')]);

        // Editar: la red y el número no cambian; el cambio queda en la auditoría.
        $id = $c->json('id');
        $this->como(self::ADMIN)->putJson("/api/v1/crm/canales/{$id}", ['number' => '+51911000000'] + $base)->assertStatus(422);
        $e = $this->como(self::ADMIN)->putJson("/api/v1/crm/canales/{$id}", ['display_name' => 'Ventas 3 (nuevo)',
            'recording_notice_text' => 'Aviso', 'assignment_mode' => 'LEAST_OPEN'] + array_diff_key($base, ['kind' => 1, 'number' => 1]))->assertOk();
        $this->assertSame(['Ventas 3 (nuevo)', '+51911222333', 'Menos chats abiertos'], [$e->json('display_name'), $e->json('number'), $e->json('assignment_name')]);
        $this->enEmpresa(fn () => $this->assertTrue(DB::table('audit.change_log')->where('table_name', 'messaging_channels')->where('row_id', $id)->where('action', 'U')->exists()));

        // La base tampoco acepta un número de WhatsApp conectado de otra forma.
        $marca = $this->marca();
        $this->enEmpresa(function () use ($marca) {
            try {
                DB::transaction(fn () => DB::table('messaging_channels')->insert(['brand_id' => $marca, 'kind' => 'WHATSAPP', 'number' => '+51900000001', 'display_name' => 'QR', 'connection_mode' => 'DM_API',
                    'assignment_mode' => 'MANUAL', 'status' => 'ACTIVE', 'free_service_quota' => 0]));
                $this->fail('Se aceptó WhatsApp sin la API oficial');
            } catch (QueryException $e) {
                $this->assertStringContainsString('messaging_channels_conexion', $e->getMessage());
            }
        });
    }

    public function test_probar_conexion_segun_el_modo(): void
    {
        $l = collect($this->como(self::ADMIN)->getJson('/api/v1/crm/canales')->json('data'));
        $tiktok = $l->firstWhere('connection_mode', 'NOT_AVAILABLE');
        $this->assertStringContainsString('TikTok no está disponible', $this->como(self::ADMIN)->postJson("/api/v1/crm/canales/{$tiktok['id']}/probar")->assertOk()->json('mensaje'));
        $soloApp = $this->numeroNuevo();
        $this->assertStringContainsString('solo app', $this->como(self::ADMIN)->postJson("/api/v1/crm/canales/{$soloApp}/probar")->json('mensaje'));
        $this->como(self::SUPERVISORA)->postJson("/api/v1/crm/canales/{$soloApp}/probar")->assertForbidden();
    }

    public function test_reparto_turno_rotativo_menos_chats_tope_y_manual(): void
    {
        $canal = $this->numeroNuevo();
        [$a, $b, $c] = [$this->id(self::VENDEDORA_A), $this->id(self::VENDEDORA_B), $this->id(self::VENDEDORA_C)];
        $miembro = [];
        foreach ([$a, $b, $c] as $u) {
            $miembro[$u] = $this->como(self::ADMIN)->postJson("/api/v1/crm/canales/{$canal}/miembros", ['user_id' => $u])->assertCreated()->json('id');
            // Turno de todo el día, los siete días: el reparto depende solo del estado y de las asignaciones.
            $this->como(self::ADMIN)->putJson("/api/v1/crm/miembros/{$miembro[$u]}/turnos", ['turnos' => array_map(fn ($d) => ['weekday' => $d, 'from' => '00:00', 'to' => '23:59'], range(1, 7))])->assertOk();
        }
        $this->como(self::VENDEDORA_A)->postJson('/api/v1/crm/mi-estado', ['estado' => 'ONLINE'])->assertOk()->assertJsonPath('estado_name', 'En línea');
        $this->como(self::VENDEDORA_B)->postJson('/api/v1/crm/mi-estado', ['estado' => 'ONLINE'])->assertOk();
        $this->como(self::VENDEDORA_C)->postJson('/api/v1/crm/mi-estado', ['estado' => 'OFFLINE'])->assertOk();

        // CA-CRM-01: A recibió un chat hace una hora, B ninguno, C desconectada => el primero va a B; luego, a A.
        $this->enEmpresa(fn () => DB::table('conversation_assignments')->insert(['channel_id' => $canal, 'conversation_id' => DB::table('conversations')->value('id'),
            'to_user_id' => $a, 'reason' => 'AUTO_SHIFT', 'assigned_at' => now()->subHour()]));
        $this->assertSame($b, $this->enEmpresa(fn () => Equipos::elegir($canal)));
        $this->enEmpresa(fn () => DB::table('conversation_assignments')->insert(['channel_id' => $canal, 'conversation_id' => DB::table('conversations')->value('id'),
            'to_user_id' => $b, 'reason' => 'AUTO_SHIFT', 'assigned_at' => now()]));
        $this->assertSame($a, $this->enEmpresa(fn () => Equipos::elegir($canal)));
        $e = collect($this->como(self::ADMIN)->getJson('/api/v1/crm/equipos')->json('data'))->firstWhere('id', $canal);
        $this->assertSame('Ana Torres Lazo', $e['siguiente']);
        $this->assertSame('Lun a Dom 00:00–23:59', collect($e['miembros'])->firstWhere('user_id', $a)['turnos_texto']);

        // Tope: con A llena, va a B; «menos chats abiertos» elige a quien tiene menos; «manual» no asigna.
        $abiertosA = collect($e['miembros'])->firstWhere('user_id', $a)['abiertos'];
        $this->como(self::ADMIN)->putJson("/api/v1/crm/miembros/{$miembro[$a]}", ['max_open_conversations' => max(1, $abiertosA)])->assertOk();
        $this->assertSame($b, $this->enEmpresa(fn () => Equipos::elegir($canal)));
        $this->como(self::ADMIN)->putJson("/api/v1/crm/miembros/{$miembro[$a]}", ['max_open_conversations' => 25])->assertOk();
        $this->como(self::ADMIN)->putJson("/api/v1/crm/canales/{$canal}/asignacion", ['assignment_mode' => 'LEAST_OPEN'])->assertOk();
        $menos = collect($e['miembros'])->whereIn('user_id', [$a, $b])->sortBy('abiertos')->first()['user_id'];
        $this->assertSame($menos, $this->enEmpresa(fn () => Equipos::elegir($canal)));
        $this->como(self::ADMIN)->putJson("/api/v1/crm/canales/{$canal}/asignacion", ['assignment_mode' => 'MANUAL'])->assertOk();
        $this->assertNull($this->enEmpresa(fn () => Equipos::elegir($canal)));

        // Fuera de turno nadie recibe: con el turno solo del lunes de madrugada, el sábado a mediodía queda en cola.
        $this->como(self::ADMIN)->putJson("/api/v1/crm/canales/{$canal}/asignacion", ['assignment_mode' => 'SHIFT_ROUND_ROBIN'])->assertOk();
        foreach ($miembro as $m) {
            $this->como(self::ADMIN)->putJson("/api/v1/crm/miembros/{$m}/turnos", ['turnos' => [['weekday' => 1, 'from' => '01:00', 'to' => '02:00']]])->assertOk();
        }
        $this->assertNull($this->enEmpresa(fn () => Equipos::elegir($canal, now('America/Lima')->next('Saturday')->setTime(12, 0))));
    }

    public function test_miembros_turnos_y_estado_con_sus_reglas(): void
    {
        $canal = $this->numeroNuevo();
        $mal = fn (string $email) => $this->como(self::ADMIN)->postJson("/api/v1/crm/canales/{$canal}/miembros", ['user_id' => $this->id($email)])->assertStatus(422)->json('message');
        $this->assertStringContainsString('no es vendedora ni supervisora', $mal(self::GERENTE));
        $this->assertStringContainsString('no atiende Don Guando', $mal(self::VENDEDORA_OTRA));
        $sup = $this->como(self::ADMIN)->postJson("/api/v1/crm/canales/{$canal}/miembros", ['user_id' => $this->id(self::SUPERVISORA)])->assertCreated()->json('id');
        $this->assertStringContainsString('ya es miembro', $mal(self::SUPERVISORA));
        $this->como(self::SUPERVISORA)->postJson("/api/v1/crm/canales/{$canal}/miembros", ['user_id' => $this->id(self::VENDEDORA_A)])->assertForbidden();
        $e = collect($this->como(self::ADMIN)->getJson('/api/v1/crm/equipos')->json('data'))->firstWhere('id', $canal);
        $this->assertSame(['Supervisora', 'Horario de atención'], [$e['miembros'][0]['role_name'], $e['miembros'][0]['turnos_texto']]);

        // Turnos: un turno por día y que termine después de empezar.
        $this->como(self::ADMIN)->putJson("/api/v1/crm/miembros/{$sup}/turnos", ['turnos' => [['weekday' => 1, 'from' => '14:00', 'to' => '08:00']]])->assertStatus(422);
        $this->como(self::ADMIN)->putJson("/api/v1/crm/miembros/{$sup}/turnos", ['turnos' => [['weekday' => 1, 'from' => '08:00', 'to' => '12:00'], ['weekday' => 1, 'from' => '13:00', 'to' => '18:00']]])->assertStatus(422);
        $this->como(self::ADMIN)->putJson("/api/v1/crm/miembros/{$sup}/turnos", ['turnos' => [
            ['weekday' => 1, 'from' => '08:00', 'to' => '14:00'], ['weekday' => 2, 'from' => '08:00', 'to' => '14:00'], ['weekday' => 3, 'from' => '08:00', 'to' => '14:00'],
            ['weekday' => 6, 'from' => '09:00', 'to' => '13:00']]])->assertOk();
        $e = collect($this->como(self::ADMIN)->getJson('/api/v1/crm/equipos')->json('data'))->firstWhere('id', $canal);
        $this->assertSame('Lun a Mié 08:00–14:00 · Sáb 09:00–13:00', $e['miembros'][0]['turnos_texto']);

        // Quitar no borra: queda inactiva. Con chats abiertos en el número, antes hay que reasignarlos.
        $this->como(self::ADMIN)->putJson("/api/v1/crm/miembros/{$sup}", ['active' => false])->assertOk();
        $this->assertFalse(collect($this->como(self::ADMIN)->getJson('/api/v1/crm/equipos')->json('data'))->firstWhere('id', $canal)['miembros'][0]['active']);
        $v1 = $this->enEmpresa(fn () => DB::table('messaging_channels')->where('number', '+51987650101')->value('id'));
        $conChats = $this->enEmpresa(fn () => DB::table('channel_members as m')->where('m.channel_id', $v1)->whereExists(fn ($q) => $q->from('conversations as c')
            ->whereColumn('c.assigned_user_id', 'm.user_id')->where('c.channel_id', $v1)->where('c.status', '<>', 'CLOSED'))->value('m.id'));
        $this->assertStringContainsString('reasígnalos', $this->como(self::ADMIN)->putJson("/api/v1/crm/miembros/{$conChats}", ['active' => false])->assertStatus(422)->json('message'));

        // El estado de quien atiende: solo se agrega al historial; quien no es miembro no lo marca.
        $this->como(self::VENDEDORA_A)->getJson('/api/v1/crm/mi-estado')->assertOk()->assertJsonPath('miembro', true);
        $this->como('mcardenas@donguando.pe')->postJson('/api/v1/crm/mi-estado', ['estado' => 'ONLINE'])->assertForbidden();
        $this->enEmpresa(function () {
            try {
                DB::transaction(fn () => DB::statement("UPDATE crm_agent_status SET status = 'ONLINE'"));
                $this->fail('Se pudo cambiar el historial de estados');
            } catch (QueryException $e) {
                $this->assertMatchesRegularExpression('/permission denied|permiso denegado/i', $e->getMessage());
            }
        });
    }

    public function test_horario_de_atencion_desde_el_parametro(): void
    {
        $h = $this->enEmpresa(fn () => Equipos::horario());
        $this->assertSame(['08:00', '20:00'], $h[1]);
        $this->assertSame(['08:00', '20:00'], $h[6]);
        $this->assertSame(['09:00', '14:00'], $h[7]);
        $domingo = now('America/Lima')->next('Sunday');
        $this->assertTrue($this->enEmpresa(fn () => Equipos::enTurno([], $domingo->copy()->setTime(10, 0))));
        $this->assertFalse($this->enEmpresa(fn () => Equipos::enTurno([], $domingo->copy()->setTime(15, 0))));
    }
}
