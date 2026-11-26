<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// CNT · generada desde el modelo del prototipo (tools/prototipo/generar_migraciones.py).
// Tablas: gl_accounts, journal_rules, journal_rule_lines, journal_entries, journal_lines, accountant_inbox_items, sire_proposals, sire_proposal_lines, sire_submissions, cnt_fiscal_years, ledger_exports, bank_statement_lines, bank_reconciliations, period_close_tasks, payroll_journal_imports, fs_templates, fs_template_lines.
// El dueño del módulo revisa tipos, únicos y estados antes de construir sus pantallas;
// los cambios se hacen con migraciones nuevas, no editando esta.
return new class extends Migration
{
    public function up(): void
    {
        // CNT · gl_accounts
        Schema::create('gl_accounts', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('company_id');
            $table->string('code', 255);
            $table->string('name', 255);
            $table->string('parent_code', 255)->nullable();
            $table->integer('level');
            $table->string('acc_type', 255)->comment('valores en el prototipo: ANALYTIC, ASSET, CONTROL, COST, EQUITY, EXPENSE, INCOME, LIABILITY');
            $table->string('nature', 255)->comment('valores en el prototipo: CREDIT, DEBIT');
            $table->boolean('postable')->default(false);
            $table->boolean('requires_cost_center')->default(false);
            $table->boolean('requires_third_party')->default(false);
            $table->boolean('requires_brand')->default(false);
            $table->string('dest_debit_code', 255)->nullable()->comment('valores en el prototipo: 2011, 2411, 2521, 2611, CC');
            $table->string('dest_credit_code', 255)->nullable()->comment('valores en el prototipo: 6111, 6121, 6132, 6141, 791');
            $table->string('status', 255)->comment('valores en el prototipo: ACTIVE');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // CNT · journal_rules
        Schema::create('journal_rules', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('company_id');
            $table->string('code', 255);
            $table->string('source', 255)->comment('valores en el prototipo: COGS, COLLECTION, CONSUMPTION, EXPENSE, INV_ADJUSTMENT, NTI, PAYMENT, PAYROLL, PRODUCTION, PURCHASE, SALE');
            $table->string('subtype', 255);
            $table->string('name', 255);
            $table->boolean('auto_approve')->default(false);
            $table->boolean('allocate_common')->default(false);
            $table->string('status', 255)->comment('valores en el prototipo: ACTIVE');
            $table->date('valid_from');
            $table->date('valid_to')->nullable();
            $table->integer('version');
            $table->uuid('approved_by');
            $table->timestampTz('approved_at');
            $table->jsonb('account_map')->default('{}');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // CNT · journal_rule_lines
        Schema::create('journal_rule_lines', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('rule_id');
            $table->integer('seq');
            $table->string('side', 255)->comment('valores en el prototipo: C, D');
            $table->string('account_from', 255)->comment('valores en el prototipo: CASH, CASH_TO, DETAIL, FIXED, PARAM, PAYABLE');
            $table->string('account_code', 255)->nullable();
            $table->string('param_key', 255)->nullable();
            $table->string('amount_key', 255);
            $table->string('third', 255)->nullable()->comment('valores en el prototipo: CASH, CASH_TO, DOC');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // CNT · journal_entries
        Schema::create('journal_entries', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('company_id');
            $table->string('number', 255)->nullable();
            $table->integer('seq')->nullable();
            $table->date('period');
            $table->string('currency', 255)->comment('valores en el prototipo: PEN');
            $table->decimal('total_debit', 14, 2);
            $table->decimal('total_credit', 14, 2);
            $table->timestampTz('prepared_at');
            $table->uuid('approved_by')->nullable();
            $table->timestampTz('approved_at')->nullable();
            $table->boolean('auto_approved')->default(false);
            $table->uuid('reversal_of')->nullable();
            $table->uuid('reversed_by_id')->nullable();
            $table->boolean('blocked')->default(false);
            $table->jsonb('history')->default('[]');
            $table->date('entry_date');
            $table->string('source_kind', 255);
            $table->string('source_type', 255);
            $table->string('source_subtype', 255);
            $table->uuid('source_id')->nullable()->comment('referencia polimórfica: cash_transfers, expenses, payments, payroll_journal_imports, production_orders, purchase_documents, sales_documents, settlement_batches, stock_movements, supplier_payments');
            $table->string('source_label', 255)->nullable();
            $table->uuid('rule_id')->nullable();
            $table->string('rule_code', 255)->nullable();
            $table->text('description');
            $table->string('status', 255)->comment('valores en el prototipo: APPROVED, DRAFT, PENDING_APPROVAL, VOIDED');
            $table->uuid('prepared_by')->nullable();
            $table->uuid('brand_id')->nullable();
            $table->uuid('establishment_id')->nullable();
            $table->uuid('bank_line_id')->nullable();
            $table->jsonb('blocked_reasons')->nullable();
            $table->decimal('exchange_rate', 9, 4)->nullable();
            $table->decimal('fx_total', 14, 2)->nullable();
            $table->string('void_reason', 255)->nullable();
            $table->string('reverse_reason', 255)->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // CNT · journal_lines
        Schema::create('journal_lines', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('entry_id');
            $table->integer('seq');
            $table->string('account_code', 255)->nullable();
            $table->text('description');
            $table->decimal('debit', 14, 2);
            $table->decimal('credit', 14, 2);
            $table->uuid('cost_center_id')->nullable();
            $table->uuid('brand_id')->nullable();
            $table->uuid('establishment_id')->nullable();
            $table->string('third_party_type', 255)->nullable()->comment('valores en el prototipo: CUSTOMER, EMPLOYEE, OTHER, SUPPLIER');
            $table->uuid('third_party_id')->nullable()->comment('referencia polimórfica: customers, employees, suppliers');
            $table->string('third_party_doc', 255)->nullable();
            $table->string('third_party_name', 255)->nullable();
            $table->boolean('is_destination')->default(false);
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // CNT · accountant_inbox_items
        Schema::create('accountant_inbox_items', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('company_id');
            $table->date('period');
            $table->string('source_type', 255)->comment('valores en el prototipo: EXPENSE, PURCHASE, PURCHASE_DOCUMENT, SIRE');
            $table->uuid('source_id')->comment('referencia polimórfica: expenses, purchase_documents, sire_proposals');
            $table->string('reason', 255)->comment('valores en el prototipo: MISSING_ACCOUNT, NO_RULE, NO_VALID_RECEIPT, PO_MISMATCH, SIRE_DIFF');
            $table->jsonb('missing')->default('[]');
            $table->string('status', 255)->comment('valores en el prototipo: APPROVED, CLASSIFIED, PENDING');
            $table->uuid('assigned_to')->nullable();
            $table->jsonb('classification')->nullable();
            $table->uuid('classified_by')->nullable();
            $table->timestampTz('classified_at')->nullable();
            $table->uuid('approved_by')->nullable();
            $table->timestampTz('approved_at')->nullable();
            $table->string('returned_reason', 255)->nullable();
            $table->text('notes')->nullable();
            $table->string('ref_label', 255)->nullable();
            $table->decimal('amount', 14, 2)->nullable();
            $table->uuid('entry_id')->nullable();
            $table->uuid('sire_line_id')->nullable();
            $table->jsonb('history')->default('[]');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // CNT · sire_proposals
        Schema::create('sire_proposals', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('company_id');
            $table->string('register', 255)->comment('valores en el prototipo: PURCHASES, SALES');
            $table->date('period');
            $table->string('file_name', 255);
            $table->timestampTz('imported_at');
            $table->uuid('imported_by');
            $table->integer('line_count');
            $table->decimal('total_amount', 14, 2);
            $table->string('status', 255)->comment('valores en el prototipo: SUBMITTED, WITH_DIFFS');
            $table->jsonb('summary')->default('{}');
            $table->boolean('superseded')->default(false);
            $table->timestampTz('matched_at');
            $table->integer('system_count');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // CNT · sire_proposal_lines
        Schema::create('sire_proposal_lines', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('proposal_id');
            $table->string('origin', 255)->comment('valores en el prototipo: PROPOSAL, SYSTEM');
            $table->integer('seq');
            $table->string('key', 255);
            $table->string('match_status', 255)->comment('valores en el prototipo: AMOUNT_DIFF, MATCHED, MISSING_IN_PROPOSAL, MISSING_IN_SYSTEM');
            $table->string('resolution', 255)->nullable()->comment('valores en el prototipo: ADD_TO_REGISTER, EXCLUDE, KEEP_SYSTEM');
            $table->string('issuer_ruc', 255);
            $table->string('issuer_name', 255);
            $table->string('doc_type_code', 255)->comment('valores en el prototipo: 01, 03');
            $table->string('series', 255)->comment('valores en el prototipo: B001, B002, B003, B004, B005, E001, F001, F002, F003, F004, F104, F310');
            $table->string('number', 255);
            $table->date('issue_date');
            $table->decimal('base', 14, 2);
            $table->decimal('igv', 14, 2);
            $table->decimal('total', 14, 2)->nullable();
            $table->string('system_kind', 255)->nullable()->comment('valores en el prototipo: EXPENSE, PURCHASE, SALE');
            $table->uuid('system_id')->nullable()->comment('referencia polimórfica: expenses, purchase_documents, sales_documents');
            $table->decimal('system_total', 14, 2)->nullable();
            $table->decimal('diff', 14, 2)->nullable();
            $table->string('resolution_note', 255)->nullable();
            $table->uuid('resolved_by')->nullable();
            $table->timestampTz('resolved_at')->nullable();
            $table->string('counterparty_doc', 255)->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // CNT · sire_submissions
        Schema::create('sire_submissions', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('company_id')->nullable();
            $table->string('register', 255)->nullable()->comment('valores en el prototipo: PURCHASES, SALES');
            $table->date('period')->nullable();
            $table->uuid('proposal_id')->nullable();
            $table->string('action', 255)->nullable()->comment('valores en el prototipo: ACCEPT, ADJUST');
            $table->string('file_name', 255)->nullable();
            $table->string('file_hash', 255)->nullable();
            $table->integer('line_count')->nullable();
            $table->integer('adjustments')->nullable();
            $table->timestampTz('generated_at')->nullable();
            $table->uuid('prepared_by')->nullable();
            $table->string('status', 255)->nullable()->comment('valores en el prototipo: ACCEPTED');
            $table->string('ticket', 255)->nullable()->comment('valores en el prototipo: 20260900857031, 20260900994111');
            $table->string('receipt_number', 255)->nullable();
            $table->uuid('submitted_by')->nullable();
            $table->timestampTz('submitted_at')->nullable();
            $table->timestampTz('accepted_at')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // CNT · cnt_fiscal_years
        Schema::create('cnt_fiscal_years', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('company_id')->nullable();
            $table->integer('year')->nullable();
            $table->decimal('uit_value_pen', 14, 2)->nullable();
            $table->string('uit_source', 255)->nullable();
            $table->decimal('revenue_pen', 16, 2)->nullable();
            $table->uuid('uit_confirmed_by')->nullable();
            $table->timestampTz('uit_confirmed_at')->nullable();
            $table->string('regime_result', 255)->nullable()->comment('valores en el prototipo: SIMPLIFIED');
            $table->jsonb('books')->nullable();
            $table->text('notes')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // CNT · ledger_exports
        Schema::create('ledger_exports', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('company_id');
            $table->string('book_code', 255)->comment('valores en el prototipo: LDS');
            $table->string('book_name', 255);
            $table->date('period');
            $table->string('format', 255)->comment('valores en el prototipo: PDF, XLSX');
            $table->string('ple_code', 255)->nullable();
            $table->string('file_name', 255);
            $table->integer('row_count');
            $table->string('hash', 255);
            $table->timestampTz('generated_at');
            $table->uuid('generated_by');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // CNT · bank_statement_lines
        Schema::create('bank_statement_lines', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('reconciliation_id');
            $table->uuid('cash_account_id');
            $table->integer('seq');
            $table->date('line_date');
            $table->text('description');
            $table->string('reference', 255)->nullable();
            $table->decimal('amount', 14, 2);
            $table->decimal('balance', 14, 2);
            $table->string('match_status', 255)->comment('valores en el prototipo: MATCHED, UNMATCHED');
            $table->uuid('matched_line_id')->nullable();
            $table->string('matched_by', 255)->nullable()->comment('AUTO o MANUAL');
            $table->uuid('booked_entry_id')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // CNT · bank_reconciliations
        Schema::create('bank_reconciliations', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('company_id')->nullable();
            $table->uuid('cash_account_id')->nullable();
            $table->date('period')->nullable();
            $table->decimal('opening_balance', 14, 2)->nullable();
            $table->decimal('statement_balance', 14, 2)->nullable();
            $table->string('status', 255)->nullable()->comment('valores en el prototipo: OPEN');
            $table->string('file_name', 255)->nullable();
            $table->timestampTz('imported_at')->nullable();
            $table->uuid('imported_by')->nullable();
            $table->uuid('closed_by')->nullable();
            $table->timestampTz('closed_at')->nullable();
            $table->integer('line_count')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // CNT · period_close_tasks
        Schema::create('period_close_tasks', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('company_id');
            $table->date('period');
            $table->integer('seq');
            $table->string('code', 255)->comment('valores en el prototipo: BANKS, DOCS_ENTRY, FARM, FS, INBOX_EMPTY, PRODUCTION, SIRE');
            $table->string('name', 255);
            $table->boolean('auto_check')->default(false);
            $table->string('status', 255)->comment('valores en el prototipo: DONE, PENDING');
            $table->uuid('done_by')->nullable();
            $table->timestampTz('done_at')->nullable();
            $table->string('waive_reason', 255)->nullable();
            $table->string('evidence', 255)->nullable();
            $table->string('last_check', 255)->nullable();
            $table->timestampTz('last_check_at')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // CNT · payroll_journal_imports
        Schema::create('payroll_journal_imports', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('company_id')->nullable();
            $table->date('period')->nullable();
            $table->string('source', 255)->nullable()->comment('valores en el prototipo: FILE');
            $table->string('file_name', 255)->nullable();
            $table->timestampTz('imported_at')->nullable();
            $table->uuid('imported_by')->nullable();
            $table->string('status', 255)->nullable()->comment('valores en el prototipo: POSTED');
            $table->uuid('entry_id')->nullable();
            $table->jsonb('lines')->nullable();
            $table->string('source_hint', 255)->nullable()->comment('valores en el prototipo: FILE');
            $table->decimal('gross_total', 14, 2)->nullable();
            $table->decimal('essalud_total', 14, 2)->nullable();
            $table->decimal('cts_total', 14, 2)->nullable();
            $table->decimal('vac_total', 14, 2)->nullable();
            $table->decimal('pension_total', 14, 2)->nullable();
            $table->decimal('net_total', 14, 2)->nullable();
            $table->integer('employees')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // CNT · fs_templates
        Schema::create('fs_templates', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('company_id');
            $table->string('code', 255)->comment('valores en el prototipo: ERF, ERN, ESF');
            $table->string('name', 255);
            $table->string('kind', 255)->comment('valores en el prototipo: BALANCE, INCOME');
            $table->string('status', 255)->comment('valores en el prototipo: ACTIVE');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // CNT · fs_template_lines
        Schema::create('fs_template_lines', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('template_id');
            $table->integer('seq');
            $table->string('code', 255);
            $table->string('label', 255);
            $table->string('kind', 255)->comment('valores en el prototipo: ACC, HEADER, RESULT, SUM');
            $table->jsonb('refs');
            $table->integer('sign');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });

        Schema::table('gl_accounts', function (Blueprint $table) { $table->foreign('company_id')->references('id')->on('companies')->restrictOnDelete(); $table->index('company_id'); });
        Schema::table('gl_accounts', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('journal_rules', function (Blueprint $table) { $table->foreign('company_id')->references('id')->on('companies')->restrictOnDelete(); $table->index('company_id'); });
        Schema::table('journal_rules', function (Blueprint $table) { $table->foreign('approved_by')->references('id')->on('users')->restrictOnDelete(); $table->index('approved_by'); });
        Schema::table('journal_rules', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('journal_rule_lines', function (Blueprint $table) { $table->foreign('rule_id')->references('id')->on('journal_rules')->restrictOnDelete(); $table->index('rule_id'); });
        Schema::table('journal_rule_lines', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('journal_entries', function (Blueprint $table) { $table->foreign('company_id')->references('id')->on('companies')->restrictOnDelete(); $table->index('company_id'); });
        Schema::table('journal_entries', function (Blueprint $table) { $table->foreign('approved_by')->references('id')->on('users')->restrictOnDelete(); $table->index('approved_by'); });
        Schema::table('journal_entries', function (Blueprint $table) { $table->foreign('reversal_of')->references('id')->on('journal_entries')->restrictOnDelete(); $table->index('reversal_of'); });
        Schema::table('journal_entries', function (Blueprint $table) { $table->foreign('reversed_by_id')->references('id')->on('journal_entries')->restrictOnDelete(); $table->index('reversed_by_id'); });
        Schema::table('journal_entries', function (Blueprint $table) { $table->foreign('rule_id')->references('id')->on('journal_rules')->restrictOnDelete(); $table->index('rule_id'); });
        Schema::table('journal_entries', function (Blueprint $table) { $table->foreign('prepared_by')->references('id')->on('users')->restrictOnDelete(); $table->index('prepared_by'); });
        Schema::table('journal_entries', function (Blueprint $table) { $table->foreign('brand_id')->references('id')->on('brands')->restrictOnDelete(); $table->index('brand_id'); });
        Schema::table('journal_entries', function (Blueprint $table) { $table->foreign('establishment_id')->references('id')->on('establishments')->restrictOnDelete(); $table->index('establishment_id'); });
        Schema::table('journal_entries', function (Blueprint $table) { $table->foreign('bank_line_id')->references('id')->on('bank_statement_lines')->restrictOnDelete(); $table->index('bank_line_id'); });
        Schema::table('journal_entries', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('journal_lines', function (Blueprint $table) { $table->foreign('entry_id')->references('id')->on('journal_entries')->restrictOnDelete(); $table->index('entry_id'); });
        Schema::table('journal_lines', function (Blueprint $table) { $table->foreign('cost_center_id')->references('id')->on('cost_centers')->restrictOnDelete(); $table->index('cost_center_id'); });
        Schema::table('journal_lines', function (Blueprint $table) { $table->foreign('brand_id')->references('id')->on('brands')->restrictOnDelete(); $table->index('brand_id'); });
        Schema::table('journal_lines', function (Blueprint $table) { $table->foreign('establishment_id')->references('id')->on('establishments')->restrictOnDelete(); $table->index('establishment_id'); });
        Schema::table('journal_lines', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('accountant_inbox_items', function (Blueprint $table) { $table->foreign('company_id')->references('id')->on('companies')->restrictOnDelete(); $table->index('company_id'); });
        Schema::table('accountant_inbox_items', function (Blueprint $table) { $table->foreign('classified_by')->references('id')->on('users')->restrictOnDelete(); $table->index('classified_by'); });
        Schema::table('accountant_inbox_items', function (Blueprint $table) { $table->foreign('approved_by')->references('id')->on('users')->restrictOnDelete(); $table->index('approved_by'); });
        Schema::table('accountant_inbox_items', function (Blueprint $table) { $table->foreign('entry_id')->references('id')->on('journal_entries')->restrictOnDelete(); $table->index('entry_id'); });
        Schema::table('accountant_inbox_items', function (Blueprint $table) { $table->foreign('sire_line_id')->references('id')->on('sire_proposal_lines')->restrictOnDelete(); $table->index('sire_line_id'); });
        Schema::table('accountant_inbox_items', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('sire_proposals', function (Blueprint $table) { $table->foreign('company_id')->references('id')->on('companies')->restrictOnDelete(); $table->index('company_id'); });
        Schema::table('sire_proposals', function (Blueprint $table) { $table->foreign('imported_by')->references('id')->on('users')->restrictOnDelete(); $table->index('imported_by'); });
        Schema::table('sire_proposals', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('sire_proposal_lines', function (Blueprint $table) { $table->foreign('proposal_id')->references('id')->on('sire_proposals')->restrictOnDelete(); $table->index('proposal_id'); });
        Schema::table('sire_proposal_lines', function (Blueprint $table) { $table->foreign('resolved_by')->references('id')->on('users')->restrictOnDelete(); $table->index('resolved_by'); });
        Schema::table('sire_proposal_lines', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('sire_submissions', function (Blueprint $table) { $table->foreign('company_id')->references('id')->on('companies')->restrictOnDelete(); $table->index('company_id'); });
        Schema::table('sire_submissions', function (Blueprint $table) { $table->foreign('proposal_id')->references('id')->on('sire_proposals')->restrictOnDelete(); $table->index('proposal_id'); });
        Schema::table('sire_submissions', function (Blueprint $table) { $table->foreign('prepared_by')->references('id')->on('users')->restrictOnDelete(); $table->index('prepared_by'); });
        Schema::table('sire_submissions', function (Blueprint $table) { $table->foreign('submitted_by')->references('id')->on('users')->restrictOnDelete(); $table->index('submitted_by'); });
        Schema::table('sire_submissions', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('cnt_fiscal_years', function (Blueprint $table) { $table->foreign('company_id')->references('id')->on('companies')->restrictOnDelete(); $table->index('company_id'); });
        Schema::table('cnt_fiscal_years', function (Blueprint $table) { $table->foreign('uit_confirmed_by')->references('id')->on('users')->restrictOnDelete(); $table->index('uit_confirmed_by'); });
        Schema::table('cnt_fiscal_years', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('ledger_exports', function (Blueprint $table) { $table->foreign('company_id')->references('id')->on('companies')->restrictOnDelete(); $table->index('company_id'); });
        Schema::table('ledger_exports', function (Blueprint $table) { $table->foreign('generated_by')->references('id')->on('users')->restrictOnDelete(); $table->index('generated_by'); });
        Schema::table('ledger_exports', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('bank_statement_lines', function (Blueprint $table) { $table->foreign('reconciliation_id')->references('id')->on('bank_reconciliations')->restrictOnDelete(); $table->index('reconciliation_id'); });
        Schema::table('bank_statement_lines', function (Blueprint $table) { $table->foreign('cash_account_id')->references('id')->on('cash_accounts')->restrictOnDelete(); $table->index('cash_account_id'); });
        Schema::table('bank_statement_lines', function (Blueprint $table) { $table->foreign('matched_line_id')->references('id')->on('journal_lines')->restrictOnDelete(); $table->index('matched_line_id'); });
        Schema::table('bank_statement_lines', function (Blueprint $table) { $table->foreign('booked_entry_id')->references('id')->on('journal_entries')->restrictOnDelete(); $table->index('booked_entry_id'); });
        Schema::table('bank_statement_lines', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('bank_reconciliations', function (Blueprint $table) { $table->foreign('company_id')->references('id')->on('companies')->restrictOnDelete(); $table->index('company_id'); });
        Schema::table('bank_reconciliations', function (Blueprint $table) { $table->foreign('cash_account_id')->references('id')->on('cash_accounts')->restrictOnDelete(); $table->index('cash_account_id'); });
        Schema::table('bank_reconciliations', function (Blueprint $table) { $table->foreign('imported_by')->references('id')->on('users')->restrictOnDelete(); $table->index('imported_by'); });
        Schema::table('bank_reconciliations', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('period_close_tasks', function (Blueprint $table) { $table->foreign('company_id')->references('id')->on('companies')->restrictOnDelete(); $table->index('company_id'); });
        Schema::table('period_close_tasks', function (Blueprint $table) { $table->foreign('done_by')->references('id')->on('users')->restrictOnDelete(); $table->index('done_by'); });
        Schema::table('period_close_tasks', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('payroll_journal_imports', function (Blueprint $table) { $table->foreign('company_id')->references('id')->on('companies')->restrictOnDelete(); $table->index('company_id'); });
        Schema::table('payroll_journal_imports', function (Blueprint $table) { $table->foreign('imported_by')->references('id')->on('users')->restrictOnDelete(); $table->index('imported_by'); });
        Schema::table('payroll_journal_imports', function (Blueprint $table) { $table->foreign('entry_id')->references('id')->on('journal_entries')->restrictOnDelete(); $table->index('entry_id'); });
        Schema::table('payroll_journal_imports', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('fs_templates', function (Blueprint $table) { $table->foreign('company_id')->references('id')->on('companies')->restrictOnDelete(); $table->index('company_id'); });
        Schema::table('fs_templates', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('fs_template_lines', function (Blueprint $table) { $table->foreign('template_id')->references('id')->on('fs_templates')->restrictOnDelete(); $table->index('template_id'); });
        Schema::table('fs_template_lines', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });

        DB::statement("SELECT enable_tenant_rls('gl_accounts')");
        DB::statement("SELECT audit.track('gl_accounts')");
        DB::statement("SELECT enable_tenant_rls('journal_rules')");
        DB::statement("SELECT audit.track('journal_rules')");
        DB::statement("SELECT enable_tenant_rls('journal_rule_lines')");
        DB::statement("SELECT audit.track('journal_rule_lines')");
        DB::statement("SELECT enable_tenant_rls('journal_entries')");
        DB::statement("SELECT audit.track('journal_entries')");
        DB::statement("SELECT enable_tenant_rls('journal_lines')");
        DB::statement("SELECT audit.track('journal_lines')");
        DB::statement("SELECT enable_tenant_rls('accountant_inbox_items')");
        DB::statement("SELECT audit.track('accountant_inbox_items')");
        DB::statement("SELECT enable_tenant_rls('sire_proposals')");
        DB::statement("SELECT audit.track('sire_proposals')");
        DB::statement("SELECT enable_tenant_rls('sire_proposal_lines')");
        DB::statement("SELECT audit.track('sire_proposal_lines')");
        DB::statement("SELECT enable_tenant_rls('sire_submissions')");
        DB::statement("SELECT audit.track('sire_submissions')");
        DB::statement("SELECT enable_tenant_rls('cnt_fiscal_years')");
        DB::statement("SELECT audit.track('cnt_fiscal_years')");
        DB::statement("SELECT enable_tenant_rls('ledger_exports')");
        DB::statement("SELECT audit.track('ledger_exports')");
        DB::statement("SELECT enable_tenant_rls('bank_statement_lines')");
        DB::statement("SELECT audit.track('bank_statement_lines')");
        DB::statement("SELECT enable_tenant_rls('bank_reconciliations')");
        DB::statement("SELECT audit.track('bank_reconciliations')");
        DB::statement("SELECT enable_tenant_rls('period_close_tasks')");
        DB::statement("SELECT audit.track('period_close_tasks')");
        DB::statement("SELECT enable_tenant_rls('payroll_journal_imports')");
        DB::statement("SELECT audit.track('payroll_journal_imports')");
        DB::statement("SELECT enable_tenant_rls('fs_templates')");
        DB::statement("SELECT audit.track('fs_templates')");
        DB::statement("SELECT enable_tenant_rls('fs_template_lines')");
        DB::statement("SELECT audit.track('fs_template_lines')");
    }

    public function down(): void
    {
        DB::statement('DROP TABLE IF EXISTS fs_template_lines CASCADE');
        DB::statement('DROP TABLE IF EXISTS fs_templates CASCADE');
        DB::statement('DROP TABLE IF EXISTS payroll_journal_imports CASCADE');
        DB::statement('DROP TABLE IF EXISTS period_close_tasks CASCADE');
        DB::statement('DROP TABLE IF EXISTS bank_reconciliations CASCADE');
        DB::statement('DROP TABLE IF EXISTS bank_statement_lines CASCADE');
        DB::statement('DROP TABLE IF EXISTS ledger_exports CASCADE');
        DB::statement('DROP TABLE IF EXISTS cnt_fiscal_years CASCADE');
        DB::statement('DROP TABLE IF EXISTS sire_submissions CASCADE');
        DB::statement('DROP TABLE IF EXISTS sire_proposal_lines CASCADE');
        DB::statement('DROP TABLE IF EXISTS sire_proposals CASCADE');
        DB::statement('DROP TABLE IF EXISTS accountant_inbox_items CASCADE');
        DB::statement('DROP TABLE IF EXISTS journal_lines CASCADE');
        DB::statement('DROP TABLE IF EXISTS journal_entries CASCADE');
        DB::statement('DROP TABLE IF EXISTS journal_rule_lines CASCADE');
        DB::statement('DROP TABLE IF EXISTS journal_rules CASCADE');
        DB::statement('DROP TABLE IF EXISTS gl_accounts CASCADE');
    }
};
