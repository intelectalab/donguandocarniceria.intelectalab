<?php

namespace Tests\Feature\Modulos;

use Tests\TestCase;

/** SEG-13 Dispositivos de la app: lista de celulares, cifras y quién la ve (RN-SEG-11). */
class SegDispositivosTest extends TestCase
{
    private function como(string $email): static
    {
        return $this->desde(self::DG, $this->ingresar(self::DG, $email));
    }

    public function test_lista_de_celulares_con_cifras_y_filtros(): void
    {
        $api = $this->como('lccahuana@donguando.pe');
        $r = $api->getJson('/api/v1/seg/dispositivos?per_page=100')->assertOk();
        $this->assertNotContains('WEB', array_column($r->json('data'), 'platform'), 'Como el prototipo: solo celulares');
        $this->assertSame($r->json('resumen.pendientes') + $r->json('resumen.aprobados') + $r->json('resumen.revocados'), $r->json('total'));
        $this->assertTrue($r->json('resumen.aprobacion_exigida'));

        $pendientes = $api->getJson('/api/v1/seg/dispositivos?status=PENDING')->assertOk()->json('data');
        $this->assertNotEmpty($pendientes);
        $this->assertSame(['PENDING'], array_values(array_unique(array_column($pendientes, 'status'))));
        $this->assertNotEmpty($pendientes[0]['user_name']);
    }

    public function test_el_coordinador_de_delivery_la_ve_sin_el_modulo_de_seguridad_y_el_cajero_no(): void
    {
        $this->como('rchavez@donguando.pe')->getJson('/api/v1/seg/dispositivos')->assertOk();
        $this->como('rchavez@donguando.pe')->getJson('/api/v1/seg/usuarios')->assertForbidden();
        $this->como('jsalas@donguando.pe')->getJson('/api/v1/seg/dispositivos')->assertForbidden();
    }
}
