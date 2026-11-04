<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// CRM · generada desde el modelo del prototipo (tools/prototipo/generar_migraciones.py).
// Tablas: messages, messaging_channels, channel_members, channel_member_shifts, crm_agent_status, leads, channel_contacts, conversations, conversation_assignments, message_templates, quick_replies, conversation_messages, message_status_events, message_charges, message_transcripts, conversation_orders, contact_consents, official_identifiers, control_alert_rules, control_alerts, conversation_reviews, crm_tasks, customer_rebuy_profiles, delivery_surveys.
// El dueño del módulo revisa tipos, únicos y estados antes de construir sus pantallas;
// los cambios se hacen con migraciones nuevas, no editando esta.
return new class extends Migration
{
    public function up(): void
    {
        // CRM · messages
        Schema::create('messages', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('customer_id');
            $table->uuid('channel_id');
            $table->string('direction', 20)->comment('valores en el prototipo: IN, OUT');
            $table->string('kind', 40)->comment('valores en el prototipo: MARKETING, SESSION, UTILITY');
            $table->string('template', 40)->nullable();
            $table->text('text');
            $table->string('ref', 20)->nullable();
            $table->timestampTz('sent_at');
            $table->uuid('sender_user_id')->nullable();
            $table->string('status', 40)->comment('valores en el prototipo: DELIVERED, FAILED, READ, RECEIVED');
            $table->decimal('cost', 18, 4);
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // CRM · messaging_channels
        Schema::create('messaging_channels', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->string('kind', 40)->comment('valores en el prototipo: INSTAGRAM, MESSENGER, TIKTOK, WHATSAPP');
            $table->uuid('brand_id');
            $table->string('number', 40);
            $table->string('display_name', 40);
            $table->boolean('coexistence')->nullable();
            $table->string('provider', 40)->nullable()->comment('valores en el prototipo: CLOUD_API');
            $table->string('status', 20)->comment('valores en el prototipo: ACTIVE, PAUSED');
            $table->string('quality_rating', 20)->nullable()->comment('valores en el prototipo: HIGH, MEDIUM');
            $table->decimal('messaging_limit', 14, 2)->nullable();
            $table->string('connection_mode', 80)->nullable()->comment('valores en el prototipo: CLOUD_API_COEXISTENCE, DM_API, NOT_AVAILABLE');
            $table->string('external_id', 40)->nullable();
            $table->string('display_phone', 40)->nullable();
            $table->string('waba_id', 40)->nullable();
            $table->string('assignment_mode', 40)->nullable()->comment('valores en el prototipo: LEAST_OPEN, SHIFT_ROUND_ROBIN');
            $table->integer('free_service_quota')->nullable();
            $table->string('auto_greeting', 255)->nullable();
            $table->text('recording_notice_text')->nullable();
            $table->date('synced_history_from')->nullable();
            $table->timestampTz('connected_at')->nullable();
            $table->integer('group_msgs_discarded')->nullable();
            $table->timestampTz('catalog_synced_at')->nullable();
            $table->boolean('shared')->nullable();
            $table->timestampTz('embedded_signup_at')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // CRM · channel_members
        Schema::create('channel_members', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('channel_id');
            $table->uuid('user_id');
            $table->string('role', 40)->comment('valores en el prototipo: AGENT, SUPERVISOR');
            $table->string('status', 20)->comment('valores en el prototipo: ACTIVE');
            $table->string('member_role', 40)->comment('valores en el prototipo: AGENT, SUPERVISOR');
            $table->decimal('max_open_conversations', 14, 2);
            $table->boolean('active')->default(false);
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // CRM · channel_member_shifts
        Schema::create('channel_member_shifts', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('member_id');
            $table->integer('weekday');
            $table->time('time_from');
            $table->time('time_to');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // CRM · crm_agent_status
        Schema::create('crm_agent_status', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('user_id');
            $table->string('status', 20)->comment('valores en el prototipo: OFFLINE, ONLINE');
            $table->timestampTz('changed_at');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // CRM · leads
        Schema::create('leads', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('brand_id');
            $table->uuid('channel_id');
            $table->uuid('customer_id')->nullable();
            $table->string('full_name', 80);
            $table->string('phone', 40)->nullable();
            $table->string('source', 40)->comment('valores en el prototipo: INSTAGRAM, MESSENGER, TIKTOK, WHATSAPP');
            $table->uuid('owner_user_id')->nullable();
            $table->string('status', 40)->comment('valores en el prototipo: CONTACTED, LOST, NEW, WON');
            $table->timestampTz('first_contact_at');
            $table->text('notes')->nullable();
            $table->string('ad_code', 20)->nullable();
            $table->uuid('existing_customer_id')->nullable();
            $table->uuid('ad_id')->nullable();
            $table->timestampTz('first_response_at')->nullable();
            $table->uuid('converted_order_id')->nullable();
            $table->timestampTz('converted_at')->nullable();
            $table->string('lost_reason', 40)->nullable()->comment('valores en el prototipo: NO_RESPONSE, OUT_OF_ZONE, PRICE');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // CRM · channel_contacts
        Schema::create('channel_contacts', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->string('provider', 40)->comment('valores en el prototipo: INSTAGRAM, MESSENGER, TIKTOK, WHATSAPP');
            $table->string('external_user_id', 40);
            $table->string('display_name', 80);
            $table->string('phone', 40)->nullable();
            $table->uuid('customer_id')->nullable();
            $table->uuid('lead_id')->nullable();
            $table->boolean('blocked')->default(false);
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // CRM · conversations
        Schema::create('conversations', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('channel_id');
            $table->uuid('contact_id');
            $table->uuid('brand_id');
            $table->uuid('customer_id')->nullable();
            $table->uuid('lead_id')->nullable();
            $table->uuid('assigned_user_id')->nullable();
            $table->string('status', 20)->comment('valores en el prototipo: CLOSED, OPEN, PENDING');
            $table->string('entry_point', 40)->comment('valores en el prototipo: CTWA_AD, ORGANIC, TIKTOK_DM, TRACKING_CODE');
            $table->uuid('ad_id')->nullable();
            $table->string('ad_code', 20)->nullable();
            $table->timestampTz('opened_at');
            $table->timestampTz('last_inbound_at');
            $table->timestampTz('last_outbound_at');
            $table->integer('outbound_since_inbound');
            $table->timestampTz('first_response_at')->nullable();
            $table->timestampTz('service_window_expires_at');
            $table->timestampTz('free_entry_expires_at')->nullable();
            $table->timestampTz('closed_at')->nullable();
            $table->string('close_reason', 40)->nullable()->comment('valores en el prototipo: INACTIVE, INFO_ONLY, NO_PURCHASE, ORDER_CREATED');
            $table->jsonb('tags');
            $table->jsonb('internal_notes');
            $table->timestampTz('queued_at')->nullable();
            $table->timestampTz('last_reply_at')->nullable();
            $table->timestampTz('unanswered_flag_for')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // CRM · conversation_assignments
        Schema::create('conversation_assignments', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('conversation_id');
            $table->uuid('channel_id');
            $table->string('from_user_id', 20)->nullable();
            $table->uuid('to_user_id');
            $table->string('reason', 40)->comment('valores en el prototipo: AUTO_LEAST_OPEN, AUTO_SHIFT');
            $table->string('assigned_by', 20)->nullable();
            $table->timestampTz('assigned_at');
            $table->string('note', 20)->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // CRM · message_templates
        Schema::create('message_templates', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('brand_id');
            $table->uuid('channel_id')->nullable();
            $table->string('name', 40);
            $table->string('language', 20);
            $table->string('category', 40)->comment('valores en el prototipo: MARKETING, UTILITY');
            $table->string('purpose', 40)->comment('valores en el prototipo: ORDER_CONFIRMATION, ORDER_DISPATCHED, PAYMENT_REQUEST, POST_DELIVERY_SURVEY, PROMOTION, REBUY, WEIGHT_DIFFERENCE');
            $table->text('body');
            $table->jsonb('variables');
            $table->string('provider_template_id', 20)->nullable();
            $table->string('provider_status', 20)->comment('valores en el prototipo: APPROVED, PENDING, REJECTED');
            $table->string('rejection_reason', 255)->nullable();
            $table->timestampTz('submitted_at')->nullable();
            $table->string('reject_reason', 255)->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // CRM · quick_replies
        Schema::create('quick_replies', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('brand_id')->nullable();
            $table->uuid('owner_user_id')->nullable();
            $table->string('shortcut', 40);
            $table->text('body');
            $table->string('status', 20)->comment('valores en el prototipo: ACTIVE');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // CRM · conversation_messages
        Schema::create('conversation_messages', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('conversation_id');
            $table->uuid('channel_id');
            $table->uuid('brand_id');
            $table->string('direction', 20)->comment('valores en el prototipo: IN, OUT');
            $table->string('origin', 40)->comment('valores en el prototipo: API, BUSINESS_APP, SYSTEM');
            $table->uuid('sender_user_id')->nullable();
            $table->string('msg_type', 20)->comment('valores en el prototipo: AUDIO, LOCATION, PRODUCT, TEMPLATE, TEXT');
            $table->text('body')->nullable();
            $table->jsonb('media')->nullable();
            $table->uuid('template_id')->nullable();
            $table->string('category', 40)->nullable()->comment('valores en el prototipo: MARKETING, SERVICE, UTILITY');
            $table->jsonb('referral')->nullable();
            $table->uuid('order_id')->nullable();
            $table->timestampTz('sent_at');
            $table->string('unsupported_kind', 20)->nullable();
            $table->decimal('cost', 18, 4);
            $table->string('external_id', 40);
            $table->string('charge_reason', 80)->nullable()->comment('valores en el prototipo: BUSINESS_APP, CHARGED, FREE_CTWA_WINDOW, FREE_SERVICE_QUOTA, FREE_UTILITY_IN_WINDOW');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // CRM · message_status_events
        Schema::create('message_status_events', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('message_id');
            $table->string('status', 40)->comment('valores en el prototipo: DELETED_BY_CUSTOMER, DELETED_IN_APP, DELIVERED, SENT');
            $table->timestampTz('occurred_at');
            $table->string('pricing_category', 40)->nullable()->comment('valores en el prototipo: MARKETING, SERVICE, UTILITY');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // CRM · message_charges
        Schema::create('message_charges', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('message_id');
            $table->uuid('channel_id');
            $table->uuid('brand_id');
            $table->uuid('user_id')->nullable();
            $table->uuid('conversation_id');
            $table->uuid('order_id')->nullable();
            $table->date('period');
            $table->string('category', 40)->comment('valores en el prototipo: MARKETING, SERVICE, UTILITY');
            $table->boolean('billable')->default(false);
            $table->string('reason', 80)->comment('valores en el prototipo: BUSINESS_APP, CHARGED, FREE_CTWA_WINDOW, FREE_SERVICE_QUOTA, FREE_UTILITY_IN_WINDOW');
            $table->decimal('rate', 9, 4);
            $table->decimal('amount', 18, 4);
            $table->timestampTz('charged_at');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // CRM · message_transcripts
        Schema::create('message_transcripts', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('message_id')->nullable();
            $table->string('provider', 40)->nullable()->comment('valores en el prototipo: TRANSCRIPCION_FALSA');
            $table->string('language', 20)->nullable();
            $table->text('transcript')->nullable();
            $table->decimal('confidence', 14, 2)->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // CRM · conversation_orders
        Schema::create('conversation_orders', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('conversation_id');
            $table->uuid('order_id');
            $table->uuid('lead_id')->nullable();
            $table->timestampTz('linked_at');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // CRM · contact_consents
        Schema::create('contact_consents', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('customer_id')->nullable();
            $table->uuid('contact_id')->nullable();
            $table->string('purpose', 40)->comment('valores en el prototipo: MARKETING, RECORDING_NOTICE');
            $table->boolean('granted')->default(false);
            $table->string('channel', 40)->comment('valores en el prototipo: INSTAGRAM, MESSENGER, TIKTOK, WHATSAPP');
            $table->uuid('evidence_message_id')->nullable();
            $table->text('evidence_text');
            $table->timestampTz('recorded_at');
            $table->uuid('brand_id')->nullable();
            $table->string('recorded_by', 20)->nullable();
            $table->string('source', 40)->nullable()->comment('valores en el prototipo: FIRST_ORDER, KEYWORD');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // CRM · official_identifiers
        Schema::create('official_identifiers', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->string('identifier_type', 40)->comment('valores en el prototipo: BANK_ACCOUNT, CCI, EMAIL, PHONE, PLIN, URL, YAPE');
            $table->string('value', 80);
            $table->string('label', 80);
            $table->uuid('brand_id')->nullable();
            $table->string('status', 20)->comment('valores en el prototipo: ACTIVE');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // CRM · control_alert_rules
        Schema::create('control_alert_rules', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->string('code', 20);
            $table->string('rule_type', 40)->comment('valores en el prototipo: APP_DELETION, FOREIGN_ACCOUNT, FOREIGN_PHONE, KEYWORD, OFF_CATALOG_TERM, SURVEY_FLAG, UNANSWERED_CHAT');
            $table->string('pattern', 255);
            $table->string('severity', 20)->comment('valores en el prototipo: HIGH, LOW, MEDIUM');
            $table->string('name', 80);
            $table->jsonb('applies_to');
            $table->boolean('active')->default(false);
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // CRM · control_alerts
        Schema::create('control_alerts', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('rule_id');
            $table->string('rule_code', 20);
            $table->string('source_type', 20)->comment('valores en el prototipo: MESSAGE');
            $table->uuid('message_id')->nullable();
            $table->string('call_id', 20)->nullable();
            $table->uuid('conversation_id')->nullable();
            $table->uuid('user_id');
            $table->uuid('brand_id')->nullable();
            $table->string('severity', 20)->comment('valores en el prototipo: HIGH, LOW, MEDIUM');
            $table->text('matched_text');
            $table->string('excerpt', 255);
            $table->string('status', 40)->comment('valores en el prototipo: CONFIRMED, DISMISSED, OPEN');
            $table->timestampTz('raised_at');
            $table->uuid('reviewed_by')->nullable();
            $table->timestampTz('reviewed_at')->nullable();
            $table->string('resolution_note', 255)->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // CRM · conversation_reviews
        Schema::create('conversation_reviews', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('conversation_id');
            $table->uuid('reviewer_user_id');
            $table->date('sample_week');
            $table->string('result', 20)->comment('valores en el prototipo: OBSERVED, OK');
            $table->text('notes')->nullable();
            $table->timestampTz('reviewed_at');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // CRM · crm_tasks
        Schema::create('crm_tasks', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->string('status', 20)->comment('valores en el prototipo: OPEN');
            $table->string('done_at', 20)->nullable();
            $table->string('result', 20)->nullable();
            $table->string('task_type', 40)->comment('valores en el prototipo: ALERT_REVIEW, CALLBACK, FOLLOW_UP, REBUY, SURVEY_FOLLOW_UP, UNANSWERED_CHAT');
            $table->uuid('customer_id')->nullable();
            $table->uuid('order_id')->nullable();
            $table->uuid('brand_id');
            $table->uuid('assigned_user_id');
            $table->timestampTz('due_at');
            $table->string('note', 255);
            $table->uuid('conversation_id')->nullable();
            $table->uuid('lead_id')->nullable();
            $table->uuid('assigned_by')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // CRM · customer_rebuy_profiles
        Schema::create('customer_rebuy_profiles', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('customer_id');
            $table->uuid('brand_id');
            $table->timestampTz('computed_at');
            $table->integer('orders_count');
            $table->decimal('median_interval_days', 14, 2)->nullable();
            $table->date('last_order_at');
            $table->date('next_expected_at')->nullable();
            $table->string('status', 20)->comment('valores en el prototipo: ACTIVE, AT_RISK, DUE, LOST, NEW');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // CRM · delivery_surveys
        Schema::create('delivery_surveys', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('order_id');
            $table->uuid('customer_id');
            $table->uuid('seller_user_id')->nullable();
            $table->uuid('brand_id');
            $table->timestampTz('sent_at');
            $table->string('send_mode', 20)->comment('valores en el prototipo: SESSION, TEMPLATE');
            $table->timestampTz('answered_at')->nullable();
            $table->integer('rating_service')->nullable();
            $table->integer('rating_product')->nullable();
            $table->boolean('received_as_ordered')->nullable();
            $table->boolean('bought_outside_catalog')->nullable();
            $table->string('comments', 255)->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });

        Schema::table('messages', function (Blueprint $table) { $table->foreign('customer_id')->references('id')->on('customers')->restrictOnDelete(); $table->index('customer_id'); });
        Schema::table('messages', function (Blueprint $table) { $table->foreign('channel_id')->references('id')->on('messaging_channels')->restrictOnDelete(); $table->index('channel_id'); });
        Schema::table('messages', function (Blueprint $table) { $table->foreign('sender_user_id')->references('id')->on('users')->restrictOnDelete(); $table->index('sender_user_id'); });
        Schema::table('messages', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('messaging_channels', function (Blueprint $table) { $table->foreign('brand_id')->references('id')->on('brands')->restrictOnDelete(); $table->index('brand_id'); });
        Schema::table('messaging_channels', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('channel_members', function (Blueprint $table) { $table->foreign('channel_id')->references('id')->on('messaging_channels')->restrictOnDelete(); $table->index('channel_id'); });
        Schema::table('channel_members', function (Blueprint $table) { $table->foreign('user_id')->references('id')->on('users')->restrictOnDelete(); $table->index('user_id'); });
        Schema::table('channel_members', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('channel_member_shifts', function (Blueprint $table) { $table->foreign('member_id')->references('id')->on('channel_members')->restrictOnDelete(); $table->index('member_id'); });
        Schema::table('channel_member_shifts', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('crm_agent_status', function (Blueprint $table) { $table->foreign('user_id')->references('id')->on('users')->restrictOnDelete(); $table->index('user_id'); });
        Schema::table('crm_agent_status', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('leads', function (Blueprint $table) { $table->foreign('brand_id')->references('id')->on('brands')->restrictOnDelete(); $table->index('brand_id'); });
        Schema::table('leads', function (Blueprint $table) { $table->foreign('channel_id')->references('id')->on('messaging_channels')->restrictOnDelete(); $table->index('channel_id'); });
        Schema::table('leads', function (Blueprint $table) { $table->foreign('customer_id')->references('id')->on('customers')->restrictOnDelete(); $table->index('customer_id'); });
        Schema::table('leads', function (Blueprint $table) { $table->foreign('owner_user_id')->references('id')->on('users')->restrictOnDelete(); $table->index('owner_user_id'); });
        Schema::table('leads', function (Blueprint $table) { $table->foreign('existing_customer_id')->references('id')->on('customers')->restrictOnDelete(); $table->index('existing_customer_id'); });
        Schema::table('leads', function (Blueprint $table) { $table->foreign('converted_order_id')->references('id')->on('sales_orders')->restrictOnDelete(); $table->index('converted_order_id'); });
        Schema::table('leads', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('channel_contacts', function (Blueprint $table) { $table->foreign('customer_id')->references('id')->on('customers')->restrictOnDelete(); $table->index('customer_id'); });
        Schema::table('channel_contacts', function (Blueprint $table) { $table->foreign('lead_id')->references('id')->on('leads')->restrictOnDelete(); $table->index('lead_id'); });
        Schema::table('channel_contacts', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('conversations', function (Blueprint $table) { $table->foreign('channel_id')->references('id')->on('messaging_channels')->restrictOnDelete(); $table->index('channel_id'); });
        Schema::table('conversations', function (Blueprint $table) { $table->foreign('contact_id')->references('id')->on('channel_contacts')->restrictOnDelete(); $table->index('contact_id'); });
        Schema::table('conversations', function (Blueprint $table) { $table->foreign('brand_id')->references('id')->on('brands')->restrictOnDelete(); $table->index('brand_id'); });
        Schema::table('conversations', function (Blueprint $table) { $table->foreign('customer_id')->references('id')->on('customers')->restrictOnDelete(); $table->index('customer_id'); });
        Schema::table('conversations', function (Blueprint $table) { $table->foreign('lead_id')->references('id')->on('leads')->restrictOnDelete(); $table->index('lead_id'); });
        Schema::table('conversations', function (Blueprint $table) { $table->foreign('assigned_user_id')->references('id')->on('users')->restrictOnDelete(); $table->index('assigned_user_id'); });
        Schema::table('conversations', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('conversation_assignments', function (Blueprint $table) { $table->foreign('conversation_id')->references('id')->on('conversations')->restrictOnDelete(); $table->index('conversation_id'); });
        Schema::table('conversation_assignments', function (Blueprint $table) { $table->foreign('channel_id')->references('id')->on('messaging_channels')->restrictOnDelete(); $table->index('channel_id'); });
        Schema::table('conversation_assignments', function (Blueprint $table) { $table->foreign('to_user_id')->references('id')->on('users')->restrictOnDelete(); $table->index('to_user_id'); });
        Schema::table('conversation_assignments', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('message_templates', function (Blueprint $table) { $table->foreign('brand_id')->references('id')->on('brands')->restrictOnDelete(); $table->index('brand_id'); });
        Schema::table('message_templates', function (Blueprint $table) { $table->foreign('channel_id')->references('id')->on('messaging_channels')->restrictOnDelete(); $table->index('channel_id'); });
        Schema::table('message_templates', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('quick_replies', function (Blueprint $table) { $table->foreign('brand_id')->references('id')->on('brands')->restrictOnDelete(); $table->index('brand_id'); });
        Schema::table('quick_replies', function (Blueprint $table) { $table->foreign('owner_user_id')->references('id')->on('users')->restrictOnDelete(); $table->index('owner_user_id'); });
        Schema::table('quick_replies', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('conversation_messages', function (Blueprint $table) { $table->foreign('conversation_id')->references('id')->on('conversations')->restrictOnDelete(); $table->index('conversation_id'); });
        Schema::table('conversation_messages', function (Blueprint $table) { $table->foreign('channel_id')->references('id')->on('messaging_channels')->restrictOnDelete(); $table->index('channel_id'); });
        Schema::table('conversation_messages', function (Blueprint $table) { $table->foreign('brand_id')->references('id')->on('brands')->restrictOnDelete(); $table->index('brand_id'); });
        Schema::table('conversation_messages', function (Blueprint $table) { $table->foreign('sender_user_id')->references('id')->on('users')->restrictOnDelete(); $table->index('sender_user_id'); });
        Schema::table('conversation_messages', function (Blueprint $table) { $table->foreign('template_id')->references('id')->on('message_templates')->restrictOnDelete(); $table->index('template_id'); });
        Schema::table('conversation_messages', function (Blueprint $table) { $table->foreign('order_id')->references('id')->on('sales_orders')->restrictOnDelete(); $table->index('order_id'); });
        Schema::table('conversation_messages', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('message_status_events', function (Blueprint $table) { $table->foreign('message_id')->references('id')->on('conversation_messages')->restrictOnDelete(); $table->index('message_id'); });
        Schema::table('message_status_events', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('message_charges', function (Blueprint $table) { $table->foreign('message_id')->references('id')->on('conversation_messages')->restrictOnDelete(); $table->index('message_id'); });
        Schema::table('message_charges', function (Blueprint $table) { $table->foreign('channel_id')->references('id')->on('messaging_channels')->restrictOnDelete(); $table->index('channel_id'); });
        Schema::table('message_charges', function (Blueprint $table) { $table->foreign('brand_id')->references('id')->on('brands')->restrictOnDelete(); $table->index('brand_id'); });
        Schema::table('message_charges', function (Blueprint $table) { $table->foreign('user_id')->references('id')->on('users')->restrictOnDelete(); $table->index('user_id'); });
        Schema::table('message_charges', function (Blueprint $table) { $table->foreign('conversation_id')->references('id')->on('conversations')->restrictOnDelete(); $table->index('conversation_id'); });
        Schema::table('message_charges', function (Blueprint $table) { $table->foreign('order_id')->references('id')->on('sales_orders')->restrictOnDelete(); $table->index('order_id'); });
        Schema::table('message_charges', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('message_transcripts', function (Blueprint $table) { $table->foreign('message_id')->references('id')->on('conversation_messages')->restrictOnDelete(); $table->index('message_id'); });
        Schema::table('message_transcripts', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('conversation_orders', function (Blueprint $table) { $table->foreign('conversation_id')->references('id')->on('conversations')->restrictOnDelete(); $table->index('conversation_id'); });
        Schema::table('conversation_orders', function (Blueprint $table) { $table->foreign('order_id')->references('id')->on('sales_orders')->restrictOnDelete(); $table->index('order_id'); });
        Schema::table('conversation_orders', function (Blueprint $table) { $table->foreign('lead_id')->references('id')->on('leads')->restrictOnDelete(); $table->index('lead_id'); });
        Schema::table('conversation_orders', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('contact_consents', function (Blueprint $table) { $table->foreign('customer_id')->references('id')->on('customers')->restrictOnDelete(); $table->index('customer_id'); });
        Schema::table('contact_consents', function (Blueprint $table) { $table->foreign('contact_id')->references('id')->on('channel_contacts')->restrictOnDelete(); $table->index('contact_id'); });
        Schema::table('contact_consents', function (Blueprint $table) { $table->foreign('evidence_message_id')->references('id')->on('conversation_messages')->restrictOnDelete(); $table->index('evidence_message_id'); });
        Schema::table('contact_consents', function (Blueprint $table) { $table->foreign('brand_id')->references('id')->on('brands')->restrictOnDelete(); $table->index('brand_id'); });
        Schema::table('contact_consents', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('official_identifiers', function (Blueprint $table) { $table->foreign('brand_id')->references('id')->on('brands')->restrictOnDelete(); $table->index('brand_id'); });
        Schema::table('official_identifiers', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('control_alert_rules', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('control_alerts', function (Blueprint $table) { $table->foreign('rule_id')->references('id')->on('control_alert_rules')->restrictOnDelete(); $table->index('rule_id'); });
        Schema::table('control_alerts', function (Blueprint $table) { $table->foreign('message_id')->references('id')->on('conversation_messages')->restrictOnDelete(); $table->index('message_id'); });
        Schema::table('control_alerts', function (Blueprint $table) { $table->foreign('conversation_id')->references('id')->on('conversations')->restrictOnDelete(); $table->index('conversation_id'); });
        Schema::table('control_alerts', function (Blueprint $table) { $table->foreign('user_id')->references('id')->on('users')->restrictOnDelete(); $table->index('user_id'); });
        Schema::table('control_alerts', function (Blueprint $table) { $table->foreign('brand_id')->references('id')->on('brands')->restrictOnDelete(); $table->index('brand_id'); });
        Schema::table('control_alerts', function (Blueprint $table) { $table->foreign('reviewed_by')->references('id')->on('users')->restrictOnDelete(); $table->index('reviewed_by'); });
        Schema::table('control_alerts', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('conversation_reviews', function (Blueprint $table) { $table->foreign('conversation_id')->references('id')->on('conversations')->restrictOnDelete(); $table->index('conversation_id'); });
        Schema::table('conversation_reviews', function (Blueprint $table) { $table->foreign('reviewer_user_id')->references('id')->on('users')->restrictOnDelete(); $table->index('reviewer_user_id'); });
        Schema::table('conversation_reviews', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('crm_tasks', function (Blueprint $table) { $table->foreign('customer_id')->references('id')->on('customers')->restrictOnDelete(); $table->index('customer_id'); });
        Schema::table('crm_tasks', function (Blueprint $table) { $table->foreign('order_id')->references('id')->on('sales_orders')->restrictOnDelete(); $table->index('order_id'); });
        Schema::table('crm_tasks', function (Blueprint $table) { $table->foreign('brand_id')->references('id')->on('brands')->restrictOnDelete(); $table->index('brand_id'); });
        Schema::table('crm_tasks', function (Blueprint $table) { $table->foreign('assigned_user_id')->references('id')->on('users')->restrictOnDelete(); $table->index('assigned_user_id'); });
        Schema::table('crm_tasks', function (Blueprint $table) { $table->foreign('conversation_id')->references('id')->on('conversations')->restrictOnDelete(); $table->index('conversation_id'); });
        Schema::table('crm_tasks', function (Blueprint $table) { $table->foreign('lead_id')->references('id')->on('leads')->restrictOnDelete(); $table->index('lead_id'); });
        Schema::table('crm_tasks', function (Blueprint $table) { $table->foreign('assigned_by')->references('id')->on('users')->restrictOnDelete(); $table->index('assigned_by'); });
        Schema::table('crm_tasks', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('customer_rebuy_profiles', function (Blueprint $table) { $table->foreign('customer_id')->references('id')->on('customers')->restrictOnDelete(); $table->index('customer_id'); });
        Schema::table('customer_rebuy_profiles', function (Blueprint $table) { $table->foreign('brand_id')->references('id')->on('brands')->restrictOnDelete(); $table->index('brand_id'); });
        Schema::table('customer_rebuy_profiles', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('delivery_surveys', function (Blueprint $table) { $table->foreign('order_id')->references('id')->on('sales_orders')->restrictOnDelete(); $table->index('order_id'); });
        Schema::table('delivery_surveys', function (Blueprint $table) { $table->foreign('customer_id')->references('id')->on('customers')->restrictOnDelete(); $table->index('customer_id'); });
        Schema::table('delivery_surveys', function (Blueprint $table) { $table->foreign('seller_user_id')->references('id')->on('users')->restrictOnDelete(); $table->index('seller_user_id'); });
        Schema::table('delivery_surveys', function (Blueprint $table) { $table->foreign('brand_id')->references('id')->on('brands')->restrictOnDelete(); $table->index('brand_id'); });
        Schema::table('delivery_surveys', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });

        DB::statement("SELECT enable_tenant_rls('messages')");
        DB::statement("SELECT enable_tenant_rls('messaging_channels')");
        DB::statement("SELECT enable_tenant_rls('channel_members')");
        DB::statement("SELECT enable_tenant_rls('channel_member_shifts')");
        DB::statement("SELECT enable_tenant_rls('crm_agent_status')");
        DB::statement("SELECT enable_tenant_rls('leads')");
        DB::statement("SELECT enable_tenant_rls('channel_contacts')");
        DB::statement("SELECT enable_tenant_rls('conversations')");
        DB::statement("SELECT enable_tenant_rls('conversation_assignments')");
        DB::statement('REVOKE UPDATE, DELETE, TRUNCATE ON conversation_assignments FROM aycha_app');  // solo inserción
        DB::statement("SELECT enable_tenant_rls('message_templates')");
        DB::statement("SELECT enable_tenant_rls('quick_replies')");
        DB::statement("SELECT enable_tenant_rls('conversation_messages')");
        DB::statement('REVOKE UPDATE, DELETE, TRUNCATE ON conversation_messages FROM aycha_app');  // solo inserción
        DB::statement("SELECT enable_tenant_rls('message_status_events')");
        DB::statement('REVOKE UPDATE, DELETE, TRUNCATE ON message_status_events FROM aycha_app');  // solo inserción
        DB::statement("SELECT enable_tenant_rls('message_charges')");
        DB::statement('REVOKE UPDATE, DELETE, TRUNCATE ON message_charges FROM aycha_app');  // solo inserción
        DB::statement("SELECT enable_tenant_rls('message_transcripts')");
        DB::statement("SELECT enable_tenant_rls('conversation_orders')");
        DB::statement("SELECT enable_tenant_rls('contact_consents')");
        DB::statement('REVOKE UPDATE, DELETE, TRUNCATE ON contact_consents FROM aycha_app');  // solo inserción
        DB::statement("SELECT enable_tenant_rls('official_identifiers')");
        DB::statement("SELECT enable_tenant_rls('control_alert_rules')");
        DB::statement("SELECT enable_tenant_rls('control_alerts')");
        DB::statement("SELECT enable_tenant_rls('conversation_reviews')");
        DB::statement("SELECT enable_tenant_rls('crm_tasks')");
        DB::statement("SELECT enable_tenant_rls('customer_rebuy_profiles')");
        DB::statement("SELECT enable_tenant_rls('delivery_surveys')");
    }

    public function down(): void
    {
        DB::statement('DROP TABLE IF EXISTS delivery_surveys CASCADE');
        DB::statement('DROP TABLE IF EXISTS customer_rebuy_profiles CASCADE');
        DB::statement('DROP TABLE IF EXISTS crm_tasks CASCADE');
        DB::statement('DROP TABLE IF EXISTS conversation_reviews CASCADE');
        DB::statement('DROP TABLE IF EXISTS control_alerts CASCADE');
        DB::statement('DROP TABLE IF EXISTS control_alert_rules CASCADE');
        DB::statement('DROP TABLE IF EXISTS official_identifiers CASCADE');
        DB::statement('DROP TABLE IF EXISTS contact_consents CASCADE');
        DB::statement('DROP TABLE IF EXISTS conversation_orders CASCADE');
        DB::statement('DROP TABLE IF EXISTS message_transcripts CASCADE');
        DB::statement('DROP TABLE IF EXISTS message_charges CASCADE');
        DB::statement('DROP TABLE IF EXISTS message_status_events CASCADE');
        DB::statement('DROP TABLE IF EXISTS conversation_messages CASCADE');
        DB::statement('DROP TABLE IF EXISTS quick_replies CASCADE');
        DB::statement('DROP TABLE IF EXISTS message_templates CASCADE');
        DB::statement('DROP TABLE IF EXISTS conversation_assignments CASCADE');
        DB::statement('DROP TABLE IF EXISTS conversations CASCADE');
        DB::statement('DROP TABLE IF EXISTS channel_contacts CASCADE');
        DB::statement('DROP TABLE IF EXISTS leads CASCADE');
        DB::statement('DROP TABLE IF EXISTS crm_agent_status CASCADE');
        DB::statement('DROP TABLE IF EXISTS channel_member_shifts CASCADE');
        DB::statement('DROP TABLE IF EXISTS channel_members CASCADE');
        DB::statement('DROP TABLE IF EXISTS messaging_channels CASCADE');
        DB::statement('DROP TABLE IF EXISTS messages CASCADE');
    }
};
