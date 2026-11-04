<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// CAT · generada desde el modelo del prototipo (tools/prototipo/generar_migraciones.py).
// Tablas: cut_types, price_lists, price_list_items, combo_components, product_categories, products, product_variants.
// El dueño del módulo revisa tipos, únicos y estados antes de construir sus pantallas;
// los cambios se hacen con migraciones nuevas, no editando esta.
return new class extends Migration
{
    public function up(): void
    {
        // CAT · cut_types
        Schema::create('cut_types', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->string('code', 40);
            $table->string('name', 80);
            $table->jsonb('applies_to_lines');
            $table->integer('sort_order');
            $table->string('status', 20)->comment('valores en el prototipo: ACTIVE');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // CAT · price_lists
        Schema::create('price_lists', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->string('code', 20);
            $table->string('name', 255);
            $table->uuid('brand_id')->nullable();
            $table->jsonb('channels');
            $table->boolean('includes_igv')->default(false);
            $table->string('status', 20)->comment('valores en el prototipo: ACTIVE, DRAFT');
            $table->date('valid_from')->nullable();
            $table->integer('priority')->nullable();
            $table->jsonb('customer_types')->nullable();
            $table->date('valid_to')->nullable();
            $table->string('currency', 20)->nullable()->comment('valores en el prototipo: PEN');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // CAT · price_list_items
        Schema::create('price_list_items', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('list_id');
            $table->uuid('variant_id');
            $table->decimal('price', 14, 2);
            $table->string('basis', 20)->comment('valores en el prototipo: KG, UNIT');
            $table->date('valid_from');
            $table->date('valid_to')->nullable();
            $table->decimal('min_qty', 14, 3)->nullable();
            $table->string('created_by', 40)->nullable();
            $table->string('closed_by', 40)->nullable();
            $table->string('closed_reason', 80)->nullable();
            $table->string('reason', 80)->nullable();
            $table->decimal('previous_price', 14, 2)->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // CAT · combo_components
        Schema::create('combo_components', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('combo_variant_id');
            $table->uuid('component_variant_id');
            $table->decimal('qty', 14, 3);
            $table->decimal('est_weight_kg', 14, 3)->nullable();
            $table->decimal('price_share_pct', 9, 4);
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // CAT · product_categories
        Schema::create('product_categories', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->string('code', 40);
            $table->string('name', 80);
            $table->string('line', 40);
            $table->string('source', 20)->nullable()->comment('valores en el prototipo: TEMPLATE');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // CAT · products
        Schema::create('products', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('brand_id');
            $table->uuid('category_id');
            $table->string('code', 40);
            $table->string('name', 255);
            $table->string('line', 40);
            $table->string('product_type', 40)->comment('valores en el prototipo: COMBO, GOODS, INPUT, PACKAGING');
            $table->string('origin', 40)->comment('valores en el prototipo: PRODUCED, RAW_MATERIAL, RESALE');
            $table->string('storage', 20)->comment('valores en el prototipo: AMBIENT, CHILLED, FROZEN');
            $table->integer('shelf_life_days');
            $table->boolean('requires_lot')->default(false);
            $table->string('igv_affectation', 20)->comment('valores en el prototipo: 10');
            $table->string('sanitary_authority', 20)->nullable()->comment('valores en el prototipo: DIGESA, NONE, SENASA');
            $table->string('sanitary_registry', 40)->nullable();
            $table->date('sanitary_registry_expires')->nullable();
            $table->string('status', 20)->comment('valores en el prototipo: ACTIVE, INACTIVE');
            $table->boolean('web_publishable')->nullable();
            $table->boolean('allow_discount')->nullable();
            $table->string('sanitary_alert_days', 20)->nullable();
            $table->string('sunat_product_code', 20)->nullable()->comment('valores en el prototipo: 50101716, 50112000, 50112004, 50151500, 50192100, 50192400, 50192401, 50201706, 50201712');
            $table->string('web_title', 255)->nullable();
            $table->text('web_description')->nullable();
            $table->string('image_url', 80)->nullable();
            $table->string('web_sync_status', 40)->nullable()->comment('valores en el prototipo: NOT_PUBLISHED, PENDING, REMOVED, SYNCED');
            $table->timestampTz('web_synced_at')->nullable();
            $table->string('sanitary_certificate', 40)->nullable();
            $table->string('source_module', 20)->nullable()->comment('valores en el prototipo: DES, PRO');
            $table->string('source', 20)->nullable()->comment('valores en el prototipo: TEMPLATE');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // CAT · product_variants
        Schema::create('product_variants', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('product_id');
            $table->uuid('brand_id');
            $table->string('sku', 40);
            $table->string('name', 255);
            $table->string('barcode', 40)->nullable();
            $table->uuid('uom_id');
            $table->string('sale_mode', 40)->comment('valores en el prototipo: KG, UNIT, UNIT_VARIABLE_WEIGHT');
            $table->decimal('nominal_weight_kg', 14, 3)->nullable();
            $table->decimal('weight_tolerance_pct', 9, 4)->nullable();
            $table->decimal('min_weight_kg', 14, 3)->nullable();
            $table->decimal('max_weight_kg', 14, 3)->nullable();
            $table->string('scale_plu', 20)->nullable();
            $table->string('status', 20)->comment('valores en el prototipo: ACTIVE, INACTIVE');
            $table->boolean('web_publishable')->nullable();
            $table->decimal('min_order_qty', 14, 3)->nullable();
            $table->decimal('qty_step', 14, 3)->nullable();
            $table->decimal('std_cost', 14, 2);
            $table->boolean('sellable')->default(false);
            $table->string('line', 40);
            $table->uuid('cut_type_id')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });

        Schema::table('cut_types', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('price_lists', function (Blueprint $table) { $table->foreign('brand_id')->references('id')->on('brands')->restrictOnDelete(); $table->index('brand_id'); });
        Schema::table('price_lists', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('price_list_items', function (Blueprint $table) { $table->foreign('list_id')->references('id')->on('price_lists')->restrictOnDelete(); $table->index('list_id'); });
        Schema::table('price_list_items', function (Blueprint $table) { $table->foreign('variant_id')->references('id')->on('product_variants')->restrictOnDelete(); $table->index('variant_id'); });
        Schema::table('price_list_items', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('combo_components', function (Blueprint $table) { $table->foreign('combo_variant_id')->references('id')->on('product_variants')->restrictOnDelete(); $table->index('combo_variant_id'); });
        Schema::table('combo_components', function (Blueprint $table) { $table->foreign('component_variant_id')->references('id')->on('product_variants')->restrictOnDelete(); $table->index('component_variant_id'); });
        Schema::table('combo_components', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('product_categories', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('products', function (Blueprint $table) { $table->foreign('brand_id')->references('id')->on('brands')->restrictOnDelete(); $table->index('brand_id'); });
        Schema::table('products', function (Blueprint $table) { $table->foreign('category_id')->references('id')->on('product_categories')->restrictOnDelete(); $table->index('category_id'); });
        Schema::table('products', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('product_variants', function (Blueprint $table) { $table->foreign('product_id')->references('id')->on('products')->restrictOnDelete(); $table->index('product_id'); });
        Schema::table('product_variants', function (Blueprint $table) { $table->foreign('brand_id')->references('id')->on('brands')->restrictOnDelete(); $table->index('brand_id'); });
        Schema::table('product_variants', function (Blueprint $table) { $table->foreign('uom_id')->references('id')->on('units_of_measure')->restrictOnDelete(); $table->index('uom_id'); });
        Schema::table('product_variants', function (Blueprint $table) { $table->foreign('cut_type_id')->references('id')->on('cut_types')->restrictOnDelete(); $table->index('cut_type_id'); });
        Schema::table('product_variants', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });

        DB::statement("SELECT enable_tenant_rls('cut_types')");
        DB::statement("SELECT enable_tenant_rls('price_lists')");
        DB::statement("SELECT enable_tenant_rls('price_list_items')");
        DB::statement("SELECT enable_tenant_rls('combo_components')");
        DB::statement("SELECT enable_tenant_rls('product_categories')");
        Schema::table('products', fn (Blueprint $table) => $table->unique(['tenant_id', 'code']));
        DB::statement("SELECT enable_tenant_rls('products')");
        Schema::table('product_variants', fn (Blueprint $table) => $table->unique(['tenant_id', 'sku']));
        DB::statement("SELECT enable_tenant_rls('product_variants')");
    }

    public function down(): void
    {
        DB::statement('DROP TABLE IF EXISTS product_variants CASCADE');
        DB::statement('DROP TABLE IF EXISTS products CASCADE');
        DB::statement('DROP TABLE IF EXISTS product_categories CASCADE');
        DB::statement('DROP TABLE IF EXISTS combo_components CASCADE');
        DB::statement('DROP TABLE IF EXISTS price_list_items CASCADE');
        DB::statement('DROP TABLE IF EXISTS price_lists CASCADE');
        DB::statement('DROP TABLE IF EXISTS cut_types CASCADE');
    }
};
