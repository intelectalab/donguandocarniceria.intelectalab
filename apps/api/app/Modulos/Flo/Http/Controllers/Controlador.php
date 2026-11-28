<?php

namespace App\Modulos\Flo\Http\Controllers;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;

/** Base de los controladores de FLO: archivos (multipart o base64 «<campo>_data») y filtros comunes. */
abstract class Controlador extends Controller
{
    protected function archivo(Request $request, string $campo = 'foto'): UploadedFile|string|null
    {
        $request->validate([$campo => ['nullable', 'file', 'max:20480'], $campo.'_data' => ['nullable', 'string', 'max:15000000']]);
        $f = $request->file($campo);
        if ($f instanceof UploadedFile) {
            return $f;
        }
        $d = $request->input($campo.'_data');

        return is_string($d) && $d !== '' ? $d : null;
    }

    /** Campos del formulario sin los archivos, con textos recortados. */
    protected function datos(Request $request, array $campos): array
    {
        return array_map(fn ($v) => is_string($v) ? trim($v) : $v, $request->only($campos));
    }

    /** Filtros de fecha y uuid validados. */
    protected function filtros(Request $request, array $extra = []): array
    {
        return $request->validate($extra + [
            'desde' => ['nullable', 'date_format:Y-m-d'], 'hasta' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:desde'], 'vehiculo' => ['nullable', 'uuid'],
        ]);
    }
}
