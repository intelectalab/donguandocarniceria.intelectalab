<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// TAB · generada desde el modelo del prototipo (tools/prototipo/generar_migraciones.py).
// Tablas: kpi_snapshot_runs, dashboards, dashboard_widgets, kpi_definitions, kpi_targets, kpi_snapshots.
// El dueño del módulo revisa tipos, únicos y estados antes de construir sus pantallas;
// los cambios se hacen con migraciones nuevas, no editando esta.
return new class extends Migration
{
    public function up(): void
    {
        // TAB · kpi_snapshot_runs
        Schema::create('kpi_snapshot_runs', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->date('period');
            $table->integer('run_no');
            $table->string('reason', 255);
            $table->integer('kpis_count');
            $table->string('status', 20)->comment('valores en el prototipo: FAILED, OK');
            $table->timestampTz('started_at');
            $table->timestampTz('finished_at');
            $table->string('user', 80);
            $table->string('error', 255)->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // TAB · dashboards
        Schema::create('dashboards', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->string('code', 40)->comment('valores en el prototipo: ALMACEN, DELIVERY, GERENCIA, MARKETING, SUPERVISORA, VENTAS');
            $table->string('name', 80);
            $table->jsonb('role_codes');
            $table->boolean('is_system')->default(false);
            $table->jsonb('layout');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // TAB · dashboard_widgets
        Schema::create('dashboard_widgets', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('dashboard_id');
            $table->uuid('kpi_id');
            $table->string('kpi_code', 40);
            $table->integer('position');
            $table->string('viz', 20)->comment('valores en el prototipo: TABLE, TILE');
            $table->string('dimension', 20)->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // TAB · kpi_definitions
        Schema::create('kpi_definitions', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->string('code', 40);
            $table->string('module_code', 20);
            $table->string('name', 255);
            $table->string('formula', 255);
            $table->string('unit', 20)->comment('valores en el prototipo: COUNT, DAYS, HOURS, KG, MINUTES, PCT, PEN, RATIO');
            $table->string('direction', 40)->comment('valores en el prototipo: HIGHER_BETTER, LOWER_BETTER, TARGET');
            $table->text('direction_text');
            $table->integer('phase');
            $table->string('frequency', 20)->comment('valores en el prototipo: INSTANT, MONTHLY, WEEKLY');
            $table->string('status', 20)->comment('valores en el prototipo: ACTIVE');
            $table->string('requires_module', 20);
            $table->string('calculator', 40);
            $table->string('drilldown', 20);
            $table->integer('decimals');
            $table->jsonb('visible_roles');
            $table->jsonb('dimensions');
            $table->string('source', 255)->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // TAB · kpi_targets
        Schema::create('kpi_targets', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('kpi_id');
            $table->string('kpi_code', 40);
            $table->uuid('brand_id')->nullable();
            $table->uuid('establishment_id')->nullable();
            $table->decimal('target', 14, 2);
            $table->decimal('tolerance_pct', 9, 4);
            $table->date('valid_from');
            $table->date('valid_to')->nullable();
            $table->string('created_by', 40)->nullable();
            $table->string('note', 80)->nullable();
            $table->string('source', 20)->nullable()->comment('valores en el prototipo: TEMPLATE');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // TAB · kpi_snapshots
        Schema::create('kpi_snapshots', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('kpi_id');
            $table->string('kpi_code', 40);
            $table->date('period');
            $table->string('dimension_key', 20)->comment('valores en el prototipo: ALL');
            $table->decimal('value', 18, 4)->nullable();
            $table->decimal('numerator', 18, 4)->nullable();
            $table->decimal('denominator', 18, 4)->nullable();
            $table->integer('run_no');
            $table->timestampTz('computed_at');
            $table->uuid('snapshot_run_id');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });

        Schema::table('kpi_snapshot_runs', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('dashboards', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('dashboard_widgets', function (Blueprint $table) { $table->foreign('dashboard_id')->references('id')->on('dashboards')->restrictOnDelete(); $table->index('dashboard_id'); });
        Schema::table('dashboard_widgets', function (Blueprint $table) { $table->foreign('kpi_id')->references('id')->on('kpi_definitions')->restrictOnDelete(); $table->index('kpi_id'); });
        Schema::table('dashboard_widgets', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('kpi_definitions', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('kpi_targets', function (Blueprint $table) { $table->foreign('kpi_id')->references('id')->on('kpi_definitions')->restrictOnDelete(); $table->index('kpi_id'); });
        Schema::table('kpi_targets', function (Blueprint $table) { $table->foreign('brand_id')->references('id')->on('brands')->restrictOnDelete(); $table->index('brand_id'); });
        Schema::table('kpi_targets', function (Blueprint $table) { $table->foreign('establishment_id')->references('id')->on('establishments')->restrictOnDelete(); $table->index('establishment_id'); });
        Schema::table('kpi_targets', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('kpi_snapshots', function (Blueprint $table) { $table->foreign('kpi_id')->references('id')->on('kpi_definitions')->restrictOnDelete(); $table->index('kpi_id'); });
        Schema::table('kpi_snapshots', function (Blueprint $table) { $table->foreign('snapshot_run_id')->references('id')->on('kpi_snapshot_runs')->restrictOnDelete(); $table->index('snapshot_run_id'); });
        Schema::table('kpi_snapshots', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });

        DB::statement("SELECT enable_tenant_rls('kpi_snapshot_runs')");
        DB::statement("SELECT enable_tenant_rls('dashboards')");
        DB::statement("SELECT enable_tenant_rls('dashboard_widgets')");
        Schema::table('kpi_definitions', fn (Blueprint $table) => $table->unique(['tenant_id', 'code']));
        DB::statement("SELECT enable_tenant_rls('kpi_definitions')");
        DB::statement("SELECT enable_tenant_rls('kpi_targets')");
        DB::statement("SELECT enable_tenant_rls('kpi_snapshots')");
        DB::statement('REVOKE UPDATE, DELETE, TRUNCATE ON kpi_snapshots FROM aycha_app');  // solo inserción
    }

    public function down(): void
    {
        DB::statement('DROP TABLE IF EXISTS kpi_snapshots CASCADE');
        DB::statement('DROP TABLE IF EXISTS kpi_targets CASCADE');
        DB::statement('DROP TABLE IF EXISTS kpi_definitions CASCADE');
        DB::statement('DROP TABLE IF EXISTS dashboard_widgets CASCADE');
        DB::statement('DROP TABLE IF EXISTS dashboards CASCADE');
        DB::statement('DROP TABLE IF EXISTS kpi_snapshot_runs CASCADE');
    }
};
