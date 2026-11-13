<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// REC · restricciones, índices y correcciones del esquema generado (002800 creó las tablas).
// Decisiones y motivos: docs/contratos.md (sección REC) y docs/cambios/2026-11-12_rec-recetas.md.
//
//  - Los kg de ingrediente pasan a 4 decimales: el nitrito va en 0,0015 kg por lote base (CA-REC-03);
//    con 3 decimales quedaba en 0,002 kg y la dosis subía de 145 a 193 ppm.
//  - RN-REC-01: una sola versión APPROVED por receta (índice único parcial).
//  - RN-REC-03: una versión APPROVED o RETIRED no cambia. Lo valida RecetasService y, además, la base:
//    un disparador rechaza cambiar o borrar ingredientes, pasos y puntos de control de esas versiones,
//    y cambiar el contenido de la versión (solo se permite retirarla y guardar el recálculo del costo).
//    Insertar no se bloquea en la base porque la siembra crea primero la versión aprobada y luego sus filas.
return new class extends Migration
{
    private const ESTADOS = [
        ['recipes', 'status', ['ACTIVE', 'INACTIVE', 'DRAFT']],
        ['recipes', 'recipe_type', ['SAUSAGE', 'BROTH', 'JAM', 'LARD', 'CURED', 'PRESERVE', 'CUT_PACK', 'OTHER']],
        ['recipe_versions', 'status', ['DRAFT', 'IN_REVIEW', 'APPROVED', 'RETIRED']],
        ['recipe_versions', 'storage', ['CHILLED', 'FROZEN', 'AMBIENT']],
        ['food_additives', 'status', ['ACTIVE', 'INACTIVE']],
        ['food_additives', 'function_class', ['PRESERVATIVE', 'ANTIOXIDANT', 'COLOR', 'FLAVOR_ENHANCER', 'THICKENER', 'GELLING', 'ACIDITY_REGULATOR', 'STABILIZER', 'EMULSIFIER', 'SEQUESTRANT', 'OTHER']],
        ['recipe_steps', 'equipment_category', ['POT', 'STOVE', 'STUFFER', 'SEALER', 'GRINDER', 'SAW', 'SCALE', 'SMOKER', 'COLD_ROOM', 'ROASTER', 'OTHER']],
        ['recipe_control_points', 'variable', ['CORE_TEMP', 'TIME', 'PH', 'BRINE_PCT', 'BRIX', 'WATER_ACTIVITY', 'OTHER']],
    ];

    public function up(): void
    {
        // Precisión: kg de ingrediente a 4 decimales (CA-REC-03) y costo por kg a 4 (CA-REC-06: S/ 15,370).
        DB::statement('ALTER TABLE recipe_ingredients ALTER COLUMN qty_kg TYPE numeric(14,4)');
        DB::statement('ALTER TABLE recipe_versions ALTER COLUMN standard_cost_per_kg TYPE numeric(14,4)');
        DB::statement('ALTER TABLE recipe_versions ALTER COLUMN expected_yield_pct DROP NOT NULL');   // se calcula al enviar y al aprobar
        DB::statement('ALTER TABLE recipe_control_points ALTER COLUMN min_value TYPE numeric(14,3)');
        DB::statement('ALTER TABLE recipe_control_points ALTER COLUMN max_value TYPE numeric(14,3)');
        DB::statement('ALTER TABLE recipe_steps ALTER COLUMN duration_min DROP NOT NULL');         // un paso puede no tener tiempo
        DB::statement('ALTER TABLE recipe_steps ALTER COLUMN equipment_category DROP NOT NULL');
        DB::statement("ALTER TABLE recipe_ingredients ALTER COLUMN weighing_tolerance_pct SET DEFAULT 2");
        DB::statement("ALTER TABLE recipe_versions ALTER COLUMN allergens SET DEFAULT '[]'::jsonb");
        DB::statement("ALTER TABLE recipe_versions ALTER COLUMN packaging SET DEFAULT '[]'::jsonb");
        DB::statement("ALTER TABLE recipe_versions ALTER COLUMN history SET DEFAULT '[]'::jsonb");

        // REC-09: el último recálculo del costo estándar (KPI-REC-01), sin tocar el costo fijado al aprobar.
        Schema::table('recipe_versions', function (Blueprint $table) {
            $table->decimal('recalc_cost_per_kg', 14, 4)->nullable();
            $table->timestampTz('recalc_at')->nullable();
        });

        foreach (self::ESTADOS as [$tabla, $col, $valores]) {
            $lista = implode(',', array_map(fn ($v) => "'{$v}'", $valores));
            DB::statement("ALTER TABLE {$tabla} ADD CONSTRAINT {$tabla}_{$col}_valido CHECK ({$col} IN ({$lista}))");
        }

        // Cantidades y rangos.
        DB::statement('ALTER TABLE recipe_versions ADD CONSTRAINT recipe_versions_base_positiva CHECK (base_output_kg > 0)');
        DB::statement('ALTER TABLE recipe_versions ADD CONSTRAINT recipe_versions_vida_util_positiva CHECK (shelf_life_days IS NULL OR shelf_life_days > 0)');
        DB::statement('ALTER TABLE recipe_ingredients ADD CONSTRAINT recipe_ingredients_kg_positivo CHECK (qty_kg > 0)');
        DB::statement('ALTER TABLE recipe_ingredients ADD CONSTRAINT recipe_ingredients_tolerancia CHECK (weighing_tolerance_pct >= 0 AND weighing_tolerance_pct <= 100)');
        // RN-REC-04: un aditivo apunta al catálogo.
        DB::statement('ALTER TABLE recipe_ingredients ADD CONSTRAINT recipe_ingredients_aditivo_con_sin CHECK (NOT is_additive OR additive_id IS NOT NULL)');
        DB::statement('ALTER TABLE recipe_steps ADD CONSTRAINT recipe_steps_tiempo CHECK (duration_min IS NULL OR duration_min >= 0)');
        // RN-REC-12: mínimo ≤ máximo y acción correctiva escrita.
        DB::statement('ALTER TABLE recipe_control_points ADD CONSTRAINT recipe_control_points_rango CHECK (min_value <= max_value)');
        DB::statement("ALTER TABLE recipe_control_points ADD CONSTRAINT recipe_control_points_accion CHECK (btrim(corrective_action) <> '')");
        DB::statement('ALTER TABLE food_additives ADD CONSTRAINT food_additives_limite_positivo CHECK (max_ppm IS NULL OR max_ppm > 0)');

        // Únicos.
        Schema::table('recipes', fn (Blueprint $table) => $table->unique(['tenant_id', 'code']));
        Schema::table('recipe_versions', fn (Blueprint $table) => $table->unique(['recipe_id', 'version']));
        Schema::table('food_additives', fn (Blueprint $table) => $table->unique(['tenant_id', 'sin_code']));
        // RN-REC-01: una sola versión aprobada por receta. Y una sola en curso (borrador o revisión).
        DB::statement("CREATE UNIQUE INDEX recipe_versions_una_aprobada ON recipe_versions (recipe_id) WHERE status = 'APPROVED'");
        DB::statement("CREATE UNIQUE INDEX recipe_versions_una_en_curso ON recipe_versions (recipe_id) WHERE status IN ('DRAFT','IN_REVIEW')");

        // Índices de las pantallas.
        DB::statement('CREATE INDEX recipe_ingredients_version_seq_index ON recipe_ingredients (version_id, seq)');
        DB::statement('CREATE INDEX recipe_steps_version_seq_index ON recipe_steps (version_id, seq)');
        DB::statement('CREATE INDEX recipe_control_points_version_index ON recipe_control_points (version_id, step_seq)');
        DB::statement('CREATE INDEX recipe_versions_estado_index ON recipe_versions (tenant_id, status)');

        // RN-REC-03 en la base.
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION rec_version_cerrada() RETURNS trigger LANGUAGE plpgsql AS $$
            DECLARE
                v_estado text;
                v_version uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.version_id ELSE NEW.version_id END;
            BEGIN
                SELECT status INTO v_estado FROM recipe_versions WHERE id = OLD.version_id;
                IF v_estado IN ('APPROVED', 'RETIRED') THEN
                    RAISE EXCEPTION 'RN-REC-03: la versión está % y no cambia; crea una versión nueva', lower(CASE v_estado WHEN 'APPROVED' THEN 'aprobada' ELSE 'retirada' END)
                        USING ERRCODE = 'check_violation';
                END IF;
                IF TG_OP = 'UPDATE' AND v_version IS DISTINCT FROM OLD.version_id THEN
                    SELECT status INTO v_estado FROM recipe_versions WHERE id = v_version;
                    IF v_estado IN ('APPROVED', 'RETIRED') THEN
                        RAISE EXCEPTION 'RN-REC-03: la versión de destino está cerrada' USING ERRCODE = 'check_violation';
                    END IF;
                END IF;
                RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
            END $$;

            CREATE OR REPLACE FUNCTION rec_version_sin_cambios() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                IF OLD.status IN ('APPROVED', 'RETIRED') THEN
                    IF TG_OP = 'DELETE' THEN
                        RAISE EXCEPTION 'RN-REC-03: una versión aprobada o retirada no se borra' USING ERRCODE = 'check_violation';
                    END IF;
                    -- Solo se permite: APPROVED → RETIRED, y guardar el recálculo del costo (REC-09).
                    IF NEW.base_output_kg IS DISTINCT FROM OLD.base_output_kg OR NEW.shelf_life_days IS DISTINCT FROM OLD.shelf_life_days
                        OR NEW.storage IS DISTINCT FROM OLD.storage OR NEW.allergens IS DISTINCT FROM OLD.allergens
                        OR NEW.standard_cost_per_kg IS DISTINCT FROM OLD.standard_cost_per_kg OR NEW.expected_yield_pct IS DISTINCT FROM OLD.expected_yield_pct
                        OR NEW.packaging IS DISTINCT FROM OLD.packaging OR NEW.recipe_id IS DISTINCT FROM OLD.recipe_id OR NEW.version IS DISTINCT FROM OLD.version
                        OR NEW.approved_by IS DISTINCT FROM OLD.approved_by OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
                        OR NEW.notes IS DISTINCT FROM OLD.notes OR NEW.approval_warnings IS DISTINCT FROM OLD.approval_warnings
                        OR (NEW.status IS DISTINCT FROM OLD.status AND NOT (OLD.status = 'APPROVED' AND NEW.status = 'RETIRED')) THEN
                        RAISE EXCEPTION 'RN-REC-03: la versión está cerrada y no cambia; crea una versión nueva' USING ERRCODE = 'check_violation';
                    END IF;
                END IF;
                RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
            END $$;

            CREATE TRIGGER recipe_ingredients_version_cerrada BEFORE UPDATE OR DELETE ON recipe_ingredients FOR EACH ROW EXECUTE FUNCTION rec_version_cerrada();
            CREATE TRIGGER recipe_steps_version_cerrada BEFORE UPDATE OR DELETE ON recipe_steps FOR EACH ROW EXECUTE FUNCTION rec_version_cerrada();
            CREATE TRIGGER recipe_control_points_version_cerrada BEFORE UPDATE OR DELETE ON recipe_control_points FOR EACH ROW EXECUTE FUNCTION rec_version_cerrada();
            CREATE TRIGGER recipe_versions_sin_cambios BEFORE UPDATE OR DELETE ON recipe_versions FOR EACH ROW EXECUTE FUNCTION rec_version_sin_cambios();
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            DROP TRIGGER IF EXISTS recipe_versions_sin_cambios ON recipe_versions;
            DROP TRIGGER IF EXISTS recipe_control_points_version_cerrada ON recipe_control_points;
            DROP TRIGGER IF EXISTS recipe_steps_version_cerrada ON recipe_steps;
            DROP TRIGGER IF EXISTS recipe_ingredients_version_cerrada ON recipe_ingredients;
            DROP FUNCTION IF EXISTS rec_version_sin_cambios();
            DROP FUNCTION IF EXISTS rec_version_cerrada();
        SQL);
        foreach (['recipe_versions_estado_index', 'recipe_control_points_version_index', 'recipe_steps_version_seq_index', 'recipe_ingredients_version_seq_index',
            'recipe_versions_una_en_curso', 'recipe_versions_una_aprobada'] as $i) {
            DB::statement("DROP INDEX IF EXISTS {$i}");
        }
        Schema::table('food_additives', fn (Blueprint $table) => $table->dropUnique(['tenant_id', 'sin_code']));
        Schema::table('recipe_versions', fn (Blueprint $table) => $table->dropUnique(['recipe_id', 'version']));
        Schema::table('recipes', fn (Blueprint $table) => $table->dropUnique(['tenant_id', 'code']));
        foreach (['food_additives_limite_positivo' => 'food_additives', 'recipe_control_points_accion' => 'recipe_control_points', 'recipe_control_points_rango' => 'recipe_control_points',
            'recipe_steps_tiempo' => 'recipe_steps', 'recipe_ingredients_aditivo_con_sin' => 'recipe_ingredients', 'recipe_ingredients_tolerancia' => 'recipe_ingredients',
            'recipe_ingredients_kg_positivo' => 'recipe_ingredients', 'recipe_versions_vida_util_positiva' => 'recipe_versions', 'recipe_versions_base_positiva' => 'recipe_versions'] as $c => $t) {
            DB::statement("ALTER TABLE {$t} DROP CONSTRAINT IF EXISTS {$c}");
        }
        foreach (self::ESTADOS as [$tabla, $col]) {
            DB::statement("ALTER TABLE {$tabla} DROP CONSTRAINT IF EXISTS {$tabla}_{$col}_valido");
        }
        Schema::table('recipe_versions', fn (Blueprint $table) => $table->dropColumn(['recalc_cost_per_kg', 'recalc_at']));
    }
};
