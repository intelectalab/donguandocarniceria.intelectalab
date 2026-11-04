<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// INT · generada desde el modelo del prototipo (tools/prototipo/generar_migraciones.py).
// Tablas: integration_connectors, integration_credentials, webhook_endpoints, webhook_events, outbox_messages, idempotency_keys, integration_runs, notifications, notification_preferences, file_attachments.
// El dueño del módulo revisa tipos, únicos y estados antes de construir sus pantallas;
// los cambios se hacen con migraciones nuevas, no editando esta.
return new class extends Migration
{
    public function up(): void
    {
        // INT · integration_connectors
        Schema::create('integration_connectors', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->string('code', 40);
            $table->string('name', 255);
            $table->string('kind', 40);
            $table->string('interface', 40);
            $table->string('provider', 40);
            $table->string('adapter', 80);
            $table->string('environment', 40)->comment('valores en el prototipo: PRODUCTION, SANDBOX');
            $table->string('owner_module', 20)->comment('valores en el prototipo: ADS, CRM, DEL, FAC, GRJ, INT, MAE, PER, POS, PRE, TEL, WEB');
            $table->uuid('brand_id')->nullable();
            $table->uuid('establishment_id')->nullable();
            $table->string('status', 20)->comment('valores en el prototipo: ACTIVE, DISABLED, ERROR, PENDING');
            $table->jsonb('config');
            $table->integer('consecutive_failures');
            $table->timestampTz('last_ok_at')->nullable();
            $table->timestampTz('last_error_at')->nullable();
            $table->string('last_error', 255)->nullable();
            $table->jsonb('errors');
            $table->decimal('latency_ms', 14, 2);
            $table->boolean('simulate_down')->default(false);
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // INT · integration_credentials
        Schema::create('integration_credentials', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('connector_id');
            $table->string('name', 80);
            $table->integer('version');
            $table->string('secret_enc', 255);
            $table->string('last4', 20);
            $table->timestampTz('expires_at')->nullable();
            $table->string('status', 20)->comment('valores en el prototipo: ACTIVE, REVOKED');
            $table->string('created_by', 40);
            $table->timestampTz('revoked_at')->nullable();
            $table->string('revoked_reason', 20)->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // INT · webhook_endpoints
        Schema::create('webhook_endpoints', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('connector_id');
            $table->string('name', 80);
            $table->string('owner_module', 20)->comment('valores en el prototipo: CRM, DEL, FAC, TEL, WEB');
            $table->string('token', 80);
            $table->string('url', 255);
            $table->string('signature_scheme', 80);
            $table->string('secret_enc', 255);
            $table->string('status', 20)->comment('valores en el prototipo: ACTIVE');
            $table->integer('received_count');
            $table->timestampTz('last_received_at')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // INT · webhook_events
        Schema::create('webhook_events', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('endpoint_id')->nullable();
            $table->uuid('connector_id')->nullable();
            $table->string('owner_module', 20)->nullable()->comment('valores en el prototipo: CRM, DEL, TEL, WEB');
            $table->string('event_key', 80)->nullable();
            $table->jsonb('headers')->nullable();
            $table->text('body')->nullable();
            $table->string('signature', 255)->nullable();
            $table->timestampTz('received_at');
            $table->string('status', 40)->comment('valores en el prototipo: FAILED, IGNORED, PROCESSED, REJECTED');
            $table->integer('http_status')->nullable();
            $table->integer('duplicates')->nullable();
            $table->decimal('attempts', 14, 2)->nullable();
            $table->timestampTz('processed_at')->nullable();
            $table->integer('ack_ms')->nullable();
            $table->string('result', 255)->nullable();
            $table->string('last_error', 255)->nullable();
            $table->string('source', 40)->nullable()->comment('valores en el prototipo: PAYMENT_GATEWAY');
            $table->string('provider', 20)->nullable()->comment('valores en el prototipo: FAKE');
            $table->string('event_type', 40)->nullable();
            $table->string('external_id', 40)->nullable();
            $table->jsonb('payload')->nullable();
            $table->boolean('signature_ok')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // INT · outbox_messages
        Schema::create('outbox_messages', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->string('number', 40);
            $table->string('status', 20)->comment('valores en el prototipo: DEAD, RETRYING, SENT');
            $table->decimal('attempts', 14, 2);
            $table->timestampTz('next_attempt_at')->nullable();
            $table->string('last_error', 255)->nullable();
            $table->jsonb('tries');
            $table->string('idempotency_key', 80);
            $table->uuid('connector_id');
            $table->string('module', 20)->comment('valores en el prototipo: CRM, FAC, INT, WEB');
            $table->string('kind', 40)->comment('valores en el prototipo: DOMAIN_EVENT, EINVOICE, MESSAGE, SYNC');
            $table->string('event', 40);
            $table->jsonb('payload');
            $table->string('ref', 40)->nullable();
            $table->timestampTz('sent_at')->nullable();
            $table->string('provider_ref', 80)->nullable();
            $table->timestampTz('dead_at')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // INT · idempotency_keys
        Schema::create('idempotency_keys', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->string('key', 80);
            $table->string('scope', 80);
            $table->string('request_hash', 255);
            $table->string('status', 40)->comment('valores en el prototipo: COMPLETED, EXPIRED');
            $table->integer('response_code');
            $table->jsonb('response_body');
            $table->uuid('user_id')->nullable();
            $table->timestampTz('completed_at');
            $table->timestampTz('expires_at');
            $table->integer('replays');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // INT · integration_runs
        Schema::create('integration_runs', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('connector_id');
            $table->string('job', 40)->comment('valores en el prototipo: ADS_SPEND_IMPORT, FX_DAILY, GRJ_LOTS_SYNC, WOO_CATALOG_SYNC, WOO_STOCK_SYNC');
            $table->timestampTz('started_at');
            $table->timestampTz('finished_at');
            $table->string('status', 40)->comment('valores en el prototipo: COMPLETED, FAILED, PARTIAL');
            $table->integer('items_ok');
            $table->integer('items_failed');
            $table->text('detail');
            $table->string('triggered_by', 80);
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // INT · notifications
        Schema::create('notifications', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('user_id')->nullable();
            $table->string('title', 255);
            $table->text('body');
            $table->jsonb('ref')->nullable();
            $table->string('tone', 20);
            $table->string('module', 20)->comment('valores en el prototipo: AUD, CRM, FAC, INT, MAE, PED, PLT, PRS, SEG, SUS');
            $table->timestampTz('read_at')->nullable();
            $table->timestampTz('at');
            $table->string('severity', 20)->nullable()->comment('valores en el prototipo: CRITICAL, INFO, WARNING');
            $table->string('type', 40)->nullable()->comment('valores en el prototipo: APPROVALS, DOCUMENTS, INTEGRATIONS, ORDERS, PAYMENTS, SECURITY');
            $table->jsonb('channels')->nullable();
            $table->boolean('in_app')->nullable();
            $table->string('role', 40)->nullable()->comment('valores en el prototipo: ADMIN_SISTEMA');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // INT · notification_preferences
        Schema::create('notification_preferences', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('user_id');
            $table->string('type', 40)->comment('valores en el prototipo: APPROVALS, CRITICAL, EXPORTS, INTEGRATIONS, ORDERS, PAYMENTS, SECURITY, STOCK');
            $table->boolean('in_app')->default(false);
            $table->boolean('email')->default(false);
            $table->boolean('push')->default(false);
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // INT · file_attachments
        Schema::create('file_attachments', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->string('entity', 40)->nullable();
            $table->uuid('entity_id')->nullable()->comment('referencia polimórfica: brand_separations, data_imports, employees, payments, sales_documents, sales_orders, suppliers');
            $table->string('file_name', 80);
            $table->string('ext', 20)->nullable()->comment('valores en el prototipo: CSV, JPG, PDF, PNG, XML');
            $table->integer('size_bytes');
            $table->string('sha256', 255);
            $table->string('classification', 40)->comment('valores en el prototipo: CONFIDENTIAL, INTERNAL, PERSONAL_DATA');
            $table->string('storage_key', 255);
            $table->string('status', 20)->comment('valores en el prototipo: ACTIVE, DELETED');
            $table->string('uploaded_by', 40)->nullable();
            $table->timestampTz('uploaded_at')->nullable();
            $table->jsonb('links')->nullable();
            $table->string('deleted_reason', 80)->nullable();
            $table->string('deleted_by', 40)->nullable();
            $table->timestampTz('deleted_at')->nullable();
            $table->string('mime', 40)->nullable();
            $table->string('module_code', 20)->nullable()->comment('valores en el prototipo: ONB');
            $table->string('entity_type', 40)->nullable();
            $table->string('mime_type', 20)->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });

        Schema::table('integration_connectors', function (Blueprint $table) { $table->foreign('brand_id')->references('id')->on('brands')->restrictOnDelete(); $table->index('brand_id'); });
        Schema::table('integration_connectors', function (Blueprint $table) { $table->foreign('establishment_id')->references('id')->on('establishments')->restrictOnDelete(); $table->index('establishment_id'); });
        Schema::table('integration_connectors', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('integration_credentials', function (Blueprint $table) { $table->foreign('connector_id')->references('id')->on('integration_connectors')->restrictOnDelete(); $table->index('connector_id'); });
        Schema::table('integration_credentials', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('webhook_endpoints', function (Blueprint $table) { $table->foreign('connector_id')->references('id')->on('integration_connectors')->restrictOnDelete(); $table->index('connector_id'); });
        Schema::table('webhook_endpoints', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('webhook_events', function (Blueprint $table) { $table->foreign('endpoint_id')->references('id')->on('webhook_endpoints')->restrictOnDelete(); $table->index('endpoint_id'); });
        Schema::table('webhook_events', function (Blueprint $table) { $table->foreign('connector_id')->references('id')->on('integration_connectors')->restrictOnDelete(); $table->index('connector_id'); });
        Schema::table('webhook_events', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('outbox_messages', function (Blueprint $table) { $table->foreign('connector_id')->references('id')->on('integration_connectors')->restrictOnDelete(); $table->index('connector_id'); });
        Schema::table('outbox_messages', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('idempotency_keys', function (Blueprint $table) { $table->foreign('user_id')->references('id')->on('users')->restrictOnDelete(); $table->index('user_id'); });
        Schema::table('idempotency_keys', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('integration_runs', function (Blueprint $table) { $table->foreign('connector_id')->references('id')->on('integration_connectors')->restrictOnDelete(); $table->index('connector_id'); });
        Schema::table('integration_runs', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('notifications', function (Blueprint $table) { $table->foreign('user_id')->references('id')->on('users')->restrictOnDelete(); $table->index('user_id'); });
        Schema::table('notifications', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('notification_preferences', function (Blueprint $table) { $table->foreign('user_id')->references('id')->on('users')->restrictOnDelete(); $table->index('user_id'); });
        Schema::table('notification_preferences', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('file_attachments', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });

        DB::statement("SELECT enable_tenant_rls('integration_connectors')");
        DB::statement("SELECT enable_tenant_rls('integration_credentials')");
        DB::statement("SELECT enable_tenant_rls('webhook_endpoints')");
        DB::statement("SELECT enable_tenant_rls('webhook_events')");
        DB::statement("SELECT enable_tenant_rls('outbox_messages')");
        DB::statement("SELECT enable_tenant_rls('idempotency_keys')");
        DB::statement("SELECT enable_tenant_rls('integration_runs')");
        DB::statement("SELECT enable_tenant_rls('notifications')");
        DB::statement("SELECT enable_tenant_rls('notification_preferences')");
        DB::statement("SELECT enable_tenant_rls('file_attachments')");
    }

    public function down(): void
    {
        DB::statement('DROP TABLE IF EXISTS file_attachments CASCADE');
        DB::statement('DROP TABLE IF EXISTS notification_preferences CASCADE');
        DB::statement('DROP TABLE IF EXISTS notifications CASCADE');
        DB::statement('DROP TABLE IF EXISTS integration_runs CASCADE');
        DB::statement('DROP TABLE IF EXISTS idempotency_keys CASCADE');
        DB::statement('DROP TABLE IF EXISTS outbox_messages CASCADE');
        DB::statement('DROP TABLE IF EXISTS webhook_events CASCADE');
        DB::statement('DROP TABLE IF EXISTS webhook_endpoints CASCADE');
        DB::statement('DROP TABLE IF EXISTS integration_credentials CASCADE');
        DB::statement('DROP TABLE IF EXISTS integration_connectors CASCADE');
    }
};
