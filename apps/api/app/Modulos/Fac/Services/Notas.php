<?php

namespace App\Modulos\Fac\Services;

use App\Models\User;
use App\Modulos\Alm\Services\InventarioService;
use App\Support\Events;
use App\Support\Params;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * FAC-05 Nota de crédito y FAC-06 Nota de débito (RN-FAC-07, RN-FAC-08, RN-FAC-15).
 * Una nota refiere a una factura o boleta vigente del mismo cliente, con una serie de nota del mismo
 * tipo (F o B) y el motivo SUNAT. Las notas de crédito de un comprobante no superan su total; si es
 * devolución (06, 07) el producto vuelve al almacén de devoluciones con ALM.
 */
final class Notas
{
    /** Suma de las notas de crédito vigentes de un comprobante. */
    public static function acreditado(string $docId): float
    {
        return round((float) DB::table('sales_documents')->where('related_document_id', $docId)->where('doc_type', 'CREDIT_NOTE')
            ->where('status', 'ISSUED')->where('sunat_status', '<>', 'REJECTED')->sum('total'), 2);
    }

    /**
     * Lo ya acreditado por línea del comprobante (cantidad), desde las notas con líneas enlazadas. Es el mismo
     * campo `returned` que usa POS-09: {línea: {qty, amount}}.
     */
    public static function acreditadoPorLinea(object $ref): array
    {
        return array_map(fn ($x) => round((float) (is_array($x) ? ($x['qty'] ?? 0) : $x), 3), self::devuelto($ref));
    }

    /** El campo `returned` crudo, en la forma de POS: {línea: {qty, amount}}. */
    private static function devuelto(object $ref): array
    {
        $r = is_string($ref->returned) ? json_decode($ref->returned, true) : (array) ($ref->returned ?? []);
        if (! is_array($r)) {
            return [];
        }

        return array_map(fn ($x) => is_array($x) ? ['qty' => (float) ($x['qty'] ?? 0), 'amount' => (float) ($x['amount'] ?? 0)] : ['qty' => (float) $x, 'amount' => 0.0], $r);
    }

    public static function referencia(string $docId, User $u): object
    {
        $ref = DB::table('sales_documents')->where('id', $docId)->first() ?? RuleError::fail('RN-FAC-07', 'El comprobante no existe.');
        Emision::alcance($u, $ref->brand_id, $ref->establishment_id);
        if (! in_array($ref->doc_type, ['INVOICE', 'RECEIPT'], true)) {
            RuleError::fail('RN-FAC-07', 'La nota refiere a una factura o a una boleta.');
        }
        if ($ref->status === 'VOIDED' || $ref->sunat_status === 'REJECTED') {
            RuleError::fail('RN-FAC-07', "{$ref->full_number} está ".($ref->status === 'VOIDED' ? 'anulado' : 'rechazado por SUNAT').': no admite notas.');
        }

        return $ref;
    }

