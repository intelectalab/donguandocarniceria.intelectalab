<?php

namespace App\Modulos\Pre\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Int\Services\Archivos;
use App\Modulos\Ped\Services\Estados;
use App\Modulos\Ped\Services\Pesos;
use App\Modulos\Pre\Services\Base;
use App\Modulos\Pre\Services\Despacho;
use App\Modulos\Pre\Services\Escaneo;
use App\Modulos\Pre\Services\Tareas;
use App\Support\RuleError;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * PRE-03 Lista por pedido, PRE-04 Armado con escaneo, PRE-05 Pesado, PRE-06 Bolsas y etiquetas,
 * PRE-07 Verificación y PRE-09 Faltantes.
 */
class TareaController extends Controller
{
    /** Tareas para los selectores: de una ola, de una fecha (por defecto hoy) y en ciertos estados. */
    public function index(Request $request)
    {
        $d = $request->validate(['fecha' => ['nullable', 'date_format:Y-m-d'], 'wave_id' => ['nullable', 'uuid'], 'estados' => ['nullable', 'string', 'max:120'],
            'establishment_id' => ['nullable', 'uuid']]);
        $estados = array_filter(explode(',', (string) ($d['estados'] ?? '')));
        $q = DB::table('picking_tasks as t')->join('picking_waves as w', 'w.id', '=', 't.wave_id')->join('sales_orders as o', 'o.id', '=', 't.order_id')
            ->where('w.status', '<>', 'CANCELLED')->where('w.status', '<>', 'DRAFT')
            ->when($d['wave_id'] ?? null, fn ($x, $v) => $x->where('t.wave_id', $v), fn ($x) => $x->where('w.wave_date', $d['fecha'] ?? Base::hoy()))
            ->when($estados, fn ($x) => $x->whereIn('t.status', $estados), fn ($x) => $x->where('t.status', '<>', 'CANCELLED'))
            ->when($d['establishment_id'] ?? null, fn ($x, $v) => $x->where('t.establishment_id', $v));
        Base::alcanceTareas($q, $request->user());
        $ts = $q->orderBy('t.slot_from')->orderBy('t.order_number')->limit(300)
            ->get(['t.*', 'w.number as wave_number', 'o.customer_id', 'o.status as order_status']);

        return response()->json($ts->map(fn ($t) => [
            'id' => $t->id, 'pedido' => $t->order_number, 'cliente' => Base::cliente($t->customer_id), 'estado' => $t->status, 'estado_pedido' => $t->order_status,
            'ola' => $t->wave_number, 'ruta' => $t->route_code, 'parada' => $t->stop_seq, 'avance' => Tareas::avance($t),
            'franja' => $t->slot_from ? substr($t->slot_from, 0, 5).'–'.substr((string) $t->slot_to, 0, 5) : null,
        ])->values());
    }

    /** PRE-03: el ticket de preparación del pedido, con sus lecturas, bolsas y lo que se puede hacer. */
    public function show(Request $request, string $id)
    {
        $u = $request->user();
        $t = Tareas::visible($id, $u);

        return response()->json(self::ficha($t, $u));
    }

