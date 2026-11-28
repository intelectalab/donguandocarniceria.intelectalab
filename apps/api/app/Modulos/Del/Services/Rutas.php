<?php

namespace App\Modulos\Del\Services;

use App\Models\User;
use App\Modulos\Ped\Services\Estados;
use App\Modulos\Pre\Services\Reparto;
use App\Support\Events;
use App\Support\RuleError;
use Carbon\CarbonImmutable;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Rutas y paradas (DEL-01 a DEL-03): armar rutas con orden sugerido (RN-DEL-02), asignar modalidad,
 * vehículo y repartidor o empresa (RN-DEL-01 y RN-DEL-03), cargar las bolsas, salir (RN-DEL-04) y volver.
 */
final class Rutas
{
    /** Estados del pedido que se pueden programar en una ruta. */
    public const PEDIDO_PROGRAMABLE = ['CONFIRMED', 'IN_PREPARATION', 'WEIGHED', 'READY', 'NOT_DELIVERED'];

    /** Medios que se cobran al entregar (los demás se pagan antes: pasarela, transferencia o crédito). */
    public const MEDIOS_CONTRA_ENTREGA = ['CASH', 'CARD', 'YAPE', 'PLIN'];

    public static function ruta(string $id): object
    {
        $r = DB::table('delivery_routes')->where('id', $id)->first();
        if (! $r) {
            abort(404, 'No se encontró la ruta.');
        }

        return $r;
    }

    public static function parada(string $id): object
    {
        $s = DB::table('delivery_stops')->where('id', $id)->first();
        if (! $s) {
            abort(404, 'No se encontró la parada.');
        }

        return $s;
    }

    /** Paradas que cuentan en la ruta, en orden. */
    public static function paradas(string $routeId): Collection
    {
        return DB::table('delivery_stops')->where('route_id', $routeId)->whereIn('status', Base::EN_RUTA)->orderBy('seq')->get();
    }

    public static function paradaActiva(string $orderId): ?object
    {
        return DB::table('delivery_stops')->where('order_id', $orderId)->whereNotIn('status', ['FAILED', 'RESCHEDULED', 'CANCELLED'])->first();
    }

    /** Kg del pedido: el peso real, o el estimado, o el peso nominal por unidad. */
    public static function kgPedido(string $orderId): float
    {
        $kg = DB::table('sales_order_lines as l')->leftJoin('product_variants as v', 'v.id', '=', 'l.variant_id')->where('l.sales_order_id', $orderId)
            ->selectRaw("coalesce(sum(CASE WHEN l.price_basis = 'KG' THEN coalesce(l.weighed_kg, l.est_weight_kg, l.qty) ELSE l.qty * coalesce(v.nominal_weight_kg, 0.5) END), 0) AS kg")
            ->value('kg');

        return round((float) $kg, 3);
    }

    public static function totalPedido(object $o): float
    {
        return round((float) ($o->final_total ?? $o->estimated_total ?? 0), 2);
    }

    /** Monto a cobrar al entregar (RN-DEL-09): el saldo del pedido si se paga contra entrega. */
    public static function cobroPedido(object $o): float
    {
        $medio = $o->payment_method_id ? DB::table('payment_methods')->where('id', $o->payment_method_id)->value('code') : null;
        if (! in_array($medio, self::MEDIOS_CONTRA_ENTREGA, true)) {
            return 0.0;
        }

        return max(0.0, round(self::totalPedido($o) - (float) ($o->paid_amount ?? 0), 2));
    }

    /** Punto del pedido: el pin de la dirección o el centro de la zona. */
    public static function punto(object $o): array
    {
        $a = $o->address_id ? DB::table('customer_addresses')->where('id', $o->address_id)->first(['lat', 'lng']) : null;
        if ($a && $a->lat !== null) {
            return [(float) $a->lat, (float) $a->lng];
        }
        $z = $o->zone_id ? DB::table('delivery_zones')->where('id', $o->zone_id)->first(['lat', 'lng']) : null;
        if ($z && $z->lat !== null) {
            return [(float) $z->lat, (float) $z->lng];
        }

        return self::puntoLocal($o->establishment_id);
    }

    public static function puntoLocal(?string $establecimiento): array
    {
        $e = $establecimiento ? DB::table('establishments')->where('id', $establecimiento)->first(['lat', 'lng']) : null;

        return $e && $e->lat !== null ? [(float) $e->lat, (float) $e->lng] : [-12.13, -76.99];
    }

    private static function km(array $a, array $b): float
    {
        return Base::km($a[0], $a[1], $b[0], $b[1]) ?? 0.0;
    }