    /**
     * Emite una nota. $d: reason_code, reason, lines ([line_id, qty] para devolver o ajustar por línea)
     * o amount (monto global), restock (bool), warehouse_id, customer_id (debe ser el mismo), series_id.
     */
    public static function emitir(string $tipo, string $docId, array $d, User $u): object
    {
        return DB::transaction(function () use ($tipo, $docId, $d, $u) {
            DB::table('sales_documents')->where('id', $docId)->lockForUpdate()->first();
            $ref = self::referencia($docId, $u);
            $cat = $tipo === 'CREDIT_NOTE' ? Catalogos::CAT09 : Catalogos::CAT10;
            $code = str_pad((string) ($d['reason_code'] ?? ''), 2, '0', STR_PAD_LEFT);
            if (! isset($cat[$code])) {
                RuleError::fail('RN-FAC-07', 'Elige el motivo SUNAT del catálogo '.($tipo === 'CREDIT_NOTE' ? '09' : '10').'.');
            }
            if (! empty($d['customer_id']) && $d['customer_id'] !== $ref->customer_id) {
                RuleError::fail('RN-FAC-07', "La nota es del mismo cliente del comprobante ({$ref->customer_name}).");
            }
            $motivo = trim((string) ($d['reason'] ?? ''));
            if (mb_strlen($motivo) < 5) {
                RuleError::fail('RN-FAC-07', 'Escribe el sustento de la nota (al menos 5 letras).');
            }
            $serie = Emision::serie($tipo, $ref->brand_id, $ref->establishment_id, ['applies_to' => $ref->doc_type, 'series_id' => $d['series_id'] ?? null]);

            // Líneas: por ítem (cantidad de cada línea del comprobante) o un monto global.
            $lineas = [];
            $porLinea = [];
            $importePorLinea = [];
            $origen = DB::table('sales_document_lines')->where('sales_document_id', $ref->id)->orderBy('line_no')->get()->keyBy('id');
            $ya = self::acreditadoPorLinea($ref);
            foreach ($d['lines'] ?? [] as $x) {
                $l = $origen[$x['line_id']] ?? RuleError::fail('RN-FAC-07', 'Una línea no es de este comprobante.');
                $q = round((float) ($x['qty'] ?? 0), 3);
                if ($q <= 0) {
                    continue;
                }
                if ($tipo === 'CREDIT_NOTE') {
                    $queda = round((float) $l->qty - (float) ($ya[$l->id] ?? 0), 3);
                    if ($q > $queda + 0.0005) {
                        RuleError::fail('RN-FAC-08', "De «{$l->description}» quedan ".number_format($queda, $l->uom_code === 'KGM' ? 3 : 0, ',', ' ').' por acreditar.');
                    }
                }
                $importe = isset($x['amount']) ? round((float) $x['amount'], 2) : round((float) $l->total * $q / (float) $l->qty, 2);
                if ($code === '09' && $l->uom_code !== 'KGM') {
                    RuleError::fail('RN-FAC-15', 'La diferencia de peso se aplica a líneas vendidas por kg.');
                }
                $lineas[] = ['variant_id' => $l->variant_id, 'description' => ($code === '09' ? 'Diferencia de peso '.number_format($q, 3, ',', ' ').' kg · ' : '').preg_replace('/ · [\d,\s]+ kg.*$/u', '', $l->description),
                    'qty' => $q, 'uom_code' => $l->uom_code, 'unit_price' => round($importe / $q, 2), 'total' => $importe,
                    'igv_affectation' => $l->igv_affectation ?: '10', 'lot_id' => $l->lot_id, 'unit_cost' => $l->unit_cost !== null ? (float) $l->unit_cost : null,
                    'cost' => $l->unit_cost !== null ? round((float) $l->unit_cost * $q, 2) : 0, '_line' => $l->id];
                $porLinea[$l->id] = round((float) ($porLinea[$l->id] ?? 0) + $q, 3);
                $importePorLinea[$l->id] = round((float) ($importePorLinea[$l->id] ?? 0) + $importe, 2);
            }
            if (! $lineas) {
                $monto = round((float) ($d['amount'] ?? 0), 2);
                if ($monto <= 0) {
                    RuleError::fail('RN-FAC-07', 'La nota necesita un importe mayor que cero: elige líneas o escribe el monto.');
                }
                $af = $origen->first()->igv_affectation ?? '10';
                $lineas[] = ['variant_id' => null, 'description' => "{$cat[$code]} · ref. {$ref->full_number}", 'qty' => 1, 'uom_code' => 'ZZ',
                    'unit_price' => $monto, 'total' => $monto, 'igv_affectation' => $af, 'cost' => 0];
            }
            $total = round(array_sum(array_column($lineas, 'total')), 2);
            if ($total <= 0) {
                RuleError::fail('RN-FAC-07', 'La nota necesita un importe mayor que cero.');
            }
            if ($tipo === 'CREDIT_NOTE') {
                $usado = self::acreditado($ref->id);
                $disp = round((float) $ref->total - $usado, 2);
                if ($total > $disp + Emision::EPS) {
                    RuleError::fail('RN-FAC-08', "{$ref->full_number} (S/ ".number_format((float) $ref->total, 2).') ya tiene notas de crédito por S/ '.number_format($usado, 2)
                        .': el disponible es S/ '.number_format($disp, 2).' y pides S/ '.number_format($total, 2).'.');
                }
            }
            $cli = (object) ['id' => $ref->customer_id, 'doc_type' => $ref->customer_doc_type, 'doc_number' => $ref->customer_doc_number,
                'full_name' => $ref->customer_name, 'fiscal_address' => $ref->buyer_address];
            $nota = Emision::registrar([
                'doc_type' => $tipo, 'series_id' => $serie->id, 'brand_id' => $ref->brand_id, 'establishment_id' => $ref->establishment_id,
                'customer' => $cli, 'order_id' => $ref->order_id, 'related_document_id' => $ref->id, 'seller_id' => $u->id,
                'note_reason_code' => $code, 'note_reason' => $motivo, 'source' => 'NOTE', 'balance' => $total,
            ], array_map(fn ($l) => array_diff_key($l, ['_line' => 1]), $lineas), $u);

            if ($tipo === 'CREDIT_NOTE') {
                // Lo acreditado por línea queda en el comprobante (POS-09 lo comparte para no devolver dos veces).
                if ($porLinea) {
                    $crudo = self::devuelto($ref);
                    foreach ($porLinea as $k => $q) {
                        $antes = $crudo[$k] ?? ['qty' => 0, 'amount' => 0];
                        $crudo[$k] = ['qty' => round($antes['qty'] + $q, 3), 'amount' => round($antes['amount'] + ($importePorLinea[$k] ?? 0), 2)];
                    }
                    DB::table('sales_documents')->where('id', $ref->id)->update(['returned' => json_encode($crudo), 'updated_at' => now()]);
                }
                DB::table('sales_documents')->where('id', $ref->id)->update(['balance' => max(0, round((float) $ref->balance - $total, 2)), 'updated_at' => now()]);
                if (! empty($d['restock']) && in_array($code, Catalogos::DEVOLUCION, true) && $porLinea) {
                    self::reingresar($ref, $nota, $lineas, $d['warehouse_id'] ?? null, $motivo, $u);
                }
            }
            Events::emit($tipo === 'CREDIT_NOTE' ? 'credit_note.issued' : 'debit_note.issued', 'sales_documents', $nota->id, [
                'full_number' => $nota->full_number, 'document' => $ref->full_number, 'reason_code' => $code, 'total' => $total, 'order_id' => $ref->order_id,
            ]);

            return DB::table('sales_documents')->where('id', $nota->id)->first();
        });
    }

