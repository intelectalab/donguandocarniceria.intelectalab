<?php

namespace App\Modulos\Cmp\Services;

use App\Models\User;
use App\Modulos\Canales\Soporte as S;
use App\Support\Events;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * CMP-08 a CMP-10: puntos por sol cobrado sin IGV (RN-CMP-11), canje sin superar el saldo (RN-CMP-12), ajustes y
 * reversos con motivo (RN-CMP-13) y referidos (RN-CMP-14). El libro de puntos es de solo inserción: un error se
 * corrige con un movimiento de reverso, nunca editando.
 */
final class Puntos
{
    public const MOVIMIENTOS = ['EARN' => 'Ganados', 'REDEEM' => 'Canje', 'EXPIRE' => 'Vencidos', 'ADJUST' => 'Ajuste', 'REVERSAL' => 'Reverso', 'REFERRAL_BONUS' => 'Premio por referido'];

    public static function programa(): ?object
    {
        return DB::table('loyalty_programs')->where('status', 'ACTIVE')->orderBy('created_at')->first();
    }

    public static function saldo(string $customerId): int
    {
        return (int) DB::table('loyalty_ledger')->where('customer_id', $customerId)->sum('points');
    }

    public static function puntosPor(float $monto): int
    {
        $pr = self::programa();
        $ppp = $pr ? (float) $pr->points_per_pen : S::num('cmp_points_per_pen', 1);

        return (int) floor(S::r($monto / (1 + Campanas::igv())) * $ppp + 1e-9);
    }

    private static function vence(string $fecha, ?object $pr): string
    {
        return \Carbon\CarbonImmutable::parse($fecha)->addMonthsNoOverflow((int) ($pr->expiry_months ?? S::num('cmp_points_expiry_months', 12)))->toDateString();
    }

    /** RN-CMP-11: puntos de un cobro confirmado (una sola vez por cobro: índice único en la base). */
    public static function ganar(string $paymentId): ?object
    {
        $pr = self::programa();
        $p = DB::table('payments')->where('id', $paymentId)->first();
        if (! $pr || ! $p || $p->status !== 'CONFIRMED' || ! $p->customer_id) {
            return null;
        }
        if (DB::table('customers')->where('id', $p->customer_id)->value('customer_type') === 'OTHER') {
            return null;
        }
        if (DB::table('loyalty_ledger')->where('payment_id', $p->id)->where('movement', 'EARN')->exists()) {
            return null;
        }
        $pts = self::puntosPor((float) $p->amount);
        if ($pts <= 0) {
            return null;
        }
        $fecha = S::fecha($p->paid_at);
        $orden = DB::table('payment_allocations')->where('payment_id', $p->id)->whereNotNull('order_id')->orderBy('line_no')->value('order_id');
        $id = DB::table('loyalty_ledger')->insertGetId(['program_id' => $pr->id, 'customer_id' => $p->customer_id, 'movement' => 'EARN', 'points' => $pts,
            'payment_id' => $p->id, 'order_id' => $orden, 'expires_on' => self::vence($fecha, $pr), 'reason' => "Cobro {$p->number} de ".S::soles($p->amount)], 'id');
        Events::emit('loyalty.points_earned', 'loyalty_ledger', $id, ['customer_id' => $p->customer_id, 'points' => $pts, 'payment_id' => $p->id]);

        return DB::table('loyalty_ledger')->where('id', $id)->first();
    }

    /** Cobro revertido: se revierten sus puntos (CA-CMP-04). */
    public static function reversarCobro(string $paymentId, ?string $motivo = null): ?object
    {
        $e = DB::table('loyalty_ledger')->where('payment_id', $paymentId)->where('movement', 'EARN')->first();
        if (! $e || DB::table('loyalty_ledger')->where('reversal_of', $e->id)->exists()) {
            return null;
        }
        $id = DB::table('loyalty_ledger')->insertGetId(['program_id' => $e->program_id, 'customer_id' => $e->customer_id, 'movement' => 'REVERSAL', 'points' => -$e->points,
            'payment_id' => $paymentId, 'reversal_of' => $e->id, 'reason' => mb_substr($motivo ?: 'Cobro revertido', 0, 255)], 'id');

        return DB::table('loyalty_ledger')->where('id', $id)->first();
    }

