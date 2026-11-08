<?php

namespace Tests\Feature\Modulos;

use Illuminate\Support\Carbon;
use Tests\TestCase;

/** CAT-12 Historial de precios: cada vigencia queda como historia con el precio anterior. */
class CatHistorialTest extends TestCase
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

    public function test_el_cambio_del_cuy_entero_muestra_el_precio_anterior(): void
    {
        $filas = $this->gerente()->getJson('/api/v1/cat/historial?q=DG-CUY-ENT&tipo=CHANGE&per_page=100')->assertOk()->json('data');
        $wa = collect($filas)->first(fn ($x) => $x['list_code'] === 'DG-WA' && $x['sku'] === 'DG-CUY-ENT');
        $this->assertEquals(44, $wa['price']);
        $this->assertEquals(42, $wa['precio_anterior']);
        $this->assertEquals(4.8, $wa['cambio_pct']);
        $this->assertSame('2026-11-01', substr($wa['valid_from'], 0, 10));

        $r = $this->gerente()->getJson('/api/v1/cat/historial/resumen')->assertOk()->json();
        $this->assertGreaterThan(0, $r['cambios']);
        $this->assertGreaterThan(0, $r['este_mes']);
    }

    public function test_un_cambio_nuevo_aparece_programado_y_la_vendedora_solo_ve_su_marca(): void
    {
        $wa = collect($this->gerente()->getJson('/api/v1/cat/listas')->json())->firstWhere('code', 'DG-WA');
        $ent = collect($this->gerente()->getJson('/api/v1/cat/variantes?q=DG-CUY-ENT')->json('data'))->firstWhere('sku', 'DG-CUY-ENT');
        $this->gerente()->postJson("/api/v1/cat/listas/{$wa['id']}/precios", ['variant_id' => $ent['id'], 'price' => 46, 'valid_from' => '2026-12-01', 'cerrar_anterior' => true, 'reason' => 'Fiestas'])->assertCreated();

        $antes = $this->gerente()->getJson("/api/v1/cat/historial?list_id={$wa['id']}&variant_id={$ent['id']}&sort=-valid_from")->json('data');
        $this->assertEquals(46, $antes[0]['price']);
        $this->assertEquals(44, $antes[0]['precio_anterior']);
        $this->assertSame('Fiestas', $antes[0]['reason']);
        $this->assertGreaterThan(0, $this->gerente()->getJson('/api/v1/cat/historial/resumen')->json('programados'));

        $ana = $this->desde(self::DG, $this->ingresar(self::DG, 'ana.torres@donguando.pe'));
        $skus = array_unique(array_column($ana->getJson('/api/v1/cat/historial?per_page=100')->assertOk()->json('data'), 'sku'));
        $this->assertEmpty(array_filter($skus, fn ($s) => ! str_starts_with($s, 'DG-')));
    }
}
