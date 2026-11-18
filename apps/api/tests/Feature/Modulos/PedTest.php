<?php

namespace Tests\Feature\Modulos;

use App\Models\User;
use App\Modulos\Ped\Services\Estados;
use App\Support\TenantContext;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/** PED · Pedidos de todos los canales: un test por criterio CA-PED-01 a CA-PED-11 y las reglas que los rodean. */
class PedTest extends TestCase
{
    private array $tokens = [];

    private const FECHA = '2026-10-13';

    protected function setUp(): void
    {
        parent::setUp();
        // Con los lotes de demo vigentes: el 12/10 a las 6:00, para entregar el 13/10.
        $this->travelTo(Carbon::parse('2026-10-12 06:00', 'America/Lima'));
    }

    private function como(string $email): static
    {
        return $this->desde(self::DG, $this->tokens[$email] ??= $this->ingresar(self::DG, $email));
    }

    private function gerente(): static
    {
        return $this->como('rquispe@donguando.pe');
    }

    private function vendedora(): static
    {
        return $this->como('ana.torres@donguando.pe');
    }

    private function supervisora(): static
    {
        return $this->como('pleon@donguando.pe');
    }

    private function contexto(): void
    {
        $t = DB::selectOne('SELECT auth_tenants_for_email(?) AS t', ['rquispe@donguando.pe'])->t;
        TenantContext::set(TenantContext::find($t));
        TenantContext::setUser(User::where('email', 'rquispe@donguando.pe')->value('id'));
    }

    private function opciones(): array
    {
        return $this->gerente()->getJson('/api/v1/ped/opciones')->assertOk()->json();
    }

    private function marca(string $code): string
    {
        return collect($this->opciones()['marcas'])->firstWhere('code', $code)['id'];
    }

    private function variante(string $sku, string $marca = 'DG'): string
    {
        $r = $this->gerente()->getJson('/api/v1/ped/productos?brand_id='.$this->marca($marca).'&q='.$sku)->assertOk()->json();

        return collect($r)->firstWhere('sku', $sku)['id'];
    }

    private function pago(string $code = 'YAPE'): string
    {
        return collect($this->opciones()['formas_pago'])->firstWhere('code', $code)['id'];
    }

    /** Cliente nuevo con dirección en Surco B (tarifa S/ 10, gratis desde 3 unidades o 3 kg). */
    private function cliente(string $cel = '956123001'): array
    {
        $c = $this->gerente()->postJson('/api/v1/ped/clientes/rapida', ['phone' => $cel, 'full_name' => "Cliente Pedido {$cel}"])->assertSuccessful()->json('customer.id');
        $d = $this->gerente()->postJson("/api/v1/ped/clientes/{$c}/direcciones", [
            'address_line' => 'Av. Primavera 1234', 'district' => 'Santiago de Surco', 'reference' => 'Frente al parque de la Amistad', 'lat' => -12.135, 'lng' => -76.99,
        ])->assertCreated()->json();
        $this->assertSame('SURCO-B', $d['zona']['code']);

        return ['id' => $c, 'direccion' => $d['direccion']['id'], 'local' => $d['zona']['establishment_id']];
    }

    private function franja(string $local, string $desde = '09:00'): string
    {
        return collect($this->gerente()->getJson("/api/v1/ped/franjas/disponibles?establishment_id={$local}&fecha=".self::FECHA)->assertOk()->json())
            ->first(fn ($s) => $s['slot_from'] === $desde && $s['zone_id'] === null)['id'];
    }

    /** Borrador completo de delivery con N cuyes enteros. */
    private function pedido(int $cuyes = 2, array $extra = [], ?string $quien = null): array
    {
        $c = $this->cliente('9561230'.str_pad((string) random_int(10, 99), 2, '0'));
        if (($extra['fulfillment'] ?? null) === 'PICKUP') {
            $extra += ['pickup_establishment_id' => $c['local']];
        }
        $datos = $extra + [
            'brand_id' => $this->marca('DG'), 'channel' => 'WHATSAPP', 'customer_id' => $c['id'], 'fulfillment' => 'DELIVERY', 'address_id' => $c['direccion'],
            'delivery_date' => self::FECHA, 'slot_id' => $this->franja($c['local']), 'requested_doc_type' => 'RECEIPT', 'payment_method_id' => $this->pago(),
            'prep_notes_ok' => true, 'lines' => [['variant_id' => $this->variante('DG-CUY-ENT'), 'qty' => $cuyes]],
        ];

        return ($quien ? $this->como($quien) : $this->gerente())->postJson('/api/v1/ped/pedidos', $datos)->assertCreated()->json();
    }

