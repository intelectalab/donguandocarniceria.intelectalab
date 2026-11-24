<?php

namespace Tests\Feature\Modulos;

use App\Support\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/** AUD · Auditoría: cambios (AUD-01), historia (AUD-02), accesos (AUD-03), datos sensibles (AUD-04) y exportaciones (AUD-05). */
class AudTest extends TestCase
{
    private const GERENTE = 'rquispe@donguando.pe';

    private const AUDITOR = 'aexterno@donguando.pe';

    private const ADMINISTRACION = 'chuaman@donguando.pe';   // ve la historia de los registros, no la consulta completa

    private const CONTADORA = 'mcardenas@donguando.pe';      // exporta, también datos personales

    private const ADMIN = 'lccahuana@donguando.pe';          // administración del sistema: aprueba

    private array $tokens = [];

    private function como(string $email): static
    {
        return $this->desde(self::DG, $this->tokens[$email] ??= $this->ingresar(self::DG, $email));
    }

    /** Cambia filas como una persona (el trigger toma el usuario de la sesión de la base). */
    private function comoPersona(string $email, callable $f): mixed
    {
        $t = DB::table('tenants')->where('short', 'Don Guando')->value('id');
        TenantContext::set(['id' => $t]);
        TenantContext::setUser(DB::table('users')->where('email', $email)->value('id'));
        try {
            return $f();
        } finally {
            TenantContext::set(null);
        }
    }

    public function test_consulta_de_cambios_campo_por_campo_con_secretos_y_datos_personales_enmascarados(): void
    {
        [$marca, $cliente] = $this->comoPersona(self::GERENTE, function () {
            $m = DB::table('brands')->orderBy('name')->first(['id', 'name']);
            DB::table('brands')->where('id', $m->id)->update(['name' => $m->name.' Renovada', 'updated_at' => now()]);
            $c = DB::table('customers')->whereNotNull('phone')->orderBy('full_name')->first(['id']);
            DB::table('customers')->where('id', $c->id)->update(['phone' => '+51999888777', 'updated_at' => now()]);

            return [$m, $c->id];
        });

        $l = $this->como(self::GERENTE)->getJson('/api/v1/aud/cambios?tabla=brands&accion=U')->assertOk();
        $f = collect($l->json('data'))->firstWhere('row_id', $marca->id);
        $this->assertSame(['Rosa Quispe Huamán', 'Cambio', 'Marcas', $marca->name.' Renovada'], [$f['usuario'], $f['accion_nombre'], $f['tabla_nombre'], $f['registro']]);
        $this->assertSame(['campo' => 'name', 'antes' => $marca->name, 'despues' => $marca->name.' Renovada'], $f['cambios'][0]);
        $this->assertGreaterThanOrEqual(1, $l->json('cifras.hoy'));
        $this->assertContains('brands', array_column($l->json('tablas'), 'value'));
        // El buscador: en los valores del cambio y por persona.
        $this->assertContains($marca->id, array_column($this->como(self::GERENTE)->getJson('/api/v1/aud/cambios?buscar=Renovada')->json('data'), 'row_id'));
        $this->assertSame(0, $this->como(self::GERENTE)->getJson('/api/v1/aud/cambios?buscar=NadaQueCoincida_xyz')->json('total'));
        $this->assertGreaterThan(0, $this->como(self::GERENTE)->getJson('/api/v1/aud/cambios?buscar='.urlencode('Quispe'))->json('cifras.total'));
        // Por defecto, solo los cambios de personas (la carga inicial, si se pide).
        $this->assertNotContains('Sistema', array_column($this->como(self::GERENTE)->getJson('/api/v1/aud/cambios')->json('data'), 'usuario'));
        $this->assertContains('Sistema', array_column($this->como(self::GERENTE)->getJson('/api/v1/aud/cambios?sistema=1&per_page=100')->json('data'), 'usuario'));

        // Datos personales enmascarados; completos solo con permiso y pidiéndolo (queda en la bitácora).
        $c = collect($this->como(self::GERENTE)->getJson("/api/v1/aud/cambios?tabla=customers&registro={$cliente}")->json('data'))->first();
        $tel = collect($c['cambios'])->firstWhere('campo', 'phone');
        $this->assertSame('+519•••••777', $tel['despues']);
        $r = $this->como(self::GERENTE)->getJson("/api/v1/aud/cambios?tabla=customers&registro={$cliente}&revelar=1")->assertOk();
        $this->assertSame('+51999888777', collect($r->json('data.0.cambios'))->firstWhere('campo', 'phone')['despues']);
        $this->como(self::AUDITOR)->getJson('/api/v1/aud/cambios?tabla=customers&revelar=1')->assertStatus(422)->assertJsonPath('code', 'RN-AUD-07');

        // RN-AUD-07: un secreto nunca queda en la bitácora (ni cifrado): se ve «***».
        $conector = $this->comoPersona(self::GERENTE, fn () => DB::table('integration_connectors')->where('environment', 'SANDBOX')->value('id'));
        $this->como(self::GERENTE)->postJson('/api/v1/int/credenciales', ['connector_id' => $conector, 'name' => 'api_key_prueba', 'secret' => 'sk_test_NuncaEnLaBitacora_1'])->assertCreated();
        $this->comoPersona(self::GERENTE, function () {
            $fila = DB::table('audit.change_log')->where('table_name', 'integration_credentials')->orderByDesc('id')->first();
            $this->assertSame('***', json_decode($fila->new_data, true)['secret_enc']);
            $this->assertStringNotContainsString('enc:v2', $fila->new_data);
        });
        $cred = $this->como(self::GERENTE)->getJson('/api/v1/aud/cambios?tabla=integration_credentials&accion=I')->assertOk();
        $this->assertStringNotContainsString('NuncaEnLaBitacora', $cred->getContent());
        $this->assertStringNotContainsString('enc:v', $cred->getContent());

        // Detalle de un cambio, con todos los campos.
        $this->como(self::GERENTE)->getJson('/api/v1/aud/cambios/'.$f['id'])->assertOk()->assertJsonPath('tabla', 'brands');
    }

