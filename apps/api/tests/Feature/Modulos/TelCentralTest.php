<?php

namespace Tests\Feature\Modulos;

use App\Support\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/** TEL-03 Números y desvíos, TEL-04 Menú de voz y horario y TEL-05 Grupos de llamada (RN-TEL-04 y 06). */
class TelCentralTest extends TestCase
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

    private function id(string $email): string
    {
        return $this->enEmpresa(fn () => DB::table('users')->where('email', $email)->value('id'));
    }

    private function falla(callable $f): void
    {
        try {
            $this->enEmpresa(fn () => DB::transaction($f));
            $this->fail('La base debió rechazarlo');
        } catch (QueryException) {
            $this->assertTrue(true);
        }
    }

    protected function setUp(): void
    {
        parent::setUp();
        foreach (['CARRIER_FORWARDING', 'SIGNED_POLICY'] as $p) {
            $this->como(self::GERENTE)->postJson("/api/v1/plt/modulos/tel/pasos/{$p}", ['notes' => 'Constancia archivada en la carpeta de Telefonía'])->assertOk();
        }
        $this->como(self::GERENTE)->putJson('/api/v1/plt/modulos/TEL', ['enabled' => true, 'reason' => 'Central lista para las vendedoras'])->assertOk();
        $this->tokens = [];
    }

    public function test_menu_de_voz_con_aviso_opciones_por_marca_y_horario(): void
    {
        // Las opciones de la demostración ya apuntan a la marca, su grupo y la supervisora reales.
        $m = $this->como(self::SUPERVISORA)->getJson('/api/v1/tel/menu')->assertOk();
        $op = collect($m->json('opciones'))->keyBy('digit');
        $this->assertSame(['Don Guando', 'Vendedoras Don Guando', 'SUPERVISORA', 'Supervisora: Patricia León Vera'],
            [$op[1]['etiqueta'], $op[1]['grupo'], $op[9]['tipo'], $op[9]['etiqueta']]);
        $this->assertSame(['08:00', '20:00'], $m->json('horario.lun_sab'));
        $this->assertSame(['+5117085500'], $m->json('numeros'));

        [$dg, $m2] = $this->enEmpresa(fn () => [DB::table('brands')->where('name', 'Don Guando')->value('id'), DB::table('brands')->where('name', 'like', 'Marca 2%')->value('id')]);
        $base = ['name' => 'Menú general', 'greeting_text' => 'Gracias por llamar. Esta llamada puede ser grabada para fines de calidad.', 'after_hours_action' => 'VOICEMAIL',
            'horario' => ['lun_sab' => ['08:00', '20:00'], 'dom' => ['09:00', '13:00']],
            'opciones' => [['digit' => 2, 'tipo' => 'MARCA', 'brand_id' => $m2], ['digit' => 1, 'tipo' => 'MARCA', 'brand_id' => $dg], ['digit' => 9, 'tipo' => 'SUPERVISORA', 'direct_user_id' => $this->id(self::SUPERVISORA)]]];
        $this->como(self::SUPERVISORA)->putJson('/api/v1/tel/menu', $base)->assertForbidden();
        $this->como(self::ADMIN)->putJson('/api/v1/tel/menu', ['greeting_text' => 'Gracias por llamar a Don Guando, marca una opción'] + $base)->assertStatus(422)->assertJsonPath('code', 'RN-TEL-04');
        $this->como(self::ADMIN)->putJson('/api/v1/tel/menu', ['opciones' => [['digit' => 1, 'tipo' => 'MARCA', 'brand_id' => $dg], ['digit' => 2, 'tipo' => 'MARCA', 'brand_id' => $dg]]] + $base)->assertStatus(422);
        $this->como(self::ADMIN)->putJson('/api/v1/tel/menu', ['opciones' => [['digit' => 1, 'tipo' => 'MARCA', 'brand_id' => $dg], ['digit' => 1, 'tipo' => 'MARCA', 'brand_id' => $m2]]] + $base)->assertStatus(422);
        $this->como(self::ADMIN)->putJson('/api/v1/tel/menu', ['opciones' => [['digit' => 9, 'tipo' => 'SUPERVISORA', 'direct_user_id' => $this->id(self::A)]]] + $base)->assertStatus(422);
        $this->como(self::ADMIN)->putJson('/api/v1/tel/menu', ['horario' => ['lun_sab' => ['20:00', '08:00']]] + $base)->assertStatus(422);
        $this->como(self::ADMIN)->putJson('/api/v1/tel/menu', ['horario' => ['lun_sab' => ['8 am', '20:00']]] + $base)->assertStatus(422);

        $r = $this->como(self::ADMIN)->putJson('/api/v1/tel/menu', $base)->assertOk();
        $this->assertSame([1, 2, 9], array_column($r->json('opciones'), 'digit'), 'Las opciones quedan en orden');
        $this->assertSame(['VOICEMAIL', ['09:00', '13:00']], [$r->json('after_hours_action'), $r->json('horario.dom')]);
        // Sin domingo: cerrado.
        $this->assertNull($this->como(self::ADMIN)->putJson('/api/v1/tel/menu', ['horario' => ['lun_sab' => ['08:00', '20:00'], 'dom' => null]] + $base)->assertOk()->json('horario.dom'));
    }

    public function test_numeros_con_destino_y_desvios_de_celulares(): void
    {
        $l = $this->como(self::SUPERVISORA)->getJson('/api/v1/tel/numeros')->assertOk();
        $this->assertSame([3, false], [$l->json('total'), $l->json('puede')]);
        $this->assertSame(1, $this->como(self::SUPERVISORA)->getJson('/api/v1/tel/numeros?buscar=650101')->json('total'));
        $this->assertSame(1, $this->como(self::SUPERVISORA)->getJson('/api/v1/tel/numeros?estado=INACTIVE')->json('total'));
        $this->assertSame('Menú: Menú general', collect($l->json('data'))->firstWhere('e164', '+5117085500')['atiende']);

        [$menu, $grupo, $m2] = $this->enEmpresa(fn () => [DB::table('tel_menus')->value('id'), DB::table('tel_ring_groups')->where('name', 'Vendedoras Marca 2')->value('id'),
            DB::table('brands')->where('name', 'like', 'Marca 2%')->value('id')]);
        $nuevo = ['e164' => '01 7099000', 'number_kind' => 'LANDLINE_LIMA', 'brand_id' => $m2, 'ring_group_id' => $grupo, 'forwarded_from' => ['987 650 201'], 'status' => 'ACTIVE'];
        $this->como(self::SUPERVISORA)->postJson('/api/v1/tel/numeros', $nuevo)->assertForbidden();
        $this->como(self::ADMIN)->postJson('/api/v1/tel/numeros', ['e164' => '123'] + $nuevo)->assertStatus(422);
        $this->como(self::ADMIN)->postJson('/api/v1/tel/numeros', ['e164' => '+5117085500'] + $nuevo)->assertStatus(422);
        $this->como(self::ADMIN)->postJson('/api/v1/tel/numeros', ['menu_id' => $menu] + $nuevo)->assertStatus(422);
        $this->como(self::ADMIN)->postJson('/api/v1/tel/numeros', ['ring_group_id' => null] + $nuevo)->assertStatus(422);
        $this->como(self::ADMIN)->postJson('/api/v1/tel/numeros', ['forwarded_from' => ['01 4445555']] + $nuevo)->assertStatus(422);
        $this->como(self::ADMIN)->postJson('/api/v1/tel/numeros', ['forwarded_from' => ['987650101']] + $nuevo)->assertStatus(422)->assertJsonPath('code', 'RN-TEL-03');
        $n = $this->como(self::ADMIN)->postJson('/api/v1/tel/numeros', ['e164' => '+5117099000'] + $nuevo)->assertCreated();
        $this->assertSame(['+5117099000', ['+51987650201']], [$n->json('e164'), json_decode($n->json('forwarded_from'), true)]);
        // Inactivo puede quedar sin destino; no se borra.
        $this->como(self::ADMIN)->putJson('/api/v1/tel/numeros/'.$n->json('id'), ['e164' => '+5117099000', 'ring_group_id' => null, 'status' => 'INACTIVE'] + $nuevo)->assertOk();
        $this->falla(fn () => DB::table('tel_numbers')->where('e164', '+5117099000')->delete());
        $this->falla(fn () => DB::table('tel_numbers')->where('e164', '+5117099000')->update(['status' => 'ACTIVE']));
        $this->como(self::A)->getJson('/api/v1/tel/numeros')->assertForbidden();
    }

    public function test_grupos_por_marca_con_prioridad_y_orden_de_timbre(): void
    {
        $l = $this->como(self::SUPERVISORA)->getJson('/api/v1/tel/grupos')->assertOk();
        $dg = collect($l->json('data'))->firstWhere('name', 'Vendedoras Don Guando');
        $this->assertSame(['Ana Torres Lazo', 0, 25], [$dg['plan'][0]['nombres'][0], $dg['plan'][0]['desde'], $dg['plan'][0]['hasta']]);
        $this->assertCount(4, $dg['plan']);
        $this->assertSame(['Vendedoras Marca 2'], array_column($this->como(self::SUPERVISORA)->getJson('/api/v1/tel/grupos?buscar=karina')->json('data'), 'name'));

        $m2 = collect($l->json('data'))->firstWhere('name', 'Vendedoras Marca 2');
        $this->como(self::ADMIN)->postJson('/api/v1/tel/grupos', ['brand_id' => $m2['brand_id'], 'name' => 'Otro grupo', 'strategy' => 'ROUND_ROBIN', 'ring_timeout_s' => 20])->assertStatus(422);
        $this->como(self::ADMIN)->putJson("/api/v1/tel/grupos/{$m2['id']}", ['name' => 'Vendedoras Marca 2', 'strategy' => 'SIMULTANEOUS', 'ring_timeout_s' => 200])->assertStatus(422);
        $this->como(self::ADMIN)->putJson("/api/v1/tel/grupos/{$m2['id']}", ['name' => 'Vendedoras Marca 2', 'strategy' => 'SIMULTANEOUS', 'ring_timeout_s' => 30])->assertOk();

        // Candidatas: vendedoras de la marca (o de todas) y supervisoras; Ana (solo Don Guando) no.
        $cand = collect($this->como(self::ADMIN)->getJson("/api/v1/tel/grupos/{$m2['id']}/candidatos")->assertOk()->json('data'))->pluck('value');
        $this->assertTrue($cand->contains($this->id('fcampos@donguando.pe')) && $cand->contains($this->id(self::SUPERVISORA)) && ! $cand->contains($this->id(self::A)));
        $this->como(self::ADMIN)->postJson("/api/v1/tel/grupos/{$m2['id']}/miembros", ['user_id' => $this->id(self::A)])->assertStatus(422);
        $this->como(self::ADMIN)->postJson("/api/v1/tel/grupos/{$m2['id']}/miembros", ['user_id' => $this->id('mcardenas@donguando.pe')])->assertStatus(422);
        $r = $this->como(self::ADMIN)->postJson("/api/v1/tel/grupos/{$m2['id']}/miembros", ['user_id' => $this->id('fcampos@donguando.pe')])->assertCreated();
        $this->como(self::ADMIN)->postJson("/api/v1/tel/grupos/{$m2['id']}/miembros", ['user_id' => $this->id('fcampos@donguando.pe')])->assertStatus(422);
        $g = collect($r->json('data'))->firstWhere('id', $m2['id']);
        $this->assertSame(['Todas a la vez', 3, 1], [$g['estrategia'], count($g['miembros']), count($g['plan'])]);
        $this->assertCount(2, $g['plan'][0]['nombres'], 'Karina tiene el usuario inactivo: no suena');
        $nuevo = collect($g['miembros'])->firstWhere('nombre', 'Fiorella Campos Ruiz');
        $this->assertSame(3, $nuevo['priority']);

        // Subir de prioridad intercambia con la anterior; pausar la saca del orden de timbre.
        $g = collect($this->como(self::ADMIN)->putJson("/api/v1/tel/miembros/{$nuevo['id']}", ['mover' => 'subir'])->assertOk()->json('data'))->firstWhere('id', $m2['id']);
        $this->assertSame(2, collect($g['miembros'])->firstWhere('id', $nuevo['id'])['priority']);
        $g = collect($this->como(self::ADMIN)->putJson("/api/v1/tel/miembros/{$nuevo['id']}", ['active' => false])->assertOk()->json('data'))->firstWhere('id', $m2['id']);
        $this->assertCount(1, $g['plan'][0]['nombres']);
        $this->como(self::SUPERVISORA)->putJson("/api/v1/tel/miembros/{$nuevo['id']}", ['active' => true])->assertForbidden();

        // La base: una vez por grupo, un grupo por marca, sin borrar.
        $this->falla(fn () => DB::table('tel_ring_members')->insert(['group_id' => $m2['id'], 'user_id' => $this->id_sin_contexto('fcampos@donguando.pe'), 'priority' => 5, 'active' => true]));
        $this->falla(fn () => DB::table('tel_ring_groups')->insert(['brand_id' => $m2['brand_id'], 'name' => 'Duplicado', 'strategy' => 'ROUND_ROBIN', 'ring_timeout_s' => 25]));
        $this->falla(fn () => DB::table('tel_ring_members')->where('id', $nuevo['id'])->delete());
    }

    /** Dentro de un enEmpresa ya abierto (no anida otro, que dejaría la empresa vacía). */
    private function id_sin_contexto(string $email): string
    {
        return (string) DB::table('users')->where('email', $email)->value('id');
    }
}
