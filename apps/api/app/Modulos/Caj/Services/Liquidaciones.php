<?php

namespace App\Modulos\Caj\Services;

use App\Models\User;
use App\Support\Events;
use App\Support\RuleError;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * CAJ-06 Caja del repartidor y CAJ-07 Liquidación del repartidor. CAJ es el dueño de driver_settlements: la
 * pantalla de DEL (DEL-06) llama a este mismo servicio.
 *
 * RN-CAJ-10: el efectivo entregado se compara con los cobros en efectivo de la ruta menos los gastos pagados con
 * ese efectivo; si la diferencia pasa caj_driver_diff_tolerance exige motivo, y el efectivo pasa con un traslado
 * a la caja que recibe. RN-CAJ-11: el repartidor no recibe su propia liquidación. Una liquidación con diferencia
 * la aprueba otra persona; con ella la ruta queda liquidada.
 */
final class Liquidaciones
{
    public const ESTADOS = ['SETTLED' => 'liquidada', 'WITH_DIFFERENCE' => 'con diferencia', 'APPROVED' => 'aprobada'];

    /** Lo que el repartidor debe entregar: cobros en efectivo menos gastos pagados del efectivo de la ruta. */
    public static function esperado(string $routeId): array
    {
        $pagos = DB::table('delivery_events as e')->join('payments as p', 'p.id', '=', 'e.payment_id')->join('payment_methods as m', 'm.id', '=', 'p.payment_method_id')
            ->leftJoin('delivery_stops as s', 's.id', '=', 'e.stop_id')
            ->where('e.route_id', $routeId)->where('e.event_type', 'COD_COLLECTED')->where('p.status', 'CONFIRMED')
            ->get(['p.id', 'p.number', 'p.amount', 'p.reference', 'm.code as medio', 'm.name as medio_nombre', 's.seq']);
        $efectivo = Base::r($pagos->where('medio', 'CASH')->sum('amount'));
        $digital = Base::r($pagos->where('medio', '<>', 'CASH')->sum('amount'));
        $gastos = DB::table('driver_expenses')->where('route_id', $routeId)->where('status', 'ACTIVE')->orderBy('created_at')->get();
        $deRuta = Base::r($gastos->where('paid_with', 'ROUTE_CASH')->sum('amount'));

        return [
            'cobrado_efectivo' => $efectivo, 'gastos_ruta' => $deRuta, 'efectivo' => Base::r($efectivo - $deRuta), 'digital' => $digital,
            'por_reembolsar' => Base::r($gastos->where('paid_with', 'OWN')->sum('amount')),
            'cobros' => $pagos->map(fn ($p) => (array) $p)->values()->all(),
            'gastos' => $gastos->map(fn ($g) => ['id' => $g->id, 'number' => $g->number, 'category' => $g->category, 'amount' => (float) $g->amount, 'paid_with' => $g->paid_with, 'note' => $g->note])->values()->all(),
        ];
    }

    public static function deRuta(string $routeId): ?object
    {
        return DB::table('driver_settlements')->where('route_ref', $routeId)->orderByDesc('created_at')->first();
    }

    public static function tolerancia(?string $local = null): float
    {
        return max(0.0, Base::num('caj_driver_diff_tolerance', 0, $local ? ['site' => $local] : []));
    }

    /** Cajas que reciben el efectivo de un local: la del mostrador primero (D-CAJ-03), luego la caja chica. */
    public static function receptoras(?string $local): Collection
    {
        return DB::table('cash_accounts')->where('status', 'ACTIVE')->whereIn('account_type', ['CASH_REGISTER', 'PETTY_CASH'])
            ->when($local, fn ($q) => $q->where(fn ($w) => $w->where('establishment_id', $local)->orWhereNull('establishment_id')))
            ->orderByRaw("account_type = 'CASH_REGISTER' desc")->orderBy('code')->get(['id', 'code', 'name', 'account_type', 'establishment_id']);
    }