    public function test_permisos_historia_del_registro_y_403_en_la_bitacora(): void
    {
        $marca = $this->comoPersona(self::GERENTE, function () {
            $m = DB::table('brands')->orderBy('name')->first(['id', 'name']);
            DB::table('brands')->where('id', $m->id)->update(['name' => $m->name.' 2', 'updated_at' => now()]);

            return $m;
        });

        // RN-AUD-09: administración no ve la consulta completa (y el 403 queda en la bitácora de accesos)…
        $this->como(self::ADMINISTRACION)->getJson('/api/v1/aud/cambios')->assertForbidden();
        $this->comoPersona(self::GERENTE, fn () => $this->assertTrue(DB::table('access_log')->whereIn('event', ['PERMISSION_DENIED', 'MODULE_DISABLED'])
            ->where('user_name', 'Carmen Huamán Soto')->exists(), 'El 403 queda en la bitácora'));
        // …pero sí la historia de un registro que puede ver, y no la de un usuario.
        $h = $this->como(self::ADMINISTRACION)->getJson("/api/v1/aud/historia?tabla=brands&id={$marca->id}")->assertOk();
        $this->assertSame('Marcas', $h->json('tabla_nombre'));
        $this->assertSame('cambio', collect($h->json('items'))->last()['tipo']);
        $this->assertNotEmpty($h->json('actual'));
        $usuario = $this->comoPersona(self::GERENTE, fn () => DB::table('users')->where('email', self::GERENTE)->value('id'));
        $this->como(self::ADMINISTRACION)->getJson("/api/v1/aud/historia?tabla=users&id={$usuario}")->assertStatus(422)->assertJsonPath('code', 'RN-AUD-09');
        $this->como(self::GERENTE)->getJson("/api/v1/aud/historia?tabla=users&id={$usuario}")->assertOk();
        // Los registros con historia, para elegir; las tablas reservadas no se ofrecen a quien no las ve.
        $r = $this->como(self::ADMINISTRACION)->getJson('/api/v1/aud/historia/registros?tabla=brands')->assertOk();
        $this->assertContains($marca->id, array_column($r->json('registros'), 'id'));
        $this->assertNotContains('users', array_column($r->json('tablas'), 'value'));
        $this->assertSame([], $this->como(self::ADMINISTRACION)->getJson('/api/v1/aud/historia/registros?tabla=users')->json('registros'));
    }