    /** Lo corre la tarea diaria: puntos de los cobros confirmados y reversos de los cobros revertidos. */
    public static function sincronizar(int $dias = 30): array
    {
        $desde = now()->subDays($dias);
        $g = 0;
        $r = 0;
        foreach (DB::table('payments as p')->where('p.status', 'CONFIRMED')->where('p.paid_at', '>=', $desde)
            ->whereNotExists(fn ($q) => $q->from('loyalty_ledger as l')->whereColumn('l.payment_id', 'p.id')->where('l.movement', 'EARN'))->pluck('p.id') as $id) {
            self::ganar($id) && $g++;
        }
        foreach (DB::table('payments as p')->where('p.status', 'REVERSED')
            ->whereExists(fn ($q) => $q->from('loyalty_ledger as l')->whereColumn('l.payment_id', 'p.id')->where('l.movement', 'EARN'))
            ->whereNotExists(fn ($q) => $q->from('loyalty_ledger as l')->whereColumn('l.payment_id', 'p.id')->where('l.movement', 'REVERSAL'))->get(['p.id', 'p.reversal_reason']) as $p) {
            self::reversarCobro($p->id, $p->reversal_reason) && $r++;
        }

        return ['earned' => $g, 'reversed' => $r];
    }

    /** RN-CMP-12: el canje no supera el saldo y respeta el mínimo. */
    public static function canjear(string $customerId, int $puntos, User $quien, ?string $orderId = null): object
    {
        return DB::transaction(function () use ($customerId, $puntos, $quien, $orderId) {
            DB::select('SELECT pg_advisory_xact_lock(hashtext(?))', ['cmp:puntos:'.$customerId]);
            $pr = self::programa() ?? RuleError::fail('RN-CMP-12', 'No hay programa de puntos activo.');
            $puntos > 0 || RuleError::fail('RN-CMP-12', 'Indica cuántos puntos canjear.');
            $saldo = self::saldo($customerId);
            $puntos <= $saldo || RuleError::fail('RN-CMP-12', "El cliente tiene {$saldo} puntos e intenta canjear {$puntos}: el canje no supera el saldo.");
            $min = (int) ($pr->min_redeem_points ?? S::num('cmp_min_redeem_points', 100));
            $puntos >= $min || RuleError::fail('RN-CMP-12', "El canje mínimo es de {$min} puntos.");
            $valor = S::r($puntos * (float) ($pr->pen_per_point ?? S::num('cmp_pen_per_point', 0.05)));
            $o = null;
            if ($orderId) {
                $o = DB::table('sales_orders')->where('id', $orderId)->lockForUpdate()->first() ?? abort(404);
                in_array($o->status, ['DRAFT', 'CONFIRMED'], true) || RuleError::fail('RN-CMP-12', 'El canje se aplica a un pedido en borrador o confirmado.');
                $o->customer_id === $customerId || RuleError::fail('RN-CMP-12', 'El pedido es de otro cliente.');
                DB::table('sales_orders')->where('id', $o->id)->update(['order_discount' => S::r((float) ($o->order_discount ?? 0) + $valor),
                    'estimated_total' => S::r(max(0, (float) $o->estimated_total - $valor)), 'updated_at' => now()]);
            }
            $id = DB::table('loyalty_ledger')->insertGetId(['program_id' => $pr->id, 'customer_id' => $customerId, 'movement' => 'REDEEM', 'points' => -$puntos,
                'order_id' => $o->id ?? null, 'value_pen' => $valor, 'user_id' => $quien->id, 'reason' => 'Canje por '.S::soles($valor).($o ? " en {$o->number}" : '')], 'id');

            return DB::table('loyalty_ledger')->where('id', $id)->first();
        });
    }

