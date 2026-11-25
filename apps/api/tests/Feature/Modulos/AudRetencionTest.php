<?php

namespace Tests\Feature\Modulos;

use App\Support\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/** AUD-06 Políticas de retención, AUD-07 Corridas de depuración y AUD-08 Revisión de accesos. */
class AudRetencionTest extends TestCase
{
    private const GERENTE = 'rquispe@donguando.pe';

    private const ADMIN = 'lccahuana@donguando.pe';

    private const AUDITOR = 'aexterno@donguando.pe';         // consulta, no cambia

    private const ADMINISTRACION = 'chuaman@donguando.pe';   // no ve estas pantallas

    private array $tokens = [];

    private function como(string $email): static
    {
        return $this->desde(self::DG, $this->tokens[$email] ??= $this->ingresar(self::DG, $email));
    }

    /** Ejecuta en la base dentro de una empresa (por defecto Don Guando), como una persona. */
    private function enEmpresa(callable $f, string $empresa = 'Don Guando', ?string $email = self::ADMIN): mixed
    {
        TenantContext::set(['id' => DB::table('tenants')->where('short', $empresa)->value('id')]);
        TenantContext::setUser($email ? DB::table('users')->where('email', $email)->value('id') : null);
        try {
            return $f();
        } finally {
            TenantContext::set(null);
        }
    }

    public function test_politicas_con_minimo_de_cinco_anios_motivo_y_ejemplo_de_enmascarado(): void
    {
        $l = $this->como(self::AUDITOR)->getJson('/api/v1/aud/retencion')->assertOk();
        $this->assertCount(9, $l->json('data'));
        $this->assertFalse($l->json('puede'), 'La auditoría consulta, no cambia');
        $cambios = collect($l->json('data'))->firstWhere('category', 'CHANGE_LOG');
        $this->assertSame(['Auditoría de cambios', '5 años', 60, true], [$cambios['nombre'], $cambios['plazo'], $cambios['minimo'], $cambios['archive_before_purge']]);
        $this->assertSame(now('America/Lima')->subMonths(60)->toDateString(), $cambios['corte']);
        // Ejemplo de enmascarado: los secretos se guardan como ***; el celular se ve enmascarado.
        $e = collect($l->json('enmascarado'))->keyBy('campo');
        $this->assertSame('***', $e['password']['en_auditoria']);
        $this->assertSame('***', $e['totp_secret']['en_auditoria']);
        $this->assertSame('***', $e['secret_enc']['en_auditoria']);
        $this->assertSame('+519•••••711', $e['phone']['en_auditoria']);

        $this->como(self::ADMINISTRACION)->getJson('/api/v1/aud/retencion')->assertForbidden();
        $this->como(self::AUDITOR)->putJson('/api/v1/aud/retencion/NOTIFICATIONS', ['months' => 30, 'archive' => false, 'reason' => 'Bajar el plazo de notificaciones'])->assertForbidden();

        $mal = fn (array $d) => $this->como(self::ADMIN)->putJson('/api/v1/aud/retencion/CHANGE_LOG', $d + ['months' => 60, 'archive' => true, 'reason' => 'Confirmado por la contadora'])
            ->assertStatus(422)->json('message');
        $this->assertStringContainsString('al menos 60 meses', $mal(['months' => 24]));
        $this->assertStringContainsString('se archivan siempre', $mal(['archive' => false]));
        $this->assertStringContainsString('motivo', mb_strtolower($mal(['reason' => 'corto'])));
        $this->como(self::ADMIN)->putJson('/api/v1/aud/retencion/INVENTADA', ['months' => 3, 'archive' => false, 'reason' => 'Una categoría que no existe'])->assertNotFound();

        $ok = $this->como(self::ADMIN)->putJson('/api/v1/aud/retencion/NOTIFICATIONS', ['months' => 30, 'archive' => true, 'reason' => 'Archivar las notificaciones por 30 días'])->assertOk();
        $this->assertSame(['30 días', true, 'Luis Ccahuana Rojas'], [$ok->json('plazo'), $ok->json('archive_before_purge'), $ok->json('updated_by')]);
        // El cambio queda en la auditoría de cambios (AUD-01).
        $this->enEmpresa(fn () => $this->assertTrue(DB::table('audit.change_log')->where('table_name', 'audit_retention_policies')->where('action', 'U')
            ->whereRaw("new_data->>'months' = '30'")->exists()));
    }

