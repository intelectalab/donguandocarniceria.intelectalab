<?php

namespace App\Modulos\Del\Services;

use App\Models\User;
use App\Modulos\Ped\Services\Estados;
use App\Support\Events;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * DEL-11 Envíos a provincia (RN-DEL-12): agencia, destino, embalaje, guía de remisión electrónica (la emite
 * FAC; aquí se enlaza la del pedido), número de seguimiento, flete y empaque. No pasa a «entregado a la
 * agencia» sin la guía y el seguimiento; flete y empaque se cargan al costo del pedido.
 */
final class Provincia
{
    public const EMBALAJES = ['THERMAL_BOX' => 'Caja térmica', 'BOX' => 'Caja', 'BAG' => 'Bolsa', 'COOLER' => 'Cooler'];

    public const FLUJO = ['HANDED_TO_AGENCY' => ['IN_TRANSIT', 'DELIVERED', 'LOST'], 'IN_TRANSIT' => ['DELIVERED', 'RETURNED', 'LOST']];

    public static function envio(string $id): object
    {
        $s = DB::table('province_shipments')->where('id', $id)->first();
        if (! $s) {
            abort(404, 'No se encontró el envío.');
        }

        return $s;
    }

    /** Guías de remisión emitidas (FAC) para el pedido. */
    public static function guias(string $orderId): array
    {
        return DB::table('dispatch_guides')->where('order_id', $orderId)->whereNotIn('status', ['VOIDED', 'CANCELLED', 'REJECTED'])
            ->orderByDesc('issue_date')->get(['id', 'full_number', 'issue_date', 'status', 'sunat_status'])->map(fn ($g) => (array) $g)->all();
    }

    public static function crear(array $d, User $u): object
    {
        return DB::transaction(function () use ($d, $u) {
            $o = DB::table('sales_orders')->where('id', $d['order_id'] ?? null)->lockForUpdate()->first();
            if (! $o) {
                RuleError::fail('RN-DEL-12', 'Elige el pedido.');
            }
            if (! Base::veLocal($u, $o->establishment_id)) {
                abort(404, 'No se encontró el pedido.');
            }
            if ($o->fulfillment !== 'PROVINCE_SHIPPING') {
                RuleError::fail('RN-DEL-12', "El pedido {$o->number} no es un envío a provincia.");
            }
            if (in_array($o->status, ['DRAFT', 'CANCELLED', 'DELIVERED', 'CLOSED'], true)) {
                RuleError::fail('RN-DEL-12', "El pedido {$o->number} está ".Estados::nombre($o->status).'.');
            }
            if (DB::table('province_shipments')->where('order_id', $o->id)->exists()) {
                RuleError::fail('RN-DEL-12', "El pedido {$o->number} ya tiene su envío a provincia.");
            }
            $agencia = $d['agency_supplier_id'] ?? $o->province_agency;
            if (! $agencia || ! DB::table('suppliers')->where('id', $agencia)->where('supplier_type', 'DELIVERY_COMPANY')->where('status', 'ACTIVE')->exists()) {
                RuleError::fail('RN-DEL-12', 'Elige la agencia de envío.');
            }
            $emb = $d['packaging'] ?? ($o->thermal_packaging ? 'THERMAL_BOX' : 'BOX');
            Base::exigirEn($emb, self::EMBALAJES, 'RN-DEL-12', 'Elige el embalaje.');
            $destino = trim((string) ($d['destination'] ?? $o->province_destination ?? ''));
            if ($destino === '') {
                RuleError::fail('RN-DEL-12', 'Escribe el destino (ciudad o agencia de destino).');
            }
            foreach (['freight_cost', 'packaging_cost', 'charged_to_customer', 'weight_kg'] as $k) {
                if (isset($d[$k]) && $d[$k] !== '' && (float) $d[$k] < 0) {
                    RuleError::fail('RN-DEL-12', 'Los montos y el peso no pueden ser negativos.');
                }
            }
            $id = DB::table('province_shipments')->insertGetId([
                'order_id' => $o->id, 'agency_supplier_id' => $agencia, 'packaging' => $emb, 'packages' => max(1, (int) ($d['packages'] ?? 1)),
                'weight_kg' => isset($d['weight_kg']) && $d['weight_kg'] !== '' ? round((float) $d['weight_kg'], 3) : Rutas::kgPedido($o->id),
                'freight_cost' => round((float) ($d['freight_cost'] ?? 0), 2), 'packaging_cost' => round((float) ($d['packaging_cost'] ?? 0), 2),
                'charged_to_customer' => round((float) ($d['charged_to_customer'] ?? $o->delivery_fee ?? 0), 2), 'destination' => mb_substr($destino, 0, 80),
                'destination_ubigeo' => ! empty($d['destination_ubigeo']) ? mb_substr($d['destination_ubigeo'], 0, 6) : null, 'status' => 'PREPARED',
                'tracking_number' => ! empty($d['tracking_number']) ? mb_substr(trim($d['tracking_number']), 0, 40) : null,
                'notes' => ! empty($d['notes']) ? mb_substr(trim($d['notes']), 0, 255) : null, 'created_by' => $u->id,
            ], 'id');
            $g = self::guias($o->id);
            if (count($g) === 1) {
                DB::table('province_shipments')->where('id', $id)->update(['dispatch_guide_id' => $g[0]['id']]);
            }

            return self::envio($id);
        });
    }