    /** Código «L1-F1-R» con sufijo si ya existe ese día. */
    public static function codigo(string $fecha, string $local, ?object $franja): string
    {
        $l = DB::table('establishments')->where('id', $local)->value('code') ?: 'L';
        $f = $franja ? 'F'.substr((string) $franja->slot_from, 0, 2) : 'D';
        $base = "{$l}-{$f}-R";
        $codigo = $base;
        $i = 2;
        while (DB::table('delivery_routes')->where('route_date', $fecha)->where('code', $codigo)->exists()) {
            $codigo = $base.$i++;
        }

        return mb_substr($codigo, 0, 40);
    }

    /** DEL-01: crea la ruta (con sus pedidos, si vienen) en orden sugerido. */
    public static function crear(array $d, User $u): object
    {
        return DB::transaction(function () use ($d, $u) {
            if (! Base::veLocal($u, $d['establishment_id'])) {
                RuleError::fail('RN-DEL-02', 'Ese local no está en tu alcance.');
            }
            $franja = ! empty($d['slot_id']) ? DB::table('order_time_slots')->where('id', $d['slot_id'])->first() : null;
            if (! empty($d['slot_id']) && (! $franja || $franja->establishment_id !== $d['establishment_id'])) {
                RuleError::fail('RN-DEL-02', 'La franja elegida no es de ese local.');
            }
            $codigo = trim((string) ($d['code'] ?? '')) !== '' ? mb_strtoupper(trim($d['code'])) : self::codigo($d['route_date'], $d['establishment_id'], $franja);
            if (DB::table('delivery_routes')->where('route_date', $d['route_date'])->where('code', $codigo)->exists()) {
                RuleError::fail('RN-DEL-02', "Ya existe la ruta {$codigo} el ".Base::fecha($d['route_date']).'.');
            }
            $id = DB::table('delivery_routes')->insertGetId([
                'code' => $codigo, 'route_date' => $d['route_date'], 'establishment_id' => $d['establishment_id'],
                'slot_from' => $franja?->slot_from, 'slot_to' => $franja?->slot_to, 'mode' => $d['mode'] ?? 'OWN', 'sequence_method' => 'NEAREST_NEIGHBOR',
                'planned_km' => 0, 'status' => 'PLANNED', 'created_by' => $u->id,
            ], 'id');
            foreach ($d['order_ids'] ?? [] as $oid) {
                self::agregarSinOrden($id, $oid);
            }
            self::ordenar($id);
            Events::emit('route.planned', 'delivery_routes', $id, ['code' => $codigo, 'date' => $d['route_date']]);

            return self::ruta($id);
        });
    }

    private static function exigirEditable(object $r): void
    {
        if (! in_array($r->status, ['PLANNED', 'LOADING'], true)) {
            RuleError::fail('RN-DEL-02', "La ruta {$r->code} está ".Base::ruta($r->status).': ya no se cambian sus paradas.');
        }
    }

    private static function agregarSinOrden(string $routeId, string $orderId): object
    {
        $r = DB::table('delivery_routes')->where('id', $routeId)->lockForUpdate()->first();
        self::exigirEditable($r);
        $o = DB::table('sales_orders')->where('id', $orderId)->lockForUpdate()->first();
        if (! $o) {
            RuleError::fail('RN-DEL-02', 'No se encontró el pedido.');
        }
        if ($o->fulfillment !== 'DELIVERY') {
            RuleError::fail('RN-DEL-02', "El pedido {$o->number} no es de delivery: no va en una ruta de reparto.");
        }
        if (! in_array($o->status, self::PEDIDO_PROGRAMABLE, true)) {
            RuleError::fail('RN-DEL-02', "El pedido {$o->number} está ".Estados::nombre($o->status).': no se puede programar.');
        }
        if ($o->establishment_id !== $r->establishment_id) {
            RuleError::fail('RN-DEL-02', "El pedido {$o->number} lo atiende otro local.");
        }
        if ($act = self::paradaActiva($o->id)) {
            $otra = DB::table('delivery_routes')->where('id', $act->route_id)->value('code');
            RuleError::fail('RN-DEL-02', "El pedido {$o->number} ya tiene una parada activa en la ruta {$otra}: muévela en lugar de duplicarla.");
        }
        if (! $o->zone_id) {
            RuleError::fail('RN-DEL-02', "El pedido {$o->number} no tiene zona de reparto: corrige su dirección.");
        }
        $seq = (int) DB::table('delivery_stops')->where('route_id', $routeId)->whereIn('status', Base::EN_RUTA)->max('seq') + 1;
        $id = DB::table('delivery_stops')->insertGetId([
            'route_id' => $routeId, 'order_id' => $o->id, 'seq' => $seq, 'zone_id' => $o->zone_id, 'status' => 'PENDING',
            'cod_amount' => self::cobroPedido($o), 'collected_amount' => 0, 'bags' => json_encode(self::bolsasVirtuales($o)), 'kg' => self::kgPedido($o->id),
        ], 'id');
        if ($r->status === 'LOADING') {
            // Llegó una parada nueva a una ruta que ya cargaba: falta cargar sus bolsas.
            DB::table('delivery_routes')->where('id', $r->id)->update(['updated_at' => now()]);
        }

        return self::parada($id);
    }

