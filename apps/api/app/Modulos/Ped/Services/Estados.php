<?php

namespace App\Modulos\Ped\Services;

use App\Models\User;
use App\Modulos\Alm\Services\ReservasService;
use App\Support\Access;
use App\Support\Events;
use App\Support\Params;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * Estados del pedido (RN-PED-03) con su historial, cancelación y no entrega (RN-PED-13),
 * reprogramación (RN-PED-14), saldo y cierre (RN-PED-15 y RN-PED-19) y borradores vencidos
 * (RN-PED-18). Cada cambio queda en sales_order_status_history con usuario y fecha.
 */
final class Estados
{
    public const NOMBRES = [
        'DRAFT' => 'en borrador', 'CONFIRMED' => 'confirmado', 'IN_PREPARATION' => 'en preparación', 'WEIGHED' => 'pesado',
        'READY' => 'listo', 'IN_ROUTE' => 'en ruta', 'DELIVERED' => 'entregado', 'NOT_DELIVERED' => 'no entregado',
        'CLOSED' => 'cerrado', 'CANCELLED' => 'cancelado',
    ];

    /** RN-PED-03: transiciones permitidas. Las marcadas con entrega solo valen para ese tipo de entrega. */
    public const TRANSICIONES = [
        'DRAFT' => ['CONFIRMED', 'CANCELLED'],
        'CONFIRMED' => ['DRAFT', 'IN_PREPARATION', 'CANCELLED', 'DELIVERED:COUNTER'],
        'IN_PREPARATION' => ['WEIGHED', 'READY', 'CANCELLED'],
        'WEIGHED' => ['READY', 'IN_PREPARATION', 'CANCELLED'],
        'READY' => ['IN_ROUTE', 'CANCELLED', 'DELIVERED:PICKUP', 'DELIVERED:COUNTER'],
        'IN_ROUTE' => ['DELIVERED', 'NOT_DELIVERED'],
        'NOT_DELIVERED' => ['CONFIRMED', 'IN_ROUTE', 'CANCELLED'],
        'DELIVERED' => ['CLOSED'],
        'CLOSED' => [],
        'CANCELLED' => [],
    ];

    /** Los que se hacen con el botón «Siguiente estado»; los demás tienen su propia acción. */
    public const DIRECTOS = ['IN_PREPARATION', 'WEIGHED', 'READY', 'IN_ROUTE', 'DELIVERED'];

    public static function nombre(string $s): string
    {
        return self::NOMBRES[$s] ?? $s;
    }

    /** @return list<string> */
    public static function siguientes(object $o): array
    {
        $r = [];
        foreach (self::TRANSICIONES[$o->status] ?? [] as $t) {
            [$a, $solo] = array_pad(explode(':', $t), 2, null);
            if ($solo === null || $solo === $o->fulfillment) {
                $r[] = $a;
            }
        }
        if ($o->fulfillment === 'COUNTER' || $o->fulfillment === 'PICKUP') {
            $r = array_values(array_diff($r, ['IN_ROUTE']));
        }

        return array_values(array_unique($r));
    }

    public static function exigir(object $o, string $a): void
    {
        if (! in_array($a, self::siguientes($o), true)) {
            RuleError::fail('RN-PED-03', 'Un pedido '.self::nombre($o->status).' no pasa a '.self::nombre($a).'.');
        }
    }

    public static function historial(object $o, string $de, string $a, ?string $motivo, ?User $u): void
    {
        DB::table('sales_order_status_history')->insert([
            'order_id' => $o->id, 'order_number' => $o->number, 'from_status' => $de, 'to_status' => $a,
            'reason' => $motivo ? mb_substr($motivo, 0, 255) : null, 'changed_at' => now(),
            'changed_by' => $u?->id, 'changed_by_name' => mb_substr($u?->name ?? 'Sistema', 0, 120),
        ]);
    }

