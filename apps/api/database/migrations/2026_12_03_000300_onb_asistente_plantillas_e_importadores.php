<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * ONB · Asistente de alta, plantillas por rubro e importadores (ONB-02 a ONB-15; RN-ONB-03 a 19).
 *
 *  - industry_templates e industry_template_items: catálogo global de la plataforma (la aplicación solo lee).
 *  - onboarding_runs y onboarding_steps: corrida de alta de cada empresa (una sola IN_PROGRESS por empresa, RN-ONB-03)
 *    y sus 16 pasos con prerrequisitos (RN-ONB-04/06) y estado.
 *  - template_applications: aplicaciones de plantillas a marcas (una vez por plantilla y marca, RN-ONB-07).
 *  - data_imports, data_import_rows y opening_balances: importaciones CSV/Excel con huella SHA-256 (RN-ONB-09),
 *    validación por fila (RN-ONB-08), ejecución por lotes de 500 (RN-ONB-16), liberación de stock inicial en
 *    cuarentena (RN-ONB-14) y saldos iniciales por cobrar y por pagar (RN-ONB-11).
 */
return new class extends Migration
{
    private const PASOS = [
        ['COMPANY', 'Empresa', 'ONB-03', true, 'ADMIN_SISTEMA'],
        ['BRANDS', 'Marcas', 'ONB-04', true, 'ADMIN_SISTEMA'],
        ['ESTABLISHMENTS', 'Locales', 'ONB-05', true, 'ADMIN_SISTEMA'],
        ['WAREHOUSES', 'Almacenes', 'ONB-05', false, 'ALMACENERO'],
        ['SERIES', 'Series de comprobantes', 'ONB-06', true, 'CONTADORA'],
        ['EINVOICE', 'Comprobante electrónico (OSE)', 'ONB-06', true, 'CONTADORA'],
        ['PAYMENT_METHODS', 'Medios de pago y cajas', 'ONB-07', false, 'ADMINISTRACION'],
        ['WHATSAPP', 'Números de WhatsApp', 'ONB-08', false, 'SUPERVISORA_VENTAS'],
        ['DELIVERY_ZONES', 'Zonas de reparto', 'ONB-09', false, 'COORDINADOR_DELIVERY'],
        ['TEMPLATE', 'Plantilla por rubro', 'ONB-10', false, 'ADMIN_SISTEMA'],
        ['IMPORT_PRODUCTS', 'Importar productos', 'ONB-11', false, 'ADMINISTRACION'],
        ['IMPORT_CUSTOMERS', 'Importar clientes', 'ONB-11', false, 'ADMINISTRACION'],
        ['IMPORT_STOCK', 'Importar stock inicial', 'ONB-11', false, 'ALMACENERO'],
        ['IMPORT_BALANCES', 'Importar saldos', 'ONB-11', false, 'CONTADORA'],
        ['USERS', 'Usuarios e invitaciones', 'ONB-14', false, 'ADMIN_SISTEMA'],
        ['GO_LIVE', 'Salida a producción', 'ONB-15', true, 'GERENTE'],
    ];

    public function up(): void
    {
        // Permitir números de WhatsApp compartidos entre marcas (ONB-08, RN-ONB-19).
        DB::statement('ALTER TABLE messaging_channels ALTER COLUMN brand_id DROP NOT NULL');

        // 1. Catálogo global de plantillas por rubro (ONB-10)
        Schema::create('industry_templates', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->string('code', 40);
            $table->integer('version')->default(1);
            $table->string('product_id', 30)->default('COMERCIAL');
            $table->string('name', 140);
            $table->text('description')->nullable();
            $table->string('status', 20)->default('PUBLISHED');
            $table->timestampTz('published_at')->nullable();
            $table->timestampsTz();
            $table->unique(['code', 'version']);
        });
        DB::statement("ALTER TABLE industry_templates ADD CONSTRAINT industry_templates_estado CHECK (status IN ('DRAFT','PUBLISHED','RETIRED'))");

        Schema::create('industry_template_items', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('template_id');
            $table->integer('seq');
            $table->string('item_type', 30);
            $table->string('item_code', 80);
            $table->string('requires_module', 20)->nullable();
            $table->jsonb('payload');
            $table->timestampTz('created_at')->useCurrent();
            $table->foreign('template_id')->references('id')->on('industry_templates')->cascadeOnDelete();
            $table->index(['template_id', 'seq']);
        });

        $this->sembrarPlantillas();

        foreach (['industry_templates', 'industry_template_items'] as $t) {
            DB::statement("COMMENT ON TABLE {$t} IS 'global: catálogo de plantillas por rubro (ONB-10), sin RLS'");
            DB::statement("REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON {$t} FROM aycha_app");
        }

        // 2. Corrida de alta y lista de 16 pasos (ONB-02 a ONB-15)
        Schema::create('onboarding_runs', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('signup_ref')->nullable();
            $table->string('industry', 40)->default('DISTRIBUIDORA_CARNES');
            $table->uuid('industry_template_id')->nullable();
            $table->string('plan_code', 30)->default('CRECIMIENTO');
            $table->string('status', 20)->default('IN_PROGRESS');
            $table->timestampTz('started_at')->useCurrent();
            $table->timestampTz('completed_at')->nullable();
            $table->date('go_live_at')->nullable();
            $table->date('planned_go_live')->nullable();
            $table->timestampTz('first_accepted_document_at')->nullable();
            $table->uuid('first_document_id')->nullable();
            $table->uuid('owner_user_id')->nullable();
            $table->uuid('company_id')->nullable();
            $table->uuid('subscription_id')->nullable();
            $table->timestampsTz();
            $table->index('tenant_id');
            $table->foreign('tenant_id')->references('id')->on('tenants')->cascadeOnDelete();
            $table->foreign('industry_template_id')->references('id')->on('industry_templates')->nullOnDelete();
            $table->foreign('company_id')->references('id')->on('companies')->nullOnDelete();
            $table->foreign('owner_user_id')->references('id')->on('users')->nullOnDelete();
        });
        DB::statement("ALTER TABLE onboarding_runs ADD CONSTRAINT onboarding_runs_estado CHECK (status IN ('IN_PROGRESS','COMPLETED','ABANDONED'))");
        // RN-ONB-03: una sola alta en curso por empresa.
        DB::statement("CREATE UNIQUE INDEX onboarding_runs_una_activa ON onboarding_runs (tenant_id) WHERE status = 'IN_PROGRESS'");

        Schema::create('onboarding_steps', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('run_id');
            $table->string('step_code', 30);
            $table->integer('seq');
            $table->boolean('is_required')->default(false);
            $table->string('status', 20)->default('PENDING');
            $table->string('blocked_reason', 255)->nullable();
            $table->timestampTz('completed_at')->nullable();
            $table->string('completed_by', 120)->nullable();
            $table->string('owner_role', 40)->nullable();
            $table->timestampsTz();
            $table->index('tenant_id');
            $table->unique(['run_id', 'step_code']);
            $table->foreign('tenant_id')->references('id')->on('tenants')->cascadeOnDelete();
            $table->foreign('run_id')->references('id')->on('onboarding_runs')->cascadeOnDelete();
        });
        DB::statement("ALTER TABLE onboarding_steps ADD CONSTRAINT onboarding_steps_estado CHECK (status IN ('PENDING','DONE','SKIPPED','BLOCKED'))");

        // 3. Aplicaciones de plantillas (ONB-10)
        Schema::create('template_applications', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('run_id')->nullable();
            $table->uuid('template_id');
            $table->string('template_code', 40);
            $table->integer('template_version')->default(1);
            $table->uuid('brand_id');
            $table->string('mode', 30)->default('SKIP_EXISTING');
            $table->string('status', 20)->default('APPLIED');
            $table->integer('items_created')->default(0);
            $table->integer('items_skipped')->default(0);
            $table->integer('items_failed')->default(0);
            $table->timestampTz('applied_at')->useCurrent();
            $table->string('applied_by', 120)->nullable();
            $table->jsonb('detail')->default(DB::raw("'[]'::jsonb"));
            $table->timestampsTz();
            $table->index('tenant_id');
            $table->foreign('tenant_id')->references('id')->on('tenants')->cascadeOnDelete();
            $table->foreign('run_id')->references('id')->on('onboarding_runs')->nullOnDelete();
            $table->foreign('template_id')->references('id')->on('industry_templates')->restrictOnDelete();
            $table->foreign('brand_id')->references('id')->on('brands')->cascadeOnDelete();
        });
        DB::statement("ALTER TABLE template_applications ADD CONSTRAINT template_applications_estado CHECK (status IN ('APPLIED','PARTIAL','FAILED'))");
        // RN-ONB-07: una plantilla se aplica una sola vez por marca (salvo que haya fallado).
        DB::statement("CREATE UNIQUE INDEX template_applications_unica_por_marca ON template_applications (tenant_id, template_id, brand_id) WHERE status <> 'FAILED'");

        // 4. Importaciones de datos e inventario/saldos iniciales (ONB-11 a ONB-13)
        Schema::create('data_imports', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('run_id')->nullable();
            $table->string('import_type', 30);
            $table->uuid('file_id')->nullable();
            $table->char('file_hash', 64);
            $table->string('file_name', 160);
            $table->string('template_version', 20)->default('v1');
            $table->uuid('company_id')->nullable();
            $table->uuid('brand_id')->nullable();
            $table->uuid('warehouse_id')->nullable();
            $table->date('cutover_date')->nullable();
            $table->string('mode', 20)->default('INSERT_ONLY');
            $table->boolean('allow_partial')->default(false);
            $table->string('status', 25)->default('UPLOADED');
            $table->string('file_error', 300)->nullable();
            $table->jsonb('headers')->default(DB::raw("'[]'::jsonb"));
            $table->jsonb('map')->default(DB::raw("'{}'::jsonb"));
            $table->integer('total_rows')->default(0);
            $table->integer('valid_rows')->default(0);
            $table->integer('warning_rows')->default(0);
            $table->integer('error_rows')->default(0);
            $table->integer('imported_rows')->default(0);
            $table->integer('skipped_rows')->default(0);
            $table->jsonb('batches')->default(DB::raw("'[]'::jsonb"));
            $table->jsonb('opening_lots')->default(DB::raw("'[]'::jsonb"));
            $table->string('created_by', 120)->nullable();
            $table->timestampTz('validated_at')->nullable();
            $table->timestampTz('started_at')->nullable();
            $table->timestampTz('finished_at')->nullable();
            $table->string('executed_by', 120)->nullable();
            $table->timestampTz('released_at')->nullable();
            $table->string('released_by', 120)->nullable();
            $table->timestampTz('reverted_at')->nullable();
            $table->string('reverted_by', 120)->nullable();
            $table->string('revert_reason', 300)->nullable();
            $table->timestampsTz();
            $table->index('tenant_id');
            $table->foreign('tenant_id')->references('id')->on('tenants')->cascadeOnDelete();
            $table->foreign('run_id')->references('id')->on('onboarding_runs')->nullOnDelete();
            $table->foreign('company_id')->references('id')->on('companies')->nullOnDelete();
            $table->foreign('brand_id')->references('id')->on('brands')->nullOnDelete();
            $table->foreign('warehouse_id')->references('id')->on('warehouses')->nullOnDelete();
        });
        DB::statement("ALTER TABLE data_imports ADD CONSTRAINT data_imports_tipo CHECK (import_type IN ('PRODUCTS','CUSTOMERS','SUPPLIERS','PRICES','STOCK','CUSTOMER_BALANCES','SUPPLIER_BALANCES'))");
        DB::statement("ALTER TABLE data_imports ADD CONSTRAINT data_imports_estado CHECK (status IN ('UPLOADED','VALIDATING','VALIDATED','FAILED_VALIDATION','IMPORTING','COMPLETED','CANCELLED'))");
        // RN-ONB-09: el mismo archivo (SHA-256) no se importa dos veces para el mismo tipo salvo que la anterior esté CANCELLED.
        DB::statement("CREATE UNIQUE INDEX data_imports_hash_unico ON data_imports (tenant_id, import_type, file_hash) WHERE status <> 'CANCELLED'");

        Schema::create('data_import_rows', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('import_id');
            $table->integer('row_no');
            $table->jsonb('raw');
            $table->jsonb('norm')->nullable();
            $table->string('status', 20)->default('PENDING');
            $table->jsonb('errors')->default(DB::raw("'[]'::jsonb"));
            $table->string('dup_of', 60)->nullable();
            $table->string('target_table', 40)->nullable();
            $table->uuid('target_id')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->index('tenant_id');
            $table->index(['import_id', 'row_no']);
            $table->foreign('tenant_id')->references('id')->on('tenants')->cascadeOnDelete();
            $table->foreign('import_id')->references('id')->on('data_imports')->cascadeOnDelete();
        });
        DB::statement("ALTER TABLE data_import_rows ADD CONSTRAINT data_import_rows_estado CHECK (status IN ('PENDING','VALID','WARNING','ERROR','IMPORTED','SKIPPED'))");

        Schema::create('opening_balances', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('import_id')->nullable();
            $table->uuid('company_id');
            $table->uuid('brand_id')->nullable();
            $table->string('party_type', 20);
            $table->uuid('customer_id')->nullable();
            $table->uuid('supplier_id')->nullable();
            $table->string('doc_type', 30);
            $table->string('doc_reference', 60);
            $table->date('issue_date');
            $table->date('due_date')->nullable();
            $table->string('currency', 10)->default('PEN');
            $table->decimal('amount', 14, 2);
            $table->decimal('balance', 14, 2);
            $table->string('status', 20)->default('OPEN');
            $table->date('cutover_date')->nullable();
            $table->timestampsTz();
            $table->index('tenant_id');
            $table->foreign('tenant_id')->references('id')->on('tenants')->cascadeOnDelete();
            $table->foreign('import_id')->references('id')->on('data_imports')->nullOnDelete();
            $table->foreign('company_id')->references('id')->on('companies')->restrictOnDelete();
            $table->foreign('brand_id')->references('id')->on('brands')->nullOnDelete();
            $table->foreign('customer_id')->references('id')->on('customers')->nullOnDelete();
            $table->foreign('supplier_id')->references('id')->on('suppliers')->nullOnDelete();
        });
        DB::statement("ALTER TABLE opening_balances ADD CONSTRAINT opening_balances_tipo CHECK (party_type IN ('CUSTOMER','SUPPLIER'))");
        DB::statement("ALTER TABLE opening_balances ADD CONSTRAINT opening_balances_estado CHECK (status IN ('OPEN','SETTLED','VOIDED'))");
        // RN-ONB-11: importe > 0, saldo entre 0 y el importe, vencimiento >= emisión.
        DB::statement('ALTER TABLE opening_balances ADD CONSTRAINT opening_balances_montos CHECK (amount > 0 AND balance >= 0 AND balance <= amount + 0.005 AND (due_date IS NULL OR due_date >= issue_date))');

        foreach (['onboarding_runs', 'onboarding_steps', 'template_applications', 'data_imports', 'data_import_rows', 'opening_balances'] as $t) {
            DB::statement("SELECT enable_tenant_rls('{$t}')");
            if ($t !== 'data_import_rows') {
                DB::statement("SELECT audit.track('{$t}')");
            }
        }

        // Sembrar las corridas de alta de las empresas que ya estén en la base (Don Guando y Carnes Selectas).
        $this->sembrarAltasExistentes();
    }

    public function down(): void
    {
        foreach (['opening_balances', 'data_import_rows', 'data_imports', 'template_applications', 'onboarding_steps', 'onboarding_runs', 'industry_template_items', 'industry_templates'] as $t) {
            DB::statement("DROP TABLE IF EXISTS {$t} CASCADE");
        }
    }

    private function sembrarPlantillas(): void
    {
        $p = fn (string $code, string $name, string $cat, string $mode, ?float $kg, ?int $tol, float $price, float $cost, string $storage, int $shelf, bool $lot, string $auth) => [
            'PRODUCT', $code, null, [
                'name' => $name, 'category' => $cat, 'sku' => $code, 'mode' => $mode, 'kg' => $kg, 'tol' => $tol,
                'price' => $price, 'cost' => $cost, 'storage' => $storage, 'shelf' => $shelf, 'lot' => $lot, 'authority' => $auth,
            ],
        ];

        $plantillas = [
            'DISTRIBUIDORA_CARNES' => [
                'name' => 'Distribuidora de carnes',
                'desc' => 'Carnes de granja y cortes con peso variable: cuy, conejo, aves, cerdo y res. Sirve a carnicerías premium y proveedores de restaurantes (D-ONB-02).',
                'items' => [
                    ['CATEGORY', 'CUY', null, ['name' => 'Cuy', 'line' => 'CUY']],
                    ['CATEGORY', 'CONEJO', null, ['name' => 'Conejo', 'line' => 'CONEJO']],
                    ['CATEGORY', 'AVES', null, ['name' => 'Aves de corral', 'line' => 'AVES']],
                    ['CATEGORY', 'CERDO', null, ['name' => 'Cerdo', 'line' => 'CERDO']],
                    ['CATEGORY', 'RES', null, ['name' => 'Res', 'line' => 'RES']],
                    $p('CUY-ENT', 'Cuy entero beneficiado', 'CUY', 'UNIT_VARIABLE_WEIGHT', 0.9, 10, 42, 26.5, 'CHILLED', 7, true, 'SENASA'),
                    $p('CON-ENT', 'Conejo entero', 'CONEJO', 'UNIT_VARIABLE_WEIGHT', 1.6, 10, 32, 19.5, 'CHILLED', 7, true, 'SENASA'),
                    $p('POL-ENT', 'Pollo de corral entero', 'AVES', 'UNIT_VARIABLE_WEIGHT', 2.2, 10, 22, 14.2, 'CHILLED', 6, true, 'SENASA'),
                    $p('CER-BON', 'Bondiola de cerdo', 'CERDO', 'KG', null, 5, 38, 24, 'CHILLED', 10, true, 'SENASA'),
                    $p('CER-PAN', 'Panceta de cerdo', 'CERDO', 'KG', null, 5, 36, 22.5, 'CHILLED', 10, true, 'SENASA'),
                    $p('RES-LOM', 'Lomo fino de res', 'RES', 'KG', null, 5, 85, 61, 'CHILLED', 10, true, 'SENASA'),
                    ['CUT', 'ENTERO', null, ['name' => 'Entero', 'lines' => ['CUY', 'CONEJO', 'AVES']]],
                    ['CUT', 'MITADES', null, ['name' => 'En mitades', 'lines' => ['CUY', 'CONEJO', 'AVES']]],
                    ['CUT', 'TROZADO', null, ['name' => 'Trozado', 'lines' => ['CONEJO', 'AVES', 'CERDO']]],
                    ['BREAKDOWN', 'DESP-CERDO-MR', 'DES', ['name' => 'Despiece de media res de cerdo (de ejemplo, ajustar con pesadas propias)', 'species' => 'CERDO', 'lines' => [['Bondiola', 14], ['Panceta', 18], ['Chuleta', 22], ['Pierna', 26], ['Hueso y recortes', 16], ['Merma', 4]]]],
                    ['CHECKLIST', 'CHK-CAMARA', 'CAL', ['name' => 'Control diario de cámara y BPM', 'stage' => 'STORAGE', 'items' => ['Temperatura de cámara entre 0 y 4 °C', 'Producto rotulado con lote y vencimiento', 'Estantes y pisos limpios y desinfectados', 'Ningún producto en contacto con el piso']]],
                    ['KPI_TARGET', 'KPI-PED-04', null, ['target' => 3, 'tol' => 10, 'label' => 'Diferencia de peso pedido frente a real ≤ 3 %']],
                    ['KPI_TARGET', 'KPI-DEL-04', null, ['target' => 9, 'tol' => 10, 'label' => 'Costo por entrega ≤ S/ 9']],
                    ['KPI_TARGET', 'KPI-ALM-02', null, ['target' => 2, 'tol' => 10, 'label' => 'Mermas ≤ 2 %']],
                    ['PARAMETER', 'ped_weight_tolerance_pct', null, ['value' => 10, 'reason' => 'Plantilla distribuidora: tolerancia de peso variable']],
                    ['ROLE', 'VENDEDOR_HORECA', null, ['name' => 'Vendedor de restaurantes (HORECA)', 'desc' => 'Atiende cuentas de restaurantes con lista B2B']],
                    ['EXPENSE_CATEGORY', 'FLETE-FRIO', 'GAS', ['name' => 'Flete refrigerado', 'group' => 'DELIVERY']],
                    ['DELIVERY_SLOT', 'MANANA-HORECA', 'DEL', ['name' => '06:00–10:00', 'from' => '06:00', 'to' => '10:00', 'cutoff' => '20:00', 'capacity' => 20]],
                ],
            ],
            'CHARCUTERIA' => [
                'name' => 'Charcutería y embutidos',
                'desc' => 'Embutidos, ahumados y fiambres con recetas, control de ahumado y vencimientos cortos.',
                'items' => [
                    ['CATEGORY', 'EMBUTIDOS', null, ['name' => 'Embutidos', 'line' => 'EMBUTIDOS']],
                    ['CATEGORY', 'AHUMADOS', null, ['name' => 'Ahumados', 'line' => 'EMBUTIDOS']],
                    ['CATEGORY', 'FIAMBRES', null, ['name' => 'Fiambres', 'line' => 'EMBUTIDOS']],
                    $p('CHO-PAR-500', 'Chorizo parrillero 500 g', 'EMBUTIDOS', 'UNIT', null, null, 24, 11.4, 'CHILLED', 21, true, 'DIGESA'),
                    $p('SAL-HUA-500', 'Salchicha huachana 500 g', 'EMBUTIDOS', 'UNIT', null, null, 16, 7.6, 'CHILLED', 21, true, 'DIGESA'),
                    $p('JAM-AHU-KG', 'Jamón ahumado por kg', 'AHUMADOS', 'KG', null, 5, 64, 33, 'CHILLED', 30, true, 'DIGESA'),
                    $p('MOR-500', 'Morcilla 500 g', 'FIAMBRES', 'UNIT', null, null, 15, 6.8, 'CHILLED', 14, true, 'DIGESA'),
                    ['RECIPE', 'REC-CHORIZO', 'REC', ['name' => 'Chorizo parrillero (lote de 20 kg)', 'product' => 'CHO-PAR-500', 'type' => 'SAUSAGE']],
                    ['RECIPE', 'REC-JAMON', 'REC', ['name' => 'Jamón ahumado (pieza curada)', 'product' => 'JAM-AHU-KG', 'type' => 'CURED']],
                    ['CHECKLIST', 'CHK-AHUMADO', 'CAL', ['name' => 'Control de ahumado y cocción', 'stage' => 'PRODUCTION', 'items' => ['Temperatura interna ≥ 68 °C', 'Tiempo de ahumado registrado', 'Nitritos dentro de la dosis de la receta', 'Enfriado a ≤ 4 °C antes de empacar']]],
                    ['KPI_TARGET', 'KPI-REC-01', null, ['target' => 5, 'tol' => 10, 'label' => 'Variación del costo de recetas ≤ 5 %']],
                    ['KPI_TARGET', 'KPI-CAL-05', null, ['target' => 95, 'tol' => 5, 'label' => 'Cumplimiento de checklists ≥ 95 %']],
                    ['KPI_TARGET', 'KPI-ALM-03', null, ['target' => 1, 'tol' => 10, 'label' => 'Vencidos ≤ 1 %']],
                    ['PARAMETER', 'rec_cost_alert_pct', null, ['value' => 5, 'reason' => 'Plantilla charcutería: alerta de costo de receta']],
                    ['ROLE', 'MAESTRO_CHARCUTERO', null, ['name' => 'Maestro charcutero', 'desc' => 'Aprueba recetas y controla el ahumado']],
                ],
            ],
            'AVICOLA' => [
                'name' => 'Avícola',
                'desc' => 'Pollo, pato y huevos con beneficio, despiece de ave y control de cadena de frío.',
                'items' => [
                    ['CATEGORY', 'POLLO', null, ['name' => 'Pollo', 'line' => 'AVES']],
                    ['CATEGORY', 'PATO', null, ['name' => 'Pato', 'line' => 'AVES']],
                    ['CATEGORY', 'HUEVOS', null, ['name' => 'Huevos', 'line' => 'AVES']],
                    $p('POL-ENT', 'Pollo entero beneficiado', 'POLLO', 'UNIT_VARIABLE_WEIGHT', 2.2, 10, 21, 13.8, 'CHILLED', 6, true, 'SENASA'),
                    $p('POL-PEC', 'Pechuga de pollo', 'POLLO', 'KG', null, 5, 27, 18, 'CHILLED', 5, true, 'SENASA'),
                    $p('PAT-ENT', 'Pato entero', 'PATO', 'UNIT_VARIABLE_WEIGHT', 2.5, 10, 30, 19, 'CHILLED', 6, true, 'SENASA'),
                    $p('HUE-30', 'Huevos de corral × 30', 'HUEVOS', 'UNIT', null, null, 28, 19.5, 'AMBIENT', 21, true, 'SENASA'),
                    ['CUT', 'ENTERO', null, ['name' => 'Entero', 'lines' => ['AVES']]],
                    ['CUT', 'PECHUGA', null, ['name' => 'Pechuga', 'lines' => ['AVES']]],
                    ['CUT', 'PIERNA-ENC', null, ['name' => 'Pierna y encuentro', 'lines' => ['AVES']]],
                    ['BREAKDOWN', 'DESP-POLLO', 'DES', ['name' => 'Despiece de pollo entero (de ejemplo, ajustar con pesadas propias)', 'species' => 'AVES', 'lines' => [['Pechuga', 34], ['Pierna y encuentro', 32], ['Alas', 10], ['Carcasa', 18], ['Menudencia', 4], ['Merma', 2]]]],
                    ['CHECKLIST', 'CHK-BENEFICIO', 'CAL', ['name' => 'Recepción de aves beneficiadas', 'stage' => 'RECEPTION', 'items' => ['Temperatura de la carcasa ≤ 4 °C', 'Guía de remisión y certificado sanitario', 'Sin hematomas ni plumas', 'Cajas limpias y rotuladas']]],
                    ['KPI_TARGET', 'KPI-DES-01', null, ['target' => 98, 'tol' => 3, 'label' => 'Rendimiento de despiece ≥ 98 % del estándar']],
                    ['KPI_TARGET', 'KPI-PED-04', null, ['target' => 3, 'tol' => 10, 'label' => 'Diferencia de peso ≤ 3 %']],
                    ['KPI_TARGET', 'KPI-CAL-03', null, ['target' => 2, 'tol' => 10, 'label' => 'Temperaturas fuera de rango ≤ 2 %']],
                    ['PARAMETER', 'alm_max_temp_chilled_c', null, ['value' => 4, 'reason' => 'Plantilla avícola: cadena de frío']],
                ],
            ],
            'TIENDA_GOURMET' => [
                'name' => 'Tienda gourmet (café y abarrotes)',
                'desc' => 'Café, frutos secos, mermeladas e infusiones: productos por unidad con lote y vida útil larga.',
                'items' => [
                    ['CATEGORY', 'CAFE', null, ['name' => 'Café', 'line' => 'CAFE']],
                    ['CATEGORY', 'FRUTOS_SECOS', null, ['name' => 'Frutos secos', 'line' => 'FRUTOS_SECOS']],
                    ['CATEGORY', 'MERMELADAS', null, ['name' => 'Mermeladas', 'line' => 'MERMELADAS']],
                    ['CATEGORY', 'INFUSIONES', null, ['name' => 'Infusiones', 'line' => 'INFUSIONES']],
                    $p('CAF-250', 'Café tostado molido 250 g', 'CAFE', 'UNIT', null, null, 32, 14.5, 'AMBIENT', 270, true, 'DIGESA'),
                    $p('CAF-G500', 'Café en grano 500 g', 'CAFE', 'UNIT', null, null, 55, 25, 'AMBIENT', 270, true, 'DIGESA'),
                    $p('ALM-250', 'Almendras tostadas 250 g', 'FRUTOS_SECOS', 'UNIT', null, null, 22, 12.4, 'AMBIENT', 240, true, 'DIGESA'),
                    $p('MER-AGU', 'Mermelada de aguaymanto 250 g', 'MERMELADAS', 'UNIT', null, null, 16, 6.2, 'AMBIENT', 180, true, 'DIGESA'),
                    $p('INF-MUN', 'Infusión de muña × 20 sobres', 'INFUSIONES', 'UNIT', null, null, 9, 3.9, 'AMBIENT', 365, true, 'DIGESA'),
                    ['RECIPE', 'REC-MERMELADA', 'REC', ['name' => 'Mermelada de aguaymanto (paila de 12 kg)', 'product' => 'MER-AGU', 'type' => 'PRESERVE']],
                    ['CHECKLIST', 'CHK-SECO', 'CAL', ['name' => 'Almacén seco y control de plagas', 'stage' => 'STORAGE', 'items' => ['Humedad relativa ≤ 65 %', 'Trampas de plagas revisadas', 'Rotación por vencimiento (FEFO)', 'Envases sin abolladuras ni fugas']]],
                    ['KPI_TARGET', 'KPI-ALM-04', null, ['target' => 5, 'tol' => 10, 'label' => 'Stock por vencer ≤ 5 %']],
                    ['KPI_TARGET', 'KPI-CAT-01', null, ['target' => 100, 'tol' => 2, 'label' => 'Cobertura de precios 100 %']],
                    ['KPI_TARGET', 'KPI-PED-02', null, ['target' => 75, 'tol' => 10, 'label' => 'Ticket promedio ≥ S/ 75']],
                    ['PARAMETER', 'alm_expiry_alert_days', null, ['value' => 15, 'reason' => 'Plantilla gourmet: vida útil larga']],
                ],
            ],
        ];

        foreach ($plantillas as $code => $tpl) {
            $id = DB::table('industry_templates')->insertGetId([
                'code' => $code,
                'version' => 1,
                'product_id' => 'COMERCIAL',
                'name' => $tpl['name'],
                'description' => $tpl['desc'],
                'status' => 'PUBLISHED',
                'published_at' => '2026-09-01 10:00:00',
                'created_at' => now(),
                'updated_at' => now(),
            ], 'id');

            foreach ($tpl['items'] as $idx => [$type, $itemCode, $reqMod, $payload]) {
                DB::table('industry_template_items')->insert([
                    'template_id' => $id,
                    'seq' => $idx + 1,
                    'item_type' => $type,
                    'item_code' => $itemCode,
                    'requires_module' => $reqMod,
                    'payload' => json_encode($payload, JSON_UNESCAPED_UNICODE),
                ]);
            }
        }

        // Versión 2 en borrador (RN-ONB-07: el asistente solo ofrece las publicadas).
        DB::table('industry_templates')->insert([
            'code' => 'DISTRIBUIDORA_CARNES',
            'version' => 2,
            'product_id' => 'COMERCIAL',
            'name' => 'Distribuidora de carnes v2 (con cordero y caldos)',
            'description' => 'Borrador: agrega cordero, caldos y despiece de cordero; pendiente de validar rendimientos.',
            'status' => 'DRAFT',
            'published_at' => null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function sembrarAltasExistentes(): void
    {
        $tplId = DB::table('industry_templates')->where('code', 'DISTRIBUIDORA_CARNES')->where('status', 'PUBLISHED')->value('id');
        foreach (DB::table('tenants')->get() as $t) {
            if (DB::table('onboarding_runs')->where('tenant_id', $t->id)->exists()) {
                continue;
            }
            $co = DB::table('companies')->where('tenant_id', $t->id)->orderBy('created_at')->first();
            $esDemo = in_array($t->short, ['Don Guando', 'Carnes Selectas'], true);
            $started = $t->short === 'Don Guando' ? '2026-08-18 09:00:00' : ($t->short === 'Carnes Selectas' ? '2026-09-08 11:00:00' : ($t->created_at ?? now()));
            $goLive = $t->short === 'Don Guando' ? '2026-09-01' : ($t->short === 'Carnes Selectas' ? '2026-09-20' : null);
            $firstDoc = $t->short === 'Don Guando' ? '2026-09-01 10:42:00' : ($t->short === 'Carnes Selectas' ? '2026-09-20 12:15:00' : null);

            $runId = DB::table('onboarding_runs')->insertGetId([
                'tenant_id' => $t->id,
                'industry' => 'DISTRIBUIDORA_CARNES',
                'industry_template_id' => $tplId,
                'plan_code' => $t->plan ?: 'CRECIMIENTO',
                'status' => $esDemo ? 'COMPLETED' : 'IN_PROGRESS',
                'started_at' => $started,
                'completed_at' => $esDemo ? $goLive.' 09:00:00' : null,
                'go_live_at' => $goLive,
                'planned_go_live' => $goLive ?: now()->addDays(14)->toDateString(),
                'first_accepted_document_at' => $firstDoc,
                'company_id' => $co?->id,
                'created_at' => now(),
                'updated_at' => now(),
            ], 'id');

            foreach (self::PASOS as $idx => [$code, , , $req, $role]) {
                $status = ! $esDemo
                    ? 'PENDING'
                    : ($t->short === 'Carnes Selectas' && in_array($code, ['WHATSAPP', 'IMPORT_BALANCES', 'IMPORT_STOCK'], true) ? 'SKIPPED' : 'DONE');
                DB::table('onboarding_steps')->insert([
                    'tenant_id' => $t->id,
                    'run_id' => $runId,
                    'step_code' => $code,
                    'seq' => $idx + 1,
                    'is_required' => $req,
                    'status' => $status,
                    'completed_at' => $esDemo ? $goLive.' 17:00:00' : null,
                    'completed_by' => $esDemo ? ($t->short === 'Don Guando' ? 'Luis Ccahuana Rojas' : 'Hernán Salas Pino') : null,
                    'owner_role' => $role,
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);
            }
        }
    }
};