    public static function editar(string $id, array $d, User $u): object
    {
        return DB::transaction(function () use ($id, $d) {
            $s = DB::table('province_shipments')->where('id', $id)->lockForUpdate()->first();
            if ($s->status !== 'PREPARED') {
                RuleError::fail('RN-DEL-12', 'El envío ya se entregó a la agencia: no se cambian sus datos.');
            }
            $fila = [];
            if (array_key_exists('dispatch_guide_id', $d)) {
                if ($d['dispatch_guide_id'] && ! in_array($d['dispatch_guide_id'], array_column(self::guias($s->order_id), 'id'), true)) {
                    RuleError::fail('RN-DEL-12', 'Esa guía de remisión no es de este pedido.');
                }
                $fila['dispatch_guide_id'] = $d['dispatch_guide_id'] ?: null;
            }
            foreach (['tracking_number' => 40, 'destination' => 80, 'notes' => 255] as $k => $max) {
                if (array_key_exists($k, $d)) {
                    $fila[$k] = trim((string) $d[$k]) !== '' ? mb_substr(trim((string) $d[$k]), 0, $max) : null;
                }
            }
            if (array_key_exists('destination', $fila) && ! $fila['destination']) {
                RuleError::fail('RN-DEL-12', 'Escribe el destino.');
            }
            foreach (['freight_cost', 'packaging_cost', 'charged_to_customer', 'weight_kg'] as $k) {
                if (array_key_exists($k, $d) && $d[$k] !== null && $d[$k] !== '') {
                    if ((float) $d[$k] < 0) {
                        RuleError::fail('RN-DEL-12', 'Los montos y el peso no pueden ser negativos.');
                    }
                    $fila[$k] = round((float) $d[$k], $k === 'weight_kg' ? 3 : 2);
                }
            }
            if (isset($d['packages'])) {
                $fila['packages'] = max(1, (int) $d['packages']);
            }
            if (isset($d['packaging'])) {
                Base::exigirEn($d['packaging'], self::EMBALAJES, 'RN-DEL-12', 'Elige el embalaje.');
                $fila['packaging'] = $d['packaging'];
            }
            DB::table('province_shipments')->where('id', $id)->update($fila + ['updated_at' => now()]);

            return self::envio($id);
        });
    }

