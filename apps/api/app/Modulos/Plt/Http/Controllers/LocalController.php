<?php

namespace App\Modulos\Plt\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Plt\Models\Establishment;
use App\Support\Listado;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * PLT-04 Locales: plantas, tiendas, almacenes y oficinas de cada empresa, con su código de
 * establecimiento anexo SUNAT (RN-PLT-04). No se borran: se desactivan.
 */
class LocalController extends Controller
{
    public const TIPOS = ['PLANT', 'STORE', 'WAREHOUSE', 'OFFICE', 'MIXED'];

    public function index(Request $request)
    {
        $query = Establishment::query()
            ->select('establishments.*')
            ->addSelect([
                'company_name' => DB::table('companies')->select('trade_name')->whereColumn('companies.id', 'establishments.company_id')->limit(1),
                'district' => DB::table('ubigeo')->select('district')->whereColumn('ubigeo.code', 'establishments.ubigeo')->limit(1),
                // El local fija sus almacenes (ALM) y sus zonas de reparto (CLI).
                'warehouses_count' => DB::table('warehouses')->selectRaw('count(*)')->whereColumn('warehouses.establishment_id', 'establishments.id'),
                'zones_count' => DB::table('delivery_zones')->selectRaw('count(*)')->whereColumn('delivery_zones.establishment_id', 'establishments.id'),
            ])
            ->when($request->query('company_id'), fn ($q, $v) => $q->where('company_id', $v))
            ->when($request->query('est_type'), fn ($q, $v) => $q->where('est_type', $v))
            ->when($request->query('status'), fn ($q, $v) => $q->where('status', $v));

        return response()->json(Listado::de($query, $request, buscar: ['code', 'name', 'short', 'address'],
            ordenar: ['code', 'name', 'est_type', 'status', 'warehouses_count', 'zones_count'], porDefecto: 'code'));
    }

    public function store(Request $request)
    {
        $local = Establishment::create($this->validar($request));

        return response()->json($local->fresh(), 201);
    }

    public function update(Request $request, string $id)
    {
        $local = Establishment::findOrFail($id);
        $local->update($this->validar($request, $local->id));

        return response()->json($local->fresh());
    }

    private function validar(Request $request, ?string $id = null): array
    {
        $request->merge(['code' => mb_strtoupper(trim((string) $request->input('code')))]);

        return $request->validate([
            // exists pasa por RLS: una empresa de otro cliente no existe para este usuario.
            'company_id' => ['required', 'uuid', 'exists:companies,id'],
            'code' => ['required', 'regex:/^[A-Z0-9]{1,6}$/', Rule::unique('establishments', 'code')->ignore($id)],
            'name' => ['required', 'string', 'max:255'],
            'short' => ['required', 'string', 'max:40'],
            'est_type' => ['required', Rule::in(self::TIPOS)],
            'sunat_code' => ['required', 'regex:/^\d{4}$/',
                Rule::unique('establishments', 'sunat_code')->where('company_id', $request->input('company_id'))->ignore($id)],
            'address' => ['required', 'string', 'max:255'],
            'ubigeo' => ['nullable', 'regex:/^\d{6}$/'],
            'lat' => ['nullable', 'numeric', 'between:-90,90'],
            'lng' => ['nullable', 'numeric', 'between:-180,180'],
            'has_counter' => ['boolean'],
            'status' => ['required', Rule::in(['ACTIVE', 'INACTIVE'])],
        ], [
            // RN-PLT-04
            'company_id.exists' => 'La empresa no existe.',
            'code.regex' => 'El código interno tiene de 1 a 6 letras o números.',
            'code.unique' => 'Ya existe un local con ese código.',
            'sunat_code.regex' => 'El código anexo SUNAT tiene 4 dígitos (0000 es el domicilio fiscal).',
            'sunat_code.unique' => 'Ese código anexo ya lo usa otro local de la empresa.',
            'ubigeo.regex' => 'El ubigeo tiene 6 dígitos (código INEI del distrito).',
        ]);
    }
}
