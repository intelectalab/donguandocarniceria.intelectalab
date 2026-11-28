<?php

namespace Tests\Feature\Modulos;

use App\Models\User;
use App\Support\TenantContext;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/** CAJ · Cajas, cobros y conciliación: un test por criterio CA-CAJ-01 a CA-CAJ-06 y las reglas que los rodean (RN-CAJ-01 a RN-CAJ-15). */
class CajTest extends TestCase
{
    private const GERENTE = 'rquispe@donguando.pe';

    private const ADMINISTRACION = 'chuaman@donguando.pe';

    private const CAJERO = 'jsalas@donguando.pe';

    private const VENDEDORA = 'ana.torres@donguando.pe';

    private const REPARTIDOR = 'pcondori@donguando.pe';

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

    private function id(string $tabla, string $code, string $col = 'code'): string
    {
        $this->usuario();

        return DB::table($tabla)->where($col, $code)->value('id');
    }

    private function marca(): string
    {
        return $this->id('brands', 'DG');
    }

    private function local(): string
    {
        return $this->id('establishments', 'L1');
    }

    private function cliente(string $tipo = 'DNI', ?string $nombre = null): string
    {
        $this->usuario();
        if ($tipo === 'RUC') {
            $base = '20'.random_int(10000000, 99999999);
            $suma = 0;
            foreach ([5, 4, 3, 2, 7, 6, 5, 4, 3, 2] as $i => $peso) {
                $suma += (int) $base[$i] * $peso;
            }
            $numero = $base.match ($r = 11 - ($suma % 11)) { 10 => 0, 11 => 1, default => $r };
        } else {
            $numero = (string) random_int(40000000, 79999999);
        }

        return DB::table('customers')->insertGetId(['doc_type' => $tipo, 'doc_number' => $numero, 'full_name' => $nombre ?? 'CLIENTE PRUEBA '.Str::upper(Str::random(5)),
            'customer_type' => $tipo === 'RUC' ? 'BUSINESS' : 'PERSON', 'status' => 'ACTIVE', 'phone' => '9'.random_int(10000000, 99999999),
            'fiscal_address' => $tipo === 'RUC' ? 'Av. Larco 345, Miraflores' : null], 'id');
    }

    /** Factura o boleta emitida por FAC (emisión directa), con su saldo igual al total. */
    private function comprobante(string $cliente, float $total, string $tipo = 'INVOICE'): string
    {
        return $this->como(self::GERENTE)->postJson('/api/v1/fac/comprobantes', [
            'doc_type' => $tipo, 'brand_id' => $this->marca(), 'establishment_id' => $this->local(), 'customer_id' => $cliente,
            'payment_terms' => 'CREDIT', 'credit_days' => 15,
            'lines' => [['description' => 'Cuy entero beneficiado', 'qty' => 1, 'unit_price' => $total, 'uom_code' => 'NIU']],
        ])->assertCreated()->json('id');
    }

    private function doc(string $id): object
    {
        $this->usuario();

        return DB::table('sales_documents')->where('id', $id)->first();
    }

    private function cobro(string $cliente, string $medio, float $monto, array $extra = [], string $quien = self::GERENTE)
    {
        $cuenta = $extra['cash_account_id'] ?? $this->id('cash_accounts', match ($medio) {
            'YAPE' => 'YAPE', 'PLIN' => 'PLIN', 'MP' => 'MP', 'CARD' => 'POS-VISA', 'CASH' => 'CAJA-L1', default => 'BCP-CTE',
        });

        return $this->como($quien)->postJson('/api/v1/caj/cobros', $extra + [
            'customer_id' => $cliente, 'method' => $medio, 'cash_account_id' => $cuenta, 'amount' => $monto,
            'brand_id' => $this->marca(), 'establishment_id' => $this->local(),
        ]);
    }

    /** Pedido entregado del cliente, sin pagar. */
    private function pedido(string $cliente, float $total): string
    {
        $this->usuario();

        return DB::table('sales_orders')->insertGetId([
            'number' => 'P-C'.random_int(10000, 99999), 'brand_id' => $this->marca(), 'establishment_id' => $this->local(), 'channel' => 'WHATSAPP', 'fulfillment' => 'DELIVERY',
            'customer_id' => $cliente, 'billing_customer_id' => $cliente, 'requested_doc_type' => 'RECEIPT', 'status' => 'DELIVERED', 'delivery_date' => '2026-11-20',
            'estimated_total' => $total, 'final_total' => $total, 'delivery_fee' => 0, 'paid_amount' => 0, 'discount_status' => 'NONE', 'delivered_at' => now(), 'imported' => true,
        ], 'id');
    }

