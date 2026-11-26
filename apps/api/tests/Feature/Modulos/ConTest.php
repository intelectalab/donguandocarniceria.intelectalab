<?php

namespace Tests\Feature\Modulos;

use App\Models\User;
use App\Modulos\Con\Services\Base;
use App\Modulos\Con\Services\EntregasService;
use App\Modulos\Con\Services\PuntosService;
use App\Modulos\Con\Services\VisitasService;
use App\Support\RuleError;
use App\Support\TenantContext;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * CON · Consignación. CA-CON-01 a 11 de la spec, permisos del visitador y aislamiento entre empresas. Fecha de las
 * pruebas: 10/10/2026. Datos de demo: Minimarket Los Álamos (contrato CC-2026-001 al 20 %, del 01/08 al 31/12/2026,
 * con congeladora prestada y la entrega EC-00019 en borrador sin guía), Bodega Gourmet con visita planificada hoy y
 * Market Orgánico con escala de comisión. Feriados del 08/12 y 09/12/2026 en el calendario.
 */
class ConTest extends TestCase
{
    private const GERENTE = 'rquispe@donguando.pe';

    private const VISITADOR = 'mvilla@donguando.pe';    // VISITADOR_CONSIGNACION: solo sus puntos

    private const VENDEDORA = 'evargas@donguando.pe';

    private const LOS_ALAMOS = 'ee73f8ed-57a3-570b-b11d-a4d46783bd60';

