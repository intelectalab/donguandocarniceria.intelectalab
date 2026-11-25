<?php

namespace Tests\Feature\Modulos;

use App\Support\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/** TEL-06 Teléfono en la app y TEL-07 Llamar desde la ficha o el pedido (RN-TEL-04 a 08; CA-TEL-03 y 04). */
class TelLlamadasTest extends TestCase
{
    private const ADMIN = 'lccahuana@donguando.pe';

    private const GERENTE = 'rquispe@donguando.pe';

    private const SUPERVISORA = 'pleon@donguando.pe';

    private const CONTADORA = 'mcardenas@donguando.pe';

    private const A = 'ana.torres@donguando.pe';

    private const B = 'bramos@donguando.pe';

    private const E = 'evargas@donguando.pe';   // Don Guando y Marca 5

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

    /** Enciende Telefonía con el adaptador de prueba; con $enVivo, la pasa a en vivo. */
    private function preparar(bool $enVivo = true): void
    {
        foreach (['CARRIER_FORWARDING', 'SIGNED_POLICY'] as $p) {
            $this->como(self::GERENTE)->postJson("/api/v1/plt/modulos/tel/pasos/{$p}", ['notes' => 'Constancia archivada en la carpeta de Telefonía'])->assertOk();
        }
        $this->como(self::GERENTE)->putJson('/api/v1/plt/modulos/TEL', ['enabled' => true, 'reason' => 'Central lista para las vendedoras'])->assertOk();
        $this->tokens = [];
        $this->ajustes(['provider' => 'FAKE']);
        if ($enVivo) {
            $this->como(self::ADMIN)->postJson('/api/v1/tel/activacion/en-vivo')->assertOk();
        }
    }

    private function ajustes(array $cambios): void
    {
        $base = collect($this->como(self::ADMIN)->getJson('/api/v1/tel/ajustes')->json())->only(['provider', 'connector_id', 'recording_enabled', 'recording_notice_text', 'ring_strategy',
            'retention_days', 'callback_due_minutes', 'ring_timeout_s', 'transcription_enabled', 'outbound_registered_only', 'tarifas'])->all();
        $this->como(self::ADMIN)->putJson('/api/v1/tel/ajustes', $cambios + $base)->assertOk();
    }

    private function entra(string $quien, array $d): \Illuminate\Testing\TestResponse
    {
        return $this->como($quien)->postJson('/api/v1/tel/telefono/simular', $d);
    }

    public function test_en_configuracion_no_se_cursan_llamadas_y_apagada_no_hay_api(): void
    {
        $this->como(self::A)->getJson('/api/v1/tel/telefono')->assertForbidden();
        $this->preparar(false);
        $t = $this->como(self::A)->getJson('/api/v1/tel/telefono')->assertOk();
        $this->assertSame([false, '+5117085500', true], [$t->json('en_vivo'), $t->json('central'), $t->json('simulador')]);
        $this->entra(self::A, ['from' => '+51955500777', 'option' => 1, 'resultado' => 'COMPLETED'])->assertStatus(422)->assertJsonPath('code', 'RN-TEL-02');
        $this->como(self::CONTADORA)->getJson('/api/v1/tel/telefono')->assertForbidden();
    }

