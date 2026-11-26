<?php

use Illuminate\Support\Facades\DB;
use Illuminate\Database\Migrations\Migration;

// CRM-07 Números y cuentas y CRM-08 Equipos y turnos (RN-CRM-01, 02 y 03).
//  - Cada número o cuenta queda enlazado a su conector de INT (allí están sus credenciales cifradas); se enlazan los existentes
//    por el número que atiende cada conector.
//  - Un número se conecta una sola vez; WhatsApp solo por la API oficial (con o sin coexistencia) o «solo app»: no hay QR.
//  - Un miembro por número y persona; un turno por día; el turno termina después de empezar; el estado de la vendedora
//    (en línea, ausente, desconectada) solo se agrega.
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('ALTER TABLE messaging_channels ADD COLUMN IF NOT EXISTS connector_id uuid REFERENCES integration_connectors (id) ON DELETE RESTRICT');
        DB::statement('CREATE INDEX IF NOT EXISTS messaging_channels_conector ON messaging_channels (connector_id)');
        DB::statement(<<<'SQL'
            UPDATE messaging_channels c SET connector_id = i.id
            FROM integration_connectors i
            WHERE i.tenant_id = c.tenant_id AND i.owner_module = 'CRM' AND c.connector_id IS NULL AND (
                (c.kind = 'WHATSAPP' AND i.config->>'display_number' = c.number)
                OR (c.kind = 'MESSENGER' AND i.config->>'page' = c.number)
                OR (c.kind = 'INSTAGRAM' AND i.config->>'instagram' = c.number)
                OR (c.kind = 'TIKTOK' AND i.provider = 'TIKTOK' AND position(c.number IN coalesce(i.config->>'accounts', '')) > 0)
            )
        SQL);
        DB::statement('ALTER TABLE messaging_channels ALTER COLUMN display_name TYPE varchar(80), ALTER COLUMN auto_greeting TYPE text, ALTER COLUMN recording_notice_text TYPE text');
        DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS messaging_channels_numero ON messaging_channels (tenant_id, kind, number)');
        DB::statement("ALTER TABLE messaging_channels ADD CONSTRAINT messaging_channels_red CHECK (kind IN ('WHATSAPP','MESSENGER','INSTAGRAM','TIKTOK'))");
        DB::statement("ALTER TABLE messaging_channels ADD CONSTRAINT messaging_channels_conexion CHECK (connection_mode IN ('CLOUD_API_COEXISTENCE','CLOUD_API','APP_ONLY','DM_API','NOT_AVAILABLE')
            AND (kind <> 'WHATSAPP' OR connection_mode IN ('CLOUD_API_COEXISTENCE','CLOUD_API','APP_ONLY')))");
        DB::statement("ALTER TABLE messaging_channels ADD CONSTRAINT messaging_channels_asignacion CHECK (assignment_mode IN ('SHIFT_ROUND_ROBIN','LEAST_OPEN','MANUAL'))");
        DB::statement("ALTER TABLE messaging_channels ADD CONSTRAINT messaging_channels_estado CHECK (status IN ('ACTIVE','PAUSED','DISCONNECTED'))");

        DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS channel_members_persona ON channel_members (channel_id, user_id)');
        DB::statement("ALTER TABLE channel_members ADD CONSTRAINT channel_members_rol CHECK (member_role IN ('AGENT','SUPERVISOR'))");
        DB::statement('ALTER TABLE channel_members ADD CONSTRAINT channel_members_tope CHECK (max_open_conversations BETWEEN 1 AND 100)');

        DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS channel_member_shifts_dia ON channel_member_shifts (member_id, weekday)');
        DB::statement('ALTER TABLE channel_member_shifts ADD CONSTRAINT channel_member_shifts_horario CHECK (weekday BETWEEN 1 AND 7 AND time_from < time_to)');

        DB::statement("ALTER TABLE crm_agent_status ADD CONSTRAINT crm_agent_status_estado CHECK (status IN ('ONLINE','AWAY','OFFLINE'))");
        DB::statement('CREATE INDEX IF NOT EXISTS crm_agent_status_ultimo ON crm_agent_status (user_id, changed_at DESC)');
        DB::statement('REVOKE UPDATE, DELETE, TRUNCATE ON crm_agent_status FROM aycha_app');   // historial: solo inserción
    }

    public function down(): void
    {
        DB::statement('GRANT UPDATE, DELETE ON crm_agent_status TO aycha_app');
        DB::statement('DROP INDEX IF EXISTS crm_agent_status_ultimo');
        DB::statement('ALTER TABLE crm_agent_status DROP CONSTRAINT IF EXISTS crm_agent_status_estado');
        DB::statement('ALTER TABLE channel_member_shifts DROP CONSTRAINT IF EXISTS channel_member_shifts_horario');
        DB::statement('DROP INDEX IF EXISTS channel_member_shifts_dia');
        DB::statement('ALTER TABLE channel_members DROP CONSTRAINT IF EXISTS channel_members_tope');
        DB::statement('ALTER TABLE channel_members DROP CONSTRAINT IF EXISTS channel_members_rol');
        DB::statement('DROP INDEX IF EXISTS channel_members_persona');
        foreach (['estado', 'asignacion', 'conexion', 'red'] as $c) {
            DB::statement("ALTER TABLE messaging_channels DROP CONSTRAINT IF EXISTS messaging_channels_{$c}");
        }
        DB::statement('DROP INDEX IF EXISTS messaging_channels_numero');
        DB::statement('DROP INDEX IF EXISTS messaging_channels_conector');
        DB::statement('ALTER TABLE messaging_channels DROP COLUMN IF EXISTS connector_id');
    }
};
