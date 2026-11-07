<?php

namespace Tests\Feature\Modulos;

use App\Modulos\Plt\Services\CentrosCosto;
use App\Support\RuleError;
use Tests\TestCase;

/** PLT-07 Centros de costo: árbol por área, hasta 4 niveles y sin ciclos (RN-PLT-21). */
class PltCentrosCostoTest extends TestCase
{
    private function gerente(): static
    {
        return $this->desde(self::DG, $this->ingresar(self::DG, 'rquispe@donguando.pe'));
    }

    /** @return array<string, array> centros por código */
    private function centros(): array
    {
        return collect($this->gerente()->getJson('/api/v1/plt/centros-costo/arbol')->assertOk()->json('centros'))->keyBy('code')->all();
    }

    private function nuevo(array $cambios = []): array
    {
        $c = $this->centros();

        return $cambios + ['company_id' => $c['VEN']['company_id'], 'code' => 'ven-ferias', 'name' => 'Ventas en ferias', 'area' => 'SALES', 'status' => 'ACTIVE'];
    }

    public function test_arbol_con_niveles_y_cifras(): void
    {
        $r = $this->gerente()->getJson('/api/v1/plt/centros-costo/arbol')->assertOk();
        $c = collect($r->json('centros'))->keyBy('code');

        $this->assertSame(1, $c['VEN']['nivel']);
        $this->assertSame(3, $c['VEN-WEB']['nivel']); // VEN > VEN-DG > VEN-WEB
        $this->assertSame('VEN-DG', $c['VEN-WEB']['parent_code']);
        $this->assertSame(27, $r->json('resumen.total'));
        $this->assertSame(9, $r->json('resumen.areas'));
        $this->assertSame(4, $r->json('resumen.limite'));

        $tabla = $this->gerente()->getJson('/api/v1/plt/centros-costo?area=MARKETING&status=INACTIVE')->assertOk()->json('data');
        $this->assertSame(['FERIAS'], array_column($tabla, 'code'));
    }

    public function test_crea_un_hijo_que_hereda_el_area_del_padre(): void
    {
        $c = $this->centros();
        $r = $this->gerente()->postJson('/api/v1/plt/centros-costo', $this->nuevo(['parent_id' => $c['VEN']['id'], 'area' => 'MARKETING']))
            ->assertCreated();
        $this->assertSame('VEN-FERIAS', $r->json('code'));
        $this->assertSame('SALES', $r->json('area'));

        $this->gerente()->postJson('/api/v1/plt/centros-costo', $this->nuevo(['code' => 'VEN']))
            ->assertUnprocessable()->assertJsonValidationErrors(['code' => 'Ya existe']);
        $this->gerente()->postJson('/api/v1/plt/centros-costo', $this->nuevo(['code' => 'X']))
            ->assertUnprocessable()->assertJsonValidationErrors(['code' => 'de 2 a 12']);
    }

    public function test_no_pasa_de_cuatro_niveles_ni_forma_ciclos(): void
    {
        $c = $this->centros();
        // VEN-WEB está en el nivel 3: un hijo queda en el 4 y un nieto en el 5.
        $hijo = $this->gerente()->postJson('/api/v1/plt/centros-costo', $this->nuevo(['code' => 'WEB-ENVIOS', 'parent_id' => $c['VEN-WEB']['id']]))
            ->assertCreated()->json('id');
        $this->gerente()->postJson('/api/v1/plt/centros-costo', $this->nuevo(['code' => 'WEB-ENV-LIM', 'parent_id' => $hijo]))
            ->assertUnprocessable()->assertJsonPath('message', 'El árbol admite como máximo 4 niveles: así quedaría con 5.');

        // VEN no puede depender de VEN-WEB, que está debajo de él.
        $ven = $c['VEN'];
        $this->gerente()->putJson("/api/v1/plt/centros-costo/{$ven['id']}", ['parent_id' => $c['VEN-WEB']['id']] + $ven)
            ->assertUnprocessable()->assertJsonPath('code', 'RN-PLT-21');

        // Mover VEN-DG (con dos niveles debajo) bajo VEN-MOS lo dejaría en 5 niveles.
        $this->gerente()->putJson("/api/v1/plt/centros-costo/{$c['VEN-DG']['id']}", ['parent_id' => $c['VEN-MOS']['id']] + $c['VEN-DG'])
            ->assertUnprocessable()->assertJsonPath('message', 'El árbol admite como máximo 4 niveles: así quedaría con 5.');
    }

    public function test_desactiva_varios_y_un_inactivo_no_admite_gastos(): void
    {
        $c = $this->centros();
        $ids = [$c['MKT-M2']['id'], $c['MKT-M3']['id']];
        $this->gerente()->putJson('/api/v1/plt/centros-costo/estado', ['ids' => $ids, 'status' => 'INACTIVE'])
            ->assertOk()->assertJsonPath('cambiados', 2);

        try {
            CentrosCosto::activo($c['MKT-M2']['id']);
            $this->fail('Debió rechazar el centro inactivo.');
        } catch (RuleError $e) {
            $this->assertSame('RN-PLT-21', $e->rule);
            $this->assertStringContainsString('MKT-M2 · Marketing Marca 2 está inactivo', $e->getMessage());
        }
        $this->assertSame('VEN', CentrosCosto::activo($c['VEN']['id'])->code);
    }

    public function test_sin_el_permiso_no_edita(): void
    {
        $datos = $this->nuevo(); // antes de entrar como vendedora: nuevo() consulta como gerente
        $vendedora = $this->desde(self::DG, $this->ingresar(self::DG, 'ana.torres@donguando.pe'));
        $vendedora->postJson('/api/v1/plt/centros-costo', $datos)->assertForbidden();
    }
}
