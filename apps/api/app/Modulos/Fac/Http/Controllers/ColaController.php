<?php

namespace App\Modulos\Fac\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Fac\Services\Catalogos;
use App\Modulos\Fac\Services\Emision;
use App\Modulos\Fac\Services\Envios;
use App\Modulos\Fac\Services\Resumenes;
use App\Support\Access;
use App\Support\Params;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** FAC-07 Cola de envío y FAC-08 Resumen diario y bajas. */
class ColaController extends Controller
{
    public function index(Request $request)
    {
        $u = $request->user();
        $a = Access::for($u);
        $docs = Emision::filtrar(DB::table('sales_documents as d'), $u)
            ->where(fn ($w) => $w->where(fn ($x) => $x->where('d.sunat_status', 'PENDING')->where('d.status', 'ISSUED'))
                ->orWhere(fn ($x) => $x->where('d.sunat_status', 'REJECTED')->whereNull('d.reissued_by')))
            ->orderByDesc('d.needs_review')->orderBy('d.next_retry_at')->orderBy('d.issued_at')->limit(300)
            ->get(['d.id', 'd.doc_type', 'd.full_number', 'd.issue_date', 'd.issued_at', 'd.customer_name', 'd.total', 'd.brand_name', 'd.sunat_status', 'd.status',
                'd.send_attempts', 'd.last_attempt_at', 'd.next_retry_at', 'd.needs_review', 'd.sunat_code', 'd.sunat_message', 'd.summary_pending', 'd.source']);
        $guias = DB::table('dispatch_guides as g')->where(fn ($w) => $w->where(fn ($x) => $x->where('g.sunat_status', 'PENDING')->where('g.status', 'ISSUED'))->orWhere('g.sunat_status', 'REJECTED'))
            ->when($a['establishments'], fn ($w) => $w->whereIn('g.establishment_id', $a['establishments']))
            ->orderBy('g.next_retry_at')->limit(100)
            ->get(['g.id', 'g.full_number', 'g.issue_date', 'g.issued_at', 'g.transfer_reason_code', 'g.sunat_status', 'g.send_attempts', 'g.last_attempt_at', 'g.next_retry_at',
                'g.needs_review', 'g.sunat_code', 'g.sunat_message']);
        $ultimos = DB::table('einvoice_submissions as s')->leftJoin('sales_documents as d', 'd.id', '=', 's.document_id')->leftJoin('dispatch_guides as g', 'g.id', '=', 's.guide_id')
            ->leftJoin('sunat_daily_summaries as r', 'r.id', '=', 's.summary_id')
            ->orderByDesc('s.requested_at')->limit(20)
            ->get(['s.requested_at', 's.attempt_no', 's.result', 's.response_code', 's.message', 's.duration_ms', 's.manual', 's.requested_by_name',
                DB::raw('coalesce(d.full_number, g.full_number, r.identifier) as numero')]);

        return response()->json([
            'comprobantes' => $docs, 'guias' => $guias, 'ultimos' => $ultimos,
            'proveedor' => strtoupper((string) (Params::get('fac_einvoice_provider') ?? 'FAKE')),
            'esperas' => Catalogos::esperas(), 'max_intentos' => Catalogos::maxIntentos(), 'modo_boletas' => Catalogos::modoBoletas(),
            'cifras' => [
                'pendientes' => $docs->where('sunat_status', 'PENDING')->where('needs_review', false)->count() + $guias->where('sunat_status', 'PENDING')->where('needs_review', false)->count(),
                'revision' => $docs->where('sunat_status', 'PENDING')->where('needs_review', true)->count() + $guias->where('needs_review', true)->where('sunat_status', 'PENDING')->count(),
                'rechazados' => $docs->where('sunat_status', 'REJECTED')->count() + $guias->where('sunat_status', 'REJECTED')->count(),
                'resumen' => $docs->where('summary_pending', true)->count(),
                'mas_24h' => $docs->where('sunat_status', 'PENDING')->filter(fn ($d) => $d->issued_at && strtotime($d->issued_at) < time() - 86400)->count(),
            ],
        ]);
    }

    /** Procesa ahora la cola (lo mismo que hace el programador cada minuto). */
    public function procesar()
    {
        return response()->json(Envios::procesar());
    }

    public function reenviarGuia(Request $request, string $id)
    {
        return response()->json(Envios::enviarGuia($id, $request->user(), true));
    }

    /* ---------------------------------------------------------------- FAC-08 */

    public function resumenes(Request $request)
    {
        $filas = DB::table('sunat_daily_summaries as s')
            ->when($request->query('type'), fn ($w, $v) => $w->where('s.summary_type', $v))
            ->orderByDesc('s.reference_date')->orderByDesc('s.created_at')->limit(200)
            ->get(['s.*', DB::raw('(select count(*) from sunat_daily_summary_lines l where l.summary_id = s.id) as documentos'),
                DB::raw('(select coalesce(sum(d.total), 0) from sunat_daily_summary_lines l join sales_documents d on d.id = l.document_id where l.summary_id = s.id) as total')]);
        $porInformar = DB::table('sales_documents')->where('doc_type', 'RECEIPT')->where('summary_pending', true)->where('sunat_status', 'PENDING')->where('status', 'ISSUED')
            ->whereNotExists(fn ($w) => $w->from('sunat_daily_summary_lines as l')->whereColumn('l.document_id', 'sales_documents.id')->where('l.action', 'ADD'))
            ->groupBy('issue_date')->orderBy('issue_date')->get(['issue_date', DB::raw('count(*) as boletas'), DB::raw('sum(total) as total')]);

        return response()->json(['resumenes' => $filas, 'por_informar' => $porInformar, 'modo_boletas' => Catalogos::modoBoletas()]);
    }

    public function resumen(string $id)
    {
        $s = DB::table('sunat_daily_summaries')->where('id', $id)->first() ?? abort(404);
        $docs = DB::table('sunat_daily_summary_lines as l')->join('sales_documents as d', 'd.id', '=', 'l.document_id')->where('l.summary_id', $id)->orderBy('d.full_number')
            ->get(['d.id', 'd.doc_type', 'd.full_number', 'd.issue_date', 'd.customer_name', 'd.total', 'd.sunat_status', 'd.status', 'l.action', 'l.reason']);
        $envios = DB::table('einvoice_submissions')->where('summary_id', $id)->orderBy('attempt_no')->get(['attempt_no', 'requested_at', 'result', 'response_code', 'message', 'requested_by_name']);

        return response()->json(['resumen' => $s, 'documentos' => $docs, 'envios' => $envios]);
    }

    public function crearResumen(Request $request)
    {
        $d = $request->validate(['date' => ['required', 'date_format:Y-m-d']]);

        return response()->json(Resumenes::resumenDeBoletas($d['date'], $request->user()), 201);
    }

    public function enviarResumen(Request $request, string $id)
    {
        return response()->json(Resumenes::enviar($id, $request->user()));
    }

    public function consultarResumen(string $id)
    {
        return response()->json(Resumenes::consultar($id));
    }
}
