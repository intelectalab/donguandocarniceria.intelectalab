<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// OPS-10 Métricas del negocio y SUS-04 historial de uso.
//  - platform_metric_runs: las métricas de un mes se calculan al cierre y se congelan; recalcular crea otra corrida
//    (run_no) sin borrar la anterior (RN-OPS-17). Solo inserción (RN-OPS-05) y solo la consola las ve.
//  - tenant_usage_snapshots: uso de cada empresa por mes (usuarios, marcas, locales), para su historial de 12 meses.
//    La tarea diaria deja el valor del día en la fila del mes en curso. La empresa ve las suyas; la consola, todas.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('platform_metric_runs', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('gen_random_uuid()'));
            $table->string('period', 7);
            $table->unsignedSmallInteger('run_no');
            $table->jsonb('data');
            $table->string('reason', 300)->nullable();
            $table->uuid('created_by')->nullable();
            $table->string('created_by_name', 120);
            $table->timestampTz('created_at')->useCurrent();
            $table->unique(['period', 'run_no']);
        });
        DB::statement('ALTER TABLE platform_metric_runs ENABLE ROW LEVEL SECURITY');
        DB::statement('CREATE POLICY solo_consola ON platform_metric_runs USING (app_is_platform()) WITH CHECK (app_is_platform())');
        DB::statement('REVOKE UPDATE, DELETE, TRUNCATE ON platform_metric_runs FROM aycha_app');

        Schema::create('tenant_usage_snapshots', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('gen_random_uuid()'));
            $table->uuid('tenant_id');
            $table->string('period', 7);
            $table->unsignedInteger('users')->default(0);
            $table->unsignedInteger('brands')->default(0);
            $table->unsignedInteger('sites')->default(0);
            $table->unsignedInteger('users_limit')->nullable();
            $table->unsignedInteger('brands_limit')->nullable();
            $table->unsignedInteger('sites_limit')->nullable();
            $table->timestampTz('taken_at');
            $table->foreign('tenant_id')->references('id')->on('tenants')->cascadeOnDelete();
            $table->unique(['tenant_id', 'period']);
        });
        DB::statement('ALTER TABLE tenant_usage_snapshots ENABLE ROW LEVEL SECURITY');
        DB::statement('CREATE POLICY tenant_isolation ON tenant_usage_snapshots USING (tenant_id = app_tenant_id() OR app_is_platform()) WITH CHECK (app_is_platform())');
    }

    public function down(): void
    {
        Schema::dropIfExists('tenant_usage_snapshots');
        Schema::dropIfExists('platform_metric_runs');
    }
};
