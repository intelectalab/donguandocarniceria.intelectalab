<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

// POS · Mostrador. Ajustes del dueño del módulo sobre las tablas generadas
// (2026_11_03_001000_pos_mostrador.php), sin editar esa migración y solo en tablas de POS:
//  - pos_terminals: datos obligatorios, modo de balanza y estado permitidos, código único.
//  - pos_shifts: fondo y conteo de cierre con decimales, estados permitidos, una caja y una cajera
//    con un solo turno abierto (RN-POS-01, RN-POS-02), un turno cerrado no se reabre y su arqueo no
//    se modifica (RN-POS-07).
//  - pos_shift_counts: un conteo por medio y turno, solo inserción (RN-POS-07).
//  - pos_cash_movements: tipos permitidos (con depósito y devolución en efectivo), monto mayor que 0
//    y enlace a la nota de crédito de una devolución.
return new class extends Migration
{
    public function up(): void
    {
        // pos_terminals
        DB::statement("UPDATE pos_terminals SET scale_mode = coalesce(scale_mode, 'MANUAL'), status = coalesce(status, 'ACTIVE')");
        DB::statement(<<<'SQL'
            ALTER TABLE pos_terminals
              ALTER COLUMN code SET NOT NULL,
              ALTER COLUMN name TYPE varchar(80),
              ALTER COLUMN name SET NOT NULL,
              ALTER COLUMN establishment_id SET NOT NULL,
              ALTER COLUMN warehouse_id SET NOT NULL,
              ALTER COLUMN receipt_series_id SET NOT NULL,
              ALTER COLUMN scale_mode SET DEFAULT 'MANUAL',
              ALTER COLUMN scale_mode SET NOT NULL,
              ALTER COLUMN status SET DEFAULT 'ACTIVE',
              ALTER COLUMN status SET NOT NULL
        SQL);
        DB::statement("ALTER TABLE pos_terminals ADD CONSTRAINT pos_terminals_scale_mode_check CHECK (scale_mode IN ('MANUAL','SCALE','LABEL'))");
        DB::statement("ALTER TABLE pos_terminals ADD CONSTRAINT pos_terminals_status_check CHECK (status IN ('ACTIVE','INACTIVE'))");
        DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS pos_terminals_codigo ON pos_terminals (tenant_id, code)');

        // pos_shifts
        DB::statement(<<<'SQL'
            ALTER TABLE pos_shifts
              ALTER COLUMN opening_float TYPE numeric(14,2),
              ALTER COLUMN opening_counts SET DEFAULT '{}'::jsonb,
              ALTER COLUMN closing_denoms TYPE jsonb USING NULL,
              ALTER COLUMN cashier_name TYPE varchar(120),
              ALTER COLUMN approved_by_name TYPE varchar(120),
              ALTER COLUMN status SET DEFAULT 'OPEN',
              ADD COLUMN IF NOT EXISTS closed_by_name varchar(120),
              ADD COLUMN IF NOT EXISTS approval_note varchar(255),
              ADD COLUMN IF NOT EXISTS over_limit boolean NOT NULL DEFAULT false
        SQL);
        DB::statement("ALTER TABLE pos_shifts ADD CONSTRAINT pos_shifts_status_check CHECK (status IN ('OPEN','CLOSED','APPROVED'))");
        DB::statement('ALTER TABLE pos_shifts ADD CONSTRAINT pos_shifts_float_check CHECK (opening_float >= 0)');
        DB::statement("ALTER TABLE pos_shifts ADD CONSTRAINT pos_shifts_cierre_check CHECK (status = 'OPEN' OR (closed_at IS NOT NULL AND expected_cash IS NOT NULL AND counted_cash IS NOT NULL AND difference IS NOT NULL))");
        DB::statement("ALTER TABLE pos_shifts ADD CONSTRAINT pos_shifts_aprobado_check CHECK (status <> 'APPROVED' OR (approved_by IS NOT NULL AND approved_by <> cashier_user_id))");
        DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS pos_shifts_numero ON pos_shifts (tenant_id, number)');
        DB::statement("CREATE UNIQUE INDEX IF NOT EXISTS pos_shifts_un_abierto_por_caja ON pos_shifts (terminal_id) WHERE status = 'OPEN'");
        DB::statement("CREATE UNIQUE INDEX IF NOT EXISTS pos_shifts_un_abierto_por_cajera ON pos_shifts (cashier_user_id) WHERE status = 'OPEN'");

        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION pos_turno_cerrado() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
              IF OLD.status <> 'OPEN' AND NEW.status = 'OPEN' THEN
                RAISE EXCEPTION 'RN-POS-01: un turno cerrado no se reabre';
              END IF;
              IF OLD.status = 'APPROVED' AND NEW.status <> 'APPROVED' THEN
                RAISE EXCEPTION 'RN-POS-08: un cierre aprobado no cambia';
              END IF;
              IF OLD.status <> 'OPEN' AND (
                   NEW.expected_cash IS DISTINCT FROM OLD.expected_cash OR NEW.counted_cash IS DISTINCT FROM OLD.counted_cash
                OR NEW.difference IS DISTINCT FROM OLD.difference OR NEW.total_difference IS DISTINCT FROM OLD.total_difference
                OR NEW.difference_reason IS DISTINCT FROM OLD.difference_reason OR NEW.closing_denoms IS DISTINCT FROM OLD.closing_denoms
                OR NEW.opening_float IS DISTINCT FROM OLD.opening_float OR NEW.closed_at IS DISTINCT FROM OLD.closed_at
                OR NEW.terminal_id IS DISTINCT FROM OLD.terminal_id OR NEW.cashier_user_id IS DISTINCT FROM OLD.cashier_user_id) THEN
                RAISE EXCEPTION 'RN-POS-07: el arqueo cerrado no se modifica';
              END IF;
              RETURN NEW;
            END $$;
            DROP TRIGGER IF EXISTS pos_turno_cerrado ON pos_shifts;
            CREATE TRIGGER pos_turno_cerrado BEFORE UPDATE ON pos_shifts FOR EACH ROW EXECUTE FUNCTION pos_turno_cerrado();
        SQL);
        DB::statement('REVOKE DELETE, TRUNCATE ON pos_shifts FROM aycha_app');

        // pos_shift_counts: el arqueo no se modifica
        DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS pos_shift_counts_unico ON pos_shift_counts (shift_id, payment_method_id)');
        DB::statement('REVOKE UPDATE, DELETE, TRUNCATE ON pos_shift_counts FROM aycha_app');

        // pos_cash_movements
        DB::statement(<<<'SQL'
            ALTER TABLE pos_cash_movements
              ALTER COLUMN user_name TYPE varchar(120),
              ALTER COLUMN authorized_by_name TYPE varchar(120),
              ALTER COLUMN reason TYPE varchar(255),
              ALTER COLUMN moved_at SET DEFAULT now(),
              ADD COLUMN IF NOT EXISTS document_id uuid REFERENCES sales_documents(id) ON DELETE RESTRICT
        SQL);
        DB::statement("ALTER TABLE pos_cash_movements ADD CONSTRAINT pos_cash_movements_type_check CHECK (movement_type IN ('CASH_IN','CASH_OUT','DEPOSIT','PETTY_EXPENSE','REFUND'))");
        DB::statement('ALTER TABLE pos_cash_movements ADD CONSTRAINT pos_cash_movements_amount_check CHECK (amount > 0)');
        DB::statement('CREATE INDEX IF NOT EXISTS pos_cash_movements_turno_idx ON pos_cash_movements (shift_id, moved_at)');
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS pos_cash_movements_turno_idx');
        DB::statement('ALTER TABLE pos_cash_movements DROP CONSTRAINT IF EXISTS pos_cash_movements_amount_check');
        DB::statement('ALTER TABLE pos_cash_movements DROP CONSTRAINT IF EXISTS pos_cash_movements_type_check');
        DB::statement('ALTER TABLE pos_cash_movements DROP COLUMN IF EXISTS document_id');
        DB::statement('GRANT UPDATE, DELETE ON pos_shift_counts TO aycha_app');
        DB::statement('DROP INDEX IF EXISTS pos_shift_counts_unico');
        DB::statement('GRANT DELETE ON pos_shifts TO aycha_app');
        DB::unprepared('DROP TRIGGER IF EXISTS pos_turno_cerrado ON pos_shifts; DROP FUNCTION IF EXISTS pos_turno_cerrado();');
        foreach (['pos_shifts_un_abierto_por_cajera', 'pos_shifts_un_abierto_por_caja', 'pos_shifts_numero', 'pos_terminals_codigo'] as $i) {
            DB::statement("DROP INDEX IF EXISTS {$i}");
        }
        foreach (['aprobado', 'cierre', 'float', 'status'] as $c) {
            DB::statement("ALTER TABLE pos_shifts DROP CONSTRAINT IF EXISTS pos_shifts_{$c}_check");
        }
        DB::statement('ALTER TABLE pos_shifts DROP COLUMN IF EXISTS closed_by_name, DROP COLUMN IF EXISTS approval_note, DROP COLUMN IF EXISTS over_limit');
        DB::statement('ALTER TABLE pos_shifts ALTER COLUMN closing_denoms TYPE varchar(20) USING NULL');
        foreach (['status_check', 'scale_mode_check'] as $c) {
            DB::statement("ALTER TABLE pos_terminals DROP CONSTRAINT IF EXISTS pos_terminals_{$c}");
        }
    }
};