    /** RN-DEL-12: entregado a la agencia solo con guía y seguimiento. El pedido pasa a EN RUTA y el costo se registra. */
    public static function entregarAgencia(string $id, ?string $seguimiento, User $u): object
    {
        return DB::transaction(function () use ($id, $seguimiento, $u) {
            $s = DB::table('province_shipments')->where('id', $id)->lockForUpdate()->first();
            $o = DB::table('sales_orders')->where('id', $s->order_id)->lockForUpdate()->first();
            if ($s->status !== 'PREPARED') {
                RuleError::fail('RN-DEL-12', 'El envío ya fue entregado a la agencia.');
            }
            $tn = trim((string) ($seguimiento ?: $s->tracking_number));
            if (! $s->dispatch_guide_id) {
                RuleError::fail('RN-DEL-12', "El envío del pedido {$o->number} no tiene guía de remisión electrónica: emítela en Comprobantes y enlázala antes de entregarlo a la agencia.");
            }
            if ($tn === '') {
                RuleError::fail('RN-DEL-12', 'Registra el número de seguimiento que dio la agencia.');
            }
            if (! in_array($o->status, ['READY', 'NOT_DELIVERED'], true)) {
                RuleError::fail('RN-DEL-12', "El pedido {$o->number} está ".Estados::nombre($o->status).': entrégalo a la agencia cuando esté listo (Preparación).');
            }
            $guia = DB::table('dispatch_guides')->where('id', $s->dispatch_guide_id)->value('full_number');
            DB::table('province_shipments')->where('id', $id)->update(['tracking_number' => mb_substr($tn, 0, 40), 'status' => 'HANDED_TO_AGENCY', 'handed_at' => now(), 'updated_at' => now()]);
            // PED exige guía y seguimiento en el pedido para pasarlo a EN RUTA (RN-PED-08).
            DB::table('sales_orders')->where('id', $o->id)->update(['tracking_number' => mb_substr($tn, 0, 40), 'dispatch_guide_number' => $guia ? mb_substr($guia, 0, 40) : null,
                'province_agency' => $s->agency_supplier_id, 'updated_at' => now()]);
            $agencia = DB::table('suppliers')->where('id', $s->agency_supplier_id)->value('trade_name');
            Estados::cambiar($o->id, 'IN_ROUTE', "Entregado a {$agencia} · seguimiento {$tn}", $u);
            $zona = DB::table('delivery_zones')->where('province', true)->value('id') ?? $o->zone_id;
            if ((float) $s->freight_cost > 0) {
                Costos::registrar(['cost_date' => Base::hoy(), 'cost_type' => 'PROVINCE_FREIGHT', 'amount' => (float) $s->freight_cost, 'supplier_id' => $s->agency_supplier_id,
                    'zone_id' => $zona, 'order_id' => $o->id, 'notes' => "Flete {$o->number} a {$s->destination}", 'establishment_id' => $o->establishment_id], $u);
            }
            if ((float) $s->packaging_cost > 0) {
                Costos::registrar(['cost_date' => Base::hoy(), 'cost_type' => 'PACKAGING', 'amount' => (float) $s->packaging_cost, 'zone_id' => $zona, 'order_id' => $o->id,
                    'notes' => 'Empaque '.mb_strtolower(self::EMBALAJES[$s->packaging])." {$o->number}", 'establishment_id' => $o->establishment_id], $u);
            }
            Events::emit('order.dispatched', 'sales_orders', $o->id, ['number' => $o->number, 'agency' => $agencia, 'tracking' => $tn]);

            return self::envio($id);
        });
    }

    public static function cambiarEstado(string $id, string $estado, ?string $nota, User $u): object
    {
        return DB::transaction(function () use ($id, $estado, $nota, $u) {
            $s = DB::table('province_shipments')->where('id', $id)->lockForUpdate()->first();
            if (! in_array($estado, self::FLUJO[$s->status] ?? [], true)) {
                RuleError::fail('RN-DEL-12', 'Un envío '.(Base::PROVINCIA[$s->status] ?? $s->status).' no pasa a '.(Base::PROVINCIA[$estado] ?? $estado).'.');
            }
            if (in_array($estado, ['RETURNED', 'LOST'], true) && mb_strlen(trim((string) $nota)) < 5) {
                RuleError::fail('RN-DEL-12', 'Escribe qué pasó con el envío.');
            }
            DB::table('province_shipments')->where('id', $id)->update(['status' => $estado, 'delivered_at' => $estado === 'DELIVERED' ? now() : $s->delivered_at,
                'notes' => $nota ? mb_substr(trim($nota), 0, 255) : $s->notes, 'updated_at' => now()]);
            $o = DB::table('sales_orders')->where('id', $s->order_id)->first();
            if ($estado === 'DELIVERED' && $o->status === 'IN_ROUTE') {
                Estados::cambiar($o->id, 'DELIVERED', 'Recogido en la agencia de destino', $u);
            }
            if (in_array($estado, ['RETURNED', 'LOST'], true) && $o->status === 'IN_ROUTE') {
                Estados::noEntregado($o->id, 'OTRO', ($estado === 'LOST' ? 'Envío perdido por la agencia' : 'Envío devuelto por la agencia').": {$nota}", $u);
            }

            return self::envio($id);
        });
    }
}
