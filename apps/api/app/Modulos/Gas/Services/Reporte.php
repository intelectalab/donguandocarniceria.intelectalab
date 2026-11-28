<?php

namespace App\Modulos\Gas\Services;

use App\Models\User;
use App\Support\Access;
use Illuminate\Support\Facades\DB;

/**
 * GAS-11 Reporte de gastos y KPI-GAS-01 a 06. Cuenta los gastos aprobados o pagados (amount_pen); si el gasto está
 * repartido entre centros de costo, cada parte va a su centro, marca y canal (KPI-GAS-02).
 */
final class Reporte
{
    public const POR = ['categoria' => 'Categoría', 'grupo' => 'Grupo', 'centro' => 'Centro de costo', 'local' => 'Local', 'marca' => 'Marca', 'canal' => 'Canal', 'mes' => 'Mes'];

    /** Líneas del reporte: una por gasto, o una por parte del reparto. */
    private static function lineas(array $f, User $u)
    {
        $q = DB::table('expenses as e')
            ->leftJoin('expense_allocations as a', fn ($j) => $j->on('a.expense_id', '=', 'e.id')->where('e.allocated', true))
            ->leftJoin('expense_categories as c', 'c.id', '=', 'e.category_id')
            ->leftJoin('cost_centers as cc', 'cc.id', '=', DB::raw('coalesce(a.cost_center_id, e.cost_center_id)'))
            ->leftJoin('brands as b', 'b.id', '=', DB::raw('coalesce(a.brand_id, e.brand_id)'))
            ->leftJoin('establishments as l', 'l.id', '=', 'e.establishment_id')
            ->whereIn('e.status', ['APPROVED', 'PAID'])->whereBetween('e.issue_date', [$f['desde'], $f['hasta']])
            ->when($f['local'] ?? null, fn ($w, $v) => $w->where('e.establishment_id', $v))
            ->when($f['categoria'] ?? null, fn ($w, $v) => $w->where('e.category_id', $v))
            ->when($f['centro'] ?? null, fn ($w, $v) => $w->whereRaw('coalesce(a.cost_center_id, e.cost_center_id) = ?', [$v]))
            ->when($f['marca'] ?? null, fn ($w, $v) => $w->whereRaw('coalesce(a.brand_id, e.brand_id) = ?', [$v]));
        $q = Base::alcance($q, $u);

        return $q->selectRaw("e.id, e.issue_date, e.accounting_flag, coalesce(c.name, e.category_code, 'Sin categoría') AS categoria,
            coalesce(c.category_group, 'OTHER') AS grupo, coalesce(cc.name, 'Sin centro') AS centro, coalesce(l.name, '') AS local, coalesce(b.name, '') AS marca,
            coalesce(a.sales_channel, e.sales_channel) AS canal, to_char(e.issue_date, 'YYYY-MM') AS mes, coalesce(a.amount, e.amount_pen) AS monto,
            CASE WHEN a.id IS NULL THEN e.amount_pen ELSE 0 END AS monto_gasto, a.id IS NOT NULL AS repartido");
    }

    public static function datos(array $f, User $u): array
    {
        $por = isset(self::POR[$f['por'] ?? '']) ? $f['por'] : 'categoria';
        $lineas = self::lineas($f, $u)->get();
        $total = Base::r($lineas->sum('monto'));
        $clave = fn ($l) => match ($por) {
            'grupo' => Base::GRUPOS[$l->grupo] ?? $l->grupo,
            'canal' => $l->canal ? (Base::CANALES[$l->canal] ?? $l->canal) : 'Sin canal',
            default => $l->{$por},
        };
        $filas = $lineas->groupBy($clave)->map(fn ($g, $k) => [
            'clave' => (string) $k, 'total' => Base::r($g->sum('monto')), 'gastos' => $g->pluck('id')->unique()->count(),
            'sin_valido' => Base::r($g->where('accounting_flag', 'NO_VALID_RECEIPT')->sum('monto')),
            'pct' => $total > 0 ? round($g->sum('monto') / $total * 100, 1) : 0,
        ])->sortByDesc('total')->values();
        $sinValido = Base::r($lineas->where('accounting_flag', 'NO_VALID_RECEIPT')->sum('monto'));
        $porMes = $lineas->groupBy('mes')->map(fn ($g, $k) => ['mes' => $k, 'total' => Base::r($g->sum('monto'))])->sortBy('mes')->values();

        return [
            'por' => $por, 'desde' => $f['desde'], 'hasta' => $f['hasta'], 'filas' => $filas, 'por_mes' => $porMes,
            'kpi' => [
                'total' => $total, 'gastos' => $lineas->pluck('id')->unique()->count(),
                'sin_valido' => $sinValido, 'sin_valido_pct' => $total > 0 ? round($sinValido / $total * 100, 1) : 0,   // KPI-GAS-03
                'mediana_horas' => self::medianas($f, $u),   // KPI-GAS-04
                'pendientes' => Base::alcance(DB::table('expenses as e')->where('e.status', 'SUBMITTED'), $u)->count(),   // KPI-GAS-05
                'pendientes_monto' => Base::r(Base::alcance(DB::table('expenses as e')->where('e.status', 'SUBMITTED'), $u)->sum('e.amount_pen')),
                'caja_chica_dias' => self::diasCajaChica(),   // KPI-GAS-06
            ],
        ];
    }

    /** KPI-GAS-04: mediana de horas entre el envío y la aprobación, por nivel. */
    private static function medianas(array $f, User $u): array
    {
        $q = DB::table('expenses as e')->whereNotNull('e.submitted_at')->whereNotNull('e.approved_at')->whereNull('e.driver_expense_id')
            ->whereBetween('e.issue_date', [$f['desde'], $f['hasta']])->whereIn('e.status', ['APPROVED', 'PAID'])->whereNotNull('e.required_level');
        $filas = Base::alcance($q, $u)->groupBy('e.required_level')
            ->selectRaw('e.required_level AS nivel, percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (e.approved_at - e.submitted_at)) / 3600) AS horas, count(*) AS n')
            ->orderBy('nivel')->get();

        return $filas->map(fn ($r) => ['nivel' => (int) $r->nivel, 'nombre' => Base::NOMBRE_NIVEL[(int) $r->nivel] ?? '', 'horas' => round(max(0, (float) $r->horas), 1), 'gastos' => (int) $r->n])->all();
    }

    /** KPI-GAS-06: días desde el gasto más antiguo de una rendición abierta (el peor fondo). */
    private static function diasCajaChica(): ?int
    {
        $min = DB::table('expenses as e')->join('petty_cash_reports as r', 'r.id', '=', 'e.petty_cash_report_id')->where('r.status', 'OPEN')
            ->whereIn('e.status', ['SUBMITTED', 'APPROVED', 'PAID'])->min('e.issue_date');

        return $min ? (int) floor((strtotime(Base::hoy()) - strtotime($min)) / 86400) : null;
    }

    /** Detalle para exportar: una fila por gasto (o por parte del reparto). */
    public static function detalle(array $f, User $u)
    {
        return self::lineas($f, $u)->leftJoin('suppliers as s', 's.id', '=', 'e.supplier_id')
            ->addSelect(['e.number', 'e.doc_type', 'e.doc_series', 'e.doc_number', 'e.description', 'e.status', 'e.igv', 'e.net_pen', 'e.currency', 'e.total',
                DB::raw('coalesce(e.supplier_name, s.legal_name) AS proveedor')])
            ->orderBy('e.issue_date')->orderBy('e.number')->limit(20000)->get();
    }

    public static function puedeVer(User $u): bool
    {
        return Access::can($u, 'gas.expense.view_all') || Access::can($u, 'gas.accounting.review');
    }
}
