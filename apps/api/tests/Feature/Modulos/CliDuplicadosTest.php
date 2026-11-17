<?php

namespace Tests\Feature\Modulos;

use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/** CLI-10 Duplicados y CLI-11 Fusión (RN-CLI-07, RN-CLI-08, CA-CLI-05). */
class CliDuplicadosTest extends TestCase
{
    private ?string $token = null;

    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo(Carbon::parse('2026-11-07 10:00', 'America/Lima'));
    }

    private function gerente(): static
    {
        return $this->desde(self::DG, $this->token ??= $this->ingresar(self::DG, 'rquispe@donguando.pe'));
    }

    public function test_ca_cli_05_mismo_celular_desde_dos_numeros_y_fusion(): void
    {
        $a = $this->gerente()->postJson('/api/v1/cli/clientes', ['full_name' => 'Teresa Gómez', 'customer_type' => 'PERSON', 'doc_type' => 'NONE',
            'phone' => '956 123 789', 'source_channel' => 'WHATSAPP'])->assertCreated()->json('customer.id');
        $b = $this->gerente()->postJson('/api/v1/cli/clientes', ['full_name' => 'Tere Gómez', 'customer_type' => 'PERSON', 'doc_type' => 'NONE',
            'phone' => '+51956123789', 'source_channel' => 'WHATSAPP'])->assertCreated()->assertJsonPath('duplicados', 1)->json('customer.id');

        $par = collect($this->gerente()->getJson('/api/v1/cli/duplicados')->assertOk()->json('data'))->firstWhere('customer_id', $b);
        $this->assertSame('Mismo celular', $par['motivo']);
        $this->assertSame($a, $par['duplicate_of_id']);

        // Pedidos en ambos (se toman dos pedidos sembrados de otro cliente).
        $pedidos = DB::table('sales_orders')->where('status', 'CLOSED')->limit(2)->pluck('id');
        DB::table('sales_orders')->where('id', $pedidos[0])->update(['customer_id' => $a]);
        DB::table('sales_orders')->where('id', $pedidos[1])->update(['customer_id' => $b]);
        DB::table('customer_balance_movements')->insert(['customer_id' => $b, 'movement_type' => 'OVERPAYMENT', 'amount' => 12.5, 'reason' => 'Prueba', 'at' => now(), 'user' => 'Prueba']);

        $vista = $this->gerente()->getJson("/api/v1/cli/fusion?a={$a}&b={$b}&sobreviviente={$a}")->assertOk();
        $this->assertSame($b, $vista->json('fusionado.id'));
        $this->assertEquals(12.5, $vista->json('mueve.saldo'));

        $this->gerente()->postJson('/api/v1/cli/fusion', ['sobreviviente_id' => $a, 'fusionado_id' => $b, 'motivo' => ''])->assertUnprocessable();
        $this->gerente()->postJson('/api/v1/cli/fusion', ['sobreviviente_id' => $a, 'fusionado_id' => $b, 'motivo' => 'Misma clienta escribió a dos números'])
            ->assertCreated()->assertJsonPath('moved_counts.sales_orders', 1);

        $this->assertSame(2, DB::table('sales_orders')->whereIn('id', $pedidos)->where('customer_id', $a)->count());
        $fusionado = $this->gerente()->getJson("/api/v1/cli/clientes/{$b}")->json();
        $this->assertSame($a, $fusionado['merged_into_id']);
        $this->assertSame('INACTIVE', $fusionado['status']);
        $this->assertEquals(12.5, $this->gerente()->getJson("/api/v1/cli/clientes/{$a}")->json('cifras.saldo'));
        $this->assertSame('MERGED', DB::table('customer_duplicate_candidates')->where('id', $par['id'])->value('status'));

        // No se deshace ni vuelve a activarse.
        $this->gerente()->postJson("/api/v1/cli/clientes/{$b}/desbloquear")->assertUnprocessable()->assertJsonPath('code', 'RN-CLI-08');
        $this->gerente()->postJson('/api/v1/cli/fusion', ['sobreviviente_id' => $a, 'fusionado_id' => $b, 'motivo' => 'otra vez'])->assertUnprocessable();
        $this->assertSame('Misma clienta escribió a dos números', $this->gerente()->getJson('/api/v1/cli/fusiones')->json('data.0.reason'));
    }

    public function test_descartar_exige_motivo_y_buscar_en_toda_la_base(): void
    {
        $par = $this->gerente()->getJson('/api/v1/cli/duplicados')->json('data.0');
        $this->gerente()->postJson("/api/v1/cli/duplicados/{$par['id']}/descartar", ['nota' => ''])->assertUnprocessable();
        $this->gerente()->postJson("/api/v1/cli/duplicados/{$par['id']}/descartar", ['nota' => 'Esposos con el mismo celular'])->assertNoContent();
        $this->assertSame(2, $this->gerente()->getJson('/api/v1/cli/duplicados/resumen')->json('abiertos'));
        $this->gerente()->postJson('/api/v1/cli/duplicados/buscar')->assertOk()->assertJsonStructure(['nuevos']);

        $vendedora = $this->ingresar(self::DG, 'ana.torres@donguando.pe');
        $this->desde(self::DG, $vendedora)->postJson('/api/v1/cli/duplicados/buscar')->assertForbidden();
    }
}