    /**
     * EN PREPARACIÓN, PESADO, LISTO, EN RUTA y ENTREGADO (PED-03; luego los harán PRE y DEL).
     * LISTO exige el peso real de las líneas por kg (RN-PED-04) y el aviso registrado si
     * hubo diferencia (RN-PED-05). EN RUTA a provincia exige guía y seguimiento (RN-PED-08).
     */
    public static function cambiar(string $id, string $a, ?string $nota, User $u): object
    {
        if (! in_array($a, self::DIRECTOS, true)) {
            RuleError::fail('RN-PED-03', 'Ese cambio tiene su propia acción (confirmar, cancelar, no entregado, reprogramar o cerrar).');
        }

        return DB::transaction(function () use ($id, $a, $nota, $u) {
            $o = Pedidos::bloquear($id);
            self::exigir($o, $a);
            $extra = [];
            if ($a === 'WEIGHED' || $a === 'READY') {
                $porKg = DB::table('sales_order_lines')->where('sales_order_id', $o->id)->where('price_basis', 'KG');
                if ((clone $porKg)->whereNull('weighed_kg')->exists()) {
                    RuleError::fail('RN-PED-04', 'Falta registrar el peso real de los productos que se cobran por kg.');
                }
            }
            if ($a === 'READY') {
                if ($o->weight_diff_status === 'NOTICE_REQUIRED') {
                    RuleError::fail('RN-PED-05', 'El peso real difiere del estimado más de la tolerancia: registra el aviso al cliente (Diferencia de peso) antes de pasarlo a listo.');
                }
                if ($o->weight_diff_status === 'NOTICE_SENT' && strtolower((string) Params::get('ped_weight_notice_wait_response', ['brand' => $o->brand_id])) === 'true') {
                    $r = DB::table('order_weight_notices')->where('order_id', $o->id)->orderByDesc('sent_at')->value('customer_response');
                    if ($r !== 'ACCEPTED') {
                        RuleError::fail('RN-PED-05', 'Se espera la respuesta del cliente al aviso de peso antes de pasarlo a listo.');
                    }
                }
            }
            if ($a === 'IN_ROUTE' && $o->fulfillment === 'PROVINCE_SHIPPING' && (! $o->tracking_number || ! $o->dispatch_guide_number)) {
                RuleError::fail('RN-PED-08', 'Para despachar a provincia registra la guía de remisión y el número de seguimiento (Pedidos de provincia).');
            }
            if ($a === 'DELIVERED') {
                $extra['delivered_at'] = now();
            }
            DB::table('sales_orders')->where('id', $o->id)->update(['status' => $a, 'last_activity_at' => now(), 'updated_at' => now()] + $extra);
            self::historial($o, $o->status, $a, $nota, $u);
            Events::emit(match ($a) {
                'IN_PREPARATION' => 'order.in_preparation', 'WEIGHED' => 'order.weighed', 'READY' => 'order.ready',
                'IN_ROUTE' => 'order.in_route', default => 'order.delivered',
            }, 'sales_orders', $o->id, ['number' => $o->number, 'from' => $o->status]);

            if ($a === 'DELIVERED') {
                self::saldoAlEntregar(Pedidos::pedido($o->id), $u);
            }

            return Pedidos::pedido($o->id);
        });
    }

    /** CONFIRMADO → BORRADOR para corregir, antes de preparar. Libera las reservas. */
    public static function aBorrador(string $id, ?string $motivo, User $u): object
    {
        return DB::transaction(function () use ($id, $motivo, $u) {
            $o = Pedidos::bloquear($id);
            self::exigir($o, 'DRAFT');
            ReservasService::liberar($o->id, 'Pedido vuelto a borrador', $u);
            DB::table('sales_orders')->where('id', $o->id)->update(['status' => 'DRAFT', 'needs_stock' => false, 'last_activity_at' => now(), 'updated_at' => now()]);
            self::historial($o, $o->status, 'DRAFT', $motivo ?: 'Vuelto a borrador para corregir', $u);
            Events::emit('order.reopened', 'sales_orders', $o->id, ['number' => $o->number]);

            return Pedidos::pedido($o->id);
        });
    }

    /** Motivo del catálogo que aplica (RN-PED-13). */
    public static function motivo(string $codigo, string $para): object
    {
        $m = DB::table('order_cancel_reasons')->where('code', $codigo)->where('status', 'ACTIVE')->first();
        if (! $m || ! in_array($m->applies_to, [$para, 'BOTH'], true)) {
            RuleError::fail('RN-PED-13', 'Elige un motivo del catálogo'.($para === 'CANCEL' ? ' de cancelación.' : ' de no entrega.'));
        }

        return $m;
    }

