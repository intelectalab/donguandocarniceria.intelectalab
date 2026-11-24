<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// INT-06 Mensajes salientes e INT-07 Cola muerta (RN-INT-08 a RN-INT-11, RN-INT-14).
//  - Los intentos son un número entero; se guardan las acciones a mano (reintentar o cancelar con motivo) y el motivo
//    de la cancelación.
//  - La clave de idempotencia es única por empresa (RN-INT-11) y el número sigue al último de la empresa (OB-000168…).
//  - Índice para que el despacho encuentre rápido los mensajes que tocan.
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('ALTER TABLE outbox_messages ALTER COLUMN attempts TYPE integer USING round(attempts)::integer');
        DB::statement('ALTER TABLE outbox_messages ALTER COLUMN attempts SET DEFAULT 0');
        DB::statement("ALTER TABLE outbox_messages ALTER COLUMN tries SET DEFAULT '[]'::jsonb");
        Schema::table('outbox_messages', function (Blueprint $table) {
            $table->jsonb('manual')->default(DB::raw("'[]'::jsonb"));
            $table->string('cancel_reason', 300)->nullable();
            $table->index(['status', 'next_attempt_at']);
        });
        DB::statement("ALTER TABLE outbox_messages ADD CONSTRAINT outbox_messages_estado CHECK (status IN ('PENDING','RETRYING','SENT','DEAD','CANCELLED'))");
        DB::statement("ALTER TABLE outbox_messages ADD CONSTRAINT outbox_messages_tipo CHECK (kind IN ('MESSAGE','EINVOICE','SYNC','DOMAIN_EVENT'))");
        DB::statement('ALTER TABLE outbox_messages ADD CONSTRAINT outbox_messages_intentos CHECK (attempts >= 0)');
        DB::statement('CREATE UNIQUE INDEX outbox_messages_clave_unica ON outbox_messages (tenant_id, idempotency_key)');

        // El número OB-000001… lo da encolar() por empresa (el siguiente al último, con bloqueo): no hace falta secuencia.
        DB::statement('DROP SEQUENCE IF EXISTS outbox_number_seq');
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS outbox_messages_clave_unica');
        DB::statement('ALTER TABLE outbox_messages DROP CONSTRAINT IF EXISTS outbox_messages_intentos, DROP CONSTRAINT IF EXISTS outbox_messages_tipo, DROP CONSTRAINT IF EXISTS outbox_messages_estado');
        Schema::table('outbox_messages', function (Blueprint $table) {
            $table->dropIndex(['status', 'next_attempt_at']);
            $table->dropColumn(['manual', 'cancel_reason']);
        });
        DB::statement('ALTER TABLE outbox_messages ALTER COLUMN attempts DROP DEFAULT');
        DB::statement('ALTER TABLE outbox_messages ALTER COLUMN attempts TYPE numeric(14,2)');
    }
};
