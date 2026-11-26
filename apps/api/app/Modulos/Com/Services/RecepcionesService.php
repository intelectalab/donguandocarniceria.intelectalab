<?php

namespace App\Modulos\Com\Services;

use App\Models\User;
use App\Modulos\Alm\Services\InventarioService;
use App\Modulos\Alm\Services\LotesService;
use App\Modulos\Com\Services\Soporte as C;
use App\Modulos\Equ\Services\EquiposService;
use App\Support\Access;
use App\Support\Events;
use App\Support\RuleError;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * COM-06 Recepción valorizada, contra la OC o sin ella. El stock y los lotes los escribe ALM (InventarioService y LotesService):
 * COM solo guarda la recepción y sus líneas.
 *  RN-COM-02  refrigerado (máx. com_chilled_max_c) y congelado (máx. com_frozen_max_c) registran temperatura; fuera de
 *             rango la línea se rechaza o pasa a decisión de calidad.
 *  RN-COM-03  lo que se compra por kg exige peso recibido mayor que 0 (también en la base).
 *  RN-COM-04  recibir más que lo pedido por encima de com_over_receipt_tolerance_pct exige motivo y aprobación.
 *  RN-COM-10  cada línea aceptada crea su lote con proveedor, vencimiento y costo unitario = precio de la OC o, sin OC, el indicado.
 */
final class RecepcionesService
{
    public const DECISIONES = ['ACCEPT', 'REJECT', 'QUALITY_HOLD'];

    /** Temperatura máxima de recepción del producto, o null si no la exige (ambiente). */
    public static function tempMax(?string $storage): ?float
    {
        return match ($storage) {
            'CHILLED' => C::param('com_chilled_max_c'),
            'FROZEN' => C::param('com_frozen_max_c'),
            default => null,
        };
    }

    /**
     * Revisa una línea y devuelve su cálculo (cantidad, peso, costo, exceso). Lanza la regla que la bloquea.
     *
     * @return array{v: object, p: object, base: string, qty: float, peso: ?float, temp: ?float, max: ?float, decision: string, precio: float, total: float, exceso: float}
     */
    public static function evaluar(array $l, ?object $lineaOc, User $quien): array
    {
        $variante = $lineaOc->variant_id ?? ($l['variant_id'] ?? null) ?: RuleError::fail('RN-COM-06', 'Elige el producto de la línea.');
        $v = DB::table('product_variants')->where('id', $variante)->first() ?? RuleError::fail('RN-COM-06', 'Producto no encontrado.');
        $p = DB::table('products')->where('id', $v->product_id)->first();
        $base = $lineaOc->price_basis ?? ($l['price_basis'] ?? OrdenesService::base($v->id));
        $peso = isset($l['weight_kg']) && $l['weight_kg'] !== '' && $l['weight_kg'] !== null ? C::r($l['weight_kg'], 3) : null;
        $qty = (float) ($l['qty'] ?? 0);
        if ($v->sale_mode === 'KG') {
            $qty = $peso ?: $qty;
        } elseif ($v->sale_mode === 'UNIT_VARIABLE_WEIGHT' && ! $qty && $peso) {
            $qty = max(1, round($peso / ((float) $v->nominal_weight_kg ?: 1)));
        }
        $decision = $l['decision'] ?? 'ACCEPT';
        if (! in_array($decision, self::DECISIONES, true)) {
            RuleError::fail('RN-COM-02', 'Elige si la línea se acepta, se rechaza o pasa a decisión de calidad.');
        }
        $temp = isset($l['temp_c']) && $l['temp_c'] !== '' && $l['temp_c'] !== null ? C::r($l['temp_c'], 2) : null;
        $max = self::tempMax($p->storage ?? null);
        if ($decision !== 'REJECT') {
            if ($base === 'KG' && ! ($peso > 0)) {
                RuleError::fail('RN-COM-03', "{$v->name} se compra por kg: registra el peso recibido (mayor que 0).");
            }
            if (! ($qty > 0)) {
                RuleError::fail('RN-COM-03', "Indica la cantidad recibida de {$v->name}.");
            }
        }
        if ($max !== null) {
            if ($temp === null) {
                RuleError::fail('RN-COM-02', "{$v->name} es ".($p->storage === 'FROZEN' ? 'congelado' : 'refrigerado').': registra su temperatura al recibirlo.');
            }
            if ($temp > $max + 1e-9 && $decision === 'ACCEPT') {
                RuleError::fail('RN-COM-02', "{$v->name} llegó a ".number_format($temp, 1, ',', '').' °C y el máximo es '.number_format($max, 1, ',', '').' °C: rechaza la línea o envíala a decisión de calidad.');
            }
        }
        $precio = $lineaOc ? (float) $lineaOc->unit_price : (float) ($l['unit_price'] ?? -1);
        if ($precio < 0) {
            RuleError::fail('RN-COM-10', "Indica el costo de {$v->name} (precio sin IGV).");
        }
        $total = $decision === 'REJECT' ? 0.0 : C::r(($base === 'KG' ? $peso : $qty) * $precio);
        $exceso = 0.0;
        if ($lineaOc && $decision !== 'REJECT') {
            $pedido = OrdenesService::pedido($lineaOc);
            $ahora = $base === 'KG' ? $peso : $qty;
            $exceso = $pedido > 0 ? C::r((OrdenesService::recibido($lineaOc) + $ahora - $pedido) / $pedido * 100, 2) : 0.0;
            $tol = C::param('com_over_receipt_tolerance_pct');
            if ($exceso > $tol + 1e-9) {
                if (trim((string) ($l['over_receipt_reason'] ?? '')) === '') {
                    RuleError::fail('RN-COM-04', "{$v->name}: se recibe ".C::pct($exceso).' más que lo pedido (tolerancia '.C::pct($tol, 0).'): indica el motivo.');
                }
                if (! Access::can($quien, 'com.order.approve')) {
                    RuleError::fail('RN-COM-04', "El exceso de ".C::pct($exceso)." en {$v->name} lo aprueba el gerente o administración: pídeles que registren la recepción.");
                }
            }
        }

        return ['v' => $v, 'p' => $p, 'base' => $base, 'qty' => C::r($qty, 3), 'peso' => $peso, 'temp' => $temp, 'max' => $max, 'decision' => $decision,
            'precio' => $precio, 'total' => $total, 'exceso' => $exceso];
    }

