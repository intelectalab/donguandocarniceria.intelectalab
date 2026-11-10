<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

/**
 * ALM · correcciones a los datos de demo, después de la base (corre con el dueño de las tablas).
 *
 * En el prototipo, la cámara de frío del Local 1 tiene 6 cuyes enteros del lote L261008-001 y 8
 * reservados: al despachar P-001291 bajó el saldo, pero las demás reservas no se recortaron. Eso
 * viola RN-ALM-03 (la reserva no supera el saldo). Se libera la reserva de P-001330 (2 u), la más
 * reciente, y el saldo queda con 6 reservados de 6.
 */
class AlmDemoSeeder extends Seeder
{
    public function run(): void
    {
        $filas = DB::select(<<<'SQL'
            SELECT r.id, r.balance_id, r.qty
              FROM stock_reservations r
              JOIN stock_balances b ON b.id = r.balance_id
              JOIN lots l ON l.id = b.lot_id
             WHERE r.order_number = 'P-001330' AND r.status = 'ACTIVE' AND l.code = 'L261008-001'
               AND b.reserved_qty > b.qty
        SQL);

        foreach ($filas as $r) {
            DB::table('stock_reservations')->where('id', $r->id)->update([
                'status' => 'RELEASED', 'released_reason' => 'Stock insuficiente en la demo (RN-ALM-03)', 'closed_at' => now(),
            ]);
            DB::update('UPDATE stock_balances SET reserved_qty = GREATEST(0, reserved_qty - ?) WHERE id = ?', [$r->qty, $r->balance_id]);
        }

        $quedan = DB::table('stock_balances')->whereColumn('reserved_qty', '>', 'qty')->count();
        if ($quedan) {
            $this->command?->warn("ALM: {$quedan} saldo(s) con reservado mayor que el saldo (RN-ALM-03)");
        }
    }
}
