<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// REC · generada desde el modelo del prototipo (tools/prototipo/generar_migraciones.py).
// Tablas: food_additives, recipes, recipe_versions, recipe_ingredients, recipe_steps, recipe_control_points.
// El dueño del módulo revisa tipos, únicos y estados antes de construir sus pantallas;
// los cambios se hacen con migraciones nuevas, no editando esta.
return new class extends Migration
{
    public function up(): void
    {
        // REC · food_additives
        Schema::create('food_additives', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->string('sin_code', 20);
            $table->string('name', 80);
            $table->string('function_class', 40)->comment('valores en el prototipo: ACIDITY_REGULATOR, ANTIOXIDANT, FLAVOR_ENHANCER, GELLING, PRESERVATIVE, SEQUESTRANT, THICKENER');
            $table->decimal('max_ppm', 14, 2)->nullable();
            $table->string('max_ppm_source', 255)->nullable();
            $table->string('allergen', 20)->nullable();
            $table->string('status', 20)->comment('valores en el prototipo: ACTIVE');
            $table->uuid('variant_id')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // REC · recipes
        Schema::create('recipes', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('product_id');
            $table->string('code', 40);
            $table->string('name', 80);
            $table->string('recipe_type', 20)->comment('valores en el prototipo: BROTH, CURED, JAM, LARD, OTHER, PRESERVE, SAUSAGE');
            $table->uuid('brand_id');
            $table->string('status', 20)->comment('valores en el prototipo: ACTIVE, DRAFT');
            $table->uuid('output_variant_id')->nullable();
            $table->string('line_code', 20)->nullable();
            $table->string('source', 20)->nullable()->comment('valores en el prototipo: TEMPLATE');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // REC · recipe_versions
        Schema::create('recipe_versions', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('recipe_id');
            $table->integer('version');
            $table->decimal('base_output_kg', 14, 3);
            $table->decimal('expected_yield_pct', 9, 4);
            $table->integer('shelf_life_days')->nullable();
            $table->string('storage', 20)->comment('valores en el prototipo: AMBIENT, CHILLED, FROZEN');
            $table->jsonb('allergens');
            $table->decimal('standard_cost_per_kg', 14, 3)->nullable();
            $table->string('status', 40)->comment('valores en el prototipo: APPROVED, DRAFT, IN_REVIEW, RETIRED');
            $table->text('notes')->nullable();
            $table->jsonb('packaging');
            $table->uuid('created_by');
            $table->jsonb('history');
            $table->uuid('approved_by')->nullable();
            $table->timestampTz('approved_at')->nullable();
            $table->text('approval_warnings')->nullable();
            $table->timestampTz('submitted_at')->nullable();
            $table->uuid('submitted_by')->nullable();
            $table->timestampTz('retired_at')->nullable();
            $table->uuid('retired_by')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // REC · recipe_ingredients
        Schema::create('recipe_ingredients', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('version_id');
            $table->integer('seq');
            $table->uuid('variant_id');
            $table->decimal('qty_kg', 14, 3);
            $table->decimal('weighing_tolerance_pct', 9, 4);
            $table->boolean('is_additive')->default(false);
            $table->uuid('additive_id')->nullable();
            $table->string('allergen', 20)->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // REC · recipe_steps
        Schema::create('recipe_steps', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('version_id');
            $table->integer('seq');
            $table->text('description');
            $table->decimal('duration_min', 14, 2);
            $table->string('equipment_category', 40)->comment('valores en el prototipo: COLD_ROOM, GRINDER, OTHER, POT, ROASTER, SEALER, SMOKER, STOVE, STUFFER');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // REC · recipe_control_points
        Schema::create('recipe_control_points', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('version_id');
            $table->integer('step_seq');
            $table->string('code', 20)->comment('valores en el prototipo: PC1, PC2, PC3');
            $table->string('variable', 40)->comment('valores en el prototipo: BRINE_PCT, BRIX, CORE_TEMP, PH, TIME');
            $table->decimal('min_value', 14, 2);
            $table->decimal('max_value', 14, 2);
            $table->string('unit', 20);
            $table->boolean('is_critical')->default(false);
            $table->string('corrective_action', 255);
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });

        Schema::table('food_additives', function (Blueprint $table) { $table->foreign('variant_id')->references('id')->on('product_variants')->restrictOnDelete(); $table->index('variant_id'); });
        Schema::table('food_additives', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('recipes', function (Blueprint $table) { $table->foreign('product_id')->references('id')->on('products')->restrictOnDelete(); $table->index('product_id'); });
        Schema::table('recipes', function (Blueprint $table) { $table->foreign('brand_id')->references('id')->on('brands')->restrictOnDelete(); $table->index('brand_id'); });
        Schema::table('recipes', function (Blueprint $table) { $table->foreign('output_variant_id')->references('id')->on('product_variants')->restrictOnDelete(); $table->index('output_variant_id'); });
        Schema::table('recipes', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('recipe_versions', function (Blueprint $table) { $table->foreign('recipe_id')->references('id')->on('recipes')->restrictOnDelete(); $table->index('recipe_id'); });
        Schema::table('recipe_versions', function (Blueprint $table) { $table->foreign('created_by')->references('id')->on('users')->restrictOnDelete(); $table->index('created_by'); });
        Schema::table('recipe_versions', function (Blueprint $table) { $table->foreign('approved_by')->references('id')->on('users')->restrictOnDelete(); $table->index('approved_by'); });
        Schema::table('recipe_versions', function (Blueprint $table) { $table->foreign('submitted_by')->references('id')->on('users')->restrictOnDelete(); $table->index('submitted_by'); });
        Schema::table('recipe_versions', function (Blueprint $table) { $table->foreign('retired_by')->references('id')->on('users')->restrictOnDelete(); $table->index('retired_by'); });
        Schema::table('recipe_versions', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('recipe_ingredients', function (Blueprint $table) { $table->foreign('version_id')->references('id')->on('recipe_versions')->restrictOnDelete(); $table->index('version_id'); });
        Schema::table('recipe_ingredients', function (Blueprint $table) { $table->foreign('variant_id')->references('id')->on('product_variants')->restrictOnDelete(); $table->index('variant_id'); });
        Schema::table('recipe_ingredients', function (Blueprint $table) { $table->foreign('additive_id')->references('id')->on('food_additives')->restrictOnDelete(); $table->index('additive_id'); });
        Schema::table('recipe_ingredients', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('recipe_steps', function (Blueprint $table) { $table->foreign('version_id')->references('id')->on('recipe_versions')->restrictOnDelete(); $table->index('version_id'); });
        Schema::table('recipe_steps', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('recipe_control_points', function (Blueprint $table) { $table->foreign('version_id')->references('id')->on('recipe_versions')->restrictOnDelete(); $table->index('version_id'); });
        Schema::table('recipe_control_points', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });

        DB::statement("SELECT enable_tenant_rls('food_additives')");
        DB::statement("SELECT audit.track('food_additives')");
        DB::statement("SELECT enable_tenant_rls('recipes')");
        DB::statement("SELECT audit.track('recipes')");
        DB::statement("SELECT enable_tenant_rls('recipe_versions')");
        DB::statement("SELECT audit.track('recipe_versions')");
        DB::statement("SELECT enable_tenant_rls('recipe_ingredients')");
        DB::statement("SELECT audit.track('recipe_ingredients')");
        DB::statement("SELECT enable_tenant_rls('recipe_steps')");
        DB::statement("SELECT audit.track('recipe_steps')");
        DB::statement("SELECT enable_tenant_rls('recipe_control_points')");
        DB::statement("SELECT audit.track('recipe_control_points')");
    }

    public function down(): void
    {
        DB::statement('DROP TABLE IF EXISTS recipe_control_points CASCADE');
        DB::statement('DROP TABLE IF EXISTS recipe_steps CASCADE');
        DB::statement('DROP TABLE IF EXISTS recipe_ingredients CASCADE');
        DB::statement('DROP TABLE IF EXISTS recipe_versions CASCADE');
        DB::statement('DROP TABLE IF EXISTS recipes CASCADE');
        DB::statement('DROP TABLE IF EXISTS food_additives CASCADE');
    }
};
