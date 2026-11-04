<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// ADS · generada desde el modelo del prototipo (tools/prototipo/generar_migraciones.py).
// Tablas: ad_accounts, ad_campaigns, ad_ads, ad_import_runs, ad_spend_daily, ad_attributions, ad_platform_invoices.
// El dueño del módulo revisa tipos, únicos y estados antes de construir sus pantallas;
// los cambios se hacen con migraciones nuevas, no editando esta.
return new class extends Migration
{
    public function up(): void
    {
        // ADS · ad_accounts
        Schema::create('ad_accounts', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->string('platform', 20)->comment('valores en el prototipo: GOOGLE, META, TIKTOK');
            $table->uuid('brand_id');
            $table->string('name', 40);
            $table->string('external_id', 40);
            $table->string('currency', 20)->comment('valores en el prototipo: PEN, USD');
            $table->string('status', 20)->comment('valores en el prototipo: ACTIVE');
            $table->timestampTz('connected_at');
            $table->uuid('supplier_id');
            $table->string('timezone', 40);
            $table->string('connector_id', 40);
            $table->timestampTz('last_import_at');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // ADS · ad_campaigns
        Schema::create('ad_campaigns', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('account_id');
            $table->uuid('brand_id');
            $table->string('platform', 20)->comment('valores en el prototipo: GOOGLE, META, TIKTOK');
            $table->string('code', 40);
            $table->string('name', 80);
            $table->string('objective', 20)->comment('valores en el prototipo: MESSAGES, SALES');
            $table->string('status', 20)->comment('valores en el prototipo: ACTIVE, PAUSED');
            $table->decimal('daily_budget', 14, 2);
            $table->string('external_id', 20);
            $table->date('paused_from')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // ADS · ad_ads
        Schema::create('ad_ads', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('campaign_id');
            $table->uuid('brand_id');
            $table->string('platform', 20)->comment('valores en el prototipo: GOOGLE, META, TIKTOK');
            $table->string('code', 20);
            $table->string('name', 80);
            $table->string('status', 20)->comment('valores en el prototipo: ACTIVE, PAUSED');
            $table->string('external_id', 40);
            $table->string('ad_group_name', 80);
            $table->string('destination', 40)->comment('valores en el prototipo: TIKTOK_DM, WEB, WHATSAPP');
            $table->boolean('is_ctwa')->default(false);
            $table->uuid('channel_id')->nullable();
            $table->string('tracking_code', 20)->nullable();
            $table->string('utm_source', 20)->nullable();
            $table->string('utm_medium', 20)->nullable();
            $table->string('utm_campaign', 40)->nullable();
            $table->text('utm_content')->nullable();
            $table->string('landing_url', 80)->nullable();
            $table->date('paused_from')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // ADS · ad_import_runs
        Schema::create('ad_import_runs', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('account_id');
            $table->date('date_from');
            $table->date('date_to');
            $table->string('status', 20)->comment('valores en el prototipo: FAILED, OK');
            $table->integer('rows_read');
            $table->integer('rows_upserted');
            $table->string('error', 255)->nullable();
            $table->timestampTz('started_at');
            $table->timestampTz('finished_at');
            $table->string('user', 80);
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // ADS · ad_spend_daily
        Schema::create('ad_spend_daily', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('campaign_id');
            $table->uuid('ad_id');
            $table->date('spend_date');
            $table->string('currency', 20)->comment('valores en el prototipo: PEN, USD');
            $table->decimal('spend', 14, 2);
            $table->decimal('exchange_rate', 9, 4);
            $table->decimal('spend_pen', 14, 2);
            $table->integer('impressions');
            $table->integer('clicks');
            $table->decimal('platform_leads', 14, 2);
            $table->decimal('platform_conversions', 14, 2);
            $table->uuid('import_run_id');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // ADS · ad_attributions
        Schema::create('ad_attributions', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->string('lead_id', 40)->nullable();
            $table->uuid('order_id')->nullable();
            $table->uuid('conversation_id')->nullable();
            $table->uuid('ad_id')->nullable();
            $table->uuid('campaign_id')->nullable();
            $table->string('platform', 20)->nullable()->comment('valores en el prototipo: GOOGLE, META, TIKTOK');
            $table->uuid('brand_id');
            $table->string('method', 40)->comment('valores en el prototipo: CTWA_REFERRAL, INHERITED_FROM_LEAD, MANUAL, NONE, TIKTOK_DM, TRACKING_CODE, UTM');
            $table->boolean('is_new_customer')->default(false);
            $table->timestampTz('attributed_at');
            $table->timestampTz('lead_at')->nullable();
            $table->boolean('lead_origin')->nullable();
            $table->uuid('customer_id')->nullable();
            $table->string('manual_reason', 255)->nullable();
            $table->string('phone', 40)->nullable();
            $table->string('corrected_by', 40)->nullable();
            $table->timestampTz('corrected_at')->nullable();
            $table->jsonb('previous')->nullable();
            $table->string('ad_code', 20)->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // ADS · ad_platform_invoices
        Schema::create('ad_platform_invoices', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('account_id');
            $table->uuid('supplier_id');
            $table->string('invoice_number', 40);
            $table->date('issue_date');
            $table->date('period_from');
            $table->date('period_to');
            $table->string('currency', 20)->comment('valores en el prototipo: PEN, USD');
            $table->decimal('amount', 14, 2);
            $table->decimal('exchange_rate', 9, 4);
            $table->decimal('amount_pen', 14, 2);
            $table->decimal('imported_spend_pen', 14, 2)->nullable();
            $table->decimal('difference_pen', 14, 2)->nullable();
            $table->string('status', 40)->comment('valores en el prototipo: OBSERVED, PENDING, RECONCILED');
            $table->string('expense_id', 20)->nullable();
            $table->string('file_id', 20)->nullable();
            $table->string('doc_type', 40)->comment('valores en el prototipo: FOREIGN_INVOICE');
            $table->uuid('brand_id');
            $table->decimal('tolerance_pen', 14, 2)->nullable();
            $table->uuid('reconciled_by')->nullable();
            $table->timestampTz('reconciled_at')->nullable();
            $table->string('note', 255)->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });

        Schema::table('ad_accounts', function (Blueprint $table) { $table->foreign('brand_id')->references('id')->on('brands')->restrictOnDelete(); $table->index('brand_id'); });
        Schema::table('ad_accounts', function (Blueprint $table) { $table->foreign('supplier_id')->references('id')->on('suppliers')->restrictOnDelete(); $table->index('supplier_id'); });
        Schema::table('ad_accounts', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('ad_campaigns', function (Blueprint $table) { $table->foreign('account_id')->references('id')->on('ad_accounts')->restrictOnDelete(); $table->index('account_id'); });
        Schema::table('ad_campaigns', function (Blueprint $table) { $table->foreign('brand_id')->references('id')->on('brands')->restrictOnDelete(); $table->index('brand_id'); });
        Schema::table('ad_campaigns', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('ad_ads', function (Blueprint $table) { $table->foreign('campaign_id')->references('id')->on('ad_campaigns')->restrictOnDelete(); $table->index('campaign_id'); });
        Schema::table('ad_ads', function (Blueprint $table) { $table->foreign('brand_id')->references('id')->on('brands')->restrictOnDelete(); $table->index('brand_id'); });
        Schema::table('ad_ads', function (Blueprint $table) { $table->foreign('channel_id')->references('id')->on('messaging_channels')->restrictOnDelete(); $table->index('channel_id'); });
        Schema::table('ad_ads', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('ad_import_runs', function (Blueprint $table) { $table->foreign('account_id')->references('id')->on('ad_accounts')->restrictOnDelete(); $table->index('account_id'); });
        Schema::table('ad_import_runs', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('ad_spend_daily', function (Blueprint $table) { $table->foreign('campaign_id')->references('id')->on('ad_campaigns')->restrictOnDelete(); $table->index('campaign_id'); });
        Schema::table('ad_spend_daily', function (Blueprint $table) { $table->foreign('ad_id')->references('id')->on('ad_ads')->restrictOnDelete(); $table->index('ad_id'); });
        Schema::table('ad_spend_daily', function (Blueprint $table) { $table->foreign('import_run_id')->references('id')->on('ad_import_runs')->restrictOnDelete(); $table->index('import_run_id'); });
        Schema::table('ad_spend_daily', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('ad_attributions', function (Blueprint $table) { $table->foreign('order_id')->references('id')->on('sales_orders')->restrictOnDelete(); $table->index('order_id'); });
        Schema::table('ad_attributions', function (Blueprint $table) { $table->foreign('conversation_id')->references('id')->on('conversations')->restrictOnDelete(); $table->index('conversation_id'); });
        Schema::table('ad_attributions', function (Blueprint $table) { $table->foreign('ad_id')->references('id')->on('ad_ads')->restrictOnDelete(); $table->index('ad_id'); });
        Schema::table('ad_attributions', function (Blueprint $table) { $table->foreign('campaign_id')->references('id')->on('ad_campaigns')->restrictOnDelete(); $table->index('campaign_id'); });
        Schema::table('ad_attributions', function (Blueprint $table) { $table->foreign('brand_id')->references('id')->on('brands')->restrictOnDelete(); $table->index('brand_id'); });
        Schema::table('ad_attributions', function (Blueprint $table) { $table->foreign('customer_id')->references('id')->on('customers')->restrictOnDelete(); $table->index('customer_id'); });
        Schema::table('ad_attributions', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('ad_platform_invoices', function (Blueprint $table) { $table->foreign('account_id')->references('id')->on('ad_accounts')->restrictOnDelete(); $table->index('account_id'); });
        Schema::table('ad_platform_invoices', function (Blueprint $table) { $table->foreign('supplier_id')->references('id')->on('suppliers')->restrictOnDelete(); $table->index('supplier_id'); });
        Schema::table('ad_platform_invoices', function (Blueprint $table) { $table->foreign('brand_id')->references('id')->on('brands')->restrictOnDelete(); $table->index('brand_id'); });
        Schema::table('ad_platform_invoices', function (Blueprint $table) { $table->foreign('reconciled_by')->references('id')->on('users')->restrictOnDelete(); $table->index('reconciled_by'); });
        Schema::table('ad_platform_invoices', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });

        DB::statement("SELECT enable_tenant_rls('ad_accounts')");
        DB::statement("SELECT enable_tenant_rls('ad_campaigns')");
        DB::statement("SELECT enable_tenant_rls('ad_ads')");
        DB::statement("SELECT enable_tenant_rls('ad_import_runs')");
        DB::statement("SELECT enable_tenant_rls('ad_spend_daily')");
        DB::statement("SELECT enable_tenant_rls('ad_attributions')");
        DB::statement("SELECT enable_tenant_rls('ad_platform_invoices')");
    }

    public function down(): void
    {
        DB::statement('DROP TABLE IF EXISTS ad_platform_invoices CASCADE');
        DB::statement('DROP TABLE IF EXISTS ad_attributions CASCADE');
        DB::statement('DROP TABLE IF EXISTS ad_spend_daily CASCADE');
        DB::statement('DROP TABLE IF EXISTS ad_import_runs CASCADE');
        DB::statement('DROP TABLE IF EXISTS ad_ads CASCADE');
        DB::statement('DROP TABLE IF EXISTS ad_campaigns CASCADE');
        DB::statement('DROP TABLE IF EXISTS ad_accounts CASCADE');
    }
};