    public function test_bitacora_de_accesos_con_cifras_filtros_y_denegados_por_semana(): void
    {
        $this->como(self::ADMINISTRACION)->getJson('/api/v1/aud/accesos')->assertForbidden();   // un 403 para contar
        $l = $this->como(self::AUDITOR)->getJson('/api/v1/aud/accesos')->assertOk();
        $this->assertGreaterThanOrEqual(2, $l->json('cifras.ingresos_hoy'), 'Los ingresos de esta prueba');
        $this->assertGreaterThanOrEqual(1, $l->json('cifras.denegados_7'));
        $this->assertNotEmpty($l->json('semanas'));
        $this->assertContains('Carmen Huamán Soto', array_column($l->json('semanas'), 'usuario'));
        $this->assertNotContains('SENSITIVE_VIEW', array_column($l->json('data'), 'event'), 'Los datos sensibles van en AUD-04');

        $ok = $this->como(self::AUDITOR)->getJson('/api/v1/aud/accesos?evento=LOGIN_OK')->assertOk();
        $this->assertSame(['LOGIN_OK'], array_values(array_unique(array_column($ok->json('data'), 'event'))));
        $this->assertSame('Ingreso', $ok->json('data.0.event_name'));
        // Desde una fecha de la demostración: trae los de septiembre.
        $this->assertGreaterThan(0, $this->como(self::AUDITOR)->getJson('/api/v1/aud/accesos?desde=2026-09-01&hasta=2026-09-30')->json('total'));
        $this->como(self::AUDITOR)->getJson('/api/v1/aud/accesos?desde=2026-09-30&hasta=2026-09-01')->assertStatus(422);

        // Filtrar por una persona queda en la bitácora (consulta de auditoría).
        $id = $this->comoPersona(self::GERENTE, fn () => DB::table('users')->where('email', self::ADMINISTRACION)->value('id'));
        $this->como(self::AUDITOR)->getJson("/api/v1/aud/accesos?usuario={$id}")->assertOk();
        $this->comoPersona(self::GERENTE, fn () => $this->assertTrue(DB::table('access_log')->where('event', 'AUDIT_VIEWED')->where('detail', 'like', '%Carmen Huamán Soto%')->exists()));
    }

    /** Descarga por el enlace firmado, sin sesión. */
    private function bajar(string $url)
    {
        $this->app['auth']->forgetGuards();
        TenantContext::set(null);

        return $this->call('GET', parse_url($url, PHP_URL_PATH).'?'.parse_url($url, PHP_URL_QUERY));
    }

    public function test_exportacion_sin_datos_personales_lista_con_archivo_y_enlace_temporal(): void
    {
        Storage::fake('local');
        $this->como(self::CONTADORA)->postJson('/api/v1/aud/exportaciones', ['report' => 'payments', 'reason' => 'corto'])->assertStatus(422);
        $x = $this->como(self::CONTADORA)->postJson('/api/v1/aud/exportaciones', ['report' => 'payments', 'reason' => 'Conciliación de cobros de setiembre',
            'desde' => '2026-09-01', 'hasta' => '2026-09-30'])->assertCreated();
        $this->assertSame(['READY', false, true], [$x->json('status'), $x->json('contains_personal_data'), $x->json('tiene_archivo')]);
        $this->assertMatchesRegularExpression('/^EXP-\d{4}$/', $x->json('number'));
        $this->comoPersona(self::GERENTE, fn () => $this->assertSame(1, DB::table('data_exports')->where('number', $x->json('number'))->count(), 'No repite un número de la demostración'));
        $this->assertGreaterThan(0, $x->json('rows_count'));
        $this->assertStringContainsString('Del 01/09/2026 al 30/09/2026', $x->json('filtros_texto'));

        // Solo quien la pidió (o gerencia y administración) la descarga; otra persona ni la ve.
        $this->como(self::ADMINISTRACION)->getJson('/api/v1/aud/exportaciones/'.$x->json('id'))->assertNotFound();
        $this->como(self::ADMINISTRACION)->postJson('/api/v1/aud/exportaciones/'.$x->json('id').'/enlace')->assertStatus(422)->assertJsonPath('code', 'RN-AUD-05');
        $e = $this->como(self::CONTADORA)->postJson('/api/v1/aud/exportaciones/'.$x->json('id').'/enlace')->assertOk();
        $r = $this->bajar($e->json('url'))->assertOk()->assertHeader('X-Content-Type-Options', 'nosniff');
        $this->assertStringContainsString('spreadsheetml', $r->headers->get('Content-Type'));
        $this->bajar(str_replace('signature=', 'signature=x', $e->json('url')))->assertForbidden();
        $this->assertSame(1, $this->como(self::CONTADORA)->getJson('/api/v1/aud/exportaciones/'.$x->json('id'))->json('descargas'));

        // Vencido el enlace (24 horas), ya no se descarga.
        $this->travel(25)->hours();
        $this->tokens = [];   // la sesión también venció: se vuelve a ingresar
        $this->como(self::CONTADORA)->postJson('/api/v1/aud/exportaciones/'.$x->json('id').'/enlace')->assertStatus(422)->assertJsonPath('code', 'RN-AUD-05');
        $this->bajar($e->json('url'))->assertForbidden();
        $this->travelBack();
        $this->tokens = [];
        // Las de la demostración no tienen archivo: lo dice.
        $demo = collect($this->como(self::CONTADORA)->getJson('/api/v1/aud/exportaciones')->json('data'))->first(fn ($d) => ! $d['tiene_archivo']);
        $this->assertNotNull($demo);

        // AUD-04: la descarga queda entre los accesos a datos sensibles.
        $s = $this->como(self::AUDITOR)->getJson('/api/v1/aud/sensibles')->assertOk();
        $this->assertGreaterThan(0, collect($s->json('por_tipo'))->firstWhere('event', 'EXPORT_DOWNLOADED')['n']);
        $this->assertContains('CPC Marisol Cárdenas', array_column($s->json('data'), 'user_name'));
        $this->assertSame(['EXPORT_DOWNLOADED'], array_values(array_unique(array_column($this->como(self::AUDITOR)->getJson('/api/v1/aud/sensibles?evento=EXPORT_DOWNLOADED')->json('data'), 'event'))));
        $this->como(self::ADMINISTRACION)->getJson('/api/v1/aud/sensibles')->assertForbidden();
    }

