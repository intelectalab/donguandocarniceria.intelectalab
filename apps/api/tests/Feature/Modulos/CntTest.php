<?php

namespace Tests\Feature\Modulos;

use App\Models\User;
use App\Modulos\Cnt\Services\AsientosService;
use App\Modulos\Cnt\Services\SireService;
use App\Modulos\Plt\Services\Periodos;
use App\Support\TenantContext;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * CNT · Contabilidad. CA-CNT-01 a 10 de la spec, permisos de la practicante y aislamiento.
 * Fecha de las pruebas: 10/10/2026. Agosto de 2026 está cerrado; septiembre y octubre, abiertos.
 */
class CntTest extends TestCase
{
    private const CONTADORA = 'mcardenas@donguando.pe';

    private const PRACTICANTE = 'khuerta@donguando.pe';

    private const GERENTE = 'rquispe@donguando.pe';

    private const COMPRAS = 'dflores.compras@donguando.pe';

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

    private function usuario(string $email = self::CONTADORA): User
    {
        $tenantId = DB::selectOne('SELECT auth_tenants_for_email(?) AS t', [$email])->t;
        TenantContext::set(TenantContext::find($tenantId));
        $u = User::where('email', $email)->firstOrFail();
        TenantContext::setUser($u->id);

        return $u;
    }

    /** Copia una factura de octubre como F001-1250 de S/ 1 180,00. */
    private function factura1250(): string
    {
        $this->usuario();
        $f = (array) DB::table('sales_documents')->where('series', 'F001')->where('issue_date', '>=', '2026-10-01')->orderBy('number')->first();
        $id = (string) Str::uuid();
        $cols = collect(DB::select("select column_name from information_schema.columns where table_name = 'sales_documents' and table_schema = 'public' and is_generated = 'NEVER'"))->pluck('column_name')->all();
        $f = array_intersect_key($f, array_flip($cols));
                DB::table('sales_documents')->insert(array_merge($f, ['id' => $id, 'number' => 1250, 'full_number' => 'F001-00001250', 'xml_hash' => hash('sha256', $id), 'order_id' => null, 'subtotal' => 1000, 'igv' => 180, 'total' => 1180, 'issue_date' => '2026-10-09']));

        return $id;
    }

    private function manual(float $debe = 100, float $haber = 100, array $extra = []): array
    {
        return array_merge(['entry_date' => '2026-10-09', 'description' => 'Traslado de caja al banco', 'lines' => [
            ['account_code' => '104101', 'debit' => $debe, 'credit' => 0], ['account_code' => '1011', 'debit' => 0, 'credit' => $haber]]], $extra);
    }

    public function test_ca_cnt_01_la_factura_de_1180_debita_1212_y_acredita_40111_y_702(): void
    {
        $id = $this->factura1250();
        $r = AsientosService::generar('SALE', $id, null);
        $e = AsientosService::ver($r['entry']->id);
        $this->assertSame('APPROVED', $e->status, 'la regla de ventas es de aprobación automática');
        $l = collect($e->lines)->keyBy('account_code');
        $this->assertEquals(1180.00, (float) $l['1212']->debit);
        $this->assertEquals(180.00, (float) $l['40111']->credit);
        $this->assertEquals(1000.00, (float) $l['702']->credit);
        $this->assertEquals((float) $e->total_debit, (float) $e->total_credit);
        // El detalle por HTTP muestra el mismo asiento.
        $this->como(self::CONTADORA)->getJson("/api/v1/cnt/asientos/{$e->id}")->assertOk()->assertJsonPath('source_label', 'Factura F001-1250');
    }

    public function test_ca_cnt_02_la_practicante_no_aprueba_su_asiento_y_la_contadora_le_da_el_numero_siguiente(): void
    {
        $e = $this->como(self::PRACTICANTE)->postJson('/api/v1/cnt/asientos', $this->manual())->assertCreated()->json();
        $this->assertSame('PENDING_APPROVAL', $e['status']);
        $this->assertNull($e['number']);
        $this->como(self::PRACTICANTE)->postJson("/api/v1/cnt/asientos/{$e['id']}/aprobar")->assertStatus(422)->assertJsonPath('code', 'RN-CNT-02');
        $this->usuario();
        $sig = (int) DB::table('journal_entries')->where('company_id', $e['company_id'])->where('period', '2026-10-01')->max('seq') + 1;
        $ok = $this->como(self::CONTADORA)->postJson("/api/v1/cnt/asientos/{$e['id']}/aprobar")->assertOk()->json();
        $this->assertSame('APPROVED', $ok['status']);
        $this->assertSame($sig, (int) $ok['seq']);
        $this->assertNotEmpty($ok['number']);
        $this->assertNotEmpty($ok['prepared_by_name']);
    }

