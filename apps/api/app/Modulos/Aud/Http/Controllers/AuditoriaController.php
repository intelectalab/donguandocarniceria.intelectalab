<?php

namespace App\Modulos\Aud\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Aud\Services\Accesos;
use App\Modulos\Aud\Services\Cambios;
use App\Modulos\Aud\Services\Exportaciones;
use App\Modulos\Aud\Services\Retencion;
use App\Modulos\Aud\Services\Revision;
use App\Support\Access;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * AUD-01 Consulta de cambios, AUD-02 Historia, AUD-03 Bitácora de accesos, AUD-04 Datos sensibles, AUD-05 Exportaciones,
 * AUD-06 Políticas de retención, AUD-07 Corridas de depuración y AUD-08 Revisión de accesos.
 */
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

    /** AUD-06: políticas, cuánto hay para depurar y el ejemplo de enmascarado. */
    public function retencion(Request $request)
    {
        return response()->json(['data' => Retencion::politicas(), 'anios' => Retencion::anios(), 'enmascarado' => Retencion::muestraDeEnmascarado(),
            'puede' => Access::can($request->user(), 'aud.retention.manage')]);
    }

    public function actualizarRetencion(Request $request, string $categoria)
    {
        abort_unless(isset(Retencion::CATEGORIAS[$categoria]), 404);
        $d = $request->validate(['months' => ['required', 'integer', 'min:1', 'max:3650'], 'archive' => ['required', 'boolean'], 'reason' => ['required', 'string', 'min:10', 'max:300']],
            [], ['months' => 'plazo', 'archive' => 'archivar', 'reason' => 'motivo']);

        return response()->json(Retencion::actualizar($categoria, (int) $d['months'], (bool) $d['archive'], $d['reason'], $request->user()));
    }

    public function depurarCategoria(Request $request, string $categoria)
    {
        abort_unless(isset(Retencion::CATEGORIAS[$categoria]), 404);

        return response()->json(Retencion::depurar($categoria, $request->user()->name));
    }

    /** AUD-07: corridas de depuración. */
    public function depuraciones(Request $request)
    {
        $f = $request->validate([
            'categoria' => ['nullable', Rule::in(array_keys(Retencion::CATEGORIAS))], 'estado' => ['nullable', Rule::in(array_keys(Retencion::ESTADOS))],
            'desde' => ['nullable', 'date_format:Y-m-d'], 'hasta' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:desde'], 'buscar' => ['nullable', 'string', 'max:100'],
        ]);

        return response()->json(Retencion::corridas($f) + ['puede' => Access::can($request->user(), 'aud.retention.manage')]);
    }

    public function depurarVencidas(Request $request)
    {
        return response()->json(['data' => Retencion::depurarVencidas($request->user()->name)]);
    }

    /** AUD-08: revisión de accesos del trimestre. */
    public function revision(Request $request)
    {
        return response()->json(Revision::panel($request->user()) + ['puede' => Access::can($request->user(), 'aud.access_review.run')]);
    }

    public function iniciarRevision(Request $request)
    {
        Revision::iniciar($request->user());

        return response()->json(Revision::panel($request->user()) + ['puede' => true], 201);
    }

    public function verRevision(string $id)
    {
        return response()->json(Revision::ver($id));
    }

    public function decidirRevision(Request $request, string $id)
    {
        $d = $request->validate(['user_id' => ['required', 'uuid'], 'decision' => ['required', Rule::in(array_keys(Revision::DECISIONES))], 'note' => ['nullable', 'string', 'max:300']],
            [], ['user_id' => 'usuario', 'decision' => 'decisión', 'note' => 'nota']);

        return response()->json(Revision::decidir($id, $d['user_id'], $d['decision'], $d['note'] ?? null));
    }

    public function cerrarRevision(Request $request, string $id)
    {
        $d = $request->validate(['findings' => ['required', 'string', 'min:10', 'max:2000']], [], ['findings' => 'hallazgos']);

        return response()->json(Revision::cerrar($id, $d['findings'], $request->user()));
    }

    /** Descarga desde el enlace firmado (sin sesión: la firma lleva la exportación, la empresa, quién y el vencimiento). */
    public function descargarExportacion(Request $request, string $id)
    {
        return Exportaciones::descargar($id, (string) $request->query('e'), (string) $request->query('u'));
    }
}
