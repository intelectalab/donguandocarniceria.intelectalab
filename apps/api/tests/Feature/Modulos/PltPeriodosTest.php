<?php

namespace Tests\Feature\Modulos;

use App\Modulos\Plt\Services\Periodos;
use App\Support\RuleError;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/** Servicio de períodos (RN-PLT-05) que usan los demás módulos antes de registrar algo con fecha. */
class PltPeriodosTest extends TestCase
{
    private string $empresa;

    protected function setUp(): void
    {
        parent::setUp();
        $this->desde(self::DG, $this->ingresar(self::DG, 'rquispe@donguando.pe'))->getJson('/api/v1/me')->assertOk(); // contexto de la empresa
        $this->empresa = DB::table('companies')->where('ruc', '20609147254')->value('id');
    }

    public function test_un_mes_cerrado_no_admite_documentos(): void
    {
        try {
            Periodos::abierto('2026-08-31', $this->empresa);
            $this->fail('Debió rechazar agosto, que está cerrado.');
        } catch (RuleError $e) {
            $this->assertSame('RN-PLT-05', $e->rule);
            $this->assertStringContainsString('agosto de 2026 está cerrado', $e->getMessage());
        }
        $this->assertTrue(Periodos::cerrado('2026-08-01', $this->empresa));
    }

    public function test_un_mes_abierto_o_sin_registro_si_admite(): void
    {
        Periodos::abierto('2026-09-30', $this->empresa); // abierto
        Periodos::abierto('2026-12-15', $this->empresa); // nadie lo cerró todavía
        $this->assertFalse(Periodos::cerrado('2026-09-01', $this->empresa));
    }

    public function test_cada_empresa_tiene_sus_periodos(): void
    {
        $otra = DB::table('companies')->where('id', '!=', $this->empresa)->value('id');
        $this->assertNotNull($otra);

        Periodos::abierto('2026-08-31', $otra); // agosto está cerrado solo para la otra empresa
        $this->assertFalse(Periodos::cerrado('2026-08-31', $otra));
    }

    private function como(string $email): static
    {
        return $this->desde(self::DG, $this->ingresar(self::DG, $email));
    }

    public function test_lista_los_meses_con_sus_cifras(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-11-06 10:00', 'America/Lima'));
        $r = $this->como('rquispe@donguando.pe')->getJson('/api/v1/plt/periodos?company_id='.$this->empresa)->assertOk();

        $meses = collect($r->json('meses'))->keyBy('period');
        $this->assertSame('CLOSED', $meses['2026-08-01']['status']);
        $this->assertSame('OPEN', $meses['2026-09-01']['status']);
        // Noviembre no tiene registro: sale abierto, en curso y sin id.
        $this->assertNull($meses['2026-11-01']['id']);
        $this->assertTrue($meses['2026-11-01']['en_curso']);
        $this->assertSame('setiembre de 2026', $r->json('resumen.pendiente.nombre'));
        $this->assertTrue($r->json('resumen.pendiente.vencido'));
        $this->assertSame(8, $r->json('resumen.cerrados'));
    }

    public function test_cierra_en_orden_y_reabre_con_motivo(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-11-06 10:00', 'America/Lima'));
        $contadora = fn () => $this->como('mcardenas@donguando.pe');
        $cerrar = fn (string $mes) => $contadora()->postJson('/api/v1/plt/periodos/cerrar', ['company_id' => $this->empresa, 'period' => $mes]);

        $cerrar('2026-10-01')->assertUnprocessable()->assertJsonPath('message', 'Primero cierra setiembre de 2026: los períodos se cierran en orden.');
        $cerrar('2026-11-01')->assertUnprocessable()->assertJsonPath('code', 'RN-PLT-17');
        $setiembre = $cerrar('2026-09-01')->assertOk()->assertJsonPath('status', 'CLOSED')->json('id');
        $cerrar('2026-09-01')->assertUnprocessable()->assertJsonPath('message', 'Setiembre de 2026 ya está cerrado.');
        $octubre = $cerrar('2026-10-01')->assertOk()->json('id');

        $this->assertTrue(Periodos::cerrado('2026-09-15', $this->empresa));
        $this->assertSame(1, DB::table('domain_events')->where('event_name', 'period.closed')->where('aggregate_id', $setiembre)->count());

        // Reabrir: motivo de al menos 10 caracteres y sin meses posteriores cerrados.
        $contadora()->postJson("/api/v1/plt/periodos/{$setiembre}/reabrir", ['reason' => 'corto'])->assertUnprocessable()->assertJsonPath('code', 'RN-PLT-18');
        $contadora()->postJson("/api/v1/plt/periodos/{$setiembre}/reabrir", ['reason' => 'Factura de proveedor sin registrar'])
            ->assertUnprocessable()->assertJsonPath('message', 'No se puede reabrir: octubre de 2026 (posterior) está cerrado. Reabre primero los meses posteriores.');
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-11-06 11:00', 'America/Lima')); // una hora después del cierre
        $contadora()->postJson("/api/v1/plt/periodos/{$octubre}/reabrir", ['reason' => 'Factura de proveedor del 28/10 sin registrar'])
            ->assertOk()->assertJsonPath('status', 'OPEN');

        $historial = $contadora()->getJson('/api/v1/plt/periodos/historial?company_id='.$this->empresa.'&period_id='.$octubre)->assertOk()->json('data');
        $this->assertSame(['REOPEN', 'CLOSE'], array_slice(array_column($historial, 'action'), 0, 2));
        $this->assertSame('Factura de proveedor del 28/10 sin registrar', $historial[0]['reason']);
    }

    public function test_administracion_cierra_pero_no_reabre(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-11-06 10:00', 'America/Lima'));
        $admin = fn () => $this->como('chuaman@donguando.pe');
        $id = $admin()->postJson('/api/v1/plt/periodos/cerrar', ['company_id' => $this->empresa, 'period' => '2026-09-01'])->assertOk()->json('id');
        $admin()->postJson("/api/v1/plt/periodos/{$id}/reabrir", ['reason' => 'Necesito registrar una compra'])->assertForbidden();
        $this->como('ana.torres@donguando.pe')->postJson('/api/v1/plt/periodos/cerrar', ['company_id' => $this->empresa, 'period' => '2026-10-01'])->assertForbidden();
    }

    protected function tearDown(): void
    {
        CarbonImmutable::setTestNow();
        parent::tearDown();
    }

    public function test_una_fecha_con_hora_se_toma_en_hora_de_lima(): void
    {
        // 1 de setiembre 03:00 UTC es todavía 31 de agosto en Lima: agosto, cerrado.
        $this->assertTrue(Periodos::cerrado(CarbonImmutable::parse('2026-09-01 03:00:00', 'UTC'), $this->empresa));
        $this->assertFalse(Periodos::cerrado(CarbonImmutable::parse('2026-09-01 06:00:00', 'UTC'), $this->empresa));
        $this->assertSame('setiembre de 2026', Periodos::nombre('2026-09-12'));
    }
}
