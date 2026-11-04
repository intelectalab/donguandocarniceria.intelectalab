<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// GAS · generada desde el modelo del prototipo (tools/prototipo/generar_migraciones.py).
// Tablas: expense_categories, expense_approval_rules, petty_cash_funds, petty_cash_reports, expenses, expense_allocations, expense_approvals.
// El dueño del módulo revisa tipos, únicos y estados antes de construir sus pantallas;
// los cambios se hacen con migraciones nuevas, no editando esta.
return new class extends Migration
{
    public function up(): void
    {
        // GAS · expense_categories
        Schema::create('expense_categories', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->string('code', 40);
            $table->string('name', 80);
            $table->string('category_group', 80)->comment('valores en el prototipo: ADMIN, ADVERTISING, COMMERCIAL, CONTENT_CREATORS, DELIVERY, EQUIPMENT_MAINTENANCE, OTHER, PRODUCTION, RENT, SERVICES, SUPPLIES_PACKAGING');
            $table->string('default_area', 40)->comment('valores en el prototipo: ADMIN, DELIVERY, MARKETING, OTHER, PRODUCTION, SALES');
            $table->string('delivery_cost_type', 80)->nullable()->comment('valores en el prototipo: CARRIER_FEE, DRIVER_MEAL, DRIVER_TRANSPORT, DRIVER_WAGE, FINE, FUEL, MAINTENANCE_CORRECTIVE, PROVINCE_FREIGHT, RENT, SOAT, TOLL');
            $table->uuid('default_cost_center_id');
            $table->string('default_doc_type', 40)->comment('valores en el prototipo: FEES_RECEIPT, FOREIGN_INVOICE, INVOICE, MOBILITY_SHEET, RECEIPT, SIMPLE_RECEIPT, TICKET');
            $table->boolean('requires_vehicle')->default(false);
            $table->boolean('requires_gallons')->default(false);
            $table->boolean('requires_employee')->default(false);
            $table->boolean('requires_supplier')->default(false);
            $table->boolean('requires_campaign')->default(false);
            $table->string('status', 20)->comment('valores en el prototipo: ACTIVE');
            $table->string('parent_id', 20)->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // GAS · expense_approval_rules
        Schema::create('expense_approval_rules', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->decimal('min_amount', 14, 2);
            $table->decimal('max_amount', 14, 2)->nullable();
            $table->integer('level');
            $table->string('permission_code', 80);
            $table->uuid('category_id')->nullable();
            $table->string('establishment_id', 20)->nullable();
            $table->string('status', 20)->comment('valores en el prototipo: ACTIVE');
            $table->string('note', 255);
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // GAS · petty_cash_funds
        Schema::create('petty_cash_funds', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('cash_account_id')->nullable();
            $table->uuid('establishment_id')->nullable();
            $table->uuid('custodian_user_id')->nullable();
            $table->decimal('fund_amount', 14, 2)->nullable();
            $table->decimal('max_expense_amount', 14, 2)->nullable();
            $table->string('status', 20)->nullable()->comment('valores en el prototipo: ACTIVE');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // GAS · petty_cash_reports
        Schema::create('petty_cash_reports', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('fund_id');
            $table->string('number', 40);
            $table->date('period_from');
            $table->date('period_to');
            $table->decimal('total_expenses', 14, 2);
            $table->decimal('replenishment_amount', 14, 2)->nullable();
            $table->string('status', 40)->comment('valores en el prototipo: APPROVED, OPEN, REIMBURSED');
            $table->timestampTz('submitted_at')->nullable();
            $table->uuid('submitted_by')->nullable();
            $table->uuid('approved_by')->nullable();
            $table->timestampTz('approved_at')->nullable();
            $table->timestampTz('reimbursed_at')->nullable();
            $table->uuid('reimbursed_from')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // GAS · expenses
        Schema::create('expenses', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->string('number', 40);
            $table->uuid('company_id');
            $table->uuid('establishment_id');
            $table->uuid('cost_center_id');
            $table->uuid('brand_id');
            $table->uuid('category_id')->nullable();
            $table->string('category_code', 40)->nullable()->comment('valores en el prototipo: CONTENT_CREATORS');
            $table->uuid('supplier_id')->nullable();
            $table->string('doc_type', 40)->comment('valores en el prototipo: FEES_RECEIPT, FOREIGN_INVOICE, INVOICE, MOBILITY_SHEET, NONE, RECEIPT, SIMPLE_RECEIPT, TICKET');
            $table->string('doc_series', 20)->nullable();
            $table->string('doc_number', 20)->nullable();
            $table->date('issue_date');
            $table->string('currency', 20)->comment('valores en el prototipo: PEN, USD');
            $table->decimal('exchange_rate', 9, 4);
            $table->decimal('subtotal', 14, 2);
            $table->decimal('igv', 14, 2);
            $table->decimal('other_taxes', 14, 2);
            $table->decimal('total', 14, 2);
            $table->decimal('withholding_amount', 14, 2);
            $table->decimal('amount_pen', 14, 2);
            $table->uuid('ad_campaign_id')->nullable();
            $table->text('description');
            $table->string('status', 40)->comment('valores en el prototipo: APPROVED, DRAFT, PAID, REJECTED, SUBMITTED, VOIDED');
            $table->boolean('demo_fallback')->nullable();
            $table->string('source_module', 20)->nullable()->comment('valores en el prototipo: ADS');
            $table->string('sales_channel', 40)->nullable()->comment('valores en el prototipo: INSTAGRAM, TIKTOK, WEB, WHATSAPP');
            $table->string('payment_method_id', 20)->nullable();
            $table->uuid('vehicle_id')->nullable();
            $table->string('route_id', 20)->nullable();
            $table->uuid('employee_id')->nullable();
            $table->decimal('fuel_gallons', 18, 4)->nullable();
            $table->string('fuel_voucher_no', 20)->nullable();
            $table->decimal('odometer_km', 14, 3)->nullable();
            $table->string('receipt_file_id', 40)->nullable();
            $table->jsonb('receipt_photo')->nullable();
            $table->decimal('net_pen', 14, 2)->nullable();
            $table->string('accounting_flag', 40)->nullable()->comment('valores en el prototipo: NO_VALID_RECEIPT, OBSERVED, OK');
            $table->uuid('created_by')->nullable();
            $table->string('pay_source', 20)->nullable()->comment('valores en el prototipo: PAYABLE, PETTY');
            $table->integer('required_level')->nullable();
            $table->jsonb('history')->nullable();
            $table->timestampTz('submitted_at')->nullable();
            $table->boolean('allocated')->nullable();
            $table->uuid('approved_by')->nullable();
            $table->timestampTz('approved_at')->nullable();
            $table->timestampTz('paid_at')->nullable();
            $table->uuid('paid_from_account_id')->nullable();
            $table->string('payment_reference', 40)->nullable();
            $table->decimal('paid_amount', 14, 2)->nullable();
            $table->uuid('petty_cash_report_id')->nullable();
            $table->timestampTz('accounting_reviewed_at')->nullable();
            $table->uuid('accounting_reviewed_by')->nullable();
            $table->string('accounting_note', 255)->nullable();
            $table->string('rejection_reason', 255)->nullable();
            $table->string('void_reason', 80)->nullable();
            $table->timestampTz('voided_at')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // GAS · expense_allocations
        Schema::create('expense_allocations', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('expense_id');
            $table->uuid('cost_center_id');
            $table->uuid('brand_id');
            $table->string('sales_channel', 20)->nullable();
            $table->decimal('pct', 9, 4);
            $table->decimal('amount', 14, 2);
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // GAS · expense_approvals
        Schema::create('expense_approvals', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('expense_id');
            $table->integer('level');
            $table->uuid('approver_user_id');
            $table->string('decision', 20)->comment('valores en el prototipo: APPROVED, REJECTED');
            $table->text('comment')->nullable();
            $table->timestampTz('decided_at');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });

        Schema::table('expense_categories', function (Blueprint $table) { $table->foreign('default_cost_center_id')->references('id')->on('cost_centers')->restrictOnDelete(); $table->index('default_cost_center_id'); });
        Schema::table('expense_categories', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('expense_approval_rules', function (Blueprint $table) { $table->foreign('category_id')->references('id')->on('expense_categories')->restrictOnDelete(); $table->index('category_id'); });
        Schema::table('expense_approval_rules', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('petty_cash_funds', function (Blueprint $table) { $table->foreign('cash_account_id')->references('id')->on('cash_accounts')->restrictOnDelete(); $table->index('cash_account_id'); });
        Schema::table('petty_cash_funds', function (Blueprint $table) { $table->foreign('establishment_id')->references('id')->on('establishments')->restrictOnDelete(); $table->index('establishment_id'); });
        Schema::table('petty_cash_funds', function (Blueprint $table) { $table->foreign('custodian_user_id')->references('id')->on('users')->restrictOnDelete(); $table->index('custodian_user_id'); });
        Schema::table('petty_cash_funds', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('petty_cash_reports', function (Blueprint $table) { $table->foreign('fund_id')->references('id')->on('petty_cash_funds')->restrictOnDelete(); $table->index('fund_id'); });
        Schema::table('petty_cash_reports', function (Blueprint $table) { $table->foreign('submitted_by')->references('id')->on('users')->restrictOnDelete(); $table->index('submitted_by'); });
        Schema::table('petty_cash_reports', function (Blueprint $table) { $table->foreign('approved_by')->references('id')->on('users')->restrictOnDelete(); $table->index('approved_by'); });
        Schema::table('petty_cash_reports', function (Blueprint $table) { $table->foreign('reimbursed_from')->references('id')->on('cash_accounts')->restrictOnDelete(); $table->index('reimbursed_from'); });
        Schema::table('petty_cash_reports', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('expenses', function (Blueprint $table) { $table->foreign('company_id')->references('id')->on('companies')->restrictOnDelete(); $table->index('company_id'); });
        Schema::table('expenses', function (Blueprint $table) { $table->foreign('establishment_id')->references('id')->on('establishments')->restrictOnDelete(); $table->index('establishment_id'); });
        Schema::table('expenses', function (Blueprint $table) { $table->foreign('cost_center_id')->references('id')->on('cost_centers')->restrictOnDelete(); $table->index('cost_center_id'); });
        Schema::table('expenses', function (Blueprint $table) { $table->foreign('brand_id')->references('id')->on('brands')->restrictOnDelete(); $table->index('brand_id'); });
        Schema::table('expenses', function (Blueprint $table) { $table->foreign('category_id')->references('id')->on('expense_categories')->restrictOnDelete(); $table->index('category_id'); });
        Schema::table('expenses', function (Blueprint $table) { $table->foreign('supplier_id')->references('id')->on('suppliers')->restrictOnDelete(); $table->index('supplier_id'); });
        Schema::table('expenses', function (Blueprint $table) { $table->foreign('vehicle_id')->references('id')->on('vehicles')->restrictOnDelete(); $table->index('vehicle_id'); });
        Schema::table('expenses', function (Blueprint $table) { $table->foreign('employee_id')->references('id')->on('employees')->restrictOnDelete(); $table->index('employee_id'); });
        Schema::table('expenses', function (Blueprint $table) { $table->foreign('created_by')->references('id')->on('users')->restrictOnDelete(); $table->index('created_by'); });
        Schema::table('expenses', function (Blueprint $table) { $table->foreign('approved_by')->references('id')->on('users')->restrictOnDelete(); $table->index('approved_by'); });
        Schema::table('expenses', function (Blueprint $table) { $table->foreign('paid_from_account_id')->references('id')->on('cash_accounts')->restrictOnDelete(); $table->index('paid_from_account_id'); });
        Schema::table('expenses', function (Blueprint $table) { $table->foreign('petty_cash_report_id')->references('id')->on('petty_cash_reports')->restrictOnDelete(); $table->index('petty_cash_report_id'); });
        Schema::table('expenses', function (Blueprint $table) { $table->foreign('accounting_reviewed_by')->references('id')->on('users')->restrictOnDelete(); $table->index('accounting_reviewed_by'); });
        Schema::table('expenses', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('expense_allocations', function (Blueprint $table) { $table->foreign('expense_id')->references('id')->on('expenses')->restrictOnDelete(); $table->index('expense_id'); });
        Schema::table('expense_allocations', function (Blueprint $table) { $table->foreign('cost_center_id')->references('id')->on('cost_centers')->restrictOnDelete(); $table->index('cost_center_id'); });
        Schema::table('expense_allocations', function (Blueprint $table) { $table->foreign('brand_id')->references('id')->on('brands')->restrictOnDelete(); $table->index('brand_id'); });
        Schema::table('expense_allocations', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('expense_approvals', function (Blueprint $table) { $table->foreign('expense_id')->references('id')->on('expenses')->restrictOnDelete(); $table->index('expense_id'); });
        Schema::table('expense_approvals', function (Blueprint $table) { $table->foreign('approver_user_id')->references('id')->on('users')->restrictOnDelete(); $table->index('approver_user_id'); });
        Schema::table('expense_approvals', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });

        DB::statement("SELECT enable_tenant_rls('expense_categories')");
        DB::statement("SELECT enable_tenant_rls('expense_approval_rules')");
        DB::statement("SELECT enable_tenant_rls('petty_cash_funds')");
        DB::statement("SELECT enable_tenant_rls('petty_cash_reports')");
        DB::statement("SELECT enable_tenant_rls('expenses')");
        DB::statement("SELECT enable_tenant_rls('expense_allocations')");
        DB::statement("SELECT enable_tenant_rls('expense_approvals')");
        DB::statement('REVOKE UPDATE, DELETE, TRUNCATE ON expense_approvals FROM aycha_app');  // solo inserción
    }

    public function down(): void
    {
        DB::statement('DROP TABLE IF EXISTS expense_approvals CASCADE');
        DB::statement('DROP TABLE IF EXISTS expense_allocations CASCADE');
        DB::statement('DROP TABLE IF EXISTS expenses CASCADE');
        DB::statement('DROP TABLE IF EXISTS petty_cash_reports CASCADE');
        DB::statement('DROP TABLE IF EXISTS petty_cash_funds CASCADE');
        DB::statement('DROP TABLE IF EXISTS expense_approval_rules CASCADE');
        DB::statement('DROP TABLE IF EXISTS expense_categories CASCADE');
    }
};
