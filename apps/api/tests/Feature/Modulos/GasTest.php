<?php

namespace Tests\Feature\Modulos;

use App\Models\User;
use App\Modulos\Gas\Services\Gastos;
use App\Support\TenantContext;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/** GAS · Gastos: un test por criterio CA-GAS-01 a CA-GAS-08 y las reglas que los rodean (RN-GAS-01 a RN-GAS-14). */
class GasTest extends TestCase
{
    private array $tokens = [];

    private ?array $op = null;

    private const FECHA = '2026-10-12';

    protected function setUp(): void
    {
        parent::setUp();
        // Octubre abierto y con tipo de cambio cargado (hasta el 09/10).
        $this->travelTo(Carbon::parse('2026-10-12 10:00', 'America/Lima'));
        // Las opciones se piden antes: armar los datos de un gasto no debe cambiar quién hace la petición.
        $this->op();
    }

    private function como(string $email): static
    {
        return $this->desde(self::DG, $this->tokens[$email] ??= $this->ingresar(self::DG, $email));
    }

    private function gerente(): static
    {
        return $this->como('rquispe@donguando.pe');
    }

    private function coordinador(): static
    {
        return $this->como('rchavez@donguando.pe');
    }

    private function supervisora(): static
    {
        return $this->como('pleon@donguando.pe');
    }

    private function administracion(): static
    {
        return $this->como('chuaman@donguando.pe');
    }

    private function marketing(): static
    {
        return $this->como('lparedes@donguando.pe');
    }

    private function contadora(): static
    {
        return $this->como('mcardenas@donguando.pe');
    }

    private function contexto(): void
    {
        $t = DB::selectOne('SELECT auth_tenants_for_email(?) AS t', ['rquispe@donguando.pe'])->t;
        TenantContext::set(TenantContext::find($t));
        TenantContext::setUser(User::where('email', 'rquispe@donguando.pe')->value('id'));
    }

    private function op(): array
    {
        return $this->op ??= $this->gerente()->getJson('/api/v1/gas/opciones')->assertOk()->json();
    }

    private function local(string $codigo = 'L1'): string
    {
        return collect($this->op()['locales'])->firstWhere('code', $codigo)['id'];
    }

    private function categoria(string $codigo): array
    {
        return collect($this->op()['categorias'])->firstWhere('code', $codigo);
    }

    private function centro(string $codigo): string
    {
        return collect($this->op()['centros'])->firstWhere('code', $codigo)['id'];
    }

    private function marca(string $codigo): string
    {
        return collect($this->op()['marcas'])->firstWhere('code', $codigo)['id'];
    }

    private function vehiculo(string $placa): string
    {
        return collect($this->op()['vehiculos'])->firstWhere('plate', $placa)['id'];
    }

    private function trabajador(string $nombre): string
    {
        return collect($this->op()['trabajadores'])->first(fn ($t) => str_starts_with($t['full_name'], $nombre))['id'];
    }

    /** Un RUC válido (con su dígito verificador) que no está en el maestro de proveedores. */
    private function ruc(string $primeros10 = '2060998877'): string
    {
        $pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
        $s = 0;
        foreach ($pesos as $i => $p) {
            $s += (int) $primeros10[$i] * $p;
        }
        $r = 11 - ($s % 11);

        return $primeros10.match ($r) { 10 => 0, 11 => 1, default => $r };
    }

    private function foto(): UploadedFile
    {
        return UploadedFile::fake()->image('comprobante-'.uniqid().'.jpg', 40, 60);
    }

    /** Datos base de un gasto: lo que cada prueba no dice, va por defecto. */
    private function gasto(array $d): array
    {
        $cat = $this->categoria($d['cat'] ?? 'OTR');
        unset($d['cat']);

        return $d + [
            'establishment_id' => $this->local(), 'category_id' => $cat['id'], 'cost_center_id' => $cat['default_cost_center_id'],
            'issue_date' => self::FECHA, 'doc_type' => 'RECEIPT', 'total' => 50, 'igv' => 0, 'description' => 'Gasto de prueba', 'pay_source' => 'PAYABLE',
        ];
    }

