<?php

namespace Tests\Feature\Modulos;

use App\Models\User;
use App\Modulos\Cat\Services\Balanza;
use App\Support\TenantContext;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/** DEL · Reparto: un test por criterio CA-DEL-01 a CA-DEL-10 y las reglas que los rodean (RN-DEL-01 a RN-DEL-19). */
class DelTest extends TestCase
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

    private function coordinador(): static
    {
        return $this->como('rchavez@donguando.pe');
    }

    private function repartidor(): static
    {
        return $this->como('pcondori@donguando.pe');
    }

    private function otroRepartidor(): static
    {
        return $this->como('hticona@donguando.pe');
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

    private function marca(): string
    {
        return collect($this->opciones()['marcas'])->firstWhere('code', 'DG')['id'];
    }

    private function variante(string $sku): string
    {
        $r = $this->gerente()->getJson('/api/v1/ped/productos?brand_id='.$this->marca().'&q='.$sku)->assertOk()->json();

        return collect($r)->firstWhere('sku', $sku)['id'];
    }

    /** Pedido de delivery confirmado (Surco, local 1, franja de las 9:00). */
    private function pedido(int $cuyes = 1, string $pago = 'CASH', float $lat = -12.135): array
    {
        $cel = '9581'.str_pad((string) random_int(0, 99999), 5, '0', STR_PAD_LEFT);
        $c = $this->gerente()->postJson('/api/v1/ped/clientes/rapida', ['phone' => $cel, 'full_name' => "Lucía Reparto {$cel}"])->assertSuccessful()->json('customer.id');
        $d = $this->gerente()->postJson("/api/v1/ped/clientes/{$c}/direcciones", [
            'address_line' => 'Av. Primavera 1234', 'district' => 'Santiago de Surco', 'reference' => 'Frente al parque', 'lat' => $lat - random_int(0, 30) / 10000, 'lng' => -76.99,
        ])->assertCreated()->json();
        $local = $d['zona']['establishment_id'];
        $franja = collect($this->gerente()->getJson("/api/v1/ped/franjas/disponibles?establishment_id={$local}&fecha=".self::FECHA)->assertOk()->json())
            ->first(fn ($s) => $s['slot_from'] === '09:00' && $s['zone_id'] === null)['id'];
        $medio = collect($this->opciones()['formas_pago'])->firstWhere('code', $pago)['id'];
        $o = $this->gerente()->postJson('/api/v1/ped/pedidos', [
            'brand_id' => $this->marca(), 'channel' => 'WHATSAPP', 'customer_id' => $c, 'fulfillment' => 'DELIVERY', 'address_id' => $d['direccion']['id'],
            'delivery_date' => self::FECHA, 'slot_id' => $franja, 'requested_doc_type' => 'RECEIPT', 'payment_method_id' => $medio, 'prep_notes_ok' => true,
            'lines' => [['variant_id' => $this->variante('DG-CUY-ENT'), 'qty' => $cuyes]],
        ])->assertCreated()->json();
        $this->gerente()->postJson("/api/v1/ped/pedidos/{$o['pedido']['id']}/confirmar")->assertOk();

        return ['id' => $o['pedido']['id'], 'number' => $o['pedido']['number'], 'local' => $local, 'slot' => $franja, 'pin' => [(float) $d['direccion']['lat'], (float) $d['direccion']['lng']]];
    }

    private function foto(): UploadedFile
    {
        return UploadedFile::fake()->image('entrega-'.random_int(1000, 9999).'.jpg', 40 + random_int(0, 80), 40);
    }

    /** PRE completo: ola, armado de cuyes, bolsas y verificación por otra persona. El pedido queda LISTO. */
    private function preparar(array $p, int $bolsas = 1): void
    {
        $w = $this->como('mtorres@donguando.pe')->postJson('/api/v1/pre/olas', ['order_ids' => [$p['id']], 'liberar' => true])->assertCreated()->json();
        $t = collect($this->gerente()->getJson("/api/v1/pre/olas/{$w['id']}")->assertOk()->json('tareas'))->firstWhere('order_id', $p['id'])['id'];
        $n = (int) DB::table('sales_order_lines')->where('sales_order_id', $p['id'])->sum('qty');
        for ($i = 0; $i < $n; $i++) {
            $this->contexto();
            $code = Balanza::armar(DB::table('product_variants')->where('sku', 'DG-CUY-ENT')->value('scale_plu'), 0.9 + random_int(1, 80) / 1000);
            $this->como('smamani@donguando.pe')->postJson("/api/v1/pre/tareas/{$t}/escanear", ['code' => $code, 'lot_code' => 'CU-2026-1008'])->assertOk()->assertJsonPath('result', 'OK');
        }
        $this->como('smamani@donguando.pe')->postJson("/api/v1/pre/tareas/{$t}/bolsas", ['count' => $bolsas, 'type' => 'BAG'])->assertOk();
        $this->como('whuanca@donguando.pe')->post("/api/v1/pre/tareas/{$t}/verificar", ['photo' => $this->foto(), 'parcel_count' => $bolsas])->assertOk();
        $this->assertSame('READY', DB::table('sales_orders')->where('id', $p['id'])->value('status'));
    }

    private function vehiculo(string $placa): string
    {
        $this->contexto();

        return DB::table('vehicles')->where('plate', $placa)->value('id');
    }

    private function usuario(string $email): string
    {
        return User::where('email', $email)->value('id');
    }

    /** Ruta del coordinador con esos pedidos, asignada a la moto MTA-123 y a Pedro. */
    private function ruta(array $pedidos, bool $asignar = true): array
    {
        $h = $this->coordinador()->postJson('/api/v1/del/rutas', ['route_date' => self::FECHA, 'establishment_id' => $pedidos[0]['local'], 'slot_id' => $pedidos[0]['slot'],
            'order_ids' => array_column($pedidos, 'id')])->assertCreated()->json();
        if ($asignar) {
            $h = $this->coordinador()->postJson("/api/v1/del/rutas/{$h['ruta']['id']}/asignar", ['mode' => 'OWN', 'vehicle_id' => $this->vehiculo('MTA-123'),
                'driver_user_id' => $this->usuario('pcondori@donguando.pe'), 'driver_pay_mode' => 'DAILY', 'driver_pay_rate' => 80])->assertOk()->json();
        }

        return $h;
    }

    /** Carga todas las bolsas por escaneo, de la última parada a la primera (RN-PRE-08). */
    private function cargarTodo(array $h): array
    {
        $id = $h['ruta']['id'];
        foreach (array_reverse($h['paradas']) as $s) {
            foreach ($s['bolsas'] as $b) {
                $h = $this->repartidor()->postJson("/api/v1/del/rutas/{$id}/cargar", ['code' => $b['label']])->assertOk()->assertJsonPath('ok', true)->json();
            }
        }

        return $h;
    }

    /** Pedidos preparados, ruta asignada, bolsas cargadas y salida. Devuelve la hoja del coordinador. */
    private function enCalle(int $n = 1, string $pago = 'CASH'): array
    {
        $ps = [];
        for ($i = 0; $i < $n; $i++) {
            $ps[] = $p = $this->pedido(1, $pago);
            $this->preparar($p);
        }
        $h = $this->cargarTodo($this->ruta($ps));
        $this->repartidor()->postJson("/api/v1/del/rutas/{$h['ruta']['id']}/salir", ['odometer' => 20000])->assertOk()->assertJsonPath('ruta.status', 'IN_ROUTE');

        return $this->coordinador()->getJson("/api/v1/del/rutas/{$h['ruta']['id']}")->assertOk()->json() + ['pedidos' => $ps];
    }

    /** Cobra y entrega la parada con foto y código, en el pin. */
    private function entregar(array $s): void
    {
        if ($s['pendiente'] > 0) {
            $this->repartidor()->postJson("/api/v1/del/app/paradas/{$s['id']}/cobrar", ['method' => 'CASH', 'amount' => $s['pendiente'], 'client_event_id' => Str::uuid()->toString()])->assertOk();
        }
        $this->repartidor()->post("/api/v1/del/app/paradas/{$s['id']}/entregar", ['photo' => $this->foto(), 'code' => $s['codigo'], 'lat' => $s['lat'], 'lng' => $s['lng'],
            'client_event_id' => Str::uuid()->toString()])->assertOk()->assertJsonPath('status', 'DELIVERED');
    }

    /** Pedidos de demo sin parada, para armar rutas cerradas de un mes aislado (noviembre). */
    private function pedidosLibres(int $n): array
    {
        $this->contexto();

        return DB::table('sales_orders as o')->whereNotExists(fn ($q) => $q->from('delivery_stops as s')->whereColumn('s.order_id', 'o.id'))
            ->orderBy('o.number')->limit($n)->pluck('o.id')->all();
    }

    /** Ruta ya cerrada en una fecha, con sus paradas entregadas (para el costo por entrega y la conciliación). */
    private function rutaCerrada(string $fecha, array $orderIds, array $extra = [], ?string $zona = null): string
    {
        $this->contexto();
        $local = DB::table('establishments')->where('code', 'L1')->value('id');
        $zona ??= DB::table('delivery_zones')->where('establishment_id', $local)->where('province', false)->orderBy('code')->value('id');
        $r = DB::table('delivery_routes')->insertGetId($extra + [
            'code' => 'T-'.strtoupper(Str::random(6)), 'route_date' => $fecha, 'establishment_id' => $local, 'mode' => 'OWN', 'vehicle_id' => $this->vehiculo('MTA-123'),
            'driver_user_id' => $this->usuario('pcondori@donguando.pe'), 'driver_employee_id' => User::where('email', 'pcondori@donguando.pe')->value('employee_id'),
            'sequence_method' => 'MANUAL', 'planned_km' => 30, 'status' => 'SETTLED',
        ], 'id');
        foreach (array_values($orderIds) as $i => $oid) {
            DB::table('delivery_stops')->insert(['route_id' => $r, 'order_id' => $oid, 'seq' => $i + 1, 'zone_id' => $zona, 'status' => 'DELIVERED', 'cod_amount' => 0,
                'collected_amount' => 0, 'bags' => '[]', 'kg' => 1, 'closed_at' => $fecha.' 12:00:00']);
        }

        return $r;
    }

    public function test_ca_del_01_07_10_costo_por_entrega_subsidio_y_nueva_corrida(): void
    {
        $this->travelTo(Carbon::parse('2026-11-30 18:00', 'America/Lima'));
        $ordenes = $this->pedidosLibres(10);
        $this->contexto();
        DB::table('sales_orders')->whereIn('id', $ordenes)->update(['delivery_fee' => 0]);
        DB::table('sales_orders')->where('id', $ordenes[0])->update(['delivery_fee' => 10]);
        $r = $this->rutaCerrada('2026-11-12', $ordenes);
        $moto = $this->vehiculo('MTA-123');

        $this->coordinador()->postJson('/api/v1/del/costos', ['cost_date' => '2026-11-12', 'cost_type' => 'FUEL', 'amount' => 50, 'route_id' => $r])
            ->assertUnprocessable()->assertJsonPath('code', 'RN-DEL-13');
        $this->coordinador()->postJson('/api/v1/del/costos', ['cost_date' => '2026-11-12', 'cost_type' => 'TOLL', 'amount' => 5])
            ->assertUnprocessable()->assertJsonPath('code', 'RN-DEL-13');
        foreach ([
            ['cost_type' => 'FUEL', 'amount' => 50, 'route_id' => $r, 'vehicle_id' => $moto, 'fuel_gallons' => 3.2, 'fuel_voucher_no' => 'V-1001'],
            ['cost_type' => 'DRIVER_WAGE', 'amount' => 80, 'route_id' => $r],
            ['cost_type' => 'DRIVER_MEAL', 'amount' => 15, 'route_id' => $r],
            ['cost_type' => 'TOLL', 'amount' => 5, 'route_id' => $r],
        ] as $c) {
            $this->coordinador()->postJson('/api/v1/del/costos', $c + ['cost_date' => '2026-11-12'])->assertCreated();
        }
        $this->coordinador()->postJson('/api/v1/del/costo-entrega/calcular', ['mes' => '2026-11'])->assertCreated()->assertJsonPath('run_no', 1)->assertJsonPath('entregas', 10);
        $res = $this->gerente()->getJson('/api/v1/del/costo-entrega?mes=2026-11&por=route')->assertOk();
        $this->assertEquals(15.0, $res->json('filas.0.por_entrega'));
        $this->assertEquals(15.0, $res->json('total.por_entrega'));
        // CA-DEL-07: gratis = S/ 15 de subsidio; con S/ 10 cobrados, S/ 5.
        $this->contexto();
        $sub = DB::table('delivery_cost_allocations')->where('period', '2026-11-01')->where('run_no', 1)->pluck('subsidy', 'order_id');
        $this->assertEquals(5.0, (float) $sub[$ordenes[0]]);
        $this->assertEquals(15.0, (float) $sub[$ordenes[1]]);

        // CA-DEL-10: reparación de S/ 20 de la moto → corrida 2 y S/ 17 por entrega; la corrida 1 se conserva.
        $this->coordinador()->postJson('/api/v1/del/costos', ['cost_date' => '2026-11-29', 'cost_type' => 'MAINTENANCE_CORRECTIVE', 'amount' => 20, 'vehicle_id' => $moto])->assertCreated();
        $this->coordinador()->postJson('/api/v1/del/costo-entrega/calcular', ['mes' => '2026-11'])->assertCreated()->assertJsonPath('run_no', 2);
        $res = $this->gerente()->getJson('/api/v1/del/costo-entrega?mes=2026-11&por=vehicle')->assertOk()->assertJsonPath('run_no', 2);
        $this->assertEquals(17.0, $res->json('total.por_entrega'));
        $this->assertCount(2, $res->json('corridas'));
        $this->contexto();
        $this->assertSame(10, DB::table('delivery_cost_allocations')->where('period', '2026-11-01')->where('run_no', 1)->count());
    }

    public function test_ca_del_02_soat_vencido_no_sale(): void
    {
        $this->contexto();
        DB::table('vehicles')->where('plate', 'MTB-456')->update(['soat_expires_on' => '2026-10-10']);
        $p = $this->pedido();
        $h = $this->ruta([$p], false);
        $this->coordinador()->postJson("/api/v1/del/rutas/{$h['ruta']['id']}/asignar", ['mode' => 'OWN', 'vehicle_id' => $this->vehiculo('MTB-456'),
            'driver_user_id' => $this->usuario('pcondori@donguando.pe')])->assertUnprocessable()->assertJsonPath('code', 'RN-DEL-03');
        // RN-DEL-01: un vehículo alquilado no va como propia y una ruta de tercero lleva empresa.
        $this->coordinador()->postJson("/api/v1/del/rutas/{$h['ruta']['id']}/asignar", ['mode' => 'OWN', 'vehicle_id' => $this->vehiculo('BKZ-512'),
            'driver_user_id' => $this->usuario('pcondori@donguando.pe')])->assertUnprocessable()->assertJsonPath('code', 'RN-DEL-01');
        $this->coordinador()->postJson("/api/v1/del/rutas/{$h['ruta']['id']}/asignar", ['mode' => 'THIRD_PARTY'])->assertUnprocessable()->assertJsonPath('code', 'RN-DEL-01');
        // Aviso de 15 días: la MTB vence el 20/10 → se asigna con aviso.
        $this->contexto();
        DB::table('vehicles')->where('plate', 'MTB-456')->update(['soat_expires_on' => '2026-10-20']);
        $r = $this->coordinador()->postJson("/api/v1/del/rutas/{$h['ruta']['id']}/asignar", ['mode' => 'OWN', 'vehicle_id' => $this->vehiculo('MTB-456'),
            'driver_user_id' => $this->usuario('pcondori@donguando.pe')])->assertOk();
        $this->assertStringContainsString('SOAT vence el 20/10/2026', implode(' ', $r->json('warnings')));
        // Si vence después de asignar, tampoco sale.
        $this->contexto();
        DB::table('vehicles')->where('plate', 'MTB-456')->update(['soat_expires_on' => '2026-10-10']);
        $this->coordinador()->postJson("/api/v1/del/rutas/{$h['ruta']['id']}/salir")->assertUnprocessable()->assertJsonPath('code', 'RN-DEL-03');
    }

    public function test_ca_del_03_sale_solo_con_todas_las_bolsas_y_emite_va_en_camino(): void
    {
        $p = $this->pedido(2);
        $this->preparar($p, 2);
        $h = $this->ruta([$p]);
        $id = $h['ruta']['id'];
        $this->assertSame(2, $h['ruta']['bolsas']);
        $this->assertFalse($h['puede_salir']['ok']);
        $bolsas = $h['paradas'][0]['bolsas'];
        $this->repartidor()->postJson("/api/v1/del/rutas/{$id}/cargar", ['code' => $bolsas[0]['label']])->assertOk()->assertJsonPath('ok', true)->assertJsonPath('ruta.status', 'LOADING');
        $this->repartidor()->postJson("/api/v1/del/rutas/{$id}/cargar", ['code' => $bolsas[0]['label']])->assertOk()->assertJsonPath('ok', false);
        $this->repartidor()->postJson("/api/v1/del/rutas/{$id}/salir")->assertUnprocessable()->assertJsonPath('code', 'RN-DEL-04');
        $this->repartidor()->postJson("/api/v1/del/rutas/{$id}/cargar", ['code' => 'XX-NO-EXISTE'])->assertOk()->assertJsonPath('result', 'WRONG_ROUTE');
        $this->repartidor()->postJson("/api/v1/del/rutas/{$id}/cargar", ['code' => $bolsas[1]['label']])->assertOk()->assertJsonPath('ok', true);
        $this->repartidor()->postJson("/api/v1/del/rutas/{$id}/salir", ['odometer' => 20000])->assertOk()->assertJsonPath('ruta.status', 'IN_ROUTE');

        $this->contexto();
        $this->assertSame('IN_ROUTE', DB::table('sales_orders')->where('id', $p['id'])->value('status'));
        $ev = DB::table('domain_events')->where('event_name', 'order.dispatched')->where('aggregate_id', $p['id'])->first();
        $this->assertNotNull($ev);
        $token = json_decode($ev->payload, true)['tracking_token'];
        $this->assertSame(1, preg_match('/^[A-Za-z0-9]{22}$/', $token));
        // El coordinador arma el «va en camino» con el enlace y el código.
        $s = $this->coordinador()->getJson("/api/v1/del/rutas/{$id}")->assertOk()->json('paradas.0');
        $this->assertMatchesRegularExpression('/^\d{4}$/', $s['codigo']);
        $aviso = $this->coordinador()->postJson("/api/v1/del/paradas/{$s['id']}/aviso", ['origin' => 'https://donguando.example'])->assertOk();
        $this->assertStringContainsString('wa.me/51', $aviso->json('url'));
        $this->assertStringContainsString(rawurlencode($s['codigo']), $aviso->json('url'));
        $this->assertSame("https://donguando.example/s/{$token}", $aviso->json('tracking_url'));
        // El repartidor no ve el código.
        $this->assertNull($this->repartidor()->getJson("/api/v1/del/app/rutas/{$id}")->assertOk()->json('paradas.0.codigo'));

        // RN-DEL-08: la página pública solo muestra estado, hora y nombre de pila.
        $this->flushHeaders();
        $pub = $this->getJson("/api/v1/publico/seguimiento/{$token}")->assertOk()->assertJsonPath('estado', 'IN_ROUTE')->assertJsonPath('paso', 3)->json();
        $this->assertSame(explode(' ', User::where('email', 'pcondori@donguando.pe')->value('name'))[0], $pub['repartidor']);
        $this->assertEqualsCanonicalizing(['pedido', 'marca', 'estado', 'paso', 'franja', 'fecha', 'hora_estimada', 'entregado_a_las', 'no_entregado', 'repartidor', 'paradas_antes', 'vence'], array_keys($pub));
        $this->getJson('/api/v1/publico/seguimiento/NOEXISTE0000000000000000')->assertUnprocessable()->assertJsonPath('code', 'RN-DEL-08');
    }

    public function test_ca_del_04_entrega_exige_foto_y_codigo_correcto_y_guarda_la_distancia(): void
    {
        $h = $this->enCalle(1, 'CASH');
        $s = $h['paradas'][0];
        $this->assertGreaterThan(0, $s['pendiente']);
        $this->repartidor()->postJson("/api/v1/del/app/paradas/{$s['id']}/llegar", ['lat' => $s['lat'], 'lng' => $s['lng'], 'client_event_id' => 'arr-'.$s['id']])->assertOk();
        // RN-DEL-09: el monto es el de la parada.
        $this->repartidor()->postJson("/api/v1/del/app/paradas/{$s['id']}/cobrar", ['method' => 'CASH', 'amount' => $s['pendiente'] + 1])
            ->assertUnprocessable()->assertJsonPath('code', 'RN-DEL-09');
        // Sin cobrar no se entrega.
        $this->repartidor()->post("/api/v1/del/app/paradas/{$s['id']}/entregar", ['photo' => $this->foto(), 'code' => $s['codigo']])
            ->assertUnprocessable()->assertJsonPath('code', 'RN-DEL-09');
        $this->repartidor()->postJson("/api/v1/del/app/paradas/{$s['id']}/cobrar", ['method' => 'CASH', 'amount' => $s['pendiente']])->assertOk();
        $this->repartidor()->postJson("/api/v1/del/app/paradas/{$s['id']}/entregar", ['code' => $s['codigo']])->assertUnprocessable()->assertJsonPath('code', 'RN-DEL-06');
        $mal = $s['codigo'][0].$s['codigo'][1].$s['codigo'][3].$s['codigo'][2];
        $mal = $mal === $s['codigo'] ? str_pad((string) (((int) $s['codigo'] + 1) % 10000), 4, '0', STR_PAD_LEFT) : $mal;
        $this->repartidor()->post("/api/v1/del/app/paradas/{$s['id']}/entregar", ['photo' => $this->foto(), 'code' => $mal])->assertUnprocessable()->assertJsonPath('code', 'RN-DEL-06');
        // 0,001° de latitud ≈ 111 m del pin.
        $r = $this->repartidor()->post("/api/v1/del/app/paradas/{$s['id']}/entregar", ['photo' => $this->foto(), 'code' => $s['codigo'], 'lat' => $s['lat'] + 0.001, 'lng' => $s['lng']])
            ->assertOk()->assertJsonPath('status', 'DELIVERED')->assertJsonPath('outside_radius', false);
        $this->assertEqualsWithDelta(111, $r->json('distance_m'), 1.5);
        $this->contexto();
        $this->assertSame('DELIVERED', DB::table('sales_orders')->where('id', $s['order_id'])->value('status'));
        $this->assertSame(['DELIVERED'], DB::table('shipment_parcels')->where('order_id', $s['order_id'])->distinct()->pluck('status')->all());
        // El cobro quedó como pago CONFIRMADO en la caja del repartidor.
        $pago = DB::table('delivery_events as e')->join('payments as p', 'p.id', '=', 'e.payment_id')->where('e.stop_id', $s['id'])->first(['p.status', 'p.amount']);
        $this->assertSame('CONFIRMED', $pago->status);
        $this->assertEquals($s['pendiente'], (float) $pago->amount);
        // RN-DEL-05: con la parada cerrada ya no se registra nada en ella.
        $this->repartidor()->postJson("/api/v1/del/app/paradas/{$s['id']}/llegar")->assertUnprocessable()->assertJsonPath('code', 'RN-DEL-05');
    }

    public function test_ca_del_05_factura_de_empresa_de_delivery_queda_observada(): void
    {
        $this->travelTo(Carbon::parse('2026-11-30 18:00', 'America/Lima'));
        $this->contexto();
        $sup = DB::table('suppliers')->where('trade_name', 'Express Lima')->value('id');
        $zonaConTarifa = DB::table('carrier_rates')->where('supplier_id', $sup)->whereNotNull('zone_id')->pluck('zone_id');
        $zona = DB::table('delivery_zones')->where('province', false)->whereNotIn('id', $zonaConTarifa)->orderBy('code')->value('id');
        $ordenes = $this->pedidosLibres(40);
        $this->rutaCerrada('2026-11-05', array_slice($ordenes, 0, 25), ['mode' => 'THIRD_PARTY', 'vehicle_id' => null, 'driver_user_id' => null, 'driver_employee_id' => null, 'carrier_supplier_id' => $sup], $zona);
        $this->rutaCerrada('2026-11-19', array_slice($ordenes, 25), ['mode' => 'THIRD_PARTY', 'vehicle_id' => null, 'driver_user_id' => null, 'driver_employee_id' => null, 'carrier_supplier_id' => $sup], $zona);

        $prev = $this->gerente()->getJson("/api/v1/del/facturas/envios?supplier_id={$sup}&period_from=2026-11-01&period_to=2026-11-30")->assertOk();
        $this->assertSame(40, $prev->json('envios'));
        $this->assertEquals(360.0, $prev->json('total'));
        $f = $this->gerente()->postJson('/api/v1/del/facturas', ['supplier_id' => $sup, 'invoice_number' => 'F001-0789', 'period_from' => '2026-11-01', 'period_to' => '2026-11-30', 'amount' => 378])
            ->assertCreated()->assertJsonPath('status', 'OBSERVED');
        $this->assertEquals(360.0, (float) $f->json('expected_amount'));
        $this->assertEquals(18.0, (float) $f->json('difference'));
        // Dentro de la tolerancia (S/ 2) queda conciliada.
        $this->gerente()->postJson('/api/v1/del/facturas', ['supplier_id' => $sup, 'invoice_number' => 'F001-0789', 'period_from' => '2026-11-01', 'period_to' => '2026-11-30', 'amount' => 361.5])
            ->assertCreated()->assertJsonPath('status', 'RECONCILED');
        $this->gerente()->postJson('/api/v1/del/facturas', ['supplier_id' => $sup, 'invoice_number' => 'F001-0789', 'period_from' => '2026-11-01', 'period_to' => '2026-11-30', 'amount' => 360])
            ->assertUnprocessable()->assertJsonPath('code', 'RN-DEL-11');
        // Con líneas: una facturada sin envío queda «no registrado».
        $nums = DB::table('sales_orders')->whereIn('id', array_slice($ordenes, 0, 39))->pluck('number')->all();
        $lineas = array_map(fn ($n) => ['ref' => $n, 'amount' => 9], $nums);
        $lineas[] = ['ref' => 'PED-FANTASMA', 'amount' => 9];
        $f2 = $this->gerente()->postJson('/api/v1/del/facturas', ['supplier_id' => $sup, 'invoice_number' => 'F001-0790', 'period_from' => '2026-11-01', 'period_to' => '2026-11-30', 'amount' => 360, 'lines' => $lineas])
            ->assertCreated()->json();
        $l = collect($this->gerente()->getJson("/api/v1/del/facturas/{$f2['id']}")->assertOk()->json('lineas'))->countBy('match_status');
        $this->assertSame(39, $l['MATCHED']);
        $this->assertSame(1, $l['NOT_REGISTERED']);
        $this->assertSame(1, $l['NOT_BILLED']);
    }

    public function test_ca_del_06_comparativo_sugiere_tercerizar_la_zona(): void
    {
        $this->travelTo(Carbon::parse('2026-11-30 18:00', 'America/Lima'));
        $this->contexto();
        DB::table('carrier_rates')->update(['status' => 'VOIDED', 'void_reason' => 'Prueba']);
        $zona = DB::table('delivery_zones')->where('province', false)->orderBy('code')->value('id');
        $sup = DB::table('suppliers')->where('trade_name', 'Express Lima')->value('id');
        $r = $this->rutaCerrada('2026-11-10', $this->pedidosLibres(10), [], $zona);
        $this->coordinador()->postJson('/api/v1/del/costos', ['cost_date' => '2026-11-10', 'cost_type' => 'DRIVER_WAGE', 'amount' => 124, 'route_id' => $r])->assertCreated();
        $this->gerente()->postJson('/api/v1/del/tarifas', ['supplier_id' => $sup, 'zone_id' => $zona, 'rate_basis' => 'PER_DELIVERY', 'amount' => 9, 'valid_from' => '2026-11-01'])->assertCreated();
        // Una tarifa que se cruza con la vigente se rechaza.
        $this->gerente()->postJson('/api/v1/del/tarifas', ['supplier_id' => $sup, 'zone_id' => $zona, 'rate_basis' => 'PER_DELIVERY', 'amount' => 8, 'valid_from' => '2026-11-15'])
            ->assertUnprocessable()->assertJsonPath('code', 'RN-DEL-11');
        $this->coordinador()->postJson('/api/v1/del/costo-entrega/calcular', ['mes' => '2026-11'])->assertCreated();
        $z = collect($this->gerente()->getJson('/api/v1/del/comparativo?mes=2026-11')->assertOk()->json('zonas'))->firstWhere('zone_id', $zona);
        $this->assertEquals(12.40, $z['propia']);
        $this->assertEquals(9.00, $z['tarifa']['por_entrega']);
        $this->assertEquals(3.40, $z['diferencia']);
        $this->assertSame('EVALUAR_TERCERIZAR', $z['sugerencia']);
    }

    public function test_ca_del_08_envio_a_provincia_sin_gre_no_pasa_a_la_agencia(): void
    {
        $this->contexto();
        $env = DB::table('province_shipments')->where('status', 'PREPARED')->whereNull('dispatch_guide_id')->first();
        $this->assertNotNull($env);
        $this->gerente()->postJson("/api/v1/del/provincia/{$env->id}/agencia", ['tracking_number' => 'SH-778812'])
            ->assertUnprocessable()->assertJsonPath('code', 'RN-DEL-12');
        $lista = $this->coordinador()->getJson('/api/v1/del/provincia')->assertOk();
        $this->assertTrue(collect($lista->json('data'))->contains('id', $env->id));
    }

    public function test_ca_del_09_sincronizar_dos_veces_el_mismo_evento_lo_registra_una_vez(): void
    {
        $h = $this->enCalle(1, 'YAPE');
        $s = $h['paradas'][0];
        $img = UploadedFile::fake()->image('x.png', 60, 50);
        $foto = 'data:image/png;base64,'.base64_encode(file_get_contents($img->getRealPath()));
        $eventos = [
            ['client_event_id' => 'tel-arr-1', 'type' => 'ARRIVED', 'stop_id' => $s['id'], 'payload' => ['lat' => $s['lat'], 'lng' => $s['lng']]],
            ['client_event_id' => 'tel-cob-1', 'type' => 'COD_COLLECTED', 'stop_id' => $s['id'], 'payload' => ['method' => 'YAPE', 'amount' => $s['pendiente'], 'reference' => '0045123']],
            ['client_event_id' => 'tel-ent-1', 'type' => 'DELIVERED', 'stop_id' => $s['id'], 'payload' => ['code' => $s['codigo'], 'photo_data' => $foto, 'lat' => $s['lat'], 'lng' => $s['lng']]],
        ];
        $r1 = $this->repartidor()->postJson('/api/v1/del/app/sincronizar', ['events' => $eventos])->assertOk()->json('results');
        $this->assertSame([true, true, true], array_column($r1, 'ok'));
        $this->assertSame([false, false, false], array_column($r1, 'duplicate'));
        $r2 = $this->repartidor()->postJson('/api/v1/del/app/sincronizar', ['events' => $eventos])->assertOk()->json('results');
        $this->assertSame([true, true, true], array_column($r2, 'duplicate'));
        $this->contexto();
        foreach (['tel-arr-1', 'tel-cob-1', 'tel-ent-1'] as $cid) {
            $this->assertSame(1, DB::table('delivery_events')->where('client_event_id', $cid)->count());
        }
        $this->assertSame(1, DB::table('delivery_events')->where('stop_id', $s['id'])->where('event_type', 'COD_COLLECTED')->count());
        // Un evento con error vuelve con su regla, sin cortar los demás.
        $r3 = $this->repartidor()->postJson('/api/v1/del/app/sincronizar', ['events' => [['client_event_id' => 'tel-x', 'type' => 'ARRIVED', 'stop_id' => $s['id']]]])->assertOk();
        $r3->assertJsonPath('results.0.ok', false)->assertJsonPath('results.0.code', 'RN-DEL-05');
    }

    public function test_rn_del_02_un_pedido_tiene_una_sola_parada_activa_y_el_orden_no_repite(): void
    {
        $a = $this->pedido(1, 'CASH', -12.120);
        $b = $this->pedido(1, 'CASH', -12.150);
        $h = $this->ruta([$a, $b], false);
        $this->assertSame([1, 2], array_column($h['paradas'], 'seq'));
        $otra = $this->coordinador()->postJson('/api/v1/del/rutas', ['route_date' => self::FECHA, 'establishment_id' => $a['local']])->assertCreated()->json('ruta.id');
        $this->coordinador()->postJson("/api/v1/del/rutas/{$otra}/paradas", ['order_ids' => [$a['id']]])->assertUnprocessable()->assertJsonPath('code', 'RN-DEL-02');
        // Orden manual: debe traer cada parada una vez.
        $ids = array_column($h['paradas'], 'id');
        $this->coordinador()->postJson("/api/v1/del/rutas/{$h['ruta']['id']}/ordenar", ['stop_ids' => [$ids[0], $ids[0]]])->assertUnprocessable()->assertJsonPath('code', 'RN-DEL-02');
        $h2 = $this->coordinador()->postJson("/api/v1/del/rutas/{$h['ruta']['id']}/ordenar", ['stop_ids' => array_reverse($ids)])->assertOk()->json();
        $this->assertSame(array_reverse($ids), array_column($h2['paradas'], 'id'));
        // Mover a la otra ruta libera la parada.
        $this->coordinador()->postJson("/api/v1/del/paradas/{$ids[0]}/mover", ['route_id' => $otra])->assertOk();
        $this->assertCount(1, $this->coordinador()->getJson("/api/v1/del/rutas/{$otra}")->json('paradas'));
        $this->assertCount(1, $this->coordinador()->getJson("/api/v1/del/rutas/{$h['ruta']['id']}")->json('paradas'));
        // El repartidor no planifica ni ve el planificador.
        $this->repartidor()->postJson('/api/v1/del/rutas', ['route_date' => self::FECHA, 'establishment_id' => $a['local']])->assertForbidden();
        $this->repartidor()->getJson('/api/v1/del/planificador?fecha='.self::FECHA)->assertForbidden();
        $plan = $this->coordinador()->getJson('/api/v1/del/planificador?fecha='.self::FECHA.'&establishment_id='.$a['local'])->assertOk();
        $this->assertTrue(collect($plan->json('pedidos'))->contains('id', $a['id']));
    }

    public function test_rn_del_05_el_repartidor_solo_actua_en_sus_rutas_en_ruta(): void
    {
        $p = $this->pedido();
        $this->preparar($p);
        $h = $this->ruta([$p]);
        $s = $h['paradas'][0];
        $this->repartidor()->postJson("/api/v1/del/app/paradas/{$s['id']}/llegar")->assertUnprocessable()->assertJsonPath('code', 'RN-DEL-05');
        $this->otroRepartidor()->getJson("/api/v1/del/app/rutas/{$h['ruta']['id']}")->assertNotFound();
        $this->otroRepartidor()->postJson("/api/v1/del/app/paradas/{$s['id']}/llegar")->assertNotFound();
        $this->assertFalse(collect($this->otroRepartidor()->getJson('/api/v1/del/app/rutas?fecha='.self::FECHA)->assertOk()->json('data'))->contains('id', $h['ruta']['id']));
        $this->assertTrue(collect($this->repartidor()->getJson('/api/v1/del/app/rutas?fecha='.self::FECHA)->assertOk()->json('data'))->contains('id', $h['ruta']['id']));
        // El teléfono va enmascarado; el número se entrega solo al pedir llamar y queda registrado.
        $this->assertStringContainsString('***', $s['telefono']);
    }

    public function test_rn_del_07_no_entregado_devuelve_bolsas_y_se_reprograma(): void
    {
        $h = $this->enCalle(1, 'CASH');
        $s = $h['paradas'][0];
        $this->repartidor()->postJson("/api/v1/del/app/paradas/{$s['id']}/no-entregar", ['reason' => 'CUSTOMER_ABSENT'])->assertUnprocessable()->assertJsonPath('code', 'RN-DEL-07');
        $this->repartidor()->post("/api/v1/del/app/paradas/{$s['id']}/no-entregar", ['reason' => 'OTHER', 'photo' => $this->foto()])->assertUnprocessable()->assertJsonPath('code', 'RN-DEL-07');
        $this->repartidor()->post("/api/v1/del/app/paradas/{$s['id']}/no-entregar", ['reason' => 'CUSTOMER_ABSENT', 'photo' => $this->foto(), 'notes' => 'Nadie abre'])->assertOk()->assertJsonPath('status', 'FAILED');
        $this->contexto();
        $this->assertSame('NOT_DELIVERED', DB::table('sales_orders')->where('id', $s['order_id'])->value('status'));
        $this->assertSame(['RETURNED'], DB::table('shipment_parcels')->where('order_id', $s['order_id'])->distinct()->pluck('status')->all());
        $lista = $this->coordinador()->getJson('/api/v1/del/no-entregados')->assertOk()->json('data');
        $this->assertTrue(collect($lista)->contains('id', $s['id']));
        // Reprogramar exige recibir antes las bolsas.
        $franja = $h['pedidos'][0]['slot'];
        $this->coordinador()->postJson("/api/v1/del/paradas/{$s['id']}/reprogramar", ['date' => '2026-10-14', 'slot_id' => $franja, 'reason' => 'Cliente pide mañana'])
            ->assertUnprocessable()->assertJsonPath('code', 'RN-DEL-07');
        $this->contexto();
        $lote = DB::table('stock_movements')->where('source_type', 'SALES_ORDER')->where('source_id', $s['order_id'])->where('movement_type', 'SALE')->first();
        $this->coordinador()->postJson("/api/v1/del/paradas/{$s['id']}/recibir-bolsas")->assertOk();
        $this->coordinador()->postJson("/api/v1/del/paradas/{$s['id']}/recibir-bolsas")->assertUnprocessable()->assertJsonPath('code', 'RN-DEL-07');
        $this->contexto();
        $this->assertTrue(DB::table('stock_movements')->where('source_type', 'SALES_ORDER')->where('source_id', $s['order_id'])->where('movement_type', 'RETURN')->exists() || $lote === null);
        $this->assertSame(0, DB::table('picking_tasks')->where('order_id', $s['order_id'])->where('status', '<>', 'CANCELLED')->count());
        $this->coordinador()->postJson("/api/v1/del/paradas/{$s['id']}/reprogramar", ['date' => '2026-10-14', 'slot_id' => $franja, 'reason' => 'Cliente pide mañana'])
            ->assertOk()->assertJsonPath('status', 'RESCHEDULED');
        $this->contexto();
        $o = DB::table('sales_orders')->where('id', $s['order_id'])->first();
        $this->assertSame('CONFIRMED', $o->status);
        $this->assertSame('2026-10-14', $o->delivery_date);
        // Con el pedido libre, la ruta vuelve y se liquida.
        $this->repartidor()->postJson("/api/v1/del/rutas/{$h['ruta']['id']}/volver", ['odometer' => 20020])->assertOk()->assertJsonPath('ruta.status', 'RETURNED');
    }

    public function test_rn_del_10_liquidacion_del_repartidor(): void
    {
        $h = $this->enCalle(2, 'CASH');
        $id = $h['ruta']['id'];
        foreach ($h['paradas'] as $s) {
            $this->entregar($s);
        }
        $cobrado = array_sum(array_column($h['paradas'], 'pendiente'));
        // DEL-17: gasto pagado con el efectivo de la ruta (exige foto del comprobante).
        $this->repartidor()->postJson("/api/v1/del/app/rutas/{$id}/gastos", ['category' => 'FUEL', 'amount' => 12, 'paid_with' => 'ROUTE_CASH', 'fuel_gallons' => 0.8, 'voucher_no' => 'V-88'])
            ->assertUnprocessable()->assertJsonPath('code', 'RN-DEL-16');
        $this->repartidor()->postJson("/api/v1/del/app/rutas/{$id}/gastos", ['category' => 'OTHER', 'amount' => 12, 'paid_with' => 'ROUTE_CASH'])
            ->assertUnprocessable()->assertJsonPath('code', 'RN-DEL-16');
        $this->repartidor()->post("/api/v1/del/app/rutas/{$id}/gastos", ['category' => 'FUEL', 'amount' => 12, 'paid_with' => 'ROUTE_CASH', 'fuel_gallons' => 0.8, 'voucher_no' => 'V-88',
            'photo' => $this->foto()])->assertCreated();
        $this->repartidor()->postJson("/api/v1/del/rutas/{$id}/liquidar", ['counted_cash' => 1])->assertUnprocessable()->assertJsonPath('code', 'RN-DEL-10');
        $this->repartidor()->postJson("/api/v1/del/rutas/{$id}/volver", ['odometer' => 19000])->assertUnprocessable()->assertJsonPath('code', 'RN-DEL-13');
        $this->repartidor()->postJson("/api/v1/del/rutas/{$id}/volver", ['odometer' => 20032])->assertOk()->assertJsonPath('ruta.status', 'RETURNED');
        $l = $this->coordinador()->getJson("/api/v1/del/rutas/{$id}/liquidacion")->assertOk();
        $this->assertEqualsWithDelta($cobrado - 12, $l->json('esperado.efectivo'), 0.001);
        // Quien entrega el efectivo no registra su liquidación; la diferencia lleva motivo.
        $this->repartidor()->postJson("/api/v1/del/rutas/{$id}/liquidar", ['counted_cash' => $cobrado - 12])->assertUnprocessable()->assertJsonPath('code', 'RN-CAJ-11');
        $this->coordinador()->postJson("/api/v1/del/rutas/{$id}/liquidar", ['counted_cash' => $cobrado - 15])->assertUnprocessable()->assertJsonPath('code', 'RN-CAJ-10');
        $st = $this->coordinador()->postJson("/api/v1/del/rutas/{$id}/liquidar", ['counted_cash' => $cobrado - 15, 'reason' => 'Faltan 3 soles de vuelto'])->assertCreated()
            ->assertJsonPath('status', 'WITH_DIFFERENCE')->json();
        $this->coordinador()->postJson("/api/v1/del/liquidaciones/{$st['id']}/aprobar")->assertUnprocessable()->assertJsonPath('code', 'RN-CAJ-10');
        $this->gerente()->postJson("/api/v1/del/liquidaciones/{$st['id']}/aprobar")->assertOk()->assertJsonPath('status', 'APPROVED');
        $this->contexto();
        $this->assertSame('SETTLED', DB::table('delivery_routes')->where('id', $id)->value('status'));
        // Al volver se registró el jornal del repartidor como costo de la ruta.
        $this->assertTrue(DB::table('delivery_costs')->where('route_id', $id)->where('cost_type', 'DRIVER_WAGE')->where('amount', 80)->exists());
    }

    public function test_delx_mensaje_con_captura_apoyo_y_derivacion(): void
    {
        $h = $this->enCalle(2, 'YAPE');
        $id = $h['ruta']['id'];
        [$s1, $s2] = $h['paradas'];
        // DEL-21: captura de pago con monto; control la confirma.
        $m = $this->repartidor()->post("/api/v1/del/app/rutas/{$id}/mensajes", ['kind' => 'CAPTURE', 'stop_id' => $s1['id'], 'amount' => 45.5, 'photo' => $this->foto()])
            ->assertCreated()->json();
        $mid = $m['message']['id'] ?? $m['id'] ?? DB::table('driver_messages')->where('route_id', $id)->value('id');
        $this->coordinador()->postJson("/api/v1/del/mensajes/{$mid}/responder", ['status' => 'CONFIRMED', 'confirmed_amount' => 40])
            ->assertUnprocessable()->assertJsonPath('code', 'RN-DEL-17');
        $this->coordinador()->postJson("/api/v1/del/mensajes/{$mid}/responder", ['status' => 'CONFIRMED', 'confirmed_amount' => 45.5])->assertOk()->assertJsonPath('status', 'CONFIRMED');
        // DEL-20: apoyo para la parada 2, asignado a otra ruta en curso del día.
        $q = $this->repartidor()->postJson("/api/v1/del/app/rutas/{$id}/apoyo", ['stop_ids' => [$s2['id']], 'reason' => 'Se me hace tarde', 'late_min' => 40])->assertCreated()->json();
        $qid = $q['request']['id'] ?? $q['id'] ?? DB::table('support_requests')->where('route_id', $id)->value('id');
        $this->coordinador()->postJson("/api/v1/del/apoyos/{$qid}/resolver", ['action' => 'REJECT'])->assertUnprocessable()->assertJsonPath('code', 'RN-DEL-18');
        $this->coordinador()->postJson("/api/v1/del/apoyos/{$qid}/resolver", ['action' => 'EXTERNAL', 'note' => 'Deriva a un motorizado'])->assertOk();
        // RN-DEL-19: derivación con nombre, placa y tres fotos.
        $this->repartidor()->post("/api/v1/del/app/paradas/{$s2['id']}/derivar", ['courier_name' => 'Juan Pérez', 'plate' => '1234-AB', 'shipping_cost' => 8,
            'photo_courier' => $this->foto(), 'photo_plate' => $this->foto()])->assertUnprocessable()->assertJsonPath('code', 'RN-DEL-19');
        $d = $this->repartidor()->post("/api/v1/del/app/paradas/{$s2['id']}/derivar", ['courier_name' => 'Juan Pérez', 'plate' => '1234-AB', 'shipping_cost' => 8,
            'photo_courier' => $this->foto(), 'photo_plate' => $this->foto(), 'photo_product' => $this->foto()])->assertCreated()->json('handoff');
        $this->assertSame('HANDED', $d['status']);
        $this->coordinador()->postJson("/api/v1/del/derivaciones/{$d['id']}/cerrar", ['delivered' => true, 'method' => 'YAPE', 'reference' => '7781'])->assertOk()->assertJsonPath('status', 'DELIVERED');
        $this->contexto();
        $this->assertSame('DELIVERED', DB::table('sales_orders')->where('id', $s2['order_id'])->value('status'));
        $this->assertTrue(DB::table('driver_expenses')->where('route_id', $id)->where('category', 'EXT_COURIER')->where('amount', 8)->exists());
        // DEL-18: ticket de la parada con el detalle del pedido.
        $t = $this->repartidor()->getJson("/api/v1/del/paradas/{$s1['id']}/ticket")->assertOk()->json();
        $this->assertSame($s1['pedido'], $t['pedido']);
        $this->assertNotEmpty($t['lineas']);
        $this->assertSame($id, $t['route_id']);
        // El ticket mostrado se registra una sola vez aunque el teléfono lo reenvíe (cola sin conexión).
        $this->repartidor()->postJson('/api/v1/del/app/sincronizar', ['events' => [['client_event_id' => 'tk-1', 'type' => 'TICKET', 'stop_id' => $s1['id'], 'payload' => ['via' => 'SHOWN']],
            ['client_event_id' => 'tk-1', 'type' => 'TICKET', 'stop_id' => $s1['id'], 'payload' => ['via' => 'SHOWN']]]])->assertOk()->assertJsonPath('results.1.duplicate', true);
        $this->assertSame(1, DB::table('delivery_events')->where('stop_id', $s1['id'])->where('event_type', 'TICKET')->count());
        // La foto de la captura se abre con un enlace temporal; un archivo ajeno al reparto no.
        $foto = DB::table('driver_messages')->where('id', $mid)->value('photo_file_id');
        $this->coordinador()->postJson("/api/v1/del/archivos/{$foto}/enlace")->assertOk()->assertJsonStructure(['url']);
        $this->coordinador()->postJson('/api/v1/del/archivos/'.Str::uuid().'/enlace')->assertNotFound();
        // DEL-19: direcciones del día con puntaje.
        $dir = $this->coordinador()->getJson('/api/v1/del/direcciones?fecha='.self::FECHA)->assertOk()->json('data');
        $this->assertNotEmpty($dir);
        $this->assertArrayHasKey('score', $dir[0]);
        $u = $this->coordinador()->postJson("/api/v1/del/pedidos/{$dir[0]['order_id']}/pedir-ubicacion")->assertOk()->json();
        $this->assertStringStartsWith('https://wa.me/', (string) $u['url']);
        $this->repartidor()->postJson("/api/v1/del/pedidos/{$dir[0]['order_id']}/pedir-ubicacion")->assertForbidden();
        // DEL-07: el mapa muestra la ruta en curso.
        $mapa = $this->coordinador()->getJson('/api/v1/del/mapa?fecha='.self::FECHA)->assertOk()->json('rutas');
        $this->assertTrue(collect($mapa)->contains('id', $id));
    }

    public function test_opciones_y_vehiculos(): void
    {
        $o = $this->coordinador()->getJson('/api/v1/del/opciones?fecha='.self::FECHA)->assertOk()->json();
        $this->assertTrue($o['puede']['planificar']);
        $this->assertTrue($this->repartidor()->getJson('/api/v1/del/opciones')->assertOk()->json('puede.solo_sus_rutas'));
        // Administración solo lee DEL y tiene sus costos: abre las opciones y los costos, no arma rutas. La caja no entra.
        $this->assertTrue($this->como('chuaman@donguando.pe')->getJson('/api/v1/del/opciones')->assertOk()->json('puede.ver_costos'));
        $this->como('chuaman@donguando.pe')->getJson('/api/v1/del/costos')->assertOk()->assertJsonStructure(['rutas', 'trabajadores', 'proveedores']);
        $this->como('chuaman@donguando.pe')->postJson('/api/v1/del/rutas', [])->assertForbidden();
        $this->como('jsalas@donguando.pe')->getJson('/api/v1/del/opciones')->assertForbidden();
        $this->contexto();
        $local = DB::table('establishments')->where('code', 'L1')->value('id');
        $this->coordinador()->postJson('/api/v1/del/vehiculos', ['plate' => 'mta-123', 'vehicle_type' => 'MOTO', 'ownership' => 'OWN', 'establishment_id' => $local, 'capacity_kg' => 60])
            ->assertUnprocessable();
        $v = $this->coordinador()->postJson('/api/v1/del/vehiculos', ['plate' => 'MTZ-900', 'vehicle_type' => 'MOTO', 'ownership' => 'OWN', 'establishment_id' => $local,
            'capacity_kg' => 60, 'soat_expires_on' => '2027-05-01', 'tech_inspection_expires_on' => '2027-05-01'])->assertCreated()->json();
        $this->assertSame('MTZ-900', $v['plate']);
        $this->repartidor()->postJson('/api/v1/del/vehiculos', ['plate' => 'MTZ-901', 'vehicle_type' => 'MOTO', 'ownership' => 'OWN', 'establishment_id' => $local, 'capacity_kg' => 60])
            ->assertForbidden();
    }
}
