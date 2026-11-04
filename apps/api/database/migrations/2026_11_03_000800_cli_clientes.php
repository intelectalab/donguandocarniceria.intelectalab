<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// CLI · generada desde el modelo del prototipo (tools/prototipo/generar_migraciones.py).
// Tablas: customers, customer_addresses, delivery_zones, customer_duplicate_candidates, customer_merges.
// El dueño del módulo revisa tipos, únicos y estados antes de construir sus pantallas;
// los cambios se hacen con migraciones nuevas, no editando esta.
return new class extends Migration
{
    public function up(): void
    {
        // CLI · customers
        Schema::create('customers', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->string('doc_type', 20)->comment('valores en el prototipo: DNI, NONE, RUC');
            $table->string('doc_number', 40)->nullable();
            $table->string('full_name', 80);
            $table->string('phone', 40)->nullable();
            $table->string('email', 80)->nullable();
            $table->string('customer_type', 40)->comment('valores en el prototipo: BUSINESS, CONSIGNMENT_POINT, OTHER, PERSON, RESTAURANT');
            $table->string('source_channel', 40)->nullable()->comment('valores en el prototipo: B2B, FACEBOOK, IMPORT, INSTAGRAM, TIKTOK, WEB, WHATSAPP');
            $table->boolean('marketing_opt_in')->nullable();
            $table->string('status', 20)->comment('valores en el prototipo: ACTIVE, BLOCKED, INACTIVE');
            $table->timestampTz('first_order_at')->nullable();
            $table->timestampTz('last_order_at')->nullable();
            $table->jsonb('segment_brands')->nullable()->comment('lista de ids');
            $table->timestampTz('doc_validated_at')->nullable();
            $table->string('doc_validation_source', 20)->nullable()->comment('valores en el prototipo: RENIEC, SUNAT');
            $table->integer('orders_count')->nullable();
            $table->string('phone_alt', 40)->nullable();
            $table->uuid('merged_into_id')->nullable();
            $table->uuid('seller_user_id')->nullable();
            $table->timestampTz('marketing_opt_in_at')->nullable();
            $table->string('referral_code', 40)->nullable();
            $table->string('trade_name', 80)->nullable();
            $table->string('price_list_id', 20)->nullable();
            $table->string('blocked_reason', 255)->nullable();
            $table->timestampTz('blocked_at')->nullable();
            $table->string('blocked_by', 40)->nullable();
            $table->string('origin_wa_number', 40)->nullable();
            $table->string('created_by', 40)->nullable();
            $table->timestampTz('merged_at')->nullable();
            $table->text('notes')->nullable();
            $table->string('consent_source', 20)->nullable()->comment('valores en el prototipo: IMPORT');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // CLI · customer_addresses
        Schema::create('customer_addresses', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('customer_id');
            $table->string('label', 40);
            $table->string('address_line', 255);
            $table->string('reference', 255);
            $table->string('ubigeo', 20)->nullable()->comment('valores en el prototipo: 040101, 080108, 130111, 1501');
            $table->decimal('lat', 10, 7)->nullable();
            $table->decimal('lng', 10, 7)->nullable();
            $table->uuid('zone_id')->nullable();
            $table->string('contact_name', 80)->nullable();
            $table->string('contact_phone', 40)->nullable();
            $table->boolean('is_default')->default(false);
            $table->string('status', 20)->comment('valores en el prototipo: ACTIVE');
            $table->string('pin_source', 40)->nullable()->comment('valores en el prototipo: COORDINATES, GEOCODE, GPS, LINK, MAP, PENDING_LINK, WEB');
            $table->string('district', 40)->nullable();
            $table->decimal('geocode_confidence', 14, 2)->nullable();
            $table->timestampTz('last_used_at')->nullable();
            $table->string('zone_by', 20)->nullable()->comment('valores en el prototipo: DISTRICT, POLYGON');
            $table->timestampTz('verified_at')->nullable();
            $table->uuid('verified_by')->nullable();
            $table->string('call_signal', 40)->nullable()->comment('valores en el prototipo: WHATSAPP_ONLY');
            $table->boolean('out_of_coverage')->nullable();
            $table->boolean('needs_pin')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // CLI · delivery_zones
        Schema::create('delivery_zones', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('establishment_id');
            $table->string('code', 40);
            $table->string('name', 80);
            $table->jsonb('districts');
            $table->decimal('delivery_fee', 14, 2);
            $table->integer('free_from_units')->nullable();
            $table->decimal('free_from_kg', 14, 3)->nullable();
            $table->string('free_from_amount', 20)->nullable();
            $table->decimal('min_order_amount', 14, 2);
            $table->string('status', 20)->comment('valores en el prototipo: ACTIVE');
            $table->integer('priority')->nullable();
            $table->boolean('province')->default(false);
            $table->decimal('lat', 10, 7)->nullable();
            $table->decimal('lng', 10, 7)->nullable();
            $table->jsonb('polygon')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // CLI · customer_duplicate_candidates
        Schema::create('customer_duplicate_candidates', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('customer_id');
            $table->uuid('duplicate_of_id');
            $table->string('match_reason', 40)->comment('valores en el prototipo: SAME_EMAIL, SAME_PHONE, SIMILAR_NAME_ADDRESS');
            $table->decimal('score', 14, 2);
            $table->string('status', 40)->comment('valores en el prototipo: DISMISSED, MERGED, OPEN');
            $table->uuid('resolved_by')->nullable();
            $table->timestampTz('resolved_at')->nullable();
            $table->string('resolution_note', 255)->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // CLI · customer_merges
        Schema::create('customer_merges', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('survivor_id')->nullable();
            $table->uuid('merged_id')->nullable();
            $table->jsonb('moved_counts')->nullable();
            $table->string('reason', 80)->nullable();
            $table->timestampTz('merged_at')->nullable();
            $table->string('merged_by', 40)->nullable();
            $table->string('survivor_name', 80)->nullable();
            $table->string('merged_name', 80)->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });

        Schema::table('customers', function (Blueprint $table) { $table->foreign('merged_into_id')->references('id')->on('customers')->restrictOnDelete(); $table->index('merged_into_id'); });
        Schema::table('customers', function (Blueprint $table) { $table->foreign('seller_user_id')->references('id')->on('users')->restrictOnDelete(); $table->index('seller_user_id'); });
        Schema::table('customers', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('customer_addresses', function (Blueprint $table) { $table->foreign('customer_id')->references('id')->on('customers')->restrictOnDelete(); $table->index('customer_id'); });
        Schema::table('customer_addresses', function (Blueprint $table) { $table->foreign('zone_id')->references('id')->on('delivery_zones')->restrictOnDelete(); $table->index('zone_id'); });
        Schema::table('customer_addresses', function (Blueprint $table) { $table->foreign('verified_by')->references('id')->on('users')->restrictOnDelete(); $table->index('verified_by'); });
        Schema::table('customer_addresses', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('delivery_zones', function (Blueprint $table) { $table->foreign('establishment_id')->references('id')->on('establishments')->restrictOnDelete(); $table->index('establishment_id'); });
        Schema::table('delivery_zones', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('customer_duplicate_candidates', function (Blueprint $table) { $table->foreign('customer_id')->references('id')->on('customers')->restrictOnDelete(); $table->index('customer_id'); });
        Schema::table('customer_duplicate_candidates', function (Blueprint $table) { $table->foreign('duplicate_of_id')->references('id')->on('customers')->restrictOnDelete(); $table->index('duplicate_of_id'); });
        Schema::table('customer_duplicate_candidates', function (Blueprint $table) { $table->foreign('resolved_by')->references('id')->on('users')->restrictOnDelete(); $table->index('resolved_by'); });
        Schema::table('customer_duplicate_candidates', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('customer_merges', function (Blueprint $table) { $table->foreign('survivor_id')->references('id')->on('customers')->restrictOnDelete(); $table->index('survivor_id'); });
        Schema::table('customer_merges', function (Blueprint $table) { $table->foreign('merged_id')->references('id')->on('customers')->restrictOnDelete(); $table->index('merged_id'); });
        Schema::table('customer_merges', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });

        DB::statement("SELECT enable_tenant_rls('customers')");
        DB::statement("SELECT enable_tenant_rls('customer_addresses')");
        Schema::table('delivery_zones', fn (Blueprint $table) => $table->unique(['tenant_id', 'code']));
        DB::statement("SELECT enable_tenant_rls('delivery_zones')");
        DB::statement("SELECT enable_tenant_rls('customer_duplicate_candidates')");
        DB::statement("SELECT enable_tenant_rls('customer_merges')");
        DB::statement('REVOKE UPDATE, DELETE, TRUNCATE ON customer_merges FROM aycha_app');  // solo inserción
    }

    public function down(): void
    {
        DB::statement('DROP TABLE IF EXISTS customer_merges CASCADE');
        DB::statement('DROP TABLE IF EXISTS customer_duplicate_candidates CASCADE');
        DB::statement('DROP TABLE IF EXISTS delivery_zones CASCADE');
        DB::statement('DROP TABLE IF EXISTS customer_addresses CASCADE');
        DB::statement('DROP TABLE IF EXISTS customers CASCADE');
    }
};
