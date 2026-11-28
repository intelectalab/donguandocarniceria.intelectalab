<?php

namespace Tests\Feature\Modulos;

use App\Modulos\Onb\Services\Importador;
use App\Modulos\Onb\Services\Registro;
use App\Modulos\Plt\Services\Ruc;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * ONB · Asistente de alta, plantillas por rubro e importadores (ONB-02 a ONB-15; RN-ONB-03 a 19; CA-ONB-02 a 08).
 */
class OnbAsistenteTest extends TestCase
{
    /** Crea una empresa nueva desde el registro público y devuelve [hostname, token]. */
    private function nuevaEmpresa(string $rucBase, string $plan = 'CRECIMIENTO'): array
    {
        $ruc = Ruc::conVerificador($rucBase);
        $email = 'admin'.substr($ruc, -4).'@pruebaonb.pe';
        $clave = 'Norte#Carnes2026!';

        $this->flushHeaders();
        $this->withHeaders(['Accept' => 'application/json'])->postJson('/api/v1/publico/registro', [
            'ruc' => $ruc,
            'legal_name' => 'EMPRESA DE PRUEBA '.substr($ruc, -4).' SAC',
            'trade_name' => 'Prueba '.substr($ruc, -4),
            'business_type' => 'DISTRIBUIDORA',
            'tax_regime' => 'MYPE',
            'fiscal_address' => 'Av. Industrial 540, Lima',
            'plan_code' => $plan,
            'contact_name' => 'Ana Prueba',
            'email' => $email,
            'phone' => '987654321',
            'password' => $clave,
            'password_confirmation' => $clave,
            'terms' => true,
        ])->assertCreated();

        $ver = $this->withHeaders(['Accept' => 'application/json'])->postJson('/api/v1/publico/registro/verificar', [
            'email' => $email,
            'codigo' => Registro::$ultimoCodigo,
        ])->assertOk();

        $host = DB::table('tenants')->where('id', $ver->json('tenant_id'))->value('hostname');
        $token = $this->ingresar($host, $email, $clave);

        return [$host, $token];
    }

