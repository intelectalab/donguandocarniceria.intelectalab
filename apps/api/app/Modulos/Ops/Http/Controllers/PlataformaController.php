<?php

namespace App\Modulos\Ops\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Mae\Services\CatalogosGlobales;
use App\Modulos\Ops\Services\Plataforma;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/** OPS-13 Bitácora de la consola, OPS-16 Parámetros de plataforma e importación de catálogos globales. */
class PlataformaController extends Controller
{
    public function bitacora(Request $request)
    {
        $f = $request->validate([
            'action' => ['nullable', 'string', 'max:40'], 'user' => ['nullable', 'uuid'], 'tenant' => ['nullable', 'uuid'],
            'desde' => ['nullable', 'date_format:Y-m-d'], 'hasta' => ['nullable', 'date_format:Y-m-d'], 'search' => ['nullable', 'string', 'max:80'],
            'page' => ['nullable', 'integer', 'min:1'], 'per_page' => ['nullable', 'integer', 'min:10', 'max:100'],
        ]);

        return response()->json(Plataforma::bitacora($f));
    }

    public function parametros()
    {
        return response()->json(['data' => Plataforma::parametros(), 'historial' => Plataforma::historialParametros()]);
    }

    public function cambiarParametro(Request $request, string $key)
    {
        $d = $request->validate(['value' => ['present'], 'reason' => ['required', 'string', 'min:5', 'max:300']], [], ['value' => 'valor', 'reason' => 'motivo']);

        return response()->json(Plataforma::cambiarParametro($key, $d['value'], trim($d['reason']), $request->attributes->get('consola_usuario')));
    }

    public function revisarCatalogo(Request $request)
    {
        $d = $this->archivo($request);

        return response()->json(Plataforma::revisarCatalogo($d['tabla'], $request->file('archivo'), $request->attributes->get('consola_usuario')));
    }

    public function importarCatalogo(Request $request)
    {
        $d = $this->archivo($request, true);

        return response()->json(Plataforma::importarCatalogo($d['tabla'], $request->file('archivo'), trim($d['reason']), $request->attributes->get('consola_usuario')));
    }

    private function archivo(Request $request, bool $conMotivo = false): array
    {
        return $request->validate([
            'tabla' => ['required', Rule::in(array_keys(CatalogosGlobales::TABLAS))],
            'archivo' => ['required', 'file', 'max:'.intdiv(CatalogosGlobales::MAX_BYTES, 1000), 'mimes:txt,csv'],
            'reason' => $conMotivo ? ['required', 'string', 'min:5', 'max:300'] : ['nullable'],
        ], [], ['tabla' => 'catálogo', 'reason' => 'motivo']);
    }
}