    private function avanzar(string $id, string ...$estados): void
    {
        foreach ($estados as $e) {
            $this->gerente()->postJson("/api/v1/ped/pedidos/{$id}/estado", ['to' => $e])->assertOk();
        }
    }

    public function test_ca_ped_01_no_confirma_sin_direccion_franja_ni_forma_de_pago(): void
    {
        $c = $this->cliente('956123010');
        $r = $this->vendedora()->postJson('/api/v1/ped/pedidos', [
            'brand_id' => $this->marca('DG'), 'channel' => 'WHATSAPP', 'customer_id' => $c['id'], 'fulfillment' => 'DELIVERY', 'prep_notes_ok' => true,
            'lines' => [['variant_id' => $this->variante('DG-CUY-ENT'), 'qty' => 2]],
        ])->assertCreated();
        $id = $r->json('pedido.id');
        $this->assertSame('DRAFT', $r->json('pedido.status'));
        $this->assertStringStartsWith('P-', $r->json('pedido.number'));

        $e = $this->vendedora()->postJson("/api/v1/ped/pedidos/{$id}/confirmar")->assertUnprocessable()->assertJsonPath('code', 'RN-PED-01');
        foreach (['DIRECCION_CON_PIN', 'FRANJA', 'FORMA_DE_PAGO'] as $f) {
            $this->assertContains($f, $e->json('faltan'));
        }
        $this->assertStringContainsString('dirección con pin', $e->json('message'));
    }

    public function test_ca_ped_02_peso_dentro_de_tolerancia_da_el_total_final_y_pasa_a_listo(): void
    {
        $o = $this->pedido(2, ['fulfillment' => 'PICKUP', 'address_id' => null, 'channel' => 'PHONE']);
        $id = $o['pedido']['id'];
        $linea = $o['lineas'][0];
        $precio = (float) $linea['unit_price'];
        $this->assertEquals(1.8, (float) $linea['est_weight_kg']);
        $this->assertEquals(round(1.8 * $precio, 2), (float) $o['pedido']['estimated_total']);

        $this->gerente()->postJson("/api/v1/ped/pedidos/{$id}/confirmar")->assertOk()->assertJsonPath('pedido.status', 'CONFIRMED');
        $this->avanzar($id, 'IN_PREPARATION');
        $r = $this->gerente()->postJson("/api/v1/ped/pedidos/{$id}/pesos", ['pesos' => [['line_id' => $linea['id'], 'weighed_kg' => 1.96]]])->assertOk();
        $this->assertSame('WEIGHED', $r->json('pedido.status'));
        $this->assertSame('WITHIN_TOLERANCE', $r->json('pedido.weight_diff_status'));
        $this->assertEquals(round(1.96 * $precio, 2), (float) $r->json('pedido.final_total'));
        if ($precio === 42.0) {
            $this->assertEquals(75.60, (float) $o['pedido']['estimated_total']);
            $this->assertEquals(82.32, (float) $r->json('pedido.final_total'));
        }
        $this->avanzar($id, 'READY');
    }

    public function test_ca_ped_03_peso_fuera_de_tolerancia_exige_aviso_antes_de_listo(): void
    {
        $o = $this->pedido(2, ['fulfillment' => 'PICKUP', 'address_id' => null]);
        $id = $o['pedido']['id'];
        $this->gerente()->postJson("/api/v1/ped/pedidos/{$id}/confirmar")->assertOk();
        $this->avanzar($id, 'IN_PREPARATION');
        $r = $this->gerente()->postJson("/api/v1/ped/pedidos/{$id}/pesos", ['pesos' => [['line_id' => $o['lineas'][0]['id'], 'weighed_kg' => 2.1]]])->assertOk();
        $this->assertSame('NOTICE_REQUIRED', $r->json('pedido.weight_diff_status'));
        $this->assertEquals(16.7, $r->json('peso.lineas.0.diferencia_pct'));

        $this->gerente()->postJson("/api/v1/ped/pedidos/{$id}/estado", ['to' => 'READY'])->assertUnprocessable()->assertJsonPath('code', 'RN-PED-05');
        $this->assertNotEmpty($this->gerente()->getJson('/api/v1/ped/pesos')->assertOk()->json());
        $this->assertStringContainsString('pesó', $this->gerente()->getJson("/api/v1/ped/pesos/{$id}")->assertOk()->json('mensaje'));

        $this->gerente()->postJson("/api/v1/ped/pesos/{$id}/aviso", ['channel' => 'WHATSAPP'])->assertCreated();
        $this->avanzar($id, 'READY');
    }

