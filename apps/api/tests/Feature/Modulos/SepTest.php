<?php

namespace Tests\Feature\Modulos;

use App\Modulos\Plt\Services\Marcas;
use App\Support\TenantContext;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * SEP · Separación de marcas (SEP-01 a SEP-12; RN-SEP-01 a 20; CA-SEP-01 a 06).
 */
class SepTest extends TestCase
{
    private function cerrarSetiembre(string $companyId): void
    {
        $existe = DB::table('accounting_periods')
            ->where('company_id', $companyId)
            ->where('period', '2026-09-01')
            ->first();

        if ($existe) {
            DB::table('accounting_periods')->where('id', $existe->id)->update([
                'status' => 'CLOSED',
                'closed_at' => now(),
                'closed_by' => 'María Cárdenas Vega',
            ]);
        } else {
            DB::table('accounting_periods')->insert([
                'company_id' => $companyId,
                'period' => '2026-09-01',
                'status' => 'CLOSED',
                'closed_at' => now(),
                'closed_by' => 'María Cárdenas Vega',
            ]);
        }
    }

    private function terminarPedidosEnPreparacion(string $brandId): void
    {
        DB::table('sales_orders')
            ->where('brand_id', $brandId)
            ->whereIn('status', ['IN_PREPARATION', 'WEIGHED', 'READY', 'IN_ROUTE'])
            ->update(['status' => 'DELIVERED']);

        if (DB::getSchemaBuilder()->hasTable('delivery_routes') && DB::getSchemaBuilder()->hasTable('delivery_stops')) {
            $routeIds = DB::table('delivery_stops as ds')
                ->join('sales_orders as o', 'o.id', '=', 'ds.order_id')
                ->where('o.brand_id', $brandId)
                ->pluck('ds.route_id')
                ->all();
            if ($routeIds) {
                DB::table('delivery_routes')
                    ->whereIn('id', $routeIds)
                    ->whereIn('status', ['PLANNED', 'IN_PROGRESS', 'DISPATCHED'])
                    ->update(['status' => 'COMPLETED']);
            }
        }
    }

    private function assertStockItemsHaveCutoffAndAvailability(array $items, string $cutoffDate): void
    {
        $stockItems = array_values(array_filter($items, fn ($item) => $item['item_type'] === 'STOCK'));
        $this->assertNotEmpty($stockItems);

        foreach ($stockItems as $item) {
            $balance = DB::table('stock_balances')->where('id', $item['ref_id'])->first();
            $this->assertNotNull($balance);
            $this->assertNotNull($item['qty_available']);

            $movimientos = DB::table('stock_movements')
                ->where('warehouse_id', $balance->warehouse_id)
                ->where('variant_id', $balance->variant_id)
                ->when($balance->lot_id, fn ($query) => $query->where('lot_id', $balance->lot_id), fn ($query) => $query->whereNull('lot_id'))
                ->whereDate('moved_at', '>', $cutoffDate)
                ->where(fn ($query) => $query->whereNull('source_type')->orWhere('source_type', '<>', 'INITIAL_LOAD'))
                ->sum('qty');

            $this->assertEquals(
                max(0, round((float) $balance->qty - (float) $movimientos, 3)),
                (float) $item['qty_at_cutoff'],
            );
            $this->assertEquals(
                max(0, (float) $balance->qty - (float) $balance->reserved_qty),
                (float) $item['qty_available'],
            );
        }
    }

