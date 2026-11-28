<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

// PRE · Preparación con escaneo, bolsas numeradas y carga verificada. Ajustes del dueño del módulo
// sobre las tablas generadas (2026_11_03_001200_pre_preparacion.php), sin editar esa migración:
//  - Estados permitidos de olas, tareas, líneas, bolsas, lecturas y errores (los del prototipo).
//  - Una ola en borrador aún no tiene quién ni cuándo la liberó; número de ola único por empresa.
//  Todo es compatible con los datos de demostración (migrate:fresh --seed siembra después de migrar).
//  - RN-PRE-01: un pedido tiene una sola tarea de preparación activa (índice único parcial).
//  - RN-PRE-07: el código de cada bolsa es único y su número va de 1 al total.
//  - Lecturas de carga y de códigos desconocidos (sin pedido, ola ni producto) y la autorización
//    FEFO como una lectura nueva que apunta a la bloqueada (picking_scans sigue de solo inserción).
//  - Faltantes con quién los pidió y quién los aprobó (RN-PRE-12); usuarios como uuid.
//  - RN-PRE-11: cerrar un error exige acción correctiva y los que llegaron al cliente, responsable.
return new class extends Migration
{
    public function up(): void
    {
        // Olas
        DB::statement(<<<'SQL'
            ALTER TABLE picking_waves
              ALTER COLUMN released_at DROP NOT NULL,
              ALTER COLUMN released_by DROP NOT NULL,
              ALTER COLUMN status SET DEFAULT 'DRAFT',
              ADD COLUMN IF NOT EXISTS cancel_reason varchar(255),
              ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
              ADD COLUMN IF NOT EXISTS closed_by uuid REFERENCES users(id) ON DELETE RESTRICT
        SQL);
        DB::statement("ALTER TABLE picking_waves ADD CONSTRAINT picking_waves_status_check CHECK (status IN ('DRAFT','RELEASED','PICKING','PACKED','LOADED','CLOSED','CANCELLED'))");
        DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS picking_waves_numero_unico ON picking_waves (tenant_id, number)');
        DB::statement('CREATE INDEX IF NOT EXISTS picking_waves_fecha_idx ON picking_waves (tenant_id, wave_date)');

        // Tareas
        DB::statement(<<<'SQL'
            ALTER TABLE picking_tasks
              ALTER COLUMN delivery_date DROP NOT NULL,
              ALTER COLUMN status SET DEFAULT 'PENDING',
              ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
              ADD COLUMN IF NOT EXISTS cancel_note varchar(255),
              ADD COLUMN IF NOT EXISTS stock_error varchar(500)
        SQL);
        DB::statement("ALTER TABLE picking_tasks ADD CONSTRAINT picking_tasks_status_check CHECK (status IN ('PENDING','PICKING','PICKED','PACKED','VERIFIED','LOADED','CANCELLED'))");
        DB::statement("ALTER TABLE picking_tasks ADD CONSTRAINT picking_tasks_parcel_type_check CHECK (parcel_type IS NULL OR parcel_type IN ('BAG','THERMAL_BOX','BOX','COOLER'))");
        DB::statement('ALTER TABLE picking_tasks ADD CONSTRAINT picking_tasks_parcel_count_check CHECK (parcel_count IS NULL OR parcel_count BETWEEN 1 AND 20)');
        // RN-PRE-01: una sola tarea activa por pedido.
        DB::statement("CREATE UNIQUE INDEX IF NOT EXISTS picking_tasks_una_activa ON picking_tasks (order_id) WHERE status <> 'CANCELLED'");
        DB::statement('CREATE INDEX IF NOT EXISTS picking_tasks_ruta_idx ON picking_tasks (tenant_id, route_key)');

        // Líneas
        DB::statement(<<<'SQL'
            ALTER TABLE picking_task_lines
              ALTER COLUMN qty_picked SET DEFAULT 0,
              ALTER COLUMN status SET DEFAULT 'PENDING',
              ALTER COLUMN short_reason TYPE varchar(255),
              ALTER COLUMN short_approved_by TYPE uuid USING nullif(short_approved_by::text, '')::uuid,
              ADD COLUMN IF NOT EXISTS short_requested_by uuid REFERENCES users(id) ON DELETE RESTRICT,
              ADD COLUMN IF NOT EXISTS short_requested_at timestamptz,
              ADD COLUMN IF NOT EXISTS short_approved_at timestamptz,
              ADD COLUMN IF NOT EXISTS short_qty numeric(14,3)
        SQL);
        DB::statement('ALTER TABLE picking_task_lines ADD CONSTRAINT picking_task_lines_short_approved_by_foreign FOREIGN KEY (short_approved_by) REFERENCES users(id) ON DELETE RESTRICT');
        DB::statement("ALTER TABLE picking_task_lines ADD CONSTRAINT picking_task_lines_status_check CHECK (status IN ('PENDING','PARTIAL','DONE','SHORT_APPROVED'))");
        DB::statement('ALTER TABLE picking_task_lines ADD CONSTRAINT picking_task_lines_cantidades_check CHECK (qty_required > 0 AND qty_picked >= 0 AND (weighed_kg IS NULL OR weighed_kg >= 0))');
        // RN-PRE-12: un faltante aprobado tiene motivo y quién lo aprobó.
        DB::statement("ALTER TABLE picking_task_lines ADD CONSTRAINT picking_task_lines_faltante_check CHECK (status <> 'SHORT_APPROVED' OR (short_reason IS NOT NULL AND short_approved_by IS NOT NULL))");

        // Bolsas y cajas
        DB::statement(<<<'SQL'
            ALTER TABLE shipment_parcels
              ALTER COLUMN weight_kg TYPE numeric(14,3) USING nullif(weight_kg::text, '')::numeric,
              ALTER COLUMN status SET DEFAULT 'SEALED'
        SQL);
        DB::statement("ALTER TABLE shipment_parcels ADD CONSTRAINT shipment_parcels_status_check CHECK (status IN ('SEALED','LOADED','DELIVERED','RETURNED'))");
        DB::statement("ALTER TABLE shipment_parcels ADD CONSTRAINT shipment_parcels_parcel_type_check CHECK (parcel_type IN ('BAG','THERMAL_BOX','BOX','COOLER'))");
        DB::statement('ALTER TABLE shipment_parcels ADD CONSTRAINT shipment_parcels_numero_check CHECK (parcel_count BETWEEN 1 AND 20 AND parcel_no BETWEEN 1 AND parcel_count)');
        DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS shipment_parcels_etiqueta_unica ON shipment_parcels (tenant_id, label_code)');
        DB::statement('CREATE INDEX IF NOT EXISTS shipment_parcels_ruta_idx ON shipment_parcels (tenant_id, route_key)');

        // Lecturas (de solo inserción: no se les quita la restricción REVOKE UPDATE/DELETE)
        DB::statement(<<<'SQL'
            ALTER TABLE picking_scans
              ALTER COLUMN task_id DROP NOT NULL,
              ALTER COLUMN variant_id DROP NOT NULL,
              ALTER COLUMN order_id DROP NOT NULL,
              ALTER COLUMN wave_id DROP NOT NULL,
              ALTER COLUMN device_id SET DEFAULT 'WEB',
              ALTER COLUMN scanned_at SET DEFAULT now(),
              ALTER COLUMN override_by TYPE uuid USING nullif(override_by::text, '')::uuid,
              ADD COLUMN IF NOT EXISTS parcel_id uuid,
              ADD COLUMN IF NOT EXISTS route_key varchar(80),
              ADD COLUMN IF NOT EXISTS override_of uuid REFERENCES picking_scans(id) ON DELETE RESTRICT,
              ADD COLUMN IF NOT EXISTS override_reason varchar(255)
        SQL);
        DB::statement('ALTER TABLE picking_scans ADD CONSTRAINT picking_scans_override_by_foreign FOREIGN KEY (override_by) REFERENCES users(id) ON DELETE RESTRICT');
        DB::statement("ALTER TABLE picking_scans ADD CONSTRAINT picking_scans_scan_type_check CHECK (scan_type IN ('PICK','LOAD'))");
        DB::statement("ALTER TABLE picking_scans ADD CONSTRAINT picking_scans_result_check CHECK (result IN ('OK','WRONG_PRODUCT','WRONG_ORDER','WRONG_ROUTE','LOT_NOT_RELEASED','NOT_FEFO','EXCESS','DUPLICATE','LOAD_ORDER','UNKNOWN'))");
        DB::statement("ALTER TABLE picking_scans ADD CONSTRAINT picking_scans_pick_check CHECK (scan_type <> 'PICK' OR result = 'UNKNOWN' OR (task_id IS NOT NULL AND order_id IS NOT NULL AND variant_id IS NOT NULL))");
        DB::statement('CREATE INDEX IF NOT EXISTS picking_scans_barcode_idx ON picking_scans (tenant_id, barcode)');
        DB::statement('CREATE INDEX IF NOT EXISTS picking_scans_override_of_idx ON picking_scans (override_of)');
        DB::statement("CREATE INDEX IF NOT EXISTS picking_scans_fefo_idx ON picking_scans (tenant_id, scanned_at) WHERE result = 'NOT_FEFO'");

        // Errores de armado
        DB::statement(<<<'SQL'
            ALTER TABLE packing_errors
              ALTER COLUMN task_id DROP NOT NULL,
              ALTER COLUMN cost_amount SET DEFAULT 0,
              ALTER COLUMN status SET DEFAULT 'OPEN',
              ALTER COLUMN detected_at SET DEFAULT now(),
              ADD COLUMN IF NOT EXISTS closed_by uuid REFERENCES users(id) ON DELETE RESTRICT
        SQL);
        DB::statement("ALTER TABLE packing_errors ADD CONSTRAINT packing_errors_type_check CHECK (error_type IN ('WRONG_PRODUCT','WRONG_CUT','MISSING_ITEM','EXTRA_ITEM','WRONG_QTY','WRONG_WEIGHT','CROSSED_CUSTOMER','EXPIRED_LOT','DAMAGED_PACKAGE','LABEL_ERROR','OTHER'))");
        DB::statement("ALTER TABLE packing_errors ADD CONSTRAINT packing_errors_stage_check CHECK (detected_at_stage IN ('PICKING_SCAN','VERIFICATION','LOADING','DELIVERY','CUSTOMER_CLAIM'))");
        DB::statement("ALTER TABLE packing_errors ADD CONSTRAINT packing_errors_status_check CHECK (status IN ('OPEN','CLOSED'))");
        DB::statement('ALTER TABLE packing_errors ADD CONSTRAINT packing_errors_cost_check CHECK (cost_amount >= 0)');
        // RN-PRE-11 en la base.
        DB::statement("ALTER TABLE packing_errors ADD CONSTRAINT packing_errors_responsable_check CHECK (detected_at_stage NOT IN ('DELIVERY','CUSTOMER_CLAIM') OR responsible_employee_id IS NOT NULL)");
        DB::statement("ALTER TABLE packing_errors ADD CONSTRAINT packing_errors_cierre_check CHECK (status <> 'CLOSED' OR nullif(trim(corrective_action), '') IS NOT NULL)");
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE packing_errors DROP CONSTRAINT IF EXISTS packing_errors_cierre_check, DROP CONSTRAINT IF EXISTS packing_errors_responsable_check, DROP CONSTRAINT IF EXISTS packing_errors_cost_check, DROP CONSTRAINT IF EXISTS packing_errors_status_check, DROP CONSTRAINT IF EXISTS packing_errors_stage_check, DROP CONSTRAINT IF EXISTS packing_errors_type_check, DROP COLUMN IF EXISTS closed_by');
        DB::statement('DROP INDEX IF EXISTS picking_scans_fefo_idx');
        DB::statement('DROP INDEX IF EXISTS picking_scans_override_of_idx');
        DB::statement('DROP INDEX IF EXISTS picking_scans_barcode_idx');
        DB::statement('ALTER TABLE picking_scans DROP CONSTRAINT IF EXISTS picking_scans_pick_check, DROP CONSTRAINT IF EXISTS picking_scans_result_check, DROP CONSTRAINT IF EXISTS picking_scans_scan_type_check, DROP CONSTRAINT IF EXISTS picking_scans_override_by_foreign, DROP COLUMN IF EXISTS override_reason, DROP COLUMN IF EXISTS override_of, DROP COLUMN IF EXISTS route_key, DROP COLUMN IF EXISTS parcel_id');
        DB::statement('ALTER TABLE picking_scans ALTER COLUMN override_by TYPE varchar(40)');
        DB::statement('DROP INDEX IF EXISTS shipment_parcels_ruta_idx');
        DB::statement('DROP INDEX IF EXISTS shipment_parcels_etiqueta_unica');
        DB::statement('ALTER TABLE shipment_parcels DROP CONSTRAINT IF EXISTS shipment_parcels_numero_check, DROP CONSTRAINT IF EXISTS shipment_parcels_parcel_type_check, DROP CONSTRAINT IF EXISTS shipment_parcels_status_check');
        DB::statement('ALTER TABLE picking_task_lines DROP CONSTRAINT IF EXISTS picking_task_lines_faltante_check, DROP CONSTRAINT IF EXISTS picking_task_lines_cantidades_check, DROP CONSTRAINT IF EXISTS picking_task_lines_status_check, DROP CONSTRAINT IF EXISTS picking_task_lines_short_approved_by_foreign, DROP COLUMN IF EXISTS short_qty, DROP COLUMN IF EXISTS short_approved_at, DROP COLUMN IF EXISTS short_requested_at, DROP COLUMN IF EXISTS short_requested_by');
        DB::statement('ALTER TABLE picking_task_lines ALTER COLUMN short_approved_by TYPE varchar(40)');
        DB::statement('DROP INDEX IF EXISTS picking_tasks_ruta_idx');
        DB::statement('DROP INDEX IF EXISTS picking_tasks_una_activa');
        DB::statement('ALTER TABLE picking_tasks DROP CONSTRAINT IF EXISTS picking_tasks_parcel_count_check, DROP CONSTRAINT IF EXISTS picking_tasks_parcel_type_check, DROP CONSTRAINT IF EXISTS picking_tasks_status_check, DROP COLUMN IF EXISTS stock_error, DROP COLUMN IF EXISTS cancel_note, DROP COLUMN IF EXISTS cancelled_at');
        DB::statement('DROP INDEX IF EXISTS picking_waves_fecha_idx');
        DB::statement('DROP INDEX IF EXISTS picking_waves_numero_unico');
        DB::statement('ALTER TABLE picking_waves DROP CONSTRAINT IF EXISTS picking_waves_status_check, DROP COLUMN IF EXISTS closed_by, DROP COLUMN IF EXISTS cancelled_at, DROP COLUMN IF EXISTS cancel_reason');
    }
};
