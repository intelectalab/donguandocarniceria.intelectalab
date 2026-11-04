<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// NUC · generada desde el modelo del prototipo (tools/prototipo/generar_migraciones.py).
// Tablas: suppliers, vehicles.
// El dueño del módulo revisa tipos, únicos y estados antes de construir sus pantallas;
// los cambios se hacen con migraciones nuevas, no editando esta.
return new class extends Migration
{
    public function up(): void
    {
        // NUC · suppliers
        Schema::create('suppliers', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->string('doc_type', 20)->comment('valores en el prototipo: DNI, FOREIGN, RUC');
            $table->string('doc_number', 40);
            $table->string('legal_name', 255);
            $table->string('trade_name', 80);
            $table->string('supplier_type', 40)->comment('valores en el prototipo: ADVERTISING, CONTENT_CREATOR, DELIVERY_COMPANY, INPUTS, PACKAGING, PRODUCER, RELATED_FARM, SERVICES, SLAUGHTERHOUSE, VEHICLE_RENTAL');
            $table->string('phone', 40)->nullable();
            $table->string('email', 80)->nullable();
            $table->string('status', 20)->comment('valores en el prototipo: ACTIVE');
            $table->integer('payment_terms_days');
            $table->uuid('related_company_id')->nullable();
            $table->string('sunat_status', 40)->comment('valores en el prototipo: ACTIVE, NOT_LOCATED, UNKNOWN');
            $table->integer('rating');
            $table->uuid('default_cost_center_id');
            $table->string('bank_name', 40)->nullable();
            $table->string('bank_account', 40)->nullable();
            $table->timestampTz('sunat_checked_at')->nullable();
            $table->string('sunat_msg', 255)->nullable();
            $table->text('notes')->nullable();
            $table->jsonb('pending_bank_change')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // NUC · vehicles
        Schema::create('vehicles', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->string('plate', 20);
            $table->string('vehicle_type', 20)->comment('valores en el prototipo: CAR, MOTO, VAN');
            $table->string('ownership', 20)->comment('valores en el prototipo: OWN, RENTED');
            $table->uuid('provider_id')->nullable();
            $table->uuid('establishment_id');
            $table->decimal('capacity_kg', 14, 3);
            $table->boolean('refrigerated')->default(false);
            $table->string('status', 20)->comment('valores en el prototipo: ACTIVE');
            $table->string('fuel_type', 20)->comment('valores en el prototipo: DIESEL, GASOLINE');
            $table->string('soat_policy_no', 40);
            $table->date('soat_expires_on');
            $table->date('tech_inspection_expires_on');
            $table->decimal('odometer_km', 14, 3);
            $table->decimal('rental_daily_rate', 9, 4)->nullable();
            $table->string('driver_user_id', 20)->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });

        Schema::table('suppliers', function (Blueprint $table) { $table->foreign('related_company_id')->references('id')->on('companies')->restrictOnDelete(); $table->index('related_company_id'); });
        Schema::table('suppliers', function (Blueprint $table) { $table->foreign('default_cost_center_id')->references('id')->on('cost_centers')->restrictOnDelete(); $table->index('default_cost_center_id'); });
        Schema::table('suppliers', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('vehicles', function (Blueprint $table) { $table->foreign('provider_id')->references('id')->on('suppliers')->restrictOnDelete(); $table->index('provider_id'); });
        Schema::table('vehicles', function (Blueprint $table) { $table->foreign('establishment_id')->references('id')->on('establishments')->restrictOnDelete(); $table->index('establishment_id'); });
        Schema::table('vehicles', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });

        DB::statement("SELECT enable_tenant_rls('suppliers')");
        Schema::table('vehicles', fn (Blueprint $table) => $table->unique(['tenant_id', 'plate']));
        DB::statement("SELECT enable_tenant_rls('vehicles')");
    }

    public function down(): void
    {
        DB::statement('DROP TABLE IF EXISTS vehicles CASCADE');
        DB::statement('DROP TABLE IF EXISTS suppliers CASCADE');
    }
};
