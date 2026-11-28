<?php

namespace App\Modulos\Per\Services;

use App\Models\User;
use App\Support\Events;
use App\Support\RuleError;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * PER-10 Planes y PER-11 Comisiones y bonos del período.
 * RN-PER-10: comisión sobre lo cobrado (asignación de un cobro confirmado a un pedido de la vendedora), sin IGV.
 * RN-PER-11: una por asignación y plan (índice único). RN-PER-12: un reverso en negativo, en el período abierto.
 * RN-PER-13: bono por pedido entregado al repartidor de la parada, uno por pedido y repartidor. RN-PER-15: cierre el día 5.
 * Los eventos aún no se despachan entre módulos (Events): PER lee los cobros y entregas y los procesa sin duplicar.
 */
final class Comisiones
{
    /** Día en que cierran las comisiones del mes $periodo (RN-PER-15). */
    public static function cierre(string $periodo): string
    {
        $dia = max(1, min(28, (int) Base::num('per_commission_close_day', 5)));

        return CarbonImmutable::parse(Base::sumarMeses($periodo, 1))->addDays($dia - 1)->toDateString();
    }

    public static function cerrado(string $periodo, ?string $hoy = null): bool
    {
        return ($hoy ?? Base::hoy()) > self::cierre($periodo);
    }

    /** RN-PER-15: lo que se procesa después del cierre del mes del hecho entra al período abierto. */
    public static function periodoPara(string $fechaHecho, ?string $procesado = null): string
    {
        $p = Base::mes($fechaHecho);
        $hoy = $procesado ?? Base::hoy();

        return $hoy > self::cierre($p) ? self::abierto($hoy) : $p;
    }

    /** Período abierto en una fecha: el mes anterior si aún no cierra; si no, el mes en curso. */
    public static function abierto(?string $hoy = null): string
    {
        $hoy ??= Base::hoy();
        $ant = Base::sumarMeses(Base::mes($hoy), -1);

        return $hoy <= self::cierre($ant) ? $ant : Base::mes($hoy);
    }

    public static function igv(): float
    {
        $v = (float) (\App\Support\Params::get('fac_igv_rate') ?? 0.18);

        return $v > 1 ? $v / 100 : ($v > 0 ? $v : 0.18);
    }

    public static function base(float $monto): float
    {
        return Base::texto('per_commission_base', 'NET_OF_IGV') === 'GROSS' ? Base::r($monto) : Base::r($monto / (1 + self::igv()));
    }

    /** Plan vigente del tipo: el más específico (marca y canal) primero. */
    public static function plan(string $tipo, ?string $marca, ?string $canal, string $fecha): ?object
    {
        return DB::table('commission_plans')->where('plan_type', $tipo)->where('status', 'ACTIVE')->where('valid_from', '<=', $fecha)
            ->where(fn ($w) => $w->whereNull('valid_to')->orWhere('valid_to', '>=', $fecha))
            ->where(fn ($w) => $w->whereNull('brand_id')->orWhere('brand_id', $marca))->where(fn ($w) => $w->whereNull('channel')->orWhere('channel', $canal))
            ->orderByRaw('(CASE WHEN brand_id IS NULL THEN 0 ELSE 2 END + CASE WHEN channel IS NULL THEN 0 ELSE 1 END) DESC')->orderByDesc('valid_from')->first();
    }

    private static function tasa(object $plan, string $empleado, string $periodo, float $base): float
    {
        $tramos = json_decode($plan->tiers ?? '[]', true) ?: [];
        if (! $tramos) {
            return (float) $plan->rate_pct;
        }
        $acum = (float) DB::table('commission_entries')->where('employee_id', $empleado)->where('plan_id', $plan->id)->where('period', $periodo)->sum('base_amount') + $base;
        usort($tramos, fn ($a, $b) => $a['from'] <=> $b['from']);
        $r = (float) $plan->rate_pct;
        foreach ($tramos as $t) {
            if ($acum >= (float) $t['from']) {
                $r = (float) $t['rate_pct'];
            }
        }

        return $r;
    }

