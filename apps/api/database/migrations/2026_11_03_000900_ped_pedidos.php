<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// PED · generada desde el modelo del prototipo (tools/prototipo/generar_migraciones.py).
// Tablas: sales_orders, sales_order_lines, order_time_slots, order_cancel_reasons, discount_limits, sales_order_status_history, order_reschedules, order_discount_approvals, order_weight_notices.
// El dueño del módulo revisa tipos, únicos y estados antes de construir sus pantallas;
// los cambios se hacen con migraciones nuevas, no editando esta.
return new class extends Migration
{
    public function up(): void
    {
        // PED · sales_orders
        Schema::create('sales_orders', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->string('number', 20);
            $table->uuid('brand_id');
            $table->uuid('establishment_id');
            $table->string('channel', 40)->comment('valores en el prototipo: B2B, COUNTER, FACEBOOK, INSTAGRAM, PHONE, TIKTOK, WEB, WHATSAPP');
            $table->uuid('customer_id');
            $table->uuid('address_id')->nullable();
            $table->uuid('seller_id')->nullable();
            $table->string('fulfillment', 40)->comment('valores en el prototipo: COUNTER, DELIVERY, PICKUP, PROVINCE_SHIPPING');
            $table->date('delivery_date')->nullable();
            $table->uuid('slot_id')->nullable();
            $table->time('slot_from')->nullable();
            $table->time('slot_to')->nullable();
            $table->string('requested_doc_type', 20)->comment('valores en el prototipo: INVOICE, RECEIPT');
            $table->uuid('billing_customer_id');
            $table->uuid('payment_method_id')->nullable();
            $table->string('status', 40)->comment('valores en el prototipo: CANCELLED, CLOSED, CONFIRMED, DELIVERED, DRAFT, IN_PREPARATION, IN_ROUTE, NOT_DELIVERED, READY, WEIGHED');
            $table->decimal('estimated_total', 14, 2);
            $table->decimal('final_total', 14, 2)->nullable();
            $table->decimal('delivery_fee', 14, 2);
            $table->decimal('paid_amount', 14, 2);
            $table->decimal('discount_total', 14, 2);
            $table->string('discount_status', 40)->comment('valores en el prototipo: APPLIED, APPROVED, NONE, PENDING_APPROVAL, REJECTED');
            $table->string('weight_diff_status', 40)->comment('valores en el prototipo: NONE, NOTICE_SENT, WITHIN_TOLERANCE');
            $table->string('contact_phone', 40)->nullable();
            $table->uuid('zone_id')->nullable();
            $table->uuid('pickup_establishment_id')->nullable();
            $table->text('notes')->nullable();
            $table->boolean('prep_notes_ok')->nullable();
            $table->string('origin_wa_number', 40)->nullable();
            $table->string('origin_ad_code', 20)->nullable();
            $table->jsonb('origin_utm')->nullable();
            $table->string('external_ref', 40)->nullable();
            $table->timestampTz('confirmed_at')->nullable();
            $table->timestampTz('customer_confirmed_at')->nullable();
            $table->string('confirmation_channel', 20)->nullable()->comment('valores en el prototipo: PHONE, WEB, WHATSAPP');
            $table->integer('reschedule_count');
            $table->uuid('driver_user_id')->nullable();
            $table->integer('units');
            $table->decimal('est_kg', 14, 3);
            $table->timestampTz('delivered_at')->nullable();
            $table->timestampTz('closed_at')->nullable();
            $table->uuid('web_store_id')->nullable();
            $table->uuid('web_inbox_id')->nullable();
            $table->string('cancel_reason', 80)->nullable();
            $table->timestampTz('cancelled_at')->nullable();
            $table->string('balance_mode', 40)->nullable()->comment('valores en el prototipo: COLLECT_ON_DELIVERY, CUSTOMER_CREDIT');
            $table->decimal('balance_amount', 14, 2)->nullable();
            $table->timestampTz('balance_decided_at')->nullable();
            $table->string('balance_decided_by_name', 40)->nullable();
            $table->string('origin_ref', 40)->nullable();
            $table->decimal('order_discount', 14, 2)->nullable();
            $table->decimal('order_discount_pct', 9, 4)->nullable();
            $table->string('discount_reason', 255)->nullable();
            $table->string('coupon_code', 20)->nullable()->comment('valores en el prototipo: VUELVE10');
            $table->string('not_delivered_reason_code', 40)->nullable()->comment('valores en el prototipo: CLIENTE_AUSENTE');
            $table->timestampTz('not_delivered_at')->nullable();
            $table->uuid('province_agency')->nullable();
            $table->string('province_destination', 20)->nullable();
            $table->boolean('thermal_packaging')->nullable();
            $table->string('tracking_number', 40)->nullable();
            $table->string('dispatch_guide_number', 40)->nullable();
            $table->boolean('imported')->nullable();
            $table->string('import_batch', 80)->nullable();
            $table->decimal('fee_override', 14, 2)->nullable();
            $table->string('shared_delivery_with', 40)->nullable();
            $table->uuid('pos_shift_id')->nullable();
            $table->uuid('pos_terminal_id')->nullable();
            $table->string('pos_ticket', 40)->nullable();
            $table->decimal('cash_given', 14, 2)->nullable();
            $table->decimal('change_given', 14, 2)->nullable();
            $table->decimal('returned_amount', 14, 2)->nullable();
            $table->boolean('origin_locked')->nullable();
            $table->uuid('conversation_id')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // PED · sales_order_lines
        Schema::create('sales_order_lines', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('sales_order_id');
            $table->integer('line_no')->default(1);
            $table->uuid('variant_id');
            $table->decimal('qty', 14, 3);
            $table->decimal('unit_price', 14, 2);
            $table->decimal('list_price', 14, 2);
            $table->string('price_basis', 20)->comment('valores en el prototipo: KG, UNIT');
            $table->uuid('price_list_id');
            $table->decimal('est_weight_kg', 14, 3)->nullable();
            $table->decimal('tolerance_pct', 9, 4)->nullable();
            $table->decimal('discount_pct', 9, 4);
            $table->decimal('discount_amount', 14, 2);
            $table->decimal('weighed_kg', 14, 3)->nullable();
            $table->decimal('final_amount', 14, 2)->nullable();
            $table->uuid('lot_id')->nullable();
            $table->text('cut_notes')->nullable();
            $table->decimal('est_amount', 14, 2);
            $table->string('weight_source', 20)->nullable()->comment('valores en el prototipo: SCALE');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // PED · order_time_slots
        Schema::create('order_time_slots', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('establishment_id');
            $table->uuid('zone_id')->nullable();
            $table->string('name', 40);
            $table->time('slot_from');
            $table->time('slot_to');
            $table->time('cutoff');
            $table->decimal('capacity', 14, 3);
            $table->jsonb('weekdays');
            $table->string('status', 20)->comment('valores en el prototipo: ACTIVE');
            $table->decimal('cutoff_minutes', 14, 2);
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // PED · order_cancel_reasons
        Schema::create('order_cancel_reasons', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->string('code', 40)->comment('valores en el prototipo: ACCIDENTE_RUTA, BORRADOR_VENCIDO, CLIENTE_AUSENTE, CLIENTE_DESISTIO, DIRECCION_ERRADA, DUPLICADO, FUERA_COBERTURA, OTRO, PAGO_NO_CONFIRMADO, RECHAZO_PRODUCTO, SIN_DINERO, SIN_STOCK');
            $table->string('name', 80);
            $table->string('applies_to', 40)->comment('valores en el prototipo: BOTH, CANCEL, NOT_DELIVERED');
            $table->boolean('requires_note')->default(false);
            $table->boolean('counts_as_loss')->default(false);
            $table->string('status', 20)->comment('valores en el prototipo: ACTIVE');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // PED · discount_limits
        Schema::create('discount_limits', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->string('role', 40)->comment('valores en el prototipo: CAJERO, SUPERVISORA_VENTAS, VENDEDORA');
            $table->string('role_id', 40)->comment('valores en el prototipo: CAJERO, SUPERVISORA_VENTAS, VENDEDORA');
            $table->uuid('brand_id')->nullable();
            $table->decimal('max_pct', 9, 4);
            $table->decimal('max_amount', 14, 2);
            $table->string('status', 20)->comment('valores en el prototipo: ACTIVE');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // PED · sales_order_status_history
        Schema::create('sales_order_status_history', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('order_id');
            $table->string('order_number', 20);
            $table->string('from_status', 40)->comment('valores en el prototipo: CONFIRMED, DRAFT, IN_ROUTE');
            $table->string('to_status', 40)->comment('valores en el prototipo: CANCELLED, CLOSED, CONFIRMED, DELIVERED, IN_PREPARATION, IN_ROUTE, NOT_DELIVERED, READY, WEIGHED');
            $table->string('reason', 40)->nullable();
            $table->timestampTz('changed_at');
            $table->uuid('changed_by')->nullable();
            $table->string('changed_by_name', 40);
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // PED · order_reschedules
        Schema::create('order_reschedules', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('order_id');
            $table->string('order_number', 20);
            $table->uuid('brand_id');
            $table->uuid('establishment_id');
            $table->date('old_date');
            $table->time('old_slot_from');
            $table->date('new_date');
            $table->time('new_slot_from');
            $table->uuid('new_slot_id');
            $table->string('reason', 80);
            $table->decimal('fee_charged', 14, 2);
            $table->string('from_status', 40)->comment('valores en el prototipo: CONFIRMED');
            $table->uuid('rescheduled_by');
            $table->string('rescheduled_by_name', 40);
            $table->timestampTz('at');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // PED · order_discount_approvals
        Schema::create('order_discount_approvals', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('order_id');
            $table->string('order_number', 20);
            $table->uuid('brand_id');
            $table->uuid('establishment_id');
            $table->uuid('requested_by');
            $table->string('requested_by_name', 40);
            $table->string('requested_role', 40)->comment('valores en el prototipo: VENDEDORA');
            $table->decimal('requested_pct', 9, 4);
            $table->decimal('requested_amount', 14, 2);
            $table->decimal('order_base', 14, 2);
            $table->string('reason', 255);
            $table->string('status', 20)->comment('valores en el prototipo: APPROVED, PENDING, REJECTED');
            $table->timestampTz('requested_at');
            $table->uuid('decided_by')->nullable();
            $table->string('decided_by_name', 40)->nullable();
            $table->timestampTz('decided_at')->nullable();
            $table->string('decision_note', 80)->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // PED · order_weight_notices
        Schema::create('order_weight_notices', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('order_id');
            $table->string('order_number', 20);
            $table->uuid('brand_id');
            $table->uuid('establishment_id');
            $table->decimal('estimated_total', 14, 2);
            $table->decimal('final_total', 14, 2);
            $table->decimal('diff_pct', 9, 4);
            $table->text('message');
            $table->string('channel', 20)->comment('valores en el prototipo: PHONE, WHATSAPP');
            $table->timestampTz('sent_at');
            $table->uuid('sent_by')->nullable();
            $table->string('customer_response', 40)->comment('valores en el prototipo: ACCEPTED, NO_RESPONSE');
            $table->string('responded_at', 20)->nullable();
            $table->decimal('cost', 14, 2);
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });

        Schema::table('sales_orders', function (Blueprint $table) { $table->foreign('brand_id')->references('id')->on('brands')->restrictOnDelete(); $table->index('brand_id'); });
        Schema::table('sales_orders', function (Blueprint $table) { $table->foreign('establishment_id')->references('id')->on('establishments')->restrictOnDelete(); $table->index('establishment_id'); });
        Schema::table('sales_orders', function (Blueprint $table) { $table->foreign('customer_id')->references('id')->on('customers')->restrictOnDelete(); $table->index('customer_id'); });
        Schema::table('sales_orders', function (Blueprint $table) { $table->foreign('address_id')->references('id')->on('customer_addresses')->restrictOnDelete(); $table->index('address_id'); });
        Schema::table('sales_orders', function (Blueprint $table) { $table->foreign('seller_id')->references('id')->on('users')->restrictOnDelete(); $table->index('seller_id'); });
        Schema::table('sales_orders', function (Blueprint $table) { $table->foreign('slot_id')->references('id')->on('order_time_slots')->restrictOnDelete(); $table->index('slot_id'); });
        Schema::table('sales_orders', function (Blueprint $table) { $table->foreign('billing_customer_id')->references('id')->on('customers')->restrictOnDelete(); $table->index('billing_customer_id'); });
        Schema::table('sales_orders', function (Blueprint $table) { $table->foreign('payment_method_id')->references('id')->on('payment_methods')->restrictOnDelete(); $table->index('payment_method_id'); });
        Schema::table('sales_orders', function (Blueprint $table) { $table->foreign('zone_id')->references('id')->on('delivery_zones')->restrictOnDelete(); $table->index('zone_id'); });
        Schema::table('sales_orders', function (Blueprint $table) { $table->foreign('pickup_establishment_id')->references('id')->on('establishments')->restrictOnDelete(); $table->index('pickup_establishment_id'); });
        Schema::table('sales_orders', function (Blueprint $table) { $table->foreign('driver_user_id')->references('id')->on('users')->restrictOnDelete(); $table->index('driver_user_id'); });
        Schema::table('sales_orders', function (Blueprint $table) { $table->foreign('province_agency')->references('id')->on('suppliers')->restrictOnDelete(); $table->index('province_agency'); });
        Schema::table('sales_orders', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('sales_order_lines', function (Blueprint $table) { $table->foreign('sales_order_id')->references('id')->on('sales_orders')->cascadeOnDelete(); $table->index('sales_order_id'); });
        Schema::table('sales_order_lines', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('order_time_slots', function (Blueprint $table) { $table->foreign('establishment_id')->references('id')->on('establishments')->restrictOnDelete(); $table->index('establishment_id'); });
        Schema::table('order_time_slots', function (Blueprint $table) { $table->foreign('zone_id')->references('id')->on('delivery_zones')->restrictOnDelete(); $table->index('zone_id'); });
        Schema::table('order_time_slots', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('order_cancel_reasons', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('discount_limits', function (Blueprint $table) { $table->foreign('brand_id')->references('id')->on('brands')->restrictOnDelete(); $table->index('brand_id'); });
        Schema::table('discount_limits', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('sales_order_status_history', function (Blueprint $table) { $table->foreign('order_id')->references('id')->on('sales_orders')->restrictOnDelete(); $table->index('order_id'); });
        Schema::table('sales_order_status_history', function (Blueprint $table) { $table->foreign('changed_by')->references('id')->on('users')->restrictOnDelete(); $table->index('changed_by'); });
        Schema::table('sales_order_status_history', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('order_reschedules', function (Blueprint $table) { $table->foreign('order_id')->references('id')->on('sales_orders')->restrictOnDelete(); $table->index('order_id'); });
        Schema::table('order_reschedules', function (Blueprint $table) { $table->foreign('brand_id')->references('id')->on('brands')->restrictOnDelete(); $table->index('brand_id'); });
        Schema::table('order_reschedules', function (Blueprint $table) { $table->foreign('establishment_id')->references('id')->on('establishments')->restrictOnDelete(); $table->index('establishment_id'); });
        Schema::table('order_reschedules', function (Blueprint $table) { $table->foreign('new_slot_id')->references('id')->on('order_time_slots')->restrictOnDelete(); $table->index('new_slot_id'); });
        Schema::table('order_reschedules', function (Blueprint $table) { $table->foreign('rescheduled_by')->references('id')->on('users')->restrictOnDelete(); $table->index('rescheduled_by'); });
        Schema::table('order_reschedules', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('order_discount_approvals', function (Blueprint $table) { $table->foreign('order_id')->references('id')->on('sales_orders')->restrictOnDelete(); $table->index('order_id'); });
        Schema::table('order_discount_approvals', function (Blueprint $table) { $table->foreign('brand_id')->references('id')->on('brands')->restrictOnDelete(); $table->index('brand_id'); });
        Schema::table('order_discount_approvals', function (Blueprint $table) { $table->foreign('establishment_id')->references('id')->on('establishments')->restrictOnDelete(); $table->index('establishment_id'); });
        Schema::table('order_discount_approvals', function (Blueprint $table) { $table->foreign('requested_by')->references('id')->on('users')->restrictOnDelete(); $table->index('requested_by'); });
        Schema::table('order_discount_approvals', function (Blueprint $table) { $table->foreign('decided_by')->references('id')->on('users')->restrictOnDelete(); $table->index('decided_by'); });
        Schema::table('order_discount_approvals', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('order_weight_notices', function (Blueprint $table) { $table->foreign('order_id')->references('id')->on('sales_orders')->restrictOnDelete(); $table->index('order_id'); });
        Schema::table('order_weight_notices', function (Blueprint $table) { $table->foreign('brand_id')->references('id')->on('brands')->restrictOnDelete(); $table->index('brand_id'); });
        Schema::table('order_weight_notices', function (Blueprint $table) { $table->foreign('establishment_id')->references('id')->on('establishments')->restrictOnDelete(); $table->index('establishment_id'); });
        Schema::table('order_weight_notices', function (Blueprint $table) { $table->foreign('sent_by')->references('id')->on('users')->restrictOnDelete(); $table->index('sent_by'); });
        Schema::table('order_weight_notices', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });

        Schema::table('sales_orders', fn (Blueprint $table) => $table->unique(['tenant_id', 'number']));
        DB::statement("SELECT enable_tenant_rls('sales_orders')");
        DB::statement("SELECT enable_tenant_rls('sales_order_lines')");
        DB::statement("SELECT enable_tenant_rls('order_time_slots')");
        DB::statement("SELECT enable_tenant_rls('order_cancel_reasons')");
        DB::statement("SELECT enable_tenant_rls('discount_limits')");
        DB::statement("SELECT enable_tenant_rls('sales_order_status_history')");
        DB::statement('REVOKE UPDATE, DELETE, TRUNCATE ON sales_order_status_history FROM aycha_app');  // solo inserción
        DB::statement("SELECT enable_tenant_rls('order_reschedules')");
        DB::statement('REVOKE UPDATE, DELETE, TRUNCATE ON order_reschedules FROM aycha_app');  // solo inserción
        DB::statement("SELECT enable_tenant_rls('order_discount_approvals')");
        DB::statement("SELECT enable_tenant_rls('order_weight_notices')");
    }

    public function down(): void
    {
        DB::statement('DROP TABLE IF EXISTS order_weight_notices CASCADE');
        DB::statement('DROP TABLE IF EXISTS order_discount_approvals CASCADE');
        DB::statement('DROP TABLE IF EXISTS order_reschedules CASCADE');
        DB::statement('DROP TABLE IF EXISTS sales_order_status_history CASCADE');
        DB::statement('DROP TABLE IF EXISTS discount_limits CASCADE');
        DB::statement('DROP TABLE IF EXISTS order_cancel_reasons CASCADE');
        DB::statement('DROP TABLE IF EXISTS order_time_slots CASCADE');
        DB::statement('DROP TABLE IF EXISTS sales_order_lines CASCADE');
        DB::statement('DROP TABLE IF EXISTS sales_orders CASCADE');
    }
};
