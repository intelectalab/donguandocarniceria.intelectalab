<?php

namespace App\Modulos\Del\Services;

use App\Models\User;
use App\Support\RuleError;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * DEL-09 Empresas de delivery y tarifas y DEL-10 Conciliación de terceros (RN-DEL-11): la factura se
 * compara contra sus envíos entregados o fallidos del período × tarifa vigente (por envío, zona, día o kg).
 */
final class Terceros
{
    public const BASES = ['PER_DELIVERY' => 'Por envío', 'PER_KG' => 'Por kg', 'PER_DAY' => 'Por día'];

    public const LINEAS = ['MATCHED' => 'coincide', 'AMOUNT_DIFF' => 'monto distinto', 'NOT_REGISTERED' => 'no registrado', 'NOT_BILLED' => 'no facturado'];

    public static function empresas(): Collection
    {
        return DB::table('suppliers')->where('supplier_type', 'DELIVERY_COMPANY')->orderBy('trade_name')
            ->get(['id', 'trade_name', 'legal_name', 'doc_number', 'status', 'phone', 'email']);
    }

    /** Tarifa vigente a la fecha: la de la zona o, si no hay, la general. */
    public static function tarifa(string $supId, ?string $zoneId, string $fecha): ?object
    {
        $rs = DB::table('carrier_rates')->where('supplier_id', $supId)->where('status', 'ACTIVE')->where('valid_from', '<=', $fecha)
            ->where(fn ($q) => $q->whereNull('valid_to')->orWhere('valid_to', '>=', $fecha))->get();

        return ($zoneId ? $rs->firstWhere('zone_id', $zoneId) : null) ?? $rs->firstWhere('zone_id', null);
    }

    /** La tarifa por entrega más baja de cualquier empresa para la zona (DEL-15). */
    public static function mejorTarifa(?string $zoneId, string $fecha, float $kgPromedio): ?array
    {
        $mejor = null;
        foreach (self::empresas()->where('status', 'ACTIVE') as $e) {
            $t = self::tarifa($e->id, $zoneId, $fecha);
            if (! $t || $t->rate_basis === 'PER_DAY') {
                continue;
            }
            $pe = $t->rate_basis === 'PER_KG' ? round((float) $t->amount * max($kgPromedio, 0), 2) : round((float) $t->amount, 2);
            if (! $mejor || $pe < $mejor['por_entrega']) {
                $mejor = ['empresa' => $e->trade_name ?: $e->legal_name, 'supplier_id' => $e->id, 'base' => $t->rate_basis, 'monto' => (float) $t->amount, 'por_entrega' => $pe];
            }
        }

        return $mejor;
    }

    public static function guardarTarifa(?string $id, array $d, User $u): object
    {
        return DB::transaction(function () use ($id, $d) {
            $sup = DB::table('suppliers')->where('id', $d['supplier_id'] ?? null)->first();
            if (! $sup || $sup->supplier_type !== 'DELIVERY_COMPANY') {
                RuleError::fail('RN-DEL-11', 'Elige una empresa de delivery.');
            }
            Base::exigirEn((string) ($d['rate_basis'] ?? ''), self::BASES, 'RN-DEL-11', 'Elige la base de la tarifa: por envío, por kg o por día.');
            if (! isset($d['amount']) || ! is_numeric($d['amount']) || (float) $d['amount'] < 0) {
                RuleError::fail('RN-DEL-11', 'La tarifa lleva un monto de cero o más.');
            }
            if (empty($d['valid_from'])) {
                RuleError::fail('RN-DEL-11', 'La tarifa lleva su fecha de inicio.');
            }
            if (! empty($d['valid_to']) && $d['valid_to'] < $d['valid_from']) {
                RuleError::fail('RN-DEL-11', 'La vigencia termina antes de empezar.');
            }
            $zona = $d['zone_id'] ?? null ?: null;
            $hasta = $d['valid_to'] ?? null ?: null;
            $cruce = DB::table('carrier_rates')->where('status', 'ACTIVE')->where('supplier_id', $sup->id)
                ->when($id, fn ($q) => $q->where('id', '<>', $id))
                ->where(fn ($q) => $zona ? $q->where('zone_id', $zona) : $q->whereNull('zone_id'))
                ->where('valid_from', '<=', $hasta ?? '9999-12-31')->where(fn ($q) => $q->whereNull('valid_to')->orWhere('valid_to', '>=', $d['valid_from']))
                ->first();
            if ($cruce) {
                RuleError::fail('RN-DEL-11', 'Se cruza con la tarifa vigente desde el '.Base::fecha($cruce->valid_from).': ponle fecha de fin antes de crear la nueva.');
            }
            $fila = ['supplier_id' => $sup->id, 'zone_id' => $zona, 'rate_basis' => $d['rate_basis'], 'amount' => round((float) $d['amount'], 2),
                'valid_from' => $d['valid_from'], 'valid_to' => $hasta, 'status' => 'ACTIVE', 'updated_at' => now()];
            if ($id) {
                DB::table('carrier_rates')->where('id', $id)->update($fila);
            } else {
                $id = DB::table('carrier_rates')->insertGetId($fila, 'id');
            }

            return DB::table('carrier_rates')->where('id', $id)->first();
        });
    }

