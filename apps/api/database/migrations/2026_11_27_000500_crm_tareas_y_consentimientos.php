<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

// CRM-06 Supervisión en vivo, CRM-17 Mis tareas y CRM-18 Consentimientos y avisos (RN-CRM-02, 08, 14, 19 y 21).
//  - Tareas: la hora y el resultado de una tarea hecha quedan guardados y no cambian; las tareas no se borran.
//    Una tarea puede quedar sin responsable (la toma la supervisión). Un chat tiene una sola tarea abierta de
//    «chat sin responder».
//  - Consentimientos: siempre con evidencia, de un cliente o de un contacto, con propósito y canal válidos (Ley 29733).
return new class extends Migration
{
    private const TIPOS = "'CALLBACK','REBUY','FOLLOW_UP','SURVEY_FOLLOW_UP','ALERT_REVIEW','UNANSWERED_CHAT'";

    public function up(): void
    {
        DB::statement("ALTER TABLE crm_tasks ALTER COLUMN done_at TYPE timestamptz(6) USING nullif(done_at, '')::timestamptz");
        DB::statement('ALTER TABLE crm_tasks ALTER COLUMN result TYPE text');
        DB::statement('ALTER TABLE crm_tasks ALTER COLUMN assigned_user_id DROP NOT NULL');
        DB::statement('ALTER TABLE crm_tasks ADD COLUMN IF NOT EXISTS done_by uuid REFERENCES users (id) ON DELETE RESTRICT');
        DB::statement('ALTER TABLE crm_tasks ADD CONSTRAINT crm_tasks_tipo CHECK (task_type IN ('.self::TIPOS.'))');
        DB::statement("ALTER TABLE crm_tasks ADD CONSTRAINT crm_tasks_estado CHECK (status IN ('OPEN','DONE'))");
        DB::statement("ALTER TABLE crm_tasks ADD CONSTRAINT crm_tasks_hecha CHECK (status <> 'DONE' OR (done_at IS NOT NULL AND length(btrim(coalesce(result, ''))) > 0))");
        DB::statement('ALTER TABLE crm_tasks ADD CONSTRAINT crm_tasks_resultado CHECK (result IS NULL OR length(result) <= 1000)');
        DB::statement("CREATE UNIQUE INDEX IF NOT EXISTS crm_tasks_un_sin_responder ON crm_tasks (conversation_id) WHERE task_type = 'UNANSWERED_CHAT' AND status = 'OPEN'");
        DB::statement('CREATE INDEX IF NOT EXISTS crm_tasks_bandeja ON crm_tasks (assigned_user_id, status, due_at)');
        DB::statement('REVOKE DELETE, TRUNCATE ON crm_tasks FROM aycha_app');
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION crm_tarea_hecha_no_cambia() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                IF OLD.status = 'DONE' AND (NEW.status, NEW.result, NEW.done_at, NEW.done_by, NEW.task_type, NEW.due_at, NEW.note)
                    IS DISTINCT FROM (OLD.status, OLD.result, OLD.done_at, OLD.done_by, OLD.task_type, OLD.due_at, OLD.note) THEN
                    RAISE EXCEPTION 'RN-CRM-19: una tarea hecha no se reabre ni cambia su resultado' USING ERRCODE = 'check_violation';
                END IF;
                RETURN NEW;
            END $$;
            DROP TRIGGER IF EXISTS crm_tarea_hecha_no_cambia ON crm_tasks;
            CREATE TRIGGER crm_tarea_hecha_no_cambia BEFORE UPDATE ON crm_tasks FOR EACH ROW EXECUTE FUNCTION crm_tarea_hecha_no_cambia();
            SQL);

        DB::statement("ALTER TABLE contact_consents ADD CONSTRAINT contact_consents_proposito CHECK (purpose IN ('DATA_PROCESSING','MARKETING','RECORDING_NOTICE','SURVEY'))");
        DB::statement("ALTER TABLE contact_consents ADD CONSTRAINT contact_consents_canal CHECK (channel IN
            ('WHATSAPP','MESSENGER','INSTAGRAM','TIKTOK','FACEBOOK','PHONE','WEB','POS','COUNTER'))");
        DB::statement('ALTER TABLE contact_consents ADD CONSTRAINT contact_consents_de_quien CHECK (customer_id IS NOT NULL OR contact_id IS NOT NULL)');
        DB::statement('ALTER TABLE contact_consents ADD CONSTRAINT contact_consents_evidencia CHECK (evidence_message_id IS NOT NULL OR length(btrim(evidence_text)) >= 5)');
        DB::statement('CREATE INDEX IF NOT EXISTS contact_consents_historial ON contact_consents (recorded_at DESC)');
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS contact_consents_historial');
        foreach (['evidencia', 'de_quien', 'canal', 'proposito'] as $c) {
            DB::statement("ALTER TABLE contact_consents DROP CONSTRAINT IF EXISTS contact_consents_{$c}");
        }
        DB::statement('DROP TRIGGER IF EXISTS crm_tarea_hecha_no_cambia ON crm_tasks');
        DB::statement('DROP FUNCTION IF EXISTS crm_tarea_hecha_no_cambia()');
        DB::statement('GRANT DELETE ON crm_tasks TO aycha_app');
        DB::statement('DROP INDEX IF EXISTS crm_tasks_bandeja');
        DB::statement('DROP INDEX IF EXISTS crm_tasks_un_sin_responder');
        foreach (['resultado', 'hecha', 'estado', 'tipo'] as $c) {
            DB::statement("ALTER TABLE crm_tasks DROP CONSTRAINT IF EXISTS crm_tasks_{$c}");
        }
        DB::statement('ALTER TABLE crm_tasks DROP COLUMN IF EXISTS done_by');
        DB::statement('ALTER TABLE crm_tasks ALTER COLUMN result TYPE varchar(255)');
        DB::statement('ALTER TABLE crm_tasks ALTER COLUMN done_at TYPE varchar(255) USING done_at::text');
    }
};
