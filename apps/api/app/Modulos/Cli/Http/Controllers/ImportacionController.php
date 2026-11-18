<?php

namespace App\Modulos\Cli\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Cli\Services\Duplicados;
use App\Modulos\Cli\Services\Importacion;
use App\Support\Importar;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/** CLI-12 Importar clientes: revisar antes de importar y confirmar fila por fila. Reglas en Services\Importacion. */
class ImportacionController extends Controller
{
    /** Plantilla Excel con instrucciones y ejemplos. */
    public function plantilla()
    {
        return Importar::plantilla('plantilla-clientes', 'Importar clientes', Importacion::COLUMNAS, [
            ['María Quispe Rojas', '+51987654321', 'mquispe@correo.pe', '45879632', 'San Juan de Lurigancho'],
            ['Restaurante El Buen Sabor SAC', '987 111 222', '', '20601234567', 'Miraflores'],
        ], [
            'Llena una fila por cliente desde la fila de abajo de los títulos. Puedes borrar los dos ejemplos.',
            'Nombre y celular son obligatorios; el celular con o sin +51, espacios o guiones. Correo, documento y distrito son opcionales.',
            'Las direcciones no se importan: se piden al cliente con el enlace de ubicación. Hasta '.Importacion::MAX_FILAS.' filas.',
        ]);
    }

    /** Convierte el Excel o CSV subido al texto que se revisa e importa. */
    public function leerArchivo(Request $request)
    {
        $request->validate(['archivo' => Importar::REGLAS_ARCHIVO]);

        return response()->json(['texto' => Importar::aTexto($request->file('archivo'), Importacion::COLUMNAS, Importacion::MAX_FILAS)]);
    }

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
