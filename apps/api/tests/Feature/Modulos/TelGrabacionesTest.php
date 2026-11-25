<?php

namespace Tests\Feature\Modulos;

use App\Models\User;
use App\Modulos\Tel\Services\Grabaciones;
use App\Support\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/** TEL-10 Grabación y transcripción y TEL-12 Escuchas y retención (RN-TEL-09, 10 y 11; Ley 29733). */
class TelGrabacionesTest extends TestCase
{
    private const ADMIN = 'lccahuana@donguando.pe';

    private const GERENTE = 'rquispe@donguando.pe';

    private const SUPERVISORA = 'pleon@donguando.pe';

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

    private function preparar(bool $transcripcion = false): void
    {
        foreach (['CARRIER_FORWARDING', 'SIGNED_POLICY'] as $p) {
            $this->como(self::GERENTE)->postJson("/api/v1/plt/modulos/tel/pasos/{$p}", ['notes' => 'Constancia archivada en la carpeta de Telefonía'])->assertOk();
        }
        $this->como(self::GERENTE)->putJson('/api/v1/plt/modulos/TEL', ['enabled' => true, 'reason' => 'Central lista para las vendedoras'])->assertOk();
        $this->tokens = [];
        $base = collect($this->como(self::ADMIN)->getJson('/api/v1/tel/ajustes')->json())->only(['provider', 'connector_id', 'recording_enabled', 'recording_notice_text', 'ring_strategy',
            'retention_days', 'callback_due_minutes', 'ring_timeout_s', 'transcription_enabled', 'outbound_registered_only', 'tarifas'])->all();
        $this->como(self::ADMIN)->putJson('/api/v1/tel/ajustes', ['provider' => 'FAKE', 'transcription_enabled' => $transcripcion] + $base)->assertOk();
        $this->como(self::ADMIN)->postJson('/api/v1/tel/activacion/en-vivo')->assertOk();
    }

    private function transcripcion(bool $si): void
    {
        $base = collect($this->como(self::ADMIN)->getJson('/api/v1/tel/ajustes')->json())->only(['provider', 'connector_id', 'recording_enabled', 'recording_notice_text', 'ring_strategy',
            'retention_days', 'callback_due_minutes', 'ring_timeout_s', 'transcription_enabled', 'outbound_registered_only', 'tarifas'])->all();
        $this->como(self::ADMIN)->putJson('/api/v1/tel/ajustes', ['transcription_enabled' => $si, 'motivo' => 'Revisión de calidad de las llamadas'] + $base)->assertOk();
    }

    /** Una llamada atendida por Ana con su grabación; devuelve el id de la grabación. */
    private function grabacion(string $desde, int $segundos = 150): string
    {
        $r = $this->como(self::A)->postJson('/api/v1/tel/telefono/simular', ['from' => $desde, 'option' => 1, 'resultado' => 'COMPLETED', 'segundos' => $segundos])->assertCreated();

        return $this->enEmpresa(fn () => DB::table('tel_recordings')->where('call_id', $r->json('id'))->value('id'));
    }

