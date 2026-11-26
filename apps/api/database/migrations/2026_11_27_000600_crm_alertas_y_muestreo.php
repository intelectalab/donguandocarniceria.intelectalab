<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

// CRM-12 Alertas de control, CRM-13 Reglas e identificadores oficiales y CRM-14 Revisión por muestreo
// (RN-CRM-15, 16, 17 y 18).
//  - Alertas: no se borran; lo detectado (regla, coincidencia, extracto, vendedora) no cambia; una alerta cerrada
//    (confirmada o descartada) lleva quién la revisó, cuándo y su nota, y ya no cambia.
//  - Reglas: código único por empresa y tipos y gravedades fijados. Identificadores: tipos fijados y sin repetir.
//  - Revisión por muestreo: una por conversación y semana (lunes), de solo inserción; distinta de OK exige nota.
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS control_alert_rules_codigo ON control_alert_rules (tenant_id, code)');
        DB::statement("ALTER TABLE control_alert_rules ADD CONSTRAINT control_alert_rules_tipo CHECK (rule_type IN
            ('KEYWORD','FOREIGN_PHONE','FOREIGN_ACCOUNT','OFF_CATALOG_TERM','APP_DELETION','UNANSWERED_CHAT','SURVEY_FLAG'))");
        DB::statement("ALTER TABLE control_alert_rules ADD CONSTRAINT control_alert_rules_gravedad CHECK (severity IN ('HIGH','MEDIUM','LOW'))");
        DB::statement('ALTER TABLE control_alert_rules ADD CONSTRAINT control_alert_rules_patron CHECK (length(btrim(pattern)) >= 2)');
        DB::statement('REVOKE DELETE, TRUNCATE ON control_alert_rules FROM aycha_app');

        DB::statement("ALTER TABLE official_identifiers ADD CONSTRAINT official_identifiers_tipo CHECK (identifier_type IN ('PHONE','YAPE','PLIN','BANK_ACCOUNT','CCI','EMAIL','URL'))");
        DB::statement("ALTER TABLE official_identifiers ADD CONSTRAINT official_identifiers_estado CHECK (status IN ('ACTIVE','INACTIVE'))");
        DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS official_identifiers_valor ON official_identifiers (tenant_id, identifier_type, value)');
        DB::statement('REVOKE DELETE, TRUNCATE ON official_identifiers FROM aycha_app');

        DB::statement('ALTER TABLE control_alerts ALTER COLUMN resolution_note TYPE text');
        DB::statement("ALTER TABLE control_alerts ADD CONSTRAINT control_alerts_estado CHECK (status IN ('OPEN','UNDER_REVIEW','DISMISSED','CONFIRMED'))");
        DB::statement("ALTER TABLE control_alerts ADD CONSTRAINT control_alerts_gravedad CHECK (severity IN ('HIGH','MEDIUM','LOW'))");
        DB::statement("ALTER TABLE control_alerts ADD CONSTRAINT control_alerts_fuente CHECK (source_type IN ('MESSAGE','VOICE_NOTE','CALL_TRANSCRIPT','SYSTEM','SURVEY'))");
        DB::statement("ALTER TABLE control_alerts ADD CONSTRAINT control_alerts_cerrada CHECK (status NOT IN ('DISMISSED','CONFIRMED')
            OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND length(btrim(coalesce(resolution_note, ''))) > 0))");
        DB::statement('CREATE INDEX IF NOT EXISTS control_alerts_bandeja ON control_alerts (status, raised_at DESC)');
        DB::statement('CREATE INDEX IF NOT EXISTS control_alerts_vendedora ON control_alerts (user_id, status)');
        DB::statement('REVOKE DELETE, TRUNCATE ON control_alerts FROM aycha_app');
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION crm_alerta_no_cambia() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                IF (NEW.rule_id, NEW.rule_code, NEW.source_type, NEW.message_id, NEW.call_id, NEW.conversation_id, NEW.user_id, NEW.brand_id,
                    NEW.severity, NEW.matched_text, NEW.excerpt, NEW.raised_at)
                    IS DISTINCT FROM (OLD.rule_id, OLD.rule_code, OLD.source_type, OLD.message_id, OLD.call_id, OLD.conversation_id, OLD.user_id, OLD.brand_id,
                    OLD.severity, OLD.matched_text, OLD.excerpt, OLD.raised_at) THEN
                    RAISE EXCEPTION 'RN-CRM-17: lo detectado en una alerta no se cambia' USING ERRCODE = 'check_violation';
                END IF;
                IF OLD.status IN ('DISMISSED','CONFIRMED') AND (NEW.status, NEW.reviewed_by, NEW.reviewed_at, NEW.resolution_note)
                    IS DISTINCT FROM (OLD.status, OLD.reviewed_by, OLD.reviewed_at, OLD.resolution_note) THEN
                    RAISE EXCEPTION 'RN-CRM-17: una alerta cerrada no se reabre ni cambia' USING ERRCODE = 'check_violation';
                END IF;
                RETURN NEW;
            END $$;
            DROP TRIGGER IF EXISTS crm_alerta_no_cambia ON control_alerts;
            CREATE TRIGGER crm_alerta_no_cambia BEFORE UPDATE ON control_alerts FOR EACH ROW EXECUTE FUNCTION crm_alerta_no_cambia();
            SQL);

        DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS conversation_reviews_semana ON conversation_reviews (conversation_id, sample_week)');
        DB::statement("ALTER TABLE conversation_reviews ADD CONSTRAINT conversation_reviews_resultado CHECK (result IN ('OK','OBSERVED','INCIDENT'))");
        DB::statement("ALTER TABLE conversation_reviews ADD CONSTRAINT conversation_reviews_nota CHECK (result = 'OK' OR length(btrim(coalesce(notes, ''))) >= 5)");
        DB::statement('ALTER TABLE conversation_reviews ADD CONSTRAINT conversation_reviews_lunes CHECK (extract(isodow FROM sample_week) = 1)');
        DB::statement('REVOKE UPDATE, DELETE, TRUNCATE ON conversation_reviews FROM aycha_app');
    }

    public function down(): void
    {
        DB::statement('GRANT UPDATE, DELETE ON conversation_reviews TO aycha_app');
        foreach (['lunes', 'nota', 'resultado'] as $c) {
            DB::statement("ALTER TABLE conversation_reviews DROP CONSTRAINT IF EXISTS conversation_reviews_{$c}");
        }
        DB::statement('DROP INDEX IF EXISTS conversation_reviews_semana');
        DB::statement('DROP TRIGGER IF EXISTS crm_alerta_no_cambia ON control_alerts');
        DB::statement('DROP FUNCTION IF EXISTS crm_alerta_no_cambia()');
        DB::statement('GRANT DELETE ON control_alerts TO aycha_app');
        DB::statement('DROP INDEX IF EXISTS control_alerts_vendedora');
        DB::statement('DROP INDEX IF EXISTS control_alerts_bandeja');
        foreach (['cerrada', 'fuente', 'gravedad', 'estado'] as $c) {
            DB::statement("ALTER TABLE control_alerts DROP CONSTRAINT IF EXISTS control_alerts_{$c}");
        }
        DB::statement('ALTER TABLE control_alerts ALTER COLUMN resolution_note TYPE varchar(255)');
        DB::statement('GRANT DELETE ON official_identifiers TO aycha_app');
        DB::statement('DROP INDEX IF EXISTS official_identifiers_valor');
        DB::statement('ALTER TABLE official_identifiers DROP CONSTRAINT IF EXISTS official_identifiers_estado');
        DB::statement('ALTER TABLE official_identifiers DROP CONSTRAINT IF EXISTS official_identifiers_tipo');
        DB::statement('GRANT DELETE ON control_alert_rules TO aycha_app');
        foreach (['patron', 'gravedad', 'tipo'] as $c) {
            DB::statement("ALTER TABLE control_alert_rules DROP CONSTRAINT IF EXISTS control_alert_rules_{$c}");
        }
        DB::statement('DROP INDEX IF EXISTS control_alert_rules_codigo');
    }
};
