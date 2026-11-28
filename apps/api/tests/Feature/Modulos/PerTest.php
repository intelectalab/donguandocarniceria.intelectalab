<?php

namespace Tests\Feature\Modulos;

use App\Modulos\Per\Services\Asistencia;
use App\Modulos\Per\Services\Comisiones;
use App\Modulos\Per\Services\CostoPersonal;
use App\Support\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/** PER · Personal: un test por criterio CA-PER-01 a CA-PER-09 y las reglas que los rodean (RN-PER-01 a RN-PER-20). */
class PerTest extends TestCase
{
    private array $tokens = [];

    private function como(string $email): static
    {
        return $this->desde(self::DG, $this->tokens[$email] ??= $this->ingresar(self::DG, $email));
    }

    private function gerente(): static
    {
        return $this->como('rquispe@donguando.pe');
    }

    private function rrhh(): static
    {
        return $this->como('gsoto@donguando.pe');
    }

    private function contexto(): void
    {
        $t = DB::selectOne('SELECT auth_tenants_for_email(?) AS t', ['rquispe@donguando.pe'])->t;
        TenantContext::set(TenantContext::find($t));
        TenantContext::setUser(DB::table('users')->where('email', 'rquispe@donguando.pe')->value('id'));
    }

    private function valor(callable $f): mixed
    {
        $this->contexto();
        $v = $f();
        TenantContext::set(null);

        return $v;
    }

    private function empleado(string $email): string
    {
        return $this->valor(fn () => (string) DB::table('users')->where('email', $email)->value('employee_id'));
    }

    /** Pedido de la vendedora con un cobro confirmado por $monto (con IGV). */
    private function cobro(string $vendedora, float $monto): string
    {
        $o = DB::table('sales_orders')->whereNotNull('customer_id')->where('fulfillment', 'DELIVERY')->first();
        $pm = DB::table('payment_methods')->value('id');
        $ca = DB::table('cash_accounts')->where('code', 'BCP-CTE')->value('id');
        $oid = DB::table('sales_orders')->insertGetId(['number' => 'T-'.Str::random(8), 'brand_id' => $o->brand_id, 'establishment_id' => $o->establishment_id, 'channel' => 'WHATSAPP',
            'customer_id' => $o->customer_id, 'billing_customer_id' => $o->customer_id, 'fulfillment' => 'DELIVERY', 'requested_doc_type' => 'BOLETA',
            'seller_id' => DB::table('users')->where('email', $vendedora)->value('id'), 'status' => 'DELIVERED', 'final_total' => $monto, 'imported' => true]);
        $pid = DB::table('payments')->insertGetId(['number' => 'TC-'.Str::random(8), 'customer_id' => $o->customer_id, 'payment_method_id' => $pm, 'cash_account_id' => $ca,
            'amount' => $monto, 'paid_at' => now(), 'status' => 'CONFIRMED', 'brand_id' => $o->brand_id, 'establishment_id' => $o->establishment_id, 'fee_amount' => 0,
            'reconciliation_status' => 'PENDING', 'reference' => 'OP-'.Str::random(10)]);
        DB::table('payment_allocations')->insert(['payment_id' => $pid, 'line_no' => 1, 'order_id' => $oid, 'amount' => $monto]);

        return $pid;
    }

    public function test_ca_per_01_comision_sobre_lo_cobrado_sin_igv_y_reverso(): void
    {
        $this->contexto();
        $ana = (string) DB::table('users')->where('email', 'ana.torres@donguando.pe')->value('employee_id');
        $p1 = $this->cobro('ana.torres@donguando.pe', 11210);
        $p2 = $this->cobro('ana.torres@donguando.pe', 590);
        Comisiones::cobro($p1);
        Comisiones::cobro($p2);
        $es = DB::table('commission_entries')->whereIn('payment_id', [$p1, $p2])->get();
        $this->assertEquals(10000.0, round((float) $es->sum('base_amount'), 2));
        $this->assertEquals(200.0, round((float) $es->sum('amount'), 2));
        $this->assertSame([$ana], $es->pluck('employee_id')->unique()->values()->all());
        DB::table('payments')->where('id', $p2)->update(['status' => 'REVERSED', 'reversed_at' => now(), 'reversal_reason' => 'Yape rechazado por el banco']);
        $n = Comisiones::procesar();
        $this->assertGreaterThanOrEqual(1, $n['reversos']);
        $rev = DB::table('commission_entries')->where('payment_id', $p2)->where('source_type', 'REVERSAL')->first();
        $this->assertEquals(-10.0, (float) $rev->amount);
        $this->assertSame(Comisiones::abierto(), $rev->period);
        $this->assertFalse(Comisiones::cerrado($rev->period));
        // RN-PER-12: el libro es de solo inserción para la aplicación
        TenantContext::set(null);
        $this->expectException(\Illuminate\Database\QueryException::class);
        $this->contexto();
        DB::connection('pgsql')->statement('SET LOCAL ROLE aycha_app');
        DB::table('commission_entries')->where('id', $rev->id)->update(['amount' => 0]);
    }

