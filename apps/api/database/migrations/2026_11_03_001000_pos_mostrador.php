<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// POS · generada desde el modelo del prototipo (tools/prototipo/generar_migraciones.py).
// Tablas: pos_terminals, pos_shifts, pos_shift_counts, pos_cash_movements.
// El dueño del módulo revisa tipos, únicos y estados antes de construir sus pantallas;
// los cambios se hacen con migraciones nuevas, no editando esta.
return new class extends Migration
{
    public function up(): void
    {
        // POS · pos_terminals
        Schema::create('pos_terminals', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->string('code', 20)->nullable();
            $table->string('name', 40)->nullable();
            $table->uuid('establishment_id')->nullable();
            $table->uuid('warehouse_id')->nullable();
            $table->uuid('cash_account_id')->nullable();
            $table->uuid('card_account_id')->nullable();
            $table->uuid('receipt_series_id')->nullable();
            $table->string('invoice_series_id', 20)->nullable();
            $table->string('scale_mode', 20)->nullable()->comment('valores en el prototipo: LABEL');
            $table->uuid('default_price_list_id')->nullable();
            $table->string('status', 20)->nullable()->comment('valores en el prototipo: ACTIVE');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // POS · pos_shifts
        Schema::create('pos_shifts', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->string('number', 40);
            $table->uuid('terminal_id');
            $table->uuid('establishment_id');
            $table->uuid('cashier_user_id');
            $table->string('cashier_name', 40);
            $table->timestampTz('opened_at');
            $table->integer('opening_float');
            $table->jsonb('opening_counts');
            $table->string('status', 20)->comment('valores en el prototipo: APPROVED, CLOSED, OPEN');
            $table->timestampTz('closed_at')->nullable();
            $table->decimal('expected_cash', 14, 2)->nullable();
            $table->decimal('counted_cash', 14, 2)->nullable();
            $table->decimal('difference', 14, 2)->nullable();
            $table->string('difference_reason', 255)->nullable();
            $table->uuid('approved_by')->nullable();
            $table->uuid('closed_by')->nullable();
            $table->decimal('total_difference', 14, 2)->nullable();
            $table->string('closing_denoms', 20)->nullable();
            $table->string('approved_by_name', 40)->nullable();
            $table->timestampTz('approved_at')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // POS · pos_shift_counts
        Schema::create('pos_shift_counts', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('shift_id');
            $table->uuid('payment_method_id');
            $table->decimal('expected_amount', 14, 2);
            $table->decimal('counted_amount', 14, 2);
            $table->decimal('difference', 14, 2);
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // POS · pos_cash_movements
        Schema::create('pos_cash_movements', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('shift_id');
            $table->timestampTz('moved_at');
            $table->uuid('user_id');
            $table->string('user_name', 40);
            $table->string('movement_type', 40)->comment('valores en el prototipo: CASH_IN, CASH_OUT, PETTY_EXPENSE');
            $table->decimal('amount', 14, 2);
            $table->string('reason', 80);
            $table->uuid('authorized_by')->nullable();
            $table->string('authorized_by_name', 40)->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });

        Schema::table('pos_terminals', function (Blueprint $table) { $table->foreign('establishment_id')->references('id')->on('establishments')->restrictOnDelete(); $table->index('establishment_id'); });
        Schema::table('pos_terminals', function (Blueprint $table) { $table->foreign('receipt_series_id')->references('id')->on('document_series')->restrictOnDelete(); $table->index('receipt_series_id'); });
        Schema::table('pos_terminals', function (Blueprint $table) { $table->foreign('default_price_list_id')->references('id')->on('price_lists')->restrictOnDelete(); $table->index('default_price_list_id'); });
        Schema::table('pos_terminals', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('pos_shifts', function (Blueprint $table) { $table->foreign('terminal_id')->references('id')->on('pos_terminals')->restrictOnDelete(); $table->index('terminal_id'); });
        Schema::table('pos_shifts', function (Blueprint $table) { $table->foreign('establishment_id')->references('id')->on('establishments')->restrictOnDelete(); $table->index('establishment_id'); });
        Schema::table('pos_shifts', function (Blueprint $table) { $table->foreign('cashier_user_id')->references('id')->on('users')->restrictOnDelete(); $table->index('cashier_user_id'); });
        Schema::table('pos_shifts', function (Blueprint $table) { $table->foreign('approved_by')->references('id')->on('users')->restrictOnDelete(); $table->index('approved_by'); });
        Schema::table('pos_shifts', function (Blueprint $table) { $table->foreign('closed_by')->references('id')->on('users')->restrictOnDelete(); $table->index('closed_by'); });
        Schema::table('pos_shifts', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('pos_shift_counts', function (Blueprint $table) { $table->foreign('shift_id')->references('id')->on('pos_shifts')->restrictOnDelete(); $table->index('shift_id'); });
        Schema::table('pos_shift_counts', function (Blueprint $table) { $table->foreign('payment_method_id')->references('id')->on('payment_methods')->restrictOnDelete(); $table->index('payment_method_id'); });
        Schema::table('pos_shift_counts', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('pos_cash_movements', function (Blueprint $table) { $table->foreign('shift_id')->references('id')->on('pos_shifts')->restrictOnDelete(); $table->index('shift_id'); });
        Schema::table('pos_cash_movements', function (Blueprint $table) { $table->foreign('user_id')->references('id')->on('users')->restrictOnDelete(); $table->index('user_id'); });
        Schema::table('pos_cash_movements', function (Blueprint $table) { $table->foreign('authorized_by')->references('id')->on('users')->restrictOnDelete(); $table->index('authorized_by'); });
        Schema::table('pos_cash_movements', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });

        DB::statement("SELECT enable_tenant_rls('pos_terminals')");
        DB::statement("SELECT enable_tenant_rls('pos_shifts')");
        DB::statement("SELECT enable_tenant_rls('pos_shift_counts')");
        DB::statement("SELECT enable_tenant_rls('pos_cash_movements')");
        DB::statement('REVOKE UPDATE, DELETE, TRUNCATE ON pos_cash_movements FROM aycha_app');  // solo inserción
    }

    public function down(): void
    {
        DB::statement('DROP TABLE IF EXISTS pos_cash_movements CASCADE');
        DB::statement('DROP TABLE IF EXISTS pos_shift_counts CASCADE');
        DB::statement('DROP TABLE IF EXISTS pos_shifts CASCADE');
        DB::statement('DROP TABLE IF EXISTS pos_terminals CASCADE');
    }
};
