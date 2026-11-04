<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// CAJ · generada desde el modelo del prototipo (tools/prototipo/generar_migraciones.py).
// Tablas: cash_accounts, payments, payment_allocations, customer_balance_movements, driver_settlements, settlement_batches, settlement_batch_items, cash_transfers.
// El dueño del módulo revisa tipos, únicos y estados antes de construir sus pantallas;
// los cambios se hacen con migraciones nuevas, no editando esta.
return new class extends Migration
{
    public function up(): void
    {
        // CAJ · cash_accounts
        Schema::create('cash_accounts', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->string('code', 40);
            $table->string('name', 80);
            $table->string('account_type', 40)->comment('valores en el prototipo: BANK, CARD_ACQUIRER, CASH_REGISTER, DRIVER_CASH, GATEWAY, PETTY_CASH, WALLET');
            $table->uuid('establishment_id')->nullable();
            $table->string('currency', 20)->comment('valores en el prototipo: PEN');
            $table->string('bank_name', 40)->nullable();
            $table->string('account_number', 40)->nullable();
            $table->string('status', 20)->comment('valores en el prototipo: ACTIVE');
            $table->decimal('fee_pct', 9, 4)->nullable();
            $table->decimal('fee_fixed', 14, 2)->nullable();
            $table->integer('settlement_days')->nullable();
            $table->string('brand_id', 20)->nullable();
            $table->decimal('opening_balance', 14, 2)->nullable();
            $table->uuid('holder_employee_id')->nullable();
            $table->string('cci', 80)->nullable();
            $table->text('qr_payload')->nullable();
            $table->string('holder_name', 80)->nullable();
            $table->string('payment_link_base', 255)->nullable();
            $table->uuid('user_id')->nullable();
            $table->decimal('max_balance', 14, 2)->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // CAJ · payments
        Schema::create('payments', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->string('number', 40);
            $table->uuid('customer_id');
            $table->uuid('payment_method_id');
            $table->uuid('cash_account_id');
            $table->decimal('amount', 14, 2);
            $table->timestampTz('paid_at');
            $table->string('reference', 40)->nullable();
            $table->string('status', 40)->comment('valores en el prototipo: CONFIRMED, REVERSED');
            $table->uuid('brand_id');
            $table->uuid('establishment_id');
            $table->decimal('fee_amount', 14, 2);
            $table->string('reconciliation_status', 40)->comment('valores en el prototipo: DIFFERENCE, MATCHED, NOT_APPLICABLE, PENDING');
            $table->uuid('received_by')->nullable();
            $table->uuid('collected_by_user_id')->nullable();
            $table->string('gateway_transaction_id', 40)->nullable();
            $table->decimal('fee_igv', 14, 2)->nullable();
            $table->decimal('to_balance', 14, 2)->nullable();
            $table->uuid('settlement_batch_id')->nullable();
            $table->timestampTz('matched_at')->nullable();
            $table->uuid('driver_settlement_id')->nullable();
            $table->string('card_brand', 40)->nullable()->comment('valores en el prototipo: MASTERCARD, VISA');
            $table->string('card_last4', 20)->nullable();
            $table->string('reversal_reason', 255)->nullable();
            $table->timestampTz('reversed_at')->nullable();
            $table->string('reversed_by', 40)->nullable();
            $table->uuid('pos_shift_id')->nullable();
            $table->string('pos_ticket', 40)->nullable();
            $table->decimal('cash_given', 14, 2)->nullable();
            $table->decimal('change_given', 14, 2)->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // CAJ · payment_allocations
        Schema::create('payment_allocations', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('payment_id');
            $table->integer('line_no')->default(1);
            $table->uuid('order_id');
            $table->uuid('document_id');
            $table->decimal('amount', 14, 2);
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // CAJ · customer_balance_movements
        Schema::create('customer_balance_movements', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('customer_id');
            $table->string('movement_type', 40)->comment('valores en el prototipo: OVERPAYMENT, REFUND');
            $table->decimal('amount', 14, 2);
            $table->uuid('order_id')->nullable();
            $table->uuid('payment_id')->nullable();
            $table->string('document_id', 20)->nullable();
            $table->string('reason', 255);
            $table->timestampTz('at');
            $table->string('user', 40);
            $table->uuid('refund_account_id')->nullable();
            $table->string('refund_reference', 40)->nullable()->comment('valores en el prototipo: OP88120034');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // CAJ · driver_settlements
        Schema::create('driver_settlements', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->string('number', 40);
            $table->uuid('driver_employee_id');
            $table->uuid('driver_cash_account_id');
            $table->uuid('receiving_account_id');
            $table->date('settlement_date');
            $table->uuid('route_ref')->nullable();
            $table->decimal('expected_cash', 14, 2);
            $table->integer('expected_digital');
            $table->decimal('delivered_cash', 14, 2);
            $table->integer('difference');
            $table->string('difference_reason', 255)->nullable();
            $table->string('status', 40)->comment('valores en el prototipo: APPROVED, SETTLED, WITH_DIFFERENCE');
            $table->uuid('received_by');
            $table->timestampTz('settled_at');
            $table->uuid('settled_by')->nullable();
            $table->uuid('approved_by')->nullable();
            $table->timestampTz('approved_at')->nullable();
            $table->uuid('driver_user_id')->nullable();
            $table->jsonb('payment_ids')->nullable()->comment('lista de ids');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // CAJ · settlement_batches
        Schema::create('settlement_batches', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('source_account_id');
            $table->uuid('bank_account_id');
            $table->date('deposit_date');
            $table->string('reference', 80);
            $table->decimal('gross_amount', 14, 2);
            $table->decimal('fee_amount', 14, 2);
            $table->decimal('fee_igv', 14, 2);
            $table->decimal('net_amount', 14, 2);
            $table->string('status', 40)->comment('valores en el prototipo: MATCHED, OPEN, WITH_DIFFERENCE');
            $table->string('kind', 40)->comment('valores en el prototipo: SETTLEMENT, STATEMENT');
            $table->boolean('imported')->default(false);
            $table->string('created_by', 40);
            $table->string('difference_reason', 255)->nullable();
            $table->timestampTz('closed_at')->nullable();
            $table->string('closed_by', 40)->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // CAJ · settlement_batch_items
        Schema::create('settlement_batch_items', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('batch_id');
            $table->uuid('payment_id');
            $table->decimal('gross_amount', 14, 2);
            $table->decimal('fee_amount', 14, 2);
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // CAJ · cash_transfers
        Schema::create('cash_transfers', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('from_account_id');
            $table->uuid('to_account_id');
            $table->decimal('amount', 14, 2);
            $table->timestampTz('transferred_at');
            $table->string('reference', 40);
            $table->string('reason', 255);
            $table->string('status', 40)->comment('valores en el prototipo: CONFIRMED');
            $table->uuid('batch_id')->nullable();
            $table->uuid('settlement_id')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });

        Schema::table('cash_accounts', function (Blueprint $table) { $table->foreign('establishment_id')->references('id')->on('establishments')->restrictOnDelete(); $table->index('establishment_id'); });
        Schema::table('cash_accounts', function (Blueprint $table) { $table->foreign('holder_employee_id')->references('id')->on('employees')->restrictOnDelete(); $table->index('holder_employee_id'); });
        Schema::table('cash_accounts', function (Blueprint $table) { $table->foreign('user_id')->references('id')->on('users')->restrictOnDelete(); $table->index('user_id'); });
        Schema::table('cash_accounts', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('payments', function (Blueprint $table) { $table->foreign('customer_id')->references('id')->on('customers')->restrictOnDelete(); $table->index('customer_id'); });
        Schema::table('payments', function (Blueprint $table) { $table->foreign('payment_method_id')->references('id')->on('payment_methods')->restrictOnDelete(); $table->index('payment_method_id'); });
        Schema::table('payments', function (Blueprint $table) { $table->foreign('cash_account_id')->references('id')->on('cash_accounts')->restrictOnDelete(); $table->index('cash_account_id'); });
        Schema::table('payments', function (Blueprint $table) { $table->foreign('brand_id')->references('id')->on('brands')->restrictOnDelete(); $table->index('brand_id'); });
        Schema::table('payments', function (Blueprint $table) { $table->foreign('establishment_id')->references('id')->on('establishments')->restrictOnDelete(); $table->index('establishment_id'); });
        Schema::table('payments', function (Blueprint $table) { $table->foreign('received_by')->references('id')->on('users')->restrictOnDelete(); $table->index('received_by'); });
        Schema::table('payments', function (Blueprint $table) { $table->foreign('collected_by_user_id')->references('id')->on('users')->restrictOnDelete(); $table->index('collected_by_user_id'); });
        Schema::table('payments', function (Blueprint $table) { $table->foreign('settlement_batch_id')->references('id')->on('settlement_batches')->restrictOnDelete(); $table->index('settlement_batch_id'); });
        Schema::table('payments', function (Blueprint $table) { $table->foreign('driver_settlement_id')->references('id')->on('driver_settlements')->restrictOnDelete(); $table->index('driver_settlement_id'); });
        Schema::table('payments', function (Blueprint $table) { $table->foreign('pos_shift_id')->references('id')->on('pos_shifts')->restrictOnDelete(); $table->index('pos_shift_id'); });
        Schema::table('payments', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('payment_allocations', function (Blueprint $table) { $table->foreign('payment_id')->references('id')->on('payments')->cascadeOnDelete(); $table->index('payment_id'); });
        Schema::table('payment_allocations', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('customer_balance_movements', function (Blueprint $table) { $table->foreign('customer_id')->references('id')->on('customers')->restrictOnDelete(); $table->index('customer_id'); });
        Schema::table('customer_balance_movements', function (Blueprint $table) { $table->foreign('order_id')->references('id')->on('sales_orders')->restrictOnDelete(); $table->index('order_id'); });
        Schema::table('customer_balance_movements', function (Blueprint $table) { $table->foreign('payment_id')->references('id')->on('payments')->restrictOnDelete(); $table->index('payment_id'); });
        Schema::table('customer_balance_movements', function (Blueprint $table) { $table->foreign('refund_account_id')->references('id')->on('cash_accounts')->restrictOnDelete(); $table->index('refund_account_id'); });
        Schema::table('customer_balance_movements', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('driver_settlements', function (Blueprint $table) { $table->foreign('driver_employee_id')->references('id')->on('employees')->restrictOnDelete(); $table->index('driver_employee_id'); });
        Schema::table('driver_settlements', function (Blueprint $table) { $table->foreign('driver_cash_account_id')->references('id')->on('cash_accounts')->restrictOnDelete(); $table->index('driver_cash_account_id'); });
        Schema::table('driver_settlements', function (Blueprint $table) { $table->foreign('receiving_account_id')->references('id')->on('cash_accounts')->restrictOnDelete(); $table->index('receiving_account_id'); });
        Schema::table('driver_settlements', function (Blueprint $table) { $table->foreign('route_ref')->references('id')->on('delivery_routes')->restrictOnDelete(); $table->index('route_ref'); });
        Schema::table('driver_settlements', function (Blueprint $table) { $table->foreign('received_by')->references('id')->on('users')->restrictOnDelete(); $table->index('received_by'); });
        Schema::table('driver_settlements', function (Blueprint $table) { $table->foreign('settled_by')->references('id')->on('users')->restrictOnDelete(); $table->index('settled_by'); });
        Schema::table('driver_settlements', function (Blueprint $table) { $table->foreign('approved_by')->references('id')->on('users')->restrictOnDelete(); $table->index('approved_by'); });
        Schema::table('driver_settlements', function (Blueprint $table) { $table->foreign('driver_user_id')->references('id')->on('users')->restrictOnDelete(); $table->index('driver_user_id'); });
        Schema::table('driver_settlements', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('settlement_batches', function (Blueprint $table) { $table->foreign('source_account_id')->references('id')->on('cash_accounts')->restrictOnDelete(); $table->index('source_account_id'); });
        Schema::table('settlement_batches', function (Blueprint $table) { $table->foreign('bank_account_id')->references('id')->on('cash_accounts')->restrictOnDelete(); $table->index('bank_account_id'); });
        Schema::table('settlement_batches', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('settlement_batch_items', function (Blueprint $table) { $table->foreign('batch_id')->references('id')->on('settlement_batches')->restrictOnDelete(); $table->index('batch_id'); });
        Schema::table('settlement_batch_items', function (Blueprint $table) { $table->foreign('payment_id')->references('id')->on('payments')->restrictOnDelete(); $table->index('payment_id'); });
        Schema::table('settlement_batch_items', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('cash_transfers', function (Blueprint $table) { $table->foreign('from_account_id')->references('id')->on('cash_accounts')->restrictOnDelete(); $table->index('from_account_id'); });
        Schema::table('cash_transfers', function (Blueprint $table) { $table->foreign('to_account_id')->references('id')->on('cash_accounts')->restrictOnDelete(); $table->index('to_account_id'); });
        Schema::table('cash_transfers', function (Blueprint $table) { $table->foreign('batch_id')->references('id')->on('settlement_batches')->restrictOnDelete(); $table->index('batch_id'); });
        Schema::table('cash_transfers', function (Blueprint $table) { $table->foreign('settlement_id')->references('id')->on('driver_settlements')->restrictOnDelete(); $table->index('settlement_id'); });
        Schema::table('cash_transfers', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });

        DB::statement("SELECT enable_tenant_rls('cash_accounts')");
        Schema::table('payments', fn (Blueprint $table) => $table->unique(['tenant_id', 'number']));
        DB::statement("SELECT enable_tenant_rls('payments')");
        DB::statement("SELECT enable_tenant_rls('payment_allocations')");
        DB::statement("SELECT enable_tenant_rls('customer_balance_movements')");
        DB::statement('REVOKE UPDATE, DELETE, TRUNCATE ON customer_balance_movements FROM aycha_app');  // solo inserción
        DB::statement("SELECT enable_tenant_rls('driver_settlements')");
        DB::statement("SELECT enable_tenant_rls('settlement_batches')");
        DB::statement("SELECT enable_tenant_rls('settlement_batch_items')");
        DB::statement("SELECT enable_tenant_rls('cash_transfers')");
    }

    public function down(): void
    {
        DB::statement('DROP TABLE IF EXISTS cash_transfers CASCADE');
        DB::statement('DROP TABLE IF EXISTS settlement_batch_items CASCADE');
        DB::statement('DROP TABLE IF EXISTS settlement_batches CASCADE');
        DB::statement('DROP TABLE IF EXISTS driver_settlements CASCADE');
        DB::statement('DROP TABLE IF EXISTS customer_balance_movements CASCADE');
        DB::statement('DROP TABLE IF EXISTS payment_allocations CASCADE');
        DB::statement('DROP TABLE IF EXISTS payments CASCADE');
        DB::statement('DROP TABLE IF EXISTS cash_accounts CASCADE');
    }
};