    public function test_escuchar_y_descargar_con_bitacora_cada_quien_lo_suyo(): void
    {
        $this->travelTo(Carbon::parse('2026-11-24 10:00', 'America/Lima'));
        $this->preparar();
        $mia = $this->grabacion('+51955500811');
        $this->assertNotNull($mia);

        $s = $this->como(self::SUPERVISORA)->getJson('/api/v1/tel/grabaciones')->assertOk();
        $this->assertGreaterThan(90, $s->json('total'));
        $this->assertGreaterThan(0, $s->json('cifras.transcritas'));
        $this->assertGreaterThan(0, $s->json('cifras.con_alertas'), 'Las alertas de demostración de las transcripciones cuentan');
        $this->assertSame(1, $this->como(self::SUPERVISORA)->getJson('/api/v1/tel/grabaciones?buscar=955500811')->json('total'));
        // La vendedora solo ve las suyas; la de otra no existe para ella.
        $a = collect($this->como(self::A)->getJson('/api/v1/tel/grabaciones?per_page=100')->json('data'));
        $this->assertTrue($a->every(fn ($g) => $g['vendedora'] === 'Ana Torres Lazo'));
        $ana = $this->id(self::A);
        $ajena = $this->enEmpresa(fn () => DB::table('tel_recordings as r')->join('tel_calls as c', 'c.id', '=', 'r.call_id')->where('c.user_id', '<>', $ana)
            ->where('r.status', 'AVAILABLE')->value('r.id'));
        $this->como(self::A)->getJson("/api/v1/tel/grabaciones/{$ajena}")->assertNotFound();
        $this->como(self::A)->postJson("/api/v1/tel/grabaciones/{$ajena}/acceso", ['accion' => 'PLAY'])->assertNotFound();
        $this->como('mcardenas@donguando.pe')->getJson('/api/v1/tel/grabaciones')->assertForbidden();

        // Escuchar la suya: queda en la bitácora de la grabación y en la de accesos.
        $e = $this->como(self::A)->postJson("/api/v1/tel/grabaciones/{$mia}/acceso", ['accion' => 'PLAY'])->assertOk();
        $this->assertSame([true, 150], [$e->json('prueba'), $e->json('duracion')], 'El proveedor de prueba no guarda audio');
        // Descargar: solo gerencia y con motivo.
        $this->como(self::A)->postJson("/api/v1/tel/grabaciones/{$mia}/acceso", ['accion' => 'DOWNLOAD', 'motivo' => 'Reclamo del cliente'])->assertStatus(422)->assertJsonPath('code', 'RN-TEL-11');
        $this->como(self::SUPERVISORA)->postJson("/api/v1/tel/grabaciones/{$mia}/acceso", ['accion' => 'DOWNLOAD', 'motivo' => 'Reclamo del cliente'])->assertStatus(422);
        $this->como(self::GERENTE)->postJson("/api/v1/tel/grabaciones/{$mia}/acceso", ['accion' => 'DOWNLOAD'])->assertStatus(422)->assertJsonPath('code', 'RN-TEL-11');
        $this->como(self::GERENTE)->postJson("/api/v1/tel/grabaciones/{$mia}/acceso", ['accion' => 'DOWNLOAD', 'motivo' => 'Reclamo de peso del cliente'])->assertOk();
        $this->como(self::SUPERVISORA)->postJson("/api/v1/tel/grabaciones/{$mia}/acceso", ['accion' => 'PLAY'])->assertOk();

        $d = $this->como(self::SUPERVISORA)->getJson("/api/v1/tel/grabaciones/{$mia}")->assertOk();
        $this->assertSame(['Escucha', 'Descarga', 'Escucha'], array_column($d->json('accesos'), 'accion'));
        $this->assertSame('Reclamo de peso del cliente', $d->json('accesos.1.motivo'));
        $this->assertSame([true, false], [$d->json('permisos.escuchar'), $d->json('permisos.descargar')]);
        // La vendedora solo ve sus propias escuchas.
        $this->assertCount(1, $this->como(self::A)->getJson("/api/v1/tel/grabaciones/{$mia}")->json('accesos'));
        $this->assertSame(1, $this->enEmpresa(fn () => DB::table('access_log')->where('event', 'RECORDING_DOWNLOADED')->where('entity_id', $mia)->where('module_code', 'TEL')->count()));
        $this->assertSame(2, $this->enEmpresa(fn () => DB::table('access_log')->where('event', 'RECORDING_PLAYED')->where('entity_id', $mia)->count()));

        // La bitácora es solo de inserción y la descarga sin motivo la rechaza la base.
        $this->enEmpresa(function () use ($mia) {
            foreach ([
                fn () => DB::table('tel_recording_access_log')->where('recording_id', $mia)->update(['reason' => 'otro']),
                fn () => DB::table('tel_recording_access_log')->where('recording_id', $mia)->delete(),
                fn () => DB::table('tel_recordings')->where('id', $mia)->delete(),
                fn () => DB::table('tel_recording_access_log')->insert(['recording_id' => $mia, 'user_id' => DB::table('users')->where('email', self::GERENTE)->value('id'),
                    'action' => 'DOWNLOAD', 'reason' => null, 'accessed_at' => now()]),
            ] as $i => $mal) {
                try {
                    DB::transaction($mal);
                    $this->fail("La base debía rechazar el cambio {$i}");
                } catch (QueryException) {
                    $this->assertTrue(true);
                }
            }
        });
    }