    public function test_entrante_de_un_desconocido_crea_el_lead_y_se_graba_con_aviso_ca_tel_04(): void
    {
        $this->travelTo(Carbon::parse('2026-10-01 10:00', 'America/Lima'));
        $this->preparar();
        $r = $this->entra(self::A, ['from' => '955 500 777', 'option' => 1, 'resultado' => 'COMPLETED', 'segundos' => 150])->assertCreated();
        $this->assertSame([true, 'COMPLETED', 'LEAD', true], [$r->json('nuevo_lead'), $r->json('estado'), $r->json('llamada.ficha.tipo'), $r->json('llamada.ficha.nuevo')]);
        $c = $this->enEmpresa(fn () => DB::table('tel_calls')->where('id', $r->json('id'))->first());
        $this->assertSame(['+51955500777', $this->id(self::A), true, 1], [$c->from_e164, $c->user_id, (bool) $c->notice_played, (int) $c->menu_option]);
        $this->assertSame('PHONE', $this->enEmpresa(fn () => DB::table('leads')->where('id', $c->lead_id)->value('source')));
        // CA-TEL-04: grabada el 01/10/2026, se conserva hasta el 30/03/2027 (180 días).
        $this->assertSame('2027-03-30', $this->enEmpresa(fn () => DB::table('tel_recordings')->where('call_id', $c->id)->value('retention_until')));
        // Inbound 3 minutos con grabación: 3 × 0,0085 + 3 × 0,0025.
        $this->assertEqualsWithDelta(0.033, (float) $c->cost_usd, 0.0001);

        // Un cliente conocido: su ficha con pedidos; no se crea otro lead.
        $cli = $this->enEmpresa(fn () => DB::table('customers')->where('status', 'ACTIVE')->whereNull('merged_into_id')->where('orders_count', '>', 0)->whereNotNull('phone')->first(['id', 'phone']));
        $r2 = $this->entra(self::A, ['from' => $cli->phone, 'option' => 1, 'resultado' => 'COMPLETED'])->assertCreated();
        $this->assertSame(['CLIENTE', $cli->id, false], [$r2->json('llamada.ficha.tipo'), $r2->json('llamada.ficha.id'), $r2->json('nuevo_lead')]);
        $this->assertGreaterThan(0, $r2->json('llamada.ficha.pedidos'));

        // Sin grabación, no hay grabación.
        $this->ajustes(['recording_enabled' => false]);
        $r3 = $this->entra(self::A, ['from' => '955 500 778', 'option' => 1, 'resultado' => 'COMPLETED'])->assertCreated();
        $this->assertFalse($this->enEmpresa(fn () => DB::table('tel_recordings')->where('call_id', $r3->json('id'))->exists()));
    }

    public function test_ca_tel_03_perdida_deja_la_tarea_a_los_30_minutos_y_se_cierra_sola(): void
    {
        $this->travelTo(Carbon::parse('2026-10-06 10:00', 'America/Lima'));   // martes
        $this->preparar();
        $r = $this->entra(self::SUPERVISORA, ['from' => '+51955500888', 'option' => 1, 'resultado' => 'MISSED'])->assertCreated();
        $t = $this->enEmpresa(fn () => DB::table('crm_tasks')->where('call_id', $r->json('id'))->first());
        $this->assertSame(['CALLBACK', 'OPEN', $this->id(self::A)], [$t->task_type, $t->status, $t->assigned_user_id], 'Para la primera del grupo de la marca');
        $this->assertSame('10:30', Carbon::parse($t->due_at)->setTimezone('America/Lima')->format('H:i'));
        $this->assertTrue($this->enEmpresa(fn () => DB::table('notifications')->where('user_id', $this->id_sin(self::A))->where('title', 'Devolver una llamada perdida')->exists()));
        // Una sola tarea abierta por llamada (la base).
        try {
            $this->enEmpresa(fn () => DB::transaction(fn () => DB::table('crm_tasks')->insert(['task_type' => 'CALLBACK', 'status' => 'OPEN', 'brand_id' => $t->brand_id, 'due_at' => now(), 'note' => 'x', 'call_id' => $r->json('id')])));
            $this->fail('La base debió rechazarlo');
        } catch (QueryException) {
            $this->assertTrue(true);
        }

        // A las 12:00 vuelve a llamar y la atienden: la tarea se cierra sola.
        $this->travelTo(Carbon::parse('2026-10-06 12:00', 'America/Lima'));
        $this->entra(self::B, ['from' => '955 500 888', 'option' => 1, 'resultado' => 'COMPLETED'])->assertCreated();
        $t = $this->enEmpresa(fn () => DB::table('crm_tasks')->where('id', $t->id)->first());
        $this->assertSame('DONE', $t->status);
        $this->assertStringContainsString('volvió a llamar', $t->result);

        // Domingo 15:00, fuera de horario (09:00 a 14:00): tarea de devolver, aunque nadie colgó.
        $this->travelTo(Carbon::parse('2026-10-11 15:00', 'America/Lima'));
        $f = $this->entra(self::A, ['from' => '+51955500889', 'option' => 1, 'resultado' => 'COMPLETED'])->assertCreated();
        $this->assertSame(['MISSED', true], [$f->json('estado'), $f->json('fuera_de_horario')]);
        $this->assertStringContainsString('fuera de horario', $this->enEmpresa(fn () => DB::table('crm_tasks')->where('call_id', $f->json('id'))->value('note')));
    }