    /** Bolsas de respaldo cuando el pedido no pasó por PRE: una por línea. */
    public static function bolsasVirtuales(object $o): array
    {
        $n = max(1, (int) DB::table('sales_order_lines')->where('sales_order_id', $o->id)->count());

        return array_map(fn ($i) => ['no' => $i, 'count' => $n, 'label' => "{$o->number}-{$i}/{$n}", 'status' => 'SEALED'], range(1, $n));
    }

    public static function agregar(string $routeId, string $orderId, User $u): object
    {
        return DB::transaction(function () use ($routeId, $orderId) {
            $s = self::agregarSinOrden($routeId, $orderId);
            self::ordenar($routeId);

            return self::parada($s->id);
        });
    }

    /** Quita la parada de una ruta que aún no sale. Sus bolsas vuelven a «por cargar». */
    public static function quitar(string $stopId, ?string $motivo, User $u, bool $reordenar = true): void
    {
        DB::transaction(function () use ($stopId, $motivo, $reordenar) {
            $s = DB::table('delivery_stops')->where('id', $stopId)->lockForUpdate()->first();
            $r = DB::table('delivery_routes')->where('id', $s->route_id)->lockForUpdate()->first();
            if (! in_array($r->status, ['PLANNED', 'LOADING'], true)) {
                RuleError::fail('RN-DEL-02', 'La ruta ya salió: la parada se cierra como entregada o no entregada desde la app.');
            }
            if ($s->status !== 'PENDING') {
                RuleError::fail('RN-DEL-02', "La parada {$s->seq} está ".Base::parada($s->status).'.');
            }
            DB::table('delivery_stops')->where('id', $s->id)->update(['status' => 'CANCELLED', 'closed_at' => now(), 'notes' => mb_substr($motivo ?: 'Quitada de la ruta', 0, 255), 'updated_at' => now()]);
            Reparto::sincronizar($s->order_id);
            if ($reordenar) {
                self::ordenar($r->id);
            }
        });
    }

    /** Mueve la parada a otra ruta del mismo día y local que aún no sale. */
    public static function mover(string $stopId, string $toRouteId, User $u): object
    {
        return DB::transaction(function () use ($stopId, $toRouteId, $u) {
            $s = self::parada($stopId);
            $to = Base::rutaVisible($toRouteId, $u, true);
            if ($to->id === $s->route_id) {
                RuleError::fail('RN-DEL-02', 'La parada ya está en esa ruta.');
            }
            $from = self::ruta($s->route_id);
            if ($to->route_date !== $from->route_date) {
                RuleError::fail('RN-DEL-02', 'Mueve la parada a una ruta del mismo día.');
            }
            self::quitar($s->id, "Movida a la ruta {$to->code}", $u);

            return self::agregar($to->id, $s->order_id, $u);
        });
    }

