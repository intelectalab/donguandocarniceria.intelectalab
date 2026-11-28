<?php

use Database\Seeders\PrsDemoSeeder;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

// PRS · Presupuesto (fase 3). Las 8 tablas del módulo (aycha-proto/dist/tablas.md, sección PRS):
//  - budget_concepts: árbol de conceptos (grupos y conceptos de detalle) con tipo (ingreso, costo de ventas, gasto) y si es
//    fijo o variable (RN-PRS-08).
//  - budget_concept_mappings: de dónde sale el real de cada concepto (ventas de FAC, costo de ventas, categoría de gasto de GAS,
//    personal de PER o cuenta contable de CNT). Una fuente cuenta una sola vez (RN-PRS-06): índice único por fuente y referencia.
//  - budgets: uno por empresa y año (RN-PRS-01).
//  - budget_versions: borrador → enviada → aprobada (una sola vigente, RN-PRS-03) → reemplazada; o rechazada. Quien aprueba no es
//    quien envió ni quien la elaboró (RN-PRS-05, también en la base).
//  - budget_lines: concepto × mes × marca/local/centro de costo, en soles sin IGV y no negativos (RN-PRS-11), con al menos una
//    dimensión (RN-PRS-01) y una sola por combinación (RN-PRS-13). Las de una versión enviada, aprobada o reemplazada no
//    cambian (RN-PRS-04, trigger).
//  - budget_actuals: real congelado de un mes cerrado, de solo inserción; recalcular crea una corrida nueva (RN-PRS-09).
//  - budget_forecasts: proyecciones de cierre guardadas (RN-PRS-08), de solo inserción.
//  - budget_alerts: desvíos de la proyección sobre el presupuesto (RN-PRS-10), una abierta por línea y mes.
// Función budget_traffic_light (RN-PRS-07) y vista budget_vs_actual_v (líneas de la versión vigente con su real congelado).
// Al final siembra la demo (PrsDemoSeeder) si la base ya tiene datos; en una base nueva la siembra el DatabaseSeeder.
return new class extends Migration
{
    public function up(): void
    {
        $base = "id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id uuid NOT NULL DEFAULT app_tenant_id() REFERENCES tenants(id) ON DELETE RESTRICT";
        $fechas = 'created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz';

        DB::statement(<<<SQL
            CREATE TABLE budget_concepts (
              {$base},
              code varchar(20) NOT NULL,
              name varchar(120) NOT NULL,
              parent_id uuid REFERENCES budget_concepts(id) ON DELETE RESTRICT,
              is_group boolean NOT NULL DEFAULT false,
              concept_type varchar(14) NOT NULL CHECK (concept_type IN ('INCOME','COST_OF_SALES','EXPENSE')),
              behavior varchar(10) CHECK (behavior IN ('VARIABLE','FIXED')),
              default_cost_center_id uuid REFERENCES cost_centers(id) ON DELETE SET NULL,
              status varchar(10) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
              sort_order integer NOT NULL DEFAULT 900,
              {$fechas},
              CHECK (is_group OR behavior IS NOT NULL),
              CHECK (NOT is_group OR parent_id IS NULL)
            )
        SQL);
        DB::statement('CREATE UNIQUE INDEX budget_concepts_codigo ON budget_concepts (tenant_id, upper(code))');

        DB::statement(<<<SQL
            CREATE TABLE budget_concept_mappings (
              {$base},
              concept_id uuid NOT NULL REFERENCES budget_concepts(id) ON DELETE RESTRICT,
              source varchar(20) NOT NULL CHECK (source IN ('SALES','COST_OF_SALES','EXPENSE_CATEGORY','PAYROLL','ACCOUNT')),
              ref varchar(60),
              note text,
              status varchar(10) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
              created_by uuid REFERENCES users(id) ON DELETE RESTRICT,
              removed_by uuid REFERENCES users(id) ON DELETE RESTRICT,
              removed_at timestamptz,
              {$fechas},
              CHECK (source IN ('SALES','COST_OF_SALES') OR ref IS NOT NULL),
              CHECK (source <> 'PAYROLL' OR ref IN ('PAYROLL','COMMISSION','BONUS')),
              CHECK (source <> 'ACCOUNT' OR ref ~ '^[0-9]{2,8}$')
            )
        SQL);
        // RN-PRS-06: una misma fuente (categoría, tipo de costo de personal, cuenta, ventas) va a un solo concepto.
        DB::statement("CREATE UNIQUE INDEX budget_concept_mappings_fuente ON budget_concept_mappings (tenant_id, source, coalesce(ref, '')) WHERE status = 'ACTIVE'");
        DB::statement('CREATE INDEX budget_concept_mappings_concepto ON budget_concept_mappings (concept_id)');

        DB::statement(<<<SQL
            CREATE TABLE budgets (
              {$base},
              company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
              year smallint NOT NULL CHECK (year BETWEEN 2020 AND 2100),
              name varchar(120) NOT NULL,
              status varchar(10) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
              current_version_id uuid,
              created_by uuid REFERENCES users(id) ON DELETE RESTRICT,
              {$fechas}
            )
        SQL);
        DB::statement('CREATE UNIQUE INDEX budgets_empresa_anio ON budgets (tenant_id, company_id, year)');   // RN-PRS-01

        DB::statement(<<<SQL
            CREATE TABLE budget_versions (
              {$base},
              budget_id uuid NOT NULL REFERENCES budgets(id) ON DELETE RESTRICT,
              version_no integer NOT NULL CHECK (version_no >= 1),
              name varchar(160) NOT NULL,
              status varchar(12) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SUBMITTED','APPROVED','REJECTED','SUPERSEDED')),
              based_on_version_id uuid REFERENCES budget_versions(id) ON DELETE SET NULL,
              source varchar(14) NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL','COPY_VERSION','COPY_ACTUAL','IMPORT')),
              adjust_pct numeric(7,2) NOT NULL DEFAULT 0,
              created_by uuid REFERENCES users(id) ON DELETE RESTRICT,
              submitted_by uuid REFERENCES users(id) ON DELETE RESTRICT, submitted_at timestamptz,
              approved_by uuid REFERENCES users(id) ON DELETE RESTRICT, approved_at timestamptz,
              rejected_by uuid REFERENCES users(id) ON DELETE RESTRICT, rejected_at timestamptz,
              decision_comment text,
              superseded_at timestamptz,
              superseded_by_version_id uuid REFERENCES budget_versions(id) ON DELETE SET NULL,
              history jsonb NOT NULL DEFAULT '[]'::jsonb,
              {$fechas},
              CHECK (status NOT IN ('SUBMITTED','APPROVED','SUPERSEDED') OR submitted_by IS NOT NULL),
              CHECK (status NOT IN ('APPROVED','SUPERSEDED') OR approved_by IS NOT NULL),
              CHECK (approved_by IS NULL OR (approved_by IS DISTINCT FROM submitted_by AND approved_by IS DISTINCT FROM created_by)),
              CHECK (rejected_by IS NULL OR (rejected_by IS DISTINCT FROM submitted_by AND rejected_by IS DISTINCT FROM created_by))
            )
        SQL);
        DB::statement('CREATE UNIQUE INDEX budget_versions_numero ON budget_versions (budget_id, version_no)');
        DB::statement("CREATE UNIQUE INDEX budget_versions_una_vigente ON budget_versions (budget_id) WHERE status = 'APPROVED'");   // RN-PRS-03
        DB::statement('ALTER TABLE budgets ADD CONSTRAINT budgets_version_vigente FOREIGN KEY (current_version_id) REFERENCES budget_versions(id) ON DELETE SET NULL');

        DB::statement(<<<SQL
            CREATE TABLE budget_lines (
              {$base},
              version_id uuid NOT NULL REFERENCES budget_versions(id) ON DELETE RESTRICT,
              concept_id uuid NOT NULL REFERENCES budget_concepts(id) ON DELETE RESTRICT,
              month date NOT NULL CHECK (extract(day FROM month) = 1),
              brand_id uuid REFERENCES brands(id) ON DELETE RESTRICT,
              establishment_id uuid REFERENCES establishments(id) ON DELETE RESTRICT,
              cost_center_id uuid REFERENCES cost_centers(id) ON DELETE RESTRICT,
              amount numeric(14,2) NOT NULL CHECK (amount >= 0),
              note text,
              {$fechas},
              CHECK (brand_id IS NOT NULL OR establishment_id IS NOT NULL OR cost_center_id IS NOT NULL)
            )
        SQL);
        // RN-PRS-13: una sola línea por concepto, mes, marca, local y centro de costo.
        DB::statement("CREATE UNIQUE INDEX budget_lines_unica ON budget_lines (version_id, concept_id, month,
            coalesce(brand_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(establishment_id, '00000000-0000-0000-0000-000000000000'::uuid),
            coalesce(cost_center_id, '00000000-0000-0000-0000-000000000000'::uuid))");
        DB::statement('CREATE INDEX budget_lines_version_mes ON budget_lines (version_id, month)');

        DB::statement(<<<SQL
            CREATE TABLE budget_actuals (
              {$base},
              company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
              period date NOT NULL CHECK (extract(day FROM period) = 1),
              run_id uuid NOT NULL,
              run_no integer NOT NULL CHECK (run_no >= 1),
              concept_id uuid REFERENCES budget_concepts(id) ON DELETE RESTRICT,
              brand_id uuid REFERENCES brands(id) ON DELETE RESTRICT,
              establishment_id uuid REFERENCES establishments(id) ON DELETE RESTRICT,
              cost_center_id uuid REFERENCES cost_centers(id) ON DELETE RESTRICT,
              source varchar(10) NOT NULL CHECK (source IN ('FAC','GAS','PER','PER_EST','CNT')),
              amount numeric(14,2) NOT NULL,
              frozen_at timestamptz NOT NULL,
              frozen_by uuid REFERENCES users(id) ON DELETE RESTRICT,
              reason text NOT NULL,
              {$fechas}
            )
        SQL);
        DB::statement('CREATE INDEX budget_actuals_periodo ON budget_actuals (tenant_id, company_id, period, run_no)');

        DB::statement(<<<SQL
            CREATE TABLE budget_forecasts (
              {$base},
              version_id uuid NOT NULL REFERENCES budget_versions(id) ON DELETE RESTRICT,
              period date NOT NULL CHECK (extract(day FROM period) = 1),
              run_id uuid NOT NULL,
              as_of date NOT NULL,
              method varchar(20) NOT NULL DEFAULT 'LINEAR_DAYS',
              concept_id uuid NOT NULL REFERENCES budget_concepts(id) ON DELETE RESTRICT,
              brand_id uuid REFERENCES brands(id) ON DELETE RESTRICT,
              establishment_id uuid REFERENCES establishments(id) ON DELETE RESTRICT,
              cost_center_id uuid REFERENCES cost_centers(id) ON DELETE RESTRICT,
              budget numeric(14,2) NOT NULL DEFAULT 0,
              actual numeric(14,2) NOT NULL DEFAULT 0,
              forecast numeric(14,2) NOT NULL DEFAULT 0,
              forecast_pct numeric(9,1),
              light varchar(5) CHECK (light IN ('GREEN','AMBER','RED')),
              days_elapsed integer NOT NULL, days_in_month integer NOT NULL,
              created_by uuid REFERENCES users(id) ON DELETE RESTRICT,
              {$fechas}
            )
        SQL);
        DB::statement('CREATE INDEX budget_forecasts_version_mes ON budget_forecasts (version_id, period, created_at)');

        DB::statement(<<<SQL
            CREATE TABLE budget_alerts (
              {$base},
              version_id uuid NOT NULL REFERENCES budget_versions(id) ON DELETE RESTRICT,
              period date NOT NULL CHECK (extract(day FROM period) = 1),
              slot_key varchar(160) NOT NULL,
              concept_id uuid NOT NULL REFERENCES budget_concepts(id) ON DELETE RESTRICT,
              brand_id uuid REFERENCES brands(id) ON DELETE RESTRICT,
              establishment_id uuid REFERENCES establishments(id) ON DELETE RESTRICT,
              cost_center_id uuid REFERENCES cost_centers(id) ON DELETE RESTRICT,
              kind varchar(10) NOT NULL DEFAULT 'FORECAST' CHECK (kind IN ('FORECAST')),
              level varchar(5) NOT NULL CHECK (level IN ('AMBER','RED')),
              status varchar(10) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','ACK','CLOSED','RESOLVED')),
              budget numeric(14,2) NOT NULL, actual numeric(14,2) NOT NULL, forecast numeric(14,2) NOT NULL, pct numeric(9,1),
              as_of date NOT NULL, days_elapsed integer NOT NULL,
              owner_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
              notified jsonb NOT NULL DEFAULT '[]'::jsonb,
              comments jsonb NOT NULL DEFAULT '[]'::jsonb,
              raised_at timestamptz NOT NULL DEFAULT now(),
              closed_at timestamptz,
              {$fechas}
            )
        SQL);
        DB::statement("CREATE UNIQUE INDEX budget_alerts_una_abierta ON budget_alerts (version_id, period, slot_key) WHERE status IN ('OPEN','ACK')");
        DB::statement('CREATE INDEX budget_alerts_estado ON budget_alerts (tenant_id, status, period)');

        DB::unprepared(<<<'SQL'
            -- RN-PRS-07: semáforo de un % de ejecución (o de proyección) según el tipo de concepto.
            CREATE OR REPLACE FUNCTION budget_traffic_light(p_pct numeric, p_type text, p_amber numeric DEFAULT 5) RETURNS text
            LANGUAGE sql IMMUTABLE AS $$
                SELECT CASE
                    WHEN p_pct IS NULL THEN NULL
                    WHEN p_type = 'INCOME' THEN CASE WHEN p_pct >= 100 THEN 'GREEN' WHEN p_pct >= 100 - p_amber THEN 'AMBER' ELSE 'RED' END
                    ELSE CASE WHEN p_pct <= 100 THEN 'GREEN' WHEN p_pct <= 100 + p_amber THEN 'AMBER' ELSE 'RED' END
                END
            $$;

            -- RN-PRS-04: las líneas de una versión enviada, aprobada o reemplazada no cambian.
            CREATE OR REPLACE FUNCTION prs_linea_bloqueada() RETURNS trigger LANGUAGE plpgsql AS $$
            DECLARE
                v_estado text;
            BEGIN
                SELECT status INTO v_estado FROM budget_versions WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.version_id ELSE NEW.version_id END;
                IF v_estado NOT IN ('DRAFT', 'REJECTED') THEN
                    RAISE EXCEPTION 'RN-PRS-04: la versión no está en borrador y sus líneas no se modifican; crea una revisión nueva' USING ERRCODE = 'check_violation';
                END IF;
                IF TG_OP = 'UPDATE' AND NEW.version_id IS DISTINCT FROM OLD.version_id THEN
                    SELECT status INTO v_estado FROM budget_versions WHERE id = OLD.version_id;
                    IF v_estado NOT IN ('DRAFT', 'REJECTED') THEN
                        RAISE EXCEPTION 'RN-PRS-04: la versión de origen no está en borrador' USING ERRCODE = 'check_violation';
                    END IF;
                END IF;
                RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
            END $$;
            CREATE TRIGGER budget_lines_bloqueo BEFORE INSERT OR UPDATE OR DELETE ON budget_lines
                FOR EACH ROW EXECUTE FUNCTION prs_linea_bloqueada();

            -- RN-PRS-04 y RN-PRS-05: una versión aprobada o reemplazada no vuelve atrás; quien aprueba no es quien envió.
            CREATE OR REPLACE FUNCTION prs_version_estado() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                IF TG_OP = 'DELETE' THEN
                    IF OLD.status <> 'DRAFT' THEN
                        RAISE EXCEPTION 'RN-PRS-04: solo se borra una versión en borrador' USING ERRCODE = 'check_violation';
                    END IF;
                    RETURN OLD;
                END IF;
                IF OLD.status = 'SUPERSEDED' AND NEW.status <> 'SUPERSEDED' THEN
                    RAISE EXCEPTION 'RN-PRS-04: una versión reemplazada no cambia de estado' USING ERRCODE = 'check_violation';
                END IF;
                IF OLD.status = 'APPROVED' AND NEW.status NOT IN ('APPROVED', 'SUPERSEDED') THEN
                    RAISE EXCEPTION 'RN-PRS-04: una versión aprobada solo pasa a reemplazada' USING ERRCODE = 'check_violation';
                END IF;
                IF NEW.status = 'APPROVED' AND OLD.status <> 'APPROVED' AND (NEW.approved_by = NEW.submitted_by OR NEW.approved_by = NEW.created_by) THEN
                    RAISE EXCEPTION 'RN-PRS-05: quien aprueba una versión es distinto de quien la envió' USING ERRCODE = 'check_violation';
                END IF;
                RETURN NEW;
            END $$;
            CREATE TRIGGER budget_versions_estado BEFORE UPDATE OR DELETE ON budget_versions
                FOR EACH ROW EXECUTE FUNCTION prs_version_estado();

            -- Líneas de la versión vigente de cada presupuesto con el real del último snapshot de ese mes (si lo hay).
            CREATE VIEW budget_vs_actual_v WITH (security_invoker = true) AS
            SELECT b.id AS budget_id, b.company_id, b.year, l.version_id, l.concept_id, c.concept_type, l.month,
                   l.brand_id, l.establishment_id, l.cost_center_id, l.amount AS budget,
                   (SELECT sum(a.amount) FROM budget_actuals a
                     WHERE a.company_id = b.company_id AND a.period = l.month AND a.concept_id = l.concept_id
                       AND a.brand_id IS NOT DISTINCT FROM l.brand_id AND a.establishment_id IS NOT DISTINCT FROM l.establishment_id
                       AND a.cost_center_id IS NOT DISTINCT FROM l.cost_center_id
                       AND a.run_no = (SELECT max(x.run_no) FROM budget_actuals x WHERE x.company_id = b.company_id AND x.period = l.month)) AS frozen_actual
              FROM budgets b
              JOIN budget_versions v ON v.budget_id = b.id AND v.status = 'APPROVED'
              JOIN budget_lines l ON l.version_id = v.id
              JOIN budget_concepts c ON c.id = l.concept_id;
        SQL);

        foreach (['budget_concepts', 'budget_concept_mappings', 'budgets', 'budget_versions', 'budget_lines', 'budget_actuals', 'budget_forecasts', 'budget_alerts'] as $t) {
            DB::statement("CREATE INDEX {$t}_tenant ON {$t} (tenant_id)");
            DB::statement("SELECT enable_tenant_rls('{$t}')");
            if (! in_array($t, ['budget_lines', 'budget_actuals', 'budget_forecasts'], true)) {   // las de alto volumen no van a la bitácora
                DB::statement("SELECT audit.track('{$t}')");
            }
        }
        DB::statement('GRANT SELECT ON budget_vs_actual_v TO aycha_app');
        // RN-PRS-09: el real congelado y las proyecciones guardadas son de solo inserción.
        DB::statement('REVOKE UPDATE, DELETE, TRUNCATE ON budget_actuals, budget_forecasts FROM aycha_app');

        // Demo: en una base ya sembrada (la del equipo) se siembra aquí; en una nueva, después, desde el DatabaseSeeder.
        if (DB::table('cost_centers')->exists()) {
            (new PrsDemoSeeder)->run();
        }
    }

    public function down(): void
    {
        DB::statement('DROP VIEW IF EXISTS budget_vs_actual_v');
        DB::statement('ALTER TABLE IF EXISTS budgets DROP CONSTRAINT IF EXISTS budgets_version_vigente');
        foreach (['budget_alerts', 'budget_forecasts', 'budget_actuals', 'budget_lines', 'budget_versions', 'budgets', 'budget_concept_mappings', 'budget_concepts'] as $t) {
            DB::statement("DROP TABLE IF EXISTS {$t} CASCADE");
        }
        DB::statement('DROP FUNCTION IF EXISTS prs_linea_bloqueada() CASCADE');
        DB::statement('DROP FUNCTION IF EXISTS prs_version_estado() CASCADE');
        DB::statement('DROP FUNCTION IF EXISTS budget_traffic_light(numeric, text, numeric)');
    }
};
