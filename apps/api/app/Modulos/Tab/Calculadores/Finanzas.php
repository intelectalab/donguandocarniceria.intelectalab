<?php

namespace App\Modulos\Tab\Calculadores;

use App\Modulos\Per\Services\CostoPersonal;
use App\Modulos\Prs\Services\Base as PrsBase;
use App\Modulos\Prs\Services\Ejecucion;
use App\Modulos\Prs\Services\Versiones;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Calculadores de finanzas y control fino: GAS, FAC, PER y PRS.
 * PER y PRS se leen con sus propios servicios (CostoPersonal y Ejecucion), así el tablero cuenta lo mismo que sus pantallas.
 */
final class Finanzas
{
    public static function todos(): array
    {
        return [
            // GAS · gastos aprobados o pagados por fecha de emisión; con reparto, cada parte a su marca (KPI-GAS-02)
            'KPI-GAS-01' => fn (Periodo $p) => Periodo::total((float) self::gastos($p)->sum('e.amount_pen')),
            'KPI-GAS-02' => fn (Periodo $p) => Periodo::total((float) self::gastosRepartidos($p)->sum(DB::raw('coalesce(a.amount, e.amount_pen)'))),
            'KPI-GAS-03' => function (Periodo $p) {
                $total = (float) self::gastos($p)->sum('e.amount_pen');

                return Periodo::pct((float) self::gastos($p)->where('e.accounting_flag', 'NO_VALID_RECEIPT')->sum('e.amount_pen'), $total, 1);
            },
            'KPI-GAS-04' => function (Periodo $p) {
                $h = self::gastos($p)->whereNotNull('e.submitted_at')->whereNotNull('e.approved_at')->whereNull('e.driver_expense_id')
                    ->selectRaw('percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (e.approved_at - e.submitted_at)) / 3600) AS h')->value('h');

                return Periodo::valor($h === null ? null : max(0, (float) $h), null, null, 1);
            },
            'KPI-GAS-05' => fn (Periodo $p) => Periodo::total($p->filtrar(DB::table('expenses as e'), 'e.brand_id', 'e.establishment_id')->where('e.status', 'SUBMITTED')
                ->where('e.submitted_at', '<', $p->fin())->count(), 0),
            'KPI-GAS-06' => function (Periodo $p) {
                $min = $p->filtrar(DB::table('expenses as e')->join('petty_cash_reports as r', 'r.id', '=', 'e.petty_cash_report_id'), 'e.brand_id', 'e.establishment_id')
                    ->where('r.status', 'OPEN')->whereIn('e.status', ['SUBMITTED', 'APPROVED', 'PAID'])->where('e.issue_date', '<=', $p->hasta)->min('e.issue_date');

                return Periodo::total($min ? (int) CarbonImmutable::parse($min)->diffInDays(CarbonImmutable::parse($p->hasta)) : 0, 0);
            },

            // FAC
            'KPI-FAC-01' => function (Periodo $p) {
                $q = fn () => self::comprobantes($p)->whereIn('d.sunat_status', ['ACCEPTED', 'REJECTED', 'OBSERVED']);

                return Periodo::pct($q()->where('d.sunat_status', 'REJECTED')->count(), $q()->count());
            },
            'KPI-FAC-02' => fn (Periodo $p) => Periodo::total($p->filtrar(DB::table('sales_documents as d'), 'd.brand_id', 'd.establishment_id')->where('d.sunat_status', 'PENDING')
                ->whereRaw("coalesce(d.issued_at, d.issue_date::timestamptz) < least(now(), ?::timestamptz) - interval '24 hours'", [$p->fin()])->count(), 0),
            'KPI-FAC-03' => function (Periodo $p) {
                $nc = (float) self::comprobantes($p)->where('d.doc_type', 'CREDIT_NOTE')->where('d.status', '<>', 'VOIDED')->sum('d.total');
                $ventas = (float) self::comprobantes($p)->whereIn('d.doc_type', ['INVOICE', 'RECEIPT'])->where('d.status', '<>', 'VOIDED')->sum('d.total');

                return Periodo::pct($nc, $ventas);
            },
            'KPI-FAC-04' => function (Periodo $p) {
                $m = self::comprobantes($p)->whereNotNull('d.accepted_at')->whereNotNull('d.issued_at')->whereColumn('d.accepted_at', '>=', 'd.issued_at')
                    ->selectRaw('percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (d.accepted_at - d.issued_at)) / 60) AS m')->value('m');

                return Periodo::valor($m === null ? null : (float) $m, null, null, 1);
            },
            'KPI-FAC-05' => function (Periodo $p) {
                $q = fn () => Ventas::porEntregaReal($p)->whereRaw("o.delivered_at < now() - interval '24 hours'");
                $sin = $q()->whereIn('o.requested_doc_type', ['RECEIPT', 'INVOICE'])
                    ->whereNotExists(fn ($x) => $x->from('sales_documents as d')->whereColumn('d.order_id', 'o.id')->where('d.status', '<>', 'VOIDED'))->count();

                return Periodo::pct($sin, $q()->count());
            },

            // PER · costo de personal y asistencia
            'KPI-PER-01' => function (Periodo $p) {
                $c = array_sum(array_column(array_filter(self::personal($p), fn ($f) => in_array($f['area'], CostoPersonal::AREAS_POR_PEDIDO, true)), 'amount'));

                return Periodo::razon($c, self::entregadosPer($p));
            },
            'KPI-PER-02' => fn (Periodo $p) => Periodo::total(array_sum(array_column(self::personal($p), 'amount'))),
            'KPI-PER-03' => fn (Periodo $p) => Periodo::total(array_sum(array_column(array_filter(self::personal($p), fn ($f) => $f['kind'] === 'COMMISSION'), 'amount'))),
            'KPI-PER-04' => fn (Periodo $p) => Periodo::total(array_sum(array_column(array_filter(self::personal($p), fn ($f) => $f['kind'] === 'BONUS'), 'amount'))),
            'KPI-PER-05' => function (Periodo $p) {
                $q = fn () => self::asistencia($p);

                return Periodo::pct($q()->whereIn('a.status', ['PRESENT', 'LATE'])->count(), $q()->whereIn('a.status', ['PRESENT', 'LATE', 'ABSENT', 'LEAVE'])->count(), 1);
            },
            'KPI-PER-06' => function (Periodo $p) {
                $q = fn () => self::asistencia($p)->whereNotNull('a.shift_assignment_id');

                return Periodo::razon((float) $q()->sum('a.late_minutes'), $q()->distinct()->count('a.employee_id'), 1);
            },
            'KPI-PER-07' => fn (Periodo $p) => Periodo::total(Schema::hasTable('shift_assignments')
                ? (float) $p->enFechas(DB::table('shift_assignments as s')->join('employees as e', 'e.id', '=', 's.employee_id'), 's.work_date')
                    ->when($p->local, fn ($q, $v) => $q->where('e.establishment_id', $v))->when($p->marca, fn ($q) => $q->whereRaw('false'))
                    ->sum('s.overtime_authorized_minutes') / 60 : 0.0, 1),
            'KPI-PER-08' => function (Periodo $p) {
                $com = array_sum(array_column(array_filter(self::personal($p), fn ($f) => $f['kind'] === 'COMMISSION'), 'amount'));
                $cobrado = (float) DB::query()->fromSub(Ventas::cobradoPor($p, 'o.seller_id'), 'x')->sum('x.total') / 1.18;

                return Periodo::pct($com, $cobrado);
            },
            'KPI-PER-09' => function (Periodo $p) {
                $n = Reparto::paradas($p)->where('s.status', 'DELIVERED')->count();

                return Periodo::razon($n, Reparto::rutas($p)->whereNotNull('r.driver_user_id')->distinct()->count('r.driver_user_id'), 1);
            },

            // PRS · con la versión aprobada del año
            'KPI-PRS-01' => fn (Periodo $p) => self::presupuesto($p, fn ($t) => Periodo::pct($t['gasto']['actual'], $t['gasto']['budget'], 1)),
            'KPI-PRS-02' => fn (Periodo $p) => self::presupuesto($p, fn ($t) => Periodo::pct($t['ingreso']['actual'], $t['ingreso']['budget'], 1)),
            'KPI-PRS-03' => fn (Periodo $p) => self::presupuesto($p, fn ($t) => Periodo::valor($t['gasto']['budget'] || $t['gasto']['actual'] ? $t['gasto']['actual'] - $t['gasto']['budget'] : null,
                $t['gasto']['actual'], $t['gasto']['budget'])),
            'KPI-PRS-04' => fn (Periodo $p) => self::presupuesto($p, fn ($t) => Periodo::pct($t['gasto']['forecast'], $t['gasto']['budget'], 1)),
            'KPI-PRS-05' => fn (Periodo $p) => self::presupuesto($p, fn ($t, $slots) => Periodo::total(count(array_filter($slots,
                fn ($s) => PrsBase::semaforoDe($s['budget'], $s['forecast'] ?: $s['actual'], $s['type']) === 'RED')), 0)),
        ];
    }

