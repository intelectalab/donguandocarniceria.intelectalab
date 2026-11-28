<?php

namespace Tests\Feature\Modulos;

use App\Modulos\Prs\Services\Alertas;
use App\Modulos\Prs\Services\Base;
use App\Modulos\Prs\Services\Real;
use App\Support\TenantContext;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/** PRS · Presupuesto: un test por criterio CA-PRS-01 a CA-PRS-07 y las reglas que los rodean (RN-PRS-01 a RN-PRS-13). */
class PrsTest extends TestCase
{
    private array $tokens = [];

    private const GERENTE = 'rquispe@donguando.pe';

    private const ADMIN = 'chuaman@donguando.pe';

    private const CONTADORA = 'mcardenas@donguando.pe';

    private function como(string $email): static
    {
        return $this->desde(self::DG, $this->tokens[$email] ??= $this->ingresar(self::DG, $email));
    }

    /** Corre $fn dentro de la empresa Don Guando (RLS) y deja el contexto limpio. */
    private function enDG(callable $fn): mixed
    {
        $t = DB::selectOne('SELECT auth_tenants_for_email(?) AS t', [self::GERENTE])->t;
        TenantContext::set(TenantContext::find($t));
        TenantContext::setUser(DB::table('users')->where('email', self::GERENTE)->value('id'));
        try {
            return $fn();
        } finally {
            try {
                TenantContext::set(null);
            } catch (\Throwable) {
                // La transacción ya falló (lo que se prueba); el contexto se limpia al deshacerla.
            }
        }
    }

    private function concepto(string $code): string
    {
        return $this->enDG(fn () => DB::table('budget_concepts')->where('code', $code)->value('id'));
    }

    private function codigo(string $tabla, string $code): string
    {
        return $this->enDG(fn () => DB::table($tabla)->where('code', $code)->value('id'));
    }

    private function version(int $anio, int $no): object
    {
        return $this->enDG(fn () => DB::table('budget_versions as v')->join('budgets as b', 'b.id', '=', 'v.budget_id')->where('b.year', $anio)->where('v.version_no', $no)->first(['v.*']));
    }

    public function test_ca_prs_01_proyeccion_publicidad_rojo_y_alerta(): void
    {
        $v2 = $this->version(2026, 2);
        $pub = $this->concepto('PUB-PLA');
        $dg = $this->codigo('brands', 'DG');
        $mkt = $this->codigo('cost_centers', 'MKT-DG');
        $r = $this->enDG(fn () => Alertas::evaluar(['version_id' => $v2->id, 'period' => '2026-10-01', 'concept_id' => $pub,
            'brand_id' => $dg, 'establishment_id' => null, 'cost_center_id' => $mkt,
            'budget' => 6000, 'actual' => 4800, 'al' => '2026-10-20']));
        $this->assertSame(20, $r['elapsed']);
        $this->assertSame(31, $r['days']);
        $this->assertEqualsWithDelta(7440, $r['forecast'], 0.001);
        $this->assertEqualsWithDelta(124.0, $r['pct'], 0.001);
        $this->assertSame('RED', $r['light']);
        $this->assertNotNull($r['alert']);
        $this->assertEqualsWithDelta(7440, (float) $r['alert']->forecast, 0.001);
        $marketing = $this->enDG(fn () => DB::table('users')->where('email', 'lparedes@donguando.pe')->value('id'));
        $this->assertContains($marketing, json_decode($r['alert']->notified, true), 'Se avisa al responsable del centro de costo (MARKETING)');
        $this->assertSame($marketing, $r['alert']->owner_user_id);
        $alerta = $r['alert']->id;
        $this->assertTrue($this->enDG(fn () => DB::table('notifications')->where('user_id', $marketing)->where('module', 'PRS')->whereRaw("ref->>'id' = ?", [$alerta])->exists()));
        // Una sola alerta abierta por línea y mes: evaluar de nuevo actualiza la misma.
        $otra = $this->enDG(fn () => Alertas::evaluar(['version_id' => $v2->id, 'period' => '2026-10-01', 'concept_id' => $pub, 'brand_id' => $dg, 'establishment_id' => null,
            'cost_center_id' => $mkt, 'budget' => 6000, 'actual' => 5000, 'al' => '2026-10-20']));
        $this->assertSame($alerta, $otra['alert']->id);
    }

