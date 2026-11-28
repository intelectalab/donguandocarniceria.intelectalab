<?php

namespace App\Modulos\Per\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Per\Services\Base;
use App\Modulos\Per\Services\Personal;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/** PER-01 Puestos, PER-02 Ficha del trabajador y PER-03 Condiciones de pago. */
class PersonalController extends Controller
{
    public function opciones(Request $request)
    {
        return response()->json(Personal::opciones($request->user()));
    }

    public function puestos()
    {
        return response()->json(['data' => Personal::puestos()]);
    }

    public function guardarPuesto(Request $request, ?string $id = null)
    {
        $request->validate([
            'code' => ['required', 'string', 'max:20'], 'name' => ['required', 'string', 'max:120'], 'area' => ['required', Rule::in(array_keys(Base::AREAS))],
            'establishment_id' => ['nullable', 'uuid'], 'functions' => ['nullable', 'array', 'max:20'], 'functions.*' => ['nullable', 'string', 'max:200'],
            'default_role' => ['nullable', 'string', 'max:40'], 'pay_scheme' => ['nullable', Rule::in(array_keys(Base::FORMAS))], 'status' => ['nullable', Rule::in(['ACTIVE', 'INACTIVE'])],
        ]);

        return response()->json(Personal::guardarPuesto($id, $request->all(), $request->user()), $id ? 200 : 201);
    }

    public function trabajadores(Request $request)
    {
        return response()->json(Personal::lista($request->user()));
    }

    public function ficha(Request $request, string $id)
    {
        return response()->json(Personal::ficha($id, $request->user()));
    }

    public function asignar(Request $request, string $id)
    {
        $request->validate([
            'valid_from' => ['required', 'date_format:Y-m-d'], 'filas' => ['required', 'array', 'min:1', 'max:10'],
            'filas.*.position_id' => ['required', 'uuid'], 'filas.*.establishment_id' => ['required', 'uuid'], 'filas.*.cost_center_id' => ['required', 'uuid'],
            'filas.*.supervisor_employee_id' => ['nullable', 'uuid'], 'filas.*.allocation_pct' => ['required', 'numeric'], 'filas.*.is_primary' => ['nullable', 'boolean'],
        ]);

        return response()->json(Personal::asignar($id, $request->input('filas'), $request->input('valid_from'), $request->user()));
    }

    public function condiciones(Request $request)
    {
        return response()->json(Personal::condiciones($request->user()));
    }

    public function guardarCondicion(Request $request)
    {
        $request->validate([
            'employee_id' => ['required', 'uuid'], 'pay_scheme' => ['required', Rule::in(array_keys(Base::FORMAS))], 'monthly_amount' => ['nullable', 'numeric'],
            'daily_rate' => ['nullable', 'numeric'], 'hourly_rate' => ['nullable', 'numeric'], 'payroll_source' => ['nullable', Rule::in(array_keys(Base::FUENTES))],
            'external_ref' => ['nullable', 'string', 'max:40'], 'valid_from' => ['required', 'date_format:Y-m-d'], 'valid_to' => ['nullable', 'date_format:Y-m-d'],
            'close_previous' => ['nullable', 'boolean'],
        ]);

        return response()->json(Personal::guardarCondicion($request->all(), $request->user()), 201);
    }
}