    /** RN-PER-10/11: procesa un cobro confirmado. Devuelve las comisiones nuevas (ninguna si ya estaba procesado). */
    public static function cobro(string $pagoId, ?string $procesado = null, bool $historico = false): array
    {
        $p = DB::table('payments')->where('id', $pagoId)->first();
        // $historico: rehace un cobro que estuvo confirmado y luego se revirtió (siembra de la demo)
        if (! $p || ($p->status !== 'CONFIRMED' && ! ($historico && $p->status === 'REVERSED'))) {
            return [];
        }
        $fecha = CarbonImmutable::parse($p->paid_at ?? $p->created_at)->setTimezone('America/Lima');
        $nuevas = [];
        $asig = DB::table('payment_allocations as a')->join('sales_orders as o', 'o.id', '=', 'a.order_id')->join('users as u', 'u.id', '=', 'o.seller_id')
            ->where('a.payment_id', $p->id)->where('a.amount', '>', 0)->whereNotNull('u.employee_id')
            ->get(['a.id', 'a.amount', 'o.id as order_id', 'o.brand_id', 'o.channel', 'u.employee_id']);
        foreach ($asig as $a) {
            $plan = self::plan('SELLER_COLLECTED', $a->brand_id, $a->channel, $fecha->toDateString());
            if (! $plan) {
                continue;
            }
            $periodo = self::periodoPara($fecha->toDateString(), $procesado);
            $base = self::base((float) $a->amount);
            $tasa = self::tasa($plan, $a->employee_id, $periodo, $base);
            $monto = Base::r($base * $tasa / 100);
            $ok = DB::table('commission_entries')->insertOrIgnore([   // el índice único hace que un reproceso no duplique (CA-PER-08)
                'plan_id' => $plan->id, 'employee_id' => $a->employee_id, 'source_type' => 'PAYMENT_ALLOCATION', 'payment_allocation_id' => $a->id, 'payment_id' => $p->id,
                'order_id' => $a->order_id, 'brand_id' => $a->brand_id, 'period' => $periodo, 'base_amount' => $base, 'rate_pct' => $tasa, 'amount' => $monto,
                'earned_at' => $fecha->toIso8601String(),
            ]);
            if ($ok) {
                $nuevas[] = ['employee_id' => $a->employee_id, 'amount' => $monto, 'period' => $periodo];
                Events::emit('commission.earned', 'payments', $p->id, ['employee_id' => $a->employee_id, 'amount' => $monto, 'period' => $periodo]);
            }
        }

        return $nuevas;
    }

    /** RN-PER-12: el cobro se revirtió; cada comisión suya recibe su reverso en negativo en el período abierto. */
    public static function reverso(string $pagoId, ?string $motivo = null, ?string $procesado = null): array
    {
        $p = DB::table('payments')->where('id', $pagoId)->first();
        $hoy = $procesado ?? Base::hoy();
        $periodo = self::abierto($hoy);
        $nuevas = [];
        foreach (DB::table('commission_entries')->where('payment_id', $pagoId)->where('source_type', 'PAYMENT_ALLOCATION')->get() as $c) {
            $ok = DB::table('commission_entries')->insertOrIgnore([
                'plan_id' => $c->plan_id, 'employee_id' => $c->employee_id, 'source_type' => 'REVERSAL', 'payment_allocation_id' => $c->payment_allocation_id,
                'payment_id' => $c->payment_id, 'order_id' => $c->order_id, 'brand_id' => $c->brand_id, 'period' => $periodo,
                'base_amount' => -1 * (float) $c->base_amount, 'rate_pct' => $c->rate_pct, 'amount' => -1 * (float) $c->amount,
                'earned_at' => ($p?->reversed_at ? CarbonImmutable::parse($p->reversed_at) : Base::ahora())->toIso8601String(), 'reversal_of' => $c->id,
                'reason' => mb_substr($motivo ?? $p?->reversal_reason ?? 'Cobro revertido en CAJ', 0, 300),
            ]);
            if ($ok) {
                $nuevas[] = ['employee_id' => $c->employee_id, 'amount' => -1 * (float) $c->amount, 'period' => $periodo];
                Events::emit('commission.reversed', 'payments', $pagoId, ['employee_id' => $c->employee_id, 'amount' => -1 * (float) $c->amount]);
            }
        }

        return $nuevas;
    }

