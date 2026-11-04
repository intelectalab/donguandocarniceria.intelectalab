<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// PLT · generada desde el modelo del prototipo (tools/prototipo/generar_migraciones.py).
// Tablas: tenants, companies, establishments, brands, cost_centers, document_series, accounting_periods, parameters, parameter_history, tenant_modules, platform_modules, parameter_definitions, tenant_hostnames, ui_themes, accounting_period_events, search_entries.
// El dueño del módulo revisa tipos, únicos y estados antes de construir sus pantallas;
// los cambios se hacen con migraciones nuevas, no editando esta.
return new class extends Migration
{
    public function up(): void
    {
        // PLT · tenants
        Schema::create('tenants', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->string('name', 80);
            $table->string('short', 80);
            $table->string('plan', 40)->comment('valores en el prototipo: CRECER, CRECIMIENTO, ESCALA, INICIA, INICIAL, MULTIMARCA, PILOTO');
            $table->string('status', 40)->comment('valores en el prototipo: ACTIVE, CANCELLED, PAST_DUE, READ_ONLY, SUSPENDED, TRIAL');
            $table->string('hostname', 80);
            $table->string('product', 40)->nullable()->comment('valores en el prototipo: COMERCIAL');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
        });
        // PLT · companies
        Schema::create('companies', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->string('legal_name', 80);
            $table->string('ruc', 40)->comment('valores en el prototipo: 20604567034, 20609147254, 20610233440, 20612345016, 20615432874, 20619874022');
            $table->string('trade_name', 40);
            $table->string('tax_regime', 20)->comment('valores en el prototipo: MYPE');
            $table->string('fiscal_address', 255);
            $table->string('fiscal_ubigeo', 20)->nullable()->comment('valores en el prototipo: 150103, 150116, 150122, 150140');
            $table->string('status', 40)->comment('valores en el prototipo: ACTIVE, PREPARING');
            $table->string('default_currency', 20)->comment('valores en el prototipo: PEN');
            $table->string('timezone', 40);
            $table->string('logo_url', 40)->nullable();
            $table->string('einvoice_provider', 40)->nullable();
            $table->string('einvoice_env', 40)->nullable()->comment('valores en el prototipo: BETA, PRODUCCION');
            $table->jsonb('einvoice_test')->nullable();
            $table->string('sunat_status', 20)->nullable()->comment('valores en el prototipo: ACTIVO');
            $table->string('sunat_condition', 20)->nullable()->comment('valores en el prototipo: HABIDO');
            $table->string('primary_color', 20)->nullable();
            $table->string('secondary_color', 20)->nullable();
            $table->string('einvoice_user', 40)->nullable();
            $table->string('einvoice_secret_last4', 20)->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // PLT · establishments
        Schema::create('establishments', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('company_id');
            $table->string('code', 20)->comment('valores en el prototipo: AQP, L1, L2, LIN, MIR, SUR');
            $table->string('name', 80);
            $table->string('short', 80);
            $table->string('sunat_code', 20)->comment('valores en el prototipo: 0000, 0001');
            $table->string('est_type', 40)->comment('valores en el prototipo: MIXED, PLANT, STORE, WAREHOUSE');
            $table->string('address', 80);
            $table->string('ubigeo', 20)->nullable()->comment('valores en el prototipo: 150119, 150140');
            $table->decimal('lat', 10, 7)->nullable();
            $table->decimal('lng', 10, 7)->nullable();
            $table->string('status', 20)->comment('valores en el prototipo: ACTIVE');
            $table->boolean('has_counter')->default(false);
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // PLT · brands
        Schema::create('brands', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('company_id');
            $table->string('code', 20)->comment('valores en el prototipo: AHU, CS, DA, DG, LV, M2, M3, M4, M5, QC');
            $table->string('name', 40);
            $table->string('primary_color', 20);
            $table->text('description')->nullable();
            $table->string('website', 40)->nullable();
            $table->string('legal_footer', 255)->nullable();
            $table->string('whatsapp_display_name', 40)->nullable();
            $table->string('status', 20)->comment('valores en el prototipo: ACTIVE');
            $table->integer('sort_order');
            $table->string('print_legends', 255)->nullable();
            $table->boolean('print_show_logo')->nullable();
            $table->string('logo_url', 20)->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // PLT · cost_centers
        Schema::create('cost_centers', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('company_id');
            $table->string('code', 40);
            $table->string('name', 80);
            $table->string('area', 40)->comment('valores en el prototipo: ADMIN, DELIVERY, FINANCE, HR, MARKETING, PRODUCTION, QUALITY, SALES, WAREHOUSE');
            $table->uuid('establishment_id')->nullable();
            $table->uuid('brand_id')->nullable();
            $table->string('status', 20)->comment('valores en el prototipo: ACTIVE, INACTIVE');
            $table->uuid('parent_id')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // PLT · document_series
        Schema::create('document_series', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('company_id');
            $table->uuid('establishment_id')->nullable();
            $table->uuid('brand_id')->nullable();
            $table->string('doc_type', 40)->comment('valores en el prototipo: CONSIGNMENT_NOTE, CREDIT_NOTE, DEBIT_NOTE, DISPATCH_GUIDE, INTERNAL_NOTE, INVOICE, JOURNAL, PRODUCTION_ORDER, PURCHASE_ORDER, QUOTE, RECEIPT');
            $table->string('series', 20);
            $table->integer('next_number');
            $table->boolean('is_electronic')->default(false);
            $table->string('status', 20)->comment('valores en el prototipo: ACTIVE, INACTIVE');
            $table->boolean('all_sites')->nullable();
            $table->string('applies_to', 20)->nullable()->comment('valores en el prototipo: INVOICE, RECEIPT');
            $table->string('note', 255)->nullable();
            $table->string('status_reason', 40)->nullable();
            $table->integer('legacy_last_number')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // PLT · accounting_periods
        Schema::create('accounting_periods', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('company_id');
            $table->date('period');
            $table->string('status', 20)->comment('valores en el prototipo: CLOSED, OPEN');
            $table->timestampTz('closed_at')->nullable();
            $table->string('closed_by', 40)->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // PLT · parameters
        Schema::create('parameters', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->string('key', 80);
            $table->string('scope', 20)->comment('valores en el prototipo: BRAND, TENANT');
            $table->uuid('scope_id')->nullable();
            $table->decimal('value', 14, 2);
            $table->string('reason', 255);
            $table->text('description');
            $table->boolean('platform')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // PLT · parameter_history
        Schema::create('parameter_history', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->string('key', 80);
            $table->string('scope', 20)->comment('valores en el prototipo: BRAND, TENANT');
            $table->uuid('scope_id')->nullable();
            $table->decimal('old_value', 14, 2);
            $table->decimal('new_value', 14, 2);
            $table->string('reason', 255);
            $table->string('changed_by', 40);
            $table->timestampTz('changed_at');
            $table->string('module_code', 20)->nullable()->comment('valores en el prototipo: PLT, SEG');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // PLT · tenant_modules
        Schema::create('tenant_modules', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->string('module_code', 20);
            $table->integer('phase');
            $table->boolean('enabled')->default(false);
            $table->timestampTz('changed_at');
            $table->string('changed_by', 80);
            $table->string('reason', 255);
            $table->string('sus_source', 20)->nullable()->comment('valores en el prototipo: ADDON, CORE, PLAN');
            $table->timestampTz('enabled_at')->nullable();
            $table->timestampTz('disabled_at')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // PLT · platform_modules
        Schema::create('platform_modules', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->string('code', 20);
            $table->string('name', 255);
            $table->integer('phase');
            $table->boolean('is_core')->default(false);
            $table->jsonb('depends_on');
            $table->jsonb('uses');
            $table->integer('sort_order');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
        });
        // PLT · parameter_definitions
        Schema::create('parameter_definitions', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->string('key', 80);
            $table->string('module_code', 20);
            $table->string('value_type', 20)->comment('valores en el prototipo: BOOL, DECIMAL, INT, JSON, LIST, TEXT, TIME');
            $table->decimal('default_value', 18, 4)->nullable();
            $table->decimal('min_value', 14, 2)->nullable();
            $table->decimal('max_value', 14, 2)->nullable();
            $table->jsonb('allowed_scopes');
            $table->string('unit', 20)->nullable();
            $table->text('description');
            $table->jsonb('options')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
        });
        // PLT · tenant_hostnames
        Schema::create('tenant_hostnames', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id');
            $table->string('hostname', 80);
            $table->boolean('is_primary')->default(false);
            $table->string('status', 40)->comment('valores en el prototipo: ACTIVE, PENDING_DNS');
            $table->timestampTz('verified_at')->nullable();
            $table->string('verify_token', 80)->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
        });
        // PLT · ui_themes
        Schema::create('ui_themes', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('brand_id')->nullable();
            $table->string('name', 80);
            $table->jsonb('light');
            $table->jsonb('dark');
            $table->string('font_family', 40);
            $table->integer('radius_px');
            $table->string('status', 20)->comment('valores en el prototipo: ACTIVE');
            $table->string('changed_by', 40);
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // PLT · accounting_period_events
        Schema::create('accounting_period_events', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('period_id');
            $table->date('period');
            $table->string('action', 20)->comment('valores en el prototipo: CLOSE, OPEN, REOPEN');
            $table->string('reason', 255);
            $table->uuid('acted_by');
            $table->string('acted_by_name', 40);
            $table->timestampTz('acted_at');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // PLT · search_entries
        Schema::create('search_entries', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->string('module_code', 20)->nullable()->comment('valores en el prototipo: TEL');
            $table->string('entity_type', 20)->nullable();
            $table->string('entity_id', 40)->nullable();
            $table->string('title', 80)->nullable();
            $table->string('subtitle', 255)->nullable();
            $table->string('keywords', 40)->nullable();
            $table->string('url', 20)->nullable();
            $table->uuid('brand_id')->nullable();
            $table->uuid('establishment_id')->nullable();
            $table->string('permission_code', 40)->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });

        Schema::table('companies', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('establishments', function (Blueprint $table) { $table->foreign('company_id')->references('id')->on('companies')->restrictOnDelete(); $table->index('company_id'); });
        Schema::table('establishments', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('brands', function (Blueprint $table) { $table->foreign('company_id')->references('id')->on('companies')->restrictOnDelete(); $table->index('company_id'); });
        Schema::table('brands', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('cost_centers', function (Blueprint $table) { $table->foreign('company_id')->references('id')->on('companies')->restrictOnDelete(); $table->index('company_id'); });
        Schema::table('cost_centers', function (Blueprint $table) { $table->foreign('establishment_id')->references('id')->on('establishments')->restrictOnDelete(); $table->index('establishment_id'); });
        Schema::table('cost_centers', function (Blueprint $table) { $table->foreign('brand_id')->references('id')->on('brands')->restrictOnDelete(); $table->index('brand_id'); });
        Schema::table('cost_centers', function (Blueprint $table) { $table->foreign('parent_id')->references('id')->on('cost_centers')->restrictOnDelete(); $table->index('parent_id'); });
        Schema::table('cost_centers', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('document_series', function (Blueprint $table) { $table->foreign('company_id')->references('id')->on('companies')->restrictOnDelete(); $table->index('company_id'); });
        Schema::table('document_series', function (Blueprint $table) { $table->foreign('establishment_id')->references('id')->on('establishments')->restrictOnDelete(); $table->index('establishment_id'); });
        Schema::table('document_series', function (Blueprint $table) { $table->foreign('brand_id')->references('id')->on('brands')->restrictOnDelete(); $table->index('brand_id'); });
        Schema::table('document_series', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('accounting_periods', function (Blueprint $table) { $table->foreign('company_id')->references('id')->on('companies')->restrictOnDelete(); $table->index('company_id'); });
        Schema::table('accounting_periods', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('parameters', function (Blueprint $table) { $table->foreign('scope_id')->references('id')->on('brands')->restrictOnDelete(); $table->index('scope_id'); });
        Schema::table('parameters', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('parameter_history', function (Blueprint $table) { $table->foreign('scope_id')->references('id')->on('brands')->restrictOnDelete(); $table->index('scope_id'); });
        Schema::table('parameter_history', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('tenant_modules', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('tenant_hostnames', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('ui_themes', function (Blueprint $table) { $table->foreign('brand_id')->references('id')->on('brands')->restrictOnDelete(); $table->index('brand_id'); });
        Schema::table('ui_themes', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('accounting_period_events', function (Blueprint $table) { $table->foreign('period_id')->references('id')->on('accounting_periods')->restrictOnDelete(); $table->index('period_id'); });
        Schema::table('accounting_period_events', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('search_entries', function (Blueprint $table) { $table->foreign('brand_id')->references('id')->on('brands')->restrictOnDelete(); $table->index('brand_id'); });
        Schema::table('search_entries', function (Blueprint $table) { $table->foreign('establishment_id')->references('id')->on('establishments')->restrictOnDelete(); $table->index('establishment_id'); });
        Schema::table('search_entries', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });

        DB::statement("COMMENT ON TABLE tenants IS 'global: catálogo de la plataforma, sin RLS'");
        DB::statement('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON tenants FROM aycha_app');  // catálogo de plataforma
        DB::statement("SELECT enable_tenant_rls('companies')");
        Schema::table('establishments', fn (Blueprint $table) => $table->unique(['tenant_id', 'code']));
        DB::statement("SELECT enable_tenant_rls('establishments')");
        Schema::table('brands', fn (Blueprint $table) => $table->unique(['tenant_id', 'code']));
        DB::statement("SELECT enable_tenant_rls('brands')");
        Schema::table('cost_centers', fn (Blueprint $table) => $table->unique(['tenant_id', 'code']));
        DB::statement("SELECT enable_tenant_rls('cost_centers')");
        Schema::table('document_series', fn (Blueprint $table) => $table->unique(['tenant_id', 'series']));
        DB::statement("SELECT enable_tenant_rls('document_series')");
        DB::statement("SELECT enable_tenant_rls('accounting_periods')");
        DB::statement("SELECT enable_tenant_rls('parameters')");
        DB::statement("SELECT enable_tenant_rls('parameter_history')");
        DB::statement("SELECT enable_tenant_rls('tenant_modules')");
        Schema::table('platform_modules', fn (Blueprint $table) => $table->unique(['code']));
        DB::statement("COMMENT ON TABLE platform_modules IS 'global: catálogo de la plataforma, sin RLS'");
        DB::statement('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON platform_modules FROM aycha_app');  // catálogo de plataforma
        Schema::table('parameter_definitions', fn (Blueprint $table) => $table->unique(['key']));
        DB::statement("COMMENT ON TABLE parameter_definitions IS 'global: catálogo de la plataforma, sin RLS'");
        DB::statement('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON parameter_definitions FROM aycha_app');  // catálogo de plataforma
        Schema::table('tenant_hostnames', fn (Blueprint $table) => $table->unique(['hostname']));
        DB::statement("COMMENT ON TABLE tenant_hostnames IS 'global: catálogo de la plataforma, sin RLS'");
        DB::statement("SELECT enable_tenant_rls('ui_themes')");
        DB::statement("SELECT enable_tenant_rls('accounting_period_events')");
        DB::statement('REVOKE UPDATE, DELETE, TRUNCATE ON accounting_period_events FROM aycha_app');  // solo inserción
        DB::statement("SELECT enable_tenant_rls('search_entries')");
    }

    public function down(): void
    {
        DB::statement('DROP TABLE IF EXISTS search_entries CASCADE');
        DB::statement('DROP TABLE IF EXISTS accounting_period_events CASCADE');
        DB::statement('DROP TABLE IF EXISTS ui_themes CASCADE');
        DB::statement('DROP TABLE IF EXISTS tenant_hostnames CASCADE');
        DB::statement('DROP TABLE IF EXISTS parameter_definitions CASCADE');
        DB::statement('DROP TABLE IF EXISTS platform_modules CASCADE');
        DB::statement('DROP TABLE IF EXISTS tenant_modules CASCADE');
        DB::statement('DROP TABLE IF EXISTS parameter_history CASCADE');
        DB::statement('DROP TABLE IF EXISTS parameters CASCADE');
        DB::statement('DROP TABLE IF EXISTS accounting_periods CASCADE');
        DB::statement('DROP TABLE IF EXISTS document_series CASCADE');
        DB::statement('DROP TABLE IF EXISTS cost_centers CASCADE');
        DB::statement('DROP TABLE IF EXISTS brands CASCADE');
        DB::statement('DROP TABLE IF EXISTS establishments CASCADE');
        DB::statement('DROP TABLE IF EXISTS companies CASCADE');
        DB::statement('DROP TABLE IF EXISTS tenants CASCADE');
    }
};
