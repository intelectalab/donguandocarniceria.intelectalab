<?php

namespace Tests\Feature\Modulos;

use App\Models\User;
use App\Modulos\Web\Services\Base;
use App\Modulos\Web\Services\Stock;
use App\Support\TenantContext;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * WEB · Tienda WooCommerce y pasarela Mercado Pago: un test por criterio CA-WEB-01 a CA-WEB-05 y las reglas que los
 * rodean (RN-WEB-01 a RN-WEB-10). Todo corre contra la tienda de prueba (STAGING, conectores SANDBOX): los webhooks
 * se firman y entran por el receptor de INT, como en producción.
 */
class WebTest extends TestCase
{
    private const GERENTE = 'rquispe@donguando.pe';

    private const SUPERVISORA = 'pleon@donguando.pe';

    private const VENDEDORA = 'ana.torres@donguando.pe';

    private const ADMINISTRACION = 'chuaman@donguando.pe';

    private const MARKETING = 'lparedes@donguando.pe';

    private const CAJERO = 'jsalas@donguando.pe';

    private array $tokens = [];

    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo(Carbon::parse('2026-11-20 10:00', 'America/Lima'));
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

    private function tienda(string $code = 'STAGING'): object
    {
        $this->usuario();

        return DB::table('web_stores')->where('code', $code)->first();
    }

    /** Un pedido de ejemplo del simulador, con número propio. */
    private function ejemplo(string $plantilla = 'normal', ?string $numero = null): array
    {
        $s = $this->tienda();
        $p = $this->como(self::GERENTE)->getJson('/api/v1/web/bandeja/ejemplo?store_id='.$s->id.'&plantilla='.$plantilla)->assertOk()->json();
        if ($numero) {
            $p['id'] = (int) $numero;
            $p['number'] = $numero;
        }

        return $p;
    }

    private function enviarPedido(array $p, int $veces = 1, bool $firmaValida = true): array
    {
        return $this->como(self::GERENTE)->postJson('/api/v1/web/bandeja/simular', ['store_id' => $this->tienda()->id, 'payload' => $p, 'veces' => $veces, 'firma_valida' => $firmaValida])
            ->assertOk()->json();
    }

    private function bandeja(string $numero): ?object
    {
        $this->usuario();

        return DB::table('web_order_inbox')->where('store_id', $this->tienda()->id)->where('external_order_id', $numero)->first();
    }

    /** Stock liberado y vigente de los productos del pedido en el almacén de la tienda (los lotes de la demo vencieron en octubre). */
    private function conStock(array $p): void
    {
        $u = $this->usuario();
        $s = Base::tienda($this->tienda()->id);
        foreach ($p['line_items'] as $l) {
            $v = DB::table('web_product_mappings as m')->join('product_variants as v', 'v.id', '=', 'm.variant_id')->where('m.store_id', $s->id)
                ->where('m.sku', $l['sku'])->first(['v.id', 'v.product_id']);
            $lote = DB::table('lots')->insertGetId(['product_id' => $v->product_id, 'variant_id' => $v->id, 'code' => 'T-'.Str::random(6), 'origin' => 'PURCHASE',
                'production_date' => '2026-11-19', 'expiry_date' => '2026-12-31', 'qc_status' => 'RELEASED', 'unit_cost' => 10], 'id');
            \App\Modulos\Alm\Services\InventarioService::mover(['type' => 'RECEIPT', 'warehouse_id' => $s->warehouse_ids[0], 'variant_id' => $v->id, 'lot_id' => $lote,
                'qty' => 20, 'weight_kg' => 20, 'unit_cost' => 10, 'source_type' => 'TEST', 'reason' => 'Prueba WEB'], $u);
        }
    }

    private function pago(array $d): array
    {
        return $this->como(self::GERENTE)->postJson('/api/v1/web/pagos/simular', $d + ['store_id' => $this->tienda()->id])->assertOk()->json();
    }

    /* ------------------------------------------------------------ CA-WEB-01 */

