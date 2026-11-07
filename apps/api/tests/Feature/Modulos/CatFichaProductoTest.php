<?php

namespace Tests\Feature\Modulos;

use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/** CAT-02 Ficha del producto: datos, variantes y precios; crear y editar con RN-CAT-01, 09, 11 y 13. */
class CatFichaProductoTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
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

    private function producto(string $code, ?self $quien = null): array
    {
        $fila = collect(($quien ?? $this->gerente())->getJson('/api/v1/cat/productos?tipo=ALL&q='.$code)->assertOk()->json('data'))
            ->firstWhere('code', $code);
        $this->assertNotNull($fila, "No encontró el producto {$code}.");

        return ($quien ?? $this->gerente())->getJson("/api/v1/cat/productos/{$fila['id']}")->assertOk()->json();
    }

    /** Datos para el formulario a partir de la ficha. */
    private function formulario(array $p, array $cambios = []): array
    {
        return $cambios + array_intersect_key($p, array_flip(['code', 'name', 'brand_id', 'category_id', 'product_type', 'origin', 'storage',
            'shelf_life_days', 'requires_lot', 'igv_affectation', 'sunat_product_code', 'allow_discount', 'sanitary_authority',
            'sanitary_registry', 'sanitary_registry_expires', 'status']));
    }

    private function nuevo(array $cambios = []): array
    {
        $cuy = $this->producto('CUY-ENT');

        return $this->formulario($cuy, $cambios + [
            'code' => 'cuy-ahumado', 'name' => 'Cuy ahumado', 'sanitary_registry' => 'SENASA-PE-09999', 'sanitary_registry_expires' => '2027-12-31',
        ]);
    }

    public function test_ficha_con_variantes_precios_y_ventas(): void
    {
        $p = $this->producto('CUY-ENT');

        $this->assertSame('Don Guando', $p['brand_name']);
        $this->assertSame(['DG-CUY-DES', 'DG-CUY-ENT', 'DG-CUY-MIT'], array_column($p['variantes'], 'sku'));
        $this->assertSame('OK', $p['sanitario']['code']);
        $this->assertTrue($p['tiene_ventas']);

        // Precios vigentes hoy: el de WhatsApp del cuy entero es S/ 44 desde el 01/11.
        $wa = collect($p['precios'])->first(fn ($x) => $x['sku'] === 'DG-CUY-ENT' && $x['list_name'] === 'WhatsApp Lima · Don Guando');
        $this->assertEquals(44, $wa['price']);
        $ent = collect($p['variantes'])->firstWhere('sku', 'DG-CUY-ENT');
        $this->assertEquals(44, $ent['precio_whatsapp']['price']);
    }

    public function test_crea_un_producto_con_la_linea_de_su_categoria(): void
    {
        $r = $this->gerente()->postJson('/api/v1/cat/productos', $this->nuevo())->assertCreated();

        $this->assertSame('CUY-AHUMADO', $r->json('code'));
        $this->assertSame('CUY', $r->json('line'));
        $this->assertFalse($r->json('web_publishable'));
        $this->assertSame('NOT_PUBLISHED', $r->json('web_sync_status'));

        // RN-CAT-01: el código es único en la empresa.
        $this->gerente()->postJson('/api/v1/cat/productos', $this->nuevo(['code' => 'CUY-ENT']))
            ->assertUnprocessable()->assertJsonValidationErrors(['code' => 'Ya existe']);
    }

    /** RN-CAT-09 (segunda parte de CA-CAT-05) */
    public function test_un_producto_digesa_activo_necesita_registro(): void
    {
        $this->gerente()->postJson('/api/v1/cat/productos', $this->nuevo(['sanitary_authority' => 'DIGESA', 'sanitary_registry' => null]))
            ->assertUnprocessable()->assertJsonPath('code', 'RN-CAT-09');

        // Inactivo sí se puede guardar sin registro.
        $this->gerente()->postJson('/api/v1/cat/productos', $this->nuevo(['sanitary_authority' => 'DIGESA', 'sanitary_registry' => null, 'status' => 'INACTIVE']))
            ->assertCreated();
    }

    /** RN-CAT-01 y RN-CAT-13 en un producto con ventas. */
    public function test_con_ventas_no_cambia_de_marca_y_el_igv_pide_permiso_y_motivo(): void
    {
        $p = $this->producto('CUY-ENT');
        $m2 = collect($this->gerente()->getJson('/api/v1/me')->json('brands'))->firstWhere('code', 'M2')['id'];

        $this->gerente()->putJson("/api/v1/cat/productos/{$p['id']}", $this->formulario($p, ['brand_id' => $m2]))
            ->assertUnprocessable()->assertJsonPath('code', 'RN-CAT-01');

        // ADMINISTRACION edita productos, pero no cambia el IGV de uno con ventas.
        $admin = $this->como('chuaman@donguando.pe');
        $admin->putJson("/api/v1/cat/productos/{$p['id']}", $this->formulario($p, ['igv_affectation' => '20', 'tax_change_reason' => 'Exonerado por ley']))
            ->assertUnprocessable()->assertJsonPath('code', 'RN-CAT-13');

        // La gerente sí, con motivo.
        $this->gerente()->putJson("/api/v1/cat/productos/{$p['id']}", $this->formulario($p, ['igv_affectation' => '20']))
            ->assertUnprocessable()->assertJsonPath('code', 'RN-CAT-13');
        $this->gerente()->putJson("/api/v1/cat/productos/{$p['id']}", $this->formulario($p, ['igv_affectation' => '20', 'tax_change_reason' => 'Exonerado por ley de la Amazonía']))
            ->assertOk()->assertJsonPath('igv_affectation', '20');

        $evento = DB::table('domain_events')->where('event_name', 'product.tax_changed')->where('aggregate_id', $p['id'])->first();
        $this->assertNotNull($evento);
        $this->assertStringContainsString('Amazonía', $evento->payload);
    }

    /** RN-CAT-11 */
    public function test_inactivar_el_producto_inactiva_sus_variantes(): void
    {
        $p = $this->producto('CUY-ENT');
        $this->gerente()->putJson("/api/v1/cat/productos/{$p['id']}/estado", ['status' => 'INACTIVE'])
            ->assertOk()->assertJsonPath('status', 'INACTIVE');

        $p = $this->producto('CUY-ENT');
        $this->assertSame(['INACTIVE'], array_values(array_unique(array_column($p['variantes'], 'status'))));
    }

    public function test_la_vendedora_consulta_pero_no_edita_ni_ve_otras_marcas(): void
    {
        $ana = $this->como('ana.torres@donguando.pe');
        $p = $this->producto('CUY-ENT', $ana);
        $ana->putJson("/api/v1/cat/productos/{$p['id']}", $this->formulario($p, ['name' => 'Otro nombre']))->assertForbidden();

        $cafe = $this->producto('CAFE');
        $this->como('ana.torres@donguando.pe')->getJson("/api/v1/cat/productos/{$cafe['id']}")->assertNotFound();
    }
}
