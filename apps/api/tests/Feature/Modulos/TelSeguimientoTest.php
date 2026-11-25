<?php

namespace Tests\Feature\Modulos;

use App\Support\TenantContext;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/** TEL-08 Historial, TEL-09 Llamadas perdidas y TEL-11 Panel de supervisión (RN-TEL-07; CA-TEL-07; KPI-TEL-01 a 07). */
class TelSeguimientoTest extends TestCase
{
    private const ADMIN = 'lccahuana@donguando.pe';

    private const GERENTE = 'rquispe@donguando.pe';

    private const SUPERVISORA = 'pleon@donguando.pe';

    private const A = 'ana.torres@donguando.pe';

    private const B = 'bramos@donguando.pe';

    private array $tokens = [];

    private function como(string $email): static
    {
        return $this->desde(self::DG, $this->tokens[$email] ??= $this->ingresar(self::DG, $email));
    }

    private function enEmpresa(callable $f): mixed
    {
        TenantContext::set(['id' => DB::table('tenants')->where('short', 'Don Guando')->value('id')]);
        TenantContext::setUser(DB::table('users')->where('email', self::ADMIN)->value('id'));
        try {
            return $f();
        } finally {
            TenantContext::set(null);
        }
    }

    private function id(string $email): string
    {
        return $this->enEmpresa(fn () => DB::table('users')->where('email', $email)->value('id'));
    }

    private function preparar(): void
    {
        foreach (['CARRIER_FORWARDING', 'SIGNED_POLICY'] as $p) {
            $this->como(self::GERENTE)->postJson("/api/v1/plt/modulos/tel/pasos/{$p}", ['notes' => 'Constancia archivada en la carpeta de Telefonía'])->assertOk();
        }
        $this->como(self::GERENTE)->putJson('/api/v1/plt/modulos/TEL', ['enabled' => true, 'reason' => 'Central lista para las vendedoras'])->assertOk();
        $this->tokens = [];
        $base = collect($this->como(self::ADMIN)->getJson('/api/v1/tel/ajustes')->json())->only(['provider', 'connector_id', 'recording_enabled', 'recording_notice_text', 'ring_strategy',
            'retention_days', 'callback_due_minutes', 'ring_timeout_s', 'transcription_enabled', 'outbound_registered_only', 'tarifas'])->all();
        $this->como(self::ADMIN)->putJson('/api/v1/tel/ajustes', ['provider' => 'FAKE'] + $base)->assertOk();
        $this->como(self::ADMIN)->postJson('/api/v1/tel/activacion/en-vivo')->assertOk();
    }

    public function test_historial_cada_quien_lo_suyo_con_filtros(): void
    {
        $this->preparar();
        $s = $this->como(self::SUPERVISORA)->getJson('/api/v1/tel/historial')->assertOk();
        $this->assertSame([122, true], [$s->json('total'), $s->json('todas')]);
        $this->assertSame([122, 96], [$s->json('cifras.total'), $s->json('cifras.atendidas')]);
        $this->assertSame(14, $s->json('cifras.perdidas'), 'Entrantes perdidas, sin respuesta o al buzón');
        $this->assertNotNull($s->json('cifras.con_pedido_pct'));
        $this->assertSame(6, $this->como(self::SUPERVISORA)->getJson('/api/v1/tel/historial?estado=MISSED')->json('total'));
        $this->assertSame(96, $this->como(self::SUPERVISORA)->getJson('/api/v1/tel/historial?grabacion=1')->json('total'));
        $uno = $s->json('data.0.numero');
        $this->assertGreaterThanOrEqual(1, $this->como(self::SUPERVISORA)->getJson('/api/v1/tel/historial?buscar='.urlencode($uno))->json('total'));
        // La vendedora solo las suyas.
        $a = $this->como(self::A)->getJson('/api/v1/tel/historial?per_page=100')->assertOk();
        $this->assertFalse($a->json('todas'));
        $this->assertLessThan(122, $a->json('total'));
        $this->assertTrue(collect($a->json('data'))->every(fn ($c) => $c['vendedora'] === 'Ana Torres Lazo'));
        // El detalle trae la grabación y la tarea, si la hay.
        $con = collect($s->json('data'))->firstWhere('grabacion', 'AVAILABLE');
        $d = $this->como(self::SUPERVISORA)->getJson('/api/v1/tel/llamadas/'.$con['id'])->assertOk();
        $this->assertSame('AVAILABLE', $d->json('grabacion.status'));
    }

