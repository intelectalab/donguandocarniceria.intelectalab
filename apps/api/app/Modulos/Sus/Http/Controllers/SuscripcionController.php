<?php

namespace App\Modulos\Sus\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Sus\Services\Suscripcion;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/** Mi suscripción (la empresa): SUS-01 resumen, SUS-04 uso, SUS-05 comprobantes, SUS-06 medio de pago y SUS-07 cancelar. */
class SuscripcionController extends Controller
{
    public function resumen(Request $request)
    {
        return response()->json(Suscripcion::resumen($request->user()) + ['encuesta' => Suscripcion::ENCUESTA]);
    }

    public function comprobantes()
    {
        return response()->json(['data' => Suscripcion::comprobantes()]);
    }

    public function comprobante(string $id)
    {
        return response()->json(Suscripcion::comprobante($id));
    }

    public function pagar(Request $request, string $id)
    {
        return response()->json(Suscripcion::pagar($request->user(), $id));
    }

    /** RN-SUS-20: llega el token que dio la pasarela en el navegador; el número de la tarjeta nunca. */
    public function guardarMedio(Request $request)
    {
        $d = $request->validate([
            'gateway' => ['required', Rule::in(['FAKE'])],
            'token' => ['required', 'string', 'regex:/^fake_tok_(ok|declined|insufficient)_[a-z0-9]{16}$/'],
            'brand' => ['required', Rule::in(['Visa', 'Mastercard', 'American Express', 'Diners Club'])],
            'last4' => ['required', 'regex:/^\d{4}$/'],
            'exp_month' => ['required', 'integer', 'between:1,12'],
            'exp_year' => ['required', 'integer', 'between:2024,2060'],
            'auto_pay' => ['required', 'boolean'],
            'billing_email' => ['nullable', 'email', 'max:160'],
        ], [], ['billing_email' => 'correo de facturación']);

        return response()->json(Suscripcion::guardarMedio($request->user(), $d));
    }

    public function preferencias(Request $request)
    {
        $d = $request->validate(['auto_pay' => ['required', 'boolean'], 'billing_email' => ['nullable', 'email', 'max:160']], [], ['billing_email' => 'correo de facturación']);

        return response()->json(Suscripcion::preferencias($request->user(), $d));
    }

    public function cancelar(Request $request)
    {
        $d = $request->validate([
            'reason' => ['required', 'string', 'min:5', 'max:300'],
            'survey' => ['required', Rule::in(array_keys(Suscripcion::ENCUESTA))],
            'exported' => ['accepted'],
        ], ['exported.accepted' => 'Confirma que sabes cómo exportar tus datos antes de cancelar.'], ['reason' => 'motivo', 'survey' => 'respuesta']);

        return response()->json(Suscripcion::cancelar($request->user(), $d));
    }

    public function deshacer(Request $request)
    {
        return response()->json(Suscripcion::deshacerCancelacion($request->user()));
    }
}
