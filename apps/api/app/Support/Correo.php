<?php

namespace App\Support;

use Illuminate\Support\Facades\Mail;

/**
 * Correos del sistema con el diseño de GestionCarnica: versión HTML (tablas y estilos en línea, para que se vea bien
 * en Gmail, Outlook y el celular) y versión de texto para los lectores que no muestran HTML.
 *
 * Contenido ($c):
 *   titulo    string    encabezado grande
 *   saludo    string    «Hola Rosa:»
 *   parrafos  string[]  texto antes del código
 *   codigo    ?string   código a copiar, en grande
 *   vence     ?string   «Vence en 48 horas.» bajo el código
 *   pasos     string[]  pasos numerados
 *   boton     ?array    ['texto' => 'Activar mi cuenta', 'ruta' => '/consola/activar'] (la ruta se une a APP_URL)
 *   nota      ?string   aviso final en gris («Si no esperabas este correo, ignóralo.»)
 *
 * Todo se escapa al mostrarse: los datos del usuario (nombres, empresas) nunca se toman como HTML. El código y el
 * correo no van en el enlace, para que no queden guardados en el historial ni en registros de servidores.
 */
class Correo
{
    public static function enviar(string $para, string $asunto, array $c): void
    {
        $datos = [
            'titulo' => $c['titulo'] ?? $asunto,
            'saludo' => $c['saludo'] ?? null,
            'parrafos' => array_values($c['parrafos'] ?? []),
            'codigo' => $c['codigo'] ?? null,
            'vence' => $c['vence'] ?? null,
            'pasos' => array_values($c['pasos'] ?? []),
            'boton' => isset($c['boton']) ? ['texto' => $c['boton']['texto'], 'url' => self::url($c['boton']['ruta'])] : null,
            'nota' => $c['nota'] ?? null,
            'sitio' => self::url('/'),
        ];

        Mail::send(['html' => 'correos.base', 'text' => 'correos.base-texto'], $datos, fn ($m) => $m->to($para)->subject($asunto));
    }

    private static function url(string $ruta): string
    {
        return rtrim((string) config('app.url'), '/').'/'.ltrim($ruta, '/');
    }
}