    public function test_ca_web_01_el_mismo_webhook_tres_veces_y_el_respaldo_dejan_un_registro_y_un_pedido(): void
    {
        $p = $this->ejemplo('normal', '61001');
        $r = $this->enviarPedido($p, 3);
        $this->assertCount(3, $r['respuestas']);
        foreach ($r['respuestas'] as $x) {
            $this->assertSame(200, $x['http']);
        }
        $this->assertSame('PROCESSED', $r['inbox']['status']);
        $this->assertCount(1, $r['inbox']['pedidos']);

        // La consulta de respaldo lo encuentra en WooCommerce y devuelve el mismo registro.
        $run = $this->como(self::GERENTE)->postJson('/api/v1/web/sincronizacion', ['store_id' => $this->tienda()->id, 'kind' => 'ORDERS'])->assertCreated()->json('corrida');
        $this->assertContains('#61001', array_column($run['items'], 'sku'));

        $this->usuario();
        $this->assertSame(1, DB::table('web_order_inbox')->where('external_order_id', '61001')->count());
        $ib = $this->bandeja('61001');
        $this->assertSame(2, (int) $ib->duplicates);
        $this->assertSame(1, (int) $ib->poll_hits);
        $this->assertSame(1, DB::table('sales_orders')->where('external_ref', 'WC-61001')->count());
        $o = DB::table('sales_orders')->where('external_ref', 'WC-61001')->first();
        $this->assertSame('WEB', $o->channel);
        $this->assertSame('DRAFT', $o->status, 'RN-WEB-06: sin pago aprobado queda en borrador');
        // Los tres envíos quedaron en la bitácora de INT; WEB los muestra en WEB-07.
        $this->assertSame(3, DB::table('webhook_events')->whereRaw('webhook_events.id::text IN (SELECT jsonb_array_elements_text(?::jsonb))', [$ib->webhook_event_ids])->count());
        $ev = $this->como(self::GERENTE)->getJson('/api/v1/web/eventos?proveedor=WOOCOMMERCE&q=61001')->assertOk()->json('data');
        $this->assertCount(3, $ev);
    }

    public function test_rn_web_01_un_webhook_con_firma_invalida_no_entra_a_la_bandeja(): void
    {
        $p = $this->ejemplo('normal', '61002');
        $r = $this->enviarPedido($p, 1, false);
        $this->assertSame(401, $r['respuestas'][0]['http']);
        $this->assertNull($r['inbox']);
        $this->usuario();
        $this->assertSame(0, DB::table('sales_orders')->where('external_ref', 'WC-61002')->count());
    }

    /* ------------------------------------------------------------ CA-WEB-02 */

    public function test_ca_web_02_sku_sin_mapeo_queda_con_error_y_tras_mapear_y_reprocesar_crea_el_pedido(): void
    {
        $p = $this->ejemplo('sku', '61003');
        $r = $this->enviarPedido($p);
        $this->assertSame('ERROR', $r['inbox']['status']);
        $this->assertSame('SKU_NOT_MAPPED', $r['inbox']['error_code']);
        $this->usuario();
        $this->assertSame(0, DB::table('sales_orders')->where('external_ref', 'WC-61003')->count(), 'RN-WEB-03: nunca un producto libre');
        $ib = $this->bandeja('61003');
        $this->assertTrue(DB::table('notifications')->where('module', 'WEB')->where('role', 'SUPERVISORA_VENTAS')->where('title', 'like', '%61003%')->exists());

        // La vendedora no resuelve: lo hace la supervisora (web.inbox.resolve).
        $this->como(self::VENDEDORA)->postJson("/api/v1/web/bandeja/{$ib->id}/reprocesar")->assertForbidden();

        $s = $this->tienda();
        $this->usuario();
        $variante = DB::table('product_variants')->where('brand_id', $s->brand_id)->where('status', 'ACTIVE')->where('sellable', true)
            ->whereNotIn('id', DB::table('web_product_mappings')->where('store_id', $s->id)->whereNotNull('variant_id')->select('variant_id'))
            ->whereExists(fn ($q) => $q->from('price_list_items as i')->whereColumn('i.variant_id', 'product_variants.id')->where('i.list_id', $s->price_list_id))
            ->orderBy('sku')->value('id');
        $this->assertNotNull($variante);
        $this->como(self::MARKETING)->postJson('/api/v1/web/mapeos', ['store_id' => $s->id, 'sku' => 'DG-CUY-ENT-XL', 'variant_id' => $variante])->assertOk();
        $this->como(self::SUPERVISORA)->postJson("/api/v1/web/bandeja/{$ib->id}/reprocesar")->assertOk();

        $ib = $this->bandeja('61003');
        $this->assertSame('PROCESSED', $ib->status);
        $o = DB::table('sales_orders')->where('external_ref', 'WC-61003')->first();
        $this->assertNotNull($o);
        $this->assertTrue(DB::table('sales_order_lines')->where('sales_order_id', $o->id)->where('variant_id', $variante)->exists());
        // Reprocesar un procesado no crea otro pedido (RN-WEB-02).
        $this->como(self::SUPERVISORA)->postJson("/api/v1/web/bandeja/{$ib->id}/reprocesar")->assertStatus(422)->assertJsonPath('code', 'RN-WEB-02');
    }