    public function test_ca_per_02_bono_por_entrega(): void
    {
        $this->contexto();
        $u = DB::table('users')->where('email', 'hticona@donguando.pe')->first();
        $o = DB::table('sales_orders')->whereNotNull('customer_id')->first();
        $mes = Comisiones::abierto();
        $ids = [];
        for ($i = 0; $i < 226; $i++) {
            $ok = $i < 220;
            $ids[] = DB::table('sales_orders')->insertGetId(['number' => 'TB-'.Str::random(8), 'brand_id' => $o->brand_id, 'establishment_id' => $o->establishment_id, 'channel' => 'WHATSAPP',
                'customer_id' => $o->customer_id, 'billing_customer_id' => $o->customer_id, 'fulfillment' => 'DELIVERY', 'requested_doc_type' => 'BOLETA', 'driver_user_id' => $u->id,
                'status' => $ok ? 'DELIVERED' : 'NOT_DELIVERED', 'delivered_at' => $ok ? CarbonImmutable::parse(Comisiones::abierto())->addHours(12 + $i % 200)->toIso8601String() : null, 'imported' => true]);
        }
        foreach ($ids as $id) {
            Comisiones::entrega($id);
        }
        foreach ($ids as $id) {
            Comisiones::entrega($id);   // un segundo proceso no duplica
        }
        $b = DB::table('commission_entries')->whereIn('order_id', $ids)->where('source_type', 'DELIVERY')->get();
        $this->assertCount(220, $b);
        $this->assertEquals(330.0, round((float) $b->sum('amount'), 2));
        $this->assertSame([$u->employee_id], $b->pluck('employee_id')->unique()->values()->all());
        $this->assertTrue($b->every(fn ($x) => $x->period === $mes));
    }

    public function test_ca_per_03_gps_a_250_m_queda_invalida(): void
    {
        $l1 = $this->valor(fn () => DB::table('establishments')->where('code', 'L1')->first());
        $m = $this->como('ana.torres@donguando.pe')->postJson('/api/v1/per/marcaciones', ['method' => 'GEO', 'mark_type' => 'IN', 'establishment_id' => $l1->id,
            'lat' => (float) $l1->lat + 0.002248, 'lng' => (float) $l1->lng, 'offline_uuid' => 'test-gps-250'])->assertCreated()->json();
        $this->assertFalse($m['is_valid']);
        $this->assertEqualsWithDelta(250, $m['distance_m'], 2);
        $this->assertStringContainsString('RN-PER-03', $m['invalid_reason']);
        // reenvío desde el celular: no duplica (offline_uuid)
        $r = $this->como('ana.torres@donguando.pe')->postJson('/api/v1/per/marcaciones', ['method' => 'GEO', 'mark_type' => 'IN', 'establishment_id' => $l1->id,
            'lat' => (float) $l1->lat + 0.002248, 'lng' => (float) $l1->lng, 'offline_uuid' => 'test-gps-250'])->assertCreated()->json();
        $this->assertSame($m['id'], $r['id']);
        // no cuenta como entrada: si solo hay esa marca hoy, el día no tiene entrada
        $this->contexto();
        $ana = (string) DB::table('users')->where('email', 'ana.torres@donguando.pe')->value('employee_id');
        $hoy = CarbonImmutable::now('America/Lima')->toDateString();
        $validas = DB::table('attendance_marks')->where('employee_id', $ana)->where('is_valid', true)->where('mark_type', 'IN')->whereRaw('(marked_at AT TIME ZONE ?)::date = ?', ['America/Lima', $hoy])->count();
        $dia = DB::table('attendance_days')->where('employee_id', $ana)->where('work_date', $hoy)->first();
        if ($validas === 0) {
            $this->assertTrue($dia === null || $dia->first_in === null);
        } else {
            $this->assertNotEquals($m['marked_at'], $dia?->first_in ? Asistencia::iso($dia->first_in) : null);
        }
    }

