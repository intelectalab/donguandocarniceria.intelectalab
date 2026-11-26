<?php

namespace Tests\Feature\Modulos;

use App\Models\User;
use App\Support\TenantContext;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * COM · Compras y cuentas por pagar. CA-COM-01 a 06 de la spec, RN-COM-04, 06, 08, 11, 12, 13 y 14,
 * permisos por rol y aislamiento entre empresas. Fecha de las pruebas: 10/10/2026, la de los criterios.
 * Datos de demo: Avícola Los Andes (pollo en canal por kg), Camal San Pedro con la factura F001-4581,
 * almacén CAM-L1 (cámara de Lince) y la cuenta BCP-CTE.
 */
class ComTest extends TestCase
{
    private const COMPRAS = 'dflores.compras@donguando.pe';

    private const ADMIN = 'chuaman@donguando.pe';        // ADMINISTRACION: aprueba OC y paga

    private const GERENTE = 'rquispe@donguando.pe';

    private const CONTADORA = 'mcardenas@donguando.pe';

    private const CALIDAD = 'sramos@donguando.pe';       // COM solo lectura

    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo(Carbon::parse('2026-10-10 10:00', 'America/Lima'));
    }

    /* ------------------------------------------------------------ ayudas */

    private array $tokens = [];

    /** Un ingreso por usuario y prueba (el login tiene límite por minuto). */
    private function como(string $email, string $host = self::DG): static
    {
        return $this->desde($host, $this->tokens[$email] ??= $this->ingresar($host, $email));
    }

    private function usuario(string $email = self::GERENTE): User
    {
        $tenantId = DB::selectOne('SELECT auth_tenants_for_email(?) AS t', [$email])->t;
        TenantContext::set(TenantContext::find($tenantId));
        $u = User::where('email', $email)->firstOrFail();
        TenantContext::setUser($u->id);

        return $u;
    }

    private function id(string $tabla, string $col, string $valor): string
    {
        $this->usuario();

        return DB::table($tabla)->where($col, $valor)->value('id');
    }

    private function proveedor(string $ruc): string
    {
        return $this->id('suppliers', 'doc_number', $ruc);
    }

    private function variante(string $sku): string
    {
        return $this->id('product_variants', 'sku', $sku);
    }

    private function almacen(string $codigo = 'CAM-L1'): string
    {
        return $this->id('warehouses', 'code', $codigo);
    }

    /** OC de pollo en canal a Avícola Los Andes. */
    private function oc(float $kg, float $precio, bool $enviar = true, string $quien = self::COMPRAS): array
    {
        return $this->como($quien)->postJson('/api/v1/com/ordenes', [
            'supplier_id' => $this->proveedor('20602338178'), 'warehouse_id' => $this->almacen(), 'expected_date' => '2026-10-12', 'submit' => $enviar,
            'lines' => [['variant_id' => $this->variante('MP-POL-CAN'), 'qty' => $kg, 'price_basis' => 'KG', 'unit_price' => $precio]],
        ])->assertCreated()->json();
    }

    private function recibir(array $oc, float $kg, ?float $temp = 2.5, array $extra = []): \Illuminate\Testing\TestResponse
    {
        return $this->como(self::COMPRAS)->postJson('/api/v1/com/recepciones', [
            'po_id' => $oc['id'], 'vehicle_temp_c' => 3, 'lines' => [array_merge(['po_line_id' => $oc['lines'][0]['id'], 'weight_kg' => $kg, 'qty' => 0, 'temp_c' => $temp,
                'supplier_lot_code' => 'ALA-1010', 'expiry_date' => '2026-10-17'], $extra)],
        ]);
    }

    /** Factura de la OC con una línea por la recepción $rc (kg facturados × precio). */
    private function factura(array $oc, string $numero, float $base, array $extra = [], ?array $rc = null, ?float $precio = null): \Illuminate\Testing\TestResponse
    {
        $igv = round($base * 0.18, 2);
        if ($rc) {
            $l = $rc['lines'][0];
            $extra += ['receipt_id' => $rc['id'], 'lines' => [['receipt_line_id' => $l['id'], 'variant_id' => $l['variant_id'], 'qty' => (float) $l['weight_kg'],
                'unit_price' => $precio ?? round($base / (float) $l['weight_kg'], 6)]]];
        }

        return $this->como(self::COMPRAS)->postJson('/api/v1/com/comprobantes', array_merge([
            'supplier_id' => $oc['supplier_id'], 'doc_type' => 'INVOICE', 'series' => 'F001', 'number' => $numero, 'issue_date' => '2026-10-10', 'due_date' => '2026-10-25',
            'base_taxed' => $base, 'igv' => $igv, 'non_taxed' => 0, 'total' => round($base + $igv, 2), 'po_id' => $oc['id'],
        ], $extra));
    }

    /* ------------------------------------------------------------ criterios de aceptación */

    public function test_ca_com_01_oc_bajo_el_umbral_se_aprueba_sola_y_la_de_2500_espera_a_otra_persona(): void
    {
        $oc = $this->oc(120, 9.50);
        $this->assertSame('1345.20', number_format((float) $oc['total'], 2, '.', ''));
        $this->assertSame('APPROVED', $oc['status']);
        $this->assertTrue((bool) $oc['auto_approved']);

        $grande = $this->oc(222.03, 9.5435);   // ≈ S/ 2 500 con IGV
        $this->assertSame('PENDING_APPROVAL', $grande['status']);
        $this->assertEqualsWithDelta(2500, (float) $grande['total'], 0.5);
        // COMPRAS no aprueba (ni tiene el permiso, ni la creó otra persona).
        $this->como(self::COMPRAS)->postJson("/api/v1/com/ordenes/{$grande['id']}/aprobar")->assertForbidden();
        // Quien la crea no la aprueba aunque tenga el permiso.
        $propia = $this->oc(300, 9.5, true, self::GERENTE);
        $this->como(self::GERENTE)->postJson("/api/v1/com/ordenes/{$propia['id']}/aprobar")->assertStatus(422)->assertJsonPath('code', 'RN-COM-01');
        $ok = $this->como(self::ADMIN)->postJson("/api/v1/com/ordenes/{$grande['id']}/aprobar")->assertOk()->json();
        $this->assertSame('APPROVED', $ok['status']);
        $this->assertSame('Carmen Huamán Soto', $ok['approved_by_name']);
    }

    public function test_ca_com_02_recepcion_a_2_5_grados_se_acepta_y_a_7_grados_sin_decision_se_rechaza(): void
    {
        $oc = $this->oc(120, 9.50);
        $this->recibir($oc, 120, 7.0)->assertStatus(422)->assertJsonPath('code', 'RN-COM-02');
        $rc = $this->recibir($oc, 120.0, 2.5)->assertCreated()->json();
        $this->assertTrue((bool) $rc['lines'][0]['accepted']);
        $this->assertSame('QUARANTINE', $rc['lines'][0]['qc_status']);
        $this->assertSame('RECEIVED', $this->como(self::COMPRAS)->getJson("/api/v1/com/ordenes/{$oc['id']}")->json('status'));
        // A 7 °C con decisión de calidad sí entra, retenida.
        $oc2 = $this->oc(50, 9.50);
        $r2 = $this->recibir($oc2, 50, 7.0, ['decision' => 'QUALITY_HOLD'])->assertCreated()->json();
        $this->assertTrue((bool) $r2['lines'][0]['quality_hold']);
    }

    public function test_ca_com_03_la_factura_f001_4581_del_camal_no_se_registra_dos_veces(): void
    {
        $camal = $this->proveedor('20554187235');
        $r = $this->como(self::COMPRAS)->postJson('/api/v1/com/comprobantes', [
            'supplier_id' => $camal, 'doc_type' => 'INVOICE', 'series' => 'F001', 'number' => '00004581', 'issue_date' => '2026-10-10',
            'base_taxed' => 100, 'igv' => 18, 'total' => 118,
        ])->assertStatus(422)->assertJsonPath('code', 'RN-COM-05');
        $this->assertStringNotContainsString('RN-', $r->json('message'));
        $this->como(self::COMPRAS)->getJson("/api/v1/com/comprobantes/duplicado?supplier_id={$camal}&doc_type=INVOICE&series=F001&number=4581")
            ->assertOk()->assertJsonPath('duplicate', true);
    }

    public function test_ca_com_04_un_segundo_pago_que_supera_el_saldo_se_rechaza_y_el_saldo_queda_en_345_20(): void
    {
        $oc = $this->oc(120, 9.50);
        $rc = $this->recibir($oc, 120)->assertCreated()->json();
        $doc = $this->factura($oc, '7001', 1140, [], $rc)->assertCreated()->json();
        $this->assertSame('1345.20', number_format((float) $doc['total'], 2, '.', ''));
        $this->assertSame('MATCHED', $doc['match_status'], json_encode($doc['match_detail']));
        $pago = fn ($monto) => $this->como(self::ADMIN)->postJson('/api/v1/com/pagos', [
            'supplier_id' => $oc['supplier_id'], 'cash_account_id' => $this->id('cash_accounts', 'code', 'BCP-CTE'), 'method' => 'TRANSFER', 'reference' => 'OP-'.$monto,
            'allocations' => [['document_id' => $doc['id'], 'amount' => $monto]],
        ]);
        $pago(1000)->assertCreated();
        $r = $pago(400)->assertStatus(422)->assertJsonPath('code', 'RN-COM-08');
        $this->assertStringContainsString('345,20', $r->json('message'));
        $this->usuario();
        $this->assertEquals(345.20, (float) DB::table('purchase_documents')->where('id', $doc['id'])->value('balance'));
        // RN-COM-14: con pagos aplicados no se anula.
        $this->como(self::COMPRAS)->postJson("/api/v1/com/comprobantes/{$doc['id']}/anular", ['reason' => 'Error de digitación'])
            ->assertStatus(422)->assertJsonPath('code', 'RN-COM-14');
    }

    public function test_ca_com_05_factura_a_9_80_frente_a_9_50_queda_observada_y_va_a_la_bandeja(): void
    {
        $oc = $this->oc(120, 9.50);
        $rc = $this->recibir($oc, 120)->assertCreated()->json();
        $doc = $this->factura($oc, '7002', 1176, [], $rc, 9.80)->assertCreated()->json();   // 120 kg × 9,80
        $this->assertSame('OBSERVED', $doc['match_status'], json_encode($doc['match_detail']));
        $this->usuario();
        $item = DB::table('accountant_inbox_items')->where('source_id', $doc['id'])->first();
        $this->assertSame('PO_MISMATCH', $item->reason);
        $this->assertSame('PENDING', $item->status);
        $cruce = $this->como(self::COMPRAS)->getJson("/api/v1/com/cruces/{$doc['id']}")->assertOk()->json();
        $this->assertSame('OBSERVED', $cruce['status']);
        $this->assertEquals(3.16, $cruce['rows'][0]['price_diff_pct']);
        $this->assertStringContainsString('3,16', $item->notes);

        // Quien la registró no acepta la diferencia; la contadora sí y la bandeja queda resuelta.
        $this->como(self::COMPRAS)->postJson("/api/v1/com/cruces/{$doc['id']}/aprobar", ['note' => 'Precio acordado por teléfono'])->assertStatus(422);
        $ok = $this->como(self::CONTADORA)->postJson("/api/v1/com/cruces/{$doc['id']}/aprobar", ['note' => 'Alza de precio acordada'])->assertOk()->json();
        $this->assertSame('APPROVED_DIFF', $ok['match_status']);
        $this->usuario();
        $this->assertSame('APPROVED', DB::table('accountant_inbox_items')->where('id', $item->id)->value('status'));
    }

    public function test_ca_com_06_recepcion_de_120_kg_por_1140_cuesta_9_50_por_kg_y_el_lote_lo_lleva(): void
    {
        $oc = $this->oc(120, 9.50);
        $rc = $this->recibir($oc, 120)->assertCreated()->json();
        $this->assertEquals(1140.00, (float) $rc['total_cost']);
        $this->usuario();
        $lote = DB::table('lots')->where('id', $rc['lines'][0]['lot_id'])->first();
        $this->assertEquals(9.50, (float) $lote->unit_cost);
        $this->assertSame($oc['supplier_id'], $lote->supplier_id);
        $this->assertSame('ALA-1010', $rc['lines'][0]['supplier_lot_code']);
        $this->assertEquals(9.50, (float) DB::table('purchase_receipt_lines')->where('receipt_id', $rc['id'])->value('unit_cost'));
    }

    /* ------------------------------------------------------------ otras reglas */

    public function test_rn_com_04_recibir_mas_de_lo_pedido_exige_motivo_y_aprobacion(): void
    {
        $oc = $this->oc(100, 9.50);
        $this->recibir($oc, 110)->assertStatus(422)->assertJsonPath('code', 'RN-COM-04');
        // Con motivo, COMPRAS no aprueba el exceso (no tiene com.order.approve).
        $this->recibir($oc, 110, 2.5, ['over_receipt_reason' => 'El proveedor mandó una jaba más'])->assertStatus(422)->assertJsonPath('code', 'RN-COM-04');
        // Dentro de la tolerancia (5 %) pasa sin motivo.
        $this->recibir($oc, 104)->assertCreated();
    }

    public function test_rn_com_06_y_12_el_total_cuadra_y_la_nti_no_lleva_igv(): void
    {
        $oc = $this->oc(10, 9.50);
        $this->factura($oc, '7003', 95, ['total' => 120])->assertStatus(422)->assertJsonPath('code', 'RN-COM-06');
        $granja = $this->proveedor('20609147254');
        $this->como(self::COMPRAS)->postJson('/api/v1/com/comprobantes', [
            'supplier_id' => $granja, 'doc_type' => 'INTERNAL_TRANSFER', 'series' => 'NTI', 'number' => '999001', 'issue_date' => '2026-10-10',
            'base_taxed' => 100, 'igv' => 18, 'total' => 118,
        ])->assertStatus(422)->assertJsonPath('code', 'RN-COM-12');
    }

    public function test_rn_com_11_proveedor_no_habido_no_recibe_oc(): void
    {
        $this->usuario();
        DB::table('suppliers')->where('doc_number', '20602338178')->update(['sunat_status' => 'NOT_LOCATED']);
        $this->como(self::COMPRAS)->postJson('/api/v1/com/ordenes', [
            'supplier_id' => $this->proveedor('20602338178'), 'warehouse_id' => $this->almacen(), 'expected_date' => '2026-10-12',
            'lines' => [['variant_id' => $this->variante('MP-POL-CAN'), 'qty' => 10, 'unit_price' => 9.5]],
        ])->assertStatus(422)->assertJsonPath('code', 'RN-COM-11');
    }

    public function test_rn_com_13_pago_solo_a_la_cuenta_registrada_y_el_cambio_lo_aprueba_el_gerente(): void
    {
        $oc = $this->oc(10, 9.50);
        $rc = $this->recibir($oc, 10)->assertCreated()->json();
        $doc = $this->factura($oc, '7004', 95, [], $rc)->assertCreated()->json();
        $base = ['supplier_id' => $oc['supplier_id'], 'cash_account_id' => $this->id('cash_accounts', 'code', 'BCP-CTE'), 'method' => 'TRANSFER',
            'allocations' => [['document_id' => $doc['id'], 'amount' => 50]]];
        $this->como(self::ADMIN)->postJson('/api/v1/com/pagos', $base + ['paid_to_account' => '0011-9999-0000000001'])->assertStatus(422)->assertJsonPath('code', 'RN-COM-13');

        // COMPRAS pide el cambio: queda pendiente y no se paga hasta que el gerente lo apruebe.
        $s = $this->como(self::COMPRAS)->postJson("/api/v1/com/proveedores/{$oc['supplier_id']}/cuenta", ['bank_account' => '0011-0182-0100099999', 'reason' => 'Cambio de banco del proveedor'])
            ->assertOk()->json();
        $this->assertTrue((bool) ($s['pending'] ?? true));
        $this->como(self::ADMIN)->postJson('/api/v1/com/pagos', $base)->assertStatus(422)->assertJsonPath('code', 'RN-COM-13');
        $this->como(self::COMPRAS)->postJson("/api/v1/com/proveedores/{$oc['supplier_id']}/cuenta/aprobar")->assertForbidden();
        $this->como(self::GERENTE)->postJson("/api/v1/com/proveedores/{$oc['supplier_id']}/cuenta/aprobar")->assertOk()->assertJsonPath('bank_account', '0011-0182-0100099999');
        $this->como(self::ADMIN)->postJson('/api/v1/com/pagos', $base)->assertCreated()->assertJsonPath('paid_to_account', '0011-0182-0100099999');
    }

    /* ------------------------------------------------------------ permisos, pantallas y aislamiento */

    public function test_calidad_solo_lee_y_las_pantallas_responden(): void
    {
        foreach (['proveedores', 'catalogo', 'requerimientos', 'ordenes', 'recepciones', 'comprobantes', 'cruces', 'por-pagar', 'pagos', 'evaluacion', 'tablero', 'opciones'] as $p) {
            $res = $this->como(self::CALIDAD)->getJson("/api/v1/com/{$p}");
            $this->assertSame(200, $res->status(), $p.": ".mb_substr((string) $res->json("message"), 0, 400));
        }
        foreach (['01', '02', '03', '04', '06', '07', '09', '11', '12'] as $n) {
            $this->como(self::COMPRAS)->getJson("/api/v1/com/cifras/{$n}")->assertOk();
        }
        $this->como(self::CALIDAD)->postJson('/api/v1/com/ordenes', [])->assertForbidden();
        $t = $this->como(self::GERENTE)->getJson('/api/v1/com/tablero?month=2026-10')->assertOk()->json();
        $this->assertArrayHasKey('cost_per_kg', $t['kpis']);
        $this->assertCount(4, $t['aging']);
    }

    public function test_otra_empresa_no_ve_los_proveedores_ni_las_oc_de_don_guando(): void
    {
        $oc = $this->oc(10, 9.50);
        $cs = 'hsalas@carnesselectas.pe';
        $r = $this->como($cs, self::CS);
        $r->getJson("/api/v1/com/ordenes/{$oc['id']}")->assertNotFound();
        $this->assertNotContains('20602338178', array_column($this->como($cs, self::CS)->getJson('/api/v1/com/proveedores?per_page=100')->json('data') ?? [], 'doc_number'));
    }
}
