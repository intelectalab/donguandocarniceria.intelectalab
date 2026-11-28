<?php

namespace App\Modulos\Pos\Services;

use App\Models\User;
use App\Modulos\Alm\Services\InventarioService;
use App\Modulos\Cli\Models\Customer;
use App\Support\Events;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * POS-09 Devolución: busca el comprobante del día, elige líneas y peso devuelto, emite la nota de
 * crédito y devuelve por el mismo medio o como saldo a favor (RN-POS-13).
 *
 * D-POS-04: la carne devuelta no vuelve a la venta. ALM la reingresa con InventarioService::devolver
 * al almacén de devoluciones del local, que no vende, hasta que calidad la revise (si no se libera,
 * merma). El efectivo sale de un turno abierto de la caja (RN-POS-05); los demás medios quedan
 * pendientes para administración.
 */
final class Devoluciones
{
    public const EPS = 0.0005;

    /** Comprobantes del mostrador del día que se pueden devolver, con lo ya devuelto. */
    public static function delDia(User $u, ?string $q = null): array
    {
        $a = \App\Support\Access::for($u);
        $hoy = now('America/Lima')->toDateString();

        return DB::table('sales_documents as d')
            ->whereIn('d.doc_type', ['RECEIPT', 'INVOICE'])->whereNotNull('d.pos_shift_id')->where('d.issue_date', $hoy)->where('d.status', 'ISSUED')
            ->when($a['establishments'], fn ($w) => $w->whereIn('d.establishment_id', $a['establishments']))
            ->when($a['brands'], fn ($w) => $w->whereIn('d.brand_id', $a['brands']))
            ->when($q !== null && trim($q) !== '', function ($w) use ($q) {
                $t = '%'.addcslashes(mb_strtolower(trim($q)), '%_\\').'%';
                $w->where(fn ($x) => $x->whereRaw('lower(d.full_number) like ?', [$t])->orWhereRaw('lower(d.pos_ticket) like ?', [$t])
                    ->orWhereRaw("translate(lower(d.customer_name), 'áéíóúüñ', 'aeiouun') like translate(?, 'áéíóúüñ', 'aeiouun')", [$t]));
            })
            ->orderByDesc('d.issued_at')->limit(100)
            ->get(['d.id', 'd.full_number', 'd.doc_type', 'd.pos_ticket', 'd.customer_name', 'd.brand_name', 'd.total', 'd.issued_at',
                DB::raw("(select coalesce(sum(n.total), 0) from sales_documents n where n.related_document_id = d.id and n.doc_type = 'CREDIT_NOTE') as devuelto")])
            ->all();
    }

    /** Notas de crédito del mostrador (las más recientes). */
    public static function notas(User $u): array
    {
        $a = \App\Support\Access::for($u);

        return DB::table('sales_documents as n')->leftJoin('sales_documents as d', 'd.id', '=', 'n.related_document_id')
            ->leftJoin('payment_methods as m', 'm.id', '=', 'n.refund_method')
            ->where('n.doc_type', 'CREDIT_NOTE')->whereNotNull('n.pos_terminal_id')
            ->when($a['establishments'], fn ($w) => $w->whereIn('n.establishment_id', $a['establishments']))
            ->when($a['brands'], fn ($w) => $w->whereIn('n.brand_id', $a['brands']))
            ->orderByDesc('n.issued_at')->limit(50)
            ->get(['n.id', 'n.full_number', 'n.issue_date', 'n.issued_at', 'n.note_reason', 'n.total', 'n.refund_mode', 'n.refund_status', 'n.customer_name',
                'n.sunat_status', 'd.full_number as afecta', 'm.name as medio'])->all();
    }

