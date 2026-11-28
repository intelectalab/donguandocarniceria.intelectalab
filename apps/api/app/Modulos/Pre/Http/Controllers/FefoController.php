<?php

namespace App\Modulos\Pre\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Pre\Services\Base;
use App\Modulos\Pre\Services\Escaneo;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/** PRE-12 Autorizaciones FEFO: lecturas bloqueadas por FEFO para que la supervisora autorice o pida otro lote (RN-PRE-05). */
class FefoController extends Controller
{
    public function index(Request $request)
    {
        $d = $request->validate(['vista' => ['nullable', Rule::in(['PENDIENTES', 'RESUELTAS'])]]);
        $q = DB::table('picking_scans as s')->join('picking_tasks as t', 't.id', '=', 's.task_id')->join('product_variants as v', 'v.id', '=', 's.variant_id')
            ->leftJoin('lots as l', 'l.id', '=', 's.lot_id')->leftJoin('lots as g', 'g.id', '=', 's.suggested_lot_id')->leftJoin('users as u', 'u.id', '=', 's.user_id')
            ->leftJoin('picking_waves as w', 'w.id', '=', 's.wave_id')
            ->where('s.result', 'NOT_FEFO')->whereNull('s.override_of');
        if (($d['vista'] ?? 'PENDIENTES') === 'PENDIENTES') {
            $q->whereIn('t.status', ['PENDING', 'PICKING'])->whereNotExists(fn ($x) => $x->from('picking_scans as r')->whereColumn('r.override_of', 's.id'));
        } else {
            $q->whereExists(fn ($x) => $x->from('picking_scans as r')->whereColumn('r.override_of', 's.id'))->where('s.scanned_at', '>=', now()->subDays(30));
        }
        Base::alcanceTareas($q, $request->user());
        $filas = $q->orderByDesc('s.scanned_at')->limit(200)->get(['s.id', 's.task_id', 's.barcode', 's.weight_kg', 's.scanned_at', 's.message', 't.order_number',
            'v.name', 'v.sku', 'l.code as lote', 'l.expiry_date as vence', 'g.code as lote_sugerido', 'g.expiry_date as vence_sugerido', 'u.name as preparador', 'w.number as ola']);
        $resol = DB::table('picking_scans as r')->leftJoin('users as u', 'u.id', '=', 'r.override_by')->whereIn('r.override_of', $filas->pluck('id'))
            ->get(['r.override_of', 'r.result', 'r.error_code', 'r.override_reason', 'r.scanned_at', 'u.name as supervisora'])->keyBy('override_of');

        return response()->json($filas->map(fn ($s) => (array) $s + ['resolucion' => isset($resol[$s->id]) ? [
            'autorizada' => $resol[$s->id]->error_code !== 'OVERRIDE_DENIED', 'resultado' => $resol[$s->id]->result, 'motivo' => $resol[$s->id]->override_reason,
            'supervisora' => $resol[$s->id]->supervisora, 'at' => $resol[$s->id]->scanned_at] : null])->values());
    }

    public function autorizar(Request $request, string $id)
    {
        $d = $request->validate(['reason' => ['nullable', 'string', 'max:255']]);

        return response()->json(Escaneo::autorizarFefo($id, $d['reason'] ?? null, $request->user()));
    }

    public function negar(Request $request, string $id)
    {
        $d = $request->validate(['reason' => ['nullable', 'string', 'max:255']]);

        return response()->json(Escaneo::negarFefo($id, $d['reason'] ?? null, $request->user()));
    }
}