    public function test_depuracion_archiva_cifrado_conserva_lo_pendiente_y_no_toca_otra_empresa(): void
    {
        Storage::fake('local');
        $viejo = now()->subDays(200);
        [$leida, $sinLeer] = $this->enEmpresa(function () use ($viejo) {
            $u = DB::table('users')->where('email', self::GERENTE)->value('id');
            $ins = fn (string $t, $leidaEn) => DB::table('notifications')->insertGetId(['user_id' => $u, 'module' => 'AUD', 'tone' => 'info', 'severity' => 'INFO',
                'type' => 'APPROVALS', 'title' => $t, 'body' => 'Prueba de depuración', 'at' => $viejo, 'read_at' => $leidaEn], 'id');

            return [$ins('Aviso viejo ya leído', $viejo), $ins('Aviso viejo sin leer', null)];
        });
        $otra = $this->enEmpresa(function () use ($viejo) {
            $u = DB::table('users')->value('id');

            return DB::table('notifications')->insertGetId(['user_id' => $u, 'module' => 'AUD', 'tone' => 'info', 'severity' => 'INFO', 'type' => 'APPROVALS',
                'title' => 'Aviso de otra empresa', 'body' => 'No se toca', 'at' => $viejo, 'read_at' => $viejo], 'id');
        }, 'Carnes Selectas', null);
        $this->como(self::ADMIN)->putJson('/api/v1/aud/retencion/NOTIFICATIONS', ['months' => 90, 'archive' => true, 'reason' => 'Archivar antes de depurar'])->assertOk();
        $pol = collect($this->como(self::ADMIN)->getJson('/api/v1/aud/retencion')->json('data'))->firstWhere('category', 'NOTIFICATIONS');
        $this->assertGreaterThanOrEqual(1, $pol['para_depurar']);

        $this->como(self::AUDITOR)->postJson('/api/v1/aud/retencion/NOTIFICATIONS/depurar')->assertForbidden();
        $c = $this->como(self::ADMIN)->postJson('/api/v1/aud/retencion/NOTIFICATIONS/depurar')->assertOk();
        $this->assertSame(['COMPLETED', 'Notificaciones leídas', 'Luis Ccahuana Rojas'], [$c->json('status'), $c->json('category_name'), $c->json('run_by')]);
        $this->assertSame($c->json('purged_rows'), $c->json('archived_rows'));
        $this->assertMatchesRegularExpression('/^DEP-\d{4}$/', $c->json('number'));
        $this->assertStringEndsWith('.jsonl.gz.enc', $c->json('archivo'));

        $this->enEmpresa(function () use ($leida, $sinLeer) {
            $this->assertFalse(DB::table('notifications')->where('id', $leida)->exists(), 'La leída vieja se depuró');
            $this->assertTrue(DB::table('notifications')->where('id', $sinLeer)->exists(), 'La que nadie leyó se conserva');
        });
        $this->enEmpresa(fn () => $this->assertTrue(DB::table('notifications')->where('id', $otra)->exists(), 'La otra empresa no se toca'), 'Carnes Selectas', null);

        // El archivo: cifrado, comprimido, con la huella guardada y las filas depuradas adentro.
        $ruta = $this->enEmpresa(fn () => DB::table('audit_purge_runs')->where('id', $c->json('id'))->value('archive_file'));
        $cifrado = Storage::disk('local')->get($ruta);
        $this->assertSame($c->json('archive_sha256'), hash('sha256', $cifrado));
        $this->assertStringNotContainsString('Aviso viejo ya leído', $cifrado);
        $this->assertStringContainsString('Aviso viejo ya leído', gzdecode(Crypt::decryptString($cifrado)));

        // AUD-07: la corrida aparece, con buscador y cifras; nada más pendiente en esa categoría.
        $l = $this->como(self::AUDITOR)->getJson('/api/v1/aud/depuraciones?buscar='.$c->json('number'))->assertOk();
        $this->assertSame([$c->json('id')], array_column($l->json('data'), 'id'));
        $this->assertFalse($l->json('puede'));
        $todas = $this->como(self::AUDITOR)->getJson('/api/v1/aud/depuraciones?categoria=NOTIFICATIONS')->assertOk();
        $this->assertGreaterThanOrEqual($c->json('purged_rows'), $todas->json('cifras.depuradas'));
        $this->assertSame(0, $this->como(self::AUDITOR)->getJson('/api/v1/aud/depuraciones?buscar=zzqqxx')->json('total'));
        $this->assertSame(0, collect($this->como(self::ADMIN)->getJson('/api/v1/aud/retencion')->json('data'))->firstWhere('category', 'NOTIFICATIONS')['para_depurar']);

        // «Ejecutar todas las vencidas»: solo quien gestiona la retención.
        $this->como(self::AUDITOR)->postJson('/api/v1/aud/depuraciones')->assertForbidden();
        $this->como(self::ADMIN)->postJson('/api/v1/aud/depuraciones')->assertOk();
    }