    public function test_rn_web_04_tras_los_reintentos_automaticos_solo_se_reprocesa_a_mano(): void
    {
        $this->enviarPedido($this->ejemplo('sku', '61004'));
        $s = $this->tienda();
        for ($i = 0; $i < 5; $i++) {
            $this->travel(16)->minutes();
            $this->como(self::GERENTE)->postJson('/api/v1/web/sincronizacion', ['store_id' => $s->id, 'kind' => 'ORDERS'])->assertCreated();
        }
        $ib = $this->bandeja('61004');
        $this->assertSame('ERROR', $ib->status);
        $this->assertTrue((bool) $ib->manual_only);
        $this->assertSame(5, (int) $ib->auto_attempts);
    }

    /* ------------------------------------------------------------ CA-WEB-03 y CA-WEB-05 */

    public function test_ca_web_03_y_05_stock_publicado_con_margen_y_sin_lotes_vencidos(): void
    {
        $s = $this->tienda();
        $this->usuario();
        $s = Base::tienda($s->id);
        $almacen = $s->warehouse_ids[0];
        $v = DB::table('product_variants')->where('brand_id', $s->brand_id)->where('status', 'ACTIVE')->where('sale_mode', 'UNIT')
            ->whereNotIn('id', DB::table('stock_balances')->whereIn('warehouse_id', (array) $s->warehouse_ids)->select('variant_id'))->first(['id', 'product_id']);
        $u = $this->usuario();
        $lote = fn (string $vence, string $qc) => DB::table('lots')->insertGetId(['product_id' => $v->product_id, 'variant_id' => $v->id, 'code' => 'T-'.Str::random(6),
            'origin' => 'PURCHASE', 'production_date' => '2026-10-01', 'expiry_date' => $vence, 'qc_status' => $qc, 'unit_cost' => 1], 'id');
        $saldo = fn (string $l, float $q) => \App\Modulos\Alm\Services\InventarioService::mover(['type' => 'RECEIPT', 'warehouse_id' => $almacen, 'variant_id' => $v->id,
            'lot_id' => $l, 'qty' => $q, 'unit_cost' => 1, 'source_type' => 'TEST', 'reason' => 'Prueba WEB'], $u);
        $bueno = $lote('2026-12-31', 'RELEASED');
        $saldo($bueno, 10);
        // 3 reservados por un pedido confirmado (ALM).
        $o = DB::table('sales_orders')->where('establishment_id', $s->establishment_id)->where('brand_id', $s->brand_id)->first(['id', 'number', 'brand_id', 'establishment_id']);
        \App\Modulos\Alm\Services\ReservasService::reservar(['order_id' => $o->id, 'order_number' => $o->number, 'brand_id' => $o->brand_id, 'establishment_id' => $o->establishment_id,
            'delivery_date' => '2026-11-21', 'lines' => [['line_id' => DB::table('sales_order_lines')->where('sales_order_id', $o->id)->value('id'), 'variant_id' => $v->id, 'qty' => 3, 'lot_id' => $bueno]]], $u);
        $x = Stock::publicado($s, $v->id);
        $this->assertSame(7.0, $x['disponible']);
        $this->assertSame(6, $x['publicado'], 'CA-WEB-03: (10 − 3) × 0,90 = 6,3 → 6');
        $this->assertSame('7 × 0,90 = 6,30 → 6', Stock::formula($x));

        // CA-WEB-05: un lote vencido (o en cuarentena) no suma.
        $saldo($lote('2026-10-15', 'RELEASED'), 5);
        $saldo($lote('2026-12-31', 'QUARANTINE'), 4);
        $x = Stock::publicado($s, $v->id);
        $this->assertSame(6, $x['publicado']);
        $this->assertSame(9.0, $x['no_usable']);
        $this->assertCount(2, array_filter($x['lotes'], fn ($l) => ! $l['usable']));
    }

