<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// CAL · generada desde el modelo del prototipo (tools/prototipo/generar_migraciones.py).
// Tablas: qc_checklists, qc_checklist_items, qc_schedules, qc_inspections, qc_inspection_answers, temperature_points, temperature_readings, temperature_excursions, lot_quality_decisions, nonconformities, corrective_actions, sanitary_registrations, quality_claims.
// El dueño del módulo revisa tipos, únicos y estados antes de construir sus pantallas;
// los cambios se hacen con migraciones nuevas, no editando esta.
return new class extends Migration
{
    public function up(): void
    {
        // CAL · qc_checklists
        Schema::create('qc_checklists', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->string('code', 40);
            $table->string('name', 255);
            $table->string('stage', 40)->comment('valores en el prototipo: BPM, CLEANING, DISPATCH, PACKING, PROCESS, PRODUCTION, RECEPTION, STORAGE');
            $table->integer('version');
            $table->string('status', 20)->comment('valores en el prototipo: ACTIVE, DRAFT, RETIRED');
            $table->string('created_by', 40)->nullable();
            $table->date('activated_at')->nullable();
            $table->jsonb('items')->nullable();
            $table->string('source', 20)->nullable()->comment('valores en el prototipo: TEMPLATE');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // CAL · qc_checklist_items
        Schema::create('qc_checklist_items', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('checklist_id');
            $table->integer('seq');
            $table->string('question', 255);
            $table->string('answer_type', 20)->comment('valores en el prototipo: NUMBER, PHOTO, TEXT, YES_NO');
            $table->decimal('min_value', 14, 2)->nullable();
            $table->decimal('max_value', 14, 2)->nullable();
            $table->boolean('is_critical')->default(false);
            $table->boolean('requires_photo')->default(false);
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // CAL · qc_schedules
        Schema::create('qc_schedules', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('checklist_id');
            $table->uuid('establishment_id');
            $table->string('area', 255);
            $table->string('frequency', 40)->comment('valores en el prototipo: DAILY, MONTHLY, PER_SHIFT, WEEKLY');
            $table->string('responsible_role', 40)->comment('valores en el prototipo: ALMACENERO, CALIDAD, OPERARIO_PRODUCCION, PREPARADOR');
            $table->integer('weekday')->nullable();
            $table->string('status', 20)->comment('valores en el prototipo: ACTIVE');
            $table->date('active_from');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // CAL · qc_inspections
        Schema::create('qc_inspections', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->string('number', 40);
            $table->uuid('checklist_id');
            $table->integer('checklist_version');
            $table->string('stage', 40)->comment('valores en el prototipo: BPM, CLEANING, DISPATCH, PACKING, PROCESS, RECEPTION');
            $table->uuid('establishment_id');
            $table->uuid('schedule_id')->nullable();
            $table->string('shift', 20)->comment('valores en el prototipo: M, T');
            $table->uuid('lot_id')->nullable();
            $table->uuid('production_order_id')->nullable()->comment('apunta a production_orders (módulo posterior): la FK la agrega su dueño');
            $table->string('production_order_ref', 40)->nullable();
            $table->uuid('purchase_receipt_id')->nullable()->comment('apunta a purchase_receipts (módulo posterior): la FK la agrega su dueño');
            $table->uuid('sales_order_id')->nullable();
            $table->uuid('vehicle_id')->nullable();
            $table->string('area', 255);
            $table->uuid('inspector_user_id');
            $table->timestampTz('inspected_at');
            $table->string('status', 20)->comment('valores en el prototipo: DONE');
            $table->string('result', 20)->comment('valores en el prototipo: FAIL, PASS');
            $table->decimal('score_pct', 9, 4);
            $table->jsonb('critical_failed');
            $table->text('notes')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // CAL · qc_inspection_answers
        Schema::create('qc_inspection_answers', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('inspection_id');
            $table->uuid('item_id');
            $table->boolean('answer_bool')->nullable();
            $table->decimal('answer_num', 14, 2)->nullable();
            $table->text('answer_text')->nullable();
            $table->string('photo_url', 80)->nullable();
            $table->boolean('is_conforming')->default(false);
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // CAL · temperature_points
        Schema::create('temperature_points', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->string('code', 40);
            $table->string('name', 80);
            $table->string('point_type', 40)->comment('valores en el prototipo: COLD_ROOM, DISPLAY, FREEZER, POT, PRODUCT, VEHICLE');
            $table->uuid('establishment_id');
            $table->uuid('equipment_id')->nullable();
            $table->uuid('warehouse_id')->nullable();
            $table->uuid('vehicle_id')->nullable();
            $table->decimal('min_c', 14, 2);
            $table->decimal('max_c', 14, 2);
            $table->decimal('reading_frequency_min', 14, 2);
            $table->string('status', 20)->comment('valores en el prototipo: ACTIVE');
            $table->boolean('sensor')->default(false);
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // CAL · temperature_readings
        Schema::create('temperature_readings', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('point_id');
            $table->uuid('establishment_id');
            $table->timestampTz('read_at');
            $table->decimal('value_c', 14, 2);
            $table->string('source', 20)->comment('valores en el prototipo: MANUAL');
            $table->text('context');
            $table->uuid('read_by');
            $table->string('photo_url', 20)->nullable();
            $table->boolean('in_range')->default(false);
            $table->uuid('excursion_id')->nullable();
            $table->uuid('approved_by')->nullable();
            $table->timestampTz('approved_at')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // CAL · temperature_excursions
        Schema::create('temperature_excursions', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('point_id');
            $table->uuid('establishment_id');
            $table->timestampTz('started_at');
            $table->timestampTz('ended_at')->nullable();
            $table->decimal('first_value_c', 14, 2);
            $table->decimal('max_deviation_c', 14, 2);
            $table->decimal('max_value_c', 14, 2);
            $table->integer('readings_count');
            $table->string('status', 20)->comment('valores en el prototipo: CLOSED, OPEN');
            $table->string('action_taken', 255)->nullable();
            $table->uuid('closed_by')->nullable();
            $table->timestampTz('closed_at')->nullable();
            $table->uuid('nonconformity_id')->nullable();
            $table->jsonb('lots_exposed')->comment('lista de ids');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // CAL · lot_quality_decisions
        Schema::create('lot_quality_decisions', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('lot_id');
            $table->string('decision', 20)->comment('valores en el prototipo: HOLD, REJECT, RELEASE');
            $table->uuid('decided_by');
            $table->timestampTz('decided_at');
            $table->uuid('inspection_id')->nullable();
            $table->string('reason', 255)->nullable();
            $table->string('reject_destination', 20)->nullable()->comment('valores en el prototipo: WASTE');
            $table->string('previous_status', 40)->comment('valores en el prototipo: QUARANTINE');
            $table->string('new_status', 20)->comment('valores en el prototipo: BLOCKED, REJECTED, RELEASED');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // CAL · nonconformities
        Schema::create('nonconformities', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->string('number', 40);
            $table->string('source', 40)->comment('valores en el prototipo: AUDIT, CUSTOMER_CLAIM, PACKING, SUPPLIER, TEMPERATURE');
            $table->string('severity', 20)->comment('valores en el prototipo: CRITICAL, MAJOR, MINOR');
            $table->text('description');
            $table->uuid('establishment_id');
            $table->uuid('lot_id')->nullable();
            $table->uuid('supplier_id')->nullable();
            $table->uuid('equipment_id')->nullable();
            $table->uuid('production_order_id')->nullable()->comment('apunta a production_orders (módulo posterior): la FK la agrega su dueño');
            $table->timestampTz('detected_at');
            $table->uuid('detected_by');
            $table->string('root_cause', 255)->nullable();
            $table->uuid('responsible_user_id');
            $table->date('due_date');
            $table->string('status', 40)->comment('valores en el prototipo: CLOSED, IN_PROGRESS, OPEN, VERIFICATION');
            $table->timestampTz('closed_at')->nullable();
            $table->uuid('closed_by')->nullable();
            $table->boolean('effectiveness_verified')->nullable();
            $table->uuid('claim_id')->nullable();
            $table->uuid('excursion_id')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // CAL · corrective_actions
        Schema::create('corrective_actions', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('nonconformity_id');
            $table->string('action_type', 40)->comment('valores en el prototipo: CORRECTION, CORRECTIVE, PREVENTIVE');
            $table->text('description');
            $table->uuid('responsible_user_id');
            $table->date('due_date');
            $table->timestampTz('done_at')->nullable();
            $table->string('evidence_url', 255)->nullable();
            $table->string('status', 20)->comment('valores en el prototipo: DONE, PENDING, VERIFIED');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // CAL · sanitary_registrations
        Schema::create('sanitary_registrations', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('product_id');
            $table->string('authority', 20)->comment('valores en el prototipo: DIGESA, SENASA');
            $table->string('registration_type', 80)->comment('valores en el prototipo: SANITARY_AUTHORIZATION, SANITARY_REGISTRY');
            $table->string('number', 40);
            $table->date('issued_on');
            $table->date('expires_on');
            $table->uuid('establishment_id')->nullable();
            $table->string('file_url', 80);
            $table->string('status', 20)->comment('valores en el prototipo: ACTIVE, EXPIRED');
            $table->text('notes')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });
        // CAL · quality_claims
        Schema::create('quality_claims', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->string('number', 40);
            $table->uuid('customer_id');
            $table->uuid('sales_order_id');
            $table->uuid('sales_document_id');
            $table->uuid('lot_id')->nullable();
            $table->uuid('product_id');
            $table->string('claim_type', 40)->comment('valores en el prototipo: PACKAGING, SPOILED, TASTE, TEMPERATURE, WRONG_WEIGHT');
            $table->text('description');
            $table->string('photo_url', 20)->nullable();
            $table->timestampTz('received_at');
            $table->string('channel', 20)->comment('valores en el prototipo: WHATSAPP');
            $table->string('status', 40)->comment('valores en el prototipo: INVESTIGATING, OPEN, RESOLVED');
            $table->string('resolution', 40)->nullable()->comment('valores en el prototipo: NONE, REFUND, REPLACEMENT');
            $table->uuid('credit_note_id')->nullable();
            $table->uuid('nonconformity_id')->nullable();
            $table->timestampTz('resolved_at')->nullable();
            $table->uuid('resolved_by')->nullable();
            $table->uuid('brand_id');
            $table->uuid('establishment_id');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
        });

        Schema::table('qc_checklists', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('qc_checklist_items', function (Blueprint $table) { $table->foreign('checklist_id')->references('id')->on('qc_checklists')->restrictOnDelete(); $table->index('checklist_id'); });
        Schema::table('qc_checklist_items', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('qc_schedules', function (Blueprint $table) { $table->foreign('checklist_id')->references('id')->on('qc_checklists')->restrictOnDelete(); $table->index('checklist_id'); });
        Schema::table('qc_schedules', function (Blueprint $table) { $table->foreign('establishment_id')->references('id')->on('establishments')->restrictOnDelete(); $table->index('establishment_id'); });
        Schema::table('qc_schedules', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('qc_inspections', function (Blueprint $table) { $table->foreign('checklist_id')->references('id')->on('qc_checklists')->restrictOnDelete(); $table->index('checklist_id'); });
        Schema::table('qc_inspections', function (Blueprint $table) { $table->foreign('establishment_id')->references('id')->on('establishments')->restrictOnDelete(); $table->index('establishment_id'); });
        Schema::table('qc_inspections', function (Blueprint $table) { $table->foreign('schedule_id')->references('id')->on('qc_schedules')->restrictOnDelete(); $table->index('schedule_id'); });
        Schema::table('qc_inspections', function (Blueprint $table) { $table->foreign('lot_id')->references('id')->on('lots')->restrictOnDelete(); $table->index('lot_id'); });
        Schema::table('qc_inspections', function (Blueprint $table) { $table->foreign('sales_order_id')->references('id')->on('sales_orders')->restrictOnDelete(); $table->index('sales_order_id'); });
        Schema::table('qc_inspections', function (Blueprint $table) { $table->foreign('vehicle_id')->references('id')->on('vehicles')->restrictOnDelete(); $table->index('vehicle_id'); });
        Schema::table('qc_inspections', function (Blueprint $table) { $table->foreign('inspector_user_id')->references('id')->on('users')->restrictOnDelete(); $table->index('inspector_user_id'); });
        Schema::table('qc_inspections', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('qc_inspection_answers', function (Blueprint $table) { $table->foreign('inspection_id')->references('id')->on('qc_inspections')->restrictOnDelete(); $table->index('inspection_id'); });
        Schema::table('qc_inspection_answers', function (Blueprint $table) { $table->foreign('item_id')->references('id')->on('qc_checklist_items')->restrictOnDelete(); $table->index('item_id'); });
        Schema::table('qc_inspection_answers', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('temperature_points', function (Blueprint $table) { $table->foreign('establishment_id')->references('id')->on('establishments')->restrictOnDelete(); $table->index('establishment_id'); });
        Schema::table('temperature_points', function (Blueprint $table) { $table->foreign('warehouse_id')->references('id')->on('warehouses')->restrictOnDelete(); $table->index('warehouse_id'); });
        Schema::table('temperature_points', function (Blueprint $table) { $table->foreign('vehicle_id')->references('id')->on('vehicles')->restrictOnDelete(); $table->index('vehicle_id'); });
        Schema::table('temperature_points', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('temperature_readings', function (Blueprint $table) { $table->foreign('point_id')->references('id')->on('temperature_points')->restrictOnDelete(); $table->index('point_id'); });
        Schema::table('temperature_readings', function (Blueprint $table) { $table->foreign('establishment_id')->references('id')->on('establishments')->restrictOnDelete(); $table->index('establishment_id'); });
        Schema::table('temperature_readings', function (Blueprint $table) { $table->foreign('read_by')->references('id')->on('users')->restrictOnDelete(); $table->index('read_by'); });
        Schema::table('temperature_readings', function (Blueprint $table) { $table->foreign('excursion_id')->references('id')->on('temperature_excursions')->restrictOnDelete(); $table->index('excursion_id'); });
        Schema::table('temperature_readings', function (Blueprint $table) { $table->foreign('approved_by')->references('id')->on('users')->restrictOnDelete(); $table->index('approved_by'); });
        Schema::table('temperature_readings', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('temperature_excursions', function (Blueprint $table) { $table->foreign('point_id')->references('id')->on('temperature_points')->restrictOnDelete(); $table->index('point_id'); });
        Schema::table('temperature_excursions', function (Blueprint $table) { $table->foreign('establishment_id')->references('id')->on('establishments')->restrictOnDelete(); $table->index('establishment_id'); });
        Schema::table('temperature_excursions', function (Blueprint $table) { $table->foreign('closed_by')->references('id')->on('users')->restrictOnDelete(); $table->index('closed_by'); });
        Schema::table('temperature_excursions', function (Blueprint $table) { $table->foreign('nonconformity_id')->references('id')->on('nonconformities')->restrictOnDelete(); $table->index('nonconformity_id'); });
        Schema::table('temperature_excursions', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('lot_quality_decisions', function (Blueprint $table) { $table->foreign('lot_id')->references('id')->on('lots')->restrictOnDelete(); $table->index('lot_id'); });
        Schema::table('lot_quality_decisions', function (Blueprint $table) { $table->foreign('decided_by')->references('id')->on('users')->restrictOnDelete(); $table->index('decided_by'); });
        Schema::table('lot_quality_decisions', function (Blueprint $table) { $table->foreign('inspection_id')->references('id')->on('qc_inspections')->restrictOnDelete(); $table->index('inspection_id'); });
        Schema::table('lot_quality_decisions', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('nonconformities', function (Blueprint $table) { $table->foreign('establishment_id')->references('id')->on('establishments')->restrictOnDelete(); $table->index('establishment_id'); });
        Schema::table('nonconformities', function (Blueprint $table) { $table->foreign('lot_id')->references('id')->on('lots')->restrictOnDelete(); $table->index('lot_id'); });
        Schema::table('nonconformities', function (Blueprint $table) { $table->foreign('supplier_id')->references('id')->on('suppliers')->restrictOnDelete(); $table->index('supplier_id'); });
        Schema::table('nonconformities', function (Blueprint $table) { $table->foreign('detected_by')->references('id')->on('users')->restrictOnDelete(); $table->index('detected_by'); });
        Schema::table('nonconformities', function (Blueprint $table) { $table->foreign('responsible_user_id')->references('id')->on('users')->restrictOnDelete(); $table->index('responsible_user_id'); });
        Schema::table('nonconformities', function (Blueprint $table) { $table->foreign('closed_by')->references('id')->on('users')->restrictOnDelete(); $table->index('closed_by'); });
        Schema::table('nonconformities', function (Blueprint $table) { $table->foreign('claim_id')->references('id')->on('quality_claims')->restrictOnDelete(); $table->index('claim_id'); });
        Schema::table('nonconformities', function (Blueprint $table) { $table->foreign('excursion_id')->references('id')->on('temperature_excursions')->restrictOnDelete(); $table->index('excursion_id'); });
        Schema::table('nonconformities', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('corrective_actions', function (Blueprint $table) { $table->foreign('nonconformity_id')->references('id')->on('nonconformities')->restrictOnDelete(); $table->index('nonconformity_id'); });
        Schema::table('corrective_actions', function (Blueprint $table) { $table->foreign('responsible_user_id')->references('id')->on('users')->restrictOnDelete(); $table->index('responsible_user_id'); });
        Schema::table('corrective_actions', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('sanitary_registrations', function (Blueprint $table) { $table->foreign('product_id')->references('id')->on('products')->restrictOnDelete(); $table->index('product_id'); });
        Schema::table('sanitary_registrations', function (Blueprint $table) { $table->foreign('establishment_id')->references('id')->on('establishments')->restrictOnDelete(); $table->index('establishment_id'); });
        Schema::table('sanitary_registrations', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });
        Schema::table('quality_claims', function (Blueprint $table) { $table->foreign('customer_id')->references('id')->on('customers')->restrictOnDelete(); $table->index('customer_id'); });
        Schema::table('quality_claims', function (Blueprint $table) { $table->foreign('sales_order_id')->references('id')->on('sales_orders')->restrictOnDelete(); $table->index('sales_order_id'); });
        Schema::table('quality_claims', function (Blueprint $table) { $table->foreign('sales_document_id')->references('id')->on('sales_documents')->restrictOnDelete(); $table->index('sales_document_id'); });
        Schema::table('quality_claims', function (Blueprint $table) { $table->foreign('lot_id')->references('id')->on('lots')->restrictOnDelete(); $table->index('lot_id'); });
        Schema::table('quality_claims', function (Blueprint $table) { $table->foreign('product_id')->references('id')->on('products')->restrictOnDelete(); $table->index('product_id'); });
        Schema::table('quality_claims', function (Blueprint $table) { $table->foreign('credit_note_id')->references('id')->on('sales_documents')->restrictOnDelete(); $table->index('credit_note_id'); });
        Schema::table('quality_claims', function (Blueprint $table) { $table->foreign('nonconformity_id')->references('id')->on('nonconformities')->restrictOnDelete(); $table->index('nonconformity_id'); });
        Schema::table('quality_claims', function (Blueprint $table) { $table->foreign('resolved_by')->references('id')->on('users')->restrictOnDelete(); $table->index('resolved_by'); });
        Schema::table('quality_claims', function (Blueprint $table) { $table->foreign('brand_id')->references('id')->on('brands')->restrictOnDelete(); $table->index('brand_id'); });
        Schema::table('quality_claims', function (Blueprint $table) { $table->foreign('establishment_id')->references('id')->on('establishments')->restrictOnDelete(); $table->index('establishment_id'); });
        Schema::table('quality_claims', function (Blueprint $table) { $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete(); });

        DB::statement("SELECT enable_tenant_rls('qc_checklists')");
        DB::statement("SELECT audit.track('qc_checklists')");
        DB::statement("SELECT enable_tenant_rls('qc_checklist_items')");
        DB::statement("SELECT audit.track('qc_checklist_items')");
        DB::statement("SELECT enable_tenant_rls('qc_schedules')");
        DB::statement("SELECT audit.track('qc_schedules')");
        DB::statement("SELECT enable_tenant_rls('qc_inspections')");
        DB::statement("SELECT audit.track('qc_inspections')");
        DB::statement("SELECT enable_tenant_rls('qc_inspection_answers')");
        DB::statement("SELECT audit.track('qc_inspection_answers')");
        DB::statement("SELECT enable_tenant_rls('temperature_points')");
        DB::statement("SELECT audit.track('temperature_points')");
        DB::statement("SELECT enable_tenant_rls('temperature_readings')");
        DB::statement("SELECT audit.track('temperature_readings')");
        DB::statement("SELECT enable_tenant_rls('temperature_excursions')");
        DB::statement("SELECT audit.track('temperature_excursions')");
        DB::statement("SELECT enable_tenant_rls('lot_quality_decisions')");
        DB::statement("SELECT audit.track('lot_quality_decisions')");
        DB::statement("SELECT enable_tenant_rls('nonconformities')");
        DB::statement("SELECT audit.track('nonconformities')");
        DB::statement("SELECT enable_tenant_rls('corrective_actions')");
        DB::statement("SELECT audit.track('corrective_actions')");
        DB::statement("SELECT enable_tenant_rls('sanitary_registrations')");
        DB::statement("SELECT audit.track('sanitary_registrations')");
        DB::statement("SELECT enable_tenant_rls('quality_claims')");
        DB::statement("SELECT audit.track('quality_claims')");
    }

    public function down(): void
    {
        DB::statement('DROP TABLE IF EXISTS quality_claims CASCADE');
        DB::statement('DROP TABLE IF EXISTS sanitary_registrations CASCADE');
        DB::statement('DROP TABLE IF EXISTS corrective_actions CASCADE');
        DB::statement('DROP TABLE IF EXISTS nonconformities CASCADE');
        DB::statement('DROP TABLE IF EXISTS lot_quality_decisions CASCADE');
        DB::statement('DROP TABLE IF EXISTS temperature_excursions CASCADE');
        DB::statement('DROP TABLE IF EXISTS temperature_readings CASCADE');
        DB::statement('DROP TABLE IF EXISTS temperature_points CASCADE');
        DB::statement('DROP TABLE IF EXISTS qc_inspection_answers CASCADE');
        DB::statement('DROP TABLE IF EXISTS qc_inspections CASCADE');
        DB::statement('DROP TABLE IF EXISTS qc_schedules CASCADE');
        DB::statement('DROP TABLE IF EXISTS qc_checklist_items CASCADE');
        DB::statement('DROP TABLE IF EXISTS qc_checklists CASCADE');
    }
};