    /** Ruta que volvió con cobros contra entrega en efectivo del repartidor. */
    private function rutaConCobros(array $montos, string $repartidor = self::REPARTIDOR): string
    {
        $this->usuario();
        $driver = DB::table('users')->where('email', $repartidor)->first(['id', 'employee_id']);
        $ruta = DB::table('delivery_routes')->insertGetId([
            'code' => 'R-T'.random_int(1000, 9999), 'route_date' => '2026-11-20', 'establishment_id' => $this->local(), 'mode' => 'OWN',
            'vehicle_id' => DB::table('vehicles')->value('id'), 'driver_user_id' => $driver->id,
            'driver_employee_id' => $driver->employee_id ?? DB::table('employees')->value('id'), 'sequence_method' => 'MANUAL', 'planned_km' => 10,
            'status' => 'RETURNED', 'departed_at' => now()->subHours(4), 'returned_at' => now(),
        ], 'id');
        $caja = \App\Modulos\Del\Services\App::cuentaRepartidor(DB::table('delivery_routes')->where('id', $ruta)->first());
        $cash = DB::table('payment_methods')->where('code', 'CASH')->value('id');
        $cliente = $this->cliente();
        foreach ($montos as $m) {
            $p = DB::table('payments')->insertGetId([
                'number' => 'CB-T'.random_int(100000, 999999), 'customer_id' => $cliente, 'payment_method_id' => $cash, 'cash_account_id' => $caja, 'amount' => $m,
                'paid_at' => now(), 'status' => 'CONFIRMED', 'brand_id' => $this->marca(), 'establishment_id' => $this->local(), 'fee_amount' => 0,
                'reconciliation_status' => 'NOT_APPLICABLE', 'collected_by_user_id' => $driver->id, 'source' => 'DEL',
            ], 'id');
            DB::table('delivery_events')->insert(['route_id' => $ruta, 'event_type' => 'COD_COLLECTED', 'payment_id' => $p, 'amount' => $m,
                'client_event_id' => (string) Str::uuid(), 'occurred_at' => now(), 'user_id' => $driver->id]);
        }

        return $ruta;
    }

    /* ------------------------------------------------------------ criterios */

    public function test_ca_caj_01_operacion_obligatoria_y_unica(): void
    {
        $cli = $this->cliente();
        $this->cobro($cli, 'YAPE', 50)->assertStatus(422)->assertJsonPath('code', 'RN-CAJ-02');
        $id = $this->cobro($cli, 'YAPE', 50, ['reference' => '81234567'])->assertCreated()
            ->assertJsonPath('status', 'CONFIRMED')->assertJsonPath('reconciliation_status', 'PENDING')->json('id');
        $this->assertMatchesRegularExpression('/^CB-\d{6}$/', $this->cobro($cli, 'YAPE', 20, ['reference' => '81234568'])->json('number'));
        // La misma captura de Yape no se usa dos veces (también en minúsculas o con otro monto).
        $this->cobro($this->cliente(), 'YAPE', 80, ['reference' => '81234567'])->assertStatus(422)->assertJsonPath('code', 'RN-CAJ-04');
        // Con otro medio sí puede repetirse el número.
        $this->cobro($cli, 'PLIN', 10, ['reference' => '81234567'])->assertCreated();
        // Revertido el cobro, la operación vuelve a quedar libre.
        $this->como(self::ADMINISTRACION)->postJson("/api/v1/caj/cobros/{$id}/revertir", ['reason' => 'Se registró con el cliente equivocado'])->assertOk();
        $this->cobro($this->cliente(), 'YAPE', 50, ['reference' => '81234567'])->assertCreated();
    }

    public function test_ca_caj_02_aplicar_un_cobro_a_dos_facturas(): void
    {
        $cli = $this->cliente('RUC');
        $f1 = $this->comprobante($cli, 600);
        $f2 = $this->comprobante($cli, 700);
        $this->assertEqualsWithDelta(600, (float) $this->doc($f1)->balance, 0.001);
        $p = $this->cobro($cli, 'TRANSFER', 1000, ['reference' => 'TRF-55001', 'applications' => [
            ['document_id' => $f1, 'amount' => 600], ['document_id' => $f2, 'amount' => 400],
        ]])->assertCreated()->assertJsonPath('sin_aplicar', 0)->json();
        $this->assertEqualsWithDelta(0, (float) $this->doc($f1)->balance, 0.001);
        $this->assertEqualsWithDelta(300, (float) $this->doc($f2)->balance, 0.001);
        // Aplicar S/ 100 más pasa el monto del cobro.
        $this->como(self::GERENTE)->postJson("/api/v1/caj/cobros/{$p['id']}/aplicar", ['applications' => [['document_id' => $f2, 'amount' => 100]]])
            ->assertStatus(422)->assertJsonPath('code', 'RN-CAJ-05');
        // RN-CAJ-07: a la segunda factura no se le aplica más de lo que le queda.
        $this->cobro($cli, 'TRANSFER', 400, ['reference' => 'TRF-55002', 'applications' => [['document_id' => $f2, 'amount' => 350]]])
            ->assertStatus(422)->assertJsonPath('code', 'RN-CAJ-07');
        // Un cobro con saldo sin aplicar se aplica después (CAJ-04).
        $q = $this->cobro($cli, 'TRANSFER', 500, ['reference' => 'TRF-55003'])->assertCreated()->assertJsonPath('sin_aplicar', 500)->json('id');
        $this->como(self::GERENTE)->postJson("/api/v1/caj/cobros/{$q}/aplicar", ['applications' => [['document_id' => $f2, 'amount' => 300]]])
            ->assertOk()->assertJsonPath('sin_aplicar', 200);
        $this->assertEqualsWithDelta(0, (float) $this->doc($f2)->balance, 0.001);
        // Lo aplicado a un pedido sube lo pagado (RN-CAJ-09) y no pasa lo que le falta.
        $o = $this->pedido($cli, 150);
        $this->como(self::GERENTE)->postJson("/api/v1/caj/cobros/{$q}/aplicar", ['applications' => [['order_id' => $o, 'amount' => 160]]])
            ->assertStatus(422)->assertJsonPath('code', 'RN-CAJ-05');
        $this->como(self::GERENTE)->postJson("/api/v1/caj/cobros/{$q}/aplicar", ['applications' => [['order_id' => $o, 'amount' => 150]]])->assertOk();
        $this->usuario();
        $this->assertEqualsWithDelta(150, (float) DB::table('sales_orders')->where('id', $o)->value('paid_amount'), 0.001);
        // Un pedido de otro cliente no recibe el cobro.
        $otro = $this->pedido($this->cliente(), 50);
        $this->como(self::GERENTE)->postJson("/api/v1/caj/cobros/{$q}/aplicar", ['applications' => [['order_id' => $otro, 'amount' => 10]]])
            ->assertStatus(422)->assertJsonPath('code', 'RN-CAJ-05');
    }

