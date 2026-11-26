<?php

namespace App\Modulos\B2b\Services;

use App\Models\User;
use App\Modulos\Canales\Soporte as S;
use App\Support\Events;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * B2B-01, B2B-02 y B2B-04: ficha de crédito (RN-B2B-01, 20), exposición y disponible (RN-B2B-02), bloqueo por
 * vencido con gracia (RN-B2B-03, 04) y excepciones de crédito para un pedido (RN-B2B-05).
 * Credito::confirmar() es el control que usan PED, el portal y las corridas al confirmar un pedido a crédito.
 */
final class Credito
{
    public const TIPOS = ['RESTAURANT', 'BUSINESS', 'CONSIGNMENT_POINT'];

    /** Estados del pedido que cuentan como confirmados sin facturar. */
    public const CONFIRMADOS = ['CONFIRMED', 'IN_PREPARATION', 'WEIGHED', 'READY', 'IN_ROUTE', 'DELIVERED'];

    public static function metodoCredito(): ?string
    {
        return DB::table('payment_methods')->where('code', 'CREDIT')->value('id');
    }

    public static function ficha(string $customerId): ?object
    {
        return DB::table('customer_credit_profiles')->where('customer_id', $customerId)->first();
    }

    /** Comprobantes a crédito con saldo (vista b2b_receivables_v). */
    public static function abiertos(string $customerId): \Illuminate\Support\Collection
    {
        return DB::table('b2b_receivables_v')->where('customer_id', $customerId)->whereIn('doc_type', ['INVOICE', 'RECEIPT'])->orderBy('due_date')->get();
    }

    public static function saldo(string $customerId): float
    {
        return S::r(self::abiertos($customerId)->sum('balance'));
    }

    /** Pedidos a crédito confirmados y aún sin comprobante. */
    public static function sinFacturar(string $customerId, ?string $excepto = null): float
    {
        $credito = self::metodoCredito();

        return S::r((float) DB::table('sales_orders as o')->where('o.customer_id', $customerId)->where('o.payment_method_id', $credito)
            ->whereIn('o.status', self::CONFIRMADOS)->when($excepto, fn ($q) => $q->where('o.id', '<>', $excepto))
            ->whereNotExists(fn ($q) => $q->from('sales_documents as d')->whereColumn('d.order_id', 'o.id')->where('d.status', '<>', 'VOIDED'))
            ->sum(DB::raw('coalesce(o.final_total, o.estimated_total)')));
    }

    public static function exposicion(string $customerId, ?string $excepto = null): float
    {
        return S::r(self::saldo($customerId) + self::sinFacturar($customerId, $excepto));
    }

    public static function diasMora(string $customerId, ?string $hoy = null): int
    {
        return (int) DB::selectOne('SELECT customer_overdue_days(?, ?::date) AS d', [$customerId, S::fecha($hoy)])->d;
    }

    public static function vencido(string $customerId, ?string $hoy = null): float
    {
        $hoy = S::fecha($hoy);

        return S::r(self::abiertos($customerId)->filter(fn ($d) => $d->due_date && $d->due_date < $hoy)->sum('balance'));
    }

    public static function gracia(?object $f): int
    {
        return $f && $f->grace_days !== null ? (int) $f->grace_days : (int) S::num('b2b_grace_days', 5);
    }

    /** RN-B2B-03: bloqueado si la ficha está bloqueada o suspendida, o si tiene vencido más allá de la gracia. */
    public static function bloqueado(string $customerId, ?string $hoy = null): bool
    {
        $f = self::ficha($customerId);
        if (! $f) {
            return false;
        }

        return in_array($f->status, ['BLOCKED', 'SUSPENDED'], true) || ($f->block_on_overdue && self::diasMora($customerId, $hoy) > self::gracia($f));
    }

    public static function estado(string $customerId): string
    {
        $f = self::ficha($customerId);

        return ! $f ? 'NONE' : ($f->status === 'SUSPENDED' ? 'SUSPENDED' : (self::bloqueado($customerId) ? 'BLOCKED' : 'ACTIVE'));
    }

