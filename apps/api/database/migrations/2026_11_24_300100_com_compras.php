<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// COM · generada desde el modelo del prototipo (tools/prototipo/generar_migraciones.py).
// Tablas: purchase_requisitions, supplier_catalog, purchase_orders, purchase_order_lines, purchase_receipts, purchase_receipt_lines, purchase_documents, purchase_document_lines, supplier_payments, supplier_payment_allocations.
// El dueño del módulo revisa tipos, únicos y estados antes de construir sus pantallas;
// los cambios se hacen con migraciones nuevas, no editando esta.
return new class extends Migration
{
    public function up(): void
    {
        // COM · purchase_requisitions (COM-03; el prototipo la usa aunque tablas.md no la lista)
        Schema::create('purchase_requisitions', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->string('number', 255);
            $table->string('source', 255)->comment('PRO-03, ALM o MANUAL');
            $table->string('source_ref', 255)->nullable();
            $table->uuid('warehouse_id');
            $table->uuid('establishment_id');
            $table->uuid('variant_id');
            $table->decimal('qty', 14, 3);
            $table->date('needed_date');
            $table->string('status', 255)->comment('PENDING, ORDERED, CANCELLED');
            $table->uuid('requested_by')->nullable();
            $table->timestampTz('requested_at');
            $table->uuid('po_id')->nullable();
            $table->text('notes')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // COM · supplier_catalog
        Schema::create('supplier_catalog', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('supplier_id');
            $table->uuid('variant_id');
            $table->string('supplier_sku', 255)->nullable();
            $table->uuid('purchase_uom_id');
            $table->string('price_basis', 255)->comment('valores en el prototipo: KG, UNIT');
            $table->decimal('last_price', 18, 6);
            $table->decimal('min_order_qty', 14, 3)->nullable();
            $table->integer('lead_time_days');
            $table->string('status', 255)->comment('valores en el prototipo: ACTIVE');
            $table->jsonb('price_history')->default('[]');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // COM · purchase_orders
        Schema::create('purchase_orders', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->string('number', 255);
            $table->uuid('company_id');
            $table->uuid('establishment_id');
            $table->uuid('supplier_id');
            $table->uuid('warehouse_id');
            $table->uuid('brand_id')->nullable();
            $table->date('order_date');
            $table->date('expected_date');
            $table->string('currency', 255)->comment('valores en el prototipo: PEN');
            $table->decimal('subtotal', 14, 2);
            $table->decimal('igv', 14, 2);
            $table->decimal('total', 14, 2);
            $table->string('status', 255)->comment('valores en el prototipo: APPROVED, DRAFT, PARTIALLY_RECEIVED, PENDING_APPROVAL, RECEIVED');
            $table->uuid('approved_by')->nullable();
            $table->timestampTz('approved_at')->nullable();
            $table->string('void_reason', 255)->nullable();
            $table->text('notes')->nullable();
            $table->uuid('created_by');
            $table->boolean('no_igv')->default(false);
            $table->jsonb('history')->default('[]');
            $table->boolean('auto_approved')->nullable();
            $table->timestampTz('submitted_at')->nullable();
            $table->timestampTz('last_receipt_at')->nullable();
            $table->timestampTz('received_complete_at')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // COM · purchase_order_lines
        Schema::create('purchase_order_lines', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('po_id');
            $table->decimal('subtotal', 14, 2);
            $table->decimal('received_qty', 14, 3)->default(0);
            $table->decimal('received_weight_kg', 14, 3)->default(0);
            $table->uuid('variant_id');
            $table->decimal('qty', 14, 3);
            $table->string('price_basis', 255)->comment('valores en el prototipo: KG, UNIT');
            $table->decimal('est_weight_kg', 14, 3)->nullable();
            $table->decimal('unit_price', 18, 6);
            $table->string('igv_affectation', 255)->comment('valores en el prototipo: 10');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // COM · purchase_receipts
        Schema::create('purchase_receipts', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->string('number', 255);
            $table->uuid('company_id');
            $table->uuid('establishment_id');
            $table->uuid('warehouse_id');
            $table->uuid('supplier_id');
            $table->uuid('po_id')->nullable();
            $table->string('receipt_type', 255)->comment('valores en el prototipo: FARM_NTI, PURCHASE');
            $table->timestampTz('received_at');
            $table->uuid('received_by');
            $table->decimal('vehicle_temp_c', 14, 2)->nullable();
            $table->string('carrier_guide', 255)->nullable();
            $table->uuid('scale_equipment_id')->nullable();
            $table->uuid('inspection_id')->nullable();
            $table->string('inspection_result', 255)->comment('valores en el prototipo: OK, PENDING');
            $table->string('status', 255)->comment('valores en el prototipo: POSTED');
            $table->string('void_reason', 255)->nullable();
            $table->boolean('historical')->default(false);
            $table->decimal('total_cost', 14, 2);
            $table->uuid('document_id')->nullable();
            $table->uuid('farm_dispatch_id')->nullable();
            $table->text('notes')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // COM · purchase_receipt_lines
        Schema::create('purchase_receipt_lines', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('receipt_id');
            $table->uuid('po_line_id')->nullable();
            $table->uuid('variant_id');
            $table->uuid('lot_id')->nullable();
            $table->string('supplier_lot_code', 255)->nullable();
            $table->date('expiry_date')->nullable();
            $table->decimal('qty', 14, 3);
            $table->decimal('weight_kg', 14, 3)->nullable();
            $table->decimal('temp_c', 6, 2)->nullable();
            $table->decimal('unit_cost', 18, 6);
            $table->string('price_basis', 255)->comment('valores en el prototipo: KG, UNIT');
            $table->decimal('total_cost', 14, 2);
            $table->boolean('accepted')->default(false);
            $table->boolean('quality_hold')->default(false);
            $table->string('rejection_reason', 255)->nullable();
            $table->string('over_receipt_reason', 255)->nullable();
            $table->decimal('over_pct', 9, 4)->default(0);
            $table->uuid('stock_movement_id')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // COM · purchase_documents
        Schema::create('purchase_documents', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('company_id');
            $table->uuid('supplier_id');
            $table->uuid('establishment_id');
            $table->uuid('brand_id')->nullable();
            $table->uuid('cost_center_id');
            $table->string('doc_type', 255)->comment('valores en el prototipo: FEE_RECEIPT, INTERNAL_TRANSFER, INVOICE, OTHER');
            $table->string('sunat_doc_type', 255)->comment('valores en el prototipo: 00, 01, 02, 91');
            $table->string('series', 255)->comment('valores en el prototipo: E001, F001, F002, F003, F004, FBADS, GADS, NI01');
            $table->string('number', 255);
            $table->date('issue_date');
            $table->date('due_date')->nullable();
            $table->date('accounting_date');
            $table->string('currency', 255)->comment('valores en el prototipo: PEN, USD');
            $table->decimal('exchange_rate', 9, 4);
            $table->decimal('base_taxed', 14, 2);
            $table->decimal('igv', 14, 2);
            $table->decimal('non_taxed', 14, 2);
            $table->decimal('other_charges', 14, 2)->default(0);
            $table->decimal('total', 14, 2);
            $table->boolean('igv_is_credit')->default(false);
            $table->uuid('po_id')->nullable();
            $table->uuid('receipt_id')->nullable();
            $table->uuid('related_document_id')->nullable();
            $table->string('file_pdf_url', 255)->nullable();
            $table->string('file_xml_url', 255)->nullable();
            $table->string('match_status', 255)->comment('valores en el prototipo: MATCHED, NOT_CHECKED, OBSERVED');
            $table->string('status', 255)->comment('valores en el prototipo: OBSERVED, REGISTERED');
            $table->string('void_reason', 255)->nullable();
            $table->decimal('paid_amount', 14, 2);
            $table->decimal('balance', 14, 2);
            $table->uuid('registered_by');
            $table->timestampTz('registered_at');
            $table->uuid('farm_dispatch_id')->nullable();
            $table->text('notes')->nullable();
            $table->date('scheduled_pay_date')->nullable();
            $table->text('description')->nullable();
            $table->jsonb('match_detail')->nullable();
            $table->text('match_note')->nullable();
            $table->uuid('match_approved_by')->nullable();
            $table->timestampTz('match_approved_at')->nullable();
            $table->jsonb('cost_adjustments')->nullable();
            $table->timestampTz('last_paid_at')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // COM · purchase_document_lines
        Schema::create('purchase_document_lines', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('document_id');
            $table->uuid('receipt_line_id')->nullable();
            $table->uuid('variant_id')->nullable();
            $table->text('description');
            $table->decimal('qty', 14, 3);
            $table->decimal('unit_price', 18, 6);
            $table->decimal('subtotal', 14, 2);
            $table->decimal('igv', 14, 2);
            $table->decimal('total', 14, 2);
            $table->decimal('non_taxed', 14, 2);
            $table->uuid('cost_center_id');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // COM · supplier_payments
        Schema::create('supplier_payments', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->string('number', 255);
            $table->uuid('company_id');
            $table->uuid('supplier_id');
            $table->uuid('cash_account_id');
            $table->timestampTz('paid_at');
            $table->decimal('amount', 14, 2);
            $table->string('method', 255)->comment('valores en el prototipo: OTHER, TRANSFER');
            $table->string('reference', 255)->nullable();
            $table->string('paid_to_account', 255)->nullable();
            $table->string('status', 255)->comment('valores en el prototipo: CONFIRMED');
            $table->boolean('is_detraction')->default(false);
            $table->uuid('registered_by');
            $table->string('currency', 255)->comment('valores en el prototipo: PEN');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // COM · supplier_payment_allocations
        Schema::create('supplier_payment_allocations', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('payment_id');
            $table->uuid('document_id');
            $table->decimal('amount', 14, 2);
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });

        Schema::table('purchase_requisitions', function (Blueprint $table) { $table->foreign('warehouse_id')->references('id')->on('warehouses')->restrictOnDelete(); $table->index('warehouse_id'); });
        Schema::table('purchase_requisitions', function (Blueprint $table) { $table->foreign('establishment_id')->references('id')->on('establishments')->restrictOnDelete(); $table->index('establishment_id'); });
        Schema::table('purchase_requisitions', function (Blueprint $table) { $table->foreign('variant_id')->references('id')->on('product_variants')->restrictOnDelete(); $table->index('variant_id'); });
        Schema::table('purchase_requisitions', function (Blueprint $table) { $table->foreign('requested_by')->references('id')->on('users')->restrictOnDelete(); $table->index('requested_by'); });
        Schema::table('purchase_requisitions', function (Blueprint $table) { $table->foreign('po_id')->references('id')->on('purchase_orders')->restrictOnDelete(); $table->index('po_id'); });
        Schema::table('purchase_requisitions', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('purchase_documents', function (Blueprint $table) { $table->foreign('related_document_id')->references('id')->on('purchase_documents')->restrictOnDelete(); $table->index('related_document_id'); });
        Schema::table('purchase_documents', function (Blueprint $table) { $table->foreign('match_approved_by')->references('id')->on('users')->restrictOnDelete(); });
        Schema::table('purchase_receipts', function (Blueprint $table) { $table->foreign('scale_equipment_id')->references('id')->on('equipment')->restrictOnDelete(); $table->index('scale_equipment_id'); });
        Schema::table('supplier_catalog', function (Blueprint $table) { $table->foreign('supplier_id')->references('id')->on('suppliers')->restrictOnDelete(); $table->index('supplier_id'); });
        Schema::table('supplier_catalog', function (Blueprint $table) { $table->foreign('variant_id')->references('id')->on('product_variants')->restrictOnDelete(); $table->index('variant_id'); });
        Schema::table('supplier_catalog', function (Blueprint $table) { $table->foreign('purchase_uom_id')->references('id')->on('units_of_measure')->restrictOnDelete(); $table->index('purchase_uom_id'); });
        Schema::table('supplier_catalog', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('purchase_orders', function (Blueprint $table) { $table->foreign('company_id')->references('id')->on('companies')->restrictOnDelete(); $table->index('company_id'); });
        Schema::table('purchase_orders', function (Blueprint $table) { $table->foreign('establishment_id')->references('id')->on('establishments')->restrictOnDelete(); $table->index('establishment_id'); });
        Schema::table('purchase_orders', function (Blueprint $table) { $table->foreign('supplier_id')->references('id')->on('suppliers')->restrictOnDelete(); $table->index('supplier_id'); });
        Schema::table('purchase_orders', function (Blueprint $table) { $table->foreign('warehouse_id')->references('id')->on('warehouses')->restrictOnDelete(); $table->index('warehouse_id'); });
        Schema::table('purchase_orders', function (Blueprint $table) { $table->foreign('brand_id')->references('id')->on('brands')->restrictOnDelete(); $table->index('brand_id'); });
        Schema::table('purchase_orders', function (Blueprint $table) { $table->foreign('approved_by')->references('id')->on('users')->restrictOnDelete(); $table->index('approved_by'); });
        Schema::table('purchase_orders', function (Blueprint $table) { $table->foreign('created_by')->references('id')->on('users')->restrictOnDelete(); $table->index('created_by'); });
        Schema::table('purchase_orders', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('purchase_order_lines', function (Blueprint $table) { $table->foreign('po_id')->references('id')->on('purchase_orders')->restrictOnDelete(); $table->index('po_id'); });
        Schema::table('purchase_order_lines', function (Blueprint $table) { $table->foreign('variant_id')->references('id')->on('product_variants')->restrictOnDelete(); $table->index('variant_id'); });
        Schema::table('purchase_order_lines', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('purchase_receipts', function (Blueprint $table) { $table->foreign('company_id')->references('id')->on('companies')->restrictOnDelete(); $table->index('company_id'); });
        Schema::table('purchase_receipts', function (Blueprint $table) { $table->foreign('establishment_id')->references('id')->on('establishments')->restrictOnDelete(); $table->index('establishment_id'); });
        Schema::table('purchase_receipts', function (Blueprint $table) { $table->foreign('warehouse_id')->references('id')->on('warehouses')->restrictOnDelete(); $table->index('warehouse_id'); });
        Schema::table('purchase_receipts', function (Blueprint $table) { $table->foreign('supplier_id')->references('id')->on('suppliers')->restrictOnDelete(); $table->index('supplier_id'); });
        Schema::table('purchase_receipts', function (Blueprint $table) { $table->foreign('po_id')->references('id')->on('purchase_orders')->restrictOnDelete(); $table->index('po_id'); });
        Schema::table('purchase_receipts', function (Blueprint $table) { $table->foreign('received_by')->references('id')->on('users')->restrictOnDelete(); $table->index('received_by'); });
        Schema::table('purchase_receipts', function (Blueprint $table) { $table->foreign('inspection_id')->references('id')->on('qc_inspections')->restrictOnDelete(); $table->index('inspection_id'); });
        Schema::table('purchase_receipts', function (Blueprint $table) { $table->foreign('document_id')->references('id')->on('purchase_documents')->restrictOnDelete(); $table->index('document_id'); });
        Schema::table('purchase_receipts', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('purchase_receipt_lines', function (Blueprint $table) { $table->foreign('receipt_id')->references('id')->on('purchase_receipts')->restrictOnDelete(); $table->index('receipt_id'); });
        Schema::table('purchase_receipt_lines', function (Blueprint $table) { $table->foreign('po_line_id')->references('id')->on('purchase_order_lines')->restrictOnDelete(); $table->index('po_line_id'); });
        Schema::table('purchase_receipt_lines', function (Blueprint $table) { $table->foreign('variant_id')->references('id')->on('product_variants')->restrictOnDelete(); $table->index('variant_id'); });
        Schema::table('purchase_receipt_lines', function (Blueprint $table) { $table->foreign('lot_id')->references('id')->on('lots')->restrictOnDelete(); $table->index('lot_id'); });
        Schema::table('purchase_receipt_lines', function (Blueprint $table) { $table->foreign('stock_movement_id')->references('id')->on('stock_movements')->restrictOnDelete(); $table->index('stock_movement_id'); });
        Schema::table('purchase_receipt_lines', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('purchase_documents', function (Blueprint $table) { $table->foreign('company_id')->references('id')->on('companies')->restrictOnDelete(); $table->index('company_id'); });
        Schema::table('purchase_documents', function (Blueprint $table) { $table->foreign('supplier_id')->references('id')->on('suppliers')->restrictOnDelete(); $table->index('supplier_id'); });
        Schema::table('purchase_documents', function (Blueprint $table) { $table->foreign('establishment_id')->references('id')->on('establishments')->restrictOnDelete(); $table->index('establishment_id'); });
        Schema::table('purchase_documents', function (Blueprint $table) { $table->foreign('brand_id')->references('id')->on('brands')->restrictOnDelete(); $table->index('brand_id'); });
        Schema::table('purchase_documents', function (Blueprint $table) { $table->foreign('cost_center_id')->references('id')->on('cost_centers')->restrictOnDelete(); $table->index('cost_center_id'); });
        Schema::table('purchase_documents', function (Blueprint $table) { $table->foreign('po_id')->references('id')->on('purchase_orders')->restrictOnDelete(); $table->index('po_id'); });
        Schema::table('purchase_documents', function (Blueprint $table) { $table->foreign('receipt_id')->references('id')->on('purchase_receipts')->restrictOnDelete(); $table->index('receipt_id'); });
        Schema::table('purchase_documents', function (Blueprint $table) { $table->foreign('registered_by')->references('id')->on('users')->restrictOnDelete(); $table->index('registered_by'); });
        Schema::table('purchase_documents', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('purchase_document_lines', function (Blueprint $table) { $table->foreign('document_id')->references('id')->on('purchase_documents')->restrictOnDelete(); $table->index('document_id'); });
        Schema::table('purchase_document_lines', function (Blueprint $table) { $table->foreign('receipt_line_id')->references('id')->on('purchase_receipt_lines')->restrictOnDelete(); $table->index('receipt_line_id'); });
        Schema::table('purchase_document_lines', function (Blueprint $table) { $table->foreign('variant_id')->references('id')->on('product_variants')->restrictOnDelete(); $table->index('variant_id'); });
        Schema::table('purchase_document_lines', function (Blueprint $table) { $table->foreign('cost_center_id')->references('id')->on('cost_centers')->restrictOnDelete(); $table->index('cost_center_id'); });
        Schema::table('purchase_document_lines', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('supplier_payments', function (Blueprint $table) { $table->foreign('company_id')->references('id')->on('companies')->restrictOnDelete(); $table->index('company_id'); });
        Schema::table('supplier_payments', function (Blueprint $table) { $table->foreign('supplier_id')->references('id')->on('suppliers')->restrictOnDelete(); $table->index('supplier_id'); });
        Schema::table('supplier_payments', function (Blueprint $table) { $table->foreign('cash_account_id')->references('id')->on('cash_accounts')->restrictOnDelete(); $table->index('cash_account_id'); });
        Schema::table('supplier_payments', function (Blueprint $table) { $table->foreign('registered_by')->references('id')->on('users')->restrictOnDelete(); $table->index('registered_by'); });
        Schema::table('supplier_payments', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('supplier_payment_allocations', function (Blueprint $table) { $table->foreign('payment_id')->references('id')->on('supplier_payments')->restrictOnDelete(); $table->index('payment_id'); });
        Schema::table('supplier_payment_allocations', function (Blueprint $table) { $table->foreign('document_id')->references('id')->on('purchase_documents')->restrictOnDelete(); $table->index('document_id'); });
        Schema::table('supplier_payment_allocations', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });

        DB::statement("SELECT enable_tenant_rls('purchase_requisitions')");
        DB::statement("SELECT audit.track('purchase_requisitions')");
        DB::statement("SELECT enable_tenant_rls('supplier_catalog')");
        DB::statement("SELECT audit.track('supplier_catalog')");
        DB::statement("SELECT enable_tenant_rls('purchase_orders')");
        DB::statement("SELECT audit.track('purchase_orders')");
        DB::statement("SELECT enable_tenant_rls('purchase_order_lines')");
        DB::statement("SELECT audit.track('purchase_order_lines')");
        DB::statement("SELECT enable_tenant_rls('purchase_receipts')");
        DB::statement("SELECT audit.track('purchase_receipts')");
        DB::statement("SELECT enable_tenant_rls('purchase_receipt_lines')");
        DB::statement("SELECT audit.track('purchase_receipt_lines')");
        DB::statement("SELECT enable_tenant_rls('purchase_documents')");
        DB::statement("SELECT audit.track('purchase_documents')");
        DB::statement("SELECT enable_tenant_rls('purchase_document_lines')");
        DB::statement("SELECT audit.track('purchase_document_lines')");
        DB::statement("SELECT enable_tenant_rls('supplier_payments')");
        DB::statement("SELECT audit.track('supplier_payments')");
        DB::statement("SELECT enable_tenant_rls('supplier_payment_allocations')");
        DB::statement("SELECT audit.track('supplier_payment_allocations')");
    }

    public function down(): void
    {
        DB::statement('DROP TABLE IF EXISTS supplier_payment_allocations CASCADE');
        DB::statement('DROP TABLE IF EXISTS supplier_payments CASCADE');
        DB::statement('DROP TABLE IF EXISTS purchase_document_lines CASCADE');
        DB::statement('DROP TABLE IF EXISTS purchase_documents CASCADE');
        DB::statement('DROP TABLE IF EXISTS purchase_receipt_lines CASCADE');
        DB::statement('DROP TABLE IF EXISTS purchase_receipts CASCADE');
        DB::statement('DROP TABLE IF EXISTS purchase_order_lines CASCADE');
        DB::statement('DROP TABLE IF EXISTS purchase_orders CASCADE');
        DB::statement('DROP TABLE IF EXISTS supplier_catalog CASCADE');
        DB::statement('DROP TABLE IF EXISTS purchase_requisitions CASCADE');
    }
};
