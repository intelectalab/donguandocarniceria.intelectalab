<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// SUS · planes de Aycha (catálogo global, sin empresa) para la página pública, y los pedidos de demo
// que deja quien visita la página. Nombres de la spec: saas_plans y saas_plan_modules.
//  - Planes: la app solo los lee (los cambia la plataforma con el dueño de la base). Textos de la página
//    del prototipo (a quién va dirigido y lo que incluye).
//  - Pedidos de demo: la app solo inserta (no los puede leer, cambiar ni borrar); los lee la plataforma.
return new class extends Migration
{
    private const PLANES = [
        'INICIAL' => [
            'name' => 'Inicial', 'price' => 149, 'users' => 5, 'brands' => 1, 'sites' => 1, 'order' => 1, 'featured' => false,
            'description' => 'Para una carnicería, puesto de mercado o avícola con un local.', 'includes_previous' => null,
            'highlights' => ['Hasta 5 usuarios, 1 marca y 1 local', 'Pedidos por WhatsApp y teléfono', 'Mostrador con venta por peso y balanza',
                'Boletas y facturas electrónicas', 'Caja diaria con arqueo', 'Almacén por lotes con vencimiento', 'Reparto con rutas y app del repartidor',
                'Gastos y tableros de ventas'],
        ],
        'CRECIMIENTO' => [
            'name' => 'Crecimiento', 'price' => 299, 'users' => 15, 'brands' => 3, 'sites' => 2, 'order' => 2, 'featured' => true,
            'description' => 'Para distribuidoras y negocios con varios canales de venta.', 'includes_previous' => 'Todo lo del Inicial, más:',
            'highlights' => ['Hasta 15 usuarios, 3 marcas y 2 locales', 'CRM con leads de la web y WhatsApp', 'Tienda WooCommerce conectada',
                'Consignaciones y venta a negocios (B2B)', 'Compras a proveedores', 'Producción, desposte y recetas', 'Calidad y trazabilidad',
                'Contabilidad y personal'],
        ],
        'MULTIMARCA' => [
            'name' => 'Multimarca', 'price' => 599, 'users' => 40, 'brands' => 10, 'sites' => 5, 'order' => 3, 'featured' => false,
            'description' => 'Para grupos con varias marcas, locales o plantas.', 'includes_previous' => 'Todo lo del Crecimiento, más:',
            'highlights' => ['Hasta 40 usuarios, 10 marcas y 5 locales', 'Todos los módulos del sistema', 'Flota avanzada', 'API pública y webhooks',
                'Telefonía con grabación', 'Separación de una marca a otro RUC'],
        ],
    ];

    private const BASE = ['PLT', 'SEG', 'MAE', 'AUD', 'ONB', 'SUS', 'INT', 'CAT', 'CLI', 'PED', 'POS', 'FAC', 'CAJ', 'ALM', 'PRE', 'GAS', 'TAB', 'DEL'];

    private const CRECE = ['CRM', 'WEB', 'CMP', 'CON', 'COM', 'PER', 'ETQ', 'EQU', 'ADS', 'B2B', 'PRO', 'DES', 'REC', 'CAL', 'CNT', 'PRS'];

    public function up(): void
    {
        Schema::create('saas_plans', function (Blueprint $table) {
            $table->string('code', 20)->primary();
            $table->string('name', 40);
            $table->string('description', 300);              // a quién va dirigido
            $table->decimal('price_pen', 10, 2);             // mensual, más IGV
            $table->unsignedSmallInteger('users_max');
            $table->unsignedSmallInteger('brands_max');
            $table->unsignedSmallInteger('sites_max');
            $table->unsignedSmallInteger('sort_order');
            $table->boolean('is_featured')->default(false);
            $table->boolean('all_modules')->default(false);  // todos los módulos de la plataforma (Multimarca)
            $table->string('includes_previous', 80)->nullable();   // «Todo lo del Inicial, más:»
            $table->jsonb('highlights')->default(DB::raw("'[]'::jsonb"));   // lo que incluye, para la página
            $table->string('status', 10)->default('ACTIVE');
            $table->timestampsTz();
        });
        DB::statement("ALTER TABLE saas_plans ADD CONSTRAINT saas_plans_estado CHECK (status IN ('ACTIVE','INACTIVE'))");
        DB::statement('ALTER TABLE saas_plans ADD CONSTRAINT saas_plans_precio CHECK (price_pen >= 0)');
        DB::statement("ALTER TABLE saas_plans ADD CONSTRAINT saas_plans_lista CHECK (jsonb_typeof(highlights) = 'array')");

        // Códigos de módulo de la plataforma (el catálogo se siembra después de migrar: aquí no hay clave foránea).
        Schema::create('saas_plan_modules', function (Blueprint $table) {
            $table->string('plan_code', 20);
            $table->string('module_code', 10);
            $table->primary(['plan_code', 'module_code']);
            $table->foreign('plan_code')->references('code')->on('saas_plans')->cascadeOnDelete();
        });

        Schema::create('demo_requests', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('gen_random_uuid()'));
            $table->string('name', 80);
            $table->string('phone', 20);                     // WhatsApp
            $table->string('email', 120)->nullable();
            $table->string('business_type', 20);
            $table->jsonb('interests')->default(DB::raw("'[]'::jsonb"));   // qué le interesa ver
            $table->string('plan_code', 20)->nullable();
            $table->string('source', 200)->nullable();       // página y campaña (utm)
            $table->timestampTz('consent_at');                // aceptó que se le escriba sobre esta solicitud
            $table->string('ip', 45);
            $table->string('user_agent', 200)->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->foreign('plan_code')->references('code')->on('saas_plans')->nullOnDelete();
            $table->index('created_at');
        });
        DB::statement("ALTER TABLE demo_requests ADD CONSTRAINT demo_requests_tipo CHECK (business_type IN ('CARNICERIA','DISTRIBUIDORA','AVICOLA','GRANJA','PLANTA','OTRO'))");
        DB::statement("ALTER TABLE demo_requests ADD CONSTRAINT demo_requests_intereses CHECK (jsonb_typeof(interests) = 'array' AND jsonb_array_length(interests) <= 6)");

        foreach (['saas_plans', 'saas_plan_modules', 'demo_requests'] as $t) {
            DB::statement("COMMENT ON TABLE {$t} IS 'global: de la plataforma, sin empresa'");
        }
        DB::statement('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON saas_plans, saas_plan_modules FROM aycha_app');      // solo lectura
        DB::statement('REVOKE SELECT, UPDATE, DELETE, TRUNCATE ON demo_requests FROM aycha_app');                      // solo inserción

        foreach (self::PLANES as $code => $p) {
            DB::table('saas_plans')->insert(['code' => $code, 'name' => $p['name'], 'description' => $p['description'], 'price_pen' => $p['price'],
                'users_max' => $p['users'], 'brands_max' => $p['brands'], 'sites_max' => $p['sites'], 'sort_order' => $p['order'],
                'is_featured' => $p['featured'], 'all_modules' => $code === 'MULTIMARCA', 'includes_previous' => $p['includes_previous'],
                'highlights' => json_encode($p['highlights'], JSON_UNESCAPED_UNICODE), 'created_at' => now(), 'updated_at' => now()]);
            $suyos = match ($code) {
                'INICIAL' => self::BASE,
                'CRECIMIENTO' => [...self::BASE, ...self::CRECE],
                default => [],
            };
            if ($suyos) {
                DB::table('saas_plan_modules')->insert(array_map(fn ($m) => ['plan_code' => $code, 'module_code' => $m], $suyos));
            }
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('demo_requests');
        Schema::dropIfExists('saas_plan_modules');
        Schema::dropIfExists('saas_plans');
    }
};
