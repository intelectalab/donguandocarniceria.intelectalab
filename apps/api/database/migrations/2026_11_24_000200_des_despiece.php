<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// DES · Despiece y costeo conjunto. Punto de partida: tools/prototipo/generar_migraciones.py (DES), revisado:
//  - RN-DES-08 en la base: una sola plantilla ACTIVE por variante de entrada (índice parcial);
//  - roles, estados y rendimientos con CHECK; la salida que no es merma lleva su variante;
//  - un solo precio de referencia ACTIVE por variante y fecha de inicio;
//  - quién hizo cada cosa: uuid del usuario (el nombre del prototipo queda en history).
// El despiece en sí es una orden de producción CUTTING (production_orders y production_order_outputs de PRO);
// DES escribe sus plantillas y precios, y el costeo conjunto lo fija DespieceService al cerrar.
return new class extends Migration
{
    private const TABLAS = ['cutting_templates', 'cutting_template_lines', 'cut_reference_prices'];

    public function up(): void
    {
        Schema::create('cutting_templates', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->string('code', 40);
            $table->string('name', 80);
            $table->string('species', 40)->comment('CORDERO, CUY, CERDO, POLLO, PATO, CONEJO…');
            $table->uuid('brand_id');
            $table->uuid('input_product_id');
            $table->uuid('input_variant_id');
            $table->integer('version')->default(1);
            $table->string('status', 20)->default('DRAFT')->comment('DRAFT, ACTIVE, RETIRED');
            $table->decimal('mass_balance_tolerance_pct', 6, 2)->nullable()->comment('RN-DES-04; vacío = des_mass_balance_tolerance_pct');
            $table->text('notes')->nullable();
            $table->uuid('created_by')->nullable();
            $table->timestampTz('activated_at')->nullable();
            $table->uuid('activated_by')->nullable();
            $table->timestampTz('retired_at')->nullable();
            $table->uuid('retired_by')->nullable();
            $table->uuid('replaced_by')->nullable();
            $table->uuid('parent_id')->nullable()->comment('Versión anterior de la que salió esta');
            $table->jsonb('history')->default(DB::raw("'[]'::jsonb"));
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
            $table->unique(['tenant_id', 'code', 'version']);
            foreach (['brand_id' => 'brands', 'input_product_id' => 'products', 'input_variant_id' => 'product_variants', 'created_by' => 'users',
                'activated_by' => 'users', 'retired_by' => 'users'] as $col => $destino) {
                $table->foreign($col)->references('id')->on($destino)->restrictOnDelete();
            }
        });

        Schema::create('cutting_template_lines', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('template_id');
            $table->integer('seq');
            $table->string('name', 80);
            $table->string('role', 20)->comment('CO_PRODUCT, BY_PRODUCT, WASTE');
            $table->uuid('output_variant_id')->nullable();
            $table->decimal('standard_yield_pct', 7, 3);
            $table->decimal('nrv_cost_per_kg', 12, 4)->default(0)->comment('RN-DES-02: costo adicional por kg para vender el subproducto (VNR)');
            $table->text('notes')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
            $table->index('template_id');
            $table->foreign('template_id')->references('id')->on('cutting_templates')->cascadeOnDelete();
            $table->foreign('output_variant_id')->references('id')->on('product_variants')->restrictOnDelete();
        });

        Schema::create('cut_reference_prices', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('variant_id');
            $table->decimal('price_per_kg', 12, 4);
            $table->date('valid_from');
            $table->date('valid_to')->nullable();
            $table->string('source', 20)->default('MANUAL')->comment('MANUAL, WEB_LIST (D-DES-02: lista web sin IGV)');
            $table->decimal('web_price_per_kg', 12, 4)->nullable();
            $table->string('note', 255)->nullable();
            $table->string('status', 20)->default('ACTIVE')->comment('ACTIVE, REPLACED');
            $table->uuid('created_by')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
            $table->index(['variant_id', 'valid_from']);
            $table->foreign('variant_id')->references('id')->on('product_variants')->restrictOnDelete();
            $table->foreign('created_by')->references('id')->on('users')->restrictOnDelete();
        });

        DB::statement('ALTER TABLE cutting_templates ADD CONSTRAINT cutting_templates_replaced_by_fk FOREIGN KEY (replaced_by) REFERENCES cutting_templates(id)');
        DB::statement('ALTER TABLE cutting_templates ADD CONSTRAINT cutting_templates_parent_fk FOREIGN KEY (parent_id) REFERENCES cutting_templates(id)');
        foreach (self::TABLAS as $t) {
            DB::statement("ALTER TABLE {$t} ADD CONSTRAINT {$t}_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id)");
        }
        $checks = [
            'cutting_templates' => [
                'estado' => "status IN ('DRAFT','ACTIVE','RETIRED')",
                'tolerancia' => 'mass_balance_tolerance_pct IS NULL OR (mass_balance_tolerance_pct >= 0 AND mass_balance_tolerance_pct <= 20)',
                'version' => 'version >= 1',
            ],
            'cutting_template_lines' => [
                'rol' => "role IN ('CO_PRODUCT','BY_PRODUCT','WASTE')",
                'rendimiento' => 'standard_yield_pct >= 0 AND standard_yield_pct <= 100 AND nrv_cost_per_kg >= 0',
                'variante' => "role = 'WASTE' OR output_variant_id IS NOT NULL",
            ],
            'cut_reference_prices' => [
                'precio' => 'price_per_kg > 0',
                'vigencia' => 'valid_to IS NULL OR valid_to >= valid_from',
                'origen' => "source IN ('MANUAL','WEB_LIST')",
                'estado' => "status IN ('ACTIVE','REPLACED')",
            ],
        ];
        foreach ($checks as $t => $lista) {
            foreach ($lista as $nombre => $expr) {
                DB::statement("ALTER TABLE {$t} ADD CONSTRAINT {$t}_{$nombre} CHECK ({$expr})");
            }
        }
        // RN-DES-08: una sola plantilla activa por producto de entrada.
        DB::statement("CREATE UNIQUE INDEX cutting_templates_una_activa ON cutting_templates (tenant_id, input_variant_id) WHERE status = 'ACTIVE'");
        DB::statement('CREATE UNIQUE INDEX cutting_template_lines_seq ON cutting_template_lines (template_id, seq)');

        foreach (self::TABLAS as $t) {
            DB::statement("SELECT enable_tenant_rls('{$t}')");
            DB::statement("SELECT audit.track('{$t}')");
        }

        // El despiece es una orden CUTTING de PRO: su plantilla y la línea de cada corte.
        DB::statement('ALTER TABLE production_orders ADD CONSTRAINT production_orders_cutting_template_fk FOREIGN KEY (cutting_template_id) REFERENCES cutting_templates(id)');
        DB::statement('ALTER TABLE production_order_outputs ADD CONSTRAINT production_order_outputs_template_line_fk FOREIGN KEY (template_line_id) REFERENCES cutting_template_lines(id)');
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE production_orders DROP CONSTRAINT IF EXISTS production_orders_cutting_template_fk');
        DB::statement('ALTER TABLE production_order_outputs DROP CONSTRAINT IF EXISTS production_order_outputs_template_line_fk');
        foreach (array_reverse(self::TABLAS) as $t) {
            DB::statement("DROP TABLE IF EXISTS {$t} CASCADE");
        }
    }
};