    public static function anularTarifa(string $id, string $motivo): void
    {
        if (mb_strlen(trim($motivo)) < 5) {
            RuleError::fail('RN-DEL-11', 'Anular una tarifa exige el motivo.');
        }
        DB::table('carrier_rates')->where('id', $id)->update(['status' => 'VOIDED', 'void_reason' => mb_substr(trim($motivo), 0, 255), 'updated_at' => now()]);
    }

    /** Envíos de la empresa en el período: paradas entregadas o fallidas de sus rutas de tercero. */
    public static function envios(string $supId, string $desde, string $hasta): Collection
    {
        return DB::table('delivery_stops as s')->join('delivery_routes as r', 'r.id', '=', 's.route_id')->join('sales_orders as o', 'o.id', '=', 's.order_id')
            ->where('r.carrier_supplier_id', $supId)->where('r.mode', 'THIRD_PARTY')->whereBetween('r.route_date', [$desde, $hasta])
            ->whereIn('s.status', ['DELIVERED', 'FAILED'])->orderBy('r.route_date')->orderBy('s.seq')
            ->get(['s.id', 's.route_id', 's.zone_id', 's.kg', 's.status', 'r.route_date', 'r.code', 'o.number']);
    }

    /** Lo esperado por un envío según la tarifa vigente ese día. */
    public static function esperadoDe(string $supId, object $x, Collection $todos): float
    {
        $t = self::tarifa($supId, $x->zone_id, $x->route_date);
        if (! $t) {
            return 0.0;
        }

        return match ($t->rate_basis) {
            'PER_KG' => round((float) $t->amount * (float) $x->kg, 2),
            'PER_DAY' => round((float) $t->amount / max(1, $todos->where('route_date', $x->route_date)->count()), 4),
            default => round((float) $t->amount, 2),
        };
    }

