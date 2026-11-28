<?php

namespace App\Modulos\Caj\Services;

use App\Models\User;
use App\Support\Events;
use App\Support\RuleError;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * CAJ-01 Cuentas: cajas, bancos, billeteras, pasarela, adquirente y cajas de los repartidores, con su saldo.
 * Los datos de pago que ve el cliente (QR, enlace, número) salen de aquí y solo los cambia quien tiene
 * caj.account.manage (RN-CAJ-01).
 */
final class Cuentas
{
    /** Cuenta activa o falla con RN-CAJ-01. */
    public static function activa(?string $id, ?string $tipoMedio = null): object
    {
        $c = $id ? DB::table('cash_accounts')->where('id', $id)->first() : null;
        if (! $c || $c->status !== 'ACTIVE') {
            RuleError::fail('RN-CAJ-01', 'Elige una cuenta activa de la empresa.');
        }
        if ($tipoMedio !== null) {
            $tipos = Base::CUENTAS_DEL_MEDIO[$tipoMedio] ?? [];
            if (! in_array($c->account_type, $tipos, true)) {
                RuleError::fail('RN-CAJ-01', "La cuenta {$c->name} no recibe ese medio de pago.");
            }
        }

        return $c;
    }

    /**
     * Saldo de cada cuenta: saldo inicial + cobros vigentes + traslados recibidos − traslados enviados − comisiones
     * de los abonos cerrados − devoluciones de saldo a favor − gastos pagados y reposiciones de caja chica (GAS)
     * ± ingresos y retiros del mostrador (POS). La caja del repartidor muestra lo que tiene por liquidar.
     *
     * @return array<string, array{saldo: float, cobros: float, entradas: float, salidas: float, otros: float}>
     */
    public static function saldos(?array $ids = null): array
    {
        $cuentas = DB::table('cash_accounts')->when($ids !== null, fn ($q) => $q->whereIn('id', $ids))->get(['id', 'account_type', 'opening_balance', 'user_id']);
        if ($cuentas->isEmpty()) {
            return [];
        }
        $lista = $cuentas->pluck('id')->all();
        $suma = fn ($q, string $col, string $monto) => $q->whereIn($col, $lista)->groupBy($col)->selectRaw("{$col} as id, sum({$monto}) as m")->pluck('m', 'id');

        $cobros = $suma(DB::table('payments')->where('status', 'CONFIRMED'), 'cash_account_id', 'amount');
        $entran = $suma(DB::table('cash_transfers')->where('status', 'CONFIRMED'), 'to_account_id', 'amount');
        $salen = $suma(DB::table('cash_transfers')->where('status', 'CONFIRMED'), 'from_account_id', 'amount');
        $comisiones = $suma(DB::table('settlement_batches')->where('status', '<>', 'OPEN'), 'source_account_id', 'fee_amount + fee_igv');
        $devoluciones = $suma(DB::table('customer_balance_movements')->where('movement_type', 'REFUND'), 'refund_account_id', '-amount');
        $mostrador = DB::table('pos_cash_movements as m')->join('pos_shifts as s', 's.id', '=', 'm.shift_id')->join('pos_terminals as t', 't.id', '=', 's.terminal_id')
            ->whereIn('t.cash_account_id', $lista)->groupBy('t.cash_account_id')
            ->selectRaw("t.cash_account_id as id, sum(case when m.movement_type = 'CASH_IN' then m.amount else -m.amount end) as m")->pluck('m', 'id');
        $gastos = self::gastos($lista);

        // Caja del repartidor: cobros en efectivo aún sin liquidar menos los gastos pagados con ese efectivo.
        $drv = $cuentas->where('account_type', 'DRIVER_CASH');
        $porLiquidar = $drv->isEmpty() ? collect() : DB::table('payments')->where('status', 'CONFIRMED')->whereNull('driver_settlement_id')
            ->whereIn('cash_account_id', $drv->pluck('id'))->groupBy('cash_account_id')->selectRaw('cash_account_id as id, sum(amount) as m')->pluck('m', 'id');
        $gastosRuta = $drv->isEmpty() ? collect() : DB::table('driver_expenses')->where('status', 'ACTIVE')->where('paid_with', 'ROUTE_CASH')->whereNull('settlement_id')
            ->whereIn('driver_user_id', $drv->pluck('user_id')->filter())->groupBy('driver_user_id')->selectRaw('driver_user_id as id, sum(amount) as m')->pluck('m', 'id');

        $r = [];
        foreach ($cuentas as $c) {
            $v = fn ($col) => Base::r($col[$c->id] ?? 0);
            if ($c->account_type === 'DRIVER_CASH') {
                $pend = Base::r($v($porLiquidar) - Base::r($gastosRuta[$c->user_id] ?? 0));
                $r[$c->id] = ['saldo' => $pend, 'cobros' => $v($porLiquidar), 'entradas' => 0.0, 'salidas' => Base::r($gastosRuta[$c->user_id] ?? 0), 'otros' => 0.0];

                continue;
            }
            $entradas = $v($entran);
            $salidas = Base::r($v($salen) + $v($comisiones) + $v($devoluciones) + Base::r($gastos['salen'][$c->id] ?? 0));
            $otros = Base::r($v($mostrador) + Base::r($gastos['entran'][$c->id] ?? 0));
            $r[$c->id] = [
                'saldo' => Base::r((float) $c->opening_balance + $v($cobros) + $entradas - $salidas + $otros),
                'cobros' => $v($cobros), 'entradas' => $entradas, 'salidas' => $salidas, 'otros' => $otros,
            ];
        }

        return $r;
    }

