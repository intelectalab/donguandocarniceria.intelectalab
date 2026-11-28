<?php

namespace App\Modulos\Fac\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Fac\Services\Catalogos;
use App\Modulos\Fac\Services\Consultas;
use App\Modulos\Fac\Services\Plantillas;
use App\Modulos\Plt\Http\Controllers\SerieController;
use App\Modulos\Plt\Services\Correlativo;
use App\Modulos\Plt\Services\Periodos;
use App\Support\Exportar;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** FAC-10 Series, FAC-11 Plantillas impresas y FAC-12 Comprobantes del período. */
class ConfigController extends Controller
{
    public const TIPOS_FAC = ['INVOICE', 'RECEIPT', 'CREDIT_NOTE', 'DEBIT_NOTE', 'DISPATCH_GUIDE'];

    /** FAC-10: series electrónicas con su correlativo siguiente, uso y último emitido. */
    public function series(Request $request)
    {
        $filas = DB::table('document_series as s')->leftJoin('brands as b', 'b.id', '=', 's.brand_id')->leftJoin('establishments as e', 'e.id', '=', 's.establishment_id')
            ->whereIn('s.doc_type', self::TIPOS_FAC)
            ->when($request->query('doc_type'), fn ($w, $v) => $w->where('s.doc_type', $v))
            ->when($request->query('brand') && $request->query('brand') !== 'ALL', fn ($w) => $w->where('s.brand_id', $request->query('brand')))
            ->orderBy('s.doc_type')->orderBy('s.series')
            ->get(['s.id', 's.series', 's.doc_type', 's.brand_id', 'b.name as brand', 's.establishment_id', 'e.short as site', 's.all_sites', 's.applies_to',
                's.next_number', 's.status', 's.status_reason', 's.is_electronic', 's.note', 's.company_id',
                DB::raw('(select max(d.issued_at) from sales_documents d where d.series_id = s.id) as ultimo'),
                DB::raw('(select count(*) from sales_documents d where d.series_id = s.id) + (select count(*) from dispatch_guides g where g.series_id = s.id) as emitidos')]);

        return response()->json([
            'series' => $filas->map(fn ($s) => (array) $s + ['tipo' => Catalogos::TIPOS[$s->doc_type] ?? 'Guía de remisión', 'uso' => Correlativo::uso((int) $s->next_number)]),
            'opciones' => [
                'empresas' => DB::table('companies')->get(['id', 'legal_name', 'ruc']),
                'marcas' => DB::table('brands')->where('status', 'ACTIVE')->orderBy('sort_order')->get(['id', 'name']),
                'locales' => DB::table('establishments')->where('status', 'ACTIVE')->orderBy('code')->get(['id', 'name', 'short']),
            ],
        ]);
    }

    /** Crea una serie con las reglas de PLT-08 (formato SUNAT, única, local y marca de la empresa). */
    public function crearSerie(Request $request)
    {
        $request->validate(['doc_type' => ['required', 'in:'.implode(',', self::TIPOS_FAC)]], ['doc_type.in' => 'En FAC se crean series de comprobantes y guías.']);
        $request->merge(['is_electronic' => true]);

        return app(SerieController::class)->store($request);
    }

    public function estadoSerie(Request $request, string $id)
    {
        $s = DB::table('document_series')->where('id', $id)->whereIn('doc_type', self::TIPOS_FAC)->first() ?? abort(404);

        return app(SerieController::class)->estado($request, $s->id);
    }

    /* ---------------------------------------------------------------- FAC-11 */

    public function plantillas(Request $request)
    {
        return response()->json(Plantillas::lista($request->user()));
    }

    public function guardarPlantilla(Request $request, string $brandId)
    {
        $d = $request->validate(['legal_footer' => ['required', 'string', 'max:255'], 'print_legends' => ['nullable', 'string', 'max:255'], 'print_show_logo' => ['boolean']],
            ['legal_footer.required' => 'El pie legal es obligatorio: sale en el comprobante impreso.']);

        return response()->json(Plantillas::guardar($brandId, $d, $request->user()));
    }

    /* ---------------------------------------------------------------- FAC-12 */

    public function periodo(Request $request)
    {
        $d = $request->validate(['month' => ['nullable', 'date_format:Y-m']]);

        return response()->json(Consultas::periodo($d['month'] ?? now('America/Lima')->format('Y-m'), $request->user(), $request->query('brand'), $request->query('site')));
    }