    /** CA-GAS-01 y RN-GAS-12: combustible de S/ 180 con factura; al aprobarlo, entra a DEL como costo sin IGV con sus galones. */
    public function test_ca_gas_01_combustible_aprobado_llega_a_delivery(): void
    {
        $ruc = $this->ruc();
        $r = $this->coordinador()->post('/api/v1/gas/gastos', $this->gasto([
            'cat' => 'DEL-COMB', 'doc_type' => 'INVOICE', 'supplier_doc' => $ruc, 'supplier_name' => 'GRIFO LOS ANDES SAC', 'doc_series' => 'F001', 'doc_number' => '345',
            'total' => 180, 'igv' => 27.46, 'vehicle_id' => $this->vehiculo('MTA-123'), 'fuel_gallons' => 10.5, 'description' => 'Combustible de la moto',
            'foto' => $this->foto(), 'enviar' => 1,
        ]))->assertCreated()->json();
        $this->assertSame('SUBMITTED', $r['status']);
        $this->assertSame(1, $r['required_level']);
        $this->assertEquals(152.54, $r['subtotal']);
        $this->assertEquals(152.54, $r['net_pen']);
        $this->assertSame('OK', $r['accounting_flag']);

        // El coordinador no ve su propio gasto en su bandeja; la supervisora sí.
        $this->assertNotContains($r['id'], collect($this->coordinador()->getJson('/api/v1/gas/aprobaciones')->assertOk()->json('data'))->pluck('id'));
        $this->assertContains($r['id'], collect($this->supervisora()->getJson('/api/v1/gas/aprobaciones')->assertOk()->json('data'))->pluck('id'));

        $a = $this->supervisora()->postJson("/api/v1/gas/gastos/{$r['id']}/aprobar", ['comentario' => 'Conforme'])->assertOk()->json();
        $this->assertSame('APPROVED', $a['status']);
        $this->assertSame('Combustible', $a['costo_reparto']['tipo']);
        $this->assertEquals(152.54, $a['costo_reparto']['amount']);
        $this->assertEquals(10.5, $a['costo_reparto']['fuel_gallons']);
        $this->assertCount(1, $a['aprobaciones']);

        $this->contexto();
        $c = DB::table('delivery_costs')->where('expense_id', $r['id'])->first();
        $this->assertSame('FUEL', $c->cost_type);
        $this->assertEquals(152.54, (float) $c->amount);
        $this->assertSame('F001-345', $c->fuel_voucher_no);
        $this->assertSame('GAS', $c->source);
        $this->assertTrue(DB::table('domain_events')->where('event_name', 'expense.approved')->where('aggregate_id', $r['id'])->exists());
        // Las aprobaciones son de solo inserción.
        $this->expectException(\Illuminate\Database\QueryException::class);
        DB::table('expense_approvals')->where('expense_id', $r['id'])->update(['comment' => 'cambiado']);
    }

    /** CA-GAS-02 y RN-GAS-07: un gasto de S/ 1500 pide nivel 2; el nivel 1 no lo aprueba. */
    public function test_ca_gas_02_nivel_requerido(): void
    {
        $r = $this->marketing()->post('/api/v1/gas/gastos', $this->gasto(['total' => 1500, 'description' => 'Stand de feria', 'foto' => $this->foto(), 'enviar' => 1]))
            ->assertCreated()->json();
        $this->assertSame(2, $r['required_level']);
        // La supervisora (nivel 1) no lo ve en su bandeja ni lo puede aprobar.
        $this->assertNotContains($r['id'], collect($this->supervisora()->getJson('/api/v1/gas/aprobaciones')->json('data'))->pluck('id'));
        $this->supervisora()->postJson("/api/v1/gas/gastos/{$r['id']}/aprobar")->assertStatus(422)->assertJsonPath('code', 'RN-GAS-07');
        $this->administracion()->postJson("/api/v1/gas/gastos/{$r['id']}/aprobar")->assertOk()->assertJsonPath('status', 'APPROVED');
        // Solo se aprueba un gasto enviado.
        $this->gerente()->postJson("/api/v1/gas/gastos/{$r['id']}/aprobar")->assertStatus(422)->assertJsonPath('code', 'RN-GAS-07');
    }