    private static function ruta(string $routeId, User $u): object
    {
        $r = DB::table('delivery_routes')->where('id', $routeId)->lockForUpdate()->first();
        $l = Base::locales($u);
        if (! $r || ($l && ! in_array($r->establishment_id, $l, true))) {
            abort(404, 'No se encontró la ruta.');
        }

        return $r;
    }

    /**
     * Registra la liquidación de una ruta que volvió. $cuentaRecibe: caja que recibe el efectivo (por defecto la
     * del mostrador del local de la ruta).
     */
    public static function registrar(string $routeId, float $contado, ?string $motivo, User $u, ?string $cuentaRecibe = null): object
    {
        return DB::transaction(function () use ($routeId, $contado, $motivo, $u, $cuentaRecibe) {
            $r = self::ruta($routeId, $u);
            if ($r->mode === 'THIRD_PARTY') {
                RuleError::fail('RN-DEL-10', 'Las rutas de terceros no se liquidan con un repartidor.');
            }
            if ($r->status !== 'RETURNED') {
                RuleError::fail('RN-DEL-10', 'Se liquida una ruta que ya volvió al local (está '.(\App\Modulos\Del\Services\Base::RUTA[$r->status] ?? $r->status).').');
            }
            if ($prev = self::deRuta($r->id)) {
                RuleError::fail('RN-DEL-10', "La ruta ya tiene la liquidación {$prev->number} (".(self::ESTADOS[$prev->status] ?? $prev->status).').');
            }
            if ($r->driver_user_id === $u->id) {
                RuleError::fail('RN-CAJ-11', 'El repartidor no recibe su propia liquidación: entrega el efectivo a la caja o a la coordinación.');
            }
            $contado = Base::r($contado);
            if ($contado < 0) {
                RuleError::fail('RN-CAJ-10', 'El efectivo entregado no puede ser negativo.');
            }
            $e = self::esperado($r->id);
            $dif = Base::r($contado - $e['efectivo']);
            $tol = self::tolerancia($r->establishment_id);
            $motivo = trim((string) $motivo);
            $fuera = abs($dif) > $tol + Base::EPS;
            if ($fuera && mb_strlen($motivo) < 5) {
                RuleError::fail('RN-CAJ-10', 'Hay una diferencia de '.Base::soles($dif).': escribe el motivo.');
            }
            $empleado = $r->driver_employee_id ?: DB::table('users')->where('id', $r->driver_user_id)->value('employee_id');
            if (! $empleado) {
                RuleError::fail('RN-DEL-10', 'El repartidor no tiene ficha de trabajador: regístrala en Maestros antes de liquidar.');
            }
            if ($cuentaRecibe) {
                $recibe = Cuentas::activa($cuentaRecibe);
                if (! in_array($recibe->account_type, ['CASH_REGISTER', 'PETTY_CASH'], true)) {
                    RuleError::fail('RN-CAJ-10', 'El efectivo se recibe en una caja de efectivo (mostrador o caja chica).');
                }
                if ($recibe->establishment_id && $recibe->establishment_id !== $r->establishment_id) {
                    RuleError::fail('RN-CAJ-10', "La caja {$recibe->name} es de otro local.");
                }
                $recibe = $recibe->id;
            } else {
                $recibe = self::receptoras($r->establishment_id)->first()?->id ?? self::receptoras(null)->first()?->id;
            }
            if (! $recibe) {
                RuleError::fail('RN-DEL-10', 'El local no tiene una caja activa que reciba el efectivo.');
            }
            $cajaRepartidor = \App\Modulos\Del\Services\App::cuentaRepartidor($r);
            $estado = $fuera ? 'WITH_DIFFERENCE' : 'SETTLED';
            $ids = array_column($e['cobros'], 'id');
            $numero = Base::numero('driver_settlements', 'LQR-', 5);
            $id = DB::table('driver_settlements')->insertGetId([
                'number' => $numero, 'driver_employee_id' => $empleado, 'driver_cash_account_id' => $cajaRepartidor,
                'receiving_account_id' => $recibe, 'settlement_date' => $r->route_date, 'route_ref' => $r->id, 'expected_cash' => $e['efectivo'],
                'expected_digital' => $e['digital'], 'delivered_cash' => $contado, 'difference' => $dif,
                'difference_reason' => $motivo !== '' ? mb_substr($motivo, 0, 255) : null, 'status' => $estado, 'received_by' => $u->id,
                'settled_at' => now(), 'settled_by' => $u->id, 'driver_user_id' => $r->driver_user_id, 'payment_ids' => json_encode($ids),
            ], 'id');
            if ($ids) {
                DB::table('payments')->whereIn('id', $ids)->update(['driver_settlement_id' => $id, 'updated_at' => now()]);
            }
            DB::table('driver_expenses')->where('route_id', $r->id)->where('status', 'ACTIVE')->update(['settlement_id' => $id, 'updated_at' => now()]);
            // El efectivo entregado pasa de la caja del repartidor a la caja que recibe.
            if ($contado > Base::EPS) {
                DB::table('cash_transfers')->insert([
                    'from_account_id' => $cajaRepartidor, 'to_account_id' => $recibe, 'amount' => $contado, 'transferred_at' => now(),
                    'reference' => $numero, 'reason' => mb_substr("Liquidación de la ruta {$r->code}", 0, 255), 'status' => 'CONFIRMED',
                    'settlement_id' => $id, 'created_by' => $u->id, 'created_at' => now(),
                ]);
            }
            if ($estado === 'SETTLED') {
                DB::table('delivery_routes')->where('id', $r->id)->update(['status' => 'SETTLED', 'updated_at' => now()]);
            } else {
                Base::avisar(['role' => 'GERENTE'], "Liquidación con diferencia · {$r->code}", 'Diferencia de '.Base::soles($dif).": {$motivo}", 'CAJ-07', $id);
            }
            Events::emit('driver.settled', 'driver_settlements', $id, ['route_id' => $r->id, 'status' => $estado, 'difference' => $dif]);

            return DB::table('driver_settlements')->where('id', $id)->first();
        });
    }

