<?php

namespace Tests\Feature\Modulos;

use App\Models\User;
use App\Modulos\B2b\Services\Cobranza;
use App\Modulos\B2b\Services\Credito;
use App\Modulos\B2b\Services\Portal;
use App\Modulos\B2b\Services\PreciosCliente;
use App\Modulos\B2b\Services\Recurrentes;
use App\Support\RuleError;
use App\Support\TenantContext;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * B2B · Clientes empresariales y portal del cliente. CA-B2B-01 a 09 de la spec, permisos, aislamiento del
 * portal entre clientes y entre empresas. Fecha de las pruebas: sábado 10/10/2026. Datos de demo: EL CUY
 * DORADO SAC (límite S/ 5 000, 15 días, gracia 5; cuy a S/ 25/kg en setiembre y S/ 26/kg en octubre), la
 * PICANTERÍA LA AREQUIPEÑA bloqueada por mora con su pedido P-001391 retenido, y el recurrente de lunes y jueves.
 */
class B2bTest extends TestCase
{
    private const GERENTE = 'rquispe@donguando.pe';

    private const ADMIN = 'chuaman@donguando.pe';

    private const SUPERVISORA = 'pleon@donguando.pe';

    private const VENDEDORA = 'evargas@donguando.pe';

    private const PORTAL_CUY = 'compras@elcuydorado.pe';

    private const PORTAL_PARRILLAS = 'compras@parrillasdelsur.pe';

    private const CUY = '881ff696-530f-5a1a-8576-72de7b2d74cd';

    private const PICANTERIA = '3727a115-e880-57e9-b337-c55364b971d9';

    private const PARRILLAS = '8ccd1ac8-bdd4-56b1-b362-a9ca5556681a';

    private const CUY_ENTERO = '577b8cb8-914e-50b9-84ce-67abd239740f';

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

    private function pedido(string $numero): object
    {
        return DB::table('sales_orders')->where('number', $numero)->first();
    }

    /* ------------------------------------------------------------ criterios de aceptación */

    public function test_ca_b2b_01_un_pedido_que_pasa_el_limite_se_retiene_y_con_excepcion_aprobada_se_confirma(): void
    {
        $this->usuario();
        // El pedido retenido de la demo pasa a EL CUY DORADO por S/ 1 000, con S/ 800 libres de su límite (saldo S/ 4 200 de S/ 5 000).
        $o = $this->pedido('P-001391');
        DB::table('sales_orders')->where('id', $o->id)->update(['customer_id' => self::CUY, 'estimated_total' => 1000]);
        $exp = Credito::exposicion(self::CUY, $o->id);
        DB::table('customer_credit_profiles')->where('customer_id', self::CUY)->update(['credit_limit' => $exp + 800]);
        $e = $this->falla('RN-B2B-02', fn () => Credito::confirmar($o->id, $this->usuario(self::VENDEDORA)));
        $this->assertStringContainsString('supera el límite', $e->getMessage());

        $x = Credito::solicitarExcepcion($o->id, 'Cliente fiel, paga los viernes', $this->usuario(self::VENDEDORA));
        $this->assertSame('OVER_LIMIT', $x->kind);
        $this->assertSame('200.00', $x->exceeded_amount);
        Credito::decidirExcepcion($x->id, true, 'Aprobado por esta vez', $this->usuario());
        $this->assertSame('CONFIRMED', Credito::confirmar($o->id, $this->usuario(self::VENDEDORA))->status);
        $this->assertSame('USED', DB::table('credit_exceptions')->where('id', $x->id)->value('status'));
    }

    public function test_ca_b2b_02_con_mora_sobre_la_gracia_se_rechaza_a_credito_y_al_contado_pasa(): void
    {
        $this->usuario();
        $o = $this->pedido('P-001391');
        $this->assertGreaterThan(Credito::gracia(Credito::ficha(self::PICANTERIA)), Credito::diasMora(self::PICANTERIA));
        $this->falla('RN-B2B-03', fn () => Credito::confirmar($o->id, $this->usuario(self::VENDEDORA)));
        $contado = DB::table('payment_methods')->where('code', '<>', 'CREDIT')->where('status', 'ACTIVE')->value('id');
        $o->payment_method_id = $contado;
        $r = Credito::revisar($o);
        $this->assertTrue($r['ok']);
        $this->assertFalse($r['credit']);
    }

