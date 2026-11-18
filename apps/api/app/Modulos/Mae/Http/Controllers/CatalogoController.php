<?php

namespace App\Modulos\Mae\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Mae\Services\TiposDeCambio;
use App\Modulos\Mae\Services\Unidades;
use App\Support\Listado;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * MAE-06 Unidades y conversiones, MAE-07 Catálogos SUNAT, MAE-08 Ubigeo y MAE-09 Entidades financieras.
 * Los catálogos SUNAT, el ubigeo y las entidades son globales y de solo lectura para la empresa (RN-MAE-11):
 * aquí solo hay lecturas; la base además le niega a la aplicación cualquier escritura. Se actualizan con el
 * comando mae:importar-global, que corre el operador de la plataforma.
 */
class CatalogoController extends Controller
{
    public const CATALOGOS = [
        '01' => 'Tipo de documento', '03' => 'Unidad de medida', '06' => 'Documento de identidad', '07' => 'Afectación del IGV',
        '09' => 'Tipo de nota de crédito', '10' => 'Tipo de nota de débito', '12' => 'Documentos relacionados', '18' => 'Modalidad de transporte',
        '20' => 'Motivo de traslado',
    ];

    public function unidades()
    {
        $sunat = DB::table('sunat_catalog_items')->where('catalog', '03')->get()->keyBy('code');
        $hoy = TiposDeCambio::hoy();

        return response()->json([
            'unidades' => DB::table('units_of_measure')->orderBy('code')->get()->map(fn ($u) => (array) $u + ['sunat_vigente' => isset($sunat[$u->code])
                && $sunat[$u->code]->valid_from <= $hoy && (! $sunat[$u->code]->valid_to || $sunat[$u->code]->valid_to >= $hoy)]),
            'conversiones' => DB::table('unit_conversions')->where('status', 'ACTIVE')->orderBy('from_uom')->get()
                ->map(fn ($c) => array_merge((array) $c, ['factor' => (float) $c->factor, 'inversa' => round(1 / (float) $c->factor, 6)])),
            // Códigos del catálogo 03 vigentes que la empresa todavía no usa: los que puede dar de alta como unidad propia.
            'codigos_libres' => DB::table('sunat_catalog_items as s')->where('s.catalog', '03')->where('s.valid_from', '<=', $hoy)
                ->where(fn ($w) => $w->whereNull('s.valid_to')->orWhere('s.valid_to', '>=', $hoy))
                ->whereNotIn('s.code', DB::table('units_of_measure')->select('code'))->orderBy('s.code')->get(['s.code', 's.description']),
        ]);
    }

    /** Unidad propia de la empresa: código del catálogo 03 vigente, tipo y decimales (Unidades::agregarUnidad). */
    public function storeUnidad(Request $request)
    {
        $d = $request->validate(['code' => ['required', 'string', 'max:6', 'regex:/^[A-Za-z0-9]+$/'], 'name' => ['nullable', 'string', 'min:2', 'max:40'],
            'uom_type' => ['required', Rule::in(Unidades::TIPOS)], 'decimals' => ['required', 'integer', 'between:0,6']]);
        $u = Unidades::agregarUnidad($d, $request->user());

        return response()->json(['id' => $u->id, 'code' => $u->code], 201);
    }

    public function convertir(Request $request)
    {
        $d = $request->validate(['qty' => ['required', 'numeric', 'between:-99999999,99999999'], 'from' => ['required', 'string', 'max:20'], 'to' => ['required', 'string', 'max:20']]);
        Unidades::validarDecimales($d['qty'], $d['from']);

        return response()->json(['resultado' => Unidades::convertir((float) $d['qty'], $d['from'], $d['to'])]);
    }

    public function storeConversion(Request $request)
    {
        $d = $request->validate(['from_uom' => ['required', 'string', 'max:20'], 'to_uom' => ['required', 'string', 'max:20'],
            'factor' => ['required', 'numeric', 'gt:0', 'max:1000000'], 'note' => ['nullable', 'string', 'max:80']]);
        $c = Unidades::agregarConversion($d, $request->user());

        return response()->json(['id' => $c->id], 201);
    }