    public function test_ca_prs_02_linea_de_version_aprobada_no_cambia(): void
    {
        $v2 = $this->version(2026, 2);
        $l = $this->enDG(fn () => DB::table('budget_lines')->where('version_id', $v2->id)->orderBy('id')->first());
        $this->como(self::ADMIN)->putJson("/api/v1/prs/lineas/{$l->id}", ['amount' => (float) $l->amount + 500])->assertStatus(422)->assertJsonPath('code', 'RN-PRS-04');
        $this->assertEqualsWithDelta((float) $l->amount, (float) $this->enDG(fn () => DB::table('budget_lines')->where('id', $l->id)->value('amount')), 0.001);
        // La base también lo impide (trigger).
        $this->expectExceptionMessage('RN-PRS-04');
        $this->enDG(fn () => DB::table('budget_lines')->where('id', $l->id)->update(['amount' => 1]));
    }

    public function test_ca_prs_03_al_aprobar_v2_la_v1_queda_reemplazada(): void
    {
        $b = $this->como(self::ADMIN)->postJson('/api/v1/prs/presupuestos', ['anio' => 2030, 'nombre' => 'Prueba CA-PRS-03'])->assertCreated()->json();
        $this->como(self::ADMIN)->postJson("/api/v1/prs/versiones/{$b['version_id']}/lineas", ['concept_id' => $this->concepto('PUB-PLA'), 'month' => '2030-01-01',
            'brand_id' => $this->codigo('brands', 'DG'), 'cost_center_id' => $this->codigo('cost_centers', 'MKT-DG'), 'amount' => 5000])->assertCreated();
        $this->como(self::ADMIN)->postJson("/api/v1/prs/versiones/{$b['version_id']}/enviar")->assertOk()->assertJsonPath('status', 'SUBMITTED');
        $this->como(self::GERENTE)->postJson("/api/v1/prs/versiones/{$b['version_id']}/aprobar")->assertOk()->assertJsonPath('status', 'APPROVED');
        $v2 = $this->como(self::ADMIN)->postJson("/api/v1/prs/presupuestos/{$b['budget_id']}/versiones", ['desde' => $b['version_id'], 'pct' => 5])->assertCreated()->json();
        $this->como(self::ADMIN)->postJson("/api/v1/prs/versiones/{$v2['id']}/enviar")->assertOk();
        $this->como(self::GERENTE)->postJson("/api/v1/prs/versiones/{$v2['id']}/aprobar", ['comentario' => 'Ok'])->assertOk()->assertJsonPath('status', 'APPROVED');

        $estados = $this->enDG(fn () => DB::table('budget_versions')->where('budget_id', $b['budget_id'])->orderBy('version_no')->pluck('status')->all());
        $this->assertSame(['SUPERSEDED', 'APPROVED'], $estados);
        $this->assertSame($v2['id'], $this->enDG(fn () => DB::table('budgets')->where('id', $b['budget_id'])->value('current_version_id')));
        $this->assertEqualsWithDelta(5250, (float) $this->enDG(fn () => DB::table('budget_lines')->where('version_id', $v2['id'])->value('amount')), 0.001);
    }

    public function test_ca_prs_04_semaforo_de_ingresos(): void
    {
        $this->enDG(function () {
            $this->assertSame(95.8, Base::pct(115000, 120000));
            $this->assertSame(93.3, Base::pct(112000, 120000));
            $this->assertSame('AMBER', Base::semaforoDe(120000, 115000, 'INCOME'));
            $this->assertSame('RED', Base::semaforoDe(120000, 112000, 'INCOME'));
            $this->assertSame('GREEN', Base::semaforoDe(120000, 121000, 'INCOME'));
            // Gastos: verde hasta 100 %, ámbar hasta 105 %, rojo encima (RN-PRS-07).
            $this->assertSame('GREEN', Base::semaforo(100.0, 'EXPENSE'));
            $this->assertSame('AMBER', Base::semaforo(104.9, 'EXPENSE'));
            $this->assertSame('RED', Base::semaforo(105.1, 'EXPENSE'));
            $this->assertSame('AMBER', DB::selectOne("SELECT budget_traffic_light(95.8, 'INCOME', 5) AS l")->l);
        });
    }

