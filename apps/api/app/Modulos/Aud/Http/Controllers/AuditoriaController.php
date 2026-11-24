<?php

namespace App\Modulos\Aud\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Aud\Services\Accesos;
use App\Modulos\Aud\Services\Cambios;
use App\Modulos\Aud\Services\Exportaciones;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/** AUD-01 Consulta de cambios, AUD-02 Historia, AUD-03 Bitácora de accesos, AUD-04 Datos sensibles y AUD-05 Exportaciones. */
class AuditoriaController extends Controller
{
    public function cambios(Request $request)
    {
        $f = $request->validate([
            'tabla' => ['nullable', 'string', 'max:63', 'regex:/^[a-z_]+$/'], 'usuario' => ['nullable', 'string', 'regex:/^(SISTEMA|[0-9a-f-]{36})$/'],
            'accion' => ['nullable', Rule::in(array_keys(Cambios::ACCIONES))], 'registro' => ['nullable', 'uuid'],
            'desde' => ['nullable', 'date_format:Y-m-d'], 'hasta' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:desde'], 'revelar' => ['nullable', 'boolean'],
            'sistema' => ['nullable', 'boolean'], 'buscar' => ['nullable', 'string', 'max:100'],
        ]);

        return response()->json(Cambios::lista($f, $request->user()));
    }

    public function cambio(Request $request, int $id)
    {
        $f = $request->validate(['revelar' => ['nullable', 'boolean']]);

        return response()->json(Cambios::ver($id, $f, $request->user()));
    }

    public function historia(Request $request)
    {
        $f = $request->validate(['tabla' => ['required', 'string', 'max:63', 'regex:/^[a-z_]+$/'], 'id' => ['required', 'uuid'], 'revelar' => ['nullable', 'boolean']]);

        return response()->json(Cambios::historia($f['tabla'], $f['id'], $f, $request->user()));
    }

    public function registros(Request $request)
    {
        $d = $request->validate(['tabla' => ['nullable', 'string', 'max:63', 'regex:/^[a-z_]+$/'], 'buscar' => ['nullable', 'string', 'max:80']]);
        $tablas = Cambios::elegibles($request->user());
        // Sin tabla: la primera que tiene historia.
        $tabla = $d['tabla'] ?? ($tablas[0]['value'] ?? null);

        return response()->json(['tablas' => $tablas, 'tabla' => $tabla, 'registros' => $tabla ? Cambios::registros($tabla, $d['buscar'] ?? null, $request->user()) : []]);
    }

    public function accesos(Request $request)
    {
        $f = $request->validate([
            'evento' => ['nullable', 'string', 'max:80', 'regex:/^[A-Z_]+$/'], 'usuario' => ['nullable', 'uuid'], 'ip' => ['nullable', 'string', 'max:40', 'regex:/^[0-9a-fA-F.:]+$/'], 'buscar' => ['nullable', 'string', 'max:100'],
            'resultado' => ['nullable', Rule::in(['OK', 'DENIED'])], 'desde' => ['nullable', 'date_format:Y-m-d'], 'hasta' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:desde'],
        ]);

        return response()->json(Accesos::lista($f, $request->user()));
    }

    public function sensibles(Request $request)
    {
        $f = $request->validate([
            'evento' => ['nullable', Rule::in(Accesos::SENSIBLES)], 'usuario' => ['nullable', 'uuid'], 'buscar' => ['nullable', 'string', 'max:100'],
            'desde' => ['nullable', 'date_format:Y-m-d'], 'hasta' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:desde'],
        ]);

        return response()->json(Accesos::sensibles($f, $request->user()));
    }

    public function exportaciones(Request $request)
    {
        $f = $request->validate(['scope' => ['nullable', Rule::in(['mine', 'pending', 'all'])], 'status' => ['nullable', Rule::in(array_keys(Exportaciones::ESTADOS))],
            'report' => ['nullable', Rule::in(array_keys(Exportaciones::REPORTES))], 'buscar' => ['nullable', 'string', 'max:100']]);

        return response()->json(Exportaciones::lista($f, $request->user()));
    }

    public function exportacion(Request $request, string $id)
    {
        return response()->json(Exportaciones::ver($id, $request->user()));
    }

    public function solicitarExportacion(Request $request)
    {
        $d = $request->validate([
            'report' => ['required', Rule::in(array_keys(Exportaciones::REPORTES))], 'reason' => ['required', 'string', 'min:10', 'max:300'],
            'desde' => ['nullable', 'date_format:Y-m-d'], 'hasta' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:desde'], 'marca' => ['nullable', 'uuid'], 'optin' => ['nullable', 'boolean'],
        ], [], ['reason' => 'motivo', 'report' => 'reporte', 'marca' => 'marca', 'optin' => 'solo quienes aceptan publicidad']);

        return response()->json(Exportaciones::solicitar($d['report'], $d, $d['reason'], $request->user()), 201);
    }

    public function aprobarExportacion(Request $request, string $id)
    {
        return response()->json(Exportaciones::aprobar($id, $request->user()));
    }

    public function rechazarExportacion(Request $request, string $id)
    {
        $d = $request->validate(['reason' => ['required', 'string', 'min:10', 'max:300']], [], ['reason' => 'motivo']);

        return response()->json(Exportaciones::rechazar($id, $d['reason'], $request->user()));
    }

    public function enlaceExportacion(Request $request, string $id)
    {
        return response()->json(Exportaciones::enlace($id, $request->user()));
    }

    /** Descarga desde el enlace firmado (sin sesión: la firma lleva la exportación, la empresa, quién y el vencimiento). */
    public function descargarExportacion(Request $request, string $id)
    {
        return Exportaciones::descargar($id, (string) $request->query('e'), (string) $request->query('u'));
    }
}