    /** RN-FAC-15: reclamo de peso después de emitir. $reclamos: [line_id, real_kg]. */
    public static function porPeso(string $docId, array $reclamos, string $motivo, User $u): object
    {
        $origen = DB::table('sales_document_lines')->where('sales_document_id', $docId)->get()->keyBy('id');
        $lines = [];
        foreach ($reclamos as $r) {
            $l = $origen[$r['line_id']] ?? RuleError::fail('RN-FAC-15', 'Una línea no es de este comprobante.');
            if ($l->uom_code !== 'KGM') {
                RuleError::fail('RN-FAC-15', 'La diferencia de peso se aplica a líneas vendidas por kg.');
            }
            $real = round((float) $r['real_kg'], 3);
            if ($real < 0 || $real >= (float) $l->qty) {
                RuleError::fail('RN-FAC-15', 'El peso real ('.number_format($real, 3, ',', ' ').' kg) debe ser menor al facturado ('.number_format((float) $l->qty, 3, ',', ' ').' kg).');
            }
            $dif = round((float) $l->qty - $real, 3);
            $lines[] = ['line_id' => $l->id, 'qty' => $dif, 'amount' => round($dif * (float) $l->unit_price, 2)];
        }

        return self::emitir('CREDIT_NOTE', $docId, [
            'reason_code' => str_pad((string) (Params::get('fac_weight_credit_note_reason') ?? '09'), 2, '0', STR_PAD_LEFT),
            'reason' => $motivo ?: 'Reclamo del cliente por diferencia de peso', 'lines' => $lines,
        ], $u);
    }