    public static function resumen(string $customerId): array
    {
        $f = self::ficha($customerId);
        $saldo = self::saldo($customerId);
        $sinFacturar = self::sinFacturar($customerId);

        return [
            'credit_limit' => $f ? (float) $f->credit_limit : null, 'term_days' => $f->term_days ?? null, 'grace_days' => $f ? self::gracia($f) : null,
            'balance' => $saldo, 'unbilled' => $sinFacturar, 'exposure' => S::r($saldo + $sinFacturar), 'overdue' => self::vencido($customerId),
            'overdue_days' => self::diasMora($customerId), 'available' => $f ? S::r((float) $f->credit_limit - $saldo - $sinFacturar) : null,
            'status' => self::estado($customerId), 'blocked_reason' => $f->blocked_reason ?? null,
        ];
    }

    private static function cambio(object $f, array $entrada, User $quien): string
    {
        return S::historial($f->history, ['at' => S::ahora()->format('Y-m-d\TH:i'), 'user' => $quien->name] + $entrada);
    }

    /** RN-B2B-01 y RN-B2B-20: alta o cambio de la ficha, con motivo; cada cambio queda en el historial y en la auditoría. */
    public static function guardarFicha(string $customerId, array $d, ?string $motivo, User $quien): object
    {
        return DB::transaction(function () use ($customerId, $d, $motivo, $quien) {
            $motivo = S::motivo($motivo, 'RN-B2B-20', 'El cambio de la condición de crédito exige motivo.');
            $c = DB::table('customers')->where('id', $customerId)->first() ?? abort(404);
            if ($c->doc_type !== 'RUC' || ! preg_match('/^(10|15|17|20)\d{9}$/', (string) $c->doc_number) || ! in_array($c->customer_type, self::TIPOS, true)) {
                RuleError::fail('RN-B2B-01', 'Solo un cliente con RUC y tipo restaurante, negocio o punto de consignación puede tener crédito.');
            }
            $f = self::ficha($customerId);
            $fila = [
                'credit_limit' => (float) ($d['credit_limit'] ?? $f->credit_limit ?? 0),
                'term_days' => (int) ($d['term_days'] ?? $f->term_days ?? S::num('b2b_default_term_days', 15)),
                'grace_days' => (int) ($d['grace_days'] ?? $f->grace_days ?? S::num('b2b_grace_days', 5)),
                'block_on_overdue' => (bool) ($d['block_on_overdue'] ?? $f->block_on_overdue ?? true),
                'review_on' => $d['review_on'] ?? $f->review_on ?? S::hoy()->addMonths(6)->toDateString(),
                'seller_user_id' => $d['seller_user_id'] ?? $f->seller_user_id ?? $c->seller_user_id,
            ];
            $fila['credit_limit'] >= 0 || RuleError::fail('RN-B2B-20', 'El límite no puede ser negativo.');
            $fila['term_days'] >= 0 && $fila['term_days'] <= 120 || RuleError::fail('RN-B2B-08', 'El plazo debe estar entre 0 y 120 días.');
            if ($f) {
                $hist = $f->history;
                foreach ($fila as $k => $v) {
                    if ((string) $v !== (string) $f->{$k} && ! ($k === 'block_on_overdue' && (bool) $v === (bool) $f->{$k})) {
                        $hist = self::cambio((object) ['history' => $hist], ['field' => $k, 'before' => $f->{$k}, 'after' => $v, 'reason' => $motivo], $quien);
                    }
                }
                DB::table('customer_credit_profiles')->where('id', $f->id)->update($fila + ['change_reason' => $motivo, 'history' => $hist, 'updated_at' => now()]);
            } else {
                DB::table('customer_credit_profiles')->insert($fila + ['customer_id' => $customerId, 'status' => 'ACTIVE', 'change_reason' => $motivo,
                    'history' => json_encode([['at' => S::ahora()->format('Y-m-d\TH:i'), 'user' => $quien->name, 'field' => 'credit_limit', 'before' => null, 'after' => $fila['credit_limit'], 'reason' => $motivo]], JSON_UNESCAPED_UNICODE)]);
            }
            self::refrescar($customerId);

            return self::ficha($customerId);
        });
    }