    public function sunat(Request $request)
    {
        $d = $request->validate(['catalogo' => ['nullable', Rule::in(array_keys(self::CATALOGOS))]]);
        $cat = $d['catalogo'] ?? '01';
        $hoy = TiposDeCambio::hoy();
        $presentes = DB::table('sunat_catalog_items')->distinct()->pluck('catalog')->flip();

        return response()->json([
            'catalogo' => $cat,
            'catalogos' => collect(self::CATALOGOS)->filter(fn ($n, $c) => isset($presentes[$c]))->map(fn ($n, $c) => ['code' => (string) $c, 'name' => $n])->values(),
            'items' => DB::table('sunat_catalog_items')->where('catalog', $cat)->orderBy('code')->get(['id', 'catalog', 'code', 'description', 'valid_from', 'valid_to'])
                ->map(fn ($x) => (array) $x + ['vigente' => $x->valid_from <= $hoy && (! $x->valid_to || $x->valid_to >= $hoy)]),
        ]);
    }

    /** RN-MAE-12: ¿se puede usar este código en esa fecha? */
    public function validarSunat(Request $request)
    {
        $d = $request->validate(['catalogo' => ['required', 'string', 'max:4'], 'codigo' => ['required', 'string', 'max:10'], 'fecha' => ['required', 'date_format:Y-m-d']]);
        $x = Unidades::sunatVigente($d['catalogo'], trim($d['codigo']), $d['fecha']);

        return response()->json(['ok' => true, 'descripcion' => $x->description]);
    }

    public function ubigeo(Request $request)
    {
        $f = $request->validate(['level' => ['nullable', Rule::in(['DEPARTMENT', 'PROVINCE', 'DISTRICT'])], 'department' => ['nullable', 'string', 'max:40']]);
        $q = DB::table('ubigeo as u')->select(['u.id', 'u.code', 'u.level', 'u.department', 'u.province', 'u.district'])
            ->selectSub(DB::table('customer_addresses as a')->whereColumn('a.ubigeo', 'u.code')->where('a.status', 'ACTIVE')->selectRaw('count(*)'), 'direcciones')
            ->when($f['level'] ?? null, fn ($w, $v) => $w->where('u.level', $v))
            ->when($f['department'] ?? null, fn ($w, $v) => $w->where('u.department', $v));

        return response()->json(Listado::de($q, $request, buscar: ['u.code', 'u.department', 'u.province', 'u.district'], ordenar: ['code', 'department', 'province', 'district'], porDefecto: 'code'));
    }

    public function ubigeoResumen()
    {
        $dist = fn ($p) => DB::table('ubigeo')->where('level', 'DISTRICT')->where('code', 'like', "{$p}%")->count();

        return response()->json([
            'lima' => $dist('1501'), 'callao' => $dist('0701'), 'arequipa' => $dist('0401'),
            'departamentos' => DB::table('ubigeo')->where('level', 'DEPARTMENT')->count(),
            'lista_departamentos' => DB::table('ubigeo')->distinct()->orderBy('department')->pluck('department'),
            'locales' => DB::table('establishments as s')->leftJoin('ubigeo as u', 'u.code', '=', 's.ubigeo')->where('s.status', 'ACTIVE')
                ->orderBy('s.code')->get(['s.short', 's.ubigeo', 'u.district']),
        ]);
    }

    public function entidades()
    {
        $medios = DB::table('payment_methods')->whereNotNull('institution_code')->get(['institution_code', 'name'])->groupBy('institution_code');

        return response()->json(DB::table('financial_institutions')->orderBy('sort_order')->get(['id', 'code', 'name', 'kind', 'ruc', 'cci_code', 'status'])
            ->map(fn ($f) => (array) $f + ['medios' => ($medios[$f->code] ?? collect())->pluck('name')->values()]));
    }
}
