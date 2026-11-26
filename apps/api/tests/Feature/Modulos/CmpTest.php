<?php

namespace Tests\Feature\Modulos;

use App\Models\User;
use App\Modulos\Cmp\Services\Audiencia;
use App\Modulos\Cmp\Services\Campanas;
use App\Modulos\Cmp\Services\Cupones;
use App\Modulos\Cmp\Services\Puntos;
use App\Support\RuleError;
use App\Support\TenantContext;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * CMP · Campañas y fidelización. CA-CMP-01 a 09 de la spec, RN-CMP-02, 12 y 14, permisos y aislamiento entre
 * empresas. Fecha de las pruebas: 10/10/2026. Datos de demo: VUELVE10 (octubre, 1 uso por cliente) con cuatro
 * canjes, NOV-CUY (noviembre), CMP-0006 por aprobar (segmento SEG-RFM-TOP de Don Guando) y el programa de
 * puntos PUNTOS-DG (1 punto por sol sin IGV, S/ 0,05 por punto).
 */
class CmpTest extends TestCase
{
    private const MARKETING = 'lparedes@donguando.pe';   // MARKETING: segmentos, campañas, cupones

    private const GERENTE = 'rquispe@donguando.pe';

    private const ADMIN = 'chuaman@donguando.pe';        // ADMINISTRACION: aprueba y ajusta puntos sin el módulo

    private const VENDEDORA = 'evargas@donguando.pe';

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

    private function campana(string $codigo): object
    {
        TenantContext::id() || $this->usuario();

        return DB::table('campaigns')->where('code', $codigo)->first();
    }

    /** Un destinatario que hoy recibiría la campaña (con consentimiento, fuera del grupo de control). */
    private function destinatario(object $c): string
    {
        $p = Campanas::planificar($c);
        $semana = Audiencia::enLaSemana();
        $id = collect($p['rows'])->filter(fn ($e, $k) => $e === 'QUEUED' && ! isset($semana[$k]))->keys()->first() ?? false;
        $this->assertNotFalse($id, 'La campaña debería tener destinatarios.');

        return $id;
    }

    /* ------------------------------------------------------------ criterios de aceptación */

    public function test_ca_cmp_01_mil_clientes_con_10_por_ciento_de_control_son_900_a_210_51_y_exigen_gerencia(): void
    {
        $this->usuario();
        $e = Campanas::estimar(1000, 10);
        $this->assertSame(100, $e['control']);
        $this->assertSame(900, $e['effective']);
        $this->assertSame(210.51, $e['cost']);
        $this->assertTrue($e['needs_manager']);
        $this->assertFalse(Campanas::estimar(100, 10)['needs_manager']);
    }

    public function test_ca_cmp_02_quien_escribe_baja_queda_fuera_de_la_campana(): void
    {
        $this->usuario(self::MARKETING);
        $c = $this->campana('CMP-0006');
        $cliente = $this->destinatario($c);
        $r = Audiencia::entrante(['customer_id' => $cliente, 'brand_id' => $c->brand_id, 'text' => 'Baja por favor']);
        $this->assertTrue($r['optout']);
        $this->assertFalse(Audiencia::tieneConsentimiento($cliente, $c->brand_id));
        $this->assertSame('SKIPPED_CONSENT', Campanas::planificar($c)['rows'][$cliente]);
        // Un mensaje sin palabra de baja no cambia nada.
        $this->assertFalse(Audiencia::entrante(['customer_id' => $cliente, 'brand_id' => $c->brand_id, 'text' => '¿A qué hora llega mi pedido?'])['optout']);
    }

    public function test_ca_cmp_03_vuelve10_no_se_usa_dos_veces_por_el_mismo_cliente(): void
    {
        $this->usuario(self::MARKETING);
        $usado = DB::table('coupon_redemptions as r')->join('coupons as k', 'k.id', '=', 'r.coupon_id')->where('k.code', 'VUELVE10')->where('r.status', 'APPLIED')->value('r.order_id');
        $otro = DB::table('sales_orders')->where('id', $usado)->first();
        $otro->id = (string) Str::uuid();
        $otro->number = 'P-PRUEBA';
        $otro->coupon_code = null;
        $e = $this->falla('RN-CMP-08', fn () => Cupones::revisar($otro, 'VUELVE10'));
        $this->assertStringContainsString('ya usó el cupón VUELVE10', $e->getMessage());
    }