    public function test_ca_ped_04_pago_de_mas_queda_como_saldo_a_favor_y_se_cierra(): void
    {
        $o = $this->pedido(2, ['fulfillment' => 'PICKUP', 'address_id' => null, 'paid_amount' => 90]);
        $id = $o['pedido']['id'];
        $this->gerente()->postJson("/api/v1/ped/pedidos/{$id}/confirmar")->assertOk();
        $this->avanzar($id, 'IN_PREPARATION');
        $r = $this->gerente()->postJson("/api/v1/ped/pedidos/{$id}/pesos", ['pesos' => [['line_id' => $o['lineas'][0]['id'], 'weighed_kg' => 1.96]]])->assertOk();
        $final = (float) $r->json('pedido.final_total');
        $this->avanzar($id, 'READY', 'DELIVERED');

        $d = $this->gerente()->getJson("/api/v1/ped/pedidos/{$id}")->assertOk();
        $this->assertSame('CUSTOMER_CREDIT', $d->json('pedido.balance_mode'));
        $this->assertEquals(round(90 - $final, 2), (float) $d->json('pedido.balance_amount'));
        $this->contexto();
        $this->assertEquals(round(90 - $final, 2), (float) DB::table('customer_balance_movements')->where('order_id', $id)->sum('amount'));
        $this->gerente()->postJson("/api/v1/ped/pedidos/{$id}/cerrar")->assertOk()->assertJsonPath('pedido.status', 'CLOSED');
    }

    public function test_ca_ped_05_descuento_sobre_el_limite_espera_a_la_supervisora(): void
    {
        $o = $this->pedido(2, ['discount' => ['pct' => 10, 'reason' => 'Cliente frecuente']], 'ana.torres@donguando.pe');
        $id = $o['pedido']['id'];
        $this->assertSame('PENDING_APPROVAL', $o['pedido']['discount_status']);
        $this->vendedora()->postJson("/api/v1/ped/pedidos/{$id}/confirmar")->assertUnprocessable()->assertJsonPath('code', 'RN-PED-11');

        $sol = collect($this->supervisora()->getJson('/api/v1/ped/descuentos')->assertOk()->json())->firstWhere('order_id', $id);
        $this->assertEquals(10, (float) $sol['requested_pct']);
        // La vendedora no tiene el permiso; la supervisora sí.
        $this->vendedora()->postJson("/api/v1/ped/descuentos/{$sol['id']}/aprobar")->assertForbidden();
        $this->supervisora()->postJson("/api/v1/ped/descuentos/{$sol['id']}/aprobar")->assertOk()->assertJsonPath('status', 'APPROVED');

        $r = $this->vendedora()->postJson("/api/v1/ped/pedidos/{$id}/confirmar")->assertOk();
        $this->assertSame('CONFIRMED', $r->json('pedido.status'));
        $this->assertEquals(round((float) $r->json('subtotal') * 0.10, 2), (float) $r->json('pedido.discount_total'));
    }

    public function test_rn_ped_11_quien_pide_no_aprueba(): void
    {
        $o = $this->pedido(4, ['discount' => ['pct' => 20, 'reason' => 'Reclamo anterior']], 'pleon@donguando.pe');
        $this->assertSame('PENDING_APPROVAL', $o['pedido']['discount_status']);
        $sol = collect($this->supervisora()->getJson('/api/v1/ped/descuentos')->json())->firstWhere('order_id', $o['pedido']['id']);
        $this->supervisora()->postJson("/api/v1/ped/descuentos/{$sol['id']}/aprobar")->assertUnprocessable()->assertJsonPath('code', 'RN-PED-11');
        $this->gerente()->postJson("/api/v1/ped/descuentos/{$sol['id']}/rechazar", ['note' => 'Muy alto'])->assertOk()->assertJsonPath('status', 'REJECTED');
    }

