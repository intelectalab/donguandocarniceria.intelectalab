<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// EQU · restricciones, índices y correcciones del esquema generado (002900 creó las tablas).
// Decisiones y motivos: docs/contratos.md (sección EQU) y docs/cambios/2026-11-18_equ-equipos.md.
//
//  - RN-EQU-01: toda balanza exige calibración (CHECK en equipment).
//  - RN-EQU-02: certificado con número, archivo y vigencia posterior a la fecha (CHECK en equipment_calibrations).
//  - RN-EQU-06: total = mano de obra + repuestos + servicio externo (CHECK en maintenance_orders).
//  - RN-EQU-12: las calibraciones son de solo inserción (REVOKE UPDATE, DELETE al usuario de la app).
//  - Datos de compra, marca, modelo, serie, capacidad y manual pasan a opcionales: un equipo viejo
//    puede no tenerlos y el generador los dejó obligatorios solo porque la demo siempre los traía.
//  - Tabla nueva equipment_usage (EQU-08): horas de uso por orden de producción, con la carga por hora
//    del momento. PRO (que aún no existe) agregará la FK de production_order_id y la llenará con
//    EquiposService::registrarUso().
return new class extends Migration
{
    private const CATEGORIAS = ['SEALER', 'STOVE', 'POT', 'SCALE', 'COLD_ROOM', 'FREEZER', 'GRINDER', 'STUFFER', 'SAW', 'SLICER', 'LABEL_PRINTER', 'THERMOMETER', 'OTHER'];

    private const ESTADOS = [
        ['equipment', 'category', self::CATEGORIAS],
        ['equipment', 'status', ['ACTIVE', 'OUT_OF_SERVICE', 'RETIRED']],
        ['equipment_calibrations', 'result', ['PASS', 'FAIL']],
        ['maintenance_plans', 'status', ['ACTIVE', 'INACTIVE']],
        ['maintenance_orders', 'kind', ['PREVENTIVE', 'CORRECTIVE']],
        ['maintenance_orders', 'status', ['OPEN', 'IN_PROGRESS', 'DONE', 'VOIDED']],
        ['maintenance_orders', 'urgency', ['LOW', 'NORMAL', 'HIGH']],
    ];

    public function up(): void
    {
        // Columnas opcionales (equipos antiguos sin factura, manual o serie).
        foreach (['brand_name', 'model', 'serial_number', 'purchase_date', 'purchase_cost', 'useful_life_months', 'power_kw', 'capacity', 'manual_url'] as $c) {
            DB::statement("ALTER TABLE equipment ALTER COLUMN {$c} DROP NOT NULL");
        }
        DB::statement('ALTER TABLE equipment ALTER COLUMN hourly_rate SET DEFAULT 0');
        DB::statement('ALTER TABLE equipment ALTER COLUMN hour_meter SET DEFAULT 0');
        DB::statement("ALTER TABLE equipment ALTER COLUMN meter_readings SET DEFAULT '[]'::jsonb");
        DB::statement("ALTER TABLE equipment ALTER COLUMN photos SET DEFAULT '[]'::jsonb");
        DB::statement('ALTER TABLE equipment ALTER COLUMN hour_meter TYPE numeric(14,1)');
        DB::statement('ALTER TABLE equipment_calibrations ALTER COLUMN max_error_g TYPE numeric(14,3)');
        DB::statement('ALTER TABLE equipment_calibrations ALTER COLUMN provider_name DROP NOT NULL');
        DB::statement('ALTER TABLE equipment_calibrations ALTER COLUMN cost SET DEFAULT 0');
        DB::statement('ALTER TABLE maintenance_plans ALTER COLUMN responsible_name DROP NOT NULL');
        DB::statement("ALTER TABLE maintenance_plans ALTER COLUMN status SET DEFAULT 'ACTIVE'");
        DB::statement('ALTER TABLE maintenance_plans ALTER COLUMN next_due_hours TYPE numeric(14,1)');
        DB::statement('ALTER TABLE maintenance_orders ALTER COLUMN diagnosis TYPE text');
        foreach (['labor_hours', 'labor_cost', 'parts_cost', 'external_cost', 'total_cost'] as $c) {
            DB::statement("ALTER TABLE maintenance_orders ALTER COLUMN {$c} SET DEFAULT 0");
        }
        DB::statement("ALTER TABLE maintenance_orders ALTER COLUMN parts SET DEFAULT '[]'::jsonb");
        DB::statement("ALTER TABLE maintenance_orders ALTER COLUMN urgency SET DEFAULT 'NORMAL'");
        DB::statement("ALTER TABLE maintenance_orders ALTER COLUMN status SET DEFAULT 'OPEN'");

        // Columnas nuevas que piden las pantallas.
        Schema::table('equipment', function (Blueprint $table) {
            $table->text('notes')->nullable();
        });
        Schema::table('equipment_calibrations', function (Blueprint $table) {
            $table->uuid('recorded_by_user_id')->nullable();   // quién la registró; recorded_by queda como foto del nombre
            $table->foreign('recorded_by_user_id')->references('id')->on('users')->restrictOnDelete();
        });
        Schema::table('maintenance_orders', function (Blueprint $table) {
            $table->uuid('finished_by')->nullable();
            $table->timestampTz('voided_at')->nullable();
            $table->uuid('voided_by')->nullable();
            $table->foreign('finished_by')->references('id')->on('users')->restrictOnDelete();
            $table->foreign('voided_by')->references('id')->on('users')->restrictOnDelete();
        });

        foreach (self::ESTADOS as [$tabla, $col, $valores]) {
            $lista = implode(',', array_map(fn ($v) => "'{$v}'", $valores));
            DB::statement("ALTER TABLE {$tabla} ADD CONSTRAINT {$tabla}_{$col}_valido CHECK ({$col} IN ({$lista}))");
        }
        DB::statement("ALTER TABLE equipment ADD CONSTRAINT equipment_oos_reason_valido CHECK (oos_reason IS NULL OR oos_reason IN ('CORRECTIVE','CALIBRATION','MANUAL'))");

        // RN-EQU-01: toda balanza exige calibración.
        DB::statement("ALTER TABLE equipment ADD CONSTRAINT equipment_balanza_calibrada CHECK (category <> 'SCALE' OR requires_calibration)");
        DB::statement('ALTER TABLE equipment ADD CONSTRAINT equipment_montos CHECK (hourly_rate >= 0 AND hour_meter >= 0 AND (purchase_cost IS NULL OR purchase_cost >= 0) AND (power_kw IS NULL OR power_kw >= 0))');
        DB::statement('ALTER TABLE equipment ADD CONSTRAINT equipment_vida_util CHECK (useful_life_months IS NULL OR useful_life_months > 0)');

        // RN-EQU-02: número y archivo del certificado, y vigencia posterior a la fecha de calibración.
        DB::statement("ALTER TABLE equipment_calibrations ADD CONSTRAINT equipment_calibrations_certificado CHECK (btrim(certificate_number) <> '' AND btrim(certificate_url) <> '')");
        DB::statement('ALTER TABLE equipment_calibrations ADD CONSTRAINT equipment_calibrations_vigencia CHECK (valid_until > calibrated_on)');
        DB::statement('ALTER TABLE equipment_calibrations ADD CONSTRAINT equipment_calibrations_costo CHECK (cost >= 0 AND (max_error_g IS NULL OR max_error_g >= 0))');

        // Plan con frecuencia en días u horas de uso.
        DB::statement('ALTER TABLE maintenance_plans ADD CONSTRAINT maintenance_plans_frecuencia CHECK ((frequency_days IS NOT NULL AND frequency_days > 0) OR (frequency_hours IS NOT NULL AND frequency_hours > 0))');

        // RN-EQU-06: costo = mano de obra + repuestos + servicio externo.
        DB::statement('ALTER TABLE maintenance_orders ADD CONSTRAINT maintenance_orders_costos CHECK (labor_cost >= 0 AND parts_cost >= 0 AND external_cost >= 0 AND labor_hours >= 0 AND (downtime_hours IS NULL OR downtime_hours >= 0))');
        DB::statement('ALTER TABLE maintenance_orders ADD CONSTRAINT maintenance_orders_total CHECK (total_cost = labor_cost + parts_cost + external_cost)');
        DB::statement('ALTER TABLE maintenance_orders ADD CONSTRAINT maintenance_orders_preventiva_con_plan CHECK (kind <> \'PREVENTIVE\' OR plan_id IS NOT NULL OR status IN (\'DONE\', \'VOIDED\'))');
        DB::statement("ALTER TABLE maintenance_orders ADD CONSTRAINT maintenance_orders_anulada_con_motivo CHECK (status <> 'VOIDED' OR btrim(coalesce(void_reason, '')) <> '')");

        // Únicos.
        Schema::table('equipment', fn (Blueprint $table) => $table->unique(['tenant_id', 'code']));
        Schema::table('equipment', fn (Blueprint $table) => $table->unique(['tenant_id', 'qr_code']));
        Schema::table('maintenance_orders', fn (Blueprint $table) => $table->unique(['tenant_id', 'number']));
        // RN-EQU-07: una sola orden abierta por plan (generar dos veces no la duplica).
        DB::statement("CREATE UNIQUE INDEX maintenance_orders_una_abierta_por_plan ON maintenance_orders (plan_id) WHERE plan_id IS NOT NULL AND status IN ('OPEN','IN_PROGRESS')");

        // Índices de las pantallas y de RN-EQU-03/05.
        DB::statement('CREATE INDEX equipment_calibrations_vigentes_index ON equipment_calibrations (equipment_id, result, valid_until)');
        DB::statement('CREATE INDEX maintenance_orders_equipo_estado_index ON maintenance_orders (equipment_id, kind, status)');
        DB::statement('CREATE INDEX maintenance_orders_estado_fecha_index ON maintenance_orders (status, reported_at)');
        DB::statement('CREATE INDEX equipment_estado_index ON equipment (status, category)');

        // EQU-08 · horas de uso por orden de producción.
        Schema::create('equipment_usage', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('equipment_id');
            $table->uuid('production_order_id')->nullable()->comment('apunta a production_orders (PRO, módulo posterior): la FK la agrega su dueño');
            $table->string('order_ref', 40)->nullable();
            $table->date('used_on');
            $table->decimal('hours', 9, 2);
            $table->decimal('hourly_rate', 9, 4);
            $table->decimal('cost', 14, 2);
            $table->string('source', 10)->default('EQU');
            $table->uuid('recorded_by')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
            $table->index(['equipment_id', 'used_on']);
            $table->index('used_on');
            $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete();
            $table->foreign('equipment_id')->references('id')->on('equipment')->restrictOnDelete();
            $table->foreign('recorded_by')->references('id')->on('users')->restrictOnDelete();
        });
        DB::statement('ALTER TABLE equipment_usage ADD CONSTRAINT equipment_usage_horas CHECK (hours > 0 AND hourly_rate >= 0 AND cost >= 0)');
        DB::statement("ALTER TABLE equipment_usage ADD CONSTRAINT equipment_usage_orden CHECK (production_order_id IS NOT NULL OR btrim(coalesce(order_ref, '')) <> '')");
        DB::statement("ALTER TABLE equipment_usage ADD CONSTRAINT equipment_usage_source_valido CHECK (source IN ('EQU','PRO'))");
        DB::statement("SELECT enable_tenant_rls('equipment_usage')");
        DB::statement("SELECT audit.track('equipment_usage')");

        // RN-EQU-12: calibraciones de solo inserción. Un error se corrige registrando otra.
        DB::statement('REVOKE UPDATE, DELETE, TRUNCATE ON equipment_calibrations FROM aycha_app');
    }

    public function down(): void
    {
        DB::statement('GRANT UPDATE, DELETE, TRUNCATE ON equipment_calibrations TO aycha_app');
        Schema::dropIfExists('equipment_usage');
        DB::statement('DROP INDEX IF EXISTS maintenance_orders_una_abierta_por_plan');
        DB::statement('DROP INDEX IF EXISTS equipment_calibrations_vigentes_index');
        DB::statement('DROP INDEX IF EXISTS maintenance_orders_equipo_estado_index');
        DB::statement('DROP INDEX IF EXISTS maintenance_orders_estado_fecha_index');
        DB::statement('DROP INDEX IF EXISTS equipment_estado_index');
        Schema::table('equipment', fn (Blueprint $table) => $table->dropUnique(['tenant_id', 'code']));
        Schema::table('equipment', fn (Blueprint $table) => $table->dropUnique(['tenant_id', 'qr_code']));
        Schema::table('maintenance_orders', fn (Blueprint $table) => $table->dropUnique(['tenant_id', 'number']));
        foreach (['maintenance_orders_costos', 'maintenance_orders_total', 'maintenance_orders_preventiva_con_plan', 'maintenance_orders_anulada_con_motivo'] as $c) {
            DB::statement("ALTER TABLE maintenance_orders DROP CONSTRAINT IF EXISTS {$c}");
        }
        DB::statement('ALTER TABLE maintenance_plans DROP CONSTRAINT IF EXISTS maintenance_plans_frecuencia');
        foreach (['equipment_calibrations_certificado', 'equipment_calibrations_vigencia', 'equipment_calibrations_costo'] as $c) {
            DB::statement("ALTER TABLE equipment_calibrations DROP CONSTRAINT IF EXISTS {$c}");
        }
        foreach (['equipment_balanza_calibrada', 'equipment_montos', 'equipment_vida_util', 'equipment_oos_reason_valido'] as $c) {
            DB::statement("ALTER TABLE equipment DROP CONSTRAINT IF EXISTS {$c}");
        }
        foreach (self::ESTADOS as [$tabla, $col]) {
            DB::statement("ALTER TABLE {$tabla} DROP CONSTRAINT IF EXISTS {$tabla}_{$col}_valido");
        }
        Schema::table('maintenance_orders', function (Blueprint $table) {
            $table->dropForeign(['finished_by']);
            $table->dropForeign(['voided_by']);
            $table->dropColumn(['finished_by', 'voided_at', 'voided_by']);
        });
        Schema::table('equipment_calibrations', function (Blueprint $table) {
            $table->dropForeign(['recorded_by_user_id']);
            $table->dropColumn('recorded_by_user_id');
        });
        Schema::table('equipment', fn (Blueprint $table) => $table->dropColumn('notes'));
    }
};
