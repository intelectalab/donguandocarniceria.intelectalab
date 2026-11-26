<?php

namespace Tests\Feature\Modulos;

use App\Support\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/** TEL-01 Lista de activación y TEL-02 Ajustes (RN-TEL-01 a 04; CA-TEL-01 y 02). */
class TelActivacionTest extends TestCase
{
    private const ADMIN = 'lccahuana@donguando.pe';

    private const GERENTE = 'rquispe@donguando.pe';

    private const SUPERVISORA = 'pleon@donguando.pe';

    private const A = 'ana.torres@donguando.pe';

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

    /** Intenta en un punto de guardado y devuelve el mensaje del error de la base (o null si pasó). */
    private function errorDeLaBase(callable $f): ?string
    {
        try {
            $this->enEmpresa(fn () => DB::transaction($f));

            return null;
        } catch (QueryException $e) {
            return $e->getMessage();
        }
    }

    /** Completa la lista en Módulos activables y enciende Telefonía (como la gerente). */
    private function encender(): void
    {
        foreach (['CARRIER_FORWARDING', 'SIGNED_POLICY'] as $p) {
            $this->como(self::GERENTE)->postJson("/api/v1/plt/modulos/tel/pasos/{$p}", ['notes' => 'Constancia archivada en la carpeta de Telefonía'])->assertOk();
        }
        $this->como(self::GERENTE)->putJson('/api/v1/plt/modulos/TEL', ['enabled' => true, 'reason' => 'Central lista para las vendedoras'])->assertOk();
        $this->tokens = [];   // los permisos de TEL se cargan al volver a entrar
    }

    public function test_ca_tel_01_con_telefonia_apagada_la_api_y_la_base_rechazan(): void
    {
        $this->como(self::GERENTE)->getJson('/api/v1/tel/ajustes')->assertForbidden()->assertJsonPath('code', 'MODULE_DISABLED');
        $this->assertStringContainsString('RN-PLT-07', $this->como(self::ADMIN)->getJson('/api/v1/tel/activacion')->assertForbidden()->json('message'));
        $this->como(self::ADMIN)->putJson('/api/v1/tel/ajustes', [])->assertForbidden();

        // La base: grabar ajustes, números o llamadas falla con RN-PLT-07.
        $this->assertStringContainsString('RN-PLT-07', (string) $this->errorDeLaBase(fn () => DB::table('tel_settings')->update(['retention_days' => 90])));
        $this->assertStringContainsString('RN-PLT-07', (string) $this->errorDeLaBase(fn () => DB::table('tel_numbers')->insert(['e164' => '+5117000000', 'number_kind' => 'LANDLINE_LIMA', 'status' => 'ACTIVE'])));
        $this->assertNotNull($this->errorDeLaBase(fn () => DB::table('tel_calls')->limit(1)->delete()), 'Las llamadas nunca se borran');
        // Lo que sí pasa: la lista de activación (se llena antes de encender) y la unión de clientes duplicados.
        $this->assertNull($this->errorDeLaBase(fn () => DB::table('tel_activation_steps')->where('step_code', 'CARRIER_FORWARDING')->update(['notes' => 'Pedido al operador'])));
        $this->assertNull($this->errorDeLaBase(function () {
            $c = DB::table('tel_calls')->whereNotNull('customer_id')->first(['id', 'customer_id']);
            $otro = DB::table('customers')->where('id', '<>', $c->customer_id)->value('id');
            DB::table('tel_calls')->where('id', $c->id)->update(['customer_id' => $otro, 'updated_at' => now()]);
        }));
        $this->assertStringContainsString('RN-PLT-07', (string) $this->errorDeLaBase(fn () => DB::table('tel_calls')->limit(1)->update(['duration_seconds' => 1, 'customer_id' => null])));
    }

