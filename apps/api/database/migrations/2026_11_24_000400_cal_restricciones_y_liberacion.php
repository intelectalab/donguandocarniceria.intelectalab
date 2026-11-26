<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

// CAL · Calidad. Las tablas existen desde el 03/11 (2026_11_03_002700_cal_calidad.php, generadas del prototipo);
// esta migración pone sus reglas en la base:
//  - CHECK de etapas, estados, tipos, severidades, resultados y decisiones;
//  - RN-CAL-01: con CAL activo, el estado de calidad de un lote de producción o despiece solo cambia con una
//    decisión de calidad (CalidadService fija app.cal_decision dentro de su transacción). Un UPDATE directo
//    de lots.qc_status se rechaza con «RN-CAL-01: …». El retiro de ETQ también pasa por aquí;
//  - RN-PRO-05: con CAL activo, un lote nuevo de producción o despiece entra en QUARANTINE aunque pida otro
//    estado (queda en requested_qc_status);
//  - RN-CAL-05, 06 (parte), 12 y 17 como CHECK; RN-CAL-16: lecturas y decisiones de solo inserción
//    (de una lectura solo se completa la excursión y la aprobación de calidad, RN-CAL-15);
//  - únicos de número por empresa y nuevas columnas: cierre de la excursión con sus lotes, tareas de limpieza
//    (RN-CAL-13) y la ruta del archivo del reclamo.
return new class extends Migration
{
    public function up(): void
    {
        $checks = [
            'qc_checklists' => [
                'etapa' => "stage IN ('RECEPTION','PROCESS','PRODUCTION','PACKING','STORAGE','DISPATCH','CLEANING','BPM')",
                'estado' => "status IN ('DRAFT','ACTIVE','RETIRED')",
            ],
            'qc_checklist_items' => [
                'tipo' => "answer_type IN ('YES_NO','NUMBER','TEXT','PHOTO')",
                'rango' => "answer_type <> 'NUMBER' OR min_value IS NULL OR max_value IS NULL OR min_value <= max_value",
            ],
            'qc_schedules' => [
                'frecuencia' => "frequency IN ('PER_SHIFT','DAILY','WEEKLY','MONTHLY')",
                'estado' => "status IN ('ACTIVE','INACTIVE')",
                'dia' => 'weekday IS NULL OR weekday BETWEEN 0 AND 6',
            ],
            'qc_inspections' => [
                'estado' => "status IN ('IN_PROGRESS','DONE')",
                'resultado' => "result IN ('PASS','FAIL','PENDING')",
                'puntaje' => 'score_pct BETWEEN 0 AND 100',
                'turno' => "shift IN ('M','T','N')",
            ],
            'temperature_points' => [
                'tipo' => "point_type IN ('COLD_ROOM','FREEZER','POT','VEHICLE','DISPLAY','PRODUCT')",
                'rango' => 'min_c <= max_c AND reading_frequency_min > 0',
                'estado' => "status IN ('ACTIVE','INACTIVE')",
            ],
            'temperature_readings' => [
                'origen' => "source IN ('MANUAL','SENSOR')",
            ],
            'temperature_excursions' => [
                'estado' => "status IN ('OPEN','CLOSED')",
                // RN-CAL-05
                'accion' => "status <> 'CLOSED' OR btrim(coalesce(action_taken, '')) <> ''",
            ],
            'lot_quality_decisions' => [
                'decision' => "decision IN ('RELEASE','RELEASE_WITH_NOTE','HOLD','REJECT')",
                'estado' => "new_status IN ('RELEASED','BLOCKED','REJECTED')",
                // RN-CAL-17
                'rechazo' => "decision <> 'REJECT' OR (btrim(coalesce(reason, '')) <> '' AND reject_destination IN ('WASTE','REPROCESS'))",
                'nota' => "decision <> 'RELEASE_WITH_NOTE' OR btrim(coalesce(reason, '')) <> ''",
            ],
            'nonconformities' => [
                'origen' => "source IN ('RECEPTION','PROCESS','PACKING','TEMPERATURE','SUPPLIER','CUSTOMER_CLAIM','AUDIT','EQUIPMENT','CCP','OTHER')",
                'severidad' => "severity IN ('MINOR','MAJOR','CRITICAL')",
                'estado' => "status IN ('OPEN','IN_PROGRESS','VERIFICATION','CLOSED')",
                // RN-CAL-06 (la parte de las acciones la valida CalidadService)
                'cierre' => "status <> 'CLOSED' OR btrim(coalesce(root_cause, '')) <> ''",
            ],
            'corrective_actions' => [
                'tipo' => "action_type IN ('CORRECTION','CORRECTIVE','PREVENTIVE')",
                'estado' => "status IN ('PENDING','DONE','VERIFIED','CANCELLED')",
            ],
            'sanitary_registrations' => [
                'autoridad' => "authority IN ('DIGESA','SENASA')",
                'tipo' => "registration_type IN ('SANITARY_REGISTRY','SANITARY_AUTHORIZATION','HEALTH_CERTIFICATE')",
                'estado' => "status IN ('ACTIVE','EXPIRED','REPLACED','CANCELLED')",
                'vigencia' => 'expires_on > issued_on',
            ],
            'quality_claims' => [
                'tipo' => "claim_type IN ('SPOILED','FOREIGN_BODY','TEMPERATURE','WRONG_WEIGHT','PACKAGING','TASTE','LABEL','OTHER')",
                'estado' => "status IN ('OPEN','INVESTIGATING','RESOLVED','REJECTED')",
                'resolucion' => "resolution IS NULL OR resolution IN ('NONE','REPLACEMENT','CREDIT_NOTE','REFUND','RETURN')",
                // RN-CAL-12
                'resuelto' => "status <> 'RESOLVED' OR resolution IS NOT NULL",
                'nota_credito' => "status <> 'RESOLVED' OR resolution <> 'CREDIT_NOTE' OR credit_note_id IS NOT NULL",
            ],
        ];
        foreach ($checks as $t => $lista) {
            foreach ($lista as $nombre => $expr) {
                DB::statement("ALTER TABLE {$t} ADD CONSTRAINT {$t}_{$nombre} CHECK ({$expr})");
            }
        }

        // Números únicos por empresa.
        foreach (['qc_inspections', 'nonconformities', 'quality_claims'] as $t) {
            DB::statement("CREATE UNIQUE INDEX {$t}_numero ON {$t} (tenant_id, number)");
        }
        DB::statement('CREATE UNIQUE INDEX qc_checklists_codigo ON qc_checklists (tenant_id, code, version)');
        DB::statement('CREATE UNIQUE INDEX temperature_points_codigo ON temperature_points (tenant_id, code)');
        DB::statement("CREATE UNIQUE INDEX temperature_excursions_una_abierta ON temperature_excursions (point_id) WHERE status = 'OPEN'");
        DB::statement('CREATE INDEX temperature_readings_punto ON temperature_readings (point_id, read_at)');
        DB::statement('CREATE INDEX lot_quality_decisions_lote ON lot_quality_decisions (lot_id, decided_at)');

        // Columnas que pide la spec y el prototipo no guardaba.
        DB::statement('ALTER TABLE temperature_excursions ADD COLUMN IF NOT EXISTS last_value_c numeric(14,2)');
        DB::statement('ALTER TABLE quality_claims ADD COLUMN IF NOT EXISTS resolution_notes text');
        DB::statement('ALTER TABLE quality_claims ADD COLUMN IF NOT EXISTS registered_by uuid REFERENCES users(id)');
        DB::statement('ALTER TABLE quality_claims ALTER COLUMN sales_order_id DROP NOT NULL');
        DB::statement('ALTER TABLE quality_claims ALTER COLUMN sales_document_id DROP NOT NULL');
        DB::statement('ALTER TABLE quality_claims ALTER COLUMN photo_url TYPE varchar(255)');
        DB::statement('ALTER TABLE temperature_readings ALTER COLUMN photo_url TYPE varchar(255)');
        DB::statement('ALTER TABLE corrective_actions ADD COLUMN IF NOT EXISTS verified_by uuid REFERENCES users(id)');
        DB::statement('ALTER TABLE corrective_actions ADD COLUMN IF NOT EXISTS verified_at timestamptz');
        DB::statement('ALTER TABLE corrective_actions ADD COLUMN IF NOT EXISTS notes text');
        DB::statement('ALTER TABLE nonconformities ADD COLUMN IF NOT EXISTS closing_notes text');
        DB::statement('ALTER TABLE nonconformities ADD COLUMN IF NOT EXISTS lot_previous_status varchar(20)');

        // RN-CAL-13: tareas de limpieza y BPM del día, generadas por la programación (CAL-12).
        DB::statement(<<<'SQL'
            CREATE TABLE qc_schedule_tasks (
                id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                tenant_id uuid NOT NULL DEFAULT app_tenant_id() REFERENCES tenants(id),
                schedule_id uuid NOT NULL REFERENCES qc_schedules(id),
                task_date date NOT NULL,
                shift varchar(2) NOT NULL DEFAULT 'M',
                status varchar(20) NOT NULL DEFAULT 'PENDING',
                inspection_id uuid REFERENCES qc_inspections(id),
                done_at timestamptz,
                done_by uuid REFERENCES users(id),
                evidence_url varchar(255),
                notes text,
                created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at timestamptz,
                CONSTRAINT qc_schedule_tasks_estado CHECK (status IN ('PENDING','DONE','MISSED')),
                CONSTRAINT qc_schedule_tasks_turno CHECK (shift IN ('M','T','N','D'))
            )
        SQL);
        DB::statement('CREATE INDEX qc_schedule_tasks_tenant ON qc_schedule_tasks (tenant_id)');
        DB::statement('CREATE UNIQUE INDEX qc_schedule_tasks_unica ON qc_schedule_tasks (schedule_id, task_date, shift)');
        DB::statement("SELECT enable_tenant_rls('qc_schedule_tasks')");
        DB::statement("SELECT audit.track('qc_schedule_tasks')");

        // RN-CAL-16: solo inserción. De una lectura se completa después su excursión y la aprobación de calidad (RN-CAL-15).
        DB::statement('REVOKE UPDATE, DELETE, TRUNCATE ON lot_quality_decisions FROM aycha_app');
        DB::statement('REVOKE UPDATE, DELETE, TRUNCATE ON temperature_readings FROM aycha_app');
        DB::statement('GRANT UPDATE (excursion_id, approved_by, approved_at, updated_at) ON temperature_readings TO aycha_app');

        // RN-CAL-01 y RN-PRO-05 sobre lots (tabla de ALM): el guardia de calidad para lotes de producción y despiece.
        DB::statement(<<<'SQL'
            CREATE OR REPLACE FUNCTION cal_activo() RETURNS boolean
                LANGUAGE sql STABLE
                AS $$ SELECT EXISTS (SELECT 1 FROM tenant_modules WHERE module_code = 'CAL' AND enabled) $$
        SQL);
        DB::statement(<<<'SQL'
            CREATE OR REPLACE FUNCTION cal_guard_lot_qc() RETURNS trigger
                LANGUAGE plpgsql
                AS $$
                BEGIN
                    IF NEW.origin NOT IN ('PRODUCTION', 'CUTTING') OR NOT cal_activo() THEN
                        RETURN NEW;
                    END IF;
                    IF TG_OP = 'INSERT' THEN
                        IF NEW.qc_status <> 'QUARANTINE' THEN
                            NEW.requested_qc_status := NEW.qc_status;
                            NEW.qc_status := 'QUARANTINE';
                        END IF;
                        RETURN NEW;
                    END IF;
                    IF NEW.qc_status IS DISTINCT FROM OLD.qc_status
                       AND coalesce(current_setting('app.cal_decision', true), '') <> 'on' THEN
                        RAISE EXCEPTION 'RN-CAL-01: el estado de calidad de un lote de producción o despiece solo cambia con una decisión de calidad.'
                            USING ERRCODE = 'P0001';
                    END IF;
                    RETURN NEW;
                END
                $$
        SQL);
        DB::statement('CREATE TRIGGER lots_cal_guard BEFORE INSERT OR UPDATE OF qc_status ON lots FOR EACH ROW EXECUTE FUNCTION cal_guard_lot_qc()');
    }

    public function down(): void
    {
        DB::statement('DROP TRIGGER IF EXISTS lots_cal_guard ON lots');
        DB::statement('DROP FUNCTION IF EXISTS cal_guard_lot_qc()');
        DB::statement('DROP FUNCTION IF EXISTS cal_activo()');
        DB::statement('DROP TABLE IF EXISTS qc_schedule_tasks');
        DB::statement('GRANT UPDATE, DELETE ON lot_quality_decisions, temperature_readings TO aycha_app');
    }
};
