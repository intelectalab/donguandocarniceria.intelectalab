<?php

use Database\Seeders\PerDemoSeeder;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

// PER · Personal (fase 3). Las 17 tablas del módulo, a partir del modelo del prototipo (aycha-proto/src/modules/PER.js),
// con los tipos, únicos y estados revisados. No agrega columnas a employees (MAE): puesto, local, centro de costo y
// supervisor viven en employee_assignments, con vigencia.
//  - job_positions, employee_assignments (RN-PER-01) y employment_terms (RN-PER-02: sin traslapes, con una exclusión).
//  - shifts, shift_assignments (una programación vigente por trabajador y día) y las horas extra autorizadas (RN-PER-08).
//  - establishment_qr_tokens (RN-PER-04), attendance_marks (solo inserción, RN-PER-06), attendance_days y leave_requests.
//  - salary_advances (RN-PER-09: uno abierto por trabajador; quien pide no aprueba).
//  - commission_plans y commission_entries (solo inserción; una comisión por asignación de cobro y plan, RN-PER-11;
//    un bono por pedido y repartidor, RN-PER-13; un reverso por comisión, RN-PER-12).
//  - staff_payouts y staff_payout_lines (RN-PER-14: neto = bruto − descuentos; aprobado antes de pagar).
//  - supervision_actions (RN-PER-16: la acción tomada no se cambia ni se borra).
//  - payroll_exchanges y payroll_cost_lines (RN-PER-18: costo importado de Ayni HR o del archivo del contador).
// Al final da acceso de lectura a PER a los roles que solo marcan asistencia (PER-06) y siembra la demo (PerDemoSeeder)
// si la base ya tiene datos; en una base nueva la siembra el DatabaseSeeder.
return new class extends Migration
{
    private const TABLAS = ['job_positions', 'employee_assignments', 'employment_terms', 'shifts', 'shift_assignments', 'establishment_qr_tokens',
        'attendance_marks', 'attendance_days', 'leave_requests', 'salary_advances', 'commission_plans', 'commission_entries', 'staff_payouts',
        'staff_payout_lines', 'supervision_actions', 'payroll_exchanges', 'payroll_cost_lines'];

    public function up(): void
    {
        $base = "id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id uuid NOT NULL DEFAULT app_tenant_id() REFERENCES tenants(id) ON DELETE RESTRICT";
        $fechas = 'created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz';
        $areas = "'PRODUCTION','QUALITY','WAREHOUSE','DELIVERY','SALES','MARKETING','ADMIN','FINANCE','HR','OTHER'";
        $formas = "'MONTHLY','DAILY','HOURLY'";

        DB::statement(<<<SQL
            CREATE TABLE job_positions (
              {$base},
              code varchar(20) NOT NULL,
              name varchar(120) NOT NULL,
              area varchar(12) NOT NULL CHECK (area IN ({$areas})),
              establishment_id uuid REFERENCES establishments(id) ON DELETE RESTRICT,
              functions jsonb NOT NULL DEFAULT '[]'::jsonb,
              default_role varchar(40),
              pay_scheme varchar(8) NOT NULL DEFAULT 'MONTHLY' CHECK (pay_scheme IN ({$formas})),
              status varchar(10) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
              {$fechas}
            )
        SQL);
        DB::statement('CREATE UNIQUE INDEX job_positions_codigo ON job_positions (tenant_id, upper(code))');

        DB::statement(<<<SQL
            CREATE TABLE employee_assignments (
              {$base},
              employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
              position_id uuid NOT NULL REFERENCES job_positions(id) ON DELETE RESTRICT,
              establishment_id uuid NOT NULL REFERENCES establishments(id) ON DELETE RESTRICT,
              cost_center_id uuid NOT NULL REFERENCES cost_centers(id) ON DELETE RESTRICT,
              supervisor_employee_id uuid REFERENCES employees(id) ON DELETE RESTRICT,
              allocation_pct numeric(5,2) NOT NULL CHECK (allocation_pct > 0 AND allocation_pct <= 100),
              is_primary boolean NOT NULL DEFAULT false,
              valid_from date NOT NULL,
              valid_to date,
              superseded boolean NOT NULL DEFAULT false,
              created_by uuid REFERENCES users(id) ON DELETE RESTRICT,
              {$fechas},
              CHECK (superseded OR valid_to IS NULL OR valid_to >= valid_from),
              CHECK (supervisor_employee_id IS NULL OR supervisor_employee_id <> employee_id)
            )
        SQL);
        DB::statement('CREATE INDEX employee_assignments_trabajador ON employee_assignments (employee_id, valid_from)');

        DB::statement(<<<SQL
            CREATE TABLE employment_terms (
              {$base},
              employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
              pay_scheme varchar(8) NOT NULL CHECK (pay_scheme IN ({$formas})),
              monthly_amount numeric(12,2) CHECK (monthly_amount IS NULL OR monthly_amount >= 0),
              daily_rate numeric(10,2) CHECK (daily_rate IS NULL OR daily_rate >= 0),
              hourly_rate numeric(10,2) CHECK (hourly_rate IS NULL OR hourly_rate >= 0),
              payroll_source varchar(16) NOT NULL DEFAULT 'AYNI_HR' CHECK (payroll_source IN ('AYNI_HR','ACCOUNTANT_FILE','NONE')),
              external_ref varchar(40),
              valid_from date NOT NULL,
              valid_to date,
              created_by uuid REFERENCES users(id) ON DELETE RESTRICT,
              {$fechas},
              CHECK (valid_to IS NULL OR valid_to >= valid_from),
              CHECK ((pay_scheme = 'MONTHLY' AND monthly_amount IS NOT NULL) OR (pay_scheme = 'DAILY' AND daily_rate IS NOT NULL) OR (pay_scheme = 'HOURLY' AND hourly_rate IS NOT NULL)),
              EXCLUDE USING gist (tenant_id WITH =, employee_id WITH =, daterange(valid_from, coalesce(valid_to, 'infinity'::date), '[]') WITH &&)
            )
        SQL);   // RN-PER-02

        DB::statement(<<<SQL
            CREATE TABLE shifts (
              {$base},
              establishment_id uuid NOT NULL REFERENCES establishments(id) ON DELETE RESTRICT,
              code varchar(12) NOT NULL,
              name varchar(80) NOT NULL,
              start_time time NOT NULL,
              end_time time NOT NULL,
              break_minutes integer NOT NULL DEFAULT 60 CHECK (break_minutes BETWEEN 0 AND 240),
              crosses_midnight boolean NOT NULL DEFAULT false,
              late_tolerance_minutes integer CHECK (late_tolerance_minutes IS NULL OR late_tolerance_minutes BETWEEN 0 AND 120),
              status varchar(10) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
              {$fechas},
              CHECK (crosses_midnight = (end_time <= start_time))
            )
        SQL);
        DB::statement('CREATE UNIQUE INDEX shifts_codigo ON shifts (tenant_id, establishment_id, upper(code))');

        DB::statement(<<<SQL
            CREATE TABLE shift_assignments (
              {$base},
              employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
              shift_id uuid NOT NULL REFERENCES shifts(id) ON DELETE RESTRICT,
              work_date date NOT NULL,
              status varchar(10) NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED','SWAPPED','REST','CANCELLED')),
              overtime_authorized_minutes integer NOT NULL DEFAULT 0 CHECK (overtime_authorized_minutes BETWEEN 0 AND 720),
              overtime_authorized_by uuid REFERENCES users(id) ON DELETE RESTRICT,
              note varchar(500),
              created_by uuid REFERENCES users(id) ON DELETE RESTRICT,
              {$fechas},
              CHECK (overtime_authorized_minutes = 0 OR overtime_authorized_by IS NOT NULL)
            )
        SQL);
        DB::statement("CREATE UNIQUE INDEX shift_assignments_dia ON shift_assignments (tenant_id, employee_id, work_date) WHERE status <> 'CANCELLED'");
        DB::statement('CREATE INDEX shift_assignments_fecha ON shift_assignments (tenant_id, work_date)');

        DB::statement(<<<SQL
            CREATE TABLE establishment_qr_tokens (
              {$base},
              establishment_id uuid NOT NULL REFERENCES establishments(id) ON DELETE RESTRICT,
              token_hash varchar(40) NOT NULL,
              valid_from timestamptz NOT NULL,
              valid_to timestamptz NOT NULL,
              {$fechas},
              CHECK (valid_to > valid_from)
            )
        SQL);
        DB::statement('CREATE UNIQUE INDEX establishment_qr_tokens_codigo ON establishment_qr_tokens (tenant_id, token_hash)');
        DB::statement('CREATE INDEX establishment_qr_tokens_local ON establishment_qr_tokens (establishment_id, valid_from)');

        DB::statement(<<<SQL
            CREATE TABLE attendance_marks (
              {$base},
              employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
              establishment_id uuid NOT NULL REFERENCES establishments(id) ON DELETE RESTRICT,
              mark_type varchar(10) NOT NULL CHECK (mark_type IN ('IN','BREAK_OUT','BREAK_IN','OUT')),
              marked_at timestamptz NOT NULL,
              method varchar(8) NOT NULL CHECK (method IN ('GEO','QR','MANUAL')),
              lat numeric(10,7) CHECK (lat IS NULL OR lat BETWEEN -90 AND 90),
              lng numeric(10,7) CHECK (lng IS NULL OR lng BETWEEN -180 AND 180),
              distance_m numeric(10,1),
              qr_token_id uuid REFERENCES establishment_qr_tokens(id) ON DELETE RESTRICT,
              device_id varchar(80),
              photo_file_id uuid REFERENCES file_attachments(id) ON DELETE RESTRICT,
              is_valid boolean NOT NULL DEFAULT true,
              invalid_reason varchar(300),
              manual_reason varchar(500),
              approved_by_employee_id uuid REFERENCES employees(id) ON DELETE RESTRICT,
              offline_uuid varchar(64),
              synced_late boolean NOT NULL DEFAULT false,
              recorded_by uuid REFERENCES users(id) ON DELETE RESTRICT,
              {$fechas},
              CHECK (method <> 'GEO' OR (lat IS NOT NULL AND lng IS NOT NULL AND distance_m IS NOT NULL)),
              CHECK (method <> 'QR' OR qr_token_id IS NOT NULL),
              CHECK (method <> 'MANUAL' OR (length(trim(coalesce(manual_reason, ''))) > 0 AND approved_by_employee_id IS NOT NULL AND approved_by_employee_id <> employee_id)),
              CHECK (is_valid OR invalid_reason IS NOT NULL)
            )
        SQL);   // RN-PER-03/04/05
        DB::statement('CREATE UNIQUE INDEX attendance_marks_offline ON attendance_marks (tenant_id, offline_uuid) WHERE offline_uuid IS NOT NULL');
        DB::statement('CREATE INDEX attendance_marks_trabajador ON attendance_marks (employee_id, marked_at)');
        DB::statement('CREATE INDEX attendance_marks_fecha ON attendance_marks (tenant_id, marked_at)');

        DB::statement(<<<SQL
            CREATE TABLE attendance_days (
              {$base},
              employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
              work_date date NOT NULL,
              shift_assignment_id uuid REFERENCES shift_assignments(id) ON DELETE SET NULL,
              first_in timestamptz, last_out timestamptz,
              worked_minutes integer NOT NULL DEFAULT 0 CHECK (worked_minutes >= 0),
              late_minutes integer NOT NULL DEFAULT 0 CHECK (late_minutes >= 0),
              overtime_minutes integer NOT NULL DEFAULT 0 CHECK (overtime_minutes >= 0),
              unauthorized_minutes integer NOT NULL DEFAULT 0 CHECK (unauthorized_minutes >= 0),
              status varchar(8) NOT NULL CHECK (status IN ('PRESENT','LATE','ABSENT','LEAVE','REST','HOLIDAY')),
              justification varchar(500),
              justification_approved boolean NOT NULL DEFAULT false,
              approved_by uuid REFERENCES users(id) ON DELETE RESTRICT,
              {$fechas},
              CHECK (NOT justification_approved OR (justification IS NOT NULL AND approved_by IS NOT NULL))
            )
        SQL);
        DB::statement('CREATE UNIQUE INDEX attendance_days_dia ON attendance_days (tenant_id, employee_id, work_date)');
        DB::statement('CREATE INDEX attendance_days_fecha ON attendance_days (tenant_id, work_date)');

        DB::statement(<<<SQL
            CREATE TABLE leave_requests (
              {$base},
              employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
              leave_type varchar(12) NOT NULL CHECK (leave_type IN ('VACATION','PERMISSION','MEDICAL')),
              date_from date NOT NULL, date_to date NOT NULL,
              days integer NOT NULL CHECK (days > 0),
              reason varchar(500) NOT NULL,
              status varchar(10) NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED','APPROVED','REJECTED','CANCELLED')),
              requested_by uuid REFERENCES users(id) ON DELETE RESTRICT,
              approved_by uuid REFERENCES users(id) ON DELETE RESTRICT,
              decided_at timestamptz,
              decision_note varchar(500),
              {$fechas},
              CHECK (date_to >= date_from),
              CHECK (status NOT IN ('APPROVED','REJECTED') OR (approved_by IS NOT NULL AND decided_at IS NOT NULL)),
              CHECK (approved_by IS NULL OR requested_by IS NULL OR approved_by <> requested_by)
            )
        SQL);
        DB::statement('CREATE INDEX leave_requests_trabajador ON leave_requests (employee_id, date_from)');

        DB::statement(<<<SQL
            CREATE TABLE salary_advances (
              {$base},
              number varchar(20) NOT NULL,
              employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
              requested_by uuid REFERENCES users(id) ON DELETE RESTRICT,
              requested_on date NOT NULL,
              amount numeric(12,2) NOT NULL CHECK (amount > 0),
              max_amount numeric(12,2),
              reason varchar(500) NOT NULL,
              status varchar(10) NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED','APPROVED','REJECTED','PAID','DEDUCTED','CANCELLED')),
              approved_by uuid REFERENCES users(id) ON DELETE RESTRICT,
              approved_at timestamptz,
              decision_note varchar(500),
              deduct_period date NOT NULL CHECK (extract(day FROM deduct_period) = 1),
              cash_account_id uuid REFERENCES cash_accounts(id) ON DELETE RESTRICT,
              paid_at timestamptz,
              payment_reference varchar(60),
              deducted_payout_id uuid,
              {$fechas},
              CHECK (status IN ('REQUESTED','CANCELLED') OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)),
              CHECK (approved_by IS NULL OR requested_by IS NULL OR approved_by <> requested_by),
              CHECK (status NOT IN ('PAID','DEDUCTED') OR paid_at IS NOT NULL OR deducted_payout_id IS NOT NULL)
            )
        SQL);
        DB::statement('CREATE UNIQUE INDEX salary_advances_numero ON salary_advances (tenant_id, number)');
        DB::statement("CREATE UNIQUE INDEX salary_advances_uno_abierto ON salary_advances (tenant_id, employee_id) WHERE status IN ('REQUESTED','APPROVED','PAID')");   // RN-PER-09

        DB::statement(<<<SQL
            CREATE TABLE commission_plans (
              {$base},
              code varchar(30) NOT NULL,
              name varchar(160) NOT NULL,
              plan_type varchar(16) NOT NULL CHECK (plan_type IN ('SELLER_COLLECTED','DRIVER_DELIVERY')),
              brand_id uuid REFERENCES brands(id) ON DELETE RESTRICT,
              channel varchar(30),
              rate_pct numeric(6,3) CHECK (rate_pct IS NULL OR (rate_pct >= 0 AND rate_pct <= 100)),
              per_delivery_amount numeric(10,2) CHECK (per_delivery_amount IS NULL OR per_delivery_amount >= 0),
              tiers jsonb NOT NULL DEFAULT '[]'::jsonb,
              alert_penalty_pct numeric(5,2) NOT NULL DEFAULT 10 CHECK (alert_penalty_pct BETWEEN 0 AND 50),
              valid_from date NOT NULL,
              valid_to date,
              status varchar(10) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
              created_by uuid REFERENCES users(id) ON DELETE RESTRICT,
              {$fechas},
              CHECK (valid_to IS NULL OR valid_to >= valid_from),
              CHECK (plan_type <> 'SELLER_COLLECTED' OR rate_pct IS NOT NULL),
              CHECK (plan_type <> 'DRIVER_DELIVERY' OR per_delivery_amount IS NOT NULL)
            )
        SQL);
        DB::statement('CREATE UNIQUE INDEX commission_plans_codigo ON commission_plans (tenant_id, upper(code))');

        DB::statement(<<<SQL
            CREATE TABLE commission_entries (
              {$base},
              plan_id uuid NOT NULL REFERENCES commission_plans(id) ON DELETE RESTRICT,
              employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
              source_type varchar(20) NOT NULL CHECK (source_type IN ('PAYMENT_ALLOCATION','DELIVERY','REVERSAL')),
              payment_allocation_id uuid REFERENCES payment_allocations(id) ON DELETE RESTRICT,
              payment_id uuid REFERENCES payments(id) ON DELETE RESTRICT,
              order_id uuid REFERENCES sales_orders(id) ON DELETE RESTRICT,
              brand_id uuid REFERENCES brands(id) ON DELETE RESTRICT,
              delivery_stop_id uuid REFERENCES delivery_stops(id) ON DELETE RESTRICT,
              period date NOT NULL CHECK (extract(day FROM period) = 1),
              base_amount numeric(14,2) NOT NULL DEFAULT 0,
              rate_pct numeric(6,3),
              amount numeric(14,2) NOT NULL,
              earned_at timestamptz NOT NULL,
              reversal_of uuid REFERENCES commission_entries(id) ON DELETE RESTRICT,
              reason varchar(300),
              {$fechas},
              CHECK (source_type <> 'PAYMENT_ALLOCATION' OR (payment_allocation_id IS NOT NULL AND amount >= 0)),
              CHECK (source_type <> 'DELIVERY' OR (order_id IS NOT NULL AND amount >= 0)),
              CHECK (source_type <> 'REVERSAL' OR (reversal_of IS NOT NULL AND amount <= 0))
            )
        SQL);
        DB::statement("CREATE UNIQUE INDEX commission_entries_cobro ON commission_entries (tenant_id, payment_allocation_id, plan_id) WHERE source_type = 'PAYMENT_ALLOCATION'");   // RN-PER-11
        DB::statement("CREATE UNIQUE INDEX commission_entries_entrega ON commission_entries (tenant_id, order_id, employee_id) WHERE source_type = 'DELIVERY'");                 // RN-PER-13
        DB::statement('CREATE UNIQUE INDEX commission_entries_reverso ON commission_entries (tenant_id, reversal_of) WHERE reversal_of IS NOT NULL');                              // RN-PER-12
        DB::statement('CREATE INDEX commission_entries_periodo ON commission_entries (tenant_id, period, employee_id)');
        DB::statement('CREATE INDEX commission_entries_pago ON commission_entries (payment_id)');

        DB::statement(<<<SQL
            CREATE TABLE staff_payouts (
              {$base},
              number varchar(20) NOT NULL,
              employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
              period date NOT NULL CHECK (extract(day FROM period) = 1),
              payout_type varchar(12) NOT NULL CHECK (payout_type IN ('COMMISSIONS','BONUS','WAGES','MIXED')),
              gross_amount numeric(14,2) NOT NULL CHECK (gross_amount >= 0),
              deductions_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (deductions_amount >= 0),
              net_amount numeric(14,2) NOT NULL,
              status varchar(10) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','HELD','APPROVED','PAID','VOIDED')),
              held_reason varchar(500),
              approved_by uuid REFERENCES users(id) ON DELETE RESTRICT,
              approved_at timestamptz,
              cash_account_id uuid REFERENCES cash_accounts(id) ON DELETE RESTRICT,
              paid_at timestamptz,
              payment_reference varchar(60),
              void_reason varchar(500),
              created_by uuid REFERENCES users(id) ON DELETE RESTRICT,
              {$fechas},
              CHECK (net_amount = gross_amount - deductions_amount),
              CHECK (status NOT IN ('APPROVED','PAID') OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)),
              CHECK (status <> 'PAID' OR (paid_at IS NOT NULL AND payment_reference IS NOT NULL)),
              CHECK (status <> 'HELD' OR held_reason IS NOT NULL)
            )
        SQL);   // RN-PER-14
        DB::statement('CREATE UNIQUE INDEX staff_payouts_numero ON staff_payouts (tenant_id, number)');
        DB::statement("CREATE UNIQUE INDEX staff_payouts_uno ON staff_payouts (tenant_id, employee_id, period) WHERE status <> 'VOIDED'");
        DB::statement('CREATE INDEX staff_payouts_periodo ON staff_payouts (tenant_id, period)');

        DB::statement(<<<SQL
            CREATE TABLE staff_payout_lines (
              {$base},
              payout_id uuid NOT NULL REFERENCES staff_payouts(id) ON DELETE CASCADE,
              concept varchar(20) NOT NULL CHECK (concept IN ('COMMISSION','DELIVERY_BONUS','WAGE','BONUS','ADVANCE_DEDUCTION','FINE_DEDUCTION','OTHER_DEDUCTION')),
              amount numeric(14,2) NOT NULL CHECK (amount >= 0),
              ref_type varchar(20),
              ref_id uuid,
              note varchar(300),
              {$fechas}
            )
        SQL);
        DB::statement('CREATE INDEX staff_payout_lines_pago ON staff_payout_lines (payout_id)');

        DB::statement(<<<SQL
            CREATE TABLE supervision_actions (
              {$base},
              employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
              supervisor_employee_id uuid REFERENCES employees(id) ON DELETE RESTRICT,
              source varchar(20) NOT NULL CHECK (source IN ('CRM_CONTROL_ALERT','TEL_CALL','FLO_ALERT','FLO_FINE','ATTENDANCE','OTHER')),
              source_ref_id uuid,
              control_alert_id uuid REFERENCES control_alerts(id) ON DELETE RESTRICT,
              severity varchar(8) NOT NULL CHECK (severity IN ('LOW','MEDIUM','HIGH')),
              summary text NOT NULL,
              action varchar(16) CHECK (action IN ('OBSERVATION','VERBAL_WARNING','WRITTEN_WARNING','TRAINING','NO_ACTION')),
              action_note text,
              action_by uuid REFERENCES users(id) ON DELETE RESTRICT,
              action_at timestamptz,
              status varchar(8) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')),
              raised_at timestamptz NOT NULL,
              created_by uuid REFERENCES users(id) ON DELETE RESTRICT,
              {$fechas},
              CHECK (status <> 'CLOSED' OR (action IS NOT NULL AND action_by IS NOT NULL AND action_at IS NOT NULL)),
              CHECK (action IS NULL OR action = 'NO_ACTION' OR length(trim(coalesce(action_note, ''))) > 0)
            )
        SQL);   // RN-PER-16
        DB::statement('CREATE UNIQUE INDEX supervision_actions_alerta ON supervision_actions (tenant_id, control_alert_id) WHERE control_alert_id IS NOT NULL');
        DB::statement("CREATE UNIQUE INDEX supervision_actions_origen ON supervision_actions (tenant_id, source, source_ref_id) WHERE source_ref_id IS NOT NULL AND source <> 'OTHER'");
        DB::statement('CREATE INDEX supervision_actions_trabajador ON supervision_actions (employee_id, status)');

        DB::statement(<<<SQL
            CREATE TABLE payroll_exchanges (
              {$base},
              period date NOT NULL CHECK (extract(day FROM period) = 1),
              direction varchar(18) NOT NULL CHECK (direction IN ('IMPORT_COST','EXPORT_VARIABLES')),
              provider varchar(16) NOT NULL CHECK (provider IN ('AYNI_HR','ACCOUNTANT_FILE')),
              file_name varchar(160),
              file_id uuid REFERENCES file_attachments(id) ON DELETE RESTRICT,
              status varchar(12) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','DONE','FAILED','SUPERSEDED')),
              total_amount numeric(14,2) NOT NULL DEFAULT 0,
              row_count integer NOT NULL DEFAULT 0 CHECK (row_count >= 0),
              error_message text,
              processed_at timestamptz,
              created_by uuid REFERENCES users(id) ON DELETE RESTRICT,
              {$fechas}
            )
        SQL);
        DB::statement("CREATE UNIQUE INDEX payroll_exchanges_vigente ON payroll_exchanges (tenant_id, period, direction) WHERE status = 'DONE'");

        DB::statement(<<<SQL
            CREATE TABLE payroll_cost_lines (
              {$base},
              exchange_id uuid NOT NULL REFERENCES payroll_exchanges(id) ON DELETE CASCADE,
              employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
              cost_center_id uuid NOT NULL REFERENCES cost_centers(id) ON DELETE RESTRICT,
              gross_salary numeric(14,2) NOT NULL DEFAULT 0 CHECK (gross_salary >= 0),
              employer_contributions numeric(14,2) NOT NULL DEFAULT 0 CHECK (employer_contributions >= 0),
              provisions numeric(14,2) NOT NULL DEFAULT 0 CHECK (provisions >= 0),
              total_cost numeric(14,2) NOT NULL,
              {$fechas},
              CHECK (total_cost = gross_salary + employer_contributions + provisions)
            )
        SQL);
        DB::statement('CREATE INDEX payroll_cost_lines_intercambio ON payroll_cost_lines (exchange_id)');

        // RN-PER-16: una acción registrada no se cambia; RN-PER-14: un pago pagado o anulado ya no se edita.
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION per_supervision_inmutable() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
              IF OLD.status = 'CLOSED' THEN
                RAISE EXCEPTION 'RN-PER-16: la acción tomada ya quedó registrada y no se cambia.' USING ERRCODE = 'check_violation';
              END IF;
              RETURN NEW;
            END $$;
            CREATE TRIGGER supervision_actions_inmutable BEFORE UPDATE ON supervision_actions FOR EACH ROW EXECUTE FUNCTION per_supervision_inmutable();

            CREATE OR REPLACE FUNCTION per_pago_cerrado() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
              IF OLD.status IN ('PAID','VOIDED') THEN
                RAISE EXCEPTION 'RN-PER-14: el pago ya está cerrado y no se edita.' USING ERRCODE = 'check_violation';
              END IF;
              RETURN NEW;
            END $$;
            CREATE TRIGGER staff_payouts_cerrado BEFORE UPDATE ON staff_payouts FOR EACH ROW EXECUTE FUNCTION per_pago_cerrado();
        SQL);

        foreach (self::TABLAS as $t) {
            DB::statement("CREATE INDEX {$t}_tenant ON {$t} (tenant_id)");
            DB::statement("SELECT enable_tenant_rls('{$t}')");
            if (! in_array($t, ['establishment_qr_tokens', 'attendance_marks', 'attendance_days', 'commission_entries'], true)) {   // las de alto volumen no van a la bitácora
                DB::statement("SELECT audit.track('{$t}')");
            }
        }
        // RN-PER-06 y RN-PER-12: marcaciones y libro de comisiones de solo inserción; RN-PER-16: la supervisión no se borra.
        DB::statement('REVOKE UPDATE, DELETE, TRUNCATE ON attendance_marks, commission_entries FROM aycha_app');
        DB::statement('REVOKE DELETE, TRUNCATE ON supervision_actions, staff_payouts FROM aycha_app');

        // PER-06: todos marcan su asistencia (per.attendance.mark es de todos); los roles sin PER lo leen para ver su app.
        DB::statement(<<<'SQL'
            INSERT INTO role_module_access (tenant_id, role_id, module_code, actions, created_at)
            SELECT r.tenant_id, r.id, 'PER', 'L', now() FROM roles r
            WHERE r.code NOT IN ('GERENTE', 'AUDITOR', 'CLIENTE_B2B', 'SOPORTE_PLATAFORMA', 'SOPORTE_TECNICO')
            ON CONFLICT (tenant_id, role_id, module_code) DO NOTHING
        SQL);

        if (DB::table('employees')->exists()) {
            (new PerDemoSeeder)->run();
        }
    }

    public function down(): void
    {
        DB::statement("DELETE FROM role_module_access WHERE module_code = 'PER' AND actions = 'L' AND role_id IN (SELECT id FROM roles WHERE code NOT IN ('ADMINISTRACION','SUPERVISORA_VENTAS','JEFE_PRODUCCION','CONTADORA','RRHH'))");
        foreach (array_reverse(self::TABLAS) as $t) {
            DB::statement("DROP TABLE IF EXISTS {$t} CASCADE");
        }
        DB::statement('DROP FUNCTION IF EXISTS per_supervision_inmutable() CASCADE');
        DB::statement('DROP FUNCTION IF EXISTS per_pago_cerrado() CASCADE');
    }
};
