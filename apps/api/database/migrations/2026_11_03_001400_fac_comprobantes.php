<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// FAC · generada desde el modelo del prototipo (tools/prototipo/generar_migraciones.py).
// Tablas: sales_documents, sales_document_lines, einvoice_submissions, sunat_daily_summaries, sunat_daily_summary_lines, dispatch_guides, dispatch_guide_lines.
// El dueño del módulo revisa tipos, únicos y estados antes de construir sus pantallas;
// los cambios se hacen con migraciones nuevas, no editando esta.
return new class extends Migration
{
    public function up(): void
    {
        // FAC · sales_documents
        Schema::create('sales_documents', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('company_id');
            $table->uuid('establishment_id');
            $table->uuid('brand_id');
            $table->uuid('series_id');
            $table->string('doc_type', 40)->comment('valores en el prototipo: CREDIT_NOTE, INVOICE, RECEIPT');
            $table->string('series', 20)->comment('valores en el prototipo: B001, B002, B003, B004, B005, B010, BC03, F001, F002, F005, FC01');
            $table->integer('number');
            $table->string('full_number', 40);
            $table->date('issue_date');
            $table->uuid('customer_id');
            $table->string('customer_doc_type', 20)->comment('valores en el prototipo: DNI, NONE, RUC');
            $table->string('customer_doc_number', 40)->nullable();
            $table->string('customer_name', 80);
            $table->uuid('order_id')->nullable();
            $table->uuid('related_document_id')->nullable();
            $table->string('currency', 20)->comment('valores en el prototipo: PEN');
            $table->decimal('subtotal', 14, 2);
            $table->decimal('igv', 14, 2);
            $table->decimal('total', 14, 2);
            $table->decimal('cost', 14, 2);
            $table->string('payment_terms', 20)->comment('valores en el prototipo: CASH, CREDIT');
            $table->date('due_date')->nullable();
            $table->string('sunat_status', 20)->comment('valores en el prototipo: ACCEPTED, OBSERVED, PENDING, REJECTED, VOIDED');
            $table->string('status', 20)->comment('valores en el prototipo: ISSUED, VOIDED');
            $table->uuid('seller_id')->nullable();
            $table->string('note_reason_code', 20)->nullable()->comment('valores en el prototipo: 07, 09');
            $table->string('note_reason', 255)->nullable();
            $table->decimal('send_attempts', 14, 2);
            $table->timestampTz('sent_at')->nullable();
            $table->decimal('balance', 14, 2);
            $table->string('xml_hash', 80);
            $table->timestampTz('issued_at')->nullable();
            $table->string('brand_name', 40)->nullable();
            $table->string('brand_logo', 20)->nullable();
            $table->string('buyer_address', 255)->nullable();
            $table->timestampTz('accepted_at')->nullable();
            $table->string('sunat_code', 20)->nullable()->comment('valores en el prototipo: 0, 0109, 3105, 4287');
            $table->text('sunat_message')->nullable();
            $table->string('cdr_hash', 80)->nullable();
            $table->string('void_reason', 255)->nullable();
            $table->timestampTz('voided_at')->nullable();
            $table->string('voided_by', 40)->nullable();
            $table->timestampTz('last_attempt_at')->nullable();
            $table->timestampTz('next_retry_at')->nullable();
            $table->boolean('needs_review')->nullable();
            $table->uuid('pos_shift_id')->nullable();
            $table->uuid('pos_terminal_id')->nullable();
            $table->string('pos_ticket', 40)->nullable();
            $table->jsonb('returned')->nullable();
            $table->string('refund_mode', 20)->nullable()->comment('valores en el prototipo: SAME');
            $table->uuid('refund_method')->nullable();
            $table->string('refund_status', 20)->nullable()->comment('valores en el prototipo: PENDING');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // FAC · sales_document_lines
        Schema::create('sales_document_lines', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('sales_document_id');
            $table->integer('line_no')->default(1);
            $table->uuid('variant_id')->nullable();
            $table->text('description');
            $table->decimal('qty', 14, 3);
            $table->string('uom_code', 20)->comment('valores en el prototipo: KGM, NIU, ZZ');
            $table->decimal('unit_price', 14, 2);
            $table->string('igv_affectation', 20)->comment('valores en el prototipo: 10');
            $table->decimal('total', 14, 2);
            $table->uuid('lot_id')->nullable();
            $table->decimal('unit_cost', 14, 2)->nullable();
            $table->decimal('cost', 14, 2);
            $table->decimal('subtotal', 14, 2);
            $table->decimal('igv', 14, 2);
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // FAC · einvoice_submissions
        Schema::create('einvoice_submissions', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('document_id')->nullable();
            $table->uuid('guide_id')->nullable();
            $table->uuid('summary_id')->nullable();
            $table->decimal('attempt_no', 14, 2);
            $table->string('provider', 20)->comment('valores en el prototipo: FAKE');
            $table->timestampTz('requested_at');
            $table->string('response_code', 20)->comment('valores en el prototipo: 0, 0109, 3105, 4287');
            $table->string('result', 20)->comment('valores en el prototipo: ACCEPTED, OBSERVED, REJECTED, TIMEOUT');
            $table->text('message');
            $table->integer('duration_ms');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // FAC · sunat_daily_summaries
        Schema::create('sunat_daily_summaries', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('company_id')->nullable();
            $table->string('summary_type', 20)->nullable()->comment('valores en el prototipo: RA');
            $table->date('reference_date')->nullable();
            $table->string('identifier', 40)->nullable();
            $table->string('ticket', 40)->nullable()->comment('valores en el prototipo: 202613004517');
            $table->string('status', 20)->nullable()->comment('valores en el prototipo: ACCEPTED');
            $table->timestampTz('sent_at')->nullable();
            $table->timestampTz('accepted_at')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // FAC · sunat_daily_summary_lines
        Schema::create('sunat_daily_summary_lines', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('summary_id')->nullable();
            $table->uuid('document_id')->nullable();
            $table->string('action', 20)->nullable()->comment('valores en el prototipo: VOID');
            $table->string('reason', 255)->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // FAC · dispatch_guides
        Schema::create('dispatch_guides', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('company_id');
            $table->uuid('establishment_id');
            $table->uuid('brand_id')->nullable();
            $table->uuid('series_id');
            $table->string('series', 20)->comment('valores en el prototipo: T001, T002');
            $table->integer('number');
            $table->string('full_number', 40);
            $table->date('issue_date');
            $table->string('transfer_reason_code', 20)->comment('valores en el prototipo: 01, 04, 05');
            $table->string('transport_mode', 20)->comment('valores en el prototipo: 01, 02');
            $table->date('start_date');
            $table->uuid('carrier_supplier_id')->nullable();
            $table->uuid('recipient_customer_id')->nullable();
            $table->string('origin_ubigeo', 20)->comment('valores en el prototipo: 150119, 150140');
            $table->string('origin_address', 80);
            $table->string('dest_ubigeo', 20)->comment('valores en el prototipo: 040101, 080108, 130111, 1501, 150140');
            $table->string('dest_address', 255);
            $table->decimal('gross_weight_kg', 14, 3);
            $table->integer('packages');
            $table->uuid('order_id')->nullable();
            $table->string('status', 20)->comment('valores en el prototipo: ISSUED');
            $table->string('sunat_status', 20)->comment('valores en el prototipo: ACCEPTED, PENDING');
            $table->uuid('vehicle_id')->nullable();
            $table->uuid('driver_employee_id')->nullable();
            $table->string('driver_license', 40)->nullable()->comment('valores en el prototipo: Q40143565, Q40144936');
            $table->uuid('dest_establishment_id')->nullable();
            $table->string('transfer_id', 20)->nullable();
            $table->string('transfer_ref', 40)->nullable();
            $table->string('sales_document_id', 20)->nullable();
            $table->decimal('send_attempts', 14, 2)->nullable();
            $table->timestampTz('issued_at')->nullable();
            $table->string('issued_by', 40)->nullable();
            $table->text('notes')->nullable();
            $table->timestampTz('accepted_at')->nullable();
            $table->string('sunat_code', 20)->nullable()->comment('valores en el prototipo: 0');
            $table->text('sunat_message')->nullable();
            $table->timestampTz('last_attempt_at')->nullable();
            $table->string('next_retry_at', 20)->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // FAC · dispatch_guide_lines
        Schema::create('dispatch_guide_lines', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('guide_id');
            $table->uuid('variant_id');
            $table->text('description');
            $table->decimal('qty', 14, 3);
            $table->string('uom_code', 20)->comment('valores en el prototipo: KGM, NIU');
            $table->decimal('weight_kg', 14, 3)->nullable();
            $table->uuid('lot_id')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });

        Schema::table('sales_documents', function (Blueprint $table) { $table->foreign('company_id')->references('id')->on('companies')->restrictOnDelete(); $table->index('company_id'); });
        Schema::table('sales_documents', function (Blueprint $table) { $table->foreign('establishment_id')->references('id')->on('establishments')->restrictOnDelete(); $table->index('establishment_id'); });
        Schema::table('sales_documents', function (Blueprint $table) { $table->foreign('brand_id')->references('id')->on('brands')->restrictOnDelete(); $table->index('brand_id'); });
        Schema::table('sales_documents', function (Blueprint $table) { $table->foreign('series_id')->references('id')->on('document_series')->restrictOnDelete(); $table->index('series_id'); });
        Schema::table('sales_documents', function (Blueprint $table) { $table->foreign('customer_id')->references('id')->on('customers')->restrictOnDelete(); $table->index('customer_id'); });
        Schema::table('sales_documents', function (Blueprint $table) { $table->foreign('order_id')->references('id')->on('sales_orders')->restrictOnDelete(); $table->index('order_id'); });
        Schema::table('sales_documents', function (Blueprint $table) { $table->foreign('related_document_id')->references('id')->on('sales_documents')->restrictOnDelete(); $table->index('related_document_id'); });
        Schema::table('sales_documents', function (Blueprint $table) { $table->foreign('seller_id')->references('id')->on('users')->restrictOnDelete(); $table->index('seller_id'); });
        Schema::table('sales_documents', function (Blueprint $table) { $table->foreign('pos_shift_id')->references('id')->on('pos_shifts')->restrictOnDelete(); $table->index('pos_shift_id'); });
        Schema::table('sales_documents', function (Blueprint $table) { $table->foreign('pos_terminal_id')->references('id')->on('pos_terminals')->restrictOnDelete(); $table->index('pos_terminal_id'); });
        Schema::table('sales_documents', function (Blueprint $table) { $table->foreign('refund_method')->references('id')->on('payment_methods')->restrictOnDelete(); $table->index('refund_method'); });
        Schema::table('sales_documents', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('sales_document_lines', function (Blueprint $table) { $table->foreign('sales_document_id')->references('id')->on('sales_documents')->cascadeOnDelete(); $table->index('sales_document_id'); });
        Schema::table('sales_document_lines', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('einvoice_submissions', function (Blueprint $table) { $table->foreign('document_id')->references('id')->on('sales_documents')->restrictOnDelete(); $table->index('document_id'); });
        Schema::table('einvoice_submissions', function (Blueprint $table) { $table->foreign('guide_id')->references('id')->on('dispatch_guides')->restrictOnDelete(); $table->index('guide_id'); });
        Schema::table('einvoice_submissions', function (Blueprint $table) { $table->foreign('summary_id')->references('id')->on('sunat_daily_summaries')->restrictOnDelete(); $table->index('summary_id'); });
        Schema::table('einvoice_submissions', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('sunat_daily_summaries', function (Blueprint $table) { $table->foreign('company_id')->references('id')->on('companies')->restrictOnDelete(); $table->index('company_id'); });
        Schema::table('sunat_daily_summaries', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('sunat_daily_summary_lines', function (Blueprint $table) { $table->foreign('summary_id')->references('id')->on('sunat_daily_summaries')->restrictOnDelete(); $table->index('summary_id'); });
        Schema::table('sunat_daily_summary_lines', function (Blueprint $table) { $table->foreign('document_id')->references('id')->on('sales_documents')->restrictOnDelete(); $table->index('document_id'); });
        Schema::table('sunat_daily_summary_lines', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('dispatch_guides', function (Blueprint $table) { $table->foreign('company_id')->references('id')->on('companies')->restrictOnDelete(); $table->index('company_id'); });
        Schema::table('dispatch_guides', function (Blueprint $table) { $table->foreign('establishment_id')->references('id')->on('establishments')->restrictOnDelete(); $table->index('establishment_id'); });
        Schema::table('dispatch_guides', function (Blueprint $table) { $table->foreign('brand_id')->references('id')->on('brands')->restrictOnDelete(); $table->index('brand_id'); });
        Schema::table('dispatch_guides', function (Blueprint $table) { $table->foreign('series_id')->references('id')->on('document_series')->restrictOnDelete(); $table->index('series_id'); });
        Schema::table('dispatch_guides', function (Blueprint $table) { $table->foreign('carrier_supplier_id')->references('id')->on('suppliers')->restrictOnDelete(); $table->index('carrier_supplier_id'); });
        Schema::table('dispatch_guides', function (Blueprint $table) { $table->foreign('recipient_customer_id')->references('id')->on('customers')->restrictOnDelete(); $table->index('recipient_customer_id'); });
        Schema::table('dispatch_guides', function (Blueprint $table) { $table->foreign('order_id')->references('id')->on('sales_orders')->restrictOnDelete(); $table->index('order_id'); });
        Schema::table('dispatch_guides', function (Blueprint $table) { $table->foreign('vehicle_id')->references('id')->on('vehicles')->restrictOnDelete(); $table->index('vehicle_id'); });
        Schema::table('dispatch_guides', function (Blueprint $table) { $table->foreign('driver_employee_id')->references('id')->on('employees')->restrictOnDelete(); $table->index('driver_employee_id'); });
        Schema::table('dispatch_guides', function (Blueprint $table) { $table->foreign('dest_establishment_id')->references('id')->on('establishments')->restrictOnDelete(); $table->index('dest_establishment_id'); });
        Schema::table('dispatch_guides', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('dispatch_guide_lines', function (Blueprint $table) { $table->foreign('guide_id')->references('id')->on('dispatch_guides')->restrictOnDelete(); $table->index('guide_id'); });
        Schema::table('dispatch_guide_lines', function (Blueprint $table) { $table->foreign('variant_id')->references('id')->on('product_variants')->restrictOnDelete(); $table->index('variant_id'); });
        Schema::table('dispatch_guide_lines', function (Blueprint $table) { $table->foreign('lot_id')->references('id')->on('lots')->restrictOnDelete(); $table->index('lot_id'); });
        Schema::table('dispatch_guide_lines', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });

        Schema::table('sales_documents', fn (Blueprint $table) => $table->unique(['tenant_id', 'series', 'number']));
        DB::statement("SELECT enable_tenant_rls('sales_documents')");
        DB::statement("SELECT enable_tenant_rls('sales_document_lines')");
        DB::statement("SELECT enable_tenant_rls('einvoice_submissions')");
        DB::statement('REVOKE UPDATE, DELETE, TRUNCATE ON einvoice_submissions FROM aycha_app');  // solo inserción
        DB::statement("SELECT enable_tenant_rls('sunat_daily_summaries')");
        DB::statement("SELECT enable_tenant_rls('sunat_daily_summary_lines')");
        DB::statement("SELECT enable_tenant_rls('dispatch_guides')");
        DB::statement("SELECT enable_tenant_rls('dispatch_guide_lines')");
    }

    public function down(): void
    {
        DB::statement('DROP TABLE IF EXISTS dispatch_guide_lines CASCADE');
        DB::statement('DROP TABLE IF EXISTS dispatch_guides CASCADE');
        DB::statement('DROP TABLE IF EXISTS sunat_daily_summary_lines CASCADE');
        DB::statement('DROP TABLE IF EXISTS sunat_daily_summaries CASCADE');
        DB::statement('DROP TABLE IF EXISTS einvoice_submissions CASCADE');
        DB::statement('DROP TABLE IF EXISTS sales_document_lines CASCADE');
        DB::statement('DROP TABLE IF EXISTS sales_documents CASCADE');
    }
};
