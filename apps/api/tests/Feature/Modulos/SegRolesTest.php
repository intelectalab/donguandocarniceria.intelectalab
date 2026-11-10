<?php

namespace Tests\Feature\Modulos;

use App\Support\TenantContext;
use Illuminate\Support\Facades\DB;
use PhpOffice\PhpSpreadsheet\Cell\DataType;
use PhpOffice\PhpSpreadsheet\IOFactory;
use Tests\TestCase;

/** SEG-10 Roles, SEG-11 Permisos del rol y SEG-12 Matriz: RN-SEG-12, 14, 15 y 20, RN-PLT-07. */
class SegRolesTest extends TestCase
{
    private const ADMIN = 'lccahuana@donguando.pe';   // ADMIN_SISTEMA: seg.role.manage

    private const GERENTE = 'rquispe@donguando.pe';

    private const AUDITOR = 'aexterno@donguando.pe';  // lee todo, no cambia nada

    private const VENDEDORA = 'ana.torres@donguando.pe';

    private function como(string $email): static
    {
        return $this->desde(self::DG, $this->ingresar(self::DG, $email));
    }

    private function contexto(): void
    {
        $tenantId = DB::selectOne('SELECT auth_tenants_for_email(?) AS t', [self::ADMIN])->t;
        TenantContext::set(TenantContext::find($tenantId));
    }

    private function rol(string $code): string
    {
        $this->contexto();

        return DB::table('roles')->where('code', $code)->value('id');
    }

    /** Copia de Vendedora para las pruebas. */
    private function copia(string $codigo = 'VENDEDORA_FERIA'): array
    {
        return $this->como(self::ADMIN)->postJson('/api/v1/seg/roles', ['base_id' => $this->rol('VENDEDORA'), 'code' => $codigo, 'name' => 'Vendedora de ferias'])
            ->assertCreated()->json();
    }

    public function test_lista_con_cifras_y_quien_puede_verla(): void
    {
        $r = $this->como(self::AUDITOR)->getJson('/api/v1/seg/roles')->assertOk();
        $roles = collect($r->json('data'))->keyBy('code');
        $this->assertSame($roles->count(), $r->json('resumen.sistema') + $r->json('resumen.propios'));
        $this->assertSame(0, $r->json('resumen.propios'));
        $this->assertGreaterThan(0, $roles['VENDEDORA']['users']);
        $this->assertFalse($roles['GERENTE']['editable']);
        $this->assertTrue($roles['VENDEDORA']['editable']);

        // El cajero no tiene acceso a Seguridad.
        $this->como('jsalas@donguando.pe')->getJson('/api/v1/seg/roles')->assertForbidden();
    }

    public function test_copiar_un_rol_crea_uno_propio_con_sus_accesos_y_permisos(): void
    {
        $r = $this->copia('vendedora_feria');
        $this->assertSame('VENDEDORA_FERIA', $r['code'], 'El código se guarda en mayúsculas');
        $this->assertFalse((bool) $r['is_system']);
        $this->assertSame('ASSIGNED', $r['scope_mode']);

        $api = $this->como(self::ADMIN);
        $ficha = $api->getJson("/api/v1/seg/roles/{$r['id']}")->assertOk();
        $this->assertSame('CLE', collect($ficha->json('modules'))->firstWhere('code', 'PED')['actions']);
        $base = collect($api->getJson('/api/v1/seg/roles/'.$this->rol('VENDEDORA'))->json('permissions'))->where('granted', true)->pluck('code')->sort()->values();
        $this->assertSame($base->all(), collect($ficha->json('permissions'))->where('granted', true)->pluck('code')->sort()->values()->all());

        // Código repetido, código inválido, copiar la gerencia y quien no tiene el permiso.
        $api->postJson('/api/v1/seg/roles', ['base_id' => $this->rol('VENDEDORA'), 'code' => 'VENDEDORA_FERIA', 'name' => 'Otra'])->assertUnprocessable()->assertJsonPath('code', 'RN-SEG-14');
        $api->postJson('/api/v1/seg/roles', ['base_id' => $this->rol('VENDEDORA'), 'code' => '1-x', 'name' => 'Otra'])->assertUnprocessable()->assertJsonPath('code', 'RN-SEG-14');
        $api->postJson('/api/v1/seg/roles', ['base_id' => $this->rol('GERENTE'), 'code' => 'GERENTE_2', 'name' => 'Otra'])->assertUnprocessable()->assertJsonPath('code', 'RN-SEG-14');
        $this->como(self::AUDITOR)->postJson('/api/v1/seg/roles', ['base_id' => $this->rol('VENDEDORA'), 'code' => 'OTRO_ROL', 'name' => 'Otro'])->assertForbidden();
    }