    /** CA-GAS-03 y RN-GAS-08: nadie aprueba su propio gasto. */
    public function test_ca_gas_03_no_aprueba_su_propio_gasto(): void
    {
        $r = $this->coordinador()->post('/api/v1/gas/gastos', $this->gasto(['total' => 40, 'foto' => $this->foto(), 'enviar' => 1]))->assertCreated()->json();
        $this->coordinador()->postJson("/api/v1/gas/gastos/{$r['id']}/aprobar")->assertStatus(422)->assertJsonPath('code', 'RN-GAS-08');
        $this->assertFalse($this->coordinador()->getJson("/api/v1/gas/gastos/{$r['id']}")->json('puede.aprobar'));
        // Rechazar pide motivo y el gasto vuelve a quien lo registró para corregirlo y reenviarlo.
        $this->supervisora()->postJson("/api/v1/gas/gastos/{$r['id']}/rechazar", ['comentario' => 'no'])->assertStatus(422);
        $this->supervisora()->postJson("/api/v1/gas/gastos/{$r['id']}/rechazar", ['comentario' => 'Falta el detalle del gasto'])->assertOk()->assertJsonPath('status', 'REJECTED');
        $mios = $this->coordinador()->getJson('/api/v1/gas/gastos?vista=mios')->assertOk()->json('data');
        $this->assertSame('Falta el detalle del gasto', collect($mios)->firstWhere('id', $r['id'])['rejection_reason']);
        $e = $this->coordinador()->post("/api/v1/gas/gastos/{$r['id']}", $this->gasto(['total' => 40, 'description' => 'Útiles para la oficina de reparto', 'enviar' => 1]))->assertOk()->json();
        $this->assertSame('SUBMITTED', $e['status']);
    }

    /** CA-GAS-04 y RN-GAS-05: la misma factura del mismo proveedor no se registra dos veces, salvo que la anterior esté anulada. */
    public function test_ca_gas_04_comprobante_repetido(): void
    {
        $ruc = $this->ruc('2061112223');
        $datos = fn () => $this->gasto(['cat' => 'ADM-UTI', 'doc_type' => 'INVOICE', 'supplier_doc' => $ruc, 'supplier_name' => 'LIBRERÍA CENTRAL SAC',
            'doc_series' => 'F001', 'doc_number' => '345', 'total' => 118, 'igv' => 18, 'foto' => $this->foto()]);
        $r = $this->coordinador()->post('/api/v1/gas/gastos', $datos())->assertCreated()->json();
        $this->coordinador()->post('/api/v1/gas/gastos', $datos())->assertStatus(422)->assertJsonPath('code', 'RN-GAS-05');
        // Con ceros a la izquierda es el mismo número.
        $this->marketing()->post('/api/v1/gas/gastos', ['doc_number' => '000345'] + $datos())->assertStatus(422)->assertJsonPath('code', 'RN-GAS-05');
        $this->coordinador()->postJson("/api/v1/gas/gastos/{$r['id']}/anular", ['motivo' => 'Registrado por error'])->assertOk()->assertJsonPath('status', 'VOIDED');
        $this->coordinador()->post('/api/v1/gas/gastos', $datos())->assertCreated();
    }

    /** CA-GAS-05 y RN-GAS-06: una movilidad sin comprobante se acepta, queda marcada y aparece en la bandeja de la contadora. */
    public function test_ca_gas_05_sin_comprobante_va_a_la_contadora(): void
    {
        $r = $this->coordinador()->post('/api/v1/gas/gastos', $this->gasto(['cat' => 'DEL-MOV', 'doc_type' => 'NONE', 'total' => 25,
            'employee_id' => $this->trabajador('Pedro Condori'), 'description' => 'Taxi del repartidor', 'enviar' => 1]))->assertCreated()->json();
        $this->assertSame('SUBMITTED', $r['status']);
        $this->assertSame('NO_VALID_RECEIPT', $r['accounting_flag']);
        $this->assertNull($r['comprobante']);
        $bandeja = $this->contadora()->getJson('/api/v1/gas/contadora')->assertOk()->json();
        $this->assertContains($r['id'], collect($bandeja['data'])->pluck('id'));
        // La contadora pide corrección: quien lo registró lo ve y corrige el comprobante.
        $this->contadora()->postJson("/api/v1/gas/gastos/{$r['id']}/observar", ['nota' => 'Trae la planilla de movilidad firmada'])->assertOk()->assertJsonPath('accounting_flag', 'OBSERVED');
        $c = $this->coordinador()->post("/api/v1/gas/gastos/{$r['id']}/corregir", ['doc_type' => 'MOBILITY_SHEET', 'doc_number' => '12', 'foto' => $this->foto()])->assertOk()->json();
        $this->assertTrue($c['corregido']);
        $this->assertSame('MOBILITY_SHEET', $c['doc_type']);
        // D-GAS-05: la contadora confirma que la planilla cumple; sale de la bandeja.
        $this->contadora()->postJson("/api/v1/gas/gastos/{$r['id']}/clasificar", ['accounting_flag' => 'OK', 'note' => 'Planilla conforme'])->assertOk()->assertJsonPath('accounting_flag', 'OK');
        $this->assertNotContains($r['id'], collect($this->contadora()->getJson('/api/v1/gas/contadora')->json('data'))->pluck('id'));
        // Sin el permiso, no hay bandeja.
        $this->coordinador()->getJson('/api/v1/gas/contadora')->assertForbidden();
    }