    /**
     * Emite la nota de crédito. $d: lines [{line_id, qty, weight_kg}], mode SAME (mismo medio) o
     * CREDIT (saldo a favor), reason, restock (si vuelve al almacén de devoluciones; por defecto sí).
     */
    public static function devolver(string $docId, array $d, User $u): array
    {
        return DB::transaction(function () use ($docId, $d, $u) {
            $doc = DB::table('sales_documents')->where('id', $docId)->lockForUpdate()->first();
            if (! $doc || ! Cajas::enAlcance($doc->establishment_id, $u)) {
                abort(404, 'Comprobante no encontrado.');
            }
            if (! in_array($doc->doc_type, ['RECEIPT', 'INVOICE'], true) || ! $doc->pos_shift_id) {
                RuleError::fail('RN-POS-13', 'Elige una boleta o factura emitida en el mostrador.');
            }
            if ($doc->status !== 'ISSUED') {
                RuleError::fail('RN-POS-13', "El comprobante {$doc->full_number} está anulado.");
            }
            if ($doc->issue_date !== now('America/Lima')->toDateString()) {
                RuleError::fail('RN-POS-13', 'En el mostrador solo se devuelven comprobantes del día; los demás reclamos van por Facturación.');
            }
            $motivo = trim((string) ($d['reason'] ?? ''));
            if (mb_strlen($motivo) < 5) {
                RuleError::fail('RN-POS-13', 'Escribe el motivo de la devolución.');
            }
            $modo = $d['mode'] ?? 'SAME';
            if (! in_array($modo, ['SAME', 'CREDIT'], true)) {
                RuleError::fail('RN-POS-13', 'Elige cómo se devuelve: por el mismo medio o como saldo a favor.');
            }
            $varios = Cajas::clienteVarios();
            if ($modo === 'CREDIT' && $doc->customer_id === $varios) {
                RuleError::fail('RN-POS-13', 'Para dejarlo como saldo a favor el comprobante debe ser de un cliente identificado (no «Clientes varios»).');
            }

            $lineasDoc = DB::table('sales_document_lines as l')->leftJoin('product_variants as v', 'v.id', '=', 'l.variant_id')
                ->where('l.sales_document_id', $doc->id)->get(['l.*', 'v.sale_mode', 'v.name as variante'])->keyBy('id');
            $devuelto = Comprobantes::devuelto($doc);
            $nc = [];
            foreach ($d['lines'] ?? [] as $x) {
                $l = $lineasDoc[$x['line_id'] ?? ''] ?? null;
                if (! $l) {
                    RuleError::fail('RN-POS-13', 'La línea elegida no es de este comprobante.');
                }
                $porKg = $l->uom_code === 'KGM';
                $q = $porKg ? round((float) ($x['weight_kg'] ?? 0), 3) : round((float) ($x['qty'] ?? 0), 3);
                if ($q <= self::EPS) {
                    continue;
                }
                if (! $porKg && abs($q - round($q)) > self::EPS) {
                    RuleError::fail('RN-POS-13', "{$l->description}: las unidades devueltas van sin decimales.");
                }
                $ya = $devuelto[$l->id] ?? ['qty' => 0, 'amount' => 0];
                $queda = round((float) $l->qty - (float) $ya['qty'], 3);
                if ($q > $queda + self::EPS) {
                    $u_ = $porKg ? 'kg' : 'u';
                    RuleError::fail('RN-POS-13', "{$l->description}: se vendió ".self::n((float) $l->qty, $porKg)." {$u_} y ya se devolvió ".self::n((float) $ya['qty'], $porKg)
                        ." {$u_}; no se puede devolver ".self::n($q, $porKg)." {$u_}.");
                }
                $importe = abs($q - $queda) <= self::EPS ? round((float) $l->total - (float) $ya['amount'], 2) : round($q * (float) $l->unit_price, 2);
                // Unidades que vuelven al almacén: por kg, el peso; por unidad, las unidades; peso variable por kg, las unidades que dice la cajera.
                $stock = match (true) {
                    $l->sale_mode === 'KG' => $q,
                    ! $porKg => $q,
                    default => max(1, (int) round((float) ($x['qty'] ?? 1))),
                };
                $nc[] = ['l' => $l, 'q' => $q, 'importe' => $importe, 'stock' => $stock, 'peso' => $porKg ? $q : null];
            }
            if (! $nc) {
                RuleError::fail('RN-POS-13', 'Elige al menos una línea y la cantidad o el peso devuelto.');
            }
            $monto = round(array_sum(array_column($nc, 'importe')), 2);
            $previas = (float) DB::table('sales_documents')->where('related_document_id', $doc->id)->where('doc_type', 'CREDIT_NOTE')->sum('total');
            if ($monto + $previas > (float) $doc->total + 0.005) {
                RuleError::fail('RN-FAC-08', 'Las notas de crédito no pueden pasar el total del comprobante.');
            }

            // Medio por el que se devuelve: el del cobro mayor del comprobante.
            $medio = DB::table('payment_allocations as a')->join('payments as p', 'p.id', '=', 'a.payment_id')->join('payment_methods as m', 'm.id', '=', 'p.payment_method_id')
                ->where('a.document_id', $doc->id)->where('p.status', 'CONFIRMED')->orderByDesc('a.amount')->first(['m.id', 'm.code', 'm.name', 'm.kind']);
            $medio ??= DB::table('payment_methods')->where('code', 'BALANCE')->first(['id', 'code', 'name', 'kind']);
            $efectivo = $modo === 'SAME' && $medio?->kind === 'CASH';
            $turno = null;
            if ($efectivo) {
                $turno = Turnos::abiertoDe($u) ?? DB::table('pos_shifts')->where('terminal_id', $doc->pos_terminal_id)->where('status', 'OPEN')->first();
                if (! $turno) {
                    RuleError::fail('RN-POS-05', 'Devolver efectivo exige un turno abierto en la caja: abre el turno o devuelve como saldo a favor.');
                }
                $turno = Turnos::bloquear($turno->id);
                $hay = Turnos::esperado($turno)['efectivo'];
                if ($monto > $hay + 0.005) {
                    RuleError::fail('RN-POS-05', "En la caja del turno {$turno->number} deberían quedar S/ ".number_format($hay, 2).': no alcanza para devolver S/ '.number_format($monto, 2).'.');
                }
            }
            if ($modo === 'SAME' && $medio?->code === 'BALANCE' && $doc->customer_id === $varios) {
                RuleError::fail('RN-POS-13', 'El comprobante no tiene un cobro al que devolver.');
            }
            $saldoFavor = DB::table('payment_methods')->where('code', 'BALANCE')->value('id');
            $cliente = Customer::find($doc->customer_id);
            $notaDoc = Comprobantes::emitir([
                'brand_id' => $doc->brand_id, 'establishment_id' => $doc->establishment_id, 'series_id' => Comprobantes::serieDeNota($doc)->id,
                'doc_type' => 'CREDIT_NOTE', 'customer' => $cliente, 'order_id' => $doc->order_id, 'related_document_id' => $doc->id, 'seller_id' => $u->id,
                'pos_shift_id' => $turno?->id ?? $doc->pos_shift_id, 'pos_terminal_id' => $doc->pos_terminal_id, 'balance' => 0,
                'note_reason_code' => '07', 'note_reason' => "Devolución en el mostrador: {$motivo}",
                'refund_mode' => $modo, 'refund_method' => $modo === 'CREDIT' ? $saldoFavor : $medio?->id,
                'refund_status' => ($modo === 'SAME' && ! $efectivo && $medio?->code !== 'BALANCE') ? 'PENDING' : 'DONE',
            ], array_map(fn ($x) => [
                'variant_id' => $x['l']->variant_id, 'description' => $x['l']->description, 'qty' => $x['q'], 'uom_code' => $x['l']->uom_code,
                'unit_price' => (float) $x['l']->unit_price, 'total' => $x['importe'], 'lot_id' => $x['l']->lot_id,
                'unit_cost' => $x['l']->unit_cost, 'cost' => round($x['q'] * (float) ($x['l']->unit_cost ?? 0), 2),
            ], $nc), $u);

            // Stock: vuelve al almacén de devoluciones (no vende) con el lote y el costo de la venta.
            $reingreso = [];
            if (($d['restock'] ?? true) && $doc->order_id) {
                $reingreso = self::reingresar($doc, $nc, $notaDoc, $motivo, $u);
            }

            foreach ($nc as $x) {
                $ya = $devuelto[$x['l']->id] ?? ['qty' => 0, 'amount' => 0];
                $devuelto[$x['l']->id] = ['qty' => round((float) $ya['qty'] + $x['q'], 3), 'amount' => round((float) $ya['amount'] + $x['importe'], 2)];
            }
            DB::table('sales_documents')->where('id', $doc->id)->update(['returned' => json_encode($devuelto), 'updated_at' => now()]);
            if ($doc->order_id) {
                DB::table('sales_orders')->where('id', $doc->order_id)->update(['returned_amount' => DB::raw('coalesce(returned_amount, 0) + '.$monto), 'updated_at' => now()]);
            }

            if ($efectivo) {
                DB::table('pos_cash_movements')->insert([
                    'shift_id' => $turno->id, 'moved_at' => now(), 'user_id' => $u->id, 'user_name' => mb_substr($u->name, 0, 120),
                    'movement_type' => 'REFUND', 'amount' => $monto, 'reason' => mb_substr("Devolución {$notaDoc->full_number}: {$motivo}", 0, 255),
                    'authorized_by' => $u->id, 'authorized_by_name' => mb_substr($u->name, 0, 120), 'document_id' => $notaDoc->id, 'created_at' => now(),
                ]);
            } elseif ($modo === 'CREDIT') {
                DB::table('customer_balance_movements')->insert([
                    'customer_id' => $doc->customer_id, 'movement_type' => 'CREDIT_NOTE', 'amount' => $monto, 'order_id' => $doc->order_id,
                    'reason' => mb_substr("Devolución del mostrador {$notaDoc->full_number}: {$motivo}", 0, 255), 'at' => now(), 'user' => mb_substr($u->name, 0, 40),
                ]);
            } elseif ($medio?->code === 'BALANCE') {
                DB::table('customer_balance_movements')->insert([
                    'customer_id' => $doc->customer_id, 'movement_type' => 'CREDIT_NOTE', 'amount' => $monto, 'order_id' => $doc->order_id,
                    'reason' => mb_substr("Devolución del mostrador {$notaDoc->full_number} (se pagó con saldo a favor)", 0, 255), 'at' => now(), 'user' => mb_substr($u->name, 0, 40),
                ]);
            } else {
                DB::table('notifications')->insert([
                    'role' => 'ADMINISTRACION', 'title' => mb_substr('Devolver S/ '.number_format($monto, 2)." por {$medio->name}", 0, 255),
                    'body' => "Nota de crédito {$notaDoc->full_number} de {$doc->full_number} · {$doc->customer_name}. Motivo: {$motivo}",
                    'ref' => json_encode(['screen' => 'POS-09', 'id' => $notaDoc->id]), 'tone' => 'warn', 'module' => 'POS', 'at' => now(), 'type' => 'ALERTS', 'in_app' => true,
                ]);
            }
            Events::emit('pos.refund.issued', 'sales_documents', $notaDoc->id, [
                'full_number' => $notaDoc->full_number, 'document' => $doc->full_number, 'amount' => $monto, 'mode' => $modo, 'method' => $medio?->code,
            ]);

            return ['nota' => DB::table('sales_documents')->where('id', $notaDoc->id)->first(), 'monto' => $monto, 'medio' => $medio?->name,
                'modo' => $modo, 'efectivo' => $efectivo, 'reingreso' => $reingreso];
        });
    }