    public static function saldo(string $id): float
    {
        return self::saldos([$id])[$id]['saldo'] ?? 0.0;
    }

    /** Gastos pagados y reposiciones de caja chica (tablas de GAS, solo lectura). */
    private static function gastos(array $lista): array
    {
        $salen = [];
        $entran = [];
        if (Schema::hasTable('expenses') && Schema::hasColumn('expenses', 'paid_from_account_id')) {
            $monto = Schema::hasColumn('expenses', 'paid_amount') ? 'coalesce(paid_amount, amount_pen)' : 'amount_pen';
            foreach (DB::table('expenses')->where('status', 'PAID')->whereIn('paid_from_account_id', $lista)->groupBy('paid_from_account_id')
                ->selectRaw("paid_from_account_id as id, sum({$monto}) as m")->get() as $g) {
                $salen[$g->id] = ($salen[$g->id] ?? 0) + (float) $g->m;
            }
            // Pagados de caja chica sin cuenta propia: salen de la cuenta del fondo de su rendición.
            if (Schema::hasColumn('expenses', 'pay_source') && Schema::hasColumn('expenses', 'petty_cash_report_id') && Schema::hasTable('petty_cash_funds')) {
                foreach (DB::table('expenses as x')->join('petty_cash_reports as r', 'r.id', '=', 'x.petty_cash_report_id')->join('petty_cash_funds as f', 'f.id', '=', 'r.fund_id')
                    ->where('x.status', 'PAID')->whereNull('x.paid_from_account_id')->where('x.pay_source', 'PETTY')->whereIn('f.cash_account_id', $lista)
                    ->groupBy('f.cash_account_id')->selectRaw('f.cash_account_id as id, sum('.str_replace(['paid_amount', 'amount_pen'], ['x.paid_amount', 'x.amount_pen'], $monto).') as m')->get() as $g) {
                    $salen[$g->id] = ($salen[$g->id] ?? 0) + (float) $g->m;
                }
            }
        }
        if (Schema::hasTable('petty_cash_reports')) {
            foreach (DB::table('petty_cash_reports as r')->join('petty_cash_funds as f', 'f.id', '=', 'r.fund_id')->where('r.status', 'REIMBURSED')
                ->get(['r.reimbursed_from', 'f.cash_account_id', 'r.replenishment_amount']) as $p) {
                if ($p->reimbursed_from && in_array($p->reimbursed_from, $lista, true)) {
                    $salen[$p->reimbursed_from] = ($salen[$p->reimbursed_from] ?? 0) + (float) $p->replenishment_amount;
                }
                if ($p->cash_account_id && in_array($p->cash_account_id, $lista, true)) {
                    $entran[$p->cash_account_id] = ($entran[$p->cash_account_id] ?? 0) + (float) $p->replenishment_amount;
                }
            }
        }

        return ['salen' => $salen, 'entran' => $entran];
    }

