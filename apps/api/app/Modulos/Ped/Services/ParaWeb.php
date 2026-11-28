<?php

namespace App\Modulos\Ped\Services;

use Illuminate\Support\Facades\DB;

/**
 * Lo que WEB necesita de PED y Pedidos::guardar no recibe (lo usa solo WEB, en la misma transacción que crea el pedido).
 *  - El enlace del pedido con su tienda y su registro de la bandeja (sales_orders.web_store_id y web_inbox_id).
 *  - D-WEB-01: un carrito con varias marcas se divide en un pedido por marca; los pedidos que no son el primero no
 *    vuelven a cobrar el delivery (fee_override = 0) y dicen con quién lo comparten.
 *  - RN-WEB-08: si la web cobró menos que la lista vigente, la diferencia queda como descuento «Precio web», ya
 *    aprobado (es lo que el cliente pagó, no un descuento de la vendedora).
 */
final class ParaWeb
{
    public static function enlazar(string $orderId, string $storeId, string $inboxId, ?string $compartidoCon = null): void
    {
        $datos = ['web_store_id' => $storeId, 'web_inbox_id' => $inboxId, 'updated_at' => now()];
        if ($compartidoCon) {
            $datos += ['fee_override' => 0, 'shared_delivery_with' => mb_substr($compartidoCon, 0, 40)];
        }
        DB::table('sales_orders')->where('id', $orderId)->update($datos);
        Pedidos::recalcular($orderId);
    }

    public static function descuentoPrecioWeb(string $orderId, float $monto): object
    {
        DB::table('sales_orders')->where('id', $orderId)->where('status', 'DRAFT')->update([
            'order_discount' => round($monto, 2), 'order_discount_pct' => null, 'discount_reason' => 'Precio web', 'discount_status' => 'APPROVED', 'updated_at' => now(),
        ]);

        return Pedidos::recalcular($orderId);
    }
}