    /** Aprueba una liquidación con diferencia: no la aprueba quien la registró ni el repartidor. */
    public static function aprobar(string $id, ?string $nota, User $u): object
    {
        return DB::transaction(function () use ($id, $u) {
            $st = DB::table('driver_settlements')->where('id', $id)->lockForUpdate()->first();
            if (! $st) {
                abort(404, 'No se encontró la liquidación.');
            }
            if ($st->route_ref) {
                self::ruta($st->route_ref, $u);
            }
            if ($st->status !== 'WITH_DIFFERENCE') {
                RuleError::fail('RN-CAJ-10', 'Solo se aprueba una liquidación con diferencia.');
            }
            if ($st->driver_user_id === $u->id) {
                RuleError::fail('RN-CAJ-11', 'El repartidor no aprueba su propia liquidación.');
            }
            if ($st->settled_by === $u->id || $st->received_by === $u->id) {
                RuleError::fail('RN-CAJ-10', 'Quien registró la liquidación no la aprueba: pide la aprobación a otra persona.');
            }
            DB::table('driver_settlements')->where('id', $id)->update(['status' => 'APPROVED', 'approved_by' => $u->id, 'approved_at' => now(), 'updated_at' => now()]);
            if ($st->route_ref) {
                DB::table('delivery_routes')->where('id', $st->route_ref)->where('status', 'RETURNED')->update(['status' => 'SETTLED', 'updated_at' => now()]);
            }
            Events::emit('driver.settled', 'driver_settlements', $id, ['route_id' => $st->route_ref, 'status' => 'APPROVED']);

            return DB::table('driver_settlements')->where('id', $id)->first();
        });
    }