    /**
     * Registra la recepción: cada línea aceptada crea su lote (en cuarentena, como toda entrada de ALM) y entra al stock;
     * la rechazada queda con su motivo y no entra. Contra la OC, actualiza lo recibido y su estado.
     */
    public static function registrar(array $d, User $quien, array $opc = []): object
    {
        return DB::transaction(function () use ($d, $quien, $opc) {
            $po = ! empty($d['po_id']) ? (DB::table('purchase_orders')->where('id', $d['po_id'])->lockForUpdate()->first() ?? abort(404)) : null;
            if ($po && ! in_array($po->status, OrdenesService::ABIERTAS, true)) {
                RuleError::fail('RN-COM-04', "La OC {$po->number} no está aprobada: solo se recibe una OC aprobada o recibida en parte.");
            }
            $s = C::proveedor($po->supplier_id ?? ($d['supplier_id'] ?? null));
            $w = InventarioService::almacen($d['warehouse_id'] ?? ($po->warehouse_id ?? null), $quien);
            $cuando = isset($d['received_at']) ? CarbonImmutable::parse($d['received_at'], 'America/Lima') : C::ahora();
            if (! empty($d['scale_equipment_id'])) {
                EquiposService::exigirBalanza($d['scale_equipment_id'], $cuando->toDateString());
            }
            $lineas = array_values(array_filter($d['lines'] ?? [], fn ($l) => ! empty($l['po_line_id']) || ! empty($l['variant_id'])));
            $lineas = array_values(array_filter($lineas, fn ($l) => (float) ($l['qty'] ?? 0) > 0 || (float) ($l['weight_kg'] ?? 0) > 0 || ($l['decision'] ?? '') === 'REJECT'));
            if (! $lineas) {
                RuleError::fail('RN-COM-03', 'Registra al menos una línea con cantidad o peso.');
            }
            $evals = [];
            foreach ($lineas as $l) {
                $pl = ! empty($l['po_line_id']) ? DB::table('purchase_order_lines')->where('id', $l['po_line_id'])->lockForUpdate()->first() : null;
                if ($pl && $po && $pl->po_id !== $po->id) {
                    RuleError::fail('RN-COM-04', 'Esa línea no es de la OC elegida.');
                }
                $evals[] = [$l, $pl, self::evaluar($l, $pl, $quien)];
            }
            $tipo = $d['receipt_type'] ?? 'PURCHASE';
            $granja = str_starts_with($tipo, 'FARM');
            $pendiente = ($d['inspection_result'] ?? 'OK') === 'PENDING';
            $id = DB::table('purchase_receipts')->insertGetId([
                'number' => C::numero('purchase_receipts', 'RC-', 5), 'company_id' => C::empresaDe($w->establishment_id), 'establishment_id' => $w->establishment_id,
                'warehouse_id' => $w->id, 'supplier_id' => $s->id, 'po_id' => $po->id ?? null, 'receipt_type' => $tipo, 'received_at' => $cuando, 'received_by' => $quien->id,
                'vehicle_temp_c' => isset($d['vehicle_temp_c']) && $d['vehicle_temp_c'] !== '' ? C::r($d['vehicle_temp_c'], 2) : null,
                'carrier_guide' => $d['carrier_guide'] ?? null, 'scale_equipment_id' => $d['scale_equipment_id'] ?? null,
                'inspection_result' => $d['inspection_result'] ?? 'OK', 'status' => 'POSTED', 'total_cost' => 0, 'farm_dispatch_id' => $d['farm_dispatch_id'] ?? null,
                'notes' => $d['notes'] ?? null,
            ], 'id');
            $numero = DB::table('purchase_receipts')->where('id', $id)->value('number');
            $total = 0.0;
            $lotes = [];
            foreach ($evals as [$l, $pl, $e]) {
                $aceptada = $e['decision'] !== 'REJECT';
                $retenida = $e['decision'] === 'QUALITY_HOLD';
                $loteId = null;
                $movId = null;
                if ($aceptada && $e['p']->requires_lot) {
                    $vence = $l['expiry_date'] ?? $cuando->addDays(max(1, (int) ($e['p']->shelf_life_days ?? 7)))->toDateString();
                    $lote = LotesService::crear([
                        'product_id' => $e['p']->id, 'variant_id' => $e['v']->id, 'code' => $l['lot_code'] ?? self::codigoLote($cuando->toDateString(), $granja ? 'G' : 'C'),
                        'origin' => $granja ? 'FARM' : 'PURCHASE', 'supplier_id' => $s->id, 'production_date' => $l['production_date'] ?? $cuando->toDateString(),
                        'expiry_date' => $vence, 'unit_cost' => round($e['precio'], 4), 'received_weight_kg' => $e['peso'], 'supplier_lot_code' => $l['supplier_lot_code'] ?? null,
                        'cost_basis' => $e['base'],
                    ], $quien, "Recepción {$numero} · ".C::nombreProveedor($s));
                    $extra = array_filter(['farm_lot_code' => $l['farm_lot_code'] ?? null, 'farm_origin' => isset($l['farm_origin']) ? json_encode($l['farm_origin'], JSON_UNESCAPED_UNICODE) : null,
                        'notes' => $retenida ? 'Decisión de calidad pendiente'.($e['temp'] !== null ? ': llegó a '.number_format($e['temp'], 1, ',', '').' °C' : '') : ($pendiente ? 'Pendiente de inspección de recepción' : null)]);
                    if ($extra) {
                        DB::table('lots')->where('id', $lote->id)->update($extra);
                    }
                    $loteId = $lote->id;
                    $lotes[] = $loteId;
                }
                if ($aceptada) {
                    $m = InventarioService::mover([
                        'type' => 'RECEIPT', 'warehouse_id' => $w->id, 'variant_id' => $e['v']->id, 'lot_id' => $loteId, 'qty' => $e['qty'],
                        'weight_kg' => $e['v']->sale_mode === 'UNIT' ? null : $e['peso'], 'unit_cost' => $e['qty'] > 0 ? round($e['total'] / $e['qty'], 4) : 0,
                        'source_type' => $granja ? 'FARM_RECEIPT' : 'PURCHASE_RECEIPT', 'source_id' => $id, 'reason' => "Recepción {$numero} · ".C::nombreProveedor($s),
                        'moved_at' => $cuando, 'allow_unreleased' => true,
                    ], $quien);
                    $movId = $m['moves'][0]['movement_id'] ?? null;
                }
                DB::table('purchase_receipt_lines')->insert([
                    'receipt_id' => $id, 'po_line_id' => $pl->id ?? null, 'variant_id' => $e['v']->id, 'lot_id' => $loteId, 'supplier_lot_code' => $l['supplier_lot_code'] ?? null,
                    'expiry_date' => $loteId ? DB::table('lots')->where('id', $loteId)->value('expiry_date') : null, 'qty' => $e['decision'] === 'REJECT' ? (float) ($l['qty'] ?? 0) : $e['qty'],
                    'weight_kg' => $e['peso'], 'temp_c' => $e['temp'], 'unit_cost' => $e['precio'], 'price_basis' => $e['base'], 'total_cost' => $e['total'],
                    'accepted' => $aceptada, 'quality_hold' => $retenida,
                    'rejection_reason' => $aceptada ? null : (trim((string) ($l['rejection_reason'] ?? '')) ?: ($e['temp'] !== null && $e['max'] !== null && $e['temp'] > $e['max']
                        ? 'Temperatura '.number_format($e['temp'], 1, ',', '').' °C fuera de rango (máx. '.number_format($e['max'], 1, ',', '').' °C)' : 'Rechazada en la recepción')),
                    'over_receipt_reason' => $l['over_receipt_reason'] ?? null, 'over_pct' => $e['exceso'], 'stock_movement_id' => $movId,
                ]);
                if ($pl && $aceptada) {
                    DB::table('purchase_order_lines')->where('id', $pl->id)->update([
                        'received_qty' => C::r((float) $pl->received_qty + $e['qty'], 3), 'received_weight_kg' => C::r((float) $pl->received_weight_kg + (float) $e['peso'], 3), 'updated_at' => now(),
                    ]);
                }
                $total += $e['total'];
            }
            DB::table('purchase_receipts')->where('id', $id)->update(['total_cost' => C::r($total)]);
            if ($po) {
                $ls = DB::table('purchase_order_lines')->where('po_id', $po->id)->get();
                $completa = $ls->every(fn ($x) => OrdenesService::recibido($x) >= OrdenesService::pedido($x) * 0.98 - 1e-9);
                DB::table('purchase_orders')->where('id', $po->id)->update([
                    'status' => $completa ? 'RECEIVED' : 'PARTIALLY_RECEIVED', 'last_receipt_at' => $cuando, 'received_complete_at' => $completa ? $cuando : null,
                    'history' => C::historial($po->history, "Recepción {$numero}".($completa ? ' (completa)' : ' (parcial)'), $quien), 'updated_at' => now(),
                ]);
            }
            if (empty($opc['silencio'])) {
                Events::emit('purchase_receipt.posted', 'purchase_receipts', $id, ['number' => $numero, 'supplier_id' => $s->id, 'po_id' => $po->id ?? null, 'lots' => $lotes]);
                $retenidas = collect($evals)->filter(fn ($x) => $x[2]['decision'] === 'QUALITY_HOLD')->count();
                if ($retenidas) {
                    C::avisar(['CALIDAD'], "Recepción {$numero}: {$retenidas} línea(s) para decisión de calidad", C::nombreProveedor($s), 'COM', 'COM-06', $id);
                }
            }

            return self::ver($id);
        });
    }

