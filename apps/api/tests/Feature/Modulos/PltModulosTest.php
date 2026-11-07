<?php

namespace Tests\Feature\Modulos;

use Tests\TestCase;

/** PLT-12 Módulos (RN-PLT-07 a RN-PLT-10) y la lista de activación de Telefonía (RN-TEL-02). */
class PltModulosTest extends TestCase
{
    private ?string $token = null;

    /** Una sola sesión por prueba: ingresar muchas veces seguidas choca con el límite de intentos. */
    private function gerente(): static
    {
        return $this->desde(self::DG, $this->token ??= $this->ingresar(self::DG, 'rquispe@donguando.pe'));
    }

    private function cambiar(string $code, bool $on, string $motivo = 'Prueba de encendido y apagado')
    {
        return $this->gerente()->putJson("/api/v1/plt/modulos/{$code}", ['enabled' => $on, 'reason' => $motivo]);
    }

    public function test_lista_el_catalogo_con_su_estado(): void
    {
        $r = $this->gerente()->getJson('/api/v1/plt/modulos')->assertOk();
        $m = collect($r->json('modulos'))->keyBy('code');

        $this->assertSame(40, $r->json('resumen.total'));
        $this->assertSame(['TEL'], $r->json('resumen.apagados'));
        $this->assertSame(['CLI', 'CRM', 'PED'], $m['TEL']['depends_on']);
        $this->assertContains('CAL', $m['CRM']['dependientes']);
        $this->assertTrue($m['PLT']['is_core']);
        $this->assertSame('Telefonía', mb_substr($m['TEL']['name'], 0, 9));
        $this->assertCount(6, $r->json('tel'));
    }

    public function test_nucleo_y_dependencias(): void
    {
        $this->cambiar('PLT', false)->assertUnprocessable()->assertJsonPath('code', 'RN-PLT-09');
        $this->cambiar('CRM', false)->assertUnprocessable()->assertJsonPath('code', 'RN-PLT-10');
        $this->cambiar('SUS', false)->assertUnprocessable()->assertJsonPath('code', 'RN-PLT-08');
        $this->cambiar('PRS', false, 'corto')->assertUnprocessable()->assertJsonPath('code', 'RN-PLT-06');

        // PRS no tiene dependientes: se apaga y se vuelve a encender.
        $this->cambiar('PRS', false)->assertOk()->assertJsonPath('enabled', false);
        $this->cambiar('PRS', false)->assertUnprocessable(); // ya está apagado
        $this->cambiar('PRS', true)->assertOk()->assertJsonPath('enabled', true);

        // Con CNT apagado no se enciende PRS, que lo necesita.
        foreach (['CON', 'B2B', 'FLO', 'PER', 'PRS'] as $c) {
            $this->cambiar($c, false)->assertOk();
        }
        $this->cambiar('CNT', false)->assertOk();
        $this->cambiar('PRS', true)->assertUnprocessable()->assertJsonPath('code', 'RN-PLT-10');
    }

    public function test_un_modulo_apagado_responde_403_y_no_concede_permisos(): void
    {
        $this->gerente()->getJson('/api/v1/plt/series')->assertOk();
        // TEL llega apagado: su permiso no se concede ni a la gerente.
        $this->assertNotContains('tel.call.make', $this->gerente()->getJson('/api/v1/me')->json('permissions'));
    }

    public function test_telefonia_se_enciende_con_la_lista_completa(): void
    {
        $this->cambiar('TEL', true)->assertUnprocessable()->assertJsonPath('code', 'RN-TEL-02');

        $this->gerente()->postJson('/api/v1/plt/modulos/tel/pasos/CARRIER_FORWARDING', ['notes' => ''])->assertUnprocessable();
        foreach (['CARRIER_FORWARDING', 'SIGNED_POLICY'] as $paso) {
            $this->gerente()->postJson("/api/v1/plt/modulos/tel/pasos/{$paso}", ['notes' => 'Constancia del operador del 10/11'])->assertOk();
        }
        $this->cambiar('TEL', true, 'Central lista para las vendedoras')->assertOk()->assertJsonPath('enabled', true);

        $tel = collect($this->gerente()->getJson('/api/v1/plt/modulos')->json('tel'))->keyBy('code');
        $this->assertTrue($tel['SWITCH_ON']['done']);
        $this->gerente()->deleteJson('/api/v1/plt/modulos/tel/pasos/SIGNED_POLICY')->assertUnprocessable(); // encendido: no se deshace
        $this->assertContains('tel.call.make', $this->gerente()->getJson('/api/v1/me')->json('permissions'));
    }

    public function test_sin_el_permiso_no_enciende_ni_apaga(): void
    {
        $admin = $this->desde(self::DG, $this->ingresar(self::DG, 'chuaman@donguando.pe'));
        $admin->getJson('/api/v1/plt/modulos')->assertOk();
        $admin->putJson('/api/v1/plt/modulos/PRS', ['enabled' => false, 'reason' => 'Prueba de encendido y apagado'])->assertForbidden();
        $admin->postJson('/api/v1/plt/modulos/tel/pasos/SIGNED_POLICY', ['notes' => 'Firmada'])->assertForbidden();
    }
}