    public function test_cambiar_el_acceso_del_rol_rige_en_la_siguiente_peticion(): void
    {
        $rol = $this->copia();
        $this->contexto();
        $vendedora = DB::table('users')->where('email', self::VENDEDORA)->value('id');
        $marca = DB::table('brands')->where('status', 'ACTIVE')->value('id');
        $api = $this->como(self::ADMIN);
        $api->putJson("/api/v1/seg/usuarios/{$vendedora}", ['role_id' => $rol['id'], 'brand_ids' => [$marca]])->assertOk();

        $token = $this->ingresar(self::DG, self::VENDEDORA);
        $this->desde(self::DG, $token)->getJson('/api/v1/alm/stock')->assertForbidden();

        $this->como(self::ADMIN)->putJson("/api/v1/seg/roles/{$rol['id']}/acceso", ['module_code' => 'alm', 'actions' => 'lc'])
            ->assertOk()->assertJsonPath('actions', 'CL');
        $this->desde(self::DG, $token)->getJson('/api/v1/alm/stock')->assertOk();

        $this->como(self::ADMIN)->putJson("/api/v1/seg/roles/{$rol['id']}/acceso", ['module_code' => 'ALM', 'actions' => ''])->assertOk();
        $this->desde(self::DG, $token)->getJson('/api/v1/alm/stock')->assertForbidden();

        // Entrada inválida.
        $this->como(self::ADMIN)->putJson("/api/v1/seg/roles/{$rol['id']}/acceso", ['module_code' => 'ALM', 'actions' => 'X'])->assertUnprocessable();
    }

    public function test_conceder_y_quitar_un_permiso_especial(): void
    {
        $rol = $this->copia();
        $api = $this->como(self::ADMIN);
        $api->putJson("/api/v1/seg/roles/{$rol['id']}/permisos", ['permission_code' => 'alm.stock.view_cost', 'granted' => true])->assertOk();
        $this->assertTrue(collect($api->getJson("/api/v1/seg/roles/{$rol['id']}")->json('permissions'))->firstWhere('code', 'alm.stock.view_cost')['granted']);
        $api->putJson("/api/v1/seg/roles/{$rol['id']}/permisos", ['permission_code' => 'alm.stock.view_cost', 'granted' => false])->assertOk();
        $this->assertFalse(collect($api->getJson("/api/v1/seg/roles/{$rol['id']}")->json('permissions'))->firstWhere('code', 'alm.stock.view_cost')['granted']);

        // Un permiso que tienen todos no se cambia por rol; uno que no existe tampoco.
        $this->contexto();
        $todos = DB::table('permissions')->where('everyone', true)->value('code');
        if ($todos) {
            $api->putJson("/api/v1/seg/roles/{$rol['id']}/permisos", ['permission_code' => $todos, 'granted' => false])->assertUnprocessable()->assertJsonPath('code', 'RN-SEG-12');
        }
        $api->putJson("/api/v1/seg/roles/{$rol['id']}/permisos", ['permission_code' => 'no.existe', 'granted' => true])->assertUnprocessable()->assertJsonPath('code', 'RN-SEG-12');
    }

    public function test_un_modulo_apagado_no_concede_accesos_ni_permisos(): void
    {
        $rol = $this->copia();
        $this->contexto();
        $apagado = DB::table('tenant_modules')->where('enabled', false)->value('module_code');
        $this->assertNotNull($apagado, 'La demo tiene un módulo apagado');
        $api = $this->como(self::ADMIN);
        $api->putJson("/api/v1/seg/roles/{$rol['id']}/acceso", ['module_code' => $apagado, 'actions' => 'L'])->assertUnprocessable()->assertJsonPath('code', 'RN-PLT-07');
        $this->contexto();
        $permiso = DB::table('permissions')->where('module_code', $apagado)->where('everyone', false)->value('code');
        if ($permiso) {
            $api->putJson("/api/v1/seg/roles/{$rol['id']}/permisos", ['permission_code' => $permiso, 'granted' => true])->assertUnprocessable()->assertJsonPath('code', 'RN-PLT-07');
        }
        $this->assertFalse(collect($api->getJson("/api/v1/seg/roles/{$rol['id']}")->json('modules'))->firstWhere('code', $apagado)['enabled']);
    }

    public function test_roles_del_sistema_gerencia_y_administrador_protegidos(): void
    {
        $api = $this->como(self::ADMIN);
        $vendedora = $this->rol('VENDEDORA');
        $admin = $this->rol('ADMIN_SISTEMA');
        $gerente = $this->rol('GERENTE');

        // RN-SEG-14: los del sistema no se borran ni cambian su nombre; la gerencia no se edita.
        $api->deleteJson("/api/v1/seg/roles/{$vendedora}")->assertUnprocessable()->assertJsonPath('code', 'RN-SEG-14');
        $api->putJson("/api/v1/seg/roles/{$vendedora}", ['name' => 'Otro nombre'])->assertUnprocessable()->assertJsonPath('code', 'RN-SEG-14');
        $api->putJson("/api/v1/seg/roles/{$gerente}/acceso", ['module_code' => 'ALM', 'actions' => 'L'])->assertUnprocessable()->assertJsonPath('code', 'RN-SEG-14');

        // Pero sus permisos sí se ajustan.
        $api->putJson("/api/v1/seg/roles/{$vendedora}/permisos", ['permission_code' => 'alm.stock.view_cost', 'granted' => true])->assertOk();

        // El administrador conserva lo necesario para administrar.
        $api->putJson("/api/v1/seg/roles/{$admin}/permisos", ['permission_code' => 'seg.role.manage', 'granted' => false])->assertUnprocessable()->assertJsonPath('code', 'RN-SEG-15');
        $api->putJson("/api/v1/seg/roles/{$admin}/acceso", ['module_code' => 'SEG', 'actions' => 'L'])->assertUnprocessable()->assertJsonPath('code', 'RN-SEG-15');
    }