    /** Reparte lo devuelto entre las salidas de la venta y lo reingresa con ALM. */
    private static function reingresar(object $doc, array $nc, object $nota, string $motivo, User $u): array
    {
        $salidas = DB::table('stock_movements')->where('source_type', 'POS_SALE')->where('source_id', $doc->order_id)->where('movement_type', 'SALE')
            ->orderBy('moved_at')->orderBy('id')->get(['id', 'variant_id', 'lot_id', 'qty', 'weight_kg']);
        if ($salidas->isEmpty()) {
            return [];
        }
        $yaVolvio = DB::table('stock_movements')->where('source_type', 'POS_SALE')->where('source_id', $doc->order_id)->where('movement_type', 'RETURN')
            ->get()->groupBy(fn ($r) => $r->variant_id.'|'.$r->lot_id)->map(fn ($g) => (float) $g->sum('qty'))->all();
        $pendiente = [];
        foreach ($salidas as $s) {
            $k = $s->variant_id.'|'.$s->lot_id;
            $ya = min(abs((float) $s->qty), $yaVolvio[$k] ?? 0);
            $yaVolvio[$k] = ($yaVolvio[$k] ?? 0) - $ya;
            $pendiente[$s->id] = round(abs((float) $s->qty) - $ya, 3);
        }
        $lineas = [];
        foreach ($nc as $x) {
            $falta = (float) $x['stock'];
            foreach ($salidas as $s) {
                if ($s->variant_id !== $x['l']->variant_id || $falta <= self::EPS || $pendiente[$s->id] <= self::EPS) {
                    continue;
                }
                $q = round(min($falta, $pendiente[$s->id]), 3);
                $pendiente[$s->id] = round($pendiente[$s->id] - $q, 3);
                $falta = round($falta - $q, 3);
                $prev = $lineas[$s->id] ?? ['movement_id' => $s->id, 'qty' => 0, 'weight_kg' => null];
                $peso = $x['peso'] !== null ? round((float) $x['peso'] * $q / max(self::EPS, (float) $x['stock']), 3) : null;
                $lineas[$s->id] = ['movement_id' => $s->id, 'qty' => round($prev['qty'] + $q, 3),
                    'weight_kg' => $peso !== null ? round((float) ($prev['weight_kg'] ?? 0) + $peso, 3) : $prev['weight_kg']];
            }
        }
        if (! $lineas) {
            return [];
        }

        return InventarioService::devolver('POS_SALE', $doc->order_id, "Devolución del mostrador {$nota->full_number}: {$motivo}", $u, null, array_values($lineas))['moves'];
    }

    private static function n(float $v, bool $kg): string
    {
        return number_format($v, $kg ? 3 : 0, ',', ' ');
    }
}
