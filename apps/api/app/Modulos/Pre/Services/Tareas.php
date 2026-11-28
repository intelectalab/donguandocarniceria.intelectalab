<?php

namespace App\Modulos\Pre\Services;

use App\Models\User;
use App\Modulos\Alm\Services\InventarioService;
use App\Modulos\Ped\Services\Estados;
use App\Support\Events;
use App\Support\RuleError;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * La tarea de preparación de un pedido y sus líneas (RN-PRE-01, RN-PRE-02). Se crea al planificar
 * la ola con los pedidos confirmados: una sola tarea activa por pedido (también en la base).
 */
final class Tareas
{
    public static function tarea(string $id): object
    {
        $t = DB::table('picking_tasks')->where('id', $id)->first();
        if (! $t) {
            abort(404, 'Tarea de preparación no encontrada.');
        }

        return $t;
    }

    public static function bloquear(string $id): object
    {
        $t = DB::table('picking_tasks')->where('id', $id)->lockForUpdate()->first();
        if (! $t) {
            abort(404, 'Tarea de preparación no encontrada.');
        }

        return $t;
    }

    /** La tarea si el usuario la ve (marca y local); si no, 404 como si no existiera. */
    public static function visible(string $id, User $u): object
    {
        $t = self::tarea($id);
        if (! Base::veTarea($t, $u)) {
            abort(404, 'Tarea de preparación no encontrada.');
        }

        return $t;
    }

    public static function activaDe(string $orderId): ?object
    {
        return DB::table('picking_tasks')->where('order_id', $orderId)->where('status', '<>', 'CANCELLED')->first();
    }

    public static function lineas(string $taskId): Collection
    {
        return DB::table('picking_task_lines as l')->join('product_variants as v', 'v.id', '=', 'l.variant_id')
            ->join('products as p', 'p.id', '=', 'v.product_id')
            ->leftJoin('sales_order_lines as ol', 'ol.id', '=', 'l.order_line_id')
            ->where('l.task_id', $taskId)->orderBy('ol.line_no')->orderBy('l.created_at')
            ->get(['l.*', 'v.sku', 'v.name', 'v.sale_mode', 'v.nominal_weight_kg', 'v.brand_id', 'p.requires_lot', 'p.storage', 'ol.price_basis', 'ol.line_no']);
    }

    /** RN-PRE-10: una línea por kg se completa al llegar a lo pedido menos pre_kg_fill_tolerance_pct. */
    public static function lineaCompleta(object $l, ?string $marca = null): bool
    {
        if ($l->status === 'SHORT_APPROVED') {
            return true;
        }
        if ($l->sale_mode === 'KG') {
            $tol = Base::num('pre_kg_fill_tolerance_pct', 10, $marca);

            return (float) ($l->weighed_kg ?? 0) >= (float) $l->qty_required * (1 - $tol / 100) - Base::EPS;
        }

        return (float) $l->qty_picked >= (float) $l->qty_required - Base::EPS;
    }

    /** Avance de la línea de 0 a 1. */
    public static function avanceLinea(object $l, ?string $marca = null): float
    {
        if (self::lineaCompleta($l, $marca)) {
            return 1.0;
        }
        $req = max(Base::EPS, (float) $l->qty_required);
        $hecho = $l->sale_mode === 'KG' ? (float) ($l->weighed_kg ?? 0) : (float) $l->qty_picked;

        return max(0, min(1, $hecho / $req));
    }

    /** Avance de la tarea en %, 0 a 100. */
    public static function avance(object $t): int
    {
        if (in_array($t->status, ['PICKED', 'PACKED', 'VERIFIED', 'LOADED'], true)) {
            return 100;
        }
        $ls = self::lineas($t->id);
        if ($ls->isEmpty()) {
            return 0;
        }

        return (int) round($ls->avg(fn ($l) => self::avanceLinea($l, $t->brand_id)) * 100);
    }

