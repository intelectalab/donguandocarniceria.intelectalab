<?php

namespace App\Modulos\Del\Services;

use App\Models\User;
use App\Support\RuleError;
use App\Support\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * DEL-07 Seguimiento en mapa y DEL-08 Enlace de seguimiento (RN-DEL-08): token aleatorio por pedido; la
 * página pública solo muestra estado, hora estimada y el nombre de pila del repartidor, y vence
 * del_tracking_link_hours (48 h) después de la entrega.
 */
final class Seguimiento
{
    /** Enlace vigente del pedido; si no hay, se crea (vence 2 días después de la fecha de entrega). */
    public static function enlace(string $orderId): object
    {
        $t = DB::table('tracking_links')->where('order_id', $orderId)->where('revoked', false)->orderByDesc('created_at')->first();
        if ($t) {
            return $t;
        }
        $fecha = DB::table('sales_orders')->where('id', $orderId)->value('delivery_date') ?? Base::hoy();
        $vence = CarbonImmutable::parse($fecha, 'America/Lima')->addDays(2)->endOfDay();
        $id = DB::table('tracking_links')->insertGetId(['order_id' => $orderId, 'token' => Str::random(22), 'expires_at' => $vence, 'revoked' => false], 'id');

        return DB::table('tracking_links')->where('id', $id)->first();
    }

    /** Al entregar: el enlace vence del_tracking_link_hours después. */
    public static function alEntregar(string $orderId): void
    {
        $horas = (int) Base::num('del_tracking_link_hours', 48);
        DB::table('tracking_links')->where('order_id', $orderId)->where('revoked', false)->update(['expires_at' => now()->addHours($horas), 'updated_at' => now()]);
    }

    public static function anular(string $orderId): void
    {
        DB::table('tracking_links')->where('order_id', $orderId)->where('revoked', false)->update(['revoked' => true, 'updated_at' => now()]);
    }

    /** Lo que ve el cliente, sin sesión. Solo su pedido: estado, hora estimada y nombre de pila. */
    public static function publico(string $token): array
    {
        $empresa = DB::selectOne('SELECT del_tracking_tenant(?) AS t', [$token])?->t;
        if (! $empresa) {
            RuleError::fail('RN-DEL-08', 'Este enlace no existe. Pide uno nuevo a la tienda.');
        }
        TenantContext::set(TenantContext::find($empresa));
        $t = DB::table('tracking_links')->where('token', $token)->first();
        if ($t->revoked) {
            RuleError::fail('RN-DEL-08', 'Este enlace fue anulado por la tienda.');
        }
        if (CarbonImmutable::parse($t->expires_at)->isPast()) {
            RuleError::fail('RN-DEL-08', 'Este enlace ya venció.');
        }
        $o = DB::table('sales_orders')->where('id', $t->order_id)->first();
        $s = Rutas::paradaActiva($o->id) ?? DB::table('delivery_stops')->where('order_id', $o->id)->orderByDesc('created_at')->first();
        $r = $s ? Rutas::ruta($s->route_id) : null;
        $antes = null;
        if ($s && $r && in_array($s->status, Base::ABIERTAS, true) && $r->status === 'IN_ROUTE') {
            $antes = DB::table('delivery_stops')->where('route_id', $r->id)->whereIn('status', Base::ABIERTAS)->where('seq', '<', $s->seq)->count();
        }
        $repartidor = null;
        if ($r?->driver_user_id) {
            $repartidor = Base::primerNombre(DB::table('users')->where('id', $r->driver_user_id)->value('name'));
        } elseif ($r?->carrier_supplier_id) {
            $repartidor = DB::table('suppliers')->where('id', $r->carrier_supplier_id)->value('trade_name');
        }
        $marca = DB::table('brands')->where('id', $o->brand_id)->value('name');
        $entregado = in_array($o->status, ['DELIVERED', 'CLOSED'], true);
        $paso = match (true) {
            $entregado => 4,
            $o->status === 'IN_ROUTE' => 3,
            in_array($o->status, ['READY', 'WEIGHED', 'IN_PREPARATION'], true) => 2,
            default => 1,
        };

        return [
            'pedido' => $o->number, 'marca' => $marca, 'estado' => $o->status, 'paso' => $paso,
            'franja' => $o->slot_from ? substr((string) $o->slot_from, 0, 5).'–'.substr((string) $o->slot_to, 0, 5) : null,
            'fecha' => $o->delivery_date,
            'hora_estimada' => $s && $s->eta && in_array($s->status, Base::ABIERTAS, true) ? CarbonImmutable::parse($s->eta)->setTimezone('America/Lima')->format('H:i') : null,
            'entregado_a_las' => $entregado ? CarbonImmutable::parse($s?->closed_at ?? $o->delivered_at ?? now())->setTimezone('America/Lima')->format('d/m H:i') : null,
            'no_entregado' => $o->status === 'NOT_DELIVERED',
            'repartidor' => $o->status === 'IN_ROUTE' || $entregado ? $repartidor : null,
            'paradas_antes' => $antes,
            'vence' => $t->expires_at,
        ];
    }