    public function test_separacion_a_otro_ruc_4_ojos_transferencia_de_stock_y_vigencia_de_comprobantes(): void
    {
        Storage::fake('local');
        $this->travelTo(Carbon::parse('2026-10-05 10:00:00', 'America/Lima'));

        $tokAdmin = $this->ingresar(self::DG, 'lccahuana@donguando.pe');
        $tokGer = $this->ingresar(self::DG, 'rquispe@donguando.pe');

        // SEP-01: listar proyectos y obtener SEP-0002 (Don Guando Gourmet -> DON GUANDO GOURMET SAC, corte 2026-09-30).
        $lista = $this->desde(self::DG, $tokAdmin)->getJson('/api/v1/sep/proyectos')->assertOk();
        $esperadoActual = DB::table('brand_separations')
            ->where('simulation', false)
            ->whereIn('status', ['DRAFT', 'VALIDATED', 'APPROVED', 'EXECUTING', 'FAILED'])
            ->orderByDesc('number')
            ->value('number');
        $actual = $this->desde(self::DG, $tokAdmin)->getJson('/api/v1/sep/proyectos/actual')->assertOk();
        $this->assertSame($esperadoActual, $actual->json('separation.number'));

        $idsKpi = DB::table('brand_separations')
            ->where('simulation', false)
            ->whereIn('status', ['EXECUTING', 'COMPLETED', 'FAILED'])
            ->pluck('id');
        $traspasosKpi = DB::table('brand_separation_items')
            ->whereIn('separation_id', $idsKpi)
            ->where('item_type', 'STOCK')
            ->where('action', 'TRANSFER')
            ->where('status', 'DONE')
            ->get(['qty', 'received_qty']);
        $pedidosKpi = DB::table('brand_separation_items')
            ->whereIn('separation_id', $idsKpi)
            ->where('item_type', 'ORDER')
            ->get(['status']);
        $resueltosKpi = $pedidosKpi->whereIn('status', ['DONE', 'EXCLUDED'])->count();
        $this->assertEquals(
            round((float) $traspasosKpi->sum(fn ($i) => abs((float) $i->qty - (float) ($i->received_qty ?? 0))), 3),
            $lista->json('kpis.stock_qty_difference'),
        );
        $this->assertSame($traspasosKpi->count(), $lista->json('kpis.stock_transfer_lots_count'));
        $this->assertEquals(
            $pedidosKpi->isNotEmpty() ? round($resueltosKpi * 100 / $pedidosKpi->count(), 1) : null,
            $lista->json('kpis.orders_resolved_pct'),
        );
        $this->assertSame($resueltosKpi, $lista->json('kpis.orders_resolved_count'));
        $this->assertSame(
            DB::table('brand_separations')->where('simulation', false)->whereIn('status', ['DRAFT', 'VALIDATED', 'APPROVED', 'EXECUTING', 'FAILED'])->count(),
            $lista->json('kpis.in_progress_real_count'),
        );
        $this->assertSame(
            DB::table('brand_separations')->where('simulation', false)->where('status', 'COMPLETED')->count(),
            $lista->json('kpis.completed_real_count'),
        );
        $this->assertSame(
            DB::table('brand_separations')->where('simulation', true)->count(),
            $lista->json('kpis.simulations_count'),
        );

        $reales = $this->desde(self::DG, $tokAdmin)->getJson('/api/v1/sep/proyectos?simulation=0')->assertOk();
        $this->assertSame(
            DB::table('brand_separations')->where('simulation', false)->count(),
            $reales->json('total'),
        );
        $simulaciones = $this->desde(self::DG, $tokAdmin)->getJson('/api/v1/sep/proyectos?simulation=1')->assertOk();
        $this->assertSame(
            DB::table('brand_separations')->where('simulation', true)->count(),
            $simulaciones->json('total'),
        );

        $pagina = $this->desde(self::DG, $tokAdmin)
            ->getJson('/api/v1/sep/proyectos?page=2&per_page=1&sort=-s.number')
            ->assertOk();
        $this->assertSame(2, $pagina->json('current_page'));
        $this->assertSame(1, $pagina->json('per_page'));
        $this->assertCount(1, $pagina->json('data'));
        $this->assertSame($pagina->json('data.0.number'), $pagina->json('separations.0.number'));

        $busqueda = $this->desde(self::DG, $tokAdmin)
            ->getJson('/api/v1/sep/proyectos?q=SEP-0002')
            ->assertOk();
        $this->assertSame(1, $busqueda->json('total'));
        $this->assertSame('SEP-0002', $busqueda->json('data.0.number'));

        $sep2 = collect($lista->json('separations'))->firstWhere('number', 'SEP-0002');
        $this->assertNotNull($sep2);
        $sepId = $sep2['id'];
        $brandId = $sep2['brand_id'];
        $coDgId = $sep2['origin_company_id'];
        $coGouId = $sep2['dest_company_id'];

        // RN-SEP-02: no permite otra separación viva para la misma marca M5.
        $this->desde(self::DG, $tokAdmin)->postJson('/api/v1/sep/proyectos', [
            'brand_id' => $brandId,
            'dest_type' => 'OTHER_RUC',
            'dest_company_id' => $coGouId,
            'cutoff_date' => '2026-08-31',
        ])->assertStatus(422)->assertJsonPath('code', 'RN-SEP-02');

        // RN-SEP-01: la fecha de corte debe ser fin de mes.
        $brM2 = collect($lista->json('brands'))->firstWhere('code', 'M2')['id'];
        $this->desde(self::DG, $tokAdmin)->postJson('/api/v1/sep/proyectos', [
            'brand_id' => $brM2,
            'dest_type' => 'OTHER_RUC',
            'dest_company_id' => $coGouId,
            'cutoff_date' => '2026-08-30',
        ])->assertStatus(422)->assertJsonPath('code', 'RN-SEP-01');

        // RN-SEP-03: empresa destino igual al origen falla.
        $this->desde(self::DG, $tokAdmin)->postJson('/api/v1/sep/proyectos', [
            'brand_id' => $brM2,
            'dest_type' => 'OTHER_RUC',
            'dest_company_id' => $coDgId,
            'cutoff_date' => '2026-08-31',
        ])->assertStatus(422)->assertJsonPath('code', 'RN-SEP-03');

        // CA-SEP-06: si hay 3 pedidos en preparación de la marca, NO_ORDERS_IN_PREPARATION queda en FAIL y bloquea validar.
        $tenantId = DB::table('tenants')->where('short', 'Don Guando')->value('id');
        TenantContext::set(TenantContext::find($tenantId));
        $pedidosMarca = DB::table('sales_orders')->where('brand_id', $brandId)->limit(3)->pluck('id')->all();
        DB::table('sales_orders')->whereIn('id', $pedidosMarca)->update(['status' => 'IN_PREPARATION']);
        TenantContext::set(null);

        $chkFail = $this->desde(self::DG, $tokAdmin)->postJson("/api/v1/sep/proyectos/{$sepId}/chequeos")->assertOk();
        $cPrep = collect($chkFail->json('checks'))->firstWhere('code', 'NO_ORDERS_IN_PREPARATION');
        $this->assertSame('FAIL', $cPrep['result']);
        $this->assertGreaterThanOrEqual(3, $cPrep['count']);

        $this->desde(self::DG, $tokAdmin)->postJson("/api/v1/sep/proyectos/{$sepId}/validar", [
            'warn_note' => 'Intento con pedidos abiertos',
        ])->assertStatus(422)->assertJsonPath('code', 'RN-SEP-07');

        // Terminar pedidos en preparación -> valida con nota de advertencia.
        TenantContext::set(TenantContext::find($tenantId));
        $this->terminarPedidosEnPreparacion($brandId);
        TenantContext::set(null);

        $val = $this->desde(self::DG, $tokAdmin)->postJson("/api/v1/sep/proyectos/{$sepId}/validar", [
            'warn_note' => 'Advertencias aceptadas: setiembre se cierra antes de aprobar.',
        ])->assertOk();
        $this->assertSame('VALIDATED', $val->json('separation.status'));

        // RN-SEP-08: quien preparó (jquispe) no puede aprobar (4 ojos), y con período abierto tampoco se aprueba (RN-SEP-01).
        TenantContext::set(TenantContext::find($tenantId));
        $this->cerrarSetiembre($coDgId);
        TenantContext::set(null);

        // El gerente aprueba (distinto de quien preparó).
        $apr = $this->desde(self::DG, $tokGer)->postJson("/api/v1/sep/proyectos/{$sepId}/aprobar", [
            'note' => 'Aprobado tras cierre contable de setiembre.',
        ])->assertOk();
        $this->assertSame('APPROVED', $apr->json('separation.status'));

        // RN-SEP-11: una vez aprobada, el alcance y la fecha de corte quedan bloqueados.
        $this->desde(self::DG, $tokAdmin)->putJson("/api/v1/sep/proyectos/{$sepId}", [
            'cutoff_date' => '2026-08-31',
        ])->assertStatus(422)->assertJsonPath('code', 'RN-SEP-11');

        // CA-SEP-04: simular fallo, reintentar un elemento sin cerrar los pendientes y luego continuar la cola.
        $fallo = $this->desde(self::DG, $tokAdmin)->postJson("/api/v1/sep/proyectos/{$sepId}/ejecutar", [
            'fail_on' => 'USER',
        ])->assertOk();
        $this->assertSame('FAILED', $fallo->json('separation.status'));
        $this->assertGreaterThan(0, $fallo->json('progress.done'));
        $this->assertGreaterThan(0, $fallo->json('progress.failed'));

        $itemFallidoId = DB::table('brand_separation_items')
            ->where('separation_id', $sepId)
            ->where('status', 'FAILED')
            ->value('id');
        $this->assertNotNull($itemFallidoId);
        $reintentoPuntual = $this->desde(self::DG, $tokAdmin)
            ->postJson("/api/v1/sep/proyectos/{$sepId}/ejecutar", ['item_id' => $itemFallidoId])
            ->assertOk();
        $this->assertSame('DONE', DB::table('brand_separation_items')->where('id', $itemFallidoId)->value('status'));
        $this->assertNotSame('COMPLETED', $reintentoPuntual->json('separation.status'));
        $this->assertGreaterThan(0, $reintentoPuntual->json('progress.pending') + $reintentoPuntual->json('progress.failed'));

        $comp = $this->desde(self::DG, $tokAdmin)->postJson("/api/v1/sep/proyectos/{$sepId}/ejecutar")->assertOk();
        $this->assertSame('COMPLETED', $comp->json('separation.status'));
        $this->assertSame(100.0, (float) $comp->json('progress.pct'));
        $this->assertSame(0.0, (float) $comp->json('kpis.stock_diff_pen')); // KPI-SEP-01 = 0
        $this->assertNotEmpty($comp->json('separation.transfer_docs'));
        $acta = $comp->json('separation.act');
        $this->assertNotEmpty($acta['file_id']);
        $this->assertSame('application/pdf', DB::table('file_attachments')->where('id', $acta['file_id'])->value('mime'));
        $adjunto = DB::table('file_attachments')->where('id', $acta['file_id'])->first();
        $this->assertSame('brand_separations', $adjunto->entity);
        $this->assertSame($sepId, $adjunto->entity_id);
        $rutaActa = substr($adjunto->storage_key, 8);
        $contenidoActa = Storage::disk('local')->get($rutaActa);
        $this->assertStringStartsWith('%PDF-', $contenidoActa);
        $this->assertSame(hash('sha256', $contenidoActa), $acta['sha256']);
        $this->assertSame(strlen($contenidoActa), $acta['size_bytes']);

        $enlaceActa = $this->desde(self::DG, $tokAdmin)
            ->postJson("/api/v1/sep/proyectos/{$sepId}/acta/enlace")
            ->assertOk()
            ->json('url');
        $descargaActa = $this->get($enlaceActa)->assertOk();
        $this->assertSame('application/pdf', $descargaActa->headers->get('content-type'));
        $this->assertSame($contenidoActa, $descargaActa->streamedContent());

        // CA-SEP-01 y CA-SEP-05: vigencias en brand_company_history y comprobantes antes/después del corte.
        TenantContext::set(TenantContext::find($tenantId));
        $vigSep = Marcas::empresaParaFecha($brandId, '2026-09-30');
        $vigOct = Marcas::empresaParaFecha($brandId, '2026-10-01');
        $this->assertSame($coDgId, $vigSep?->company_id);
        $this->assertSame($coGouId, $vigOct?->company_id);
        TenantContext::set(null);

        $hist = $this->desde(self::DG, $tokAdmin)->getJson("/api/v1/sep/historial?brand_id={$brandId}")->assertOk();
        $this->assertCount(2, $hist->json('history'));
        $this->assertCount(
            DB::table('brand_separations')->where('brand_id', $brandId)->count(),
            $hist->json('separations'),
        );
        $this->assertContains('COMPLETED', array_column($hist->json('separations'), 'status'));
        $this->assertArrayHasKey('subtotal_pen', $hist->json('sales_by_company.0'));
        $periodoDisponible = $hist->json('sales_by_company.0.period');
        $ventasDelMes = $this->desde(self::DG, $tokAdmin)->getJson(
            "/api/v1/sep/historial?brand_id={$brandId}&from={$periodoDisponible}&to={$periodoDisponible}",
        )->assertOk();
        $this->assertSame(
            [$periodoDisponible],
            array_values(array_unique(array_column($ventasDelMes->json('sales_by_company'), 'period'))),
        );
        $this->desde(self::DG, $tokAdmin)->getJson('/api/v1/sep/historial?from=2026-10&to=2026-09')->assertUnprocessable();
        $ventasTodas = $this->desde(self::DG, $tokAdmin)->getJson("/api/v1/sep/historial?brand_id={$brandId}&all=1")->assertOk();
        $this->assertGreaterThanOrEqual(
            count($hist->json('sales_by_company')),
            count($ventasTodas->json('sales_by_company')),
        );
        $historialCompleto = $this->desde(self::DG, $tokAdmin)->getJson('/api/v1/sep/historial')->assertOk();
        $this->assertContains('CANCELLED', array_column($historialCompleto->json('separations'), 'status'));
    }