    /** RN-PER-13: bono por pedido entregado (delivery), al repartidor de la parada entregada (o del pedido). */
    public static function entrega(string $pedidoId, ?string $procesado = null): ?array
    {
        $o = DB::table('sales_orders')->where('id', $pedidoId)->first();
        if (! $o || ! in_array($o->status, ['DELIVERED', 'CLOSED'], true) || $o->fulfillment !== 'DELIVERY' || ! $o->delivered_at) {
            return null;
        }
        $parada = DB::table('delivery_stops as s')->join('delivery_routes as r', 'r.id', '=', 's.route_id')->where('s.order_id', $o->id)->where('s.status', 'DELIVERED')
            ->orderByDesc('s.closed_at')->first(['s.id', 'r.driver_user_id', 'r.driver_employee_id']);
        $empleado = $parada?->driver_employee_id ?: Base::empleadoDe($parada?->driver_user_id ?: $o->driver_user_id);
        if (! $empleado) {
            return null;
        }
        $fecha = CarbonImmutable::parse($o->delivered_at)->setTimezone('America/Lima');
        $plan = self::plan('DRIVER_DELIVERY', $o->brand_id, $o->channel, $fecha->toDateString());
        if (! $plan) {
            return null;
        }
        $monto = $plan->per_delivery_amount !== null ? (float) $plan->per_delivery_amount : Base::num('per_delivery_bonus_amount', 1.5);
        $periodo = self::periodoPara($fecha->toDateString(), $procesado);
        $ok = DB::table('commission_entries')->insertOrIgnore([
            'plan_id' => $plan->id, 'employee_id' => $empleado, 'source_type' => 'DELIVERY', 'order_id' => $o->id, 'brand_id' => $o->brand_id,
            'delivery_stop_id' => $parada?->id, 'period' => $periodo, 'base_amount' => 0, 'amount' => Base::r($monto), 'earned_at' => $fecha->toIso8601String(),
        ]);

        return $ok ? ['employee_id' => $empleado, 'amount' => $monto, 'period' => $periodo] : null;
    }

    /**
     * Procesa lo pendiente desde una fecha: cobros confirmados sin comisión, cobros revertidos con comisión sin reverso
     * y pedidos entregados sin bono. Es idempotente: se puede correr las veces que haga falta.
     */
    public static function procesar(?string $desde = null, ?string $procesado = null): array
    {
        $desde ??= Base::sumarMeses(Base::mes(), -2);
        $n = ['comisiones' => 0, 'reversos' => 0, 'bonos' => 0];
        $pagos = DB::table('payments as p')->where('p.status', 'CONFIRMED')->where('p.paid_at', '>=', $desde)
            ->whereExists(fn ($q) => $q->from('payment_allocations as a')->join('sales_orders as o', 'o.id', '=', 'a.order_id')->whereColumn('a.payment_id', 'p.id')->whereNotNull('o.seller_id')
                ->whereNotExists(fn ($x) => $x->from('commission_entries as c')->whereColumn('c.payment_allocation_id', 'a.id')->where('c.source_type', 'PAYMENT_ALLOCATION')))
            ->orderBy('p.paid_at')->get(['p.id', 'p.paid_at']);
        foreach ($pagos as $p) {
            $n['comisiones'] += count(self::cobro($p->id, $procesado ?? null));
        }
        $rev = DB::table('payments as p')->where('p.status', 'REVERSED')
            ->whereExists(fn ($q) => $q->from('commission_entries as c')->whereColumn('c.payment_id', 'p.id')->where('c.source_type', 'PAYMENT_ALLOCATION')
                ->whereNotExists(fn ($x) => $x->from('commission_entries as r')->whereColumn('r.reversal_of', 'c.id')))->pluck('p.id');
        foreach ($rev as $id) {
            $n['reversos'] += count(self::reverso($id, null, $procesado));
        }
        $ped = DB::table('sales_orders as o')->whereIn('o.status', ['DELIVERED', 'CLOSED'])->where('o.fulfillment', 'DELIVERY')->where('o.delivered_at', '>=', $desde)
            ->whereNotExists(fn ($x) => $x->from('commission_entries as c')->whereColumn('c.order_id', 'o.id')->where('c.source_type', 'DELIVERY'))->orderBy('o.delivered_at')->pluck('o.id');
        foreach ($ped as $id) {
            if (self::entrega($id, $procesado)) {
                $n['bonos']++;
            }
        }

        return $n;
    }