    /** Lista de CAJ-01 con saldo, local, marca, titular, comisión y días de abono. */
    public static function lista(User $u, array $f = []): Collection
    {
        $l = Base::locales($u);
        $filas = DB::table('cash_accounts as c')->leftJoin('establishments as e', 'e.id', '=', 'c.establishment_id')->leftJoin('brands as b', 'b.id', '=', 'c.brand_id')
            ->leftJoin('employees as h', 'h.id', '=', 'c.holder_employee_id')->leftJoin('users as us', 'us.id', '=', 'c.user_id')
            ->when($l, fn ($q) => $q->where(fn ($w) => $w->whereNull('c.establishment_id')->orWhereIn('c.establishment_id', $l)))
            ->when($f['tipo'] ?? null, fn ($q, $t) => $q->where('c.account_type', $t))
            ->when($f['estado'] ?? null, fn ($q, $s) => $q->where('c.status', $s))
            ->orderByRaw("array_position(array['CASH_REGISTER','PETTY_CASH','DRIVER_CASH','WALLET','CARD_ACQUIRER','GATEWAY','BANK']::varchar[], c.account_type::varchar)")
            ->orderBy('c.code')
            ->get(['c.*', 'e.name as local', 'b.name as marca', 'h.full_name as titular_trabajador', 'us.name as usuario']);
        $saldos = self::saldos($filas->pluck('id')->all());

        return $filas->map(function ($c) use ($saldos) {
            $s = $saldos[$c->id] ?? ['saldo' => 0.0];
            $c->saldo = $s['saldo'];
            $c->detalle_saldo = $s;
            $c->tipo = Base::TIPOS[$c->account_type] ?? $c->account_type;
            $c->tiene_qr = (bool) $c->qr_payload;
            $c->sobre_tope = $c->max_balance !== null && $s['saldo'] > (float) $c->max_balance + Base::EPS;
            $c->por_conciliar = in_array($c->account_type, ['WALLET', 'GATEWAY', 'CARD_ACQUIRER', 'BANK'], true)
                ? (int) DB::table('payments')->where('cash_account_id', $c->id)->where('status', 'CONFIRMED')->where('reconciliation_status', 'PENDING')->count() : 0;

            return $c;
        })->values();
    }

    /** Crea o edita una cuenta (caj.account.manage). La caja del repartidor la crea el reparto. */
    public static function guardar(?string $id, array $d, User $u): object
    {
        return DB::transaction(function () use ($id, $d, $u) {
            $antes = $id ? DB::table('cash_accounts')->where('id', $id)->lockForUpdate()->first() : null;
            if ($id && ! $antes) {
                abort(404, 'No se encontró la cuenta.');
            }
            $v = fn (string $k) => array_key_exists($k, $d) ? (is_string($d[$k]) ? (trim($d[$k]) === '' ? null : trim($d[$k])) : $d[$k]) : ($antes->{$k} ?? null);
            $code = strtoupper((string) $v('code'));
            $name = (string) $v('name');
            $tipo = (string) $v('account_type');
            if ($code === '' || $name === '' || ! preg_match('/^[A-Z0-9._-]{2,40}$/', $code)) {
                RuleError::fail('RN-CAJ-01', 'Escribe el código (letras, números o guiones, hasta 40) y el nombre de la cuenta.');
            }
            if (! isset(Base::TIPOS[$tipo])) {
                RuleError::fail('RN-CAJ-01', 'Elige el tipo de cuenta.');
            }
            if ($tipo === 'DRIVER_CASH' && (! $antes || $antes->account_type !== 'DRIVER_CASH')) {
                RuleError::fail('RN-CAJ-01', 'La caja del repartidor se crea sola cuando cobra su primera entrega.');
            }
            if ($antes && $antes->account_type !== $tipo && DB::table('payments')->where('cash_account_id', $antes->id)->exists()) {
                RuleError::fail('RN-CAJ-01', 'La cuenta ya tiene cobros: no cambies su tipo.');
            }
            if (DB::table('cash_accounts')->where('code', $code)->when($antes, fn ($q) => $q->where('id', '<>', $antes->id))->exists()) {
                RuleError::fail('RN-CAJ-01', "Ya existe una cuenta con el código {$code}.");
            }
            $local = $v('establishment_id');
            if ($local && ! DB::table('establishments')->where('id', $local)->exists()) {
                RuleError::fail('RN-CAJ-01', 'El local no existe.');
            }
            if (in_array($tipo, ['CASH_REGISTER', 'PETTY_CASH'], true) && ! $local) {
                RuleError::fail('RN-CAJ-01', 'Una caja de efectivo es de un local: elígelo.');
            }
            $marca = $v('brand_id');
            if ($marca && ! DB::table('brands')->where('id', $marca)->exists()) {
                RuleError::fail('RN-CAJ-01', 'La marca no existe.');
            }
            $comision = $v('fee_pct');
            if ($comision !== null && (! is_numeric($comision) || (float) $comision < 0 || (float) $comision > 100)) {
                RuleError::fail('RN-CAJ-01', 'La comisión va de 0 a 100 %.');
            }
            $fijo = $v('fee_fixed');
            $dias = $v('settlement_days');
            if (($fijo !== null && (! is_numeric($fijo) || (float) $fijo < 0)) || ($dias !== null && (! is_numeric($dias) || (int) $dias < 0 || (int) $dias > 90))) {
                RuleError::fail('RN-CAJ-01', 'La comisión fija y los días de abono no pueden ser negativos (días hasta 90).');
            }
            $enlace = $v('payment_link_base');
            if ($enlace && ! preg_match('#^https://[^\s]+$#i', (string) $enlace)) {
                RuleError::fail('RN-CAJ-01', 'El enlace de pago debe empezar con https://.');
            }
            $tope = $v('max_balance');
            $estado = $v('status') ?: 'ACTIVE';
            if (! in_array($estado, ['ACTIVE', 'INACTIVE'], true)) {
                RuleError::fail('RN-CAJ-01', 'Estado no válido.');
            }
            if ($antes && $estado === 'INACTIVE' && $antes->status === 'ACTIVE'
                && DB::table('pos_terminals')->where('status', 'ACTIVE')->where(fn ($w) => $w->where('cash_account_id', $antes->id)->orWhere('card_account_id', $antes->id))->exists()) {
                RuleError::fail('RN-CAJ-01', 'Una caja registradora activa usa esta cuenta: cámbiala en Cajas registradoras antes de desactivarla.');
            }
            $txt = fn ($k, $n) => $v($k) !== null ? mb_substr((string) $v($k), 0, $n) : null;
            $datos = [
                'code' => $code, 'name' => mb_substr($name, 0, 80), 'account_type' => $tipo, 'establishment_id' => $local, 'brand_id' => $marca,
                'currency' => 'PEN', 'bank_name' => $txt('bank_name', 40), 'account_number' => $txt('account_number', 40), 'cci' => $txt('cci', 80),
                'holder_name' => $txt('holder_name', 80), 'qr_payload' => $v('qr_payload') !== null ? mb_substr((string) $v('qr_payload'), 0, 2000) : null,
                'payment_link_base' => $txt('payment_link_base', 255), 'fee_pct' => $comision !== null ? round((float) $comision, 4) : null,
                'fee_fixed' => $fijo !== null ? round((float) $fijo, 2) : null, 'settlement_days' => $dias !== null ? (int) $dias : null,
                'opening_balance' => round((float) ($v('opening_balance') ?? 0), 2), 'max_balance' => $tope !== null && $tope !== '' ? round((float) $tope, 2) : null,
                'status' => $estado, 'updated_at' => now(),
            ];
            if ($antes) {
                if ($antes->account_type === 'DRIVER_CASH') {
                    // La caja del repartidor solo cambia nombre, tope y estado.
                    $datos = array_intersect_key($datos, array_flip(['name', 'max_balance', 'status', 'updated_at']));
                }
                DB::table('cash_accounts')->where('id', $antes->id)->update($datos);
                $cid = $antes->id;
            } else {
                $cid = DB::table('cash_accounts')->insertGetId($datos + ['created_at' => now()], 'id');
            }
            Events::emit($antes ? 'caj.account.updated' : 'caj.account.created', 'cash_accounts', $cid, ['code' => $code, 'by' => $u->id]);

            return DB::table('cash_accounts')->where('id', $cid)->first();
        });
    }

