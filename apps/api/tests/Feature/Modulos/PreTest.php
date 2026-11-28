<?php

namespace Tests\Feature\Modulos;

use App\Models\User;
use App\Modulos\Cat\Services\Balanza;
use App\Support\TenantContext;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/** PRE · Preparación con escaneo, bolsas numeradas y carga verificada: un test por criterio CA-PRE-01 a CA-PRE-09 y las reglas que los rodean. */
class PreTest extends TestCase
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

    /** Preparador (arma). */
    private function preparador(): static
    {
        return $this->como('smamani@donguando.pe');
    }

    /** Otro preparador (verifica). */
    private function otro(): static
    {
        return $this->como('whuanca@donguando.pe');
    }

    /** Supervisora de almacén del local 1 (aprueba faltantes y FEFO). */
    private function almacenera(): static
    {
        return $this->como('mtorres@donguando.pe');
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

    private function marca(string $code = 'DG'): string
    {
        return collect($this->opciones()['marcas'])->firstWhere('code', $code)['id'];
    }

    private function variante(string $sku): string
    {
        $r = $this->gerente()->getJson('/api/v1/ped/productos?brand_id='.$this->marca().'&q='.$sku)->assertOk()->json();

        return collect($r)->firstWhere('sku', $sku)['id'];
    }

    /** Pedido de delivery confirmado (Surco B, local 1, franja de las 9:00). */
    private function pedido(array $lineas = ['DG-CUY-ENT' => 2]): array
    {
        $cel = '9571'.str_pad((string) random_int(0, 99999), 5, '0', STR_PAD_LEFT);
        $c = $this->gerente()->postJson('/api/v1/ped/clientes/rapida', ['phone' => $cel, 'full_name' => "Cliente Pre {$cel}"])->assertSuccessful()->json('customer.id');
        $d = $this->gerente()->postJson("/api/v1/ped/clientes/{$c}/direcciones", [
            'address_line' => 'Av. Primavera 1234', 'district' => 'Santiago de Surco', 'reference' => 'Frente al parque', 'lat' => -12.135 - random_int(0, 50) / 10000, 'lng' => -76.99,
        ])->assertCreated()->json();
        $local = $d['zona']['establishment_id'];
        $franja = collect($this->gerente()->getJson("/api/v1/ped/franjas/disponibles?establishment_id={$local}&fecha=".self::FECHA)->assertOk()->json())
            ->first(fn ($s) => $s['slot_from'] === '09:00' && $s['zone_id'] === null)['id'];
        $pago = collect($this->opciones()['formas_pago'])->firstWhere('code', 'YAPE')['id'];
        $o = $this->gerente()->postJson('/api/v1/ped/pedidos', [
            'brand_id' => $this->marca(), 'channel' => 'WHATSAPP', 'customer_id' => $c, 'fulfillment' => 'DELIVERY', 'address_id' => $d['direccion']['id'],
            'delivery_date' => self::FECHA, 'slot_id' => $franja, 'requested_doc_type' => 'RECEIPT', 'payment_method_id' => $pago, 'prep_notes_ok' => true,
            'lines' => collect($lineas)->map(fn ($q, $sku) => ['variant_id' => $this->variante($sku), 'qty' => $q])->values()->all(),
        ])->assertCreated()->json();
        $this->gerente()->postJson("/api/v1/ped/pedidos/{$o['pedido']['id']}/confirmar")->assertOk();

        return $o + ['local' => $local];
    }

    /** Ola liberada con esos pedidos; devuelve [ola, tareas por pedido]. */
    private function ola(array ...$pedidos): array
    {
        $w = $this->almacenera()->postJson('/api/v1/pre/olas', ['order_ids' => array_map(fn ($p) => $p['pedido']['id'], $pedidos), 'liberar' => true])
            ->assertCreated()->assertJsonPath('status', 'RELEASED')->json();
        $tareas = collect($this->gerente()->getJson("/api/v1/pre/olas/{$w['id']}")->assertOk()->json('tareas'))->keyBy('order_id');

        return [$w, $tareas];
    }

    private function etiqueta(string $sku, float $kg): string
    {
        $this->contexto();
        $plu = DB::table('product_variants')->where('sku', $sku)->value('scale_plu');

        return Balanza::armar($plu, $kg);
    }

    private function escanear(string $tarea, array $d, ?callable $quien = null): TestResponse
    {
        return ($quien ? $quien() : $this->preparador())->postJson("/api/v1/pre/tareas/{$tarea}/escanear", $d);
    }

    /** Arma los cuyes de la tarea con etiquetas de balanza del lote CU-2026-1008 (vence el 15/10). */
    private function armarCuyes(string $tarea, array $pesos): void
    {
        foreach ($pesos as $kg) {
            $this->escanear($tarea, ['code' => $this->etiqueta('DG-CUY-ENT', $kg), 'lot_code' => 'CU-2026-1008'])->assertOk()->assertJsonPath('result', 'OK');
        }
    }

    private function foto(): UploadedFile
    {
        return UploadedFile::fake()->image('pedido-'.random_int(1000, 9999).'.jpg', 40 + random_int(0, 60), 40);
    }

    public function test_ca_pre_01_producto_que_no_esta_en_la_ola_se_bloquea_como_producto_equivocado(): void
    {
        $p = $this->pedido(['DG-CUY-ENT' => 2]);
        [, $ts] = $this->ola($p);
        $t = $ts[$p['pedido']['id']]['id'];
        $this->assertSame('IN_PREPARATION', $this->gerente()->getJson("/api/v1/ped/pedidos/{$p['pedido']['id']}")->json('pedido.status'));

        $r = $this->escanear($t, ['code' => 'DG-CON-ENT', 'weight_kg' => 1.6])->assertOk();
        $this->assertSame('WRONG_PRODUCT', $r->json('result'));
        $this->assertSame('RN-PRE-03', $r->json('code'));
        $this->assertFalse($r->json('ok'));
        $this->assertStringContainsString('Producto equivocado', $r->json('message'));
        $this->assertStringNotContainsString('RN-PRE', $r->json('message'));
        // La lectura queda registrada y no cuenta para el pedido.
        $this->assertSame('WRONG_PRODUCT', $r->json('tarea.lecturas.0.result'));
        $this->assertEquals(0, $r->json('tarea.lineas.0.qty_picked'));
    }

    public function test_ca_pre_02_producto_de_otro_pedido_de_la_ola_se_bloquea_como_pedido_cruzado(): void
    {
        $a = $this->pedido(['DG-CUY-ENT' => 2]);
        $b = $this->pedido(['DG-POL-ENT' => 1]);
        [, $ts] = $this->ola($a, $b);
        $r = $this->escanear($ts[$a['pedido']['id']]['id'], ['code' => $this->etiqueta('DG-POL-ENT', 2.2)])->assertOk();
        $this->assertSame('WRONG_ORDER', $r->json('result'));
        $this->assertStringContainsString('Pedido cruzado', $r->json('message'));
        $this->assertStringContainsString($b['pedido']['number'], $r->json('message'));
    }

    public function test_ca_pre_03_lote_en_cuarentena_se_bloquea_y_sin_lote_tambien(): void
    {
        $p = $this->pedido();
        [, $ts] = $this->ola($p);
        $t = $ts[$p['pedido']['id']]['id'];
        $r = $this->escanear($t, ['code' => 'L261010-Q01', 'weight_kg' => 0.9])->assertOk();
        $this->assertSame('LOT_NOT_RELEASED', $r->json('result'));
        $this->assertSame('RN-PRE-04', $r->json('code'));
        $this->assertStringContainsString('cuarentena', $r->json('message'));
        // Un producto con lote no se acepta sin lote.
        $this->escanear($t, ['code' => 'DG-CUY-ENT', 'weight_kg' => 0.9])->assertOk()->assertJsonPath('result', 'LOT_NOT_RELEASED');
        // Código desconocido (RN-PRE-06).
        $this->escanear($t, ['code' => 'XYZ-NO-EXISTE'])->assertOk()->assertJsonPath('result', 'UNKNOWN')->assertJsonPath('code', 'RN-PRE-06');
    }

    public function test_ca_pre_04_lote_que_vence_despues_se_bloquea_por_fefo_y_pasa_con_autorizacion(): void
    {
        $p = $this->pedido(['DG-CUY-ENT' => 2]);
        [, $ts] = $this->ola($p);
        $t = $ts[$p['pedido']['id']]['id'];
        // L261009-002 vence el 16/10 y hay lotes que vencen el 15/10 con stock.
        $r = $this->escanear($t, ['code' => 'L261009-002', 'weight_kg' => 0.9])->assertOk();
        $this->assertSame('NOT_FEFO', $r->json('result'));
        $this->assertSame('RN-PRE-05', $r->json('code'));
        $this->assertStringContainsString('15/10/2026', $r->json('message'));
        $scan = $r->json('scan_id');

        $pend = collect($this->almacenera()->getJson('/api/v1/pre/fefo')->assertOk()->json());
        $this->assertTrue($pend->contains('id', $scan));
        // El preparador no autoriza: es la supervisora (pre.fefo.override).
        $this->preparador()->postJson("/api/v1/pre/fefo/{$scan}/autorizar")->assertForbidden();
        $ok = $this->almacenera()->postJson("/api/v1/pre/fefo/{$scan}/autorizar", ['reason' => 'Se termina el lote abierto'])->assertOk();
        $this->assertSame('OK', $ok->json('result'));
        $this->almacenera()->postJson("/api/v1/pre/fefo/{$scan}/autorizar")->assertUnprocessable()->assertJsonPath('code', 'RN-PRE-05');
        $this->assertFalse(collect($this->almacenera()->getJson('/api/v1/pre/fefo')->json())->contains('id', $scan));
        $this->contexto();
        $this->assertSame(DB::table('users')->where('email', 'mtorres@donguando.pe')->value('id'), DB::table('picking_scans')->where('override_of', $scan)->value('override_by'));
    }

    public function test_ca_pre_09_dos_paquetes_completan_la_linea_y_ped_recibe_el_peso(): void
    {
        $p = $this->pedido(['DG-CUY-ENT' => 2]);
        $this->assertEquals(1.8, (float) $p['lineas'][0]['est_weight_kg']);
        [, $ts] = $this->ola($p);
        $t = $ts[$p['pedido']['id']]['id'];
        $e1 = $this->etiqueta('DG-CUY-ENT', 0.86);
        $this->escanear($t, ['code' => $e1, 'lot_code' => 'CU-2026-1008'])->assertOk()->assertJsonPath('result', 'OK')->assertJsonPath('line.complete', false);
        // La misma etiqueta de balanza no se lee dos veces (RN-PRE-06).
        $this->escanear($t, ['code' => $e1, 'lot_code' => 'CU-2026-1008'])->assertOk()->assertJsonPath('result', 'DUPLICATE');
        $e2 = $this->etiqueta('DG-CUY-ENT', 0.86);
        $this->assertSame($e1, $e2);
        // Otra etiqueta con el mismo peso es otro paquete: cambia en el código (otro PLU no; mismo peso sí sería igual), por eso se usa 0,860 con otra balanza.
        $r = $this->escanear($t, ['code' => 'CU-2026-1008', 'weight_kg' => 0.86])->assertOk()->assertJsonPath('result', 'OK');
        $this->assertTrue($r->json('line.complete'));
        $this->assertTrue($r->json('finished'));
        $this->assertEquals(1.72, $r->json('tarea.lineas.0.weighed_kg'));
        $this->assertSame('PICKED', $r->json('tarea.estado'));
        $this->assertTrue($r->json('tarea.stock_moved'));

        $o = $this->gerente()->getJson("/api/v1/ped/pedidos/{$p['pedido']['id']}")->assertOk();
        $this->assertSame('WEIGHED', $o->json('pedido.status'));
        $this->assertSame('WITHIN_TOLERANCE', $o->json('pedido.weight_diff_status'));
        $this->assertEquals(1.72, (float) $o->json('lineas.0.weighed_kg'));
        $this->assertEquals(round(1.72 * (float) $p['lineas'][0]['unit_price'] + (float) $o->json('pedido.delivery_fee') - (float) $o->json('pedido.discount_total'), 2), (float) $o->json('pedido.final_total'));
        // Exceso: la línea ya está completa.
        $this->escanear($t, ['code' => 'CU-2026-1008', 'weight_kg' => 0.9])->assertUnprocessable()->assertJsonPath('code', 'RN-PRE-09');
        // El stock salió del lote escaneado y la reserva se liberó.
        $this->contexto();
        $this->assertEquals(-2, (float) DB::table('stock_movements')->where('source_type', 'SALES_ORDER')->where('source_id', $p['pedido']['id'])->where('movement_type', 'SALE')->sum('qty'));
        $this->assertSame(0, DB::table('stock_reservations')->where('order_id', $p['pedido']['id'])->where('status', 'ACTIVE')->count());
    }

    public function test_ca_pre_05_etiqueta_dice_pedido_bolsa_n_de_total_ruta_y_parada(): void
    {
        $p = $this->pedido(['DG-CUY-ENT' => 2]);
        [, $ts] = $this->ola($p);
        $t = $ts[$p['pedido']['id']]['id'];
        // Sin terminar el armado no se embolsa (RN-PRE-09).
        $this->preparador()->postJson("/api/v1/pre/tareas/{$t}/bolsas", ['count' => 3])->assertUnprocessable()->assertJsonPath('code', 'RN-PRE-09');
        $this->armarCuyes($t, [0.88, 0.91]);
        $r = $this->preparador()->postJson("/api/v1/pre/tareas/{$t}/bolsas", ['count' => 3, 'type' => 'BAG'])->assertOk();
        $this->assertSame('PACKED', $r->json('estado'));
        $this->assertCount(3, $r->json('bolsas'));
        $corto = (string) (int) preg_replace('/\D/', '', $p['pedido']['number']);
        $parada = $r->json('parada');
        $this->assertSame('SURCO-B', $r->json('ruta'));
        $this->assertSame("Pedido {$corto} · bolsa 2 de 3 · Ruta SURCO-B · parada {$parada}", $r->json('bolsas.1.leyenda'));
        $this->assertNotSame($r->json('bolsas.0.label_code'), $r->json('bolsas.1.label_code'));
    }

    public function test_ca_pre_07_verificar_exige_foto_y_otra_persona(): void
    {
        $p = $this->pedido(['DG-CUY-ENT' => 2]);
        [, $ts] = $this->ola($p);
        $t = $ts[$p['pedido']['id']]['id'];
        $this->armarCuyes($t, [0.9, 0.92]);
        $this->otro()->post("/api/v1/pre/tareas/{$t}/verificar", ['photo' => $this->foto()])->assertUnprocessable()->assertJsonPath('code', 'RN-PRE-09');
        $this->preparador()->postJson("/api/v1/pre/tareas/{$t}/bolsas", ['count' => 2])->assertOk();

        $this->otro()->post("/api/v1/pre/tareas/{$t}/verificar", ['parcel_count' => 2])->assertUnprocessable()->assertJsonPath('code', 'RN-PRE-09');
        $this->preparador()->post("/api/v1/pre/tareas/{$t}/verificar", ['photo' => $this->foto(), 'parcel_count' => 2])->assertUnprocessable()->assertJsonPath('code', 'RN-PRE-13');
        $this->otro()->post("/api/v1/pre/tareas/{$t}/verificar", ['photo' => $this->foto(), 'parcel_count' => 3])->assertUnprocessable()->assertJsonPath('code', 'RN-PRE-09');
        $r = $this->otro()->post("/api/v1/pre/tareas/{$t}/verificar", ['photo' => $this->foto(), 'parcel_count' => 2])->assertOk();
        $this->assertSame('VERIFIED', $r->json('estado'));
        $this->assertTrue($r->json('foto'));
        $this->assertSame('READY', $this->gerente()->getJson("/api/v1/ped/pedidos/{$p['pedido']['id']}")->json('pedido.status'));
        $this->otro()->getJson("/api/v1/pre/tareas/{$t}/foto")->assertOk()->assertJsonStructure(['url']);
    }

    public function test_ca_pre_06_carga_en_orden_inverso_de_paradas(): void
    {
        $a = $this->pedido(['DG-CUY-ENT' => 1]);
        $b = $this->pedido(['DG-CUY-ENT' => 1]);
        [, $ts] = $this->ola($a, $b);
        $tareas = [];
        foreach ([$a, $b] as $p) {
            $t = $ts[$p['pedido']['id']]['id'];
            $this->armarCuyes($t, [0.9 + random_int(1, 40) / 1000]);
            $this->preparador()->postJson("/api/v1/pre/tareas/{$t}/bolsas", ['count' => 1])->assertOk();
            $tareas[] = $this->otro()->post("/api/v1/pre/tareas/{$t}/verificar", ['photo' => $this->foto(), 'parcel_count' => 1])->assertOk()->json();
        }
        $this->assertSame($tareas[0]['route_key'], $tareas[1]['route_key']);
        usort($tareas, fn ($x, $y) => $x['parada'] <=> $y['parada']);
        [$primera, $ultima] = $tareas;
        $this->assertLessThan($ultima['parada'], $primera['parada']);
        $clave = $primera['route_key'];

        $rutas = collect($this->preparador()->getJson('/api/v1/pre/rutas?fecha='.self::FECHA)->assertOk()->json());
        $this->assertTrue($rutas->contains('route_key', $clave));
        // La bolsa de la primera parada no se sube mientras falte la de la última.
        $this->preparador()->postJson('/api/v1/pre/carga/escanear', ['route_key' => $clave, 'code' => $primera['bolsas'][0]['label_code']])->assertOk()
            ->assertJsonPath('result', 'LOAD_ORDER')->assertJsonPath('code', 'RN-PRE-08');
        // Otra ruta: se bloquea.
        $this->preparador()->postJson('/api/v1/pre/carga/escanear', ['route_key' => '2026-10-13|09:00|OTRA', 'code' => $ultima['bolsas'][0]['label_code']])->assertOk()
            ->assertJsonPath('result', 'WRONG_ROUTE');
        $this->preparador()->postJson('/api/v1/pre/carga/escanear', ['route_key' => $clave, 'code' => $ultima['bolsas'][0]['label_code']])->assertOk()
            ->assertJsonPath('result', 'OK')->assertJsonPath('task_loaded', true);
        $this->preparador()->postJson('/api/v1/pre/carga/escanear', ['route_key' => $clave, 'code' => $ultima['bolsas'][0]['label_code']])->assertOk()
            ->assertJsonPath('result', 'DUPLICATE');
        $r = $this->preparador()->postJson('/api/v1/pre/carga/escanear', ['route_key' => $clave, 'code' => mb_strtolower($primera['bolsas'][0]['label_code'])])->assertOk()
            ->assertJsonPath('result', 'OK');
        $this->assertSame($r->json('carga.total'), $r->json('carga.cargadas'));
        $this->assertSame('LOADED', $this->gerente()->getJson("/api/v1/pre/tareas/{$primera['id']}")->json('estado'));
    }

    public function test_rn_pre_08_la_primera_parada_espera_a_los_pedidos_sin_bolsas_de_paradas_posteriores(): void
    {
        $a = $this->pedido(['DG-CUY-ENT' => 1]);
        $b = $this->pedido(['DG-CUY-ENT' => 1]);
        [, $ts] = $this->ola($a, $b);
        $porParada = collect([$ts[$a['pedido']['id']], $ts[$b['pedido']['id']]])->sortBy('parada')->values();
        [$primera, $ultima] = [$porParada[0], $porParada[1]];
        $this->assertLessThan($ultima['parada'], $primera['parada']);
        // Solo la primera parada se arma, embolsa y verifica; la última aún no tiene bolsas.
        $this->armarCuyes($primera['id'], [0.93]);
        $this->preparador()->postJson("/api/v1/pre/tareas/{$primera['id']}/bolsas", ['count' => 1])->assertOk();
        $t = $this->otro()->post("/api/v1/pre/tareas/{$primera['id']}/verificar", ['photo' => $this->foto(), 'parcel_count' => 1])->assertOk()->json();
        $clave = $t['route_key'];

        $ruta = collect($this->preparador()->getJson('/api/v1/pre/rutas?fecha='.self::FECHA)->assertOk()->json())->firstWhere('route_key', $clave);
        $this->assertSame(2, $ruta['pedidos']);
        $this->assertSame(1, $ruta['sin_bolsas']);
        $carga = $this->preparador()->getJson('/api/v1/pre/carga?route_key='.urlencode($clave))->assertOk();
        $this->assertSame($ultima['pedido'], $carga->json('sin_bolsas.0.pedido'));

        $r = $this->preparador()->postJson('/api/v1/pre/carga/escanear', ['route_key' => $clave, 'code' => $t['bolsas'][0]['label_code']])->assertOk()
            ->assertJsonPath('result', 'LOAD_ORDER')->assertJsonPath('code', 'RN-PRE-08');
        $this->assertStringContainsString($ultima['pedido'], $r->json('message'));
    }

    public function test_ca_pre_08_porcentaje_de_pedidos_con_error_de_armado(): void
    {
        $this->contexto();
        $ini = Carbon::parse('2026-10-01 00:00', 'America/Lima');
        $fin = $ini->copy()->addMonth();
        $entregados = DB::table('sales_orders')->whereNotNull('delivered_at')->where('delivered_at', '>=', $ini)->where('delivered_at', '<', $fin)->count();
        $this->assertGreaterThan(0, $entregados);
        $emp = DB::table('employees')->where('status', 'ACTIVE')->value('id');
        $ped = DB::table('sales_orders')->whereNotNull('delivered_at')->where('delivered_at', '>=', $ini)->where('delivered_at', '<', $fin)->limit(3)->pluck('id');
        // Un error de entrega sin responsable no se registra (RN-PRE-11).
        $this->almacenera()->postJson('/api/v1/pre/errores', ['order_id' => $ped[0], 'error_type' => 'WRONG_PRODUCT', 'detected_at_stage' => 'DELIVERY', 'description' => 'Llegó pollo en vez de cuy'])
            ->assertUnprocessable()->assertJsonPath('code', 'RN-PRE-11');
        foreach ($ped as $id) {
            $this->almacenera()->postJson('/api/v1/pre/errores', ['order_id' => $id, 'error_type' => 'WRONG_PRODUCT', 'detected_at_stage' => 'CUSTOMER_CLAIM',
                'description' => 'Reclamo del cliente', 'responsible_employee_id' => $emp, 'cost_amount' => 12.5])->assertCreated();
        }
        $this->contexto();
        $conError = DB::table('packing_errors')->whereIn('detected_at_stage', ['DELIVERY', 'CUSTOMER_CLAIM'])->where('detected_at', '>=', $ini)->where('detected_at', '<', $fin)
            ->distinct()->count('order_id');
        $k = $this->gerente()->getJson('/api/v1/pre/kpis?mes=2026-10')->assertOk();
        $this->assertSame($entregados, $k->json('entregados'));
        $this->assertSame($conError, $k->json('con_error'));
        $this->assertEquals(round($conError / $entregados * 100, 2), $k->json('error_pct'));
        // La fórmula con los números del criterio: 12 de 1000 = 1,2 %.
        $this->assertEquals(1.2, round(12 / 1000 * 100, 2));

        // Cerrar exige la acción correctiva.
        $e = $this->almacenera()->postJson('/api/v1/pre/errores', ['order_id' => $ped[0], 'error_type' => 'WRONG_CUT', 'detected_at_stage' => 'VERIFICATION', 'description' => 'Corte en mitades'])->assertCreated()->json('id');
        $this->almacenera()->postJson("/api/v1/pre/errores/{$e}/cerrar")->assertUnprocessable()->assertJsonPath('code', 'RN-PRE-11');
        $this->almacenera()->postJson("/api/v1/pre/errores/{$e}/cerrar", ['corrective_action' => 'Repaso de cortes con el equipo'])->assertOk()->assertJsonPath('status', 'CLOSED');
    }

    public function test_rn_pre_12_faltante_lo_aprueba_la_supervisora_y_no_quien_prepara(): void
    {
        $p = $this->pedido(['DG-CUY-ENT' => 2]);
        [, $ts] = $this->ola($p);
        $t = $ts[$p['pedido']['id']]['id'];
        $this->armarCuyes($t, [0.9]);
        $linea = $this->gerente()->getJson("/api/v1/pre/tareas/{$t}")->json('lineas.0.id');
        $this->preparador()->postJson("/api/v1/pre/lineas/{$linea}/faltante", ['reason' => 'No hay más cuyes en cámara'])->assertOk();
        $this->assertTrue(collect($this->almacenera()->getJson('/api/v1/pre/faltantes')->assertOk()->json())->contains('id', $linea));
        // El preparador no tiene el permiso.
        $this->preparador()->postJson("/api/v1/pre/lineas/{$linea}/faltante/aprobar")->assertForbidden();
        // Verificar o embolsar con la línea incompleta: no (RN-PRE-09).
        $this->preparador()->postJson("/api/v1/pre/tareas/{$t}/bolsas")->assertUnprocessable()->assertJsonPath('code', 'RN-PRE-09');

        $this->almacenera()->postJson("/api/v1/pre/lineas/{$linea}/faltante/aprobar")->assertOk()->assertJsonPath('status', 'SHORT_APPROVED');
        $f = $this->gerente()->getJson("/api/v1/pre/tareas/{$t}")->assertOk();
        $this->assertSame('PICKED', $f->json('estado'));
        $this->assertEquals(1, $f->json('lineas.0.short_qty'));
        $o = $this->gerente()->getJson("/api/v1/ped/pedidos/{$p['pedido']['id']}")->assertOk();
        $this->assertEquals(0.9, (float) $o->json('lineas.0.weighed_kg'));
        $this->contexto();
        $this->assertTrue(DB::table('notifications')->where('module', 'PRE')->where('title', 'like', 'Faltante en el pedido%')->exists());
    }

    public function test_rn_pre_12_quien_arma_no_aprueba_su_propio_faltante(): void
    {
        $p = $this->pedido(['DG-CUY-ENT' => 2]);
        [, $ts] = $this->ola($p);
        $t = $ts[$p['pedido']['id']]['id'];
        // La almacenera arma (tiene pre.task.pick) y pide el faltante: no se lo aprueba ella misma.
        $this->escanear($t, ['code' => 'CU-2026-1008', 'weight_kg' => 0.9], fn () => $this->almacenera())->assertOk()->assertJsonPath('result', 'OK');
        $linea = $this->gerente()->getJson("/api/v1/pre/tareas/{$t}")->json('lineas.0.id');
        $this->almacenera()->postJson("/api/v1/pre/lineas/{$linea}/faltante", ['reason' => 'Se acabó el stock'])->assertOk();
        $this->almacenera()->postJson("/api/v1/pre/lineas/{$linea}/faltante/aprobar")->assertUnprocessable()->assertJsonPath('code', 'RN-PRE-12');
        $this->gerente()->postJson("/api/v1/pre/lineas/{$linea}/faltante/rechazar", ['reason' => 'Busca en CAM-L1'])->assertOk();
        $this->assertNull($this->gerente()->getJson("/api/v1/pre/tareas/{$t}")->json('lineas.0.short_reason'));
    }

    public function test_rn_pre_01_solo_confirmados_y_una_tarea_activa_por_pedido(): void
    {
        $p = $this->pedido();
        $w = $this->almacenera()->postJson('/api/v1/pre/olas', ['order_ids' => [$p['pedido']['id']]])->assertCreated()->assertJsonPath('status', 'DRAFT')->json();
        $this->almacenera()->postJson('/api/v1/pre/olas', ['order_ids' => [$p['pedido']['id']]])->assertUnprocessable()->assertJsonPath('code', 'RN-PRE-01');
        // Sin ola liberada no se escanea.
        $t = $this->gerente()->getJson("/api/v1/pre/olas/{$w['id']}")->json('tareas.0.id');
        $this->escanear($t, ['code' => 'CU-2026-1008', 'weight_kg' => 0.9])->assertUnprocessable()->assertJsonPath('code', 'RN-PRE-02');
        // El preparador no crea olas.
        $this->preparador()->postJson('/api/v1/pre/olas', ['order_ids' => [$p['pedido']['id']]])->assertForbidden();
        // Cancelar el borrador deja el pedido libre para otra ola.
        $this->almacenera()->postJson("/api/v1/pre/olas/{$w['id']}/cancelar", ['reason' => 'Se arma con la ruta'])->assertOk()->assertJsonPath('status', 'CANCELLED');
        $plan = $this->almacenera()->getJson('/api/v1/pre/planificador?fecha='.self::FECHA)->assertOk();
        $this->assertTrue(collect($plan->json('grupos'))->flatMap(fn ($g) => $g['pedidos'])->contains('id', $p['pedido']['id']));
        $this->ola($p);

        // Un borrador no entra a preparación.
        $c = $this->pedido();
        $this->gerente()->postJson("/api/v1/ped/pedidos/{$c['pedido']['id']}/borrador")->assertOk();
        $this->almacenera()->postJson('/api/v1/pre/olas', ['order_ids' => [$c['pedido']['id']]])->assertUnprocessable()->assertJsonPath('code', 'RN-PRE-01');
    }

    public function test_pedido_cancelado_despues_de_armar_anula_la_tarea_y_devuelve_el_stock(): void
    {
        $p = $this->pedido(['DG-CUY-ENT' => 1]);
        [, $ts] = $this->ola($p);
        $t = $ts[$p['pedido']['id']]['id'];
        $this->armarCuyes($t, [0.9]);
        $this->gerente()->postJson("/api/v1/ped/pedidos/{$p['pedido']['id']}/cancelar", ['reason_code' => 'CLIENTE_DESISTIO', 'note' => 'Ya no lo quiere'])->assertOk();
        $this->preparador()->postJson("/api/v1/pre/tareas/{$t}/bolsas")->assertUnprocessable()->assertJsonPath('code', 'RN-PRE-01');
        $this->almacenera()->postJson("/api/v1/pre/tareas/{$t}/anular")->assertOk()->assertJsonPath('estado', 'CANCELLED');
        $this->contexto();
        $this->assertEquals(1, (float) DB::table('stock_movements')->where('source_type', 'SALES_ORDER')->where('source_id', $p['pedido']['id'])->where('movement_type', 'RETURN')->sum('qty'));
    }

    public function test_pantallas_responden(): void
    {
        $p = $this->pedido(['DG-CUY-ENT' => 2, 'DG-CUY-DES' => 1]);
        [$w, $ts] = $this->ola($p);
        $t = $ts[$p['pedido']['id']]['id'];
        $this->armarCuyes($t, [0.9]);
        $f = '?fecha='.self::FECHA;
        $con = $this->almacenera()->getJson("/api/v1/pre/olas/{$w['id']}/consolidada")->assertOk();
        $this->assertSame(2, $con->json('cifras.productos'));
        $this->almacenera()->getJson("/api/v1/pre/planificador{$f}")->assertOk()->assertJsonStructure(['grupos', 'olas', 'cifras', 'locales']);
        $this->almacenera()->getJson("/api/v1/pre/olas{$f}")->assertOk();
        $this->almacenera()->getJson("/api/v1/pre/tareas{$f}")->assertOk()->assertJsonPath('0.id', $t);
        $tk = $this->almacenera()->getJson("/api/v1/pre/tareas/{$t}")->assertOk();
        $this->assertNotNull($tk->json('lineas.1.lote_sugerido'));
        $this->almacenera()->getJson("/api/v1/pre/pesado?wave_id={$w['id']}")->assertOk()->assertJsonPath('cifras.pedidos', 1);
        $this->almacenera()->getJson("/api/v1/pre/rutas{$f}")->assertOk();
        $this->almacenera()->getJson('/api/v1/pre/faltantes?vista=INCOMPLETAS')->assertOk();
        $this->almacenera()->getJson('/api/v1/pre/errores?mes=2026-10')->assertOk()->assertJsonStructure(['data', 'total']);
        $this->almacenera()->getJson('/api/v1/pre/errores/resumen?mes=2026-10')->assertOk();
        $this->almacenera()->getJson('/api/v1/pre/errores/opciones')->assertOk();
        $this->almacenera()->getJson('/api/v1/pre/errores/pedidos?q='.substr($p['pedido']['number'], -4))->assertOk();
        $tab = $this->almacenera()->getJson("/api/v1/pre/tablero{$f}")->assertOk();
        $this->assertSame(1, $tab->json('cifras.pedidos'));
        $this->almacenera()->getJson('/api/v1/pre/kpis?mes=2026-10')->assertOk();
        $this->almacenera()->getJson('/api/v1/pre/fefo?vista=RESUELTAS')->assertOk();
        // La vendedora solo mira (PRE:L) y no escanea.
        $this->como('ana.torres@donguando.pe')->getJson("/api/v1/pre/tablero{$f}")->assertOk();
        $this->como('ana.torres@donguando.pe')->postJson("/api/v1/pre/tareas/{$t}/escanear", ['code' => 'X'])->assertForbidden();
        // La almacenera del local 2 no ve la tarea del local 1.
        $this->como('irojas@donguando.pe')->getJson("/api/v1/pre/tareas/{$t}")->assertNotFound();
    }
}