    /** RN-B2B-03 y 04: pone o levanta el bloqueo automático según lo vencido (la revisión diaria y cada cobro). */
    public static function refrescar(string $customerId, ?string $hoy = null): ?object
    {
        $f = self::ficha($customerId);
        if (! $f || $f->status === 'SUSPENDED') {
            return $f;
        }
        $mora = self::diasMora($customerId, $hoy);
        $debe = $f->block_on_overdue && $mora > self::gracia($f);
        if ($debe && $f->status !== 'BLOCKED') {
            $motivo = "Comprobante vencido hace {$mora} días (gracia ".self::gracia($f).')';
            DB::table('customer_credit_profiles')->where('id', $f->id)->update([
                'status' => 'BLOCKED', 'blocked_reason' => $motivo, 'blocked_at' => now(), 'auto_blocked' => true,
                'history' => S::historial($f->history, ['at' => S::ahora()->format('Y-m-d\TH:i'), 'user' => 'Revisión automática', 'field' => 'status', 'before' => 'ACTIVE', 'after' => 'BLOCKED', 'reason' => $motivo]), 'updated_at' => now(),
            ]);
            Events::emit('credit.blocked', 'customer_credit_profiles', $f->id, ['customer_id' => $customerId, 'reason' => $motivo]);
        } elseif (! $debe && $f->status === 'BLOCKED' && $f->auto_blocked) {
            DB::table('customer_credit_profiles')->where('id', $f->id)->update([
                'status' => 'ACTIVE', 'blocked_reason' => null, 'auto_blocked' => false,
                'history' => S::historial($f->history, ['at' => S::ahora()->format('Y-m-d\TH:i'), 'user' => 'Revisión automática', 'field' => 'status', 'before' => 'BLOCKED', 'after' => 'ACTIVE', 'reason' => 'Pagó lo vencido']), 'updated_at' => now(),
            ]);
            Events::emit('credit.unblocked', 'customer_credit_profiles', $f->id, ['customer_id' => $customerId]);
        }

        return self::ficha($customerId);
    }

    public static function bloquear(string $customerId, ?string $motivo, User $quien): object
    {
        $f = self::ficha($customerId) ?? abort(404);
        $motivo = S::motivo($motivo, 'RN-B2B-04', 'El bloqueo exige motivo.');
        DB::table('customer_credit_profiles')->where('id', $f->id)->update(['status' => 'BLOCKED', 'blocked_reason' => $motivo, 'blocked_at' => now(), 'auto_blocked' => false,
            'history' => self::cambio($f, ['field' => 'status', 'before' => $f->status, 'after' => 'BLOCKED', 'reason' => $motivo], $quien), 'updated_at' => now()]);
        Events::emit('credit.blocked', 'customer_credit_profiles', $f->id, ['customer_id' => $customerId, 'reason' => $motivo]);

        return self::ficha($customerId);
    }

    /** RN-B2B-04 y 19: se desbloquea solo sin vencido más allá de la gracia; una promesa de pago no desbloquea. */
    public static function desbloquear(string $customerId, ?string $motivo, User $quien): object
    {
        $f = self::ficha($customerId) ?? abort(404);
        $motivo = S::motivo($motivo, 'RN-B2B-04', 'El desbloqueo exige motivo.');
        $mora = self::diasMora($customerId);
        if ($f->block_on_overdue && $mora > self::gracia($f)) {
            RuleError::fail('RN-B2B-04', 'El cliente mantiene '.S::soles(self::vencido($customerId))." vencidos hace {$mora} días: el bloqueo se levanta al pagar lo vencido o con una excepción aprobada para un pedido. Una promesa de pago no desbloquea.");
        }
        DB::table('customer_credit_profiles')->where('id', $f->id)->update(['status' => 'ACTIVE', 'blocked_reason' => null, 'auto_blocked' => false,
            'history' => self::cambio($f, ['field' => 'status', 'before' => $f->status, 'after' => 'ACTIVE', 'reason' => $motivo], $quien), 'updated_at' => now()]);
        Events::emit('credit.unblocked', 'customer_credit_profiles', $f->id, ['customer_id' => $customerId]);

        return self::ficha($customerId);
    }

