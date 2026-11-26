<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// ETQ · Etiquetas, trazabilidad y retiro de lotes. Punto de partida: tools/prototipo/generar_migraciones.py (ETQ), revisado:
//  - RN-ETQ-03 en la base: una plantilla ACTIVE tiene los campos obligatorios (y {{qr}} si lleva QR);
//  - RN-ETQ-04 en la base: una reimpresión lleva motivo y apunta a la impresión original;
//  - RN-ETQ-12 en la base: impresiones de solo inserción;
//  - RN-ETQ-08 en la base: un retiro cerrado lleva su resumen;
//  - el token del QR es único en toda la plataforma: la página pública (ETQ-08) no tiene sesión y
//    etq_tenant_for_qr(token) (del dueño, SECURITY DEFINER) devuelve solo la empresa del token.
return new class extends Migration
{
    private const TABLAS = ['label_templates', 'label_prints', 'lot_qr_tokens', 'lot_recalls', 'lot_recall_lots', 'lot_recall_contacts'];

    public function up(): void
    {
        Schema::create('label_templates', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->string('code', 40);
            $table->uuid('brand_id');
            $table->string('name', 120);
            $table->string('format', 10)->comment('ZPL, ESCPOS, PDF');
            $table->integer('width_mm');
            $table->integer('height_mm');
            $table->text('body');
            $table->boolean('includes_qr')->default(true);
            $table->string('status', 20)->default('DRAFT')->comment('DRAFT, ACTIVE, RETIRED');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
            $table->unique(['tenant_id', 'code']);
            $table->foreign('brand_id')->references('id')->on('brands')->restrictOnDelete();
        });

        Schema::create('label_prints', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('template_id');
            $table->uuid('lot_id');
            $table->uuid('variant_id');
            $table->uuid('production_order_id')->nullable();
            $table->string('production_order_ref', 40)->nullable();
            $table->uuid('establishment_id');
            $table->integer('copies');
            $table->decimal('net_weight_kg', 14, 3);
            $table->decimal('price', 14, 2)->nullable()->comment('RN-ETQ-11: precio por kg de la lista del canal × peso, redondeado');
            $table->decimal('price_per_kg', 14, 4)->nullable();
            $table->string('channel', 20)->default('COUNTER');
            $table->string('barcode', 40);
            $table->string('printer_code', 40);
            $table->uuid('scale_equipment_id')->nullable();
            $table->uuid('printed_by')->nullable();
            $table->timestampTz('printed_at');
            $table->uuid('reprint_of')->nullable();
            $table->string('reprint_reason', 255)->nullable();
            $table->string('payload_hash', 64);
            $table->text('payload')->nullable()->comment('Etiqueta ya armada (ZPL, ESC/POS o texto) tal como se envió');
            $table->string('source', 10)->default('ETQ')->comment('ETQ, PRO, ALM, POS, PRE');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
            $table->index('lot_id');
            $table->index('printed_at');
            foreach (['template_id' => 'label_templates', 'lot_id' => 'lots', 'variant_id' => 'product_variants', 'production_order_id' => 'production_orders',
                'establishment_id' => 'establishments', 'scale_equipment_id' => 'equipment', 'printed_by' => 'users'] as $col => $destino) {
                $table->foreign($col)->references('id')->on($destino)->restrictOnDelete();
            }
        });

        Schema::create('lot_qr_tokens', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('lot_id');
            $table->string('token', 64)->unique();
            $table->string('status', 20)->default('ACTIVE');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
            $table->foreign('lot_id')->references('id')->on('lots')->restrictOnDelete();
        });

        Schema::create('lot_recalls', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->string('number', 20);
            $table->text('reason');
            $table->string('risk_class', 20)->comment('CLASS_I, CLASS_II, CLASS_III');
            $table->boolean('include_descendants')->default(true);
            $table->uuid('initiated_by')->nullable();
            $table->timestampTz('initiated_at');
            $table->timestampTz('contacts_listed_at')->nullable()->comment('KPI-ETQ-01');
            $table->timestampTz('authority_notified_at')->nullable();
            $table->string('status', 20)->default('OPEN')->comment('OPEN, CLOSED');
            $table->text('closing_summary')->nullable();
            $table->timestampTz('closed_at')->nullable();
            $table->uuid('closed_by')->nullable();
            $table->jsonb('affected_orders')->default(DB::raw("'[]'::jsonb"))->comment('Órdenes de producción abiertas que consumieron un lote retirado');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
            $table->unique(['tenant_id', 'number']);
            $table->foreign('initiated_by')->references('id')->on('users')->restrictOnDelete();
            $table->foreign('closed_by')->references('id')->on('users')->restrictOnDelete();
        });

        Schema::create('lot_recall_lots', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('recall_id');
            $table->uuid('lot_id');
            $table->boolean('is_descendant')->default(false);
            $table->string('previous_status', 20)->nullable();
            $table->decimal('remaining_qty', 14, 3)->nullable()->comment('Stock bloqueado al iniciar');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
            $table->unique(['recall_id', 'lot_id']);
            $table->foreign('recall_id')->references('id')->on('lot_recalls')->cascadeOnDelete();
            $table->foreign('lot_id')->references('id')->on('lots')->restrictOnDelete();
        });

        Schema::create('lot_recall_contacts', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('recall_id');
            $table->uuid('customer_id')->nullable();
            $table->uuid('lot_id');
            $table->uuid('sales_document_id')->nullable();
            $table->uuid('sales_order_id')->nullable();
            $table->uuid('consignment_delivery_id')->nullable()->comment('CON (módulo posterior): la FK la agrega su dueño');
            $table->decimal('qty', 14, 3)->default(0);
            $table->decimal('weight_kg', 14, 3)->nullable();
            $table->string('status', 20)->default('PENDING')->comment('PENDING, CONTACTED, RECOVERED, NOT_REACHABLE');
            $table->timestampTz('contacted_at')->nullable();
            $table->text('contact_notes')->nullable();
            $table->decimal('recovered_kg', 14, 3)->nullable();
            $table->uuid('updated_by')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
            $table->index('recall_id');
            foreach (['recall_id' => 'lot_recalls', 'customer_id' => 'customers', 'lot_id' => 'lots', 'sales_document_id' => 'sales_documents',
                'sales_order_id' => 'sales_orders', 'updated_by' => 'users'] as $col => $destino) {
                $table->foreign($col)->references('id')->on($destino)->restrictOnDelete();
            }
        });

        DB::statement('ALTER TABLE label_prints ADD CONSTRAINT label_prints_reprint_of_fk FOREIGN KEY (reprint_of) REFERENCES label_prints(id)');
        foreach (self::TABLAS as $t) {
            DB::statement("ALTER TABLE {$t} ADD CONSTRAINT {$t}_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id)");
        }
        $obligatorios = implode(' AND ', array_map(fn ($c) => "position('{{".$c."}}' in body) > 0",
            ['product', 'brand', 'net_weight', 'lot', 'production_date', 'expiry_date', 'sanitary_registry']));
        $checks = [
            'label_templates' => [
                'formato' => "format IN ('ZPL','ESCPOS','PDF')",
                'estado' => "status IN ('DRAFT','ACTIVE','RETIRED')",
                'tamano' => 'width_mm BETWEEN 20 AND 300 AND height_mm BETWEEN 10 AND 300',
                // RN-ETQ-03
                'campos' => "status <> 'ACTIVE' OR ({$obligatorios} AND (NOT includes_qr OR position('{{qr}}' in body) > 0))",
            ],
            'label_prints' => [
                'copias' => 'copies BETWEEN 1 AND 500',
                'peso' => 'net_weight_kg > 0',
                // RN-ETQ-04
                'reimpresion' => "reprint_of IS NULL OR btrim(coalesce(reprint_reason, '')) <> ''",
            ],
            'lot_qr_tokens' => ['estado' => "status IN ('ACTIVE','REVOKED')"],
            'lot_recalls' => [
                'clase' => "risk_class IN ('CLASS_I','CLASS_II','CLASS_III')",
                'estado' => "status IN ('OPEN','CLOSED')",
                // RN-ETQ-08
                'cierre' => "status <> 'CLOSED' OR btrim(coalesce(closing_summary, '')) <> ''",
            ],
            'lot_recall_contacts' => [
                'estado' => "status IN ('PENDING','CONTACTED','RECOVERED','NOT_REACHABLE')",
                'recuperado' => 'recovered_kg IS NULL OR recovered_kg >= 0',
            ],
        ];
        foreach ($checks as $t => $lista) {
            foreach ($lista as $nombre => $expr) {
                DB::statement("ALTER TABLE {$t} ADD CONSTRAINT {$t}_{$nombre} CHECK ({$expr})");
            }
        }
        // RN-ETQ-12: las impresiones no se cambian ni se borran.
        DB::statement('REVOKE UPDATE, DELETE, TRUNCATE ON label_prints FROM aycha_app');
        DB::statement('CREATE UNIQUE INDEX lot_qr_tokens_un_activo ON lot_qr_tokens (lot_id) WHERE status = \'ACTIVE\'');

        foreach (self::TABLAS as $t) {
            DB::statement("SELECT enable_tenant_rls('{$t}')");
            DB::statement("SELECT audit.track('{$t}')");
        }

        // ETQ-08: la página pública no tiene sesión. Esta función devuelve solo la empresa del token;
        // la página se arma después con RLS, dentro de esa empresa.
        DB::statement(<<<'SQL'
            CREATE OR REPLACE FUNCTION etq_tenant_for_qr(p_token text) RETURNS uuid
                LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
                AS $$
                    SELECT q.tenant_id FROM lot_qr_tokens q JOIN tenants t ON t.id = q.tenant_id
                     WHERE q.token = p_token AND q.status = 'ACTIVE' AND t.status = 'ACTIVE'
                $$
        SQL);
        DB::statement('REVOKE ALL ON FUNCTION etq_tenant_for_qr(text) FROM PUBLIC');
        DB::statement('GRANT EXECUTE ON FUNCTION etq_tenant_for_qr(text) TO aycha_app');
    }

    public function down(): void
    {
        DB::statement('DROP FUNCTION IF EXISTS etq_tenant_for_qr(text)');
        foreach (array_reverse(self::TABLAS) as $t) {
            DB::statement("DROP TABLE IF EXISTS {$t} CASCADE");
        }
    }
};
