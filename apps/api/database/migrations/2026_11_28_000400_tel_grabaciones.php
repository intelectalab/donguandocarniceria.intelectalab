<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * TEL · grabaciones, transcripciones y escuchas (TEL-10 y TEL-12; RN-TEL-09, 10 y 11, Ley 29733).
 *
 *  - Una grabación por llamada; al purgarse queda PURGED con su fecha, conserva los datos de la llamada y no vuelve
 *    atrás. Una grabación purgada no cambia ni se pone en retención legal; la retención legal pide su motivo.
 *  - El estado, una por llamada y que la app no las borre ya vienen de la migración de llamadas (000300).
 *  - Una transcripción por grabación, y ya no cambia.
 *  - Cada escucha o descarga queda en la bitácora (solo inserción); la descarga siempre con motivo.
 *  - control_alerts.call_id es uuid (enlaza la alerta con su llamada) y tiene su índice.
 */
return new class extends Migration
{
    public function up(): void
    {
        // En algunas bases ya es uuid: solo se convierte si todavía es texto.
        if (DB::selectOne("SELECT data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'control_alerts' AND column_name = 'call_id'")?->data_type !== 'uuid') {
            DB::statement("ALTER TABLE control_alerts ALTER COLUMN call_id TYPE uuid USING (CASE WHEN call_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN call_id::uuid END)");
        }
        DB::statement('CREATE INDEX IF NOT EXISTS control_alerts_llamada ON control_alerts (call_id) WHERE call_id IS NOT NULL');

        DB::statement("ALTER TABLE tel_recordings ADD CONSTRAINT tel_recordings_purgada CHECK (status <> 'PURGED' OR purged_at IS NOT NULL)");
        DB::statement("ALTER TABLE tel_recordings ADD CONSTRAINT tel_recordings_retencion_legal CHECK (NOT legal_hold OR length(btrim(coalesce(legal_hold_reason, ''))) >= 5)");
        DB::statement('ALTER TABLE tel_recordings ALTER COLUMN file_id DROP NOT NULL');
        DB::statement('CREATE INDEX IF NOT EXISTS tel_recordings_vencen ON tel_recordings (status, retention_until)');
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION tel_grabacion_no_cambia() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                IF NEW.call_id IS DISTINCT FROM OLD.call_id OR NEW.duration_seconds IS DISTINCT FROM OLD.duration_seconds
                   OR NEW.provider_recording_id IS DISTINCT FROM OLD.provider_recording_id OR NEW.retention_until IS DISTINCT FROM OLD.retention_until THEN
                    RAISE EXCEPTION 'RN-TEL-10: los datos de una grabación no cambian';
                END IF;
                IF OLD.status = 'PURGED' AND (NEW.status <> 'PURGED' OR NEW.legal_hold IS DISTINCT FROM OLD.legal_hold OR NEW.file_id IS DISTINCT FROM OLD.file_id) THEN
                    RAISE EXCEPTION 'RN-TEL-10: una grabación purgada no vuelve ni cambia';
                END IF;
                IF NEW.status = 'PURGED' AND OLD.status = 'AVAILABLE' AND OLD.legal_hold THEN
                    RAISE EXCEPTION 'RN-TEL-10: una grabación en retención legal no se purga';
                END IF;
                RETURN NEW;
            END $$;
            DROP TRIGGER IF EXISTS tel_grabacion_no_cambia ON tel_recordings;
            CREATE TRIGGER tel_grabacion_no_cambia BEFORE UPDATE ON tel_recordings FOR EACH ROW EXECUTE FUNCTION tel_grabacion_no_cambia();
        SQL);

        DB::statement("ALTER TABLE tel_transcripts ALTER COLUMN preview_alerts SET DEFAULT '[]'::jsonb");
        DB::statement('ALTER TABLE tel_transcripts ALTER COLUMN cost_usd TYPE numeric(14,4)');
        DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS tel_transcripts_una_por_grabacion ON tel_transcripts (tenant_id, recording_id)');
        DB::statement('REVOKE UPDATE, DELETE, TRUNCATE ON tel_transcripts FROM aycha_app');

        DB::statement('ALTER TABLE tel_recording_access_log ALTER COLUMN reason DROP NOT NULL');
        DB::statement('ALTER TABLE tel_recording_access_log ALTER COLUMN reason TYPE varchar(255)');
        DB::statement("ALTER TABLE tel_recording_access_log ADD CONSTRAINT tel_escucha_accion CHECK (action IN ('PLAY','DOWNLOAD'))");
        DB::statement("ALTER TABLE tel_recording_access_log ADD CONSTRAINT tel_escucha_descarga_con_motivo CHECK (action <> 'DOWNLOAD' OR length(btrim(coalesce(reason, ''))) >= 5)");
        DB::statement('CREATE INDEX IF NOT EXISTS tel_escuchas_grabacion ON tel_recording_access_log (recording_id, accessed_at DESC)');
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS tel_escuchas_grabacion');
        DB::statement('ALTER TABLE tel_recording_access_log DROP CONSTRAINT IF EXISTS tel_escucha_descarga_con_motivo');
        DB::statement('ALTER TABLE tel_recording_access_log DROP CONSTRAINT IF EXISTS tel_escucha_accion');
        DB::statement('GRANT UPDATE, DELETE ON tel_transcripts TO aycha_app');
        DB::statement('DROP INDEX IF EXISTS tel_transcripts_una_por_grabacion');
        DB::statement('DROP TRIGGER IF EXISTS tel_grabacion_no_cambia ON tel_recordings');
        DB::statement('DROP FUNCTION IF EXISTS tel_grabacion_no_cambia()');
        DB::statement('DROP INDEX IF EXISTS tel_recordings_vencen');
        foreach (['tel_recordings_retencion_legal', 'tel_recordings_purgada'] as $c) {
            DB::statement("ALTER TABLE tel_recordings DROP CONSTRAINT IF EXISTS {$c}");
        }
        DB::statement('DROP INDEX IF EXISTS control_alerts_llamada');
    }
};
