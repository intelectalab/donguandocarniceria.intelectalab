<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

// INT-09 Centro de notificaciones, INT-10 Preferencias e INT-11 Archivos adjuntos (RN-INT-15 a RN-INT-18).
//  - Preferencias: una fila por persona y tipo de aviso, y solo los tipos que existen.
//  - Notificaciones: índices para la lista de cada persona y la de su rol.
//  - Archivos: nombres y motivos que caben enteros, clasificación y estado limitados, índice por registro.
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('CREATE UNIQUE INDEX notification_preferences_una ON notification_preferences (user_id, type)');
        DB::statement("ALTER TABLE notification_preferences ADD CONSTRAINT notification_preferences_tipo CHECK (type IN ('ORDERS','STOCK','DOCUMENTS','PAYMENTS','APPROVALS','INTEGRATIONS','SECURITY','EXPORTS','CRITICAL'))");
        DB::statement('CREATE INDEX notifications_persona_idx ON notifications (user_id, at)');
        DB::statement('CREATE INDEX notifications_rol_idx ON notifications (role, at)');

        DB::statement('ALTER TABLE file_attachments ALTER COLUMN file_name TYPE varchar(255), ALTER COLUMN uploaded_by TYPE varchar(120), ALTER COLUMN deleted_reason TYPE varchar(300),
            ALTER COLUMN deleted_by TYPE varchar(120), ALTER COLUMN mime TYPE varchar(100)');
        DB::statement("ALTER TABLE file_attachments ADD CONSTRAINT file_attachments_clasificacion CHECK (classification IN ('PUBLIC','INTERNAL','CONFIDENTIAL','PERSONAL_DATA'))");
        DB::statement("ALTER TABLE file_attachments ADD CONSTRAINT file_attachments_estado CHECK (status IN ('ACTIVE','DELETED'))");
        DB::statement('ALTER TABLE file_attachments ADD CONSTRAINT file_attachments_tamano CHECK (size_bytes > 0)');
        DB::statement('CREATE INDEX file_attachments_registro_idx ON file_attachments (entity, entity_id)');
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS file_attachments_registro_idx');
        DB::statement('ALTER TABLE file_attachments DROP CONSTRAINT IF EXISTS file_attachments_tamano, DROP CONSTRAINT IF EXISTS file_attachments_estado, DROP CONSTRAINT IF EXISTS file_attachments_clasificacion');
        DB::statement('ALTER TABLE file_attachments ALTER COLUMN file_name TYPE varchar(80), ALTER COLUMN uploaded_by TYPE varchar(40), ALTER COLUMN deleted_reason TYPE varchar(80),
            ALTER COLUMN deleted_by TYPE varchar(40), ALTER COLUMN mime TYPE varchar(40)');
        DB::statement('DROP INDEX IF EXISTS notifications_rol_idx');
        DB::statement('DROP INDEX IF EXISTS notifications_persona_idx');
        DB::statement('ALTER TABLE notification_preferences DROP CONSTRAINT IF EXISTS notification_preferences_tipo');
        DB::statement('DROP INDEX IF EXISTS notification_preferences_una');
    }
};
