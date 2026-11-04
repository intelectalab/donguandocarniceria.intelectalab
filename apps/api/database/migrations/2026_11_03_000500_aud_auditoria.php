<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// AUD · generada desde el modelo del prototipo (tools/prototipo/generar_migraciones.py).
// Tablas: access_log, data_exports, audit_retention_policies, audit_purge_runs, access_reviews.
// El dueño del módulo revisa tipos, únicos y estados antes de construir sus pantallas;
// los cambios se hacen con migraciones nuevas, no editando esta.
return new class extends Migration
{
    public function up(): void
    {
        // AUD · access_log
        Schema::create('access_log', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('user_id')->nullable();
            $table->string('email_attempted', 80)->nullable();
            $table->string('event', 80);
            $table->string('module_code', 20)->nullable()->comment('valores en el prototipo: SEG');
            $table->string('ip', 40);
            $table->string('user_agent', 80)->nullable();
            $table->jsonb('details')->nullable();
            $table->timestampTz('occurred_at')->nullable();
            $table->timestampTz('at');
            $table->string('user_name', 40);
            $table->string('role', 80)->nullable();
            $table->string('device', 80);
            $table->text('detail')->nullable();
            $table->string('result', 20)->comment('valores en el prototipo: DENIED, OK');
            $table->uuid('device_id')->nullable();
            $table->string('session_id', 20)->nullable();
            $table->string('entity', 40)->nullable();
            $table->uuid('entity_id')->nullable()->comment('referencia polimórfica: data_exports, file_attachments, users');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // AUD · data_exports
        Schema::create('data_exports', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->string('number', 40);
            $table->string('format', 20);
            $table->jsonb('downloads');
            $table->string('file_name', 80);
            $table->string('watermark', 255);
            $table->string('source_module', 20)->comment('valores en el prototipo: AUD, CMP, SEP');
            $table->string('report', 40);
            $table->string('report_name', 255);
            $table->jsonb('filters');
            $table->integer('rows_count');
            $table->boolean('contains_personal_data')->default(false);
            $table->string('reason', 255);
            $table->string('status', 40)->comment('valores en el prototipo: EXPIRED, PENDING_APPROVAL, READY, REJECTED');
            $table->uuid('requested_by_id');
            $table->string('requested_by', 40);
            $table->string('requested_role', 40)->comment('valores en el prototipo: CONTADORA, GERENTE, MARKETING, RRHH, SUPERVISORA_VENTAS');
            $table->timestampTz('requested_at');
            $table->string('approved_by', 40)->nullable();
            $table->timestampTz('link_expires_at')->nullable();
            $table->uuid('approved_by_id')->nullable();
            $table->timestampTz('approved_at')->nullable();
            $table->string('rejected_by', 40)->nullable();
            $table->timestampTz('rejected_at')->nullable();
            $table->string('reject_reason', 255)->nullable();
            $table->string('sha256', 255)->nullable();
            $table->integer('size_bytes')->nullable();
            $table->string('link_token', 80)->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // AUD · audit_retention_policies
        Schema::create('audit_retention_policies', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->string('category', 40)->comment('valores en el prototipo: ACCESS_LOG, CHANGE_LOG, DOMAIN_EVENTS, EXPORTS, FILES, NOTIFICATIONS, OUTBOX, RECORDINGS, WEBHOOKS');
            $table->integer('months');
            $table->string('unit', 20)->comment('valores en el prototipo: DAYS, MONTHS');
            $table->boolean('archive_before_purge')->default(false);
            $table->string('reason', 255);
            $table->string('updated_by', 40);
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // AUD · audit_purge_runs
        Schema::create('audit_purge_runs', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->string('number', 20);
            $table->string('category', 40)->comment('valores en el prototipo: NOTIFICATIONS, OUTBOX, WEBHOOKS');
            $table->date('cutoff_date');
            $table->integer('archived_rows');
            $table->integer('purged_rows');
            $table->string('archive_file', 255)->nullable();
            $table->string('archive_sha256', 255)->nullable();
            $table->string('status', 40)->comment('valores en el prototipo: COMPLETED');
            $table->timestampTz('started_at');
            $table->timestampTz('finished_at');
            $table->string('run_by', 80);
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // AUD · access_reviews
        Schema::create('access_reviews', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->string('number', 40);
            $table->string('quarter', 20);
            $table->string('status', 40)->comment('valores en el prototipo: COMPLETED, OPEN');
            $table->timestampTz('opened_at');
            $table->date('due_date');
            $table->timestampTz('closed_at')->nullable();
            $table->string('reviewer', 40)->nullable();
            $table->uuid('reviewer_id')->nullable();
            $table->jsonb('items')->nullable();
            $table->jsonb('deactivated')->nullable();
            $table->string('findings', 255)->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });

        Schema::table('access_log', function (Blueprint $table) { $table->foreign('user_id')->references('id')->on('users')->restrictOnDelete(); $table->index('user_id'); });
        Schema::table('access_log', function (Blueprint $table) { $table->foreign('device_id')->references('id')->on('user_devices')->restrictOnDelete(); $table->index('device_id'); });
        Schema::table('access_log', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('data_exports', function (Blueprint $table) { $table->foreign('requested_by_id')->references('id')->on('users')->restrictOnDelete(); $table->index('requested_by_id'); });
        Schema::table('data_exports', function (Blueprint $table) { $table->foreign('approved_by_id')->references('id')->on('users')->restrictOnDelete(); $table->index('approved_by_id'); });
        Schema::table('data_exports', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('audit_retention_policies', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('audit_purge_runs', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('access_reviews', function (Blueprint $table) { $table->foreign('reviewer_id')->references('id')->on('users')->restrictOnDelete(); $table->index('reviewer_id'); });
        Schema::table('access_reviews', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });

        DB::statement("SELECT enable_tenant_rls('access_log')");
        DB::statement('REVOKE UPDATE, DELETE, TRUNCATE ON access_log FROM aycha_app');  // solo inserción
        DB::statement("SELECT enable_tenant_rls('data_exports')");
        DB::statement("SELECT enable_tenant_rls('audit_retention_policies')");
        DB::statement("SELECT enable_tenant_rls('audit_purge_runs')");
        DB::statement('REVOKE UPDATE, DELETE, TRUNCATE ON audit_purge_runs FROM aycha_app');  // solo inserción
        DB::statement("SELECT enable_tenant_rls('access_reviews')");
    }

    public function down(): void
    {
        DB::statement('DROP TABLE IF EXISTS access_reviews CASCADE');
        DB::statement('DROP TABLE IF EXISTS audit_purge_runs CASCADE');
        DB::statement('DROP TABLE IF EXISTS audit_retention_policies CASCADE');
        DB::statement('DROP TABLE IF EXISTS data_exports CASCADE');
        DB::statement('DROP TABLE IF EXISTS access_log CASCADE');
    }
};
