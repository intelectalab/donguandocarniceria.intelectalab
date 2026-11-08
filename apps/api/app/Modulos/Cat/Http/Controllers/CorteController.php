<?php

namespace App\Modulos\Cat\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Support\RuleError;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * CAT-04 Tipos de corte: catálogo editable de cortes y presentaciones con las líneas a las que
 * aplican. Al crear una variante solo se ofrecen los cortes de la línea de su producto (CAT-03).
 */
class CorteController extends Controller
{
    /** Todos los cortes (activos e inactivos) en su orden, con cuántas variantes los usan. */
    public function index()
    {
        $uso = DB::table('product_variants')->whereNotNull('cut_type_id')
            ->selectRaw("cut_type_id, count(*) as total, count(*) filter (where status = 'ACTIVE') as activas")
            ->groupBy('cut_type_id')->get()->keyBy('cut_type_id');

        return response()->json(DB::table('cut_types')->orderBy('sort_order')->orderBy('name')
            ->get(['id', 'code', 'name', 'applies_to_lines', 'sort_order', 'status', 'updated_at'])
            ->map(function ($c) use ($uso) {
                $c->applies_to_lines = json_decode((string) $c->applies_to_lines, true) ?: [];
                $c->variantes = (int) ($uso[$c->id]->total ?? 0);
                $c->variantes_activas = (int) ($uso[$c->id]->activas ?? 0);

                return $c;
            }));
    }

    public function store(Request $request)
    {
        $d = $this->validar($request);
        $id = DB::table('cut_types')->insertGetId([
            'code' => $d['code'], 'name' => $d['name'], 'applies_to_lines' => json_encode($d['applies_to_lines']),
            'sort_order' => $d['sort_order'] ?? ((int) DB::table('cut_types')->max('sort_order') + 10), 'status' => $d['status'],
        ]);

        return response()->json(['id' => $id], 201);
    }

    public function update(Request $request, string $id)
    {
        $c = DB::table('cut_types')->where('id', $id)->first() ?? abort(404);
        $d = $this->validar($request, $id);

        // No se deja a una variante activa con un corte inactivo o que ya no aplica a su línea.
        $activas = DB::table('product_variants')->where('cut_type_id', $id)->where('status', 'ACTIVE');
        if ($d['status'] === 'INACTIVE' && (clone $activas)->exists()) {
            RuleError::fail('CAT-04', 'Hay '.(clone $activas)->count().' variantes activas con el corte '.$c->name.': cámbialas o inactívalas antes de inactivarlo.');
        }
        $fuera = (clone $activas)->whereNotIn('line', $d['applies_to_lines'])->distinct()->pluck('line')->filter()->values();
        if ($fuera->isNotEmpty()) {
            RuleError::fail('CAT-04', 'Hay variantes activas de '.$fuera->implode(', ').' con este corte: no quites esa línea mientras las usen.');
        }

        DB::table('cut_types')->where('id', $id)->update([
            'code' => $d['code'], 'name' => $d['name'], 'applies_to_lines' => json_encode($d['applies_to_lines']),
            'sort_order' => $d['sort_order'] ?? $c->sort_order, 'status' => $d['status'], 'updated_at' => now(),
        ]);

        return response()->json(['id' => $id]);
    }

    private function validar(Request $request, ?string $id = null): array
    {
        $request->merge(['code' => mb_strtoupper(trim((string) $request->input('code')))]);

        return $request->validate([
            'code' => ['required', 'regex:/^[A-Z0-9_]{2,40}$/', Rule::unique('cut_types', 'code')->ignore($id)],
            'name' => ['required', 'string', 'max:80'],
            'applies_to_lines' => ['required', 'array', 'min:1'],
            'applies_to_lines.*' => ['distinct', Rule::in(ProductoController::LINEAS)],
            'sort_order' => ['nullable', 'integer', 'min:0', 'max:9999'],
            'status' => ['required', Rule::in(['ACTIVE', 'INACTIVE'])],
        ], [
            'code.regex' => 'El código tiene de 2 a 40 letras, números o guiones bajos. Ej.: SIN_PIEL.',
            'code.unique' => 'Ya existe un corte con ese código.',
            'applies_to_lines.required' => 'Marca al menos una línea a la que aplica.',
            'applies_to_lines.min' => 'Marca al menos una línea a la que aplica.',
        ]);
    }
}