    /* ---------------- Totales ---------------- */

    public static function totales(string $periodo, ?string $empleado = null): array
    {
        $r = DB::table('commission_entries as c')->join('commission_plans as p', 'p.id', '=', 'c.plan_id')->where('c.period', $periodo)
            ->when($empleado, fn ($w) => $w->where('c.employee_id', $empleado))
            ->selectRaw("coalesce(sum(c.amount) FILTER (WHERE p.plan_type = 'SELLER_COLLECTED' AND c.source_type <> 'REVERSAL'), 0) AS comision,
                coalesce(sum(c.amount) FILTER (WHERE p.plan_type = 'SELLER_COLLECTED' AND c.source_type = 'REVERSAL'), 0) AS reversos,
                coalesce(sum(c.base_amount) FILTER (WHERE p.plan_type = 'SELLER_COLLECTED'), 0) AS base,
                coalesce(sum(c.amount) FILTER (WHERE p.plan_type = 'DRIVER_DELIVERY'), 0) AS bonos,
                count(*) FILTER (WHERE c.source_type = 'DELIVERY') AS entregas, count(*) AS n")->first();

        return ['comision' => Base::r($r->comision), 'reversos' => Base::r($r->reversos), 'neta' => Base::r($r->comision + $r->reversos), 'base' => Base::r($r->base),
            'bonos' => Base::r($r->bonos), 'entregas' => (int) $r->entregas, 'n' => (int) $r->n];
    }

    /** PER-11: totales por persona y el detalle del período (o de una persona). */
    public static function periodo(string $periodo, ?string $empleado, User $u): array
    {
        $vis = Base::visibles($u);
        $ve = Base::veSueldos($u);
        $yo = Base::yo($u);
        $por = DB::table('commission_entries as c')->join('commission_plans as p', 'p.id', '=', 'c.plan_id')->join('employees as e', 'e.id', '=', 'c.employee_id')
            ->where('c.period', $periodo)->when($vis !== null, fn ($w) => $w->whereIn('c.employee_id', $vis))
            ->groupBy('c.employee_id', 'e.full_name')->orderBy('e.full_name')
            ->selectRaw("c.employee_id, e.full_name,
                coalesce(sum(c.amount) FILTER (WHERE p.plan_type = 'SELLER_COLLECTED' AND c.source_type <> 'REVERSAL'), 0) AS comision,
                coalesce(sum(c.amount) FILTER (WHERE c.source_type = 'REVERSAL'), 0) AS reversos,
                coalesce(sum(c.base_amount) FILTER (WHERE p.plan_type = 'SELLER_COLLECTED'), 0) AS base,
                coalesce(sum(c.amount) FILTER (WHERE p.plan_type = 'DRIVER_DELIVERY'), 0) AS bonos,
                count(*) FILTER (WHERE c.source_type = 'PAYMENT_ALLOCATION') AS cobros, count(*) FILTER (WHERE c.source_type = 'DELIVERY') AS entregas")->get();
        $pagos = DB::table('staff_payouts')->where('period', $periodo)->where('status', '<>', 'VOIDED')->pluck('status', 'employee_id');
        $personas = $por->map(function ($f) use ($ve, $yo, $pagos) {
            $v = $ve || $f->employee_id === $yo;

            return ['employee_id' => $f->employee_id, 'trabajador' => $f->full_name, 'cobros' => (int) $f->cobros, 'entregas' => (int) $f->entregas,
                'base' => $v ? Base::r($f->base) : null, 'comision' => $v ? Base::r($f->comision) : null, 'reversos' => $v ? Base::r($f->reversos) : null,
                'neta' => $v ? Base::r($f->comision + $f->reversos) : null, 'bonos' => $v ? Base::r($f->bonos) : null,
                'total' => $v ? Base::r($f->comision + $f->reversos + $f->bonos) : null, 'pago' => $pagos[$f->employee_id] ?? null];
        })->all();
        $detalle = [];
        if ($empleado) {
            if ($vis !== null && ! in_array($empleado, $vis, true)) {
                RuleError::fail('RN-PER-19', 'Solo ves tus propias comisiones y las de tu equipo.');
            }
            $v = $ve || $empleado === $yo;
            $detalle = DB::table('commission_entries as c')->join('commission_plans as p', 'p.id', '=', 'c.plan_id')->leftJoin('sales_orders as o', 'o.id', '=', 'c.order_id')
                ->leftJoin('payments as pg', 'pg.id', '=', 'c.payment_id')->leftJoin('brands as b', 'b.id', '=', 'c.brand_id')
                ->where('c.period', $periodo)->where('c.employee_id', $empleado)->orderByDesc('c.earned_at')->limit(1000)
                ->get(['c.*', 'p.code as plan', 'p.plan_type', 'o.number as pedido', 'pg.number as cobro', 'b.name as marca'])
                ->map(fn ($c) => ['id' => $c->id, 'source_type' => $c->source_type, 'plan' => $c->plan, 'plan_type' => $c->plan_type, 'pedido' => $c->pedido, 'cobro' => $c->cobro,
                    'marca' => $c->marca, 'earned_at' => Asistencia::iso($c->earned_at), 'base' => $v ? (float) $c->base_amount : null, 'rate_pct' => $c->rate_pct === null ? null : (float) $c->rate_pct,
                    'amount' => $v ? (float) $c->amount : null, 'reason' => $c->reason])->all();
        }
        $t = self::totales($periodo);

        return ['periodo' => $periodo, 'nombre' => Base::nombreMes($periodo), 'cierre' => self::cierre($periodo), 'cerrado' => self::cerrado($periodo),
            'abierto' => self::abierto(), 'personas' => $personas, 'detalle' => $detalle,
            'resumen' => $ve ? $t + ['kpi_pct' => $t['base'] > 0 ? Base::r($t['neta'] / $t['base'] * 100, 2) : null] : ['entregas' => $t['entregas'], 'n' => $t['n']]];
    }

    /* ---------------- PER-10 Planes ---------------- */

    public static function planes(): array
    {
        return DB::table('commission_plans as p')->leftJoin('brands as b', 'b.id', '=', 'p.brand_id')->orderBy('p.plan_type')->orderByDesc('p.status')->orderBy('p.valid_from')
            ->get(['p.*', 'b.name as marca'])->map(fn ($p) => ['id' => $p->id, 'code' => $p->code, 'name' => $p->name, 'plan_type' => $p->plan_type,
                'tipo' => $p->plan_type === 'SELLER_COLLECTED' ? 'Comisión sobre lo cobrado' : 'Bono por entrega', 'brand_id' => $p->brand_id, 'marca' => $p->marca ?? 'Todas',
                'channel' => $p->channel, 'rate_pct' => $p->rate_pct === null ? null : (float) $p->rate_pct, 'per_delivery_amount' => $p->per_delivery_amount === null ? null : (float) $p->per_delivery_amount,
                'tiers' => json_decode($p->tiers, true) ?: [], 'alert_penalty_pct' => (float) $p->alert_penalty_pct, 'valid_from' => $p->valid_from, 'valid_to' => $p->valid_to,
                'status' => $p->status, 'usos' => (int) DB::table('commission_entries')->where('plan_id', $p->id)->count()])->all();
    }

    public static function guardarPlan(?string $id, array $d, User $u): array
    {
        $tipo = $d['plan_type'] ?? null;
        if (! in_array($tipo, ['SELLER_COLLECTED', 'DRIVER_DELIVERY'], true)) {
            RuleError::fail('RN-PER-10', 'Elige el tipo: comisión sobre lo cobrado o bono por entrega.');
        }
        $code = strtoupper(Base::obligatorio($d['code'] ?? '', 'RN-PER-10', 'Indica el código del plan.', 2, 30));
        $name = Base::obligatorio($d['name'] ?? '', 'RN-PER-10', 'Indica el nombre del plan.', 3, 160);
        $tasa = $d['rate_pct'] ?? null;
        $bono = $d['per_delivery_amount'] ?? null;
        if ($tipo === 'SELLER_COLLECTED' && (! is_numeric($tasa) || $tasa < 0 || $tasa > 100)) {
            RuleError::fail('RN-PER-10', 'Indica el porcentaje de comisión (0 a 100).');
        }
        if ($tipo === 'DRIVER_DELIVERY' && (! is_numeric($bono) || $bono < 0)) {
            RuleError::fail('RN-PER-13', 'Indica el monto del bono por entrega.');
        }
        $tramos = [];
        foreach ((array) ($d['tiers'] ?? []) as $t) {
            if (! is_numeric($t['from'] ?? null) || ! is_numeric($t['rate_pct'] ?? null) || $t['from'] < 0 || $t['rate_pct'] < 0 || $t['rate_pct'] > 100) {
                RuleError::fail('RN-PER-10', 'Cada tramo lleva desde cuánto cobrado (S/) y su porcentaje.');
            }
            $tramos[] = ['from' => (float) $t['from'], 'rate_pct' => (float) $t['rate_pct']];
        }
        usort($tramos, fn ($a, $b) => $a['from'] <=> $b['from']);
        if (empty($d['valid_from'])) {
            RuleError::fail('RN-PER-10', 'Indica desde cuándo rige.');
        }
        if (! empty($d['valid_to']) && $d['valid_to'] < $d['valid_from']) {
            RuleError::fail('RN-PER-10', 'La vigencia termina antes de empezar.');
        }
        if (DB::table('commission_plans')->whereRaw('upper(code) = ?', [$code])->when($id, fn ($w) => $w->where('id', '<>', $id))->exists()) {
            RuleError::fail('RN-PER-10', "Ya existe un plan con el código {$code}.");
        }
        $fila = ['code' => $code, 'name' => $name, 'plan_type' => $tipo, 'brand_id' => ($d['brand_id'] ?? null) ?: null, 'channel' => ($d['channel'] ?? null) ?: null,
            'rate_pct' => $tipo === 'SELLER_COLLECTED' ? (float) $tasa : null, 'per_delivery_amount' => $tipo === 'DRIVER_DELIVERY' ? Base::r($bono) : null,
            'tiers' => json_encode($tipo === 'SELLER_COLLECTED' ? $tramos : []), 'alert_penalty_pct' => min(50, max(0, (float) ($d['alert_penalty_pct'] ?? 10))),
            'valid_from' => $d['valid_from'], 'valid_to' => ($d['valid_to'] ?? null) ?: null, 'status' => ($d['status'] ?? 'ACTIVE') === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE'];
        if ($id) {
            $p = DB::table('commission_plans')->where('id', $id)->first() ?? abort(404, 'No se encontró el plan.');
            $usado = DB::table('commission_entries')->where('plan_id', $id)->exists();
            if ($usado && ((float) $p->rate_pct !== (float) $fila['rate_pct'] || (float) $p->per_delivery_amount !== (float) $fila['per_delivery_amount'] || $p->plan_type !== $tipo
                || json_decode($p->tiers, true) != $tramos || $p->valid_from !== $fila['valid_from'] || $p->brand_id !== $fila['brand_id'] || $p->channel !== $fila['channel'])) {
                RuleError::fail('RN-PER-12', 'El plan ya generó comisiones: no se cambian sus montos ni su alcance. Ciérralo (fecha «hasta») y crea uno nuevo.');
            }
            DB::table('commission_plans')->where('id', $id)->update($fila + ['updated_at' => now()]);
        } else {
            $id = DB::table('commission_plans')->insertGetId($fila + ['created_by' => $u->id]);
        }

        return collect(self::planes())->firstWhere('id', $id);
    }
}
