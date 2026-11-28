<?php

namespace App\Modulos\Del\Http\Controllers;

use App\Modulos\Del\Services\Base;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;

/** Lectura de fotos de la app: archivo (multipart) o imagen en base64 («<campo>_data») de la cola sin conexión. */
trait Entrada
{
    protected function imagen(Request $request, string $campo): UploadedFile|string|null
    {
        $f = $request->file($campo);
        if ($f instanceof UploadedFile) {
            return $f;
        }
        $d = $request->input($campo.'_data');

        return is_string($d) && $d !== '' ? $d : null;
    }

    /** Fecha del filtro: la pedida o la de hoy en Lima. */
    protected function fecha(Request $request, string $campo = 'fecha'): string
    {
        $d = $request->validate([$campo => ['nullable', 'date_format:Y-m-d']]);

        return $d[$campo] ?? Base::hoy();
    }
}
