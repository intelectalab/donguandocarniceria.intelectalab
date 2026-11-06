<?php

namespace App\Modulos\Plt\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Plt\Models\DocumentSeries;
use App\Modulos\Plt\Services\Correlativo;
use App\Support\Listado;
use App\Support\Params;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * PLT-08 Series: por empresa, tipo de documento, local y marca. El correlativo lo toma
 * Correlativo::emitir() al emitir (RN-PLT-03). Una serie no se borra ni se renumera: se desactiva
 * con un motivo.
 */
class SerieController extends Controller
{
    /** Tipos de documento. Los electrónicos llevan el formato de serie que pide SUNAT (RN-PLT-04). */
    public const TIPOS = [
        'INVOICE' => '/^F[A-Z0-9]{3}$/',
        'RECEIPT' => '/^B[A-Z0-9]{3}$/',
        'CREDIT_NOTE' => '/^[FB]C[A-Z0-9]{2}$/',
        'DEBIT_NOTE' => '/^[FB]D[A-Z0-9]{2}$/',
        'DISPATCH_GUIDE' => '/^T[A-Z0-9]{3}$/',
        'INTERNAL_NOTE' => null,
        'PURCHASE_ORDER' => null,
        'PRODUCTION_ORDER' => null,
        'QUOTE' => null,
        'CONSIGNMENT_NOTE' => null,
        'JOURNAL' => null,
    ];

    private const EJEMPLOS = [
        'INVOICE' => 'F y 3 letras o números, por ejemplo F006',
        'RECEIPT' => 'B y 3 letras o números, por ejemplo B011',
        'CREDIT_NOTE' => 'FC o BC y 2 letras o números, por ejemplo FC01',
        'DEBIT_NOTE' => 'FD o BD y 2 letras o números, por ejemplo FD01',
        'DISPATCH_GUIDE' => 'T y 3 letras o números, por ejemplo T003',
    ];

    public function index(Request $request)
    {
        $query = $this->conNombres(DocumentSeries::query())
            ->when($request->query('company_id'), fn ($q, $v) => $q->where('company_id', $v))
            ->when($request->query('doc_type'), fn ($q, $v) => $q->where('doc_type', $v))
            ->when($request->query('establishment_id'), fn ($q, $v) => $q->where('establishment_id', $v))
            ->when($request->query('brand_id'), fn ($q, $v) => $q->where('brand_id', $v))
            ->when($request->query('status'), fn ($q, $v) => $q->where('status', $v));

        return response()->json(Listado::de($query, $request, buscar: ['series', 'note'],
            ordenar: ['series', 'doc_type', 'next_number', 'status'], porDefecto: 'series'));
    }