    /**
     * RN-PRE-01 y RN-PRE-02: la tarea del pedido con sus líneas. Solo entra un pedido confirmado o en
     * preparación. Si ya existe y nadie la empezó (sin lecturas), se actualiza con el pedido tal como
     * está (por si volvió a borrador y se corrigió).
     */
    public static function asegurar(object $o): object
    {
        if (! in_array($o->status, ['CONFIRMED', 'IN_PREPARATION'], true)) {
            RuleError::fail('RN-PRE-01', "El pedido {$o->number} está ".Estados::nombre($o->status).': solo entra a preparación un pedido confirmado o en preparación.');
        }
        if ($o->fulfillment === 'COUNTER') {
            RuleError::fail('RN-PRE-01', "El pedido {$o->number} es de mostrador: se entrega en el momento y no pasa por preparación.");
        }
        $t = self::activaDe($o->id);
        if ($t && ($t->status !== 'PENDING' || DB::table('picking_scans')->where('task_id', $t->id)->exists())) {
            return $t;
        }
        $datos = ['order_number' => $o->number, 'establishment_id' => $o->establishment_id, 'brand_id' => $o->brand_id,
            'delivery_date' => $o->delivery_date, 'slot_from' => $o->slot_from, 'slot_to' => $o->slot_to];
        if ($t) {
            DB::table('picking_tasks')->where('id', $t->id)->update($datos + ['updated_at' => now()]);
            DB::table('picking_task_lines')->where('task_id', $t->id)->delete();
            $id = $t->id;
        } else {
            $id = DB::table('picking_tasks')->insertGetId($datos + ['order_id' => $o->id, 'status' => 'PENDING', 'stock_moved' => false], 'id');
        }
        $lineas = DB::table('sales_order_lines as l')->join('product_variants as v', 'v.id', '=', 'l.variant_id')
            ->where('l.sales_order_id', $o->id)->orderBy('l.line_no')->get(['l.id', 'l.variant_id', 'l.qty', 'l.est_weight_kg', 'l.cut_notes', 'v.sale_mode']);
        if ($lineas->isEmpty()) {
            RuleError::fail('RN-PRE-02', "El pedido {$o->number} no tiene productos.");
        }
        foreach ($lineas as $l) {
            DB::table('picking_task_lines')->insert([
                'task_id' => $id, 'order_line_id' => $l->id, 'variant_id' => $l->variant_id, 'qty_required' => $l->qty, 'qty_picked' => 0,
                'est_weight_kg' => $l->est_weight_kg, 'status' => 'PENDING', 'cut_notes' => $l->cut_notes, 'weighted' => $l->sale_mode !== 'UNIT',
            ]);
        }

        return self::tarea($id);
    }

    /**
     * El pedido se canceló después de entrar a preparación: la tarea se anula, sus bolsas vuelven y,
     * si ya se descontó el stock, se reingresa al almacén de devoluciones del local (ALM).
     */
    public static function anular(string $taskId, ?string $nota, User $u): object
    {
        return DB::transaction(function () use ($taskId, $nota, $u) {
            $t = self::bloquear($taskId);
            if ($t->status === 'CANCELLED') {
                RuleError::fail('RN-PRE-01', 'La tarea ya está anulada.');
            }
            $o = DB::table('sales_orders')->where('id', $t->order_id)->first();
            if ($o->status !== 'CANCELLED') {
                RuleError::fail('RN-PRE-01', "El pedido {$o->number} sigue ".Estados::nombre($o->status).': solo se anula la tarea de un pedido cancelado.');
            }
            $devuelto = false;
            if ($t->stock_moved) {
                $hay = DB::table('stock_movements')->where('source_type', 'SALES_ORDER')->where('source_id', $o->id)->where('movement_type', 'SALE')->exists();
                if ($hay) {
                    InventarioService::devolver('SALES_ORDER', $o->id, "Pedido {$o->number} cancelado después de preparar", $u);
                    $devuelto = true;
                }
            }
            DB::table('shipment_parcels')->where('task_id', $t->id)->update(['status' => 'RETURNED', 'updated_at' => now()]);
            DB::table('picking_tasks')->where('id', $t->id)->update([
                'status' => 'CANCELLED', 'cancelled_at' => now(), 'cancel_note' => mb_substr(trim((string) $nota) ?: 'Pedido cancelado', 0, 255), 'updated_at' => now(),
            ]);
            Events::emit('picking_task.cancelled', 'picking_tasks', $t->id, ['order_id' => $o->id, 'number' => $o->number, 'stock_returned' => $devuelto]);
            if ($t->wave_id) {
                Olas::recalcular($t->wave_id);
            }

            return self::tarea($t->id);
        });
    }

    /** El pedido de la tarea, exigiendo que se pueda seguir trabajando (no cancelado). */
    public static function pedidoVivo(object $t): object
    {
        $o = DB::table('sales_orders')->where('id', $t->order_id)->first();
        if ($o->status === 'CANCELLED') {
            RuleError::fail('RN-PRE-01', "El pedido {$o->number} fue cancelado: no lo armes. Anula la tarea desde Lista por pedido para devolver lo separado.");
        }

        return $o;
    }
}
