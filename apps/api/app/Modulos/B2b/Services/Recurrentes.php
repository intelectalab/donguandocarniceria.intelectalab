<?php

namespace App\Modulos\B2b\Services;

use App\Models\User;
use App\Modulos\Canales\Soporte as S;
use App\Support\Events;
use App\Support\RuleError;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * B2B-05 y B2B-06: pedidos recurrentes y sus corridas. RN-B2B-09: una sola corrida por programación y fecha
 * de entrega (la base lo garantiza con UNIQUE); RN-B2B-10: bloqueado por crédito queda en borrador y avisa;
 * RN-B2B-11: precios de la corrida y presentaciones inactivas omitidas.
 */
final class Recurrentes
{
    public static function ocurre(object $ro, string $fecha): bool
    {
        if ($fecha < $ro->starts_on || ($ro->ends_on && $fecha > $ro->ends_on)) {
            return false;
        }
        if ($ro->frequency === 'WEEKLY') {
            $dias = is_string($ro->weekdays) ? json_decode($ro->weekdays, true) : (array) $ro->weekdays;

            return in_array(CarbonImmutable::parse($fecha)->dayOfWeekIso, array_map('intval', $dias ?: []), true);
        }

        return S::dias($ro->starts_on, $fecha) % max(1, (int) $ro->interval_days) === 0;
    }

    public static function proximas(object $ro, string $desde, int $n = 4): array
    {
        $out = [];
        for ($d = $desde, $i = 0; count($out) < $n && $i < 120; $d = S::masDias($d, 1), $i++) {
            if (self::ocurre($ro, $d)) {
                $out[] = $d;
            }
        }

        return $out;
    }

    public static function esFeriado(string $fecha): bool
    {
        return DB::table('calendar_holidays')->whereNull('establishment_id')->where('holiday_date', $fecha)->exists();
    }

    public static function guardar(array $d, ?string $id, User $quien): object
    {
        return DB::transaction(function () use ($d, $id, $quien) {
            $actual = $id ? (DB::table('recurring_orders')->where('id', $id)->first() ?? abort(404)) : null;
            $cliente = $actual->customer_id ?? ($d['customer_id'] ?? null);
            $cliente || RuleError::fail('RN-B2B-09', 'Elige el cliente.');
            $frec = $d['frequency'] ?? 'WEEKLY';
            $dias = array_values(array_unique(array_map('intval', $d['weekdays'] ?? [])));
            if ($frec === 'WEEKLY' && ! $dias) {
                RuleError::fail('RN-B2B-09', 'Marca al menos un día de la semana.');
            }
            if ($frec === 'EVERY_N_DAYS' && ! ((int) ($d['interval_days'] ?? 0) >= 1)) {
                RuleError::fail('RN-B2B-09', 'Indica cada cuántos días.');
            }
            $lineas = array_values(array_filter($d['lines'] ?? [], fn ($l) => (float) ($l['qty'] ?? 0) > 0));
            $lineas || RuleError::fail('RN-B2B-09', 'Agrega al menos una línea.');
            $marcas = DB::table('product_variants')->whereIn('id', array_column($lineas, 'variant_id'))->distinct()->pluck('brand_id');
            $marcas->count() === 1 || RuleError::fail('RN-B2B-09', 'Un pedido recurrente es de una sola marca: crea uno por marca.');
            $dir = DB::table('customer_addresses')->where('id', $d['address_id'] ?? null)->where('customer_id', $cliente)->first()
                ?? RuleError::fail('RN-B2B-09', 'Elige la dirección de entrega del cliente.');
            $zona = $dir->zone_id ? DB::table('delivery_zones')->where('id', $dir->zone_id)->first() : null;
            $fila = [
                'customer_id' => $cliente, 'brand_id' => $marcas[0], 'establishment_id' => $zona->establishment_id ?? DB::table('establishments')->orderBy('code')->value('id'),
                'address_id' => $dir->id, 'name' => mb_substr(trim((string) ($d['name'] ?? 'Pedido recurrente')), 0, 255), 'frequency' => $frec,
                'weekdays' => json_encode($frec === 'WEEKLY' ? $dias : []), 'interval_days' => $frec === 'EVERY_N_DAYS' ? (int) $d['interval_days'] : null,
                'slot_from' => $d['slot_from'] ?? '09:00', 'slot_to' => $d['slot_to'] ?? '13:00',
                'lead_days' => (int) ($d['lead_days'] ?? S::num('b2b_recurring_lead_days', 1)), 'starts_on' => S::fecha($d['starts_on'] ?? null), 'ends_on' => $d['ends_on'] ?? null,
                'auto_confirm' => (bool) ($d['auto_confirm'] ?? false), 'requested_doc_type' => $d['requested_doc_type'] ?? 'INVOICE',
                'status' => $d['status'] ?? ($actual->status ?? 'ACTIVE'), 'notes' => $d['notes'] ?? null, 'updated_at' => now(),
            ];
            if ($actual) {
                DB::table('recurring_orders')->where('id', $id)->update($fila);
                DB::table('recurring_order_lines')->where('recurring_order_id', $id)->delete();
            } else {
                $id = DB::table('recurring_orders')->insertGetId($fila + ['created_by' => $quien->id], 'id');
            }
            foreach ($lineas as $l) {
                DB::table('recurring_order_lines')->insert(['recurring_order_id' => $id, 'variant_id' => $l['variant_id'], 'qty' => $l['qty'],
                    'est_weight_kg' => $l['est_weight_kg'] ?? null, 'cut_notes' => $l['cut_notes'] ?? null]);
            }
            $ro = DB::table('recurring_orders')->where('id', $id)->first();
            DB::table('recurring_orders')->where('id', $id)->update(['next_delivery_date' => self::proximas($ro, S::masDias(S::fecha(), 1), 1)[0] ?? null]);

            return DB::table('recurring_orders')->where('id', $id)->first();
        });
    }

