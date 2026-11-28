<?php

namespace App\Modulos\Pos\Services;

use App\Models\User;
use App\Modulos\Alm\Services\InventarioService;
use App\Modulos\Alm\Services\ReservasService;
use App\Modulos\Cli\Models\Customer;
use App\Modulos\Ped\Services\Estados;
use App\Modulos\Ped\Services\Pedidos;
use App\Support\Access;
use App\Support\Events;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * POS-12 Pedidos por recoger: pedidos LISTO con recojo en el local de la caja. Se buscan por número
 * o celular, se cobra el saldo en el turno abierto (RN-POS-05) y se entregan: las reservas pasan a
 * salida con ALM, se emite el comprobante si aún no tiene y el pedido pasa a ENTREGADO y, pagado,
 * a CERRADO (RN-PED-03, RN-PED-15).
 */
final class Recojos
{
    public static function pendientes(User $u, ?string $local, ?string $q = null): array
    {
        $a = Access::for($u);
        $filas = DB::table('sales_orders as o')->join('customers as c', 'c.id', '=', 'o.customer_id')->join('brands as b', 'b.id', '=', 'o.brand_id')
            ->where('o.status', 'READY')->where('o.fulfillment', 'PICKUP')
            ->when($local, fn ($w) => $w->whereRaw('coalesce(o.pickup_establishment_id, o.establishment_id) = ?', [$local]))
            ->when($a['establishments'], fn ($w) => $w->where(fn ($x) => $x->whereIn('o.pickup_establishment_id', $a['establishments'])->orWhereIn('o.establishment_id', $a['establishments'])))
            ->when($a['brands'], fn ($w) => $w->whereIn('o.brand_id', $a['brands']))
            ->when($q !== null && trim($q) !== '', function ($w) use ($q) {
                $t = trim($q);
                $dig = preg_replace('/\D/', '', $t);
                $w->where(function ($x) use ($t, $dig) {
                    $x->whereRaw('lower(o.number) like ?', ['%'.mb_strtolower($t).'%']);
                    if (strlen($dig) >= 4) {
                        $x->orWhere('c.phone', 'like', "%{$dig}%")->orWhere('o.contact_phone', 'like', "%{$dig}%");
                    }
                    $x->orWhereRaw("translate(lower(c.full_name), 'áéíóúüñ', 'aeiouun') like translate(?, 'áéíóúüñ', 'aeiouun')", ['%'.mb_strtolower($t).'%']);
                });
            })
            ->orderBy('o.delivery_date')->orderBy('o.slot_from')->limit(100)
            ->get(['o.id', 'o.number', 'o.status', 'o.delivery_date', 'o.slot_from', 'o.slot_to', 'o.estimated_total', 'o.final_total', 'o.paid_amount',
                'o.balance_mode', 'o.requested_doc_type', 'c.full_name as cliente', 'c.phone', 'o.contact_phone', 'b.name as marca', 'o.units', 'o.est_kg']);

        return $filas->map(function ($o) {
            $s = Estados::saldo($o);

            return (array) $o + ['total' => $s['total'], 'saldo' => $s['diferencia'] < 0 ? round(-$s['diferencia'], 2) : 0.0, 'a_favor' => $s['diferencia'] > 0 ? $s['diferencia'] : 0.0,
                'comprobante' => DB::table('sales_documents')->where('order_id', $o->id)->where('doc_type', '<>', 'CREDIT_NOTE')->where('status', 'ISSUED')->value('full_number')];
        })->all();
    }

    /** El pedido por recoger con sus líneas, para cobrar y entregar. */
    public static function detalle(string $id, User $u): array
    {
        $o = Pedidos::pedido($id);
        if ($o->fulfillment !== 'PICKUP' || ! Cajas::enAlcance($o->pickup_establishment_id ?? $o->establishment_id, $u)) {
            abort(404, 'Pedido no encontrado.');
        }
        $ls = DB::table('sales_order_lines as l')->join('product_variants as v', 'v.id', '=', 'l.variant_id')->where('l.sales_order_id', $o->id)->orderBy('l.line_no')
            ->get(['l.id', 'l.qty', 'l.price_basis', 'l.unit_price', 'l.est_weight_kg', 'l.weighed_kg', 'l.est_amount', 'l.final_amount', 'v.name', 'v.sku', 'v.sale_mode']);
        $s = Estados::saldo($o);

        return ['pedido' => $o, 'lineas' => $ls, 'saldo' => $s, 'cliente' => DB::table('customers')->where('id', $o->customer_id)->first(['id', 'full_name', 'phone', 'doc_type', 'doc_number']),
            'marca' => DB::table('brands')->where('id', $o->brand_id)->value('name')];
    }

