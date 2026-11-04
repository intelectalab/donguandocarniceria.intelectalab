<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// PRE · generada desde el modelo del prototipo (tools/prototipo/generar_migraciones.py).
// Tablas: picking_waves, picking_tasks, picking_task_lines, shipment_parcels, picking_scans, packing_errors.
// El dueño del módulo revisa tipos, únicos y estados antes de construir sus pantallas;
// los cambios se hacen con migraciones nuevas, no editando esta.
return new class extends Migration
{
    public function up(): void
    {
        // PRE · picking_waves
        Schema::create('picking_waves', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->string('number', 20);
            $table->uuid('establishment_id');
            $table->uuid('warehouse_id');
            $table->date('wave_date');
            $table->time('slot_from')->nullable();
            $table->time('slot_to')->nullable();
            $table->string('route_id', 20)->nullable();
            $table->string('route_code', 20)->nullable();
            $table->string('status', 20)->comment('valores en el prototipo: CLOSED, LOADED, PICKING');
            $table->timestampTz('released_at');
            $table->uuid('released_by');
            $table->uuid('created_by');
            $table->timestampTz('closed_at')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // PRE · picking_tasks
        Schema::create('picking_tasks', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('wave_id')->nullable();
            $table->uuid('order_id');
            $table->string('order_number', 20);
            $table->uuid('establishment_id');
            $table->uuid('brand_id');
            $table->date('delivery_date');
            $table->time('slot_from')->nullable();
            $table->time('slot_to')->nullable();
            $table->uuid('preparer_user_id')->nullable();
            $table->string('status', 20)->comment('valores en el prototipo: LOADED, PENDING, PICKED, PICKING, VERIFIED');
            $table->integer('parcel_count')->nullable();
            $table->string('parcel_type', 40)->nullable()->comment('valores en el prototipo: BAG, THERMAL_BOX');
            $table->string('photo_file_id', 40)->nullable();
            $table->uuid('verified_by')->nullable();
            $table->timestampTz('started_at')->nullable();
            $table->timestampTz('finished_at')->nullable();
            $table->string('route_code', 40)->nullable();
            $table->string('route_id', 20)->nullable();
            $table->integer('stop_seq')->nullable();
            $table->string('route_key', 80)->nullable();
            $table->boolean('stock_moved')->default(false);
            $table->timestampTz('picked_at')->nullable();
            $table->timestampTz('packed_at')->nullable();
            $table->timestampTz('verified_at')->nullable();
            $table->timestampTz('loaded_at')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // PRE · picking_task_lines
        Schema::create('picking_task_lines', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('task_id');
            $table->string('order_line_id', 40);
            $table->uuid('variant_id');
            $table->decimal('qty_required', 14, 3);
            $table->decimal('qty_picked', 14, 3);
            $table->decimal('est_weight_kg', 14, 3)->nullable();
            $table->decimal('weighed_kg', 14, 3)->nullable();
            $table->string('status', 20)->comment('valores en el prototipo: DONE, PENDING');
            $table->string('short_reason', 20)->nullable();
            $table->string('short_approved_by', 20)->nullable();
            $table->text('cut_notes')->nullable();
            $table->boolean('weighted')->default(false);
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // PRE · shipment_parcels
        Schema::create('shipment_parcels', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('task_id');
            $table->uuid('order_id');
            $table->integer('parcel_no');
            $table->integer('parcel_count');
            $table->string('parcel_type', 40)->comment('valores en el prototipo: BAG, THERMAL_BOX');
            $table->string('label_code', 40);
            $table->string('route_id', 20)->nullable();
            $table->string('route_code', 40);
            $table->string('route_key', 80);
            $table->integer('stop_seq');
            $table->string('weight_kg', 20)->nullable();
            $table->string('status', 40)->comment('valores en el prototipo: DELIVERED, LOADED, SEALED');
            $table->timestampTz('loaded_at')->nullable();
            $table->uuid('loaded_by')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // PRE · picking_scans
        Schema::create('picking_scans', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('task_id');
            $table->uuid('task_line_id')->nullable();
            $table->string('scan_type', 20)->comment('valores en el prototipo: PICK');
            $table->string('barcode', 40);
            $table->uuid('variant_id');
            $table->uuid('lot_id')->nullable();
            $table->decimal('weight_kg', 14, 3)->nullable();
            $table->decimal('qty', 14, 3)->nullable();
            $table->string('result', 40)->comment('valores en el prototipo: DUPLICATE, EXCESS, NOT_FEFO, OK, WRONG_ORDER, WRONG_PRODUCT');
            $table->string('error_code', 40)->nullable();
            $table->text('message')->nullable();
            $table->string('override_by', 20)->nullable();
            $table->string('device_id', 20);
            $table->timestampTz('scanned_at');
            $table->uuid('user_id');
            $table->uuid('order_id');
            $table->uuid('wave_id');
            $table->uuid('suggested_lot_id')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // PRE · packing_errors
        Schema::create('packing_errors', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('order_id');
            $table->uuid('task_id');
            $table->string('error_type', 40)->comment('valores en el prototipo: CROSSED_CUSTOMER, DAMAGED_PACKAGE, EXPIRED_LOT, LABEL_ERROR, MISSING_ITEM, WRONG_CUT, WRONG_PRODUCT, WRONG_WEIGHT');
            $table->string('detected_at_stage', 40)->comment('valores en el prototipo: CUSTOMER_CLAIM, DELIVERY, LOADING, PICKING_SCAN, VERIFICATION');
            $table->uuid('responsible_employee_id')->nullable();
            $table->uuid('detected_by');
            $table->text('description');
            $table->decimal('cost_amount', 14, 2);
            $table->string('corrective_action', 255)->nullable();
            $table->string('status', 20)->comment('valores en el prototipo: CLOSED, OPEN');
            $table->timestampTz('detected_at');
            $table->uuid('establishment_id');
            $table->timestampTz('closed_at')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });

        Schema::table('picking_waves', function (Blueprint $table) { $table->foreign('establishment_id')->references('id')->on('establishments')->restrictOnDelete(); $table->index('establishment_id'); });
        Schema::table('picking_waves', function (Blueprint $table) { $table->foreign('warehouse_id')->references('id')->on('warehouses')->restrictOnDelete(); $table->index('warehouse_id'); });
        Schema::table('picking_waves', function (Blueprint $table) { $table->foreign('released_by')->references('id')->on('users')->restrictOnDelete(); $table->index('released_by'); });
        Schema::table('picking_waves', function (Blueprint $table) { $table->foreign('created_by')->references('id')->on('users')->restrictOnDelete(); $table->index('created_by'); });
        Schema::table('picking_waves', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('picking_tasks', function (Blueprint $table) { $table->foreign('wave_id')->references('id')->on('picking_waves')->restrictOnDelete(); $table->index('wave_id'); });
        Schema::table('picking_tasks', function (Blueprint $table) { $table->foreign('order_id')->references('id')->on('sales_orders')->restrictOnDelete(); $table->index('order_id'); });
        Schema::table('picking_tasks', function (Blueprint $table) { $table->foreign('establishment_id')->references('id')->on('establishments')->restrictOnDelete(); $table->index('establishment_id'); });
        Schema::table('picking_tasks', function (Blueprint $table) { $table->foreign('brand_id')->references('id')->on('brands')->restrictOnDelete(); $table->index('brand_id'); });
        Schema::table('picking_tasks', function (Blueprint $table) { $table->foreign('preparer_user_id')->references('id')->on('users')->restrictOnDelete(); $table->index('preparer_user_id'); });
        Schema::table('picking_tasks', function (Blueprint $table) { $table->foreign('verified_by')->references('id')->on('users')->restrictOnDelete(); $table->index('verified_by'); });
        Schema::table('picking_tasks', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('picking_task_lines', function (Blueprint $table) { $table->foreign('task_id')->references('id')->on('picking_tasks')->restrictOnDelete(); $table->index('task_id'); });
        Schema::table('picking_task_lines', function (Blueprint $table) { $table->foreign('variant_id')->references('id')->on('product_variants')->restrictOnDelete(); $table->index('variant_id'); });
        Schema::table('picking_task_lines', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('shipment_parcels', function (Blueprint $table) { $table->foreign('task_id')->references('id')->on('picking_tasks')->restrictOnDelete(); $table->index('task_id'); });
        Schema::table('shipment_parcels', function (Blueprint $table) { $table->foreign('order_id')->references('id')->on('sales_orders')->restrictOnDelete(); $table->index('order_id'); });
        Schema::table('shipment_parcels', function (Blueprint $table) { $table->foreign('loaded_by')->references('id')->on('users')->restrictOnDelete(); $table->index('loaded_by'); });
        Schema::table('shipment_parcels', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('picking_scans', function (Blueprint $table) { $table->foreign('task_id')->references('id')->on('picking_tasks')->restrictOnDelete(); $table->index('task_id'); });
        Schema::table('picking_scans', function (Blueprint $table) { $table->foreign('task_line_id')->references('id')->on('picking_task_lines')->restrictOnDelete(); $table->index('task_line_id'); });
        Schema::table('picking_scans', function (Blueprint $table) { $table->foreign('variant_id')->references('id')->on('product_variants')->restrictOnDelete(); $table->index('variant_id'); });
        Schema::table('picking_scans', function (Blueprint $table) { $table->foreign('lot_id')->references('id')->on('lots')->restrictOnDelete(); $table->index('lot_id'); });
        Schema::table('picking_scans', function (Blueprint $table) { $table->foreign('user_id')->references('id')->on('users')->restrictOnDelete(); $table->index('user_id'); });
        Schema::table('picking_scans', function (Blueprint $table) { $table->foreign('order_id')->references('id')->on('sales_orders')->restrictOnDelete(); $table->index('order_id'); });
        Schema::table('picking_scans', function (Blueprint $table) { $table->foreign('wave_id')->references('id')->on('picking_waves')->restrictOnDelete(); $table->index('wave_id'); });
        Schema::table('picking_scans', function (Blueprint $table) { $table->foreign('suggested_lot_id')->references('id')->on('lots')->restrictOnDelete(); $table->index('suggested_lot_id'); });
        Schema::table('picking_scans', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('packing_errors', function (Blueprint $table) { $table->foreign('order_id')->references('id')->on('sales_orders')->restrictOnDelete(); $table->index('order_id'); });
        Schema::table('packing_errors', function (Blueprint $table) { $table->foreign('task_id')->references('id')->on('picking_tasks')->restrictOnDelete(); $table->index('task_id'); });
        Schema::table('packing_errors', function (Blueprint $table) { $table->foreign('responsible_employee_id')->references('id')->on('employees')->restrictOnDelete(); $table->index('responsible_employee_id'); });
        Schema::table('packing_errors', function (Blueprint $table) { $table->foreign('detected_by')->references('id')->on('users')->restrictOnDelete(); $table->index('detected_by'); });
        Schema::table('packing_errors', function (Blueprint $table) { $table->foreign('establishment_id')->references('id')->on('establishments')->restrictOnDelete(); $table->index('establishment_id'); });
        Schema::table('packing_errors', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });

        DB::statement("SELECT enable_tenant_rls('picking_waves')");
        DB::statement("SELECT enable_tenant_rls('picking_tasks')");
        DB::statement("SELECT enable_tenant_rls('picking_task_lines')");
        DB::statement("SELECT enable_tenant_rls('shipment_parcels')");
        DB::statement("SELECT enable_tenant_rls('picking_scans')");
        DB::statement('REVOKE UPDATE, DELETE, TRUNCATE ON picking_scans FROM aycha_app');  // solo inserción
        DB::statement("SELECT enable_tenant_rls('packing_errors')");
    }

    public function down(): void
    {
        DB::statement('DROP TABLE IF EXISTS packing_errors CASCADE');
        DB::statement('DROP TABLE IF EXISTS picking_scans CASCADE');
        DB::statement('DROP TABLE IF EXISTS shipment_parcels CASCADE');
        DB::statement('DROP TABLE IF EXISTS picking_task_lines CASCADE');
        DB::statement('DROP TABLE IF EXISTS picking_tasks CASCADE');
        DB::statement('DROP TABLE IF EXISTS picking_waves CASCADE');
    }
};
