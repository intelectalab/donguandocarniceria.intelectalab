<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

// CRM-01 Bandeja y CRM-02 Conversación (RN-CRM-03, 04, 10, 11, 21).
//  - RN-CRM-04: los mensajes, sus estados y transcripciones son de solo inserción: la aplicación no puede cambiarlos ni
//    borrarlos (tampoco por la API). Igual el historial de asignaciones y los consentimientos (Ley 29733).
//  - Un contacto por red; un mensaje del proveedor una sola vez (el webhook repetido no duplica); una conversación abierta
//    por contacto y número.
return new class extends Migration
{
    private const SOLO_INSERCION = ['conversation_messages', 'message_status_events', 'message_transcripts', 'conversation_assignments', 'contact_consents'];

    public function up(): void
    {
        foreach (self::SOLO_INSERCION as $t) {
            DB::statement("REVOKE UPDATE, DELETE, TRUNCATE ON {$t} FROM aycha_app");
        }
        DB::statement("ALTER TABLE conversation_messages ADD CONSTRAINT conversation_messages_direccion CHECK (direction IN ('IN','OUT'))");
        DB::statement("ALTER TABLE conversation_messages ADD CONSTRAINT conversation_messages_origen CHECK (origin IN ('API','SYSTEM','BUSINESS_APP'))");
        DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS conversation_messages_proveedor ON conversation_messages (tenant_id, external_id) WHERE external_id IS NOT NULL');
        DB::statement('CREATE INDEX IF NOT EXISTS conversation_messages_hilo ON conversation_messages (conversation_id, sent_at)');
        DB::statement("ALTER TABLE message_status_events ADD CONSTRAINT message_status_events_estado CHECK (status IN ('QUEUED','NOT_SENT','SENT','DELIVERED','READ','FAILED','DELETED_BY_CUSTOMER','DELETED_IN_APP'))");
        DB::statement('CREATE INDEX IF NOT EXISTS message_status_events_mensaje ON message_status_events (message_id, occurred_at)');

        // Un chat recién llegado aún no tiene mensaje saliente; devolver un chat a la cola no tiene destinataria.
        DB::statement('ALTER TABLE conversations ALTER COLUMN last_outbound_at DROP NOT NULL');
        DB::statement('ALTER TABLE conversation_assignments ALTER COLUMN to_user_id DROP NOT NULL');
        DB::statement("ALTER TABLE conversations ADD CONSTRAINT conversations_estado CHECK (status IN ('OPEN','PENDING','SNOOZED','CLOSED'))");
        DB::statement("CREATE UNIQUE INDEX IF NOT EXISTS conversations_una_abierta ON conversations (channel_id, contact_id) WHERE status <> 'CLOSED'");
        DB::statement('CREATE INDEX IF NOT EXISTS conversations_bandeja ON conversations (channel_id, status, last_inbound_at DESC)');
        DB::statement('CREATE INDEX IF NOT EXISTS conversations_asignada ON conversations (assigned_user_id, status)');

        DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS channel_contacts_red ON channel_contacts (tenant_id, provider, external_user_id)');
        DB::statement("ALTER TABLE leads ADD CONSTRAINT leads_estado CHECK (status IN ('NEW','CONTACTED','QUALIFIED','WON','LOST','DISCARDED'))");
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_estado');
        DB::statement("UPDATE conversation_assignments SET to_user_id = from_user_id WHERE to_user_id IS NULL AND from_user_id IS NOT NULL");
        DB::statement('DROP INDEX IF EXISTS channel_contacts_red');
        DB::statement('DROP INDEX IF EXISTS conversations_asignada');
        DB::statement('DROP INDEX IF EXISTS conversations_bandeja');
        DB::statement('DROP INDEX IF EXISTS conversations_una_abierta');
        DB::statement('ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_estado');
        DB::statement('DROP INDEX IF EXISTS message_status_events_mensaje');
        DB::statement('ALTER TABLE message_status_events DROP CONSTRAINT IF EXISTS message_status_events_estado');
        DB::statement('DROP INDEX IF EXISTS conversation_messages_hilo');
        DB::statement('DROP INDEX IF EXISTS conversation_messages_proveedor');
        DB::statement('ALTER TABLE conversation_messages DROP CONSTRAINT IF EXISTS conversation_messages_origen');
        DB::statement('ALTER TABLE conversation_messages DROP CONSTRAINT IF EXISTS conversation_messages_direccion');
        foreach (self::SOLO_INSERCION as $t) {
            DB::statement("GRANT UPDATE, DELETE ON {$t} TO aycha_app");
        }
    }
};