    /** CAJ-07: rutas que volvieron y esperan liquidación, y las liquidaciones del periodo. */
    public static function lista(User $u, string $desde, string $hasta, ?string $estado = null): array
    {
        $l = Base::locales($u);
        $porLiquidar = DB::table('delivery_routes as r')->leftJoin('users as d', 'd.id', '=', 'r.driver_user_id')->leftJoin('establishments as e', 'e.id', '=', 'r.establishment_id')
            ->when($l, fn ($w) => $w->whereIn('r.establishment_id', $l))
            ->where('r.status', 'RETURNED')->where('r.mode', '<>', 'THIRD_PARTY')
            ->whereNotExists(fn ($x) => $x->from('driver_settlements as s')->whereColumn('s.route_ref', 'r.id'))
            ->orderBy('r.route_date')->get(['r.id', 'r.code', 'r.route_date', 'r.returned_at', 'r.establishment_id', 'r.driver_user_id', 'd.name as repartidor', 'e.name as local'])
            ->map(fn ($r) => (array) $r + ['esperado' => self::esperado($r->id)]);
        $hechas = DB::table('driver_settlements as s')->leftJoin('delivery_routes as r', 'r.id', '=', 's.route_ref')->leftJoin('users as d', 'd.id', '=', 's.driver_user_id')
            ->leftJoin('users as rc', 'rc.id', '=', 's.received_by')->leftJoin('users as ap', 'ap.id', '=', 's.approved_by')
            ->leftJoin('cash_accounts as c', 'c.id', '=', 's.receiving_account_id')->leftJoin('employees as em', 'em.id', '=', 's.driver_employee_id')
            ->where(fn ($w) => $w->whereBetween('s.settlement_date', [$desde, $hasta])->orWhere('s.status', 'WITH_DIFFERENCE'))->when($l, fn ($w) => $w->whereIn('r.establishment_id', $l))
            ->when($estado, fn ($w, $e) => $w->where('s.status', $e))
            ->orderByRaw("s.status = 'WITH_DIFFERENCE' desc")->orderByDesc('s.settled_at')->limit(300)
            ->get(['s.id', 's.number', 's.settlement_date', 's.expected_cash', 's.expected_digital', 's.delivered_cash', 's.difference', 's.difference_reason', 's.status',
                's.settled_at', 's.approved_at', 's.driver_user_id', 's.settled_by', 'r.code as ruta', DB::raw('coalesce(d.name, em.full_name) as repartidor'),
                'rc.name as recibido_por', 'ap.name as aprobado_por', 'c.name as caja']);

        return ['por_liquidar' => $porLiquidar, 'liquidaciones' => $hechas, 'estados' => self::ESTADOS, 'tolerancia' => self::tolerancia(),
            'cajas' => self::receptoras(null)];
    }