    /**
     * Orden de las paradas (RN-DEL-02): vecino más cercano desde el local o el orden manual del coordinador.
     * Las paradas cerradas quedan primero; no se repite el número de parada.
     */
    public static function ordenar(string $routeId, ?array $manual = null): void
    {
        $r = DB::table('delivery_routes')->where('id', $routeId)->lockForUpdate()->first();
        $todas = self::paradas($routeId);
        $abiertas = $todas->filter(fn ($s) => in_array($s->status, Base::ABIERTAS, true))->values();
        $cerradas = $todas->reject(fn ($s) => in_array($s->status, Base::ABIERTAS, true))->values();
        $pedidos = DB::table('sales_orders')->whereIn('id', $todas->pluck('order_id'))->get()->keyBy('id');
        $pt = fn ($s) => self::punto($pedidos[$s->order_id]);
        if ($manual !== null) {
            $ids = $abiertas->pluck('id')->all();
            sort($ids);
            $pedido = array_values(array_unique($manual));
            $orden = $pedido;
            sort($orden);
            if ($orden !== $ids) {
                RuleError::fail('RN-DEL-02', 'El orden debe incluir cada parada abierta de la ruta una sola vez.');
            }
            $porId = $abiertas->keyBy('id');
            $secuencia = array_map(fn ($id) => $porId[$id], $pedido);
        } else {
            $actual = $cerradas->isNotEmpty() ? $pt($cerradas->last()) : self::puntoLocal($r->establishment_id);
            $resto = $abiertas->all();
            $secuencia = [];
            while ($resto) {
                usort($resto, fn ($a, $b) => self::km($actual, $pt($a)) <=> self::km($actual, $pt($b)));
                $s = array_shift($resto);
                $secuencia[] = $s;
                $actual = $pt($s);
            }
        }
        $final = array_merge($cerradas->all(), $secuencia);
        foreach ($final as $i => $s) {
            DB::table('delivery_stops')->where('id', $s->id)->update(['seq' => 1000 + $i + 1]);
        }
        foreach ($final as $i => $s) {
            DB::table('delivery_stops')->where('id', $s->id)->update(['seq' => $i + 1, 'updated_at' => now()]);
        }
        // Km planificados: local → paradas → local.
        $km = 0.0;
        $prev = self::puntoLocal($r->establishment_id);
        foreach ($final as $s) {
            if ($s->status === 'FAILED') {
                continue;
            }
            $p = $pt($s);
            $km += self::km($prev, $p) * 1.35;
            $prev = $p;
        }
        $km += self::km($prev, self::puntoLocal($r->establishment_id)) * 1.35;
        DB::table('delivery_routes')->where('id', $routeId)->update([
            'sequence_method' => $manual !== null ? 'MANUAL' : 'NEAREST_NEIGHBOR', 'planned_km' => round($km, 3), 'updated_at' => now(),
        ]);
        self::calcularEta($routeId);
        foreach ($final as $s) {
            Reparto::sincronizar($s->order_id);
        }
    }

    /** Hora estimada de cada parada abierta: 22 km/h, 1,35 por calles y 7 minutos por parada. */
    public static function calcularEta(string $routeId): void
    {
        $r = self::ruta($routeId);
        $t = $r->departed_at ? CarbonImmutable::parse($r->departed_at)->setTimezone('America/Lima')
            : CarbonImmutable::parse($r->route_date.' '.($r->slot_from ?: '09:00:00'), 'America/Lima');
        if ($r->status === 'IN_ROUTE' && $t->lessThan(CarbonImmutable::now('America/Lima'))) {
            $t = CarbonImmutable::now('America/Lima');
        }
        $actual = self::puntoLocal($r->establishment_id);
        $primera = true;
        foreach (self::paradas($routeId) as $s) {
            $o = DB::table('sales_orders')->where('id', $s->order_id)->first();
            $p = self::punto($o);
            if (! in_array($s->status, Base::ABIERTAS, true)) {
                $actual = $p;

                continue;
            }
            $km = self::km($actual, $p) * 1.35;
            $t = $t->addMinutes((int) round($km / 22 * 60 + ($primera ? 0 : 7)));
            $primera = false;
            DB::table('delivery_stops')->where('id', $s->id)->update(['eta' => $t, 'distance_km' => round($km, 3)]);
            $actual = $p;
        }
    }

    /** RN-DEL-03: avisos de SOAT y revisión técnica a la fecha de la ruta. */
    public static function documentos(object $v, string $fecha): array
    {
        $dias = (int) Base::num('del_doc_alert_days', 15);
        $out = [];
        foreach (['soat_expires_on' => 'SOAT', 'tech_inspection_expires_on' => 'Revisión técnica'] as $col => $nombre) {
            $d = $v->{$col};
            if (! $d) {
                $out[] = ['level' => 'bad', 'doc' => $nombre, 'msg' => "{$nombre} sin registrar"];
            } elseif ($d < $fecha) {
                $out[] = ['level' => 'bad', 'doc' => $nombre, 'msg' => "{$nombre} vencido el ".Base::fecha($d)];
            } else {
                $faltan = (int) CarbonImmutable::parse($fecha)->diffInDays(CarbonImmutable::parse($d));
                if ($faltan <= $dias) {
                    $out[] = ['level' => 'warn', 'doc' => $nombre, 'msg' => "{$nombre} vence el ".Base::fecha($d)." (en {$faltan} día".($faltan === 1 ? '' : 's').')'];
                }
            }
        }

        return $out;
    }

    public static function exigirDocumentos(object $v, string $fecha): void
    {
        if (in_array($v->vehicle_type, ['BICYCLE'], true)) {
            return;
        }
        $malos = array_filter(self::documentos($v, $fecha), fn ($x) => $x['level'] === 'bad');
        if ($malos) {
            RuleError::fail('RN-DEL-03', "{$v->plate} no puede salir el ".Base::fecha($fecha).': '.implode(' y ', array_column($malos, 'msg')).'. Renueva el documento en Vehículos o asigna otro vehículo.');
        }
    }