    public function test_ca_prs_05_copiar_el_real_del_anio_anterior_con_8_por_ciento(): void
    {
        $m2 = $this->codigo('brands', 'M2');
        $cre = $this->concepto('PUB-CRE');
        $this->enDG(function () use ($m2, $cre) {
            $empresa = Base::empresaPorDefecto();
            $antes = count(Real::corridas('2026-03-01', $empresa));
            $ultima = DB::table('budget_actuals')->where('company_id', $empresa)->where('period', '2026-03-01')->max('run_no');
            $filas = DB::table('budget_actuals')->where('company_id', $empresa)->where('period', '2026-03-01')->where('run_no', $ultima)->get()
                ->map(fn ($a) => ['concept_id' => $a->concept_id, 'brand_id' => $a->brand_id, 'establishment_id' => $a->establishment_id, 'cost_center_id' => $a->cost_center_id,
                    'source' => $a->source, 'amount' => $a->concept_id === $cre && $a->brand_id === $m2 ? 2500.0 : (float) $a->amount])->all();
            Real::congelar('2026-03-01', $empresa, null, 'Prueba CA-PRS-05', null, $filas);
            $this->assertCount($antes + 1, Real::corridas('2026-03-01', $empresa), 'Recalcular crea una corrida nueva (RN-PRS-09)');
        });
        $v27 = $this->version(2027, 1);
        $this->como(self::ADMIN)->postJson("/api/v1/prs/versiones/{$v27->id}/copiar-real", ['pct' => 8])->assertOk();
        $l = $this->enDG(fn () => DB::table('budget_lines')->where('version_id', $v27->id)->where('concept_id', $cre)->where('brand_id', $m2)->where('month', '2027-03-01')->first());
        $this->assertNotNull($l);
        $this->assertEqualsWithDelta(2700, (float) $l->amount, 0.001);
    }

    public function test_ca_prs_06_quien_envia_no_aprueba(): void
    {
        $v2 = $this->version(2026, 2);
        $n = $this->como(self::ADMIN)->postJson("/api/v1/prs/presupuestos/{$v2->budget_id}/versiones", ['desde' => $v2->id])->assertCreated()->json();
        $this->como(self::ADMIN)->postJson("/api/v1/prs/versiones/{$n['id']}/enviar")->assertOk();
        $this->como(self::ADMIN)->postJson("/api/v1/prs/versiones/{$n['id']}/aprobar")->assertStatus(422)->assertJsonPath('code', 'RN-PRS-05');
        $this->assertSame('SUBMITTED', $this->enDG(fn () => DB::table('budget_versions')->where('id', $n['id'])->value('status')));
        $this->assertSame('APPROVED', $this->enDG(fn () => DB::table('budget_versions')->where('id', $v2->id)->value('status')));
        // Aunque sea GERENTE: si él la envió, la aprueba otra persona.
        $g = $this->como(self::GERENTE)->postJson("/api/v1/prs/presupuestos/{$v2->budget_id}/versiones", ['desde' => $v2->id])->assertCreated()->json();
        $this->como(self::GERENTE)->postJson("/api/v1/prs/versiones/{$g['id']}/enviar")->assertOk();
        $this->como(self::GERENTE)->postJson("/api/v1/prs/versiones/{$g['id']}/aprobar")->assertStatus(422)->assertJsonPath('code', 'RN-PRS-05');
    }

    public function test_ca_prs_07_importe_negativo_se_rechaza(): void
    {
        $v27 = $this->version(2027, 1);
        $antes = $this->enDG(fn () => DB::table('budget_lines')->where('version_id', $v27->id)->count());
        $this->como(self::ADMIN)->postJson("/api/v1/prs/versiones/{$v27->id}/lineas", ['concept_id' => $this->concepto('ADM-GEN'), 'month' => '2027-01-01',
            'establishment_id' => $this->codigo('establishments', 'L1'), 'cost_center_id' => $this->codigo('cost_centers', 'ADM'), 'amount' => -100])
            ->assertStatus(422)->assertJsonPath('code', 'RN-PRS-11');
        $r = $this->como(self::ADMIN)->postJson("/api/v1/prs/versiones/{$v27->id}/importar/revisar", ['texto' => "concepto;mes;marca;local;centro_costo;importe;nota\nADM-GEN;1;;L1;ADM;-100;"])->assertOk();
        $this->assertSame('RN-PRS-11', $r->json('errores.0.code'));
        $this->como(self::ADMIN)->postJson("/api/v1/prs/versiones/{$v27->id}/importar", ['texto' => 'ADM-GEN;1;;L1;ADM;-100;'])->assertStatus(422)->assertJsonPath('code', 'RN-PRS-11');
        $this->assertSame($antes, $this->enDG(fn () => DB::table('budget_lines')->where('version_id', $v27->id)->count()));
    }

