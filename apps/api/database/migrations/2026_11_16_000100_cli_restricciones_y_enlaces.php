<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// CLI · restricciones, columnas que faltaban y enlaces de ubicación (000800 creó las tablas).
// Detalle de cada pantalla: docs/cambios/2026-11-16_cli-clientes.md.
//
//  - RN-CLI-11: un cliente es único por tipo y número de documento (sin contar los fusionados).
//  - RN-CLI-10: una sola dirección predeterminada activa por cliente.
//  - CLI-04: la respuesta del proveedor (dirección fiscal, condición del contribuyente, estado).
//  - CLI-02: quién y cuándo desbloqueó, y por dónde llegó el consentimiento.
//  - CLI-08: «gratis desde S/» era texto; pasa a número.
//  - CLI-07: enlace de ubicación de un solo uso. Se guarda solo el hash del token: el enlace completo
//    se ve una vez, al crearlo. El cliente lo abre sin sesión; cli_link_tenant() (del dueño, SECURITY
//    DEFINER) devuelve solo la empresa del enlace, igual que auth_tenant_for_token en el ingreso.
return new class extends Migration
{
    private const ESTADOS = [
        ['customers', 'status', ['ACTIVE', 'BLOCKED', 'INACTIVE']],
        ['customers', 'doc_type', ['DNI', 'RUC', 'CE', 'PASSPORT', 'NONE']],
        ['customers', 'customer_type', ['PERSON', 'RESTAURANT', 'BUSINESS', 'CONSIGNMENT_POINT', 'RELATED', 'OTHER']],
        ['customer_addresses', 'status', ['ACTIVE', 'INACTIVE']],
        ['delivery_zones', 'status', ['ACTIVE', 'INACTIVE']],
        ['customer_duplicate_candidates', 'status', ['OPEN', 'MERGED', 'DISMISSED']],
        ['customer_duplicate_candidates', 'match_reason', ['SAME_PHONE', 'SAME_DOC', 'SAME_EMAIL', 'SIMILAR_NAME_ADDRESS']],
    ];

    public function up(): void
    {
        Schema::table('customers', function (Blueprint $table) {
            $table->string('fiscal_address', 255)->nullable();
            $table->string('taxpayer_condition', 40)->nullable();
            $table->string('doc_validation_state', 80)->nullable();
            $table->timestampTz('unblocked_at')->nullable();
            $table->string('unblocked_note', 255)->nullable();
            $table->string('marketing_opt_in_source', 40)->nullable();
        });

        DB::statement('ALTER TABLE delivery_zones ALTER COLUMN free_from_amount TYPE numeric(14,2) USING NULLIF(free_from_amount, \'\')::numeric');
        DB::statement('ALTER TABLE delivery_zones ALTER COLUMN min_order_amount SET DEFAULT 0');
        DB::statement("ALTER TABLE delivery_zones ALTER COLUMN districts SET DEFAULT '[]'::jsonb");
        DB::statement("ALTER TABLE customers ALTER COLUMN segment_brands SET DEFAULT '[]'::jsonb");
        DB::statement('ALTER TABLE customers ALTER COLUMN orders_count SET DEFAULT 0');
        DB::statement('ALTER TABLE customers ALTER COLUMN marketing_opt_in SET DEFAULT false');

        foreach (self::ESTADOS as [$tabla, $col, $valores]) {
            $lista = implode(',', array_map(fn ($v) => "'{$v}'", $valores));
            DB::statement("ALTER TABLE {$tabla} ADD CONSTRAINT {$tabla}_{$col}_valido CHECK ({$col} IN ({$lista}))");
        }
        DB::statement('ALTER TABLE delivery_zones ADD CONSTRAINT delivery_zones_montos CHECK (delivery_fee >= 0 AND min_order_amount >= 0)');
        DB::statement('ALTER TABLE customer_duplicate_candidates ADD CONSTRAINT customer_duplicate_candidates_par CHECK (customer_id <> duplicate_of_id)');
        // RN-CLI-04: el pin, si está, cae dentro del Perú.
        DB::statement('ALTER TABLE customer_addresses ADD CONSTRAINT customer_addresses_pin_en_peru CHECK (lat IS NULL OR (lat BETWEEN -18.4 AND -0.03 AND lng BETWEEN -81.4 AND -68.6))');

        // RN-CLI-11 y RN-CLI-10.
        DB::statement("CREATE UNIQUE INDEX customers_documento_unico ON customers (tenant_id, doc_type, doc_number) WHERE doc_type <> 'NONE' AND doc_number IS NOT NULL AND merged_into_id IS NULL");
        DB::statement("CREATE UNIQUE INDEX customer_addresses_una_predeterminada ON customer_addresses (customer_id) WHERE is_default AND status = 'ACTIVE'");

        // Búsquedas de las pantallas.
        DB::statement('CREATE INDEX customers_celular_index ON customers (tenant_id, phone)');
        DB::statement('CREATE INDEX customers_celular_alterno_index ON customers (tenant_id, phone_alt)');
        DB::statement('CREATE INDEX customers_correo_index ON customers (tenant_id, lower(email))');
        DB::statement('CREATE INDEX customer_duplicate_candidates_estado_index ON customer_duplicate_candidates (tenant_id, status)');
        DB::statement('CREATE INDEX sales_orders_cliente_index ON sales_orders (customer_id, created_at)');

        // CLI-07 Enlace de ubicación.
        Schema::create('customer_location_links', function (Blueprint $table) {
            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));
            $table->uuid('customer_id');
            $table->string('token_hash', 64)->nullable()->comment('sha256 del token; el token solo se muestra al crear el enlace');
            $table->string('phone', 40)->nullable();
            $table->timestampTz('expires_at');
            $table->string('status', 20)->default('PENDING');
            $table->string('sent_via', 20)->nullable();
            $table->string('created_by', 80)->nullable();
            $table->timestampTz('used_at')->nullable();
            $table->uuid('address_id')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
            $table->index('tenant_id');
            $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete();
            $table->foreign('customer_id')->references('id')->on('customers')->restrictOnDelete();
            $table->foreign('address_id')->references('id')->on('customer_addresses')->restrictOnDelete();
            $table->index('customer_id');
            $table->unique('token_hash');
        });
        DB::statement("ALTER TABLE customer_location_links ADD CONSTRAINT customer_location_links_status_valido CHECK (status IN ('PENDING','USED','EXPIRED','CANCELLED'))");
        DB::statement("SELECT enable_tenant_rls('customer_location_links')");

        DB::statement(<<<'SQL'
            CREATE OR REPLACE FUNCTION cli_link_tenant(p_hash text) RETURNS uuid
                LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
                AS $$ SELECT l.tenant_id FROM customer_location_links l JOIN tenants t ON t.id = l.tenant_id
                       WHERE l.token_hash = p_hash AND t.status = 'ACTIVE' $$
        SQL);
        DB::statement('REVOKE ALL ON FUNCTION cli_link_tenant(text) FROM PUBLIC');
        DB::statement('GRANT EXECUTE ON FUNCTION cli_link_tenant(text) TO aycha_app');
    }

    public function down(): void
    {
        DB::statement('DROP FUNCTION IF EXISTS cli_link_tenant(text)');
        Schema::dropIfExists('customer_location_links');
        foreach (['customers_documento_unico', 'customer_addresses_una_predeterminada', 'customers_celular_index', 'customers_celular_alterno_index',
            'customers_correo_index', 'customer_duplicate_candidates_estado_index', 'sales_orders_cliente_index'] as $indice) {
            DB::statement("DROP INDEX IF EXISTS {$indice}");
        }
        foreach (self::ESTADOS as [$tabla, $col]) {
            DB::statement("ALTER TABLE {$tabla} DROP CONSTRAINT IF EXISTS {$tabla}_{$col}_valido");
        }
        DB::statement('ALTER TABLE delivery_zones DROP CONSTRAINT IF EXISTS delivery_zones_montos');
        DB::statement('ALTER TABLE customer_duplicate_candidates DROP CONSTRAINT IF EXISTS customer_duplicate_candidates_par');
        DB::statement('ALTER TABLE customer_addresses DROP CONSTRAINT IF EXISTS customer_addresses_pin_en_peru');
        DB::statement('ALTER TABLE delivery_zones ALTER COLUMN free_from_amount TYPE varchar(255) USING free_from_amount::text');
        Schema::table('customers', function (Blueprint $table) {
            $table->dropColumn(['fiscal_address', 'taxpayer_condition', 'doc_validation_state', 'unblocked_at', 'unblocked_note', 'marketing_opt_in_source']);
        });
    }
};