    public function test_ca_ped_06_no_confirma_en_una_franja_llena(): void
    {
        $o = $this->pedido(3);
        $slot = $o['pedido']['slot_id'];
        $this->contexto();
        DB::table('order_time_slots')->where('id', $slot)->update(['capacity' => 40]);
        $ocupados = DB::table('sales_orders')->where(['slot_id' => $slot, 'delivery_date' => self::FECHA])->whereIn('status', ['CONFIRMED', 'IN_PREPARATION', 'READY'])->count();
        // Llena la franja hasta 40 con copias confirmadas de otro pedido.
        $base = (array) DB::table('sales_orders')->where('id', $o['pedido']['id'])->first();
        for ($i = $ocupados; $i < 40; $i++) {
            DB::table('sales_orders')->insert(array_merge(array_diff_key($base, array_flip(['id', 'tenant_id'])), ['number' => 'T-'.str_pad((string) $i, 6, '0', STR_PAD_LEFT), 'status' => 'CONFIRMED']));
        }
        TenantContext::set(null);

        $this->vendedora()->postJson("/api/v1/ped/pedidos/{$o['pedido']['id']}/confirmar")->assertUnprocessable()->assertJsonPath('code', 'RN-PED-06');
        // La supervisora tiene ped.slot.override.
        $this->supervisora()->postJson("/api/v1/ped/pedidos/{$o['pedido']['id']}/confirmar")->assertOk();
    }

    public function test_rn_ped_06_no_confirma_pasada_la_hora_de_corte(): void
    {
        $this->travelTo(Carbon::parse(self::FECHA.' 08:00', 'America/Lima'));
        $o = $this->pedido(3);
        $this->vendedora()->postJson("/api/v1/ped/pedidos/{$o['pedido']['id']}/confirmar")->assertUnprocessable()->assertJsonPath('code', 'RN-PED-06');
    }

    public function test_ca_ped_07_delivery_gratis_con_3_cuyes_y_10_soles_con_2(): void
    {
        $this->assertEquals(0, (float) $this->pedido(3)['pedido']['delivery_fee']);
        $dos = $this->pedido(2)['pedido'];
        $this->assertEquals(10, (float) $dos['delivery_fee']);
        $this->assertNotNull($dos['zone_id']);
    }

    public function test_ca_ped_08_no_entregado_se_reprograma_y_vuelve_a_confirmado(): void
    {
        $o = $this->pedido(3);
        $id = $o['pedido']['id'];
        $this->gerente()->postJson("/api/v1/ped/pedidos/{$id}/confirmar")->assertOk();
        $this->avanzar($id, 'IN_PREPARATION');
        $this->gerente()->postJson("/api/v1/ped/pedidos/{$id}/pesos", ['pesos' => [['line_id' => $o['lineas'][0]['id'], 'weighed_kg' => 2.7]]])->assertOk();
        $this->avanzar($id, 'READY', 'IN_ROUTE');
        $antes = count($this->gerente()->getJson("/api/v1/ped/pedidos/{$id}")->json('historial'));

        $this->gerente()->postJson("/api/v1/ped/pedidos/{$id}/no-entregado", ['reason_code' => 'CLIENTE_AUSENTE'])->assertOk()->assertJsonPath('pedido.status', 'NOT_DELIVERED');
        $manana = '2026-10-14';
        $franja = collect($this->gerente()->getJson("/api/v1/ped/franjas/disponibles?establishment_id={$o['pedido']['establishment_id']}&fecha={$manana}")->json())->first()['id'];
        $r = $this->vendedora()->postJson("/api/v1/ped/pedidos/{$id}/reprogramar", ['delivery_date' => $manana, 'slot_id' => $franja, 'reason' => 'Cliente ausente, pide mañana'])->assertOk();
        $this->assertSame('CONFIRMED', $r->json('pedido.status'));
        $this->assertSame(1, $r->json('pedido.reschedule_count'));
        $this->assertCount($antes + 2, $r->json('historial'));
        $this->assertSame(['IN_ROUTE', 'NOT_DELIVERED', 'CONFIRMED'], array_slice(array_merge(...array_map(fn ($h) => [$h['to_status']], array_slice($r->json('historial'), -3))), 0, 3));
        $this->assertCount(1, $r->json('reprogramaciones'));
    }

