<?php

namespace Tests\Feature\Modulos;

use App\Models\User;
use App\Modulos\Alm\Services\InventarioService;
use App\Modulos\Alm\Services\ReservasService;
use App\Modulos\Cat\Services\Balanza;
use App\Modulos\Pos\Services\Ose;
use App\Support\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/** POS · Mostrador: un test por criterio CA-POS-01 a CA-POS-06 y las reglas que los rodean. */
class PosTest extends TestCase
{
    private const CAJERO = 'jsalas@donguando.pe';

    private const SUPERVISORA = 'pleon@donguando.pe';

    private const GERENTE = 'rquispe@donguando.pe';

    private array $tokens = [];

    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo(Carbon::parse('2026-11-10 10:00', 'America/Lima'));
        Ose::$caido = false;
    }

    protected function tearDown(): void
    {
        Ose::$caido = false;
        parent::tearDown();
    }

    /* ------------------------------------------------------------ ayudas */

    private function como(string $email): static
    {
        return $this->desde(self::DG, $this->tokens[$email] ??= $this->ingresar(self::DG, $email));
    }

    private function usuario(string $email = self::GERENTE): User
    {
        $t = DB::selectOne('SELECT auth_tenants_for_email(?) AS t', [$email])->t;
        TenantContext::set(TenantContext::find($t));
        $u = User::where('email', $email)->firstOrFail();
        TenantContext::setUser($u->id);

        return $u;
    }

    private function variante(string $sku): object
    {
        $this->usuario();

        return DB::table('product_variants')->where('sku', $sku)->first();
    }

    private function almacen(string $code): string
    {
        $this->usuario();

        return DB::table('warehouses')->where('code', $code)->value('id');
    }

    /** Deja en el almacén solo un lote nuevo y vigente de la variante, con esa cantidad. */
    private function stock(string $sku, float $qty, string $wh = 'MOS-L1', ?float $peso = null): string
    {
        $u = $this->usuario();
        $v = $this->variante($sku);
        DB::statement("SELECT set_config('app.cal_decision', 'on', true)");
        DB::table('lots')->where('variant_id', $v->id)->update(['qc_status' => 'BLOCKED']);
        $lot = DB::table('lots')->insertGetId([
            'product_id' => $v->product_id, 'variant_id' => $v->id, 'code' => 'L-'.substr($sku, 0, 10).'-'.random_int(100, 999), 'origin' => 'PURCHASE',
            'production_date' => now()->toDateString(), 'expiry_date' => now()->addDays(8)->toDateString(), 'qc_status' => 'RELEASED', 'unit_cost' => 20,
        ], 'id');
        InventarioService::mover(['type' => 'RECEIPT', 'warehouse_id' => $this->almacen($wh), 'variant_id' => $v->id, 'lot_id' => $lot, 'qty' => $qty,
            'weight_kg' => $peso, 'unit_cost' => 20, 'source_type' => 'TEST', 'reason' => 'Prueba POS'], $u);

        return $lot;
    }

    private function saldoStock(string $wh, string $sku, string $lot): float
    {
        $this->usuario();

        return (float) DB::table('stock_balances')->where('warehouse_id', $this->almacen($wh))->where('variant_id', $this->variante($sku)->id)->where('lot_id', $lot)->value('qty');
    }

    private function caja(string $code = 'MOS-1'): object
    {
        $this->usuario();

        return DB::table('pos_terminals')->where('code', $code)->first();
    }

    /** Segunda caja del Local 1 (para abrir turnos sin tocar el de la demo). */
    private function caja2(): object
    {
        $c = $this->caja();
        $r = $this->como(self::GERENTE)->postJson('/api/v1/pos/cajas', [
            'code' => 'MOS-2', 'name' => 'Mostrador 2', 'establishment_id' => $c->establishment_id, 'warehouse_id' => $c->warehouse_id,
            'cash_account_id' => $c->cash_account_id, 'card_account_id' => $c->card_account_id, 'receipt_series_id' => $c->receipt_series_id,
            'default_price_list_id' => $c->default_price_list_id, 'scale_mode' => 'LABEL',
        ])->assertCreated();

        return (object) $r->json();
    }

    private function turnoDemo(): object
    {
        $this->usuario();

        return DB::table('pos_shifts')->where('number', 'TUR-00003')->first();
    }

    private function venta(array $lineas, array $pagos, array $extra = []): \Illuminate\Testing\TestResponse
    {
        return $this->como($extra['_como'] ?? self::CAJERO)->postJson('/api/v1/pos/ventas', ['lines' => $lineas, 'payments' => $pagos] + array_diff_key($extra, ['_como' => 1]));
    }

    private function falla(\Illuminate\Testing\TestResponse $r, string $regla): void
    {
        $r->assertStatus(422);
        $this->assertSame($regla, $r->json('code'), (string) $r->json('message'));
    }

    /* ------------------------------------------------------------ CA-POS */

    public function test_ca_pos_01_una_caja_y_una_cajera_tienen_un_solo_turno_abierto(): void
    {
        $mos1 = $this->caja();
        // La demo ya tiene el turno TUR-00003 de Jorge Salas en «Mostrador 1».
        $this->falla($this->como(self::GERENTE)->postJson('/api/v1/pos/turnos', ['terminal_id' => $mos1->id, 'counts' => ['100' => 2]]), 'RN-POS-01');

        $mos2 = $this->caja2();
        // RN-POS-02: la cajera con turno abierto no abre otro en otra caja.
        $this->falla($this->como(self::CAJERO)->postJson('/api/v1/pos/turnos', ['terminal_id' => $mos2->id, 'counts' => ['100' => 2]]), 'RN-POS-02');

        $t = $this->como(self::GERENTE)->postJson('/api/v1/pos/turnos', ['terminal_id' => $mos2->id, 'counts' => ['100' => 1, '50' => 1, '20' => 2, '0.5' => 20]])->assertCreated();
        $this->assertEquals(200, $t->json('opening_float'));
        $this->assertSame('OPEN', $t->json('status'));
        $this->assertMatchesRegularExpression('/^TUR-\d{5}$/', $t->json('number'));
        $this->falla($this->como(self::CAJERO)->postJson('/api/v1/pos/turnos', ['terminal_id' => $mos2->id]), 'RN-POS-01');

        // La base lo repite: un segundo turno abierto en la misma caja no entra.
        $this->usuario();
        $this->expectException(QueryException::class);
        DB::table('pos_shifts')->insert([
            'number' => 'TUR-99999', 'terminal_id' => $mos2->id, 'establishment_id' => $mos2->establishment_id, 'cashier_user_id' => User::where('email', self::SUPERVISORA)->value('id'),
            'cashier_name' => 'Patricia', 'opened_at' => now(), 'opening_float' => 0, 'opening_counts' => '{}', 'status' => 'OPEN',
        ]);
    }

    public function test_ca_pos_02_peso_fuera_del_rango_de_la_variante(): void
    {
        $lot = $this->stock('DG-CON-ENT', 3, 'MOS-L1', 5.5);
        $conejo = $this->variante('DG-CON-ENT')->id;

        $r = $this->como(self::CAJERO)->postJson('/api/v1/pos/cotizar', ['lines' => [['variant_id' => $conejo, 'qty' => 1, 'weight_kg' => '25']]]);
        $this->falla($r, 'RN-POS-04');
        $this->assertStringContainsString('1,200 kg a 2,500 kg', $r->json('message'));
        $this->falla($this->como(self::CAJERO)->postJson('/api/v1/pos/peso', ['variant_id' => $conejo, 'weight_kg' => '31']), 'RN-POS-04');
        $this->falla($this->como(self::CAJERO)->postJson('/api/v1/pos/peso', ['variant_id' => $conejo, 'weight_kg' => '0']), 'RN-POS-04');

        $c = $this->como(self::CAJERO)->postJson('/api/v1/pos/cotizar', ['lines' => [['variant_id' => $conejo, 'qty' => 1, 'weight_kg' => '1.850']]])->assertOk();
        $this->assertEquals(70.30, $c->json('total'));
        $this->assertEquals(38.00, $c->json('lineas.0.price'));

        $v = $this->venta([['variant_id' => $conejo, 'qty' => 1, 'weight_kg' => '1.850']], [['method' => 'CASH', 'amount' => 80]])->assertCreated();
        $this->assertEquals(70.30, $v->json('total'));
        $this->assertEquals(9.70, $v->json('vuelto'));
        $this->assertEquals(2, $this->saldoStock('MOS-L1', 'DG-CON-ENT', $lot));

        // La supervisora puede aceptar un peso fuera de rango (pos.weight.override); la cajera no.
        $this->falla($this->como(self::CAJERO)->postJson('/api/v1/pos/peso', ['variant_id' => $conejo, 'weight_kg' => '2.9', 'override' => true]), 'RN-POS-04');
        $this->como(self::SUPERVISORA)->postJson('/api/v1/pos/peso', ['variant_id' => $conejo, 'weight_kg' => '2.9', 'override' => true])->assertOk()->assertJsonPath('weight_kg', '2.900');
    }

    public function test_ca_pos_03_pago_mixto_emite_boleta_y_deja_dos_cobros_en_el_turno(): void
    {
        $mos1 = $this->caja();
        $b001 = DB::table('document_series')->where('series', 'B001')->value('id');
        $this->como(self::GERENTE)->putJson("/api/v1/pos/cajas/{$mos1->id}", ['receipt_series_id' => $b001])->assertOk();
        $lot = $this->stock('DG-COR-PIE', 5, 'MOS-L1', 5);
        $pierna = $this->variante('DG-COR-PIE')->id;
        $linea = [['variant_id' => $pierna, 'weight_kg' => '2.500']];

        // RN-POS-11: lo que no es efectivo no pasa el total y la suma alcanza el total.
        $this->falla($this->venta($linea, [['method' => 'CARD', 'amount' => 130, 'reference' => '1', 'card_last4' => '4821']]), 'RN-POS-11');
        $this->falla($this->venta($linea, [['method' => 'CASH', 'amount' => 50]]), 'RN-POS-11');
        // RN-CAJ-02 y RN-CAJ-03: la tarjeta con operación y 4 dígitos.
        $this->falla($this->venta($linea, [['method' => 'CASH', 'amount' => 50], ['method' => 'CARD', 'amount' => 70, 'card_last4' => '4821']]), 'RN-CAJ-02');
        $this->falla($this->venta($linea, [['method' => 'CASH', 'amount' => 50], ['method' => 'CARD', 'amount' => 70, 'reference' => '004512', 'card_last4' => '48']]), 'RN-CAJ-03');

        $r = $this->venta($linea, [['method' => 'CASH', 'amount' => 50], ['method' => 'CARD', 'amount' => 70, 'reference' => '004512', 'card_brand' => 'VISA', 'card_last4' => '4821']])->assertCreated();
        $this->assertEquals(120.00, $r->json('total'));
        $this->assertCount(1, $r->json('comprobantes'));
        $this->assertStringStartsWith('B001-', $r->json('comprobantes.0.full_number'));
        $this->assertSame('ACCEPTED', $r->json('comprobantes.0.sunat_status'));

        $this->usuario();
        $turno = $this->turnoDemo();
        $cobros = DB::table('payments as p')->join('payment_methods as m', 'm.id', '=', 'p.payment_method_id')->where('p.pos_ticket', $r->json('ticket'))
            ->orderBy('m.code')->get(['m.code', 'p.amount', 'p.pos_shift_id', 'p.reference', 'p.card_last4', 'p.card_brand']);
        $this->assertCount(2, $cobros);
        $this->assertSame(['CARD', 'CASH'], $cobros->pluck('code')->all());
        $this->assertEquals([70.00, 50.00], $cobros->pluck('amount')->map(fn ($x) => (float) $x)->all());
        $this->assertSame([$turno->id, $turno->id], $cobros->pluck('pos_shift_id')->all());
        $this->assertSame(['004512', '4821', 'VISA'], [$cobros[0]->reference, $cobros[0]->card_last4, $cobros[0]->card_brand]);

        $doc = DB::table('sales_documents')->where('full_number', $r->json('comprobantes.0.full_number'))->first();
        $this->assertEquals([120.00, 101.69, 18.31, 0.00], [(float) $doc->total, (float) $doc->subtotal, (float) $doc->igv, (float) $doc->balance]);
        $l = DB::table('sales_document_lines')->where('sales_document_id', $doc->id)->first();
        $this->assertEquals([2.5, 'KGM', 48.0], [(float) $l->qty, $l->uom_code, (float) $l->unit_price]);
        $o = DB::table('sales_orders')->where('id', $doc->order_id)->first();
        $this->assertSame(['COUNTER', 'COUNTER', 'CLOSED'], [$o->channel, $o->fulfillment, $o->status]);
        $this->assertEquals([120.00, 120.00], [(float) $o->final_total, (float) $o->paid_amount]);
        $this->assertEquals(2.5, $this->saldoStock('MOS-L1', 'DG-COR-PIE', $lot));
        $this->assertSame(['CONFIRMED', 'DELIVERED', 'CLOSED'], DB::table('sales_order_status_history')->where('order_id', $o->id)->orderBy('changed_at')->orderBy('created_at')->pluck('to_status')->all());

        // RN-CAJ-04: la misma operación de tarjeta no se registra dos veces.
        $this->falla($this->venta([['variant_id' => $pierna, 'weight_kg' => '0.500']], [['method' => 'CARD', 'amount' => 24, 'reference' => '004512', 'card_last4' => '4821']]), 'RN-CAJ-04');
    }

    public function test_ca_pos_04_arqueo_con_diferencia_exige_motivo_y_lo_aprueba_otra_persona(): void
    {
        $mos2 = $this->caja2();
        $t = $this->como(self::GERENTE)->postJson('/api/v1/pos/turnos', ['terminal_id' => $mos2->id, 'counts' => ['200' => 1]])->assertCreated()->json();

        // Cobros en efectivo del turno por S/ 1 350 (ventas del día).
        $this->usuario();
        DB::table('payments')->insert([
            'number' => 'CB-990001', 'customer_id' => DB::table('customers')->where('full_name', 'Clientes varios (mostrador)')->value('id'),
            'payment_method_id' => DB::table('payment_methods')->where('code', 'CASH')->value('id'), 'cash_account_id' => $mos2->cash_account_id,
            'amount' => 1350, 'paid_at' => now(), 'status' => 'CONFIRMED', 'brand_id' => DB::table('brands')->where('code', 'DG')->value('id'),
            'establishment_id' => $mos2->establishment_id, 'fee_amount' => 0, 'reconciliation_status' => 'NOT_APPLICABLE', 'pos_shift_id' => $t['id'],
        ]);
        $this->como(self::GERENTE)->postJson("/api/v1/pos/turnos/{$t['id']}/movimientos", ['movement_type' => 'CASH_OUT', 'amount' => 1000, 'reason' => 'Retiro a caja fuerte'])
            ->assertCreated()->assertJsonPath('turno.esperado.efectivo', 550);

        $cerrar = fn (array $extra = []) => $this->como(self::GERENTE)->postJson("/api/v1/pos/turnos/{$t['id']}/cerrar", [
            'cash_denoms' => ['200' => 2, '100' => 1, '20' => 2, '5' => 1], 'counts' => ['CARD' => 0, 'YAPE' => 0, 'PLIN' => 0],
        ] + $extra);
        $r = $cerrar();
        $this->falla($r, 'RN-POS-07');
        $this->assertStringContainsString('−S/ 5.00', $r->json('message'));

        $c = $cerrar(['reason' => 'Faltó sencillo al dar vuelto'])->assertOk();
        $this->assertSame('CLOSED', $c->json('status'));
        $this->assertEquals([550.00, 545.00, -5.00], [(float) $c->json('expected_cash'), (float) $c->json('counted_cash'), (float) $c->json('difference')]);
        $this->assertSame(['200' => 2, '100' => 1, '20' => 2, '5' => 1], $c->json('closing_denoms'));
        $this->assertFalse($c->json('over_limit'));
        $this->assertCount(4, $c->json('conteos'));

        // Un turno cerrado no se reabre ni se cambia su arqueo (también en la base).
        $this->falla($cerrar(['reason' => 'otra vez']), 'RN-POS-01');
        $this->usuario();
        try {
            DB::transaction(fn () => DB::table('pos_shifts')->where('id', $t['id'])->update(['counted_cash' => 550]));
            $this->fail('La base dejó cambiar el arqueo cerrado.');
        } catch (QueryException $e) {
            $this->assertStringContainsString('RN-POS-07', $e->getMessage());
        }

        // RN-POS-08: quien cerró como cajera no aprueba; la supervisora sí.
        $this->falla($this->como(self::GERENTE)->postJson("/api/v1/pos/turnos/{$t['id']}/aprobar"), 'RN-POS-08');
        $this->como(self::CAJERO)->postJson("/api/v1/pos/turnos/{$t['id']}/aprobar")->assertForbidden();
        $a = $this->como(self::SUPERVISORA)->postJson("/api/v1/pos/turnos/{$t['id']}/aprobar", ['note' => 'Revisado'])->assertOk();
        $this->assertSame(['APPROVED', 'Patricia León Vera'], [$a->json('status'), $a->json('approved_by_name')]);
    }

    public function test_ca_pos_05_el_mostrador_no_vende_lo_reservado_para_delivery(): void
    {
        $lot = $this->stock('DG-CUY-ENT', 3, 'MOS-L1', 2.7);
        $u = $this->usuario();
        $o = DB::table('sales_orders')->where('number', 'P-001318')->first();
        ReservasService::reservar(['order_id' => $o->id, 'order_number' => $o->number, 'brand_id' => $o->brand_id, 'establishment_id' => $o->establishment_id,
            'delivery_date' => now()->toDateString(), 'lines' => [['line_id' => DB::table('sales_order_lines')->where('sales_order_id', $o->id)->value('id'),
                'variant_id' => $this->variante('DG-CUY-ENT')->id, 'qty' => 2, 'lot_id' => $lot]]], $u);
        $cuy = $this->variante('DG-CUY-ENT')->id;

        $r = $this->venta([['variant_id' => $cuy, 'qty' => 2, 'weight_kg' => '1.800']], [['method' => 'CASH', 'amount' => 100]]);
        $this->falla($r, 'RN-ALM-09');
        $this->assertStringContainsString('reservados para pedidos de delivery', $r->json('message'));
        $this->assertEquals(3, $this->saldoStock('MOS-L1', 'DG-CUY-ENT', $lot));

        $this->venta([['variant_id' => $cuy, 'qty' => 1, 'weight_kg' => '0.900']], [['method' => 'CASH', 'amount' => 37.80]])->assertCreated();
        $this->assertEquals(2, $this->saldoStock('MOS-L1', 'DG-CUY-ENT', $lot));
    }

    public function test_ca_pos_06_etiqueta_de_balanza_con_plu_y_digito_de_control(): void
    {
        $this->stock('M3-CHO-ART', 10, 'MOS-L1', 10);
        $chorizo = $this->variante('M3-CHO-ART')->id;

        $e = $this->como(self::CAJERO)->postJson('/api/v1/pos/codigo', ['code' => '2012345012509'])->assertOk();
        $this->assertSame(['ETIQUETA', $chorizo, '1.250', '12345'], [$e->json('tipo'), $e->json('etiqueta.variant_id'), $e->json('etiqueta.weight_kg'), $e->json('etiqueta.plu')]);

        // PLU de otro producto para la línea del chorizo.
        $otro = Balanza::armar('10005', 1.25);
        $this->falla($this->como(self::CAJERO)->postJson('/api/v1/pos/codigo', ['code' => $otro, 'variant_id' => $chorizo]), 'RN-POS-06');
        $this->falla($this->como(self::CAJERO)->postJson('/api/v1/pos/codigo', ['code' => '2012345012508']), 'RN-POS-06');

        // En la venta, el peso de la línea es el del código.
        $this->falla($this->venta([['variant_id' => $chorizo, 'weight_kg' => '1.300', 'weight_source' => 'LABEL', 'barcode' => '2012345012509']], [['method' => 'CASH', 'amount' => 50]]), 'RN-POS-06');
        $this->falla($this->venta([['variant_id' => $chorizo, 'weight_kg' => '1.250', 'weight_source' => 'LABEL', 'barcode' => $otro]], [['method' => 'CASH', 'amount' => 50]]), 'RN-POS-06');
        $v = $this->venta([['variant_id' => $chorizo, 'weight_kg' => '1.250', 'weight_source' => 'LABEL', 'barcode' => '2012345012509']], [['method' => 'CASH', 'amount' => 45]])->assertCreated();
        $this->assertEquals(45.00, $v->json('total'));
        $this->usuario();
        $this->assertSame('LABEL', DB::table('sales_order_lines as l')->join('sales_orders as o', 'o.id', '=', 'l.sales_order_id')->where('o.pos_ticket', $v->json('ticket'))->value('l.weight_source'));
    }

    /* ------------------------------------------------------------ reglas */

    public function test_venta_sin_turno_abierto_se_rechaza(): void
    {
        $this->stock('DG-CAL-1L', 5);
        $caldo = $this->variante('DG-CAL-1L')->id;
        $this->falla($this->venta([['variant_id' => $caldo, 'qty' => 1]], [['method' => 'CASH', 'amount' => 18]], ['_como' => self::GERENTE]), 'RN-POS-03');
        // La supervisora no vende en el mostrador (pos.sale.create).
        $this->venta([['variant_id' => $caldo, 'qty' => 1]], [['method' => 'CASH', 'amount' => 18]], ['_como' => self::SUPERVISORA])->assertForbidden();
    }

    public function test_varias_marcas_un_comprobante_por_marca_cobrado_en_un_paso(): void
    {
        $this->stock('DG-CAL-1L', 5);
        $this->stock('M3-CHO-ART', 5, 'MOS-L1', 5);
        $lineas = [['variant_id' => $this->variante('DG-CAL-1L')->id, 'qty' => 2], ['variant_id' => $this->variante('M3-CHO-ART')->id, 'weight_kg' => '0.500']];
        $this->falla($this->venta($lineas, [['method' => 'YAPE', 'amount' => 54]]), 'RN-CAJ-02');
        $r = $this->venta($lineas, [['method' => 'YAPE', 'amount' => 40, 'reference' => '88990011'], ['method' => 'CASH', 'amount' => 20]])->assertCreated();
        $this->assertEquals([54.00, 6.00], [$r->json('total'), $r->json('vuelto')]);
        $this->assertCount(2, $r->json('comprobantes'));
        $this->assertCount(2, $r->json('pedidos'));
        $this->assertSame(['B010', 'B010'], array_map(fn ($d) => substr($d['full_number'], 0, 4), $r->json('comprobantes')));

        $this->usuario();
        $docs = DB::table('sales_documents')->where('pos_ticket', $r->json('ticket'))->get();
        foreach ($docs as $d) {
            $this->assertEquals((float) $d->total, (float) DB::table('payment_allocations')->where('document_id', $d->id)->sum('amount'));
            $this->assertEquals(0, (float) $d->balance);
        }
        $efectivo = DB::table('payments')->where('pos_ticket', $r->json('ticket'))->whereNotNull('cash_given')->first();
        $this->assertEquals([14.00, 20.00, 6.00], [(float) $efectivo->amount, (float) $efectivo->cash_given, (float) $efectivo->change_given]);

        // Ventas del turno (POS-10) y comprobante (POS-05).
        $v = $this->como(self::CAJERO)->getJson('/api/v1/pos/ventas')->assertOk();
        $this->assertGreaterThanOrEqual(2, count($v->json('filas')));
        $this->como(self::CAJERO)->getJson('/api/v1/pos/tickets/'.$r->json('ticket'))->assertOk()->assertJsonCount(2);
        $d = $this->como(self::CAJERO)->getJson('/api/v1/pos/comprobantes/'.$r->json('comprobantes.0.id'))->assertOk();
        $this->assertNotEmpty($d->json('lineas'));
        $this->assertNotEmpty($d->json('empresa.ruc'));
    }

    public function test_factura_exige_ruc_y_boleta_grande_exige_documento(): void
    {
        $this->stock('DG-COR-PIE', 25, 'MOS-L1', 25);
        $pierna = $this->variante('DG-COR-PIE')->id;
        $this->falla($this->venta([['variant_id' => $pierna, 'weight_kg' => '1.000']], [['method' => 'CASH', 'amount' => 48]], ['doc_type' => 'INVOICE']), 'RN-FAC-04');
        // 15 kg × S/ 48 = S/ 720, más de S/ 700 sin documento.
        $this->falla($this->venta([['variant_id' => $pierna, 'weight_kg' => '15']], [['method' => 'CASH', 'amount' => 720]]), 'RN-FAC-05');

        $this->usuario();
        $ruc = DB::table('customers')->where('doc_type', 'RUC')->whereNull('merged_into_id')->where('status', 'ACTIVE')->first();
        $r = $this->venta([['variant_id' => $pierna, 'weight_kg' => '1.000']], [['method' => 'CASH', 'amount' => 48]], ['doc_type' => 'INVOICE', 'customer_id' => $ruc->id])->assertCreated();
        $this->assertStringStartsWith('F', $r->json('comprobantes.0.full_number'));
    }

    public function test_saldo_a_favor_se_usa_con_cliente_identificado(): void
    {
        $this->stock('DG-CAL-500', 5);
        $caldo = $this->variante('DG-CAL-500')->id;
        $this->usuario();
        $cli = DB::table('customers')->where('full_name', 'Milagros Sánchez Sánchez')->first();
        $saldo = round((float) DB::table('customer_balance_movements')->where('customer_id', $cli->id)->sum('amount'), 2);
        $this->assertGreaterThan(14, $saldo);

        $this->falla($this->venta([['variant_id' => $caldo, 'qty' => 1]], [['method' => 'BALANCE', 'amount' => 14]]), 'RN-CAJ-08');
        $this->falla($this->venta([['variant_id' => $caldo, 'qty' => 2]], [['method' => 'BALANCE', 'amount' => 28]], ['customer_id' => $cli->id]), 'RN-CAJ-08');
        $r = $this->venta([['variant_id' => $caldo, 'qty' => 1]], [['method' => 'BALANCE', 'amount' => 14]], ['customer_id' => $cli->id])->assertCreated();
        $this->usuario();
        $this->assertEquals(round($saldo - 14, 2), round((float) DB::table('customer_balance_movements')->where('customer_id', $cli->id)->sum('amount'), 2));
        $this->assertSame(0, DB::table('payments')->where('pos_ticket', $r->json('ticket'))->count());
        $this->assertEquals(14, (float) DB::table('sales_orders')->where('pos_ticket', $r->json('ticket'))->value('paid_amount'));
    }

    public function test_retiro_sobre_el_limite_necesita_autorizacion(): void
    {
        $t = $this->turnoDemo();
        $this->como(self::CAJERO)->postJson("/api/v1/pos/turnos/{$t->id}/movimientos", ['movement_type' => 'CASH_IN', 'amount' => 300, 'reason' => 'Ingreso de sencillo'])->assertCreated();
        $mov = ['movement_type' => 'CASH_OUT', 'amount' => 150, 'reason' => 'Retiro a caja fuerte'];
        $this->falla($this->como(self::CAJERO)->postJson("/api/v1/pos/turnos/{$t->id}/movimientos", $mov), 'RN-POS-09');
        $this->falla($this->como(self::CAJERO)->postJson("/api/v1/pos/turnos/{$t->id}/movimientos", $mov + ['authorizer_email' => self::SUPERVISORA, 'authorizer_password' => 'mala']), 'RN-POS-09');
        $this->falla($this->como(self::CAJERO)->postJson("/api/v1/pos/turnos/{$t->id}/movimientos", $mov + ['authorizer_email' => self::CAJERO, 'authorizer_password' => self::CLAVE]), 'RN-POS-09');
        $m = $this->como(self::CAJERO)->postJson("/api/v1/pos/turnos/{$t->id}/movimientos", $mov + ['authorizer_email' => self::SUPERVISORA, 'authorizer_password' => self::CLAVE])->assertCreated();
        $this->assertSame('Patricia León Vera', $m->json('movimiento.authorized_by_name'));
        // Debajo del límite no pide autorización; nunca se saca más de lo que hay.
        $this->como(self::CAJERO)->postJson("/api/v1/pos/turnos/{$t->id}/movimientos", ['movement_type' => 'PETTY_EXPENSE', 'amount' => 20, 'reason' => 'Bolsas'])->assertCreated();
        $this->falla($this->como(self::CAJERO)->postJson("/api/v1/pos/turnos/{$t->id}/movimientos", ['movement_type' => 'DEPOSIT', 'amount' => 99999, 'reason' => 'Depósito'] + ['authorizer_email' => self::SUPERVISORA, 'authorizer_password' => self::CLAVE]), 'RN-POS-09');
    }

    public function test_cierre_con_diferencia_grande_avisa_a_la_supervisora(): void
    {
        $t = $this->turnoDemo();
        $esp = $this->como(self::CAJERO)->getJson("/api/v1/pos/turnos/{$t->id}")->assertOk()->json('esperado');
        $conteos = collect($esp['por_medio'])->mapWithKeys(fn ($m) => [$m['code'] => $m['esperado']])->all();
        $conteos['CASH'] = round($conteos['CASH'] - 12, 2);
        $c = $this->como(self::CAJERO)->postJson("/api/v1/pos/turnos/{$t->id}/cerrar", ['counts' => $conteos, 'reason' => 'Billete falso'])->assertOk();
        $this->assertTrue($c->json('over_limit'));
        $this->usuario();
        $this->assertTrue(DB::table('notifications')->where('role', 'SUPERVISORA_VENTAS')->where('module', 'POS')->where('title', 'like', '%TUR-00003%')->exists());
        // Con el turno cerrado ya no se vende ni se mueve efectivo.
        $this->falla($this->como(self::CAJERO)->postJson("/api/v1/pos/turnos/{$t->id}/movimientos", ['movement_type' => 'CASH_IN', 'amount' => 10, 'reason' => 'Sencillo']), 'RN-POS-09');
    }

    public function test_devolucion_con_nota_de_credito_y_lote_a_devoluciones(): void
    {
        $lot = $this->stock('DG-COR-PIE', 5, 'MOS-L1', 5);
        $pierna = $this->variante('DG-COR-PIE')->id;
        $r = $this->venta([['variant_id' => $pierna, 'weight_kg' => '2.000']], [['method' => 'CASH', 'amount' => 100]])->assertCreated();
        $docId = $r->json('comprobantes.0.id');
        $linea = $this->como(self::SUPERVISORA)->getJson("/api/v1/pos/comprobantes/{$docId}")->assertOk()->json('lineas.0.id');
        $esperado = $this->como(self::CAJERO)->getJson("/api/v1/pos/turnos/{$this->turnoDemo()->id}")->json('esperado.efectivo');

        // La cajera no devuelve (pos.sale.refund); con «Clientes varios» no hay saldo a favor.
        $this->como(self::CAJERO)->postJson("/api/v1/pos/comprobantes/{$docId}/devolucion", ['lines' => [['line_id' => $linea, 'weight_kg' => 1]], 'mode' => 'SAME', 'reason' => 'Producto con mal olor'])->assertForbidden();
        $this->falla($this->como(self::SUPERVISORA)->postJson("/api/v1/pos/comprobantes/{$docId}/devolucion", ['lines' => [['line_id' => $linea, 'weight_kg' => 1]], 'mode' => 'CREDIT', 'reason' => 'Producto con mal olor']), 'RN-POS-13');
        $this->falla($this->como(self::SUPERVISORA)->postJson("/api/v1/pos/comprobantes/{$docId}/devolucion", ['lines' => [['line_id' => $linea, 'weight_kg' => 2.5]], 'mode' => 'SAME', 'reason' => 'Producto con mal olor']), 'RN-POS-13');

        $n = $this->como(self::SUPERVISORA)->postJson("/api/v1/pos/comprobantes/{$docId}/devolucion", ['lines' => [['line_id' => $linea, 'weight_kg' => 0.5]], 'mode' => 'SAME', 'reason' => 'Producto con mal olor'])->assertCreated();
        $this->assertStringStartsWith('BC01-', $n->json('nota.full_number'));
        $this->assertEquals(24.00, $n->json('monto'));
        $this->assertTrue($n->json('efectivo'));
        $this->assertEquals(round($esperado - 24, 2), $this->como(self::CAJERO)->getJson("/api/v1/pos/turnos/{$this->turnoDemo()->id}")->json('esperado.efectivo'));

        // D-POS-04: vuelve al almacén de devoluciones (que no vende), con el mismo lote.
        $this->assertEquals(0.5, $this->saldoStock('DEV-L1', 'DG-COR-PIE', $lot));
        $this->assertEquals(3, $this->saldoStock('MOS-L1', 'DG-COR-PIE', $lot));

        // Lo devuelto se descuenta: queda 1,5 kg por devolver; devolver todo cierra exacto.
        $this->falla($this->como(self::SUPERVISORA)->postJson("/api/v1/pos/comprobantes/{$docId}/devolucion", ['lines' => [['line_id' => $linea, 'weight_kg' => 1.6]], 'mode' => 'SAME', 'reason' => 'Producto con mal olor']), 'RN-POS-13');
        $this->como(self::SUPERVISORA)->postJson("/api/v1/pos/comprobantes/{$docId}/devolucion", ['lines' => [['line_id' => $linea, 'weight_kg' => 1.5]], 'mode' => 'SAME', 'reason' => 'Producto con mal olor', 'restock' => false])->assertCreated();
        $this->usuario();
        $this->assertEquals(96.00, (float) DB::table('sales_documents')->where('related_document_id', $docId)->sum('total'));
        $this->assertEquals(0.5, $this->saldoStock('DEV-L1', 'DG-COR-PIE', $lot));
    }

    public function test_ose_sin_respuesta_entrega_el_ticket_y_deja_el_comprobante_en_reintento(): void
    {
        $this->stock('DG-CAL-1L', 5);
        Ose::$caido = true;
        $r = $this->venta([['variant_id' => $this->variante('DG-CAL-1L')->id, 'qty' => 1]], [['method' => 'CASH', 'amount' => 18]])->assertCreated();
        $this->assertSame('PENDING', $r->json('comprobantes.0.sunat_status'));
        $id = $r->json('comprobantes.0.id');
        $this->como(self::CAJERO)->getJson('/api/v1/pos/contexto')->assertOk()->assertJsonFragment(['pantalla' => 'pos-10']);
        $this->como(self::CAJERO)->postJson("/api/v1/pos/comprobantes/{$id}/reenviar")->assertOk()->assertJsonPath('documento.sunat_status', 'PENDING');
        Ose::$caido = false;
        $d = $this->como(self::CAJERO)->postJson("/api/v1/pos/comprobantes/{$id}/reenviar")->assertOk();
        $this->assertSame('ACCEPTED', $d->json('documento.sunat_status'));
        $this->assertCount(3, $d->json('envios'));
        $this->falla($this->como(self::CAJERO)->postJson("/api/v1/pos/comprobantes/{$id}/reenviar"), 'RN-FAC-06');
    }

    public function test_pedido_por_recoger_se_cobra_y_se_entrega(): void
    {
        $this->usuario();
        $o = DB::table('sales_orders')->where('number', 'P-001293')->first();
        foreach (DB::table('sales_order_lines as l')->join('product_variants as v', 'v.id', '=', 'l.variant_id')->where('l.sales_order_id', $o->id)->get(['v.sku', 'l.qty', 'l.weighed_kg', 'v.sale_mode']) as $l) {
            $this->stock($l->sku, 20, 'MOS-L1', 20);
        }
        $lista = $this->como(self::CAJERO)->getJson('/api/v1/pos/recojos?q=P-001293')->assertOk();
        $this->assertEquals(80.66, collect($lista->json('pedidos'))->firstWhere('number', 'P-001293')['saldo']);

        $this->falla($this->como(self::CAJERO)->postJson("/api/v1/pos/recojos/{$o->id}/entregar", ['payments' => [['method' => 'CASH', 'amount' => 50]]]), 'RN-POS-11');
        $this->falla($this->como(self::GERENTE)->postJson("/api/v1/pos/recojos/{$o->id}/entregar", ['payments' => [['method' => 'CASH', 'amount' => 90]]]), 'RN-POS-05');
        $r = $this->como(self::CAJERO)->postJson("/api/v1/pos/recojos/{$o->id}/entregar", ['payments' => [['method' => 'CASH', 'amount' => 100]]])->assertOk();
        $this->assertSame(['CLOSED', true], [$r->json('pedido.status'), $r->json('cerrado')]);
        $this->assertEquals([80.66, 19.34], [$r->json('cobrado'), $r->json('vuelto')]);
        $this->assertEquals(80.66, (float) $r->json('comprobante.total'));
        $this->usuario();
        $this->assertTrue(DB::table('stock_movements')->where('source_type', 'SALES_ORDER')->where('source_id', $o->id)->where('movement_type', 'SALE')->exists());

        // Pagado de más: se entrega sin cobro y lo de más queda como saldo a favor.
        $p = DB::table('sales_orders')->where('number', 'P-001291')->first();
        foreach (DB::table('sales_order_lines as l')->join('product_variants as v', 'v.id', '=', 'l.variant_id')->where('l.sales_order_id', $p->id)->pluck('v.sku') as $sku) {
            $this->stock($sku, 20, 'MOS-L1', 20);
        }
        $this->falla($this->como(self::CAJERO)->postJson("/api/v1/pos/recojos/{$p->id}/entregar", ['payments' => [['method' => 'CASH', 'amount' => 5]]]), 'RN-POS-11');
        $r2 = $this->como(self::CAJERO)->postJson("/api/v1/pos/recojos/{$p->id}/entregar", [])->assertOk();
        $this->assertSame('CLOSED', $r2->json('pedido.status'));
        $this->assertSame('CUSTOMER_CREDIT', $r2->json('pedido.balance_mode'));
    }

    public function test_cajas_registradoras_validan_local_almacen_y_series(): void
    {
        $c = $this->caja();
        $this->usuario();
        $otroAlmacen = DB::table('warehouses')->where('code', 'ALM-L2')->value('id');
        $base = ['code' => 'MOS-9', 'name' => 'Mostrador 9', 'establishment_id' => $c->establishment_id, 'warehouse_id' => $c->warehouse_id, 'receipt_series_id' => $c->receipt_series_id];
        $this->falla($this->como(self::GERENTE)->postJson('/api/v1/pos/cajas', ['warehouse_id' => $otroAlmacen] + $base), 'RN-POS-10');
        $this->falla($this->como(self::GERENTE)->postJson('/api/v1/pos/cajas', ['receipt_series_id' => DB::table('document_series')->where('series', 'F001')->value('id')] + $base), 'RN-FAC-02');
        $this->falla($this->como(self::GERENTE)->postJson('/api/v1/pos/cajas', ['code' => 'MOS-1'] + $base), 'RN-POS-01');
        $this->como(self::CAJERO)->postJson('/api/v1/pos/cajas', $base)->assertForbidden();
        $this->como(self::GERENTE)->postJson('/api/v1/pos/cajas', $base)->assertCreated()->assertJsonPath('scale_mode', 'MANUAL');
        // Una caja con turno abierto no se desactiva.
        $this->falla($this->como(self::GERENTE)->putJson("/api/v1/pos/cajas/{$c->id}", ['status' => 'INACTIVE']), 'RN-POS-01');
        $this->como(self::CAJERO)->getJson('/api/v1/pos/contexto')->assertOk()->assertJsonPath('turno.number', 'TUR-00003');
    }
}