    /** Devolución: el producto vuelve con ALM al almacén de devoluciones (o al elegido), mismo lote y costo. */
    private static function reingresar(object $ref, object $nota, array $lineas, ?string $almacen, string $motivo, User $u): void
    {
        $razon = "Devolución {$nota->full_number} de {$ref->full_number}: {$motivo}";
        $fuente = $ref->order_id ? (DB::table('stock_movements')->where('source_id', $ref->order_id)->where('movement_type', 'SALE')->value('source_type')) : null;
        $destino = null;
        if ($fuente) {
            // Reparte lo devuelto entre las salidas del pedido (mismo lote y costo), como POS-09.
            $salidas = DB::table('stock_movements')->where('source_type', $fuente)->where('source_id', $ref->order_id)->where('movement_type', 'SALE')
                ->orderBy('moved_at')->orderBy('id')->get(['id', 'variant_id', 'lot_id', 'qty', 'weight_kg', 'warehouse_id']);
            $volvio = DB::table('stock_movements')->where('source_type', $fuente)->where('source_id', $ref->order_id)->where('movement_type', 'RETURN')
                ->get()->groupBy(fn ($r) => $r->variant_id.'|'.$r->lot_id)->map(fn ($g) => (float) $g->sum('qty'))->all();
            $pend = [];
            foreach ($salidas as $s) {
                $k = $s->variant_id.'|'.$s->lot_id;
                $y = min(abs((float) $s->qty), $volvio[$k] ?? 0);
                $volvio[$k] = ($volvio[$k] ?? 0) - $y;
                $pend[$s->id] = round(abs((float) $s->qty) - $y, 3);
            }
            $mov = [];
            foreach ($lineas as $l) {
                if (empty($l['variant_id'])) {
                    continue;
                }
                $modo = DB::table('product_variants')->where('id', $l['variant_id'])->value('sale_mode');
                $falta = (float) $l['qty'];
                foreach ($salidas as $s) {
                    if ($s->variant_id !== $l['variant_id'] || $falta <= 0.0005 || $pend[$s->id] <= 0.0005) {
                        continue;
                    }
                    // En peso variable por unidad, la salida se cuenta en unidades: se devuelve en proporción al peso.
                    $porPeso = $modo === 'UNIT_VARIABLE_WEIGHT' && $s->weight_kg !== null && abs((float) $s->weight_kg) > 0;
                    $q = $porPeso ? min($pend[$s->id], max(1, round($falta / abs((float) $s->weight_kg) * abs((float) $s->qty)))) : round(min($falta, $pend[$s->id]), 3);
                    $peso = $porPeso ? min($falta, abs((float) $s->weight_kg) * $q / abs((float) $s->qty)) : ($modo === 'KG' ? $q : null);
                    $pend[$s->id] = round($pend[$s->id] - $q, 3);
                    $falta = round($falta - ($porPeso ? $peso : $q), 3);
                    $mov[$s->id] = ['movement_id' => $s->id, 'qty' => round(($mov[$s->id]['qty'] ?? 0) + $q, 3),
                        'weight_kg' => $peso !== null ? round(($mov[$s->id]['weight_kg'] ?? 0) + $peso, 3) : null];
                    $destino ??= InventarioService::almacenDevoluciones($s->warehouse_id);
                }
            }
            if ($mov) {
                InventarioService::devolver($fuente, $ref->order_id, $razon, $u, $almacen, array_values($mov));
                DB::table('sales_documents')->where('id', $nota->id)->update(['restocked_warehouse_id' => $almacen ?? $destino, 'updated_at' => now()]);

                return;
            }
        }
        // Sin salida registrada (comprobante directo o histórico): entra al almacén de devoluciones del local con el lote de la línea.
        $wh = $almacen ?? DB::table('warehouses')->where('establishment_id', $ref->establishment_id)->where('status', 'ACTIVE')
            ->orderByRaw("CASE wh_type WHEN 'RETURNS' THEN 0 WHEN 'COLD_ROOM' THEN 1 ELSE 2 END")->orderBy('pick_priority')->value('id');
        if (! $wh) {
            RuleError::fail('RN-ALM-01', 'El local no tiene un almacén de devoluciones para reingresar el producto.');
        }
        $movidas = 0;
        foreach ($lineas as $l) {
            if (empty($l['variant_id'])) {
                continue;
            }
            $v = DB::table('product_variants as v')->join('products as p', 'p.id', '=', 'v.product_id')->where('v.id', $l['variant_id'])
                ->first(['v.sale_mode', 'v.nominal_weight_kg', 'v.std_cost', 'p.requires_lot']);
            $lote = $l['lot_id'] ?? null;
            if (! $lote && $v->requires_lot) {
                // RN-ALM-08: un producto con lote no entra sin lote. Sin la salida registrada no se sabe cuál.
                RuleError::fail('RN-ALM-08', "No se sabe de qué lote salió «{$l['description']}»: emite la nota sin reingreso y registra la devolución en Almacenes (ALM).");
            }
            $unid = $v->sale_mode === 'UNIT_VARIABLE_WEIGHT' ? max(1, (int) round((float) $l['qty'] / max(0.001, (float) ($v->nominal_weight_kg ?: 1)))) : (float) $l['qty'];
            InventarioService::mover(['type' => 'RETURN', 'warehouse_id' => $wh, 'variant_id' => $l['variant_id'], 'lot_id' => $lote, 'qty' => $unid,
                'weight_kg' => $v->sale_mode !== 'UNIT' ? (float) $l['qty'] : null, 'unit_cost' => $l['unit_cost'] ?? (float) $v->std_cost,
                'source_type' => 'CREDIT_NOTE', 'source_id' => $nota->id, 'reason' => $razon], $u);
            $movidas++;
        }
        if (! $movidas) {
            return;
        }
        DB::table('sales_documents')->where('id', $nota->id)->update(['restocked_warehouse_id' => $wh, 'updated_at' => now()]);
    }
}
