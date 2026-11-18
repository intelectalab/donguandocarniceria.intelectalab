<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

// PED · Pedidos de todos los canales. Ajustes del dueño del módulo sobre las tablas generadas
// (2026_11_03_000900_ped_pedidos.php), sin editar esa migración:
//  - Valores por defecto de las cifras del pedido y estados permitidos (RN-PED-03).
//  - CA-PED-11: la base no deja un pedido confirmado (o más allá) sin cliente, forma de pago,
//    dirección o local de recojo, fecha y franja o agencia, según cómo se entrega (RN-PED-01).
//    Los importados quedan fuera y salen en la vista de incompletos.
//  - Marca de «sin stock» al confirmar con permiso (RN-PED-17) y aviso de peso requerido (RN-PED-05).
//  - Textos con largo holgado en el historial y las aprobaciones.
//  - Una franja no se repite en el mismo local, zona y hora (PED-06).
return new class extends Migration
{
    public function up(): void
    {
        DB::statement(<<<'SQL'
            ALTER TABLE sales_orders
              ALTER COLUMN estimated_total SET DEFAULT 0,
              ALTER COLUMN delivery_fee SET DEFAULT 0,
              ALTER COLUMN paid_amount SET DEFAULT 0,
              ALTER COLUMN discount_total SET DEFAULT 0,
              ALTER COLUMN discount_status SET DEFAULT 'NONE',
              ALTER COLUMN weight_diff_status SET DEFAULT 'NONE',
              ALTER COLUMN reschedule_count SET DEFAULT 0,
              ALTER COLUMN units SET DEFAULT 0,
              ALTER COLUMN est_kg SET DEFAULT 0,
              ALTER COLUMN status SET DEFAULT 'DRAFT',
              ADD COLUMN IF NOT EXISTS needs_stock boolean NOT NULL DEFAULT false,
              ADD COLUMN IF NOT EXISTS last_activity_at timestamptz,
              ADD COLUMN IF NOT EXISTS cancel_note varchar(255),
              ADD COLUMN IF NOT EXISTS balance_note varchar(255)
        SQL);

        DB::statement(<<<'SQL'
            ALTER TABLE sales_order_lines
              ALTER COLUMN discount_pct SET DEFAULT 0,
              ALTER COLUMN discount_amount SET DEFAULT 0
        SQL);

        DB::statement("ALTER TABLE sales_orders ADD CONSTRAINT sales_orders_status_check CHECK (status IN
            ('DRAFT','CONFIRMED','IN_PREPARATION','WEIGHED','READY','IN_ROUTE','DELIVERED','NOT_DELIVERED','CLOSED','CANCELLED'))");
        DB::statement("ALTER TABLE sales_orders ADD CONSTRAINT sales_orders_fulfillment_check CHECK (fulfillment IN ('DELIVERY','PICKUP','COUNTER','PROVINCE_SHIPPING'))");
        DB::statement("ALTER TABLE sales_orders ADD CONSTRAINT sales_orders_weight_diff_check CHECK (weight_diff_status IN ('NONE','WITHIN_TOLERANCE','NOTICE_REQUIRED','NOTICE_SENT'))");
        DB::statement("ALTER TABLE sales_orders ADD CONSTRAINT sales_orders_discount_status_check CHECK (discount_status IN ('NONE','APPLIED','PENDING_APPROVAL','APPROVED','REJECTED'))");
        DB::statement('ALTER TABLE sales_orders ADD CONSTRAINT sales_orders_montos_check CHECK (estimated_total >= 0 AND delivery_fee >= 0 AND paid_amount >= 0 AND discount_total >= 0)');

        // CA-PED-11 / RN-PED-01 en la base.
        DB::statement(<<<'SQL'
            ALTER TABLE sales_orders ADD CONSTRAINT sales_orders_datos_obligatorios_check CHECK (
              status IN ('DRAFT','CANCELLED') OR coalesce(imported, false) OR (
                customer_id IS NOT NULL AND payment_method_id IS NOT NULL
                AND (fulfillment <> 'DELIVERY' OR (address_id IS NOT NULL AND delivery_date IS NOT NULL AND slot_id IS NOT NULL))
                AND (fulfillment <> 'PICKUP' OR (pickup_establishment_id IS NOT NULL AND delivery_date IS NOT NULL AND slot_id IS NOT NULL))
                AND (fulfillment <> 'PROVINCE_SHIPPING' OR (address_id IS NOT NULL AND province_agency IS NOT NULL))
              )
            )
        SQL);

        DB::statement("CREATE INDEX IF NOT EXISTS sales_orders_estado_entrega_idx ON sales_orders (tenant_id, status, delivery_date)");
        DB::statement("CREATE INDEX IF NOT EXISTS sales_orders_franja_idx ON sales_orders (slot_id, delivery_date) WHERE status NOT IN ('DRAFT','CANCELLED')");
        DB::statement('CREATE INDEX IF NOT EXISTS sales_order_lines_pedido_idx ON sales_order_lines (sales_order_id, line_no)');
        DB::statement('CREATE INDEX IF NOT EXISTS sales_order_status_history_pedido_idx ON sales_order_status_history (order_id, changed_at)');

        DB::statement('ALTER TABLE sales_order_status_history ALTER COLUMN reason TYPE varchar(255), ALTER COLUMN changed_by_name TYPE varchar(120)');
        DB::statement("ALTER TABLE sales_order_status_history ALTER COLUMN from_status TYPE varchar(40), ALTER COLUMN changed_at SET DEFAULT now()");
        DB::statement('ALTER TABLE order_reschedules ALTER COLUMN rescheduled_by_name TYPE varchar(120), ALTER COLUMN reason TYPE varchar(255)');
        DB::statement('ALTER TABLE order_reschedules ALTER COLUMN old_slot_from DROP NOT NULL, ALTER COLUMN old_date DROP NOT NULL');
        DB::statement('ALTER TABLE order_discount_approvals ALTER COLUMN requested_by_name TYPE varchar(120), ALTER COLUMN decided_by_name TYPE varchar(120), ALTER COLUMN decision_note TYPE varchar(255)');
        DB::statement("ALTER TABLE order_discount_approvals ADD CONSTRAINT order_discount_approvals_status_check CHECK (status IN ('PENDING','APPROVED','REJECTED'))");
        DB::statement("CREATE UNIQUE INDEX IF NOT EXISTS order_discount_approvals_una_pendiente ON order_discount_approvals (order_id) WHERE status = 'PENDING'");
        DB::statement('ALTER TABLE order_weight_notices ALTER COLUMN responded_at TYPE varchar(40), ALTER COLUMN cost SET DEFAULT 0');
        DB::statement('ALTER TABLE sales_orders ALTER COLUMN balance_decided_by_name TYPE varchar(120)');

        DB::statement("ALTER TABLE order_time_slots ALTER COLUMN status SET DEFAULT 'ACTIVE', ALTER COLUMN cutoff_minutes SET DEFAULT 0");
        DB::statement('ALTER TABLE order_time_slots ADD CONSTRAINT order_time_slots_horas_check CHECK (slot_to > slot_from AND capacity > 0)');
        DB::statement("CREATE UNIQUE INDEX IF NOT EXISTS order_time_slots_unica ON order_time_slots (tenant_id, establishment_id, coalesce(zone_id, '00000000-0000-0000-0000-000000000000'::uuid), slot_from) WHERE status = 'ACTIVE'");

        DB::statement("CREATE UNIQUE INDEX IF NOT EXISTS order_cancel_reasons_codigo ON order_cancel_reasons (tenant_id, code)");
        DB::statement("ALTER TABLE discount_limits ADD CONSTRAINT discount_limits_valores_check CHECK (max_pct >= 0 AND max_pct <= 100 AND max_amount >= 0)");
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE discount_limits DROP CONSTRAINT IF EXISTS discount_limits_valores_check');
        DB::statement('DROP INDEX IF EXISTS order_cancel_reasons_codigo');
        DB::statement('DROP INDEX IF EXISTS order_time_slots_unica');
        DB::statement('ALTER TABLE order_time_slots DROP CONSTRAINT IF EXISTS order_time_slots_horas_check');
        DB::statement('DROP INDEX IF EXISTS order_discount_approvals_una_pendiente');
        DB::statement('ALTER TABLE order_discount_approvals DROP CONSTRAINT IF EXISTS order_discount_approvals_status_check');
        DB::statement('DROP INDEX IF EXISTS sales_order_status_history_pedido_idx');
        DB::statement('DROP INDEX IF EXISTS sales_order_lines_pedido_idx');
        DB::statement('DROP INDEX IF EXISTS sales_orders_franja_idx');
        DB::statement('DROP INDEX IF EXISTS sales_orders_estado_entrega_idx');
        foreach (['datos_obligatorios', 'montos', 'discount_status', 'weight_diff', 'fulfillment', 'status'] as $c) {
            DB::statement("ALTER TABLE sales_orders DROP CONSTRAINT IF EXISTS sales_orders_{$c}_check");
        }
        DB::statement('ALTER TABLE sales_orders DROP COLUMN IF EXISTS needs_stock, DROP COLUMN IF EXISTS last_activity_at, DROP COLUMN IF EXISTS cancel_note, DROP COLUMN IF EXISTS balance_note');
    }
};