    public function test_rn_web_05_la_corrida_de_stock_envia_el_publicado_y_la_siguiente_no_repite(): void
    {
        $s = $this->tienda();
        $this->usuario();
        DB::table('web_stores')->where('id', $s->id)->update(['sync_stock' => true]);
        $run = $this->como(self::GERENTE)->postJson('/api/v1/web/sincronizacion', ['store_id' => $s->id, 'kind' => 'STOCK'])->assertCreated()->json('corrida');
        $this->assertSame('COMPLETED', $run['status']);
        $this->usuario();
        $m = DB::table('web_product_mappings')->where('store_id', $s->id)->where('status', 'LINKED')->where('publish', true)->first();
        $this->assertSame(Stock::publicado(Base::tienda($s->id), $m->variant_id)['publicado'], (int) $m->last_stock_sent);
        // Una corrida programada sin cambios no envía nada (solo la manual reenvía todo).
        $r = \App\Modulos\Web\Services\Sincronizacion::correr($s->id, 'STOCK', 'SCHEDULE');
        $this->assertSame(0, (int) $r->items_ok);
        $this->assertSame('Sin cambios que enviar', $r->detail);

        // Con WooCommerce caído la corrida falla y el mapeo no se marca con error (se reintenta).
        DB::table('integration_connectors')->where('id', $s->connector_id)->update(['simulate_down' => true]);
        $run = $this->como(self::GERENTE)->postJson('/api/v1/web/sincronizacion', ['store_id' => $s->id, 'kind' => 'STOCK'])->assertCreated()->json('corrida');
        $this->assertSame('FAILED', $run['status']);
        $this->usuario();
        $this->assertSame('LINKED', DB::table('web_product_mappings')->where('id', $m->id)->value('status'));
    }

    /* ------------------------------------------------------------ CA-WEB-04 */

