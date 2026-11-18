<?php

namespace Tests\Feature;

use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/** La página pública de GestionCarnica: planes desde la API y pedidos de demo (sin sesión ni empresa). */
class PublicoTest extends TestCase
{
    private function pedido(array $cambios = []): array
    {
        return $cambios + ['name' => 'Lucía Prueba', 'phone' => '+51 987 654 321', 'email' => 'Lucia@LaPrueba.pe', 'business_type' => 'AVICOLA',
            'interests' => ['PEDIDOS', 'REPARTO'], 'plan_code' => 'CRECIMIENTO', 'source' => '/?utm_source=prueba', 'consent' => true];
    }

    /** Las filas que se insertan en demo_requests (la app no las puede leer después). */
    private function insertados(callable $fn): array
    {
        $filas = [];
        DB::listen(function ($q) use (&$filas) {
            if (str_starts_with($q->sql, 'insert into "demo_requests"')) {
                $filas[] = $q->bindings;
            }
        });
        $fn();

        return $filas;
    }

    public function test_los_planes_salen_de_la_api_con_lo_que_incluyen_y_sus_modulos(): void
    {
        $r = $this->getJson('/api/v1/publico/planes')->assertOk();
        $this->assertSame(14, $r->json('prueba_dias'));
        $planes = collect($r->json('planes'))->keyBy('code');
        $this->assertSame(['INICIAL', 'CRECIMIENTO', 'MULTIMARCA'], $planes->keys()->all());
        $this->assertSame(149.0, (float) $planes['INICIAL']['price_pen']);
        $this->assertTrue($planes['CRECIMIENTO']['is_featured']);
        $this->assertSame('Todo lo del Inicial, más:', $planes['CRECIMIENTO']['includes_previous']);
        $this->assertContains('Boletas y facturas electrónicas', $planes['INICIAL']['highlights']);
        $this->assertCount(18, $planes['INICIAL']['modulos']);
        $this->assertCount(DB::table('platform_modules')->count(), $planes['MULTIMARCA']['modulos'], 'Multimarca: todos los módulos');
        $this->assertNotContains('CRM', array_column($planes['INICIAL']['modulos'], 'code'));
    }

    public function test_el_pedido_de_demo_se_guarda_y_la_app_no_lo_puede_leer(): void
    {
        $filas = $this->insertados(fn () => $this->postJson('/api/v1/publico/demo', $this->pedido())->assertCreated());
        $this->assertCount(1, $filas);
        $this->assertContains('lucia@laprueba.pe', $filas[0], 'El correo se guarda en minúsculas');
        $this->assertContains('["PEDIDOS","REPARTO"]', $filas[0]);
        // El correo es opcional.
        $this->postJson('/api/v1/publico/demo', $this->pedido(['email' => null]))->assertCreated();

        $this->expectException(QueryException::class);
        DB::table('demo_requests')->count();   // la app solo inserta
    }

    public function test_el_pedido_valida_todo_y_la_trampa_no_guarda(): void
    {
        $this->postJson('/api/v1/publico/demo', $this->pedido(['email' => 'no-es-correo', 'phone' => '<script>', 'business_type' => 'BANCO',
            'plan_code' => 'GRATIS', 'interests' => ['PEDIDOS', 'HACKEO'], 'consent' => false]))
            ->assertUnprocessable()->assertJsonValidationErrors(['email', 'phone', 'business_type', 'plan_code', 'interests.1', 'consent']);

        // Un robot llena el campo oculto: se le responde igual, pero no se guarda nada.
        $filas = $this->insertados(fn () => $this->postJson('/api/v1/publico/demo', $this->pedido(['name' => 'Robot', 'sitio_web' => 'http://spam.example']))->assertCreated());
        $this->assertSame([], $filas);
    }

    public function test_el_pedido_tiene_limite_por_ip(): void
    {
        for ($i = 0; $i < 5; $i++) {
            $this->postJson('/api/v1/publico/demo', $this->pedido(['name' => "Persona {$i}"]))->assertCreated();
        }
        $this->postJson('/api/v1/publico/demo', $this->pedido(['name' => 'Persona 6']))->assertTooManyRequests();
    }

    public function test_la_app_no_cambia_los_planes(): void
    {
        $this->expectException(QueryException::class);
        DB::table('saas_plans')->where('code', 'INICIAL')->update(['price_pen' => 1]);
    }
}