    /**
     * RN-DEL-11: concilia la factura. Con líneas ([{ref, amount}], por número de pedido) marca coincide,
     * monto distinto, no registrado (facturado sin envío) y no facturado (envío sin cobrar).
     */
    public static function conciliar(array $d, User $u): object
    {
        return DB::transaction(function () use ($d, $u) {
            $sup = DB::table('suppliers')->where('id', $d['supplier_id'] ?? null)->first();
            if (! $sup || $sup->supplier_type !== 'DELIVERY_COMPANY') {
                RuleError::fail('RN-DEL-11', 'Elige la empresa de delivery de la factura.');
            }
            $numero = mb_strtoupper(trim((string) ($d['invoice_number'] ?? '')));
            if ($numero === '' || empty($d['period_from']) || empty($d['period_to']) || ! isset($d['amount']) || (float) $d['amount'] < 0) {
                RuleError::fail('RN-DEL-11', 'Completa el número, el período y el importe de la factura.');
            }
            if ($d['period_to'] < $d['period_from']) {
                RuleError::fail('RN-DEL-11', 'El período termina antes de empezar.');
            }
            $f = DB::table('carrier_invoices')->where('supplier_id', $sup->id)->where('invoice_number', $numero)->lockForUpdate()->first();
            if ($f && $f->status === 'RECONCILED') {
                RuleError::fail('RN-DEL-11', "La factura {$numero} ya está conciliada.");
            }
            $envios = self::envios($sup->id, $d['period_from'], $d['period_to']);
            $esperados = $envios->mapWithKeys(fn ($x) => [$x->id => self::esperadoDe($sup->id, $x, $envios)]);
            $esperado = round($esperados->sum(), 2);
            $monto = round((float) $d['amount'], 2);
            $dif = round($monto - $esperado, 2);
            $tol = Base::num('del_carrier_tolerance_pen', 2);
            $estado = abs($dif) <= $tol + Base::EPS ? 'RECONCILED' : 'OBSERVED';
            $cab = ['supplier_id' => $sup->id, 'invoice_number' => $numero, 'issue_date' => $d['issue_date'] ?? Base::hoy(), 'period_from' => $d['period_from'],
                'period_to' => $d['period_to'], 'amount' => $monto, 'expected_amount' => $esperado, 'difference' => $dif, 'status' => $estado,
                'reconciled_by' => $u->id, 'reconciled_at' => now(), 'shipments' => $envios->count(), 'updated_at' => now()];
            if ($f) {
                DB::table('carrier_invoices')->where('id', $f->id)->update($cab);
                $id = $f->id;
                DB::table('carrier_invoice_lines')->where('invoice_id', $id)->delete();
            } else {
                $id = DB::table('carrier_invoices')->insertGetId($cab, 'id');
            }
            $porRef = $envios->keyBy(fn ($x) => mb_strtoupper($x->number));
            $lineas = [];
            if (! empty($d['lines'])) {
                $vistos = [];
                foreach ($d['lines'] as $l) {
                    $ref = mb_strtoupper(trim((string) ($l['ref'] ?? '')));
                    if ($ref === '') {
                        continue;
                    }
                    $cobrado = round((float) ($l['amount'] ?? 0), 2);
                    $x = $porRef[$ref] ?? null;
                    if (! $x || isset($vistos[$x->id])) {
                        $lineas[] = ['stop_id' => null, 'external_ref' => mb_substr($ref, 0, 40), 'billed_amount' => $cobrado, 'expected_amount' => 0, 'match_status' => 'NOT_REGISTERED'];

                        continue;
                    }
                    $vistos[$x->id] = true;
                    $esp = round($esperados[$x->id], 2);
                    $lineas[] = ['stop_id' => $x->id, 'external_ref' => mb_substr($ref, 0, 40), 'billed_amount' => $cobrado, 'expected_amount' => $esp,
                        'match_status' => abs($cobrado - $esp) <= Base::EPS ? 'MATCHED' : 'AMOUNT_DIFF'];
                }
                foreach ($envios as $x) {
                    if (! isset($vistos[$x->id])) {
                        $lineas[] = ['stop_id' => $x->id, 'external_ref' => mb_substr($x->number, 0, 40), 'billed_amount' => 0, 'expected_amount' => round($esperados[$x->id], 2), 'match_status' => 'NOT_BILLED'];
                    }
                }
            } else {
                foreach ($envios as $x) {
                    $esp = round($esperados[$x->id], 2);
                    $lineas[] = ['stop_id' => $x->id, 'external_ref' => mb_substr($x->number, 0, 40), 'billed_amount' => $esp, 'expected_amount' => $esp, 'match_status' => 'MATCHED'];
                }
                if (abs($dif) > Base::EPS) {
                    $lineas[] = ['stop_id' => null, 'external_ref' => 'Diferencia sin detalle', 'billed_amount' => max(0, $dif), 'expected_amount' => max(0, -$dif),
                        'match_status' => $dif > 0 ? 'NOT_REGISTERED' : 'NOT_BILLED'];
                }
            }
            foreach ($lineas as $l) {
                DB::table('carrier_invoice_lines')->insert($l + ['invoice_id' => $id]);
            }

            return DB::table('carrier_invoices')->where('id', $id)->first();
        });
    }
}