    /** RN-CMP-13: ajuste con motivo (permiso cmp.loyalty.adjust en la ruta). */
    public static function ajustar(string $customerId, int $puntos, ?string $motivo, User $quien): object
    {
        $motivo = S::motivo($motivo, 'RN-CMP-13', 'Un ajuste de puntos exige motivo.');
        $puntos !== 0 || RuleError::fail('RN-CMP-13', 'El ajuste no puede ser cero.');
        self::saldo($customerId) + $puntos >= 0 || RuleError::fail('RN-CMP-12', 'El ajuste dejaría el saldo negativo.');
        $pr = self::programa() ?? RuleError::fail('RN-CMP-12', 'No hay programa de puntos activo.');
        $id = DB::table('loyalty_ledger')->insertGetId(['program_id' => $pr->id, 'customer_id' => $customerId, 'movement' => 'ADJUST', 'points' => $puntos,
            'reason' => mb_substr($motivo, 0, 255), 'user_id' => $quien->id, 'expires_on' => $puntos > 0 ? self::vence(S::fecha(), $pr) : null], 'id');

        return DB::table('loyalty_ledger')->where('id', $id)->first();
    }

    public static function reversar(string $ledgerId, ?string $motivo, User $quien): object
    {
        $motivo = S::motivo($motivo, 'RN-CMP-13', 'El reverso exige motivo.');
        $row = DB::table('loyalty_ledger')->where('id', $ledgerId)->first() ?? abort(404);
        ($row->movement !== 'REVERSAL' && ! DB::table('loyalty_ledger')->where('reversal_of', $row->id)->exists()) || RuleError::fail('RN-CMP-13', 'Ese movimiento ya fue revertido.');
        self::saldo($row->customer_id) - $row->points >= 0 || RuleError::fail('RN-CMP-12', 'El reverso dejaría el saldo negativo.');
        $id = DB::table('loyalty_ledger')->insertGetId(['program_id' => $row->program_id, 'customer_id' => $row->customer_id, 'movement' => 'REVERSAL', 'points' => -$row->points,
            'reversal_of' => $row->id, 'reason' => mb_substr($motivo, 0, 255), 'user_id' => $quien->id], 'id');

        return DB::table('loyalty_ledger')->where('id', $id)->first();
    }

    /** Puntos que vencen hasta la fecha (FIFO: lo canjeado consume primero lo más antiguo). */
    public static function porVencer(string $customerId, string $hasta): array
    {
        $rows = DB::table('loyalty_ledger')->where('customer_id', $customerId)->get();
        $revertidos = $rows->whereNotNull('reversal_of')->pluck('reversal_of')->flip();
        $pos = $rows->filter(fn ($r) => $r->points > 0 && $r->movement !== 'REVERSAL' && $r->expires_on && ! isset($revertidos[$r->id]))->sortBy('expires_on')->values();
        $usado = -$rows->filter(fn ($r) => $r->points < 0 && ! ($r->movement === 'REVERSAL' && $r->reversal_of))->sum('points');
        $out = [];
        foreach ($pos as $p) {
            $toma = min($usado, $p->points);
            $usado -= $toma;
            $queda = $p->points - $toma;
            if ($queda > 0 && $p->expires_on <= $hasta) {
                $out[] = ['row' => $p, 'points' => (int) $queda];
            }
        }

        return $out;
    }

    /** Vence los puntos cuya fecha ya pasó. */
    public static function vencer(?string $hoy = null): int
    {
        $hoy = S::fecha($hoy);
        $n = 0;
        $clientes = DB::table('loyalty_ledger')->where('points', '>', 0)->where('expires_on', '<', $hoy)->distinct()->pluck('customer_id');
        foreach ($clientes as $cid) {
            foreach (self::porVencer($cid, S::masDias($hoy, -1)) as $e) {
                DB::table('loyalty_ledger')->insert(['program_id' => $e['row']->program_id, 'customer_id' => $cid, 'movement' => 'EXPIRE', 'points' => -$e['points'],
                    'expires_on' => $e['row']->expires_on, 'reason' => 'Vencen puntos del '.S::dmy(substr((string) $e['row']->created_at, 0, 10))]);
                $n++;
            }
        }

        return $n;
    }

