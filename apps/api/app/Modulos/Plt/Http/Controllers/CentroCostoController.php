<?php

namespace App\Modulos\Plt\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Plt\Models\CostCenter;
use App\Modulos\Plt\Services\CentrosCosto;
use App\Support\Listado;
use App\Support\RuleError;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * PLT-07 Centros de costo: árbol por área con local y marca opcionales, hasta
 * plt_cost_center_max_depth niveles y sin ciclos (RN-PLT-21). No se borran: se desactivan.
 */
class CentroCostoController extends Controller
{
    public const AREAS = ['PRODUCTION', 'QUALITY', 'WAREHOUSE', 'DELIVERY', 'SALES', 'MARKETING', 'ADMIN', 'FINANCE', 'HR'];

    /** Lista paginada para la tabla, con su nivel en el árbol. */
    public function index(Request $request)
    {
        $query = $this->conNombres(CostCenter::query())
            ->when($request->query('company_id'), fn ($q, $v) => $q->where('cost_centers.company_id', $v))
            ->when($request->query('area'), fn ($q, $v) => $q->where('cost_centers.area', $v))
            ->when($request->query('status'), fn ($q, $v) => $q->where('cost_centers.status', $v));

        $pagina = Listado::de($query, $request, buscar: ['cost_centers.code', 'cost_centers.name'],
            ordenar: ['code', 'name', 'area', 'status'], porDefecto: 'code');
        $niveles = CentrosCosto::niveles();
        $pagina->getCollection()->each(fn ($c) => $c->setAttribute('nivel', $niveles[$c->id] ?? 1));

        return response()->json($pagina);
    }

    /** Todos los centros (para el árbol y los selectores) y las cifras de cabecera. */
    public function arbol(Request $request)
    {
        $centros = $this->conNombres(CostCenter::query())
            ->when($request->query('company_id'), fn ($q, $v) => $q->where('cost_centers.company_id', $v))
            ->orderBy('code')->get();
        $niveles = CentrosCosto::niveles();
        $centros->each(fn ($c) => $c->setAttribute('nivel', $niveles[$c->id] ?? 1));

        return response()->json([
            'centros' => $centros,
            'resumen' => [
                'total' => $centros->count(),
                'activos' => $centros->where('status', 'ACTIVE')->count(),
                'areas' => $centros->pluck('area')->unique()->count(),
                'areas_total' => count(self::AREAS),
                'nivel_maximo' => (int) $centros->max('nivel'),
                'limite' => CentrosCosto::maximo(),
                'por_marca' => $centros->whereNotNull('brand_id')->count(),
            ],
        ]);
    }

    public function show(string $id)
    {
        $cc = $this->conNombres(CostCenter::query())->findOrFail($id);
        $cc->setAttribute('nivel', CentrosCosto::niveles()[$id] ?? 1);
        $cc->setAttribute('hijos', DB::table('cost_centers')->where('parent_id', $id)->orderBy('code')->pluck('code'));

        return response()->json($cc);
    }

    public function store(Request $request)
    {
        $cc = DB::transaction(fn () => CostCenter::create($this->validar($request)));

        return response()->json($cc->fresh(), 201);
    }

    public function update(Request $request, string $id)
    {
        $cc = CostCenter::findOrFail($id);
        DB::transaction(fn () => $cc->update($this->validar($request, $cc)));

        return response()->json($cc->fresh());
    }

    /** Activa o desactiva varios a la vez. Los gastos ya imputados no cambian. */
    public function estado(Request $request)
    {
        $datos = $request->validate([
            'ids' => ['required', 'array', 'min:1', 'max:200'],
            'ids.*' => ['uuid'],
            'status' => ['required', Rule::in(['ACTIVE', 'INACTIVE'])],
        ], ['ids.required' => 'Elige al menos un centro de costo.']);
        abort_if(CostCenter::whereIn('id', $datos['ids'])->count() !== count(array_unique($datos['ids'])), 404, 'Alguno de los centros de costo ya no existe.');

        $cambiados = CostCenter::whereIn('id', $datos['ids'])->where('status', '!=', $datos['status'])
            ->update(['status' => $datos['status'], 'updated_at' => now()]);

        return response()->json(['cambiados' => $cambiados]);
    }

    /** Nombres del padre, local y marca, hijos y gastos imputados. */
    private function conNombres($query)
    {
        return $query->select('cost_centers.*')->addSelect([
            'parent_code' => DB::table('cost_centers as p')->select('p.code')->whereColumn('p.id', 'cost_centers.parent_id')->limit(1),
            'establishment_name' => DB::table('establishments')->select('short')->whereColumn('establishments.id', 'cost_centers.establishment_id')->limit(1),
            'brand_name' => DB::table('brands')->select('name')->whereColumn('brands.id', 'cost_centers.brand_id')->limit(1),
            'hijos_count' => DB::table('cost_centers as h')->selectRaw('count(*)')->whereColumn('h.parent_id', 'cost_centers.id'),
            'gastos_count' => DB::table('expenses')->selectRaw('count(*)')->whereColumn('expenses.cost_center_id', 'cost_centers.id'),
        ]);
    }

    private function validar(Request $request, ?CostCenter $cc = null): array
    {
        $request->merge(['code' => mb_strtoupper(trim((string) $request->input('code')))]);
        $datos = $request->validate([
            'company_id' => ['required', 'uuid', 'exists:companies,id'],
            'code' => ['required', 'regex:/^[A-Z0-9-]{2,12}$/', Rule::unique('cost_centers', 'code')->ignore($cc?->id)],
            'name' => ['required', 'string', 'max:80'],
            'area' => ['required', Rule::in(self::AREAS)],
            'parent_id' => ['nullable', 'uuid', 'exists:cost_centers,id'],
            'establishment_id' => ['nullable', 'uuid', Rule::exists('establishments', 'id')->where('company_id', $request->input('company_id'))],
            'brand_id' => ['nullable', 'uuid', Rule::exists('brands', 'id')->where('company_id', $request->input('company_id'))],
            'status' => ['required', Rule::in(['ACTIVE', 'INACTIVE'])],
        ], [
            'code.regex' => 'El código tiene de 2 a 12 letras, números o guiones.',
            'code.unique' => 'Ya existe un centro de costo con ese código.',
            'establishment_id.exists' => 'El local no es de esa empresa.',
            'brand_id.exists' => 'La marca no es de esa empresa.',
        ]);

        // Un hijo es de la misma empresa y área que su padre: así el árbol de cada área queda completo.
        if (! empty($datos['parent_id'])) {
            $padre = CostCenter::findOrFail($datos['parent_id']);
            if ($padre->company_id !== $datos['company_id']) {
                RuleError::fail('RN-PLT-21', 'El centro del que depende es de otra empresa.');
            }
            $datos['area'] = $padre->area;
        }
        CentrosCosto::validarPadre($cc?->id, $datos['parent_id'] ?? null);

        // Si cambia de área, sus hijos la siguen.
        if ($cc && $cc->area !== $datos['area']) {
            $this->cambiarAreaHijos($cc->id, $datos['area']);
        }

        return $datos;
    }

    private function cambiarAreaHijos(string $id, string $area, int $prof = 0): void
    {
        if ($prof > 50) {
            return;
        }
        foreach (DB::table('cost_centers')->where('parent_id', $id)->pluck('id') as $hijo) {
            DB::table('cost_centers')->where('id', $hijo)->update(['area' => $area, 'updated_at' => now()]);
            $this->cambiarAreaHijos($hijo, $area, $prof + 1);
        }
    }
}
