<?php

namespace Tests\Feature\Modulos;

use App\Modulos\Mae\Services\TipoCambio\FuenteTipoCambio;
use App\Modulos\Mae\Services\TipoCambio\SinConector;
use App\Modulos\Mae\Services\TiposDeCambio;
use App\Modulos\Mae\Services\Trabajadores;
use App\Modulos\Mae\Services\Unidades;
use App\Support\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use PhpOffice\PhpSpreadsheet\IOFactory;
use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PhpOffice\PhpSpreadsheet\Writer\Xlsx;
use Tests\TestCase;

/** MAE · Maestros comunes: un caso por criterio CA-MAE de la spec, más permisos, importación y aislamiento. */
class MaeTest extends TestCase
{
    private array $tokens = [];

    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo(Carbon::parse('2026-11-16 10:00', 'America/Lima'));
    }

    private function como(string $email, string $host = self::DG): static
    {
        return $this->desde($host, $this->tokens[$host.$email] ??= $this->ingresar($host, $email));
    }

    private function admin(): static
    {
        return $this->como('chuaman@donguando.pe'); // ADMINISTRACION
    }

    /** Las consultas directas de la prueba pasan por RLS: se fija la empresa como lo hace la API. */
    private function empresa(string $host = self::DG): void
    {
        TenantContext::set(TenantContext::find(DB::table('tenant_hostnames')->where('hostname', $host)->value('tenant_id')));
    }

    private function medio(string $codigo): string
    {
        $this->empresa();

        return DB::table('payment_methods')->where('system_code', $codigo)->value('id');
    }

    public function test_ca_mae_01_comision_de_mercado_pago_por_vigencia_y_sin_cruces(): void
    {
        $mp = $this->medio('MERCADOPAGO');
        $this->admin()->getJson("/api/v1/mae/comisiones/simular?payment_method_id={$mp}&date=2026-10-15&amount=100")->assertOk()->assertJsonPath('comision', 3.99);
        $this->admin()->getJson("/api/v1/mae/comisiones/simular?payment_method_id={$mp}&date=2026-11-15&amount=100")->assertOk()->assertJsonPath('comision', 3.49);
        $this->admin()->postJson('/api/v1/mae/comisiones', ['payment_method_id' => $mp, 'valid_from' => '2026-10-20', 'valid_to' => '2026-10-25', 'fee_pct' => 2.5])
            ->assertUnprocessable()->assertJsonPath('code', 'RN-MAE-05');
        // Una nueva vigencia que cierra la anterior el día previo sí entra.
        $this->admin()->postJson('/api/v1/mae/comisiones', ['payment_method_id' => $mp, 'valid_from' => '2026-12-01', 'fee_pct' => 3.2, 'close_previous' => true])->assertCreated();
        $this->assertSame('2026-11-30', DB::table('payment_method_fees')->where('payment_method_id', $mp)->where('valid_from', '2026-11-01')->value('valid_to'));
        // La base tampoco deja que se crucen.
        $this->expectException(QueryException::class);
        DB::table('payment_method_fees')->insert(['payment_method_id' => $mp, 'valid_from' => '2026-10-10', 'valid_to' => '2026-10-12', 'fee_pct' => 1,
            'fee_fixed' => 0, 'igv_included' => true, 'status' => 'ACTIVE', 'created_by' => 'prueba']);
    }

    public function test_ca_mae_02_sin_publicacion_usa_el_ultimo_publicado_dentro_de_7_dias(): void
    {
        $r = $this->admin()->getJson('/api/v1/mae/tipo-cambio/para?date=2026-10-10&amount=100')->assertOk();
        $this->assertSame(3.39, $r->json('sell'));
        $this->assertSame('2026-10-09', $r->json('fecha_usada'));
        $this->assertTrue($r->json('respaldo'));
        $this->assertSame(339.0, (float) $r->json('soles'));
        $this->admin()->getJson('/api/v1/mae/tipo-cambio/para?date=2026-10-20&amount=100')->assertUnprocessable()->assertJsonPath('code', 'RN-MAE-07');
    }

    public function test_ca_mae_03_conversiones_y_decimales_de_la_unidad(): void
    {
        $this->admin()->getJson('/api/v1/mae/unidades/convertir?qty=1.25&from=KGM&to=GRM')->assertOk()->assertJsonPath('resultado', 1250);
        $kg = collect($this->admin()->getJson('/api/v1/mae/unidades')->assertOk()->json('conversiones'))->firstWhere('from_uom', 'KGM');
        $this->assertSame([1000, 0.001], [$kg['factor'], $kg['inversa']]); // números, no el texto «1000.000000» de la base
        $this->admin()->getJson('/api/v1/mae/unidades/convertir?qty=500&from=GRM&to=KGM')->assertOk()->assertJsonPath('resultado', 0.5);
        $this->admin()->getJson('/api/v1/mae/unidades/convertir?qty=1.5&from=NIU&to=BX')->assertUnprocessable()->assertJsonPath('code', 'RN-MAE-10');
        $this->admin()->getJson('/api/v1/mae/unidades/convertir?qty=1&from=KGM&to=LTR')->assertUnprocessable()->assertJsonPath('code', 'RN-MAE-09');
        // La inversa no se registra aparte.
        $this->admin()->postJson('/api/v1/mae/conversiones', ['from_uom' => 'GRM', 'to_uom' => 'KGM', 'factor' => 0.001])->assertUnprocessable()->assertJsonPath('code', 'RN-MAE-09');
        $this->admin()->postJson('/api/v1/mae/conversiones', ['from_uom' => 'BG', 'to_uom' => 'NIU', 'factor' => 10, 'note' => 'Bolsa de 10'])->assertCreated();
        $this->assertSame(0.1, Unidades::factor('NIU', 'BG'));
    }

    public function test_unidad_propia_con_codigo_vigente_del_catalogo_03(): void
    {
        $libres = collect($this->admin()->getJson('/api/v1/mae/unidades')->assertOk()->json('codigos_libres'))->pluck('code');
        $this->assertContains('TNE', $libres);
        $this->assertNotContains('KGM', $libres);
        $this->admin()->postJson('/api/v1/mae/unidades', ['code' => 'tne', 'uom_type' => 'WEIGHT', 'decimals' => 3])->assertCreated()->assertJsonPath('code', 'TNE');
        $tne = collect($this->admin()->getJson('/api/v1/mae/unidades')->json('unidades'))->firstWhere('code', 'TNE');
        $this->assertSame(['Tonelada', false, 3], [$tne['name'], $tne['is_system'], $tne['decimals']]);
        // No se repite, el código debe existir en el catálogo 03 y hace falta el permiso.
        $this->admin()->postJson('/api/v1/mae/unidades', ['code' => 'TNE', 'uom_type' => 'WEIGHT', 'decimals' => 3])->assertUnprocessable()->assertJsonPath('code', 'RN-MAE-10');
        $this->admin()->postJson('/api/v1/mae/unidades', ['code' => 'BG', 'uom_type' => 'PACKAGE', 'decimals' => 0])->assertUnprocessable();
        $this->admin()->postJson('/api/v1/mae/unidades', ['code' => 'XYZ', 'uom_type' => 'UNIT', 'decimals' => 0])->assertUnprocessable()->assertJsonPath('code', 'RN-MAE-12');
        $this->admin()->postJson('/api/v1/mae/unidades', ['code' => 'TNE', 'uom_type' => 'WEIGHT', 'decimals' => 9])->assertUnprocessable()->assertJsonValidationErrors('decimals');
        $this->como('ana.torres@donguando.pe')->postJson('/api/v1/mae/unidades', ['code' => 'TNE', 'uom_type' => 'WEIGHT', 'decimals' => 3])->assertForbidden();
    }

    public function test_ca_mae_04_la_baja_desactiva_el_usuario_y_cierra_su_sesion(): void
    {
        $this->empresa();
        $juan = DB::table('users')->where('email', 'jchoque@donguando.pe')->first();
        $this->assertNotNull($juan->employee_id);
        $tokenJuan = $this->ingresar(self::DG, 'jchoque@donguando.pe');

        $r = $this->admin()->postJson("/api/v1/mae/trabajadores/{$juan->employee_id}/baja", ['reason' => 'Renuncia voluntaria'])->assertOk();
        $this->assertSame(1, $r->json('usuarios'));
        $this->empresa();
        $this->assertSame('INACTIVE', DB::table('users')->where('id', $juan->id)->value('status'));
        $this->desde(self::DG, $tokenJuan)->getJson('/api/v1/me')->assertUnauthorized();
        $ficha = $this->admin()->getJson("/api/v1/mae/trabajadores/{$juan->employee_id}")->assertOk();
        $this->assertSame('2026-11-16', $ficha->json('trabajador.terminated_on'));
        $this->assertSame('INACTIVE', $ficha->json('trabajador.status'));
        // RN-MAE-02: ya no se le asigna nada nuevo, ni recupera el acceso por Seguridad.
        $this->empresa();
        $this->expectExceptionMessage('dado de baja');
        Trabajadores::activo($juan->employee_id);
    }

    public function test_ca_mae_05_siete_medios_y_los_que_exigen_numero_de_operacion(): void
    {
        $r = $this->admin()->getJson('/api/v1/mae/medios')->assertOk();
        $this->assertCount(7, $r->json('medios'));
        $this->assertSame(['WEB'], collect($r->json('medios'))->firstWhere('system_code', 'MERCADOPAGO')['allowed_channels']); // lista, no texto
        $exigen = collect($r->json('medios'))->where('requires_reference', true)->pluck('system_code')->sort()->values()->all();
        $this->assertSame(['MERCADOPAGO', 'PLIN', 'POS_VISA', 'TRANSFER', 'YAPE'], $exigen);
        $this->admin()->postJson('/api/v1/mae/medios/validar', ['payment_method_id' => $this->medio('YAPE'), 'reference' => ''])
            ->assertUnprocessable()->assertJsonPath('code', 'RN-MAE-04');
        $this->admin()->postJson('/api/v1/mae/medios/validar', ['payment_method_id' => $this->medio('CASH')])->assertOk();
    }

    public function test_ca_mae_06_ubigeo_de_lima_y_callao_y_la_app_no_lo_modifica(): void
    {
        $r = $this->admin()->getJson('/api/v1/mae/ubigeo/resumen')->assertOk();
        $this->assertSame(43, $r->json('lima'));
        $this->assertSame(7, $r->json('callao'));
        $this->assertSame('Santiago de Surco', DB::table('ubigeo')->where('code', '150140')->value('district'));
        try {
            DB::table('ubigeo')->where('code', '150140')->update(['district' => 'Surco']);
            $this->fail('La aplicación no debe poder modificar el ubigeo.');
        } catch (QueryException $e) {
            $this->assertStringContainsString('permission denied', $e->getMessage());
        }
    }

    public function test_rn_mae_01_documento_unico_y_con_formato(): void
    {
        $this->empresa();
        $base = ['full_name' => 'Lucía Prueba Rojas', 'position' => 'Vendedora', 'hire_date' => '2026-11-02',
            'establishment_id' => DB::table('establishments')->where('code', 'L1')->value('id'), 'cost_center_id' => DB::table('cost_centers')->where('code', 'DEL')->value('id')];
        $this->admin()->postJson('/api/v1/mae/trabajadores', $base + ['doc_type' => 'DNI', 'doc_number' => '7265103'])->assertUnprocessable()->assertJsonPath('code', 'RN-MAE-01');
        $this->admin()->postJson('/api/v1/mae/trabajadores', $base + ['doc_type' => 'CE', 'doc_number' => '00 2315 478', 'phone' => '987 654 321'])->assertCreated();
        $this->empresa();
        $this->assertSame('+51987654321', DB::table('employees')->where('doc_number', '002315478')->value('phone'));
        $this->admin()->postJson('/api/v1/mae/trabajadores', $base + ['doc_type' => 'CE', 'doc_number' => '002315478'])->assertUnprocessable()->assertJsonPath('code', 'RN-MAE-01');
    }

    public function test_ficha_con_alcance_del_usuario_e_historia_enmascarada_segun_el_rol(): void
    {
        $this->empresa();
        $ana = DB::table('users')->where('email', 'ana.torres@donguando.pe')->first();
        $e = DB::table('employees')->where('id', $ana->employee_id)->first();
        $this->admin()->putJson("/api/v1/mae/trabajadores/{$e->id}", [
            'full_name' => $e->full_name, 'position' => 'Vendedora líder', 'establishment_id' => $e->establishment_id,
            'cost_center_id' => $e->cost_center_id, 'hire_date' => $e->hire_date, 'phone' => '+51987000111', 'email' => $e->email,
        ])->assertNoContent();

        // Administración ve la historia, pero sin datos personales (RN-AUD-07); la vendedora tiene marcas asignadas.
        $f = $this->admin()->getJson("/api/v1/mae/trabajadores/{$e->id}")->assertOk();
        $this->assertNotEmpty($f->json('usuarios.0.marcas'));
        $this->assertNull($f->json('usuarios.0.locales')); // sin locales asignados ve todos (así lo aplica Access)
        $this->assertIsBool($f->json('usuarios.0.segundo_factor'));
        $this->assertSame('Vendedora', $f->json('usuarios.0.rol_nombre'));
        $cambio = $f->json('historia.0');
        $this->assertSame('cambio', $cambio['tipo']);
        $this->assertStringNotContainsString('_', (string) $cambio['rol']); // el nombre del rol, no su código
        $campos = collect($cambio['cambios'])->keyBy('campo');
        $this->assertSame('Vendedora líder', $campos['Cargo']['despues']);
        $this->assertStringNotContainsString('987000', $campos['Celular']['despues']);
        $this->assertArrayNotHasKey('monthly_salary', $campos->all());

        // Una sola alta aunque la base se haya rehecho antes (la bitácora conserva las copias anteriores).
        $this->assertCount(1, collect($f->json('historia'))->where('tipo', 'alta'));

        // Gerencia ve el dato completo; RR. HH. no ve la historia de los registros.
        $g = $this->como('rquispe@donguando.pe')->getJson("/api/v1/mae/trabajadores/{$e->id}")->assertOk();
        $this->assertSame('+51987000111', collect($g->json('historia.0.cambios'))->firstWhere('campo', 'Celular')['despues']);
        $this->como('gsoto@donguando.pe')->getJson("/api/v1/mae/trabajadores/{$e->id}")->assertOk()->assertJsonPath('historia', null);
        // Un rol de alcance total ve todas las marcas.
        $this->empresa();
        $this->assertNull($this->admin()->getJson('/api/v1/mae/trabajadores/'.DB::table('users')->where('email', 'chuaman@donguando.pe')->value('employee_id'))
            ->json('usuarios.0.marcas'));
    }

    public function test_rn_mae_13_un_solo_usuario_vigente_por_trabajador(): void
    {
        $this->empresa();
        $libre = DB::table('employees')->where('status', 'ACTIVE')->whereNotIn('id', DB::table('users')->whereNotNull('employee_id')->pluck('employee_id'))->value('id');
        $conUsuario = DB::table('users')->where('email', 'fquispe@donguando.pe')->first();
        $this->admin()->postJson("/api/v1/mae/trabajadores/{$libre}/usuario", ['user_id' => $conUsuario->id])->assertUnprocessable()->assertJsonPath('code', 'RN-MAE-13');
        // Los usuarios de Intelectalab no son trabajadores: ni se ofrecen ni se vinculan.
        $this->empresa();
        $soporte = DB::table('users')->where('role', 'SOPORTE_PLATAFORMA')->value('id');
        $libres = collect($this->admin()->getJson("/api/v1/mae/trabajadores/{$libre}/usuarios-libres")->assertOk()->json());
        $this->assertNotContains($soporte, $libres->pluck('id'));
        $this->assertFalse($libres->contains(fn ($u) => str_contains($u['role'], '_')), 'El rol va con su nombre, no con su código');
        $this->admin()->postJson("/api/v1/mae/trabajadores/{$libre}/usuario", ['user_id' => $soporte])->assertUnprocessable()->assertJsonPath('code', 'RN-MAE-13');
    }

    public function test_importar_trabajadores_graba_solo_las_filas_validas(): void
    {
        $csv = "tipo_doc;numero;nombre;cargo;local;centro_costo;ingreso;celular;correo\n"
            ."DNI;72651034;Jhon Huamaní Tito;Preparador;L1;ALM-L1;2026-10-12;+51984551230;\n"
            ."DNI;7265103;Lucero Rojas Paz;Vendedora;L1;VEN-MOS;2026-10-12;;\n"
            ."DNI;73110299;Nataly Inga Ramos;Operaria de caldos;L2;PROD-L2;12/10/2026;984551235;\n"
            .'DNI;73110299;Repetida;Operaria;L2;PROD-L2;2026-10-12;;';
        $r = $this->admin()->postJson('/api/v1/mae/trabajadores/importar/revisar', ['texto' => $csv])->assertOk();
        $this->assertSame([[], 1, [], 1], array_map(fn ($f) => $f['errores'] ? 1 : [], $r->json('filas')));
        $this->admin()->postJson('/api/v1/mae/trabajadores/importar', ['texto' => $csv])->assertCreated()->assertJsonPath('grabados', 2)->assertJsonPath('omitidos', 2);
        $this->empresa();
        $this->assertSame('2026-10-12', DB::table('employees')->where('doc_number', '73110299')->value('hire_date'));
    }

    public function test_importar_trabajadores_con_el_modelo_en_excel_o_un_csv(): void
    {
        // El modelo: Excel con instrucciones, la cabecera y las listas de la empresa.
        $r = $this->admin()->get('/api/v1/mae/trabajadores/importar/plantilla')->assertOk();
        $ruta = tempnam(sys_get_temp_dir(), 'pl').'.xlsx';
        file_put_contents($ruta, $r->streamedContent());
        $libro = IOFactory::load($ruta);
        $hoja = $libro->getSheet(0);
        $this->assertStringStartsWith('# Importar trabajadores', (string) $hoja->getCell('A1')->getValue());
        $this->assertSame('Tipo de documento', $hoja->getCell('A5')->getValue());
        $this->assertContains('L1', $libro->getSheetByName('Listas')->rangeToArray('B1:B5', null, false, false)[0]);

        // El modelo lleno se lee aunque cambien el orden de las columnas, con fechas de Excel y filas de notas.
        $libro = new Spreadsheet;
        $libro->getActiveSheet()->fromArray([
            ['# Notas que se saltan'],
            ['Nombre completo', 'Número de documento', 'Tipo de documento', 'Cargo', 'Local', 'Centro de costo', 'Fecha de ingreso'],
            ['Rosa Mena; Paz', '74125896', 'DNI', 'Vendedora', 'L1', 'VEN-MOS', 46307], // 12/10/2026 como número de Excel
        ]);
        $xlsx = tempnam(sys_get_temp_dir(), 'tr').'.xlsx';
        (new Xlsx($libro))->save($xlsx);
        $texto = $this->admin()->post('/api/v1/mae/trabajadores/importar/archivo', [
            'archivo' => new UploadedFile($xlsx, 'trabajadores.xlsx', null, null, true),
        ])->assertOk()->json('texto');
        $this->assertSame("tipo_doc;numero;nombre;cargo;local;centro_costo;ingreso;celular;correo\nDNI;74125896;Rosa Mena Paz;Vendedora;L1;VEN-MOS;2026-10-12;;", $texto);
        $this->admin()->postJson('/api/v1/mae/trabajadores/importar/revisar', ['texto' => $texto])->assertOk()->assertJsonPath('filas.0.errores', []);

        // Un CSV con comas también; un archivo sin la fila de títulos o de otro tipo, no.
        $csv = UploadedFile::fake()->createWithContent('t.csv', "numero,tipo_doc,nombre,cargo,local,centro_costo,ingreso\n74125897,DNI,Ana Paz,Cajera,L2,PROD-L2,2026-10-01");
        $this->assertStringEndsWith("\nDNI;74125897;Ana Paz;Cajera;L2;PROD-L2;2026-10-01;;", $this->admin()->post('/api/v1/mae/trabajadores/importar/archivo', ['archivo' => $csv])->json('texto'));
        $this->admin()->post('/api/v1/mae/trabajadores/importar/archivo', ['archivo' => UploadedFile::fake()->createWithContent('t.csv', "a;b\n1;2")])
            ->assertUnprocessable()->assertJsonPath('code', 'IMPORTAR');
        $this->admin()->postJson('/api/v1/mae/trabajadores/importar/archivo', ['archivo' => UploadedFile::fake()->create('virus.exe', 10)])
            ->assertUnprocessable()->assertJsonValidationErrors('archivo');
        // Sin sesión: 401 aunque se pida un archivo y no JSON (la API no redirige a una página de ingreso).
        $this->app['auth']->forgetGuards();
        $this->flushHeaders()->withHeaders(['Accept' => 'application/octet-stream', 'X-Tenant-Host' => self::DG])
            ->get('/api/v1/mae/trabajadores/importar/plantilla')->assertUnauthorized();
        // Sin el permiso de gestionar trabajadores no hay modelo ni lectura.
        $this->como('ana.torres@donguando.pe')->get('/api/v1/mae/trabajadores/importar/plantilla')->assertForbidden();
    }

    public function test_tipo_de_cambio_correccion_con_motivo_y_permiso(): void
    {
        $this->como('fquispe@donguando.pe')->postJson('/api/v1/mae/tipo-cambio', ['date' => '2026-11-13', 'buy' => 3.37, 'sell' => 3.38])->assertForbidden();
        // La contadora abre MAE-05 por su permiso, aunque no tenga el resto de MAE.
        $this->como('mcardenas@donguando.pe')->getJson('/api/v1/mae/tipo-cambio?mes=2026-10')->assertOk()->assertJsonCount(31, 'dias');
        // Cargas manuales y correcciones: paginadas, la más reciente primero, con filtros.
        $r = $this->como('mcardenas@donguando.pe')->getJson('/api/v1/mae/tipo-cambio/registros?per_page=2')->assertOk();
        $this->assertSame(3, $r->json('total'));
        $this->assertSame(2, $r->json('last_page'));
        $this->assertSame('2026-10-02', $r->json('data.0.date'));
        $this->como('mcardenas@donguando.pe')->getJson('/api/v1/mae/tipo-cambio/registros?tipo=CORREGIDO')->assertOk()->assertJsonPath('total', 1);
        $this->como('mcardenas@donguando.pe')->getJson('/api/v1/mae/tipo-cambio/registros?desde=2026-09-20&hasta=2026-09-30')->assertOk()->assertJsonPath('data.0.date', '2026-09-22');
        $this->como('mcardenas@donguando.pe')->postJson('/api/v1/mae/tipo-cambio', ['date' => '2026-11-13', 'buy' => 3.37, 'sell' => 3.38])->assertCreated();
        $this->como('mcardenas@donguando.pe')->postJson('/api/v1/mae/tipo-cambio', ['date' => '2026-11-13', 'buy' => 3.39, 'sell' => 3.38])
            ->assertUnprocessable()->assertJsonPath('code', 'RN-MAE-06');
        $this->como('mcardenas@donguando.pe')->postJson('/api/v1/mae/tipo-cambio', ['date' => '2026-11-13', 'buy' => 3.36, 'sell' => 3.37, 'reason' => 'corto'])
            ->assertUnprocessable()->assertJsonPath('code', 'RN-MAE-08');
        $this->como('mcardenas@donguando.pe')->postJson('/api/v1/mae/tipo-cambio', ['date' => '2026-11-13', 'buy' => 3.36, 'sell' => 3.37, 'reason' => 'Error al digitar la venta'])
            ->assertCreated()->assertJsonPath('corregido', true);
        $this->empresa();
        $this->assertSame('3.3700', DB::table('exchange_rates')->where('date', '2026-11-13')->value('sell'));
    }

    public function test_carga_automatica_desde_la_fuente_y_aviso_si_falla(): void
    {
        $this->app->bind(FuenteTipoCambio::class, fn () => new class implements FuenteTipoCambio
        {
            public function del(string $fecha, string $moneda): ?array
            {
                return ['buy' => 3.371, 'sell' => 3.379, 'published_on' => $fecha];
            }

            public function nombre(): string
            {
                return 'SUNAT de prueba';
            }
        });
        $this->artisan('mae:cargar-tipo-cambio', ['--fecha' => '2026-11-16', '--pausa' => 0])->assertSuccessful();
        foreach ([self::DG, self::CS] as $host) {
            $this->empresa($host);
            $this->assertSame(1, DB::table('exchange_rates')->where('date', '2026-11-16')->count(), "Una por empresa ({$host})");
        }

        $this->app->bind(FuenteTipoCambio::class, SinConector::class);
        $this->artisan('mae:cargar-tipo-cambio', ['--fecha' => '2026-11-13', '--pausa' => 0])->assertSuccessful();
        $this->empresa();
        $this->assertTrue(DB::table('notifications')->where(['module' => 'MAE', 'role' => 'ADMINISTRACION'])->where('title', 'like', '%13/11/2026')->exists());
        $this->assertTrue(TiposDeCambio::esHabil('2026-11-13'));
        $this->assertFalse(TiposDeCambio::esHabil('2026-04-03')); // Viernes Santo
    }

    public function test_permisos_y_cada_empresa_ve_solo_lo_suyo(): void
    {
        $this->como('fquispe@donguando.pe')->postJson('/api/v1/mae/comisiones', ['payment_method_id' => $this->medio('YAPE'), 'valid_from' => '2027-01-01', 'fee_pct' => 1])
            ->assertForbidden();
        $dg = $this->admin()->getJson('/api/v1/mae/trabajadores?per_page=100')->assertOk()->json('data');
        $this->assertNotEmpty($dg);
        $this->assertArrayNotHasKey('monthly_salary', $dg[0]);
        // Un trabajador de la otra empresa no se ve desde Don Guando.
        $this->empresa(self::CS);
        $cc = DB::table('cost_centers')->insertGetId(['company_id' => DB::table('companies')->value('id'), 'code' => 'ADM', 'name' => 'Administración', 'area' => 'ADM', 'status' => 'ACTIVE']);
        $otro = DB::table('employees')->insertGetId(['doc_type' => 'DNI', 'doc_number' => '45678912', 'full_name' => 'Trabajador del Sur', 'position' => 'Vendedor',
            'establishment_id' => DB::table('establishments')->value('id'), 'cost_center_id' => $cc, 'hire_date' => '2026-01-05', 'status' => 'ACTIVE']);
        $this->admin()->getJson("/api/v1/mae/trabajadores/{$otro}")->assertNotFound();
        $this->assertNotContains($otro, array_column($this->admin()->getJson('/api/v1/mae/trabajadores?per_page=100')->json('data'), 'id'));
    }
}