    public static function ficha(object $t, $u): array
    {
        $t = Tareas::tarea($t->id);
        $o = DB::table('sales_orders as o')->leftJoin('customers as c', 'c.id', '=', 'o.customer_id')->leftJoin('customer_addresses as a', 'a.id', '=', 'o.address_id')
            ->leftJoin('brands as b', 'b.id', '=', 'o.brand_id')->leftJoin('delivery_zones as z', 'z.id', '=', 'o.zone_id')->where('o.id', $t->order_id)
            ->first(['o.id', 'o.number', 'o.status', 'o.fulfillment', 'o.delivery_date', 'o.slot_from', 'o.slot_to', 'o.notes', 'o.weight_diff_status', 'o.contact_phone',
                'o.estimated_total', 'o.final_total', 'o.seller_id', DB::raw('coalesce(c.trade_name, c.full_name) as cliente'), 'a.address_line as direccion', 'a.reference as referencia',
                'b.name as marca', 'z.name as zona']);
        $w = $t->wave_id ? DB::table('picking_waves')->where('id', $t->wave_id)->first(['id', 'number', 'status']) : null;
        $lineas = Tareas::lineas($t->id)->map(function ($l) use ($t) {
            $fefo = in_array($t->status, ['PENDING', 'PICKING'], true) && ! Tareas::lineaCompleta($l, $t->brand_id) ? (Escaneo::lotesFefo($t, $l->variant_id)[0] ?? null) : null;

            return [
                'id' => $l->id, 'sku' => $l->sku, 'name' => $l->name, 'sale_mode' => $l->sale_mode, 'requires_lot' => (bool) $l->requires_lot,
                'qty_required' => (float) $l->qty_required, 'qty_picked' => (float) $l->qty_picked, 'est_weight_kg' => $l->est_weight_kg !== null ? (float) $l->est_weight_kg : null,
                'weighed_kg' => $l->weighed_kg !== null ? (float) $l->weighed_kg : null, 'status' => $l->status, 'cut_notes' => $l->cut_notes, 'weighted' => (bool) $l->weighted,
                'price_basis' => $l->price_basis, 'complete' => Tareas::lineaCompleta($l, $t->brand_id), 'avance' => (int) round(Tareas::avanceLinea($l, $t->brand_id) * 100),
                'short_reason' => $l->short_reason, 'short_qty' => $l->short_qty !== null ? (float) $l->short_qty : null, 'short_requested_at' => $l->short_requested_at,
                'lote_sugerido' => $fefo ? ['code' => $fefo['lot_code'], 'vence' => $fefo['expiry_date'], 'almacen' => $fefo['almacen'], 'disponible' => $fefo['disponible']] : null,
            ];
        });
        $lecturas = DB::table('picking_scans as s')->leftJoin('users as u', 'u.id', '=', 's.user_id')->leftJoin('lots as l', 'l.id', '=', 's.lot_id')
            ->where('s.task_id', $t->id)->orderByDesc('s.scanned_at')->limit(40)
            ->get(['s.id', 's.scan_type', 's.barcode', 's.result', 's.error_code', 's.message', 's.weight_kg', 's.qty', 's.scanned_at', 's.override_of', 'u.name as usuario', 'l.code as lote']);
        $nombres = DB::table('users')->whereIn('id', array_filter([$t->preparer_user_id, $t->verified_by]))->pluck('name', 'id');

        return [
            'id' => $t->id, 'estado' => $t->status, 'wave' => $w, 'ruta' => $t->route_code, 'parada' => $t->stop_seq, 'route_key' => $t->route_key,
            'ruta_nombre' => Despacho::nombreRuta($t->route_key),
            'preparador' => $nombres[$t->preparer_user_id] ?? null, 'verificador' => $nombres[$t->verified_by] ?? null, 'preparer_user_id' => $t->preparer_user_id,
            'started_at' => $t->started_at, 'picked_at' => $t->picked_at, 'packed_at' => $t->packed_at, 'verified_at' => $t->verified_at, 'loaded_at' => $t->loaded_at,
            'parcel_count' => $t->parcel_count, 'parcel_type' => $t->parcel_type, 'foto' => (bool) $t->photo_file_id,
            'stock_moved' => (bool) $t->stock_moved, 'stock_error' => $t->stock_error, 'cancel_note' => $t->cancel_note,
            'pedido' => (array) $o + ['estado_nombre' => Estados::nombre($o->status)], 'lineas' => $lineas->values(), 'lecturas' => $lecturas,
            'bolsas' => Despacho::bolsas($t->id), 'sugerido' => Despacho::sugerir($t), 'avance' => Tareas::avance($t),
            'verifica_otro' => Base::bool('pre_verify_by_other', $t->brand_id),
        ];
    }

    /** PRE-04: una lectura del preparador. */
    public function escanear(Request $request, string $id)
    {
        $d = $request->validate(['code' => ['required', 'string', 'max:120'], 'lot_code' => ['nullable', 'string', 'max:60'], 'weight_kg' => ['nullable', 'numeric', 'min:0', 'max:99.999'],
            'qty' => ['nullable', 'integer', 'min:1', 'max:500'], 'device' => ['nullable', 'string', 'max:40']]);
        $u = $request->user();
        $r = Escaneo::escanear($id, $d, $u);

        return response()->json($r + ['tarea' => self::ficha(Tareas::tarea($id), $u)]);
    }