    public function test_plantillas_publicadas_aplicacion_idempotente_y_importacion_con_errores(): void
    {
        $this->travelTo(Carbon::parse('2026-10-10 10:00:00', 'America/Lima'));

        [$host, $tok] = $this->nuevaEmpresa('2060900103');

        // CA-ONB-02: 4 plantillas publicadas con categorías, productos, checklists y metas; charcutería con recetas, avícola con despiece.
        $tpls = $this->desde($host, $tok)->getJson('/api/v1/onb/plantillas')->assertOk();
        $this->assertCount(4, $tpls->json('templates'));

        // ONB-03 Empresa -> ONB-04 Marca -> ONB-05 Local y Almacén
        $this->desde($host, $tok)->putJson('/api/v1/onb/empresa', [
            'trade_name' => 'Distribuidora Prueba',
            'fiscal_address' => 'Av. Industrial 540, Lurín, Lima',
            'tax_regime' => 'MYPE',
            'primary_color' => '#922242',
        ])->assertOk();

        $marca = $this->desde($host, $tok)->postJson('/api/v1/onb/marcas', [
            'code' => 'DG',
            'name' => 'Don Guando',
            'color' => '#922242',
        ])->assertCreated();

        $local = $this->desde($host, $tok)->postJson('/api/v1/onb/locales', [
            'code' => 'L1',
            'name' => 'Local Principal',
            'sunat_code' => '0000',
            'est_type' => 'MIXED',
            'address' => 'Av. Industrial 540',
            'has_counter' => true,
        ])->assertCreated();

        $this->desde($host, $tok)->postJson('/api/v1/onb/almacenes', [
            'establishment_id' => $local->json('id'),
            'code' => 'ALM-1',
            'name' => 'Cámara 1',
            'wh_type' => 'COLD_ROOM',
            'min_temp_c' => 0,
            'max_temp_c' => 4,
        ])->assertCreated();

        // CA-ONB-03: aplicar DISTRIBUIDORA_CARNES con DES apagado -> 5 categorías, 6 productos, 3 cortes, despiece omitido; reaplicar falla con RN-ONB-07.
        $tenantId = DB::table('tenants')->where('hostname', $host)->value('id')
            ?? DB::table('tenant_hostnames')->where('hostname', $host)->value('tenant_id');
        $this->assertNotNull($tenantId);
        \App\Support\TenantContext::set(\App\Support\TenantContext::find($tenantId));
        DB::table('tenant_modules')->where('module_code', 'DES')->update(['enabled' => false]);
        \App\Support\TenantContext::set(null);

        $app = $this->desde($host, $tok)->postJson('/api/v1/onb/plantillas/aplicar', [
            'template_code' => 'DISTRIBUIDORA_CARNES',
            'brand_id' => $marca->json('id'),
        ])->assertCreated();

        $det = collect($app->json('detail'));
        $this->assertSame(5, $det->where('item_type', 'CATEGORY')->where('result', 'CREATED')->count());
        $this->assertSame(6, $det->where('item_type', 'PRODUCT')->where('result', 'CREATED')->count());
        $this->assertSame(3, $det->where('item_type', 'CUT')->where('result', 'CREATED')->count());
        $br = $det->firstWhere('item_type', 'BREAKDOWN');
        $this->assertSame('SKIPPED', $br['result']);
        $this->assertStringContainsString('DES', $br['reason']);

        $this->desde($host, $tok)->postJson('/api/v1/onb/plantillas/aplicar', [
            'template_code' => 'DISTRIBUIDORA_CARNES',
            'brand_id' => $marca->json('id'),
        ])->assertStatus(422)->assertJsonPath('code', 'RN-ONB-07');

        // CA-ONB-04: 120 productos con 3 errores -> sin aceptar parcial se rechaza; aceptando se importan 117; CSV con 3 errores (2.5%); mismo archivo falla con RN-ONB-09.
        $ej = $this->desde($host, $tok)->postJson('/api/v1/onb/importaciones/ejemplo/PRODUCTS', [
            'n' => 120,
            'errors' => 3,
            'seed' => 7,
        ])->assertOk();

        $imp = $this->desde($host, $tok)->postJson('/api/v1/onb/importaciones', [
            'type' => 'PRODUCTS',
            'content' => $ej->json('csv'),
            'file_name' => 'productos.csv',
            'brand_id' => $marca->json('id'),
        ])->assertCreated();

        $impId = $imp->json('import.id');
        $this->assertSame([120, 3, 2.5], [
            $imp->json('import.total_rows'),
            $imp->json('import.error_rows'),
            (float) $imp->json('import.error_pct'),
        ]);

        $this->desde($host, $tok)->postJson("/api/v1/onb/importaciones/{$impId}/ejecutar", [
            'allow_partial' => false,
        ])->assertStatus(422)->assertJsonPath('code', 'RN-ONB-08');

        $done = $this->desde($host, $tok)->postJson("/api/v1/onb/importaciones/{$impId}/ejecutar", [
            'allow_partial' => true,
        ])->assertOk();
        $this->assertSame(117, $done->json('import.imported_rows'));

        $errCsv = $this->desde($host, $tok)->getJson("/api/v1/onb/importaciones/{$impId}/errores")->assertOk();
        $parsedErr = Importador::parseCsv($errCsv->json('csv'));
        $this->assertCount(4, $parsedErr);
        $this->assertContains('errores', $parsedErr[0]);

        $this->desde($host, $tok)->postJson('/api/v1/onb/importaciones', [
            'type' => 'PRODUCTS',
            'content' => $ej->json('csv'),
            'file_name' => 'productos.csv',
            'brand_id' => $marca->json('id'),
        ])->assertStatus(422)->assertJsonPath('code', 'RN-ONB-09');
    }