    public function test_ca_cnt_03_un_asiento_que_no_cuadra_no_se_aprueba(): void
    {
        $this->como(self::PRACTICANTE)->postJson('/api/v1/cnt/asientos', $this->manual(100, 90))->assertStatus(422)->assertJsonPath('code', 'RN-CNT-01');
        $b = $this->como(self::PRACTICANTE)->postJson('/api/v1/cnt/asientos', $this->manual(100, 90, ['draft' => true]))->assertCreated()->json();
        $this->assertSame('DRAFT', $b['status']);
        $this->como(self::PRACTICANTE)->postJson("/api/v1/cnt/asientos/{$b['id']}/enviar")->assertStatus(422)->assertJsonPath('code', 'RN-CNT-01');
        $this->usuario();
        DB::table('journal_entries')->where('id', $b['id'])->update(['status' => 'PENDING_APPROVAL']);
        $r = $this->como(self::CONTADORA)->postJson("/api/v1/cnt/asientos/{$b['id']}/aprobar")->assertStatus(422)->assertJsonPath('code', 'RN-CNT-01');
        $this->assertStringContainsString('100,00', $r->json('message'));
    }

    public function test_ca_cnt_04_con_septiembre_cerrado_no_se_registra_un_asiento_del_15_09(): void
    {
        $u = $this->usuario();
        $emp = DB::table('companies')->orderBy('legal_name')->value('id');
        Periodos::cerrar($emp, '2026-09-01', $u, 'Prueba');
        $this->como(self::PRACTICANTE)->postJson('/api/v1/cnt/asientos', $this->manual(100, 100, ['entry_date' => '2026-09-15']))
            ->assertStatus(422)->assertJsonPath('code', 'RN-CNT-06');
    }

    public function test_ca_cnt_05_el_cruce_sire_cuenta_coincidencias_diferencias_y_faltantes(): void
    {
        $this->usuario();
        $emp = DB::table('companies')->orderBy('legal_name')->value('id');
        $sis = SireService::compras('2026-10-01', $emp)->values();
        $this->assertGreaterThanOrEqual(8, $sis->count());
        // La propuesta trae todos menos 2 de los registrados, 3 con otro importe y 7 que el sistema no tiene.
        $prop = $sis->slice(2)->values()->map(fn ($s, $i) => ['issuer_ruc' => $s->ruc, 'issuer_name' => $s->name, 'doc_type_code' => $s->type, 'series' => $s->series,
            'number' => (string) $s->number, 'issue_date' => $s->date, 'base' => $s->base, 'igv' => $s->igv, 'total' => $i < 3 ? $s->total + 25 : $s->total])->all();
        for ($i = 1; $i <= 7; $i++) {
            $prop[] = ['issuer_ruc' => '20612345679', 'issuer_name' => 'Proveedor fuera del sistema', 'doc_type_code' => '01', 'series' => 'F900', 'number' => (string) $i,
                'issue_date' => '2026-10-05', 'base' => 100, 'igv' => 18, 'total' => 118];
        }
        $r = $this->como(self::PRACTICANTE)->postJson('/api/v1/cnt/sire/propuestas', ['register' => 'PURCHASES', 'period' => '2026-10-01', 'lines' => $prop, 'inbox' => false])
            ->assertCreated()->json();
        $this->assertSame($sis->count() - 5, $r['summary']['MATCHED']);
        $this->assertSame(3, $r['summary']['AMOUNT_DIFF']);
        $this->assertSame(7, $r['summary']['MISSING_IN_SYSTEM']);
        $this->assertSame(2, $r['summary']['MISSING_IN_PROPOSAL']);
        // RN-CNT-18: con diferencias sin resolver no se prepara el envío.
        $this->como(self::PRACTICANTE)->postJson('/api/v1/cnt/sire/envios', ['register' => 'PURCHASES', 'period' => '2026-10-01'])->assertStatus(422)->assertJsonPath('code', 'RN-CNT-18');
    }