    /** PED-09: cancelar con motivo (y nota si el motivo la pide). Libera las reservas de stock. */
    public static function cancelar(string $id, string $codigo, ?string $nota, User $u, bool $sistema = false): object
    {
        return DB::transaction(function () use ($id, $codigo, $nota, $u, $sistema) {
            $o = Pedidos::bloquear($id);
            self::exigir($o, 'CANCELLED');
            if (! $sistema && $o->status !== 'DRAFT' && ! Access::can($u, 'ped.order.cancel')) {
                RuleError::fail('RN-PED-13', 'Cancelar un pedido confirmado lo hace la supervisora (permiso ped.order.cancel).');
            }
            $m = self::motivo($codigo, 'CANCEL');
            $nota = trim((string) $nota);
            if ($m->requires_note && $nota === '') {
                RuleError::fail('RN-PED-13', "El motivo «{$m->name}» exige una nota que explique qué pasó.");
            }
            $liberadas = ReservasService::liberar($o->id, "Pedido cancelado: {$m->name}", $u);
            DB::table('sales_orders')->where('id', $o->id)->update([
                'status' => 'CANCELLED', 'cancel_reason' => $m->code, 'cancel_note' => $nota !== '' ? mb_substr($nota, 0, 255) : null,
                'cancelled_at' => now(), 'last_activity_at' => now(), 'updated_at' => now(),
            ]);
            DB::table('order_discount_approvals')->where('order_id', $o->id)->where('status', 'PENDING')
                ->update(['status' => 'REJECTED', 'decided_at' => now(), 'decided_by_name' => 'Sistema', 'decision_note' => 'Pedido cancelado', 'updated_at' => now()]);
            self::historial($o, $o->status, 'CANCELLED', $m->name.($nota !== '' ? ": {$nota}" : ''), $sistema ? null : $u);
            Events::emit('order.cancelled', 'sales_orders', $o->id, ['number' => $o->number, 'reason' => $m->code, 'from' => $o->status, 'released' => $liberadas]);

            return Pedidos::pedido($o->id);
        });
    }

    /** PED-09: el repartidor no pudo entregar. EN RUTA → NO ENTREGADO con motivo. */
    public static function noEntregado(string $id, string $codigo, ?string $nota, User $u): object
    {
        return DB::transaction(function () use ($id, $codigo, $nota, $u) {
            $o = Pedidos::bloquear($id);
            self::exigir($o, 'NOT_DELIVERED');
            $m = self::motivo($codigo, 'NOT_DELIVERED');
            $nota = trim((string) $nota);
            if ($m->requires_note && $nota === '') {
                RuleError::fail('RN-PED-13', "El motivo «{$m->name}» exige una nota que explique qué pasó.");
            }
            DB::table('sales_orders')->where('id', $o->id)->update([
                'status' => 'NOT_DELIVERED', 'not_delivered_reason_code' => $m->code, 'not_delivered_at' => now(),
                'cancel_note' => $nota !== '' ? mb_substr($nota, 0, 255) : null, 'last_activity_at' => now(), 'updated_at' => now(),
            ]);
            self::historial($o, $o->status, 'NOT_DELIVERED', $m->name.($nota !== '' ? ": {$nota}" : ''), $u);
            Events::emit('order.not_delivered', 'sales_orders', $o->id, ['number' => $o->number, 'reason' => $m->code]);

            return Pedidos::pedido($o->id);
        });
    }

    /**
     * PED-08: nueva fecha y franja con motivo (RN-PED-14). Un NO ENTREGADO vuelve a CONFIRMADO.
     * Pasadas ped_max_reschedules, solo la supervisora (ped.order.cancel) reprograma.
     */
    public static function reprogramar(string $id, string $fecha, string $franjaId, string $motivo, User $u): object
    {
        return DB::transaction(function () use ($id, $fecha, $franjaId, $motivo, $u) {
            $o = Pedidos::bloquear($id);
            if (! in_array($o->status, ['CONFIRMED', 'NOT_DELIVERED'], true)) {
                RuleError::fail('RN-PED-14', 'Se reprograma un pedido confirmado o no entregado (este está '.self::nombre($o->status).'). Un borrador se cambia editándolo.');
            }
            if (trim($motivo) === '') {
                RuleError::fail('RN-PED-14', 'Reprogramar exige un motivo.');
            }
            $max = (int) (Params::get('ped_max_reschedules', ['brand' => $o->brand_id]) ?? 2);
            if ((int) $o->reschedule_count >= $max && ! Access::can($u, 'ped.order.cancel')) {
                RuleError::fail('RN-PED-14', "Este pedido ya se reprogramó {$o->reschedule_count} veces (máximo {$max}): la siguiente la hace la supervisora.");
            }
            $s = DB::table('order_time_slots')->where('id', $franjaId)->first();
            if (! $s || $s->establishment_id !== $o->establishment_id) {
                RuleError::fail('RN-PED-06', 'La franja elegida no es del local que atiende el pedido.');
            }
            if ($fecha === (string) $o->delivery_date && $franjaId === $o->slot_id) {
                RuleError::fail('RN-PED-14', 'Elige una fecha o franja distinta a la actual.');
            }
            Franjas::validar($franjaId, $fecha, $u, $o->id);

            DB::table('order_reschedules')->insert([
                'order_id' => $o->id, 'order_number' => $o->number, 'brand_id' => $o->brand_id, 'establishment_id' => $o->establishment_id,
                'old_date' => $o->delivery_date, 'old_slot_from' => $o->slot_from, 'new_date' => $fecha, 'new_slot_from' => $s->slot_from,
                'new_slot_id' => $s->id, 'reason' => mb_substr(trim($motivo), 0, 255), 'fee_charged' => 0, 'from_status' => $o->status,
                'rescheduled_by' => $u->id, 'rescheduled_by_name' => mb_substr($u->name, 0, 120), 'at' => now(),
            ]);
            DB::table('sales_orders')->where('id', $o->id)->update([
                'delivery_date' => $fecha, 'slot_id' => $s->id, 'slot_from' => $s->slot_from, 'slot_to' => $s->slot_to,
                'reschedule_count' => (int) $o->reschedule_count + 1, 'status' => 'CONFIRMED', 'last_activity_at' => now(), 'updated_at' => now(),
            ]);
            $texto = 'Reprogramado al '.date('d/m/Y', strtotime($fecha)).' '.substr($s->slot_from, 0, 5).'–'.substr($s->slot_to, 0, 5).": {$motivo}";
            if ($o->status === 'NOT_DELIVERED') {
                self::historial($o, 'NOT_DELIVERED', 'CONFIRMED', $texto, $u);
            } else {
                self::historial($o, 'CONFIRMED', 'CONFIRMED', $texto, $u);
            }
            Events::emit('order.rescheduled', 'sales_orders', $o->id, ['number' => $o->number, 'date' => $fecha, 'slot_id' => $s->id, 'count' => (int) $o->reschedule_count + 1]);

            return Pedidos::pedido($o->id);
        });
    }

