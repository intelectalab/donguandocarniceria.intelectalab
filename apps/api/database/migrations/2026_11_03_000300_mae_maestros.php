<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// MAE · generada desde el modelo del prototipo (tools/prototipo/generar_migraciones.py).
// Tablas: employees, payment_methods, exchange_rates, units_of_measure, sunat_catalog_items, ubigeo, payment_method_fees, unit_conversions, financial_institutions.
// El dueño del módulo revisa tipos, únicos y estados antes de construir sus pantallas;
// los cambios se hacen con migraciones nuevas, no editando esta.
return new class extends Migration
{
    public function up(): void
    {
        // MAE · employees
        Schema::create('employees', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->string('doc_type', 20)->comment('valores en el prototipo: CE, DNI');
            $table->string('doc_number', 40);
            $table->string('full_name', 80);
            $table->string('position', 80);
            $table->uuid('establishment_id');
            $table->date('hire_date');
            $table->string('phone', 40);
            $table->string('status', 40)->comment('valores en el prototipo: ACTIVE, INACTIVE, TERMINATED');
            $table->decimal('monthly_salary', 14, 2);
            $table->string('email', 80)->nullable();
            $table->uuid('cost_center_id');
            $table->date('terminated_on')->nullable();
            $table->string('termination_reason', 40)->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // MAE · payment_methods
        Schema::create('payment_methods', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->string('code', 20)->comment('valores en el prototipo: BALANCE, CARD, CASH, CREDIT, MP, PLIN, TRANSFER, YAPE');
            $table->string('name', 80);
            $table->string('kind', 20)->comment('valores en el prototipo: BANK, CARD, CASH, CREDIT, GATEWAY, INTERNAL, WALLET');
            $table->boolean('requires_reference')->default(false);
            $table->boolean('allowed_on_delivery')->default(false);
            $table->string('status', 20)->comment('valores en el prototipo: ACTIVE, INTERNAL');
            $table->string('system_code', 40)->nullable()->comment('valores en el prototipo: CASH, CREDIT, MERCADOPAGO, PLIN, POS_VISA, TRANSFER, YAPE');
            $table->boolean('is_system')->nullable();
            $table->string('institution_code', 40)->nullable()->comment('valores en el prototipo: BCP, MERCADOPAGO, PLIN, YAPE');
            $table->string('connector_code', 20)->nullable();
            $table->uuid('connector_id')->nullable();
            $table->integer('settlement_days')->nullable();
            $table->jsonb('allowed_channels')->nullable();
            $table->integer('sort_order')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // MAE · exchange_rates
        Schema::create('exchange_rates', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->date('date');
            $table->string('currency', 20)->comment('valores en el prototipo: USD');
            $table->decimal('buy', 18, 4);
            $table->decimal('sell', 18, 4);
            $table->string('source', 20)->comment('valores en el prototipo: IMPORT, MANUAL, SUNAT');
            $table->string('loaded_via', 20)->nullable()->comment('valores en el prototipo: IMPORT, MANUAL, SUNAT');
            $table->date('published_on')->nullable();
            $table->string('edit_reason', 255)->nullable();
            $table->string('loaded_by', 80)->nullable();
            $table->string('edited_by', 40)->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // MAE · units_of_measure
        Schema::create('units_of_measure', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->string('code', 20)->comment('valores en el prototipo: BG, BX, GRM, KGM, LTR, MLT, NIU, PK, ZZ');
            $table->string('name', 40);
            $table->string('kind', 20)->comment('valores en el prototipo: SERVICE, UNIT, VOLUME, WEIGHT');
            $table->string('sunat_code', 20)->comment('valores en el prototipo: BG, BX, GRM, KGM, LTR, MLT, NIU, PK, ZZ');
            $table->string('uom_type', 20)->nullable()->comment('valores en el prototipo: PACKAGE, SERVICE, UNIT, VOLUME, WEIGHT');
            $table->integer('decimals')->nullable();
            $table->boolean('is_system')->nullable();
            $table->string('status', 20)->nullable()->comment('valores en el prototipo: ACTIVE');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // MAE · sunat_catalog_items
        Schema::create('sunat_catalog_items', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->string('catalog', 20)->comment('valores en el prototipo: 01, 03, 06, 07, 09, 10, 12, 18, 20');
            $table->string('catalog_name', 80);
            $table->string('code', 20);
            $table->text('description');
            $table->date('valid_from');
            $table->date('valid_to')->nullable();
            $table->string('status', 20)->comment('valores en el prototipo: ACTIVE');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
        });
        // MAE · ubigeo
        Schema::create('ubigeo', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->string('code', 20);
            $table->string('level', 40)->comment('valores en el prototipo: DEPARTMENT, DISTRICT, PROVINCE');
            $table->string('department', 40);
            $table->string('province', 40)->nullable();
            $table->string('district', 80)->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
        });
        // MAE · payment_method_fees
        Schema::create('payment_method_fees', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('payment_method_id');
            $table->date('valid_from');
            $table->date('valid_to')->nullable();
            $table->decimal('fee_pct', 9, 4);
            $table->decimal('fee_fixed', 14, 2);
            $table->boolean('igv_included')->default(false);
            $table->string('note', 255);
            $table->string('status', 20)->comment('valores en el prototipo: ACTIVE');
            $table->string('created_by', 40);
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // MAE · unit_conversions
        Schema::create('unit_conversions', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->string('from_uom', 20)->comment('valores en el prototipo: BX, KGM, LTR, PK');
            $table->string('to_uom', 20)->comment('valores en el prototipo: GRM, MLT, NIU');
            $table->integer('factor');
            $table->string('note', 80);
            $table->string('status', 20)->comment('valores en el prototipo: ACTIVE');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // MAE · financial_institutions
        Schema::create('financial_institutions', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->string('code', 40);
            $table->string('name', 255);
            $table->string('kind', 20)->comment('valores en el prototipo: ACQUIRER, BANK, CAJA, GATEWAY, WALLET');
            $table->string('ruc', 40)->nullable()->comment('valores en el prototipo: 20100030595, 20100043140, 20100047218, 20100053455, 20100130204, 20101036813');
            $table->string('cci_code', 20)->nullable()->comment('valores en el prototipo: 002, 003, 009, 011, 018, 038, 803, 808');
            $table->string('status', 20)->comment('valores en el prototipo: ACTIVE');
            $table->integer('sort_order');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
        });

        Schema::table('employees', function (Blueprint $table) { $table->foreign('establishment_id')->references('id')->on('establishments')->restrictOnDelete(); $table->index('establishment_id'); });
        Schema::table('employees', function (Blueprint $table) { $table->foreign('cost_center_id')->references('id')->on('cost_centers')->restrictOnDelete(); $table->index('cost_center_id'); });
        Schema::table('employees', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('payment_methods', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('exchange_rates', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('units_of_measure', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('payment_method_fees', function (Blueprint $table) { $table->foreign('payment_method_id')->references('id')->on('payment_methods')->restrictOnDelete(); $table->index('payment_method_id'); });
        Schema::table('payment_method_fees', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('unit_conversions', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });

        DB::statement("SELECT enable_tenant_rls('employees')");
        Schema::table('payment_methods', fn (Blueprint $table) => $table->unique(['tenant_id', 'code']));
        DB::statement("SELECT enable_tenant_rls('payment_methods')");
        DB::statement("SELECT enable_tenant_rls('exchange_rates')");
        Schema::table('units_of_measure', fn (Blueprint $table) => $table->unique(['tenant_id', 'code']));
        DB::statement("SELECT enable_tenant_rls('units_of_measure')");
        DB::statement("COMMENT ON TABLE sunat_catalog_items IS 'global: catálogo de la plataforma, sin RLS'");
        DB::statement('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON sunat_catalog_items FROM aycha_app');  // catálogo de plataforma
        DB::statement("COMMENT ON TABLE ubigeo IS 'global: catálogo de la plataforma, sin RLS'");
        DB::statement('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ubigeo FROM aycha_app');  // catálogo de plataforma
        DB::statement("SELECT enable_tenant_rls('payment_method_fees')");
        DB::statement("SELECT enable_tenant_rls('unit_conversions')");
        DB::statement("COMMENT ON TABLE financial_institutions IS 'global: catálogo de la plataforma, sin RLS'");
        DB::statement('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON financial_institutions FROM aycha_app');  // catálogo de plataforma
    }

    public function down(): void
    {
        DB::statement('DROP TABLE IF EXISTS financial_institutions CASCADE');
        DB::statement('DROP TABLE IF EXISTS unit_conversions CASCADE');
        DB::statement('DROP TABLE IF EXISTS payment_method_fees CASCADE');
        DB::statement('DROP TABLE IF EXISTS ubigeo CASCADE');
        DB::statement('DROP TABLE IF EXISTS sunat_catalog_items CASCADE');
        DB::statement('DROP TABLE IF EXISTS units_of_measure CASCADE');
        DB::statement('DROP TABLE IF EXISTS exchange_rates CASCADE');
        DB::statement('DROP TABLE IF EXISTS payment_methods CASCADE');
        DB::statement('DROP TABLE IF EXISTS employees CASCADE');
    }
};
