<?php

namespace Tests\Feature\Modulos;

use Illuminate\Support\Carbon;
use Tests\TestCase;

/** CLI-12 Importar clientes: revisar antes de confirmar, celulares a E.164 y duplicados. */
class CliImportacionTest extends TestCase
{
    private ?string $token = null;

    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo(Carbon::parse('2026-11-07 10:00', 'America/Lima'));
    }

    private function gerente(): static
    {
        return $this->desde(self::DG, $this->token ??= $this->ingresar(self::DG, 'rquispe@donguando.pe'));
    }

    public function test_modelo_en_excel_y_lectura_del_archivo(): void
    {
        $r = $this->gerente()->get('/api/v1/cli/importar/plantilla')->assertOk();
        $this->assertStringContainsString('plantilla-clientes.xlsx', (string) $r->headers->get('Content-Disposition'));

        $libro = new \PhpOffice\PhpSpreadsheet\Spreadsheet;
        $libro->getActiveSheet()->fromArray([
            ['# Importar clientes'],
            ['Celular', 'Nombre', 'Distrito', 'Documento (DNI o RUC)'],
            ['987 111 222', 'Gloria Vásquez Ríos', 'Miraflores', '45879632'],
        ]);
        $ruta = tempnam(sys_get_temp_dir(), 'cl').'.xlsx';
        (new \PhpOffice\PhpSpreadsheet\Writer\Xlsx($libro))->save($ruta);
        $texto = $this->gerente()->post('/api/v1/cli/importar/archivo', ['archivo' => new \Illuminate\Http\UploadedFile($ruta, 'clientes.xlsx', null, null, true)])
            ->assertOk()->json('texto');
        $this->assertSame("nombre;celular;correo;documento;distrito\nGloria Vásquez Ríos;987 111 222;;45879632;Miraflores", $texto);
        $this->gerente()->postJson('/api/v1/cli/importar/revisar', ['texto' => $texto])->assertOk()->assertJsonPath('resumen.nuevas', 1);
    }

    public function test_revisa_e_importa(): void
    {
        $texto = implode("\n", [
            'nombre;celular;correo;documento;distrito',
            'Gloria Vásquez Ríos;987 111 222;gloria.vr@correo.pe;;Miraflores',
            'Rubén Tello Ugaz;(01) 998877665;;45879632;Santiago de Surco',
            'El Cuy Dorado;998800000;;;San Borja',
            'Sin Nombre Válido;12345;;;Barranco',
            'Inés Carhuas Poma;+51 965 432 100;ines.cp@correo.pe;;La Molina',
            'Inés Carhuas Poma;965432100;;;La Molina',
        ]);
        $r = $this->gerente()->postJson('/api/v1/cli/importar/revisar', ['texto' => $texto])->assertOk();
        $this->assertSame(['filas' => 6, 'nuevas' => 3, 'duplicadas' => 2, 'con_error' => 1, 'maximo' => 2000], $r->json('resumen'));
        $filas = collect($r->json('filas'))->keyBy('fila');
        $this->assertSame('+51998877665', $filas[3]['phone']);
        $this->assertSame('Mismo celular', $filas[4]['motivo_texto']);
        $this->assertSame(6, $filas[7]['repetida_en']);

        $res = $this->gerente()->postJson('/api/v1/cli/importar', ['texto' => $texto, 'origen' => 'WHATSAPP', 'acciones' => [4 => 'CREATE']])->assertCreated();
        $this->assertSame(['creados' => 4, 'omitidos' => 2, 'marcados' => 1], $res->json());
        $this->assertSame('Gloria Vásquez Ríos', $this->gerente()->getJson('/api/v1/cli/clientes?q=987111222')->json('data.0.full_name'));
    }
}
