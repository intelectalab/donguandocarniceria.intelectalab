<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * ADS · Publicidad y atribución (ADS-01 a ADS-09; RN-ADS-01 a 12).
 *
 *  - ad_spend_daily: una sola fila por campaña, anuncio y fecha (RN-ADS-02). Reimportar un día reemplaza el valor de
 *    ese día sin duplicar filas.
 *  - ad_ads: el código de rastreo (formato XX-XXXX, por ejemplo DG-G01) es único en la empresa sin importar mayúsculas
 *    (RN-ADS-03).
 *  - ad_attributions: un pedido tiene una sola atribución (último toque antes del pedido, RN-ADS-05); las correcciones
 *    manuales guardan quién corrigió, cuándo, con qué motivo y el valor anterior (RN-ADS-06).
 *  - ad_platform_invoices: número único por cuenta publicitaria y enlace al gasto generado en GAS (RN-ADS-08).
 *  - Seguimiento en la bitácora de auditoría (AUD-01) de cuentas, anuncios, atribuciones y facturas de plataformas.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('ALTER TABLE ad_accounts ALTER COLUMN last_import_at DROP NOT NULL');
        DB::statement('ALTER TABLE ad_accounts ALTER COLUMN supplier_id DROP NOT NULL');
        DB::statement('ALTER TABLE ad_import_runs ALTER COLUMN finished_at DROP NOT NULL');
        DB::statement('ALTER TABLE ad_spend_daily ALTER COLUMN import_run_id DROP NOT NULL');
        DB::statement('ALTER TABLE ad_platform_invoices ALTER COLUMN supplier_id DROP NOT NULL');
        DB::statement('ALTER TABLE ad_platform_invoices ADD COLUMN IF NOT EXISTS sent_to_gas_at timestamptz');

        // Eliminar posibles duplicados previos antes de crear los índices únicos.
        DB::statement(<<<'SQL'
            DELETE FROM ad_spend_daily a
            USING ad_spend_daily b
            WHERE a.tenant_id = b.tenant_id
              AND a.campaign_id = b.campaign_id
              AND a.ad_id = b.ad_id
              AND a.spend_date = b.spend_date
              AND a.id < b.id
        SQL);
        DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS ad_spend_daily_unico ON ad_spend_daily (tenant_id, campaign_id, ad_id, spend_date)');
        DB::statement("CREATE UNIQUE INDEX IF NOT EXISTS ad_ads_codigo_rastreo_unico ON ad_ads (tenant_id, upper(btrim(tracking_code))) WHERE tracking_code IS NOT NULL AND btrim(tracking_code) <> ''");

        DB::statement(<<<'SQL'
            DELETE FROM ad_attributions a
            USING ad_attributions b
            WHERE a.tenant_id = b.tenant_id
              AND a.order_id IS NOT NULL
              AND a.order_id = b.order_id
              AND a.id < b.id
        SQL);
        DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS ad_attributions_pedido_unico ON ad_attributions (tenant_id, order_id) WHERE order_id IS NOT NULL');
        DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS ad_platform_invoices_unico ON ad_platform_invoices (tenant_id, account_id, upper(btrim(invoice_number)))');

        foreach (['ad_accounts', 'ad_campaigns', 'ad_ads', 'ad_attributions', 'ad_platform_invoices'] as $t) {
            DB::statement("SELECT audit.track('{$t}')");
        }
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS ad_platform_invoices_unico');
        DB::statement('DROP INDEX IF EXISTS ad_attributions_pedido_unico');
        DB::statement('DROP INDEX IF EXISTS ad_ads_codigo_rastreo_unico');
        DB::statement('DROP INDEX IF EXISTS ad_spend_daily_unico');
        DB::statement('ALTER TABLE ad_platform_invoices DROP COLUMN IF EXISTS sent_to_gas_at');
    }
};
