<?php

namespace Tests\Feature\Modulos;

use App\Modulos\Cat\Services\Precios;
use App\Modulos\Cat\Services\RegistroSanitario;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/** CAT-01 Productos: lista por marca con precio WhatsApp (RN-CAT-05) y registro sanitario (RN-CAT-09). */
class CatProductosTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        // Los precios y los vencimientos dependen del día: se fija para que la prueba no cambie con el tiempo.
        $this->travelTo(Carbon::parse('2026-11-07 10:00', 'America/Lima'));
    }

    private function como(string $email): static
    {
        return $this->desde(self::DG, $this->ingresar(self::DG, $email));
    }

    private function gerente(): static
    {
        return $this->como('rquispe@donguando.pe');
    }

    /** @return array<string, string> id de marca por código (DG, M2…) */
    private function marcas(): array
    {
        return collect($this->gerente()->getJson('/api/v1/me')->assertOk()->json('brands'))->pluck('id', 'code')->all();
    }

    private function codigos(string $url, ?self $quien = null): array
    {
        return array_column(($quien ?? $this->gerente())->getJson($url)->assertOk()->json('data'), 'code');
    }

    private function variante(string $sku): string
    {
        return DB::table('product_variants')->where('sku', $sku)->value('id');
    }

    public function test_lista_productos_de_venta_con_variantes_y_precio_whatsapp(): void
    {
        $r = $this->gerente()->getJson('/api/v1/cat/productos?per_page=100')->assertOk();
        $filas = collect($r->json('data'))->keyBy('code');

        $this->assertTrue($filas->has('CUY-ENT'));
        $this->assertTrue($filas->every(fn ($p) => in_array($p['product_type'], ['GOODS', 'COMBO', 'SERVICE'], true)));
        $this->assertFalse($filas->contains(fn ($p) => $p['brand_name'] === 'Carnes Selectas'), 'No ve productos de otra empresa (RLS).');

        $cuy = $filas['CUY-ENT'];
        $this->assertSame(3, $cuy['variantes_activas']);
        $this->assertSame('KG', $cuy['precio_whatsapp']['basis']);
        $this->assertNotNull($cuy['precio_whatsapp']['min']);

        // Los insumos van en su propia pestaña.
        $insumos = $this->gerente()->getJson('/api/v1/cat/productos?tipo=INPUT&per_page=100')->assertOk()->json('data');
        $this->assertNotEmpty($insumos);
        $this->assertTrue(collect($insumos)->every(fn ($p) => ! in_array($p['product_type'], ['GOODS', 'COMBO', 'SERVICE'], true)));
        $this->assertTrue(collect($insumos)->every(fn ($p) => $p['precio_whatsapp'] === null));
    }

    public function test_busca_por_sku_de_una_variante(): void
    {
        // DG-CUY-MIT es una variante del cuy entero.
        $this->assertSame(['CUY-ENT'], $this->codigos('/api/v1/cat/productos?q=dg-cuy-mit'));
    }

    /** CA-CAT-07 */
    public function test_filtrar_por_la_marca_gourmet_solo_muestra_sus_cuatro_lineas(): void
    {
        $m5 = $this->marcas()['M5'];
        $lineas = array_unique(array_column($this->gerente()->getJson("/api/v1/cat/productos?brand_id={$m5}&per_page=100")->assertOk()->json('data'), 'line'));
        sort($lineas);

        $this->assertSame(['CAFE', 'FRUTOS_SECOS', 'INFUSIONES', 'MERMELADAS'], $lineas);
    }

    public function test_la_vendedora_solo_ve_los_productos_de_sus_marcas(): void
    {
        $marcas = $this->marcas();
        $ana = $this->como('ana.torres@donguando.pe');
        $filas = $ana->getJson('/api/v1/cat/productos?per_page=100')->assertOk()->json('data');
        $this->assertNotEmpty($filas);
        $this->assertSame([$marcas['DG']], array_values(array_unique(array_column($filas, 'brand_id'))));

        // Aunque pida otra marca, no sale de su alcance.
        $this->assertSame([], $this->codigos("/api/v1/cat/productos?brand_id={$marcas['M5']}", $this->como('ana.torres@donguando.pe')));
    }

    /** CA-CAT-02, con el servicio que usa CAT-01 (y después PED, POS y WEB). */
    public function test_precio_vigente_elige_la_lista_por_prioridad_y_tipo_de_cliente(): void
    {
        $this->gerente()->getJson('/api/v1/me')->assertOk(); // contexto de la empresa
        $conejo = $this->variante('DG-CON-DES');

        $restaurante = Precios::vigente($conejo, ['canal' => 'WHATSAPP', 'tipo_cliente' => 'RESTAURANT']);
        $this->assertSame(44.0, $restaurante['price']);
        $this->assertSame('DG-RES', $restaurante['list_code']);

        $persona = Precios::vigente($conejo, ['canal' => 'WHATSAPP', 'tipo_cliente' => 'PERSON']);
        $this->assertSame(48.0, $persona['price']);
        $this->assertSame('KG', $persona['basis']);

        // El precio de WhatsApp del cuy entero subió el 01/11: antes 42, ahora 44.
        $cuy = $this->variante('DG-CUY-ENT');
        $this->assertSame(42.0, Precios::vigente($cuy, ['fecha' => '2026-10-15'])['price']);
        $this->assertSame(44.0, Precios::vigente($cuy, ['fecha' => '2026-11-07'])['price']);

        // Un canal sin lista no tiene precio: no se vende ahí.
        $this->assertNull(Precios::vigente($cuy, ['canal' => 'CANAL_INEXISTENTE']));
    }

    /** CA-CAT-05 (semáforo) y RN-CAT-09. */
    public function test_semaforo_del_registro_sanitario(): void
    {
        $p = fn (?string $vence, string $autoridad = 'DIGESA', ?string $numero = 'DIGESA-123') => [
            'sanitary_authority' => $autoridad, 'sanitary_registry' => $numero, 'sanitary_registry_expires' => $vence, 'sanitary_alert_days' => null,
        ];
        $hoy = '2026-11-07';

        $this->assertSame('AMBER', RegistroSanitario::estado($p('2027-01-06'), $hoy, 90)['code']); // 60 días
        $this->assertSame('Vence en 60 días', RegistroSanitario::estado($p('2027-01-06'), $hoy, 90)['label']);
        $this->assertSame('RED', RegistroSanitario::estado($p('2026-11-20'), $hoy, 90)['code']);
        $this->assertSame('EXPIRED', RegistroSanitario::estado($p('2026-11-07'), $hoy, 90)['code']);
        $this->assertSame('Vencido hace 7 días', RegistroSanitario::estado($p('2026-10-31'), $hoy, 90)['label']);
        $this->assertSame('OK', RegistroSanitario::estado($p('2027-06-30'), $hoy, 90)['code']);
        $this->assertSame('MISSING', RegistroSanitario::estado($p('2027-06-30', numero: null), $hoy, 90)['code']);
        $this->assertSame('NA', RegistroSanitario::estado($p(null, 'NONE', null), $hoy, 90)['code']);
    }

    public function test_resumen_con_cobertura_de_precios_y_registros_por_vencer(): void
    {
        $r = $this->gerente()->getJson('/api/v1/cat/productos/resumen')->assertOk();

        $this->assertGreaterThan(0, $r->json('variantes_vendibles'));
        $this->assertLessThanOrEqual($r->json('variantes_vendibles'), $r->json('con_precio'));
        $this->assertSame('WHATSAPP', $r->json('canal'));
        $this->assertSame(90, $r->json('dias_aviso'));

        // Marca 5: 5 productos de venta; la mermelada (30/09) y las infusiones (05/10) ya vencieron.
        $m5 = $this->marcas()['M5'];
        $r = $this->gerente()->getJson("/api/v1/cat/productos/resumen?brand_id={$m5}")->assertOk();
        $this->assertSame(5, $r->json('activos'));
        $this->assertSame(2, $r->json('sanitario_vencidos'));
    }
}