    public function test_datos_personales_necesitan_aprobacion_de_otra_persona(): void
    {
        Storage::fake('local');
        // Administración no tiene el permiso de exportar datos personales: su pedido va a aprobación.
        $x = $this->como(self::ADMINISTRACION)->postJson('/api/v1/aud/exportaciones', ['report' => 'customers', 'reason' => 'Campaña de fin de año a clientes'])->assertCreated();
        $this->assertSame(['PENDING_APPROVAL', true, false], [$x->json('status'), $x->json('contains_personal_data'), $x->json('tiene_archivo')]);
        $id = $x->json('id');
        $this->como(self::ADMINISTRACION)->postJson("/api/v1/aud/exportaciones/{$id}/enlace")->assertStatus(422)->assertJsonPath('code', 'RN-AUD-06');
        $this->como(self::ADMINISTRACION)->postJson("/api/v1/aud/exportaciones/{$id}/aprobar")->assertForbidden();
        $this->comoPersona(self::GERENTE, fn () => $this->assertTrue(DB::table('notifications')->where('title', 'Exportación '.$x->json('number').' por aprobar')->exists(), 'Avisa a quienes aprueban'));

        // La gerencia la ve en «Por aprobar» y la aprueba: queda lista y se avisa a quien la pidió.
        $p = $this->como(self::GERENTE)->getJson('/api/v1/aud/exportaciones?scope=pending')->assertOk();
        $this->assertContains($id, array_column($p->json('data'), 'id'));
        $this->assertGreaterThanOrEqual(1, $p->json('cifras.por_aprobar'));
        $a = $this->como(self::GERENTE)->postJson("/api/v1/aud/exportaciones/{$id}/aprobar")->assertOk();
        $this->assertSame(['READY', 'Rosa Quispe Huamán', true], [$a->json('status'), $a->json('approved_by'), $a->json('tiene_archivo')]);
        $this->comoPersona(self::GERENTE, fn () => $this->assertTrue(DB::table('notifications')->where('title', 'Exportación '.$x->json('number').' aprobada')->exists()));
        $this->como(self::GERENTE)->postJson("/api/v1/aud/exportaciones/{$id}/aprobar")->assertStatus(422)->assertJsonPath('code', 'RN-AUD-06');
        $this->assertNotEmpty($this->como(self::ADMINISTRACION)->postJson("/api/v1/aud/exportaciones/{$id}/enlace")->assertOk()->json('url'));

        // Con el umbral bajo, aun quien tiene el permiso necesita aprobación; quien la pide no la resuelve; se rechaza con motivo.
        $this->comoPersona(self::GERENTE, fn () => DB::table('parameters')->insert(['key' => 'aud_export_personal_data_rows', 'scope' => 'TENANT', 'value' => '1',
            'reason' => 'Prueba del umbral de datos personales', 'description' => 'Umbral']));
        $y = $this->como(self::GERENTE)->postJson('/api/v1/aud/exportaciones', ['report' => 'employees', 'reason' => 'Actualizar la planilla de contactos'])->assertCreated();
        $this->assertSame('PENDING_APPROVAL', $y->json('status'));
        $this->como(self::GERENTE)->postJson('/api/v1/aud/exportaciones/'.$y->json('id').'/aprobar')->assertStatus(422)->assertJsonPath('code', 'RN-AUD-06');
        $this->como(self::ADMIN)->postJson('/api/v1/aud/exportaciones/'.$y->json('id').'/rechazar', ['reason' => 'corto'])->assertStatus(422);
        $r = $this->como(self::ADMIN)->postJson('/api/v1/aud/exportaciones/'.$y->json('id').'/rechazar', ['reason' => 'No hace falta exportar los celulares'])->assertOk();
        $this->assertSame(['REJECTED', 'No hace falta exportar los celulares'], [$r->json('status'), $r->json('reject_reason')]);
        $this->como(self::GERENTE)->postJson('/api/v1/aud/exportaciones/'.$y->json('id').'/enlace')->assertStatus(422)->assertJsonPath('code', 'RN-AUD-06');
        $this->comoPersona(self::GERENTE, fn () => $this->assertDatabaseHas('domain_events', ['event_name' => 'export.rejected', 'aggregate_id' => $y->json('id')]));
    }
}
