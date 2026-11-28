<?php

namespace Tests\Feature\Modulos;

use App\Models\User;
use App\Modulos\Alm\Services\InventarioService;
use App\Modulos\Alm\Services\TransferenciasService;
use App\Modulos\Fac\Services\Emision;
use App\Modulos\Fac\Services\Envios;
use App\Modulos\Pos\Services\Comprobantes;
use App\Support\RuleError;
use App\Support\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/** FAC · Comprobantes electrónicos y guía de remisión: un test por criterio CA-FAC-01 a CA-FAC-08 y las reglas que los rodean. */
class FacTest extends TestCase
{
    private const GERENTE = 'rquispe@donguando.pe';

    private const ADMINISTRACION = 'chuaman@donguando.pe';

    private const CAJERO = 'jsalas@donguando.pe';

    private const SUPERVISORA = 'pleon@donguando.pe';

    private array $tokens = [];

    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo(Carbon::parse('2026-11-10 10:00', 'America/Lima'));
        Envios::$caido = false;
        Envios::$siguiente = null;
    }

    protected function tearDown(): void
    {
        Envios::$caido = false;
        Envios::$siguiente = null;
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

    private function marca(string $code = 'DG'): string
    {
        $this->usuario();

        return DB::table('brands')->where('code', $code)->value('id');
    }

    private function local(string $code = 'L1'): string
    {
        $this->usuario();

        return DB::table('establishments')->where('code', $code)->value('id');
    }

    private function variante(string $sku): object
    {
        $this->usuario();

        return DB::table('product_variants')->where('sku', $sku)->first();
    }

    private function cliente(string $tipo, ?string $numero, string $nombre): string
    {
        $this->usuario();
        if ($numero && ($id = DB::table('customers')->where('doc_number', $numero)->value('id'))) {
            return $id;
        }

        return DB::table('customers')->insertGetId(['doc_type' => $tipo, 'doc_number' => $numero, 'full_name' => $nombre,
            'customer_type' => $tipo === 'RUC' ? 'BUSINESS' : 'PERSON', 'status' => 'ACTIVE', 'fiscal_address' => $tipo === 'RUC' ? 'Av. Larco 345, Miraflores' : null], 'id');
    }

    private function restaurante(): string
    {
        return $this->cliente('RUC', '20100070970', 'RESTAURANTE EL BUEN SABOR SAC');
    }

    private function varios(): string
    {
        $this->usuario();

        return DB::table('customers')->where('full_name', 'ilike', 'clientes varios%')->value('id') ?? $this->cliente('NONE', null, 'Clientes varios');
    }

    /** Emisión directa por la API. */
    private function directa(string $tipo, string $cliente, float $total, array $extra = [], string $quien = self::GERENTE)
    {
        return $this->como($quien)->postJson('/api/v1/fac/comprobantes', $extra + [
            'doc_type' => $tipo, 'brand_id' => $this->marca(), 'establishment_id' => $this->local(), 'customer_id' => $cliente,
            'lines' => [['description' => 'Cuy entero beneficiado', 'qty' => 1, 'unit_price' => $total, 'uom_code' => 'NIU']],
        ]);
    }

    private function doc(string $id): object
    {
        $this->usuario();

        return DB::table('sales_documents')->where('id', $id)->first();
    }

    /** Pedido entregado con una línea por kg (pesada o no) y otra por unidad. */
    private function pedido(string $cliente, string $pide, float $kg, float $precioKg, ?bool $pesado = true, float $delivery = 0, string $estado = 'DELIVERED'): string
    {
        $this->usuario();
        $v = $this->variante('DG-CON-TRZ');
        $lista = DB::table('price_lists')->where('code', 'DG-PUB')->value('id');
        $importe = round($kg * $precioKg, 2);
        $id = DB::table('sales_orders')->insertGetId([
            'number' => 'P-T'.random_int(10000, 99999), 'brand_id' => $this->marca(), 'establishment_id' => $this->local(), 'channel' => 'B2B', 'fulfillment' => 'DELIVERY',
            'customer_id' => $cliente, 'billing_customer_id' => $cliente, 'requested_doc_type' => $pide, 'status' => $estado, 'delivery_date' => '2026-11-10',
            'estimated_total' => $importe + $delivery, 'final_total' => $pesado ? $importe + $delivery : null, 'delivery_fee' => $delivery, 'paid_amount' => 0,
            'discount_status' => 'NONE', 'delivered_at' => now(), 'imported' => true,
            'payment_method_id' => DB::table('payment_methods')->where('code', 'CASH')->value('id'),
        ], 'id');
        DB::table('sales_order_lines')->insert([
            'sales_order_id' => $id, 'line_no' => 1, 'variant_id' => $v->id, 'qty' => 1, 'unit_price' => $precioKg, 'list_price' => $precioKg, 'price_basis' => 'KG',
            'price_list_id' => $lista, 'est_weight_kg' => $kg, 'weighed_kg' => $pesado ? $kg : null, 'final_amount' => $pesado ? $importe : null, 'est_amount' => $importe,
        ]);

        return $id;
    }

    /* ------------------------------------------------------------ criterios */

    /** CA-FAC-01: factura de S/ 236 a un restaurante con RUC: valor de venta 200, IGV 36 y adquirente congelado. */
    public function test_ca_fac_01_factura_desde_pedido_separa_igv_y_congela_al_adquirente(): void
    {
        $cli = $this->restaurante();
        $pedido = $this->pedido($cli, 'INVOICE', 8, 29.50);

        $this->como(self::GERENTE)->getJson("/api/v1/fac/pedidos/{$pedido}")->assertOk()
            ->assertJsonPath('tipo', 'INVOICE')->assertJsonPath('series.INVOICE', 'F001')->assertJsonPath('total', 236);
        $r = $this->como(self::GERENTE)->postJson("/api/v1/fac/pedidos/{$pedido}/emitir", [])->assertCreated();
        $d = $this->doc($r->json('id'));
        $this->assertSame('INVOICE', $d->doc_type);
        $this->assertSame('F001', $d->series);
        $this->assertEqualsWithDelta(200.00, (float) $d->subtotal, 0.001);
        $this->assertEqualsWithDelta(36.00, (float) $d->igv, 0.001);
        $this->assertEqualsWithDelta(236.00, (float) $d->total, 0.001);
        $this->assertSame('ACCEPTED', $d->sunat_status);
        $this->assertSame('20100070970', $d->customer_doc_number);
        $this->assertSame('ORDER', $d->source);

        // El cliente cambia su razón social después: el comprobante no cambia.
        $this->usuario();
        DB::table('customers')->where('id', $cli)->update(['full_name' => 'OTRO NOMBRE SAC']);
        $this->assertSame('RESTAURANTE EL BUEN SABOR SAC', $this->doc($d->id)->customer_name);
        $l = DB::table('sales_document_lines')->where('sales_document_id', $d->id)->first();
        $this->assertSame('KGM', $l->uom_code);
        $this->assertEqualsWithDelta(8.0, (float) $l->qty, 0.0001);

        // Un pedido no se factura dos veces.
        $this->como(self::GERENTE)->postJson("/api/v1/fac/pedidos/{$pedido}/emitir", [])->assertStatus(422)->assertJsonPath('code', 'RN-FAC-14');
    }

    /** CA-FAC-02: boleta de S/ 850 sin documento del cliente se rechaza (RN-FAC-05); con DNI se emite. */
    public function test_ca_fac_02_boleta_sobre_el_tope_exige_documento(): void
    {
        $this->directa('RECEIPT', $this->varios(), 850)->assertStatus(422)->assertJsonPath('code', 'RN-FAC-05');
        $r = $this->directa('RECEIPT', $this->varios(), 850, ['buyer' => ['doc_type' => 'DNI', 'doc_number' => '45128833', 'name' => 'Rosa Huamán Torres']])->assertCreated();
        $d = $this->doc($r->json('id'));
        $this->assertSame('DNI', $d->customer_doc_type);
        $this->assertSame('45128833', $d->customer_doc_number);
        $this->assertSame('B001', $d->series);
        // Bajo el tope no hace falta.
        $this->directa('RECEIPT', $this->varios(), 120)->assertCreated();
    }

    /** CA-FAC-03: una boleta aceptada no cambia su total (RN-FAC-03); se corrige con nota de crédito BC01. */
    public function test_ca_fac_03_comprobante_aceptado_no_cambia_y_se_corrige_con_nota(): void
    {
        $r = $this->directa('RECEIPT', $this->cliente('DNI', '45128833', 'Rosa Huamán Torres'), 82.32)->assertCreated();
        $id = $r->json('id');
        $this->assertSame('ACCEPTED', $this->doc($id)->sunat_status);
        try {
            $this->usuario();
            DB::transaction(fn () => DB::table('sales_documents')->where('id', $id)->update(['total' => 80, 'subtotal' => 67.80, 'igv' => 12.20]));
            $this->fail('La base debía rechazar el cambio.');
        } catch (QueryException $e) {
            $this->assertStringContainsString('RN-FAC-03', $e->getMessage());
        }
        try {
            DB::transaction(fn () => DB::table('sales_document_lines')->where('sales_document_id', $id)->update(['total' => 80]));
            $this->fail('La base debía rechazar el cambio de líneas.');
        } catch (QueryException $e) {
            $this->assertStringContainsString('RN-FAC-03', $e->getMessage());
        }
        $n = $this->como(self::GERENTE)->postJson("/api/v1/fac/comprobantes/{$id}/nota-credito", [
            'reason_code' => '13', 'reason' => 'Corrección del monto cobrado', 'amount' => 2.32,
        ])->assertCreated();
        $nota = $this->doc($n->json('id'));
        $this->assertSame('CREDIT_NOTE', $nota->doc_type);
        $this->assertSame('BC01', $nota->series);
        $this->assertSame($id, $nota->related_document_id);
        $this->assertEqualsWithDelta(2.32, (float) $nota->total, 0.001);
    }

    /** CA-FAC-04: factura de 236 con nota de 200; otra nota de 50 se rechaza (RN-FAC-08). */
    public function test_ca_fac_04_notas_de_credito_no_superan_el_total(): void
    {
        $id = $this->directa('INVOICE', $this->restaurante(), 236)->assertCreated()->json('id');
        $this->como(self::GERENTE)->postJson("/api/v1/fac/comprobantes/{$id}/nota-credito", ['reason_code' => '04', 'reason' => 'Descuento acordado', 'amount' => 200])
            ->assertCreated()->assertJsonPath('series', 'FC01');
        $this->como(self::GERENTE)->postJson("/api/v1/fac/comprobantes/{$id}/nota-credito", ['reason_code' => '04', 'reason' => 'Otro descuento', 'amount' => 50])
            ->assertStatus(422)->assertJsonPath('code', 'RN-FAC-08');
        $this->como(self::GERENTE)->postJson("/api/v1/fac/comprobantes/{$id}/nota-credito", ['reason_code' => '04', 'reason' => 'Lo que queda', 'amount' => 36])->assertCreated();
        $this->como(self::GERENTE)->getJson("/api/v1/fac/comprobantes/{$id}")->assertOk()->assertJsonPath('disponible_nc', 0);
    }

    /** CA-FAC-05: con el OSE caído, 30 boletas se imprimen y quedan pendientes; se reintentan a los 1, 5 y 15 minutos y pasan a aceptadas solas. */
    public function test_ca_fac_05_ose_caido_reintenta_y_acepta_sin_intervencion(): void
    {
        Envios::$caido = true;
        $ids = [];
        for ($i = 0; $i < 30; $i++) {
            $ids[] = $this->directa('RECEIPT', $this->varios(), 10 + $i)->assertCreated()->assertJsonPath('sunat_status', 'PENDING')->json('id');
        }
        $this->usuario();
        $d = $this->doc($ids[0]);
        $this->assertSame(1, (int) $d->send_attempts);
        $this->assertSame(now()->addMinute()->format('Y-m-d H:i'), Carbon::parse($d->next_retry_at)->format('Y-m-d H:i'));

        $this->travel(1)->minutes();
        Envios::procesar();
        $d = $this->doc($ids[0]);
        $this->assertSame(2, (int) $d->send_attempts);
        $this->assertSame(now()->addMinutes(5)->format('Y-m-d H:i'), Carbon::parse($d->next_retry_at)->format('Y-m-d H:i'));

        $this->travel(5)->minutes();
        Envios::procesar();
        $d = $this->doc($ids[0]);
        $this->assertSame(3, (int) $d->send_attempts);
        $this->assertSame(now()->addMinutes(15)->format('Y-m-d H:i'), Carbon::parse($d->next_retry_at)->format('Y-m-d H:i'));

        // Vuelve el servicio: al siguiente reintento pasan todas a aceptadas sin que nadie haga nada.
        Envios::$caido = false;
        $this->travel(15)->minutes();
        $r = Envios::procesar();
        $this->assertGreaterThanOrEqual(30, $r['aceptados']);
        $this->usuario();
        $this->assertSame(30, DB::table('sales_documents')->whereIn('id', $ids)->where('sunat_status', 'ACCEPTED')->count());
        $this->assertSame(4, (int) $this->doc($ids[0])->send_attempts);
        $this->assertSame(4, DB::table('einvoice_submissions')->where('document_id', $ids[0])->count());
    }

    /** RN-FAC-06: tras fac_max_send_attempts el comprobante queda para revisión manual; el reenvío manual pide permiso. */
    public function test_rn_fac_06_agota_reintentos_y_pide_revision(): void
    {
        Envios::$caido = true;
        $id = $this->directa('RECEIPT', $this->varios(), 50)->assertCreated()->json('id');
        foreach ([1, 5, 15, 60] as $m) {
            $this->travel($m)->minutes();
            Envios::procesar();
        }
        $d = $this->doc($id);
        $this->assertSame(5, (int) $d->send_attempts);
        $this->assertTrue((bool) $d->needs_review);
        $this->assertNull($d->next_retry_at);
        $this->tokens = []; // pasó más de una hora: se vuelve a entrar
        $cola = $this->como(self::GERENTE)->getJson('/api/v1/fac/cola')->assertOk();
        $this->assertGreaterThanOrEqual(1, $cola->json('cifras.revision'));
        $this->assertTrue(collect($cola->json('comprobantes'))->contains(fn ($c) => $c['id'] === $id && $c['needs_review']));
        $this->como(self::CAJERO)->postJson("/api/v1/fac/comprobantes/{$id}/reenviar")->assertForbidden();
        Envios::$caido = false;
        $this->como(self::ADMINISTRACION)->postJson("/api/v1/fac/comprobantes/{$id}/reenviar")->assertOk()->assertJsonPath('documento.sunat_status', 'ACCEPTED');
    }

    /** CA-FAC-06: guía de una transferencia entre locales con motivo 01 se rechaza (RN-FAC-11); con 04, vehículo propio y conductor, se emite. */
    public function test_ca_fac_06_guia_de_transferencia_exige_motivo_04(): void
    {
        $u = $this->usuario();
        $v = $this->variante('DG-CHO-500');
        $cam = DB::table('warehouses')->where('code', 'CAM-L1')->value('id');
        $lote = DB::table('lots')->insertGetId(['product_id' => $v->product_id, 'variant_id' => $v->id, 'code' => 'L-CHO-T'.random_int(100, 999), 'origin' => 'PURCHASE',
            'production_date' => '2026-11-09', 'expiry_date' => '2026-11-30', 'qc_status' => 'RELEASED', 'unit_cost' => 9], 'id');
        InventarioService::mover(['type' => 'RECEIPT', 'warehouse_id' => $cam, 'variant_id' => $v->id, 'lot_id' => $lote, 'qty' => 40, 'weight_kg' => 20, 'unit_cost' => 9,
            'source_type' => 'TEST', 'reason' => 'Prueba FAC'], $u);
        $tr = TransferenciasService::crear(['from_warehouse_id' => $cam, 'to_warehouse_id' => DB::table('warehouses')->where('code', 'CAM-L2')->value('id'),
            'lines' => [['variant_id' => $v->id, 'lot_id' => $lote, 'qty' => 40, 'weight_kg' => 20]]], $u);
        $vehiculo = DB::table('vehicles')->where('plate', 'MTA-123')->value('id');
        $chofer = DB::table('employees')->where('doc_number', '40144936')->value('id');
        $datos = ['establishment_id' => $this->local('L1'), 'transfer_id' => $tr->id, 'transport_mode' => '02', 'vehicle_id' => $vehiculo, 'driver_employee_id' => $chofer,
            'driver_license' => 'Q40144936', 'gross_weight_kg' => 21, 'packages' => 2, 'lines' => [['variant_id' => $v->id, 'qty' => 40, 'weight_kg' => 20, 'lot_id' => $lote]]];

        $this->como(self::GERENTE)->postJson('/api/v1/fac/guias', $datos + ['transfer_reason_code' => '01'])->assertStatus(422)->assertJsonPath('code', 'RN-FAC-11');
        // Privado sin conductor tampoco.
        $this->como(self::GERENTE)->postJson('/api/v1/fac/guias', ['transfer_reason_code' => '04', 'driver_employee_id' => null] + $datos)->assertStatus(422)->assertJsonPath('code', 'RN-FAC-11');
        $r = $this->como(self::GERENTE)->postJson('/api/v1/fac/guias', $datos + ['transfer_reason_code' => '04'])->assertCreated();
        $this->assertSame('04', $r->json('transfer_reason_code'));
        $this->assertSame('ACCEPTED', $r->json('sunat_status'));
        $this->assertSame('T001', $r->json('series'));
        $this->usuario();
        $t = DB::table('stock_transfers')->where('id', $tr->id)->first();
        $this->assertSame($r->json('full_number'), $t->guide_number);
        $this->assertSame('04', $t->guide_reason_code);
        // Con la guía, ALM ya puede despachar la transferencia.
        TransferenciasService::despachar($tr->id, $u);
        $this->assertSame('DISPATCHED', DB::table('stock_transfers')->where('id', $tr->id)->value('status'));
    }

    /** CA-FAC-07: la serie B002 de la Marca 2 no sirve para una boleta de Don Guando (RN-FAC-02). */
    public function test_ca_fac_07_serie_de_otra_marca_se_rechaza(): void
    {
        $this->usuario();
        $b002 = DB::table('document_series')->where('series', 'B002')->value('id');
        $this->directa('RECEIPT', $this->varios(), 30, ['series_id' => $b002])->assertStatus(422)->assertJsonPath('code', 'RN-FAC-02');
        // Una serie de factura tampoco sirve para boleta.
        $this->directa('RECEIPT', $this->varios(), 30, ['series_id' => DB::table('document_series')->where('series', 'F001')->value('id')])
            ->assertStatus(422)->assertJsonPath('code', 'RN-FAC-02');
        // Una serie inactiva tampoco.
        DB::table('document_series')->where('series', 'B001')->update(['status' => 'INACTIVE']);
        $this->directa('RECEIPT', $this->varios(), 30)->assertStatus(422)->assertJsonPath('code', 'RN-FAC-02');
    }

    /** CA-FAC-08: líneas que suman 236 con cabecera de 240: el primer intento de envío se rechaza (RN-FAC-01). */
    public function test_ca_fac_08_cabecera_que_no_cuadra_no_se_envia(): void
    {
        $u = $this->usuario();
        $cli = Emision::comprador($this->restaurante());
        $serie = Emision::serie('INVOICE', $this->marca(), $this->local());
        $d = Emision::registrar(['doc_type' => 'INVOICE', 'series_id' => $serie->id, 'brand_id' => $this->marca(), 'establishment_id' => $this->local(), 'customer' => $cli],
            [['description' => 'Cuy entero', 'qty' => 2, 'uom_code' => 'NIU', 'unit_price' => 118, 'total' => 236]], $u, false);
        $this->assertSame(0, (int) $d->send_attempts);
        DB::table('sales_documents')->where('id', $d->id)->update(['subtotal' => 203.39, 'igv' => 36.61, 'total' => 240]);
        try {
            Envios::enviar($d->id);
            $this->fail('Debía rechazarse con RN-FAC-01.');
        } catch (RuleError $e) {
            $this->assertSame('RN-FAC-01', $e->rule);
        }
        $this->assertSame(0, DB::table('einvoice_submissions')->where('document_id', $d->id)->count());
        // La base tampoco acepta una cabecera cuyo valor de venta + IGV no sea el total.
        $this->expectException(QueryException::class);
        DB::table('sales_documents')->where('id', $d->id)->update(['igv' => 30]);
    }

    /* ------------------------------------------------------------ reglas */

    /** RN-FAC-04: la factura exige RUC válido. */
    public function test_rn_fac_04_factura_exige_ruc_valido(): void
    {
        $this->directa('INVOICE', $this->cliente('DNI', '45128833', 'Rosa Huamán Torres'), 100)->assertStatus(422)->assertJsonPath('code', 'RN-FAC-04');
        $this->directa('INVOICE', $this->cliente('RUC', '20100070971', 'RUC CON DIGITO MALO SAC'), 100)->assertStatus(422)->assertJsonPath('code', 'RN-FAC-04');
    }

    /** RN-FAC-13: al crédito con vencimiento; RN-FAC-17: no en un período cerrado. */
    public function test_rn_fac_13_credito_con_vencimiento_y_rn_fac_17_periodo_cerrado(): void
    {
        $r = $this->directa('INVOICE', $this->restaurante(), 500, ['payment_terms' => 'CREDIT', 'credit_days' => 30])->assertCreated();
        $this->assertSame('2026-12-10', $r->json('due_date'));
        $this->assertSame('CREDIT', $r->json('payment_terms'));
        $this->directa('INVOICE', $this->restaurante(), 500, ['payment_terms' => 'CREDIT', 'credit_days' => 0])->assertStatus(422);
        $this->directa('RECEIPT', $this->varios(), 20, ['issue_date' => '2026-08-15'])->assertStatus(422)->assertJsonPath('code', 'RN-FAC-17');
    }

    /** RN-FAC-14: el pedido se factura con su peso real, con el delivery como servicio. */
    public function test_rn_fac_14_pedido_sin_pesar_no_se_factura_y_delivery_va_como_servicio(): void
    {
        $cli = $this->cliente('DNI', '45128833', 'Rosa Huamán Torres');
        $sin = $this->pedido($cli, 'RECEIPT', 2, 32, false);
        $this->como(self::GERENTE)->postJson("/api/v1/fac/pedidos/{$sin}/emitir")->assertStatus(422)->assertJsonPath('code', 'RN-FAC-14');
        $borrador = $this->pedido($cli, 'RECEIPT', 2, 32, true, 0, 'CONFIRMED');
        $this->como(self::GERENTE)->postJson("/api/v1/fac/pedidos/{$borrador}/emitir")->assertStatus(422)->assertJsonPath('code', 'RN-FAC-14');

        $ok = $this->pedido($cli, 'RECEIPT', 1.85, 32, true, 8);
        $this->como(self::GERENTE)->getJson('/api/v1/fac/pedidos')->assertOk()->assertJsonFragment(['id' => $ok]);
        $id = $this->como(self::GERENTE)->postJson("/api/v1/fac/pedidos/{$ok}/emitir")->assertCreated()->assertJsonPath('doc_type', 'RECEIPT')->json('id');
        $this->usuario();
        $ls = DB::table('sales_document_lines')->where('sales_document_id', $id)->orderBy('line_no')->get();
        $this->assertCount(2, $ls);
        $this->assertEqualsWithDelta(59.20, (float) $ls[0]->total, 0.001);
        $this->assertSame('ZZ', $ls[1]->uom_code);
        $this->assertSame('Servicio de delivery', $ls[1]->description);
        $this->assertEqualsWithDelta(67.20, (float) $this->doc($id)->total, 0.001);
    }

    /** RN-FAC-15: el reclamo de peso se resuelve con nota de crédito 09 por la diferencia. */
    public function test_rn_fac_15_diferencia_de_peso_con_nota_09(): void
    {
        $cli = $this->restaurante();
        $id = $this->como(self::GERENTE)->postJson('/api/v1/fac/pedidos/'.$this->pedido($cli, 'INVOICE', 8, 29.50).'/emitir')->assertCreated()->json('id');
        $this->usuario();
        $linea = DB::table('sales_document_lines')->where('sales_document_id', $id)->value('id');
        $this->como(self::GERENTE)->postJson("/api/v1/fac/comprobantes/{$id}/nota-peso", ['claims' => [['line_id' => $linea, 'real_kg' => 8.5]]])
            ->assertStatus(422)->assertJsonPath('code', 'RN-FAC-15');
        $n = $this->como(self::GERENTE)->postJson("/api/v1/fac/comprobantes/{$id}/nota-peso", ['claims' => [['line_id' => $linea, 'real_kg' => 7.6]], 'reason' => 'El cliente pesó 7,6 kg'])
            ->assertCreated();
        $this->assertSame('09', $n->json('note_reason_code'));
        $this->assertEqualsWithDelta(11.80, (float) $n->json('total'), 0.001);
        $this->assertSame('FC01', $n->json('series'));
    }

    /** RN-FAC-07: nota con motivo SUNAT, del mismo cliente, contra factura o boleta vigente; nota de débito. */
    public function test_rn_fac_07_notas_con_motivo_y_mismo_cliente(): void
    {
        $id = $this->directa('INVOICE', $this->restaurante(), 236)->assertCreated()->json('id');
        $this->como(self::GERENTE)->postJson("/api/v1/fac/comprobantes/{$id}/nota-credito", ['reason_code' => '99', 'reason' => 'Motivo inventado', 'amount' => 10])
            ->assertStatus(422)->assertJsonPath('code', 'RN-FAC-07');
        $this->como(self::GERENTE)->postJson("/api/v1/fac/comprobantes/{$id}/nota-credito", ['reason_code' => '04', 'reason' => 'Descuento', 'amount' => 10, 'customer_id' => $this->varios()])
            ->assertStatus(422)->assertJsonPath('code', 'RN-FAC-07');
        $nd = $this->como(self::GERENTE)->postJson("/api/v1/fac/comprobantes/{$id}/nota-debito", ['reason_code' => '01', 'reason' => 'Intereses por pago fuera de plazo', 'amount' => 11.80])
            ->assertCreated();
        $this->assertSame('FD01', $nd->json('series'));
        $this->assertSame('DEBIT_NOTE', $nd->json('doc_type'));
        $this->assertEqualsWithDelta(10.0, (float) $nd->json('subtotal'), 0.001);
        // Una nota no se hace contra otra nota.
        $this->como(self::GERENTE)->postJson('/api/v1/fac/comprobantes/'.$nd->json('id').'/nota-credito', ['reason_code' => '01', 'reason' => 'Anular la nota', 'amount' => 1])
            ->assertStatus(422)->assertJsonPath('code', 'RN-FAC-07');
        // La supervisora emite notas; la cajera no.
        $this->como(self::CAJERO)->postJson("/api/v1/fac/comprobantes/{$id}/nota-credito", ['reason_code' => '04', 'reason' => 'Descuento', 'amount' => 1])->assertForbidden();
        $this->como(self::SUPERVISORA)->postJson("/api/v1/fac/comprobantes/{$id}/nota-credito", ['reason_code' => '04', 'reason' => 'Descuento', 'amount' => 1])->assertCreated();
    }

    /** Devolución por ítem: la nota de crédito reingresa el producto al almacén de devoluciones, del mismo lote. */
    public function test_nota_de_devolucion_reingresa_el_stock(): void
    {
        $u = $this->usuario();
        $v = $this->variante('DG-CAL-1L');
        $mos = DB::table('warehouses')->where('code', 'MOS-L1')->value('id');
        $dev = DB::table('warehouses')->where('code', 'DEV-L1')->value('id');
        $lote = DB::table('lots')->insertGetId(['product_id' => $v->product_id, 'variant_id' => $v->id, 'code' => 'L-CAL-T'.random_int(100, 999), 'origin' => 'PURCHASE',
            'production_date' => '2026-11-09', 'expiry_date' => '2026-11-30', 'qc_status' => 'RELEASED', 'unit_cost' => 7], 'id');
        InventarioService::mover(['type' => 'RECEIPT', 'warehouse_id' => $mos, 'variant_id' => $v->id, 'lot_id' => $lote, 'qty' => 5, 'unit_cost' => 7,
            'source_type' => 'TEST', 'reason' => 'Prueba FAC'], $u);
        $pedido = $this->pedido($this->cliente('DNI', '45128833', 'Rosa Huamán Torres'), 'RECEIPT', 1, 30);
        DB::table('sales_order_lines')->where('sales_order_id', $pedido)->delete();
        DB::table('sales_order_lines')->insert(['sales_order_id' => $pedido, 'line_no' => 1, 'variant_id' => $v->id, 'qty' => 3, 'unit_price' => 18, 'list_price' => 18,
            'price_basis' => 'UNIT', 'price_list_id' => DB::table('price_lists')->where('code', 'DG-PUB')->value('id'), 'est_amount' => 54, 'final_amount' => 54, 'lot_id' => $lote]);
        DB::table('sales_orders')->where('id', $pedido)->update(['estimated_total' => 54, 'final_total' => 54]);
        InventarioService::mover(['type' => 'SALE', 'warehouse_id' => $mos, 'variant_id' => $v->id, 'lot_id' => $lote, 'qty' => 3, 'source_type' => 'SALES_ORDER',
            'source_id' => $pedido, 'reason' => 'Entrega de prueba'], $u);
        $id = $this->como(self::GERENTE)->postJson("/api/v1/fac/pedidos/{$pedido}/emitir")->assertCreated()->assertJsonPath('total', '54.00')->json('id');
        $this->usuario();
        $linea = DB::table('sales_document_lines')->where('sales_document_id', $id)->first();
        $this->como(self::GERENTE)->postJson("/api/v1/fac/comprobantes/{$id}/nota-credito", ['reason_code' => '07', 'reason' => 'El cliente devolvió un caldo',
            'lines' => [['line_id' => $linea->id, 'qty' => 1]], 'restock' => true])->assertCreated()->assertJsonPath('total', '18.00')->assertJsonPath('restocked_warehouse_id', $dev);
        $this->usuario();
        $this->assertEqualsWithDelta(1.0, (float) DB::table('stock_balances')->where('warehouse_id', $dev)->where('variant_id', $v->id)->where('lot_id', $lote)->sum('qty'), 0.001);
        // Lo acreditado por línea queda con la forma de POS-09 ({qty, amount}): el mostrador no devuelve dos veces.
        $doc = DB::table('sales_documents')->where('id', $id)->first();
        $this->assertSame(['qty' => 1, 'amount' => 18], json_decode($doc->returned, true)[$linea->id]);
        $this->assertEqualsWithDelta(1.0, (float) Comprobantes::devuelto($doc)[$linea->id]['qty'], 0.001);
        // No se acredita más de lo vendido por línea.
        $this->como(self::GERENTE)->postJson("/api/v1/fac/comprobantes/{$id}/nota-credito", ['reason_code' => '07', 'reason' => 'Devolución de más',
            'lines' => [['line_id' => $linea->id, 'qty' => 3]]])->assertStatus(422)->assertJsonPath('code', 'RN-FAC-08');
        // Un comprobante directo no sabe de qué lote salió: el reingreso se rechaza con el motivo.
        $directo = $this->directa('RECEIPT', $this->varios(), 0, ['lines' => [['variant_id' => $v->id, 'qty' => 2, 'unit_price' => 18]]])->assertCreated()->json('id');
        $this->usuario();
        $l2 = DB::table('sales_document_lines')->where('sales_document_id', $directo)->value('id');
        $this->como(self::GERENTE)->postJson("/api/v1/fac/comprobantes/{$directo}/nota-credito", ['reason_code' => '07', 'reason' => 'Devolución', 'lines' => [['line_id' => $l2, 'qty' => 1]], 'restock' => true])
            ->assertStatus(422)->assertJsonPath('code', 'RN-ALM-08');
        $this->como(self::GERENTE)->postJson("/api/v1/fac/comprobantes/{$directo}/nota-credito", ['reason_code' => '07', 'reason' => 'Devolución', 'lines' => [['line_id' => $l2, 'qty' => 1]]])
            ->assertCreated();
    }

    /** RN-FAC-09 y RN-FAC-10: anular exige motivo, va a la comunicación de baja y no se reactiva. */
    public function test_rn_fac_10_anular_va_a_la_baja_y_no_se_reactiva(): void
    {
        $id = $this->directa('INVOICE', $this->restaurante(), 236)->assertCreated()->json('id');
        $this->como(self::CAJERO)->postJson("/api/v1/fac/comprobantes/{$id}/anular", ['reason' => 'Error en la operación'])->assertForbidden();
        $this->como(self::ADMINISTRACION)->postJson("/api/v1/fac/comprobantes/{$id}/anular", ['reason' => ''])->assertStatus(422);
        $r = $this->como(self::ADMINISTRACION)->postJson("/api/v1/fac/comprobantes/{$id}/anular", ['reason' => 'El cliente canceló la compra'])->assertOk();
        $this->assertSame('VOIDED', $r->json('documento.status'));
        $this->assertSame('ACCEPTED', $r->json('documento.sunat_status'));
        $s = $r->json('resumen.id');
        $this->assertStringStartsWith('RA-20261110-', $r->json('resumen.identifier'));
        $this->como(self::ADMINISTRACION)->postJson("/api/v1/fac/comprobantes/{$id}/anular", ['reason' => 'Otra vez'])->assertStatus(422)->assertJsonPath('code', 'RN-FAC-10');
        $this->como(self::ADMINISTRACION)->postJson("/api/v1/fac/resumenes/{$s}/enviar")->assertOk()->assertJsonPath('status', 'SENT');
        $this->como(self::ADMINISTRACION)->postJson("/api/v1/fac/resumenes/{$s}/consultar")->assertOk()->assertJsonPath('status', 'ACCEPTED');
        $this->assertSame('VOIDED', $this->doc($id)->sunat_status);
        try {
            $this->usuario();
            DB::transaction(fn () => DB::table('sales_documents')->where('id', $id)->update(['status' => 'ISSUED']));
            $this->fail('Un anulado no se reactiva.');
        } catch (QueryException $e) {
            $this->assertStringContainsString('RN-FAC-10', $e->getMessage());
        }
        // Con una nota vigente no se anula: se corrige con nota.
        $id2 = $this->directa('INVOICE', $this->restaurante(), 100)->assertCreated()->json('id');
        $this->como(self::GERENTE)->postJson("/api/v1/fac/comprobantes/{$id2}/nota-credito", ['reason_code' => '04', 'reason' => 'Descuento', 'amount' => 10])->assertCreated();
        $this->como(self::GERENTE)->postJson("/api/v1/fac/comprobantes/{$id2}/anular", ['reason' => 'Ya no va'])->assertStatus(422)->assertJsonPath('code', 'RN-FAC-10');
    }

    /** RN-FAC-09: con resumen diario, las boletas no se envían una por una: van en el RC del día. */
    public function test_rn_fac_09_boletas_por_resumen_diario(): void
    {
        $this->usuario();
        DB::table('parameters')->insert(['key' => 'fac_receipt_summary_mode', 'scope' => 'TENANT', 'value' => 'SUMMARY', 'reason' => 'Prueba', 'description' => 'Prueba']);
        $a = $this->directa('RECEIPT', $this->varios(), 20)->assertCreated()->assertJsonPath('summary_pending', true)->assertJsonPath('send_attempts', '0.00')->json('id');
        $this->directa('RECEIPT', $this->varios(), 30)->assertCreated();
        Envios::procesar();
        $this->assertSame('PENDING', $this->doc($a)->sunat_status);
        $s = $this->como(self::GERENTE)->postJson('/api/v1/fac/resumenes', ['date' => '2026-11-10'])->assertCreated()->json('id');
        $this->como(self::GERENTE)->getJson("/api/v1/fac/resumenes/{$s}")->assertOk()->assertJsonCount(2, 'documentos');
        $this->como(self::GERENTE)->postJson("/api/v1/fac/resumenes/{$s}/enviar")->assertOk();
        Envios::procesar(); // la cola consulta el ticket
        $this->assertSame('ACCEPTED', $this->doc($a)->sunat_status);
        $this->como(self::GERENTE)->postJson('/api/v1/fac/resumenes', ['date' => '2026-11-10'])->assertStatus(422)->assertJsonPath('code', 'RN-FAC-09');
    }

    /** Un comprobante rechazado por SUNAT se reemite con un número nuevo. */
    public function test_rechazado_se_reemite_con_numero_nuevo(): void
    {
        Envios::$siguiente = 'REJECTED';
        $r = $this->directa('RECEIPT', $this->varios(), 40)->assertCreated()->assertJsonPath('sunat_status', 'REJECTED');
        $id = $r->json('id');
        $this->como(self::GERENTE)->postJson("/api/v1/fac/comprobantes/{$id}/nota-credito", ['reason_code' => '01', 'reason' => 'Anulación', 'amount' => 40])
            ->assertStatus(422)->assertJsonPath('code', 'RN-FAC-07');
        $n = $this->como(self::GERENTE)->postJson("/api/v1/fac/comprobantes/{$id}/reemitir")->assertCreated();
        $this->assertNotSame($r->json('full_number'), $n->json('full_number'));
        $this->assertSame('ACCEPTED', $n->json('sunat_status'));
        $this->assertSame($n->json('id'), $this->doc($id)->reissued_by);
        $this->como(self::GERENTE)->postJson("/api/v1/fac/comprobantes/{$id}/reemitir")->assertStatus(422)->assertJsonPath('code', 'RN-FAC-03');
    }

    /** RN-FAC-12: la guía usa una serie T de su local; RN-FAC-11: público con transportista; venta enlazada al pedido. */
    public function test_rn_fac_12_guia_de_venta_con_transportista(): void
    {
        $this->usuario();
        $pedido = $this->pedido($this->restaurante(), 'INVOICE', 5, 30);
        $base = $this->como(self::GERENTE)->getJson("/api/v1/fac/guias/pedido/{$pedido}")->assertOk()->json();
        $carrier = DB::table('suppliers')->where('supplier_type', 'DELIVERY_COMPANY')->where('doc_type', 'RUC')->value('id');
        $t002 = DB::table('document_series')->where('series', 'T002')->first();
        $datos = ['establishment_id' => $this->local('L1'), 'transfer_reason_code' => '01', 'transport_mode' => '01', 'order_id' => $pedido,
            'recipient_customer_id' => $base['recipient_customer_id'], 'dest_address' => 'Av. Larco 345, Miraflores', 'dest_ubigeo' => '150122',
            'gross_weight_kg' => 6, 'packages' => 1, 'lines' => $base['lines']];
        $this->como(self::GERENTE)->postJson('/api/v1/fac/guias', $datos)->assertStatus(422)->assertJsonPath('code', 'RN-FAC-11');
        if ($t002->establishment_id && $t002->establishment_id !== $this->local('L1')) {
            $this->como(self::GERENTE)->postJson('/api/v1/fac/guias', $datos + ['carrier_supplier_id' => $carrier, 'series_id' => $t002->id])->assertStatus(422)->assertJsonPath('code', 'RN-FAC-12');
        }
        $this->como(self::GERENTE)->postJson('/api/v1/fac/guias', $datos + ['carrier_supplier_id' => $carrier, 'start_date' => '2026-11-09'])->assertStatus(422)->assertJsonPath('code', 'RN-FAC-11');
        $g = $this->como(self::GERENTE)->postJson('/api/v1/fac/guias', $datos + ['carrier_supplier_id' => $carrier])->assertCreated();
        $this->assertSame($g->json('full_number'), DB::table('sales_orders')->where('id', $pedido)->value('dispatch_guide_number'));
        $this->como(self::GERENTE)->getJson('/api/v1/fac/guias/'.$g->json('id'))->assertOk()->assertJsonPath('motivo', 'Venta');
        // El motivo 13 está habilitado pero un motivo fuera de la lista no.
        $this->como(self::GERENTE)->postJson('/api/v1/fac/guias', ['transfer_reason_code' => '17', 'carrier_supplier_id' => $carrier] + $datos)->assertStatus(422)->assertJsonPath('code', 'RN-FAC-11');
    }

    /** POS emite con el emisor de FAC: su comprobante sale en FAC-01 y en la cola si el OSE cae. */
    public function test_pos_y_fac_comparten_emisor(): void
    {
        Envios::$caido = true;
        $id = $this->directa('RECEIPT', $this->varios(), 15)->assertCreated()->json('id');
        $this->como(self::GERENTE)->getJson('/api/v1/fac/cola')->assertOk()->assertJsonFragment(['id' => $id]);
        $this->como(self::GERENTE)->getJson('/api/v1/fac/comprobantes?sunat_status=PENDING')->assertOk()->assertJsonFragment(['id' => $id]);
        $this->assertTrue(method_exists(Comprobantes::class, 'emitir'));
    }

    /** FAC-10: series con el formato SUNAT; solo quien tiene fac.series.manage las crea. */
    public function test_fac_10_series(): void
    {
        $this->usuario();
        $empresa = DB::table('companies')->orderBy('created_at')->value('id');
        $this->como(self::CAJERO)->postJson('/api/v1/fac/series', ['company_id' => $empresa, 'doc_type' => 'RECEIPT', 'series' => 'B011', 'next_number' => 1])->assertForbidden();
        $this->como(self::GERENTE)->postJson('/api/v1/fac/series', ['company_id' => $empresa, 'doc_type' => 'RECEIPT', 'series' => 'X011', 'next_number' => 1])->assertStatus(422);
        $s = $this->como(self::GERENTE)->postJson('/api/v1/fac/series', ['company_id' => $empresa, 'doc_type' => 'RECEIPT', 'series' => 'B011', 'next_number' => 1,
            'brand_id' => $this->marca(), 'establishment_id' => $this->local()])->assertCreated();
        $this->como(self::GERENTE)->putJson('/api/v1/fac/series/'.$s->json('id').'/estado', ['status' => 'INACTIVE', 'reason' => 'Serie de prueba sin uso'])->assertOk()->assertJsonPath('status', 'INACTIVE');
        $this->como(self::GERENTE)->getJson('/api/v1/fac/series')->assertOk()->assertJsonFragment(['series' => 'B011']);
    }

    /** FAC-11: el pie legal menciona la empresa y su RUC (RN-FAC-16). */
    public function test_fac_11_plantilla_exige_ruc_en_el_pie(): void
    {
        $m = $this->marca();
        $this->como(self::GERENTE)->putJson("/api/v1/fac/plantillas/{$m}", ['legal_footer' => 'Gracias por su compra', 'print_show_logo' => true])->assertStatus(422)->assertJsonPath('code', 'RN-FAC-16');
        $this->como(self::GERENTE)->putJson("/api/v1/fac/plantillas/{$m}", ['legal_footer' => 'Emitido por AGROPECUARIA DON GUANDO SAC · RUC 20601234567', 'print_legends' => 'Bienes transferidos en la Amazonía', 'print_show_logo' => false])
            ->assertOk()->assertJsonPath('mostrar_logo', false);
        $this->como(self::CAJERO)->putJson("/api/v1/fac/plantillas/{$m}", ['legal_footer' => 'RUC 20601234567'])->assertForbidden();
    }

    /** Las pantallas de FAC responden para el gerente, la contadora y la cajera. */
    public function test_pantallas_responden(): void
    {
        $id = $this->directa('INVOICE', $this->restaurante(), 236)->assertCreated()->json('id');
        foreach ([self::GERENTE, 'mcardenas@donguando.pe', self::CAJERO] as $quien) {
            foreach (['/api/v1/fac/comprobantes', '/api/v1/fac/comprobantes/resumen', "/api/v1/fac/comprobantes/{$id}", "/api/v1/fac/comprobantes/{$id}/notas",
                '/api/v1/fac/pedidos', '/api/v1/fac/emision/opciones', '/api/v1/fac/emision/productos?brand='.$this->marca().'&q=cuy', '/api/v1/fac/emision/clientes?q=rest',
                '/api/v1/fac/cola', '/api/v1/fac/resumenes', '/api/v1/fac/guias', '/api/v1/fac/guias/opciones', '/api/v1/fac/series', '/api/v1/fac/plantillas',
                '/api/v1/fac/periodo?month=2026-10', '/api/v1/fac/periodo?month=2026-11'] as $url) {
                $this->como($quien)->getJson($url)->assertOk();
            }
        }
        $x = $this->como(self::GERENTE)->get("/api/v1/fac/comprobantes/{$id}/xml")->assertOk();
        $this->assertStringContainsString('<cbc:ID>F001-', $x->getContent());
        $this->assertStringContainsString('36.00', $x->getContent());
        $this->como(self::GERENTE)->get("/api/v1/fac/comprobantes/{$id}/cdr")->assertOk();
        $this->como(self::GERENTE)->get('/api/v1/fac/comprobantes/exportar')->assertOk();
        $this->como(self::GERENTE)->get('/api/v1/fac/periodo/exportar?month=2026-10')->assertOk();
        // La vendedora (solo lectura) no emite.
        $this->directa('RECEIPT', $this->varios(), 10, [], 'ana.torres@donguando.pe')->assertForbidden();
    }
}
