<?php

namespace App\Modulos\Plt\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Plt\Services\Parametros;
use App\Support\Access;
use App\Support\Listado;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * PLT-10 Parámetros y PLT-11 Historial. Las definiciones son de toda la plataforma y aquí solo se
 * leen; la empresa cambia su valor dentro del rango, con motivo. Las reglas están en Parametros.
 */
class ParametroController extends Controller
{
    /**
     * Parámetros de un módulo (o los que coinciden con ?q en todos), con su valor vigente para la
     * empresa y de dónde sale. Incluye los módulos con su cantidad y las cifras de cabecera.
     */
    public function index(Request $request)
    {
        $q = mb_strtolower(trim((string) $request->query('q', '')));
        $modulo = $request->query('module');

        $defs = DB::table('parameter_definitions as d')
            ->leftJoin('platform_modules as m', 'm.code', '=', 'd.module_code')
            ->select('d.key', 'd.module_code', 'd.value_type', 'd.default_value', 'd.min_value', 'd.max_value', 'd.allowed_scopes', 'd.unit', 'd.description', 'd.options',
                'm.sort_order as modulo_orden')
            ->when($q !== '', fn ($w) => $w->where(fn ($x) => $x->whereRaw('lower(d.key) like ?', ["%{$q}%"])->orWhereRaw('lower(d.description) like ?', ["%{$q}%"])))
            ->when($q === '' && $modulo, fn ($w) => $w->where('d.module_code', $modulo))
            ->orderBy('m.sort_order')->orderBy('d.key')->get();

        $propios = DB::table('parameters')->get()->groupBy('key');
        $parametros = $defs->map(function ($d) use ($propios) {
            $filas = $propios->get($d->key, collect());
            $empresa = $filas->first(fn ($p) => $p->scope === 'TENANT');

            return [
                'key' => $d->key, 'module_code' => $d->module_code, 'value_type' => $d->value_type, 'description' => $d->description,
                'unit' => $d->unit, 'min_value' => $d->min_value === null ? null : (float) $d->min_value,
                'max_value' => $d->max_value === null ? null : (float) $d->max_value,
                'allowed_scopes' => json_decode($d->allowed_scopes, true) ?: ['TENANT'],
                'options' => $d->options ? json_decode($d->options, true) : null,
                'default_value' => $d->default_value,
                'value' => $empresa?->value ?? $d->default_value,
                'source' => $empresa ? 'TENANT' : 'DEFAULT',
                'overrides' => $filas->where('scope', '!=', 'TENANT')->count(),
            ];
        })->values();

        $modulos = DB::table('parameter_definitions as d')->join('platform_modules as m', 'm.code', '=', 'd.module_code')
            ->leftJoin('tenant_modules as t', 't.module_code', '=', 'm.code')
            ->groupBy('m.code', 'm.name', 'm.sort_order', 't.enabled')->orderBy('m.sort_order')
            ->selectRaw('m.code, m.name, count(*) as total, coalesce(t.enabled, false) as enabled')->get()
            ->map(fn ($m) => ['code' => $m->code, 'name' => trim(explode(':', $m->name)[0]), 'total' => (int) $m->total, 'enabled' => (bool) $m->enabled]);

        return response()->json([
            'parametros' => $parametros,
            'modulos' => $modulos,
            'resumen' => [
                'total' => DB::table('parameter_definitions')->count(),
                'modulos' => $modulos->count(),
                'con_valor_propio' => DB::table('parameters')->distinct()->count('key'),
                'cambios' => DB::table('parameter_history')->count(),
            ],
        ]);
    }

    /** Un parámetro: definición, valor de la empresa, valores por local o marca y su historial. */
    public function show(string $key)
    {
        $d = Parametros::definicion($key);
        $empresa = DB::table('parameters')->where('key', $key)->where('scope', 'TENANT')->first();
        $otros = DB::table('parameters as p')->where('p.key', $key)->where('p.scope', '!=', 'TENANT')
            ->leftJoin('brands as b', 'b.id', '=', 'p.scope_id')->leftJoin('establishments as e', 'e.id', '=', 'p.scope_id')
            ->select('p.scope', 'p.scope_id', 'p.value', 'p.reason', DB::raw('coalesce(b.name, e.short) as nombre'))->orderBy('p.scope')->get();

        return response()->json([
            'key' => $d->key, 'module_code' => $d->module_code, 'value_type' => $d->value_type, 'description' => $d->description,
            'module_name' => trim(explode(':', (string) DB::table('platform_modules')->where('code', $d->module_code)->value('name'))[0]),
            'unit' => $d->unit, 'min_value' => $d->min_value === null ? null : (float) $d->min_value, 'max_value' => $d->max_value === null ? null : (float) $d->max_value,
            'allowed_scopes' => $d->allowed_scopes, 'options' => $d->options, 'default_value' => $d->default_value,
            'value' => $empresa?->value ?? $d->default_value, 'source' => $empresa ? 'TENANT' : 'DEFAULT',
            'ambitos' => $otros,
            'historial' => $this->historialQuery()->where('h.key', $key)->orderByDesc('h.changed_at')->limit(50)->get(),
        ]);
    }