    public function test_ca_b2b_03_la_corrida_del_domingo_dos_veces_crea_un_solo_pedido_para_el_lunes(): void
    {
        $this->usuario();
        $ro = DB::table('recurring_orders')->where('customer_id', self::CUY)->where('status', 'ACTIVE')->first();
        $this->assertTrue(Recurrentes::ocurre($ro, '2026-10-12'));
        $this->assertFalse(Recurrentes::ocurre($ro, '2026-10-13'));
        $this->assertSame(0, Recurrentes::correr('2026-10-11 17:00')['ran'], 'Antes de las 18:00 no corre.');
        $uno = Recurrentes::correr('2026-10-11 18:00', false, $ro->id);
        $dos = Recurrentes::correr('2026-10-11 18:05', false, $ro->id);
        $this->assertSame(1, $uno['ran']);
        $this->assertSame(0, $dos['ran']);
        $corridas = DB::table('recurring_order_runs')->where('recurring_order_id', $ro->id)->where('delivery_date', '2026-10-12')->get();
        $this->assertCount(1, $corridas);
        $this->assertSame(1, DB::table('sales_orders')->where('id', $corridas[0]->order_id)->where('delivery_date', '2026-10-12')->count());
    }

    public function test_ca_b2b_04_el_portal_de_un_cliente_no_ve_comprobantes_de_otro(): void
    {
        $this->usuario();
        $ajeno = collect(Portal::documentos(self::PARRILLAS))->firstWhere('sunat_status', 'ACCEPTED');
        $propios = collect(Portal::documentos(self::CUY))->pluck('id');
        $api = $this->como(self::PORTAL_CUY);
        $docs = collect($api->getJson('/api/v1/b2b/portal/cuenta')->assertOk()->json('documents'));
        $this->assertNotEmpty($docs);
        $this->assertEqualsCanonicalizing($propios->all(), $docs->pluck('id')->all());
        $this->assertFalse($docs->contains('id', $ajeno->id));
        $r = $api->getJson("/api/v1/b2b/portal/comprobantes/{$ajeno->id}/PDF")->assertStatus(422);
        $this->assertSame('RN-B2B-12', $r->json('code'));
        $ped = DB::table('sales_orders')->where('customer_id', self::PARRILLAS)->value('id');
        $this->assertSame('RN-B2B-12', $api->getJson("/api/v1/b2b/portal/pedidos/{$ped}")->assertStatus(422)->json('code'));
        // El portal no entra a las pantallas internas.
        $api->getJson('/api/v1/b2b/clientes')->assertStatus(403);
    }

    public function test_ca_b2b_05_dos_precios_de_la_misma_presentacion_no_se_traslapan(): void
    {
        $u = $this->usuario();
        $e = $this->falla('RN-B2B-06', fn () => PreciosCliente::guardar(['customer_id' => self::CUY, 'variant_id' => self::CUY_ENTERO, 'unit_price' => 27, 'valid_from' => '2026-10-15'], $u));
        $this->assertStringContainsString('S/ 26,00/kg del 01/10/2026 al 31/10/2026', $e->getMessage());
        $nuevo = PreciosCliente::guardar(['customer_id' => self::CUY, 'variant_id' => self::CUY_ENTERO, 'unit_price' => 30, 'valid_from' => '2026-11-01'], $u);
        $this->assertSame('ACTIVE', $nuevo->status);
    }

    public function test_ca_b2b_06_factura_a_15_dias_del_1_de_octubre_vence_el_16_y_avisa_el_13(): void
    {
        $this->usuario();
        $f = Cobranza::fechas('2026-10-16');
        $this->assertSame('2026-10-13', $f['BEFORE_DUE']);
        $doc = DB::table('sales_documents')->where('customer_id', self::CUY)->where('issue_date', '2026-10-01')->where('payment_terms', 'CREDIT')->first();
        $this->assertSame('2026-10-16', $doc->due_date);
        $this->assertSame('2026-10-13', DB::table('collection_reminders')->where('document_id', $doc->id)->where('reminder_type', 'BEFORE_DUE')->value('scheduled_for'));
    }

    public function test_ca_b2b_07_repetir_un_pedido_muestra_la_diferencia_de_precio(): void
    {
        $this->usuario();
        $o = $this->pedido('P-001382');
        $r = $this->como(self::PORTAL_CUY)->getJson("/api/v1/b2b/portal/pedidos/{$o->id}/repetir")->assertOk();
        $cuy = collect($r->json('lines'))->firstWhere('variant_id', self::CUY_ENTERO);
        $this->assertEquals(25, $cuy['old_price']);
        $this->assertEquals(26, $cuy['new_price']);
        $this->assertEquals(1, $cuy['diff']);
    }

    public function test_ca_b2b_08_tramos_de_antiguedad(): void
    {
        $this->assertSame('Por vencer', Cobranza::tramo(-3));
        $this->assertSame('1–15', Cobranza::tramo(10));
        $this->assertSame('31–60', Cobranza::tramo(40));
        $this->assertSame('Más de 60', Cobranza::tramo(61));
        $r = $this->como(self::GERENTE)->getJson('/api/v1/b2b/cartera')->assertOk()->json();
        $this->assertNotEmpty($r);
    }