    public function test_ca_caj_03_liquidacion_con_diferencia(): void
    {
        $this->usuario();
        $drv = DB::table('cash_accounts')->where('code', 'DRV-PCONDORI')->value('id');
        $antes = \App\Modulos\Caj\Services\Cuentas::saldo($drv);
        $ruta = $this->rutaConCobros([100.00, 85.50, 92.30, 74.60, 80.00, 80.00]);
        $l = $this->como(self::CAJERO)->getJson("/api/v1/caj/rutas/{$ruta}/liquidacion")->assertOk();
        $this->assertEqualsWithDelta(512.40, $l->json('esperado.efectivo'), 0.001);
        // Sin motivo no se cierra.
        $this->como(self::CAJERO)->postJson("/api/v1/caj/rutas/{$ruta}/liquidar", ['counted_cash' => 500])->assertStatus(422)->assertJsonPath('code', 'RN-CAJ-10');
        $caja = $this->id('cash_accounts', 'CAJA-L1');
        $st = $this->como(self::CAJERO)->postJson("/api/v1/caj/rutas/{$ruta}/liquidar", ['counted_cash' => 500, 'reason' => 'Faltó el vuelto de dos pedidos', 'receiving_account_id' => $caja])
            ->assertCreated()->assertJsonPath('status', 'WITH_DIFFERENCE')->json();
        $this->assertEqualsWithDelta(-12.40, (float) $st['difference'], 0.001);
        $this->usuario();
        // El efectivo entregado pasa con un traslado a la caja que recibe; los cobros quedan liquidados.
        $t = DB::table('cash_transfers')->where('settlement_id', $st['id'])->first();
        $this->assertEqualsWithDelta(500, (float) $t->amount, 0.001);
        $this->assertSame($caja, $t->to_account_id);
        $this->assertSame(6, DB::table('payments')->where('driver_settlement_id', $st['id'])->count());
        $this->assertSame('RETURNED', DB::table('delivery_routes')->where('id', $ruta)->value('status'));
        // La segunda vez no se liquida; la cajera no aprueba (sin acceso de aprobar); administración sí.
        $this->como(self::CAJERO)->postJson("/api/v1/caj/rutas/{$ruta}/liquidar", ['counted_cash' => 512.40])->assertStatus(422)->assertJsonPath('code', 'RN-DEL-10');
        // Mientras espera aprobación, sale en la lista aunque sea de otras fechas.
        $lista = $this->como(self::ADMINISTRACION)->getJson('/api/v1/caj/liquidaciones?desde=2030-01-01&hasta=2030-01-31')->assertOk()->json('liquidaciones');
        $this->assertContains($st['id'], array_column($lista, 'id'));
        $this->como(self::CAJERO)->postJson("/api/v1/caj/liquidaciones/{$st['id']}/aprobar")->assertForbidden();
        $this->como(self::ADMINISTRACION)->postJson("/api/v1/caj/liquidaciones/{$st['id']}/aprobar")->assertOk()->assertJsonPath('status', 'APPROVED');
        $this->usuario();
        $this->assertSame('SETTLED', DB::table('delivery_routes')->where('id', $ruta)->value('status'));
        // Lo de la ruta sale de lo que la caja del repartidor tiene por liquidar.
        $this->assertSame($drv, $t->from_account_id);
        $this->assertEqualsWithDelta($antes, \App\Modulos\Caj\Services\Cuentas::saldo($drv), 0.001);
    }

