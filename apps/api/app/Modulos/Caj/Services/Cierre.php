<?php

namespace App\Modulos\Caj\Services;

use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * CAJ-13 Cierre diario de caja: por cuenta y por medio, lo cobrado, revertido, trasladado y conciliado en el día,
 * con las diferencias del día (liquidaciones de repartidores, turnos del mostrador y abonos) y el saldo actual.
 */
final class Cierre
{
    public static function delDia(string $fecha, User $u, ?string $local = null): array
    {
        $l = Base::locales($u);
        $locales = $local ? [$local] : $l;
        $dia = "(%s at time zone 'America/Lima')::date = ?";
        $cobros = Base::alcance(DB::table('payments as p'), $u)->join('payment_methods as m', 'm.id', '=', 'p.payment_method_id')
            ->whereRaw(sprintf($dia, 'p.paid_at'), [$fecha])->when($local, fn ($w) => $w->where('p.establishment_id', $local))
            ->get(['p.id', 'p.cash_account_id', 'p.amount', 'p.status', 'p.fee_amount', 'p.fee_igv', 'm.code as medio', 'm.name as medio_nombre', 'm.kind']);
        $traslados = DB::table('cash_transfers')->whereRaw(sprintf($dia, 'transferred_at'), [$fecha])->get(['from_account_id', 'to_account_id', 'amount']);
        $conciliado = DB::table('settlement_batch_items as i')->join('settlement_batches as b', 'b.id', '=', 'i.batch_id')->join('payments as p', 'p.id', '=', 'i.payment_id')
            ->where('b.status', '<>', 'OPEN')->whereRaw(sprintf($dia, 'b.closed_at'), [$fecha])
            ->groupBy('b.source_account_id')->selectRaw('b.source_account_id as id, sum(p.amount) as m')->pluck('m', 'id');

        $cuentas = DB::table('cash_accounts')->when($locales, fn ($q) => $q->where(fn ($w) => $w->whereNull('establishment_id')->orWhereIn('establishment_id', $locales)))
            ->orderByRaw("array_position(array['CASH_REGISTER','PETTY_CASH','DRIVER_CASH','WALLET','CARD_ACQUIRER','GATEWAY','BANK']::varchar[], account_type::varchar)")
            ->orderBy('code')->get(['id', 'code', 'name', 'account_type', 'status']);
        $saldos = Cuentas::saldos($cuentas->pluck('id')->all());
        $filas = [];
        foreach ($cuentas as $c) {
            $vig = $cobros->where('cash_account_id', $c->id)->where('status', 'CONFIRMED');
            $fila = [
                'id' => $c->id, 'code' => $c->code, 'name' => $c->name, 'tipo' => Base::TIPOS[$c->account_type] ?? $c->account_type, 'account_type' => $c->account_type,
                'cobrado' => Base::r($vig->sum('amount')), 'n' => $vig->count(),
                'revertido' => Base::r($cobros->where('cash_account_id', $c->id)->where('status', 'REVERSED')->sum('amount')),
                'entra' => Base::r($traslados->where('to_account_id', $c->id)->sum('amount')), 'sale' => Base::r($traslados->where('from_account_id', $c->id)->sum('amount')),
                'conciliado' => Base::r($conciliado[$c->id] ?? 0), 'saldo' => $saldos[$c->id]['saldo'] ?? 0.0,
            ];
            if ($c->status === 'ACTIVE' || $fila['cobrado'] || $fila['entra'] || $fila['sale']) {
                $filas[] = $fila;
            }
        }
        $porMedio = $cobros->where('status', 'CONFIRMED')->groupBy('medio')->map(fn ($g) => [
            'medio' => $g->first()->medio, 'nombre' => $g->first()->medio_nombre, 'n' => $g->count(), 'monto' => Base::r($g->sum('amount')),
            'comision' => Base::r($g->sum(fn ($p) => (float) $p->fee_amount + (float) $p->fee_igv)),
        ])->values();

        // Diferencias del día.
        $liq = DB::table('driver_settlements as s')->leftJoin('delivery_routes as r', 'r.id', '=', 's.route_ref')->leftJoin('users as d', 'd.id', '=', 's.driver_user_id')
            ->where('s.settlement_date', $fecha)->where('s.difference', '<>', 0)->when($locales, fn ($w) => $w->whereIn('r.establishment_id', $locales))
            ->get(['s.id', 's.number', 's.difference as monto', 's.difference_reason as motivo', 's.status', 'r.code as ruta', 'd.name as quien'])
            ->map(fn ($x) => (array) $x + ['tipo' => 'Liquidación del repartidor', 'pantalla' => 'CAJ-07']);
        $turnos = DB::table('pos_shifts as s')->whereRaw(sprintf($dia, 's.closed_at'), [$fecha])->whereNotNull('s.difference')->where('s.difference', '<>', 0)
            ->when($locales, fn ($w) => $w->whereIn('s.establishment_id', $locales))
            ->get(['s.id', 's.number', 's.difference as monto', 's.difference_reason as motivo', 's.status', 's.cashier_name as quien'])
            ->map(fn ($x) => (array) $x + ['tipo' => 'Cierre de turno del mostrador', 'pantalla' => 'POS-07']);
        $abonos = DB::table('settlement_batches as b')->join('cash_accounts as o', 'o.id', '=', 'b.source_account_id')->where('b.status', 'WITH_DIFFERENCE')
            ->whereRaw(sprintf($dia, 'b.closed_at'), [$fecha])
            ->get(['b.id', 'b.reference as number', 'b.difference_reason as motivo', 'b.status', 'o.name as quien',
                DB::raw('(select coalesce(sum(i.gross_amount), 0) from settlement_batch_items i where i.batch_id = b.id) - b.gross_amount as monto')])
            ->map(fn ($x) => (array) $x + ['tipo' => 'Abono con diferencia', 'pantalla' => 'CAJ-08']);
        $dif = collect([...$liq, ...$turnos, ...$abonos])->map(fn ($x) => $x + ['monto' => Base::r($x['monto'])])->values();

        return [
            'fecha' => $fecha, 'cuentas' => $filas, 'por_medio' => $porMedio,
            'totales' => [
                'cobrado' => Base::r(array_sum(array_column($filas, 'cobrado'))), 'revertido' => Base::r(array_sum(array_column($filas, 'revertido'))),
                'trasladado' => Base::r($traslados->sum('amount')), 'conciliado' => Base::r(array_sum(array_column($filas, 'conciliado'))),
                'diferencias' => Base::r($dif->sum('monto')), 'n_diferencias' => $dif->count(),
            ],
            'diferencias' => $dif,
        ];
    }
}