    public static function kgRuta(string $routeId): float
    {
        return round((float) DB::table('delivery_stops')->where('route_id', $routeId)->whereIn('status', ['PENDING', 'ARRIVED', 'DELIVERED', 'HANDED_OFF'])->sum('kg'), 3);
    }

    /** Repartidores activos: usuarios con el rol REPARTIDOR. */
    public static function repartidores(): Collection
    {
        return DB::table('users as u')->join('user_roles as ur', 'ur.user_id', '=', 'u.id')->join('roles as ro', 'ro.id', '=', 'ur.role_id')
            ->where('ro.code', 'REPARTIDOR')->where('u.status', 'ACTIVE')->distinct()->orderBy('u.name')->get(['u.id', 'u.name', 'u.employee_id']);
    }

    /** Pago por defecto del repartidor: el de su última ruta, o jornal de S/ 80. */
    public static function pagoPorDefecto(string $userId): array
    {
        $r = DB::table('delivery_routes')->where('driver_user_id', $userId)->whereNotNull('driver_pay_mode')->orderByDesc('route_date')->first(['driver_pay_mode', 'driver_pay_rate']);

        return $r ? ['mode' => $r->driver_pay_mode, 'rate' => (float) $r->driver_pay_rate] : ['mode' => 'DAILY', 'rate' => 80.0];
    }

    /** DEL-02: modalidad, vehículo y repartidor o empresa (RN-DEL-01, RN-DEL-03). Devuelve los avisos. */
    public static function asignar(string $routeId, array $a, User $u): array
    {
        return DB::transaction(function () use ($routeId, $a, $u) {
            $r = Base::rutaVisible($routeId, $u, true);
            if (! in_array($r->status, ['PLANNED', 'LOADING'], true)) {
                RuleError::fail('RN-DEL-01', "La ruta {$r->code} ya salió: no se cambia la asignación.");
            }
            $modo = $a['mode'] ?? $r->mode;
            Base::exigirEn($modo, Base::MODOS, 'RN-DEL-01', 'Elige la modalidad: propia, alquilada o tercero.');
            $avisos = [];
            $cambio = ['mode' => $modo, 'vehicle_id' => null, 'driver_user_id' => null, 'driver_employee_id' => null, 'carrier_supplier_id' => null,
                'driver_pay_mode' => null, 'driver_pay_rate' => null, 'updated_at' => now()];
            if ($modo === 'THIRD_PARTY') {
                $sup = ! empty($a['carrier_supplier_id']) ? DB::table('suppliers')->where('id', $a['carrier_supplier_id'])->first() : null;
                if (! $sup || $sup->supplier_type !== 'DELIVERY_COMPANY' || $sup->status !== 'ACTIVE') {
                    RuleError::fail('RN-DEL-01', 'Una ruta de tercero sale con una empresa de delivery: elígela.');
                }
                $cambio['carrier_supplier_id'] = $sup->id;
                if (! Terceros::tarifa($sup->id, null, $r->route_date)) {
                    $avisos[] = ($sup->trade_name ?: $sup->legal_name).' no tiene tarifa vigente al '.Base::fecha($r->route_date).' (Empresas de delivery y tarifas).';
                }
            } else {
                $v = ! empty($a['vehicle_id']) ? DB::table('vehicles')->where('id', $a['vehicle_id'])->first() : null;
                $chofer = ! empty($a['driver_user_id']) ? self::repartidores()->firstWhere('id', $a['driver_user_id']) : null;
                if (! $v || ! $chofer) {
                    RuleError::fail('RN-DEL-01', 'Una ruta propia o alquilada sale con vehículo y repartidor: completa ambos.');
                }
                if ($modo === 'OWN' && $v->ownership !== 'OWN') {
                    RuleError::fail('RN-DEL-01', "{$v->plate} es alquilado: usa la modalidad «Alquilada».");
                }
                if ($modo === 'RENTED' && $v->ownership !== 'RENTED') {
                    RuleError::fail('RN-DEL-01', "{$v->plate} es propio: usa la modalidad «Propia».");
                }
                if ($v->status !== 'ACTIVE') {
                    RuleError::fail('RN-DEL-03', "{$v->plate} no está activo.");
                }
                self::exigirDocumentos($v, $r->route_date);
                // FLO (si está encendido): mantenimiento vencido, vehículo en taller y documentos de la flota (RN-FLO-11).
                \App\Modulos\Flo\Services\Operable::paraDel($v->id, $r->route_date, $u);
                foreach (self::documentos($v, $r->route_date) as $w) {
                    if ($w['level'] === 'warn') {
                        $avisos[] = "{$v->plate}: {$w['msg']}.";
                    }
                }
                $kg = self::kgRuta($r->id);
                if ($v->capacity_kg && $kg > (float) $v->capacity_kg) {
                    $avisos[] = 'La ruta lleva '.number_format($kg, 1, ',', '.')." kg y {$v->plate} carga ".number_format((float) $v->capacity_kg, 0, ',', '.').' kg: divide la ruta o usa otro vehículo.';
                }
                $otra = DB::table('delivery_routes')->where('route_date', $r->route_date)->where('id', '<>', $r->id)->whereIn('status', ['PLANNED', 'LOADING', 'IN_ROUTE'])
                    ->where(fn ($w) => $w->where('vehicle_id', $v->id)->orWhere('driver_user_id', $chofer->id))->value('code');
                if ($otra) {
                    $avisos[] = "El vehículo o el repartidor también está en la ruta {$otra} ese día.";
                }
                $pago = self::pagoPorDefecto($chofer->id);
                $modoPago = $a['driver_pay_mode'] ?? $pago['mode'];
                if (! in_array($modoPago, ['DAILY', 'PER_DELIVERY'], true)) {
                    RuleError::fail('RN-DEL-01', 'El pago del repartidor es jornal o por entrega.');
                }
                $tarifa = isset($a['driver_pay_rate']) && $a['driver_pay_rate'] !== '' ? (float) $a['driver_pay_rate'] : $pago['rate'];
                if ($tarifa < 0) {
                    RuleError::fail('RN-DEL-01', 'El pago del repartidor no puede ser negativo.');
                }
                $cambio = array_merge($cambio, ['vehicle_id' => $v->id, 'driver_user_id' => $chofer->id, 'driver_employee_id' => $chofer->employee_id,
                    'driver_pay_mode' => $modoPago, 'driver_pay_rate' => $tarifa]);
            }
            DB::table('delivery_routes')->where('id', $r->id)->update($cambio);

            return ['route' => self::ruta($r->id), 'warnings' => $avisos];
        });
    }