    private static function gastos(Periodo $p)
    {
        return $p->enFechas($p->filtrar(DB::table('expenses as e'), 'e.brand_id', 'e.establishment_id'), 'e.issue_date')->whereIn('e.status', ['APPROVED', 'PAID']);
    }

    private static function gastosRepartidos(Periodo $p)
    {
        $q = $p->enFechas(DB::table('expenses as e')->leftJoin('expense_allocations as a', fn ($j) => $j->on('a.expense_id', '=', 'e.id')->where('e.allocated', true)), 'e.issue_date')
            ->whereIn('e.status', ['APPROVED', 'PAID'])->when($p->local, fn ($w, $v) => $w->where('e.establishment_id', $v));

        return $p->marca ? $q->whereRaw('coalesce(a.brand_id, e.brand_id) = ?', [$p->marca]) : $q;
    }

    public static function comprobantes(Periodo $p)
    {
        return $p->enFechas($p->filtrar(DB::table('sales_documents as d'), 'd.brand_id', 'd.establishment_id'), 'd.issue_date');
    }

    /** Filas de costo de personal del mes (PER), con la marca y el local elegidos. */
    private static function personal(Periodo $p): array
    {
        return array_values(array_filter(CostoPersonal::filasDelMes($p->mes(), $p->hasta),
            fn ($f) => (! $p->local || $f['establishment_id'] === $p->local) && (! $p->marca || $f['brand_id'] === $p->marca)));
    }