    /** Saldo del pedido: lo pagado menos el total final (o estimado si aún no se pesa). */
    public static function saldo(object $o): array
    {
        $total = round((float) ($o->final_total ?? $o->estimated_total), 2);
        $pagado = round((float) $o->paid_amount, 2);
        $dif = round($pagado - $total, 2);

        return ['total' => $total, 'pagado' => $pagado, 'diferencia' => $dif,
            'tipo' => $dif > Pedidos::EPS ? 'A_FAVOR' : ($dif < -Pedidos::EPS ? 'POR_COBRAR' : 'CUADRA')];
    }

    /** D-PED-05 y CA-PED-04: al entregar, lo pagado de más queda como saldo a favor del cliente. */
    private static function saldoAlEntregar(object $o, User $u): void
    {
        $s = self::saldo($o);
        if ($s['tipo'] === 'A_FAVOR' && ! $o->balance_mode) {
            self::anotarSaldo($o, 'CUSTOMER_CREDIT', $s['diferencia'], 'Pagó de más: queda como saldo a favor para su próxima compra', $u);
        }
    }

    /**
     * PED-12: qué se hace con la diferencia (RN-PED-19). A favor: saldo a favor o devolución
     * (caj.balance.refund). Por cobrar: cobro contra entrega, enlace de pago o condonación de un
     * saldo pequeño (ped.balance.waive, hasta ped_max_waive_amount).
     */
    public static function decidirSaldo(string $id, string $modo, ?string $nota, User $u): object
    {
        return DB::transaction(function () use ($id, $modo, $nota, $u) {
            $o = Pedidos::bloquear($id);
            if (! in_array($o->status, ['DELIVERED', 'IN_ROUTE', 'READY', 'WEIGHED', 'NOT_DELIVERED'], true)) {
                RuleError::fail('RN-PED-19', 'El saldo se decide cuando el pedido ya tiene su total final (pesado, listo, en ruta o entregado).');
            }
            $s = self::saldo($o);
            if ($s['tipo'] === 'CUADRA') {
                RuleError::fail('RN-PED-19', 'Lo pagado cuadra con el total: no hay saldo que decidir.');
            }
            $validos = $s['tipo'] === 'A_FAVOR' ? ['CUSTOMER_CREDIT', 'REFUND'] : ['COLLECT_ON_DELIVERY', 'PAYMENT_LINK', 'WAIVE'];
            if (! in_array($modo, $validos, true)) {
                RuleError::fail('RN-PED-19', $s['tipo'] === 'A_FAVOR'
                    ? 'El cliente pagó de más: elige saldo a favor o devolución.'
                    : 'Falta cobrar: elige cobro contra entrega, enlace de pago o condonar.');
            }
            if ($modo === 'REFUND' && ! Access::can($u, 'caj.balance.refund')) {
                RuleError::fail('RN-PED-19', 'La devolución exige el permiso caj.balance.refund.');
            }
            if ($modo === 'WAIVE') {
                if (! Access::can($u, 'ped.balance.waive')) {
                    RuleError::fail('RN-PED-15', 'Condonar un saldo exige el permiso ped.balance.waive.');
                }
                $tope = (float) (Params::get('ped_max_waive_amount', ['brand' => $o->brand_id]) ?? 1);
                if (abs($s['diferencia']) > $tope + Pedidos::EPS) {
                    RuleError::fail('RN-PED-15', 'Solo se condona hasta S/ '.number_format($tope, 2).'; este saldo es S/ '.number_format(abs($s['diferencia']), 2).'.');
                }
            }
            // Cambiar de saldo a favor a devolución: el saldo a favor anotado se revierte.
            if ($o->balance_mode === 'CUSTOMER_CREDIT' && $modo !== 'CUSTOMER_CREDIT') {
                DB::table('customer_balance_movements')->insert([
                    'customer_id' => $o->customer_id, 'movement_type' => 'REFUND', 'amount' => -1 * (float) $o->balance_amount, 'order_id' => $o->id,
                    'reason' => mb_substr("Pedido {$o->number}: se devuelve en lugar de dejar saldo a favor", 0, 255), 'at' => now(), 'user' => mb_substr($u->name, 0, 255),
                ]);
            }
            if ($modo === 'CUSTOMER_CREDIT' && $o->balance_mode === 'CUSTOMER_CREDIT') {
                RuleError::fail('RN-PED-19', 'El saldo a favor ya está registrado.');
            }
            self::anotarSaldo($o, $modo, $s['diferencia'], $nota, $u);

            return Pedidos::pedido($o->id);
        });
    }

