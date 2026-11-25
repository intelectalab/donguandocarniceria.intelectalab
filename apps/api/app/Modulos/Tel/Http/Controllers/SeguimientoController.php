<?php

namespace App\Modulos\Tel\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Tel\Services\Llamadas;
use App\Modulos\Tel\Services\Seguimiento;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/** TEL-08 Historial de llamadas, TEL-09 Llamadas perdidas y TEL-11 Panel de supervisión. */
class SeguimientoController extends Controller
{
    public function historial(Request $request)
    {
        $f = $request->validate([
            'direccion' => ['nullable', Rule::in(['INBOUND', 'OUTBOUND'])], 'estado' => ['nullable', Rule::in(array_keys(Llamadas::ESTADOS))], 'vendedora' => ['nullable', 'uuid'],
            'marca' => ['nullable', 'uuid'], 'grabacion' => ['nullable', Rule::in(['0', '1'])], 'pedido' => ['nullable', Rule::in(['0', '1'])],
            'desde' => ['nullable', 'date_format:Y-m-d'], 'hasta' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:desde'], 'buscar' => ['nullable', 'string', 'max:100'],
        ]);

        return response()->json(Seguimiento::historial($f, $request->user()));
    }

    public function perdidas(Request $request)
    {
        $f = $request->validate(['estado' => ['nullable', Rule::in(['OPEN', 'DONE', 'VENCIDA'])], 'marca' => ['nullable', 'uuid'],
            'responsable' => ['nullable', 'string', 'regex:/^(none|[0-9a-f-]{36})$/'], 'buscar' => ['nullable', 'string', 'max:100']]);

        return response()->json(Seguimiento::perdidas($f, $request->user()));
    }

    public function panel(Request $request)
    {
        $f = $request->validate(['dia' => ['nullable', 'date_format:Y-m-d', 'before_or_equal:today'], 'mes' => ['nullable', 'date_format:Y-m'], 'buscar' => ['nullable', 'string', 'max:100']]);

        return response()->json(Seguimiento::panel($f, $request->user()));
    }
}
