<?php

namespace App\Modulos\Etq\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Etq\Services\EtiquetasService as Etq;
use App\Modulos\Pro\Http\Controllers\Alcance;
use App\Support\Listado;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** ETQ-02 Impresión y ETQ-03 Historial de impresiones. */
class ImpresionController extends Controller
{
    use Alcance;

    private const REGLAS = ['template_id' => 'nullable|uuid', 'lot_id' => 'nullable|uuid', 'lot_code' => 'nullable|string|max:40', 'variant_id' => 'nullable|uuid',
        'net_weight_kg' => 'nullable|numeric|min:0.001|max:999', 'copies' => 'nullable|integer|min:1|max:500', 'printer_code' => 'nullable|string|max:40',
        'channel' => 'nullable|in:COUNTER,WHATSAPP,WEB,B2B', 'scale_equipment_id' => 'nullable|uuid', 'establishment_id' => 'nullable|uuid',
        'production_order_id' => 'nullable|uuid', 'source' => 'nullable|in:ETQ,PRO,ALM,POS,PRE'];

    /** Lotes para elegir al imprimir o al trazar: por código, producto o SKU. */
    public function lotes(Request $r)
    {
        $q = DB::table('lots as l')->join('products as p', 'p.id', '=', 'l.product_id')->join('product_variants as v', 'v.id', '=', 'l.variant_id')
            ->when($r->query('status'), fn ($x, $s) => $x->whereIn('l.qc_status', explode(',', $s)))
            ->when($r->query('origin'), fn ($x, $s) => $x->where('l.origin', $s))
            ->selectRaw('l.id, l.code, l.origin, l.qc_status, l.production_date, l.expiry_date, l.variant_id, l.production_order_ref, l.created_at,
                p.name as product_name, p.sanitary_authority, v.sku, v.name as variant_name, v.sale_mode, v.nominal_weight_kg,
                (SELECT sum(b.qty) FROM stock_balances b WHERE b.lot_id = l.id) as stock_qty');

        return response()->json(Listado::de(DB::query()->fromSub($q, 's'), $r, buscar: ['code', 'product_name', 'sku', 'production_order_ref'],
            ordenar: ['code', 'production_date', 'expiry_date', 'product_name', 'created_at'], porDefecto: '-created_at'));
    }

    public function previa(Request $r)
    {
        $a = Etq::armar($r->validate(self::REGLAS));
        unset($a['lot']->unit_cost);

        return response()->json(['fields' => $a['fields'], 'text' => $a['text'], 'payload' => $a['payload'], 'format' => $a['template']->format,
            'width_mm' => $a['template']->width_mm, 'height_mm' => $a['template']->height_mm, 'includes_qr' => (bool) $a['template']->includes_qr,
            'net_weight_kg' => $a['net_weight_kg'], 'price_per_kg' => $a['price_per_kg'], 'price' => $a['price'], 'barcode' => $a['barcode'], 'qr_url' => $a['qr_url'],
            'lot' => ['id' => $a['lot']->id, 'code' => $a['lot']->code, 'qc_status' => $a['lot']->qc_status, 'expiry_date' => $a['lot']->expiry_date],
            'variant' => $a['variant'], 'block' => $a['block']]);
    }

    public function store(Request $r)
    {
        return response()->json(Etq::imprimir($r->validate(self::REGLAS), $r->user()), 201);
    }

    public function reimprimir(Request $r, string $id)
    {
        $d = $r->validate(['reprint_reason' => 'required|string|max:255', 'copies' => 'nullable|integer|min:1|max:500', 'printer_code' => 'nullable|string|max:40']);
        $o = DB::table('label_prints')->where('id', $id)->first() ?? abort(404);
        $this->dentroDelAlcance($r, $o->establishment_id);

        return response()->json(Etq::imprimir(['reprint_of' => $id, 'source' => $o->source] + $d, $r->user()), 201);
    }

    public function index(Request $r)
    {
        $q = DB::table('label_prints as p')->join('label_templates as t', 't.id', '=', 'p.template_id')->join('lots as l', 'l.id', '=', 'p.lot_id')
            ->join('product_variants as v', 'v.id', '=', 'p.variant_id')->leftJoin('users as u', 'u.id', '=', 'p.printed_by')
            ->leftJoin('establishments as e', 'e.id', '=', 'p.establishment_id')->leftJoin('label_prints as o', 'o.id', '=', 'p.reprint_of')
            ->when($r->query('desde'), fn ($x, $d) => $x->where('p.printed_at', '>=', $d))
            ->when($r->query('hasta'), fn ($x, $d) => $x->where('p.printed_at', '<=', $d.' 23:59:59'))
            ->when($r->query('lot_id'), fn ($x, $d) => $x->where('p.lot_id', $d))
            ->when($r->query('reprints'), fn ($x) => $x->whereNotNull('p.reprint_of'))
            ->selectRaw('p.id, p.printed_at, p.copies, p.net_weight_kg, p.price, p.channel, p.barcode, p.printer_code, p.source, p.reprint_of, p.reprint_reason,
                p.production_order_ref, p.establishment_id, p.lot_id, t.code as template_code, t.name as template_name, t.format, l.code as lot_code, l.qc_status,
                v.sku, v.name as variant_name, u.name as printed_by_name, coalesce(e.short, e.name) as establishment_name, o.printed_at as original_printed_at');
        $this->porLocal($q, $r, 'p.establishment_id');

        return response()->json(Listado::de(DB::query()->fromSub($q, 's'), $r, buscar: ['lot_code', 'sku', 'variant_name', 'template_code', 'printed_by_name', 'production_order_ref'],
            ordenar: ['printed_at', 'lot_code', 'copies', 'template_code', 'printed_by_name'], porDefecto: '-printed_at'));
    }

    public function show(Request $r, string $id)
    {
        $p = Etq::impresion($id) ?? abort(404);
        $this->dentroDelAlcance($r, $p->establishment_id);
        $p->reprints = DB::table('label_prints as p')->leftJoin('users as u', 'u.id', '=', 'p.printed_by')->where('p.reprint_of', $id)->orderBy('p.printed_at')
            ->get(['p.id', 'p.printed_at', 'p.copies', 'p.reprint_reason', 'u.name as printed_by_name']);

        return response()->json($p);
    }
}