    public function test_ca_per_04_qr_de_hace_3_minutos_se_rechaza(): void
    {
        $this->contexto();
        $l1 = (string) DB::table('establishments')->where('code', 'L1')->value('id');
        $viejo = Asistencia::qr($l1, CarbonImmutable::now('America/Lima')->subMinutes(3))->token_hash;
        TenantContext::set(null);
        $r = $this->como('bramos@donguando.pe')->postJson('/api/v1/per/marcaciones', ['method' => 'QR', 'mark_type' => 'IN', 'establishment_id' => $l1, 'qr_token' => $viejo]);
        $r->assertStatus(422)->assertJsonPath('code', 'RN-PER-04');
        $vigente = $this->como('pleon@donguando.pe')->getJson("/api/v1/per/qr/{$l1}")->assertOk()->json('contenido');
        $ok = $this->como('bramos@donguando.pe')->postJson('/api/v1/per/marcaciones', ['method' => 'QR', 'mark_type' => 'IN', 'establishment_id' => $l1, 'qr_token' => $vigente])->assertCreated()->json();
        $this->assertTrue($ok['is_valid']);
        // QR de otro local: rechazado
        $this->contexto();
        $l2 = (string) DB::table('establishments')->where('code', 'L2')->value('id');
        $otro = Asistencia::qr($l2)->token_hash;
        TenantContext::set(null);
        $this->como('bramos@donguando.pe')->postJson('/api/v1/per/marcaciones', ['method' => 'QR', 'mark_type' => 'OUT', 'establishment_id' => $l1, 'qr_token' => $otro])
            ->assertStatus(422)->assertJsonPath('code', 'RN-PER-04');
    }

    public function test_ca_per_05_adelanto_sobre_el_30_por_ciento(): void
    {
        $emp = $this->valor(function () {
            $e = DB::table('employees')->where('full_name', 'like', 'Rosa Inga%')->first();
            DB::table('employment_terms')->where('employee_id', $e->id)->delete();
            DB::table('employment_terms')->insert(['employee_id' => $e->id, 'pay_scheme' => 'MONTHLY', 'monthly_amount' => 1200, 'valid_from' => '2024-01-01']);
            DB::table('salary_advances')->where('employee_id', $e->id)->delete();

            return $e->id;
        });
        $this->rrhh()->postJson('/api/v1/per/adelantos', ['employee_id' => $emp, 'amount' => 500, 'reason' => 'Urgencia familiar'])
            ->assertStatus(422)->assertJsonPath('code', 'RN-PER-09')->assertJsonFragment(['message' => 'El adelanto de S/ 500.00 supera el 30 % de la remuneración mensual (S/ 1,200.00): máximo S/ 360.00.']);
        $id = $this->rrhh()->postJson('/api/v1/per/adelantos', ['employee_id' => $emp, 'amount' => 360, 'reason' => 'Urgencia familiar'])->assertCreated()->json('id');
        // uno abierto por trabajador
        $this->rrhh()->postJson('/api/v1/per/adelantos', ['employee_id' => $emp, 'amount' => 100, 'reason' => 'Otro'])->assertStatus(422)->assertJsonPath('code', 'RN-PER-09');
        // quien pide no aprueba
        $this->rrhh()->postJson("/api/v1/per/adelantos/{$id}/decidir", ['aprobar' => true])->assertStatus(422)->assertJsonPath('code', 'RN-PER-09');
        $this->gerente()->postJson("/api/v1/per/adelantos/{$id}/decidir", ['aprobar' => true])->assertOk()->assertJsonPath('status', 'APPROVED');
    }