    /**
     * RN-B2B-09: la corrida de las 18:00 crea el pedido de cada programación que entrega dentro de lead_days.
     * Correrla dos veces no duplica: la segunda encuentra la corrida (o choca con el UNIQUE) y la salta.
     */
    public static function correr(?string $cuando = null, bool $forzar = false, ?string $solo = null): array
    {
        $at = $cuando ? CarbonImmutable::parse($cuando, 'America/Lima') : S::ahora();
        $hora = S::texto('b2b_recurring_run_time', '18:00');
        if (! $forzar && $at->format('H:i') < $hora) {
            return ['ran' => 0, 'message' => "La corrida es a las {$hora}.", 'runs' => []];
        }
        $quien = S::sistema();
        $out = [];
        foreach (DB::table('recurring_orders')->where('status', 'ACTIVE')->when($solo, fn ($q) => $q->where('id', $solo))->get() as $ro) {
            $entrega = S::masDias($at->toDateString(), (int) ($ro->lead_days ?? S::num('b2b_recurring_lead_days', 1)));
            if (! self::ocurre($ro, $entrega) || DB::table('recurring_order_runs')->where('recurring_order_id', $ro->id)->where('delivery_date', $entrega)->exists()) {
                continue;
            }
            $out[] = self::correrUna($ro, $entrega, $at, $quien);
        }

        return ['ran' => count($out), 'runs' => $out];
    }