    /** Movimientos de una cuenta (cobros, traslados, comisiones) para su detalle. */
    public static function movimientos(string $id, string $desde, string $hasta): array
    {
        $cobros = DB::table('payments as p')->join('payment_methods as m', 'm.id', '=', 'p.payment_method_id')->leftJoin('customers as c', 'c.id', '=', 'p.customer_id')
            ->where('p.cash_account_id', $id)->whereRaw("(p.paid_at at time zone 'America/Lima')::date between ? and ?", [$desde, $hasta])
            ->orderByDesc('p.paid_at')->limit(300)
            ->get(['p.id', 'p.number', 'p.paid_at as at', 'p.amount', 'p.status', 'p.reference', 'm.name as medio', 'c.full_name as cliente', 'p.reconciliation_status']);
        $traslados = DB::table('cash_transfers as t')->join('cash_accounts as a', 'a.id', '=', 't.from_account_id')->join('cash_accounts as b', 'b.id', '=', 't.to_account_id')
            ->where(fn ($w) => $w->where('t.from_account_id', $id)->orWhere('t.to_account_id', $id))
            ->whereRaw("(t.transferred_at at time zone 'America/Lima')::date between ? and ?", [$desde, $hasta])
            ->orderByDesc('t.transferred_at')->limit(300)
            ->get(['t.id', 't.transferred_at as at', 't.amount', 't.reference', 't.reason', 'a.name as desde', 'b.name as hacia', 't.from_account_id', 't.batch_id', 't.settlement_id']);

        return [
            'cobros' => $cobros,
            'traslados' => $traslados->map(fn ($t) => (array) $t + ['sale' => $t->from_account_id === $id])->values(),
        ];
    }
}
