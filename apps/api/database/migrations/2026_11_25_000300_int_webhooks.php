<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// INT-04 Webhooks de entrada e INT-05 Bitácora de webhooks (RN-INT-04 a RN-INT-07, RN-INT-14).
//  - Endpoints: el secreto de firma cifrado cabe entero (text); al regenerar el token, el anterior sigue valiendo 24 horas
//    (previous_token) para que haya tiempo de cambiarlo en el proveedor. El token es único: la URL lleva a una sola empresa.
//  - Eventos: intentos enteros, duplicados nunca vacíos, cuándo falló y cuándo llegó el último repetido. Un evento con la
//    misma clave en el mismo endpoint se guarda una sola vez (RN-INT-05; los rechazados por firma no cuentan).
//  - int_webhook_tenant(token): el receptor público no tiene sesión ni empresa, y webhook_endpoints tiene RLS. Esta función
//    (del dueño, SECURITY DEFINER) devuelve solo el id de la empresa del token, y nada más.
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('ALTER TABLE webhook_endpoints ALTER COLUMN secret_enc TYPE text');
        Schema::table('webhook_endpoints', function (Blueprint $table) {
            $table->string('previous_token', 80)->nullable();
            $table->timestampTz('previous_token_valid_until')->nullable();
            $table->timestampTz('token_rotated_at')->nullable();
            $table->timestampTz('secret_loaded_at')->nullable();
            $table->unique('token');
        });
        DB::statement('ALTER TABLE webhook_endpoints ALTER COLUMN received_count SET DEFAULT 0');
        DB::statement("ALTER TABLE webhook_endpoints ADD CONSTRAINT webhook_endpoints_estado CHECK (status IN ('ACTIVE','DISABLED'))");

        DB::statement('ALTER TABLE webhook_events ALTER COLUMN attempts TYPE integer USING coalesce(round(attempts), 0)::integer');
        DB::statement('ALTER TABLE webhook_events ALTER COLUMN attempts SET DEFAULT 0');
        DB::statement('ALTER TABLE webhook_events ALTER COLUMN attempts SET NOT NULL');
        DB::statement('UPDATE webhook_events SET duplicates = 0 WHERE duplicates IS NULL');
        DB::statement('ALTER TABLE webhook_events ALTER COLUMN duplicates SET DEFAULT 0');
        DB::statement('ALTER TABLE webhook_events ALTER COLUMN duplicates SET NOT NULL');
        Schema::table('webhook_events', function (Blueprint $table) {
            $table->timestampTz('failed_at')->nullable();
            $table->timestampTz('last_duplicate_at')->nullable();
            $table->index(['status', 'received_at']);
        });
        DB::statement("ALTER TABLE webhook_events ADD CONSTRAINT webhook_events_estado CHECK (status IN ('RECEIVED','PROCESSED','FAILED','REJECTED','IGNORED'))");
        DB::statement('ALTER TABLE webhook_events ADD CONSTRAINT webhook_events_contadores CHECK (attempts >= 0 AND duplicates >= 0)');
        DB::statement("CREATE UNIQUE INDEX webhook_events_una_vez ON webhook_events (endpoint_id, event_key) WHERE status <> 'REJECTED'");

        DB::statement(<<<'SQL'
            CREATE OR REPLACE FUNCTION int_webhook_tenant(p_token text) RETURNS uuid
                LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
                AS $$
                    SELECT e.tenant_id FROM webhook_endpoints e JOIN tenants t ON t.id = e.tenant_id
                     WHERE t.status = 'ACTIVE'
                       AND (e.token = p_token OR (e.previous_token = p_token AND e.previous_token_valid_until > now()))
                     LIMIT 1
                $$
        SQL);
        DB::statement('REVOKE ALL ON FUNCTION int_webhook_tenant(text) FROM PUBLIC');
        DB::statement('GRANT EXECUTE ON FUNCTION int_webhook_tenant(text) TO aycha_app');
    }

    public function down(): void
    {
        DB::statement('DROP FUNCTION IF EXISTS int_webhook_tenant(text)');
        DB::statement('DROP INDEX IF EXISTS webhook_events_una_vez');
        DB::statement('ALTER TABLE webhook_events DROP CONSTRAINT IF EXISTS webhook_events_contadores, DROP CONSTRAINT IF EXISTS webhook_events_estado');
        Schema::table('webhook_events', function (Blueprint $table) {
            $table->dropIndex(['status', 'received_at']);
            $table->dropColumn(['failed_at', 'last_duplicate_at']);
        });
        DB::statement('ALTER TABLE webhook_events ALTER COLUMN duplicates DROP NOT NULL, ALTER COLUMN duplicates DROP DEFAULT');
        DB::statement('ALTER TABLE webhook_events ALTER COLUMN attempts DROP NOT NULL, ALTER COLUMN attempts DROP DEFAULT');
        DB::statement('ALTER TABLE webhook_events ALTER COLUMN attempts TYPE numeric(14,2)');
        DB::statement('ALTER TABLE webhook_endpoints DROP CONSTRAINT IF EXISTS webhook_endpoints_estado');
        DB::statement('ALTER TABLE webhook_endpoints ALTER COLUMN received_count DROP DEFAULT');
        Schema::table('webhook_endpoints', function (Blueprint $table) {
            $table->dropUnique(['token']);
            $table->dropColumn(['previous_token', 'previous_token_valid_until', 'token_rotated_at', 'secret_loaded_at']);
        });
        DB::statement('ALTER TABLE webhook_endpoints ALTER COLUMN secret_enc TYPE varchar(255)');
    }
};