    public static function movimientos(string $customerId): array
    {
        $hoy = S::fecha();
        $rows = DB::table('loyalty_ledger as l')->leftJoin('sales_orders as o', 'o.id', '=', 'l.order_id')->leftJoin('payments as p', 'p.id', '=', 'l.payment_id')
            ->where('l.customer_id', $customerId)->orderByDesc('l.created_at')->get(['l.*', 'o.number as order_number', 'p.number as payment_number']);
        $revertidos = $rows->whereNotNull('reversal_of')->pluck('reversal_of')->flip();
        $pr = self::programa();

        return ['balance' => self::saldo($customerId), 'value' => S::r(self::saldo($customerId) * (float) ($pr->pen_per_point ?? 0.05)),
            'movements' => $rows->map(fn ($r) => tap($r, fn ($r) => $r->reversed = isset($revertidos[$r->id])))->all(),
            'expiring' => array_map(fn ($e) => ['points' => $e['points'], 'expires_on' => $e['row']->expires_on], self::porVencer($customerId, S::masDias($hoy, 60))),
            'program' => $pr];
    }

    /* ------------------------------------------------------------ referidos (RN-CMP-14) */

    public static function codigoReferido(object $c): string
    {
        if ($c->referral_code) {
            return $c->referral_code;
        }
        $base = strtoupper(preg_replace('/[^A-Za-z]/', '', iconv('UTF-8', 'ASCII//TRANSLIT', strtok((string) ($c->trade_name ?: $c->full_name), ' ')) ?: 'CLI'));
        $code = substr($base ?: 'CLI', 0, 5).strtoupper(substr(str_replace('-', '', $c->id), -4));
        DB::table('customers')->where('id', $c->id)->update(['referral_code' => $code]);

        return $code;
    }

    /** D-CMP-02: el referido recibe un cupón personal de bienvenida; el referente, los puntos al primer pedido entregado y cobrado. */
    public static function registrarReferido(string $referrerId, string $referredId, User $quien): object
    {
        return S::base(fn () => DB::transaction(function () use ($referrerId, $referredId, $quien) {
            $a = DB::table('customers')->where('id', $referrerId)->first();
            $b = DB::table('customers')->where('id', $referredId)->first();
            ($a && $b) || RuleError::fail('RN-CMP-14', 'Elige el cliente que refiere y el cliente referido.');
            $a->id !== $b->id || RuleError::fail('RN-CMP-14', 'Un cliente no puede referirse a sí mismo.');
            (DB::table('sales_orders')->where('customer_id', $b->id)->whereNotIn('status', ['DRAFT', 'CANCELLED'])->exists() || (int) $b->orders_count > 0)
                && RuleError::fail('RN-CMP-14', "{$b->full_name} ya tiene pedidos: el referido debe ser un cliente nuevo.");
            DB::table('referrals')->where('referred_customer_id', $b->id)->where('status', '<>', 'REJECTED')->exists()
                && RuleError::fail('RN-CMP-14', "{$b->full_name} ya fue referido antes: solo se refiere una vez.");
            $codigo = self::codigoReferido($a);
            $cup = 'REF-'.substr($codigo, 0, 9).'-'.strtoupper(substr(str_replace('-', '', $b->id), -4));
            $cupon = Cupones::porCodigo($cup) ?? Cupones::guardar(['code' => $cup, 'discount_type' => 'PCT', 'value' => 10, 'max_discount' => 30, 'valid_from' => S::fecha(),
                'valid_to' => S::masDias(S::fecha(), 60), 'max_uses_total' => 1, 'max_uses_per_customer' => 1, 'customer_id' => $b->id,
                'description' => 'Bienvenida por referido de '.$a->full_name], null, $quien);
            $fila = ['referrer_customer_id' => $a->id, 'referral_code' => $codigo, 'status' => 'PENDING', 'welcome_coupon_id' => $cupon->id, 'reject_reason' => null];
            // Un referido rechazado se puede volver a registrar: se reutiliza su fila (referred_customer_id es único).
            if ($id = DB::table('referrals')->where('referred_customer_id', $b->id)->where('status', 'REJECTED')->value('id')) {
                DB::table('referrals')->where('id', $id)->update($fila + ['updated_at' => now()]);
            } else {
                $id = DB::table('referrals')->insertGetId($fila + ['referred_customer_id' => $b->id], 'id');
            }

            return DB::table('referrals')->where('id', $id)->first();
        }));
    }