    /**
     * Cobra el saldo (si hay) y entrega. $d: payments (si falta cobrar), doc_type (si aún no tiene
     * comprobante; por defecto el pedido).
     */
    public static function entregar(string $id, array $d, User $u): array
    {
        return DB::transaction(function () use ($id, $d, $u) {
            $o = Pedidos::bloquear($id);
            $local = $o->pickup_establishment_id ?? $o->establishment_id;
            if ($o->fulfillment !== 'PICKUP' || ! Cajas::enAlcance($local, $u)) {
                abort(404, 'Pedido no encontrado.');
            }
            if ($o->status !== 'READY') {
                RuleError::fail('RN-PED-03', 'Solo se entrega en el mostrador un pedido LISTO para recojo (este está '.Estados::nombre($o->status).').');
            }
            $s = Estados::saldo($o);
            $falta = $s['tipo'] === 'POR_COBRAR' && $o->balance_mode !== 'WAIVE' ? round(-$s['diferencia'], 2) : 0.0;
            $turno = Turnos::abiertoDe($u);
            if ($falta > Cajas::EPS && ! $turno) {
                RuleError::fail('RN-POS-05', 'Falta cobrar S/ '.number_format($falta, 2).': todo cobro del mostrador se registra en un turno abierto. Abre tu turno.');
            }
            $caja = $turno ? Cajas::caja($turno->terminal_id)
                : DB::table('pos_terminals')->where('establishment_id', $local)->where('status', 'ACTIVE')->orderBy('code')->first();
            if (! $caja || $caja->establishment_id !== $local) {
                RuleError::fail('RN-POS-01', 'El pedido se recoge en otro local: entrégalo desde una caja de ese local.');
            }
            $cliente = Customer::find($o->customer_id);
            $v = null;
            if ($falta > Cajas::EPS) {
                $v = Cobros::validar($d['payments'] ?? [], $falta, $o->customer_id);
            } elseif (collect($d['payments'] ?? [])->contains(fn ($p) => (float) ($p['amount'] ?? 0) > 0)) {
                RuleError::fail('RN-POS-11', 'El pedido ya está pagado: no registres otro cobro.');
            }

            // Stock: las reservas pasan a salida; si el pedido no tiene reservas ni salidas, sale del almacén de la caja.
            $ls = DB::table('sales_order_lines as l')->join('product_variants as v', 'v.id', '=', 'l.variant_id')->where('l.sales_order_id', $o->id)->orderBy('l.line_no')
                ->get(['l.*', 'v.sale_mode', 'v.name']);
            $tieneReservas = DB::table('stock_reservations')->where('order_id', $o->id)->where('status', 'ACTIVE')->exists();
            if ($tieneReservas) {
                ReservasService::consumir($o->id, $u, $ls->filter(fn ($l) => $l->weighed_kg !== null)->mapWithKeys(fn ($l) => [$l->id => $l->weighed_kg])->all());
            } elseif (! DB::table('stock_movements')->where('source_type', 'SALES_ORDER')->where('source_id', $o->id)->where('movement_type', 'SALE')->exists()) {
                foreach ($ls as $l) {
                    $peso = $l->weighed_kg ?? $l->est_weight_kg;
                    InventarioService::mover([
                        'type' => 'SALE', 'warehouse_id' => $caja->warehouse_id, 'variant_id' => $l->variant_id,
                        'qty' => $l->sale_mode === 'KG' ? $peso : $l->qty, 'weight_kg' => $peso,
                        'source_type' => 'SALES_ORDER', 'source_id' => $o->id, 'reason' => "Recojo en el mostrador {$o->number}",
                    ], $u);
                }
            }

            $doc = DB::table('sales_documents')->where('order_id', $o->id)->whereIn('doc_type', ['RECEIPT', 'INVOICE'])->where('status', 'ISSUED')->first();
            if (! $doc) {
                $doc = self::emitir($o, $ls, $caja, $turno, $d['doc_type'] ?? $o->requested_doc_type, $u);
            }

            $pagado = (float) $o->paid_amount;
            $cobros = [];
            if ($v) {
                $r = Cobros::registrar($v, [['order_id' => $o->id, 'document_id' => $doc->id, 'amount' => $falta]], $caja, $turno, $o->customer_id, null, $u);
                $pagado = round($pagado + ($r['aplicado'][$o->id] ?? 0), 2);
                $cobros = $r['cobros'];
                DB::table('sales_orders')->where('id', $o->id)->update(['paid_amount' => $pagado, 'updated_at' => now()]);
            }
            DB::table('sales_documents')->where('id', $doc->id)->update(['balance' => round(max(0, (float) $doc->total - $pagado), 2), 'updated_at' => now()]);

            $nombreLocal = DB::table('establishments')->where('id', $local)->value('name');
            Estados::cambiar($o->id, 'DELIVERED', "Recogido en {$nombreLocal}", $u);
            $o = Pedidos::pedido($o->id);
            $cerrado = false;
            if (Estados::saldo($o)['tipo'] === 'CUADRA' || $o->balance_mode) {
                Estados::cerrar($o->id, $u);
                $cerrado = true;
            }
            Events::emit('pos.pickup.delivered', 'sales_orders', $o->id, ['number' => $o->number, 'collected' => $falta]);

            return ['pedido' => Pedidos::pedido($o->id), 'comprobante' => DB::table('sales_documents')->where('id', $doc->id)->first(['id', 'full_number', 'doc_type', 'total', 'sunat_status']),
                'cobrado' => $falta, 'vuelto' => $v['vuelto'] ?? 0, 'cerrado' => $cerrado, 'cobros' => array_map(fn ($c) => $c->number, $cobros)];
        });
    }