    public function test_ca_cnt_06_el_regimen_depende_de_la_uit_cargada_por_la_contadora(): void
    {
        $this->como(self::CONTADORA)->postJson('/api/v1/cnt/anios', ['year' => 2027, 'uit_value_pen' => 5000, 'uit_source' => 'Valor de ejemplo'])->assertOk();
        $this->como(self::CONTADORA)->getJson('/api/v1/cnt/regimen?year=2027&revenue=1500000')->assertOk()->assertJsonPath('result', 'SIMPLIFIED')->assertJsonPath('limit', 1500000);
        $this->como(self::CONTADORA)->getJson('/api/v1/cnt/regimen?year=2027&revenue=1500001')->assertOk()->assertJsonPath('result', 'FULL');
        $this->como(self::CONTADORA)->getJson('/api/v1/cnt/regimen?year=2028&revenue=100')->assertStatus(422)->assertJsonPath('code', 'RN-CNT-13');
        // La practicante no carga la UIT.
        $this->como(self::PRACTICANTE)->postJson('/api/v1/cnt/anios', ['year' => 2028, 'uit_value_pen' => 5000])->assertForbidden();
    }

    public function test_ca_cnt_07_el_cierre_exige_las_tareas_y_luego_bloquea_escrituras(): void
    {
        $this->como(self::CONTADORA)->postJson('/api/v1/cnt/cierre/cerrar', ['period' => '2026-09-01'])->assertStatus(422)->assertJsonPath('code', 'RN-CNT-07');
        // Se despeja septiembre: sin asientos por aprobar ni bandeja, y las tareas dispensadas con motivo.
        $this->usuario();
        DB::table('journal_entries')->where('period', '2026-09-01')->whereIn('status', ['DRAFT', 'PENDING_APPROVAL'])->update(['status' => 'VOIDED', 'void_reason' => 'Prueba']);
        DB::table('accountant_inbox_items')->where('period', '2026-09-01')->whereIn('status', ['PENDING', 'CLASSIFIED', 'RETURNED'])->update(['status' => 'APPROVED']);
        $tareas = $this->como(self::CONTADORA)->getJson('/api/v1/cnt/cierre?period=2026-09-01')->assertOk()->json('tasks');
        $this->assertCount(7, $tareas);
        $this->como(self::PRACTICANTE)->postJson("/api/v1/cnt/cierre/tareas/{$tareas[0]['id']}/marcar", ['waive' => true, 'reason' => 'Motivo largo de prueba'])
            ->assertStatus(422)->assertJsonPath('code', 'RN-CNT-07');
        foreach ($tareas as $t) {
            $this->como(self::CONTADORA)->postJson("/api/v1/cnt/cierre/tareas/{$t['id']}/marcar", ['waive' => true, 'reason' => 'Dispensada en la prueba de cierre'])->assertOk();
        }
        $this->como(self::PRACTICANTE)->postJson('/api/v1/cnt/cierre/cerrar', ['period' => '2026-09-01'])->assertForbidden();
        $this->como(self::CONTADORA)->postJson('/api/v1/cnt/cierre/cerrar', ['period' => '2026-09-01'])->assertOk()->assertJsonPath('status', 'CLOSED');
        $this->como(self::PRACTICANTE)->postJson('/api/v1/cnt/asientos', $this->manual(50, 50, ['entry_date' => '2026-09-20']))->assertStatus(422)->assertJsonPath('code', 'RN-CNT-06');
        // RN-CNT-08: reabrir exige motivo.
        $this->como(self::CONTADORA)->postJson('/api/v1/cnt/cierre/reabrir', ['period' => '2026-09-01', 'reason' => 'corto'])->assertStatus(422)->assertJsonPath('code', 'RN-CNT-08');
        $this->como(self::GERENTE)->postJson('/api/v1/cnt/cierre/reabrir', ['period' => '2026-09-01', 'reason' => 'Falta registrar una nota de crédito de septiembre'])->assertOk();
    }

    public function test_ca_cnt_08_un_documento_sin_regla_va_a_la_bandeja(): void
    {
        $id = $this->factura1250();
        $regla = DB::table('journal_rules')->where('code', 'R-VEN-01')->whereNull('valid_to')->value('id');
        $this->como(self::PRACTICANTE)->postJson("/api/v1/cnt/reglas/{$regla}/estado", ['status' => 'INACTIVE'])->assertForbidden();
        $this->como(self::CONTADORA)->postJson("/api/v1/cnt/reglas/{$regla}/estado", ['status' => 'INACTIVE'])->assertOk();
        $this->usuario();
        $r = AsientosService::generar('SALE', $id, null);
        $this->assertArrayHasKey('inbox', $r);
        $this->assertSame('NO_RULE', $r['inbox']->reason);
        $this->como(self::PRACTICANTE)->getJson('/api/v1/cnt/bandeja?reason=NO_RULE')->assertOk()->assertJsonFragment(['ref_label' => 'Factura F001-1250', 'reason_label' => 'Sin regla de asiento']);
    }

