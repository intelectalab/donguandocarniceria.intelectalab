<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// WEB · generada desde el modelo del prototipo (tools/prototipo/generar_migraciones.py).
// Tablas: web_stores, web_product_mappings, web_order_inbox, web_sync_runs, gateway_transactions.
// El dueño del módulo revisa tipos, únicos y estados antes de construir sus pantallas;
// los cambios se hacen con migraciones nuevas, no editando esta.
return new class extends Migration
{
    public function up(): void
    {
        // WEB · web_stores
        Schema::create('web_stores', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->string('code', 20)->comment('valores en el prototipo: DGCOM, GOURMET, STAGING');
            $table->string('name', 80);
            $table->string('url', 80);
            $table->string('platform', 40)->comment('valores en el prototipo: WOOCOMMERCE');
            $table->string('theme', 20);
            $table->uuid('brand_id');
            $table->jsonb('brands')->comment('lista de ids');
            $table->uuid('price_list_id');
            $table->jsonb('price_lists');
            $table->uuid('establishment_id');
            $table->jsonb('warehouse_ids')->comment('lista de ids');
            $table->decimal('safety_margin_pct', 9, 4);
            $table->uuid('default_seller_id');
            $table->boolean('sync_catalog')->default(false);
            $table->boolean('sync_prices')->default(false);
            $table->boolean('sync_stock')->default(false);
            $table->boolean('sync_orders')->default(false);
            $table->uuid('connector_id')->nullable();
            $table->uuid('payment_connector_id')->nullable();
            $table->uuid('webhook_endpoint_id')->nullable();
            $table->uuid('payment_endpoint_id')->nullable();
            $table->string('status', 20)->comment('valores en el prototipo: ACTIVE, PENDING, TESTING');
            $table->boolean('split_mixed_cart')->default(false);
            $table->timestampTz('last_test_at')->nullable();
            $table->boolean('last_test_ok')->nullable();
            $table->string('last_test_msg', 255)->nullable();
            $table->string('created_by', 40);
            $table->jsonb('history');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // WEB · web_product_mappings
        Schema::create('web_product_mappings', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('store_id');
            $table->string('sku', 40);
            $table->uuid('variant_id')->nullable();
            $table->uuid('brand_id');
            $table->integer('woo_product_id');
            $table->integer('woo_variation_id');
            $table->string('woo_name', 80);
            $table->string('status', 20)->comment('valores en el prototipo: ERROR, LINKED, UNLINKED');
            $table->boolean('remote_missing')->nullable();
            $table->string('last_error', 255)->nullable();
            $table->timestampTz('last_error_at')->nullable();
            $table->boolean('publish')->default(false);
            $table->string('web_status', 20);
            $table->decimal('last_price_sent', 14, 2)->nullable();
            $table->timestampTz('last_price_at')->nullable();
            $table->timestampTz('last_stock_at')->nullable();
            $table->integer('seed_stock_offset')->nullable();
            $table->timestampTz('linked_at')->nullable();
            $table->string('linked_by', 40)->nullable();
            $table->jsonb('history');
            $table->integer('last_stock_sent')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // WEB · web_order_inbox
        Schema::create('web_order_inbox', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('store_id');
            $table->string('external_order_id', 20);
            $table->timestampTz('received_at');
            $table->string('source', 20)->comment('valores en el prototipo: POLL, WEBHOOK');
            $table->string('status', 40)->comment('valores en el prototipo: ERROR, IGNORED, PROCESSED');
            $table->jsonb('payload');
            $table->decimal('total', 14, 2);
            $table->string('customer_name', 80);
            $table->uuid('customer_id')->nullable();
            $table->uuid('address_id')->nullable();
            $table->jsonb('order_ids')->comment('lista de ids');
            $table->decimal('attempts', 14, 2);
            $table->decimal('auto_attempts', 14, 2);
            $table->boolean('manual_only')->default(false);
            $table->integer('duplicates');
            $table->boolean('ever_error')->default(false);
            $table->timestampTz('processed_at')->nullable();
            $table->jsonb('webhook_event_ids');
            $table->jsonb('history');
            $table->timestampTz('last_attempt_at')->nullable();
            $table->string('error_code', 40)->nullable()->comment('valores en el prototipo: PHONE_INVALID, SKU_NOT_MAPPED, VARIANT_INACTIVE');
            $table->text('error_detail')->nullable();
            $table->jsonb('error_skus')->nullable();
            $table->string('ignore_reason', 255)->nullable();
            $table->string('warning_code', 40)->nullable()->comment('valores en el prototipo: ADDRESS_NO_PIN');
            $table->jsonb('missing')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // WEB · web_sync_runs
        Schema::create('web_sync_runs', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->string('number', 40);
            $table->uuid('store_id');
            $table->string('kind', 20)->comment('valores en el prototipo: CATALOG, ORDERS, PRICES, STOCK');
            $table->string('trigger', 20)->comment('valores en el prototipo: MANUAL, SCHEDULE');
            $table->timestampTz('started_at');
            $table->timestampTz('finished_at');
            $table->string('status', 40)->comment('valores en el prototipo: COMPLETED, FAILED, PARTIAL');
            $table->integer('items_ok');
            $table->integer('items_failed');
            $table->jsonb('items');
            $table->text('detail');
            $table->string('triggered_by', 80);
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // WEB · gateway_transactions
        Schema::create('gateway_transactions', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->string('provider', 40)->comment('valores en el prototipo: MERCADOPAGO');
            $table->string('external_payment_id', 40);
            $table->uuid('store_id');
            $table->string('external_reference', 20);
            $table->uuid('inbox_id')->nullable();
            $table->jsonb('order_ids')->comment('lista de ids');
            $table->string('payment_method', 40);
            $table->string('payment_type', 40);
            $table->integer('installments');
            $table->string('card_last4', 20)->nullable();
            $table->string('payer_email', 80)->nullable();
            $table->timestampTz('date_created');
            $table->timestampTz('date_approved')->nullable();
            $table->date('money_release_date')->nullable();
            $table->string('status', 40);
            $table->text('status_detail');
            $table->decimal('amount', 14, 2);
            $table->decimal('fee_amount', 14, 2);
            $table->decimal('fee_igv', 14, 2);
            $table->decimal('net_amount', 14, 2);
            $table->uuid('payment_id')->nullable();
            $table->timestampTz('verified_at');
            $table->timestampTz('registered_at')->nullable();
            $table->jsonb('webhook_event_ids');
            $table->jsonb('history');
            $table->jsonb('raw');
            $table->timestampTz('reversed_at')->nullable();
            $table->string('reverse_result', 80)->nullable();
            $table->jsonb('credit_notes')->nullable();
            $table->timestampTz('expired_at')->nullable();
            $table->timestampTz('customer_notified_at')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });

        Schema::table('web_stores', function (Blueprint $table) { $table->foreign('brand_id')->references('id')->on('brands')->restrictOnDelete(); $table->index('brand_id'); });
        Schema::table('web_stores', function (Blueprint $table) { $table->foreign('price_list_id')->references('id')->on('price_lists')->restrictOnDelete(); $table->index('price_list_id'); });
        Schema::table('web_stores', function (Blueprint $table) { $table->foreign('establishment_id')->references('id')->on('establishments')->restrictOnDelete(); $table->index('establishment_id'); });
        Schema::table('web_stores', function (Blueprint $table) { $table->foreign('default_seller_id')->references('id')->on('users')->restrictOnDelete(); $table->index('default_seller_id'); });
        Schema::table('web_stores', function (Blueprint $table) { $table->foreign('connector_id')->references('id')->on('integration_connectors')->restrictOnDelete(); $table->index('connector_id'); });
        Schema::table('web_stores', function (Blueprint $table) { $table->foreign('payment_connector_id')->references('id')->on('integration_connectors')->restrictOnDelete(); $table->index('payment_connector_id'); });
        Schema::table('web_stores', function (Blueprint $table) { $table->foreign('webhook_endpoint_id')->references('id')->on('webhook_endpoints')->restrictOnDelete(); $table->index('webhook_endpoint_id'); });
        Schema::table('web_stores', function (Blueprint $table) { $table->foreign('payment_endpoint_id')->references('id')->on('webhook_endpoints')->restrictOnDelete(); $table->index('payment_endpoint_id'); });
        Schema::table('web_stores', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('web_product_mappings', function (Blueprint $table) { $table->foreign('store_id')->references('id')->on('web_stores')->restrictOnDelete(); $table->index('store_id'); });
        Schema::table('web_product_mappings', function (Blueprint $table) { $table->foreign('variant_id')->references('id')->on('product_variants')->restrictOnDelete(); $table->index('variant_id'); });
        Schema::table('web_product_mappings', function (Blueprint $table) { $table->foreign('brand_id')->references('id')->on('brands')->restrictOnDelete(); $table->index('brand_id'); });
        Schema::table('web_product_mappings', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('web_order_inbox', function (Blueprint $table) { $table->foreign('store_id')->references('id')->on('web_stores')->restrictOnDelete(); $table->index('store_id'); });
        Schema::table('web_order_inbox', function (Blueprint $table) { $table->foreign('customer_id')->references('id')->on('customers')->restrictOnDelete(); $table->index('customer_id'); });
        Schema::table('web_order_inbox', function (Blueprint $table) { $table->foreign('address_id')->references('id')->on('customer_addresses')->restrictOnDelete(); $table->index('address_id'); });
        Schema::table('web_order_inbox', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('web_sync_runs', function (Blueprint $table) { $table->foreign('store_id')->references('id')->on('web_stores')->restrictOnDelete(); $table->index('store_id'); });
        Schema::table('web_sync_runs', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('gateway_transactions', function (Blueprint $table) { $table->foreign('store_id')->references('id')->on('web_stores')->restrictOnDelete(); $table->index('store_id'); });
        Schema::table('gateway_transactions', function (Blueprint $table) { $table->foreign('inbox_id')->references('id')->on('web_order_inbox')->restrictOnDelete(); $table->index('inbox_id'); });
        Schema::table('gateway_transactions', function (Blueprint $table) { $table->foreign('payment_id')->references('id')->on('payments')->restrictOnDelete(); $table->index('payment_id'); });
        Schema::table('gateway_transactions', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });

        DB::statement("SELECT enable_tenant_rls('web_stores')");
        DB::statement("SELECT enable_tenant_rls('web_product_mappings')");
        DB::statement("SELECT enable_tenant_rls('web_order_inbox')");
        DB::statement("SELECT enable_tenant_rls('web_sync_runs')");
        DB::statement("SELECT enable_tenant_rls('gateway_transactions')");
    }

    public function down(): void
    {
        DB::statement('DROP TABLE IF EXISTS gateway_transactions CASCADE');
        DB::statement('DROP TABLE IF EXISTS web_sync_runs CASCADE');
        DB::statement('DROP TABLE IF EXISTS web_order_inbox CASCADE');
        DB::statement('DROP TABLE IF EXISTS web_product_mappings CASCADE');
        DB::statement('DROP TABLE IF EXISTS web_stores CASCADE');
    }
};