    /**
     * CAJ-06: por repartidor, lo cobrado contra entrega en el día (efectivo y digital), lo entregado y lo pendiente
     * de cobrar, con el estado de su liquidación.
     */
    public static function cajaDelDia(string $fecha, User $u, ?string $local = null): array
    {
        $l = Base::locales($u);
        $rutas = DB::table('delivery_routes as r')->leftJoin('users as d', 'd.id', '=', 'r.driver_user_id')
            ->where('r.route_date', $fecha)->where('r.mode', '<>', 'THIRD_PARTY')->where('r.status', '<>', 'CANCELLED')
            ->when($l, fn ($w) => $w->whereIn('r.establishment_id', $l))->when($local, fn ($w) => $w->where('r.establishment_id', $local))
            ->orderBy('d.name')->orderBy('r.code')->get(['r.id', 'r.code', 'r.status', 'r.driver_user_id', 'd.name as repartidor']);
        if ($rutas->isEmpty()) {
            return ['fecha' => $fecha, 'repartidores' => [], 'totales' => ['efectivo' => 0, 'digital' => 0, 'pendiente' => 0, 'entregas' => 0, 'pendientes' => 0]];
        }
        $paradas = DB::table('delivery_stops as s')->join('sales_orders as o', 'o.id', '=', 's.order_id')->leftJoin('customers as c', 'c.id', '=', 'o.customer_id')
            ->whereIn('s.route_id', $rutas->pluck('id'))->orderBy('s.seq')
            ->get(['s.id', 's.route_id', 's.seq', 's.status', 's.cod_amount', 's.collected_amount', 'o.number as pedido', 'c.full_name as cliente']);
        $cobros = DB::table('delivery_events as e')->join('payments as p', 'p.id', '=', 'e.payment_id')->join('payment_methods as m', 'm.id', '=', 'p.payment_method_id')
            ->whereIn('e.route_id', $rutas->pluck('id'))->where('e.event_type', 'COD_COLLECTED')->where('p.status', 'CONFIRMED')
            ->get(['e.route_id', 'e.stop_id', 'p.id', 'p.number', 'p.amount', 'p.reference', 'm.code as medio', 'm.name as medio_nombre', 'p.paid_at']);
        $liq = DB::table('driver_settlements')->whereIn('route_ref', $rutas->pluck('id'))->get(['route_ref', 'number', 'status', 'delivered_cash', 'difference'])->keyBy('route_ref');

        $porRepartidor = [];
        foreach ($rutas as $r) {
            $k = $r->driver_user_id ?? 'sin';
            $ps = $paradas->where('route_id', $r->id);
            $cs = $cobros->where('route_id', $r->id);
            $pend = $ps->filter(fn ($s) => in_array($s->status, ['PENDING', 'ARRIVED'], true) && (float) $s->cod_amount - (float) $s->collected_amount > Base::EPS);
            $fila = [
                'id' => $r->id, 'code' => $r->code, 'status' => $r->status, 'ruta' => \App\Modulos\Del\Services\Base::RUTA[$r->status] ?? $r->status,
                'efectivo' => Base::r($cs->where('medio', 'CASH')->sum('amount')), 'digital' => Base::r($cs->where('medio', '<>', 'CASH')->sum('amount')),
                'entregas' => $ps->where('status', 'DELIVERED')->count(), 'no_entregadas' => $ps->where('status', 'FAILED')->count(),
                'pendiente' => Base::r($pend->sum(fn ($s) => (float) $s->cod_amount - (float) $s->collected_amount)), 'pendientes' => $pend->count(),
                'liquidacion' => $liq[$r->id] ?? null,
                'cobros' => $cs->values()->map(function ($c) use ($ps) {
                    $s = $ps->firstWhere('id', $c->stop_id);

                    return (array) $c + ['seq' => $s?->seq, 'pedido' => $s?->pedido, 'cliente' => $s?->cliente];
                })->all(),
                'por_cobrar' => $pend->values()->map(fn ($s) => ['seq' => $s->seq, 'pedido' => $s->pedido, 'cliente' => $s->cliente,
                    'monto' => Base::r((float) $s->cod_amount - (float) $s->collected_amount)])->all(),
            ];
            $porRepartidor[$k] ??= ['driver_user_id' => $r->driver_user_id, 'repartidor' => $r->repartidor ?? 'Sin repartidor', 'rutas' => [], 'efectivo' => 0.0, 'digital' => 0.0, 'pendiente' => 0.0];
            $porRepartidor[$k]['rutas'][] = $fila;
            foreach (['efectivo', 'digital', 'pendiente'] as $c) {
                $porRepartidor[$k][$c] = Base::r($porRepartidor[$k][$c] + $fila[$c]);
            }
        }
        $lista = array_values($porRepartidor);

        return ['fecha' => $fecha, 'repartidores' => $lista, 'totales' => [
            'efectivo' => Base::r(array_sum(array_column($lista, 'efectivo'))), 'digital' => Base::r(array_sum(array_column($lista, 'digital'))),
            'pendiente' => Base::r(array_sum(array_column($lista, 'pendiente'))),
            'entregas' => $paradas->where('status', 'DELIVERED')->count(),
            'pendientes' => $paradas->filter(fn ($s) => in_array($s->status, ['PENDING', 'ARRIVED'], true) && (float) $s->cod_amount - (float) $s->collected_amount > Base::EPS)->count(),
        ]];
    }
}