    /** «C261124-001»: compra (C) o granja (G), fecha y correlativo del día. */
    private static function codigoLote(string $fecha, string $prefijo): string
    {
        $base = $prefijo.CarbonImmutable::parse($fecha)->format('ymd').'-';
        DB::select('SELECT pg_advisory_xact_lock(hashtext(?))', ['com:lot:'.$base]);
        $n = DB::table('lots')->where('code', 'like', $base.'%')->count() + 1;

        return $base.str_pad((string) $n, 3, '0', STR_PAD_LEFT);
    }

    public static function ver(string $id): object
    {
        $r = DB::table('purchase_receipts as r')->join('suppliers as s', 's.id', '=', 'r.supplier_id')->join('warehouses as w', 'w.id', '=', 'r.warehouse_id')
            ->leftJoin('purchase_orders as o', 'o.id', '=', 'r.po_id')->leftJoin('users as u', 'u.id', '=', 'r.received_by')->leftJoin('equipment as eq', 'eq.id', '=', 'r.scale_equipment_id')
            ->leftJoin('purchase_documents as d', 'd.id', '=', 'r.document_id')
            ->where('r.id', $id)->first(['r.*', 's.legal_name as supplier_name', 's.trade_name as supplier_trade_name', 'w.code as warehouse_code', 'w.name as warehouse_name',
                'o.number as po_number', 'u.name as received_by_name', 'eq.code as scale_code', 'd.series as doc_series', 'd.number as doc_number', 'd.doc_type']) ?? abort(404);
        $r->lines = DB::table('purchase_receipt_lines as l')->join('product_variants as v', 'v.id', '=', 'l.variant_id')->join('products as p', 'p.id', '=', 'v.product_id')
            ->leftJoin('lots as lo', 'lo.id', '=', 'l.lot_id')->where('l.receipt_id', $id)->orderBy('l.created_at')->orderBy('v.name')
            ->get(['l.*', 'v.sku', 'v.name as variant_name', 'v.sale_mode', 'p.storage', 'lo.code as lot_code', 'lo.qc_status']);
        $docs = DB::table('purchase_document_lines as dl')->join('purchase_documents as d', 'd.id', '=', 'dl.document_id')->where('d.status', '<>', 'VOIDED')
            ->whereIn('dl.receipt_line_id', $r->lines->pluck('id'))->pluck('d.id')->unique();
        $r->documents = DB::table('purchase_documents')->whereIn('id', $docs->push($r->document_id)->filter()->unique())->get(['id', 'doc_type', 'series', 'number', 'total', 'match_status']);

        return $r;
    }
}