    public function test_ca_web_04_solo_un_pago_aprobado_y_por_el_mismo_monto_registra_el_cobro(): void
    {
        $p = $this->ejemplo('normal', '61005');
        $total = (float) $p['total'];
        $s = $this->tienda();

        // Pendiente: no confirma ni deja cobrar (RN-WEB-06).
        $pend = $this->pago(['status' => 'pending', 'external_reference' => '61005', 'amount' => $total]);
        $this->assertSame('pending', $pend['tx']['status']);
        $this->como(self::GERENTE)->postJson("/api/v1/web/pagos/{$pend['tx']['id']}/cobro", ['amount' => $total])->assertStatus(422)->assertJsonPath('code', 'RN-WEB-06');

        // Aprobado antes de que llegue el pedido: espera al pedido.
        $ok = $this->pago(['status' => 'approved', 'external_reference' => '61005', 'amount' => $total]);
        $this->usuario();
        $this->assertNull(DB::table('gateway_transactions')->where('id', $ok['tx']['id'])->value('payment_id'));

        // Sin cuenta de pasarela activa el registro automático no puede: queda esperando.
        $cuenta = DB::table('cash_accounts')->where('account_type', 'GATEWAY')->where('status', 'ACTIVE')->pluck('id');
        DB::table('cash_accounts')->whereIn('id', $cuenta)->update(['status' => 'INACTIVE']);
        $this->enviarPedido($p);
        $this->usuario();
        $ib = $this->bandeja('61005');
        $this->assertSame('PROCESSED', $ib->status);
        $this->assertNull(DB::table('gateway_transactions')->where('id', $ok['tx']['id'])->value('payment_id'));
        DB::table('cash_accounts')->whereIn('id', $cuenta)->update(['status' => 'ACTIVE']);

        // Un cobro por otro monto se rechaza; por el mismo monto se registra y confirma.
        $this->como(self::GERENTE)->postJson("/api/v1/web/pagos/{$ok['tx']['id']}/cobro", ['amount' => $total - 10])
            ->assertStatus(422)->assertJsonPath('code', 'RN-WEB-06');
        $r = $this->como(self::GERENTE)->postJson("/api/v1/web/pagos/{$ok['tx']['id']}/cobro", ['amount' => $total])->assertOk()->json();
        $this->assertSame('CONFIRMED', $r['cobro']['status']);
        $this->usuario();
        $cobro = DB::table('payments')->where('id', $r['cobro']['id'])->first();
        $this->assertSame('WEB', $cobro->source);
        $this->assertSame($ok['tx']['id'], $cobro->gateway_transaction_id);
        $this->assertEqualsWithDelta($total, (float) $cobro->amount, 0.001);
        $o = DB::table('sales_orders')->where('external_ref', 'WC-61005')->first();
        $this->assertEqualsWithDelta(min($total, (float) $o->estimated_total), (float) $o->paid_amount, 0.01);
        // No se registra dos veces.
        $this->como(self::GERENTE)->postJson("/api/v1/web/pagos/{$ok['tx']['id']}/cobro", ['amount' => $total])->assertStatus(422);
        // El mismo aviso de pago otra vez no duplica la transacción.
        $this->pago(['status' => 'approved', 'payment_id' => $ok['payment_id']]);
        $this->usuario();
        $this->assertSame(1, DB::table('gateway_transactions')->where('external_payment_id', $ok['payment_id'])->count());
        $this->assertSame(1, DB::table('payments')->where('gateway_transaction_id', $ok['tx']['id'])->count());
    }

    public function test_rn_web_06_pago_aprobado_con_pedido_creado_se_cobra_solo_y_confirma(): void
    {
        $p = $this->ejemplo('normal', '61006');
        $this->conStock($p);
        $this->enviarPedido($p);
        $r = $this->pago(['status' => 'approved', 'external_reference' => '61006', 'amount' => (float) $p['total']]);
        $this->usuario();
        $tx = DB::table('gateway_transactions')->where('id', $r['tx']['id'])->first();
        $this->assertNotNull($tx->payment_id);
        $this->assertSame('WEB', DB::table('payments')->where('id', $tx->payment_id)->value('source'));
        $o = DB::table('sales_orders')->where('external_ref', 'WC-61006')->first();
        $this->assertSame('CONFIRMED', $o->status, 'pago aprobado y pedido completo: se confirma · '.json_encode(DB::table('web_order_inbox')->where('external_order_id', '61006')->value('history')));
        $this->assertSame('WEB', $o->confirmation_channel);
    }

    public function test_rn_web_06_un_rechazo_deja_el_pedido_en_borrador_y_avisa(): void
    {
        $p = $this->ejemplo('normal', '61007');
        $this->enviarPedido($p);
        $r = $this->pago(['status' => 'rejected', 'external_reference' => '61007', 'amount' => (float) $p['total']]);
        $this->usuario();
        $this->assertSame('DRAFT', DB::table('sales_orders')->where('external_ref', 'WC-61007')->value('status'));
        $this->assertTrue(DB::table('notifications')->where('module', 'WEB')->where('title', 'like', 'Pago web rechazado%61007%')->exists());
        $a = $this->como(self::GERENTE)->postJson("/api/v1/web/pagos/{$r['tx']['id']}/avisar")->assertOk()->json();
        $this->assertStringContainsString('wa.me/', (string) $a['enlace']);
        $this->usuario();
        $this->assertNotNull(DB::table('gateway_transactions')->where('id', $r['tx']['id'])->value('customer_notified_at'));
    }