    public function test_ca_tel_02_al_encender_queda_en_configuracion_y_en_vivo_exige_los_seis_pasos(): void
    {
        $llamadas = $this->enEmpresa(fn () => DB::table('tel_calls')->count());
        $this->encender();
        $a = $this->como(self::ADMIN)->getJson('/api/v1/tel/activacion')->assertOk();
        $this->assertSame([true, 'SETUP', 6, 6, true], [$a->json('encendido'), $a->json('etapa'), $a->json('hechos'), $a->json('total'), $a->json('puede')]);

        // Con 5 de 6 pasos, pasar a en vivo se rechaza (RN-TEL-02); con los 6, pasa.
        $this->enEmpresa(fn () => DB::table('tel_activation_steps')->where('step_code', 'SWITCH_ON')->update(['done' => false, 'done_at' => null]));
        $this->como(self::ADMIN)->postJson('/api/v1/tel/activacion/en-vivo')->assertStatus(422)->assertJsonPath('code', 'RN-TEL-02');
        $this->como(self::ADMIN)->postJson('/api/v1/tel/activacion/pasos/SWITCH_ON', ['evidencia' => 'Llamada de prueba completa'])->assertStatus(422);
        $this->enEmpresa(fn () => DB::table('tel_activation_steps')->where('step_code', 'SWITCH_ON')->update(['done' => true, 'done_at' => now()]));
        $this->como(self::SUPERVISORA)->postJson('/api/v1/tel/activacion/en-vivo')->assertForbidden();
        $v = $this->como(self::ADMIN)->postJson('/api/v1/tel/activacion/en-vivo')->assertOk();
        $this->assertSame(['LIVE', 'Luis Ccahuana Rojas'], [$v->json('etapa'), $v->json('en_vivo_por')]);
        $this->como(self::ADMIN)->postJson('/api/v1/tel/activacion/en-vivo')->assertStatus(422);

        // Volver a configuración pide motivo.
        $this->como(self::ADMIN)->postJson('/api/v1/tel/activacion/configuracion', ['motivo' => 'corto'])->assertStatus(422);
        $this->como(self::ADMIN)->postJson('/api/v1/tel/activacion/configuracion', ['motivo' => 'Cambio de proveedor de telefonía'])->assertOk()->assertJsonPath('etapa', 'SETUP');
        $this->como(self::ADMIN)->postJson('/api/v1/tel/activacion/en-vivo')->assertOk();

        // Apagar el módulo lo devuelve a configuración, conserva lo registrado y vuelve a bloquear.
        $this->como(self::GERENTE)->putJson('/api/v1/plt/modulos/TEL', ['enabled' => false, 'reason' => 'Se pospone la central hasta enero'])->assertOk();
        $this->assertSame(['SETUP', $llamadas], $this->enEmpresa(fn () => [DB::table('tel_settings')->value('stage'), DB::table('tel_calls')->count()]));
        $this->assertStringContainsString('Módulo apagado', (string) $this->enEmpresa(fn () => DB::table('tel_settings')->value('setup_reason')));
        $this->tokens = [];
        $this->como(self::ADMIN)->getJson('/api/v1/tel/activacion')->assertForbidden();
        $this->assertNotNull($this->errorDeLaBase(fn () => DB::table('tel_settings')->update(['ring_timeout_s' => 30])));
    }