    /** CA-GAS-06 y RN-GAS-09: caja chica del Local 1 (S/ 1000, máximo S/ 200 por gasto). */
    public function test_ca_gas_06_maximo_de_caja_chica(): void
    {
        $this->coordinador()->post('/api/v1/gas/gastos', $this->gasto(['total' => 250, 'pay_source' => 'PETTY', 'foto' => $this->foto()]))
            ->assertStatus(422)->assertJsonPath('code', 'RN-GAS-09');
        $r = $this->coordinador()->post('/api/v1/gas/gastos', $this->gasto(['total' => 150, 'pay_source' => 'PETTY', 'foto' => $this->foto(), 'enviar' => 1]))->assertCreated()->json();
        $this->assertNotNull($r['rendicion']);
        $this->assertSame('Abierta', $r['rendicion']['estado']);
    }

    /** RN-GAS-09: la rendición suma los gastos aprobados, la aprueba otra persona y se repone desde una cuenta de CAJ. */
    public function test_rendicion_de_caja_chica(): void
    {
        $caja = $this->administracion()->getJson('/api/v1/gas/caja-chica')->assertOk()->json();
        $fondo = collect($caja['fondos'])->firstWhere('establishment_id', $this->local());
        // Cada responsable de un fondo aparece en la lista para editarlo (usuarios sin tipo son personal de la empresa).
        foreach ($caja['fondos'] as $x) {
            $this->assertContains($x['custodian_user_id'], array_column($caja['responsables'], 'id'));
        }
        $saldo = $fondo['saldo'];
        $r = $this->coordinador()->post('/api/v1/gas/gastos', $this->gasto(['total' => 80.5, 'pay_source' => 'PETTY', 'foto' => $this->foto(), 'enviar' => 1]))->assertCreated()->json();
        $pendiente = $this->coordinador()->post('/api/v1/gas/gastos', $this->gasto(['total' => 30, 'pay_source' => 'PETTY', 'foto' => $this->foto(), 'enviar' => 1]))->assertCreated()->json();
        $a = $this->supervisora()->postJson("/api/v1/gas/gastos/{$r['id']}/aprobar")->assertOk()->json();
        $this->assertSame('PAID', $a['status']);   // el dinero ya salió del fondo
        // GAS-10 lista solo los que aún se pueden repartir (sin aprobar).
        $abiertos = array_column($this->coordinador()->getJson('/api/v1/gas/gastos?vista=mios&abiertos=1&per_page=100')->assertOk()->json('data'), 'id');
        $this->assertContains($pendiente['id'], $abiertos);
        $this->assertNotContains($r['id'], $abiertos);
        $rid = $a['rendicion']['id'];
        $f = collect($this->administracion()->getJson('/api/v1/gas/caja-chica')->json('fondos'))->firstWhere('id', $fondo['id']);
        $this->assertEqualsWithDelta($saldo - 80.5 - 30, $f['saldo'], 0.001);

        // La envía la responsable del fondo (gerencia en la demo); el gasto aún sin aprobar pasa a la nueva rendición.
        $env = $this->gerente()->postJson("/api/v1/gas/rendiciones/{$rid}/enviar")->assertOk()->json();
        $this->assertSame('SUBMITTED', $env['status']);
        $this->assertEqualsWithDelta($env['total'], $env['replenishment_amount'], 0.001);
        $this->assertNotContains($pendiente['id'], collect($env['gastos'])->pluck('id'));
        $this->assertNotSame($rid, $this->coordinador()->getJson("/api/v1/gas/gastos/{$pendiente['id']}")->json('rendicion.id'));
        // Quien la envió no la aprueba.
        $this->gerente()->postJson("/api/v1/gas/rendiciones/{$rid}/aprobar")->assertStatus(422)->assertJsonPath('code', 'RN-GAS-08');
        $this->administracion()->postJson("/api/v1/gas/rendiciones/{$rid}/aprobar")->assertOk()->assertJsonPath('status', 'APPROVED');
        $banco = collect($this->administracion()->getJson('/api/v1/gas/cuentas')->json())->firstWhere('account_type', 'BANK')['id'];
        $this->administracion()->postJson("/api/v1/gas/rendiciones/{$rid}/reponer", ['cash_account_id' => $banco])->assertOk()->assertJsonPath('status', 'REIMBURSED');
        $f = collect($this->administracion()->getJson('/api/v1/gas/caja-chica')->json('fondos'))->firstWhere('id', $fondo['id']);
        $this->assertGreaterThan($saldo - 110.5, $f['saldo']);
        // Un gasto de una rendición ya enviada no se anula.
        $this->administracion()->postJson("/api/v1/gas/gastos/{$r['id']}/anular", ['motivo' => 'Prueba de anulación'])->assertStatus(422)->assertJsonPath('code', 'RN-GAS-14');
    }