    public function exportarPeriodo(Request $request)
    {
        $d = $request->validate(['month' => ['nullable', 'date_format:Y-m']]);
        $u = $request->user();
        $p = Consultas::periodo($d['month'] ?? now('America/Lima')->format('Y-m'), $u, $request->query('brand'), $request->query('site'));
        $resumen = collect($p['filas'])->map(fn ($f) => [Catalogos::TIPOS[$f->doc_type] ?? $f->doc_type, $f->marca, Catalogos::ESTADOS_SUNAT[$f->sunat_status] ?? $f->sunat_status,
            $f->status === 'VOIDED' ? 'Anulado' : 'Emitido', (int) $f->cantidad, $f->desde.' a '.$f->hasta, (float) $f->subtotal, (float) $f->igv, (float) $f->total]);
        $detalle = DB::table('sales_documents as d')->leftJoin('sales_documents as r', 'r.id', '=', 'd.related_document_id')
            ->whereBetween('d.issue_date', [$p['desde'], $p['hasta']])
            ->when($request->query('brand') && $request->query('brand') !== 'ALL', fn ($w) => $w->where('d.brand_id', $request->query('brand')))
            ->orderBy('d.issue_date')->orderBy('d.full_number')->limit(50000)
            ->get(['d.issue_date', 'd.doc_type', 'd.full_number', 'd.brand_name', 'd.customer_doc_type', 'd.customer_doc_number', 'd.customer_name', 'd.subtotal', 'd.igv', 'd.total',
                'd.sunat_status', 'd.status', 'r.full_number as ref'])
            ->map(fn ($x) => [$x->issue_date, Catalogos::CODIGO[$x->doc_type] ?? '', $x->full_number, $x->brand_name, Catalogos::DOC_ID[$x->customer_doc_type] ?? '0',
                $x->customer_doc_number ?? '', $x->customer_name, (float) $x->subtotal, (float) $x->igv, (float) $x->total, $x->ref ?? '',
                Catalogos::ESTADOS_SUNAT[$x->sunat_status] ?? $x->sunat_status, $x->status === 'VOIDED' ? 'Anulado' : 'Emitido']);
        $mes = Periodos::nombre($p['desde']);

        return Exportar::libro("Comprobantes de {$mes}", $u)
            ->hoja('Resumen', columnas: [['titulo' => 'Tipo', 'ancho' => 16], ['titulo' => 'Marca', 'ancho' => 20], ['titulo' => 'Estado SUNAT', 'ancho' => 14, 'tipo' => 'centro'],
                ['titulo' => 'Estado', 'ancho' => 11, 'tipo' => 'centro'], ['titulo' => 'Cantidad', 'ancho' => 10, 'tipo' => 'numero'], ['titulo' => 'Rango', 'ancho' => 34],
                ['titulo' => 'Valor de venta', 'ancho' => 14, 'tipo' => 'soles'], ['titulo' => 'IGV', 'ancho' => 13, 'tipo' => 'soles'], ['titulo' => 'Total', 'ancho' => 14, 'tipo' => 'soles']],
                filas: $resumen, descripcion: 'Resumen por tipo, marca y estado SUNAT para la contadora', resumen: [
                    'Ventas' => 'S/ '.number_format($p['cifras']['ventas'], 2), 'Notas de crédito' => 'S/ '.number_format($p['cifras']['notas_credito'], 2),
                    'Neto' => 'S/ '.number_format($p['cifras']['neto'], 2), 'IGV' => 'S/ '.number_format($p['cifras']['igv'], 2)])
            ->hoja('Detalle', columnas: [['titulo' => 'Fecha', 'ancho' => 12, 'tipo' => 'fecha'], ['titulo' => 'Tipo SUNAT', 'ancho' => 10, 'tipo' => 'centro'], ['titulo' => 'Número', 'ancho' => 16],
                ['titulo' => 'Marca', 'ancho' => 18], ['titulo' => 'Tipo doc.', 'ancho' => 9, 'tipo' => 'centro'], ['titulo' => 'Documento', 'ancho' => 14], ['titulo' => 'Cliente', 'ancho' => 32],
                ['titulo' => 'Valor de venta', 'ancho' => 14, 'tipo' => 'soles'], ['titulo' => 'IGV', 'ancho' => 12, 'tipo' => 'soles'], ['titulo' => 'Total', 'ancho' => 14, 'tipo' => 'soles'],
                ['titulo' => 'Modifica a', 'ancho' => 16], ['titulo' => 'Estado SUNAT', 'ancho' => 13, 'tipo' => 'centro'], ['titulo' => 'Estado', 'ancho' => 11, 'tipo' => 'centro']],
                filas: $detalle, descripcion: 'Un renglón por comprobante (registro de ventas)', fijas: 3)
            ->descargar('comprobantes-'.substr($p['desde'], 0, 7));
    }
}