    public function test_transcripcion_con_alertas_de_control_una_sola_vez(): void
    {
        $this->travelTo(Carbon::parse('2026-11-24 10:00', 'America/Lima'));
        $this->preparar();
        $g = $this->grabacion('+51955500822', 125);
        $this->como(self::SUPERVISORA)->postJson("/api/v1/tel/grabaciones/{$g}/transcribir")->assertStatus(422)->assertJsonPath('code', 'RN-TEL-09');
        $this->transcripcion(true);
        $this->como(self::A)->postJson("/api/v1/tel/grabaciones/{$g}/transcribir")->assertForbidden();

        // Con un texto que tiene un celular ajeno y una frase de control: cada coincidencia es una alerta de la llamada.
        $antes = $this->enEmpresa(fn () => DB::table('control_alerts')->where('source_type', 'CALL_TRANSCRIPT')->count());
        $this->enEmpresa(function () use ($g) {
            $sup = User::where('email', self::SUPERVISORA)->first();
            Grabaciones::transcribir($g, $sup, 'Vendedora: Si quiere se lo dejo más barato por fuera, yapéame a mi número 912 345 678 y se lo llevo yo.');
        });
        $d = $this->como(self::SUPERVISORA)->getJson("/api/v1/tel/grabaciones/{$g}")->assertOk();
        $this->assertStringContainsString('912 345 678', $d->json('transcripcion.texto'));
        $this->assertEquals(0.15, $d->json('transcripcion.cost_usd'), '3 minutos × USD 0,05');
        $this->assertGreaterThan(0, count($d->json('alertas_lista')));
        $this->assertGreaterThan($antes, $this->enEmpresa(fn () => DB::table('control_alerts')->where('source_type', 'CALL_TRANSCRIPT')->count()));
        $call = $this->enEmpresa(fn () => DB::table('tel_recordings')->where('id', $g)->value('call_id'));
        $alerta = $this->enEmpresa(fn () => DB::table('control_alerts')->where('call_id', $call)->first());
        $this->assertSame([$this->id(self::A), 'CALL_TRANSCRIPT'], [$alerta->user_id, $alerta->source_type]);
        $this->assertSame(1, $this->como(self::SUPERVISORA)->getJson('/api/v1/tel/grabaciones?alertas=1&buscar=955500822')->json('total'));
        // Una sola transcripción, que ya no cambia.
        $this->como(self::SUPERVISORA)->postJson("/api/v1/tel/grabaciones/{$g}/transcribir")->assertStatus(422)->assertJsonPath('code', 'RN-TEL-09');
        $this->enEmpresa(function () use ($g) {
            try {
                DB::transaction(fn () => DB::table('tel_transcripts')->where('recording_id', $g)->update(['transcript' => 'cambiado']));
                $this->fail('La transcripción no debía cambiar');
            } catch (QueryException) {
                $this->assertTrue(true);
            }
        });
        // Por la API sale el texto de muestra del proveedor de prueba.
        $otra = $this->grabacion('+51955500823');
        $t = $this->como(self::SUPERVISORA)->postJson("/api/v1/tel/grabaciones/{$otra}/transcribir")->assertOk();
        $this->assertSame('Proveedor de prueba', $t->json('transcripcion.proveedor'));
    }

