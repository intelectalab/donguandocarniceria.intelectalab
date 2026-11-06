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

    public function test_una_fecha_con_hora_se_toma_en_hora_de_lima(): void
    {
        // 1 de setiembre 03:00 UTC es todavía 31 de agosto en Lima: agosto, cerrado.
        $this->assertTrue(Periodos::cerrado(CarbonImmutable::parse('2026-09-01 03:00:00', 'UTC'), $this->empresa));
        $this->assertFalse(Periodos::cerrado(CarbonImmutable::parse('2026-09-01 06:00:00', 'UTC'), $this->empresa));
        $this->assertSame('setiembre de 2026', Periodos::nombre('2026-09-12'));
    }
}
