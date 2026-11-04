<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// EQU · generada desde el modelo del prototipo (tools/prototipo/generar_migraciones.py).
// Tablas: equipment, equipment_calibrations, maintenance_plans, maintenance_orders.
// El dueño del módulo revisa tipos, únicos y estados antes de construir sus pantallas;
// los cambios se hacen con migraciones nuevas, no editando esta.
return new class extends Migration
{
    public function up(): void
    {
        // EQU · equipment
        Schema::create('equipment', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->string('code', 40);
            $table->string('name', 80);
            $table->string('category', 40);
            $table->uuid('establishment_id');
            $table->uuid('warehouse_id')->nullable();
            $table->string('brand_name', 40);
            $table->string('model', 40);
            $table->string('serial_number', 40);
            $table->date('purchase_date');
            $table->decimal('purchase_cost', 14, 2);
            $table->integer('useful_life_months');
            $table->decimal('hourly_rate', 9, 4);
            $table->decimal('power_kw', 14, 2);
            $table->string('capacity', 40);
            $table->boolean('requires_calibration')->default(false);
            $table->uuid('cost_center_id');
            $table->string('qr_code', 40);
            $table->string('status', 40)->comment('valores en el prototipo: ACTIVE, OUT_OF_SERVICE');
            $table->decimal('hour_meter', 14, 2);
            $table->jsonb('meter_readings');
            $table->string('manual_url', 80);
            $table->jsonb('photos');
            $table->string('oos_reason', 40)->nullable()->comment('valores en el prototipo: CORRECTIVE');
            $table->timestampTz('oos_since')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // EQU · equipment_calibrations
        Schema::create('equipment_calibrations', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('equipment_id');
            $table->date('calibrated_on');
            $table->date('valid_until');
            $table->uuid('provider_supplier_id')->nullable();
            $table->string('provider_name', 255);
            $table->string('certificate_number', 40);
            $table->string('certificate_url', 80);
            $table->decimal('max_error_g', 14, 2)->nullable();
            $table->string('result', 20)->comment('valores en el prototipo: FAIL, PASS');
            $table->decimal('cost', 14, 2);
            $table->text('notes')->nullable();
            $table->string('recorded_by', 40);
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // EQU · maintenance_plans
        Schema::create('maintenance_plans', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('equipment_id');
            $table->string('activity', 255);
            $table->integer('frequency_days')->nullable();
            $table->integer('frequency_hours')->nullable();
            $table->date('next_due_on')->nullable();
            $table->integer('next_due_hours')->nullable();
            $table->uuid('responsible_employee_id')->nullable();
            $table->string('responsible_name', 40);
            $table->string('expected_parts', 80)->nullable();
            $table->string('status', 20)->comment('valores en el prototipo: ACTIVE');
            $table->date('last_done_on')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // EQU · maintenance_orders
        Schema::create('maintenance_orders', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->string('number', 20);
            $table->uuid('equipment_id');
            $table->string('kind', 40)->comment('valores en el prototipo: CORRECTIVE, PREVENTIVE');
            $table->uuid('plan_id')->nullable();
            $table->timestampTz('reported_at');
            $table->uuid('reported_by');
            $table->text('description');
            $table->string('photo_url', 20)->nullable();
            $table->string('urgency', 20)->comment('valores en el prototipo: HIGH, NORMAL');
            $table->string('diagnosis', 80)->nullable();
            $table->timestampTz('started_at')->nullable();
            $table->timestampTz('finished_at')->nullable();
            $table->decimal('downtime_hours', 14, 2)->nullable();
            $table->decimal('labor_hours', 14, 2);
            $table->decimal('labor_cost', 14, 2);
            $table->jsonb('parts');
            $table->decimal('parts_cost', 14, 2);
            $table->decimal('external_cost', 14, 2);
            $table->decimal('total_cost', 14, 2);
            $table->uuid('external_supplier_id')->nullable();
            $table->uuid('cost_center_id');
            $table->string('status', 20)->comment('valores en el prototipo: DONE, OPEN');
            $table->date('due_on')->nullable();
            $table->string('void_reason', 20)->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });

        Schema::table('equipment', function (Blueprint $table) { $table->foreign('establishment_id')->references('id')->on('establishments')->restrictOnDelete(); $table->index('establishment_id'); });
        Schema::table('equipment', function (Blueprint $table) { $table->foreign('warehouse_id')->references('id')->on('warehouses')->restrictOnDelete(); $table->index('warehouse_id'); });
        Schema::table('equipment', function (Blueprint $table) { $table->foreign('cost_center_id')->references('id')->on('cost_centers')->restrictOnDelete(); $table->index('cost_center_id'); });
        Schema::table('equipment', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('equipment_calibrations', function (Blueprint $table) { $table->foreign('equipment_id')->references('id')->on('equipment')->restrictOnDelete(); $table->index('equipment_id'); });
        Schema::table('equipment_calibrations', function (Blueprint $table) { $table->foreign('provider_supplier_id')->references('id')->on('suppliers')->restrictOnDelete(); $table->index('provider_supplier_id'); });
        Schema::table('equipment_calibrations', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('maintenance_plans', function (Blueprint $table) { $table->foreign('equipment_id')->references('id')->on('equipment')->restrictOnDelete(); $table->index('equipment_id'); });
        Schema::table('maintenance_plans', function (Blueprint $table) { $table->foreign('responsible_employee_id')->references('id')->on('employees')->restrictOnDelete(); $table->index('responsible_employee_id'); });
        Schema::table('maintenance_plans', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('maintenance_orders', function (Blueprint $table) { $table->foreign('equipment_id')->references('id')->on('equipment')->restrictOnDelete(); $table->index('equipment_id'); });
        Schema::table('maintenance_orders', function (Blueprint $table) { $table->foreign('plan_id')->references('id')->on('maintenance_plans')->restrictOnDelete(); $table->index('plan_id'); });
        Schema::table('maintenance_orders', function (Blueprint $table) { $table->foreign('reported_by')->references('id')->on('users')->restrictOnDelete(); $table->index('reported_by'); });
        Schema::table('maintenance_orders', function (Blueprint $table) { $table->foreign('external_supplier_id')->references('id')->on('suppliers')->restrictOnDelete(); $table->index('external_supplier_id'); });
        Schema::table('maintenance_orders', function (Blueprint $table) { $table->foreign('cost_center_id')->references('id')->on('cost_centers')->restrictOnDelete(); $table->index('cost_center_id'); });
        Schema::table('maintenance_orders', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });

        DB::statement("SELECT enable_tenant_rls('equipment')");
        DB::statement("SELECT audit.track('equipment')");
        DB::statement("SELECT enable_tenant_rls('equipment_calibrations')");
        DB::statement("SELECT audit.track('equipment_calibrations')");
        DB::statement("SELECT enable_tenant_rls('maintenance_plans')");
        DB::statement("SELECT audit.track('maintenance_plans')");
        DB::statement("SELECT enable_tenant_rls('maintenance_orders')");
        DB::statement("SELECT audit.track('maintenance_orders')");
    }

    public function down(): void
    {
        DB::statement('DROP TABLE IF EXISTS maintenance_orders CASCADE');
        DB::statement('DROP TABLE IF EXISTS maintenance_plans CASCADE');
        DB::statement('DROP TABLE IF EXISTS equipment_calibrations CASCADE');
        DB::statement('DROP TABLE IF EXISTS equipment CASCADE');
    }
};