    public function test_perdidas_con_vencimiento_y_devueltas_a_tiempo(): void
    {
        $this->travelTo(Carbon::parse('2026-11-24 10:00', 'America/Lima'));   // martes
        $this->preparar();
        $r = $this->como(self::A)->postJson('/api/v1/tel/telefono/simular', ['from' => '+51955500901', 'option' => 1, 'resultado' => 'MISSED'])->assertCreated();
        $lead = $this->enEmpresa(fn () => DB::table('tel_calls')->where('id', $r->json('id'))->value('lead_id'));
        $p = $this->como(self::A)->getJson('/api/v1/tel/perdidas?estado=OPEN&buscar=955500901')->assertOk();
        $this->assertSame([1, '+51955500901', true, false], [$p->json('total'), $p->json('data.0.numero'), $p->json('data.0.puede'), $p->json('data.0.vencida')]);
        $this->assertSame(0, $this->como(self::B)->getJson('/api/v1/tel/perdidas?buscar=955500901')->json('total'), 'B no ve la tarea de Ana');
        $this->assertSame(1, $this->como(self::SUPERVISORA)->getJson('/api/v1/tel/perdidas?buscar=955500901')->json('total'));

        // A los 31 minutos está vencida; Ana la devuelve y el cliente contesta: queda hecha (tarde).
        $this->travel(31)->minutes();
        $this->tokens = [];   // la sesión de prueba vence por inactividad
        $this->assertSame(1, $this->como(self::A)->getJson('/api/v1/tel/perdidas?estado=VENCIDA&buscar=955500901')->json('total'));
        $l = $this->como(self::A)->postJson('/api/v1/tel/llamadas', ['lead_id' => $lead])->assertCreated();
        $this->como(self::A)->postJson('/api/v1/tel/llamadas/'.$l->json('id').'/resultado', ['estado' => 'COMPLETED', 'segundos' => 60])->assertOk();
        $h = $this->como(self::A)->getJson('/api/v1/tel/perdidas?estado=DONE&buscar=955500901')->json('data.0');
        $this->assertSame(['DONE', 'Llamada devuelta: el cliente contestó.', false], [$h['status'], $h['result'], $h['a_tiempo']]);

        // Otra perdida devuelta a tiempo.
        $r2 = $this->como(self::A)->postJson('/api/v1/tel/telefono/simular', ['from' => '+51955500902', 'option' => 1, 'resultado' => 'NO_ANSWER'])->assertCreated();
        $lead2 = $this->enEmpresa(fn () => DB::table('tel_calls')->where('id', $r2->json('id'))->value('lead_id'));
        $this->travel(5)->minutes();
        $l2 = $this->como(self::A)->postJson('/api/v1/tel/llamadas', ['lead_id' => $lead2])->assertCreated();
        $this->como(self::A)->postJson('/api/v1/tel/llamadas/'.$l2->json('id').'/resultado', ['estado' => 'COMPLETED', 'segundos' => 30])->assertOk();
        $this->assertTrue($this->como(self::A)->getJson('/api/v1/tel/perdidas?buscar=955500902')->json('data.0.a_tiempo'));
        // Si no contesta, la tarea sigue abierta.
        $r3 = $this->como(self::A)->postJson('/api/v1/tel/telefono/simular', ['from' => '+51955500903', 'option' => 1, 'resultado' => 'MISSED'])->assertCreated();
        $lead3 = $this->enEmpresa(fn () => DB::table('tel_calls')->where('id', $r3->json('id'))->value('lead_id'));
        $l3 = $this->como(self::A)->postJson('/api/v1/tel/llamadas', ['lead_id' => $lead3])->assertCreated();
        $this->como(self::A)->postJson('/api/v1/tel/llamadas/'.$l3->json('id').'/resultado', ['estado' => 'NO_ANSWER'])->assertOk();
        $this->assertSame('OPEN', $this->como(self::A)->getJson('/api/v1/tel/perdidas?buscar=955500903')->json('data.0.status'));
    }

