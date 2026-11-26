<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

// TEL-01 Lista de activación y TEL-02 Ajustes (RN-TEL-01, 02, 03, 04, 06, 07 y 10).
//  - Guardia tel_guard: con el módulo TEL apagado, la aplicación no puede escribir en ninguna tabla tel_* (RN-PLT-07).
//    Quedan fuera: la lista de activación (se llena en Módulos activables antes de encender), la unión de clientes
//    duplicados (solo cambia el cliente de la llamada) y lo que corre como dueño de la base (la depuración de AUD).
//  - Ajustes: una sola fila por empresa, etapa de configuración (SETUP) o en vivo (LIVE) con quién y cuándo, y
//    valores dentro de rango; con grabación, el aviso es obligatorio (RN-TEL-04).
return new class extends Migration
{
    private const TABLAS = ['tel_settings', 'tel_numbers', 'tel_menus', 'tel_ring_groups', 'tel_ring_members', 'tel_calls', 'tel_recordings', 'tel_transcripts', 'tel_recording_access_log'];

    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION tel_guard() RETURNS trigger LANGUAGE plpgsql AS $$
            DECLARE
                fila jsonb := to_jsonb(CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END);
                empresa uuid := (fila->>'tenant_id')::uuid;
            BEGIN
                IF current_user <> 'aycha_app' THEN
                    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
                END IF;
                IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - 'customer_id' - 'lead_id' - 'updated_at') = (to_jsonb(OLD) - 'customer_id' - 'lead_id' - 'updated_at') THEN
                    RETURN NEW;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM tenant_modules m WHERE m.tenant_id = empresa AND m.module_code = 'TEL' AND m.enabled) THEN
                    RAISE EXCEPTION 'RN-PLT-07: el módulo TEL está apagado para esta empresa' USING ERRCODE = 'check_violation';
                END IF;
                RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
            END $$;
            SQL);
        foreach (self::TABLAS as $t) {
            DB::statement("DROP TRIGGER IF EXISTS tel_guard ON {$t}");
            DB::statement("CREATE TRIGGER tel_guard BEFORE INSERT OR UPDATE OR DELETE ON {$t} FOR EACH ROW EXECUTE FUNCTION tel_guard()");
        }

        DB::statement('ALTER TABLE tel_settings ADD COLUMN IF NOT EXISTS live_at timestamptz');
        DB::statement('ALTER TABLE tel_settings ADD COLUMN IF NOT EXISTS live_by uuid REFERENCES users (id) ON DELETE RESTRICT');
        DB::statement('ALTER TABLE tel_settings ADD COLUMN IF NOT EXISTS setup_reason text');
        DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS tel_settings_una ON tel_settings (tenant_id)');
        DB::statement("ALTER TABLE tel_settings ADD CONSTRAINT tel_settings_etapa CHECK (stage IN ('SETUP','LIVE'))");
        DB::statement("ALTER TABLE tel_settings ADD CONSTRAINT tel_settings_proveedor CHECK (provider IN ('FAKE','TWILIO','OTHER'))");
        DB::statement("ALTER TABLE tel_settings ADD CONSTRAINT tel_settings_reparto CHECK (ring_strategy IN ('ROUND_ROBIN','SIMULTANEOUS'))");
        DB::statement('ALTER TABLE tel_settings ADD CONSTRAINT tel_settings_rangos CHECK (retention_days BETWEEN 1 AND 3650 AND ring_timeout_s BETWEEN 5 AND 120 AND callback_due_minutes > 0)');
        DB::statement("ALTER TABLE tel_settings ADD CONSTRAINT tel_settings_aviso CHECK (NOT coalesce(recording_enabled, false) OR length(btrim(coalesce(recording_notice_text, ''))) >= 10)");
        DB::statement("ALTER TABLE tel_settings ADD CONSTRAINT tel_settings_en_vivo CHECK (stage <> 'LIVE' OR (live_at IS NOT NULL AND live_by IS NOT NULL))");
        DB::statement('REVOKE DELETE, TRUNCATE ON tel_settings FROM aycha_app');
    }

    public function down(): void
    {
        DB::statement('GRANT DELETE ON tel_settings TO aycha_app');
        foreach (['en_vivo', 'aviso', 'rangos', 'reparto', 'proveedor', 'etapa'] as $c) {
            DB::statement("ALTER TABLE tel_settings DROP CONSTRAINT IF EXISTS tel_settings_{$c}");
        }
        DB::statement('DROP INDEX IF EXISTS tel_settings_una');
        DB::statement('ALTER TABLE tel_settings DROP COLUMN IF EXISTS setup_reason');
        DB::statement('ALTER TABLE tel_settings DROP COLUMN IF EXISTS live_by');
        DB::statement('ALTER TABLE tel_settings DROP COLUMN IF EXISTS live_at');
        foreach (self::TABLAS as $t) {
            DB::statement("DROP TRIGGER IF EXISTS tel_guard ON {$t}");
        }
        DB::statement('DROP FUNCTION IF EXISTS tel_guard()');
    }
};