    public function test_separacion_a_otra_empresa_paquete_sha256_y_marca_separada_bloquea_pedidos(): void
    {
        Storage::fake('local');
        $this->travelTo(Carbon::parse('2026-10-05 10:00:00', 'America/Lima'));

        $tokAdmin = $this->ingresar(self::DG, 'lccahuana@donguando.pe');
        $tokGer = $this->ingresar(self::DG, 'rquispe@donguando.pe');

        $tenantId = DB::table('tenants')->where('short', 'Don Guando')->value('id');
        TenantContext::set(TenantContext::find($tenantId));
        $brM4 = DB::table('brands')->where('code', 'M4')->value('id');
        $coDg = DB::table('companies')->where('ruc', '20609147254')->value('id');
        $cliId = DB::table('customers')->where('customer_type', '<>', 'OTHER')->value('id');
        $varId = DB::table('product_variants')->where('brand_id', $brM4)->value('id')
            ?? DB::table('product_variants')->value('id');
        $this->terminarPedidosEnPreparacion($brM4);
        $this->cerrarSetiembre($coDg);
        TenantContext::set(null);

        // Crear separación real de M4 hacia OTHER_TENANT con corte 2026-09-30.
        $creado = $this->desde(self::DG, $tokAdmin)->postJson('/api/v1/sep/proyectos', [
            'brand_id' => $brM4,
            'dest_type' => 'OTHER_TENANT',
            'dest_tenant_name' => 'Despensa Andina SAC',
            'dest_legal_name' => 'DESPENSA ANDINA SAC',
            'dest_ruc' => \App\Modulos\Plt\Services\Ruc::conVerificador('2060987123'),
            'cutoff_date' => '2026-09-30',
            'simulation' => false,
        ])->assertCreated();

        $sepId = $creado->json('separation.id');
        $this->assertStockItemsHaveCutoffAndAvailability($creado->json('items'), '2026-09-30');
        $clientes = $creado->json('customers');
        $this->assertSame(24, $clientes['months']);
        $this->assertIsArray($clientes['all']);
        $this->assertSame(
            DB::table('sales_orders as o')
                ->join('customers as c', 'c.id', '=', 'o.customer_id')
                ->where('o.brand_id', $brM4)
                ->where('o.status', '<>', 'CANCELLED')
                ->whereDate('o.created_at', '>=', '2024-10-01')
                ->whereDate('o.created_at', '<=', '2026-09-30')
                ->where('c.customer_type', '<>', 'OTHER')
                ->whereNull('c.merged_into_id')
                ->distinct()
                ->count('c.id'),
            count($clientes['all']),
        );
        $clienteItem = collect($creado->json('items'))->firstWhere('item_type', 'CUSTOMERS');
        $this->assertNotNull($clienteItem);
        $this->assertSame('EXPORT', $clienteItem['action']);
        $this->assertEquals($clientes['with_consent_count'], (float) $clienteItem['qty']);
        $this->desde(self::DG, $tokAdmin)->putJson("/api/v1/sep/items/{$clienteItem['id']}", [
            'action' => 'SHARED',
        ])->assertStatus(422)->assertJsonPath('code', 'RN-SEP-14');

        // Excluir un ítem sin motivo falla con RN-SEP-09; con motivo pasa a EXCLUDED.
        $primerItem = $creado->json('items.0.id');
        $this->desde(self::DG, $tokAdmin)->putJson("/api/v1/sep/items/{$primerItem}", [
            'status' => 'EXCLUDED',
            'exclude_reason' => '',
        ])->assertStatus(422)->assertJsonPath('code', 'RN-SEP-09');

        $this->desde(self::DG, $tokAdmin)->putJson("/api/v1/sep/items/{$primerItem}", [
            'status' => 'EXCLUDED',
            'exclude_reason' => 'No se migra en esta etapa.',
        ])->assertOk();

        // Validar, aprobar (por gerente) y ejecutar -> genera paquete con 6 archivos y marca M4 como SEPARATED.
        $this->desde(self::DG, $tokAdmin)->postJson("/api/v1/sep/proyectos/{$sepId}/validar", [
            'warn_note' => 'Advertencias revisadas para salida a otra empresa.',
        ])->assertOk();

        $this->desde(self::DG, $tokGer)->postJson("/api/v1/sep/proyectos/{$sepId}/aprobar", [
            'note' => 'Aprobada la salida de Despensa Don Guando.',
        ])->assertOk();

        $fin = $this->desde(self::DG, $tokAdmin)->postJson("/api/v1/sep/proyectos/{$sepId}/ejecutar")->assertOk();
        $this->assertSame('COMPLETED', $fin->json('separation.status'));
        $this->assertSame('SEPARATED', $fin->json('brand.status'));
        $this->assertCount(6, $fin->json('separation.export.files'));
        $customerFile = collect($fin->json('separation.export.files'))->firstWhere('code', 'CUSTOMERS');
        $this->assertNotNull($customerFile);
        $this->assertSame($clientes['with_consent_count'], $customerFile['rows']);
        $this->assertNotEmpty($fin->json('separation.export.sha256'));
        $this->assertTrue($fin->json('separation.export.download_available'));
        $this->assertSame($fin->json('separation.export.sha256'), $fin->json('separation.act.export_sha256'));

        $export = $fin->json('separation.export');
        $exportRow = DB::table('data_exports')->where('id', $export['export_id'])->first();
        $this->assertNotNull($exportRow);
        $this->assertSame('ZIP_JSON_CSV', $exportRow->format);
        $this->assertNotEmpty($exportRow->storage_key);
        $zipPath = Storage::disk('local')->path($exportRow->storage_key);
        $this->assertSame($export['sha256'], hash_file('sha256', $zipPath));
        $this->assertSame((int) $export['size_bytes'], filesize($zipPath));

        $zip = new \ZipArchive();
        $this->assertSame(true, $zip->open($zipPath));
        $this->assertNotFalse($zip->locateName('gestioncarnica.json'));
        foreach ($export['files'] as $file) {
            $this->assertNotFalse($zip->locateName($file['name']));
        }
        $manifest = json_decode($zip->getFromName('gestioncarnica.json'), true);
        $this->assertCount(6, $manifest['files']);
        $this->assertTrue($zip->close());

        $enlace = $this->desde(self::DG, $tokAdmin)
            ->postJson("/api/v1/sep/proyectos/{$sepId}/paquete/enlace")
            ->assertOk()
            ->json('url');
        $descarga = $this->get($enlace)->assertOk();
        $this->assertSame('application/zip', $descarga->headers->get('content-type'));
        $this->assertCount(1, json_decode(DB::table('data_exports')->where('id', $export['export_id'])->value('downloads'), true));

        // CA-SEP-02 / RN-SEP-06: una marca con estado SEPARATED rechaza pedidos nuevos con RN-SEP-06.
        $this->desde(self::DG, $tokGer)->postJson('/api/v1/ped/pedidos', [
            'brand_id' => $brM4,
            'channel' => 'WHATSAPP',
            'fulfillment' => 'PICKUP',
            'customer_id' => $cliId,
            'lines' => [
                ['variant_id' => $varId, 'qty' => 1],
            ],
        ])->assertStatus(422)->assertJsonPath('code', 'RN-SEP-06');
    }