    public function test_ca_cnt_09_un_asiento_aprobado_no_se_modifica(): void
    {
        $this->usuario();
        $linea = DB::table('journal_lines as l')->join('journal_entries as e', 'e.id', '=', 'l.entry_id')->where('e.status', 'APPROVED')->where('e.period', '2026-10-01')->value('l.id');
        $this->como(self::PRACTICANTE)->patchJson("/api/v1/cnt/lineas/{$linea}", ['debit' => 1])->assertStatus(422)->assertJsonPath('code', 'RN-CNT-03');
    }

    public function test_ca_cnt_10_quien_clasifica_un_item_no_lo_aprueba(): void
    {
        $this->usuario();
        $item = DB::table('accountant_inbox_items')->where('reason', 'NO_RULE')->where('status', 'PENDING')->value('id');
        $this->como(self::PRACTICANTE)->postJson("/api/v1/cnt/bandeja/{$item}/clasificar", ['account_code' => '6311', 'note' => 'Flete del proveedor'])->assertOk();
        $this->como(self::PRACTICANTE)->postJson("/api/v1/cnt/bandeja/{$item}/aprobar")->assertStatus(422)->assertJsonPath('code', 'RN-CNT-10');
        $i = $this->como(self::CONTADORA)->getJson("/api/v1/cnt/bandeja/{$item}")->assertOk()->json();
        $this->assertSame('CLASSIFIED', $i['status']);
        $this->assertTrue($i['can']['approve']);
    }

    public function test_la_practicante_no_edita_el_plan_ni_las_reglas(): void
    {
        $this->como(self::PRACTICANTE)->postJson('/api/v1/cnt/cuentas', ['code' => '104199', 'name' => 'Prueba'])->assertForbidden();
        $c = $this->como(self::CONTADORA)->postJson('/api/v1/cnt/cuentas', ['code' => '104199', 'name' => 'BBVA cuenta corriente', 'acc_type' => 'ASSET'])->assertCreated()->json();
        $this->assertSame('1041', $c['parent_code']);
        $this->como(self::CONTADORA)->postJson('/api/v1/cnt/cuentas', ['code' => '999999', 'name' => 'Sin madre'])->assertStatus(422)->assertJsonPath('code', 'RN-CNT-05');
    }

