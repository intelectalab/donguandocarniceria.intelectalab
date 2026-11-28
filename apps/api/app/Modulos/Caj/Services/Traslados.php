<?php

namespace App\Modulos\Caj\Services;

use App\Models\User;
use App\Support\Events;
use App\Support\RuleError;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * CAJ-12 Traslados entre cuentas: depósitos del efectivo al banco, fondos para la caja chica o el mostrador,
 * con referencia. La caja del repartidor solo se mueve con su liquidación (CAJ-07) y los abonos con CAJ-08.
 */
final class Traslados
{
    public static function crear(array $d, User $u): object
    {
        return DB::transaction(function () use ($d, $u) {
            $desde = Cuentas::activa($d['from_account_id'] ?? null);
            $hacia = Cuentas::activa($d['to_account_id'] ?? null);
            if ($desde->id === $hacia->id) {
                RuleError::fail('RN-CAJ-01', 'El traslado va entre dos cuentas distintas.');
            }
            if ($desde->account_type === 'DRIVER_CASH' || $hacia->account_type === 'DRIVER_CASH') {
                RuleError::fail('RN-CAJ-10', 'La caja del repartidor se mueve con su liquidación (Liquidación del repartidor).');
            }
            $l = Base::locales($u);
            foreach ([$desde, $hacia] as $c) {
                if ($l && $c->establishment_id && ! in_array($c->establishment_id, $l, true)) {
                    RuleError::fail('RN-CAJ-01', "La cuenta {$c->name} es de un local fuera de tu alcance.");
                }
            }
            $monto = Base::r($d['amount'] ?? 0);
            if ($monto <= 0) {
                RuleError::fail('RN-CAJ-01', 'El monto del traslado debe ser mayor que cero.');
            }
            $ref = trim((string) ($d['reference'] ?? ''));
            if ($ref === '' || mb_strlen($ref) > 40) {
                RuleError::fail('RN-CAJ-02', 'Escribe la referencia del traslado (número de depósito u operación, hasta 40 caracteres).');
            }
            $motivo = Base::motivo($d['reason'] ?? null, 'RN-CAJ-01', 'Escribe para qué es el traslado (al menos 5 letras).');
            if (in_array($desde->account_type, ['CASH_REGISTER', 'PETTY_CASH'], true)) {
                DB::select('SELECT pg_advisory_xact_lock(hashtext(?))', ['caj:cuenta:'.$desde->id]);
                $saldo = Cuentas::saldo($desde->id);
                if ($monto > $saldo + Base::EPS) {
                    RuleError::fail('RN-CAJ-01', "En {$desde->name} hay ".Base::soles($saldo).' según el sistema: no se trasladan '.Base::soles($monto).'.');
                }
            }
            $fecha = Base::fecha($d['date'] ?? null);
            if ($fecha > Base::hoy()) {
                RuleError::fail('RN-CAJ-01', 'La fecha del traslado no puede ser futura.');
            }
            $cuando = $fecha === Base::hoy() ? now() : CarbonImmutable::parse($fecha.' 12:00', 'America/Lima');
            $id = DB::table('cash_transfers')->insertGetId([
                'from_account_id' => $desde->id, 'to_account_id' => $hacia->id, 'amount' => $monto, 'transferred_at' => $cuando,
                'reference' => $ref, 'reason' => $motivo, 'status' => 'CONFIRMED', 'created_by' => $u->id, 'created_at' => now(),
            ], 'id');
            Events::emit('caj.transfer.created', 'cash_transfers', $id, ['from' => $desde->code, 'to' => $hacia->code, 'amount' => $monto]);

            return DB::table('cash_transfers')->where('id', $id)->first();
        });
    }

    public static function consulta(User $u, array $f)
    {
        [$desde, $hasta] = [Base::fecha($f['desde'] ?? null, CarbonImmutable::parse(Base::hoy())->subDays(30)->toDateString()), Base::fecha($f['hasta'] ?? null)];
        $l = Base::locales($u);

        return DB::table('cash_transfers as t')->join('cash_accounts as a', 'a.id', '=', 't.from_account_id')->join('cash_accounts as b', 'b.id', '=', 't.to_account_id')
            ->leftJoin('users as us', 'us.id', '=', 't.created_by')->leftJoin('driver_settlements as s', 's.id', '=', 't.settlement_id')
            ->whereRaw("(t.transferred_at at time zone 'America/Lima')::date between ? and ?", [$desde, $hasta])
            ->when($f['cuenta'] ?? null, fn ($w, $v) => $w->where(fn ($x) => $x->where('t.from_account_id', $v)->orWhere('t.to_account_id', $v)))
            ->when($f['tipo'] ?? null, fn ($w, $v) => match ($v) {
                'LIQUIDACION' => $w->whereNotNull('t.settlement_id'),
                'ABONO' => $w->whereNotNull('t.batch_id'),
                'MANUAL' => $w->whereNull('t.settlement_id')->whereNull('t.batch_id'),
                default => $w,
            })
            ->when($l, fn ($w) => $w->where(fn ($x) => $x->whereNull('a.establishment_id')->orWhereIn('a.establishment_id', $l)
                ->orWhereNull('b.establishment_id')->orWhereIn('b.establishment_id', $l)))
            ->select(['t.id', 't.transferred_at', 't.amount', 't.reference', 't.reason', 't.status', 't.batch_id', 't.settlement_id', 'a.name as desde', 'a.code as desde_code',
                'b.name as hacia', 'b.code as hacia_code', 'us.name as registrado_por', 's.number as liquidacion',
                DB::raw("case when t.settlement_id is not null then 'LIQUIDACION' when t.batch_id is not null then 'ABONO' else 'MANUAL' end as tipo")]);
    }
}
