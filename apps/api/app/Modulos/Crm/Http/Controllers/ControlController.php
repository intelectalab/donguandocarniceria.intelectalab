<?php

namespace App\Modulos\Crm\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Crm\Services\Control;
use App\Modulos\Crm\Services\Muestreo;
use App\Support\Access;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/** CRM-12 Alertas de control, CRM-13 Reglas e identificadores oficiales y CRM-14 Revisión por muestreo. */
class ControlController extends Controller
{
    public function alertas(Request $request)
    {
        $f = $request->validate([
            'estado' => ['nullable', Rule::in(array_merge(array_keys(Control::ESTADOS), ['ACTIVAS', 'ALL']))], 'gravedad' => ['nullable', Rule::in(array_keys(Control::GRAVEDADES))],
            'fuente' => ['nullable', Rule::in(array_keys(Control::FUENTES))], 'vendedora' => ['nullable', 'uuid'], 'regla' => ['nullable', 'uuid'], 'marca' => ['nullable', 'uuid'],
            'conversacion' => ['nullable', 'uuid'], 'desde' => ['nullable', 'date_format:Y-m-d'], 'hasta' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:desde'],
            'buscar' => ['nullable', 'string', 'max:100'],
        ]);

        return response()->json(Control::alertas($f, $request->user()));
    }

    public function alerta(Request $request, string $id)
    {
        return response()->json(Control::alerta($id, $request->user()));
    }

    public function revisarAlerta(Request $request, string $id)
    {
        $d = $request->validate(['estado' => ['required', Rule::in(['UNDER_REVIEW', 'CONFIRMED', 'DISMISSED'])], 'nota' => ['nullable', 'string', 'max:2000']], [], ['nota' => 'nota']);

        return response()->json(Control::revisarAlerta($id, $d['estado'], $d['nota'] ?? null, $request->user()));
    }

    public function reglas(Request $request)
    {
        $f = $request->validate(['tipo' => ['nullable', Rule::in(array_keys(Control::TIPOS))], 'gravedad' => ['nullable', Rule::in(array_keys(Control::GRAVEDADES))],
            'activa' => ['nullable', Rule::in(['0', '1'])], 'buscar' => ['nullable', 'string', 'max:100']]);

        return response()->json(Control::reglas($f) + ['puede' => Access::can($request->user(), 'crm.alert_rule.manage')]);
    }

    public function guardarRegla(Request $request, ?string $id = null)
    {
        $d = $request->validate([
            'code' => [$id ? 'sometimes' : 'required', 'string', 'max:20'], 'name' => [$id ? 'sometimes' : 'required', 'string', 'min:3', 'max:120'],
            'rule_type' => [$id ? 'sometimes' : 'required', Rule::in(array_keys(Control::TIPOS))], 'pattern' => [$id ? 'sometimes' : 'required', 'string', 'min:2', 'max:255'],
            'severity' => [$id ? 'sometimes' : 'required', Rule::in(array_keys(Control::GRAVEDADES))], 'active' => ['sometimes', 'boolean'],
        ], [], ['code' => 'código', 'name' => 'nombre', 'rule_type' => 'tipo', 'pattern' => 'frase o término', 'severity' => 'gravedad']);

        return response()->json(Control::guardarRegla($id, $d, $request->user()), $id ? 200 : 201);
    }

    public function identificadores(Request $request)
    {
        $f = $request->validate(['tipo' => ['nullable', Rule::in(array_keys(Control::IDENTIFICADORES))], 'estado' => ['nullable', Rule::in(['ACTIVE', 'INACTIVE'])],
            'marca' => ['nullable', 'uuid'], 'buscar' => ['nullable', 'string', 'max:100']]);

        return response()->json(Control::identificadores($f, $request->user()) + ['puede' => Access::can($request->user(), 'crm.alert_rule.manage')]);
    }

    public function guardarIdentificador(Request $request, ?string $id = null)
    {
        $d = $request->validate([
            'identifier_type' => ['required', Rule::in(array_keys(Control::IDENTIFICADORES))], 'value' => ['required', 'string', 'max:120'], 'label' => ['required', 'string', 'min:3', 'max:120'],
            'brand_id' => ['nullable', 'uuid'], 'status' => ['required', Rule::in(['ACTIVE', 'INACTIVE'])],
        ], [], ['identifier_type' => 'tipo', 'value' => 'valor', 'label' => 'descripción', 'brand_id' => 'marca', 'status' => 'estado']);

        return response()->json(Control::guardarIdentificador($id, $d, $request->user()), $id ? 200 : 201);
    }

    public function probar(Request $request)
    {
        $d = $request->validate(['texto' => ['required', 'string', 'max:4096']], [], ['texto' => 'texto']);

        return response()->json(['data' => Control::probar($d['texto'])]);
    }

    public function muestreo(Request $request)
    {
        $f = $request->validate(['semana' => ['nullable', 'date_format:Y-m-d'], 'vendedora' => ['nullable', 'uuid'], 'resultado' => ['nullable', Rule::in(array_merge(array_keys(Muestreo::RESULTADOS), ['PENDING']))],
            'buscar' => ['nullable', 'string', 'max:100']]);

        return response()->json(Muestreo::semana($f, $request->user()));
    }

    public function revisarMuestra(Request $request, string $id)
    {
        $d = $request->validate(['semana' => ['required', 'date_format:Y-m-d'], 'resultado' => ['required', Rule::in(array_keys(Muestreo::RESULTADOS))], 'nota' => ['nullable', 'string', 'max:2000']],
            [], ['semana' => 'semana', 'resultado' => 'resultado', 'nota' => 'nota']);

        return response()->json(Muestreo::registrar($id, $d['semana'], $d['resultado'], $d['nota'] ?? null, $request->user()), 201);
    }
}