    public function test_rn_caj_10_11_cuadrada_y_propia(): void
    {
        $ruta = $this->rutaConCobros([40, 60]);
        $this->como(self::CAJERO)->postJson("/api/v1/caj/rutas/{$ruta}/liquidar", ['counted_cash' => 100])->assertCreated()->assertJsonPath('status', 'SETTLED');
        $this->usuario();
        $this->assertSame('SETTLED', DB::table('delivery_routes')->where('id', $ruta)->value('status'));
        // RN-CAJ-11: quien fue de repartidor no recibe su propia liquidación.
        $propia = $this->rutaConCobros([30], self::CAJERO);
        $this->como(self::CAJERO)->postJson("/api/v1/caj/rutas/{$propia}/liquidar", ['counted_cash' => 30])->assertStatus(422)->assertJsonPath('code', 'RN-CAJ-11');
        // El repartidor no tiene acceso a CAJ.
        $this->como(self::REPARTIDOR)->postJson("/api/v1/caj/rutas/{$propia}/liquidar", ['counted_cash' => 30])->assertForbidden();
        // Una caja de otro local no recibe el efectivo.
        $l2 = $this->id('cash_accounts', 'CCH-L2');
        $this->como(self::ADMINISTRACION)->postJson("/api/v1/caj/rutas/{$propia}/liquidar", ['counted_cash' => 30, 'receiving_account_id' => $l2])
            ->assertStatus(422)->assertJsonPath('code', 'RN-CAJ-10');
        // CAJ-06: la caja del día muestra lo cobrado por repartidor.
        $c = $this->como(self::CAJERO)->getJson('/api/v1/caj/repartidores?fecha=2026-11-20')->assertOk();
        $this->assertGreaterThanOrEqual(130, $c->json('totales.efectivo'));
    }

    public function test_ca_caj_04_abono_de_mercado_pago(): void
    {
        $cli = $this->cliente();
        $a = $this->cobro($cli, 'MP', 600, ['reference' => 'MP-90001'])->assertCreated()->json('id');
        $b = $this->cobro($cli, 'MP', 400, ['reference' => 'MP-90002'])->assertCreated()->json('id');
        $yape = $this->cobro($cli, 'YAPE', 30, ['reference' => '70001234'])->assertCreated()->json('id');
        $base = ['source_account_id' => $this->id('cash_accounts', 'MP'), 'bank_account_id' => $this->id('cash_accounts', 'BCP-CTE'), 'deposit_date' => '2026-11-20'];
        // El neto debe ser el bruto menos la comisión y su IGV.
        $this->como(self::ADMINISTRACION)->postJson('/api/v1/caj/abonos', $base + ['reference' => 'LIQ-MP-1', 'gross_amount' => 1000, 'fee_amount' => 25.17, 'fee_igv' => 4.53, 'net_amount' => 975])
            ->assertStatus(422)->assertJsonPath('code', 'RN-CAJ-12');
        // RN-CAJ-13: solo cobros de la misma pasarela.
        $this->como(self::ADMINISTRACION)->postJson('/api/v1/caj/abonos', $base + ['reference' => 'LIQ-MP-1', 'gross_amount' => 1000, 'fee_amount' => 25.17, 'fee_igv' => 4.53,
            'net_amount' => 970.30, 'payment_ids' => [$a, $yape]])->assertStatus(422)->assertJsonPath('code', 'RN-CAJ-13');
        $ab = $this->como(self::ADMINISTRACION)->postJson('/api/v1/caj/abonos', $base + ['reference' => 'LIQ-MP-1', 'gross_amount' => 1000, 'fee_amount' => 25.17, 'fee_igv' => 4.53,
            'net_amount' => 970.30, 'payment_ids' => [$a]])->assertCreated()->assertJsonPath('status', 'OPEN')->json('id');
        // Con S/ 600 de S/ 1 000 no cuadra: sin motivo no se cierra.
        $this->como(self::ADMINISTRACION)->postJson("/api/v1/caj/abonos/{$ab}/cerrar")->assertStatus(422)->assertJsonPath('code', 'RN-CAJ-12');
        $this->como(self::ADMINISTRACION)->postJson("/api/v1/caj/abonos/{$ab}/cobros", ['payment_ids' => [$b]])->assertOk()->assertJsonPath('diferencia', 0);
        // Un cobro no entra a dos abonos.
        $otro = $this->como(self::ADMINISTRACION)->postJson('/api/v1/caj/abonos', $base + ['reference' => 'LIQ-MP-2', 'gross_amount' => 400, 'fee_amount' => 10])->assertCreated()->json('id');
        $this->como(self::ADMINISTRACION)->postJson("/api/v1/caj/abonos/{$otro}/cobros", ['payment_ids' => [$b]])->assertStatus(422)->assertJsonPath('code', 'RN-CAJ-13');
        // La cajera no concilia.
        $this->como(self::CAJERO)->postJson("/api/v1/caj/abonos/{$ab}/cerrar")->assertForbidden();
        $this->como(self::ADMINISTRACION)->postJson("/api/v1/caj/abonos/{$ab}/cerrar")->assertOk()->assertJsonPath('status', 'MATCHED');
        $this->usuario();
        $this->assertSame(['MATCHED'], DB::table('payments')->whereIn('id', [$a, $b])->pluck('reconciliation_status')->unique()->values()->all());
        $this->assertEqualsWithDelta(25.17, (float) DB::table('payments')->whereIn('id', [$a, $b])->sum('fee_amount'), 0.001);
        $this->assertEqualsWithDelta(4.53, (float) DB::table('payments')->whereIn('id', [$a, $b])->sum('fee_igv'), 0.001);
        $this->assertEqualsWithDelta(970.30, (float) DB::table('cash_transfers')->where('batch_id', $ab)->value('amount'), 0.001);
        // Un cobro conciliado no se revierte ni sale del abono cerrado.
        $this->como(self::ADMINISTRACION)->postJson("/api/v1/caj/cobros/{$a}/revertir", ['reason' => 'Prueba de reverso'])->assertStatus(422)->assertJsonPath('code', 'RN-CAJ-12');
        $this->como(self::ADMINISTRACION)->deleteJson("/api/v1/caj/abonos/{$ab}/cobros/{$a}")->assertStatus(422)->assertJsonPath('code', 'RN-CAJ-12');
        // CAJ-09: el Yape sigue por conciliar.
        $this->como(self::ADMINISTRACION)->getJson('/api/v1/caj/conciliacion?per_page=100&q=70001234')->assertOk()->assertJsonPath('total', 1);
    }

