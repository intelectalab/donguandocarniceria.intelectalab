<?php

namespace App\Modulos\Ops\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Ops\Services\Empresas;
use App\Modulos\Ops\Services\SaludEmpresas;
use App\Modulos\Plt\Http\Controllers\EmpresaController as EmpresaPlt;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/** OPS-02 Empresas, OPS-03 Ficha de la empresa y el alta de una empresa desde la consola. */
class EmpresaController extends Controller
{
    public function index()
    {
        return response()->json(['data' => Empresas::lista(), 'salud_cortes' => SaludEmpresas::cortes()]);
    }

    /** «Recalcular salud»: guarda la foto del día de todas las empresas. */
    public function recalcularSalud(Request $request)
    {
        return response()->json(['empresas' => SaludEmpresas::guardarFotos($request->attributes->get('consola_usuario'))]);
    }

    public function show(string $id)
    {
        return response()->json(Empresas::ficha($id));
    }

    public function opciones()
    {
        return response()->json(Empresas::opcionesAlta());
    }

    public function store(Request $request)
    {
        $d = $request->validate([
            'ruc' => ['required', 'string', 'size:11'],
            'legal_name' => ['required', 'string', 'min:3', 'max:200'],
            'trade_name' => ['required', 'string', 'min:2', 'max:80'],
            'tax_regime' => ['required', Rule::in(EmpresaPlt::REGIMENES)],
            'fiscal_address' => ['required', 'string', 'min:5', 'max:250'],
            'business_type' => ['required', Rule::in(array_keys(Empresas::RUBROS))],
            'plan_code' => ['required', 'string', 'max:20'],
            'trial_days' => ['nullable', 'integer', 'min:1', 'max:60'],
            'admin_name' => ['required', 'string', 'min:3', 'max:120'],
            'admin_email' => ['required', 'email', 'max:80'],
            'admin_phone' => ['nullable', 'string', 'regex:/^\+?\d{9,15}$/'],
            'hostname' => ['nullable', 'string', 'max:120', 'regex:/^(?=.{3,120}$)([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i'],
        ], [], [
            'legal_name' => 'razón social', 'trade_name' => 'nombre comercial', 'tax_regime' => 'régimen tributario', 'fiscal_address' => 'domicilio fiscal',
            'business_type' => 'rubro', 'plan_code' => 'plan', 'trial_days' => 'días de prueba', 'admin_name' => 'nombre del administrador',
            'admin_email' => 'correo del administrador', 'admin_phone' => 'celular del administrador', 'hostname' => 'dominio',
        ]);

        return response()->json(Empresas::alta($d, $request->attributes->get('consola_usuario')), 201);
    }
}
