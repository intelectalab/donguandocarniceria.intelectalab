<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Ramsey\Uuid\Uuid;

/**
 * SEP · Separación de marcas (SEP-01 a SEP-12; RN-SEP-01 a 20; CA-SEP-01 a 06).
 *
 *  - brand_separations: proyecto de separación de una marca a otro RUC de la misma empresa (OTHER_RUC),
 *    a otro cliente de la plataforma (OTHER_TENANT) o a un sistema externo (OTHER_SYSTEM).
 *    Una sola separación viva por marca, salvo simulación (RN-SEP-02).
 *  - brand_separation_checks: 15 validaciones previas (RN-SEP-07).
 *  - brand_separation_items: ítems por área (SERIES_NEW, PRODUCT, PRICE_LIST, STOCK, CUSTOMERS, ORDER,
 *    RECEIVABLE, CHANNEL, WEB_STORE, AD_ACCOUNT, CASH_ACCOUNT, USER, WAREHOUSE, SERIES_ORIGIN).
 *  - brand_company_history: empresas con las que facturó cada marca a lo largo del tiempo (RN-SEP-04,
 *    RN-SEP-05, RN-SEP-18).
 *  - Columnas separated_at y separation_id en brands, y separation_id en data_exports.
 */
return new class extends Migration
{
    private const NS = 'b7a1c2d4-5e6f-4a8b-9c0d-1e2f3a4b5c6d';

    public function up(): void
    {
        // Columnas de separación en brands y data_exports.
        DB::statement('ALTER TABLE brands ADD COLUMN IF NOT EXISTS separated_at timestamptz');
        DB::statement('ALTER TABLE brands ADD COLUMN IF NOT EXISTS separation_id uuid');
        DB::statement('ALTER TABLE data_exports ADD COLUMN IF NOT EXISTS separation_id uuid');

        // 1. brand_separations
        Schema::create('brand_separations', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->string('number', 20);
            $table->uuid('brand_id');
            $table->uuid('origin_company_id');
            $table->string('dest_type', 20);
            $table->uuid('dest_company_id')->nullable();
            $table->uuid('dest_tenant_id')->nullable();
            $table->string('dest_tenant_name', 120)->nullable();
            $table->string('dest_system_name', 120)->nullable();
            $table->string('dest_legal_name', 160)->nullable();
            $table->string('dest_ruc', 11)->nullable();
            $table->date('cutoff_date');
            $table->boolean('simulation')->default(false);
            $table->string('receivables_policy', 20)->default('KEEP_ORIGIN');
            $table->text('notes')->nullable();
            $table->string('status', 20)->default('DRAFT');
            $table->uuid('prepared_by')->nullable();
            $table->string('prepared_by_name', 120)->nullable();
            $table->timestampTz('prepared_at')->useCurrent();
            $table->timestampTz('checks_run_at')->nullable();
            $table->timestampTz('validated_at')->nullable();
            $table->text('warn_note')->nullable();
            $table->uuid('approved_by')->nullable();
            $table->string('approved_by_name', 120)->nullable();
            $table->timestampTz('approved_at')->nullable();
            $table->text('approval_note')->nullable();
            $table->timestampTz('executed_at')->nullable();
            $table->timestampTz('completed_at')->nullable();
            $table->timestampTz('cancelled_at')->nullable();
            $table->text('cancel_reason')->nullable();
            $table->timestampTz('items_built_at')->nullable();
            $table->jsonb('export')->nullable();
            $table->jsonb('act')->nullable();
            $table->jsonb('transfer_docs')->default(DB::raw("'[]'::jsonb"));
            $table->jsonb('history')->default(DB::raw("'[]'::jsonb"));
            $table->timestampsTz();
            $table->index('tenant_id');
            $table->unique(['tenant_id', 'number']);
            $table->foreign('tenant_id')->references('id')->on('tenants')->cascadeOnDelete();
            $table->foreign('brand_id')->references('id')->on('brands')->restrictOnDelete();
            $table->foreign('origin_company_id')->references('id')->on('companies')->restrictOnDelete();
            $table->foreign('dest_company_id')->references('id')->on('companies')->nullOnDelete();
        });
        DB::statement("ALTER TABLE brand_separations ADD CONSTRAINT brand_separations_dest_type CHECK (dest_type IN ('OTHER_RUC','OTHER_TENANT','OTHER_SYSTEM'))");
        DB::statement("ALTER TABLE brand_separations ADD CONSTRAINT brand_separations_status CHECK (status IN ('DRAFT','VALIDATED','APPROVED','EXECUTING','COMPLETED','FAILED','CANCELLED'))");
        DB::statement("ALTER TABLE brand_separations ADD CONSTRAINT brand_separations_receivables_policy CHECK (receivables_policy IN ('KEEP_ORIGIN','ASSIGN'))");
        // RN-SEP-02: una sola separación viva por marca, salvo simulación.
        DB::statement("CREATE UNIQUE INDEX brand_separations_una_viva_por_marca ON brand_separations (tenant_id, brand_id) WHERE simulation = false AND status IN ('DRAFT','VALIDATED','APPROVED','EXECUTING','FAILED')");

        // 2. brand_separation_checks
        Schema::create('brand_separation_checks', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('separation_id');
            $table->integer('seq');
            $table->string('code', 40);
            $table->string('title', 160);
            $table->string('rule', 30)->nullable();
            $table->string('result', 10);
            $table->text('detail')->nullable();
            $table->integer('count')->default(0);
            $table->timestampTz('run_at')->useCurrent();
            $table->string('run_by', 120)->nullable();
            $table->index('tenant_id');
            $table->index(['separation_id', 'seq']);
            $table->foreign('tenant_id')->references('id')->on('tenants')->cascadeOnDelete();
            $table->foreign('separation_id')->references('id')->on('brand_separations')->cascadeOnDelete();
        });
        DB::statement("ALTER TABLE brand_separation_checks ADD CONSTRAINT brand_separation_checks_result CHECK (result IN ('PASS','WARN','FAIL'))");

        // 3. brand_separation_items
        Schema::create('brand_separation_items', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('separation_id');
            $table->string('item_type', 30);
            $table->integer('seq');
            $table->string('status', 20)->default('PENDING');
            $table->integer('attempts')->default(0);
            $table->text('error')->nullable();
            $table->timestampTz('executed_at')->nullable();
            $table->text('result')->nullable();
            $table->jsonb('refs')->default(DB::raw("'{}'::jsonb"));
            $table->string('ref_table', 50)->nullable();
            $table->string('ref_id', 80)->nullable();
            $table->string('label', 240);
            $table->decimal('qty', 14, 3)->default(0);
            $table->string('uom', 20)->default('UNIDAD');
            $table->string('action', 40)->nullable();
            $table->uuid('variant_id')->nullable();
            $table->uuid('lot_id')->nullable();
            $table->uuid('warehouse_id')->nullable();
            $table->uuid('establishment_id')->nullable();
            $table->date('expiry_date')->nullable();
            $table->decimal('qty_at_cutoff', 14, 3)->nullable();
            $table->decimal('unit_cost', 14, 4)->nullable();
            $table->decimal('reserved_qty', 14, 3)->nullable();
            $table->string('note', 255)->nullable();
            $table->decimal('received_qty', 14, 3)->nullable();
            $table->uuid('dest_warehouse_id')->nullable();
            $table->uuid('document_id')->nullable();
            $table->string('guide_number', 40)->nullable();
            $table->decimal('amount', 14, 2)->nullable();
            $table->date('delivery_date')->nullable();
            $table->date('due_date')->nullable();
            $table->string('kind', 30)->nullable();
            $table->string('platform', 30)->nullable();
            $table->boolean('only_brand')->nullable();
            $table->string('code', 40)->nullable();
            $table->string('doc_type', 30)->nullable();
            $table->string('applies_to', 30)->nullable();
            $table->string('exclude_reason', 300)->nullable();
            $table->timestampsTz();
            $table->index('tenant_id');
            $table->index(['separation_id', 'item_type', 'seq']);
            $table->foreign('tenant_id')->references('id')->on('tenants')->cascadeOnDelete();
            $table->foreign('separation_id')->references('id')->on('brand_separations')->cascadeOnDelete();
        });
        DB::statement("ALTER TABLE brand_separation_items ADD CONSTRAINT brand_separation_items_status CHECK (status IN ('PENDING','DONE','FAILED','EXCLUDED'))");

        // 4. brand_company_history
        Schema::create('brand_company_history', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('brand_id');
            $table->uuid('company_id');
            $table->string('company_name', 160);
            $table->string('ruc', 11);
            $table->date('valid_from');
            $table->date('valid_to')->nullable();
            $table->uuid('separation_id')->nullable();
            $table->uuid('closed_by_separation_id')->nullable();
            $table->string('reason', 255)->nullable();
            $table->string('status', 20)->default('ACTIVE');
            $table->timestampsTz();
            $table->index('tenant_id');
            $table->index(['brand_id', 'valid_from']);
            $table->foreign('tenant_id')->references('id')->on('tenants')->cascadeOnDelete();
            $table->foreign('brand_id')->references('id')->on('brands')->cascadeOnDelete();
            $table->foreign('company_id')->references('id')->on('companies')->restrictOnDelete();
            $table->foreign('separation_id')->references('id')->on('brand_separations')->nullOnDelete();
            $table->foreign('closed_by_separation_id')->references('id')->on('brand_separations')->nullOnDelete();
        });
        DB::statement("ALTER TABLE brand_company_history ADD CONSTRAINT brand_company_history_fechas CHECK (valid_to IS NULL OR valid_to >= valid_from)");

        foreach (['brand_separations', 'brand_separation_checks', 'brand_separation_items', 'brand_company_history'] as $t) {
            DB::statement("SELECT enable_tenant_rls('{$t}')");
            if ($t !== 'brand_separation_checks') {
                DB::statement("SELECT audit.track('{$t}')");
            }
        }

        $this->sembrarDatosIniciales();
    }

    public function down(): void
    {
        foreach (['brand_company_history', 'brand_separation_items', 'brand_separation_checks', 'brand_separations'] as $t) {
            DB::statement("DROP TABLE IF EXISTS {$t} CASCADE");
        }
        DB::statement('ALTER TABLE data_exports DROP COLUMN IF EXISTS separation_id');
        DB::statement('ALTER TABLE brands DROP COLUMN IF EXISTS separation_id');
        DB::statement('ALTER TABLE brands DROP COLUMN IF EXISTS separated_at');
    }

    private function uid(string $empresa, string $id): string
    {
        return (string) Uuid::uuid5(self::NS, $empresa.':'.$id);
    }

    private function sembrarDatosIniciales(): void
    {
        $dgTenant = DB::table('tenants')->where('short', 'Don Guando')->first();
        if ($dgTenant) {
            $coGouId = $this->uid('DG', 'co-gou');
            if (! DB::table('companies')->where('id', $coGouId)->exists()) {
                $filaCo = [
                    'id' => $coGouId,
                    'tenant_id' => $dgTenant->id,
                    'legal_name' => 'DON GUANDO GOURMET SAC',
                    'ruc' => '20612843013',
                    'trade_name' => 'Don Guando Gourmet',
                    'tax_regime' => 'MYPE',
                    'fiscal_address' => 'Av. La Molina 1480, La Molina, Lima',
                    'default_currency' => 'PEN',
                    'timezone' => 'America/Lima',
                    'einvoice_provider' => 'NUBEFACT',
                    'einvoice_env' => 'PRODUCTION',
                    'status' => 'ACTIVE',
                    'created_at' => '2026-09-20 10:00:00',
                ];
                $colsCo = array_flip(DB::getSchemaBuilder()->getColumnListing('companies'));
                DB::table('companies')->insert(array_intersect_key($filaCo, $colsCo));
            }
        }

        // Vigencias iniciales de todas las marcas existentes en brand_company_history.
        $marcas = DB::table('brands as b')
            ->join('companies as c', 'c.id', '=', 'b.company_id')
            ->get(['b.id as brand_id', 'b.tenant_id', 'b.company_id', 'c.legal_name', 'c.ruc']);

        foreach ($marcas as $m) {
            if (DB::table('brand_company_history')->where('brand_id', $m->brand_id)->exists()) {
                continue;
            }
            $minDoc = DB::table('sales_documents')
                ->where('brand_id', $m->brand_id)
                ->where('company_id', $m->company_id)
                ->min('issue_date');
            $from = ($minDoc && $minDoc < '2026-01-01') ? $minDoc : '2026-01-01';

            DB::table('brand_company_history')->insert([
                'tenant_id' => $m->tenant_id,
                'brand_id' => $m->brand_id,
                'company_id' => $m->company_id,
                'company_name' => $m->legal_name,
                'ruc' => $m->ruc,
                'valid_from' => $from,
                'valid_to' => null,
                'separation_id' => null,
                'reason' => 'Inicio de operaciones con la empresa original',
                'status' => 'ACTIVE',
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }

        // Proyectos de separación de demostración en Don Guando (SEP-0001 cancelado, SEP-0002 en preparación, SEP-0003 simulación completada).
        if (! $dgTenant) {
            return;
        }
        if (DB::table('brand_separations')->where('tenant_id', $dgTenant->id)->exists()) {
            return;
        }

        $coDgId = DB::table('companies')->where('tenant_id', $dgTenant->id)->where('ruc', '20609147254')->value('id');
        $coGouId = DB::table('companies')->where('tenant_id', $dgTenant->id)->where('ruc', '20612843013')->value('id');
        $brM3 = DB::table('brands')->where('tenant_id', $dgTenant->id)->where('code', 'M3')->value('id');
        $brM4 = DB::table('brands')->where('tenant_id', $dgTenant->id)->where('code', 'M4')->value('id');
        $brM5 = DB::table('brands')->where('tenant_id', $dgTenant->id)->where('code', 'M5')->value('id');
        $usAdm = DB::table('users')->where('tenant_id', $dgTenant->id)->where('role', 'ADMIN_SISTEMA')->value('id')
            ?? DB::table('users')->where('tenant_id', $dgTenant->id)->value('id');
        $usGer = DB::table('users')->where('tenant_id', $dgTenant->id)->where('role', 'GERENTE')->value('id') ?? $usAdm;

        if (! $coDgId || ! $coGouId || ! $brM3 || ! $brM4 || ! $brM5) {
            return;
        }

        // SEP-0001: cancelado
        DB::table('brand_separations')->insert([
            'id' => $this->uid('DG', 'sep-0001'),
            'tenant_id' => $dgTenant->id,
            'number' => 'SEP-0001',
            'brand_id' => $brM3,
            'origin_company_id' => $coDgId,
            'dest_type' => 'OTHER_RUC',
            'dest_company_id' => $coGouId,
            'dest_legal_name' => 'DON GUANDO GOURMET SAC',
            'dest_ruc' => '20612843013',
            'cutoff_date' => '2026-08-31',
            'simulation' => false,
            'receivables_policy' => 'KEEP_ORIGIN',
            'notes' => 'Ensayo descartado: La Casa del Cuy sigue con Don Guando SAC.',
            'status' => 'CANCELLED',
            'prepared_by' => $usAdm,
            'prepared_by_name' => 'Jorge Quispe Alvarado',
            'prepared_at' => '2026-08-29 10:00:00',
            'cancelled_at' => '2026-08-30 16:20:00',
            'cancel_reason' => 'Gerencia decidió mantener La Casa del Cuy en el RUC principal y separar primero Gourmet.',
            'history' => json_encode([
                ['at' => '2026-08-29T10:00:00', 'by' => $usAdm, 'by_name' => 'Jorge Quispe Alvarado', 'status' => 'DRAFT', 'note' => 'Proyecto creado'],
                ['at' => '2026-08-30T16:20:00', 'by' => $usGer, 'by_name' => 'Luis Ccahuana Rojas', 'status' => 'CANCELLED', 'note' => 'Gerencia decidió mantener La Casa del Cuy en el RUC principal y separar primero Gourmet.'],
            ], JSON_UNESCAPED_UNICODE),
            'created_at' => '2026-08-29 10:00:00',
            'updated_at' => '2026-08-30 16:20:00',
        ]);

        // SEP-0002: en preparación (Don Guando Gourmet -> DON GUANDO GOURMET SAC, corte 2026-09-30)
        DB::table('brand_separations')->insert([
            'id' => $this->uid('DG', 'sep-0002'),
            'tenant_id' => $dgTenant->id,
            'number' => 'SEP-0002',
            'brand_id' => $brM5,
            'origin_company_id' => $coDgId,
            'dest_type' => 'OTHER_RUC',
            'dest_company_id' => $coGouId,
            'dest_legal_name' => 'DON GUANDO GOURMET SAC',
            'dest_ruc' => '20612843013',
            'cutoff_date' => '2026-09-30',
            'simulation' => false,
            'receivables_policy' => 'KEEP_ORIGIN',
            'notes' => 'Don Guando Gourmet pasa a facturar con DON GUANDO GOURMET SAC desde el 1 de octubre de 2026.',
            'status' => 'DRAFT',
            'prepared_by' => $usAdm,
            'prepared_by_name' => 'Jorge Quispe Alvarado',
            'prepared_at' => '2026-09-28 09:30:00',
            'history' => json_encode([
                ['at' => '2026-09-28T09:30:00', 'by' => $usAdm, 'by_name' => 'Jorge Quispe Alvarado', 'status' => 'DRAFT', 'note' => 'Proyecto creado'],
            ], JSON_UNESCAPED_UNICODE),
            'created_at' => '2026-09-28 09:30:00',
            'updated_at' => '2026-09-28 09:30:00',
        ]);

        // SEP-0003: simulación completada de Despensa Don Guando hacia otro cliente de la plataforma
        DB::table('brand_separations')->insert([
            'id' => $this->uid('DG', 'sep-0003'),
            'tenant_id' => $dgTenant->id,
            'number' => 'SEP-0003',
            'brand_id' => $brM4,
            'origin_company_id' => $coDgId,
            'dest_type' => 'OTHER_TENANT',
            'dest_company_id' => null,
            'dest_tenant_name' => 'Despensa Andina SAC',
            'dest_legal_name' => 'DESPENSA ANDINA SAC',
            'dest_ruc' => '20609871234',
            'cutoff_date' => '2026-08-31',
            'simulation' => true,
            'receivables_policy' => 'KEEP_ORIGIN',
            'notes' => 'Simulación para dimensionar el paquete de exportación de Despensa Don Guando hacia su propia cuenta.',
            'status' => 'COMPLETED',
            'prepared_by' => $usAdm,
            'prepared_by_name' => 'Jorge Quispe Alvarado',
            'prepared_at' => '2026-09-04 11:00:00',
            'validated_at' => '2026-09-04 11:10:00',
            'warn_note' => 'Simulación con advertencias controladas para dimensionar el paquete.',
            'approved_by' => $usGer,
            'approved_by_name' => 'Luis Ccahuana Rojas',
            'approved_at' => '2026-09-04 11:20:00',
            'approval_note' => 'Aprobado como simulación para revisar el paquete de exportación y el acta.',
            'executed_at' => '2026-09-04 11:25:00',
            'completed_at' => '2026-09-04 11:26:00',
            'history' => json_encode([
                ['at' => '2026-09-04T11:00:00', 'by' => $usAdm, 'by_name' => 'Jorge Quispe Alvarado', 'status' => 'DRAFT', 'note' => 'Proyecto creado'],
                ['at' => '2026-09-04T11:10:00', 'by' => $usAdm, 'by_name' => 'Jorge Quispe Alvarado', 'status' => 'VALIDATED', 'note' => 'Simulación con advertencias controladas'],
                ['at' => '2026-09-04T11:20:00', 'by' => $usGer, 'by_name' => 'Luis Ccahuana Rojas', 'status' => 'APPROVED', 'note' => 'Aprobado como simulación'],
                ['at' => '2026-09-04T11:26:00', 'by' => $usAdm, 'by_name' => 'Jorge Quispe Alvarado', 'status' => 'COMPLETED', 'note' => 'Simulación completada'],
            ], JSON_UNESCAPED_UNICODE),
            'created_at' => '2026-09-04 11:00:00',
            'updated_at' => '2026-09-04 11:26:00',
        ]);
    }
};