    public function test_ca_caj_05_saldo_a_favor_no_negativo(): void
    {
        $cli = $this->cliente();
        $this->usuario();
        DB::table('customer_balance_movements')->insert(['customer_id' => $cli, 'movement_type' => 'OVERPAYMENT', 'amount' => 7.68, 'reason' => 'Pagó de más', 'at' => now(), 'user' => 'Prueba']);
        $o = $this->pedido($cli, 30);
        // La lista pagina por clientes (total) y trae aparte la suma de los saldos (saldo_total).
        $sl = $this->como(self::VENDEDORA)->getJson('/api/v1/caj/saldos?per_page=1')->assertOk();
        $this->assertIsInt($sl->json('total'));
        $this->assertGreaterThanOrEqual(7.68, (float) $sl->json('saldo_total'));
        $this->como(self::VENDEDORA)->postJson("/api/v1/caj/saldos/{$cli}/usar", ['order_id' => $o, 'amount' => 10])->assertStatus(422)->assertJsonPath('code', 'RN-CAJ-08');
        $this->como(self::VENDEDORA)->postJson("/api/v1/caj/saldos/{$cli}/usar", ['order_id' => $o, 'amount' => 7.68])->assertOk()->assertJsonPath('saldo', 0);
        $this->usuario();
        $this->assertEqualsWithDelta(7.68, (float) DB::table('sales_orders')->where('id', $o)->value('paid_amount'), 0.001);
        // La base tampoco deja el saldo negativo.
        try {
            DB::transaction(fn () => DB::table('customer_balance_movements')->insert(['customer_id' => $cli, 'movement_type' => 'APPLIED', 'amount' => -1, 'reason' => 'x', 'at' => now(), 'user' => 'Prueba']));
            $this->fail('La base debía rechazar el saldo negativo.');
        } catch (\Illuminate\Database\QueryException $e) {
            $this->assertStringContainsString('RN-CAJ-08', $e->getMessage());
        }
        // D-CAJ-04: la devolución va por transferencia o Yape, con permiso.
        DB::table('customer_balance_movements')->insert(['customer_id' => $cli, 'movement_type' => 'OVERPAYMENT', 'amount' => 20, 'reason' => 'Pagó de más', 'at' => now(), 'user' => 'Prueba']);
        $dev = ['amount' => 20, 'refund_reference' => 'OP88120034', 'reason' => 'El cliente pidió su dinero'];
        $this->como(self::VENDEDORA)->postJson("/api/v1/caj/saldos/{$cli}/devolver", $dev + ['refund_account_id' => $this->id('cash_accounts', 'YAPE')])->assertForbidden();
        $this->como(self::ADMINISTRACION)->postJson("/api/v1/caj/saldos/{$cli}/devolver", $dev + ['refund_account_id' => $this->id('cash_accounts', 'CAJA-L1')])
            ->assertStatus(422)->assertJsonPath('code', 'RN-CAJ-08');
        $this->como(self::ADMINISTRACION)->postJson("/api/v1/caj/saldos/{$cli}/devolver", $dev + ['refund_account_id' => $this->id('cash_accounts', 'YAPE')])->assertOk()->assertJsonPath('saldo', 0);
    }

    public function test_ca_caj_06_cuenta_por_cobrar(): void
    {
        $cli = $this->cliente('RUC');
        $f = $this->comprobante($cli, 236);
        $this->como(self::GERENTE)->postJson("/api/v1/fac/comprobantes/{$f}/nota-credito", ['reason_code' => '04', 'reason' => 'Descuento acordado', 'amount' => 36])->assertCreated();
        $this->cobro($cli, 'TRANSFER', 150, ['reference' => 'TRF-77001', 'applications' => [['document_id' => $f, 'amount' => 150]]])->assertCreated();
        $this->assertEqualsWithDelta(50, (float) $this->doc($f)->balance, 0.001);
        $r = $this->como(self::GERENTE)->getJson("/api/v1/caj/por-cobrar?cliente={$cli}")->assertOk();
        $this->assertEqualsWithDelta(50, $r->json('resumen.total'), 0.001);
        $this->assertEqualsWithDelta(50, (float) $r->json('data.0.balance'), 0.001);
        $this->assertSame('0-30', $r->json('data.0.tramo'));
        // No se aplica más de lo que queda (total − notas − cobros).
        $this->cobro($cli, 'TRANSFER', 60, ['reference' => 'TRF-77002', 'applications' => [['document_id' => $f, 'amount' => 60]]])
            ->assertStatus(422)->assertJsonPath('code', 'RN-CAJ-07');
        // Un comprobante rechazado por SUNAT no genera cuenta por cobrar.
        $this->usuario();
        DB::table('sales_documents')->where('id', $f)->update(['sunat_status' => 'REJECTED']);
        $this->como(self::GERENTE)->getJson("/api/v1/caj/por-cobrar?cliente={$cli}")->assertOk()->assertJsonPath('total', 0);
        // La vendedora sin el permiso ve solo los comprobantes de sus ventas.
        $this->como(self::VENDEDORA)->getJson('/api/v1/caj/por-cobrar')->assertOk()->assertJsonPath('resumen.todos', false);
    }

