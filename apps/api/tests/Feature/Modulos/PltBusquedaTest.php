<?php

namespace Tests\Feature\Modulos;

use App\Modulos\Plt\Services\Busqueda;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/** PLT-02 Búsqueda global (RN-PLT-16): módulos, permisos y alcance de quien busca. */
class PltBusquedaTest extends TestCase
{
    private array $tokens = [];

    private function como(string $email): static
    {
        return $this->desde(self::DG, $this->tokens[$email] ??= $this->ingresar(self::DG, $email));
    }

    private function buscar(string $email, string $q): array
    {
        return $this->como($email)->getJson('/api/v1/plt/buscar?q='.urlencode($q))->assertOk()->json();
    }

    public function test_busca_desde_tres_letras_en_varios_tipos(): void
    {
        $this->assertTrue($this->buscar('rquispe@donguando.pe', 'ro')['corta']);

        $r = $this->buscar('rquispe@donguando.pe', 'rosa');
        $this->assertFalse($r['corta']);
        $tipos = array_unique(array_column($r['resultados'], 'tipo'));
        $this->assertContains('customer', $tipos);
        $this->assertContains('order', $tipos);
        $this->assertNotContains('call', $tipos); // TEL está apagado: sus llamadas publicadas no salen, ni para la gerente
        $this->assertLessThanOrEqual(20, count($r['resultados']));
        // Sin tildes: «huaman» encuentra «Huamán».
        $this->assertNotEmpty(array_filter($this->buscar('rquispe@donguando.pe', 'huaman')['resultados'], fn ($x) => str_contains($x['titulo'], 'Huamán')));
    }

    public function test_encuentra_datos_de_plataforma(): void
    {
        $r = $this->buscar('rquispe@donguando.pe', 'B001');
        $serie = array_values(array_filter($r['resultados'], fn ($x) => $x['tipo'] === 'setting' && $x['titulo'] === 'B001'));
        $this->assertSame('/m/plt/plt-08', $serie[0]['url']);
    }

    public function test_respeta_el_alcance_de_marcas(): void
    {
        // Una vendedora con alcance limitado no ve pedidos de otras marcas.
        $this->como('ana.torres@donguando.pe')->getJson('/api/v1/me')->assertOk();
        $marcas = DB::table('user_scopes')->join('users', 'users.id', '=', 'user_scopes.user_id')
            ->where('users.email', 'ana.torres@donguando.pe')->whereNotNull('brand_id')->pluck('brand_id')->all();
        $this->assertNotEmpty($marcas, 'La vendedora de prueba debe tener alcance por marca');

        $r = $this->buscar('ana.torres@donguando.pe', 'P-0');
        $pedidos = array_column(array_filter($r['resultados'], fn ($x) => $x['tipo'] === 'order'), 'id');
        foreach ($pedidos as $id) {
            $this->assertContains(DB::table('sales_orders')->where('id', $id)->value('brand_id'), $marcas);
        }
    }

    public function test_un_modulo_apagado_no_aparece(): void
    {
        // TEL llega apagado: sus llamadas publicadas no aparecen para quien no puede verlo.
        $this->como('ana.torres@donguando.pe')->getJson('/api/v1/me')->assertOk();
        $r = $this->buscar('ana.torres@donguando.pe', 'rosa');
        $this->assertNotContains('call', array_column($r['resultados'], 'tipo'));
    }

    public function test_publicar_y_quitar_una_entrada(): void
    {
        $this->como('rquispe@donguando.pe')->getJson('/api/v1/me')->assertOk();
        $id = '11111111-1111-4111-8111-111111111111';
        Busqueda::publicar('CRM', 'conversation', $id, 'Conversación con Zoila Quintanilla', 'WhatsApp · Don Guando', '/m/crm/crm-01', keywords: 'zoila');

        $r = $this->buscar('rquispe@donguando.pe', 'zoila');
        $this->assertSame('Conversación con Zoila Quintanilla', collect($r['resultados'])->firstWhere('id', $id)['titulo'] ?? null);

        Busqueda::quitar('CRM', 'conversation', $id);
        $this->assertNull(collect($this->buscar('rquispe@donguando.pe', 'zoila')['resultados'])->firstWhere('id', $id));
    }
}