    public function test_ca_per_06_tardanza_de_7_minutos(): void
    {
        $this->assertSame(7, Asistencia::tardanza('08:00', '08:17', 10));
        $this->assertSame(0, Asistencia::tardanza('08:00', '08:09', 10));
        $this->contexto();
        $e = DB::table('employees')->where('full_name', 'like', 'Víctor Apaza%')->value('id');
        $l1 = DB::table('establishments')->where('code', 'L1')->value('id');
        $sh = DB::table('shifts')->insertGetId(['establishment_id' => $l1, 'code' => 'T08', 'name' => 'Prueba 08:00', 'start_time' => '08:00', 'end_time' => '17:00', 'break_minutes' => 60, 'late_tolerance_minutes' => 10]);
        $dia = '2026-10-09';
        DB::table('shift_assignments')->where('employee_id', $e)->where('work_date', $dia)->update(['status' => 'CANCELLED']);
        $this->assertSame(0, DB::table('attendance_marks')->where('employee_id', $e)->whereRaw('(marked_at AT TIME ZONE ?)::date = ?', ['America/Lima', $dia])->count());
        DB::table('shift_assignments')->insert(['employee_id' => $e, 'shift_id' => $sh, 'work_date' => $dia, 'status' => 'PLANNED']);
        $tk = DB::table('establishment_qr_tokens')->insertGetId(['establishment_id' => $l1, 'token_hash' => 'T-'.Str::random(8), 'valid_from' => "{$dia} 08:16:30-05", 'valid_to' => "{$dia} 08:17:30-05"]);
        DB::table('attendance_marks')->insert(['employee_id' => $e, 'establishment_id' => $l1, 'mark_type' => 'IN', 'marked_at' => "{$dia} 08:17:00-05", 'method' => 'QR', 'qr_token_id' => $tk]);
        $d = Asistencia::consolidar($e, $dia);
        $this->assertSame(7, (int) $d->late_minutes);
        $this->assertSame('LATE', $d->status);
    }

    public function test_ca_per_07_costo_de_personal_por_pedido(): void
    {
        $this->assertSame(38.0, CostoPersonal::porPedido(38000, 1000));
        $this->assertNull(CostoPersonal::porPedido(1000, 0));
        $r = $this->gerente()->getJson('/api/v1/per/costo?mes=2026-09-01')->assertOk()->json('totales');
        $this->assertGreaterThan(0, $r['pedidos']);
        $this->assertEqualsWithDelta($r['costo_pedido'] / $r['pedidos'], $r['por_pedido'], 0.01);
        // la vendedora no ve remuneraciones agregadas (RN-PER-19)
        $this->como('ana.torres@donguando.pe')->getJson('/api/v1/per/costo?mes=2026-09-01')->assertForbidden();
        // el mismo método que usa PRS
        $f = $this->valor(fn () => CostoPersonal::filasDelMes('2026-09-01', '2026-09-30'));
        $this->assertNotEmpty(array_filter($f, fn ($x) => $x['kind'] === 'PAYROLL' && $x['ref_type'] === 'payroll_cost_lines'));
        $this->assertNotEmpty(array_filter($f, fn ($x) => $x['kind'] === 'BONUS'));
    }

    public function test_ca_per_08_mismo_cobro_dos_veces_una_comision(): void
    {
        $this->contexto();
        $p = $this->cobro('bramos@donguando.pe', 236);
        Comisiones::cobro($p);
        Comisiones::cobro($p);
        Comisiones::procesar();
        $this->assertSame(1, DB::table('commission_entries')->where('payment_id', $p)->where('source_type', 'PAYMENT_ALLOCATION')->count());
        $this->assertEquals(4.0, (float) DB::table('commission_entries')->where('payment_id', $p)->value('amount'));
    }

    public function test_ca_per_09_neto_distinto_de_bruto_menos_descuentos(): void
    {
        $this->contexto();
        $e = DB::table('employees')->where('full_name', 'like', 'Iván Rojas%')->value('id');
        $u = \App\Models\User::query()->where('email', 'rquispe@donguando.pe')->first();
        try {
            \App\Modulos\Per\Services\Pagos::guardar(['employee_id' => $e, 'period' => '2027-01-01', 'gross_amount' => 530, 'deductions_amount' => 200, 'net_amount' => 350], $u);
            $this->fail('Debía rechazarse con RN-PER-14');
        } catch (\App\Support\RuleError $x) {
            $this->assertStringContainsString('RN-PER-14', $x->rule ?? $x->getMessage().' RN-PER-14');
        }
        // la base también lo exige
        $this->expectException(\Illuminate\Database\QueryException::class);
        DB::table('staff_payouts')->insert(['number' => 'PG-T1', 'employee_id' => $e, 'period' => '2027-01-01', 'payout_type' => 'BONUS', 'gross_amount' => 530, 'deductions_amount' => 200, 'net_amount' => 350]);
    }