    private static function anotarSaldo(object $o, string $modo, float $dif, ?string $nota, User $u): void
    {
        if ($modo === 'CUSTOMER_CREDIT') {
            DB::table('customer_balance_movements')->insert([
                'customer_id' => $o->customer_id, 'movement_type' => 'OVERPAYMENT', 'amount' => $dif, 'order_id' => $o->id,
                'reason' => mb_substr("Pedido {$o->number}: pagó de más", 0, 255), 'at' => now(), 'user' => mb_substr($u->name, 0, 255),
            ]);
        }
        DB::table('sales_orders')->where('id', $o->id)->update([
            'balance_mode' => $modo, 'balance_amount' => $dif, 'balance_decided_at' => now(), 'balance_decided_by_name' => mb_substr($u->name, 0, 120),
            'balance_note' => $nota ? mb_substr($nota, 0, 255) : null, 'updated_at' => now(),
        ]);
        Events::emit('order.balance_decided', 'sales_orders', $o->id, ['number' => $o->number, 'mode' => $modo, 'amount' => $dif]);
    }

    /** RN-PED-15: ENTREGADO → CERRADO cuando está pagado o ya se decidió qué hacer con el saldo. */
    public static function cerrar(string $id, User $u): object
    {
        return DB::transaction(function () use ($id, $u) {
            $o = Pedidos::bloquear($id);
            self::exigir($o, 'CLOSED');
            $s = self::saldo($o);
            if ($s['tipo'] !== 'CUADRA' && ! $o->balance_mode) {
                RuleError::fail('RN-PED-15', $s['tipo'] === 'POR_COBRAR'
                    ? 'Falta cobrar S/ '.number_format(abs($s['diferencia']), 2).': registra el cobro o decide qué hacer con el saldo antes de cerrar.'
                    : 'El cliente pagó S/ '.number_format($s['diferencia'], 2).' de más: decide el saldo antes de cerrar.');
            }
            DB::table('sales_orders')->where('id', $o->id)->update(['status' => 'CLOSED', 'closed_at' => now(), 'updated_at' => now()]);
            self::historial($o, 'DELIVERED', 'CLOSED', null, $u);
            Events::emit('order.closed', 'sales_orders', $o->id, ['number' => $o->number, 'total' => $s['total'], 'paid' => $s['pagado']]);

            return Pedidos::pedido($o->id);
        });
    }

    /** RN-PED-18: borradores sin actividad por ped_draft_expiry_hours se cancelan solos. */
    public static function vencerBorradores(User $sistema): int
    {
        $horas = (int) (Params::get('ped_draft_expiry_hours') ?? 48);
        $ids = DB::table('sales_orders')->where('status', 'DRAFT')
            ->whereRaw('coalesce(last_activity_at, updated_at, created_at) < ?', [now()->subHours($horas)])->pluck('id');
        foreach ($ids as $id) {
            self::cancelar($id, 'BORRADOR_VENCIDO', "Sin actividad por {$horas} h", $sistema, true);
        }

        return $ids->count();
    }
}
