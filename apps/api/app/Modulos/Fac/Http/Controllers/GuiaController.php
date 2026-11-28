<?php

namespace App\Modulos\Fac\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Fac\Services\Catalogos;
use App\Modulos\Fac\Services\Guias;
use App\Support\Access;
use App\Support\Listado;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** FAC-09 Guía de remisión remitente. Reglas en Services\Guias. */
class GuiaController extends Controller
{
    public function index(Request $request)
    {
        $a = Access::for($request->user());
        $q = DB::table('dispatch_guides as g')->leftJoin('establishments as e', 'e.id', '=', 'g.establishment_id')->leftJoin('establishments as de', 'de.id', '=', 'g.dest_establishment_id')
            ->leftJoin('vehicles as v', 'v.id', '=', 'g.vehicle_id')->leftJoin('suppliers as s', 's.id', '=', 'g.carrier_supplier_id')
            ->leftJoin('sales_orders as o', 'o.id', '=', 'g.order_id')
            ->when($a['establishments'], fn ($w) => $w->whereIn('g.establishment_id', $a['establishments']))
            ->when($request->query('site') && $request->query('site') !== 'ALL', fn ($w) => $w->where('g.establishment_id', $request->query('site')))
            ->when($request->query('reason'), fn ($w, $v) => $w->where('g.transfer_reason_code', $v))
            ->when($request->query('sunat_status'), fn ($w, $v) => $w->where('g.sunat_status', $v))
            ->select(['g.id', 'g.full_number', 'g.issue_date', 'g.start_date', 'g.transfer_reason_code', 'g.transport_mode', 'g.dest_address', 'g.gross_weight_kg', 'g.packages',
                'g.status', 'g.sunat_status', 'g.transfer_ref', 'g.send_attempts', 'e.short as origen', 'de.short as destino', 'v.plate', 's.legal_name as transportista', 'o.number as pedido']);

        return response()->json(Listado::de($q, $request, buscar: ['g.full_number', 'g.dest_address', 'g.transfer_ref', 'o.number', 'v.plate'],
            ordenar: ['full_number', 'issue_date', 'gross_weight_kg'], porDefecto: '-full_number'));
    }

    public function show(string $id)
    {
        $g = DB::table('dispatch_guides as g')->leftJoin('establishments as e', 'e.id', '=', 'g.establishment_id')->leftJoin('establishments as de', 'de.id', '=', 'g.dest_establishment_id')
            ->leftJoin('vehicles as v', 'v.id', '=', 'g.vehicle_id')->leftJoin('employees as em', 'em.id', '=', 'g.driver_employee_id')
            ->leftJoin('suppliers as s', 's.id', '=', 'g.carrier_supplier_id')->leftJoin('customers as c', 'c.id', '=', 'g.recipient_customer_id')
            ->leftJoin('sales_orders as o', 'o.id', '=', 'g.order_id')->leftJoin('sales_documents as d', 'd.id', '=', 'g.sales_document_id')
            ->where('g.id', $id)->first(['g.*', 'e.name as origen', 'de.name as destino', 'v.plate', 'em.full_name as conductor', 'em.doc_number as conductor_dni',
                's.legal_name as transportista', 's.doc_number as transportista_ruc', 'c.full_name as destinatario', 'c.doc_type as destinatario_doc_type', 'c.doc_number as destinatario_doc',
                'o.number as pedido', 'd.full_number as comprobante']) ?? abort(404);
        $empresa = DB::table('companies')->where('id', $g->company_id)->first(['ruc', 'legal_name', 'fiscal_address']);

        return response()->json([
            'guia' => $g, 'motivo' => Catalogos::CAT20[$g->transfer_reason_code] ?? $g->transfer_reason_code, 'modalidad' => Catalogos::CAT18[$g->transport_mode] ?? $g->transport_mode,
            'lineas' => DB::table('dispatch_guide_lines as l')->leftJoin('lots as lo', 'lo.id', '=', 'l.lot_id')->where('l.guide_id', $id)->orderBy('l.created_at')
                ->get(['l.id', 'l.description', 'l.qty', 'l.uom_code', 'l.weight_kg', 'lo.code as lot']),
            'envios' => DB::table('einvoice_submissions')->where('guide_id', $id)->orderBy('attempt_no')->get(['attempt_no', 'requested_at', 'result', 'response_code', 'message']),
            'empresa' => $empresa,
        ]);
    }

