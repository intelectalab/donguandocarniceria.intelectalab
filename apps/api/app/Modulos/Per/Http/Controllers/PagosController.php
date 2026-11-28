<?php

namespace App\Modulos\Per\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Per\Services\Adelantos;
use App\Modulos\Per\Services\Base;
use App\Modulos\Per\Services\Comisiones;
use App\Modulos\Per\Services\Pagos;
use App\Modulos\Per\Services\Supervision;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/** PER-09 Adelantos, PER-10 Planes, PER-11 Comisiones y bonos, PER-12 Pagos al personal y PER-13 Supervisión. */
class PagosController extends Controller
{
    public function adelantos(Request $request)
    {
        $f = $request->validate(['estado' => ['nullable', Rule::in(Adelantos::ESTADOS)]]);

        return response()->json(Adelantos::lista($request->user(), $f['estado'] ?? null));
    }

    public function pedirAdelanto(Request $request)
    {
        $request->validate(['employee_id' => ['nullable', 'uuid'], 'amount' => ['required', 'numeric'], 'reason' => ['required', 'string', 'max:500'],
            'deduct_period' => ['nullable', 'date_format:Y-m-d']]);

        return response()->json(Adelantos::pedir($request->all(), $request->user()), 201);
    }

    public function decidirAdelanto(Request $request, string $id)
    {
        $f = $request->validate(['aprobar' => ['required', 'boolean'], 'note' => ['nullable', 'string', 'max:500']]);

        return response()->json(Adelantos::decidir($id, (bool) $f['aprobar'], $f['note'] ?? null, $request->user()));
    }

    public function pagarAdelanto(Request $request, string $id)
    {
        $request->validate(['cash_account_id' => ['required', 'uuid'], 'reference' => ['required', 'string', 'max:60']]);

        return response()->json(Adelantos::pagar($id, $request->all(), $request->user()));
    }

    public function anularAdelanto(Request $request, string $id)
    {
        return response()->json(Adelantos::anular($id, $request->user()));
    }

    public function planes()
    {
        return response()->json(['data' => Comisiones::planes()]);
    }

    public function guardarPlan(Request $request, ?string $id = null)
    {
        $request->validate([
            'code' => ['required', 'string', 'max:30'], 'name' => ['required', 'string', 'max:160'], 'plan_type' => ['required', Rule::in(['SELLER_COLLECTED', 'DRIVER_DELIVERY'])],
            'brand_id' => ['nullable', 'uuid'], 'channel' => ['nullable', 'string', 'max:30'], 'rate_pct' => ['nullable', 'numeric'], 'per_delivery_amount' => ['nullable', 'numeric'],
            'tiers' => ['nullable', 'array', 'max:10'], 'tiers.*.from' => ['required', 'numeric'], 'tiers.*.rate_pct' => ['required', 'numeric'],
            'alert_penalty_pct' => ['nullable', 'numeric'], 'valid_from' => ['required', 'date_format:Y-m-d'], 'valid_to' => ['nullable', 'date_format:Y-m-d'],
            'status' => ['nullable', Rule::in(['ACTIVE', 'INACTIVE'])],
        ]);

        return response()->json(Comisiones::guardarPlan($id, $request->all(), $request->user()), $id ? 200 : 201);
    }

    public function comisiones(Request $request)
    {
        $f = $request->validate(['mes' => ['nullable', 'date_format:Y-m-d'], 'trabajador' => ['nullable', 'uuid']]);

        $mes = Base::mesValido($f['mes'] ?? Comisiones::abierto());
        // No hay despacho de eventos: el período abierto se pone al día al consultarlo (procesar es idempotente y usa insertOrIgnore).
        if (! Comisiones::cerrado($mes)) {
            Comisiones::procesar();
        }

        return response()->json(Comisiones::periodo($mes, $f['trabajador'] ?? null, $request->user()));
    }

    public function procesar(Request $request)
    {
        return response()->json(Comisiones::procesar());
    }

    public function pagos(Request $request)
    {
        $f = $request->validate(['mes' => ['nullable', 'date_format:Y-m-d']]);

        return response()->json(Pagos::lista(Base::mesValido($f['mes'] ?? Base::sumarMeses(Base::mes(), -1)), $request->user()));
    }

    public function previa(Request $request)
    {
        $f = $request->validate(['mes' => ['required', 'date_format:Y-m-d'], 'trabajador' => ['required', 'uuid']]);
        if (! Base::veSueldos($request->user())) {
            \App\Support\RuleError::fail('RN-PER-19', 'La liquidación la ven RR. HH., gerencia y administración.');
        }

        return response()->json(Pagos::construir($f['trabajador'], Base::mesValido($f['mes'])));
    }

    public function generar(Request $request)
    {
        $f = $request->validate(['mes' => ['required', 'date_format:Y-m-d']]);

        return response()->json(Pagos::generar(Base::mesValido($f['mes']), $request->user()));
    }

    public function liberar(Request $request, string $id)
    {
        $f = $request->validate(['note' => ['nullable', 'string', 'max:300']]);

        return response()->json(Pagos::liberar($id, $f['note'] ?? null, $request->user()));
    }

    public function aprobar(Request $request, string $id)
    {
        return response()->json(Pagos::aprobar($id, $request->user()));
    }

    public function pagar(Request $request, string $id)
    {
        $request->validate(['cash_account_id' => ['required', 'uuid'], 'reference' => ['required', 'string', 'max:60']]);

        return response()->json(Pagos::pagar($id, $request->all(), $request->user()));
    }

    public function anular(Request $request, string $id)
    {
        $f = $request->validate(['reason' => ['required', 'string', 'max:500']]);

        return response()->json(Pagos::anular($id, $f['reason'], $request->user()));
    }

    public function supervision(Request $request)
    {
        $f = $request->validate(['estado' => ['nullable', Rule::in(['OPEN', 'CLOSED'])], 'origen' => ['nullable', Rule::in(array_keys(Base::ORIGENES))]]);

        return response()->json(Supervision::lista($request->user(), $f['estado'] ?? null, $f['origen'] ?? null));
    }

    public function registrarAccion(Request $request, string $id)
    {
        $request->validate(['action' => ['required', Rule::in(array_keys(Base::ACCIONES))], 'note' => ['nullable', 'string', 'max:2000']]);

        return response()->json(Supervision::registrar($id, $request->all(), $request->user()));
    }

    public function nuevaObservacion(Request $request)
    {
        $request->validate(['employee_id' => ['required', 'uuid'], 'source' => ['nullable', Rule::in(['ATTENDANCE', 'OTHER'])],
            'severity' => ['nullable', Rule::in(['LOW', 'MEDIUM', 'HIGH'])], 'summary' => ['required', 'string', 'max:1000']]);

        return response()->json(Supervision::nueva($request->all(), $request->user()), 201);
    }
}