    public function test_rn_ped_14_despues_del_maximo_reprograma_la_supervisora(): void
    {
        $o = $this->pedido(3);
        $id = $o['pedido']['id'];
        $this->gerente()->postJson("/api/v1/ped/pedidos/{$id}/confirmar")->assertOk();
        $local = $o['pedido']['establishment_id'];
        foreach (['2026-10-14', '2026-10-15'] as $f) {
            $s = collect($this->gerente()->getJson("/api/v1/ped/franjas/disponibles?establishment_id={$local}&fecha={$f}")->json())->first()['id'];
            $this->vendedora()->postJson("/api/v1/ped/pedidos/{$id}/reprogramar", ['delivery_date' => $f, 'slot_id' => $s, 'reason' => 'Lo pide el cliente'])->assertOk();
        }
        $s = collect($this->gerente()->getJson("/api/v1/ped/franjas/disponibles?establishment_id={$local}&fecha=2026-10-16")->json())->first()['id'];
        $this->vendedora()->postJson("/api/v1/ped/pedidos/{$id}/reprogramar", ['delivery_date' => '2026-10-16', 'slot_id' => $s, 'reason' => 'Otra vez'])
            ->assertUnprocessable()->assertJsonPath('code', 'RN-PED-14');
        $this->supervisora()->postJson("/api/v1/ped/pedidos/{$id}/reprogramar", ['delivery_date' => '2026-10-16', 'slot_id' => $s, 'reason' => 'Otra vez'])->assertOk();
    }

    public function test_ca_ped_09_en_preparacion_no_cambia_la_cantidad_pero_si_el_peso(): void
    {
        $o = $this->pedido(2);
        $id = $o['pedido']['id'];
        $this->gerente()->postJson("/api/v1/ped/pedidos/{$id}/confirmar")->assertOk();
        $this->avanzar($id, 'IN_PREPARATION');
        $this->gerente()->putJson("/api/v1/ped/pedidos/{$id}", ['lines' => [['variant_id' => $o['lineas'][0]['variant_id'], 'qty' => 3]]])
            ->assertUnprocessable()->assertJsonPath('code', 'RN-PED-07');
        $this->gerente()->postJson("/api/v1/ped/pedidos/{$id}/pesos", ['pesos' => [['line_id' => $o['lineas'][0]['id'], 'weighed_kg' => 1.85]]])->assertOk();
    }

    public function test_ca_ped_10_no_mezcla_productos_de_dos_marcas(): void
    {
        $c = $this->cliente('956123020');
        $gourmet = $this->gerente()->getJson('/api/v1/ped/productos?brand_id='.$this->marca('M5'))->assertOk()->json('0.id');
        $this->assertNotNull($gourmet);
        $this->gerente()->postJson('/api/v1/ped/pedidos', [
            'brand_id' => $this->marca('DG'), 'channel' => 'WHATSAPP', 'customer_id' => $c['id'], 'fulfillment' => 'DELIVERY',
            'lines' => [['variant_id' => $gourmet, 'qty' => 1]],
        ])->assertUnprocessable()->assertJsonPath('code', 'RN-PED-02');
    }

    public function test_ca_ped_11_la_base_no_deja_confirmar_con_datos_faltantes(): void
    {
        $o = $this->pedido(2, ['payment_method_id' => null]);
        $this->contexto();
        $this->expectException(\Illuminate\Database\QueryException::class);
        DB::table('sales_orders')->where('id', $o['pedido']['id'])->update(['status' => 'CONFIRMED']);
    }

    public function test_ca_ped_11_los_importados_incompletos_salen_en_su_vista(): void
    {
        $o = $this->pedido(2, ['payment_method_id' => null]);
        $this->contexto();
        DB::table('sales_orders')->where('id', $o['pedido']['id'])->update(['status' => 'CONFIRMED', 'imported' => true]);
        TenantContext::set(null);
        $ids = collect($this->gerente()->getJson('/api/v1/ped/pedidos?vista=INCOMPLETOS&per_page=100')->assertOk()->json('data'))->pluck('id');
        $this->assertContains($o['pedido']['id'], $ids);
        $kpi = $this->gerente()->getJson('/api/v1/ped/kpis?mes=2026-10')->assertOk();
        $this->assertGreaterThan(0, $kpi->json('confirmados'));
    }

