<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// SUS · cambio de plan y complementos: SUS-02, SUS-03 (empresa) y SUS-10 (consola).
//  - saas_addons: catálogo de complementos; encienden un módulo o suben un límite (usuarios, marcas, locales). Nacen
//    en borrador y sin precio (D-SUS-01); publicado tiene precio (RN-SUS-01). Todos lo leen; solo la consola lo cambia.
//  - subscription_addons: lo que contrató cada empresa, con el precio del momento. RLS de la empresa y la consola.
//  - subscriptions.pending_plan_version_id / pending_from: bajar de plan se aplica al fin del período (RN-SUS-18).
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('saas_addons', function (Blueprint $table) {
            $table->string('code', 20)->primary();
            $table->string('name', 80);
            $table->string('description', 300)->nullable();
            $table->string('kind', 8);
            $table->string('module_code', 10)->nullable();
            $table->string('limit_key', 10)->nullable();
            $table->unsignedSmallInteger('unit_qty')->default(1);
            $table->decimal('price_pen', 10, 2)->nullable();
            $table->string('status', 10)->default('DRAFT');
            $table->unsignedSmallInteger('sort_order')->default(100);
            $table->string('updated_by_name', 120)->nullable();
            $table->timestampsTz();
        });
        foreach ([
            "kind IN ('MODULE','LIMIT')", "status IN ('DRAFT','PUBLISHED','RETIRED')",
            "(kind = 'MODULE') = (module_code IS NOT NULL)", "(kind = 'LIMIT') = (limit_key IN ('users','brands','sites'))",
            "status <> 'PUBLISHED' OR (price_pen IS NOT NULL AND price_pen > 0)", 'unit_qty > 0',
        ] as $i => $check) {
            DB::statement("ALTER TABLE saas_addons ADD CONSTRAINT saas_addons_regla_{$i} CHECK ({$check})");
        }
        DB::statement('ALTER TABLE saas_addons ENABLE ROW LEVEL SECURITY');
        DB::statement('CREATE POLICY lectura ON saas_addons FOR SELECT USING (true)');
        DB::statement('CREATE POLICY consola ON saas_addons FOR ALL USING (app_is_platform()) WITH CHECK (app_is_platform())');
        // Propuesta de la spec (SUS-03), en borrador y sin precio hasta D-SUS-01.
        foreach ([
            ['TEL', 'Telefonía', 'Central telefónica con grabación y registro de llamadas', 'MODULE', 'TEL', null, 1, 10],
            ['CNT', 'Contabilidad', 'Libros, asientos y cierre contable', 'MODULE', 'CNT', null, 1, 20],
            ['CON', 'Consignación', 'Mercadería en consignación y su liquidación', 'MODULE', 'CON', null, 1, 30],
            ['USERS_5', '5 usuarios más', 'Suma 5 usuarios del personal al límite del plan', 'LIMIT', null, 'users', 5, 40],
            ['BRAND_1', '1 marca más', 'Suma 1 marca al límite del plan', 'LIMIT', null, 'brands', 1, 50],
            ['SITE_1', '1 local más', 'Suma 1 local al límite del plan', 'LIMIT', null, 'sites', 1, 60],
        ] as [$code, $name, $desc, $kind, $mod, $lim, $qty, $sort]) {
            DB::table('saas_addons')->insert(['code' => $code, 'name' => $name, 'description' => $desc, 'kind' => $kind, 'module_code' => $mod,
                'limit_key' => $lim, 'unit_qty' => $qty, 'sort_order' => $sort, 'created_at' => now(), 'updated_at' => now()]);
        }

        Schema::create('subscription_addons', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('gen_random_uuid()'));
            $table->uuid('subscription_id');
            $table->uuid('tenant_id');
            $table->string('addon_code', 20);
            $table->unsignedSmallInteger('quantity');
            $table->decimal('unit_price', 10, 2);
            $table->string('status', 8)->default('ACTIVE');
            $table->timestampTz('started_at');
            $table->timestampTz('ended_at')->nullable();
            $table->string('created_by_name', 120);
            $table->timestampsTz();
            $table->foreign('subscription_id')->references('id')->on('subscriptions')->cascadeOnDelete();
            $table->foreign('tenant_id')->references('id')->on('tenants')->cascadeOnDelete();
            $table->foreign('addon_code')->references('code')->on('saas_addons');
        });
        DB::statement("ALTER TABLE subscription_addons ADD CONSTRAINT subscription_addons_estado CHECK (status IN ('ACTIVE','ENDED'))");
        DB::statement('ALTER TABLE subscription_addons ADD CONSTRAINT subscription_addons_cantidad CHECK (quantity > 0)');
        DB::statement("CREATE UNIQUE INDEX subscription_addons_un_activo ON subscription_addons (subscription_id, addon_code) WHERE status = 'ACTIVE'");
        DB::statement('ALTER TABLE subscription_addons ENABLE ROW LEVEL SECURITY');
        DB::statement('CREATE POLICY tenant_isolation ON subscription_addons USING (tenant_id = app_tenant_id() OR app_is_platform()) WITH CHECK (tenant_id = app_tenant_id() OR app_is_platform())');

        Schema::table('subscriptions', function (Blueprint $table) {
            $table->uuid('pending_plan_version_id')->nullable();
            $table->date('pending_from')->nullable();
            $table->foreign('pending_plan_version_id')->references('id')->on('saas_plan_versions')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('subscriptions', fn (Blueprint $t) => $t->dropConstrainedForeignId('pending_plan_version_id'));
        Schema::table('subscriptions', fn (Blueprint $t) => $t->dropColumn('pending_from'));
        Schema::dropIfExists('subscription_addons');
        Schema::dropIfExists('saas_addons');
    }
};
