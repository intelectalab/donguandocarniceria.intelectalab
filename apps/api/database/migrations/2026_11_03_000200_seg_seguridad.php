<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// SEG · generada desde el modelo del prototipo (tools/prototipo/generar_migraciones.py).
// Tablas: users, roles, permissions, role_permissions, user_roles, user_scopes, user_devices, user_sessions, password_history, password_reset_tokens, mfa_recovery_codes.
// El dueño del módulo revisa tipos, únicos y estados antes de construir sus pantallas;
// los cambios se hacen con migraciones nuevas, no editando esta.
return new class extends Migration
{
    public function up(): void
    {
        // SEG · users
        Schema::create('users', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('employee_id')->nullable();
            $table->string('name', 255);
            $table->string('email', 80);
            $table->string('role', 80);
            $table->string('status', 20)->comment('valores en el prototipo: ACTIVE, INACTIVE, INVITED, LOCKED');
            $table->boolean('twofa_enabled')->default(false);
            $table->timestampTz('last_login')->nullable();
            $table->timestampTz('password_changed_at')->nullable();
            $table->boolean('must_change_password')->nullable();
            $table->timestampTz('locked_until')->nullable();
            $table->timestampTz('last_failed_login_at')->nullable();
            $table->timestampTz('mfa_enrolled_at')->nullable();
            $table->string('totp_last_step', 20)->nullable();
            $table->uuid('default_brand_id')->nullable();
            $table->string('ui_theme_mode', 20)->nullable()->comment('valores en el prototipo: SYSTEM');
            $table->string('locale', 20)->nullable();
            $table->jsonb('notify_prefs')->nullable();
            $table->string('password', 255)->comment('hash de Laravel (el prototipo guarda un hash de demo)');
            $table->integer('failed_logins');
            $table->string('lock_reason', 80)->nullable();
            $table->uuid('customer_id')->nullable();
            $table->timestampTz('deactivated_at')->nullable();
            $table->string('deactivated_reason', 255)->nullable();
            $table->string('user_type', 40)->nullable()->comment('valores en el prototipo: B2B_CUSTOMER');
            $table->boolean('twofa_required')->nullable();
            $table->timestampTz('invited_at')->nullable();
            $table->string('invited_by', 40)->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // SEG · roles
        Schema::create('roles', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->string('code', 80);
            $table->string('name', 80);
            $table->boolean('is_system')->default(false);
            $table->text('description')->nullable();
            $table->boolean('requires_mfa')->default(false);
            $table->string('scope_mode', 20)->comment('valores en el prototipo: ALL, ASSIGNED, BRAND');
            $table->integer('phase')->nullable();
            $table->string('status', 20)->comment('valores en el prototipo: ACTIVE');
            $table->string('source', 20)->nullable()->comment('valores en el prototipo: TEMPLATE');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // SEG · permissions
        Schema::create('permissions', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->string('code', 80);
            $table->string('module_code', 20);
            $table->text('description');
            $table->boolean('everyone')->default(false);
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // SEG · role_permissions
        Schema::create('role_permissions', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('role_id');
            $table->uuid('permission_id');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // SEG · user_roles
        Schema::create('user_roles', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('user_id');
            $table->uuid('role_id');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // SEG · user_scopes
        Schema::create('user_scopes', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('user_id');
            $table->uuid('brand_id')->nullable();
            $table->uuid('establishment_id')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // SEG · user_devices
        Schema::create('user_devices', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('user_id');
            $table->string('fingerprint_hash', 40);
            $table->string('fingerprint_hint', 40);
            $table->string('name', 80);
            $table->string('platform', 20)->comment('valores en el prototipo: ANDROID, IOS, WEB');
            $table->string('status', 20)->comment('valores en el prototipo: APPROVED, PENDING, REVOKED');
            $table->uuid('approved_by')->nullable();
            $table->timestampTz('approved_at')->nullable();
            $table->timestampTz('revoked_at')->nullable();
            $table->string('revoke_reason', 80)->nullable();
            $table->timestampTz('requested_at');
            $table->timestampTz('last_seen_at');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // SEG · user_sessions
        Schema::create('user_sessions', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('user_id');
            $table->uuid('device_id')->nullable();
            $table->string('token_hash', 20);
            $table->string('ip', 40);
            $table->string('user_agent', 80);
            $table->string('client', 20)->comment('valores en el prototipo: ANDROID, IOS, WEB');
            $table->string('status', 20)->comment('valores en el prototipo: ACTIVE, EXPIRED, REVOKED');
            $table->timestampTz('mfa_verified_at')->nullable();
            $table->timestampTz('started_at');
            $table->timestampTz('last_seen_at');
            $table->timestampTz('expires_at');
            $table->timestampTz('revoked_at')->nullable();
            $table->string('revoke_reason', 80)->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // SEG · password_history
        Schema::create('password_history', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('user_id');
            $table->string('password_hash', 40);
            $table->timestampTz('set_at');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // SEG · password_reset_tokens
        Schema::create('password_reset_tokens', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('user_id')->nullable();
            $table->string('token_hash', 40)->nullable();
            $table->timestampTz('expires_at')->nullable();
            $table->timestampTz('used_at')->nullable();
            $table->string('voided_at', 20)->nullable();
            $table->string('requested_ip', 40)->nullable();
            $table->string('kind', 20)->nullable()->comment('valores en el prototipo: RESET');
            $table->timestampTz('requested_at')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // SEG · mfa_recovery_codes
        Schema::create('mfa_recovery_codes', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('user_id');
            $table->string('code_hash', 40);
            $table->integer('batch_no');
            $table->timestampTz('used_at')->nullable();
            $table->string('voided_at', 20)->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });

        Schema::table('users', function (Blueprint $table) { $table->foreign('default_brand_id')->references('id')->on('brands')->restrictOnDelete(); $table->index('default_brand_id'); });
        Schema::table('users', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('roles', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('permissions', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('role_permissions', function (Blueprint $table) { $table->foreign('role_id')->references('id')->on('roles')->restrictOnDelete(); $table->index('role_id'); });
        Schema::table('role_permissions', function (Blueprint $table) { $table->foreign('permission_id')->references('id')->on('permissions')->restrictOnDelete(); $table->index('permission_id'); });
        Schema::table('role_permissions', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('user_roles', function (Blueprint $table) { $table->foreign('user_id')->references('id')->on('users')->restrictOnDelete(); $table->index('user_id'); });
        Schema::table('user_roles', function (Blueprint $table) { $table->foreign('role_id')->references('id')->on('roles')->restrictOnDelete(); $table->index('role_id'); });
        Schema::table('user_roles', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('user_scopes', function (Blueprint $table) { $table->foreign('user_id')->references('id')->on('users')->restrictOnDelete(); $table->index('user_id'); });
        Schema::table('user_scopes', function (Blueprint $table) { $table->foreign('brand_id')->references('id')->on('brands')->restrictOnDelete(); $table->index('brand_id'); });
        Schema::table('user_scopes', function (Blueprint $table) { $table->foreign('establishment_id')->references('id')->on('establishments')->restrictOnDelete(); $table->index('establishment_id'); });
        Schema::table('user_scopes', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('user_devices', function (Blueprint $table) { $table->foreign('user_id')->references('id')->on('users')->restrictOnDelete(); $table->index('user_id'); });
        Schema::table('user_devices', function (Blueprint $table) { $table->foreign('approved_by')->references('id')->on('users')->restrictOnDelete(); $table->index('approved_by'); });
        Schema::table('user_devices', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('user_sessions', function (Blueprint $table) { $table->foreign('user_id')->references('id')->on('users')->restrictOnDelete(); $table->index('user_id'); });
        Schema::table('user_sessions', function (Blueprint $table) { $table->foreign('device_id')->references('id')->on('user_devices')->restrictOnDelete(); $table->index('device_id'); });
        Schema::table('user_sessions', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('password_history', function (Blueprint $table) { $table->foreign('user_id')->references('id')->on('users')->restrictOnDelete(); $table->index('user_id'); });
        Schema::table('password_history', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('password_reset_tokens', function (Blueprint $table) { $table->foreign('user_id')->references('id')->on('users')->restrictOnDelete(); $table->index('user_id'); });
        Schema::table('password_reset_tokens', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('mfa_recovery_codes', function (Blueprint $table) { $table->foreign('user_id')->references('id')->on('users')->restrictOnDelete(); $table->index('user_id'); });
        Schema::table('mfa_recovery_codes', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });

        Schema::table('users', fn (Blueprint $table) => $table->unique(['tenant_id', 'email']));
        DB::statement("SELECT enable_tenant_rls('users')");
        Schema::table('roles', fn (Blueprint $table) => $table->unique(['tenant_id', 'code']));
        DB::statement("SELECT enable_tenant_rls('roles')");
        Schema::table('permissions', fn (Blueprint $table) => $table->unique(['tenant_id', 'code']));
        DB::statement("SELECT enable_tenant_rls('permissions')");
        DB::statement("SELECT enable_tenant_rls('role_permissions')");
        DB::statement("SELECT enable_tenant_rls('user_roles')");
        DB::statement("SELECT enable_tenant_rls('user_scopes')");
        DB::statement("SELECT enable_tenant_rls('user_devices')");
        DB::statement("SELECT enable_tenant_rls('user_sessions')");
        DB::statement("SELECT enable_tenant_rls('password_history')");
        DB::statement('REVOKE UPDATE, DELETE, TRUNCATE ON password_history FROM aycha_app');  // solo inserción
        DB::statement("SELECT enable_tenant_rls('password_reset_tokens')");
        DB::statement("SELECT enable_tenant_rls('mfa_recovery_codes')");
    }

    public function down(): void
    {
        DB::statement('DROP TABLE IF EXISTS mfa_recovery_codes CASCADE');
        DB::statement('DROP TABLE IF EXISTS password_reset_tokens CASCADE');
        DB::statement('DROP TABLE IF EXISTS password_history CASCADE');
        DB::statement('DROP TABLE IF EXISTS user_sessions CASCADE');
        DB::statement('DROP TABLE IF EXISTS user_devices CASCADE');
        DB::statement('DROP TABLE IF EXISTS user_scopes CASCADE');
        DB::statement('DROP TABLE IF EXISTS user_roles CASCADE');
        DB::statement('DROP TABLE IF EXISTS role_permissions CASCADE');
        DB::statement('DROP TABLE IF EXISTS permissions CASCADE');
        DB::statement('DROP TABLE IF EXISTS roles CASCADE');
        DB::statement('DROP TABLE IF EXISTS users CASCADE');
    }
};