    public function test_reglas_de_lineas_y_envio(): void
    {
        $v27 = $this->version(2027, 1);
        // RN-PRS-02: la capacitación no tiene mapeo y la versión no se envía.
        $this->como(self::ADMIN)->postJson("/api/v1/prs/versiones/{$v27->id}/enviar")->assertStatus(422)->assertJsonPath('code', 'RN-PRS-02');
        // RN-PRS-01: sin dimensión.
        $this->como(self::ADMIN)->postJson("/api/v1/prs/versiones/{$v27->id}/lineas", ['concept_id' => $this->concepto('ADM-GEN'), 'month' => '2027-02-01', 'amount' => 10])
            ->assertStatus(422)->assertJsonPath('code', 'RN-PRS-01');
        // RN-PRS-01: mes fuera del año.
        $this->como(self::ADMIN)->postJson("/api/v1/prs/versiones/{$v27->id}/lineas", ['concept_id' => $this->concepto('ADM-GEN'), 'month' => '2026-02-01',
            'cost_center_id' => $this->codigo('cost_centers', 'ADM'), 'amount' => 10])->assertStatus(422)->assertJsonPath('code', 'RN-PRS-01');
        // RN-PRS-13: una fila nueva que repite concepto y dimensiones se rechaza.
        $this->como(self::ADMIN)->postJson("/api/v1/prs/versiones/{$v27->id}/filas", ['concept_id' => $this->concepto('GPE-CAP'), 'cost_center_id' => $this->codigo('cost_centers', 'RRHH'),
            'importes' => [100, null, null, null, null, null, null, null, null, null, null, null]])->assertStatus(422)->assertJsonPath('code', 'RN-PRS-13');
        // Con el mapeo (Contadora) ya se envía.
        $this->como(self::CONTADORA)->postJson('/api/v1/prs/conceptos/'.$this->concepto('GPE-CAP').'/mapeos', ['source' => 'ACCOUNT', 'ref' => '6256'])->assertCreated();
        // RN-PRS-06: una misma fuente va a un solo concepto.
        $this->como(self::CONTADORA)->postJson('/api/v1/prs/conceptos/'.$this->concepto('ADM-GEN').'/mapeos', ['source' => 'ACCOUNT', 'ref' => '6256'])
            ->assertStatus(422)->assertJsonPath('code', 'RN-PRS-06');
        $this->como(self::ADMIN)->postJson("/api/v1/prs/versiones/{$v27->id}/enviar")->assertOk()->assertJsonPath('status', 'SUBMITTED');
        // Rechazo con motivo, y vuelve a ser editable.
        $this->como(self::GERENTE)->postJson("/api/v1/prs/versiones/{$v27->id}/rechazar", ['comentario' => 'Falta bajar alquileres'])->assertOk()->assertJsonPath('status', 'REJECTED');
        $l = $this->enDG(fn () => DB::table('budget_lines')->where('version_id', $v27->id)->first());
        $this->como(self::ADMIN)->putJson("/api/v1/prs/lineas/{$l->id}", ['amount' => 123])->assertOk();
        // La administración no aprueba (D-PRS-03) y el auditor solo lee.
        $this->como(self::ADMIN)->postJson('/api/v1/prs/conceptos', ['code' => 'X', 'name' => 'x'])->assertStatus(422);
        $this->como('aexterno@donguando.pe')->postJson("/api/v1/prs/versiones/{$v27->id}/lineas", [])->assertStatus(403);
    }

