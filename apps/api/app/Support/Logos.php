<?php

namespace App\Support;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\Response;

/**
 * Logos de la empresa y de las marcas, en el disco privado `local`, en la carpeta del cliente:
 *   empresas/{tenant}/{carpeta}/{nombre}.{png|jpg|webp}
 * Solo PNG, JPG o WEBP de hasta 1 MB (sin SVG: podría llevar código). La columna logo_url guarda
 * solo el nombre del archivo; la imagen se sirve con sesión (o, la de la empresa en el ingreso,
 * con el cliente resuelto por el dominio).
 */
final class Logos
{
    public const REGLAS = ['required', 'file', 'max:1024', 'mimes:png,jpg,jpeg,webp'];

    public const MENSAJES = [
        'logo.required' => 'Elige la imagen del logo.',
        'logo.max' => 'El logo no puede pesar más de 1 MB.',
        'logo.mimes' => 'El logo debe ser una imagen PNG, JPG o WEBP.',
    ];

    /** Valida y guarda el archivo; borra el anterior si cambia la extensión. Devuelve el nombre guardado. */
    public static function guardar(Request $request, string $carpeta, string $base, ?string $anterior): string
    {
        $request->validate(['logo' => self::REGLAS], self::MENSAJES);
        $archivo = $request->file('logo');
        $extension = $archivo->extension() === 'jpeg' ? 'jpg' : $archivo->extension();
        $nombre = $base.'.'.$extension;

        if ($anterior && $anterior !== $nombre) {
            self::borrar($carpeta, $anterior);
        }
        Storage::disk('local')->putFileAs(dirname(self::ruta($carpeta, $nombre)), $archivo, $nombre);

        return $nombre;
    }

    public static function borrar(string $carpeta, ?string $nombre): void
    {
        if ($nombre) {
            Storage::disk('local')->delete(self::ruta($carpeta, $nombre));
        }
    }

    /** Respuesta con la imagen, o 404 si no existe. */
    public static function servir(string $carpeta, ?string $nombre, string $cache = 'private, no-cache'): Response
    {
        $ruta = $nombre ? self::ruta($carpeta, $nombre) : null;
        abort_unless($ruta && Storage::disk('local')->exists($ruta), 404, 'No hay logo.');

        return Storage::disk('local')->response($ruta, null, ['Cache-Control' => $cache, 'X-Content-Type-Options' => 'nosniff']);
    }

    private static function ruta(string $carpeta, string $nombre): string
    {
        $tenant = TenantContext::id() ?? abort(404);

        return "empresas/{$tenant}/{$carpeta}/".basename($nombre);
    }
}