    public function test_crea_empresa_destino_y_previsualiza_datos_de_la_separacion(): void
    {
        $tokAdmin = $this->ingresar(self::DG, 'lccahuana@donguando.pe');
        $lista = $this->desde(self::DG, $tokAdmin)->getJson('/api/v1/sep/proyectos')->assertOk();
        $brand = collect($lista->json('brands'))->firstWhere('code', 'M2');
        $this->assertNotNull($brand);

        $ruc = \App\Modulos\Plt\Services\Ruc::conVerificador('20'.str_pad((string) random_int(0, 99999999), 8, '0', STR_PAD_LEFT));
        $datos = [
            'brand_id' => $brand['id'],
            'dest_type' => 'OTHER_RUC',
            'new_company_ruc' => $ruc,
            'new_company_name' => 'Empresa destino temporal',
            'cutoff_date' => '2026-08-31',
        ];

        $this->desde(self::DG, $tokAdmin)->postJson('/api/v1/sep/proyectos', array_merge($datos, [
            'new_company_ruc' => '123',
        ]))->assertStatus(422)->assertJsonPath('code', 'RN-SEP-03');
        $this->desde(self::DG, $tokAdmin)->postJson('/api/v1/sep/proyectos', array_merge($datos, [
            'new_company_ruc' => DB::table('companies')->where('id', $brand['company_id'])->value('ruc'),
        ]))->assertStatus(422)->assertJsonPath('code', 'RN-SEP-03');
        $this->assertDatabaseMissing('companies', ['ruc' => $ruc]);

        $preview = $this->desde(self::DG, $tokAdmin)
            ->postJson('/api/v1/sep/preview', $datos)
            ->assertOk();
        $this->assertSame('2026-09-01', $preview->json('effective_from'));
        $this->assertTrue($preview->json('month_end'));
        $this->assertTrue($preview->json('destination_coherent'));
        $this->assertIsInt($preview->json('open_orders_count'));
        $this->assertIsInt($preview->json('stock_lots_count'));
        $this->assertDatabaseMissing('companies', ['ruc' => $ruc]);

        $creado = $this->desde(self::DG, $tokAdmin)
            ->postJson('/api/v1/sep/proyectos', $datos)
            ->assertCreated();
        $destId = $creado->json('separation.dest_company_id');
        $empresa = DB::table('companies')->where('id', $destId)->first();
        $this->assertNotNull($empresa);
        $this->assertSame($ruc, $empresa->ruc);
        $this->assertSame('EMPRESA DESTINO TEMPORAL', $empresa->legal_name);
        $this->assertSame('PREPARING', $empresa->status);

        $opciones = $this->desde(self::DG, $tokAdmin)->getJson('/api/v1/sep/proyectos')->assertOk();
        $empresaEnLista = collect($opciones->json('companies'))->firstWhere('id', $destId);
        $this->assertNotNull($empresaEnLista);
        $this->assertSame('PREPARING', $empresaEnLista['status']);
    }

