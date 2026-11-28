<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * API · destinos de webhooks, entregas e intentos, documentación y sandbox (API-04 a API-09; RN-API-05 a 08, 12, 14, 16, 17 y 18).
 *
 *  - api_webhook_endpoints: destinos https públicos de la empresa (RLS), con secreto de firma cifrado (enc:v2:…) y el
 *    anterior vigente por 24 horas al rotar (RN-API-07). La racha de fallos seguidos desactiva el destino al llegar al
 *    límite (RN-API-12); reactivarlo exige motivo.
 *  - api_webhook_deliveries: cada entrega de un evento del catálogo a un destino suscrito. Un evento se entrega una sola
 *    vez por destino, salvo reenvío manual (resent_from). Tras api_webhook_max_attempts intentos con espera exponencial
 *    (1, 5, 30, 120, 360, 720 y 1440 minutos) pasa a la cola muerta (RN-API-08).
 *  - api_webhook_attempts: cada intento de envío (solo inserción): estado HTTP, tiempo, IP resuelta, firma y espera.
 *  - api_sandboxes: el entorno de pruebas emparejado de la empresa (una fila por empresa), donde operan las claves
 *    ak_test_ con OSE, mensajería y pagos simulados (FAKE), sin leer ni escribir datos reales (RN-API-16).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('api_webhook_endpoints', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->string('name', 120);
            $table->string('description', 500)->nullable();
            $table->string('url', 500);
            $table->string('environment', 10)->default('LIVE');
            $table->jsonb('events');
            $table->jsonb('brand_ids')->default(DB::raw("'[]'::jsonb"));
            $table->uuid('customer_id')->nullable();
            $table->string('sim_mode', 20)->default('OK');
            $table->string('status', 20)->default('ACTIVE');
            $table->text('secret_enc');
            $table->string('secret_last4', 4);
            $table->integer('secret_version')->default(1);
            $table->text('prev_secret_enc')->nullable();
            $table->string('prev_last4', 4)->nullable();
            $table->timestampTz('prev_valid_until')->nullable();
            $table->timestampTz('rotated_at')->nullable();
            $table->integer('failure_streak')->default(0);
            $table->timestampTz('last_delivery_at')->nullable();
            $table->string('last_delivery_status', 20)->nullable();
            $table->timestampTz('disabled_at')->nullable();
            $table->string('disabled_reason', 500)->nullable();
            $table->string('status_reason', 500)->nullable();
            $table->uuid('created_by')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index(['tenant_id', 'environment', 'status']);
            $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete();
            $table->foreign('customer_id')->references('id')->on('customers')->restrictOnDelete();
            $table->foreign('created_by')->references('id')->on('users')->restrictOnDelete();
        });
        DB::statement("ALTER TABLE api_webhook_endpoints ADD CONSTRAINT api_webhook_endpoints_entorno CHECK (environment IN ('LIVE','TEST'))");
        DB::statement("ALTER TABLE api_webhook_endpoints ADD CONSTRAINT api_webhook_endpoints_https CHECK (url LIKE 'https://%')");
        DB::statement("ALTER TABLE api_webhook_endpoints ADD CONSTRAINT api_webhook_endpoints_eventos CHECK (jsonb_typeof(events) = 'array' AND jsonb_array_length(events) > 0 AND jsonb_typeof(brand_ids) = 'array')");
        DB::statement("ALTER TABLE api_webhook_endpoints ADD CONSTRAINT api_webhook_endpoints_sim CHECK (sim_mode IN ('OK','FLAKY','DOWN','SLOW','ERROR_500'))");
        DB::statement("ALTER TABLE api_webhook_endpoints ADD CONSTRAINT api_webhook_endpoints_estado CHECK (status IN ('ACTIVE','PAUSED','DISABLED'))");
        DB::statement("ALTER TABLE api_webhook_endpoints ADD CONSTRAINT api_webhook_endpoints_racha CHECK (failure_streak >= 0 AND secret_version >= 1)");
        DB::statement("SELECT enable_tenant_rls('api_webhook_endpoints')");
        DB::statement('REVOKE DELETE, TRUNCATE ON api_webhook_endpoints FROM aycha_app');
        DB::statement("SELECT audit.track('api_webhook_endpoints')");

        Schema::create('api_webhook_deliveries', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->string('number', 20);
            $table->uuid('endpoint_id');
            $table->string('environment', 10)->default('LIVE');
            $table->string('event_id', 60);
            $table->string('event_type', 60);
            $table->string('event_version', 10)->default('v1');
            $table->timestampTz('occurred_at');
            $table->text('payload');
            $table->text('signature')->nullable();
            $table->string('status', 20)->default('PENDING');
            $table->integer('attempts')->default(0);
            $table->timestampTz('next_attempt_at')->nullable();
            $table->timestampTz('delivered_at')->nullable();
            $table->timestampTz('dead_at')->nullable();
            $table->uuid('resent_from')->nullable();
            $table->uuid('resent_to')->nullable();
            $table->timestampTz('resent_at')->nullable();
            $table->uuid('resent_by')->nullable();
            $table->smallInteger('last_http')->nullable();
            $table->string('last_error', 500)->nullable();
            $table->boolean('is_test')->default(false);
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index(['tenant_id', 'status', 'next_attempt_at']);
            $table->index(['endpoint_id', 'created_at']);
            $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete();
            $table->foreign('endpoint_id')->references('id')->on('api_webhook_endpoints')->restrictOnDelete();
            $table->foreign('resent_by')->references('id')->on('users')->restrictOnDelete();
        });
        DB::statement('ALTER TABLE api_webhook_deliveries ADD CONSTRAINT api_webhook_deliveries_resent_from_fk FOREIGN KEY (resent_from) REFERENCES api_webhook_deliveries (id) ON DELETE RESTRICT');
        DB::statement('ALTER TABLE api_webhook_deliveries ADD CONSTRAINT api_webhook_deliveries_resent_to_fk FOREIGN KEY (resent_to) REFERENCES api_webhook_deliveries (id) ON DELETE RESTRICT');
        DB::statement('CREATE UNIQUE INDEX api_webhook_deliveries_numero ON api_webhook_deliveries (tenant_id, number)');
        DB::statement('CREATE UNIQUE INDEX api_webhook_deliveries_evento_unico ON api_webhook_deliveries (endpoint_id, event_id) WHERE resent_from IS NULL');
        DB::statement("ALTER TABLE api_webhook_deliveries ADD CONSTRAINT api_webhook_deliveries_entorno CHECK (environment IN ('LIVE','TEST'))");
        DB::statement("ALTER TABLE api_webhook_deliveries ADD CONSTRAINT api_webhook_deliveries_estado CHECK (status IN ('PENDING','RETRYING','DELIVERED','DEAD') AND attempts >= 0)");
        DB::statement("SELECT enable_tenant_rls('api_webhook_deliveries')");
        DB::statement('REVOKE DELETE, TRUNCATE ON api_webhook_deliveries FROM aycha_app');

        Schema::create('api_webhook_attempts', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('delivery_id');
            $table->uuid('endpoint_id');
            $table->integer('attempt_no');
            $table->timestampTz('at')->default(DB::raw('clock_timestamp()'));
            $table->smallInteger('http_status')->nullable();
            $table->integer('duration_ms');
            $table->boolean('ok');
            $table->string('resolved_ip', 45)->nullable();
            $table->string('response_snippet', 250)->nullable();
            $table->string('error', 500)->nullable();
            $table->text('signature');
            $table->integer('secret_version')->default(1);
            $table->integer('wait_next_min')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->index(['delivery_id', 'attempt_no']);
            $table->index('tenant_id');
            $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete();
            $table->foreign('delivery_id')->references('id')->on('api_webhook_deliveries')->restrictOnDelete();
            $table->foreign('endpoint_id')->references('id')->on('api_webhook_endpoints')->restrictOnDelete();
        });
        DB::statement('CREATE UNIQUE INDEX api_webhook_attempts_orden ON api_webhook_attempts (delivery_id, attempt_no)');
        DB::statement('ALTER TABLE api_webhook_attempts ADD CONSTRAINT api_webhook_attempts_valido CHECK (attempt_no >= 1 AND duration_ms >= 0)');
        DB::statement("SELECT enable_tenant_rls('api_webhook_attempts')");
        DB::statement('REVOKE UPDATE, DELETE, TRUNCATE ON api_webhook_attempts FROM aycha_app');   // solo inserción

        Schema::create('api_sandboxes', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->string('paired_tenant', 60);
            $table->string('status', 20)->default('READY');
            $table->string('ose_provider', 20)->default('FAKE');
            $table->string('messaging_provider', 20)->default('FAKE');
            $table->string('payments_provider', 20)->default('FAKE');
            $table->string('host', 120)->default('https://sandbox.gestioncarnica.pe');
            $table->timestampTz('last_reset_at');
            $table->date('next_reset_at');
            $table->integer('reset_count')->default(1);
            $table->uuid('reset_by')->nullable();
            $table->string('reset_by_name', 120)->default('Sistema');
            $table->jsonb('data');
            $table->jsonb('seq');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete();
            $table->foreign('reset_by')->references('id')->on('users')->restrictOnDelete();
        });
        DB::statement('CREATE UNIQUE INDEX api_sandboxes_empresa ON api_sandboxes (tenant_id)');
        DB::statement("ALTER TABLE api_sandboxes ADD CONSTRAINT api_sandboxes_estado CHECK (status IN ('READY','RESETTING') AND ose_provider = 'FAKE' AND messaging_provider = 'FAKE' AND payments_provider = 'FAKE')");
        DB::statement("SELECT enable_tenant_rls('api_sandboxes')");
        DB::statement('REVOKE DELETE, TRUNCATE ON api_sandboxes FROM aycha_app');
        DB::statement("SELECT audit.track('api_sandboxes')");
    }

    public function down(): void
    {
        foreach (['api_sandboxes', 'api_webhook_attempts', 'api_webhook_deliveries', 'api_webhook_endpoints'] as $t) {
            DB::statement("DROP TABLE IF EXISTS {$t} CASCADE");
        }
    }
};