    public function test_clientes_stock_inicial_correlativo_y_salida_a_produccion(): void
    {
        $this->travelTo(Carbon::parse('2026-10-10 10:00:00', 'America/Lima'));

        [$host, $tok] = $this->nuevaEmpresa('2060900507');

        // CA-ONB-07: lista de pasos arranca en 0%; stock sin almacenes falla con RN-ONB-06.
        $p0 = $this->desde($host, $tok)->getJson('/api/v1/onb/pasos')->assertOk();
        $this->assertSame(0.0, (float) $p0->json('progress.pct'));

        $this->desde($host, $tok)->postJson('/api/v1/onb/pasos/IMPORT_STOCK/completar')
            ->assertStatus(422)->assertJsonPath('code', 'RN-ONB-06');

        // Completar Empresa, Marca y 2 Locales -> 3 de 6 obligatorios = 50%
        $this->desde($host, $tok)->putJson('/api/v1/onb/empresa', [
            'trade_name' => 'Carnes Prueba',
            'fiscal_address' => 'Av. Prueba 123, Lima',
        ])->assertOk();
        $marca = $this->desde($host, $tok)->postJson('/api/v1/onb/marcas', [
            'code' => 'CP',
            'name' => 'Carnes Prueba',
        ])->assertCreated();
        $l1 = $this->desde($host, $tok)->postJson('/api/v1/onb/locales', [
            'code' => 'L1',
            'name' => 'Local 1',
            'sunat_code' => '0000',
        ])->assertCreated();
        $l2 = $this->desde($host, $tok)->postJson('/api/v1/onb/locales', [
            'code' => 'L2',
            'name' => 'Local 2',
            'sunat_code' => '0001',
        ])->assertCreated();

        $p50 = $this->desde($host, $tok)->getJson('/api/v1/onb/pasos')->assertOk();
        $this->assertSame([50.0, 3, 6], [
            (float) $p50->json('progress.pct'),
            $p50->json('progress.done'),
            $p50->json('progress.req'),
        ]);

        $w1 = $this->desde($host, $tok)->postJson('/api/v1/onb/almacenes', [
            'establishment_id' => $l1->json('id'),
            'code' => 'ALM-1',
            'name' => 'Almacén 1',
            'wh_type' => 'COLD_ROOM',
            'min_temp_c' => 0,
            'max_temp_c' => 4,
        ])->assertCreated();
        $this->desde($host, $tok)->postJson('/api/v1/onb/almacenes', [
            'establishment_id' => $l2->json('id'),
            'code' => 'ALM-2',
            'name' => 'Almacén 2',
            'wh_type' => 'COLD_ROOM',
            'min_temp_c' => 0,
            'max_temp_c' => 4,
        ])->assertCreated();

        $this->desde($host, $tok)->postJson('/api/v1/onb/zonas', [
            'code' => 'SUR',
            'name' => 'Surco',
            'establishment_id' => $l1->json('id'),
            'districts' => 'Santiago de Surco, Miraflores',
            'delivery_fee' => 8,
        ])->assertCreated();

        // CA-ONB-05: clientes con celulares -> +51, sin pin y duplicados omitidos con advertencia.
        $ejCli = $this->desde($host, $tok)->postJson('/api/v1/onb/importaciones/ejemplo/CUSTOMERS', [
            'n' => 100,
            'noPin' => 10,
            'dups' => 5,
            'seed' => 5,
        ])->assertOk();
        $impCli = $this->desde($host, $tok)->postJson('/api/v1/onb/importaciones', [
            'type' => 'CUSTOMERS',
            'content' => $ejCli->json('csv'),
            'file_name' => 'clientes.csv',
        ])->assertCreated();
        $this->assertSame(0, $impCli->json('import.error_rows'));
        $doneCli = $this->desde($host, $tok)->postJson('/api/v1/onb/importaciones/'.$impCli->json('import.id').'/ejecutar')->assertOk();
        $this->assertSame([95, 5], [$doneCli->json('import.imported_rows'), $doneCli->json('import.skipped_rows')]);

        // CA-ONB-06: aplicar plantilla, omitir IMPORT_PRODUCTS, importar stock inicial en 2 almacenes -> lotes en cuarentena y liberación.
        $this->desde($host, $tok)->postJson('/api/v1/onb/plantillas/aplicar', [
            'template_code' => 'DISTRIBUIDORA_CARNES',
            'brand_id' => $marca->json('id'),
        ])->assertCreated();
        $this->desde($host, $tok)->postJson('/api/v1/onb/pasos/IMPORT_PRODUCTS/omitir')->assertOk();

        $ejSt = $this->desde($host, $tok)->postJson('/api/v1/onb/importaciones/ejemplo/STOCK', [
            'lots' => 30,
            'warehouses' => ['ALM-1', 'ALM-2'],
            'cutover' => '2026-10-09',
            'seed' => 9,
        ])->assertOk();
        $impSt = $this->desde($host, $tok)->postJson('/api/v1/onb/importaciones', [
            'type' => 'STOCK',
            'content' => $ejSt->json('csv'),
            'file_name' => 'stock.csv',
            'warehouse_id' => $w1->json('id'),
            'cutover_date' => '2026-10-09',
        ])->assertCreated();
        $impStId = $impSt->json('import.id');
        $doneSt = $this->desde($host, $tok)->postJson("/api/v1/onb/importaciones/{$impStId}/ejecutar")->assertOk();
        $this->assertSame(30, $doneSt->json('stock_summary.quarantine_lots'));
        $this->assertGreaterThan(0, $doneSt->json('stock_summary.inventory_value'));

        $rel = $this->desde($host, $tok)->postJson("/api/v1/onb/importaciones/{$impStId}/liberar-stock")->assertOk();
        $this->assertSame(30, $rel->json('released_lots'));
        $this->assertSame(0, $rel->json('stock_summary.quarantine_lots'));

        // CA-ONB-08: proponer series, fijar último correlativo B001 = 4521, probar OSE y emitir primer comprobante -> B001-00004522.
        $this->desde($host, $tok)->postJson('/api/v1/onb/series/proponer', ['mode' => 'BRAND'])->assertOk();
        $this->desde($host, $tok)->putJson('/api/v1/onb/series/B001/correlativo', ['last_number' => 4521])->assertOk();
        $this->desde($host, $tok)->postJson('/api/v1/onb/ose/probar', [
            'provider' => 'FAKE',
            'user' => 'usuario.ose',
            'secret' => 'secreto-1234',
        ])->assertOk();

        // Omitir los pasos opcionales restantes antes de salir a producción.
        foreach (['PAYMENT_METHODS', 'WHATSAPP', 'IMPORT_BALANCES', 'USERS'] as $op) {
            $this->desde($host, $tok)->postJson("/api/v1/onb/pasos/{$op}/omitir")->assertOk();
        }

        // Sin el primer comprobante aceptado no permite salir a producción (RN-ONB-05).
        $this->desde($host, $tok)->postJson('/api/v1/onb/salida', ['date' => '2026-10-10'])
            ->assertStatus(422)->assertJsonPath('code', 'RN-ONB-05');

        $doc = $this->desde($host, $tok)->postJson('/api/v1/onb/salida/primer-comprobante', [
            'series' => 'B001',
            'amount' => 50,
        ])->assertCreated();
        $this->assertSame('B001-00004522', $doc->json('full_number'));

        // No permite retroceder el correlativo a un número ya emitido (RN-ONB-18).
        $this->desde($host, $tok)->putJson('/api/v1/onb/series/B001/correlativo', ['last_number' => 4000])
            ->assertStatus(422)->assertJsonPath('code', 'RN-ONB-18');

        $fin = $this->desde($host, $tok)->postJson('/api/v1/onb/salida', ['date' => '2026-10-10'])->assertOk();
        $this->assertSame('COMPLETED', $fin->json('run.status'));
        $this->assertSame(100.0, (float) $fin->json('progress.pct'));
    }
}
