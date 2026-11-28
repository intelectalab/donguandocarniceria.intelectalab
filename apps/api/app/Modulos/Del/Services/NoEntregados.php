<?php

namespace App\Modulos\Del\Services;

use App\Models\User;
use App\Modulos\Alm\Services\InventarioService;
use App\Modulos\Ped\Services\Estados;
use App\Modulos\Pre\Services\Reparto;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * DEL-16 No entregados (RN-DEL-07, RN-PED-14): el almacén recibe las bolsas devueltas (el stock vuelve con
 * el movimiento RETURN de ALM y la preparación se cierra) y el coordinador reprograma el pedido. Al
 * reprogramarlo, el pedido vuelve a CONFIRMADO y PRE lo prepara de nuevo en una ola.
 */
final class NoEntregados
{
    private static function fallida(string $stopId, User $u): array
    {
        $s = DB::table('delivery_stops')->where('id', $stopId)->lockForUpdate()->first();
        if (! $s) {
            abort(404, 'No se encontró la parada.');
        }
        $r = Base::rutaVisible($s->route_id, $u, true);
        if ($s->status !== 'FAILED') {
            RuleError::fail('RN-DEL-07', "La parada {$s->seq} de {$r->code} está ".Base::parada($s->status).': no es un no entregado pendiente.');
        }
        $o = DB::table('sales_orders')->where('id', $s->order_id)->lockForUpdate()->first();

        return [$s, $r, $o];
    }

    /** Las bolsas del no entregado vuelven al almacén: reingreso del stock y cierre de la preparación. */
    public static function recibirBolsas(string $stopId, ?string $nota, User $u): object
    {
        return DB::transaction(function () use ($stopId, $nota, $u) {
            [$s, $r, $o] = self::fallida($stopId, $u);
            if ($s->bags_returned) {
                RuleError::fail('RN-DEL-07', 'Las bolsas de esta parada ya se recibieron en el almacén.');
            }
            if ($o->status !== 'NOT_DELIVERED') {
                RuleError::fail('RN-DEL-07', "El pedido {$o->number} está ".Estados::nombre($o->status).': sus bolsas ya no se reciben aquí.');
            }
            $motivo = "No entregado {$o->number} (ruta {$r->code})".($nota ? ': '.trim($nota) : '');
            $salio = DB::table('stock_movements')->where('source_type', 'SALES_ORDER')->where('source_id', $o->id)->where('movement_type', 'SALE')->exists();
            if ($salio) {
                InventarioService::devolver('SALES_ORDER', $o->id, mb_substr($motivo, 0, 255), $u);
            }
            Reparto::liberar($o->id, 'Bolsas devueltas al almacén: '.mb_substr($motivo, 0, 200));
            DB::table('delivery_stops')->where('id', $s->id)->update(['bags_returned' => true, 'bags_returned_at' => now(), 'bags_returned_by' => $u->id, 'updated_at' => now()]);
            Base::evento(['route_id' => $r->id, 'stop_id' => $s->id, 'event_type' => 'BAGS_RETURNED',
                'notes' => 'Bolsas recibidas en el almacén'.($salio ? ' y stock reingresado' : '').($nota ? ' · '.trim($nota) : '')], $u);

            return Rutas::parada($s->id);
        });
    }

    /** Reprograma el pedido (RN-PED-14). Exige las bolsas recibidas: el pedido se vuelve a preparar fresco. */
    public static function reprogramar(string $stopId, string $fecha, string $franjaId, string $motivo, User $u): object
    {
        return DB::transaction(function () use ($stopId, $fecha, $franjaId, $motivo, $u) {
            [$s, $r, $o] = self::fallida($stopId, $u);
            if (! $s->bags_returned) {
                RuleError::fail('RN-DEL-07', 'Recibe primero las bolsas en el almacén: el pedido se vuelve a preparar para la nueva fecha.');
            }
            if ($fecha < Base::hoy()) {
                RuleError::fail('RN-PED-14', 'Elige hoy o una fecha futura.');
            }
            Estados::reprogramar($o->id, $fecha, $franjaId, $motivo, $u);
            DB::table('delivery_stops')->where('id', $s->id)->update(['status' => 'RESCHEDULED', 'rescheduled_to' => $fecha, 'updated_at' => now()]);
            Seguimiento::anular($o->id);

            return Rutas::parada($s->id);
        });
    }
}