    /* ------------------------------------------------------------ control del pedido (assert_credit_available) */

    public static function excepcionVigente(string $orderId): ?object
    {
        return DB::table('credit_exceptions')->where('order_id', $orderId)->where('status', 'APPROVED')
            ->where(fn ($q) => $q->whereNull('valid_until')->orWhere('valid_until', '>=', now()))->first();
    }

    /**
     * RN-B2B-02 y 03 para un pedido: ok, o el rechazo con su regla y mensaje.
     *
     * @return array{ok: bool, credit: bool, code?: string, message?: string, exception?: ?object, exceeded?: float}
     */
    public static function revisar(object $o): array
    {
        if ($o->payment_method_id !== self::metodoCredito()) {
            return ['ok' => true, 'credit' => false];
        }
        $f = self::ficha($o->customer_id);
        if (! $f) {
            return ['ok' => false, 'credit' => true, 'code' => 'RN-B2B-01', 'message' => 'El cliente no tiene condición de crédito: el pedido va al contado o se registra su ficha de crédito.'];
        }
        $exc = self::excepcionVigente($o->id);
        $monto = (float) ($o->final_total ?? $o->estimated_total);
        if (self::bloqueado($o->customer_id)) {
            if ($exc) {
                return ['ok' => true, 'credit' => true, 'exception' => $exc];
            }
            $mora = self::diasMora($o->customer_id);
            $porque = $f->status === 'BLOCKED' && ! $f->auto_blocked && $mora <= self::gracia($f) ? $f->blocked_reason
                : 'tiene '.S::soles(self::vencido($o->customer_id))." vencidos hace {$mora} días (gracia ".self::gracia($f).')';

            return ['ok' => false, 'credit' => true, 'code' => 'RN-B2B-03', 'message' => "El cliente está bloqueado para crédito: {$porque}. Puede pagar al contado o pedir una excepción."];
        }
        $exp = self::exposicion($o->customer_id, $o->id);
        $despues = S::r($exp + $monto);
        if ($despues > (float) $f->credit_limit + 0.005) {
            if ($exc) {
                return ['ok' => true, 'credit' => true, 'exception' => $exc];
            }

            return ['ok' => false, 'credit' => true, 'code' => 'RN-B2B-02', 'exceeded' => S::r($despues - (float) $f->credit_limit),
                'message' => 'Saldo y pedidos sin facturar '.S::soles($exp).' + este pedido '.S::soles($monto).' = '.S::soles($despues).' supera el límite de '.S::soles($f->credit_limit).'. Pide una excepción o cobra al contado.'];
        }

        return ['ok' => true, 'credit' => true];
    }

    /** Confirma un pedido con el control de crédito; si usa una excepción, la marca como usada (vale para un solo pedido). */
    public static function confirmar(string $orderId, User $quien, ?string $motivo = null): object
    {
        return DB::transaction(function () use ($orderId, $quien, $motivo) {
            $o = DB::table('sales_orders')->where('id', $orderId)->lockForUpdate()->first() ?? abort(404);
            in_array($o->status, ['DRAFT'], true) || RuleError::fail('RN-B2B-02', 'El pedido ya no está en borrador.');
            $r = self::revisar($o);
            $r['ok'] || RuleError::fail($r['code'], $r['message']);
            Pedidos::confirmar($o, $quien, $motivo ?? (! empty($r['exception']) ? 'Confirmado con excepción de crédito' : null));
            if (! empty($r['exception'])) {
                DB::table('credit_exceptions')->where('id', $r['exception']->id)->update(['status' => 'USED', 'used_at' => now(), 'updated_at' => now()]);
            }

            return DB::table('sales_orders')->where('id', $orderId)->first();
        });
    }