    public function test_rn_web_09_reembolso_revierte_el_cobro_y_avisa_a_administracion(): void
    {
        $p = $this->ejemplo('normal', '61008');
        $this->enviarPedido($p);
        $r = $this->pago(['status' => 'approved', 'external_reference' => '61008', 'amount' => (float) $p['total']]);
        $this->pago(['status' => 'refunded', 'payment_id' => $r['payment_id']]);
        $this->usuario();
        $tx = DB::table('gateway_transactions')->where('id', $r['tx']['id'])->first();
        $this->assertSame('refunded', $tx->status);
        $this->assertNotNull($tx->reversed_at);
        $this->assertSame('REVERSED', DB::table('payments')->where('id', $tx->payment_id)->value('status'));
        $this->assertTrue(DB::table('notifications')->where('module', 'WEB')->where('role', 'ADMINISTRACION')->where('title', 'like', 'Reembolso%')->exists());
    }

    public function test_pagos_pendientes_vencen_a_las_48_horas(): void
    {
        $r = $this->pago(['status' => 'pending', 'external_reference' => '61009', 'amount' => 50]);
        $this->travel(49)->hours();
        $this->usuario();
        $this->assertContains($r['tx']['id'], array_column(\App\Modulos\Web\Services\Pagos::vencerPendientes(), 'id'));
        $this->assertSame('expired', DB::table('gateway_transactions')->where('id', $r['tx']['id'])->value('status'));
    }

    /* ------------------------------------------------------------ RN-WEB-07 pin */

    public function test_rn_web_07_sin_pin_queda_en_borrador_con_enlace_y_al_marcar_el_pin_confirma_si_esta_pagado(): void
    {
        $p = $this->ejemplo('nopin', '61010');
        $this->conStock($p);
        $this->enviarPedido($p);
        $ib = $this->bandeja('61010');
        $this->assertSame('PROCESSED', $ib->status);
        $this->assertSame('ADDRESS_NO_PIN', $ib->warning_code);
        $this->pago(['status' => 'approved', 'external_reference' => '61010', 'amount' => (float) $p['total']]);
        $this->usuario();
        $this->assertSame('DRAFT', DB::table('sales_orders')->where('external_ref', 'WC-61010')->value('status'), 'pagado pero sin pin: sigue en borrador');
        $local = DB::table('establishments')->where('id', $this->tienda()->establishment_id)->first(['lat', 'lng']);
        $this->como(self::VENDEDORA)->postJson("/api/v1/web/bandeja/{$ib->id}/pin", ['lat' => (float) $local->lat + 0.004, 'lng' => (float) $local->lng + 0.004])->assertOk();
        $this->usuario();
        $this->assertSame('CONFIRMED', DB::table('sales_orders')->where('external_ref', 'WC-61010')->value('status'), json_encode($this->bandeja('61010')->history));
        $this->assertNull($this->bandeja('61010')->warning_code);
    }

    /* ------------------------------------------------------------ D-WEB-01 y RN-WEB-08 */