    /** CA-GAS-07 y RN-GAS-04: alquiler de S/ 2000 repartido 60/40 entre Don Guando y Marca 2. */
    public function test_ca_gas_07_reparto_entre_centros_de_costo(): void
    {
        $r = $this->administracion()->post('/api/v1/gas/gastos', $this->gasto(['cat' => 'ALQ-LOC', 'doc_type' => 'INVOICE', 'supplier_doc' => '20608874136',
            'doc_series' => 'F002', 'doc_number' => '9001', 'total' => 2000, 'igv' => 305.08, 'description' => 'Alquiler del local de octubre', 'foto' => $this->foto()]))->assertCreated()->json();
        $this->assertSame('INMOBILIARIA LURÍN SUR EIRL', $r['proveedor']);   // del maestro de proveedores por RUC
        $mal = ['lineas' => [['cost_center_id' => $this->centro('VEN-DG'), 'brand_id' => $this->marca('DG'), 'pct' => 60], ['cost_center_id' => $this->centro('VEN-M2'), 'brand_id' => $this->marca('M2'), 'pct' => 30]]];
        $this->administracion()->putJson("/api/v1/gas/gastos/{$r['id']}/reparto", $mal)->assertStatus(422)->assertJsonPath('code', 'RN-GAS-04');
        $bien = $mal;
        $bien['lineas'][1]['pct'] = 40;
        $x = $this->administracion()->putJson("/api/v1/gas/gastos/{$r['id']}/reparto", $bien)->assertOk()->json();
        $this->assertEqualsCanonicalizing([1200.0, 800.0], collect($x['reparto'])->pluck('amount')->all());
        $this->administracion()->postJson("/api/v1/gas/gastos/{$r['id']}/enviar")->assertOk()->assertJsonPath('required_level', 3);   // regla de la categoría: gerencia
        $this->gerente()->postJson("/api/v1/gas/gastos/{$r['id']}/aprobar")->assertOk()->assertJsonPath('status', 'APPROVED');
        // KPI-GAS-02: el reporte por marca cuenta cada parte en su marca.
        $rep = $this->administracion()->getJson('/api/v1/gas/reporte?por=marca&desde='.self::FECHA.'&hasta='.self::FECHA)->assertOk()->json();
        $this->assertEqualsWithDelta(800, collect($rep['filas'])->firstWhere('clave', 'Marca 2 · Cortes')['total'], 0.001);
        // Después de aprobado, el reparto ya no cambia.
        $this->administracion()->putJson("/api/v1/gas/gastos/{$r['id']}/reparto", $bien)->assertStatus(422)->assertJsonPath('code', 'RN-GAS-04');
    }