    public function test_rn_caj_06_reverso(): void
    {
        $cli = $this->cliente();
        $o = $this->pedido($cli, 120);
        $p = $this->cobro($cli, 'YAPE', 150, ['reference' => '91112222', 'to_balance' => true, 'applications' => [['order_id' => $o, 'amount' => 120]]], self::VENDEDORA)
            ->assertCreated()->assertJsonPath('to_balance', '30.00')->json('id');
        $this->usuario();
        $this->assertEqualsWithDelta(120, (float) DB::table('sales_orders')->where('id', $o)->value('paid_amount'), 0.001);
        $this->assertEqualsWithDelta(30, \App\Modulos\Caj\Services\Saldos::saldo($cli), 0.001);
        // La vendedora no revierte; sin motivo no se revierte.
        $this->como(self::VENDEDORA)->postJson("/api/v1/caj/cobros/{$p}/revertir", ['reason' => 'No corresponde'])->assertForbidden();
        $this->como(self::ADMINISTRACION)->postJson("/api/v1/caj/cobros/{$p}/revertir", ['reason' => 'no'])->assertStatus(422)->assertJsonPath('code', 'RN-CAJ-06');
        $this->como(self::ADMINISTRACION)->postJson("/api/v1/caj/cobros/{$p}/revertir", ['reason' => 'La captura era de otro pedido'])->assertOk()->assertJsonPath('status', 'REVERSED');
        $this->usuario();
        $this->assertEqualsWithDelta(0, (float) DB::table('sales_orders')->where('id', $o)->value('paid_amount'), 0.001);
        $this->assertEqualsWithDelta(0, \App\Modulos\Caj\Services\Saldos::saldo($cli), 0.001);
        // Un cobro revertido no se reactiva ni se aplica.
        $this->como(self::ADMINISTRACION)->postJson("/api/v1/caj/cobros/{$p}/revertir", ['reason' => 'Otra vez'])->assertStatus(422)->assertJsonPath('code', 'RN-CAJ-06');
        $this->como(self::GERENTE)->postJson("/api/v1/caj/cobros/{$p}/aplicar", ['applications' => [['order_id' => $o, 'amount' => 10]]])
            ->assertStatus(422)->assertJsonPath('code', 'RN-CAJ-05');
        // Un cobro del mostrador se corrige con una devolución del mostrador.
        $pos = DB::table('payments')->whereNotNull('pos_shift_id')->where('status', 'CONFIRMED')->value('id');
        if ($pos) {
            $this->como(self::GERENTE)->postJson("/api/v1/caj/cobros/{$pos}/revertir", ['reason' => 'Prueba de reverso'])->assertStatus(422)->assertJsonPath('code', 'RN-CAJ-06');
        }
    }

