<?php

namespace Tests\Feature\Modulos;

use App\Models\User;
use App\Modulos\Alm\Services\AlertasService;
use App\Modulos\Alm\Services\InventarioService;
use App\Modulos\Alm\Services\ReservasService;
use App\Support\RuleError;
use App\Support\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * ALM · Almacenes, lotes, FEFO y movimientos. CA-ALM-01 a 08 (portadas del prototipo, ALM.js) y
 * RN-ALM-03, 04, 07, 08, 11, 13, 15 y 16. Los datos de demo se buscan por código, SKU o número.
 */
class AlmTest extends TestCase
{
    /** Almacenero del Local 1 (las pruebas mueven almacenes de L1). irojas es el almacenero de L2. */
    private const ALMACENERO = 'mtorres@donguando.pe';

    private const ALMACENERO_L2 = 'irojas@donguando.pe';

    private const ADMIN = 'chuaman@donguando.pe';

    private const GERENTE = 'rquispe@donguando.pe';

    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo(Carbon::parse('2026-11-10 10:00', 'America/Lima'));
    }

    /* ------------------------------------------------------------ ayudas */

    private function como(string $email, string $host = self::DG): static
    {
        return $this->desde($host, $this->ingresar($host, $email));
    }

    /** Fija la empresa en la conexión (como una petición) y devuelve el usuario. */
    private function usuario(string $email = self::GERENTE, string $host = self::DG): User
    {
        $tenantId = DB::selectOne('SELECT auth_tenants_for_email(?) AS t', [$email])->t;
        TenantContext::set(TenantContext::find($tenantId));
        $u = User::where('email', $email)->firstOrFail();
        TenantContext::setUser($u->id);

        return $u;
    }

    private function variante(string $sku): object
    {
        return DB::table('product_variants')->where('sku', $sku)->first();
    }

    private function almacen(string $code): string
    {
        return DB::table('warehouses')->where('code', $code)->value('id');
    }

    private function lote(string $sku, string $code, string $vence, string $estado = 'RELEASED'): string
    {
        $this->usuario();
        $v = $this->variante($sku);

        return DB::table('lots')->insertGetId([
            'product_id' => $v->product_id, 'variant_id' => $v->id, 'code' => $code, 'origin' => 'PRODUCTION',
            'production_date' => now()->toDateString(), 'expiry_date' => $vence, 'qc_status' => $estado, 'unit_cost' => 20,
        ], 'id');
    }

    private function entrada(string $wh, string $sku, ?string $lot, float $qty, float $costo = 20): void
    {
        InventarioService::mover(['type' => 'RECEIPT', 'warehouse_id' => $this->almacen($wh), 'variant_id' => $this->variante($sku)->id, 'lot_id' => $lot,
            'qty' => $qty, 'unit_cost' => $costo, 'source_type' => 'TEST', 'reason' => 'Prueba'], $this->usuario());
    }

    private function saldo(string $wh, string $sku, ?string $lot): object
    {
        $this->usuario();

        return DB::table('stock_balances')->where('warehouse_id', $this->almacen($wh))->where('variant_id', $this->variante($sku)->id)
            ->when($lot, fn ($q) => $q->where('lot_id', $lot), fn ($q) => $q->whereNull('lot_id'))->first();
    }

    /** Ningún lote de la variante queda disponible, para que FEFO solo vea los de la prueba. */
    private function bloquearLotesDe(string $sku): void
    {
        $this->usuario();
        DB::table('lots')->where('variant_id', $this->variante($sku)->id)->update(['qc_status' => 'BLOCKED']);
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

    /* ------------------------------------------------------------ criterios de aceptación */

    public function test_ca_alm_01_recepcion_de_la_granja_crea_un_lote_en_cuarentena_que_no_se_vende_hasta_liberarlo(): void
    {
        $this->usuario();
        $cuy = $this->variante('DG-CUY-ENT');
        $granja = DB::table('suppliers')->where('trade_name', 'Granja Don Guando')->value('id');
        $api = $this->como(self::ALMACENERO);

        $rc = $api->postJson('/api/v1/alm/recepciones', [
            'warehouse_id' => $this->almacen('CUA-L1'), 'source_type' => 'FARM', 'supplier_id' => $granja, 'vehicle_temp_c' => 3.2,
            'lines' => [['variant_id' => $cuy->id, 'qty' => 40, 'weight_kg' => 36, 'product_temp_c' => 3.5, 'appearance' => 'OK', 'qc_result' => 'PASS',
                'expiry_date' => now()->addDays(6)->toDateString(), 'unit_cost' => 26.5]],
        ])->assertCreated()->json();
        $r = $api->postJson("/api/v1/alm/recepciones/{$rc['id']}/confirmar")->assertOk()->json();

        $this->usuario();
        $lote = DB::table('lots')->find($r['lots'][0]);
        $this->assertSame('QUARANTINE', $lote->qc_status);
        $this->assertEquals(40, $this->saldo('CUA-L1', 'DG-CUY-ENT', $lote->id)->qty);

        $this->falla('RN-ALM-02', fn () => InventarioService::mover(['type' => 'SALE', 'warehouse_id' => $this->almacen('MOS-L1'), 'variant_id' => $cuy->id,
            'lot_id' => $lote->id, 'qty' => 1, 'source_type' => 'TEST', 'reason' => 'Venta'], $this->usuario()));
        $this->assertFalse(InventarioService::lotesDisponibles($cuy->id, ['establishment_id' => DB::table('establishments')->where('code', 'L1')->value('id')])
            ->contains('lot_id', $lote->id));

        $api->postJson("/api/v1/alm/lotes/{$lote->id}/estado", ['status' => 'RELEASED', 'move_to' => $this->almacen('CAM-L1')])->assertOk();
        $this->assertEquals(40, $this->saldo('CAM-L1', 'DG-CUY-ENT', $lote->id)->qty);
        $this->assertTrue(InventarioService::lotesDisponibles($cuy->id, ['warehouse_id' => $this->almacen('CAM-L1')])->contains('lot_id', $lote->id));
        $this->assertSame(['NEW→QUARANTINE', 'QUARANTINE→RELEASED'], DB::table('lot_status_changes')->where('lot_id', $lote->id)->orderBy('changed_at')
            ->get()->map(fn ($c) => "{$c->from_status}→{$c->to_status}")->all());
    }

    public function test_ca_alm_02_pollo_refrigerado_a_7_grados_marcado_aprobado_se_rechaza(): void
    {
        $this->usuario();
        $api = $this->como(self::ALMACENERO);
        $rc = $api->postJson('/api/v1/alm/recepciones', [
            'warehouse_id' => $this->almacen('CAM-L1'), 'source_type' => 'PURCHASE', 'supplier_id' => DB::table('suppliers')->where('trade_name', 'Avícola Los Andes')->value('id'),
            'vehicle_temp_c' => 5, 'lines' => [['variant_id' => $this->variante('DG-POL-ENT')->id, 'qty' => 10, 'weight_kg' => 22, 'product_temp_c' => 7,
                'appearance' => 'OK', 'qc_result' => 'PASS', 'expiry_date' => now()->addDays(5)->toDateString()]],
        ])->assertCreated()->json();

        $api->postJson("/api/v1/alm/recepciones/{$rc['id']}/confirmar")->assertStatus(422)->assertJsonPath('code', 'RN-ALM-06');
        $this->usuario();
        $this->assertSame('DRAFT', DB::table('stock_receipts')->where('id', $rc['id'])->value('status'));
    }

    public function test_ca_alm_03_fefo_reserva_primero_el_lote_que_vence_antes(): void
    {
        $this->bloquearLotesDe('DG-CON-ENT');
        $b = $this->lote('DG-CON-ENT', 'L-CON-B', now()->addDays(15)->toDateString());
        $a = $this->lote('DG-CON-ENT', 'L-CON-A', now()->addDays(10)->toDateString());
        $this->entrada('CAM-L1', 'DG-CON-ENT', $b, 10);
        $this->entrada('CAM-L1', 'DG-CON-ENT', $a, 10);

        $u = $this->usuario();
        $o = DB::table('sales_orders')->where('number', 'P-001330')->first();
        $linea = DB::table('sales_order_lines')->where('sales_order_id', $o->id)->value('id');
        $r = ReservasService::reservar(['order_id' => $o->id, 'order_number' => $o->number, 'brand_id' => $o->brand_id, 'establishment_id' => $o->establishment_id,
            'delivery_date' => now()->addDays(5)->toDateString(), 'lines' => [['line_id' => $linea, 'variant_id' => $this->variante('DG-CON-ENT')->id, 'qty' => 2]]], $u);

        $this->assertSame([], $r['short']);
        $this->assertSame(['L-CON-A'], array_column($r['reservations'], 'lot_code'));
        $this->assertEquals(2, $this->saldo('CAM-L1', 'DG-CON-ENT', $a)->reserved_qty);
        $this->assertEquals(0, $this->saldo('CAM-L1', 'DG-CON-ENT', $b)->reserved_qty);
    }

    public function test_ca_alm_04_lo_reservado_no_se_vende_en_el_mostrador(): void
    {
        $lot = $this->lote('DG-CUY-ENT', 'L-CUY-MOS', now()->addDays(6)->toDateString());
        $this->entrada('MOS-L1', 'DG-CUY-ENT', $lot, 3);
        $u = $this->usuario();
        $o = DB::table('sales_orders')->where('number', 'P-001318')->first();
        ReservasService::reservar(['order_id' => $o->id, 'order_number' => $o->number, 'brand_id' => $o->brand_id, 'establishment_id' => $o->establishment_id,
            'delivery_date' => now()->toDateString(), 'lines' => [['line_id' => DB::table('sales_order_lines')->where('sales_order_id', $o->id)->value('id'),
                'variant_id' => $this->variante('DG-CUY-ENT')->id, 'qty' => 2, 'lot_id' => $lot]]], $u);
        $this->assertEquals(2, $this->saldo('MOS-L1', 'DG-CUY-ENT', $lot)->reserved_qty);

        $venta = fn ($q) => InventarioService::mover(['type' => 'SALE', 'warehouse_id' => $this->almacen('MOS-L1'), 'variant_id' => $this->variante('DG-CUY-ENT')->id,
            'lot_id' => $lot, 'qty' => $q, 'source_type' => 'POS_SALE', 'reason' => 'Venta del mostrador'], $this->usuario());
        $this->falla('RN-ALM-09', fn () => $venta(2));
        $venta(1);
        $this->assertEquals(2, $this->saldo('MOS-L1', 'DG-CUY-ENT', $lot)->qty);
    }

    public function test_ca_alm_05_transferencia_entre_locales_sin_guia_no_sale_y_con_guia_llega(): void
    {
        $this->bloquearLotesDe('M3-CHO-1K');
        $lot = $this->lote('M3-CHO-1K', 'L-CHO-TR', now()->addDays(20)->toDateString());
        $this->entrada('CAM-L1', 'M3-CHO-1K', $lot, 25);
        $api = $this->como(self::ALMACENERO);

        $tr = $api->postJson('/api/v1/alm/transferencias', ['from_warehouse_id' => $this->almacen('CAM-L1'), 'to_warehouse_id' => $this->almacen('CAM-L2'),
            'lines' => [['variant_id' => $this->variante('M3-CHO-1K')->id, 'qty' => 20]]])->assertCreated()->json();
        $this->assertTrue($tr['requires_guide']);
        $api->postJson("/api/v1/alm/transferencias/{$tr['id']}/despachar")->assertStatus(422)->assertJsonPath('code', 'RN-ALM-10');

        $api->postJson("/api/v1/alm/transferencias/{$tr['id']}/guia", ['guide_number' => 't001-31'])->assertOk()->assertJsonPath('guide_number', 'T001-00000031');
        $api->postJson("/api/v1/alm/transferencias/{$tr['id']}/despachar")->assertOk()->assertJsonPath('status', 'DISPATCHED');
        $this->assertEquals(20, $this->saldo('TRA', 'M3-CHO-1K', $lot)->qty);

        $this->assertSame([$tr['number']], array_column($api->getJson('/api/v1/alm/transferencias?status=DISPATCHED&q='.$tr['number'])->json('data'), 'number'));
        $linea = $api->getJson("/api/v1/alm/transferencias/{$tr['id']}")->json('lines.0.id');
        // Recibe el almacenero del local de destino; el de L1 no tiene alcance sobre CAM-L2.
        $api->postJson("/api/v1/alm/transferencias/{$tr['id']}/recibir", ['lines' => [['line_id' => $linea, 'received_qty' => 20]]])
            ->assertStatus(422)->assertJsonPath('code', 'RN-ALM-01');
        $this->como(self::ALMACENERO_L2)->postJson("/api/v1/alm/transferencias/{$tr['id']}/recibir", ['lines' => [['line_id' => $linea, 'received_qty' => 20]]])
            ->assertOk()->assertJsonPath('status', 'RECEIVED');
        $this->assertEquals(20, $this->saldo('CAM-L2', 'M3-CHO-1K', $lot)->qty);
        $this->assertEquals(0, $this->saldo('TRA', 'M3-CHO-1K', $lot)->qty);
    }

    public function test_ca_alm_06_quien_cuenta_no_aprueba_y_administracion_ajusta_menos_dos(): void
    {
        $lot = $this->lote('DG-CUY-ENT', 'L-CUY-CNT', now()->addDays(6)->toDateString());
        $this->entrada('CAM-L1', 'DG-CUY-ENT', $lot, 40);
        $this->usuario();
        $cuy = $this->variante('DG-CUY-ENT')->id;
        $alm = $this->como(self::ALMACENERO);

        $c = $alm->postJson('/api/v1/alm/conteos', ['warehouse_id' => $this->almacen('CAM-L1'), 'count_type' => 'SPOT', 'variant_ids' => [$cuy]])->assertCreated()->json();
        $this->assertNull($c['lines'][0]['system_qty'], 'En el conteo ciego quien cuenta no ve el saldo');
        foreach ($c['lines'] as $l) {
            $this->usuario();
            $sistema = DB::table('stock_count_lines')->where('id', $l['id'])->value('system_qty');
            $alm->putJson("/api/v1/alm/conteos/lineas/{$l['id']}", ['counted_qty' => $l['lot_id'] === $lot ? 38 : $sistema])->assertOk();
        }
        $alm->postJson("/api/v1/alm/conteos/{$c['id']}/cerrar")->assertOk()->assertJsonPath('status', 'COUNTED');
        // El almacenero no tiene alm.count.approve; aun con él (gerente que contó), quien contó no aprueba.
        $alm->postJson("/api/v1/alm/conteos/{$c['id']}/aprobar")->assertStatus(403);
        $this->usuario();
        $gerente = User::where('email', self::GERENTE)->first();
        DB::table('stock_counts')->where('id', $c['id'])->update(['counted_by' => $gerente->id]);
        $this->como(self::GERENTE)->postJson("/api/v1/alm/conteos/{$c['id']}/aprobar")->assertStatus(422)->assertJsonPath('code', 'RN-ALM-12');
        DB::table('stock_counts')->where('id', $c['id'])->update(['counted_by' => User::where('email', self::ALMACENERO)->value('id')]);

        $r = $this->como(self::ADMIN)->postJson("/api/v1/alm/conteos/{$c['id']}/aprobar")->assertOk()->json();
        $this->assertSame(['-2.000'], array_column($r['adjustments'], 'qty'));
        $this->assertEquals(38, $this->saldo('CAM-L1', 'DG-CUY-ENT', $lot)->qty);
        $this->assertSame('ADJUSTMENT', DB::table('stock_movements')->where('source_id', $c['id'])->value('movement_type'));
    }

    public function test_ca_alm_07_merma_por_cadena_de_frio_sin_foto_se_rechaza(): void
    {
        Storage::fake('local');
        $lot = $this->lote('DG-CUY-ENT', 'L-CUY-MER', now()->addDays(6)->toDateString());
        $this->entrada('CAM-L1', 'DG-CUY-ENT', $lot, 5);
        $this->usuario();
        $datos = ['warehouse_id' => $this->almacen('CAM-L1'), 'variant_id' => $this->variante('DG-CUY-ENT')->id, 'lot_id' => $lot,
            'reason_id' => DB::table('waste_reasons')->where('code', 'FRIO')->value('id'), 'qty' => 1];
        $api = $this->como(self::ALMACENERO);

        $api->postJson('/api/v1/alm/mermas', $datos)->assertStatus(422)->assertJsonPath('code', 'RN-ALM-14');
        $m = $api->post('/api/v1/alm/mermas', $datos + ['photo' => UploadedFile::fake()->image('cuy.jpg')])->assertCreated()->json();
        $this->assertSame('PENDING', $m['status']);
        $this->assertEquals(5, $this->saldo('CAM-L1', 'DG-CUY-ENT', $lot)->qty, 'Una merma solo descuenta al aprobarse');
    }

    public function test_ca_alm_08_insertar_o_cambiar_directo_en_stock_balances_y_el_kardex_se_rechaza(): void
    {
        $this->usuario();
        $wh = $this->almacen('CAM-L1');
        $v = $this->variante('DG-CUY-ENT')->id;
        $intentos = [
            fn () => DB::table('stock_balances')->insert(['warehouse_id' => $wh, 'variant_id' => $v, 'qty' => 999, 'weight_kg' => 0, 'reserved_qty' => 0, 'avg_cost' => 0]),
            fn () => DB::table('stock_balances')->where('warehouse_id', $wh)->update(['qty' => 0]),
            fn () => DB::table('stock_balances')->where('warehouse_id', $wh)->delete(),
            fn () => DB::table('stock_movements')->insert(['warehouse_id' => $wh, 'variant_id' => $v, 'movement_type' => 'RECEIPT', 'qty' => 1, 'unit_cost' => 0,
                'total_cost' => 0, 'source_type' => 'X', 'moved_at' => now(), 'reason' => 'x', 'user' => 'x', 'bal_qty' => 1]),
            fn () => DB::table('stock_movements')->limit(1)->update(['reason' => 'cambiado']),
        ];
        $antes = DB::table('stock_balances')->where('warehouse_id', $wh)->sum('qty');
        foreach ($intentos as $i => $fn) {
            try {
                DB::transaction($fn);
                $this->fail("El intento {$i} debió rechazarse (RN-ALM-01)");
            } catch (QueryException $e) {
                $this->assertSame('42501', $e->getCode(), $e->getMessage());
            }
        }
        $this->assertEquals($antes, DB::table('stock_balances')->where('warehouse_id', $wh)->sum('qty'));
    }

    /* ------------------------------------------------------------ reglas */

    public function test_rn_alm_03_el_saldo_no_queda_negativo(): void
    {
        $lot = $this->lote('DG-CUY-ENT', 'L-CUY-NEG', now()->addDays(6)->toDateString());
        $this->entrada('CAM-L1', 'DG-CUY-ENT', $lot, 2);
        $e = $this->falla('RN-ALM-03', fn () => InventarioService::mover(['type' => 'WASTE', 'warehouse_id' => $this->almacen('CAM-L1'),
            'variant_id' => $this->variante('DG-CUY-ENT')->id, 'lot_id' => $lot, 'qty' => 3, 'source_type' => 'TEST', 'reason' => 'x'], $this->usuario()));
        $this->assertStringContainsString('hay 2 u', $e->getMessage());
        $this->assertEquals(2, $this->saldo('CAM-L1', 'DG-CUY-ENT', $lot)->qty);
        // La reserva tampoco supera el saldo: la base lo rechaza aunque se llame directo.
        $this->usuario();
        $bal = $this->saldo('CAM-L1', 'DG-CUY-ENT', $lot)->id;
        try {
            DB::transaction(fn () => DB::select('SELECT alm_reserve_adjust(?, 3)', [$bal]));
            $this->fail('La reserva de 3 sobre un saldo de 2 debió rechazarse');
        } catch (QueryException $e) {
            $this->assertStringContainsString('RN-ALM-03', $e->getMessage());
        }
        $this->assertSame(0, DB::table('stock_balances')->whereColumn('reserved_qty', '>', 'qty')->count(), 'Ningún saldo sembrado viola RN-ALM-03');
    }

    public function test_rn_alm_04_fefo_respeta_la_vida_minima_y_un_lote_vencido_no_se_vende(): void
    {
        $this->bloquearLotesDe('DG-CON-ENT');
        $corto = $this->lote('DG-CON-ENT', 'L-CON-CORTO', now()->addDays(3)->toDateString());
        $largo = $this->lote('DG-CON-ENT', 'L-CON-LARGO', now()->addDays(12)->toDateString());
        $vencido = $this->lote('DG-CON-ENT', 'L-CON-VENC', now()->subDay()->toDateString());
        foreach ([$corto, $largo, $vencido] as $l) {
            $this->entrada('CAM-L1', 'DG-CON-ENT', $l, 5);
        }
        $this->usuario();
        $v = $this->variante('DG-CON-ENT')->id;
        $wh = $this->almacen('CAM-L1');

        // Entrega en 3 días: el lote corto llega sin el día mínimo de vida (alm_min_days_left_on_delivery = 1).
        $this->assertSame(['L-CON-LARGO'], InventarioService::lotesDisponibles($v, ['warehouse_id' => $wh, 'delivery_date' => now()->addDays(3)->toDateString()])->pluck('lot_code')->all());
        $this->assertSame(['L-CON-CORTO', 'L-CON-LARGO'], InventarioService::lotesDisponibles($v, ['warehouse_id' => $wh])->pluck('lot_code')->all());

        $this->falla('RN-ALM-04', fn () => InventarioService::mover(['type' => 'SALE', 'warehouse_id' => $wh, 'variant_id' => $v, 'lot_id' => $vencido, 'qty' => 1,
            'source_type' => 'TEST', 'reason' => 'x'], $this->usuario()));
        // Salida sin lote: reparte por FEFO entre los liberados y vigentes.
        $r = InventarioService::mover(['type' => 'SALE', 'warehouse_id' => $wh, 'variant_id' => $v, 'qty' => 7, 'source_type' => 'TEST', 'reason' => 'x'], $this->usuario());
        $this->assertSame([$corto, $largo], array_column($r['moves'], 'lot_id'));
        $this->assertSame(['-5.000', '-2.000'], array_column($r['moves'], 'qty'));
    }

    public function test_rn_alm_07_cambios_de_estado_con_motivo_e_historial_y_un_lote_retirado_no_cambia(): void
    {
        $lot = $this->lote('DG-CUY-ENT', 'L-CUY-EST', now()->addDays(6)->toDateString());
        $this->entrada('CAM-L1', 'DG-CUY-ENT', $lot, 4);
        $api = $this->como(self::ALMACENERO);

        $api->postJson("/api/v1/alm/lotes/{$lot}/estado", ['status' => 'BLOCKED'])->assertStatus(422)->assertJsonPath('code', 'RN-ALM-07');
        $api->postJson("/api/v1/alm/lotes/{$lot}/estado", ['status' => 'BLOCKED', 'reason' => 'Olor extraño en la cámara'])->assertOk();
        $api->postJson("/api/v1/alm/lotes/{$lot}/estado", ['status' => 'RECALLED', 'reason' => 'Retiro por proveedor'])->assertOk();
        $api->postJson("/api/v1/alm/lotes/{$lot}/estado", ['status' => 'RELEASED'])->assertStatus(422)->assertJsonPath('code', 'RN-ALM-07');

        $h = $api->getJson("/api/v1/alm/lotes/{$lot}")->assertOk()->json('history');
        $this->assertSame(['BLOCKED', 'RECALLED'], array_column($h, 'to_status'));
        $this->assertSame('Olor extraño en la cámara', $h[0]['reason']);
        $this->usuario();
        $this->assertSame(['lot.blocked', 'lot.recalled'], DB::table('domain_events')->where('aggregate_id', $lot)->orderBy('id')->pluck('event_name')->all());
        // Sin permiso de bloqueo (cajero): no puede.
        $this->como('jsalas@donguando.pe')->postJson("/api/v1/alm/lotes/{$lot}/estado", ['status' => 'BLOCKED', 'reason' => 'Prueba'])->assertStatus(403);
    }

    public function test_rn_alm_08_un_producto_con_lote_no_se_mueve_sin_lote_ni_con_lote_ajeno(): void
    {
        $this->usuario();
        $ajeno = $this->lote('DG-CON-ENT', 'L-CON-AJENO', now()->addDays(10)->toDateString());
        $base = ['type' => 'RECEIPT', 'warehouse_id' => $this->almacen('CAM-L1'), 'variant_id' => $this->variante('DG-CUY-ENT')->id, 'qty' => 1,
            'source_type' => 'TEST', 'reason' => 'x'];
        $this->falla('RN-ALM-08', fn () => InventarioService::mover($base, $this->usuario()));
        $this->falla('RN-ALM-08', fn () => InventarioService::mover($base + ['lot_id' => $ajeno], $this->usuario()));
    }

    public function test_rn_alm_11_la_diferencia_al_recibir_exige_motivo_y_queda_como_merma(): void
    {
        $this->bloquearLotesDe('M3-CHO-1K');
        $lot = $this->lote('M3-CHO-1K', 'L-CHO-DIF', now()->addDays(20)->toDateString());
        $this->entrada('CAM-L1', 'M3-CHO-1K', $lot, 10, 18);
        $api = $this->como(self::ALMACENERO);
        $tr = $api->postJson('/api/v1/alm/transferencias', ['from_warehouse_id' => $this->almacen('CAM-L1'), 'to_warehouse_id' => $this->almacen('CAM-L2'),
            'lines' => [['variant_id' => $this->variante('M3-CHO-1K')->id, 'lot_id' => $lot, 'qty' => 10]]])->json();
        $api->postJson("/api/v1/alm/transferencias/{$tr['id']}/guia", ['guide_number' => 'T001-00000099'])->assertOk();
        $api->postJson("/api/v1/alm/transferencias/{$tr['id']}/despachar")->assertOk();
        $linea = $tr['lines'][0]['id'];
        $l2 = $this->como(self::ALMACENERO_L2);   // recibe el almacenero del local de destino

        $l2->postJson("/api/v1/alm/transferencias/{$tr['id']}/recibir", ['lines' => [['line_id' => $linea, 'received_qty' => 9]]])
            ->assertStatus(422)->assertJsonPath('code', 'RN-ALM-11');
        $l2->postJson("/api/v1/alm/transferencias/{$tr['id']}/recibir", ['lines' => [['line_id' => $linea, 'received_qty' => 11, 'difference_reason' => 'Contado de más']]])
            ->assertStatus(422)->assertJsonPath('code', 'RN-ALM-11');
        $l2->postJson("/api/v1/alm/transferencias/{$tr['id']}/recibir", ['lines' => [['line_id' => $linea, 'received_qty' => 9, 'difference_reason' => 'Paquete roto en el viaje']]])
            ->assertOk()->assertJsonPath('status', 'RECEIVED_WITH_DIFF');

        $this->assertEquals(9, $this->saldo('CAM-L2', 'M3-CHO-1K', $lot)->qty);
        $m = DB::table('stock_waste_records')->where('lot_id', $lot)->first();
        $this->assertEquals(1, $m->qty);
        $this->assertSame('TRAN', DB::table('waste_reasons')->where('id', $m->reason_id)->value('code'));
        $this->assertEquals(18, $m->actual_cost);
    }

    public function test_rn_alm_13_la_merma_descuenta_al_aprobarse_y_sobre_el_umbral_la_aprueba_otra_persona_con_permiso(): void
    {
        $lot = $this->lote('DG-CUY-ENT', 'L-CUY-UMB', now()->addDays(6)->toDateString());
        $this->entrada('CAM-L1', 'DG-CUY-ENT', $lot, 10, 30);
        $this->usuario();
        $venc = DB::table('waste_reasons')->where('code', 'VENC')->first();
        $this->assertTrue((bool) $venc->counts_as_expired);
        $datos = ['warehouse_id' => $this->almacen('CAM-L1'), 'variant_id' => $this->variante('DG-CUY-ENT')->id, 'lot_id' => $lot, 'reason_id' => $venc->id];

        // 2 × S/ 30 = S/ 60 (bajo el umbral de S/ 100): no la aprueba quien la pidió, sí otra persona del módulo.
        $chica = $this->como(self::ALMACENERO)->postJson('/api/v1/alm/mermas', $datos + ['qty' => 2])->assertCreated()->json();
        $this->assertEquals(60, $chica['estimated_cost']);
        $this->como(self::ALMACENERO)->postJson("/api/v1/alm/mermas/{$chica['id']}/aprobar")->assertStatus(422)->assertJsonPath('code', 'RN-ALM-13');

        // 5 × S/ 30 = S/ 150 (sobre el umbral): sin alm.waste.approve no; con él, sí.
        $grande = $this->como(self::ADMIN)->postJson('/api/v1/alm/mermas', $datos + ['qty' => 5])->assertCreated()->json();
        $this->como(self::ALMACENERO)->postJson("/api/v1/alm/mermas/{$grande['id']}/aprobar")->assertStatus(422)->assertJsonPath('code', 'RN-ALM-13');
        $this->assertEquals(10, $this->saldo('CAM-L1', 'DG-CUY-ENT', $lot)->qty);
        $this->como(self::GERENTE)->postJson("/api/v1/alm/mermas/{$grande['id']}/aprobar")->assertOk()->assertJsonPath('status', 'APPROVED');
        $this->como(self::ADMIN)->postJson("/api/v1/alm/mermas/{$chica['id']}/aprobar")->assertOk();
        $this->assertEquals(3, $this->saldo('CAM-L1', 'DG-CUY-ENT', $lot)->qty);

        $kpi = $this->como(self::GERENTE)->getJson('/api/v1/alm/kpi?from=2026-11-01&to=2026-11-30')->assertOk()->json();
        $this->assertEquals(210, $kpi['KPI-ALM-03']['value'], 'Los vencidos cuentan en KPI-ALM-03');
        $this->assertContains('Vencido', array_column($kpi['KPI-ALM-02']['by_reason'], 'label'));
    }

    public function test_rn_alm_15_alerta_diaria_separada_en_3_y_7_dias_sin_duplicar(): void
    {
        $tres = $this->lote('DG-CUY-ENT', 'L-CUY-D3', now()->addDays(2)->toDateString());
        $siete = $this->lote('DG-CUY-ENT', 'L-CUY-D7', now()->addDays(6)->toDateString());
        $lejos = $this->lote('DG-CUY-ENT', 'L-CUY-D30', now()->addDays(30)->toDateString());
        foreach ([$tres, $siete, $lejos] as $l) {
            $this->entrada('CAM-L2', 'DG-CUY-ENT', $l, 2, 25);   // el almacenero del Local 2 ve solo su local
        }
        $api = $this->como(self::ALMACENERO_L2);
        $filas = collect($api->getJson('/api/v1/alm/alertas')->assertOk()->json('data'))->keyBy('lot_code');
        $this->assertSame('D3', $filas['L-CUY-D3']['bucket']);
        $this->assertSame('D7', $filas['L-CUY-D7']['bucket']);
        $this->assertFalse($filas->has('L-CUY-D30'));
        $this->assertSame('50.00', $filas['L-CUY-D3']['value']);

        $this->artisan('alm:alertas-vencimiento')->assertSuccessful();
        $this->usuario();
        $hoy = DB::table('stock_expiry_alerts')->where('alert_date', now()->toDateString());
        $n = (clone $hoy)->count();
        $this->assertSame('D3', (clone $hoy)->where('lot_id', $tres)->value('bucket'));
        $this->artisan('alm:alertas-vencimiento')->assertSuccessful();
        $this->usuario();
        $this->assertSame($n, DB::table('stock_expiry_alerts')->where('alert_date', now()->toDateString())->count(), 'La segunda corrida del día no duplica');
        $this->assertSame(1, DB::table('domain_events')->where('event_name', 'stock.expiring')->whereRaw("payload->>'date' = ?", [now()->toDateString()])->count());
    }

    public function test_rn_alm_16_no_se_mueve_stock_con_fecha_de_un_periodo_cerrado(): void
    {
        $this->usuario();
        $this->assertSame('CLOSED', DB::table('accounting_periods')->where('period', '2026-08-01')->value('status'));
        $this->falla('RN-ALM-16', fn () => InventarioService::mover(['type' => 'RECEIPT', 'warehouse_id' => $this->almacen('ALM-L1'),
            'variant_id' => $this->variante('M3-CHO-1K')->id, 'lot_id' => $this->lote('M3-CHO-1K', 'L-CHO-AGO', '2026-12-01'), 'qty' => 1,
            'moved_at' => '2026-08-20 10:00', 'source_type' => 'TEST', 'reason' => 'x'], $this->usuario()));
        // Un mes abierto (o sin registro, como noviembre) sí admite movimientos.
        $this->entrada('ALM-L1', 'M3-CHO-1K', $this->lote('M3-CHO-1K', 'L-CHO-NOV', '2026-12-01'), 1);
    }

    /* ------------------------------------------------------------ más */

    public function test_reverso_corrige_el_kardex_una_sola_vez(): void
    {
        $lot = $this->lote('M3-CHO-1K', 'L-CHO-REV', now()->addDays(20)->toDateString());
        $this->entrada('ALM-L1', 'M3-CHO-1K', $lot, 4);
        $this->usuario();
        $mov = DB::table('stock_movements')->where('lot_id', $lot)->value('id');
        $api = $this->como(self::ADMIN);
        $api->postJson("/api/v1/alm/kardex/{$mov}/reversar", ['reason' => 'Ingreso registrado por error'])->assertOk();
        $this->assertEquals(0, $this->saldo('ALM-L1', 'M3-CHO-1K', $lot)->qty);
        $api->postJson("/api/v1/alm/kardex/{$mov}/reversar", ['reason' => 'Ingreso registrado por error'])->assertStatus(422)->assertJsonPath('code', 'RN-ALM-01');
    }

    public function test_cada_empresa_ve_solo_su_stock_y_no_mueve_almacenes_ajenos(): void
    {
        $this->usuario();
        $whDg = $this->almacen('CAM-L1');
        $cs = $this->como('hsalas@carnesselectas.pe', self::CS);
        $this->assertSame(0, $cs->getJson('/api/v1/alm/stock')->assertOk()->json('total'));
        $this->assertSame([], $cs->getJson('/api/v1/alm/almacenes')->json('data'));
        $this->assertGreaterThan(0, $this->como(self::GERENTE)->getJson('/api/v1/alm/stock')->json('total'));

        $u = $this->usuario('hsalas@carnesselectas.pe', self::CS);
        $this->falla('RN-ALM-01', fn () => InventarioService::mover(['type' => 'RECEIPT', 'warehouse_id' => $whDg,
            'variant_id' => DB::table('product_variants')->value('id'), 'qty' => 1, 'source_type' => 'TEST', 'reason' => 'x'], $u));
    }

    public function test_el_alcance_por_local_tambien_limita_las_escrituras(): void
    {
        $lot = $this->lote('DG-CUY-ENT', 'L-CUY-ALC', now()->addDays(6)->toDateString());
        $this->entrada('CAM-L1', 'DG-CUY-ENT', $lot, 5);
        $this->usuario();
        $merma = ['warehouse_id' => $this->almacen('CAM-L1'), 'variant_id' => $this->variante('DG-CUY-ENT')->id, 'lot_id' => $lot,
            'reason_id' => DB::table('waste_reasons')->where('code', 'CORT')->value('id'), 'qty' => 1];
        $l2 = $this->como(self::ALMACENERO_L2);

        // El almacenero de L2 ve la lista filtrada, pero tampoco puede escribir sobre un almacén de L1 aunque conozca su id.
        $l2->postJson('/api/v1/alm/mermas', $merma)->assertStatus(422)->assertJsonPath('code', 'RN-ALM-01');
        $l2->postJson('/api/v1/alm/conteos', ['warehouse_id' => $this->almacen('CAM-L1')])->assertStatus(422)->assertJsonPath('code', 'RN-ALM-01');
        $l2->postJson('/api/v1/alm/transferencias', ['from_warehouse_id' => $this->almacen('CAM-L1'), 'to_warehouse_id' => $this->almacen('CAM-L2'),
            'lines' => [['variant_id' => $merma['variant_id'], 'lot_id' => $lot, 'qty' => 1]]])->assertStatus(422)->assertJsonPath('code', 'RN-ALM-01');
        $this->falla('RN-ALM-01', fn () => InventarioService::mover(['type' => 'WASTE', 'warehouse_id' => $this->almacen('CAM-L1'), 'variant_id' => $merma['variant_id'],
            'lot_id' => $lot, 'qty' => 1, 'source_type' => 'TEST', 'reason' => 'x', 'allow_unreleased' => true], $this->usuario(self::ALMACENERO_L2)));

        // El almacenero de L1 sí puede, y quien no tiene alcance limitado (gerente) también.
        $this->como(self::ALMACENERO)->postJson('/api/v1/alm/mermas', $merma)->assertCreated();
        $this->como(self::GERENTE)->postJson('/api/v1/alm/mermas', $merma)->assertCreated();
    }

    public function test_las_fichas_por_id_respetan_el_alcance_por_local(): void
    {
        $this->usuario();
        $wh = $this->almacen('CAM-L1');
        $saldo = DB::table('stock_balances')->where('warehouse_id', $wh)->value('id');
        $mov = DB::table('stock_movements')->where('warehouse_id', $wh)->value('id');
        $pedido = DB::table('sales_orders')->where('establishment_id', DB::table('warehouses')->where('id', $wh)->value('establishment_id'))
            ->whereIn('status', ['CONFIRMED', 'IN_PREPARATION', 'WEIGHED', 'READY'])->value('id');

        // El almacenero del Local 2 no abre fichas del Local 1 aunque conozca el id, ni reintenta sus reservas.
        $l2 = $this->como(self::ALMACENERO_L2);
        $l2->getJson("/api/v1/alm/almacenes/{$wh}")->assertNotFound();
        $l2->getJson("/api/v1/alm/stock/{$saldo}")->assertNotFound();
        $l2->getJson("/api/v1/alm/kardex/{$mov}")->assertNotFound();
        $this->assertNotNull($pedido, 'La demo tiene pedidos en curso del Local 1');
        $l2->getJson("/api/v1/alm/reservas/pedidos/{$pedido}")->assertNotFound();
        $l2->postJson("/api/v1/alm/reservas/pedidos/{$pedido}/reintentar")->assertNotFound();

        // El del Local 1 sí.
        $l1 = $this->como(self::ALMACENERO);
        $l1->getJson("/api/v1/alm/almacenes/{$wh}")->assertOk();
        $l1->getJson("/api/v1/alm/stock/{$saldo}")->assertOk();
        $l1->getJson("/api/v1/alm/kardex/{$mov}")->assertOk();
    }

    public function test_los_costos_solo_se_ven_con_permiso(): void
    {
        $fila = $this->como(self::ALMACENERO)->getJson('/api/v1/alm/stock?per_page=1')->assertOk()->json('data.0');
        $this->assertNull($fila['avg_cost']);
        $this->assertNotNull($this->como(self::ADMIN)->getJson('/api/v1/alm/stock?per_page=1')->json('data.0.avg_cost'));
    }

    public function test_liberar_una_reserva_a_mano_exige_permiso_y_motivo(): void
    {
        $this->usuario();
        $r = DB::table('stock_reservations')->where('status', 'ACTIVE')->orderBy('order_number')->first();
        $this->como('jsalas@donguando.pe')->postJson("/api/v1/alm/reservas/{$r->id}/liberar", ['reason' => 'Cliente canceló'])->assertStatus(403);
        $api = $this->como('pleon@donguando.pe');
        $api->postJson("/api/v1/alm/reservas/{$r->id}/liberar", ['reason' => 'x'])->assertStatus(422);
        $api->postJson("/api/v1/alm/reservas/{$r->id}/liberar", ['reason' => 'Cliente pidió cambiar el producto'])->assertOk();
        $this->usuario();
        $this->assertSame('RELEASED', DB::table('stock_reservations')->where('id', $r->id)->value('status'));
    }

    public function test_las_pantallas_responden_con_datos_de_demo(): void
    {
        $api = $this->como(self::GERENTE);
        foreach (['/api/v1/alm/almacenes', '/api/v1/alm/opciones', '/api/v1/alm/stock/resumen', '/api/v1/alm/kardex', '/api/v1/alm/recepciones', '/api/v1/alm/lotes',
            '/api/v1/alm/transferencias', '/api/v1/alm/conteos', '/api/v1/alm/mermas', '/api/v1/alm/reservas', '/api/v1/alm/alertas', '/api/v1/alm/motivos',
            '/api/v1/alm/kpi', '/api/v1/alm/variantes?q=cuy'] as $url) {
            $api->getJson($url)->assertOk();
        }
        $this->assertSame(5, $api->getJson('/api/v1/alm/recepciones')->json('total'));
        $this->assertSame(8, count($api->getJson('/api/v1/alm/motivos')->json('data')));
    }

    public function test_las_cifras_y_fichas_de_cada_pantalla_responden(): void
    {
        $api = $this->como(self::GERENTE);
        foreach (['01', '03', '04', '05', '07', '08', '09', '10', '12', '13'] as $p) {
            $api->getJson("/api/v1/alm/cifras/{$p}")->assertOk();
        }
        foreach (['/api/v1/alm/temperaturas', '/api/v1/alm/lotes/historial', '/api/v1/alm/transito', '/api/v1/alm/reservas/pedidos', '/api/v1/alm/reservas/faltantes'] as $url) {
            $api->getJson($url)->assertOk();
        }
        $this->usuario();
        $w = $this->almacen('ALM-L1');
        $b = DB::table('stock_balances')->where('qty', '>', 0)->value('id');
        $m = DB::table('stock_movements')->where('source_type', 'STOCK_TRANSFER')->value('id');
        $o = DB::table('stock_reservations')->where('status', 'ACTIVE')->value('order_id');
        $api->getJson("/api/v1/alm/almacenes/{$w}")->assertOk()->assertJsonPath('code', 'ALM-L1');
        $api->getJson("/api/v1/alm/stock/{$b}")->assertOk()->assertJsonStructure(['reservations', 'movements']);
        $this->assertNotNull($api->getJson("/api/v1/alm/kardex/{$m}")->assertOk()->json('document'));
        $api->getJson("/api/v1/alm/reservas/pedidos/{$o}")->assertOk()->assertJsonStructure(['reservations', 'short']);
        $this->assertGreaterThan(0, $api->getJson('/api/v1/alm/cifras/10')->json('orders'));
    }

    public function test_rn_alm_02_cuarentena_transito_y_vehiculo_no_venden(): void
    {
        $this->usuario();
        $local = DB::table('warehouses')->where('code', 'ALM-L1')->value('establishment_id');
        $this->como(self::GERENTE)->postJson('/api/v1/alm/almacenes', ['code' => 'CUA-NUEVA', 'name' => 'Cuarentena nueva', 'wh_type' => 'QUARANTINE',
            'establishment_id' => $local, 'allows_sale' => true])->assertStatus(422)->assertJsonPath('code', 'RN-ALM-02');
    }

    public function test_el_kardex_solo_reversa_ingresos_ajustes_y_mermas(): void
    {
        $this->usuario();
        $venta = DB::table('stock_movements')->where('movement_type', 'SALE')->value('id');
        $this->como(self::ADMIN)->postJson("/api/v1/alm/kardex/{$venta}/reversar", ['reason' => 'Venta registrada por error'])
            ->assertStatus(422)->assertJsonPath('code', 'RN-ALM-01');
    }

    public function test_la_promocion_avisa_a_marketing_y_ventas_y_la_alerta_diaria_tambien_a_ventas(): void
    {
        $lot = $this->lote('M3-CHO-1K', 'L-CHO-PRO', now()->addDays(2)->toDateString());
        $this->entrada('ALM-L1', 'M3-CHO-1K', $lot, 5);
        $this->como(self::GERENTE)->postJson("/api/v1/alm/alertas/{$lot}/promocion")->assertOk();
        // El mismo día no se repite el aviso.
        $this->como(self::GERENTE)->postJson("/api/v1/alm/alertas/{$lot}/promocion")->assertUnprocessable()->assertJsonPath('code', 'RN-ALM-15');
        $this->usuario();
        $this->assertSame(2, DB::table('notifications')->where('type', 'stock.promo_suggested')->whereIn('role', ['MARKETING', 'VENDEDORA'])->count());
        AlertasService::generarDiarias();
        $this->assertTrue(DB::table('notifications')->where('type', 'stock.expiring')->where('role', 'SUPERVISORA_VENTAS')->exists());
    }
}