    /** CA-GAS-08 y RN-GAS-11: creadora de contenido con recibo por honorarios de S/ 800 para una campaña. */
    public function test_ca_gas_08_costo_de_creadores_por_campana(): void
    {
        $this->contexto();
        $camp = DB::table('ad_campaigns')->where('status', 'ACTIVE')->orderBy('code')->value('id');
        $antes = Gastos::costoCreadores($camp);
        $datos = fn (float $total, string $num) => $this->gasto(['cat' => 'PUB-CREA', 'doc_type' => 'FEES_RECEIPT', 'supplier_doc' => $this->ruc('1072041385'), 'supplier_name' => 'ANA CREADORA',
            'doc_series' => 'E001', 'doc_number' => $num, 'total' => $total, 'ad_campaign_id' => $camp, 'sales_channel' => 'TIKTOK', 'description' => 'Videos «Cuy navideño»',
            'foto' => $this->foto(), 'enviar' => 1]);
        // Sin la campaña no se registra (RN-GAS-03).
        $this->marketing()->post('/api/v1/gas/gastos', ['ad_campaign_id' => ''] + $datos(800, '71'))->assertStatus(422)->assertJsonPath('code', 'RN-GAS-03');
        $r = $this->marketing()->post('/api/v1/gas/gastos', $datos(800, '71'))->assertCreated()->json();
        $this->assertEquals(0, $r['withholding_amount']);
        $this->administracion()->postJson("/api/v1/gas/gastos/{$r['id']}/aprobar")->assertOk();
        $this->contexto();
        $this->assertEqualsWithDelta($antes + 800, Gastos::costoCreadores($camp), 0.001);
        // Desde S/ 1500 se retiene el 8 %.
        $grande = $this->marketing()->post('/api/v1/gas/gastos', $datos(2000, '72'))->assertCreated()->json();
        $this->assertEquals(160, $grande['withholding_amount']);
    }

    /** RN-GAS-01, 02, 10 y 13: foto para enviar, IGV solo en factura, proveedor en factura, período cerrado y moneda extranjera. */
    public function test_reglas_del_registro(): void
    {
        $this->coordinador()->post('/api/v1/gas/gastos', $this->gasto(['enviar' => 1]))->assertStatus(422)->assertJsonPath('code', 'RN-GAS-01');
        $this->coordinador()->post('/api/v1/gas/gastos', $this->gasto(['description' => '']))->assertStatus(422)->assertJsonPath('code', 'RN-GAS-01');
        $this->coordinador()->post('/api/v1/gas/gastos', $this->gasto(['igv' => 5]))->assertStatus(422)->assertJsonPath('code', 'RN-GAS-02');
        $this->coordinador()->post('/api/v1/gas/gastos', $this->gasto(['doc_type' => 'INVOICE', 'total' => 118, 'igv' => 18, 'doc_series' => 'F001', 'doc_number' => '9']))
            ->assertStatus(422)->assertJsonPath('code', 'RN-GAS-02');
        $this->coordinador()->post('/api/v1/gas/gastos', $this->gasto(['doc_type' => 'INVOICE', 'supplier_doc' => '20123456789', 'supplier_name' => 'X', 'doc_series' => 'F001', 'doc_number' => '9']))
            ->assertStatus(422)->assertJsonPath('code', 'RN-GAS-02');   // RUC con dígito verificador errado
        $this->coordinador()->post('/api/v1/gas/gastos', $this->gasto(['issue_date' => '2026-01-15']))->assertStatus(422)->assertJsonPath('code', 'RN-PLT-05');
        $this->coordinador()->post('/api/v1/gas/gastos', $this->gasto(['cat' => 'DEL-COMB', 'fuel_gallons' => 3]))->assertStatus(422)->assertJsonPath('code', 'RN-GAS-03');   // sin vehículo
        $usd = $this->marketing()->post('/api/v1/gas/gastos', $this->gasto(['cat' => 'PUB-ANUN', 'doc_type' => 'FOREIGN_INVOICE', 'supplier_name' => 'Meta Platforms Ireland',
            'doc_number' => 'FBADS-1', 'currency' => 'USD', 'total' => 100, 'issue_date' => '2026-10-09', 'ad_campaign_id' => collect($this->op()['campanas'])->first()['id']]))->assertCreated()->json();
        $this->contexto();
        $venta = (float) DB::table('exchange_rates')->where('date', '2026-10-09')->where('currency', 'USD')->value('sell');
        $this->assertEqualsWithDelta(round(100 * $venta, 2), $usd['amount_pen'], 0.001);
        // La base recalcula amount_pen aunque alguien lo cambie directo.
        DB::table('expenses')->where('id', $usd['id'])->update(['amount_pen' => 1]);
        $this->assertEqualsWithDelta(round(100 * $venta, 2), (float) DB::table('expenses')->where('id', $usd['id'])->value('amount_pen'), 0.001);
    }

