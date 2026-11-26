<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

// CRM-03 Crear pedido desde el chat, CRM-04 Ficha 360 y CRM-05 Leads (RN-CRM-09 y 10).
//  - Un pedido pertenece a una sola conversación; el vínculo no se cambia ni se borra.
//  - Un lead perdido lleva su motivo y uno ganado, su pedido. Un lead cargado a mano (teléfono, visita, referido) no
//    tiene número de origen.
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS conversation_orders_pedido ON conversation_orders (order_id)');
        DB::statement('REVOKE UPDATE, DELETE, TRUNCATE ON conversation_orders FROM aycha_app');

        DB::statement('ALTER TABLE leads ALTER COLUMN channel_id DROP NOT NULL');
        DB::statement("ALTER TABLE leads ADD CONSTRAINT leads_motivo CHECK (lost_reason IS NULL OR lost_reason IN
            ('PRICE','NO_STOCK','OUT_OF_ZONE','NO_RESPONSE','DELIVERY_TIME','PRODUCT_NOT_OFFERED','DUPLICATE','SPAM','OTHER'))");
        DB::statement("ALTER TABLE leads ADD CONSTRAINT leads_perdido_con_motivo CHECK (status <> 'LOST' OR lost_reason IS NOT NULL)");
        DB::statement("ALTER TABLE leads ADD CONSTRAINT leads_ganado_con_pedido CHECK (status <> 'WON' OR converted_order_id IS NOT NULL)");
        DB::statement("ALTER TABLE leads ADD CONSTRAINT leads_origen CHECK (source IN ('WHATSAPP','MESSENGER','INSTAGRAM','TIKTOK','PHONE','WALK_IN','REFERRAL','WEB_FORM','OTHER'))");
        DB::statement('CREATE INDEX IF NOT EXISTS leads_embudo ON leads (brand_id, status, first_contact_at DESC)');
        DB::statement('CREATE INDEX IF NOT EXISTS leads_celular ON leads (phone)');
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS leads_celular');
        DB::statement('DROP INDEX IF EXISTS leads_embudo');
        foreach (['origen', 'ganado_con_pedido', 'perdido_con_motivo', 'motivo'] as $c) {
            DB::statement("ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_{$c}");
        }
        DB::statement('GRANT UPDATE, DELETE ON conversation_orders TO aycha_app');
        DB::statement('DROP INDEX IF EXISTS conversation_orders_pedido');
    }
};
