<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// TEL · generada desde el modelo del prototipo (tools/prototipo/generar_migraciones.py).
// Tablas: tel_settings, tel_activation_steps, tel_menus, tel_ring_groups, tel_ring_members, tel_numbers, tel_calls, tel_recordings, tel_transcripts, tel_recording_access_log.
// El dueño del módulo revisa tipos, únicos y estados antes de construir sus pantallas;
// los cambios se hacen con migraciones nuevas, no editando esta.
return new class extends Migration
{
    public function up(): void
    {
        // TEL · tel_settings
        Schema::create('tel_settings', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->boolean('singleton')->nullable();
            $table->string('provider', 20)->nullable()->comment('valores en el prototipo: TWILIO');
            $table->string('connector_id', 40)->nullable();
            $table->string('stage', 20)->nullable()->comment('valores en el prototipo: SETUP');
            $table->boolean('recording_enabled')->nullable();
            $table->boolean('transcription_enabled')->nullable();
            $table->text('recording_notice_text')->nullable();
            $table->string('notice_audio_file_id', 20)->nullable();
            $table->integer('retention_days')->nullable();
            $table->string('ring_strategy', 40)->nullable()->comment('valores en el prototipo: ROUND_ROBIN');
            $table->integer('ring_timeout_s')->nullable();
            $table->decimal('callback_due_minutes', 14, 2)->nullable();
            $table->boolean('outbound_registered_only')->nullable();
            $table->jsonb('rates')->nullable();
            $table->boolean('preview')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // TEL · tel_activation_steps
        Schema::create('tel_activation_steps', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->integer('step_no');
            $table->string('step_code', 40)->comment('valores en el prototipo: CARRIER_FORWARDING, PROVIDER_AND_NUMBERS, RECORDING_NOTICE, SELLER_USERS, SIGNED_POLICY, SWITCH_ON');
            $table->boolean('done')->default(false);
            $table->uuid('done_by')->nullable();
            $table->timestampTz('done_at')->nullable();
            $table->string('evidence_file_id', 20)->nullable();
            $table->text('notes')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // TEL · tel_menus
        Schema::create('tel_menus', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->string('name', 40)->nullable();
            $table->text('greeting_text')->nullable();
            $table->jsonb('business_hours')->nullable();
            $table->string('after_hours_action', 40)->nullable()->comment('valores en el prototipo: CALLBACK_TASK');
            $table->jsonb('options')->nullable();
            $table->string('status', 20)->nullable()->comment('valores en el prototipo: ACTIVE');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // TEL · tel_ring_groups
        Schema::create('tel_ring_groups', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('brand_id');
            $table->string('name', 80);
            $table->string('strategy', 40)->comment('valores en el prototipo: ROUND_ROBIN, SIMULTANEOUS');
            $table->integer('ring_timeout_s');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // TEL · tel_ring_members
        Schema::create('tel_ring_members', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('group_id');
            $table->uuid('user_id');
            $table->integer('priority');
            $table->boolean('active')->default(false);
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // TEL · tel_numbers
        Schema::create('tel_numbers', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('brand_id')->nullable();
            $table->string('e164', 40);
            $table->string('number_kind', 40)->comment('valores en el prototipo: LANDLINE_LIMA, TOLL_FREE, VIRTUAL_MOBILE');
            $table->string('provider_ref', 40)->nullable();
            $table->uuid('menu_id')->nullable();
            $table->uuid('ring_group_id')->nullable();
            $table->jsonb('forwarded_from');
            $table->string('status', 20)->comment('valores en el prototipo: ACTIVE, INACTIVE');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // TEL · tel_calls
        Schema::create('tel_calls', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->string('provider_call_id', 40);
            $table->boolean('preview')->default(false);
            $table->uuid('number_id');
            $table->string('direction', 20)->comment('valores en el prototipo: INBOUND, OUTBOUND');
            $table->string('from_e164', 40);
            $table->string('to_e164', 40);
            $table->uuid('brand_id');
            $table->uuid('customer_id')->nullable();
            $table->string('lead_id', 20)->nullable();
            $table->string('lead_phone', 40)->nullable();
            $table->uuid('order_id')->nullable();
            $table->uuid('user_id')->nullable();
            $table->string('status', 40)->comment('valores en el prototipo: BUSY, COMPLETED, FAILED, IN_PROGRESS, MISSED, NO_ANSWER, RINGING, VOICEMAIL');
            $table->boolean('notice_played')->default(false);
            $table->timestampTz('started_at');
            $table->timestampTz('answered_at')->nullable();
            $table->timestampTz('ended_at')->nullable();
            $table->integer('wait_seconds')->nullable();
            $table->integer('duration_seconds')->nullable();
            $table->decimal('cost_usd', 18, 4)->nullable();
            $table->integer('menu_option')->nullable();
            $table->jsonb('preview_task')->nullable();
            $table->boolean('pilot')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // TEL · tel_recordings
        Schema::create('tel_recordings', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('call_id');
            $table->string('file_id', 40);
            $table->integer('duration_seconds');
            $table->string('provider_recording_id', 40);
            $table->date('retention_until');
            $table->boolean('legal_hold')->default(false);
            $table->string('status', 40)->comment('valores en el prototipo: AVAILABLE, PURGED');
            $table->timestampTz('purged_at')->nullable();
            $table->boolean('preview')->default(false);
            $table->string('legal_hold_reason', 255)->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // TEL · tel_transcripts
        Schema::create('tel_transcripts', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('call_id');
            $table->uuid('recording_id');
            $table->string('provider', 80)->comment('valores en el prototipo: TWILIO_VOICE_INTELLIGENCE');
            $table->string('language', 20);
            $table->text('transcript');
            $table->decimal('cost_usd', 14, 2);
            $table->boolean('preview')->default(false);
            $table->jsonb('preview_alerts');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // TEL · tel_recording_access_log
        Schema::create('tel_recording_access_log', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('recording_id');
            $table->uuid('user_id');
            $table->string('action', 20)->comment('valores en el prototipo: DOWNLOAD, PLAY');
            $table->string('reason', 80);
            $table->timestampTz('accessed_at');
            $table->boolean('preview')->default(false);
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });

        Schema::table('tel_settings', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('tel_activation_steps', function (Blueprint $table) { $table->foreign('done_by')->references('id')->on('users')->restrictOnDelete(); $table->index('done_by'); });
        Schema::table('tel_activation_steps', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('tel_menus', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('tel_ring_groups', function (Blueprint $table) { $table->foreign('brand_id')->references('id')->on('brands')->restrictOnDelete(); $table->index('brand_id'); });
        Schema::table('tel_ring_groups', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('tel_ring_members', function (Blueprint $table) { $table->foreign('group_id')->references('id')->on('tel_ring_groups')->restrictOnDelete(); $table->index('group_id'); });
        Schema::table('tel_ring_members', function (Blueprint $table) { $table->foreign('user_id')->references('id')->on('users')->restrictOnDelete(); $table->index('user_id'); });
        Schema::table('tel_ring_members', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('tel_numbers', function (Blueprint $table) { $table->foreign('brand_id')->references('id')->on('brands')->restrictOnDelete(); $table->index('brand_id'); });
        Schema::table('tel_numbers', function (Blueprint $table) { $table->foreign('menu_id')->references('id')->on('tel_menus')->restrictOnDelete(); $table->index('menu_id'); });
        Schema::table('tel_numbers', function (Blueprint $table) { $table->foreign('ring_group_id')->references('id')->on('tel_ring_groups')->restrictOnDelete(); $table->index('ring_group_id'); });
        Schema::table('tel_numbers', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('tel_calls', function (Blueprint $table) { $table->foreign('number_id')->references('id')->on('tel_numbers')->restrictOnDelete(); $table->index('number_id'); });
        Schema::table('tel_calls', function (Blueprint $table) { $table->foreign('brand_id')->references('id')->on('brands')->restrictOnDelete(); $table->index('brand_id'); });
        Schema::table('tel_calls', function (Blueprint $table) { $table->foreign('customer_id')->references('id')->on('customers')->restrictOnDelete(); $table->index('customer_id'); });
        Schema::table('tel_calls', function (Blueprint $table) { $table->foreign('order_id')->references('id')->on('sales_orders')->restrictOnDelete(); $table->index('order_id'); });
        Schema::table('tel_calls', function (Blueprint $table) { $table->foreign('user_id')->references('id')->on('users')->restrictOnDelete(); $table->index('user_id'); });
        Schema::table('tel_calls', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('tel_recordings', function (Blueprint $table) { $table->foreign('call_id')->references('id')->on('tel_calls')->restrictOnDelete(); $table->index('call_id'); });
        Schema::table('tel_recordings', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('tel_transcripts', function (Blueprint $table) { $table->foreign('call_id')->references('id')->on('tel_calls')->restrictOnDelete(); $table->index('call_id'); });
        Schema::table('tel_transcripts', function (Blueprint $table) { $table->foreign('recording_id')->references('id')->on('tel_recordings')->restrictOnDelete(); $table->index('recording_id'); });
        Schema::table('tel_transcripts', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('tel_recording_access_log', function (Blueprint $table) { $table->foreign('recording_id')->references('id')->on('tel_recordings')->restrictOnDelete(); $table->index('recording_id'); });
        Schema::table('tel_recording_access_log', function (Blueprint $table) { $table->foreign('user_id')->references('id')->on('users')->restrictOnDelete(); $table->index('user_id'); });
        Schema::table('tel_recording_access_log', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });

        DB::statement("SELECT enable_tenant_rls('tel_settings')");
        DB::statement("SELECT enable_tenant_rls('tel_activation_steps')");
        DB::statement("SELECT enable_tenant_rls('tel_menus')");
        DB::statement("SELECT enable_tenant_rls('tel_ring_groups')");
        DB::statement("SELECT enable_tenant_rls('tel_ring_members')");
        DB::statement("SELECT enable_tenant_rls('tel_numbers')");
        DB::statement("SELECT enable_tenant_rls('tel_calls')");
        DB::statement("SELECT enable_tenant_rls('tel_recordings')");
        DB::statement("SELECT enable_tenant_rls('tel_transcripts')");
        DB::statement("SELECT enable_tenant_rls('tel_recording_access_log')");
        DB::statement('REVOKE UPDATE, DELETE, TRUNCATE ON tel_recording_access_log FROM aycha_app');  // solo inserción
    }

    public function down(): void
    {
        DB::statement('DROP TABLE IF EXISTS tel_recording_access_log CASCADE');
        DB::statement('DROP TABLE IF EXISTS tel_transcripts CASCADE');
        DB::statement('DROP TABLE IF EXISTS tel_recordings CASCADE');
        DB::statement('DROP TABLE IF EXISTS tel_calls CASCADE');
        DB::statement('DROP TABLE IF EXISTS tel_numbers CASCADE');
        DB::statement('DROP TABLE IF EXISTS tel_ring_members CASCADE');
        DB::statement('DROP TABLE IF EXISTS tel_ring_groups CASCADE');
        DB::statement('DROP TABLE IF EXISTS tel_menus CASCADE');
        DB::statement('DROP TABLE IF EXISTS tel_activation_steps CASCADE');
        DB::statement('DROP TABLE IF EXISTS tel_settings CASCADE');
    }
};