    public function test_ca_b2b_09_quien_pide_la_excepcion_no_la_aprueba(): void
    {
        $this->usuario();
        $o = $this->pedido('P-001391');
        $x = Credito::solicitarExcepcion($o->id, 'Pagará el lunes sin falta', $this->usuario(self::SUPERVISORA));
        $e = $this->falla('RN-B2B-05', fn () => Credito::decidirExcepcion($x->id, true, null, $this->usuario(self::SUPERVISORA)));
        $this->assertStringContainsString('Quien solicita la excepción no la aprueba', $e->getMessage());
        // La vendedora no tiene el permiso de aprobar: ni siquiera llega a la regla.
        $this->como(self::VENDEDORA)->postJson("/api/v1/b2b/excepciones/{$x->id}/decidir", ['approve' => true])->assertStatus(403);
        $this->como(self::GERENTE)->postJson("/api/v1/b2b/excepciones/{$x->id}/decidir", ['approve' => true, 'note' => 'Visto con cobranza'])->assertOk();
    }

    /* ------------------------------------------------------------ permisos y aislamiento */

    public function test_la_vendedora_no_cambia_el_credito_ni_los_precios(): void
    {
        $api = $this->como(self::VENDEDORA);
        $api->putJson('/api/v1/b2b/clientes/'.self::CUY.'/credito', ['credit_limit' => 99999, 'term_days' => 15, 'grace_days' => 5, 'reason' => 'Prueba'])->assertStatus(403);
        $r = $api->postJson('/api/v1/b2b/clientes/'.self::CUY.'/bloqueo', ['blocked' => true, 'reason' => 'Prueba'])->assertStatus(403);
        $this->assertDoesNotMatchRegularExpression('/b2b\.|RN-/', $r->json('message'));
    }

    public function test_un_usuario_de_compras_no_ve_el_estado_de_cuenta_si_no_tiene_acceso(): void
    {
        $this->usuario();
        $cuenta = DB::table('b2b_portal_accounts as a')->join('users as u', 'u.id', '=', 'a.user_id')->where('u.email', self::PORTAL_CUY)->value('a.id');
        DB::table('b2b_portal_accounts')->where('id', $cuenta)->update(['can_view_statement' => false]);
        $r = $this->como(self::PORTAL_CUY)->getJson('/api/v1/b2b/portal/cuenta')->assertStatus(422);
        $this->assertSame('RN-B2B-12', $r->json('code'));
    }

    public function test_cada_empresa_ve_solo_sus_clientes_empresariales(): void
    {
        // Carnes Selectas no tiene el módulo; y aunque lo tuviera, la base no le muestra filas de Don Guando.
        $cs = $this->como('hsalas@carnesselectas.pe', self::CS);
        $cs->getJson('/api/v1/b2b/clientes')->assertStatus(403);
        $this->usuario('hsalas@carnesselectas.pe');
        foreach (['customer_credit_profiles', 'customer_prices', 'credit_exceptions', 'recurring_orders', 'b2b_portal_accounts', 'b2b_claims', 'collection_reminders'] as $t) {
            $this->assertSame(0, DB::table($t)->count(), $t);
        }
        $this->usuario();
        $this->assertGreaterThan(0, DB::table('customer_credit_profiles')->count());
    }

    public function test_las_pantallas_responden_con_datos_de_demo(): void
    {
        $api = $this->como(self::GERENTE);
        $c = self::CUY;
        foreach (['/b2b/opciones', '/b2b/clientes', "/b2b/clientes/{$c}", "/b2b/clientes/{$c}/precios", '/b2b/precios/por-aprobar', '/b2b/excepciones', '/b2b/recurrentes',
            "/b2b/clientes/{$c}/direcciones", '/b2b/corridas', "/b2b/clientes/{$c}/estado-de-cuenta", '/b2b/cartera', '/b2b/cartera?by=seller', '/b2b/cartera?by=brand',
            '/b2b/cobranza', '/b2b/reclamos', '/b2b/accesos'] as $u) {
            $api->getJson('/api/v1'.$u)->assertOk();
        }
        $p = $this->como(self::PORTAL_CUY);
        foreach (['/b2b/portal/resumen', '/b2b/portal/catalogo', '/b2b/portal/pedidos', '/b2b/portal/cuenta', '/b2b/portal/reclamos', '/b2b/portal/usuarios'] as $u) {
            $p->getJson('/api/v1'.$u)->assertOk();
        }
        $this->como(self::ADMIN)->getJson('/api/v1/b2b/cartera')->assertOk();
    }
}