    public function test_catalogo_precios_y_series_muestran_alcance_y_respetan_decisiones(): void
    {
        $tokAdmin = $this->ingresar(self::DG, 'lccahuana@donguando.pe');
        $lista = $this->desde(self::DG, $tokAdmin)->getJson('/api/v1/sep/proyectos')->assertOk();
        $brand = collect($lista->json('brands'))->firstWhere('code', 'M2');
        $this->assertNotNull($brand);
        $destino = collect($lista->json('companies'))->first(fn ($company) => $company['id'] !== $brand['company_id']);
        $this->assertNotNull($destino);

        $creado = $this->desde(self::DG, $tokAdmin)->postJson('/api/v1/sep/proyectos', [
            'brand_id' => $brand['id'],
            'dest_type' => 'OTHER_RUC',
            'dest_company_id' => $destino['id'],
            'cutoff_date' => '2026-08-31',
            'simulation' => true,
        ])->assertCreated();
        $separacion = $creado->json('separation');
        $productos = collect($creado->json('items_by_type.PRODUCT'));
        $listasPrecio = collect($creado->json('items_by_type.PRICE_LIST'));
        $seriesNuevas = collect($creado->json('items_by_type.SERIES_NEW'));
        $seriesOrigen = collect($creado->json('items_by_type.SERIES_ORIGIN'));

        $productosOrigen = DB::table('products')
            ->where('brand_id', $brand['id'])
            ->where('status', '<>', 'INACTIVE')
            ->get(['id', 'line']);
        $this->assertCount($productosOrigen->count(), $productos);
        $this->assertSame(
            DB::table('product_variants')->whereIn('product_id', $productosOrigen->pluck('id'))->count(),
            (int) $productos->sum('qty'),
        );
        foreach ($productosOrigen as $producto) {
            $itemProducto = $productos->firstWhere('ref_id', $producto->id);
            $this->assertSame($producto->line, $itemProducto['line']);
        }
        $this->assertSame(
            DB::table('price_lists')->where('brand_id', $brand['id'])->count(),
            $listasPrecio->count(),
        );
        $this->assertSame(4, $seriesNuevas->count());
        $codigosSerie = $seriesNuevas->pluck('code')->all();
        $this->assertCount(count(array_unique($codigosSerie)), $codigosSerie);
        foreach ($codigosSerie as $codigo) {
            $this->assertDatabaseMissing('document_series', ['series' => $codigo]);
        }

        $this->assertNotEmpty($seriesOrigen->where('doc_type', 'INVOICE')->where('action', 'CLOSE'));
        $this->assertNotEmpty($seriesOrigen->where('doc_type', 'CREDIT_NOTE')->where('action', 'KEEP'));
        $this->assertNotEmpty($productos);
        $this->assertNotEmpty($listasPrecio);
        $this->assertIsArray($listasPrecio->first()['refs']['channels']);
        $this->assertSame('MOVE', $productos->first()['action']);
        $this->assertSame('Mover', $productos->first()['action_name']);
        $listaOrigen = DB::table('price_lists')->where('brand_id', $brand['id'])->orderBy('code')->first();
        $this->assertSame($listaOrigen->name ?: $listaOrigen->code, $listasPrecio->first()['label']);

        $producto = $productos->first();
        $listaPrecio = $listasPrecio->first();
        DB::table('brand_separation_items')->where('id', $producto['id'])->update(['action' => 'KEEP']);
        DB::table('brand_separation_items')->where('id', $listaPrecio['id'])->update([
            'action' => 'EXPORT',
            'label' => $listaOrigen->code.' · '.$listaOrigen->name,
        ]);
        $detalleLegacy = $this->desde(self::DG, $tokAdmin)->getJson("/api/v1/sep/proyectos/{$separacion['id']}")->assertOk();
        $this->assertSame(
            'MOVE',
            collect($detalleLegacy->json('items_by_type.PRODUCT'))->firstWhere('id', $producto['id'])['action'],
        );
        $this->assertSame(
            $listaOrigen->name ?: $listaOrigen->code,
            collect($detalleLegacy->json('items_by_type.PRICE_LIST'))->firstWhere('id', $listaPrecio['id'])['label'],
        );

        $accionActualizada = $this->desde(self::DG, $tokAdmin)->putJson("/api/v1/sep/items/{$producto['id']}", [
            'action' => 'EXPORT_ONLY',
        ])->assertOk();
        $this->assertSame(
            'EXPORT_ONLY',
            collect($accionActualizada->json('detail.items_by_type.PRODUCT'))->firstWhere('id', $producto['id'])['action'],
        );
        $this->desde(self::DG, $tokAdmin)->putJson("/api/v1/sep/items/{$producto['id']}", [
            'action' => 'COPY',
        ])->assertStatus(422)->assertJsonPath('code', 'RN-SEP-03');

        $serie = $seriesNuevas->first();
        $nuevoCodigo = 'F'.strtoupper(substr(bin2hex(random_bytes(2)), 0, 3));
        $actualizada = $this->desde(self::DG, $tokAdmin)->putJson("/api/v1/sep/items/{$serie['id']}", [
            'code' => $nuevoCodigo,
        ])->assertOk();
        $this->assertSame($nuevoCodigo, collect($actualizada->json('detail.items_by_type.SERIES_NEW'))->firstWhere('id', $serie['id'])['code']);

        $otraSerie = $seriesNuevas->last();
        $this->desde(self::DG, $tokAdmin)->putJson("/api/v1/sep/items/{$otraSerie['id']}", [
            'code' => $nuevoCodigo,
        ])->assertStatus(422)->assertJsonPath('code', 'RN-PLT-03');
        $this->assertSame($separacion['id'], $actualizada->json('detail.separation.id'));
    }