    private static function entregadosPer(Periodo $p): int
    {
        return $p->enRango($p->pedidos()->whereIn('o.status', ['DELIVERED', 'CLOSED'])->whereNotNull('o.delivered_at'), 'o.delivered_at')->count();
    }

    private static function asistencia(Periodo $p)
    {
        return $p->enFechas(DB::table('attendance_days as a')->join('employees as e', 'e.id', '=', 'a.employee_id'), 'a.work_date')
            ->when($p->local, fn ($q, $v) => $q->where('e.establishment_id', $v))->when($p->marca, fn ($q) => $q->whereRaw('false'));
    }

    /** Real frente a presupuesto del mes con la versión aprobada de cada empresa (PRS-06). */
    private static function presupuesto(Periodo $p, callable $f): array
    {
        if (! Schema::hasTable('budgets')) {
            return Periodo::valor(null);
        }
        $slots = [];
        foreach (DB::table('companies')->pluck('id') as $empresa) {
            $v = Versiones::aprobadaDelAnio((int) substr($p->desde, 0, 4), $empresa);
            if (! $v) {
                continue;
            }
            foreach (Ejecucion::calcular($v->id, [$p->mes()], $p->hasta, $empresa)['slots'] as $s) {
                if ((! $p->marca || $s['brand_id'] === $p->marca) && (! $p->local || $s['establishment_id'] === $p->local)) {
                    $slots[] = $s;
                }
            }
        }
        if (! $slots) {
            return Periodo::valor(null);
        }

        return $f(Ejecucion::totales($slots), $slots);
    }
}