    /** Cancela una ruta que aún no sale: sus paradas se quitan y los pedidos quedan libres. */
    public static function cancelar(string $routeId, string $motivo, User $u): object
    {
        return DB::transaction(function () use ($routeId, $motivo, $u) {
            $r = Base::rutaVisible($routeId, $u, true);
            self::exigirEditable($r);
            foreach (self::paradas($r->id) as $s) {
                self::quitar($s->id, 'Ruta cancelada', $u, false);
            }
            DB::table('delivery_routes')->where('id', $r->id)->update(['status' => 'CANCELLED', 'cancelled_at' => now(), 'cancel_reason' => mb_substr($motivo, 0, 255), 'updated_at' => now()]);

            return self::ruta($r->id);
        });
    }

    /** Bolsas de la parada: las de PRE o, si el pedido no pasó por PRE, las de respaldo. */
    public static function bolsas(object $s): array
    {
        $reales = Reparto::bolsas($s->order_id);
        if ($reales) {
            return array_map(fn ($b) => ['label' => $b['label_code'], 'no' => (int) $b['parcel_no'], 'count' => (int) $b['parcel_count'], 'status' => $b['status'],
                'real' => true, 'tipo' => $b['parcel_type'], 'kg' => $b['weight_kg'] !== null ? (float) $b['weight_kg'] : null], $reales);
        }

        return array_map(fn ($b) => $b + ['real' => false], json_decode($s->bags ?: '[]', true) ?: []);
    }

    public static function cargadas(object $s): bool
    {
        foreach (self::bolsas($s) as $b) {
            if (! in_array($b['status'], ['LOADED', 'DELIVERED'], true)) {
                return false;
            }
        }

        return true;
    }

