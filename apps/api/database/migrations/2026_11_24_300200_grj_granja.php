<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// GRJ · generada desde el modelo del prototipo (tools/prototipo/generar_migraciones.py).
// Tablas: farm_links, farm_product_mappings, farm_dispatches, farm_dispatch_lines, farm_reconciliations.
// El dueño del módulo revisa tipos, únicos y estados antes de construir sus pantallas;
// los cambios se hacen con migraciones nuevas, no editando esta.
return new class extends Migration
{
    public function up(): void
    {
        // GRJ · farm_links
        Schema::create('farm_links', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('supplier_id')->nullable();
            $table->uuid('company_id')->nullable();
            $table->string('mode', 255)->nullable()->comment('valores en el prototipo: NTI');
            $table->date('valid_from')->nullable();
            $table->date('valid_to')->nullable();
            $table->string('farm_tenant_ref', 255)->nullable();
            $table->string('farm_ruc', 255)->nullable()->comment('valores en el prototipo: 20609147254');
            $table->string('farm_legal_name', 255)->nullable();
            $table->string('connector_status', 255)->nullable()->comment('valores en el prototipo: FAKE');
            $table->string('status', 255)->nullable()->comment('valores en el prototipo: ACTIVE');
            $table->uuid('created_by')->nullable();
            $table->timestampTz('last_webhook_at')->nullable();
            $table->text('notes')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // GRJ · farm_product_mappings
        Schema::create('farm_product_mappings', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('supplier_id');
            $table->string('farm_item_code', 255);
            $table->string('farm_item_name', 255);
            $table->uuid('variant_id');
            $table->decimal('conversion_factor', 12, 6)->default(1);
            $table->decimal('transfer_price', 18, 6);
            $table->string('status', 255)->comment('valores en el prototipo: ACTIVE');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // GRJ · farm_dispatches
        Schema::create('farm_dispatches', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('farm_link_id');
            $table->string('idempotency_key', 255);
            $table->string('farm_document_type', 255)->comment('valores en el prototipo: NTI');
            $table->string('farm_document_number', 255);
            $table->timestampTz('dispatched_at');
            $table->string('expected_doc_type', 255)->comment('valores en el prototipo: NTI');
            $table->decimal('total_sent_kg', 14, 3);
            $table->decimal('total_value', 14, 2);
            $table->jsonb('raw_payload');
            $table->string('status', 255)->comment('valores en el prototipo: DISPUTED, ERROR, RECEIVED, RECEIVED_PENDING');
            $table->text('error_message')->nullable();
            $table->uuid('purchase_receipt_id')->nullable();
            $table->uuid('purchase_document_id')->nullable();
            $table->timestampTz('received_at')->nullable();
            $table->string('source', 255)->comment('valores en el prototipo: WEBHOOK');
            $table->timestampTz('arrived_at');
            $table->string('order_ref', 255)->nullable();
            $table->integer('duplicates_received');
            $table->boolean('was_disputed')->default(false);
            $table->uuid('received_by')->nullable();
            $table->timestampTz('confirmation_sent_at')->nullable();
            $table->jsonb('confirmation_payload')->nullable();
            $table->jsonb('agreement')->nullable();
            $table->timestampTz('last_duplicate_at')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // GRJ · farm_dispatch_lines
        Schema::create('farm_dispatch_lines', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('dispatch_id');
            $table->string('farm_item_code', 255);
            $table->string('farm_item_name', 255);
            $table->string('farm_lot_code', 255);
            $table->jsonb('farm_origin');
            $table->decimal('sent_qty', 14, 3)->nullable();
            $table->decimal('sent_weight_kg', 14, 3);
            $table->decimal('unit_price', 18, 6);
            $table->uuid('mapping_id')->nullable();
            $table->decimal('received_qty', 14, 3)->nullable();
            $table->decimal('received_weight_kg', 14, 3)->nullable();
            $table->decimal('temp_c', 14, 2)->nullable();
            $table->uuid('lot_id')->nullable();
            $table->decimal('difference_pct', 9, 4)->nullable();
            $table->string('difference_reason', 255)->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // GRJ · farm_reconciliations
        Schema::create('farm_reconciliations', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->string('status', 255)->nullable()->comment('valores en el prototipo: AGREED, OPEN');
            $table->text('notes')->nullable();
            $table->uuid('closed_by')->nullable();
            $table->timestampTz('closed_at')->nullable();
            $table->uuid('farm_link_id')->nullable();
            $table->date('period')->nullable();
            $table->decimal('sent_kg', 14, 3)->nullable();
            $table->decimal('received_kg', 14, 3)->nullable();
            $table->decimal('sent_value', 14, 2)->nullable();
            $table->decimal('received_value', 14, 2)->nullable();
            $table->decimal('difference_kg', 14, 3)->nullable();
            $table->decimal('difference_value', 14, 2)->nullable();
            $table->uuid('agreed_by')->nullable();
            $table->timestampTz('agreed_at')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });

        Schema::table('farm_links', function (Blueprint $table) { $table->foreign('supplier_id')->references('id')->on('suppliers')->restrictOnDelete(); $table->index('supplier_id'); });
        Schema::table('farm_links', function (Blueprint $table) { $table->foreign('company_id')->references('id')->on('companies')->restrictOnDelete(); $table->index('company_id'); });
        Schema::table('farm_links', function (Blueprint $table) { $table->foreign('created_by')->references('id')->on('users')->restrictOnDelete(); $table->index('created_by'); });
        Schema::table('farm_links', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('farm_product_mappings', function (Blueprint $table) { $table->foreign('supplier_id')->references('id')->on('suppliers')->restrictOnDelete(); $table->index('supplier_id'); });
        Schema::table('farm_product_mappings', function (Blueprint $table) { $table->foreign('variant_id')->references('id')->on('product_variants')->restrictOnDelete(); $table->index('variant_id'); });
        Schema::table('farm_product_mappings', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('farm_dispatches', function (Blueprint $table) { $table->foreign('farm_link_id')->references('id')->on('farm_links')->restrictOnDelete(); $table->index('farm_link_id'); });
        Schema::table('farm_dispatches', function (Blueprint $table) { $table->foreign('purchase_receipt_id')->references('id')->on('purchase_receipts')->restrictOnDelete(); $table->index('purchase_receipt_id'); });
        Schema::table('farm_dispatches', function (Blueprint $table) { $table->foreign('purchase_document_id')->references('id')->on('purchase_documents')->restrictOnDelete(); $table->index('purchase_document_id'); });
        Schema::table('farm_dispatches', function (Blueprint $table) { $table->foreign('received_by')->references('id')->on('users')->restrictOnDelete(); $table->index('received_by'); });
        Schema::table('farm_dispatches', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('farm_dispatch_lines', function (Blueprint $table) { $table->foreign('dispatch_id')->references('id')->on('farm_dispatches')->restrictOnDelete(); $table->index('dispatch_id'); });
        Schema::table('farm_dispatch_lines', function (Blueprint $table) { $table->foreign('mapping_id')->references('id')->on('farm_product_mappings')->restrictOnDelete(); $table->index('mapping_id'); });
        Schema::table('farm_dispatch_lines', function (Blueprint $table) { $table->foreign('lot_id')->references('id')->on('lots')->restrictOnDelete(); $table->index('lot_id'); });
        Schema::table('farm_dispatch_lines', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('farm_reconciliations', function (Blueprint $table) { $table->foreign('farm_link_id')->references('id')->on('farm_links')->restrictOnDelete(); $table->index('farm_link_id'); });
        Schema::table('farm_reconciliations', function (Blueprint $table) { $table->foreign('agreed_by')->references('id')->on('users')->restrictOnDelete(); $table->index('agreed_by'); });
        Schema::table('farm_reconciliations', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });

        DB::statement("SELECT enable_tenant_rls('farm_links')");
        DB::statement("SELECT audit.track('farm_links')");
        DB::statement("SELECT enable_tenant_rls('farm_product_mappings')");
        DB::statement("SELECT audit.track('farm_product_mappings')");
        DB::statement("SELECT enable_tenant_rls('farm_dispatches')");
        DB::statement("SELECT audit.track('farm_dispatches')");
        DB::statement("SELECT enable_tenant_rls('farm_dispatch_lines')");
        DB::statement("SELECT audit.track('farm_dispatch_lines')");
        DB::statement("SELECT enable_tenant_rls('farm_reconciliations')");
        DB::statement("SELECT audit.track('farm_reconciliations')");
    }

    public function down(): void
    {
        DB::statement('DROP TABLE IF EXISTS farm_reconciliations CASCADE');
        DB::statement('DROP TABLE IF EXISTS farm_dispatch_lines CASCADE');
        DB::statement('DROP TABLE IF EXISTS farm_dispatches CASCADE');
        DB::statement('DROP TABLE IF EXISTS farm_product_mappings CASCADE');
        DB::statement('DROP TABLE IF EXISTS farm_links CASCADE');
    }
};
