<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

// GAS · Gastos: ajustes del dueño del módulo sobre las tablas generadas (2026_11_03_001600_gas_gastos.php),
// sin editar esa migración. Todo es compatible con los datos de demostración (migrate:fresh --seed siembra
// después de migrar, y en una base ya sembrada corre sobre esos datos).
//  - Gastos: estados, tipos de comprobante y moneda; RN-GAS-02 (total = subtotal + IGV + otros tributos) en la base;
//    RN-GAS-13: amount_pen lo calcula la base (total × tipo de cambio) con un disparador; RN-GAS-05: el mismo
//    comprobante (proveedor, tipo, serie y número) no se repite salvo anulado; número único por empresa.
//    El proveedor se guarda también por RUC y razón social (supplier_doc, supplier_name) para registrar desde el
//    celular aunque Compras aún no lo tenga en su maestro; si existe, se enlaza con supplier_id.
//    driver_expense_id enlaza el gasto que vino de la app del repartidor.
//  - Aprobaciones: de solo inserción (ya lo eran), con su decisión.
//  - Categorías y reglas de aprobación: estados y valores.
//  - Caja chica: un fondo activo por local; una rendición abierta por fondo; estados de la rendición.
//  - Reparto entre centros de costo: porcentaje entre 0 y 100 y monto no negativo.
return new class extends Migration
{
    public function up(): void
    {
        // Categorías
        DB::statement("UPDATE expense_categories SET status = 'ACTIVE' WHERE status IS NULL");
        DB::statement(<<<'SQL'
            ALTER TABLE expense_categories
              ALTER COLUMN status SET DEFAULT 'ACTIVE',
              ADD CONSTRAINT expense_categories_status_check CHECK (status IN ('ACTIVE','INACTIVE')),
              ADD CONSTRAINT expense_categories_group_check CHECK (category_group IN ('ADMIN','ADVERTISING','COMMERCIAL','CONTENT_CREATORS','DELIVERY',
                'EQUIPMENT_MAINTENANCE','OTHER','PRODUCTION','RENT','SERVICES','SUPPLIES_PACKAGING')),
              ADD CONSTRAINT expense_categories_area_check CHECK (default_area IN ('ADMIN','DELIVERY','MARKETING','OTHER','PRODUCTION','SALES')),
              ADD CONSTRAINT expense_categories_doc_check CHECK (default_doc_type IN ('FEES_RECEIPT','FOREIGN_INVOICE','INVOICE','MOBILITY_SHEET','NONE','RECEIPT','SIMPLE_RECEIPT','TICKET')),
              ADD CONSTRAINT expense_categories_reparto_check CHECK (category_group <> 'DELIVERY' OR delivery_cost_type IS NOT NULL)
        SQL);
        DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS expense_categories_codigo_unico ON expense_categories (tenant_id, upper(code))');

        // Reglas de aprobación (GAS-06)
        DB::statement("UPDATE expense_approval_rules SET status = 'ACTIVE' WHERE status IS NULL");
        DB::statement(<<<'SQL'
            ALTER TABLE expense_approval_rules
              ALTER COLUMN note DROP NOT NULL,
              ALTER COLUMN status SET DEFAULT 'ACTIVE',
              ADD CONSTRAINT expense_approval_rules_status_check CHECK (status IN ('ACTIVE','INACTIVE')),
              ADD CONSTRAINT expense_approval_rules_nivel_check CHECK (level BETWEEN 1 AND 3),
              ADD CONSTRAINT expense_approval_rules_permiso_check CHECK (permission_code IN ('gas.expense.approve_area','gas.expense.approve_admin','gas.expense.approve_management')),
              ADD CONSTRAINT expense_approval_rules_montos_check CHECK (min_amount >= 0 AND (max_amount IS NULL OR max_amount >= min_amount))
        SQL);

        // Caja chica (GAS-07 y GAS-08)
        DB::statement("UPDATE petty_cash_funds SET status = 'ACTIVE' WHERE status IS NULL");
        DB::statement(<<<'SQL'
            ALTER TABLE petty_cash_funds
              ALTER COLUMN status SET DEFAULT 'ACTIVE',
              ADD CONSTRAINT petty_cash_funds_status_check CHECK (status IN ('ACTIVE','INACTIVE')),
              ADD CONSTRAINT petty_cash_funds_montos_check CHECK ((fund_amount IS NULL OR fund_amount > 0) AND (max_expense_amount IS NULL OR max_expense_amount > 0))
        SQL);
        DB::statement("CREATE UNIQUE INDEX IF NOT EXISTS petty_cash_funds_un_activo ON petty_cash_funds (tenant_id, establishment_id) WHERE status = 'ACTIVE'");

        DB::statement(<<<'SQL'
            ALTER TABLE petty_cash_reports
              ALTER COLUMN status SET DEFAULT 'OPEN',
              ALTER COLUMN total_expenses SET DEFAULT 0,
              ADD COLUMN IF NOT EXISTS rejected_by uuid REFERENCES users(id) ON DELETE RESTRICT,
              ADD COLUMN IF NOT EXISTS rejected_at timestamptz,
              ADD COLUMN IF NOT EXISTS rejection_reason varchar(255),
              ADD CONSTRAINT petty_cash_reports_status_check CHECK (status IN ('OPEN','SUBMITTED','APPROVED','REIMBURSED','REJECTED')),
              ADD CONSTRAINT petty_cash_reports_montos_check CHECK (total_expenses >= 0 AND (replenishment_amount IS NULL OR replenishment_amount >= 0)),
              ADD CONSTRAINT petty_cash_reports_fechas_check CHECK (period_to >= period_from)
        SQL);
        DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS petty_cash_reports_numero_unico ON petty_cash_reports (tenant_id, number)');
        DB::statement("CREATE UNIQUE INDEX IF NOT EXISTS petty_cash_reports_una_abierta ON petty_cash_reports (fund_id) WHERE status = 'OPEN'");

        // Gastos
        DB::statement(<<<'SQL'
            ALTER TABLE expenses
              ALTER COLUMN status SET DEFAULT 'DRAFT',
              ALTER COLUMN currency SET DEFAULT 'PEN',
              ALTER COLUMN exchange_rate SET DEFAULT 1,
              ALTER COLUMN igv SET DEFAULT 0,
              ALTER COLUMN other_taxes SET DEFAULT 0,
              ALTER COLUMN withholding_amount SET DEFAULT 0,
              ALTER COLUMN amount_pen SET DEFAULT 0,
              ALTER COLUMN void_reason TYPE varchar(255),
              ADD COLUMN IF NOT EXISTS supplier_doc varchar(11),
              ADD COLUMN IF NOT EXISTS supplier_name varchar(160),
              ADD COLUMN IF NOT EXISTS driver_expense_id uuid REFERENCES driver_expenses(id) ON DELETE RESTRICT,
              ADD COLUMN IF NOT EXISTS corrected_at timestamptz,
              ADD COLUMN IF NOT EXISTS voided_by uuid REFERENCES users(id) ON DELETE RESTRICT,
              ADD CONSTRAINT expenses_status_check CHECK (status IN ('DRAFT','SUBMITTED','APPROVED','REJECTED','PAID','VOIDED')),
              ADD CONSTRAINT expenses_doc_check CHECK (doc_type IN ('FEES_RECEIPT','FOREIGN_INVOICE','INVOICE','MOBILITY_SHEET','NONE','RECEIPT','SIMPLE_RECEIPT','TICKET')),
              ADD CONSTRAINT expenses_currency_check CHECK (currency IN ('PEN','USD')),
              ADD CONSTRAINT expenses_flag_check CHECK (accounting_flag IS NULL OR accounting_flag IN ('NO_VALID_RECEIPT','OBSERVED','OK')),
              ADD CONSTRAINT expenses_pago_check CHECK (pay_source IS NULL OR pay_source IN ('PAYABLE','PETTY')),
              ADD CONSTRAINT expenses_nivel_check CHECK (required_level IS NULL OR required_level BETWEEN 1 AND 3),
              ADD CONSTRAINT expenses_montos_check CHECK (subtotal >= 0 AND igv >= 0 AND other_taxes >= 0 AND withholding_amount >= 0 AND total > 0 AND exchange_rate > 0),
              ADD CONSTRAINT expenses_total_check CHECK (total = subtotal + igv + other_taxes),
              ADD CONSTRAINT expenses_anulado_check CHECK (status <> 'VOIDED' OR voided_at IS NULL OR nullif(trim(void_reason), '') IS NOT NULL)
        SQL);
        DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS expenses_numero_unico ON expenses (tenant_id, number)');
        DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS expenses_gasto_de_ruta_unico ON expenses (driver_expense_id) WHERE driver_expense_id IS NOT NULL');
        // RN-GAS-05: proveedor (RUC o el del maestro), tipo, serie y número, salvo que el anterior esté anulado.
        DB::statement(<<<'SQL'
            CREATE UNIQUE INDEX IF NOT EXISTS expenses_comprobante_unico ON expenses
              (tenant_id, (coalesce(supplier_doc, supplier_id::text)), doc_type, (upper(coalesce(doc_series, ''))), (upper(doc_number)))
              WHERE status <> 'VOIDED' AND doc_number IS NOT NULL AND coalesce(supplier_doc, supplier_id::text) IS NOT NULL
        SQL);
        DB::statement('CREATE INDEX IF NOT EXISTS expenses_fecha_idx ON expenses (tenant_id, issue_date)');
        DB::statement('CREATE INDEX IF NOT EXISTS expenses_estado_idx ON expenses (tenant_id, status)');
        DB::statement('CREATE INDEX IF NOT EXISTS expenses_campana_idx ON expenses (ad_campaign_id)');

        // RN-GAS-13: amount_pen = total × tipo de cambio (venta de su fecha), siempre calculado por la base.
        DB::statement(<<<'SQL'
            CREATE OR REPLACE FUNCTION gas_amount_pen() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
              IF NEW.currency = 'PEN' THEN NEW.exchange_rate := 1; END IF;
              NEW.amount_pen := round(NEW.total * NEW.exchange_rate, 2);
              RETURN NEW;
            END $$
        SQL);
        DB::statement('DROP TRIGGER IF EXISTS gas_amount_pen ON expenses');
        DB::statement('CREATE TRIGGER gas_amount_pen BEFORE INSERT OR UPDATE OF total, exchange_rate, currency, amount_pen ON expenses FOR EACH ROW EXECUTE FUNCTION gas_amount_pen()');
        DB::statement("UPDATE expenses SET amount_pen = round(total * (CASE WHEN currency = 'PEN' THEN 1 ELSE exchange_rate END), 2)");

        // Aprobaciones (solo inserción desde la migración generada)
        DB::statement("ALTER TABLE expense_approvals ADD CONSTRAINT expense_approvals_decision_check CHECK (decision IN ('APPROVED','REJECTED'))");
        DB::statement('ALTER TABLE expense_approvals ADD CONSTRAINT expense_approvals_nivel_check CHECK (level BETWEEN 0 AND 3)');

        // Reparto (GAS-10)
        DB::statement('ALTER TABLE expense_allocations ADD CONSTRAINT expense_allocations_montos_check CHECK (pct > 0 AND pct <= 100 AND amount >= 0)');
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE expense_allocations DROP CONSTRAINT IF EXISTS expense_allocations_montos_check');
        DB::statement('ALTER TABLE expense_approvals DROP CONSTRAINT IF EXISTS expense_approvals_nivel_check, DROP CONSTRAINT IF EXISTS expense_approvals_decision_check');
        DB::statement('DROP TRIGGER IF EXISTS gas_amount_pen ON expenses');
        DB::statement('DROP FUNCTION IF EXISTS gas_amount_pen()');
        foreach (['expenses_campana_idx', 'expenses_estado_idx', 'expenses_fecha_idx', 'expenses_comprobante_unico', 'expenses_gasto_de_ruta_unico', 'expenses_numero_unico',
            'petty_cash_reports_una_abierta', 'petty_cash_reports_numero_unico', 'petty_cash_funds_un_activo', 'expense_categories_codigo_unico'] as $i) {
            DB::statement("DROP INDEX IF EXISTS {$i}");
        }
        DB::statement(<<<'SQL'
            ALTER TABLE expenses
              DROP CONSTRAINT IF EXISTS expenses_anulado_check, DROP CONSTRAINT IF EXISTS expenses_total_check, DROP CONSTRAINT IF EXISTS expenses_montos_check,
              DROP CONSTRAINT IF EXISTS expenses_nivel_check, DROP CONSTRAINT IF EXISTS expenses_pago_check, DROP CONSTRAINT IF EXISTS expenses_flag_check,
              DROP CONSTRAINT IF EXISTS expenses_currency_check, DROP CONSTRAINT IF EXISTS expenses_doc_check, DROP CONSTRAINT IF EXISTS expenses_status_check,
              DROP COLUMN IF EXISTS voided_by, DROP COLUMN IF EXISTS corrected_at, DROP COLUMN IF EXISTS driver_expense_id,
              DROP COLUMN IF EXISTS supplier_name, DROP COLUMN IF EXISTS supplier_doc
        SQL);
        DB::statement(<<<'SQL'
            ALTER TABLE petty_cash_reports
              DROP CONSTRAINT IF EXISTS petty_cash_reports_fechas_check, DROP CONSTRAINT IF EXISTS petty_cash_reports_montos_check,
              DROP CONSTRAINT IF EXISTS petty_cash_reports_status_check,
              DROP COLUMN IF EXISTS rejection_reason, DROP COLUMN IF EXISTS rejected_at, DROP COLUMN IF EXISTS rejected_by
        SQL);
        DB::statement('ALTER TABLE petty_cash_funds DROP CONSTRAINT IF EXISTS petty_cash_funds_montos_check, DROP CONSTRAINT IF EXISTS petty_cash_funds_status_check');
        DB::statement(<<<'SQL'
            ALTER TABLE expense_approval_rules
              DROP CONSTRAINT IF EXISTS expense_approval_rules_montos_check, DROP CONSTRAINT IF EXISTS expense_approval_rules_permiso_check,
              DROP CONSTRAINT IF EXISTS expense_approval_rules_nivel_check, DROP CONSTRAINT IF EXISTS expense_approval_rules_status_check
        SQL);
        DB::statement(<<<'SQL'
            ALTER TABLE expense_categories
              DROP CONSTRAINT IF EXISTS expense_categories_reparto_check, DROP CONSTRAINT IF EXISTS expense_categories_doc_check,
              DROP CONSTRAINT IF EXISTS expense_categories_area_check, DROP CONSTRAINT IF EXISTS expense_categories_group_check,
              DROP CONSTRAINT IF EXISTS expense_categories_status_check
        SQL);
    }
};