    /** RN-DEL-04: carga de una bolsa por escaneo en el vehículo de la ruta. */
    public static function cargar(string $routeId, string $codigo, User $u): array
    {
        return DB::transaction(function () use ($routeId, $codigo, $u) {
            $r = Base::rutaVisible($routeId, $u, true);
            if (! in_array($r->status, ['PLANNED', 'LOADING'], true)) {
                RuleError::fail('RN-DEL-04', "La ruta {$r->code} está ".Base::ruta($r->status).': ya no se cargan bolsas.');
            }
            $c = mb_strtoupper(trim($codigo));
            if ($c === '') {
                RuleError::fail('RN-DEL-04', 'Escanea o escribe el código de la bolsa.');
            }
            $res = null;
            foreach (self::paradas($r->id)->where('status', 'PENDING') as $s) {
                foreach (self::bolsas($s) as $b) {
                    if (mb_strtoupper($b['label']) !== $c) {
                        continue;
                    }
                    if ($b['real']) {
                        $x = Reparto::cargar($r->id, $c, $u);
                        $res = ['ok' => $x['ok'], 'result' => $x['result'], 'message' => $x['message'], 'code' => $x['code']];
                    } elseif (in_array($b['status'], ['LOADED', 'DELIVERED'], true)) {
                        $res = ['ok' => false, 'result' => 'DUPLICATE', 'message' => "La bolsa {$b['label']} ya está cargada.", 'code' => 'RN-DEL-04'];
                    } else {
                        $bolsas = array_map(fn ($y) => mb_strtoupper($y['label']) === $c ? array_merge($y, ['status' => 'LOADED', 'loaded_at' => now()->toIso8601String(), 'loaded_by' => $u->id]) : $y,
                            json_decode($s->bags ?: '[]', true) ?: []);
                        DB::table('delivery_stops')->where('id', $s->id)->update(['bags' => json_encode($bolsas), 'updated_at' => now()]);
                        $res = ['ok' => true, 'result' => 'OK', 'message' => "Bolsa {$b['label']} cargada.", 'code' => null];
                    }
                    break 2;
                }
            }
            if (! $res) {
                // Una bolsa de otra ruta o de nadie: se avisa como pedido cruzado.
                $otra = DB::table('shipment_parcels')->where('label_code', $c)->value('route_code');
                $res = ['ok' => false, 'result' => 'WRONG_ROUTE', 'code' => 'RN-DEL-04',
                    'message' => $otra ? "La bolsa {$c} es de la ruta {$otra}, no de {$r->code}: no la subas." : "La bolsa {$c} no pertenece a ninguna parada de la ruta {$r->code}."];
            }
            if ($res['ok'] && $r->status === 'PLANNED') {
                DB::table('delivery_routes')->where('id', $r->id)->update(['status' => 'LOADING', 'updated_at' => now()]);
            }

            return $res;
        });
    }

    public static function codigoEntrega(): string
    {
        return (string) random_int(1000, 9999);
    }