    public function test_editar_y_borrar_un_rol_propio(): void
    {
        $rol = $this->copia();
        $api = $this->como(self::ADMIN);
        $api->putJson("/api/v1/seg/roles/{$rol['id']}", ['name' => 'Vendedora de ferias y eventos', 'description' => 'Atiende las ferias'])
            ->assertOk()->assertJsonPath('name', 'Vendedora de ferias y eventos');

        // Con usuarios no se borra.
        $this->contexto();
        $vendedora = DB::table('users')->where('email', self::VENDEDORA)->value('id');
        $marca = DB::table('brands')->where('status', 'ACTIVE')->value('id');
        $api->putJson("/api/v1/seg/usuarios/{$vendedora}", ['role_id' => $rol['id'], 'brand_ids' => [$marca]])->assertOk();
        $this->como(self::ADMIN)->deleteJson("/api/v1/seg/roles/{$rol['id']}")->assertUnprocessable()->assertJsonPath('code', 'RN-SEG-14');

        $this->como(self::ADMIN)->putJson("/api/v1/seg/usuarios/{$vendedora}", ['role_id' => $this->rol('VENDEDORA'), 'brand_ids' => [$marca]])->assertOk();
        $this->como(self::ADMIN)->deleteJson("/api/v1/seg/roles/{$rol['id']}")->assertNoContent();
        $this->contexto();
        $this->assertFalse(DB::table('roles')->where('id', $rol['id'])->exists());
        $this->assertFalse(DB::table('role_module_access')->where('role_id', $rol['id'])->exists());
    }

    public function test_exportar_la_matriz_en_excel_con_diseno_y_sin_formulas(): void
    {
        // Un rol propio cuyo nombre empieza con «=»: en el Excel debe quedar como texto, no como fórmula.
        $this->como(self::ADMIN)->postJson('/api/v1/seg/roles', ['base_id' => $this->rol('VENDEDORA'), 'code' => 'ROL_PRUEBA', 'name' => '=1+1 prueba'])->assertCreated();

        $r = $this->como(self::AUDITOR)->get('/api/v1/seg/matriz/exportar')->assertOk();
        $this->assertStringContainsString('spreadsheetml', $r->headers->get('Content-Type'));
        $this->assertMatchesRegularExpression('/matriz-roles-permisos-\d{4}-\d{2}-\d{2}\.xlsx/', $r->headers->get('Content-Disposition'));

        $archivo = tempnam(sys_get_temp_dir(), 'xlsx');
        file_put_contents($archivo, $r->streamedContent());
        $libro = IOFactory::load($archivo);
        unlink($archivo);
        $this->assertSame(['Permisos especiales', 'Acceso por módulo', 'Roles'], $libro->getSheetNames());
        $hoja = $libro->getSheetByName('Permisos especiales');
        $this->assertSame('Matriz de roles y permisos · Permisos especiales', $hoja->getCell('A3')->getValue());
        $this->assertStringContainsString('Auditor', (string) $hoja->getCell('A5')->getValue(), 'Dice quién lo generó');

        $roles = $libro->getSheetByName('Roles');
        $celda = null;
        foreach ($roles->getRowIterator() as $fila) {
            foreach ($fila->getCellIterator() as $c) {
                if ($c->getValue() === '=1+1 prueba') {
                    $celda = $c;
                }
            }
        }
        $this->assertNotNull($celda, 'El nombre del rol aparece tal cual');
        $this->assertSame(DataType::TYPE_STRING, $celda->getDataType());

        // Queda en la bitácora; quien no ve Seguridad no exporta.
        $this->contexto();
        $this->assertTrue(DB::table('access_log')->where('event', 'EXPORT_DOWNLOADED')->where('detail', 'like', '%Matriz de roles%')->exists());
        $this->como('jsalas@donguando.pe')->get('/api/v1/seg/matriz/exportar', ['Accept' => 'application/json'])->assertForbidden();
    }

    public function test_matriz_de_roles_y_permisos(): void
    {
        $m = $this->como(self::AUDITOR)->getJson('/api/v1/seg/matriz')->assertOk();
        $roles = collect($m->json('roles'))->pluck('code');
        $this->assertContains('GERENTE', $roles);
        $ped = collect($m->json('modules'))->firstWhere('code', 'PED');
        $this->assertSame('CLEA', $ped['access']['GERENTE']);
        $this->assertSame('CLE', $ped['access']['VENDEDORA']);
        $descuento = collect($m->json('permissions'))->firstWhere('code', 'ped.discount.approve');
        $this->assertContains('GERENTE', $descuento['roles']);
        $this->assertNotContains('VENDEDORA', $descuento['roles']);
    }
}