    /** GAS-04 y RN-GAS-14: pago desde una cuenta de CAJ, reverso y anulación. */
    public function test_pago_reverso_y_anulacion(): void
    {
        $r = $this->coordinador()->post('/api/v1/gas/gastos', $this->gasto(['total' => 90, 'foto' => $this->foto(), 'enviar' => 1]))->assertCreated()->json();
        $this->supervisora()->postJson("/api/v1/gas/gastos/{$r['id']}/aprobar")->assertOk();
        $this->assertContains($r['id'], collect($this->administracion()->getJson('/api/v1/gas/gastos?vista=pagar&per_page=100')->assertOk()->json('data'))->pluck('id'));
        $banco = collect($this->administracion()->getJson('/api/v1/gas/cuentas')->json())->firstWhere('account_type', 'BANK')['id'];
        $this->supervisora()->postJson("/api/v1/gas/gastos/{$r['id']}/pagar", ['cash_account_id' => $banco])->assertForbidden();
        $this->administracion()->postJson("/api/v1/gas/gastos/{$r['id']}/pagar", ['cash_account_id' => $banco])->assertStatus(422)->assertJsonPath('code', 'RN-GAS-14');   // falta la operación
        $p = $this->administracion()->postJson("/api/v1/gas/gastos/{$r['id']}/pagar", ['cash_account_id' => $banco, 'referencia' => 'OP-778899'])->assertOk()->json();
        $this->assertSame('PAID', $p['status']);
        $this->assertEquals(90, $p['paid_amount']);
        $this->administracion()->postJson("/api/v1/gas/gastos/{$r['id']}/anular", ['motivo' => 'Pagado dos veces'])->assertStatus(422)->assertJsonPath('code', 'RN-GAS-14');
        $this->administracion()->postJson("/api/v1/gas/gastos/{$r['id']}/revertir-pago", ['motivo' => 'Se pagó a otra cuenta'])->assertOk()->assertJsonPath('status', 'APPROVED');
        // El coordinador no anula un gasto ya aprobado; administración sí.
        $this->coordinador()->postJson("/api/v1/gas/gastos/{$r['id']}/anular", ['motivo' => 'Ya no va'])->assertStatus(422)->assertJsonPath('code', 'RN-GAS-14');
        $this->administracion()->postJson("/api/v1/gas/gastos/{$r['id']}/anular", ['motivo' => 'Ya no va'])->assertOk()->assertJsonPath('status', 'VOIDED');
    }