    public function test_llamar_sale_con_el_numero_de_la_marca_y_registra_el_resultado(): void
    {
        $this->travelTo(Carbon::parse('2026-11-20 10:00', 'America/Lima'));   // después de las llamadas de la demostración
        $this->preparar();
        [$m5, $o] = $this->enEmpresa(function () {
            $m5 = DB::table('brands')->where('name', 'like', 'Marca 5%')->value('id');

            return [$m5, DB::table('sales_orders as o')->join('customers as c', 'c.id', '=', 'o.customer_id')->where('o.brand_id', $m5)->where('c.phone', 'like', '+519%')
                ->orderByDesc('o.created_at')->first(['o.id', 'o.customer_id'])];
        });
        $d = $this->como(self::E)->getJson("/api/v1/tel/llamar/destino?order_id={$o->id}")->assertOk();
        $this->assertSame(['+51987650950', 'de la marca', true], [$d->json('sale_con.e164'), $d->json('sale_con.de'), $d->json('registrado')]);
        // Un cliente sin pedido de marca: sale con el general.
        $this->assertSame('+5117085500', $this->como(self::E)->getJson("/api/v1/tel/llamar/destino?customer_id={$o->customer_id}")->json('sale_con.e164'));

        $l = $this->como(self::E)->postJson('/api/v1/tel/llamadas', ['order_id' => $o->id])->assertCreated();
        $this->assertSame(['RINGING', 'Saliente', '+51987650950', true], [$l->json('status'), $l->json('direccion'), $l->json('from_e164'), $l->json('simulador')]);
        $this->como(self::B)->postJson('/api/v1/tel/llamadas/'.$l->json('id').'/resultado', ['estado' => 'COMPLETED', 'segundos' => 95])->assertNotFound();
        $r = $this->como(self::E)->postJson('/api/v1/tel/llamadas/'.$l->json('id').'/resultado', ['estado' => 'COMPLETED', 'segundos' => 95])->assertOk();
        // 2 minutos a celular con grabación: 2 × 0,074 + 2 × 0,0025.
        $this->assertSame(['COMPLETED', 95, true], [$r->json('status'), $r->json('duration_seconds'), $r->json('notice_played')]);
        $this->assertEqualsWithDelta(0.153, $r->json('cost_usd'), 0.0001);
        $this->assertTrue($this->enEmpresa(fn () => DB::table('tel_recordings')->where('call_id', $r->json('id'))->exists()));
        $this->como(self::E)->postJson('/api/v1/tel/llamadas/'.$l->json('id').'/resultado', ['estado' => 'BUSY'])->assertStatus(422);

        // La vendedora ve sus salientes; la supervisora, todas. La contadora no llama.
        $this->assertSame($l->json('id'), $this->como(self::E)->getJson('/api/v1/tel/salientes')->json('data.0.id'), 'La más reciente arriba');
        $this->assertNotContains($l->json('id'), array_column($this->como(self::A)->getJson('/api/v1/tel/salientes?per_page=100')->json('data'), 'id'), 'Ana no ve las de Elena');
        $this->assertSame($l->json('id'), $this->como(self::SUPERVISORA)->getJson('/api/v1/tel/salientes')->json('data.0.id'));
        $this->como(self::CONTADORA)->postJson('/api/v1/tel/llamadas', ['order_id' => $o->id])->assertForbidden();
        $this->como(self::E)->postJson('/api/v1/tel/llamadas', [])->assertStatus(422);
        $this->assertNotEmpty($this->como(self::E)->getJson('/api/v1/tel/pedidos?buscar='.substr($this->enEmpresa(fn () => DB::table('sales_orders')->where('id', $o->id)->value('number')), 0, 8))->json('data'));

        // La base: las llamadas no se borran.
        try {
            $this->enEmpresa(fn () => DB::transaction(fn () => DB::table('tel_calls')->where('id', $l->json('id'))->delete()));
            $this->fail('La base debió rechazarlo');
        } catch (QueryException) {
            $this->assertTrue(true);
        }
    }

    /** Dentro de un enEmpresa ya abierto. */
    private function id_sin(string $email): string
    {
        return (string) DB::table('users')->where('email', $email)->value('id');
    }
}