    /* ------------------------------------------------------------ excepciones (RN-B2B-05) */

    public static function solicitarExcepcion(string $orderId, ?string $motivo, User $quien): object
    {
        return DB::transaction(function () use ($orderId, $motivo, $quien) {
            $motivo = S::motivo($motivo, 'RN-B2B-05', 'La excepción exige motivo.');
            $o = DB::table('sales_orders')->where('id', $orderId)->first() ?? abort(404);
            DB::table('credit_exceptions')->where('order_id', $orderId)->whereIn('status', ['PENDING', 'APPROVED'])->exists()
                && RuleError::fail('RN-B2B-05', "El pedido {$o->number} ya tiene una excepción pendiente o aprobada.");
            $f = self::ficha($o->customer_id);
            $monto = (float) ($o->final_total ?? $o->estimated_total);
            $excede = $f ? max(0, S::r(self::exposicion($o->customer_id, $o->id) + $monto - (float) $f->credit_limit)) : $monto;
            $id = DB::table('credit_exceptions')->insertGetId([
                'customer_id' => $o->customer_id, 'order_id' => $o->id, 'kind' => self::bloqueado($o->customer_id) ? 'OVERDUE' : 'OVER_LIMIT',
                'order_amount' => $monto, 'exceeded_amount' => $excede, 'reason' => $motivo, 'requested_by' => $quien->id, 'status' => 'PENDING',
            ], 'id');
            foreach (['GERENTE', 'ADMINISTRACION'] as $rol) {
                S::avisar('B2B', ['role' => $rol], 'Excepción de crédito por decidir', DB::table('customers')->where('id', $o->customer_id)->value('full_name')." · pedido {$o->number} · ".S::soles($monto), 'B2B-04', $id, 'warning');
            }

            return DB::table('credit_exceptions')->where('id', $id)->first();
        });
    }

    public static function decidirExcepcion(string $id, bool $aprobar, ?string $nota, User $quien): object
    {
        return S::base(fn () => DB::transaction(function () use ($id, $aprobar, $nota, $quien) {
            $x = DB::table('credit_exceptions')->where('id', $id)->lockForUpdate()->first() ?? abort(404);
            $x->status === 'PENDING' || RuleError::fail('RN-B2B-05', 'La excepción ya fue decidida.');
            $x->requested_by !== $quien->id || RuleError::fail('RN-B2B-05', 'Quien solicita la excepción no la aprueba: la decide otra persona de gerencia o administración.');
            $hasta = $aprobar ? now()->addHours((int) S::num('b2b_exception_valid_hours', 48)) : null;
            DB::table('credit_exceptions')->where('id', $id)->update([
                'status' => $aprobar ? 'APPROVED' : 'REJECTED', 'decided_by' => $quien->id, 'decided_at' => now(),
                'decision_note' => $nota ? mb_substr($nota, 0, 500) : null, 'valid_until' => $hasta, 'updated_at' => now(),
            ]);
            Events::emit('credit_exception.decided', 'credit_exceptions', $id, ['order_id' => $x->order_id, 'approved' => $aprobar]);
            S::avisar('B2B', ['user_id' => $x->requested_by], 'Excepción de crédito '.($aprobar ? 'aprobada' : 'rechazada'), S::soles($x->order_amount).($hasta ? ' · vale hasta el '.$hasta->setTimezone('America/Lima')->format('d/m/Y H:i') : ''), 'B2B-04', $x->order_id, $aprobar ? 'success' : 'danger');

            return DB::table('credit_exceptions')->where('id', $id)->first();
        }));
    }

    public static function estadoExcepcion(object $x): string
    {
        return $x->status === 'APPROVED' && $x->valid_until && strtotime($x->valid_until) < now()->timestamp ? 'EXPIRED' : $x->status;
    }
}