    /** PRE-05: líneas por peso de los pedidos de una ola o fecha, con su diferencia frente al estimado. */
    public function pesado(Request $request)
    {
        $d = $request->validate(['wave_id' => ['nullable', 'uuid'], 'fecha' => ['nullable', 'date_format:Y-m-d']]);
        $q = DB::table('picking_tasks as t')->join('picking_waves as w', 'w.id', '=', 't.wave_id')->join('sales_orders as o', 'o.id', '=', 't.order_id')
            ->where('t.status', '<>', 'CANCELLED')->whereNotIn('w.status', ['DRAFT', 'CANCELLED'])
            ->when($d['wave_id'] ?? null, fn ($x, $v) => $x->where('t.wave_id', $v), fn ($x) => $x->where('w.wave_date', $d['fecha'] ?? Base::hoy()))
            ->whereExists(fn ($x) => $x->from('picking_task_lines as l')->whereColumn('l.task_id', 't.id')->where('l.weighted', true));
        Base::alcanceTareas($q, $request->user());
        $ts = $q->orderBy('t.order_number')->limit(200)->get(['t.*', 'o.customer_id', 'o.weight_diff_status', 'o.status as order_status']);
        $filas = $ts->map(function ($t) {
            $o = DB::table('sales_orders')->where('id', $t->order_id)->first();
            $eval = collect(Pesos::evaluar($o)['lineas'])->keyBy('line_id');
            $paquetes = DB::table('picking_scans')->where('task_id', $t->id)->where('result', 'OK')->where('scan_type', 'PICK')->whereNotNull('weight_kg')
                ->groupBy('task_line_id')->selectRaw('task_line_id, count(*) n')->pluck('n', 'task_line_id');
            $lineas = Tareas::lineas($t->id)->where('weighted', true)->map(function ($l) use ($eval, $paquetes, $t) {
                $e = $eval[$l->order_line_id] ?? null;
                $est = $l->est_weight_kg !== null ? (float) $l->est_weight_kg : null;
                $real = $l->weighed_kg !== null ? (float) $l->weighed_kg : null;

                return ['id' => $l->id, 'sku' => $l->sku, 'name' => $l->name, 'sale_mode' => $l->sale_mode, 'qty' => (float) $l->qty_required,
                    'estimado_kg' => $est, 'real_kg' => $real, 'paquetes' => (int) ($paquetes[$l->id] ?? 0), 'complete' => Tareas::lineaCompleta($l, $t->brand_id),
                    'diferencia_pct' => $e['diferencia_pct'] ?? ($est && $real !== null ? round(($real - $est) / $est * 100, 1) : null),
                    'tolerancia_pct' => $e['tolerancia_pct'] ?? null, 'excede' => (bool) ($e['excede'] ?? false), 'cobra_por_kg' => $l->price_basis === 'KG'];
            })->values();

            return ['id' => $t->id, 'order_id' => $t->order_id, 'pedido' => $t->order_number, 'cliente' => Base::cliente($t->customer_id), 'estado' => $t->status,
                'estado_pedido' => $t->order_status, 'aviso' => $t->weight_diff_status, 'lineas' => $lineas];
        })->values();

        return response()->json(['filas' => $filas, 'cifras' => [
            'pedidos' => $filas->count(), 'aviso_requerido' => $filas->where('aviso', 'NOTICE_REQUIRED')->count(),
            'lineas' => $filas->sum(fn ($f) => count($f['lineas'])), 'pesadas' => $filas->sum(fn ($f) => collect($f['lineas'])->whereNotNull('real_kg')->count()),
        ]]);
    }

    /** PRE-06 */
    public function embolsar(Request $request, string $id)
    {
        $d = $request->validate(['count' => ['nullable', 'integer', 'min:1', 'max:20'], 'type' => ['nullable', Rule::in(array_keys(Base::BOLSAS))]]);
        $u = $request->user();
        Despacho::embolsar($id, $d['count'] ?? null, $d['type'] ?? null, $u);

        return response()->json(self::ficha(Tareas::tarea($id), $u));
    }

    /** PRE-07: verificación con la foto obligatoria (se guarda como archivo adjunto del pedido, INT-11). */
    public function verificar(Request $request, string $id)
    {
        $d = $request->validate(['photo' => ['nullable', 'file', 'max:20480'], 'parcel_count' => ['nullable', 'integer', 'min:1', 'max:20']]);
        $u = $request->user();
        $t = Tareas::visible($id, $u);
        $bolsas = isset($d['parcel_count']) ? (int) $d['parcel_count'] : null;
        $archivo = $request->file('photo');
        if (! $archivo) {
            RuleError::fail('RN-PRE-09', "Toma la foto del pedido {$t->order_number} armado: verificar exige la foto.");
        }
        // Primero las reglas, para no guardar una foto que no se usará.
        Despacho::revisarVerificacion($t, $bolsas, $u);
        $huella = hash_file('sha256', $archivo->getRealPath());
        $foto = DB::table('file_attachments')->where('entity', 'sales_orders')->where('entity_id', $t->order_id)->where('sha256', $huella)->where('status', 'ACTIVE')->value('id')
            ?? Archivos::subir($archivo, 'sales_orders', $t->order_id, 'INTERNAL', $u)['id'];
        Despacho::verificar($t->id, $foto, $bolsas, $u);

        return response()->json(self::ficha(Tareas::tarea($id), $u));
    }

