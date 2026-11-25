<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

// CRM-09 Plantillas, CRM-10 Respuestas rápidas y catálogo, CRM-11 Costo de WhatsApp (RN-CRM-07, 08 y 13).
//  - Una plantilla por nombre y marca; el texto de una plantilla aprobada o en revisión de Meta no cambia (lo que sale es
//    lo que Meta aprobó): para cambiarla se crea otra.
//  - El costo de cada mensaje queda con la tarifa usada y no se recalcula: la aplicación no puede cambiarlo ni borrarlo.
return new class extends Migration
{
    public function up(): void
    {
        // Las horas que ordenan (mensajes, estados, consentimientos, cobros, asignaciones, estado de la vendedora) con
        // microsegundos: dos registros del mismo segundo no empatan (el último consentimiento es el que vale).
        foreach (['conversation_messages' => 'sent_at', 'message_status_events' => 'occurred_at', 'contact_consents' => 'recorded_at', 'message_charges' => 'charged_at',
            'conversation_assignments' => 'assigned_at', 'crm_agent_status' => 'changed_at'] as $t => $c) {
            DB::statement("ALTER TABLE {$t} ALTER COLUMN {$c} TYPE timestamptz(6)");
        }
        DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS message_templates_nombre ON message_templates (tenant_id, brand_id, name)');
        DB::statement("ALTER TABLE message_templates ADD CONSTRAINT message_templates_categoria CHECK (category IN ('UTILITY','MARKETING','AUTHENTICATION'))");
        DB::statement("ALTER TABLE message_templates ADD CONSTRAINT message_templates_estado CHECK (provider_status IN ('DRAFT','PENDING','APPROVED','REJECTED','PAUSED','DISABLED'))");
        DB::statement(<<<'SQL'
            CREATE OR REPLACE FUNCTION crm_plantilla_aprobada_fija() RETURNS trigger
                LANGUAGE plpgsql
                AS $$
                BEGIN
                    IF OLD.provider_status IN ('APPROVED', 'PENDING') AND (NEW.body IS DISTINCT FROM OLD.body OR NEW.category IS DISTINCT FROM OLD.category OR NEW.name IS DISTINCT FROM OLD.name) THEN
                        RAISE EXCEPTION 'RN-CRM-07: el texto, la categoría y el nombre de una plantilla aprobada o en revisión de Meta no cambian; crea otra';
                    END IF;
                    RETURN NEW;
                END
                $$
        SQL);
        DB::statement('DROP TRIGGER IF EXISTS plantilla_aprobada_fija ON message_templates');
        DB::statement('CREATE TRIGGER plantilla_aprobada_fija BEFORE UPDATE ON message_templates FOR EACH ROW EXECUTE FUNCTION crm_plantilla_aprobada_fija()');

        DB::statement("CREATE UNIQUE INDEX IF NOT EXISTS quick_replies_atajo ON quick_replies (tenant_id, coalesce(owner_user_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(brand_id, '00000000-0000-0000-0000-000000000000'::uuid), shortcut)");
        DB::statement("ALTER TABLE quick_replies ADD CONSTRAINT quick_replies_estado CHECK (status IN ('ACTIVE','INACTIVE'))");
        DB::statement('ALTER TABLE quick_replies ADD CONSTRAINT quick_replies_alcance CHECK ((owner_user_id IS NULL) <> (brand_id IS NULL))');

        DB::statement('REVOKE UPDATE, DELETE, TRUNCATE ON message_charges FROM aycha_app');
        DB::statement("ALTER TABLE message_charges ADD CONSTRAINT message_charges_categoria CHECK (category IN ('SERVICE','UTILITY','MARKETING','AUTHENTICATION'))");
        DB::statement("ALTER TABLE message_charges ADD CONSTRAINT message_charges_motivo CHECK (reason IN ('CHARGED','FREE_SERVICE_QUOTA','FREE_CTWA_WINDOW','FREE_UTILITY_IN_WINDOW','BUSINESS_APP'))");
        DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS message_charges_mensaje ON message_charges (message_id)');
        DB::statement('CREATE INDEX IF NOT EXISTS message_charges_mes ON message_charges (period, channel_id)');
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS message_charges_mes');
        DB::statement('DROP INDEX IF EXISTS message_charges_mensaje');
        DB::statement('ALTER TABLE message_charges DROP CONSTRAINT IF EXISTS message_charges_motivo');
        DB::statement('ALTER TABLE message_charges DROP CONSTRAINT IF EXISTS message_charges_categoria');
        DB::statement('GRANT UPDATE, DELETE ON message_charges TO aycha_app');
        DB::statement('ALTER TABLE quick_replies DROP CONSTRAINT IF EXISTS quick_replies_alcance');
        DB::statement('ALTER TABLE quick_replies DROP CONSTRAINT IF EXISTS quick_replies_estado');
        DB::statement('DROP INDEX IF EXISTS quick_replies_atajo');
        DB::statement('DROP TRIGGER IF EXISTS plantilla_aprobada_fija ON message_templates');
        DB::statement('DROP FUNCTION IF EXISTS crm_plantilla_aprobada_fija()');
        DB::statement('ALTER TABLE message_templates DROP CONSTRAINT IF EXISTS message_templates_estado');
        DB::statement('ALTER TABLE message_templates DROP CONSTRAINT IF EXISTS message_templates_categoria');
        DB::statement('DROP INDEX IF EXISTS message_templates_nombre');
    }
};
