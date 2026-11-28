<?php

namespace App\Modulos\Pre\Services;

use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Lo que DEL (reparto) usa de PRE. PRE sigue siendo el dueño de picking_tasks y shipment_parcels:
 *  - sincronizar(): cuando DEL arma, mueve o reordena una parada, la tarea y sus bolsas toman la ruta y la
 *    parada de DEL (route_key «DEL:<ruta>»), así la etiqueta y la carga en orden inverso (RN-PRE-08) usan
 *    el orden de DEL. Una bolsa ya cargada en otra ruta vuelve a «por cargar».
 *  - cargar(): carga por escaneo en el vehículo de una ruta de DEL (la misma regla de PRE-08).
 *  - marcar(): las bolsas pasan a entregadas (RN-DEL-06) o devueltas (RN-DEL-07).
 *  - liberar(): un no entregado cuyas bolsas volvieron al almacén cierra su tarea; al reprogramarlo, PRE lo
 *    prepara de nuevo en una ola (el stock ya volvió con el movimiento RETURN de ALM).
 */
final class Reparto
{
    public static function claveDel(string $routeId): string
    {
        return 'DEL:'.$routeId;
    }

    /** Pone la ruta y parada de DEL (o la de su zona si ya no tiene parada) en la tarea y las bolsas del pedido. */
    public static function sincronizar(string $orderId): void
    {
        $t = DB::table('picking_tasks')->where('order_id', $orderId)->where('status', '<>', 'CANCELLED')->first();
        if (! $t) {
            return;
        }
        $d = Olas::paradaDel($orderId);
        if (! $d) {
            if (! str_starts_with((string) $t->route_key, 'DEL:')) {
                return;
            }
            // La parada salió de la ruta de DEL: vuelve a la ruta de su zona.
            DB::table('picking_tasks')->where('id', $t->id)->update(['route_key' => null, 'route_id' => null, 'updated_at' => now()]);
            $d = Olas::rutaDe(DB::table('picking_tasks')->where('id', $t->id)->first());
        }
        if ($t->route_key === $d['route_key'] && (int) $t->stop_seq === (int) $d['stop_seq'] && $t->route_code === $d['route_code']) {
            return;
        }
        DB::table('picking_tasks')->where('id', $t->id)->update($d + ['updated_at' => now()]);
        $bolsas = DB::table('shipment_parcels')->where('task_id', $t->id)->whereIn('status', ['SEALED', 'LOADED']);
        if ($t->route_key !== $d['route_key']) {
            // Cambió de vehículo: lo cargado en el otro se baja y se vuelve a escanear en el nuevo.
            (clone $bolsas)->where('status', 'LOADED')->update(['status' => 'SEALED', 'loaded_at' => null, 'loaded_by' => null, 'updated_at' => now()]);
            if ($t->status === 'LOADED') {
                DB::table('picking_tasks')->where('id', $t->id)->update(['status' => 'VERIFIED', 'loaded_at' => null, 'updated_at' => now()]);
            }
        }
        $bolsas->update(['route_id' => $d['route_id'], 'route_code' => $d['route_code'], 'route_key' => $d['route_key'], 'stop_seq' => $d['stop_seq'], 'updated_at' => now()]);
    }

    /** Bolsas del pedido para la hoja de ruta y la app. */
    public static function bolsas(string $orderId): array
    {
        return DB::table('shipment_parcels as p')->join('picking_tasks as t', 't.id', '=', 'p.task_id')
            ->where('p.order_id', $orderId)->where('t.status', '<>', 'CANCELLED')->orderBy('p.parcel_no')
            ->get(['p.id', 'p.label_code', 'p.parcel_no', 'p.parcel_count', 'p.parcel_type', 'p.status', 'p.weight_kg', 'p.route_key', 'p.loaded_at'])
            ->map(fn ($b) => (array) $b)->all();
    }

    /** Escaneo de una bolsa al subirla al vehículo de una ruta de DEL (RN-PRE-08 / RN-DEL-04). */
    public static function cargar(string $routeId, string $codigo, User $u, string $dispositivo = 'WEB'): array
    {
        return Despacho::cargar(self::claveDel($routeId), $codigo, $u, $dispositivo);
    }

    /** Las bolsas del pedido pasan a entregadas o devueltas. */
    public static function marcar(string $orderId, string $estado): int
    {
        $de = $estado === 'DELIVERED' ? ['LOADED', 'SEALED'] : ['LOADED', 'SEALED', 'DELIVERED'];

        return DB::table('shipment_parcels')->where('order_id', $orderId)->whereIn('status', $de)
            ->whereIn('task_id', DB::table('picking_tasks')->where('order_id', $orderId)->where('status', '<>', 'CANCELLED')->select('id'))
            ->update(['status' => $estado, 'updated_at' => now()]);
    }

    /** Cierra la tarea del pedido devuelto (sus bolsas quedan como devueltas) para que PRE lo vuelva a preparar. */
    public static function liberar(string $orderId, string $nota): void
    {
        $t = DB::table('picking_tasks')->where('order_id', $orderId)->where('status', '<>', 'CANCELLED')->first();
        if (! $t) {
            return;
        }
        DB::table('shipment_parcels')->where('task_id', $t->id)->where('status', '<>', 'RETURNED')->update(['status' => 'RETURNED', 'updated_at' => now()]);
        DB::table('picking_tasks')->where('id', $t->id)->update(['status' => 'CANCELLED', 'cancelled_at' => now(), 'cancel_note' => mb_substr($nota, 0, 255), 'updated_at' => now()]);
    }
}
