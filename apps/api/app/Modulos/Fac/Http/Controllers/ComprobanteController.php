<?php

namespace App\Modulos\Fac\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Fac\Services\Catalogos;
use App\Modulos\Fac\Services\Consultas;
use App\Modulos\Fac\Services\Emision;
use App\Modulos\Fac\Services\Envios;
use App\Modulos\Fac\Services\Notas;
use App\Modulos\Fac\Services\Resumenes;
use App\Support\Exportar;
use App\Support\Listado;
use App\Support\Logos;
use App\Support\Params;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** FAC-01 Comprobantes, FAC-04 Detalle, FAC-05 y FAC-06 Notas. Reglas en Services. */
class ComprobanteController extends Controller
{
    public function index(Request $request)
    {
        $q = Consultas::comprobantes($request, $request->user())->select(Consultas::columnas());

        return response()->json(Listado::de($q, $request, buscar: ['d.full_number', 'd.customer_name', 'd.customer_doc_number', 'd.pos_ticket'],
            ordenar: ['issue_date', 'issued_at', 'full_number', 'total', 'customer_name', 'sunat_status', 'doc_type'], porDefecto: '-issue_date'));
    }

    public function resumen(Request $request)
    {
        return response()->json(Consultas::totales($request, $request->user()));
    }

    public function exportar(Request $request)
    {
        $u = $request->user();
        $filas = Consultas::comprobantes($request, $u)->orderBy('d.issue_date')->orderBy('d.full_number')->limit(20000)
            ->get(Consultas::columnas())->map(fn ($d) => [$d->issue_date, Catalogos::TIPOS[$d->doc_type] ?? $d->doc_type, $d->full_number, $d->brand_name, $d->site,
                $d->customer_doc_type === 'NONE' ? '' : $d->customer_doc_type.' '.$d->customer_doc_number, $d->customer_name,
                (float) $d->subtotal, (float) $d->igv, (float) $d->total, Catalogos::ESTADOS_SUNAT[$d->sunat_status] ?? $d->sunat_status, $d->status === 'VOIDED' ? 'Anulado' : 'Emitido']);
        $t = Consultas::totales($request, $u);

        return Exportar::libro('Comprobantes', $u)->hoja('Comprobantes', columnas: [
            ['titulo' => 'Fecha', 'ancho' => 12, 'tipo' => 'fecha'], ['titulo' => 'Tipo', 'ancho' => 16], ['titulo' => 'Número', 'ancho' => 16],
            ['titulo' => 'Marca', 'ancho' => 18], ['titulo' => 'Local', 'ancho' => 12], ['titulo' => 'Documento', 'ancho' => 18], ['titulo' => 'Cliente', 'ancho' => 34],
            ['titulo' => 'Valor de venta', 'ancho' => 14, 'tipo' => 'soles'], ['titulo' => 'IGV', 'ancho' => 12, 'tipo' => 'soles'], ['titulo' => 'Total', 'ancho' => 14, 'tipo' => 'soles'],
            ['titulo' => 'Estado SUNAT', 'ancho' => 14, 'tipo' => 'centro'], ['titulo' => 'Estado', 'ancho' => 12, 'tipo' => 'centro'],
        ], filas: $filas, descripcion: 'Facturas, boletas y notas con el RUC de la empresa', resumen: [
            'Comprobantes' => $t['comprobantes'], 'Ventas' => 'S/ '.number_format($t['ventas'], 2), 'Notas de crédito' => 'S/ '.number_format($t['notas'], 2),
            'Pendientes de envío' => $t['pendientes'],
        ], fijas: 3)->descargar('comprobantes');
    }

    public function show(Request $request, string $id)
    {
        return response()->json(Consultas::ficha($id, $request->user()));
    }

    public function xml(Request $request, string $id)
    {
        $d = $this->doc($request, $id);

        return response(Consultas::xml($d), 200, ['Content-Type' => 'application/xml; charset=UTF-8',
            'Content-Disposition' => 'attachment; filename="'.$this->archivo($d).'.xml"', 'X-Content-Type-Options' => 'nosniff']);
    }

    public function cdr(Request $request, string $id)
    {
        $d = $this->doc($request, $id);

        return response(Consultas::cdr($d), 200, ['Content-Type' => 'application/xml; charset=UTF-8',
            'Content-Disposition' => 'attachment; filename="R-'.$this->archivo($d).'.xml"', 'X-Content-Type-Options' => 'nosniff']);
    }

