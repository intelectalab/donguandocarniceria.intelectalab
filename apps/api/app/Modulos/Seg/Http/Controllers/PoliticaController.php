<?php

namespace App\Modulos\Seg\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Support\Listado;
use App\Support\PasswordPolicy;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * SEG-14 Política de contraseñas y sesiones: los parámetros de SEG con su valor vigente, su historial
 * (PLT-11) y las cifras de bloqueos e inicios fallidos del mes. Cambiar un valor se hace con el editor
 * de parámetros de PLT, que acepta seg.policy.edit para las claves seg_* y exige motivo (RN-PLT-06).
 */
class PoliticaController extends Controller
{
    public function index()
    {
        $propios = DB::table('parameters')->where('scope', 'TENANT')->where('key', 'like', 'seg\\_%')->pluck('value', 'key');
        $parametros = DB::table('parameter_definitions')->where('module_code', 'SEG')->orderBy('key')
            ->get(['key', 'value_type', 'default_value', 'min_value', 'max_value', 'unit', 'description', 'options'])
            ->map(fn ($d) => [
                'key' => $d->key, 'value_type' => $d->value_type, 'description' => $d->description, 'unit' => $d->unit,
                'min_value' => $d->min_value === null ? null : (float) $d->min_value, 'max_value' => $d->max_value === null ? null : (float) $d->max_value,
                'options' => $d->options ? json_decode($d->options, true) : null,
                'default_value' => $d->default_value, 'value' => $propios[$d->key] ?? $d->default_value, 'source' => isset($propios[$d->key]) ? 'TENANT' : 'DEFAULT',
            ]);

        $desde = now('America/Lima')->startOfMonth();
        $mes = DB::table('access_log')->where('at', '>=', $desde)
            ->selectRaw("count(*) filter (where event = 'LOCKED') bloqueos, count(*) filter (where event = 'LOGIN_FAILED') fallidos,
                count(*) filter (where event = 'LOGIN_OK') correctos")->first();
        $intentos = (int) $mes->fallidos + (int) $mes->correctos;

        return response()->json([
            'parametros' => $parametros,
            'regla' => PasswordPolicy::rule(),
            'mes' => [
                'desde' => $desde->toDateString(), 'bloqueos' => (int) $mes->bloqueos, 'fallidos' => (int) $mes->fallidos, 'intentos' => $intentos,
                'tasa_fallidos' => $intentos ? round((int) $mes->fallidos / $intentos * 100, 2) : 0.0,
            ],
        ]);
    }

    /** Historial de la política (PLT-11, solo las claves seg_*), paginado y con búsqueda. */
    public function historial(Request $request)
    {
        $q = DB::table('parameter_history as h')->leftJoin('parameter_definitions as d', 'd.key', '=', 'h.key')
            ->where('h.key', 'like', 'seg\\_%')
            ->when($request->query('key'), fn ($x, $v) => $x->where('h.key', $v))
            ->select('h.id', 'h.key', 'h.old_value', 'h.new_value', 'h.reason', 'h.changed_by', 'h.changed_at', 'h.scope', 'd.description');

        // Envuelta: las dos tablas tienen «key» y ordenar por ella sería ambiguo.
        return response()->json(Listado::de(DB::query()->fromSub($q, 's'), $request, buscar: ['key', 'description', 'reason', 'changed_by'],
            ordenar: ['changed_at', 'key', 'changed_by'], porDefecto: '-changed_at'));
    }

    /**
     * Prueba una contraseña contra la política con el usuario que pregunta, sin guardarla ni
     * registrarla en ningún lado. Solo responde qué condiciones cumple.
     */
    public function probar(Request $request)
    {
        $d = $request->validate(['password' => ['present', 'nullable', 'string', 'max:200']]);

        return response()->json(['checks' => array_map(fn ($c) => ['etiqueta' => $c['etiqueta'], 'ok' => $c['ok']],
            PasswordPolicy::checks($request->user(), (string) ($d['password'] ?? '')))]);
    }
}
