<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// ALM · generada desde el modelo del prototipo (tools/prototipo/generar_migraciones.py).
// Tablas: warehouses, lots, stock_movements, stock_balances, waste_reasons, stock_receipts, stock_receipt_lines, lot_status_changes, stock_transfers, stock_transfer_lines, stock_counts, stock_count_lines, stock_waste_records, stock_reservations.
// El dueño del módulo revisa tipos, únicos y estados antes de construir sus pantallas;
// los cambios se hacen con migraciones nuevas, no editando esta.
return new class extends Migration
{
    public function up(): void
    {
        // ALM · warehouses
        Schema::create('warehouses', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('establishment_id')->nullable();
            $table->string('code', 40);
            $table->string('name', 80);
            $table->string('wh_type', 40)->comment('valores en el prototipo: COLD_ROOM, CONSIGNMENT, FREEZER, MAIN, PRODUCTION, QUARANTINE, RETURNS, STORE, TRANSIT, VEHICLE');
            $table->decimal('min_temp_c', 14, 2)->nullable();
            $table->decimal('max_temp_c', 14, 2)->nullable();
            $table->string('status', 20)->comment('valores en el prototipo: ACTIVE');
            $table->boolean('allows_sale')->default(false);
            $table->integer('pick_priority');
            $table->uuid('parent_id')->nullable();
            $table->uuid('vehicle_id')->nullable();
            $table->uuid('customer_id')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // ALM · lots
        Schema::create('lots', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('product_id');
            $table->uuid('variant_id');
            $table->string('code', 40);
            $table->string('origin', 40)->comment('valores en el prototipo: CUTTING, FARM, OPENING, PRODUCTION, PURCHASE, RETURN');
            $table->uuid('supplier_id')->nullable();
            $table->date('production_date')->nullable();
            $table->date('expiry_date');
            $table->string('qc_status', 40)->comment('valores en el prototipo: BLOCKED, QUARANTINE, RECALLED, REJECTED, RELEASED');
            $table->decimal('unit_cost', 18, 4);
            $table->timestampTz('released_at')->nullable();
            $table->string('released_by', 80)->nullable();
            $table->jsonb('parent_lots')->nullable();
            $table->jsonb('farm_origin')->nullable();
            $table->text('notes')->nullable();
            $table->decimal('received_weight_kg', 14, 3)->nullable();
            $table->string('farm_lot_code', 40)->nullable();
            $table->string('block_reason', 255)->nullable();
            $table->uuid('parent_lot_id')->nullable();
            $table->string('cost_basis', 20)->nullable()->comment('valores en el prototipo: KG, UNIT');
            $table->string('supplier_lot_code', 40)->nullable();
            $table->string('requested_qc_status', 20)->nullable()->comment('valores en el prototipo: RELEASED');
            $table->boolean('ccp_deviation')->nullable();
            $table->string('production_order_ref', 40)->nullable();
            $table->uuid('supervisor_user_id')->nullable();
            $table->uuid('created_by_user_id')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // ALM · stock_movements
        Schema::create('stock_movements', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('warehouse_id');
            $table->uuid('variant_id');
            $table->uuid('lot_id')->nullable();
            $table->string('movement_type', 40)->comment('valores en el prototipo: ADJUSTMENT, CONSIGNMENT_OUT, CONSIGNMENT_RETURN, PRODUCTION_IN, PRODUCTION_OUT, RECEIPT, RETURN, SALE, TRANSFER_IN, TRANSFER_OUT, WASTE');
            $table->decimal('qty', 14, 3);
            $table->decimal('weight_kg', 14, 3)->nullable();
            $table->decimal('unit_cost', 18, 4);
            $table->decimal('total_cost', 14, 2);
            $table->string('source_type', 40);
            $table->uuid('source_id')->nullable()->comment('referencia polimórfica: consignment_deliveries, consignment_visits, data_imports, lots, production_orders, purchase_receipts, sales_documents, sales_orders, stock_counts, stock_transfers, stock_waste_records');
            $table->timestampTz('moved_at');
            $table->string('reason', 255);
            $table->string('user', 40);
            $table->decimal('bal_qty', 14, 3);
            $table->string('reversal_of', 20)->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // ALM · stock_balances
        Schema::create('stock_balances', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('warehouse_id');
            $table->uuid('variant_id');
            $table->uuid('lot_id')->nullable();
            $table->decimal('qty', 14, 3);
            $table->decimal('weight_kg', 14, 3);
            $table->decimal('reserved_qty', 14, 3);
            $table->decimal('avg_cost', 18, 4);
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // ALM · waste_reasons
        Schema::create('waste_reasons', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->string('code', 20)->comment('valores en el prototipo: CORT, DANO, DESH, DEVO, FRIO, MUES, TRAN, VENC');
            $table->string('name', 80);
            $table->boolean('requires_photo')->default(false);
            $table->integer('approval_above_pen');
            $table->boolean('counts_as_expired')->default(false);
            $table->string('status', 20)->comment('valores en el prototipo: ACTIVE');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // ALM · stock_receipts
        Schema::create('stock_receipts', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->string('number', 20);
            $table->uuid('warehouse_id');
            $table->uuid('establishment_id');
            $table->string('source_type', 20)->comment('valores en el prototipo: FARM, PURCHASE');
            $table->uuid('supplier_id');
            $table->string('supplier_doc', 40);
            $table->timestampTz('received_at');
            $table->decimal('vehicle_temp_c', 14, 2)->nullable();
            $table->string('status', 40)->comment('valores en el prototipo: CONFIRMED, DRAFT');
            $table->uuid('received_by');
            $table->timestampTz('confirmed_at')->nullable();
            $table->uuid('confirmed_by')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // ALM · stock_receipt_lines
        Schema::create('stock_receipt_lines', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('receipt_id');
            $table->uuid('lot_id')->nullable();
            $table->decimal('weight_kg', 14, 3)->nullable();
            $table->decimal('unit_cost', 14, 2);
            $table->date('expiry_date')->nullable();
            $table->decimal('product_temp_c', 14, 2)->nullable();
            $table->string('appearance', 20)->comment('valores en el prototipo: OBSERVED, OK');
            $table->string('qc_result', 20)->comment('valores en el prototipo: FAIL, PASS, PENDING');
            $table->text('qc_notes')->nullable();
            $table->uuid('variant_id');
            $table->decimal('qty', 14, 3);
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // ALM · lot_status_changes
        Schema::create('lot_status_changes', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('lot_id');
            $table->string('from_status', 40)->comment('valores en el prototipo: NEW, QUARANTINE, RELEASED');
            $table->string('to_status', 40)->comment('valores en el prototipo: BLOCKED, QUARANTINE, RELEASED');
            $table->string('reason', 255);
            $table->timestampTz('changed_at');
            $table->uuid('changed_by');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // ALM · stock_transfers
        Schema::create('stock_transfers', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->string('number', 20);
            $table->uuid('from_warehouse_id');
            $table->uuid('to_warehouse_id');
            $table->uuid('from_site');
            $table->uuid('to_site');
            $table->uuid('establishment_id');
            $table->string('status', 40)->comment('valores en el prototipo: DISPATCHED, DRAFT, RECEIVED');
            $table->boolean('requires_guide')->default(false);
            $table->string('guide_number', 40)->nullable();
            $table->text('notes');
            $table->uuid('requested_by');
            $table->timestampTz('requested_at');
            $table->string('guide_series', 20)->nullable()->comment('valores en el prototipo: T001');
            $table->string('guide_reason_code', 20)->nullable()->comment('valores en el prototipo: 04');
            $table->timestampTz('guide_issued_at')->nullable();
            $table->timestampTz('dispatched_at')->nullable();
            $table->uuid('dispatched_by')->nullable();
            $table->timestampTz('received_at')->nullable();
            $table->uuid('received_by')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // ALM · stock_transfer_lines
        Schema::create('stock_transfer_lines', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('transfer_id');
            $table->uuid('variant_id');
            $table->string('lot_id', 20)->nullable();
            $table->decimal('qty', 14, 3);
            $table->decimal('weight_kg', 14, 3)->nullable();
            $table->decimal('received_qty', 14, 3)->nullable();
            $table->decimal('received_weight_kg', 14, 3)->nullable();
            $table->string('difference_reason', 20)->nullable();
            $table->jsonb('moved');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // ALM · stock_counts
        Schema::create('stock_counts', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->string('number', 20);
            $table->uuid('warehouse_id');
            $table->uuid('establishment_id');
            $table->string('count_type', 20)->comment('valores en el prototipo: CYCLE, SPOT');
            $table->string('status', 20)->comment('valores en el prototipo: APPROVED, COUNTED, OPEN');
            $table->boolean('blind')->default(false);
            $table->timestampTz('counted_at')->nullable();
            $table->uuid('counted_by')->nullable();
            $table->uuid('approved_by')->nullable();
            $table->timestampTz('approved_at')->nullable();
            $table->uuid('created_by');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // ALM · stock_count_lines
        Schema::create('stock_count_lines', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('count_id');
            $table->uuid('variant_id');
            $table->uuid('lot_id');
            $table->decimal('system_qty', 14, 3);
            $table->decimal('counted_qty', 14, 3)->nullable();
            $table->decimal('system_weight_kg', 14, 3)->nullable();
            $table->string('counted_weight_kg', 20)->nullable();
            $table->uuid('counted_by');
            $table->decimal('diff_qty', 14, 3)->nullable();
            $table->uuid('adjust_move_id')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // ALM · stock_waste_records
        Schema::create('stock_waste_records', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->string('number', 20);
            $table->uuid('warehouse_id');
            $table->uuid('establishment_id');
            $table->uuid('variant_id');
            $table->uuid('lot_id');
            $table->uuid('reason_id');
            $table->decimal('qty', 14, 3);
            $table->decimal('weight_kg', 14, 3)->nullable();
            $table->decimal('estimated_cost', 14, 2);
            $table->string('photo_url', 40)->nullable();
            $table->text('notes');
            $table->string('status', 20)->comment('valores en el prototipo: APPROVED, PENDING, REJECTED');
            $table->uuid('approved_by')->nullable();
            $table->timestampTz('approved_at')->nullable();
            $table->uuid('requested_by');
            $table->timestampTz('requested_at');
            $table->decimal('actual_cost', 14, 2)->nullable();
            $table->uuid('move_id')->nullable();
            $table->string('reject_reason', 255)->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // ALM · stock_reservations
        Schema::create('stock_reservations', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('order_id');
            $table->string('order_number', 20);
            $table->string('order_line_id', 40);
            $table->uuid('balance_id');
            $table->uuid('warehouse_id');
            $table->uuid('variant_id');
            $table->uuid('lot_id');
            $table->decimal('qty', 14, 3);
            $table->decimal('weight_kg', 14, 3)->nullable();
            $table->string('status', 20)->comment('valores en el prototipo: ACTIVE, CONSUMED');
            $table->string('released_reason', 40)->nullable();
            $table->uuid('brand_id');
            $table->uuid('establishment_id');
            $table->date('delivery_date');
            $table->timestampTz('reserved_at');
            $table->timestampTz('closed_at')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });

        Schema::table('warehouses', function (Blueprint $table) { $table->foreign('establishment_id')->references('id')->on('establishments')->restrictOnDelete(); $table->index('establishment_id'); });
        Schema::table('warehouses', function (Blueprint $table) { $table->foreign('parent_id')->references('id')->on('warehouses')->restrictOnDelete(); $table->index('parent_id'); });
        Schema::table('warehouses', function (Blueprint $table) { $table->foreign('vehicle_id')->references('id')->on('vehicles')->restrictOnDelete(); $table->index('vehicle_id'); });
        Schema::table('warehouses', function (Blueprint $table) { $table->foreign('customer_id')->references('id')->on('customers')->restrictOnDelete(); $table->index('customer_id'); });
        Schema::table('warehouses', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('lots', function (Blueprint $table) { $table->foreign('product_id')->references('id')->on('products')->restrictOnDelete(); $table->index('product_id'); });
        Schema::table('lots', function (Blueprint $table) { $table->foreign('variant_id')->references('id')->on('product_variants')->restrictOnDelete(); $table->index('variant_id'); });
        Schema::table('lots', function (Blueprint $table) { $table->foreign('supplier_id')->references('id')->on('suppliers')->restrictOnDelete(); $table->index('supplier_id'); });
        Schema::table('lots', function (Blueprint $table) { $table->foreign('parent_lot_id')->references('id')->on('lots')->restrictOnDelete(); $table->index('parent_lot_id'); });
        Schema::table('lots', function (Blueprint $table) { $table->foreign('supervisor_user_id')->references('id')->on('users')->restrictOnDelete(); $table->index('supervisor_user_id'); });
        Schema::table('lots', function (Blueprint $table) { $table->foreign('created_by_user_id')->references('id')->on('users')->restrictOnDelete(); $table->index('created_by_user_id'); });
        Schema::table('lots', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('stock_movements', function (Blueprint $table) { $table->foreign('warehouse_id')->references('id')->on('warehouses')->restrictOnDelete(); $table->index('warehouse_id'); });
        Schema::table('stock_movements', function (Blueprint $table) { $table->foreign('variant_id')->references('id')->on('product_variants')->restrictOnDelete(); $table->index('variant_id'); });
        Schema::table('stock_movements', function (Blueprint $table) { $table->foreign('lot_id')->references('id')->on('lots')->restrictOnDelete(); $table->index('lot_id'); });
        Schema::table('stock_movements', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('stock_balances', function (Blueprint $table) { $table->foreign('warehouse_id')->references('id')->on('warehouses')->restrictOnDelete(); $table->index('warehouse_id'); });
        Schema::table('stock_balances', function (Blueprint $table) { $table->foreign('variant_id')->references('id')->on('product_variants')->restrictOnDelete(); $table->index('variant_id'); });
        Schema::table('stock_balances', function (Blueprint $table) { $table->foreign('lot_id')->references('id')->on('lots')->restrictOnDelete(); $table->index('lot_id'); });
        Schema::table('stock_balances', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('waste_reasons', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('stock_receipts', function (Blueprint $table) { $table->foreign('warehouse_id')->references('id')->on('warehouses')->restrictOnDelete(); $table->index('warehouse_id'); });
        Schema::table('stock_receipts', function (Blueprint $table) { $table->foreign('establishment_id')->references('id')->on('establishments')->restrictOnDelete(); $table->index('establishment_id'); });
        Schema::table('stock_receipts', function (Blueprint $table) { $table->foreign('supplier_id')->references('id')->on('suppliers')->restrictOnDelete(); $table->index('supplier_id'); });
        Schema::table('stock_receipts', function (Blueprint $table) { $table->foreign('received_by')->references('id')->on('users')->restrictOnDelete(); $table->index('received_by'); });
        Schema::table('stock_receipts', function (Blueprint $table) { $table->foreign('confirmed_by')->references('id')->on('users')->restrictOnDelete(); $table->index('confirmed_by'); });
        Schema::table('stock_receipts', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('stock_receipt_lines', function (Blueprint $table) { $table->foreign('receipt_id')->references('id')->on('stock_receipts')->restrictOnDelete(); $table->index('receipt_id'); });
        Schema::table('stock_receipt_lines', function (Blueprint $table) { $table->foreign('lot_id')->references('id')->on('lots')->restrictOnDelete(); $table->index('lot_id'); });
        Schema::table('stock_receipt_lines', function (Blueprint $table) { $table->foreign('variant_id')->references('id')->on('product_variants')->restrictOnDelete(); $table->index('variant_id'); });
        Schema::table('stock_receipt_lines', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('lot_status_changes', function (Blueprint $table) { $table->foreign('lot_id')->references('id')->on('lots')->restrictOnDelete(); $table->index('lot_id'); });
        Schema::table('lot_status_changes', function (Blueprint $table) { $table->foreign('changed_by')->references('id')->on('users')->restrictOnDelete(); $table->index('changed_by'); });
        Schema::table('lot_status_changes', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('stock_transfers', function (Blueprint $table) { $table->foreign('from_warehouse_id')->references('id')->on('warehouses')->restrictOnDelete(); $table->index('from_warehouse_id'); });
        Schema::table('stock_transfers', function (Blueprint $table) { $table->foreign('to_warehouse_id')->references('id')->on('warehouses')->restrictOnDelete(); $table->index('to_warehouse_id'); });
        Schema::table('stock_transfers', function (Blueprint $table) { $table->foreign('from_site')->references('id')->on('establishments')->restrictOnDelete(); $table->index('from_site'); });
        Schema::table('stock_transfers', function (Blueprint $table) { $table->foreign('to_site')->references('id')->on('establishments')->restrictOnDelete(); $table->index('to_site'); });
        Schema::table('stock_transfers', function (Blueprint $table) { $table->foreign('establishment_id')->references('id')->on('establishments')->restrictOnDelete(); $table->index('establishment_id'); });
        Schema::table('stock_transfers', function (Blueprint $table) { $table->foreign('requested_by')->references('id')->on('users')->restrictOnDelete(); $table->index('requested_by'); });
        Schema::table('stock_transfers', function (Blueprint $table) { $table->foreign('dispatched_by')->references('id')->on('users')->restrictOnDelete(); $table->index('dispatched_by'); });
        Schema::table('stock_transfers', function (Blueprint $table) { $table->foreign('received_by')->references('id')->on('users')->restrictOnDelete(); $table->index('received_by'); });
        Schema::table('stock_transfers', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('stock_transfer_lines', function (Blueprint $table) { $table->foreign('transfer_id')->references('id')->on('stock_transfers')->restrictOnDelete(); $table->index('transfer_id'); });
        Schema::table('stock_transfer_lines', function (Blueprint $table) { $table->foreign('variant_id')->references('id')->on('product_variants')->restrictOnDelete(); $table->index('variant_id'); });
        Schema::table('stock_transfer_lines', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('stock_counts', function (Blueprint $table) { $table->foreign('warehouse_id')->references('id')->on('warehouses')->restrictOnDelete(); $table->index('warehouse_id'); });
        Schema::table('stock_counts', function (Blueprint $table) { $table->foreign('establishment_id')->references('id')->on('establishments')->restrictOnDelete(); $table->index('establishment_id'); });
        Schema::table('stock_counts', function (Blueprint $table) { $table->foreign('counted_by')->references('id')->on('users')->restrictOnDelete(); $table->index('counted_by'); });
        Schema::table('stock_counts', function (Blueprint $table) { $table->foreign('approved_by')->references('id')->on('users')->restrictOnDelete(); $table->index('approved_by'); });
        Schema::table('stock_counts', function (Blueprint $table) { $table->foreign('created_by')->references('id')->on('users')->restrictOnDelete(); $table->index('created_by'); });
        Schema::table('stock_counts', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('stock_count_lines', function (Blueprint $table) { $table->foreign('count_id')->references('id')->on('stock_counts')->restrictOnDelete(); $table->index('count_id'); });
        Schema::table('stock_count_lines', function (Blueprint $table) { $table->foreign('variant_id')->references('id')->on('product_variants')->restrictOnDelete(); $table->index('variant_id'); });
        Schema::table('stock_count_lines', function (Blueprint $table) { $table->foreign('lot_id')->references('id')->on('lots')->restrictOnDelete(); $table->index('lot_id'); });
        Schema::table('stock_count_lines', function (Blueprint $table) { $table->foreign('counted_by')->references('id')->on('users')->restrictOnDelete(); $table->index('counted_by'); });
        Schema::table('stock_count_lines', function (Blueprint $table) { $table->foreign('adjust_move_id')->references('id')->on('stock_movements')->restrictOnDelete(); $table->index('adjust_move_id'); });
        Schema::table('stock_count_lines', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('stock_waste_records', function (Blueprint $table) { $table->foreign('warehouse_id')->references('id')->on('warehouses')->restrictOnDelete(); $table->index('warehouse_id'); });
        Schema::table('stock_waste_records', function (Blueprint $table) { $table->foreign('establishment_id')->references('id')->on('establishments')->restrictOnDelete(); $table->index('establishment_id'); });
        Schema::table('stock_waste_records', function (Blueprint $table) { $table->foreign('variant_id')->references('id')->on('product_variants')->restrictOnDelete(); $table->index('variant_id'); });
        Schema::table('stock_waste_records', function (Blueprint $table) { $table->foreign('lot_id')->references('id')->on('lots')->restrictOnDelete(); $table->index('lot_id'); });
        Schema::table('stock_waste_records', function (Blueprint $table) { $table->foreign('reason_id')->references('id')->on('waste_reasons')->restrictOnDelete(); $table->index('reason_id'); });
        Schema::table('stock_waste_records', function (Blueprint $table) { $table->foreign('approved_by')->references('id')->on('users')->restrictOnDelete(); $table->index('approved_by'); });
        Schema::table('stock_waste_records', function (Blueprint $table) { $table->foreign('requested_by')->references('id')->on('users')->restrictOnDelete(); $table->index('requested_by'); });
        Schema::table('stock_waste_records', function (Blueprint $table) { $table->foreign('move_id')->references('id')->on('stock_movements')->restrictOnDelete(); $table->index('move_id'); });
        Schema::table('stock_waste_records', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('stock_reservations', function (Blueprint $table) { $table->foreign('order_id')->references('id')->on('sales_orders')->restrictOnDelete(); $table->index('order_id'); });
        Schema::table('stock_reservations', function (Blueprint $table) { $table->foreign('balance_id')->references('id')->on('stock_balances')->restrictOnDelete(); $table->index('balance_id'); });
        Schema::table('stock_reservations', function (Blueprint $table) { $table->foreign('warehouse_id')->references('id')->on('warehouses')->restrictOnDelete(); $table->index('warehouse_id'); });
        Schema::table('stock_reservations', function (Blueprint $table) { $table->foreign('variant_id')->references('id')->on('product_variants')->restrictOnDelete(); $table->index('variant_id'); });
        Schema::table('stock_reservations', function (Blueprint $table) { $table->foreign('lot_id')->references('id')->on('lots')->restrictOnDelete(); $table->index('lot_id'); });
        Schema::table('stock_reservations', function (Blueprint $table) { $table->foreign('brand_id')->references('id')->on('brands')->restrictOnDelete(); $table->index('brand_id'); });
        Schema::table('stock_reservations', function (Blueprint $table) { $table->foreign('establishment_id')->references('id')->on('establishments')->restrictOnDelete(); $table->index('establishment_id'); });
        Schema::table('stock_reservations', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });

        Schema::table('warehouses', fn (Blueprint $table) => $table->unique(['tenant_id', 'code']));
        DB::statement("SELECT enable_tenant_rls('warehouses')");
        DB::statement("SELECT enable_tenant_rls('lots')");
        DB::statement("SELECT enable_tenant_rls('stock_movements')");
        DB::statement("SELECT enable_tenant_rls('stock_balances')");
        DB::statement("SELECT enable_tenant_rls('waste_reasons')");
        DB::statement("SELECT enable_tenant_rls('stock_receipts')");
        DB::statement("SELECT enable_tenant_rls('stock_receipt_lines')");
        DB::statement("SELECT enable_tenant_rls('lot_status_changes')");
        DB::statement('REVOKE UPDATE, DELETE, TRUNCATE ON lot_status_changes FROM aycha_app');  // solo inserción
        DB::statement("SELECT enable_tenant_rls('stock_transfers')");
        DB::statement("SELECT enable_tenant_rls('stock_transfer_lines')");
        DB::statement("SELECT enable_tenant_rls('stock_counts')");
        DB::statement("SELECT enable_tenant_rls('stock_count_lines')");
        DB::statement("SELECT enable_tenant_rls('stock_waste_records')");
        DB::statement("SELECT enable_tenant_rls('stock_reservations')");
    }

    public function down(): void
    {
        DB::statement('DROP TABLE IF EXISTS stock_reservations CASCADE');
        DB::statement('DROP TABLE IF EXISTS stock_waste_records CASCADE');
        DB::statement('DROP TABLE IF EXISTS stock_count_lines CASCADE');
        DB::statement('DROP TABLE IF EXISTS stock_counts CASCADE');
        DB::statement('DROP TABLE IF EXISTS stock_transfer_lines CASCADE');
        DB::statement('DROP TABLE IF EXISTS stock_transfers CASCADE');
        DB::statement('DROP TABLE IF EXISTS lot_status_changes CASCADE');
        DB::statement('DROP TABLE IF EXISTS stock_receipt_lines CASCADE');
        DB::statement('DROP TABLE IF EXISTS stock_receipts CASCADE');
        DB::statement('DROP TABLE IF EXISTS waste_reasons CASCADE');
        DB::statement('DROP TABLE IF EXISTS stock_balances CASCADE');
        DB::statement('DROP TABLE IF EXISTS stock_movements CASCADE');
        DB::statement('DROP TABLE IF EXISTS lots CASCADE');
        DB::statement('DROP TABLE IF EXISTS warehouses CASCADE');
    }
};
