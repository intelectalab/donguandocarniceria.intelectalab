<?php

namespace Tests\Feature\Modulos;

use App\Support\Params;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/** PLT-10 Parámetros y PLT-11 Historial (RN-PLT-06, RN-PLT-11, RN-PLT-12). */
class PltParametrosTest extends TestCase
{
    private function gerente(): static
    {
        return $this->desde(self::DG, $this->ingresar(self::DG, 'rquispe@donguando.pe'));
    }

    protected function tearDown(): void
    {
        CarbonImmutable::setTestNow();
        parent::tearDown();
    }

    public function test_lista_los_parametros_de_un_modulo_con_su_valor(): void
    {
        $r = $this->gerente()->getJson('/api/v1/plt/parametros?module=PLT')->assertOk();
        $p = collect($r->json('parametros'))->keyBy('key');

        $this->assertSame('5', $p['plt_period_close_day']['value']);
        $this->assertSame('DEFAULT', $p['plt_period_close_day']['source']);
        $this->assertSame('95', $p['plt_series_alert_pct']['value']);
        $this->assertSame('TENANT', $p['plt_series_alert_pct']['source']);
        $this->assertSame(271, $r->json('resumen.total'));

        // Los que no son números recuperaron su valor por defecto.
        $alm = collect($this->gerente()->getJson('/api/v1/plt/parametros?module=ALM')->json('parametros'))->keyBy('key');
        $this->assertSame('true', $alm['alm_reserve_on_confirm']['default_value']);
        $this->assertSame('SYSTEM', collect($this->gerente()->getJson('/api/v1/plt/parametros?q=theme_mode')->json('parametros'))->first()['value']);
    }

    public function test_cambia_un_valor_con_motivo_dentro_del_rango(): void
    {
        $cambiar = fn (array $b) => $this->gerente()->putJson('/api/v1/plt/parametros/plt_period_close_day', $b);

        $cambiar(['value' => '8', 'reason' => 'corto'])->assertUnprocessable()->assertJsonPath('code', 'RN-PLT-06');
        $cambiar(['value' => '40', 'reason' => 'La contadora cierra hasta el 8'])->assertUnprocessable()
            ->assertJsonPath('message', 'El valor debe ser como máximo 28.');
        $cambiar(['value' => 'ocho', 'reason' => 'La contadora cierra hasta el 8'])->assertUnprocessable()->assertJsonPath('code', 'RN-PLT-11');
        $cambiar(['value' => '5', 'reason' => 'La contadora cierra hasta el 8'])->assertUnprocessable()
            ->assertJsonPath('message', 'El valor nuevo es igual al vigente.');
        $cambiar(['value' => '8', 'reason' => 'La contadora cierra hasta el 8'])->assertOk()->assertJsonPath('value', '8');

        $this->assertSame('8', Params::get('plt_period_close_day'));
        $h = $this->gerente()->getJson('/api/v1/plt/parametros/historial?key=plt_period_close_day')->assertOk();
        $this->assertSame(['5', '8', 'PLT', 'Rosa Quispe Huamán'], [
            $h->json('data.0.old_value'), $h->json('data.0.new_value'), $h->json('data.0.module_code'), $h->json('data.0.changed_by'),
        ]);
        $this->assertSame(4, $h->json('resumen.cambios'));
    }

    public function test_cambiar_el_dia_de_cierre_no_reevalua_los_meses_cerrados(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-11-06 10:00', 'America/Lima'));
        $this->gerente()->getJson('/api/v1/me')->assertOk(); // contexto de la empresa para leer la base
        $empresa = DB::table('companies')->where('ruc', '20609147254')->value('id');
        $aTiempo = fn () => collect($this->gerente()->getJson("/api/v1/plt/periodos?company_id={$empresa}")->json('meses'))
            ->pluck('a_tiempo', 'period')->all();

        $antes = $aTiempo();
        $this->assertFalse($antes['2026-03-01']); // cerrado el 09/04, con límite 05/04

        $this->gerente()->putJson('/api/v1/plt/parametros/plt_period_close_day', ['value' => '10', 'reason' => 'La contadora cierra hasta el 10'])->assertOk();
        $this->assertSame($antes, $aTiempo());
    }

    public function test_valor_propio_por_marca_y_quitarlo(): void
    {
        $this->gerente()->getJson('/api/v1/me')->assertOk(); // contexto de la empresa para leer la base
        $m2 = DB::table('brands')->where('code', 'M2')->value('id');
        $base = ['reason' => 'Marca 2 reserva al despachar, no al confirmar'];

        $this->gerente()->putJson('/api/v1/plt/parametros/alm_reserve_on_confirm', $base + ['value' => false, 'scope' => 'BRAND', 'scope_id' => $m2])
            ->assertOk()->assertJsonPath('value', 'false');
        $this->assertSame('false', Params::get('alm_reserve_on_confirm', ['brand' => $m2]));
        $this->assertSame('true', Params::get('alm_reserve_on_confirm'));

        $detalle = $this->gerente()->getJson('/api/v1/plt/parametros/alm_reserve_on_confirm')->assertOk();
        $this->assertSame('Marca 2 · Cortes', $detalle->json('ambitos.0.nombre'));

        $this->gerente()->postJson('/api/v1/plt/parametros/alm_reserve_on_confirm/quitar', $base + ['scope' => 'BRAND', 'scope_id' => $m2])
            ->assertOk()->assertJsonPath('value', 'true');
        $this->assertSame('true', Params::get('alm_reserve_on_confirm', ['brand' => $m2]));

        // Un parámetro de la plataforma solo admite el valor de la empresa.
        $this->gerente()->putJson('/api/v1/plt/parametros/plt_series_alert_pct', $base + ['value' => 90, 'scope' => 'BRAND', 'scope_id' => $m2])
            ->assertUnprocessable()->assertJsonPath('message', 'Este parámetro no se puede fijar para una marca.');
    }

    public function test_sin_el_permiso_no_cambia_parametros(): void
    {
        $admin = $this->desde(self::DG, $this->ingresar(self::DG, 'chuaman@donguando.pe'));
        $admin->getJson('/api/v1/plt/parametros?module=PLT')->assertOk();
        $admin->putJson('/api/v1/plt/parametros/plt_period_close_day', ['value' => '8', 'reason' => 'La contadora cierra hasta el 8'])->assertForbidden();
    }
}