    public function test_pantallas_responden(): void
    {
        $g = $this->como(self::GERENTE);
        $g->getJson('/api/v1/prs/opciones')->assertOk()->assertJsonPath('puede.aprobar', true);
        $p = $g->getJson('/api/v1/prs/presupuestos')->assertOk();
        $this->assertSame([2027, 2026], array_column($p->json('presupuestos'), 'year'));
        $v2 = $this->version(2026, 2);
        $m = $g->getJson("/api/v1/prs/versiones/{$v2->id}")->assertOk();
        $this->assertNotEmpty($m->json('filas'));
        $this->assertFalse($m->json('version.editable'));
        $e = $g->getJson('/api/v1/prs/ejecucion?mes=2026-09&al=2026-11-26')->assertOk();
        $this->assertGreaterThan(80000, $e->json('kpi.ingreso.actual'), 'Ventas de setiembre sin IGV');
        $this->assertNotEmpty($e->json('filas'));
        $g->getJson('/api/v1/prs/ejecucion?mes=2026-08&modo=ACUMULADO&dim=centro&al=2026-11-26')->assertOk()->assertJsonPath('estados.2026-08-01.estado', 'CLOSED');
        $d = $g->getJson('/api/v1/prs/detalle?concepto='.$this->concepto('DLV-COM').'&mes=2026-09&al=2026-11-26')->assertOk();
        $this->assertNotEmpty($d->json('filas'));
        $pr = $g->getJson('/api/v1/prs/proyeccion?mes=2026-10&al=2026-10-10')->assertOk();
        $this->assertSame(10, $pr->json('transcurridos'));
        $this->assertSame('CURRENT', $pr->json('estado_codigo'));
        $g->getJson('/api/v1/prs/alertas?estado=ACTIVAS')->assertOk();
        $g->getJson('/api/v1/prs/alertas/semaforo?mes=2026-10&al=2026-10-10')->assertOk();
        $v1 = $this->version(2026, 1);
        $c = $g->getJson("/api/v1/prs/comparativo?a={$v1->id}&b={$v2->id}")->assertOk();
        $this->assertNotEmpty($c->json('filas'));
        $g->getJson("/api/v1/prs/versiones/{$v2->id}/diferencias")->assertOk();
        $g->get('/api/v1/prs/ejecucion/exportar?mes=2026-09&al=2026-11-26')->assertOk();
        $this->como(self::ADMIN)->get('/api/v1/prs/importar/plantilla')->assertOk();
        // Generar alertas y guardar proyección (prs.report.view_all).
        $g->postJson('/api/v1/prs/alertas/generar', ['version' => $v2->id, 'mes' => '2026-10', 'al' => '2026-10-10'])->assertOk();
        $g->postJson('/api/v1/prs/proyeccion/guardar', ['version' => $v2->id, 'mes' => '2026-10', 'al' => '2026-10-10'])->assertCreated();
        $a = $this->enDG(fn () => DB::table('budget_alerts')->whereIn('status', ['OPEN', 'ACK'])->value('id'));
        $g->postJson("/api/v1/prs/alertas/{$a}/comentar", ['texto' => 'Revisado con el área', 'estado' => 'ACK'])->assertOk();
    }

    public function test_rn_prs_12_sin_ver_todo_no_ve_otros_centros(): void
    {
        // COMPRAS lee PRS pero no tiene prs.report.view_all ni centros a su cargo: no ve líneas.
        $email = $this->enDG(fn () => DB::table('users as u')->join('user_roles as ur', 'ur.user_id', '=', 'u.id')->join('roles as r', 'r.id', '=', 'ur.role_id')
            ->where('r.code', 'COMPRAS')->where('u.status', 'ACTIVE')->value('u.email'));
        $this->assertNotNull($email);
        $e = $this->como($email)->getJson('/api/v1/prs/ejecucion?mes=2026-09&al=2026-11-26')->assertOk();
        $this->assertSame([], $e->json('filas'));
        $this->como($email)->postJson('/api/v1/prs/alertas/generar', ['version' => $this->version(2026, 2)->id, 'mes' => '2026-10'])->assertStatus(403);
        // La contadora ve todo.
        $this->assertNotEmpty($this->como(self::CONTADORA)->getJson('/api/v1/prs/ejecucion?mes=2026-09&al=2026-11-26')->assertOk()->json('filas'));
    }

    public function test_recalcular_mes_cerrado_crea_nueva_corrida(): void
    {
        $this->como(self::CONTADORA)->postJson('/api/v1/prs/real/recalcular', ['mes' => '2026-09', 'motivo' => 'Prueba de recálculo'])->assertStatus(422)->assertJsonPath('code', 'RN-PRS-09');
        $antes = $this->enDG(fn () => DB::table('budget_actuals')->where('period', '2026-08-01')->max('run_no'));
        $this->como(self::CONTADORA)->postJson('/api/v1/prs/real/recalcular', ['mes' => '2026-08', 'motivo' => 'Factura registrada tarde'])->assertCreated()->assertJsonPath('run_no', $antes + 1);
    }
}
