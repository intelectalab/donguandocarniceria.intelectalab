<?php

namespace App\Modulos\Del\Services;

use Illuminate\Support\Facades\DB;

/**
 * Lo que GAS usa de DEL: los gastos del repartidor de rutas ya liquidadas (DEL-17, RN-DEL-16) para pasarlos a
 * Gastos, y el enlace del costo de reparto con el gasto que lo respalda. DEL sigue siendo el dueño de sus tablas.
 */
final class ParaGas
{
    /** Gastos del repartidor de rutas liquidadas que GAS aún no tiene. */
    public static function gastosLiquidados(int $limite = 500)
    {
        return DB::table('driver_expenses as g')->join('delivery_routes as r', 'r.id', '=', 'g.route_id')
            ->join('driver_settlements as s', 's.id', '=', 'g.settlement_id')
            ->where('g.status', 'ACTIVE')->whereIn('s.status', ['SETTLED', 'APPROVED'])
            ->whereNotExists(fn ($q) => $q->from('expenses')->whereColumn('expenses.driver_expense_id', 'g.id'))
            ->orderBy('g.expense_date')->orderBy('g.number')->limit($limite)
            ->get(['g.*', 'r.code as ruta', 'r.establishment_id', 'r.vehicle_id', 'r.driver_employee_id', 's.number as liquidacion', 's.approved_by', 's.settled_by']);
    }

    /** El costo de reparto que creó el gasto del repartidor queda enlazado al gasto de GAS. */
    public static function enlazarCosto(string $costoId, string $gastoId): void
    {
        DB::table('delivery_costs')->where('id', $costoId)->whereNull('expense_id')->update(['expense_id' => $gastoId, 'updated_at' => now()]);
    }
}