    public function test_rn_ped_13_cancelar_exige_motivo_y_nota_y_libera_reservas(): void
    {
        $o = $this->pedido(2);
        $id = $o['pedido']['id'];
        $this->gerente()->postJson("/api/v1/ped/pedidos/{$id}/confirmar")->assertOk();
        $this->assertNotEmpty($this->gerente()->getJson("/api/v1/ped/pedidos/{$id}")->json('reservas'));
        // La vendedora no cancela un confirmado.
        $this->vendedora()->postJson("/api/v1/ped/pedidos/{$id}/cancelar", ['reason_code' => 'CLIENTE_DESISTIO'])->assertUnprocessable()->assertJsonPath('code', 'RN-PED-13');
        $this->gerente()->postJson("/api/v1/ped/pedidos/{$id}/cancelar", ['reason_code' => 'DUPLICADO'])->assertUnprocessable()->assertJsonPath('code', 'RN-PED-13');
        $this->gerente()->postJson("/api/v1/ped/pedidos/{$id}/cancelar", ['reason_code' => 'CLIENTE_AUSENTE'])->assertUnprocessable();
        $r = $this->gerente()->postJson("/api/v1/ped/pedidos/{$id}/cancelar", ['reason_code' => 'DUPLICADO', 'note' => 'Lo pidió dos veces por WhatsApp'])->assertOk();
        $this->assertSame('CANCELLED', $r->json('pedido.status'));
        $this->assertEmpty($r->json('reservas'));
    }

    public function test_rn_ped_03_transiciones_no_permitidas(): void
    {
        $o = $this->pedido(2);
        $id = $o['pedido']['id'];
        $this->gerente()->postJson("/api/v1/ped/pedidos/{$id}/estado", ['to' => 'READY'])->assertUnprocessable()->assertJsonPath('code', 'RN-PED-03');
        $this->gerente()->postJson("/api/v1/ped/pedidos/{$id}/confirmar")->assertOk();
        $this->gerente()->postJson("/api/v1/ped/pedidos/{$id}/borrador", ['reason' => 'Corregir la dirección'])->assertOk()->assertJsonPath('pedido.status', 'DRAFT');
        $this->gerente()->postJson("/api/v1/ped/pedidos/{$id}/confirmar")->assertOk();
        $this->assertSame(['DRAFT', 'CONFIRMED', 'DRAFT'], array_column($this->gerente()->getJson("/api/v1/ped/pedidos/{$id}")->json('historial'), 'from_status'));
    }

    public function test_rn_ped_08_provincia_exige_agencia_pago_adelantado_y_guia_para_salir(): void
    {
        $c = $this->cliente('956123030');
        $agencia = $this->opciones()['agencias'][0]['id'];
        $o = $this->gerente()->postJson('/api/v1/ped/pedidos', [
            'brand_id' => $this->marca('DG'), 'channel' => 'WHATSAPP', 'customer_id' => $c['id'], 'fulfillment' => 'PROVINCE_SHIPPING', 'address_id' => $c['direccion'],
            'delivery_date' => self::FECHA, 'payment_method_id' => $this->pago('CASH'), 'prep_notes_ok' => true,
            'lines' => [['variant_id' => $this->variante('DG-CAL-500'), 'qty' => 2]],
        ])->assertCreated()->json();
        $id = $o['pedido']['id'];
        $e = $this->gerente()->postJson("/api/v1/ped/pedidos/{$id}/confirmar")->assertUnprocessable();
        $this->assertContains('AGENCIA', $e->json('faltan'));
        $this->assertContains('PAGO_ADELANTADO', $e->json('faltan'));

        $this->gerente()->putJson("/api/v1/ped/pedidos/{$id}", ['province_agency' => $agencia, 'payment_method_id' => $this->pago('YAPE'), 'paid_amount' => 100])->assertOk();
        $this->gerente()->postJson("/api/v1/ped/pedidos/{$id}/confirmar")->assertOk();
        $this->avanzar($id, 'IN_PREPARATION', 'READY');
        $this->gerente()->postJson("/api/v1/ped/pedidos/{$id}/estado", ['to' => 'IN_ROUTE'])->assertUnprocessable()->assertJsonPath('code', 'RN-PED-08');
        $this->gerente()->putJson("/api/v1/ped/provincia/{$id}", ['tracking_number' => 'SHA-123456', 'dispatch_guide_number' => 'T001-00000045', 'thermal_packaging' => true])->assertOk();
        $this->avanzar($id, 'IN_ROUTE');
    }