    public function test_bancos_libros_planilla_reglas_y_bandeja_funcionan_de_punta_a_punta(): void
    {
        // CNT-11: el extracto de octubre con un cargo de comisión que solo está en el banco.
        $ca = $this->como(self::CONTADORA)->getJson('/api/v1/cnt/bancos')->assertOk()->json('accounts.0.id');
        $b = $this->como(self::PRACTICANTE)->postJson('/api/v1/cnt/bancos', ['cash_account_id' => $ca, 'period' => '2026-10-01', 'file_name' => 'extracto.csv',
            'lines' => [['date' => '2026-10-05', 'description' => 'Comisión mantenimiento', 'amount' => -15]]])->assertCreated()->json();
        $this->assertNotEquals(0.0, (float) $b['unexplained']);
        $this->como(self::CONTADORA)->postJson("/api/v1/cnt/bancos/{$b['id']}/cerrar")->assertStatus(422)->assertJsonPath('code', 'RN-CNT-15');
        $cargo = $this->como(self::PRACTICANTE)->postJson("/api/v1/cnt/bancos/lineas/{$b['lines'][0]['id']}/cargo", [])->assertCreated()->json();
        $this->assertNotEmpty($cargo);
        $this->como(self::CONTADORA)->getJson("/api/v1/cnt/bancos/{$b['id']}")->assertOk()->assertJsonPath('lines.0.booked_entry_status', 'PENDING_APPROVAL');

        // CNT-09: el Libro Diario simplificado en PDF; en TXT pide el código PLE.
        $l = $this->como(self::CONTADORA)->postJson('/api/v1/cnt/libros', ['book_code' => 'LDS', 'period' => '2026-09-01', 'format' => 'PDF'])->assertCreated()->json();
        $this->assertSame(64, strlen($l['hash']));
        $this->como(self::CONTADORA)->postJson('/api/v1/cnt/libros', ['book_code' => 'LDS', 'period' => '2026-09-01', 'format' => 'TXT'])->assertStatus(422)->assertJsonPath('code', 'RN-CNT-17');
        $this->como(self::CONTADORA)->postJson('/api/v1/cnt/libros', ['book_code' => 'LM', 'period' => '2026-09-01', 'format' => 'PDF'])->assertStatus(422)->assertJsonPath('code', 'RN-CNT-12');

        // CNT-15: la planilla de octubre genera su asiento por aprobar; una segunda importación se rechaza.
        $p = $this->como(self::PRACTICANTE)->postJson('/api/v1/cnt/planilla', ['period' => '2026-10-01'])->assertCreated()->json();
        $this->assertNotNull($p['entry_id']);
        $this->como(self::PRACTICANTE)->postJson('/api/v1/cnt/planilla', ['period' => '2026-10-01'])->assertStatus(422)->assertJsonPath('code', 'RN-CNT-20');

        // CNT-02: una regla con asientos se versiona.
        $r = collect($this->como(self::CONTADORA)->getJson('/api/v1/cnt/reglas?source=PURCHASE')->assertOk()->json('data'))->firstWhere('entries', '>', 0);
        $v = $this->como(self::CONTADORA)->getJson("/api/v1/cnt/reglas/{$r['id']}")->json();
        $n = $this->como(self::CONTADORA)->putJson("/api/v1/cnt/reglas/{$r['id']}", ['name' => $v['name'], 'valid_from' => '2026-10-11',
            'lines' => collect($v['lines'])->map(fn ($x) => collect($x)->only(['side', 'account_from', 'account_code', 'param_key', 'amount_key', 'third'])->all())->all()])->assertOk()->json();
        $this->assertSame($v['version'] + 1, $n['version']);

        // CNT-05: la contadora aprueba lo que clasificó la practicante y se genera el asiento.
        $this->usuario();
        $item = DB::table('accountant_inbox_items')->where('reason', 'NO_RULE')->where('status', 'CLASSIFIED')->value('id');
        $ok = $this->como(self::CONTADORA)->postJson("/api/v1/cnt/bandeja/{$item}/aprobar")->assertOk()->json();
        $this->assertSame('APPROVED', $ok['status']);

        // CNT-03: reverso de un asiento aprobado y generación de pendientes.
        $this->usuario();
        $e = DB::table('journal_entries')->where('status', 'APPROVED')->where('period', '2026-10-01')->where('source_type', 'SALE')->value('id');
        $rv = $this->como(self::PRACTICANTE)->postJson("/api/v1/cnt/asientos/{$e}/reversar", ['reason' => 'Prueba de reverso'])->assertCreated()->json();
        $this->assertSame($e, $rv['reversal_of']);
        $this->como(self::PRACTICANTE)->postJson('/api/v1/cnt/asientos/generar', ['period' => '2026-10-01'])->assertOk()->assertJsonStructure(['created', 'inbox', 'skipped', 'errors']);
        $this->como(self::CONTADORA)->getJson('/api/v1/cnt/tablero?month=2026-10')->assertOk()->assertJsonStructure(['kpis' => ['docs_without_entry', 'pending_approval', 'sire_diffs', 'close_days', 'invalid_receipts_pct', 'inbox_overdue']]);
    }

    public function test_las_pantallas_responden_y_compras_no_entra(): void
    {
        foreach (['opciones', 'cuentas', 'reglas', 'asientos', 'asientos/sin-asiento', 'bandeja', 'sire/propuestas', 'sire/sistema?register=SALES', 'sire/envios', 'sire/ejemplo',
            'libros', 'libros/vista?book=RV', 'anios', 'bancos', 'cierre', 'estados/ESF', 'estados/ERF', 'estados/ERN', 'estados/ERF/comparativo', 'balance', 'mayor/1212',
            'planilla', 'planilla/previa', 'tablero'] as $u) {
            $this->como(self::CONTADORA)->getJson("/api/v1/cnt/{$u}")->assertOk();
        }
        foreach (range(1, 16) as $n) {
            $this->como(self::CONTADORA)->getJson('/api/v1/cnt/cifras/'.str_pad((string) $n, 2, '0', STR_PAD_LEFT))->assertOk();
        }
        $this->como(self::COMPRAS)->getJson('/api/v1/cnt/asientos')->assertForbidden();
    }

    public function test_aislamiento_otra_empresa_no_ve_la_contabilidad(): void
    {
        $this->como('hsalas@carnesselectas.pe', self::CS)->getJson('/api/v1/cnt/asientos')->assertForbidden();
    }
}