    public function opciones(Request $request)
    {
        $a = Access::for($request->user());

        return response()->json([
            'motivos' => collect(Catalogos::motivosGuia())->map(fn ($c) => ['code' => $c, 'name' => Catalogos::CAT20[$c] ?? $c])->values(),
            'modalidades' => Catalogos::CAT18,
            'locales' => DB::table('establishments')->where('status', 'ACTIVE')->when($a['establishments'], fn ($w) => $w->whereIn('id', $a['establishments']))->orderBy('code')->get(['id', 'name', 'short', 'address', 'ubigeo', 'company_id']),
            'destinos' => DB::table('establishments')->where('status', 'ACTIVE')->orderBy('code')->get(['id', 'name', 'short', 'address', 'ubigeo']),
            'series' => DB::table('document_series')->where('doc_type', 'DISPATCH_GUIDE')->where('status', 'ACTIVE')->orderBy('series')->get(['id', 'series', 'establishment_id', 'all_sites', 'next_number']),
            'vehiculos' => DB::table('vehicles')->where('status', 'ACTIVE')->orderBy('plate')->get(['id', 'plate', 'vehicle_type', 'ownership', 'establishment_id']),
            'conductores' => DB::table('employees')->where('status', 'ACTIVE')->orderBy('full_name')->get(['id', 'full_name', 'doc_number', 'position']),
            'transportistas' => DB::table('suppliers')->where('status', 'ACTIVE')->whereIn('supplier_type', ['DELIVERY_COMPANY', 'VEHICLE_RENTAL', 'SERVICES'])->where('doc_type', 'RUC')
                ->orderBy('legal_name')->get(['id', 'legal_name', 'doc_number', 'supplier_type']),
            'transferencias' => DB::table('stock_transfers as t')->join('establishments as a', 'a.id', '=', 't.from_site')->join('establishments as b', 'b.id', '=', 't.to_site')
                ->where('t.requires_guide', true)->where('t.status', 'DRAFT')->whereNull('t.guide_number')
                ->when($a['establishments'], fn ($w) => $w->whereIn('t.from_site', $a['establishments']))
                ->orderBy('t.number')->get(['t.id', 't.number', 't.from_site', 't.to_site', 'a.short as origen', 'b.short as destino']),
            'hoy' => now('America/Lima')->toDateString(),
        ]);
    }

    public function desdePedido(string $id)
    {
        return response()->json(Guias::datosDePedido($id));
    }

    public function desdeTransferencia(string $id)
    {
        return response()->json(Guias::datosDeTransferencia($id));
    }

    public function store(Request $request)
    {
        $d = $this->datos($request, true);
        if (! empty($d['transfer_id'])) {
            $g = Guias::desdeTransferencia($d['transfer_id'], $d, $request->user());
        } else {
            $g = Guias::emitir($d, $request->user());
        }

        return response()->json($g, 201);
    }

    public function anular(Request $request, string $id)
    {
        $d = $request->validate(['reason' => ['required', 'string', 'min:5', 'max:255']], ['reason.min' => 'Anular exige motivo (al menos 5 letras).']);

        return response()->json(Guias::anular($id, $d['reason'], $request->user()));
    }

    private function datos(Request $request, bool $nueva): array
    {
        return $request->validate([
            'establishment_id' => ['required', 'uuid'], 'series_id' => ['nullable', 'uuid'], 'brand_id' => ['nullable', 'uuid'],
            'transfer_reason_code' => ['required', 'string', 'max:2'], 'transport_mode' => ['required', 'in:01,02'], 'start_date' => ['nullable', 'date_format:Y-m-d'],
            'carrier_supplier_id' => ['nullable', 'uuid'], 'vehicle_id' => ['nullable', 'uuid'], 'driver_employee_id' => ['nullable', 'uuid'],
            'driver_license' => ['nullable', 'string', 'max:20'], 'recipient_customer_id' => ['nullable', 'uuid'], 'dest_establishment_id' => ['nullable', 'uuid'],
            'dest_address' => ['nullable', 'string', 'max:255'], 'dest_ubigeo' => ['nullable', 'string', 'max:6'],
            'gross_weight_kg' => ['required', 'numeric', 'gt:0', 'max:100000'], 'packages' => ['required', 'integer', 'min:1', 'max:10000'],
            'order_id' => ['nullable', 'uuid'], 'sales_document_id' => ['nullable', 'uuid'], 'transfer_id' => ['nullable', 'uuid'], 'notes' => ['nullable', 'string', 'max:500'],
            'lines' => ['required', 'array', 'min:1', 'max:80'], 'lines.*.variant_id' => ['required', 'uuid'], 'lines.*.description' => ['nullable', 'string', 'max:250'],
            'lines.*.qty' => ['required', 'numeric', 'gt:0'], 'lines.*.uom_code' => ['nullable', 'in:KGM,NIU'], 'lines.*.weight_kg' => ['nullable', 'numeric', 'min:0'],
            'lines.*.lot_id' => ['nullable', 'uuid'],
        ], ['gross_weight_kg.required' => 'Escribe el peso bruto.', 'packages.required' => 'Escribe los bultos.', 'lines.required' => 'La guía necesita al menos un bien.']);
    }
}
