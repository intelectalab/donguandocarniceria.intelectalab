<?php

namespace Tests\Feature\Modulos;

use App\Modulos\Tab\Services\Catalogo;
use App\Modulos\Tab\Services\Cierre;
use App\Modulos\Tab\Services\Metas;
use App\Modulos\Tab\Services\Motor;
use App\Support\Access;
use App\Support\TenantContext;
use Carbon\Carbon;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/** TAB · Tablero e indicadores: un test por criterio CA-TAB-01 a CA-TAB-06 y las reglas que los rodean (RN-TAB-01 a RN-TAB-10). */
class TabTest extends TestCase
{
    private array $tokens = [];

    private const GERENTE = 'rquispe@donguando.pe';

    private const COORDINADOR = 'rchavez@donguando.pe';

    private const SUPERVISORA = 'pleon@donguando.pe';

    private const VENDEDORA = 'fcampos@donguando.pe';

    private const MARKETING = 'lparedes@donguando.pe';

    private const L1 = 'a44e8b40-bd56-5074-a845-2802480dbe92';

    private const L2 = '1f3c2801-4a74-5e20-9925-077e5e64067f';

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        CarbonImmutable::setTestNow();
        Catalogo::olvidar();
        Motor::olvidar();
        Metas::olvidar();
        parent::tearDown();
    }

    private function como(string $email): static
    {
        return $this->desde(self::DG, $this->tokens[$email] ??= $this->ingresar(self::DG, $email));
    }

    /** Corre $fn dentro de la empresa Don Guando (RLS) y deja el contexto limpio. */
    private function enDG(callable $fn): mixed
    {
        $t = DB::selectOne('SELECT auth_tenants_for_email(?) AS t', [self::GERENTE])->t;
        TenantContext::set(TenantContext::find($t));
        try {
            return $fn();
        } finally {
            TenantContext::set(null);
            Catalogo::olvidar();
            Motor::olvidar();
            Metas::olvidar();
            Access::forget();
        }
    }

    private function fila(array $tabla, string $codigo): ?array
    {
        foreach ($tabla as $x) {
            if ($x['code'] === $codigo) {
                return $x;
            }
        }

        return null;
    }

    /** Copia unas entregas de setiembre al reparto de costos de abril de 2026 (mes sin corridas), con un costo fijo por entrega. */
    private function repartoDeAbril(int $corrida, float $costo): void
    {
        $this->enDG(function () use ($corrida, $costo) {
            $base = DB::table('delivery_cost_allocations')->where('period', '2026-09-01')->orderBy('id')->limit(20)->get();
            foreach ($base as $a) {
                $f = (array) $a;
                unset($f['id'], $f['tenant_id'], $f['created_at'], $f['updated_at']);
                DB::table('delivery_cost_allocations')->insert(array_merge($f, ['period' => '2026-04-01', 'run_no' => $corrida, 'total_cost' => $costo,
                    'direct_cost' => $costo, 'vehicle_cost' => 0, 'driver_cost' => 0, 'carrier_cost' => 0, 'other_cost' => 0, 'run_at' => now()]));
            }
        });
    }

    public function test_ca_tab_01_semaforo_del_costo_por_entrega(): void
    {
        // Costo por entrega: más bajo es mejor, meta S/ 12 y tolerancia 10 %.
        $this->assertSame('AMBER', Metas::semaforo(12.90, 12, 'LOWER_BETTER', 10));
        $this->assertSame('RED', Metas::semaforo(13.50, 12, 'LOWER_BETTER', 10));
        $this->assertSame('GREEN', Metas::semaforo(11.00, 12, 'LOWER_BETTER', 10));
        // La vista previa de TAB-08 dice lo mismo.
        $this->como(self::GERENTE)->postJson('/api/v1/tab/metas/simular', ['valor' => 12.9, 'meta' => 12, 'sentido' => 'LOWER_BETTER', 'tolerancia' => 10])
            ->assertOk()->assertJsonPath('semaforo', 'AMBER');
        // Una meta guardada de S/ 12 pinta la tarjeta del tablero de delivery con su semáforo.
        $this->enDG(fn () => DB::table('kpi_targets')->where('kpi_code', 'KPI-DEL-04')->delete());
        $this->como(self::GERENTE)->postJson('/api/v1/tab/metas', ['code' => 'KPI-DEL-04', 'target' => 12, 'tolerance_pct' => 10, 'valid_from' => '2026-01-01'])->assertCreated();
        $t = $this->como(self::GERENTE)->getJson('/api/v1/tab/tableros/DELIVERY?mes=2026-10')->assertOk();
        $x = $this->fila($t->json('tabla'), 'KPI-DEL-04');
        $this->assertEqualsWithDelta(12.60, $x['value'], 0.001, 'Octubre congelado: S/ 12,60 por entrega');
        $this->assertSame('AMBER', $x['semaforo']);
        $this->assertEquals(12, $x['meta']);
    }

    public function test_ca_tab_02_error_de_armado_y_conversion_de_leads(): void
    {
        $this->assertSame('GREEN', Metas::semaforo(0.4, 0.5, 'LOWER_BETTER', 10));
        $this->assertSame('AMBER', Metas::semaforo(18, 20, 'HIGHER_BETTER', 10));
        $this->assertSame('RED', Metas::semaforo(17.9, 20, 'HIGHER_BETTER', 10));
        // Objetivo: verde dentro de la banda, ámbar hasta el doble, rojo fuera.
        $this->assertSame('GREEN', Metas::semaforo(10.5, 10, 'TARGET', 10));
        $this->assertSame('AMBER', Metas::semaforo(11.5, 10, 'TARGET', 10));
        $this->assertSame('RED', Metas::semaforo(12.5, 10, 'TARGET', 10));
        // Sin tolerancia propia se usa tab_default_tolerance_pct (10 %).
        $this->assertSame('AMBER', Metas::semaforo(18, 20, 'HIGHER_BETTER'));
    }

    public function test_ca_tab_03_congelar_y_recalcular_con_motivo(): void
    {
        $this->repartoDeAbril(1, 15);
        $r = $this->como(self::GERENTE)->postJson('/api/v1/tab/cierre/congelar', ['mes' => '2026-04'])->assertCreated();
        $this->assertSame(1, $r->json('corrida.run_no'));
        $d = $this->como(self::GERENTE)->getJson('/api/v1/tab/indicadores/KPI-DEL-04/detalle?mes=2026-04')->assertOk();
        $this->assertEqualsWithDelta(15.0, $d->json('indicador.value'), 0.001);
        $this->assertSame('SNAPSHOT', $d->json('indicador.source'));

        // Se registra la reparación de la moto: DEL reparte de nuevo y el costo sube a S/ 17 por entrega.
        $this->repartoDeAbril(2, 17);
        $this->como(self::GERENTE)->postJson('/api/v1/tab/cierre/congelar', ['mes' => '2026-04'])
            ->assertUnprocessable()->assertJsonPath('code', 'RN-TAB-03');
        $this->como(self::GERENTE)->postJson('/api/v1/tab/cierre/congelar', ['mes' => '2026-04', 'motivo' => 'corto'])
            ->assertUnprocessable()->assertJsonPath('code', 'RN-TAB-03');
        $r = $this->como(self::GERENTE)->postJson('/api/v1/tab/cierre/congelar', ['mes' => '2026-04', 'motivo' => 'Reparación de la moto registrada tarde en GAS'])->assertCreated();
        $this->assertSame(2, $r->json('corrida.run_no'));

        // El tablero usa la corrida 2; la corrida 1 se conserva (solo inserción).
        $t = $this->como(self::GERENTE)->getJson('/api/v1/tab/tableros/DELIVERY?mes=2026-04')->assertOk();
        $this->assertSame(2, $t->json('corrida.run_no'));
        $x = $this->fila($t->json('tabla'), 'KPI-DEL-04');
        $this->assertEqualsWithDelta(17.0, $x['value'], 0.001);
        $this->assertSame(2, $x['run_no']);
        $valores = $this->enDG(fn () => DB::table('kpi_snapshots')->where('kpi_code', 'KPI-DEL-04')->where('period', '2026-04-01')->where('dimension_key', 'ALL')
            ->orderBy('run_no')->pluck('value', 'run_no')->map(fn ($v) => (float) $v)->all());
        $this->assertEquals([1 => 15.0, 2 => 17.0], $valores);
        $this->assertSame(2, (int) $this->enDG(fn () => DB::table('notifications')->where('module', 'TAB')->where('title', 'like', '%abril de 2026%')
            ->where('user_id', DB::table('users')->where('email', 'chuaman@donguando.pe')->value('id'))->count()), 'Administración recibe un aviso por corrida');

        // Congelar octubre el 10/10 se rechaza: el mes no terminó.
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-10-10 12:00', 'America/Lima'));
        Carbon::setTestNow(Carbon::parse('2026-10-10 12:00', 'America/Lima'));
        $this->como(self::GERENTE)->postJson('/api/v1/tab/cierre/congelar', ['mes' => '2026-10', 'motivo' => 'Quiero ver octubre antes de tiempo'])
            ->assertUnprocessable()->assertJsonPath('code', 'RN-TAB-03');
    }

    public function test_los_valores_congelados_no_se_modifican(): void
    {
        $this->enDG(function () {
            $this->assertTrue(DB::table('kpi_snapshots')->where('period', '2026-10-01')->exists());
            try {
                DB::transaction(fn () => DB::table('kpi_snapshots')->where('period', '2026-10-01')->update(['value' => 0]));
                $this->fail('La aplicación no debe poder cambiar un valor congelado');
            } catch (\Illuminate\Database\QueryException $e) {
                $this->assertStringContainsString('permission denied', $e->getMessage());
            }
        });
    }

    public function test_ca_tab_04_del_costo_por_entrega_a_las_rutas_que_lo_forman(): void
    {
        $d = $this->como(self::GERENTE)->getJson('/api/v1/tab/indicadores/KPI-DEL-04/detalle?mes=2026-09')->assertOk();
        $valor = (float) $d->json('indicador.value');
        $this->assertGreaterThan(0, $valor);
        $det = $d->json('detalle');
        $this->assertGreaterThan(0, $det['total_filas']);
        $this->assertSame(['ruta', 'fecha', 'local', 'modalidad', 'vehiculo', 'costo', 'entregas', 'por_entrega', 'kg', 'subsidio'], array_column($det['columnas'], 0));
        // Las rutas suman el valor: costo total entre entregas.
        $this->assertEqualsWithDelta($valor, $det['totales']['costo'] / $det['totales']['entregas'], 0.01);
        // La tendencia muestra los 6 meses y de dónde sale cada valor.
        $this->assertCount(6, $d->json('tendencia'));
        $this->assertSame('SNAPSHOT', $d->json('tendencia.5.source'));
        // Exportar el detalle queda en la bitácora (RN-TAB-09).
        $this->como(self::GERENTE)->get('/api/v1/tab/indicadores/KPI-DEL-04/exportar?mes=2026-09')->assertOk()
            ->assertHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        $this->assertTrue($this->enDG(fn () => DB::table('access_log')->where('event', 'REPORT_EXPORTED')->where('detail', 'like', '%KPI-DEL-04%')->exists()));
    }

    public function test_ca_tab_05_coordinador_con_alcance_del_local_1(): void
    {
        $this->enDG(function () {
            $u = DB::table('users')->where('email', self::COORDINADOR)->first();
            DB::table('roles')->where('code', 'COORDINADOR_DELIVERY')->update(['scope_mode' => 'ASSIGNED']);
            DB::table('user_scopes')->where('user_id', $u->id)->delete();
            DB::table('user_scopes')->insert(['user_id' => $u->id, 'establishment_id' => self::L1]);
        });
        $t = $this->como(self::COORDINADOR)->getJson('/api/v1/tab/tableros/DELIVERY?mes=2026-10')->assertOk();
        $this->assertSame(self::L1, $t->json('local'));
        $this->assertNotEmpty($t->json('notas'));
        // Pedir el Local 2 se rechaza; no se amplía el alcance.
        $this->como(self::COORDINADOR)->getJson('/api/v1/tab/tableros/DELIVERY?mes=2026-10&local='.self::L2)
            ->assertUnprocessable()->assertJsonPath('code', 'RN-TAB-06');
        $this->como(self::COORDINADOR)->getJson('/api/v1/tab/indicadores/KPI-DEL-04/detalle?mes=2026-10&local='.self::L2)
            ->assertUnprocessable()->assertJsonPath('code', 'RN-TAB-06');
        // El detalle solo trae rutas del Local 1, y su valor es el del Local 1, no el de toda la empresa.
        $d = $this->como(self::COORDINADOR)->getJson('/api/v1/tab/indicadores/KPI-DEL-04/detalle?mes=2026-10')->assertOk();
        $locales = array_unique(array_column($d->json('detalle.filas'), 'local'));
        $this->assertSame(['Local 1'], array_values($locales));
        $todo = $this->como(self::GERENTE)->getJson('/api/v1/tab/indicadores/KPI-DEL-04/detalle?mes=2026-10')->assertOk();
        $this->assertContains('Local 2', array_column($todo->json('detalle.filas'), 'local'));
        // Y no puede abrir el tablero de gerencia.
        $this->como(self::COORDINADOR)->getJson('/api/v1/tab/tableros/GERENCIA')->assertUnprocessable()->assertJsonPath('code', 'RN-TAB-06');
    }

    public function test_ca_tab_06_indicadores_de_telefonia_segun_el_modulo(): void
    {
        $t = $this->como(self::SUPERVISORA)->getJson('/api/v1/tab/tableros/SUPERVISORA?mes=2026-10')->assertOk();
        $this->assertEmpty(array_filter(array_column($t->json('tabla'), 'code'), fn ($c) => str_starts_with($c, 'KPI-TEL')));
        $this->assertContains('TEL', $t->json('modulos_apagados'));
        $this->como(self::SUPERVISORA)->getJson('/api/v1/tab/indicadores/KPI-TEL-01/detalle')->assertUnprocessable()->assertJsonPath('code', 'RN-TAB-07');
        // Con TEL apagado no se congela nada de TEL.
        $this->assertFalse($this->enDG(fn () => DB::table('kpi_snapshots')->where('period', '2026-10-01')->where('kpi_code', 'like', 'KPI-TEL%')->exists()));

        // Se enciende TEL: sus indicadores aparecen sin cambiar nada más.
        $this->enDG(fn () => DB::table('tenant_modules')->where('module_code', 'TEL')->update(['enabled' => true]));
        Access::forget();
        $t = $this->como(self::SUPERVISORA)->getJson('/api/v1/tab/tableros/SUPERVISORA?mes=2026-10')->assertOk();
        $tel = array_filter(array_column($t->json('tabla'), 'code'), fn ($c) => str_starts_with($c, 'KPI-TEL'));
        $this->assertCount(8, $tel);
        $this->assertNotContains('TEL', $t->json('modulos_apagados'));
    }

    public function test_rn_tab_05_metas_sin_solapamiento(): void
    {
        $this->enDG(fn () => DB::table('kpi_targets')->where('kpi_code', 'KPI-PED-02')->delete());
        $this->como(self::GERENTE)->postJson('/api/v1/tab/metas', ['code' => 'KPI-PED-02', 'target' => 120, 'valid_from' => '2026-01-01', 'valid_to' => '2026-12-31'])->assertCreated();
        $this->como(self::GERENTE)->postJson('/api/v1/tab/metas', ['code' => 'KPI-PED-02', 'target' => 130, 'valid_from' => '2026-06-01'])
            ->assertUnprocessable()->assertJsonPath('code', 'RN-TAB-05');
        // Otra marca o local no choca: es otra meta.
        $marca = $this->enDG(fn () => DB::table('brands')->orderBy('name')->value('id'));
        $this->como(self::GERENTE)->postJson('/api/v1/tab/metas', ['code' => 'KPI-PED-02', 'target' => 130, 'valid_from' => '2026-06-01', 'brand_id' => $marca])->assertCreated();
        // Cerrada la vigencia, la nueva entra.
        $id = $this->enDG(fn () => DB::table('kpi_targets')->where('kpi_code', 'KPI-PED-02')->whereNull('brand_id')->value('id'));
        $this->como(self::GERENTE)->postJson("/api/v1/tab/metas/{$id}/cerrar", ['fecha' => '2026-11-30'])->assertOk();
        $this->como(self::GERENTE)->postJson('/api/v1/tab/metas', ['code' => 'KPI-PED-02', 'target' => 130, 'valid_from' => '2026-12-01'])->assertCreated();
        // La base también lo impide (restricción de exclusión), aunque alguien se salte la API.
        $this->enDG(function () {
            $def = DB::table('kpi_definitions')->where('code', 'KPI-PED-02')->first();
            try {
                DB::transaction(fn () => DB::table('kpi_targets')->insert(['kpi_id' => $def->id, 'kpi_code' => 'KPI-PED-02', 'target' => 1, 'tolerance_pct' => 10,
                    'valid_from' => '2026-12-15', 'created_by' => 'prueba', 'created_at' => now()]));
                $this->fail('Dos metas vigentes a la vez no deben entrar');
            } catch (\Illuminate\Database\QueryException $e) {
                $this->assertStringContainsString('kpi_targets_rn_tab_05_no_overlap', $e->getMessage());
            }
        });
    }

    public function test_permisos_de_metas_catalogo_cierre_y_exportacion(): void
    {
        $this->como(self::SUPERVISORA)->postJson('/api/v1/tab/metas', ['code' => 'KPI-PED-02', 'target' => 1, 'valid_from' => '2030-01-01'])->assertForbidden();
        $this->como(self::SUPERVISORA)->putJson('/api/v1/tab/indicadores/KPI-PED-02', ['status' => 'INACTIVE'])->assertForbidden();
        $this->como(self::SUPERVISORA)->postJson('/api/v1/tab/cierre/congelar', ['mes' => '2026-10', 'motivo' => 'sin permiso para esto'])->assertForbidden();
        $this->como(self::SUPERVISORA)->get('/api/v1/tab/tableros/SUPERVISORA/exportar')->assertForbidden();
        $this->como(self::MARKETING)->get('/api/v1/tab/tableros/MARKETING/exportar?mes=2026-10')->assertOk();
        // Cada rol ve su tablero; la vendedora no abre el de gerencia.
        $this->como(self::VENDEDORA)->getJson('/api/v1/tab/tableros/VENTAS?mes=2026-10')->assertOk();
        $this->como(self::VENDEDORA)->getJson('/api/v1/tab/tableros/GERENCIA')->assertUnprocessable()->assertJsonPath('code', 'RN-TAB-06');
        $codigos = array_column($this->como(self::VENDEDORA)->getJson('/api/v1/tab/tableros')->assertOk()->json('tableros'), 'code');
        $this->assertSame(['VENTAS'], $codigos);
    }

    public function test_catalogo_desactivar_un_indicador_lo_quita_del_tablero(): void
    {
        $c = $this->como(self::GERENTE)->getJson('/api/v1/tab/indicadores')->assertOk();
        $this->assertGreaterThan(200, $c->json('cifras.registrados'));
        $this->como(self::GERENTE)->putJson('/api/v1/tab/indicadores/KPI-PED-01', ['status' => 'INACTIVE'])->assertOk()->assertJsonPath('status', 'INACTIVE');
        $t = $this->como(self::GERENTE)->getJson('/api/v1/tab/tableros/GERENCIA?mes=2026-10')->assertOk();
        $this->assertNull($this->fila($t->json('tabla'), 'KPI-PED-01'));
        // visible_roles: un indicador solo para gerencia no lo ve la supervisora.
        $this->como(self::GERENTE)->putJson('/api/v1/tab/indicadores/KPI-PED-02', ['visible_roles' => ['GERENTE']])->assertOk();
        $t = $this->como(self::SUPERVISORA)->getJson('/api/v1/tab/tableros/SUPERVISORA?mes=2026-10')->assertOk();
        $this->assertNull($this->fila($t->json('tabla'), 'KPI-PED-02'));
    }

    public function test_rn_tab_01_mes_en_curso_en_vivo_y_mes_cerrado_congelado(): void
    {
        $t = $this->como(self::GERENTE)->getJson('/api/v1/tab/tableros/GERENCIA?mes=2026-10')->assertOk();
        $this->assertSame(1, $t->json('corrida.run_no'));
        $this->assertSame(['SNAPSHOT'], array_values(array_unique(array_filter(array_column($t->json('tabla'), 'source'), fn ($s) => $s !== 'NONE'))));
        $t = $this->como(self::GERENTE)->getJson('/api/v1/tab/tableros/GERENCIA')->assertOk();
        $this->assertNull($t->json('corrida'));
        $this->assertNotContains('SNAPSHOT', array_column($t->json('tabla'), 'source'));
        // RN-TAB-02: cada valor trae su fórmula para el cursor.
        $this->assertNotEmpty($t->json('tabla.0.formula'));
        $this->como(self::GERENTE)->postJson('/api/v1/tab/actualizar')->assertOk();
    }

    public function test_rn_tab_10_congelamiento_automatico(): void
    {
        // Octubre ya quedó congelado el 03/11 a las 02:00: la tarea no crea otra corrida.
        $this->enDG(function () {
            $oct = DB::table('kpi_snapshot_runs')->where('period', '2026-10-01')->first();
            $this->assertSame('OK', $oct->status);
            $this->assertSame('Programador de tareas', $oct->user);
            $this->assertNull(Cierre::automatico('2026-11-04'), 'Solo actúa el día tab_snapshot_day');
            $this->assertNull(Cierre::automatico('2026-11-03'), 'Un mes ya congelado no se vuelve a congelar solo');
            $this->assertSame(3, (int) DB::table('kpi_snapshots')->where('period', '2026-10-01')->where('kpi_code', 'KPI-TAB-02')->where('dimension_key', 'ALL')->value('value'));
        });
        // Las corridas fallidas no reemplazan a la anterior: julio tiene la 2 fallida y sigue en la 1.
        $c = $this->como(self::GERENTE)->getJson('/api/v1/tab/cierre')->assertOk();
        $julio = collect($c->json('meses'))->firstWhere('mes', '2026-07-01');
        $this->assertSame(1, $julio['corrida']);
        $this->assertSame(2, $julio['corridas']);
    }
}