    public static function correrUna(object $ro, string $entrega, CarbonImmutable $at, User $quien): object
    {
        DB::beginTransaction();
        try {
            DB::select('SELECT pg_advisory_xact_lock(hashtext(?))', ['b2b:run:'.$ro->id.':'.$entrega]);
            if ($r = DB::table('recurring_order_runs')->where('recurring_order_id', $ro->id)->where('delivery_date', $entrega)->first()) {
                DB::commit();

                return $r;
            }
            $base = ['recurring_order_id' => $ro->id, 'delivery_date' => $entrega, 'run_at' => $at->toIso8601String()];
            $guardar = function (array $f) use ($base) {
                $id = DB::table('recurring_order_runs')->insertGetId($base + $f, 'id');

                return DB::table('recurring_order_runs')->where('id', $id)->first();
            };
            if (self::esFeriado($entrega)) {
                $run = $guardar(['status' => 'SKIPPED', 'message' => 'Feriado: no hay reparto']);
                DB::commit();

                return $run;
            }
            $omitidas = [];
            $lineas = [];
            foreach (DB::table('recurring_order_lines as l')->join('product_variants as v', 'v.id', '=', 'l.variant_id')->where('l.recurring_order_id', $ro->id)->get(['l.*', 'v.name', 'v.status', 'v.sellable']) as $l) {
                if ($l->status !== 'ACTIVE' || ! $l->sellable || ! PreciosCliente::precio($ro->customer_id, $l->variant_id, $entrega)) {
                    $omitidas[] = $l->name;

                    continue;
                }
                $lineas[] = ['variant_id' => $l->variant_id, 'qty' => $l->qty, 'est_weight_kg' => $l->est_weight_kg, 'cut_notes' => $l->cut_notes];
            }
            if (! $lineas) {
                $run = $guardar(['status' => 'FAILED', 'message' => 'Todas las presentaciones están inactivas o sin precio: '.implode(', ', $omitidas)]);
                DB::commit();

                return $run;
            }
            $ficha = Credito::ficha($ro->customer_id);
            $o = Pedidos::crear([
                'customer_id' => $ro->customer_id, 'brand_id' => $ro->brand_id, 'establishment_id' => $ro->establishment_id, 'address_id' => $ro->address_id,
                'delivery_date' => $entrega, 'slot_from' => $ro->slot_from, 'requested_doc_type' => $ro->requested_doc_type,
                'payment_method_id' => $ficha ? Credito::metodoCredito() : DB::table('payment_methods')->where('code', 'TRANSFER')->value('id'),
                'seller_id' => $ficha->seller_user_id ?? null, 'notes' => "Pedido recurrente «{$ro->name}»".($omitidas ? ' · omitido: '.implode(', ', $omitidas) : ''),
                'origin_ref' => 'Recurrente', 'lines' => $lineas,
            ], $quien);
            $estado = 'CREATED';
            $msg = $omitidas ? 'Se omitió '.implode(', ', $omitidas).' (inactiva o sin precio)' : 'Precios tomados en la corrida';
            $chk = Credito::revisar($o);
            if (! $chk['ok']) {
                $estado = 'BLOCKED_CREDIT';
                $msg = $chk['message'];
                if ($o->seller_id) {
                    S::avisar('B2B', ['user_id' => $o->seller_id], 'Pedido recurrente bloqueado por crédito', DB::table('customers')->where('id', $o->customer_id)->value('full_name')." · {$o->number}: {$msg}", 'B2B-06', $o->id, 'danger');
                }
                S::whatsapp()->enviar(['customer_id' => $o->customer_id, 'brand_id' => $o->brand_id, 'kind' => 'UTILITY', 'template' => 'b2b_pedido_recurrente_bloqueado',
                    'text' => "Su pedido {$o->number} para el ".S::dmy($entrega).' quedó en espera por saldo vencido. Contáctenos para regularizar.', 'ref' => $o->id]);
            } elseif ($ro->auto_confirm) {
                try {
                    Credito::confirmar($o->id, $quien, 'Corrida automática de pedido recurrente');
                    $estado = 'CONFIRMED';
                } catch (\App\Support\RuleError $e) {
                    $msg = 'Queda en la bandeja de la vendedora: '.$e->getMessage();
                }
            } else {
                $msg = 'Revisión de la vendedora (sin confirmación automática)';
            }
            $run = $guardar(['order_id' => $o->id, 'status' => $estado, 'message' => $msg]);
            DB::table('recurring_orders')->where('id', $ro->id)->update(['next_delivery_date' => self::proximas($ro, S::masDias($entrega, 1), 1)[0] ?? null]);
            Events::emit('recurring_order.run', 'recurring_orders', $ro->id, ['delivery_date' => $entrega, 'status' => $estado, 'order_id' => $o->id]);
            DB::commit();

            return $run;
        } catch (\Throwable $e) {
            DB::rollBack();
            if (DB::table('recurring_order_runs')->where('recurring_order_id', $ro->id)->where('delivery_date', $entrega)->exists()) {
                return DB::table('recurring_order_runs')->where('recurring_order_id', $ro->id)->where('delivery_date', $entrega)->first();
            }
            $id = DB::table('recurring_order_runs')->insertGetId(['recurring_order_id' => $ro->id, 'delivery_date' => $entrega, 'run_at' => $at->toIso8601String(),
                'status' => 'FAILED', 'message' => mb_substr($e->getMessage(), 0, 500)], 'id');

            return DB::table('recurring_order_runs')->where('id', $id)->first();
        }
    }
}