    public function test_ajustes_con_aviso_obligatorio_parametros_con_motivo_y_audio(): void
    {
        $this->encender();
        $s = $this->como(self::SUPERVISORA)->getJson('/api/v1/tel/ajustes')->assertOk();
        $this->assertSame([180, 30, 25, false, true, false], [$s->json('retention_days'), $s->json('callback_due_minutes'), $s->json('ring_timeout_s'),
            $s->json('transcription_enabled'), $s->json('outbound_registered_only'), $s->json('puede')]);
        $this->assertSame(0.074, $s->json('tarifas.out_mobile'));
        $base = collect($this->como(self::ADMIN)->getJson('/api/v1/tel/ajustes')->json())->only(['provider', 'connector_id', 'recording_enabled', 'recording_notice_text', 'ring_strategy',
            'retention_days', 'callback_due_minutes', 'ring_timeout_s', 'transcription_enabled', 'outbound_registered_only', 'tarifas'])->all();

        $this->como(self::SUPERVISORA)->putJson('/api/v1/tel/ajustes', $base)->assertForbidden();
        $this->como(self::ADMIN)->putJson('/api/v1/tel/ajustes', ['recording_notice_text' => 'Hola'] + $base)->assertStatus(422)->assertJsonPath('code', 'RN-TEL-04');
        $this->como(self::ADMIN)->putJson('/api/v1/tel/ajustes', ['retention_days' => 90] + $base)->assertStatus(422)->assertJsonPath('code', 'RN-PLT-06');
        $this->como(self::ADMIN)->putJson('/api/v1/tel/ajustes', ['ring_timeout_s' => 200] + $base)->assertStatus(422);
        $this->como(self::ADMIN)->putJson('/api/v1/tel/ajustes', ['connector_id' => $this->enEmpresa(fn () => DB::table('integration_connectors')->where('code', 'WA-SBX')->value('id'))] + $base)
            ->assertStatus(422)->assertJsonPath('code', 'RN-TEL-03');
        // Sin cambiar parámetros no pide motivo; cambiando la retención y la transcripción, sí, y quedan en el historial de parámetros.
        $this->como(self::ADMIN)->putJson('/api/v1/tel/ajustes', ['ring_strategy' => 'SIMULTANEOUS', 'provider' => 'FAKE'] + $base)->assertOk()->assertJsonPath('ring_strategy', 'SIMULTANEOUS');
        $r = $this->como(self::ADMIN)->putJson('/api/v1/tel/ajustes', ['retention_days' => 90, 'transcription_enabled' => true, 'provider' => 'FAKE', 'ring_strategy' => 'SIMULTANEOUS',
            'motivo' => 'El abogado validó 90 días de retención'] + $base)->assertOk();
        $this->assertSame([90, true], [$r->json('retention_days'), $r->json('transcription_enabled')]);
        $this->assertSame(['90', 'true'], $this->enEmpresa(fn () => [DB::table('parameters')->where('key', 'tel_retention_days')->value('value'), DB::table('parameters')->where('key', 'tel_transcription_enabled')->value('value')]));

        // En vivo no se cambia el proveedor.
        $this->como(self::ADMIN)->postJson('/api/v1/tel/activacion/en-vivo')->assertOk();
        $vivo = collect($this->como(self::ADMIN)->getJson('/api/v1/tel/ajustes')->json())->only(array_keys($base))->all();
        $this->como(self::ADMIN)->putJson('/api/v1/tel/ajustes', ['provider' => 'TWILIO'] + $vivo)->assertStatus(422)->assertJsonPath('code', 'RN-TEL-03');

        // El audio del aviso: solo audio; luego se escucha con un enlace temporal.
        $this->como(self::ADMIN)->postJson('/api/v1/tel/ajustes/audio', ['archivo' => UploadedFile::fake()->createWithContent('aviso.txt', 'texto')])->assertStatus(422);
        $mp3 = "ID3\x04\x00\x00\x00\x00\x00\x00".str_repeat("\xFF\xFB\x90\x64".str_repeat("\x00", 413), 6);
        $a = $this->como(self::ADMIN)->postJson('/api/v1/tel/ajustes/audio', ['archivo' => UploadedFile::fake()->createWithContent('aviso-grabacion.mp3', $mp3)])->assertCreated();
        $this->assertSame('aviso-grabacion.mp3', $a->json('audio.nombre'));
        $this->assertStringContainsString('/archivos/', $this->como(self::SUPERVISORA)->getJson('/api/v1/tel/ajustes/audio')->assertOk()->json('url'));
        $this->como(self::A)->getJson('/api/v1/tel/ajustes')->assertForbidden();

        // La base: no se borran los ajustes y la grabación exige aviso.
        $this->assertNotNull($this->errorDeLaBase(fn () => DB::table('tel_settings')->delete()));
        $this->assertNotNull($this->errorDeLaBase(fn () => DB::table('tel_settings')->update(['recording_notice_text' => ''])));
    }
}
