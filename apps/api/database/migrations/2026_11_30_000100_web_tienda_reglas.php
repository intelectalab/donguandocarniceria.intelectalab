<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * WEB · Tienda web y Mercado Pago: reglas en la base sobre las tablas de la fase 1.
 *  - RN-WEB-02: un pedido externo entra una sola vez por tienda (store_id, external_order_id).
 *  - Un SKU de la web se mapea una sola vez por tienda (sin mayúsculas ni espacios).
 *  - Una transacción de la pasarela es única por proveedor y pago (los reintentos del webhook no la duplican).
 *  - Estados, márgenes y montos válidos.
 *  - Columnas nuevas: corrección del celular sin tocar el crudo (overrides), reenvíos y consultas de respaldo,
 *    variante anterior al desvincular, error del reverso.
 *  - Los roles que tienen un permiso de WEB (administrador del sistema: web.store.manage; administración:
 *    web.mapping.manage y web.sync.run) reciben el módulo WEB para poder abrir sus pantallas.
 * Compatible con los datos de prueba. Correr con: php artisan migrate --database=pgsql_owner
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('ALTER TABLE web_order_inbox ADD COLUMN IF NOT EXISTS overrides jsonb NULL');
        DB::statement('ALTER TABLE web_order_inbox ADD COLUMN IF NOT EXISTS last_duplicate_at timestamptz NULL');
        DB::statement('ALTER TABLE web_order_inbox ADD COLUMN IF NOT EXISTS last_polled_at timestamptz NULL');
        DB::statement('ALTER TABLE web_order_inbox ADD COLUMN IF NOT EXISTS poll_hits integer NOT NULL DEFAULT 0');
        DB::statement("ALTER TABLE web_order_inbox ALTER COLUMN order_ids SET DEFAULT '[]'::jsonb, ALTER COLUMN webhook_event_ids SET DEFAULT '[]'::jsonb,
            ALTER COLUMN history SET DEFAULT '[]'::jsonb, ALTER COLUMN attempts SET DEFAULT 0, ALTER COLUMN auto_attempts SET DEFAULT 0, ALTER COLUMN duplicates SET DEFAULT 0");
        DB::statement('ALTER TABLE web_product_mappings ADD COLUMN IF NOT EXISTS previous_variant_id uuid NULL');
        DB::statement('ALTER TABLE web_product_mappings ADD COLUMN IF NOT EXISTS last_catalog_at timestamptz NULL');
        DB::statement("ALTER TABLE web_product_mappings ALTER COLUMN history SET DEFAULT '[]'::jsonb");
        DB::statement('ALTER TABLE gateway_transactions ADD COLUMN IF NOT EXISTS reverse_error varchar(255) NULL');
        DB::statement("ALTER TABLE gateway_transactions ALTER COLUMN order_ids SET DEFAULT '[]'::jsonb, ALTER COLUMN webhook_event_ids SET DEFAULT '[]'::jsonb,
            ALTER COLUMN history SET DEFAULT '[]'::jsonb");
        DB::statement("ALTER TABLE web_stores ALTER COLUMN history SET DEFAULT '[]'::jsonb");
        DB::statement('ALTER TABLE web_stores ALTER COLUMN default_seller_id DROP NOT NULL');
        DB::statement('ALTER TABLE web_stores ALTER COLUMN theme DROP NOT NULL');

        // Únicos (RN-WEB-02 y mapeo)
        DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS web_order_inbox_unico ON web_order_inbox (store_id, external_order_id)');
        DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS web_product_mappings_sku_unico ON web_product_mappings (store_id, upper(sku))');
        DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS gateway_transactions_unica ON gateway_transactions (tenant_id, provider, external_payment_id)');
        DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS web_sync_runs_numero ON web_sync_runs (tenant_id, number)');
        DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS web_stores_url ON web_stores (tenant_id, lower(url))');
        DB::statement('CREATE INDEX IF NOT EXISTS web_order_inbox_estado ON web_order_inbox (status, received_at)');
        DB::statement('CREATE INDEX IF NOT EXISTS web_sync_runs_tienda ON web_sync_runs (store_id, kind, started_at)');
        DB::statement('CREATE INDEX IF NOT EXISTS gateway_transactions_ref ON gateway_transactions (store_id, external_reference)');

        // Estados y valores válidos
        $checks = [
            'web_stores' => [
                'web_stores_estado' => "status IN ('ACTIVE','TESTING','PENDING','DISABLED')",
                'web_stores_margen' => 'safety_margin_pct >= 0 AND safety_margin_pct <= 50',
            ],
            'web_product_mappings' => [
                'web_product_mappings_estado' => "status IN ('LINKED','UNLINKED','ERROR')",
                'web_product_mappings_web' => "web_status IN ('publish','draft')",
                'web_product_mappings_vinculo' => "status = 'UNLINKED' OR variant_id IS NOT NULL",
            ],
            'web_order_inbox' => [
                'web_order_inbox_estado' => "status IN ('RECEIVED','PROCESSED','ERROR','IGNORED')",
                'web_order_inbox_origen' => "source IN ('WEBHOOK','POLL','MANUAL')",
                'web_order_inbox_error' => "status <> 'ERROR' OR error_code IS NOT NULL",
            ],
            'web_sync_runs' => [
                'web_sync_runs_tipo' => "kind IN ('CATALOG','PRICES','STOCK','ORDERS')",
                'web_sync_runs_origen' => "trigger IN ('MANUAL','SCHEDULE','SALE')",
                'web_sync_runs_estado' => "status IN ('COMPLETED','PARTIAL','FAILED')",
            ],
            'gateway_transactions' => [
                'gateway_transactions_estado' => "status IN ('approved','pending','in_process','authorized','rejected','cancelled','expired','refunded','charged_back','in_mediation')",
                'gateway_transactions_montos' => 'amount >= 0 AND fee_amount >= 0 AND fee_igv >= 0',
            ],
        ];
        foreach ($checks as $tabla => $reglas) {
            foreach ($reglas as $nombre => $sql) {
                DB::statement("ALTER TABLE {$tabla} DROP CONSTRAINT IF EXISTS {$nombre}");
                DB::statement("ALTER TABLE {$tabla} ADD CONSTRAINT {$nombre} CHECK ({$sql})");
            }
        }

        // Ajustes de los datos de prueba (ids del prototipo en las listas jsonb) y acceso al módulo de los roles con permisos de WEB.
        // Lo mismo corre en una base nueva después de sembrar (DatabaseSeeder → WebDemoSeeder).
        (new \Database\Seeders\WebDemoSeeder)->run();
    }

    public function down(): void
    {
        foreach (['web_order_inbox_unico', 'web_product_mappings_sku_unico', 'gateway_transactions_unica', 'web_sync_runs_numero', 'web_stores_url',
            'web_order_inbox_estado', 'web_sync_runs_tienda', 'gateway_transactions_ref'] as $i) {
            DB::statement("DROP INDEX IF EXISTS {$i}");
        }
        foreach (['web_stores' => ['web_stores_estado', 'web_stores_margen'], 'web_product_mappings' => ['web_product_mappings_estado', 'web_product_mappings_web', 'web_product_mappings_vinculo'],
            'web_order_inbox' => ['web_order_inbox_estado', 'web_order_inbox_origen', 'web_order_inbox_error'], 'web_sync_runs' => ['web_sync_runs_tipo', 'web_sync_runs_origen', 'web_sync_runs_estado'],
            'gateway_transactions' => ['gateway_transactions_estado', 'gateway_transactions_montos']] as $t => $cs) {
            foreach ($cs as $c) {
                DB::statement("ALTER TABLE {$t} DROP CONSTRAINT IF EXISTS {$c}");
            }
        }
        DB::statement('ALTER TABLE web_order_inbox DROP COLUMN IF EXISTS overrides, DROP COLUMN IF EXISTS last_duplicate_at, DROP COLUMN IF EXISTS last_polled_at, DROP COLUMN IF EXISTS poll_hits');
        DB::statement('ALTER TABLE web_product_mappings DROP COLUMN IF EXISTS previous_variant_id, DROP COLUMN IF EXISTS last_catalog_at');
        DB::statement('ALTER TABLE gateway_transactions DROP COLUMN IF EXISTS reverse_error');
    }
};
