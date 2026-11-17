<?php

namespace App\Modulos\Cli\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Cli\Services\Duplicados;
use App\Modulos\Cli\Services\Importacion;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/** CLI-12 Importar clientes: revisar antes de importar y confirmar fila por fila. Reglas en Services\Importacion. */
class ImportacionController extends Controller
{
    public function revisar(Request $request)
    {
        $d = $request->validate(['texto' => ['required', 'string', 'max:500000']]);
        $filas = collect(Importacion::revisar($d['texto']))->map(fn ($f) => $f + ['motivo_texto' => $f['motivo'] ? Duplicados::MOTIVOS[$f['motivo']] : null]);

        return response()->json([
            'filas' => $filas->values(),
            'resumen' => [
                'filas' => $filas->count(),
                'nuevas' => $filas->filter(fn ($f) => ! $f['error'] && ! $f['existe'] && ! $f['repetida_en'])->count(),
                'duplicadas' => $filas->filter(fn ($f) => $f['existe'] || $f['repetida_en'])->count(),
                'con_error' => $filas->filter(fn ($f) => $f['error'])->count(),
                'maximo' => Importacion::MAX_FILAS,
            ],
        ]);
    }

    public function importar(Request $request)
    {
        $d = $request->validate([
            'texto' => ['required', 'string', 'max:500000'], 'origen' => ['required', Rule::in(Importacion::ORIGENES)],
            'acciones' => ['array'], 'acciones.*' => [Rule::in(['CREATE', 'SKIP'])],
        ]);

        return response()->json(Importacion::importar($d['texto'], $d['acciones'] ?? [], $d['origen'], $request->user()), 201);
    }
}