    /** Enlace temporal para ver la foto de la verificación. */
    public function foto(Request $request, string $id)
    {
        $t = Tareas::visible($id, $request->user());
        if (! $t->photo_file_id) {
            abort(404, 'Este pedido no tiene foto.');
        }

        return response()->json(Archivos::enlace($t->photo_file_id, $request->user()));
    }

    public function anular(Request $request, string $id)
    {
        $d = $request->validate(['note' => ['nullable', 'string', 'max:255']]);
        $u = $request->user();
        Tareas::visible($id, $u);
        Tareas::anular($id, $d['note'] ?? null, $u);

        return response()->json(self::ficha(Tareas::tarea($id), $u));
    }

    public function stock(Request $request, string $id)
    {
        $u = $request->user();
        Escaneo::reintentarStock($id, $u);

        return response()->json(self::ficha(Tareas::tarea($id), $u));
    }

    /* --------------------------------------------------------------- PRE-09 Faltantes */

    public function faltantes(Request $request)
    {
        $d = $request->validate(['vista' => ['nullable', Rule::in(['POR_APROBAR', 'INCOMPLETAS', 'APROBADAS'])]]);
        $vista = $d['vista'] ?? 'POR_APROBAR';
        $q = DB::table('picking_task_lines as l')->join('picking_tasks as t', 't.id', '=', 'l.task_id')->join('picking_waves as w', 'w.id', '=', 't.wave_id')
            ->join('product_variants as v', 'v.id', '=', 'l.variant_id')->join('sales_orders as o', 'o.id', '=', 't.order_id')
            ->leftJoin('users as pr', 'pr.id', '=', 'l.short_requested_by')->leftJoin('users as ap', 'ap.id', '=', 'l.short_approved_by')
            ->leftJoin('users as se', 'se.id', '=', 'o.seller_id')->where('t.status', '<>', 'CANCELLED')->whereNotIn('w.status', ['DRAFT', 'CANCELLED']);
        match ($vista) {
            'POR_APROBAR' => $q->whereNotNull('l.short_reason')->where('l.status', '<>', 'SHORT_APPROVED')->whereIn('t.status', ['PENDING', 'PICKING']),
            'INCOMPLETAS' => $q->whereIn('l.status', ['PENDING', 'PARTIAL'])->whereNull('l.short_reason')->where('t.status', 'PICKING'),
            default => $q->where('l.status', 'SHORT_APPROVED')->where('l.short_approved_at', '>=', now()->subDays(14)),
        };
        Base::alcanceTareas($q, $request->user());
        $filas = $q->orderByDesc(DB::raw('coalesce(l.short_approved_at, l.short_requested_at, l.updated_at)'))->limit(200)
            ->get(['l.id', 'l.task_id', 'l.qty_required', 'l.qty_picked', 'l.weighed_kg', 'l.status', 'l.short_reason', 'l.short_qty', 'l.short_requested_at',
                'l.short_approved_at', 'l.short_requested_by', 't.preparer_user_id', 't.order_number', 'o.customer_id', 'v.sku', 'v.name', 'v.sale_mode',
                'pr.name as pedido_por', 'ap.name as aprobado_por', 'se.name as vendedora', 'w.number as ola']);

        return response()->json($filas->map(fn ($l) => (array) $l + ['cliente' => Base::cliente($l->customer_id),
            'hecho' => $l->sale_mode === 'KG' ? (float) ($l->weighed_kg ?? 0) : (float) $l->qty_picked])->values());
    }

    public function pedirFaltante(Request $request, string $lineId)
    {
        $d = $request->validate(['reason' => ['required', 'string', 'min:5', 'max:255']]);

        return response()->json(Escaneo::pedirFaltante($lineId, $d['reason'], $request->user()));
    }

    public function aprobarFaltante(Request $request, string $lineId)
    {
        return response()->json(Escaneo::aprobarFaltante($lineId, $request->user()));
    }

    public function rechazarFaltante(Request $request, string $lineId)
    {
        $d = $request->validate(['reason' => ['nullable', 'string', 'max:255']]);

        return response()->json(Escaneo::rechazarFaltante($lineId, $d['reason'] ?? null, $request->user()));
    }
}