    public function test_rn_caj_01_03_cuentas_y_tarjeta(): void
    {
        $cli = $this->cliente();
        // Un Yape no va a una cuenta bancaria; una cuenta inactiva no recibe cobros.
        $this->cobro($cli, 'YAPE', 10, ['reference' => '60001111', 'cash_account_id' => $this->id('cash_accounts', 'BCP-CTE')])->assertStatus(422)->assertJsonPath('code', 'RN-CAJ-01');
        $this->usuario();
        DB::table('cash_accounts')->where('code', 'PLIN')->update(['status' => 'INACTIVE']);
        $this->cobro($cli, 'PLIN', 10, ['reference' => '60001112'])->assertStatus(422)->assertJsonPath('code', 'RN-CAJ-01');
        // La caja del repartidor no recibe cobros de caja.
        $drv = DB::table('cash_accounts')->where('account_type', 'DRIVER_CASH')->value('id');
        $this->cobro($cli, 'CASH', 10, ['cash_account_id' => $drv])->assertStatus(422)->assertJsonPath('code', 'RN-CAJ-01');
        // RN-CAJ-03: tarjeta con marca y 4 dígitos.
        $this->cobro($cli, 'CARD', 80, ['reference' => 'POS-1001', 'card_brand' => 'VISA', 'card_last4' => '12'])->assertStatus(422)->assertJsonPath('code', 'RN-CAJ-03');
        $c = $this->cobro($cli, 'CARD', 80, ['reference' => 'POS-1001', 'card_brand' => 'VISA', 'card_last4' => '4521'])->assertCreated()->json();
        // La comisión del POS (3.44 %) queda estimada en el cobro, con su IGV.
        $this->assertEqualsWithDelta(2.75, (float) $c['fee_amount'], 0.001);
        $this->assertEqualsWithDelta(0.50, (float) $c['fee_igv'], 0.001);
        // El efectivo entra a la caja y sube su saldo; no se concilia.
        $antes = $this->como(self::GERENTE)->getJson('/api/v1/caj/cuentas')->assertOk()->json('cuentas');
        $caja = collect($antes)->firstWhere('code', 'CAJA-L1');
        $this->cobro($cli, 'CASH', 45.50)->assertCreated()->assertJsonPath('reconciliation_status', 'NOT_APPLICABLE');
        $despues = collect($this->como(self::GERENTE)->getJson('/api/v1/caj/cuentas')->json('cuentas'))->firstWhere('code', 'CAJA-L1');
        $this->assertEqualsWithDelta($caja['saldo'] + 45.50, $despues['saldo'], 0.001);
        // La vendedora ve las cuentas sin el QR ni la cuenta completa.
        $v = collect($this->como(self::VENDEDORA)->getJson('/api/v1/caj/cuentas')->assertOk()->json('cuentas'))->firstWhere('code', 'YAPE');
        $this->assertNull($v['qr_payload']);
        $this->como(self::VENDEDORA)->postJson('/api/v1/caj/cuentas', ['code' => 'X1', 'name' => 'X', 'account_type' => 'BANK'])->assertForbidden();
    }

    public function test_rn_caj_15_contra_entrega_la_cobra_el_repartidor(): void
    {
        $cli = $this->cliente();
        $o = $this->pedido($cli, 90);
        $this->usuario();
        DB::table('sales_orders')->where('id', $o)->update(['status' => 'IN_ROUTE']);
        $driver = DB::table('users')->where('email', self::REPARTIDOR)->value('id');
        $ruta = DB::table('delivery_routes')->insertGetId(['code' => 'R-T'.random_int(1000, 9999), 'route_date' => '2026-11-20', 'establishment_id' => $this->local(), 'mode' => 'OWN',
            'vehicle_id' => DB::table('vehicles')->value('id'), 'driver_user_id' => $driver, 'sequence_method' => 'MANUAL', 'planned_km' => 5, 'status' => 'IN_ROUTE'], 'id');
        DB::table('delivery_stops')->insert(['route_id' => $ruta, 'order_id' => $o, 'seq' => 1, 'zone_id' => DB::table('delivery_zones')->value('id'), 'status' => 'PENDING',
            'cod_amount' => 90, 'collected_amount' => 0, 'bags' => 1, 'kg' => 1]);
        $this->cobro($cli, 'CASH', 90, ['applications' => [['order_id' => $o, 'amount' => 90]]], self::VENDEDORA)->assertStatus(422)->assertJsonPath('code', 'RN-CAJ-15');
    }

    public function test_caj_12_traslados_y_13_cierre(): void
    {
        $this->cobro($this->cliente(), 'CASH', 300)->assertCreated();
        $caja = $this->id('cash_accounts', 'CAJA-L1');
        $banco = $this->id('cash_accounts', 'BCP-CTE');
        $saldo = collect($this->como(self::ADMINISTRACION)->getJson('/api/v1/caj/cuentas')->json('cuentas'))->firstWhere('code', 'CAJA-L1')['saldo'];
        $this->como(self::ADMINISTRACION)->postJson('/api/v1/caj/traslados', ['from_account_id' => $caja, 'to_account_id' => $banco, 'amount' => $saldo + 100,
            'reference' => 'DEP-001', 'reason' => 'Depósito del día'])->assertStatus(422)->assertJsonPath('code', 'RN-CAJ-01');
        $this->como(self::ADMINISTRACION)->postJson('/api/v1/caj/traslados', ['from_account_id' => $caja, 'to_account_id' => $caja, 'amount' => 10,
            'reference' => 'DEP-001', 'reason' => 'Depósito del día'])->assertStatus(422)->assertJsonPath('code', 'RN-CAJ-01');
        $drv = $this->id('cash_accounts', 'DRV-PCONDORI');
        $this->como(self::ADMINISTRACION)->postJson('/api/v1/caj/traslados', ['from_account_id' => $drv, 'to_account_id' => $caja, 'amount' => 10,
            'reference' => 'DEP-001', 'reason' => 'Depósito del día'])->assertStatus(422)->assertJsonPath('code', 'RN-CAJ-10');
        $this->como(self::VENDEDORA)->postJson('/api/v1/caj/traslados', ['from_account_id' => $caja, 'to_account_id' => $banco, 'amount' => 10,
            'reference' => 'DEP-001', 'reason' => 'Depósito del día'])->assertForbidden();
        $this->como(self::ADMINISTRACION)->postJson('/api/v1/caj/traslados', ['from_account_id' => $caja, 'to_account_id' => $banco, 'amount' => 100,
            'reference' => 'DEP-001', 'reason' => 'Depósito del día'])->assertCreated();
        $nuevo = collect($this->como(self::ADMINISTRACION)->getJson('/api/v1/caj/cuentas')->json('cuentas'))->firstWhere('code', 'CAJA-L1')['saldo'];
        $this->assertEqualsWithDelta($saldo - 100, $nuevo, 0.001);
        $this->como(self::ADMINISTRACION)->getJson('/api/v1/caj/traslados?tipo=MANUAL')->assertOk()->assertJsonPath('data.0.reference', 'DEP-001');
        // CAJ-13: el cierre del día suma lo trasladado y lo cobrado.
        $this->cobro($this->cliente(), 'CASH', 25)->assertCreated();
        $c = $this->como(self::ADMINISTRACION)->getJson('/api/v1/caj/cierre?fecha=2026-11-20')->assertOk();
        $this->assertEqualsWithDelta(100, $c->json('totales.trasladado'), 0.001);
        $this->assertGreaterThanOrEqual(25, $c->json('totales.cobrado'));
        $fila = collect($c->json('cuentas'))->firstWhere('code', 'CAJA-L1');
        $this->assertEqualsWithDelta(100, $fila['sale'], 0.001);
    }