    public function update(Request $request, string $key)
    {
        $this->exigirPermiso($request, $key);
        $datos = $this->validarAmbito($request, ['value' => ['present'], 'reason' => ['required', 'string', 'max:255']]);
        $valor = Parametros::cambiar($key, $datos['value'], $datos['reason'], $request->user(), $datos['scope'] ?? 'TENANT', $datos['scope_id'] ?? null);

        return response()->json(['key' => $key, 'value' => $valor]);
    }

    /** Quita el valor propio de un ámbito: vuelve a regir el más general. */
    public function quitar(Request $request, string $key)
    {
        $this->exigirPermiso($request, $key);
        $datos = $this->validarAmbito($request, ['reason' => ['required', 'string', 'max:255']]);
        $valor = Parametros::quitar($key, $datos['reason'], $request->user(), $datos['scope'] ?? 'TENANT', $datos['scope_id'] ?? null);

        return response()->json(['key' => $key, 'value' => $valor]);
    }

    /** PLT-11: todos los cambios, con filtros por módulo, clave, usuario y ámbito, y sus cifras. */
    public function historial(Request $request)
    {
        $query = $this->historialQuery()
            ->when($request->query('module_code'), fn ($q, $v) => $q->where('h.module_code', $v))
            ->when($request->query('key'), fn ($q, $v) => $q->where('h.key', $v))
            ->when($request->query('changed_by'), fn ($q, $v) => $q->where('h.changed_by', $v))
            ->when($request->query('scope'), fn ($q, $v) => $q->where('h.scope', $v));

        $pagina = Listado::de($query, $request, buscar: ['h.key', 'h.reason', 'h.changed_by'],
            ordenar: ['changed_at', 'key', 'module_code', 'changed_by'], porDefecto: '-changed_at')->toArray();
        $ultimo = DB::table('parameter_history')->orderByDesc('changed_at')->first(['key', 'changed_at']);

        return response()->json($pagina + [
            'resumen' => [
                'cambios' => DB::table('parameter_history')->count(),
                'parametros' => DB::table('parameter_history')->distinct()->count('key'),
                'usuarios' => DB::table('parameter_history')->distinct()->count('changed_by'),
                'ultimo' => $ultimo,
            ],
            'filtros' => [
                'modulos' => DB::table('parameter_history')->whereNotNull('module_code')->distinct()->orderBy('module_code')->pluck('module_code'),
                'claves' => DB::table('parameter_history')->distinct()->orderBy('key')->pluck('key'),
                'usuarios' => DB::table('parameter_history')->distinct()->orderBy('changed_by')->pluck('changed_by'),
            ],
        ]);
    }

    private function historialQuery()
    {
        return DB::table('parameter_history as h')
            ->leftJoin('brands as b', 'b.id', '=', 'h.scope_id')->leftJoin('establishments as e', 'e.id', '=', 'h.scope_id')
            ->leftJoin('parameter_definitions as d', 'd.key', '=', 'h.key')
            ->select('h.id', 'h.key', 'h.module_code', 'h.scope', 'h.scope_id', 'h.old_value', 'h.new_value', 'h.reason', 'h.changed_by', 'h.changed_at',
                DB::raw('coalesce(b.name, e.short) as ambito_nombre'), 'd.value_type', 'd.unit', 'd.options');
    }

    /** plt.parameter.edit; las políticas de seguridad (seg_*) también con seg.policy.edit. */
    private function exigirPermiso(Request $request, string $key): void
    {
        $u = $request->user();
        $puede = Access::can($u, 'plt.parameter.edit') || (str_starts_with($key, 'seg_') && Access::can($u, 'seg.policy.edit'));
        abort_unless($puede, response()->json(['message' => 'No tienes el permiso plt.parameter.edit.', 'code' => 'PERMISSION_DENIED'], 403));
    }

    private function validarAmbito(Request $request, array $reglas): array
    {
        return $request->validate($reglas + [
            'scope' => ['nullable', Rule::in(Parametros::AMBITOS)],
            'scope_id' => ['nullable', 'uuid'],
        ], ['reason.required' => 'Escribe el motivo.']);
    }
}