    public function test_ca_cmp_04_un_cobro_de_118_da_100_puntos_y_su_reverso_los_quita(): void
    {
        $this->usuario(self::MARKETING);
        $this->assertSame(100, Puntos::puntosPor(118));
        $ganado = DB::table('loyalty_ledger')->where('movement', 'EARN')->whereNotNull('payment_id')->whereNotExists(fn ($q) => $q->from('loyalty_ledger as x')->whereColumn('x.reversal_of', 'loyalty_ledger.id'))->first();
        $antes = Puntos::saldo($ganado->customer_id);
        $rev = Puntos::reversarCobro($ganado->payment_id, 'Cobro anulado');
        $this->assertSame(-$ganado->points, $rev->points);
        $this->assertSame($antes - $ganado->points, Puntos::saldo($ganado->customer_id));
        $this->assertNull(Puntos::reversarCobro($ganado->payment_id), 'Un cobro se revierte una sola vez.');
        $this->assertNull(Puntos::ganar($ganado->payment_id), 'Un cobro gana puntos una sola vez.');
    }

    public function test_ca_cmp_05_no_se_canjea_mas_que_el_saldo(): void
    {
        $u = $this->usuario(self::ADMIN);
        $cliente = DB::table('loyalty_ledger')->groupBy('customer_id')->havingRaw('sum(points) BETWEEN 200 AND 499')->value('customer_id');
        $saldo = Puntos::saldo($cliente);
        $e = $this->falla('RN-CMP-12', fn () => Puntos::canjear($cliente, 500, $u));
        $this->assertStringContainsString("tiene {$saldo} puntos e intenta canjear 500", $e->getMessage());
        $this->falla('RN-CMP-12', fn () => Puntos::canjear($cliente, 50, $u));   // bajo el mínimo de 100
        Puntos::canjear($cliente, 100, $u);
        $this->assertSame($saldo - 100, Puntos::saldo($cliente));
    }

    public function test_ca_cmp_06_retorno_neto_de_5_58(): void
    {
        $this->assertSame(5.58, Campanas::roi(4050, 210.51 + 405));
        $this->assertNull(Campanas::roi(100, 0));
    }

    public function test_ca_cmp_07_nadie_se_refiere_a_si_mismo_ni_refiere_a_un_cliente_con_pedidos(): void
    {
        $u = $this->usuario(self::MARKETING);
        $a = DB::table('customers')->where('customer_type', 'PERSON')->where('orders_count', '>', 0)->value('id');
        $this->falla('RN-CMP-14', fn () => Puntos::registrarReferido($a, $a, $u));
        $b = DB::table('customers')->where('customer_type', 'PERSON')->where('orders_count', '>', 0)->where('id', '<>', $a)->value('id');
        $this->falla('RN-CMP-14', fn () => Puntos::registrarReferido($a, $b, $u));
        $premiado = DB::table('referrals as f')->join('loyalty_ledger as l', 'l.id', '=', 'f.reward_ledger_id')->where('f.status', 'REWARDED')->first(['l.points', 'l.movement']);
        $this->assertSame('REFERRAL_BONUS', $premiado->movement);
        $this->assertSame(200, $premiado->points);
    }

    public function test_ca_cmp_08_el_tercer_mensaje_de_la_semana_se_omite_por_frecuencia(): void
    {
        $this->usuario(self::MARKETING);
        $c = $this->campana('CMP-0006');
        $cliente = $this->destinatario($c);
        $canales = DB::table('messaging_channels')->where('kind', 'WHATSAPP')->orderBy('number')->pluck('brand_id', 'id');
        $dg = $canales->search($c->brand_id);
        $otro = $canales->keys()->first(fn ($k) => $canales[$k] !== $c->brand_id);
        foreach ([$dg, $otro] as $i => $canal) {
            DB::table('messages')->insert(['customer_id' => $cliente, 'channel_id' => $canal, 'direction' => 'OUT', 'kind' => 'MARKETING', 'template' => 'prueba',
                'text' => 'Promo', 'sent_at' => now()->subDays($i + 1), 'status' => 'DELIVERED', 'cost' => 0.2]);
        }
        $this->assertSame(2, Audiencia::enLaSemana(null, [$cliente])[$cliente]);
        $this->assertSame('SKIPPED_FREQUENCY', Campanas::planificar($c)['rows'][$cliente]);
    }

    public function test_ca_cmp_09_un_cupon_de_noviembre_no_vale_el_1_de_diciembre(): void
    {
        $this->usuario(self::MARKETING);
        $o = DB::table('sales_orders')->where('status', 'DRAFT')->first();
        $o->coupon_code = null;
        $e = $this->falla('RN-CMP-07', fn () => Cupones::revisar($o, 'NOV-CUY', '2026-12-01'));
        $this->assertStringContainsString('vale del 01/11/2026 al 30/11/2026', $e->getMessage());
    }

    /* ------------------------------------------------------------ reglas y permisos */

