<?php

namespace App\Modulos\Sus\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Sus\Services\Pagos;
use Illuminate\Http\Request;

/**
 * Aviso de la pasarela de cobro (webhook, RN-SUS-20): público pero firmado. Sin firma válida no tiene efecto (queda el
 * evento crudo para revisar en Cobros). Responde 200 a todo aviso firmado, también a uno repetido, para que la
 * pasarela no lo reintente.
 */
class PasarelaController extends Controller
{
    public function __invoke(Request $request, string $gateway)
    {
        $resultado = Pagos::recibirEvento(strtoupper($gateway), (string) $request->getContent(), $request->header('X-Firma'));

        return response()->json(['result' => $resultado], str_starts_with($resultado, 'Firma inválida') ? 401 : 200);
    }
}
