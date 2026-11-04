<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Relaciones entre módulos cuyo destino se crea en una migración posterior a la de su tabla.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('accounting_period_events', function (Blueprint $table) { $table->foreign('acted_by')->references('id')->on('users')->restrictOnDelete(); $table->index('acted_by'); });
        Schema::table('users', function (Blueprint $table) { $table->foreign('employee_id')->references('id')->on('employees')->restrictOnDelete(); $table->index('employee_id'); });
        Schema::table('users', function (Blueprint $table) { $table->foreign('customer_id')->references('id')->on('customers')->restrictOnDelete(); $table->index('customer_id'); });
        Schema::table('payment_methods', function (Blueprint $table) { $table->foreign('connector_id')->references('id')->on('integration_connectors')->restrictOnDelete(); $table->index('connector_id'); });
        Schema::table('sales_orders', function (Blueprint $table) { $table->foreign('web_store_id')->references('id')->on('web_stores')->restrictOnDelete(); $table->index('web_store_id'); });
        Schema::table('sales_orders', function (Blueprint $table) { $table->foreign('web_inbox_id')->references('id')->on('web_order_inbox')->restrictOnDelete(); $table->index('web_inbox_id'); });
        Schema::table('sales_orders', function (Blueprint $table) { $table->foreign('pos_shift_id')->references('id')->on('pos_shifts')->restrictOnDelete(); $table->index('pos_shift_id'); });
        Schema::table('sales_orders', function (Blueprint $table) { $table->foreign('pos_terminal_id')->references('id')->on('pos_terminals')->restrictOnDelete(); $table->index('pos_terminal_id'); });
        Schema::table('sales_orders', function (Blueprint $table) { $table->foreign('conversation_id')->references('id')->on('conversations')->restrictOnDelete(); $table->index('conversation_id'); });
        Schema::table('pos_terminals', function (Blueprint $table) { $table->foreign('warehouse_id')->references('id')->on('warehouses')->restrictOnDelete(); $table->index('warehouse_id'); });
        Schema::table('pos_terminals', function (Blueprint $table) { $table->foreign('cash_account_id')->references('id')->on('cash_accounts')->restrictOnDelete(); $table->index('cash_account_id'); });
        Schema::table('pos_terminals', function (Blueprint $table) { $table->foreign('card_account_id')->references('id')->on('cash_accounts')->restrictOnDelete(); $table->index('card_account_id'); });
        Schema::table('province_shipments', function (Blueprint $table) { $table->foreign('dispatch_guide_id')->references('id')->on('dispatch_guides')->restrictOnDelete(); $table->index('dispatch_guide_id'); });
        Schema::table('delivery_costs', function (Blueprint $table) { $table->foreign('expense_id')->references('id')->on('expenses')->restrictOnDelete(); $table->index('expense_id'); });
        Schema::table('expenses', function (Blueprint $table) { $table->foreign('ad_campaign_id')->references('id')->on('ad_campaigns')->restrictOnDelete(); $table->index('ad_campaign_id'); });
        Schema::table('leads', function (Blueprint $table) { $table->foreign('ad_id')->references('id')->on('ad_ads')->restrictOnDelete(); $table->index('ad_id'); });
        Schema::table('conversations', function (Blueprint $table) { $table->foreign('ad_id')->references('id')->on('ad_ads')->restrictOnDelete(); $table->index('ad_id'); });
    }

    public function down(): void
    {
        Schema::table('accounting_period_events', fn (Blueprint $table) => $table->dropForeign(['acted_by']));
        Schema::table('users', fn (Blueprint $table) => $table->dropForeign(['employee_id']));
        Schema::table('users', fn (Blueprint $table) => $table->dropForeign(['customer_id']));
        Schema::table('payment_methods', fn (Blueprint $table) => $table->dropForeign(['connector_id']));
        Schema::table('sales_orders', fn (Blueprint $table) => $table->dropForeign(['web_store_id']));
        Schema::table('sales_orders', fn (Blueprint $table) => $table->dropForeign(['web_inbox_id']));
        Schema::table('sales_orders', fn (Blueprint $table) => $table->dropForeign(['pos_shift_id']));
        Schema::table('sales_orders', fn (Blueprint $table) => $table->dropForeign(['pos_terminal_id']));
        Schema::table('sales_orders', fn (Blueprint $table) => $table->dropForeign(['conversation_id']));
        Schema::table('pos_terminals', fn (Blueprint $table) => $table->dropForeign(['warehouse_id']));
        Schema::table('pos_terminals', fn (Blueprint $table) => $table->dropForeign(['cash_account_id']));
        Schema::table('pos_terminals', fn (Blueprint $table) => $table->dropForeign(['card_account_id']));
        Schema::table('province_shipments', fn (Blueprint $table) => $table->dropForeign(['dispatch_guide_id']));
        Schema::table('delivery_costs', fn (Blueprint $table) => $table->dropForeign(['expense_id']));
        Schema::table('expenses', fn (Blueprint $table) => $table->dropForeign(['ad_campaign_id']));
        Schema::table('leads', fn (Blueprint $table) => $table->dropForeign(['ad_id']));
        Schema::table('conversations', fn (Blueprint $table) => $table->dropForeign(['ad_id']));
    }
};