    /** Integración con DEL: los gastos del repartidor de rutas liquidadas pasan a Gastos sin duplicar el costo de reparto. */
    public function test_gastos_de_ruta_liquidada(): void
    {
        $this->contexto();
        $liq = DB::table('driver_settlements')->where('status', 'SETTLED')->whereNotNull('route_ref')->orderBy('number')->first();
        $ruta = DB::table('delivery_routes')->where('id', $liq->route_ref)->first();
        $costo = DB::table('delivery_costs')->insertGetId(['cost_date' => $ruta->route_date, 'cost_type' => 'DRIVER_MEAL', 'amount' => 15, 'route_id' => $ruta->id, 'status' => 'ACTIVE'], 'id');
        $gid = DB::table('driver_expenses')->insertGetId(['number' => 'GDR-90001', 'route_id' => $ruta->id, 'driver_user_id' => $ruta->driver_user_id, 'expense_date' => $ruta->route_date,
            'category' => 'MEAL', 'amount' => 15, 'paid_with' => 'OWN', 'note' => 'Almuerzo', 'cost_id' => $costo, 'settlement_id' => $liq->id, 'status' => 'ACTIVE'], 'id');
        $b = $this->contadora()->getJson('/api/v1/gas/contadora')->assertOk()->json();
        $this->assertGreaterThanOrEqual(1, $b['por_traer']);
        $t = $this->contadora()->postJson('/api/v1/gas/contadora/traer-de-ruta')->assertOk()->json();
        $this->assertGreaterThanOrEqual(1, $t['traidos']);
        $this->contexto();
        $g = DB::table('expenses')->where('driver_expense_id', $gid)->first();
        $this->assertSame('APPROVED', $g->status);   // dinero propio: queda por reembolsar
        $this->assertSame('PAYABLE', $g->pay_source);
        $this->assertSame('NO_VALID_RECEIPT', $g->accounting_flag);
        $this->assertSame($g->id, DB::table('delivery_costs')->where('id', $costo)->value('expense_id'));
        $this->assertSame(1, DB::table('delivery_costs')->where('route_id', $ruta->id)->where('cost_type', 'DRIVER_MEAL')->where('amount', 15)->count());
        // Traerlos otra vez no los duplica, y no se anulan desde Gastos.
        $this->contadora()->postJson('/api/v1/gas/contadora/traer-de-ruta')->assertOk();
        $this->contexto();
        $this->assertSame(1, DB::table('expenses')->where('driver_expense_id', $gid)->count());
        $this->administracion()->postJson("/api/v1/gas/gastos/{$g->id}/anular", ['motivo' => 'Prueba de anulación'])->assertStatus(422)->assertJsonPath('code', 'RN-GAS-14');
    }

    /** Permisos y alcance: cada rol ve lo suyo; la exportación genera un Excel. */
    public function test_permisos_y_exportacion(): void
    {
        $r = $this->coordinador()->post('/api/v1/gas/gastos', $this->gasto(['total' => 20]))->assertCreated()->json();
        $this->marketing()->getJson("/api/v1/gas/gastos/{$r['id']}")->assertForbidden();   // no es suyo ni ve todos
        $this->contadora()->getJson("/api/v1/gas/gastos/{$r['id']}")->assertOk();
        $this->coordinador()->getJson('/api/v1/gas/gastos?vista=todos')->assertOk();   // aprueba nivel 1: ve los gastos
        $this->marketing()->getJson('/api/v1/gas/gastos?vista=todos')->assertForbidden();
        $this->marketing()->postJson('/api/v1/gas/categorias', [])->assertForbidden();
        $this->marketing()->getJson('/api/v1/gas/reporte')->assertForbidden();
        $this->como('pcondori@donguando.pe')->getJson('/api/v1/gas/aprobaciones')->assertForbidden();
        $x = $this->administracion()->get('/api/v1/gas/reporte/exportar?desde=2026-09-01&hasta=2026-10-12');
        $x->assertOk();
        $this->assertStringContainsString('spreadsheetml', (string) $x->headers->get('content-type'));
        // Categorías y reglas: administración las cambia y las reglas no se cruzan.
        $this->administracion()->postJson('/api/v1/gas/reglas', ['min_amount' => 100, 'max_amount' => 500, 'level' => 2])->assertStatus(422)->assertJsonPath('code', 'RN-GAS-07');
        $this->administracion()->postJson('/api/v1/gas/categorias', ['code' => 'DEL-LAV', 'name' => 'Lavado de motos', 'category_group' => 'DELIVERY', 'default_area' => 'DELIVERY',
            'default_cost_center_id' => $this->centro('DEL'), 'default_doc_type' => 'RECEIPT'])->assertStatus(422)->assertJsonPath('code', 'RN-GAS-12');
        $this->administracion()->postJson('/api/v1/gas/categorias', ['code' => 'DEL-LAV', 'name' => 'Lavado de motos', 'category_group' => 'DELIVERY', 'default_area' => 'DELIVERY',
            'delivery_cost_type' => 'MAINTENANCE_PREVENTIVE', 'default_cost_center_id' => $this->centro('DEL'), 'default_doc_type' => 'RECEIPT', 'requires_vehicle' => true])->assertCreated();
    }
}
