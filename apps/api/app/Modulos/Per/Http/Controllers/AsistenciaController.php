<?php

namespace App\Modulos\Per\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Per\Services\Asistencia;
use App\Modulos\Per\Services\Base;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/** PER-04 Turnos, PER-05 Programación, PER-06 Marcación, PER-07 QR del local y PER-08 Asistencia diaria. */
class AsistenciaController extends Controller
{
    public function turnos()
    {
        return response()->json(['data' => Asistencia::turnos()]);
    }

    public function guardarTurno(Request $request, ?string $id = null)
    {
        $request->validate([
            'establishment_id' => ['required', 'uuid'], 'code' => ['required', 'string', 'max:12'], 'name' => ['required', 'string', 'max:80'],
            'start_time' => ['required', 'string', 'max:8'], 'end_time' => ['required', 'string', 'max:8'], 'break_minutes' => ['required', 'integer'],
            'late_tolerance_minutes' => ['nullable', 'integer'], 'crosses_midnight' => ['nullable', 'boolean'], 'status' => ['nullable', Rule::in(['ACTIVE', 'INACTIVE'])],
        ]);

        return response()->json(Asistencia::guardarTurno($id, $request->all()), $id ? 200 : 201);
    }

    public function semana(Request $request)
    {
        $f = $request->validate(['local' => ['required', 'uuid'], 'lunes' => ['nullable', 'date_format:Y-m-d']]);

        return response()->json(Asistencia::semana($f['local'], $f['lunes'] ?? Base::hoy(), $request->user()));
    }

    public function programar(Request $request)
    {
        $f = $request->validate([
            'employee_id' => ['required', 'uuid'], 'work_date' => ['required', 'date_format:Y-m-d'], 'shift_id' => ['nullable', 'uuid'],
            'status' => ['required', Rule::in(['PLANNED', 'REST', 'CANCELLED'])], 'overtime_authorized_minutes' => ['nullable', 'integer', 'min:0', 'max:720'],
            'note' => ['nullable', 'string', 'max:500'],
        ]);

        return response()->json(['data' => Asistencia::programar($f['employee_id'], $f['work_date'], $f, $request->user())]);
    }

    public function copiarSemana(Request $request)
    {
        $f = $request->validate(['local' => ['required', 'uuid'], 'lunes' => ['required', 'date_format:Y-m-d']]);

        return response()->json(['copiados' => Asistencia::copiarSemana($f['local'], $f['lunes'], $request->user())]);
    }

    public function qr(string $local)
    {
        return response()->json(Asistencia::pantallaQr($local));
    }

    public function app(Request $request)
    {
        return response()->json(Asistencia::app($request->user()));
    }

    public function marcar(Request $request)
    {
        $request->validate([
            'method' => ['required', Rule::in(['GEO', 'QR', 'MANUAL'])], 'mark_type' => ['required', Rule::in(array_keys(Base::MARCAS))],
            'employee_id' => ['nullable', 'uuid'], 'establishment_id' => ['nullable', 'uuid'], 'lat' => ['nullable', 'numeric', 'between:-90,90'], 'lng' => ['nullable', 'numeric', 'between:-180,180'],
            'qr_token' => ['nullable', 'string', 'max:80'], 'manual_reason' => ['nullable', 'string', 'max:500'], 'marked_at' => ['nullable', 'string', 'max:40'],
            'offline_uuid' => ['nullable', 'string', 'max:64'], 'device_id' => ['nullable', 'string', 'max:80'], 'foto' => ['nullable', 'string', 'max:8000000'],
        ]);

        return response()->json(Asistencia::marcar($request->all(), $request->user()), 201);
    }

    public function diaria(Request $request)
    {
        $f = $request->validate(['fecha' => ['nullable', 'date_format:Y-m-d'], 'local' => ['nullable', 'uuid']]);

        return response()->json(Asistencia::diaria($f['fecha'] ?? Base::hoy(), $f['local'] ?? null, $request->user()));
    }

    public function consolidar(Request $request)
    {
        $f = $request->validate(['fecha' => ['required', 'date_format:Y-m-d', 'before_or_equal:today']]);

        return response()->json(['consolidados' => Asistencia::consolidarDia($f['fecha'])]);
    }

    public function justificar(Request $request, string $id)
    {
        $f = $request->validate(['text' => ['required', 'string', 'max:500']]);

        return response()->json(Asistencia::justificar($id, $f['text'], $request->user()));
    }

    public function resumenMes(Request $request)
    {
        $f = $request->validate(['mes' => ['nullable', 'date_format:Y-m-d']]);

        return response()->json(['data' => Asistencia::resumenMes(Base::mesValido($f['mes'] ?? null), $request->user())]);
    }

    public function permisos(Request $request)
    {
        return response()->json(['data' => Asistencia::permisos($request->user())]);
    }

    public function pedirPermiso(Request $request)
    {
        $request->validate(['employee_id' => ['nullable', 'uuid'], 'leave_type' => ['required', Rule::in(array_keys(Base::PERMISOS))],
            'date_from' => ['required', 'date_format:Y-m-d'], 'date_to' => ['required', 'date_format:Y-m-d'], 'reason' => ['required', 'string', 'max:500']]);

        return response()->json(Asistencia::pedirPermiso($request->all(), $request->user()), 201);
    }

    public function decidirPermiso(Request $request, string $id)
    {
        $f = $request->validate(['aprobar' => ['required', 'boolean'], 'note' => ['nullable', 'string', 'max:500']]);

        return response()->json(Asistencia::decidirPermiso($id, (bool) $f['aprobar'], $f['note'] ?? null, $request->user()));
    }
}