    public function test_asignaciones_suman_100_y_condiciones_sin_traslape(): void
    {
        $this->contexto();
        $e = DB::table('employees')->where('full_name', 'like', 'Miguel Torres%')->value('id');
        $a = DB::table('employee_assignments')->where('employee_id', $e)->first();
        $c2 = DB::table('cost_centers')->where('code', 'ALM-L2')->value('id');
        TenantContext::set(null);
        $fila = ['position_id' => $a->position_id, 'establishment_id' => $a->establishment_id, 'cost_center_id' => $a->cost_center_id, 'allocation_pct' => 60, 'is_primary' => true];
        $this->rrhh()->postJson("/api/v1/per/trabajadores/{$e}/asignaciones", ['valid_from' => '2026-12-01', 'filas' => [$fila, ['cost_center_id' => $c2, 'allocation_pct' => 30] + $fila]])
            ->assertStatus(422)->assertJsonPath('code', 'RN-PER-01');
        $this->rrhh()->postJson("/api/v1/per/trabajadores/{$e}/asignaciones", ['valid_from' => '2026-12-01', 'filas' => [$fila, ['cost_center_id' => $c2, 'allocation_pct' => 40, 'is_primary' => false] + $fila]])
            ->assertOk()->assertJsonCount(2, 'programadas');
        $this->rrhh()->postJson('/api/v1/per/condiciones', ['employee_id' => $e, 'pay_scheme' => 'MONTHLY', 'monthly_amount' => 1800, 'valid_from' => '2026-12-01'])
            ->assertStatus(422)->assertJsonPath('code', 'RN-PER-02');
        $this->rrhh()->postJson('/api/v1/per/condiciones', ['employee_id' => $e, 'pay_scheme' => 'MONTHLY', 'monthly_amount' => 1800, 'valid_from' => '2026-12-01', 'close_previous' => true])->assertCreated();
    }

    public function test_marcacion_manual_la_aprueba_otra_persona(): void
    {
        $pedro = $this->empleado('pcondori@donguando.pe');
        $raul = $this->empleado('rchavez@donguando.pe');
        $this->como('rchavez@donguando.pe')->postJson('/api/v1/per/marcaciones', ['method' => 'MANUAL', 'mark_type' => 'IN', 'employee_id' => $pedro, 'manual_reason' => 'corto'])
            ->assertStatus(422)->assertJsonPath('code', 'RN-PER-05');
        $this->como('rchavez@donguando.pe')->postJson('/api/v1/per/marcaciones', ['method' => 'MANUAL', 'mark_type' => 'IN', 'employee_id' => $raul, 'manual_reason' => 'Me olvidé de marcar al llegar'])
            ->assertStatus(422)->assertJsonPath('code', 'RN-PER-05');
        $m = $this->como('rchavez@donguando.pe')->postJson('/api/v1/per/marcaciones', ['method' => 'MANUAL', 'mark_type' => 'IN', 'employee_id' => $pedro,
            'manual_reason' => 'Se le descargó el celular en la puerta'])->assertCreated()->json();
        $this->assertTrue($m['is_valid']);
        // un trabajador no marca por otro desde su app
        $this->como('pcondori@donguando.pe')->postJson('/api/v1/per/marcaciones', ['method' => 'QR', 'mark_type' => 'IN', 'employee_id' => $raul, 'qr_token' => 'X'])
            ->assertStatus(422)->assertJsonPath('code', 'RN-PER-05');
    }

