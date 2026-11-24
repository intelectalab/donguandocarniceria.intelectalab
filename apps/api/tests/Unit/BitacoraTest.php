<?php

namespace Tests\Unit;

use App\Modulos\Ops\Services\Plataforma;
use Illuminate\Foundation\Testing\TestCase;
use RecursiveDirectoryIterator;
use RecursiveIteratorIterator;

/** La bitácora de la consola no muestra códigos internos: toda acción que se registra tiene su nombre en español. */
class BitacoraTest extends TestCase
{
    public function test_toda_accion_registrada_tiene_nombre_en_espanol(): void
    {
        $acciones = [];
        foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator(app_path())) as $archivo) {
            if ($archivo->getExtension() === 'php' && preg_match_all("/bitacora\\('([A-Z_]+)'[,)]/", file_get_contents($archivo->getPathname()), $m)) {
                $acciones = [...$acciones, ...$m[1]];
            }
        }
        $sinNombre = array_values(array_diff(array_unique($acciones), array_keys(Plataforma::ACCIONES)));

        $this->assertNotEmpty($acciones);
        $this->assertSame([], $sinNombre, 'Agrega estas acciones a Plataforma::ACCIONES con su nombre en español');
    }
}
