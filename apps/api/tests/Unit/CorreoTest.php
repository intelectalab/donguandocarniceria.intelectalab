<?php

namespace Tests\Unit;

use App\Support\Correo;
use Illuminate\Foundation\Testing\TestCase;

/** Diseño de los correos: no usa la base, así que extiende el TestCase de Laravel y no el del proyecto. */
class CorreoTest extends TestCase
{
    public function test_el_correo_lleva_html_y_texto_con_el_codigo_el_enlace_completo_y_los_datos_escapados(): void
    {
        config(['mail.default' => 'array', 'app.url' => 'https://gestioncarnica.ejemplo.pe/']);

        Correo::enviar('rosa@ejemplo.pe', 'Invitación a GestionCarnica', [
            'titulo' => 'Te invitaron a GestionCarnica',
            'saludo' => 'Hola <b>Rosa</b> & Cía:',
            'parrafos' => ['Para entrar, primero crea tu contraseña con este código:'],
            'codigo' => 'AB12CD',
            'vence' => 'Vence en 48 horas.',
            'pasos' => ['Entra a «Olvidé mi contraseña».', 'Crea tu contraseña.'],
            'boton' => ['texto' => 'Crear mi contraseña', 'ruta' => '/forgot-password'],
            'nota' => 'Si no esperabas esta invitación, ignora este correo.',
        ]);

        $enviados = app('mailer')->getSymfonyTransport()->messages();
        $this->assertCount(1, $enviados);
        $correo = $enviados[0]->getOriginalMessage();
        $this->assertSame('Invitación a GestionCarnica', $correo->getSubject());
        $this->assertSame('rosa@ejemplo.pe', $correo->getTo()[0]->getAddress());

        $html = $correo->getHtmlBody();
        $this->assertStringContainsString('AB12CD', $html);
        $this->assertStringContainsString('href="https://gestioncarnica.ejemplo.pe/forgot-password"', $html, 'El enlace va completo, con APP_URL');
        $this->assertStringContainsString('Hola &lt;b&gt;Rosa&lt;/b&gt; &amp; Cía:', $html, 'Los datos del usuario no se toman como HTML');
        $this->assertDoesNotMatchRegularExpression('/href="[^"]*AB12CD/', $html, 'El código no va en ningún enlace');

        $texto = $correo->getTextBody();
        $this->assertStringContainsString('Tu código: AB12CD', $texto);
        $this->assertStringContainsString('Hola <b>Rosa</b> & Cía:', $texto, 'El texto plano no lleva entidades HTML');
        $this->assertStringContainsString('1. Entra a «Olvidé mi contraseña».', $texto);
        $this->assertStringContainsString('Crear mi contraseña: https://gestioncarnica.ejemplo.pe/forgot-password', $texto);
    }
}