    /** Comprobante del pedido: líneas con el peso real; el descuento se reparte entre las líneas. */
    private static function emitir(object $o, $ls, object $caja, ?object $turno, string $tipo, User $u): object
    {
        $tipo = in_array($tipo, ['RECEIPT', 'INVOICE'], true) ? $tipo : 'RECEIPT';
        $cliente = Customer::find($o->billing_customer_id ?: $o->customer_id);
        $total = round((float) ($o->final_total ?? $o->estimated_total), 2);
        Comprobantes::validarCliente($tipo, $cliente, $total, $o->brand_id);
        $lineas = [];
        foreach ($ls as $l) {
            $porKg = $l->price_basis === 'KG';
            $peso = (float) ($l->weighed_kg ?? $l->est_weight_kg);
            $lineas[] = [
                'variant_id' => $l->variant_id, 'description' => $l->name, 'qty' => $porKg ? $peso : (float) $l->qty, 'uom_code' => $porKg ? 'KGM' : 'NIU',
                'unit_price' => (float) $l->unit_price, 'total' => round((float) ($l->final_amount ?? $l->est_amount), 2), 'lot_id' => $l->lot_id,
            ];
        }
        $suma = round(array_sum(array_column($lineas, 'total')), 2);
        if ($suma > 0 && abs($suma - $total) > 0.005) {
            // Descuento (o recargo) del pedido repartido en proporción; el redondeo va a la última línea.
            $acum = 0.0;
            foreach ($lineas as $i => &$l) {
                $l['total'] = $i === array_key_last($lineas) ? round($total - $acum, 2) : round($l['total'] * $total / $suma, 2);
                $acum = round($acum + $l['total'], 2);
                $l['unit_price'] = $l['qty'] > 0 ? round($l['total'] / $l['qty'], 2) : $l['unit_price'];
            }
            unset($l);
        }

        return Comprobantes::emitir([
            'brand_id' => $o->brand_id, 'establishment_id' => $caja->establishment_id, 'series_id' => Comprobantes::serieDeVenta($caja, $tipo, $o->brand_id)->id,
            'doc_type' => $tipo, 'customer' => $cliente, 'order_id' => $o->id, 'seller_id' => $o->seller_id,
            'pos_shift_id' => $turno?->id, 'pos_terminal_id' => $caja->id, 'balance' => $total,
        ], $lineas, $u);
    }
}