    public function test_la_aplicacion_no_puede_borrar_la_auditoria_ni_saltarse_la_politica(): void
    {
        $this->enEmpresa(function () {
            foreach (["DELETE FROM access_log WHERE at < now() - interval '1 day'", "DELETE FROM audit.change_log WHERE changed_at < now() - interval '1 day'"] as $sql) {
                try {
                    DB::transaction(fn () => DB::statement($sql));
                    $this->fail("Se pudo ejecutar: {$sql}");
                } catch (QueryException $e) {
                    $this->assertMatchesRegularExpression('/permission denied|permiso denegado|RN-AUD-01/i', $e->getMessage());
                }
            }
            // Aunque alguien bajara la política a mano, la base no depura cambios ni accesos con menos de un año.
            DB::table('audit_retention_policies')->where('category', 'ACCESS_LOG')->update(['months' => 2]);
            try {
                DB::transaction(fn () => DB::select("SELECT audit.purge_count('ACCESS_LOG')"));
                $this->fail('Se aceptó una política de 2 meses para la bitácora de accesos');
            } catch (QueryException $e) {
                $this->assertStringContainsString('al menos un año', $e->getMessage());
            }
            // Sin empresa en la sesión, no hay depuración.
            TenantContext::set(null);
            try {
                DB::transaction(fn () => DB::select("SELECT audit.purge_count('NOTIFICATIONS')"));
                $this->fail('Se depuró sin empresa');
            } catch (QueryException $e) {
                $this->assertStringContainsString('dentro de una empresa', $e->getMessage());
            }
        });
    }