    /** Totales de la cabecera: series, activas, electrónicas y las que pasan el aviso de uso (RN-PLT-20). */
    /**
     * Cifras de la cabecera de PLT-08: series, la más cargada (KPI-PLT-02), cuántas pasan el aviso y
     * cuántos documentos se numeraron en este sistema.
     */
    public function resumen()
    {
        $aviso = (float) (Params::get('plt_series_alert_pct') ?? 95);
        $desde = (int) ceil($aviso / 100 * Correlativo::MAXIMO) + 1;
        // Documentos numerados aquí: se descuenta lo que viene del sistema anterior (legacy_last_number).
        // Una serie migrada sin ese dato y por encima de 90 millones no se cuenta (como en el prototipo).
        $t = DB::table('document_series')->selectRaw(
            "count(*) as total, count(*) filter (where status = 'ACTIVE') as activas, count(*) filter (where is_electronic) as electronicas,
             count(*) filter (where status = 'ACTIVE' and next_number >= ?) as sobre_aviso,
             coalesce(sum(greatest(next_number - 1 - coalesce(legacy_last_number, 0), 0))
                 filter (where legacy_last_number is not null or next_number - 1 <= 90000000), 0) as numerados", [$desde])->first();

        // KPI-PLT-02: uso de la serie activa más cargada, (siguiente − 1) / 99 999 999.
        $mayor = DB::table('document_series')->where('status', 'ACTIVE')->orderByDesc('next_number')->orderBy('series')
            ->first(['series', 'next_number']);

        return response()->json([
            'total' => (int) $t->total, 'activas' => (int) $t->activas, 'electronicas' => (int) $t->electronicas,
            'sobre_aviso' => (int) $t->sobre_aviso, 'aviso_pct' => $aviso, 'maximo' => Correlativo::MAXIMO,
            'numerados' => (int) $t->numerados,
            'mas_cargada' => $mayor ? ['series' => $mayor->series, 'uso' => round(Correlativo::uso((int) $mayor->next_number), 2)] : null,
        ]);
    }

    public function show(string $id)
    {
        $serie = $this->conNombres(DocumentSeries::query())->findOrFail($id);
        $serie->setAttribute('ultimos', DB::table('sales_documents')->where('series_id', $id)
            ->orderByDesc('number')->limit(8)->get(['id', 'full_number', 'customer_name', 'total', 'issue_date', 'status']));

        return response()->json($serie);
    }

    public function store(Request $request)
    {
        $request->merge(['series' => mb_strtoupper(trim((string) $request->input('series')))]);
        $tipo = (string) $request->input('doc_type');
        $empresa = $request->input('company_id');
        $electronica = $request->boolean('is_electronic');

        $datos = $request->validate([
            'company_id' => ['required', 'uuid', 'exists:companies,id'],
            'doc_type' => ['required', Rule::in(array_keys(self::TIPOS))],
            'is_electronic' => ['boolean', function (string $a, mixed $v, Closure $fail) use ($tipo) {
                if ($v && array_key_exists($tipo, self::TIPOS) && self::TIPOS[$tipo] === null) {
                    $fail('Este tipo de documento no es electrónico: no se envía a SUNAT.');
                }
            }],
            'series' => ['required', function (string $a, mixed $v, Closure $fail) use ($tipo, $electronica) {
                $formato = self::TIPOS[$tipo] ?? null;
                if ($electronica && $formato) {
                    if (! preg_match($formato, $v)) {
                        $fail("La serie {$v} no tiene el formato que pide SUNAT: ".self::EJEMPLOS[$tipo].'.');
                    }
                } elseif (! preg_match('/^[A-Z0-9]{2,4}$/', $v)) {
                    $fail('Una serie interna tiene de 2 a 4 letras o números.');
                }
            }, Rule::unique('document_series', 'series')],
            // El local y la marca tienen que ser de la misma empresa.
            'establishment_id' => ['nullable', 'uuid', Rule::exists('establishments', 'id')->where('company_id', $empresa)],
            'brand_id' => ['nullable', 'uuid', Rule::exists('brands', 'id')->where('company_id', $empresa)],
            'next_number' => ['required', 'integer', 'min:1', 'max:'.Correlativo::MAXIMO],
            'note' => ['nullable', 'string', 'max:255'],
        ], [
            // RN-PLT-04
            'company_id.exists' => 'La empresa no existe.',
            'series.unique' => 'Esa serie ya existe.',
            'establishment_id.exists' => 'El local no es de esa empresa.',
            'brand_id.exists' => 'La marca no es de esa empresa.',
            'next_number.max' => 'El correlativo llega hasta 99 999 999.',
        ]);

        $datos['is_electronic'] = $electronica;
        $datos['status'] = 'ACTIVE';
        // Una nota de crédito o débito se aplica a facturas (F…) o a boletas (B…).
        if (in_array($tipo, ['CREDIT_NOTE', 'DEBIT_NOTE'], true)) {
            $datos['applies_to'] = str_starts_with($datos['series'], 'F') ? 'INVOICE' : 'RECEIPT';
        }

        return response()->json(DocumentSeries::create($datos)->fresh(), 201);
    }

    /** Activa o desactiva una serie, con el motivo. Una serie inactiva no numera (RN-PLT-03). */
    /** Activa o desactiva una serie, con su motivo. */
    public function estado(Request $request, string $id)
    {
        DocumentSeries::findOrFail($id);
        $request->merge(['ids' => [$id]]);
        $this->cambiarEstado($request);

        return response()->json(DocumentSeries::find($id));
    }

    /** Activa o desactiva varias series a la vez, con un mismo motivo. */
    public function estadoVarias(Request $request)
    {
        return response()->json(['cambiadas' => $this->cambiarEstado($request)]);
    }

    private function cambiarEstado(Request $request): int
    {
        $datos = $request->validate([
            'ids' => ['required', 'array', 'min:1', 'max:200'],
            'ids.*' => ['uuid'],
            'status' => ['required', Rule::in(['ACTIVE', 'INACTIVE'])],
            'reason' => ['required', 'string', 'min:10', 'max:40'],
        ], [
            'ids.required' => 'Elige al menos una serie.',
            'reason.required' => 'Escribe el motivo.',
            'reason.min' => 'El motivo tiene al menos 10 caracteres.',
            'reason.max' => 'El motivo tiene como máximo 40 caracteres.',
        ]);
        $existen = DocumentSeries::whereIn('id', $datos['ids'])->count();
        abort_if($existen !== count(array_unique($datos['ids'])), 404, 'Alguna de las series ya no existe.');

        return DocumentSeries::whereIn('id', $datos['ids'])->where('status', '!=', $datos['status'])
            ->update(['status' => $datos['status'], 'status_reason' => $datos['reason'], 'updated_at' => now()]);
    }

    private function conNombres($query)
    {
        return $query->select('document_series.*')->addSelect([
            'company_name' => DB::table('companies')->select('trade_name')->whereColumn('companies.id', 'document_series.company_id')->limit(1),
            'establishment_name' => DB::table('establishments')->select('short')->whereColumn('establishments.id', 'document_series.establishment_id')->limit(1),
            'brand_name' => DB::table('brands')->select('name')->whereColumn('brands.id', 'document_series.brand_id')->limit(1),
        ]);
    }
}