    public function test_panel_en_vivo_del_dia_por_vendedora_y_costo_del_mes_ca_tel_07(): void
    {
        $this->travelTo(Carbon::parse('2026-11-24 10:00', 'America/Lima'));
        $this->preparar();
        $this->como(self::A)->getJson('/api/v1/tel/panel')->assertForbidden();
        $this->como(self::A)->postJson('/api/v1/tel/telefono/simular', ['from' => '+51955500911', 'option' => 1, 'resultado' => 'COMPLETED', 'segundos' => 90])->assertCreated();
        $this->como(self::A)->postJson('/api/v1/tel/telefono/simular', ['from' => '+51955500912', 'option' => 1, 'resultado' => 'MISSED'])->assertCreated();
        $cli = $this->enEmpresa(fn () => DB::table('customers')->where('phone', 'like', '+519%')->where('status', 'ACTIVE')->whereNull('merged_into_id')->value('id'));
        $this->como(self::A)->postJson('/api/v1/tel/llamadas', ['customer_id' => $cli])->assertCreated();   // queda sonando

        $p = $this->como(self::SUPERVISORA)->getJson('/api/v1/tel/panel')->assertOk();
        $this->assertEquals(['2026-11-24', 2, 1, 50, 1], [$p->json('dia'), $p->json('cifras.entrantes'), $p->json('cifras.atendidas'), $p->json('cifras.atendidas_pct'), $p->json('cifras.perdidas')]);
        $this->assertGreaterThanOrEqual(1, $p->json('cifras.sonando'), 'La demostración ya trae una sonando');
        $this->assertTrue(collect($p->json('vivo'))->contains(fn ($c) => $c['direccion'] === 'Saliente' && $c['vendedora'] === 'Ana Torres Lazo'));
        $ana = collect($p->json('vendedoras'))->firstWhere('nombre', 'Ana Torres Lazo');
        $this->assertSame([2, 1, 1], [$ana['llamadas'], $ana['atendidas'], $ana['perdidas']]);
        // Un día con las llamadas de la demostración.
        $this->assertGreaterThan(0, $this->como(self::SUPERVISORA)->getJson('/api/v1/tel/panel?dia=2026-10-09')->json('cifras.entrantes'));

        // CA-TEL-07: 900 minutos salientes a celular con grabación y transcripción ≈ USD 114 (66,6 + 2,25 + 45).
        $this->enEmpresa(function () {
            $num = DB::table('tel_numbers')->where('status', 'ACTIVE')->first(['id', 'e164', 'brand_id']);
            $marca = DB::table('brands')->where('name', 'Don Guando')->value('id');
            $ped = DB::table('sales_orders')->where('brand_id', $marca)->orderByDesc('created_at')->limit(15)->pluck('id')->all();
            foreach (range(1, 15) as $i) {
                $c = DB::table('tel_calls')->insertGetId(['provider_call_id' => "CA-COSTO-{$i}", 'preview' => false, 'number_id' => $num->id, 'direction' => 'OUTBOUND', 'from_e164' => $num->e164,
                    'to_e164' => '+5195550'.str_pad((string) (1000 + $i), 4, '0', STR_PAD_LEFT), 'brand_id' => $marca, 'status' => 'COMPLETED', 'notice_played' => true,
                    'started_at' => Carbon::parse('2026-12-0'.(1 + $i % 9).' 11:00', 'America/Lima'), 'wait_seconds' => 10, 'duration_seconds' => 3600, 'order_id' => $ped[$i - 1] ?? null], 'id');
                $g = DB::table('tel_recordings')->insertGetId(['call_id' => $c, 'duration_seconds' => 3600, 'provider_recording_id' => "RE-COSTO-{$i}", 'retention_until' => '2027-06-01',
                    'legal_hold' => false, 'status' => 'AVAILABLE', 'preview' => false], 'id');
                DB::table('tel_transcripts')->insert(['call_id' => $c, 'recording_id' => $g, 'provider' => 'FAKE', 'language' => 'es', 'transcript' => 'Prueba de costo', 'cost_usd' => 3,
                    'preview' => false, 'preview_alerts' => '[]']);
            }
        });
        $c = $this->como(self::SUPERVISORA)->getJson('/api/v1/tel/panel?mes=2026-12')->assertOk()->json('costo');
        $this->assertEquals([900, 66.6, 2.25, 45, 113.85, 15], [$c['minutos'], $c['voz_usd'], $c['grabacion_usd'], $c['transcripcion_usd'], $c['total_usd'], $c['pedidos']]);
        $this->assertEqualsWithDelta($c['total_usd'] * $c['tipo_de_cambio'], $c['total_pen'], 0.01);
        $this->assertEqualsWithDelta($c['total_pen'] / 15, $c['por_pedido_pen'], 0.01);
        $this->como(self::SUPERVISORA)->getJson('/api/v1/tel/panel?dia=2027-01-01')->assertStatus(422);
    }
}
