<?php

namespace App\Modulos\Plt\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Plt\Models\Brand;
use App\Support\Listado;
use App\Support\Logos;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * PLT-05 Marcas: las marcas que facturan con el RUC de cada empresa, con su pie legal, nombre en
 * WhatsApp, web, color y orden. No se borran: se desactivan (RN-PLT-14). Una marca separada la
 * maneja SEP y aquí no se reactiva.
 */
class MarcaController extends Controller
{
    public function index(Request $request)
    {
        $query = $this->conUso(Brand::query())
            ->when($request->query('company_id'), fn ($q, $v) => $q->where('company_id', $v))
            ->when($request->query('status'), fn ($q, $v) => $q->where('status', $v));

        return response()->json(Listado::de($query, $request, buscar: ['code', 'name', 'whatsapp_display_name', 'website'],
            ordenar: ['sort_order', 'code', 'name', 'status', 'orders_count', 'documents_count'], porDefecto: 'sort_order'));
    }

    public function show(string $id)
    {
        $marca = $this->conUso(Brand::query())->findOrFail($id);
        $marca->setAttribute('series', DB::table('document_series')->where('brand_id', $id)->orderBy('series')->pluck('series'));

        return response()->json($marca);
    }

    public function store(Request $request)
    {
        $marca = Brand::create($this->validar($request));

        return response()->json($marca->fresh(), 201);
    }

    public function update(Request $request, string $id)
    {
        $marca = Brand::findOrFail($id);
        $datos = $this->validar($request, $marca);
        $marca->update($datos);

        return response()->json($marca->fresh());
    }

    /** Activa o desactiva varias marcas a la vez. Una marca separada no entra: la maneja SEP. */
    public function estado(Request $request)
    {
        $datos = $request->validate([
            'ids' => ['required', 'array', 'min:1', 'max:100'],
            'ids.*' => ['uuid'],
            'status' => ['required', Rule::in(['ACTIVE', 'INACTIVE'])],
        ], ['ids.required' => 'Elige al menos una marca.']);

        $marcas = Brand::whereIn('id', $datos['ids'])->get();
        abort_if($marcas->count() !== count(array_unique($datos['ids'])), 404, 'Alguna de las marcas ya no existe.');
        $separadas = $marcas->where('status', 'SEPARATED')->pluck('name');
        if ($separadas->isNotEmpty()) {
            throw ValidationException::withMessages(['ids' => 'Separada de la empresa, no cambia desde aquí: '.$separadas->join(', ').'.']);
        }
        $cambiadas = Brand::whereIn('id', $datos['ids'])->where('status', '!=', $datos['status'])
            ->update(['status' => $datos['status'], 'updated_at' => now()]);

        return response()->json(['cambiadas' => $cambiadas]);
    }

    /** El logo de la marca (PNG, JPG o WEBP), tal como se subió. */
    public function logo(string $id)
    {
        return Logos::servir('marcas', Brand::findOrFail($id)->logo_url);
    }

    /** Sube o cambia el logo. Se guarda como {código}.{extensión} en la carpeta del cliente. */
    public function subirLogo(Request $request, string $id)
    {
        $marca = Brand::findOrFail($id);
        $marca->update(['logo_url' => Logos::guardar($request, 'marcas', $marca->code, $marca->logo_url)]);

        return response()->json($this->conUso(Brand::query())->findOrFail($id));
    }

    public function quitarLogo(string $id)
    {
        $marca = Brand::findOrFail($id);
        Logos::borrar('marcas', $marca->logo_url);
        $marca->update(['logo_url' => null]);

        return response()->json($this->conUso(Brand::query())->findOrFail($id));
    }

    /** Empresa que factura y cuánto se usa la marca en los demás módulos. */
    private function conUso($query)
    {
        return $query->select('brands.*')->addSelect([
            // Tema propio de la marca (PLT-06). Sin él, la marca usa el de la empresa.
            'theme_name' => DB::table('ui_themes')->select('name')->whereColumn('ui_themes.brand_id', 'brands.id')
                ->where('ui_themes.status', 'ACTIVE')->orderByDesc('created_at')->limit(1),
            'company_name' => DB::table('companies')->select('trade_name')->whereColumn('companies.id', 'brands.company_id')->limit(1),
            'series_count' => DB::table('document_series')->selectRaw('count(*)')->whereColumn('document_series.brand_id', 'brands.id'),
            'products_count' => DB::table('products')->selectRaw('count(*)')->whereColumn('products.brand_id', 'brands.id'),
            'orders_count' => DB::table('sales_orders')->selectRaw('count(*)')->whereColumn('sales_orders.brand_id', 'brands.id'),
            'documents_count' => DB::table('sales_documents')->selectRaw('count(*)')->whereColumn('sales_documents.brand_id', 'brands.id'),
        ]);
    }

    private function validar(Request $request, ?Brand $marca = null): array
    {
        // El código no cambia después de crear la marca: lo usan series, productos y reportes.
        $request->merge(['code' => $marca ? $marca->code : mb_strtoupper(trim((string) $request->input('code')))]);

        $datos = $request->validate([
            'company_id' => ['required', 'uuid', 'exists:companies,id'],
            'code' => ['required', 'regex:/^[A-Z0-9]{2,6}$/', Rule::unique('brands', 'code')->ignore($marca?->id)],
            'name' => ['required', 'string', 'max:40'],
            'primary_color' => ['required', 'regex:/^#[0-9A-Fa-f]{6}$/'],
            'whatsapp_display_name' => ['required', 'string', 'max:40'],
            'website' => ['nullable', 'string', 'max:40'],
            'description' => ['nullable', 'string', 'max:500'],
            'legal_footer' => ['required', 'string', 'max:255'],
            'print_legends' => ['nullable', 'string', 'max:255'],
            'print_show_logo' => ['boolean'],
            'sort_order' => ['required', 'integer', 'min:1', 'max:999'],
            'status' => ['required', Rule::in(['ACTIVE', 'INACTIVE', 'SEPARATED'])],
        ], [
            // RN-PLT-14
            'company_id.exists' => 'La empresa no existe.',
            'code.regex' => 'El código tiene de 2 a 6 letras o números.',
            'code.unique' => 'Ya existe una marca con ese código.',
            'primary_color.regex' => 'El color va en formato #RRGGBB.',
            'legal_footer.required' => 'El pie legal es obligatorio: sale en el comprobante impreso.',
            'whatsapp_display_name.required' => 'El nombre en WhatsApp es obligatorio: es el que ve el cliente.',
        ]);

        // La separación de una marca la maneja SEP: aquí no se separa ni se reactiva una separada.
        $antes = $marca?->status;
        if (($datos['status'] === 'SEPARATED') !== ($antes === 'SEPARATED')) {
            throw ValidationException::withMessages(['status' => $antes === 'SEPARATED'
                ? 'Esta marca está separada de la empresa: no se reactiva desde aquí.'
                : 'Una marca se separa desde el proceso de separación de marcas, no desde aquí.']);
        }
        $datos['primary_color'] = mb_strtoupper($datos['primary_color']);

        return $datos;
    }
}
