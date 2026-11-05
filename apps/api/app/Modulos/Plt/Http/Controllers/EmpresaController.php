<?php

namespace App\Modulos\Plt\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Plt\Models\Company;
use App\Modulos\Plt\Services\Ruc;
use App\Support\Listado;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * PLT-03 Empresas: las razones sociales (RUC) de la empresa cliente. Cada una muestra cuántas
 * marcas, locales y series tiene. Las empresas no se borran: se desactivan.
 */
class EmpresaController extends Controller
{
    public const REGIMENES = ['MYPE', 'RER', 'GENERAL', 'NRUS'];
    public const ESTADOS = ['ACTIVE', 'INACTIVE', 'PREPARING'];

    public function index(Request $request)
    {
        $query = $this->conConteos(Company::query())
            ->when($request->query('status'), fn ($q, $s) => $q->where('status', $s));

        return response()->json(Listado::de($query, $request, buscar: ['legal_name', 'trade_name', 'ruc'],
            ordenar: ['legal_name', 'ruc', 'status', 'created_at'], porDefecto: 'legal_name'));
    }

    public function show(string $id)
    {
        return response()->json($this->conConteos(Company::query())->findOrFail($id));
    }

    public function store(Request $request)
    {
        $empresa = Company::create($this->validar($request));

        return response()->json($empresa->fresh(), 201);
    }

    public function update(Request $request, string $id)
    {
        $empresa = Company::findOrFail($id);
        $empresa->update($this->validar($request, $empresa->id));

        return response()->json($empresa->fresh());
    }

    private function validar(Request $request, ?string $id = null): array
    {
        $datos = $request->validate([
            'legal_name' => ['required', 'string', 'max:255'],
            'trade_name' => ['nullable', 'string', 'max:255'],
            'ruc' => ['required', 'string', function (string $attr, mixed $valor, Closure $fail) {
                if ($problema = Ruc::problema($valor)) {
                    // RN-PLT-13
                    $fail($problema);
                }
            }, Rule::unique('companies', 'ruc')->ignore($id)],
            'tax_regime' => ['required', Rule::in(self::REGIMENES)],
            'fiscal_address' => ['required', 'string', 'max:255'],
            'fiscal_ubigeo' => ['nullable', 'regex:/^\d{6}$/'],
            'default_currency' => ['required', Rule::in(['PEN', 'USD'])],
            'timezone' => ['required', Rule::in(['America/Lima'])],
            'status' => ['required', Rule::in(self::ESTADOS)],
        ], [
            'ruc.unique' => 'Ya existe una empresa con ese RUC.',
            'fiscal_ubigeo.regex' => 'El ubigeo tiene 6 dígitos (código INEI del distrito).',
        ]);

        $datos['legal_name'] = mb_strtoupper(trim($datos['legal_name']));
        $datos['trade_name'] = trim($datos['trade_name'] ?? '') ?: $datos['legal_name'];
        $datos['ruc'] = trim($datos['ruc']);

        return $datos;
    }

    /**
     * Conteos de marcas (y activas), locales y series (y electrónicas), las marcas con su color, los
     * locales por nombre y el distrito del domicilio fiscal.
     */
    private function conConteos($query)
    {
        return $query->select('companies.*')
            ->withCount([
                'brands', 'brands as active_brands_count' => fn ($q) => $q->where('status', 'ACTIVE'),
                'establishments', 'series', 'series as electronic_series_count' => fn ($q) => $q->where('is_electronic', true),
            ])
            ->with([
                'brands' => fn ($q) => $q->orderBy('sort_order')->select('id', 'company_id', 'code', 'name', 'status', 'primary_color'),
                'establishments' => fn ($q) => $q->orderBy('code')->select('id', 'company_id', 'code', 'short', 'est_type', 'status'),
            ])
            ->addSelect(['fiscal_district' => DB::table('ubigeo')->select('district')->whereColumn('ubigeo.code', 'companies.fiscal_ubigeo')->limit(1)]);
    }
}