    /** Premio al referente cuando el primer pedido del referido queda entregado y cobrado. */
    public static function revisarReferido(string $orderId): ?object
    {
        $o = DB::table('sales_orders')->where('id', $orderId)->first();
        $ref = $o ? DB::table('referrals')->where('referred_customer_id', $o->customer_id)->whereIn('status', ['PENDING', 'QUALIFIED'])->first() : null;
        if (! $ref) {
            return null;
        }
        $total = (float) ($o->final_total ?? $o->estimated_total);
        $entregado = in_array($o->status, ['DELIVERED', 'CLOSED'], true);
        $cobrado = (float) $o->paid_amount >= $total - 0.01;
        if (! $entregado && ! $cobrado) {
            return $ref;
        }
        if ($entregado !== $cobrado) {
            DB::table('referrals')->where('id', $ref->id)->update(['status' => 'QUALIFIED', 'first_order_id' => $o->id, 'qualified_at' => $ref->qualified_at ?? now(), 'updated_at' => now()]);

            return DB::table('referrals')->where('id', $ref->id)->first();
        }
        $pr = self::programa();
        if (! $pr) {
            return $ref;
        }
        $led = DB::table('loyalty_ledger')->insertGetId(['program_id' => $pr->id, 'customer_id' => $ref->referrer_customer_id, 'movement' => 'REFERRAL_BONUS',
            'points' => (int) ($pr->referral_bonus_points ?: 200), 'order_id' => $o->id, 'expires_on' => self::vence(S::fecha(), $pr),
            'reason' => "Referido: primer pedido {$o->number} entregado y cobrado"], 'id');
        DB::table('referrals')->where('id', $ref->id)->update(['status' => 'REWARDED', 'first_order_id' => $o->id, 'qualified_at' => $ref->qualified_at ?? now(), 'rewarded_at' => now(), 'reward_ledger_id' => $led, 'updated_at' => now()]);
        Events::emit('referral.rewarded', 'referrals', $ref->id, ['referrer' => $ref->referrer_customer_id, 'points' => (int) ($pr->referral_bonus_points ?: 200)]);

        return DB::table('referrals')->where('id', $ref->id)->first();
    }

    public static function revisarReferidos(): int
    {
        $n = 0;
        foreach (DB::table('referrals as r')->join('sales_orders as o', 'o.customer_id', '=', 'r.referred_customer_id')->whereIn('r.status', ['PENDING', 'QUALIFIED'])
            ->whereNotIn('o.status', ['DRAFT', 'CANCELLED'])->orderBy('o.created_at')->pluck('o.id') as $oid) {
            ($r = self::revisarReferido($oid)) && $r->status === 'REWARDED' && $n++;
        }

        return $n;
    }

    public static function rechazarReferido(string $id, ?string $motivo, User $quien): object
    {
        $motivo = S::motivo($motivo, 'RN-CMP-14', 'Indica el motivo del rechazo.');
        $r = DB::table('referrals')->where('id', $id)->first() ?? abort(404);
        $r->status !== 'REWARDED' || RuleError::fail('RN-CMP-14', 'Un referido ya premiado no se rechaza: revierte los puntos si hace falta.');
        DB::table('referrals')->where('id', $id)->update(['status' => 'REJECTED', 'reject_reason' => mb_substr($motivo, 0, 255), 'updated_at' => now()]);
        $r->welcome_coupon_id && DB::table('coupons')->where('id', $r->welcome_coupon_id)->update(['status' => 'PAUSED', 'updated_at' => now()]);

        return DB::table('referrals')->where('id', $id)->first();
    }
}