    public function test_rn_ped_12_resumen_para_el_cliente_y_su_confirmacion(): void
    {
        $o = $this->pedido(2);
        $id = $o['pedido']['id'];
        $r = $this->gerente()->getJson("/api/v1/ped/pedidos/{$id}/resumen")->assertOk();
        foreach (['Don Guando', 'Cuy entero', 'Total estimado', 'peso real', 'Av. Primavera', 'Frente al parque', '09:00', 'Yape', 'boleta'] as $t) {
            $this->assertStringContainsString($t, $r->json('texto'));
        }
        $this->assertStringStartsWith('https://wa.me/51', $r->json('whatsapp'));
        $this->gerente()->postJson("/api/v1/ped/pedidos/{$id}/confirmo-cliente", ['channel' => 'WHATSAPP'])->assertOk()->assertJsonPath('pedido.confirmation_channel', 'WHATSAPP');
    }

    public function test_rn_ped_18_borrador_vencido_se_cancela_solo(): void
    {
        $o = $this->pedido(2);
        $this->travel(49)->hours();
        $this->contexto();
        $n = Estados::vencerBorradores(User::where('email', 'rquispe@donguando.pe')->first());
        $this->assertGreaterThanOrEqual(1, $n);
        $this->assertSame('BORRADOR_VENCIDO', DB::table('sales_orders')->where('id', $o['pedido']['id'])->value('cancel_reason'));
    }

    public function test_pantallas_de_lista_responden(): void
    {
        $this->pedido(2);
        foreach (['/api/v1/ped/pedidos', '/api/v1/ped/pedidos/resumen', '/api/v1/ped/franjas', '/api/v1/ped/saldos', '/api/v1/ped/provincia',
            '/api/v1/ped/catalogo', '/api/v1/ped/tablero?fecha='.self::FECHA, '/api/v1/ped/motivos?para=CANCEL', '/api/v1/ped/descuentos?status=ALL'] as $url) {
            $this->gerente()->getJson($url)->assertOk();
        }
        $this->vendedora()->getJson('/api/v1/ped/pedidos')->assertOk();
        $this->como('lparedes@donguando.pe')->postJson('/api/v1/ped/pedidos', [])->assertForbidden();
    }

    public function test_pedimos_y_editamos_franjas_motivos_y_limites(): void
    {
        $local = $this->opciones()['locales'][0]['id'];
        $f = $this->supervisora()->postJson('/api/v1/ped/franjas', ['establishment_id' => $local, 'slot_from' => '20:00', 'slot_to' => '21:30', 'cutoff' => '18:00',
            'capacity' => 10, 'weekdays' => [5, 6]])->assertCreated();
        $this->supervisora()->postJson('/api/v1/ped/franjas', ['establishment_id' => $local, 'slot_from' => '20:00', 'slot_to' => '21:00', 'cutoff' => '18:00',
            'capacity' => 10, 'weekdays' => [5]])->assertUnprocessable()->assertJsonPath('code', 'RN-PED-06');
        $this->supervisora()->putJson('/api/v1/ped/franjas/'.$f->json('id'), ['establishment_id' => $local, 'slot_from' => '20:00', 'slot_to' => '21:30', 'cutoff' => '18:00',
            'capacity' => 12, 'weekdays' => [5, 6], 'status' => 'INACTIVE'])->assertOk();
        $this->supervisora()->postJson('/api/v1/ped/motivos', ['code' => 'LLUVIA', 'name' => 'Lluvia fuerte', 'applies_to' => 'NOT_DELIVERED', 'requires_note' => false, 'counts_as_loss' => false])->assertCreated();
        $this->supervisora()->postJson('/api/v1/ped/limites', ['role' => 'CAJERO', 'brand_id' => $this->marca('DG'), 'max_pct' => 4, 'max_amount' => 15])->assertCreated();
        $this->supervisora()->postJson('/api/v1/ped/limites', ['role' => 'CAJERO', 'max_pct' => 4, 'max_amount' => 15])->assertUnprocessable();
    }
}