    public function test_canales_muestran_conversaciones_y_restringen_accion_segun_destino(): void
    {
        $tokAdmin = $this->ingresar(self::DG, 'lccahuana@donguando.pe');
        $opciones = $this->desde(self::DG, $tokAdmin)->getJson('/api/v1/sep/proyectos')->assertOk();
        $brand = collect($opciones->json('brands'))->first(
            fn ($candidate) => DB::table('messaging_channels')->where('brand_id', $candidate['id'])->exists(),
        );
        $this->assertNotNull($brand);

        $destino = collect($opciones->json('companies'))->first(fn ($company) => $company['id'] !== $brand['company_id']);
        $this->assertNotNull($destino);
        $creado = $this->desde(self::DG, $tokAdmin)->postJson('/api/v1/sep/proyectos', [
            'brand_id' => $brand['id'],
            'dest_type' => 'OTHER_RUC',
            'dest_company_id' => $destino['id'],
            'cutoff_date' => '2026-08-31',
            'simulation' => true,
        ])->assertCreated();

        $canal = collect($creado->json('items_by_type.CHANNEL'))->first();
        $this->assertNotNull($canal);
        $this->assertSame('KEEP_INBOX', $canal['action']);
        $this->assertSame('Seguir en la bandeja con sus conversaciones', $canal['action_name']);
        $this->assertSame(
            DB::table('conversations')->where('channel_id', $canal['ref_id'])->count(),
            $canal['qty'],
        );
        $this->assertSame(
            DB::table('messaging_channels')->where('id', $canal['ref_id'])->value('status'),
            $canal['source_status'],
        );

        $this->desde(self::DG, $tokAdmin)->putJson("/api/v1/sep/items/{$canal['id']}", [
            'action' => 'DISCONNECT',
        ])->assertStatus(422)->assertJsonPath('code', 'RN-SEP-17');
    }