    public function reenviar(Request $request, string $id)
    {
        $this->doc($request, $id);
        $d = Envios::enviar($id, $request->user(), true);

        return response()->json(Consultas::ficha($d->id, $request->user()));
    }

    public function reemitir(Request $request, string $id)
    {
        return response()->json(Resumenes::reemitir($id, $request->user()), 201);
    }

    public function anular(Request $request, string $id)
    {
        $d = $request->validate(['reason' => ['required', 'string', 'min:5', 'max:255']], ['reason.min' => 'Anular exige motivo (al menos 5 letras).']);

        return response()->json(Resumenes::anular($id, $d['reason'], $request->user()));
    }

    public function notaCredito(Request $request, string $id)
    {
        return response()->json(Notas::emitir('CREDIT_NOTE', $id, $this->nota($request), $request->user()), 201);
    }

    public function notaDebito(Request $request, string $id)
    {
        return response()->json(Notas::emitir('DEBIT_NOTE', $id, $this->nota($request), $request->user()), 201);
    }

    public function notaPeso(Request $request, string $id)
    {
        $d = $request->validate([
            'claims' => ['required', 'array', 'min:1', 'max:80'], 'claims.*.line_id' => ['required', 'uuid'], 'claims.*.real_kg' => ['required', 'numeric', 'min:0'],
            'reason' => ['nullable', 'string', 'max:255'],
        ]);

        return response()->json(Notas::porPeso($id, $d['claims'], (string) ($d['reason'] ?? ''), $request->user()), 201);
    }

    /** Catálogos para FAC-05 y FAC-06, almacenes para el reingreso y la serie que tocaría. */
    public function motivos(Request $request, string $id)
    {
        $f = Consultas::ficha($id, $request->user());
        $d = $f['documento'];
        $serie = fn ($t) => rescue(fn () => Emision::serie($t, $d->brand_id, $d->establishment_id, ['applies_to' => $d->doc_type])->series, null, false);

        return response()->json($f + [
            'cat09' => Catalogos::CAT09, 'cat10' => Catalogos::CAT10, 'devolucion' => Catalogos::DEVOLUCION,
            'peso' => str_pad((string) (Params::get('fac_weight_credit_note_reason') ?? '09'), 2, '0', STR_PAD_LEFT),
            'serie_nc' => $serie('CREDIT_NOTE'), 'serie_nd' => $serie('DEBIT_NOTE'),
            'almacenes' => DB::table('warehouses')->where('establishment_id', $d->establishment_id)->where('status', 'ACTIVE')
                ->whereIn('wh_type', ['RETURNS', 'COLD_ROOM', 'MAIN', 'FREEZER'])->orderByRaw("CASE wh_type WHEN 'RETURNS' THEN 0 ELSE 1 END")->orderBy('code')
                ->get(['id', 'code', 'name', 'wh_type']),
        ]);
    }

    public function logo(string $id)
    {
        $m = DB::table('brands')->where('id', $id)->first(['logo_url']) ?? abort(404);

        return Logos::servir('marcas', $m->logo_url);
    }

    private function nota(Request $request): array
    {
        return $request->validate([
            'reason_code' => ['required', 'string', 'max:2'], 'reason' => ['required', 'string', 'min:5', 'max:255'],
            'lines' => ['nullable', 'array', 'max:80'], 'lines.*.line_id' => ['required', 'uuid'], 'lines.*.qty' => ['required', 'numeric', 'min:0'],
            'lines.*.amount' => ['nullable', 'numeric', 'min:0'],
            'amount' => ['nullable', 'numeric', 'min:0'], 'restock' => ['nullable', 'boolean'], 'warehouse_id' => ['nullable', 'uuid'],
            'customer_id' => ['nullable', 'uuid'], 'series_id' => ['nullable', 'uuid'],
        ], ['reason.min' => 'Escribe el sustento de la nota (al menos 5 letras).']);
    }

    private function doc(Request $request, string $id): object
    {
        $d = DB::table('sales_documents')->where('id', $id)->first() ?? abort(404);
        Emision::alcance($request->user(), $d->brand_id, $d->establishment_id);

        return $d;
    }

    private function archivo(object $d): string
    {
        return DB::table('companies')->where('id', $d->company_id)->value('ruc').'-'.(Catalogos::CODIGO[$d->doc_type] ?? '00').'-'.$d->full_number;
    }
}