    public function test_rn_cmp_02_quien_crea_la_campana_no_la_aprueba_y_sobre_el_umbral_solo_gerencia(): void
    {
        $c = $this->campana('CMP-0006');
        $r = $this->como(self::MARKETING)->postJson("/api/v1/cmp/campanas/{$c->id}/aprobar")->assertStatus(422);
        $this->assertSame('RN-CMP-02', $r->json('code'));
        $this->assertStringContainsString('Quien creó la campaña no la aprueba', $r->json('message'));
        $this->como(self::VENDEDORA)->postJson("/api/v1/cmp/campanas/{$c->id}/aprobar")->assertStatus(403);
        $g = $this->usuario(self::GERENTE);
        DB::table('campaigns')->where('id', $c->id)->update(['created_by_user' => $g->id]);
        $this->falla('RN-CMP-02', fn () => Campanas::aprobar($c->id, $g));
        DB::table('campaigns')->where('id', $c->id)->update(['created_by_user' => User::where('email', self::MARKETING)->value('id')]);
        $sobre = DB::table('campaigns')->where('id', $c->id)->value('estimated_cost');
        DB::table('campaigns')->where('id', $c->id)->update(['estimated_cost' => Campanas::umbral() + 1]);
        $this->falla('RN-CMP-02', fn () => Campanas::aprobar($c->id, $this->usuario(self::ADMIN)));
        $this->usuario();
        DB::table('campaigns')->where('id', $c->id)->update(['estimated_cost' => $sobre]);
        $this->como(self::GERENTE)->postJson("/api/v1/cmp/campanas/{$c->id}/aprobar")->assertOk()->assertJsonPath('status', 'APPROVED');
    }

    public function test_la_vendedora_no_entra_y_administracion_ajusta_puntos_sin_el_modulo(): void
    {
        $this->como(self::VENDEDORA)->getJson('/api/v1/cmp/campanas')->assertStatus(403);
        $this->como(self::VENDEDORA)->getJson('/api/v1/cmp/puntos')->assertStatus(403);
        $this->usuario();
        $cliente = DB::table('loyalty_ledger')->value('customer_id');
        $this->como(self::ADMIN)->postJson("/api/v1/cmp/puntos/clientes/{$cliente}/ajuste", ['points' => 25, 'reason' => 'Compensación por demora'])->assertCreated();
        $this->como(self::MARKETING)->postJson("/api/v1/cmp/puntos/clientes/{$cliente}/ajuste", ['points' => 25, 'reason' => 'Intento'])->assertStatus(403);
    }

    public function test_los_mensajes_de_rechazo_no_muestran_codigos_internos(): void
    {
        $this->usuario(self::MARKETING);
        $o = DB::table('sales_orders')->where('status', 'DRAFT')->first();
        $r = $this->como(self::MARKETING)->postJson('/api/v1/cmp/cupones/probar', ['order_id' => $o->id, 'code' => 'NOEXISTE'])->assertStatus(422);
        $this->assertSame('RN-CMP-07', $r->json('code'));
        $this->assertDoesNotMatchRegularExpression('/RN-|KPI-|cmp\./', $r->json('message'));
    }

    public function test_cada_empresa_ve_solo_sus_campanas_cupones_y_puntos(): void
    {
        $c = $this->campana('CMP-0006');
        $cs = $this->como('hsalas@carnesselectas.pe', self::CS);
        $this->assertSame([], $cs->getJson('/api/v1/cmp/campanas')->assertOk()->json('data'));
        $cs->getJson("/api/v1/cmp/campanas/{$c->id}")->assertNotFound();
        $this->assertSame([], $cs->getJson('/api/v1/cmp/cupones')->assertOk()->json('data'));
        $this->assertSame([], $cs->getJson('/api/v1/cmp/puntos/clientes')->assertOk()->json('data'));
    }

    public function test_las_pantallas_responden_con_datos_de_demo(): void
    {
        $api = $this->como(self::MARKETING);
        $this->usuario(self::MARKETING);
        $seg = DB::table('customer_segments')->value('id');
        $camp = $this->campana('CMP-0003');
        $cli = DB::table('loyalty_ledger')->value('customer_id');
        foreach (['/cmp/opciones', '/cmp/segmentos', "/cmp/segmentos/{$seg}", '/cmp/campanas', "/cmp/campanas/{$camp->id}", '/cmp/calendario?month=2026-10', '/cmp/cupones',
            '/cmp/puntos', '/cmp/puntos/clientes', "/cmp/puntos/clientes/{$cli}", '/cmp/referidos', '/cmp/consentimientos', '/cmp/recompra', '/cmp/clientes/buscar?q=ma'] as $u) {
            $api->getJson('/api/v1'.$u)->assertOk();
        }
        $api->postJson('/api/v1/cmp/segmentos/vista-previa', ['rules' => ['inactive' => true]])->assertOk();
        $this->assertNotNull($api->getJson("/api/v1/cmp/campanas/{$camp->id}")->json('results.roi'));
    }
}