    public function test_revision_trimestral_propone_guarda_decisiones_desactiva_y_cierra(): void
    {
        $p = $this->como(self::GERENTE)->getJson('/api/v1/aud/revision')->assertOk();
        $this->assertSame(['RA-2026-T4', 'OPEN'], [$p->json('actual.number'), $p->json('actual.status')]);
        $this->assertTrue($p->json('puede'));
        // T2 y T3 se cerraron dentro de su trimestre; T4 aún no vence.
        $this->assertSame([100.0, 2, 2], [(float) $p->json('cifras.a_tiempo'), $p->json('cifras.a_tiempo_ok'), $p->json('cifras.a_tiempo_de')]);
        $items = collect($p->json('items'));
        $this->assertGreaterThan(5, $items->count());
        $this->assertFalse($items->contains('status', 'INACTIVE'), 'Los ya inactivos no se revisan');
        // CA-AUD-06: quien no ingresa hace más de 60 días se propone desactivar.
        $inactivo = $items->first(fn ($i) => $i['inactivo'] && $i['role'] !== 'ADMIN_SISTEMA' && $i['role'] !== 'GERENTE');
        $this->assertNotNull($inactivo, 'Debe haber alguien sin ingreso reciente en la demostración');
        $this->assertSame('DEACTIVATE', $inactivo['proposal']);
        $this->assertGreaterThanOrEqual(60, $inactivo['days_inactive']);
        $this->assertSame($items->where('inactivo', true)->where('status', 'ACTIVE')->count(), $p->json('cifras.inactivos'));

        // La auditoría ve la revisión pero no decide ni cierra.
        $this->como(self::AUDITOR)->getJson('/api/v1/aud/revision')->assertOk()->assertJsonPath('puede', false);
        $this->como(self::AUDITOR)->putJson("/api/v1/aud/revision/{$p->json('actual.id')}/decisiones", ['user_id' => $inactivo['user_id'], 'decision' => 'KEEP'])->assertForbidden();
        $this->como(self::ADMINISTRACION)->getJson('/api/v1/aud/revision')->assertForbidden();

        // Las decisiones se guardan mientras está abierta.
        $id = $p->json('actual.id');
        $yo = $items->firstWhere('email', self::GERENTE);
        $otro = $items->first(fn ($i) => $i['proposal'] !== 'DEACTIVATE' && $i['email'] !== self::GERENTE);
        $d = $this->como(self::GERENTE)->putJson("/api/v1/aud/revision/{$id}/decisiones", ['user_id' => $otro['user_id'], 'decision' => 'CHANGE', 'note' => 'Quitarle la marca 2'])->assertOk();
        $this->assertSame(['CHANGE', 'Quitarle la marca 2', true], [$d->json('decision'), $d->json('note'), $d->json('decidida')]);
        $this->como(self::GERENTE)->putJson("/api/v1/aud/revision/{$id}/decisiones", ['user_id' => $yo['user_id'], 'decision' => 'DEACTIVATE'])->assertOk();
        $this->como(self::GERENTE)->putJson("/api/v1/aud/revision/{$id}/decisiones", ['user_id' => $otro['user_id'], 'decision' => 'BORRAR'])->assertStatus(422);
        $guardada = collect($this->como(self::GERENTE)->getJson('/api/v1/aud/revision')->json('items'))->firstWhere('user_id', $otro['user_id']);
        $this->assertSame(['CHANGE', 'Quitarle la marca 2'], [$guardada['decision'], $guardada['note']]);

        // Cerrar: pide hallazgos; desactiva a los marcados, menos a quien cierra.
        $this->como(self::GERENTE)->postJson("/api/v1/aud/revision/{$id}/cerrar", ['findings' => 'corto'])->assertStatus(422);
        $r = $this->como(self::GERENTE)->postJson("/api/v1/aud/revision/{$id}/cerrar", ['findings' => 'Se pidió segundo factor a contabilidad.'])->assertOk();
        $this->assertSame('COMPLETED', $r->json('status'));
        $this->assertTrue($r->json('a_tiempo'));
        $this->assertStringContainsString('usuarios revisados', $r->json('findings'));
        $this->assertStringEndsWith('Se pidió segundo factor a contabilidad.', $r->json('findings'));
        $foto = collect($r->json('items'))->keyBy('user_id');
        $this->assertSame('Desactivado', $foto[$inactivo['user_id']]['resultado']);
        $this->assertStringStartsWith('No se desactivó', $foto[$yo['user_id']]['resultado']);
        $this->assertSame('Cambiar', $foto[$otro['user_id']]['decision_name']);
        $this->assertContains($inactivo['name'], $r->json('desactivados_nombres'));
        $this->enEmpresa(function () use ($inactivo, $yo) {
            $u = DB::table('users')->where('id', $inactivo['user_id'])->first();
            $this->assertSame('INACTIVE', $u->status);
            $this->assertStringStartsWith('Revisión de accesos 2026-T4', $u->deactivated_reason);
            $this->assertSame('ACTIVE', DB::table('users')->where('id', $yo['user_id'])->value('status'));
        });
        $this->como(self::GERENTE)->postJson("/api/v1/aud/revision/{$id}/cerrar", ['findings' => 'Cerrar de nuevo la revisión'])->assertStatus(422);

        // Queda entre las cerradas y la auditoría la abre.
        $this->assertContains('RA-2026-T4', array_column($this->como(self::GERENTE)->getJson('/api/v1/aud/revision')->json('cerradas'), 'number'));
        $this->como(self::AUDITOR)->getJson("/api/v1/aud/revision/{$id}")->assertOk()->assertJsonPath('number', 'RA-2026-T4');
    }

    public function test_la_tarea_abre_la_revision_del_trimestre_nuevo_y_avisa_una_sola_vez(): void
    {
        $this->travelTo(now('America/Lima')->setDate(2027, 1, 2)->setTime(7, 10));
        Artisan::call('aud:revision-trimestral');
        $this->assertStringContainsString('revisión 2027-T1 abierta', Artisan::output());
        Artisan::call('aud:revision-trimestral');
        $this->assertStringContainsString('ya estaba abierta', Artisan::output());
        $this->enEmpresa(function () {
            $r = DB::table('access_reviews')->where('quarter', '2027-T1')->first();
            $this->assertSame(['RA-2027-T1', 'OPEN', '2027-03-31'], [$r->number, $r->status, substr((string) $r->due_date, 0, 10)]);
            $this->assertSame(1, DB::table('notifications')->where('title', 'Revisión de accesos 2027-T1 pendiente')
                ->where('user_id', DB::table('users')->where('email', self::GERENTE)->value('id'))->count());
        });
    }
}