    /** RN-DEL-04: la ruta sale con todas sus bolsas cargadas y sus pedidos listos; emite order.dispatched. */
    public static function salir(string $routeId, ?float $odometro, User $u): object
    {
        return DB::transaction(function () use ($routeId, $odometro, $u) {
            $r = Base::rutaVisible($routeId, $u, true);
            if (! in_array($r->status, ['PLANNED', 'LOADING'], true)) {
                RuleError::fail('RN-DEL-04', "La ruta {$r->code} está ".Base::ruta($r->status).'.');
            }
            $propia = $r->mode !== 'THIRD_PARTY';
            if ($propia && (! $r->vehicle_id || ! $r->driver_user_id)) {
                RuleError::fail('RN-DEL-01', "Asigna vehículo y repartidor a {$r->code} antes de salir (Asignación).");
            }
            if (! $propia && ! $r->carrier_supplier_id) {
                RuleError::fail('RN-DEL-01', "Asigna la empresa de delivery a {$r->code} antes de salir (Asignación).");
            }
            $v = $propia ? DB::table('vehicles')->where('id', $r->vehicle_id)->first() : null;
            if ($v) {
                self::exigirDocumentos($v, $r->route_date);
                \App\Modulos\Flo\Services\Operable::paraDel($v->id, $r->route_date, $u);
            }
            $paradas = self::paradas($r->id)->where('status', 'PENDING')->values();
            if ($paradas->isEmpty()) {
                RuleError::fail('RN-DEL-04', "La ruta {$r->code} no tiene paradas.");
            }
            $faltan = [];
            foreach ($paradas as $s) {
                foreach (self::bolsas($s) as $b) {
                    if (! in_array($b['status'], ['LOADED', 'DELIVERED'], true)) {
                        $faltan[] = $b['label'];
                    }
                }
            }
            if ($faltan) {
                RuleError::fail('RN-DEL-04', 'Faltan cargar por escaneo '.count($faltan).' bolsa(s): '.implode(', ', array_slice($faltan, 0, 4)).(count($faltan) > 4 ? '…' : '').'. La ruta sale solo con todas sus bolsas cargadas.');
            }
            $pedidos = DB::table('sales_orders')->whereIn('id', $paradas->pluck('order_id'))->lockForUpdate()->get()->keyBy('id');
            $noListos = $pedidos->filter(fn ($o) => ! in_array($o->status, ['READY', 'NOT_DELIVERED'], true))->pluck('number');
            if ($noListos->isNotEmpty()) {
                RuleError::fail('RN-DEL-04', $noListos->implode(', ').($noListos->count() > 1 ? ' aún no están listos' : ' aún no está listo').' (Preparación): sácalo de la ruta o espera la verificación.');
            }
            if ($odometro !== null && $v && $odometro < (float) $v->odometer_km - 0.5) {
                RuleError::fail('RN-DEL-13', 'El odómetro de salida ('.number_format($odometro, 1, ',', '.').') es menor que el último del vehículo ('.number_format((float) $v->odometer_km, 1, ',', '.').').');
            }
            DB::table('delivery_routes')->where('id', $r->id)->update([
                'status' => 'IN_ROUTE', 'departed_at' => now(), 'odometer_start' => $propia ? ($odometro ?? (float) $v->odometer_km) : null, 'updated_at' => now(),
            ]);
            $local = self::puntoLocal($r->establishment_id);
            Base::evento(['route_id' => $r->id, 'event_type' => 'DEPARTED', 'lat' => $local[0], 'lng' => $local[1], 'client_event_id' => 'srv-dep-'.$r->id], $u);
            $chofer = $r->driver_user_id ? Base::primerNombre(DB::table('users')->where('id', $r->driver_user_id)->value('name')) : null;
            $empresa = $r->carrier_supplier_id ? DB::table('suppliers')->where('id', $r->carrier_supplier_id)->value('trade_name') : null;
            foreach ($paradas as $s) {
                $o = $pedidos[$s->order_id];
                DB::table('delivery_stops')->where('id', $s->id)->update(['delivery_code' => $s->delivery_code ?: self::codigoEntrega(), 'cod_amount' => self::cobroPedido($o), 'updated_at' => now()]);
                DB::table('sales_orders')->where('id', $o->id)->update(['driver_user_id' => $r->driver_user_id, 'updated_at' => now()]);
                Estados::cambiar($o->id, 'IN_ROUTE', "Salió en la ruta {$r->code}", $u);
                $t = Seguimiento::enlace($o->id);
                Events::emit('order.dispatched', 'sales_orders', $o->id, ['number' => $o->number, 'route_id' => $r->id, 'route_code' => $r->code,
                    'driver' => $chofer ?? $empresa, 'tracking_token' => $t->token]);
            }
            self::calcularEta($r->id);
            Events::emit('route.departed', 'delivery_routes', $r->id, ['code' => $r->code, 'vehicle_id' => $r->vehicle_id, 'driver_user_id' => $r->driver_user_id]);

            return self::ruta($r->id);
        });
    }

    /** Vuelta al local: todas las paradas cerradas. La ruta de tercero queda liquidada; la propia, por liquidar. */
    public static function volver(string $routeId, ?float $odometro, User $u): object
    {
        return DB::transaction(function () use ($routeId, $odometro, $u) {
            $r = Base::rutaVisible($routeId, $u, true);
            if ($r->status !== 'IN_ROUTE') {
                RuleError::fail('RN-DEL-05', 'Solo vuelve una ruta en ruta.');
            }
            $abiertas = self::paradas($r->id)->whereIn('status', Base::ABIERTAS)->count();
            if ($abiertas) {
                RuleError::fail('RN-DEL-05', "Quedan {$abiertas} parada(s) sin cerrar: márcalas entregadas o no entregadas antes de volver.");
            }
            $odo = null;
            if ($r->mode !== 'THIRD_PARTY') {
                $odo = $odometro ?? round((float) $r->odometer_start + (float) $r->planned_km, 1);
                if ($r->odometer_start !== null && $odo < (float) $r->odometer_start) {
                    RuleError::fail('RN-DEL-13', 'El odómetro final ('.number_format($odo, 1, ',', '.').') no puede ser menor que el inicial ('.number_format((float) $r->odometer_start, 1, ',', '.').').');
                }
                DB::table('vehicles')->where('id', $r->vehicle_id)->where('odometer_km', '<', $odo)->update(['odometer_km' => $odo, 'updated_at' => now()]);
            }
            DB::table('delivery_routes')->where('id', $r->id)->update([
                'status' => $r->mode === 'THIRD_PARTY' ? 'SETTLED' : 'RETURNED', 'returned_at' => now(), 'odometer_end' => $odo, 'updated_at' => now(),
            ]);
            Base::evento(['route_id' => $r->id, 'event_type' => 'RETURNED', 'client_event_id' => 'srv-ret-'.$r->id], $u);
            Costos::automaticos(self::ruta($r->id), $u);
            Events::emit('route.returned', 'delivery_routes', $r->id, ['code' => $r->code]);

            return self::ruta($r->id);
        });
    }
}