    public function test_caj_05_mensaje_de_pago(): void
    {
        $cli = $this->cliente();
        $o = $this->pedido($cli, 88.40);
        $m = $this->como(self::VENDEDORA)->postJson('/api/v1/caj/mensaje', ['order_id' => $o, 'method' => 'YAPE'])->assertOk();
        $this->assertStringContainsString('S/ 88.40', $m->json('texto'));
        $this->assertStringContainsString('+51987650001', $m->json('texto'));
        $this->assertNotNull($m->json('cuenta.qr_payload'));
        $this->assertStringStartsWith('https://wa.me/51', $m->json('whatsapp'));
        $mp = $this->como(self::VENDEDORA)->postJson('/api/v1/caj/mensaje', ['order_id' => $o, 'method' => 'MP'])->assertOk();
        $this->assertStringContainsString('https://link.mercadopago.com.pe/donguando', $mp->json('texto'));
        // Los datos de la cuenta no los escribe la vendedora: un medio sin cuenta se rechaza.
        $this->como(self::VENDEDORA)->postJson('/api/v1/caj/mensaje', ['order_id' => $o, 'method' => 'BITCOIN'])->assertStatus(422)->assertJsonPath('code', 'RN-CAJ-01');
        $this->como(self::VENDEDORA)->getJson('/api/v1/caj/mensaje/opciones?order_id='.$o)->assertOk()->assertJsonFragment(['code' => 'YAPE']);
        // A una empresa se le saluda por su razón social, no por la primera palabra.
        $this->usuario();
        DB::table('customers')->where('id', $cli)->update(['full_name' => 'EL BUEN CORTE SAC']);
        $e = $this->como(self::VENDEDORA)->postJson('/api/v1/caj/mensaje', ['order_id' => $o, 'method' => 'YAPE'])->assertOk();
        $this->assertStringStartsWith('Hola EL BUEN CORTE SAC', $e->json('texto'));
    }

    public function test_listas_y_permisos(): void
    {
        foreach (['/api/v1/caj/cobros', '/api/v1/caj/cobros/opciones', '/api/v1/caj/liquidaciones', '/api/v1/caj/abonos', '/api/v1/caj/conciliacion',
            '/api/v1/caj/saldos', '/api/v1/caj/por-cobrar', '/api/v1/caj/traslados', '/api/v1/caj/cierre', '/api/v1/caj/repartidores', '/api/v1/caj/cuentas'] as $url) {
            $this->como(self::ADMINISTRACION)->getJson($url)->assertOk();
        }
        $this->como(self::GERENTE)->get('/api/v1/caj/cobros/exportar')->assertOk();
        $this->como(self::GERENTE)->get('/api/v1/caj/por-cobrar/exportar')->assertOk();
        // El repartidor no entra a CAJ (cobra desde su app de reparto).
        $this->como(self::REPARTIDOR)->getJson('/api/v1/caj/cobros')->assertForbidden();
        // La gerencia crea y edita cuentas con sus datos de pago.
        $c = $this->como(self::GERENTE)->postJson('/api/v1/caj/cuentas', ['code' => 'BBVA-CTE', 'name' => 'BBVA cuenta corriente', 'account_type' => 'BANK',
            'bank_name' => 'BBVA', 'account_number' => '0011-0123-0100012345', 'opening_balance' => 0])->assertCreated()->json('id');
        $this->como(self::GERENTE)->postJson('/api/v1/caj/cuentas', ['code' => 'BBVA-CTE', 'name' => 'Otra', 'account_type' => 'BANK'])->assertStatus(422)->assertJsonPath('code', 'RN-CAJ-01');
        $this->como(self::GERENTE)->putJson("/api/v1/caj/cuentas/{$c}", ['status' => 'INACTIVE'])->assertOk()->assertJsonPath('status', 'INACTIVE');
        $this->como(self::GERENTE)->postJson('/api/v1/caj/cuentas', ['code' => 'DRV-X', 'name' => 'X', 'account_type' => 'DRIVER_CASH'])->assertStatus(422)->assertJsonPath('code', 'RN-CAJ-01');
    }
}
