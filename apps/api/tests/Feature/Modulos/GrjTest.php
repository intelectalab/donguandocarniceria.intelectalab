<?php

namespace Tests\Feature\Modulos;

use App\Models\User;
use App\Modulos\Grj\Services\GranjaService;
use App\Support\TenantContext;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * GRJ · Integración con la granja. CA-GRJ-01 a 05 de la spec, RN-GRJ-05, 09 y 10, permisos y aislamiento.
 * Fecha de las pruebas: 10/10/2026. Datos de demo: vínculo NTI vigente desde el 01/01/2026 con la Granja Don Guando
 * (mismo RUC 20609147254 de la empresa) y el ítem GR-CUY-CAN (cuy en canal) mapeado a S/ 24,00 por kg.
 */
class GrjTest extends TestCase
{
    private const COMPRAS = 'dflores.compras@donguando.pe';   // recibe envíos y mapea

    private const GERENTE = 'rquispe@donguando.pe';           // vínculos y cambio a factura

    private const CONTADORA = 'mcardenas@donguando.pe';       // GRJ en lectura y cierre de la conciliación

    private array $tokens = [];

    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo(Carbon::parse('2026-10-10 10:00', 'America/Lima'));
    }

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

    private function envio(string $numero = 'NI01-000245', float $kg = 300, array $extra = []): array
    {
        return array_merge(['farm_tenant' => 'granja-donguando', 'document_type' => 'NTI', 'document_number' => $numero, 'dispatched_at' => '2026-10-10 06:30', 'source' => 'WEBHOOK',
            'lines' => [['item_code' => 'GR-CUY-CAN', 'item_name' => 'Cuy en canal', 'lot_code' => 'GDG-G01-L2640', 'qty' => 400, 'weight_kg' => $kg, 'unit_price' => 24,
                'origin' => ['granja' => 'Granja Don Guando · Pachacámac', 'galpon' => 'Galpón 1', 'fecha_beneficio' => '2026-10-09']]]], $extra);
    }

    public function test_ca_grj_01_la_nti_de_300_kg_de_cuy_crea_un_comprobante_interno_de_7200_sin_igv(): void
    {
        $r = $this->como(self::COMPRAS)->postJson('/api/v1/grj/envios', $this->envio())->assertCreated()->json();
        $this->assertFalse($r['duplicate']);
        $d = $r['dispatch'];
        $this->assertSame('RECEIVED_PENDING', $d['status']);
        $this->assertSame('NTI', $d['expected_doc_type']);
        $this->usuario();
        $doc = DB::table('purchase_documents')->find($d['purchase_document_id']);
        $this->assertSame('INTERNAL_TRANSFER', $doc->doc_type);
        $this->assertEquals(7200.00, (float) $doc->total);
        $this->assertEquals(0.00, (float) $doc->igv);
        $this->assertSame('245', $doc->number);
    }

    public function test_ca_grj_02_dentro_de_la_tolerancia_se_acepta_y_fuera_exige_motivo_y_queda_en_disputa(): void
    {
        $a = $this->como(self::COMPRAS)->postJson('/api/v1/grj/envios', $this->envio())->json('dispatch');
        $linea = $a['lines'][0]['id'];
        $ok = $this->como(self::COMPRAS)->postJson("/api/v1/grj/envios/{$a['id']}/recibir", ['lines' => [['id' => $linea, 'received_weight_kg' => 297.5, 'temp_c' => 2.0]]])
            ->assertOk()->json();
        $this->assertSame('RECEIVED', $ok['status']);
        $this->assertEquals(-0.833, (float) $ok['lines'][0]['difference_pct']);
        // RN-GRJ-06: el lote local lleva el origen y el lote de la granja.
        $this->usuario();
        $lote = DB::table('lots')->where('id', $ok['lines'][0]['lot_id'])->first();
        $this->assertSame('FARM', $lote->origin);
        $this->assertSame('GDG-G01-L2640', $lote->farm_lot_code);
        $this->assertStringContainsString('Galpón 1', $lote->farm_origin);
        $this->assertSame('FARM_NTI', DB::table('purchase_receipts')->where('id', $ok['purchase_receipt_id'])->value('receipt_type'));

        $b = $this->como(self::COMPRAS)->postJson('/api/v1/grj/envios', $this->envio('NI01-000246'))->json('dispatch');
        $sinMotivo = $this->como(self::COMPRAS)->postJson("/api/v1/grj/envios/{$b['id']}/recibir", ['lines' => [['id' => $b['lines'][0]['id'], 'received_weight_kg' => 295, 'temp_c' => 2.0]]])
            ->assertStatus(422)->assertJsonPath('code', 'RN-GRJ-07');
        $this->assertStringContainsString('1,67', $sinMotivo->json('message'));
        $disp = $this->como(self::COMPRAS)->postJson("/api/v1/grj/envios/{$b['id']}/recibir", ['lines' => [['id' => $b['lines'][0]['id'], 'received_weight_kg' => 295, 'temp_c' => 2.0,
            'reason' => 'Merma por deshidratación en el traslado']]])->assertOk()->json();
        $this->assertSame('DISPUTED', $disp['status']);

        // RN-GRJ-09: con la disputa abierta el mes no se acuerda; con el acuerdo, sí.
        $this->como(self::CONTADORA)->postJson('/api/v1/grj/conciliacion/acordar', ['month' => '2026-10', 'note' => 'Conciliación de octubre'])->assertStatus(422)->assertJsonPath('code', 'RN-GRJ-09');
        $this->como(self::CONTADORA)->postJson("/api/v1/grj/envios/{$b['id']}/acuerdo", ['decision' => 'ACCEPT_RECEIVED', 'note' => 'La granja reconoce la merma'])->assertOk()
            ->assertJsonPath('status', 'RECEIVED');
    }

    public function test_ca_grj_03_el_documento_esperado_lo_decide_la_fecha_y_los_vinculos_no_se_superponen(): void
    {
        $g = $this->como(self::GERENTE);
        $r = $g->postJson('/api/v1/grj/cambio-a-factura', ['cut_date' => '2027-03-31', 'new_ruc' => '20612345679', 'legal_name' => 'GRANJA DON GUANDO SAC'])->assertCreated()->json();
        $this->assertSame('2027-03-31', $r['closed']['valid_to']);
        $this->assertSame('2027-04-01', $r['opened']['valid_from']);
        $this->como(self::GERENTE)->getJson('/api/v1/grj/vinculos/esperado?date=2027-04-02')->assertOk()->assertJsonPath('expected_doc_type', 'INVOICE');
        $this->como(self::GERENTE)->getJson('/api/v1/grj/vinculos/esperado?date=2027-03-31')->assertOk()->assertJsonPath('expected_doc_type', 'NTI');
        $this->usuario();
        $granja = GranjaService::granja();
        $this->como(self::GERENTE)->postJson('/api/v1/grj/vinculos', ['supplier_id' => $granja->id, 'mode' => 'INVOICE', 'valid_from' => '2027-03-15', 'farm_ruc' => '20612345679'])
            ->assertStatus(422)->assertJsonPath('code', 'RN-GRJ-01');
        // RN-GRJ-10: el corte es el último día de un mes.
        $this->como(self::GERENTE)->postJson('/api/v1/grj/cambio-a-factura/deshacer')->assertOk();
        $this->como(self::GERENTE)->postJson('/api/v1/grj/cambio-a-factura', ['cut_date' => '2027-03-30', 'new_ruc' => '20612345679'])->assertStatus(422)->assertJsonPath('code', 'RN-GRJ-10');
    }

    public function test_ca_grj_04_un_vinculo_nti_con_otro_ruc_se_rechaza(): void
    {
        $this->usuario();
        $camal = DB::table('suppliers')->where('doc_number', '20554187235')->value('id');
        $this->como(self::GERENTE)->postJson('/api/v1/grj/vinculos', ['supplier_id' => $camal, 'mode' => 'NTI', 'valid_from' => '2026-11-01'])
            ->assertStatus(422)->assertJsonPath('code', 'RN-GRJ-03');
        // Compras no crea vínculos (es del gerente o la contadora).
        $this->como(self::COMPRAS)->postJson('/api/v1/grj/vinculos', ['supplier_id' => $camal, 'mode' => 'INVOICE', 'valid_from' => '2026-11-01'])->assertForbidden();
    }

    public function test_ca_grj_05_el_mismo_envio_dos_veces_queda_una_sola_vez(): void
    {
        $this->como(self::COMPRAS)->postJson('/api/v1/grj/envios', $this->envio('NI01-000250'))->assertCreated();
        $dos = $this->como(self::COMPRAS)->postJson('/api/v1/grj/envios', $this->envio('NI01-000250'))->assertOk()->json();
        $this->assertTrue($dos['duplicate']);
        $this->usuario();
        $this->assertSame(1, DB::table('farm_dispatches')->where('farm_document_number', 'NI01-000250')->count());
        $this->assertSame(1, (int) DB::table('farm_dispatches')->where('farm_document_number', 'NI01-000250')->value('duplicates_received'));
        $this->assertSame(1, DB::table('purchase_documents')->where('series', 'NI01')->where('number', '250')->count());
    }

    public function test_rn_grj_05_un_item_sin_mapear_no_se_recibe_hasta_mapearlo(): void
    {
        $e = $this->envio('NI01-000260');
        $e['lines'][0]['item_code'] = 'GR-POL-BEN';
        $e['lines'][0]['item_name'] = 'Pollo de corral beneficiado';
        $d = $this->como(self::COMPRAS)->postJson('/api/v1/grj/envios', $e)->assertCreated()->json('dispatch');
        $this->assertNull($d['purchase_document_id']);
        $this->assertStringContainsString('GR-POL-BEN', $d['error_message']);
        $this->como(self::COMPRAS)->postJson("/api/v1/grj/envios/{$d['id']}/recibir", ['lines' => [['id' => $d['lines'][0]['id'], 'received_weight_kg' => 300]]])
            ->assertStatus(422)->assertJsonPath('code', 'RN-GRJ-05');
        $this->usuario();
        $pollo = DB::table('product_variants')->where('sku', 'MP-POL-CAN')->value('id');
        $this->como(self::COMPRAS)->postJson('/api/v1/grj/mapeos', ['farm_item_code' => 'GR-POL-BEN', 'farm_item_name' => 'Pollo de corral beneficiado', 'variant_id' => $pollo,
            'transfer_price' => 9.2])->assertOk();
        $x = $this->como(self::COMPRAS)->getJson("/api/v1/grj/envios/{$d['id']}")->assertOk()->json();
        $this->assertNotNull($x['purchase_document_id']);
    }

    public function test_pantallas_responden_y_otra_empresa_no_tiene_el_modulo(): void
    {
        foreach (['opciones', 'vinculos', 'mapeos', 'envios', 'conciliacion?month=2026-09', 'tablero?month=2026-09'] as $p) {
            $this->como(self::CONTADORA)->getJson("/api/v1/grj/{$p}")->assertOk();
        }
        foreach (['01', '02', '03', '05', '06', '07'] as $n) {
            $this->como(self::COMPRAS)->getJson("/api/v1/grj/cifras/{$n}")->assertOk();
        }
        $t = $this->como(self::GERENTE)->getJson('/api/v1/grj/tablero?month=2026-09')->json();
        $this->assertArrayHasKey('weight_diff_pct', $t['kpis']);
        $this->como('hsalas@carnesselectas.pe', self::CS)->getJson('/api/v1/grj/envios')->assertForbidden();
    }
}