    /** Última posición conocida de la ruta (de cualquier evento con lugar). */
    public static function ultimaPosicion(string $routeId): ?array
    {
        $e = DB::table('delivery_events')->where('route_id', $routeId)->whereNotNull('lat')->orderByDesc('occurred_at')->orderByDesc('created_at')->first(['lat', 'lng', 'occurred_at', 'event_type']);

        return $e ? ['lat' => (float) $e->lat, 'lng' => (float) $e->lng, 'at' => $e->occurred_at, 'fuente' => $e->event_type] : null;
    }

    /** DEL-07: rutas del día con su última posición, paradas hechas y atrasadas, entregas fuera del radio. */
    public static function mapa(string $fecha, User $u, ?string $local = null): array
    {
        $max = Base::num('del_pod_max_distance_m', 300);
        $ahora = now();
        $rutas = Base::alcance(DB::table('delivery_routes as r'), $u)->where('r.route_date', $fecha)->whereNotIn('r.status', ['CANCELLED'])
            ->when($local, fn ($q) => $q->where('r.establishment_id', $local))
            ->leftJoin('users as d', 'd.id', '=', 'r.driver_user_id')->leftJoin('vehicles as v', 'v.id', '=', 'r.vehicle_id')
            ->leftJoin('suppliers as c', 'c.id', '=', 'r.carrier_supplier_id')
            ->orderByRaw("CASE r.status WHEN 'IN_ROUTE' THEN 0 WHEN 'LOADING' THEN 1 WHEN 'PLANNED' THEN 2 ELSE 3 END")->orderBy('r.code')
            ->get(['r.id', 'r.code', 'r.status', 'r.mode', 'r.slot_from', 'r.slot_to', 'r.departed_at', 'r.returned_at', 'r.establishment_id',
                'd.name as repartidor', 'v.plate', 'c.trade_name as empresa']);
        $out = [];
        $fuera = [];
        foreach ($rutas as $r) {
            $paradas = DB::table('delivery_stops as s')->join('sales_orders as o', 'o.id', '=', 's.order_id')
                ->leftJoin('customer_addresses as a', 'a.id', '=', 'o.address_id')
                ->where('s.route_id', $r->id)->whereIn('s.status', Base::EN_RUTA)->orderBy('s.seq')
                ->get(['s.id', 's.seq', 's.status', 's.eta', 's.closed_at', 's.pod_distance_m', 'o.number', 'o.customer_id', 'a.lat', 'a.lng', 'a.district']);
            $lista = [];
            $hechas = 0;
            $atrasadas = 0;
            foreach ($paradas as $s) {
                $atrasada = in_array($s->status, Base::ABIERTAS, true) && $s->eta && CarbonImmutable::parse($s->eta)->lessThan($ahora) && $r->status === 'IN_ROUTE';
                $hechas += in_array($s->status, ['DELIVERED', 'FAILED', 'HANDED_OFF'], true) ? 1 : 0;
                $atrasadas += $atrasada ? 1 : 0;
                $esFuera = $s->status === 'DELIVERED' && $s->pod_distance_m !== null && (float) $s->pod_distance_m > $max;
                if ($esFuera) {
                    $fuera[] = ['ruta' => $r->code, 'parada' => $s->seq, 'pedido' => $s->number, 'distancia_m' => (float) $s->pod_distance_m, 'hora' => $s->closed_at];
                }
                $lista[] = ['id' => $s->id, 'seq' => $s->seq, 'status' => $s->status, 'eta' => $s->eta, 'closed_at' => $s->closed_at, 'pedido' => $s->number,
                    'cliente' => Base::cliente($s->customer_id), 'distrito' => $s->district, 'lat' => $s->lat !== null ? (float) $s->lat : null,
                    'lng' => $s->lng !== null ? (float) $s->lng : null, 'atrasada' => $atrasada, 'fuera_radio' => $esFuera];
            }
            $out[] = (array) $r + ['posicion' => self::ultimaPosicion($r->id), 'paradas' => $lista, 'total' => count($lista), 'hechas' => $hechas, 'atrasadas' => $atrasadas,
                'local' => Rutas::puntoLocal($r->establishment_id)];
        }

        return ['rutas' => $out, 'fuera_radio' => $fuera, 'radio_m' => $max];
    }
}