    public function test_d_web_01_carrito_de_dos_marcas_crea_un_pedido_por_marca_y_rn_web_08_respeta_el_precio_web(): void
    {
        $this->usuario();
        $s = Base::tienda(DB::table('web_stores')->where('code', 'DGCOM')->value('id'));
        $propia = DB::table('web_product_mappings')->where('store_id', $s->id)->where('status', 'LINKED')->where('brand_id', $s->brand_id)->orderBy('sku')->first();
        $otra = DB::table('web_product_mappings')->where('store_id', $s->id)->where('status', 'LINKED')->where('brand_id', '<>', $s->brand_id)->orderBy('sku')->first();
        $lista = Base::precioWeb($s, Base::variante($propia->variant_id));
        $cli = DB::table('customers')->where('status', 'ACTIVE')->where('customer_type', 'PERSON')->whereNotNull('phone')->first(['full_name', 'phone']);
        $p = ['id' => 61020, 'number' => '61020', 'status' => 'processing', 'total' => '100.00',
            'billing' => ['first_name' => 'Rosa', 'last_name' => 'Web', 'phone' => preg_replace('/^\+51/', '', $cli->phone)],
            'shipping' => ['address_1' => 'Av. Prueba 123', 'city' => 'Santiago de Surco'],
            'payment_method' => 'cod', 'shipping_lines' => [['method_id' => 'flat_rate', 'total' => '0.00']],
            'line_items' => [
                ['sku' => $propia->sku, 'quantity' => 1, 'price' => number_format($lista['woo'] - 5, 2, '.', ''), 'total' => number_format($lista['woo'] - 5, 2, '.', '')],
                ['sku' => $otra->sku, 'quantity' => 1],
            ]];
        $r = \App\Modulos\Web\Services\Bandeja::registrar($s, $p, 'MANUAL');
        $this->assertSame('PROCESSED', $r['inbox']->status, (string) $r['inbox']->error_detail);
        $ids = Base::json($r['inbox']->order_ids);
        $this->assertCount(2, $ids);
        $os = DB::table('sales_orders')->whereIn('id', $ids)->orderBy('external_ref')->get();
        $this->assertSame(['WC-61020/1', 'WC-61020/2'], $os->pluck('external_ref')->all());
        $this->assertSame($s->brand_id, $os[0]->brand_id);
        $this->assertNotSame($os[0]->brand_id, $os[1]->brand_id);
        // RN-WEB-08: lo cobrado en la web (5 soles menos) queda como descuento «Precio web».
        $this->assertEqualsWithDelta(5.0, (float) $os[0]->order_discount, 0.01);
        $this->assertSame('Precio web', $os[0]->discount_reason);
        // El contra entrega se cobra en el reparto: el pago no es de Mercado Pago.
        $this->assertSame('CASH', DB::table('payment_methods')->where('id', $os[0]->payment_method_id)->value('code'));
    }

    public function test_las_pantallas_responden_para_cada_rol(): void
    {
        $s = $this->tienda();
        $p = $this->ejemplo('normal', '61030');
        $this->enviarPedido($p);
        $tx = $this->pago(['status' => 'approved', 'external_reference' => '61030', 'amount' => (float) $p['total']]);
        $ib = $this->bandeja('61030');
        $this->usuario();
        $m = DB::table('web_product_mappings')->where('store_id', $s->id)->first();
        $run = DB::table('web_sync_runs')->where('store_id', $s->id)->value('id') ?? $this->como(self::GERENTE)->postJson('/api/v1/web/sincronizacion', ['store_id' => $s->id, 'kind' => 'PRICES'])->json('corrida.id');
        $ev = DB::table('webhook_events')->where('owner_module', 'WEB')->where('connector_id', $s->connector_id)->value('id');
        foreach ([self::GERENTE, self::ADMINISTRACION, self::MARKETING, self::SUPERVISORA, self::VENDEDORA] as $quien) {
            foreach (['/api/v1/web/tiendas', "/api/v1/web/tiendas/{$s->id}", "/api/v1/web/mapeos?store={$s->id}", "/api/v1/web/mapeos/{$m->id}",
                '/api/v1/web/sincronizacion', "/api/v1/web/sincronizacion/{$run}", '/api/v1/web/bandeja', "/api/v1/web/bandeja/{$ib->id}",
                '/api/v1/web/pagos', "/api/v1/web/pagos/{$tx['tx']['id']}", '/api/v1/web/eventos', "/api/v1/web/eventos/{$ev}",
                "/api/v1/web/stock?store={$s->id}", "/api/v1/web/stock/{$m->id}"] as $url) {
                $this->como($quien)->getJson($url)->assertOk();
            }
        }
        $this->como(self::GERENTE)->getJson('/api/v1/web/tiendas/opciones')->assertOk();
        $this->como(self::MARKETING)->getJson("/api/v1/web/mapeos/variantes?store={$s->id}")->assertOk();
        // Filtros de cada lista.
        $this->como(self::GERENTE)->getJson('/api/v1/web/bandeja?estado=ERROR&sin_pin=1&q=61030')->assertOk();
        $this->como(self::GERENTE)->getJson('/api/v1/web/pagos?estado=PENDIENTES&conciliacion=RELEASED&desde=2026-10-01&hasta=2026-11-30&q=61030')->assertOk();
        $this->como(self::GERENTE)->getJson('/api/v1/web/sincronizacion?tipo=STOCK&estado=FAILED&origen=SCHEDULE')->assertOk();
        $this->como(self::GERENTE)->getJson('/api/v1/web/eventos?proveedor=MERCADOPAGO&estado=FAILED&dia=2026-11-20')->assertOk();
        $this->como(self::GERENTE)->getJson("/api/v1/web/stock?store={$s->id}&situacion=AGOTADO&q=cuy")->assertOk();
    }