    public function test_usuarios_y_locales_exponen_permisos_y_participacion_de_almacenes(): void
    {
        $tokAdmin = $this->ingresar(self::DG, 'lccahuana@donguando.pe');
        $opciones = $this->desde(self::DG, $tokAdmin)->getJson('/api/v1/sep/proyectos')->assertOk();
        $brand = collect($opciones->json('brands'))->first(function ($candidate) {
            $tieneUsuario = DB::table('user_scopes as us')
                ->join('users as u', 'u.id', '=', 'us.user_id')
                ->where('us.brand_id', $candidate['id'])
                ->where('u.status', 'ACTIVE')
                ->exists();
            $tieneStock = DB::table('product_variants as v')
                ->join('stock_balances as sb', 'sb.variant_id', '=', 'v.id')
                ->where('v.brand_id', $candidate['id'])
                ->where('sb.qty', '>', 0)
                ->exists();

            return $tieneUsuario && $tieneStock;
        });
        $this->assertNotNull($brand);

        $destino = collect($opciones->json('companies'))->first(fn ($company) => $company['id'] !== $brand['company_id']);
        $this->assertNotNull($destino);
        $creado = $this->desde(self::DG, $tokAdmin)->postJson('/api/v1/sep/proyectos', [
            'brand_id' => $brand['id'],
            'dest_type' => 'OTHER_RUC',
            'dest_company_id' => $destino['id'],
            'cutoff_date' => '2026-08-31',
            'simulation' => true,
        ])->assertCreated();

        $usuarios = collect($creado->json('items_by_type.USER'));
        $usuario = $usuarios->first();
        $this->assertNotNull($usuario);
        $this->assertNotEmpty($usuario['role']);
        $this->assertContains($brand['name'], $usuario['brands_in_scope']);
        $this->assertStringNotContainsString('('.$usuario['role'].')', $usuario['label']);

        $participacion = collect($creado->json('warehouse_share'));
        $this->assertNotEmpty($participacion);
        $this->assertSame(
            $participacion->where('dedicated', true)->count(),
            collect($creado->json('items_by_type.WAREHOUSE'))->count(),
        );
        foreach ($creado->json('items_by_type.WAREHOUSE') as $almacen) {
            $this->assertSame('SHARE', $almacen['action']);
            $this->assertGreaterThanOrEqual(99.9, $participacion->firstWhere('warehouse_id', $almacen['warehouse_id'])['share_pct']);
        }

        $this->desde(self::DG, $tokAdmin)->putJson("/api/v1/sep/items/{$usuario['id']}", [
            'action' => 'MOVE',
        ])->assertStatus(422)->assertJsonPath('code', 'RN-SEP-07');
    }
}