    private const GOURMET = '7d9982f8-4cab-5beb-bda5-f16f59bdc074';

    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo(Carbon::parse('2026-10-10 10:00', 'America/Lima'));
    }

    /* ------------------------------------------------------------ ayudas */

    private function como(string $email, string $host = self::DG): static
    {
        return $this->desde($host, $this->ingresar($host, $email));
    }

    private function usuario(string $email = self::GERENTE): User
    {
        $tenantId = DB::selectOne('SELECT auth_tenants_for_email(?) AS t', [$email])->t;
        TenantContext::set(TenantContext::find($tenantId));
        $u = User::where('email', $email)->firstOrFail();
        TenantContext::setUser($u->id);

        return $u;
    }

    private function falla(string $regla, callable $fn): RuleError
    {
        try {
            $fn();
        } catch (RuleError $e) {
            $this->assertSame($regla, $e->rule, $e->getMessage());

            return $e;
        }
        $this->fail("Se esperaba el rechazo {$regla} y la acción pasó.");
    }

    /* ------------------------------------------------------------ criterios de aceptación */

    public function test_ca_con_01_vendido_16_caldos_a_18_son_288_con_57_60_de_comision_y_230_40_neto(): void
    {
        $this->usuario();
        $c = Base::calcularConteo(0, 30, 12, 0, 2);
        $this->assertEquals(16, $c['sold']);
        $importe = $c['sold'] * 18;
        $this->assertEquals(288, $importe);
        $contrato = (object) ['id' => (string) Str::uuid(), 'compensation_type' => 'COMMISSION', 'commission_pct' => '20.00'];
        $com = Base::comision($contrato, $importe);
        $this->assertSame(57.6, $com['amount']);
        $this->assertSame(230.4, round($importe - $com['amount'], 2));
    }

    public function test_ca_con_02_sin_guia_de_remision_no_se_despacha(): void
    {
        $u = $this->usuario();
        $e = DB::table('consignment_deliveries')->where('number', 'EC-00019')->first();
        $this->assertNull($e->gre_number);
        $x = $this->falla('RN-CON-07', fn () => EntregasService::despachar($e->id, [], $u));
        $this->assertStringContainsString('no tiene serie y número de guía de remisión', $x->getMessage());
    }

    public function test_ca_con_03_dia_limite_de_facturacion_en_dias_habiles_con_feriados(): void
    {
        $this->usuario();
        $this->assertSame('2026-11-13', Base::diaLimite('2026-11-02'));
        $this->assertSame('2026-12-16', Base::diaLimite('2026-12-01'));
        DB::table('calendar_holidays')->whereIn('holiday_date', ['2026-12-08', '2026-12-09'])->delete();
        Base::olvidarFeriados();
        $this->assertSame('2026-12-14', Base::diaLimite('2026-12-01'), 'Sin los feriados el plazo vuelve a ser de 9 días hábiles.');
    }

    public function test_ca_con_04_un_lote_que_vence_en_5_dias_no_se_consigna(): void
    {
        $u = $this->usuario();
        $p = Base::punto(self::LOS_ALAMOS);
        $c = Base::contratoVigente($p->id);
        $vid = DB::table('consignment_contract_products')->where('contract_id', $c->id)->where('active', true)->value('variant_id');
        $lote = collect(EntregasService::lotes($p, $vid))->first();
        $this->assertNotNull($lote, 'Debe haber un lote disponible del producto.');
        $loteId = is_array($lote) ? $lote['lot_id'] : ($lote->lot_id ?? $lote->id);
        DB::table('lots')->where('id', $loteId)->update(['expiry_date' => '2026-10-15']);
        $e = $this->falla('RN-CON-06', fn () => EntregasService::crear(['point_id' => $p->id, 'delivery_date' => '2026-10-10',
            'lines' => [['variant_id' => $vid, 'lot_id' => $loteId, 'qty' => 1]]], $u));
        $this->assertStringContainsString('le quedan 5 días de vida útil y el mínimo para consignar es 10', $e->getMessage());
    }

    public function test_ca_con_05_un_lote_que_vence_en_2_dias_se_propone_retirar_completo(): void
    {
        $this->usuario();
        $v = DB::table('consignment_visits')->where('point_id', self::GOURMET)->where('planned_date', '2026-10-10')->first();
        $p = Base::punto(self::GOURMET);
        $s = collect(Base::stock($p, '2026-10-10'))->first(fn ($x) => $x->expiry_date !== null);
        DB::table('lots')->where('id', $s->lot_id)->update(['expiry_date' => '2026-10-12']);
        $pro = collect(VisitasService::propuestas($v))->firstWhere('lot_id', $s->lot_id);
        $this->assertNotNull($pro);
        $this->assertEquals($s->qty, $pro->propose);
        $this->assertStringContainsString('Vence el 12/10/2026 (2 días)', $pro->reason);
    }

    public function test_ca_con_06_reposicion_sugerida_de_12(): void
    {
        $r = Base::reposicion(56, 28, 7, 2, 6, 20);
        $this->assertEquals(2, $r['daily']);
        $this->assertEquals(12, $r['qty']);
        $this->assertEquals(9, Base::reposicion(56, 28, 7, 2, 6, 15)['qty'], 'Con máximo 15 manda el tope: 15 − 6.');
        $this->assertEquals(0, Base::reposicion(56, 28, 7, 2, 25, 20)['qty'], 'Con más de lo necesario no se repone.');
    }

    public function test_ca_con_07_con_escala_el_tramo_alcanzado_vale_para_toda_la_venta(): void
    {
        $u = $this->usuario();
        $c = Base::contratoVigente(self::LOS_ALAMOS);
        PuntosService::guardarTramo($c->id, 0, 15, $u);
        PuntosService::guardarTramo($c->id, 2000, 18, $u);
        $r = Base::comision($c, 2500);
        $this->assertEquals(18, $r['pct']);
        $this->assertSame(450.0, $r['amount']);
        $this->assertSame(285.0, Base::comision($c, 1900)['amount']);
    }

    public function test_ca_con_08_margen_neto_de_1910(): void
    {
        $this->assertSame(1910.0, Base::margenNeto(2500, 450, 4, 15, 80));
    }

    public function test_ca_con_09_con_una_congeladora_prestada_el_punto_no_se_cierra(): void
    {
        $u = $this->usuario();
        $e = $this->falla('RN-CON-23', fn () => PuntosService::cambiarEstado(self::LOS_ALAMOS, 'CLOSED', 'Cierre del local', $u));
        $this->assertStringContainsString('equipo(s) prestado(s) sin devolver', $e->getMessage());
        $this->assertSame('ACTIVE', Base::punto(self::LOS_ALAMOS)->status);
    }

    public function test_ca_con_10_un_sobrante_nunca_da_venta_negativa(): void
    {
        $c = Base::calcularConteo(35, 0, 40);
        $this->assertEquals(0, $c['sold']);
        $this->assertEquals(5, $c['surplus']);
        $this->falla('RN-CON-12', fn () => Base::calcularConteo(35, 0, -1));
    }

    public function test_ca_con_11_dos_contratos_activos_no_se_traslapan(): void
    {
        $u = $this->usuario();
        $nuevo = PuntosService::guardarContrato(['point_id' => self::LOS_ALAMOS, 'valid_from' => '2026-12-01', 'valid_to' => null, 'compensation_type' => 'COMMISSION',
            'commission_pct' => 18, 'settlement_frequency_days' => 14, 'withdraw_days_before_expiry' => 3, 'signed_file_url' => 'con/actas/CC-prueba.pdf'], null, $u);
        $vigente = Base::contratoVigente(self::LOS_ALAMOS);
        $prod = (array) DB::table('consignment_contract_products')->where('contract_id', $vigente->id)->first();
        unset($prod['id'], $prod['created_at'], $prod['updated_at']);
        DB::table('consignment_contract_products')->insert(['contract_id' => $nuevo->id] + $prod);
        $e = $this->falla('RN-CON-03', fn () => PuntosService::aprobarContrato($nuevo->id, $u));
        $this->assertStringContainsString('CC-2026-001', $e->getMessage());
    }

    /* ------------------------------------------------------------ permisos y aislamiento */

    public function test_el_visitador_ve_solo_sus_puntos_y_la_vendedora_no_entra(): void
    {
        $this->usuario();
        $mios = DB::table('consignment_points')->where('visitor_user_id', User::where('email', self::VISITADOR)->value('id'))->pluck('id')->all();
        $ajeno = DB::table('consignment_points')->whereNotIn('id', $mios ?: ['00000000-0000-0000-0000-000000000000'])->value('id');
        $api = $this->como(self::VISITADOR);
        $ids = collect($api->getJson('/api/v1/con/puntos')->assertOk()->json('data'))->pluck('id')->all();
        $this->assertEqualsCanonicalizing($mios, $ids);
        if ($ajeno) {
            $api->getJson("/api/v1/con/puntos/{$ajeno}")->assertNotFound();
        }
        $this->como(self::VENDEDORA)->getJson('/api/v1/con/puntos')->assertStatus(403);
    }

    public function test_cada_empresa_ve_solo_sus_puntos(): void
    {
        $cs = $this->como('hsalas@carnesselectas.pe', self::CS);
        $this->assertSame([], $cs->getJson('/api/v1/con/puntos')->assertOk()->json('data'));
        $cs->getJson('/api/v1/con/puntos/'.self::LOS_ALAMOS)->assertNotFound();
        $this->usuario('hsalas@carnesselectas.pe');
        foreach (['consignment_points', 'consignment_contracts', 'consignment_deliveries', 'consignment_visits', 'consignment_settlements', 'consignment_equipment_loans'] as $t) {
            $this->assertSame(0, DB::table($t)->count(), $t);
        }
    }

    public function test_las_pantallas_responden_con_datos_de_demo(): void
    {
        $api = $this->como(self::GERENTE);
        $pt = self::LOS_ALAMOS;
        foreach (['/con/opciones', '/con/puntos', "/con/puntos/{$pt}", '/con/contratos', '/con/entregas', '/con/visitas', '/con/visitas/hoy', '/con/liquidaciones',
            '/con/rentabilidad', '/con/stock', '/con/equipos', '/con/incentivos'] as $u) {
            $api->getJson('/api/v1'.$u)->assertOk();
        }
        $this->como(self::VISITADOR)->getJson('/api/v1/con/visitas/hoy')->assertOk();
    }
}