    /* ------------------------------------------------------------ permisos y alcance */

    public function test_permisos_de_web(): void
    {
        $s = $this->tienda();
        $this->como(self::VENDEDORA)->getJson('/api/v1/web/bandeja')->assertOk();
        $this->como(self::VENDEDORA)->getJson('/api/v1/web/stock?store='.$s->id)->assertOk();
        $this->como(self::VENDEDORA)->postJson('/api/v1/web/sincronizacion', ['store_id' => $s->id, 'kind' => 'STOCK'])->assertForbidden();
        $this->como(self::VENDEDORA)->postJson('/api/v1/web/mapeos', ['store_id' => $s->id, 'sku' => 'X', 'variant_id' => (string) Str::uuid()])->assertForbidden();
        $this->como(self::MARKETING)->putJson('/api/v1/web/tiendas/'.$s->id, [])->assertForbidden();
        $this->como(self::CAJERO)->getJson('/api/v1/web/bandeja')->assertForbidden();
        // Probar y activar la tienda: administrador del sistema o gerente, con motivo.
        $this->como(self::GERENTE)->postJson("/api/v1/web/tiendas/{$s->id}/estado", ['status' => 'ACTIVE', 'reason' => 'corto'])->assertStatus(422);
        $this->como(self::GERENTE)->postJson("/api/v1/web/tiendas/{$s->id}/probar")->assertOk();
        $this->como(self::GERENTE)->postJson("/api/v1/web/tiendas/{$s->id}/estado", ['status' => 'ACTIVE', 'reason' => 'Pruebas completas en staging'])->assertOk();

        // Editar la tienda (web.store.manage): margen fuera de rango y URL sin HTTPS se rechazan.
        $this->usuario();
        $t = Base::tienda($s->id);
        $d = ['name' => $t->name, 'url' => $t->url, 'brand_id' => $t->brand_id, 'brands' => $t->brands, 'price_list_id' => $t->price_list_id,
            'establishment_id' => $t->establishment_id, 'warehouse_ids' => $t->warehouse_ids, 'safety_margin_pct' => 12, 'default_seller_id' => $t->default_seller_id,
            'sync_catalog' => true, 'sync_prices' => true, 'sync_stock' => true, 'sync_orders' => true, 'connector_id' => $t->connector_id, 'payment_connector_id' => $t->payment_connector_id];
        $this->como(self::GERENTE)->putJson("/api/v1/web/tiendas/{$s->id}", ['safety_margin_pct' => 60] + $d)->assertStatus(422);
        $this->como(self::GERENTE)->putJson("/api/v1/web/tiendas/{$s->id}", ['url' => 'http://staging.donguando.com'] + $d)->assertStatus(422)->assertJsonPath('code', 'RN-WEB-01');
        $this->como(self::GERENTE)->putJson("/api/v1/web/tiendas/{$s->id}", $d)->assertOk();
        $this->usuario();
        $this->assertEqualsWithDelta(12.0, (float) DB::table('web_stores')->where('id', $s->id)->value('safety_margin_pct'), 0.001);
        $this->assertSame('ACTIVE', DB::table('web_stores')->where('id', $s->id)->value('status'), 'mismo conector y URL: la prueba sigue valiendo');
    }

    public function test_el_programador_corre_sin_errores(): void
    {
        $this->usuario();
        $r = \App\Modulos\Web\Services\Sincronizacion::programado();
        $this->assertArrayHasKey('STAGING', $r);
        foreach ($r['STAGING'] as $x) {
            $this->assertStringNotContainsString('error', $x);
        }
    }
}
