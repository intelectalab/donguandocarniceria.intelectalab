<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// DEL · generada desde el modelo del prototipo (tools/prototipo/generar_migraciones.py).
// Tablas: delivery_routes, delivery_stops, delivery_events, tracking_links, carrier_rates, carrier_invoices, carrier_invoice_lines, province_shipments, delivery_costs, delivery_cost_allocations.
// El dueño del módulo revisa tipos, únicos y estados antes de construir sus pantallas;
// los cambios se hacen con migraciones nuevas, no editando esta.
return new class extends Migration
{
    public function up(): void
    {
        // DEL · delivery_routes
        Schema::create('delivery_routes', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->string('code', 40);
            $table->date('route_date');
            $table->uuid('establishment_id');
            $table->time('slot_from');
            $table->time('slot_to');
            $table->string('mode', 40)->comment('valores en el prototipo: OWN, RENTED, THIRD_PARTY');
            $table->uuid('vehicle_id')->nullable();
            $table->uuid('driver_user_id')->nullable();
            $table->uuid('driver_employee_id')->nullable();
            $table->uuid('carrier_supplier_id')->nullable();
            $table->string('sequence_method', 40)->comment('valores en el prototipo: NEAREST_NEIGHBOR');
            $table->decimal('planned_km', 14, 3);
            $table->decimal('odometer_start', 14, 2)->nullable();
            $table->decimal('odometer_end', 14, 2)->nullable();
            $table->string('status', 20)->comment('valores en el prototipo: IN_ROUTE, RETURNED, SETTLED');
            $table->timestampTz('departed_at');
            $table->timestampTz('returned_at')->nullable();
            $table->string('driver_pay_mode', 40)->nullable()->comment('valores en el prototipo: DAILY, PER_DELIVERY');
            $table->decimal('driver_pay_rate', 9, 4)->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // DEL · delivery_stops
        Schema::create('delivery_stops', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('route_id');
            $table->uuid('order_id');
            $table->integer('seq');
            $table->uuid('zone_id');
            $table->timestampTz('eta');
            $table->string('status', 40)->comment('valores en el prototipo: ARRIVED, DELIVERED, FAILED, PENDING');
            $table->decimal('cod_amount', 14, 2);
            $table->decimal('collected_amount', 14, 2);
            $table->string('delivery_code', 20);
            $table->decimal('pod_distance_m', 14, 2)->nullable();
            $table->timestampTz('arrived_at')->nullable();
            $table->timestampTz('closed_at')->nullable();
            $table->decimal('distance_km', 14, 3);
            $table->jsonb('bags');
            $table->decimal('kg', 14, 3);
            $table->string('fail_reason', 40)->nullable()->comment('valores en el prototipo: CUSTOMER_ABSENT, NO_PAYMENT, OUT_OF_SLOT, REFUSED, WRONG_ADDRESS');
            $table->boolean('bags_returned')->nullable();
            $table->date('rescheduled_to')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // DEL · delivery_events
        Schema::create('delivery_events', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('route_id');
            $table->uuid('stop_id')->nullable();
            $table->string('reason_code', 40)->nullable()->comment('valores en el prototipo: CUSTOMER_ABSENT, DAMAGED, NO_PAYMENT, OTHER, OUT_OF_SLOT, REFUSED, WRONG_ADDRESS');
            $table->decimal('lat', 10, 7)->nullable();
            $table->decimal('lng', 10, 7)->nullable();
            $table->string('photo_file_id', 40)->nullable();
            $table->string('delivery_code', 20)->nullable();
            $table->string('signature_file_id', 40)->nullable();
            $table->string('amount', 20)->nullable();
            $table->string('payment_id', 20)->nullable();
            $table->string('receiver_name', 40)->nullable();
            $table->text('notes')->nullable();
            $table->string('client_event_id', 40);
            $table->string('event_type', 40)->comment('valores en el prototipo: ARRIVED, DELIVERED, DEPARTED, FAILED, INCIDENT, POSITION, RETURNED');
            $table->timestampTz('occurred_at');
            $table->string('incident_type', 40)->nullable()->comment('valores en el prototipo: CROSSED_ORDER, DAMAGED_PRODUCT');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // DEL · tracking_links
        Schema::create('tracking_links', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('order_id');
            $table->string('token', 80);
            $table->timestampTz('expires_at');
            $table->boolean('revoked')->default(false);
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // DEL · carrier_rates
        Schema::create('carrier_rates', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('supplier_id');
            $table->uuid('zone_id')->nullable();
            $table->string('rate_basis', 40)->comment('valores en el prototipo: PER_DELIVERY, PER_KG');
            $table->decimal('amount', 14, 2);
            $table->date('valid_from');
            $table->date('valid_to')->nullable();
            $table->string('status', 20)->comment('valores en el prototipo: ACTIVE');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // DEL · carrier_invoices
        Schema::create('carrier_invoices', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('supplier_id')->nullable();
            $table->string('invoice_number', 40)->nullable();
            $table->date('issue_date')->nullable();
            $table->date('period_from')->nullable();
            $table->date('period_to')->nullable();
            $table->decimal('amount', 14, 2)->nullable();
            $table->decimal('expected_amount', 14, 2)->nullable();
            $table->integer('difference')->nullable();
            $table->string('status', 20)->nullable()->comment('valores en el prototipo: OBSERVED');
            $table->uuid('reconciled_by')->nullable();
            $table->timestampTz('reconciled_at')->nullable();
            $table->integer('shipments')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // DEL · carrier_invoice_lines
        Schema::create('carrier_invoice_lines', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('invoice_id');
            $table->uuid('stop_id')->nullable();
            $table->string('external_ref', 40);
            $table->decimal('billed_amount', 14, 2);
            $table->decimal('expected_amount', 14, 2);
            $table->string('match_status', 40)->comment('valores en el prototipo: MATCHED, NOT_REGISTERED');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // DEL · province_shipments
        Schema::create('province_shipments', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('order_id');
            $table->uuid('agency_supplier_id');
            $table->uuid('dispatch_guide_id')->nullable();
            $table->string('tracking_number', 40)->nullable();
            $table->string('packaging', 40)->comment('valores en el prototipo: THERMAL_BOX');
            $table->integer('packages');
            $table->decimal('weight_kg', 14, 3);
            $table->decimal('freight_cost', 14, 2);
            $table->decimal('packaging_cost', 14, 2);
            $table->integer('charged_to_customer');
            $table->string('destination', 80);
            $table->string('destination_ubigeo', 20)->comment('valores en el prototipo: 040101, 080108, 130111');
            $table->string('status', 40)->comment('valores en el prototipo: DELIVERED, IN_TRANSIT, PREPARED');
            $table->timestampTz('handed_at')->nullable();
            $table->timestampTz('delivered_at')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // DEL · delivery_costs
        Schema::create('delivery_costs', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('vehicle_id')->nullable();
            $table->uuid('route_id')->nullable();
            $table->uuid('employee_id')->nullable();
            $table->uuid('supplier_id')->nullable();
            $table->uuid('zone_id')->nullable();
            $table->decimal('fuel_gallons', 18, 4)->nullable();
            $table->string('fuel_voucher_no', 40)->nullable();
            $table->decimal('odometer_km', 14, 3)->nullable();
            $table->uuid('expense_id')->nullable();
            $table->text('notes');
            $table->string('status', 20)->nullable()->comment('valores en el prototipo: ACTIVE');
            $table->decimal('km_per_gal', 14, 3)->nullable();
            $table->string('registered_by', 40)->nullable();
            $table->date('cost_date');
            $table->string('cost_type', 80);
            $table->decimal('amount', 14, 2);
            $table->boolean('auto')->nullable();
            $table->string('pay_mode', 40)->nullable()->comment('valores en el prototipo: DAILY, PER_DELIVERY');
            $table->uuid('employee_ref')->nullable();
            $table->string('subtype', 40)->nullable()->comment('valores en el prototipo: DEPRECIATION');
            $table->uuid('order_id')->nullable();
            $table->uuid('establishment_id')->nullable();
            $table->string('source', 20)->nullable()->comment('valores en el prototipo: GAS');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // DEL · delivery_cost_allocations
        Schema::create('delivery_cost_allocations', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->date('period');
            $table->integer('run_no');
            $table->uuid('stop_id');
            $table->uuid('route_id');
            $table->uuid('order_id');
            $table->uuid('zone_id');
            $table->string('mode', 40)->comment('valores en el prototipo: OWN, RENTED, THIRD_PARTY');
            $table->decimal('direct_cost', 18, 4);
            $table->decimal('vehicle_cost', 18, 4);
            $table->decimal('driver_cost', 18, 4);
            $table->decimal('carrier_cost', 18, 4);
            $table->decimal('other_cost', 18, 4);
            $table->decimal('total_cost', 18, 4);
            $table->decimal('kg_delivered', 14, 3);
            $table->decimal('fee_charged', 14, 2);
            $table->decimal('subsidy', 18, 4);
            $table->string('method', 20)->comment('valores en el prototipo: EQUAL');
            $table->timestampTz('run_at');
            $table->string('run_by', 20);
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });

        Schema::table('delivery_routes', function (Blueprint $table) { $table->foreign('establishment_id')->references('id')->on('establishments')->restrictOnDelete(); $table->index('establishment_id'); });
        Schema::table('delivery_routes', function (Blueprint $table) { $table->foreign('vehicle_id')->references('id')->on('vehicles')->restrictOnDelete(); $table->index('vehicle_id'); });
        Schema::table('delivery_routes', function (Blueprint $table) { $table->foreign('driver_user_id')->references('id')->on('users')->restrictOnDelete(); $table->index('driver_user_id'); });
        Schema::table('delivery_routes', function (Blueprint $table) { $table->foreign('driver_employee_id')->references('id')->on('employees')->restrictOnDelete(); $table->index('driver_employee_id'); });
        Schema::table('delivery_routes', function (Blueprint $table) { $table->foreign('carrier_supplier_id')->references('id')->on('suppliers')->restrictOnDelete(); $table->index('carrier_supplier_id'); });
        Schema::table('delivery_routes', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('delivery_stops', function (Blueprint $table) { $table->foreign('route_id')->references('id')->on('delivery_routes')->restrictOnDelete(); $table->index('route_id'); });
        Schema::table('delivery_stops', function (Blueprint $table) { $table->foreign('order_id')->references('id')->on('sales_orders')->restrictOnDelete(); $table->index('order_id'); });
        Schema::table('delivery_stops', function (Blueprint $table) { $table->foreign('zone_id')->references('id')->on('delivery_zones')->restrictOnDelete(); $table->index('zone_id'); });
        Schema::table('delivery_stops', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('delivery_events', function (Blueprint $table) { $table->foreign('route_id')->references('id')->on('delivery_routes')->restrictOnDelete(); $table->index('route_id'); });
        Schema::table('delivery_events', function (Blueprint $table) { $table->foreign('stop_id')->references('id')->on('delivery_stops')->restrictOnDelete(); $table->index('stop_id'); });
        Schema::table('delivery_events', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('tracking_links', function (Blueprint $table) { $table->foreign('order_id')->references('id')->on('sales_orders')->restrictOnDelete(); $table->index('order_id'); });
        Schema::table('tracking_links', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('carrier_rates', function (Blueprint $table) { $table->foreign('supplier_id')->references('id')->on('suppliers')->restrictOnDelete(); $table->index('supplier_id'); });
        Schema::table('carrier_rates', function (Blueprint $table) { $table->foreign('zone_id')->references('id')->on('delivery_zones')->restrictOnDelete(); $table->index('zone_id'); });
        Schema::table('carrier_rates', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('carrier_invoices', function (Blueprint $table) { $table->foreign('supplier_id')->references('id')->on('suppliers')->restrictOnDelete(); $table->index('supplier_id'); });
        Schema::table('carrier_invoices', function (Blueprint $table) { $table->foreign('reconciled_by')->references('id')->on('users')->restrictOnDelete(); $table->index('reconciled_by'); });
        Schema::table('carrier_invoices', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('carrier_invoice_lines', function (Blueprint $table) { $table->foreign('invoice_id')->references('id')->on('carrier_invoices')->restrictOnDelete(); $table->index('invoice_id'); });
        Schema::table('carrier_invoice_lines', function (Blueprint $table) { $table->foreign('stop_id')->references('id')->on('delivery_stops')->restrictOnDelete(); $table->index('stop_id'); });
        Schema::table('carrier_invoice_lines', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('province_shipments', function (Blueprint $table) { $table->foreign('order_id')->references('id')->on('sales_orders')->restrictOnDelete(); $table->index('order_id'); });
        Schema::table('province_shipments', function (Blueprint $table) { $table->foreign('agency_supplier_id')->references('id')->on('suppliers')->restrictOnDelete(); $table->index('agency_supplier_id'); });
        Schema::table('province_shipments', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('delivery_costs', function (Blueprint $table) { $table->foreign('vehicle_id')->references('id')->on('vehicles')->restrictOnDelete(); $table->index('vehicle_id'); });
        Schema::table('delivery_costs', function (Blueprint $table) { $table->foreign('route_id')->references('id')->on('delivery_routes')->restrictOnDelete(); $table->index('route_id'); });
        Schema::table('delivery_costs', function (Blueprint $table) { $table->foreign('employee_id')->references('id')->on('employees')->restrictOnDelete(); $table->index('employee_id'); });
        Schema::table('delivery_costs', function (Blueprint $table) { $table->foreign('supplier_id')->references('id')->on('suppliers')->restrictOnDelete(); $table->index('supplier_id'); });
        Schema::table('delivery_costs', function (Blueprint $table) { $table->foreign('zone_id')->references('id')->on('delivery_zones')->restrictOnDelete(); $table->index('zone_id'); });
        Schema::table('delivery_costs', function (Blueprint $table) { $table->foreign('employee_ref')->references('id')->on('employees')->restrictOnDelete(); $table->index('employee_ref'); });
        Schema::table('delivery_costs', function (Blueprint $table) { $table->foreign('order_id')->references('id')->on('sales_orders')->restrictOnDelete(); $table->index('order_id'); });
        Schema::table('delivery_costs', function (Blueprint $table) { $table->foreign('establishment_id')->references('id')->on('establishments')->restrictOnDelete(); $table->index('establishment_id'); });
        Schema::table('delivery_costs', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('delivery_cost_allocations', function (Blueprint $table) { $table->foreign('stop_id')->references('id')->on('delivery_stops')->restrictOnDelete(); $table->index('stop_id'); });
        Schema::table('delivery_cost_allocations', function (Blueprint $table) { $table->foreign('route_id')->references('id')->on('delivery_routes')->restrictOnDelete(); $table->index('route_id'); });
        Schema::table('delivery_cost_allocations', function (Blueprint $table) { $table->foreign('order_id')->references('id')->on('sales_orders')->restrictOnDelete(); $table->index('order_id'); });
        Schema::table('delivery_cost_allocations', function (Blueprint $table) { $table->foreign('zone_id')->references('id')->on('delivery_zones')->restrictOnDelete(); $table->index('zone_id'); });
        Schema::table('delivery_cost_allocations', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });

        DB::statement("SELECT enable_tenant_rls('delivery_routes')");
        DB::statement("SELECT enable_tenant_rls('delivery_stops')");
        DB::statement("SELECT enable_tenant_rls('delivery_events')");
        DB::statement('REVOKE UPDATE, DELETE, TRUNCATE ON delivery_events FROM aycha_app');  // solo inserción
        DB::statement("SELECT enable_tenant_rls('tracking_links')");
        DB::statement("SELECT enable_tenant_rls('carrier_rates')");
        DB::statement("SELECT enable_tenant_rls('carrier_invoices')");
        DB::statement("SELECT enable_tenant_rls('carrier_invoice_lines')");
        DB::statement("SELECT enable_tenant_rls('province_shipments')");
        DB::statement("SELECT enable_tenant_rls('delivery_costs')");
        DB::statement("SELECT enable_tenant_rls('delivery_cost_allocations')");
        DB::statement('REVOKE UPDATE, DELETE, TRUNCATE ON delivery_cost_allocations FROM aycha_app');  // solo inserción
    }

    public function down(): void
    {
        DB::statement('DROP TABLE IF EXISTS delivery_cost_allocations CASCADE');
        DB::statement('DROP TABLE IF EXISTS delivery_costs CASCADE');
        DB::statement('DROP TABLE IF EXISTS province_shipments CASCADE');
        DB::statement('DROP TABLE IF EXISTS carrier_invoice_lines CASCADE');
        DB::statement('DROP TABLE IF EXISTS carrier_invoices CASCADE');
        DB::statement('DROP TABLE IF EXISTS carrier_rates CASCADE');
        DB::statement('DROP TABLE IF EXISTS tracking_links CASCADE');
        DB::statement('DROP TABLE IF EXISTS delivery_events CASCADE');
        DB::statement('DROP TABLE IF EXISTS delivery_stops CASCADE');
        DB::statement('DROP TABLE IF EXISTS delivery_routes CASCADE');
    }
};
