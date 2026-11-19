<?php

namespace App\Modulos\Onb\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Onb\Services\Registro;
use App\Modulos\Ops\Services\Empresas;
use App\Modulos\Plt\Http\Controllers\EmpresaController as EmpresaPlt;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/** ONB-01 Registro desde la página pública y ONB-16 Registros y altas (consola), con los pedidos de demo. */
class RegistroController extends Controller
{
    /* ------------------------------------------------------------------ página pública */

    public function registrar(Request $request)
    {
        // «sitio_web» es una trampa para robots: si viene llena se responde igual y no se guarda nada.
        if (filled($request->input('sitio_web'))) {
            return response()->json(['email' => mb_strtolower((string) $request->input('email')), 'message' => 'Te enviamos un código a tu correo.'], 201);
        }
        $d = $request->validate([
            'ruc' => ['required', 'string', 'size:11'],
            'legal_name' => ['required', 'string', 'min:3', 'max:200'],
            'trade_name' => ['required', 'string', 'min:2', 'max:80'],
            'business_type' => ['required', Rule::in(array_keys(Empresas::RUBROS))],
            'tax_regime' => ['required', Rule::in(EmpresaPlt::REGIMENES)],
            'fiscal_address' => ['required', 'string', 'min:5', 'max:250'],
            'plan_code' => ['required', 'string', 'max:20'],
            'contact_name' => ['required', 'string', 'min:3', 'max:120'],
            'email' => ['required', 'email:rfc', 'max:120'],
            'phone' => ['required', 'string', 'regex:/^\+?\d{9,15}$/'],
            'password' => ['required', 'string', 'max:200', 'confirmed'],
            'source' => ['nullable', 'string', 'max:200'],
            'terms' => ['accepted'],
        ], [
            'terms.accepted' => 'Acepta los términos y la política de privacidad para crear tu cuenta.',
            'phone.regex' => 'Escribe tu celular con 9 dígitos (solo números).',
        ], [
            'legal_name' => 'razón social', 'trade_name' => 'nombre comercial', 'business_type' => 'rubro', 'tax_regime' => 'régimen tributario',
            'fiscal_address' => 'domicilio fiscal', 'plan_code' => 'plan', 'contact_name' => 'tu nombre', 'email' => 'correo', 'phone' => 'celular',
        ]);
        $r = Registro::registrar($d, $request->ip(), $request->userAgent());

        return response()->json($r + ['message' => 'Te enviamos un código a tu correo.'], 201);
    }

    public function verificar(Request $request)
    {
        $d = $request->validate(['email' => ['required', 'email', 'max:120'], 'codigo' => ['required', 'string', 'max:10']], [], ['codigo' => 'código']);

        return response()->json(Registro::verificar($d['email'], $d['codigo']));
    }

    /* ------------------------------------------------------------------ consola */

    public function lista()
    {
        return response()->json(['data' => Registro::lista()]);
    }

    public function rechazar(Request $request, string $id)
    {
        $d = $request->validate(['reason' => ['required', 'string', 'min:5', 'max:300']], [], ['reason' => 'motivo']);
        Registro::rechazar($id, trim($d['reason']), $request->attributes->get('consola_usuario'));

        return response()->noContent();
    }

    public function demos()
    {
        return response()->json(['data' => Registro::pedidosDemo()]);
    }

    public function atenderDemo(Request $request, string $id)
    {
        $d = $request->validate(['attended' => ['required', 'boolean'], 'note' => ['nullable', 'string', 'max:300']], [], ['note' => 'nota']);
        Registro::atenderDemo($id, (bool) $d['attended'], $d['note'] ?? null, $request->attributes->get('consola_usuario'));

        return response()->noContent();
    }
}