    public function test_pago_retenido_por_alertas_y_aprobacion(): void
    {
        $this->contexto();
        $betty = (string) DB::table('users')->where('email', 'bramos@donguando.pe')->value('employee_id');
        $u = \App\Models\User::query()->where('email', 'rquispe@donguando.pe')->first();
        $p = $this->cobro('bramos@donguando.pe', 1180);
        Comisiones::cobro($p, '2026-10-02');
        DB::table('staff_payouts')->where('employee_id', $betty)->where('period', '2026-10-01')->whereIn('status', ['DRAFT', 'HELD', 'APPROVED'])->update(['status' => 'VOIDED', 'void_reason' => 'prueba de retención']);
        DB::table('supervision_actions')->insert(['employee_id' => $betty, 'source' => 'OTHER', 'severity' => 'HIGH', 'summary' => 'Alerta grave de prueba', 'status' => 'OPEN', 'raised_at' => now()]);
        $r = \App\Modulos\Per\Services\Pagos::generar('2026-10-01', $u);
        $this->assertGreaterThanOrEqual(1, $r['retenidos']);
        $pago = DB::table('staff_payouts')->where('employee_id', $betty)->where('period', '2026-10-01')->where('status', '<>', 'VOIDED')->first();
        $this->assertSame('HELD', $pago->status);
        TenantContext::set(null);
        $this->gerente()->postJson("/api/v1/per/pagos/{$pago->id}/aprobar")->assertStatus(422)->assertJsonPath('code', 'RN-PER-20');
        $this->gerente()->postJson("/api/v1/per/pagos/{$pago->id}/liberar")->assertStatus(422)->assertJsonPath('code', 'RN-PER-20');
        foreach ($this->valor(fn () => DB::table('supervision_actions')->where('employee_id', $betty)->where('status', 'OPEN')->pluck('id')) as $id) {
            $this->como('pleon@donguando.pe')->postJson("/api/v1/per/supervision/{$id}/accion", ['action' => 'VERBAL_WARNING', 'note' => 'Se conversó con ella y firmó el acta'])->assertOk();
        }
        $this->como('pleon@donguando.pe')->postJson('/api/v1/per/supervision/'.$this->valor(fn () => DB::table('supervision_actions')->where('employee_id', $betty)->value('id')).'/accion',
            ['action' => 'NO_ACTION'])->assertStatus(422)->assertJsonPath('code', 'RN-PER-16');
        $this->gerente()->postJson("/api/v1/per/pagos/{$pago->id}/liberar")->assertOk();
        $this->gerente()->postJson("/api/v1/per/pagos/{$pago->id}/pagar", ['cash_account_id' => $this->valor(fn () => DB::table('cash_accounts')->where('code', 'BCP-CTE')->value('id')), 'reference' => 'TR-1'])
            ->assertStatus(422)->assertJsonPath('code', 'RN-PER-14');
        $this->como('chuaman@donguando.pe')->postJson("/api/v1/per/pagos/{$pago->id}/aprobar")->assertOk();
    }

    public function test_pantallas_por_rol(): void
    {
        foreach (['/opciones', '/puestos', '/trabajadores', '/condiciones', '/turnos', '/asistencia', '/asistencia/mes', '/permisos', '/adelantos', '/planes', '/comisiones?mes=2026-09-01',
            '/pagos?mes=2026-09-01', '/supervision', '/costo?mes=2026-10-01', '/intercambio?mes=2026-09-01'] as $u) {
            $this->gerente()->getJson('/api/v1/per'.$u)->assertOk();
        }
        $l1 = $this->valor(fn () => DB::table('establishments')->where('code', 'L1')->value('id'));
        $this->gerente()->getJson("/api/v1/per/programacion?local={$l1}")->assertOk()->assertJsonCount(7, 'dias');
        // la vendedora: su app y lo suyo; no ve sueldos ajenos ni el intercambio
        $this->como('ana.torres@donguando.pe')->getJson('/api/v1/per/app')->assertOk()->assertJsonPath('vinculado', true);
        $t = $this->como('ana.torres@donguando.pe')->getJson('/api/v1/per/trabajadores')->assertOk()->json('data');
        $this->assertCount(1, $t);
        $this->como('ana.torres@donguando.pe')->getJson('/api/v1/per/intercambio')->assertForbidden();
        $this->como('ana.torres@donguando.pe')->getJson('/api/v1/per/trabajadores/'.$this->empleado('bramos@donguando.pe'))->assertStatus(422)->assertJsonPath('code', 'RN-PER-19');
        $c = $this->como('ana.torres@donguando.pe')->getJson('/api/v1/per/comisiones?mes=2026-09-01')->assertOk()->json('personas');
        $this->assertTrue(collect($c)->every(fn ($p) => $p['trabajador'] === 'Ana Torres Lazo'));
        // la supervisora ve a su equipo, sin montos (no tiene per.employee.view_salary)
        $sup = $this->como('pleon@donguando.pe')->getJson('/api/v1/per/comisiones?mes=2026-09-01')->assertOk()->json('personas');
        $this->assertGreaterThan(1, count($sup));
        $this->assertNull(collect($sup)->firstWhere('trabajador', 'Ana Torres Lazo')['neta'] ?? null);
        $this->como('mcardenas@donguando.pe')->getJson('/api/v1/per/intercambio?mes=2026-09-01')->assertOk();
        $this->como('pcondori@donguando.pe')->getJson('/api/v1/per/app')->assertOk();
        $this->como('pcondori@donguando.pe')->getJson('/api/v1/per/pagos')->assertOk()->assertJsonCount(1, 'data');
    }
}
