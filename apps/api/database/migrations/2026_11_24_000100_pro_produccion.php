<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// PRO · Órdenes de producción. Punto de partida: tools/prototipo/generar_migraciones.py (PRO), revisado:
//  - tipos y largos de verdad, únicos por empresa y CHECK de estados, tipos, roles y cantidades;
//  - RN-PRO-01 en la base: una orden RECIPE lleva su versión de receta y una CUTTING su plantilla;
//  - RN-PRO-11 en la base: una lectura fuera de rango lleva acción correctiva;
//  - RN-PRO-14 en la base: una orden anulada lleva motivo;
//  - consumos y lecturas de solo inserción (se corrige con un reverso en ALM, no editando);
//  - quién hizo cada cosa: uuid del usuario (el nombre del prototipo queda en recorded_by_name y en history);
//  - las FK que EQU y CAL dejaron pendientes hacia production_orders.
// PRO es el único que escribe estas tablas (app/Modulos/Pro/Services). Los demás leen.
return new class extends Migration
{
    private const TABLAS = ['production_lines', 'production_orders', 'production_order_consumptions', 'production_order_outputs',
        'production_order_labor', 'production_order_equipment', 'production_ccp_readings'];

    public function up(): void
    {
        Schema::create('production_lines', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('establishment_id');
            $table->string('code', 40);
            $table->string('name', 80);
            $table->string('line_type', 20)->comment('CUTTING, VACUUM_PACK, LARD, BROTH, SAUSAGE, JAM, OTHER');
            $table->uuid('input_warehouse_id');
            $table->uuid('output_warehouse_id');
            $table->uuid('cost_center_id');
            $table->decimal('max_waste_pct', 6, 2)->nullable()->comment('RN-PRO-08: merma máxima sin motivo; vacío = pro_max_waste_pct');
            $table->string('status', 20)->default('ACTIVE');
            $table->text('notes')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
            $table->unique(['tenant_id', 'code']);
            $table->foreign('establishment_id')->references('id')->on('establishments')->restrictOnDelete();
            $table->foreign('input_warehouse_id')->references('id')->on('warehouses')->restrictOnDelete();
            $table->foreign('output_warehouse_id')->references('id')->on('warehouses')->restrictOnDelete();
            $table->foreign('cost_center_id')->references('id')->on('cost_centers')->restrictOnDelete();
        });

        Schema::create('production_orders', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->string('series', 10)->default('OP01');
            $table->string('number', 20);
            $table->uuid('company_id');
            $table->uuid('establishment_id');
            $table->uuid('line_id');
            $table->string('order_type', 20)->comment('RECIPE, CUTTING, PACKING');
            $table->uuid('brand_id');
            $table->uuid('product_id');
            $table->uuid('output_variant_id')->nullable()->comment('RECIPE y PACKING: la variante que se produce');
            $table->uuid('source_variant_id')->nullable()->comment('CUTTING y PACKING: la variante que entra');
            $table->uuid('recipe_version_id')->nullable()->comment('RN-PRO-01: versión aprobada fijada al crear');
            $table->uuid('cutting_template_id')->nullable()->comment('RN-PRO-01: plantilla ACTIVE fijada al crear');
            $table->date('planned_date');
            $table->decimal('planned_output_kg', 14, 3);
            $table->decimal('scale_factor', 12, 6)->nullable()->comment('RN-PRO-12: kg planificados / kg base de la receta');
            $table->decimal('expected_yield_pct', 7, 2)->nullable();
            $table->decimal('standard_cost_per_kg', 14, 4)->nullable()->comment('Costo estándar de la receta al crear (KPI-PRO-05)');
            $table->uuid('supervisor_user_id');
            $table->string('status', 20)->default('PLANNED')->comment('PLANNED, RELEASED, IN_PROGRESS, CLOSED, VOIDED');
            $table->text('notes')->nullable();
            $table->jsonb('history')->default(DB::raw("'[]'::jsonb"));
            $table->uuid('created_by')->nullable();
            $table->timestampTz('released_at')->nullable();
            $table->timestampTz('started_at')->nullable();
            // Cierre (PRO-10): cifras que fija pro_close_order / ProduccionService::cerrar.
            $table->timestampTz('closed_at')->nullable();
            $table->date('close_date')->nullable();
            $table->uuid('closed_by')->nullable();
            $table->decimal('input_kg', 14, 3)->nullable();
            $table->decimal('output_kg', 14, 3)->nullable();
            $table->decimal('main_kg', 14, 3)->nullable();
            $table->decimal('waste_kg', 14, 3)->nullable();
            $table->decimal('waste_pct', 7, 2)->nullable();
            $table->decimal('actual_yield_pct', 7, 2)->nullable();
            $table->decimal('yield_deviation_pp', 7, 2)->nullable();
            $table->string('yield_deviation_reason', 500)->nullable();
            $table->string('waste_reason', 500)->nullable();
            $table->decimal('raw_material_cost', 14, 2)->nullable();
            $table->decimal('input_cost', 14, 2)->nullable();
            $table->decimal('packaging_cost', 14, 2)->nullable();
            $table->decimal('material_cost', 14, 2)->nullable();
            $table->decimal('labor_cost', 14, 2)->nullable();
            $table->decimal('equipment_cost', 14, 2)->nullable();
            $table->decimal('total_cost', 14, 2)->nullable();
            $table->decimal('cost_per_kg', 14, 4)->nullable();
            $table->decimal('ingredient_cost_per_kg', 14, 4)->nullable();
            $table->boolean('critical_deviation')->default(false)->comment('RN-PRO-11: hubo un punto crítico fuera de rango');
            // Despiece (DES): balance de masa y costeo conjunto.
            $table->decimal('mass_balance_pct', 7, 2)->nullable();
            $table->uuid('mass_balance_override_by')->nullable();
            $table->decimal('joint_cost', 14, 2)->nullable();
            $table->decimal('nrv_total', 14, 2)->nullable();
            $table->jsonb('cut_alerts')->nullable();
            // Anulación (PRO-13)
            $table->string('void_reason', 500)->nullable();
            $table->timestampTz('voided_at')->nullable();
            $table->uuid('voided_by')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
            $table->unique(['tenant_id', 'number']);
            $table->index(['establishment_id', 'status']);
            $table->index('planned_date');
            foreach (['company_id' => 'companies', 'establishment_id' => 'establishments', 'line_id' => 'production_lines', 'brand_id' => 'brands',
                'product_id' => 'products', 'output_variant_id' => 'product_variants', 'source_variant_id' => 'product_variants',
                'recipe_version_id' => 'recipe_versions', 'supervisor_user_id' => 'users', 'created_by' => 'users', 'closed_by' => 'users',
                'voided_by' => 'users', 'mass_balance_override_by' => 'users'] as $col => $destino) {
                $table->foreign($col)->references('id')->on($destino)->restrictOnDelete();
            }
        });

        Schema::create('production_order_consumptions', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('order_id');
            $table->uuid('warehouse_id');
            $table->uuid('variant_id');
            $table->uuid('lot_id')->nullable();
            $table->string('role', 20)->comment('RAW_MATERIAL, INPUT, PACKAGING');
            $table->decimal('theoretical_kg', 14, 3)->nullable()->comment('RN-PRO-12: receta escalada');
            $table->decimal('qty', 14, 3);
            $table->decimal('weight_kg', 14, 3)->nullable();
            $table->decimal('unit_cost', 18, 4);
            $table->decimal('total_cost', 14, 2);
            $table->timestampTz('consumed_at');
            $table->string('fefo_override_reason', 500)->nullable()->comment('RN-PRO-03');
            $table->uuid('stock_movement_id')->comment('RN-PRO-13: PRODUCTION_OUT de ALM');
            $table->uuid('recorded_by')->nullable();
            $table->string('recorded_by_name', 120)->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
            $table->index('order_id');
            $table->index('lot_id');
            foreach (['order_id' => 'production_orders', 'warehouse_id' => 'warehouses', 'variant_id' => 'product_variants', 'lot_id' => 'lots',
                'stock_movement_id' => 'stock_movements', 'recorded_by' => 'users'] as $col => $destino) {
                $table->foreign($col)->references('id')->on($destino)->restrictOnDelete();
            }
        });

        Schema::create('production_order_outputs', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('order_id');
            $table->string('output_role', 20)->comment('MAIN, CO_PRODUCT, BY_PRODUCT, WASTE');
            $table->uuid('variant_id')->nullable();
            $table->uuid('lot_id')->nullable();
            $table->uuid('warehouse_id')->nullable();
            $table->decimal('qty', 14, 3);
            $table->decimal('weight_kg', 14, 3);
            $table->uuid('scale_equipment_id')->nullable()->comment('RN-PRO-15: balanza apta (EquiposService::exigirBalanza)');
            $table->uuid('template_line_id')->nullable()->comment('DES: corte de la plantilla');
            $table->decimal('reference_price_per_kg', 14, 4)->nullable();
            $table->decimal('nrv_cost_per_kg', 14, 4)->nullable();
            $table->decimal('allocated_cost', 14, 2)->nullable();
            $table->decimal('unit_cost', 18, 6)->nullable()->comment('Costo final por kg o unidad, fijado al cerrar');
            $table->uuid('stock_movement_id')->nullable()->comment('RN-PRO-13: PRODUCTION_IN de ALM');
            $table->string('waste_reason', 500)->nullable();
            $table->timestampTz('at');
            $table->uuid('recorded_by')->nullable();
            $table->string('recorded_by_name', 120)->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
            $table->index('order_id');
            $table->index('lot_id');
            foreach (['order_id' => 'production_orders', 'variant_id' => 'product_variants', 'lot_id' => 'lots', 'warehouse_id' => 'warehouses',
                'scale_equipment_id' => 'equipment', 'stock_movement_id' => 'stock_movements', 'recorded_by' => 'users'] as $col => $destino) {
                $table->foreign($col)->references('id')->on($destino)->restrictOnDelete();
            }
        });

        Schema::create('production_order_labor', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('order_id');
            $table->uuid('employee_id');
            $table->string('task_role', 20)->comment('CUTTER, SAUSAGE_MAKER, COOK, PACKER, HELPER, SUPERVISOR');
            $table->date('work_date');
            $table->decimal('hours', 6, 2);
            $table->decimal('hourly_rate', 10, 4);
            $table->decimal('cost', 14, 2);
            $table->string('rate_source', 20)->default('PARAM')->comment('RN-PRO-18: PER (tarifa del trabajador) o PARAM (pro_default_labor_rate_pen)');
            $table->uuid('recorded_by')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
            $table->index('order_id');
            foreach (['order_id' => 'production_orders', 'employee_id' => 'employees', 'recorded_by' => 'users'] as $col => $destino) {
                $table->foreign($col)->references('id')->on($destino)->restrictOnDelete();
            }
        });

        Schema::create('production_order_equipment', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('order_id');
            $table->uuid('equipment_id');
            $table->string('equipment_name', 80)->nullable();
            $table->date('used_on')->nullable();
            $table->decimal('hours', 6, 2);
            $table->decimal('hourly_rate', 10, 4);
            $table->decimal('cost', 14, 2);
            $table->uuid('equipment_usage_id')->nullable()->comment('La fila de EQU (EquiposService::registrarUso, source = PRO)');
            $table->uuid('recorded_by')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
            $table->index('order_id');
            foreach (['order_id' => 'production_orders', 'equipment_id' => 'equipment', 'equipment_usage_id' => 'equipment_usage', 'recorded_by' => 'users'] as $col => $destino) {
                $table->foreign($col)->references('id')->on($destino)->restrictOnDelete();
            }
        });

        Schema::create('production_ccp_readings', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('order_id');
            $table->uuid('control_point_id');
            $table->decimal('value', 12, 3);
            $table->timestampTz('read_at');
            $table->uuid('read_by')->nullable();
            $table->string('reader_name', 120)->nullable();
            $table->boolean('in_range');
            $table->string('corrective_action', 1000)->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
            $table->index('order_id');
            foreach (['order_id' => 'production_orders', 'control_point_id' => 'recipe_control_points', 'read_by' => 'users'] as $col => $destino) {
                $table->foreign($col)->references('id')->on($destino)->restrictOnDelete();
            }
        });

        foreach (self::TABLAS as $t) {
            DB::statement("ALTER TABLE {$t} ADD CONSTRAINT {$t}_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id)");
        }

        $checks = [
            'production_lines' => [
                'tipo' => "line_type IN ('CUTTING','VACUUM_PACK','LARD','BROTH','SAUSAGE','JAM','OTHER')",
                'estado' => "status IN ('ACTIVE','INACTIVE')",
                'merma' => 'max_waste_pct IS NULL OR (max_waste_pct >= 0 AND max_waste_pct <= 100)',
            ],
            'production_orders' => [
                'tipo' => "order_type IN ('RECIPE','CUTTING','PACKING')",
                'estado' => "status IN ('PLANNED','RELEASED','IN_PROGRESS','CLOSED','VOIDED')",
                'kg' => 'planned_output_kg > 0',
                // RN-PRO-01
                'receta' => "order_type <> 'RECIPE' OR recipe_version_id IS NOT NULL",
                'plantilla' => "order_type <> 'CUTTING' OR cutting_template_id IS NOT NULL",
                // RN-PRO-14
                'anulada' => "status <> 'VOIDED' OR btrim(coalesce(void_reason, '')) <> ''",
                'cerrada' => "status <> 'CLOSED' OR close_date IS NOT NULL",
            ],
            'production_order_consumptions' => [
                'rol' => "role IN ('RAW_MATERIAL','INPUT','PACKAGING')",
                'cantidad' => 'qty > 0 AND (weight_kg IS NULL OR weight_kg >= 0) AND unit_cost >= 0',
            ],
            'production_order_outputs' => [
                'rol' => "output_role IN ('MAIN','CO_PRODUCT','BY_PRODUCT','WASTE')",
                'cantidad' => 'qty >= 0 AND weight_kg >= 0',
                // Todo producto sale con su lote; la merma no tiene variante ni lote, pero sí motivo cuando la escribe PRO-08.
                'lote' => "output_role = 'WASTE' OR (variant_id IS NOT NULL AND lot_id IS NOT NULL)",
            ],
            'production_order_labor' => [
                'rol' => "task_role IN ('CUTTER','SAUSAGE_MAKER','COOK','PACKER','HELPER','SUPERVISOR')",
                'horas' => 'hours > 0 AND hours <= 24 AND hourly_rate >= 0 AND cost >= 0',
                'tarifa' => "rate_source IN ('PER','PARAM','MANUAL')",
            ],
            'production_order_equipment' => [
                'horas' => 'hours > 0 AND hours <= 24 AND hourly_rate >= 0 AND cost >= 0',
            ],
            'production_ccp_readings' => [
                // RN-PRO-11
                'accion' => "in_range OR btrim(coalesce(corrective_action, '')) <> ''",
            ],
        ];
        foreach ($checks as $t => $lista) {
            foreach ($lista as $nombre => $expr) {
                DB::statement("ALTER TABLE {$t} ADD CONSTRAINT {$t}_{$nombre} CHECK ({$expr})");
            }
        }

        // Solo inserción: un consumo se corrige con un reverso del kardex y una lectura con otra lectura.
        foreach (['production_order_consumptions', 'production_ccp_readings'] as $t) {
            DB::statement("REVOKE UPDATE, DELETE, TRUNCATE ON {$t} FROM aycha_app");
        }

        foreach (self::TABLAS as $t) {
            DB::statement("SELECT enable_tenant_rls('{$t}')");
            DB::statement("SELECT audit.track('{$t}')");
        }

        // Pendientes de EQU y CAL: sus columnas production_order_id ya apuntan a una orden.
        DB::statement('ALTER TABLE equipment_usage ADD CONSTRAINT equipment_usage_production_order_fk FOREIGN KEY (production_order_id) REFERENCES production_orders(id)');
        DB::statement('ALTER TABLE qc_inspections ADD CONSTRAINT qc_inspections_production_order_fk FOREIGN KEY (production_order_id) REFERENCES production_orders(id)');
        DB::statement('ALTER TABLE nonconformities ADD CONSTRAINT nonconformities_production_order_fk FOREIGN KEY (production_order_id) REFERENCES production_orders(id)');
        DB::statement('CREATE INDEX IF NOT EXISTS equipment_usage_production_order_idx ON equipment_usage (production_order_id)');
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE equipment_usage DROP CONSTRAINT IF EXISTS equipment_usage_production_order_fk');
        DB::statement('ALTER TABLE qc_inspections DROP CONSTRAINT IF EXISTS qc_inspections_production_order_fk');
        DB::statement('ALTER TABLE nonconformities DROP CONSTRAINT IF EXISTS nonconformities_production_order_fk');
        foreach (array_reverse(self::TABLAS) as $t) {
            DB::statement("DROP TABLE IF EXISTS {$t} CASCADE");
        }
    }
};