    public function test_retencion_legal_purga_y_panel_de_escuchas(): void
    {
        // Dos llamadas del 01/04/2026: su retención de 180 días vence el 28/09/2026.
        $this->travelTo(Carbon::parse('2026-04-01 10:00', 'America/Lima'));
        $this->preparar();
        $retenida = $this->grabacion('+51955500831');
        $vence = $this->grabacion('+51955500832');
        $this->assertSame('2026-09-28', $this->enEmpresa(fn () => DB::table('tel_recordings')->where('id', $vence)->value('retention_until')));

        $this->travelTo(Carbon::parse('2026-11-24 10:00', 'America/Lima'));
        $this->tokens = [];
        // Retención legal: con motivo, solo la supervisión.
        $this->como(self::A)->postJson("/api/v1/tel/grabaciones/{$retenida}/retencion", ['activa' => true, 'motivo' => 'Libro de Reclamaciones N.º 2026-140'])->assertForbidden();
        $this->como(self::SUPERVISORA)->postJson("/api/v1/tel/grabaciones/{$retenida}/retencion", ['activa' => true, 'motivo' => 'x'])->assertStatus(422);
        $h = $this->como(self::SUPERVISORA)->postJson("/api/v1/tel/grabaciones/{$retenida}/retencion", ['activa' => true, 'motivo' => 'Libro de Reclamaciones N.º 2026-140'])->assertOk();
        $this->assertTrue($h->json('legal_hold'));
        $this->como(self::SUPERVISORA)->postJson("/api/v1/tel/grabaciones/{$retenida}/retencion", ['activa' => true, 'motivo' => 'Otra vez el mismo caso'])->assertStatus(422);

        // Purga: la vencida pierde su audio; la retenida se conserva; la corrida queda en las de depuración.
        $p = $this->como(self::SUPERVISORA)->getJson('/api/v1/tel/grabaciones/retencion?vista=retenidas&buscar=955500831')->assertOk();
        $this->assertSame(1, $p->json('total'));
        $this->como(self::A)->postJson('/api/v1/tel/grabaciones/purga')->assertForbidden();
        $r = $this->como(self::SUPERVISORA)->postJson('/api/v1/tel/grabaciones/purga')->assertOk();
        $this->assertGreaterThanOrEqual(1, $r->json('purgadas'));
        [$estadoV, $estadoR] = $this->enEmpresa(fn () => [DB::table('tel_recordings')->where('id', $vence)->value('status'), DB::table('tel_recordings')->where('id', $retenida)->value('status')]);
        $this->assertSame(['PURGED', 'AVAILABLE'], [$estadoV, $estadoR]);
        $this->assertSame(1, $this->enEmpresa(fn () => DB::table('audit_purge_runs')->where('category', 'RECORDINGS')->where('run_by', 'Patricia León Vera')->count()));
        // Los datos de la llamada se conservan; la grabación purgada no se escucha ni se retiene.
        $this->assertNotNull($this->enEmpresa(fn () => DB::table('tel_calls')->join('tel_recordings as r', 'r.call_id', '=', 'tel_calls.id')->where('r.id', $vence)->value('tel_calls.duration_seconds')));
        $this->como(self::A)->postJson("/api/v1/tel/grabaciones/{$vence}/acceso", ['accion' => 'PLAY'])->assertStatus(422)->assertJsonPath('code', 'RN-TEL-10');
        $this->como(self::SUPERVISORA)->postJson("/api/v1/tel/grabaciones/{$vence}/retencion", ['activa' => true, 'motivo' => 'Reclamo tardío del cliente'])->assertStatus(422);
        // La purga nocturna no vuelve a purgar nada (ni la retenida).
        Artisan::call('tel:purga');
        $this->assertSame('AVAILABLE', $this->enEmpresa(fn () => DB::table('tel_recordings')->where('id', $retenida)->value('status')));
        // La base: una purgada no vuelve, una retenida no se purga, la retención pide motivo.
        $this->enEmpresa(function () use ($vence, $retenida) {
            foreach ([
                fn () => DB::table('tel_recordings')->where('id', $vence)->update(['status' => 'AVAILABLE']),
                fn () => DB::table('tel_recordings')->where('id', $retenida)->update(['status' => 'PURGED', 'purged_at' => now()]),
                fn () => DB::table('tel_recordings')->where('id', $retenida)->update(['legal_hold_reason' => null]),
                fn () => DB::table('tel_recordings')->where('id', $retenida)->update(['retention_until' => '2030-01-01']),
            ] as $i => $mal) {
                try {
                    DB::transaction($mal);
                    $this->fail("La base debía rechazar el cambio {$i}");
                } catch (QueryException) {
                    $this->assertTrue(true);
                }
            }
        });

        // Panel de escuchas: bitácora con filtros, corridas y purgadas; la vendedora no entra.
        $this->como(self::SUPERVISORA)->postJson("/api/v1/tel/grabaciones/{$retenida}/acceso", ['accion' => 'PLAY'])->assertOk();
        $b = $this->como(self::SUPERVISORA)->getJson('/api/v1/tel/grabaciones/retencion?vista=bitacora&accion=PLAY&persona='.$this->id(self::SUPERVISORA))->assertOk();
        $this->assertGreaterThanOrEqual(1, $b->json('total'));
        $this->assertSame('Escucha', $b->json('data.0.accion'));
        $this->assertGreaterThanOrEqual(1, $this->como(self::SUPERVISORA)->getJson('/api/v1/tel/grabaciones/retencion?vista=corridas')->json('total'));
        $pu = $this->como(self::SUPERVISORA)->getJson('/api/v1/tel/grabaciones/retencion?vista=purgadas&buscar=955500832')->assertOk();
        $this->assertSame(1, $pu->json('total'));
        $this->assertGreaterThan(0, $pu->json('cifras.purgadas'));
        $this->como(self::A)->getJson('/api/v1/tel/grabaciones/retencion')->assertForbidden();
    }
}
