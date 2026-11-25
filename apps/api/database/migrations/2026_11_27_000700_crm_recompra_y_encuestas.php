<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

// CRM-15 Recompra y CRM-16 Encuesta posentrega (RN-CRM-19 y 20).
//  - Recompra: un perfil por cliente y marca, con su estado; una sola tarea de recompra abierta por cliente y marca.
//    Si ya había dos abiertas (pasa en los datos de demostración), se cierra la que vence antes con una nota y queda la
//    más reciente (decidido con ella el 25/11/2026).
//  - Encuesta: una por pedido, con su forma de envío; la respuesta se registra una sola vez y no cambia; no se borran.
return new class extends Migration
{
    public function up(): void
    {
        DB::statement(<<<'SQL'
            UPDATE crm_tasks t SET status = 'DONE', done_at = now(), result = 'Tarea duplicada: se mantiene la recompra abierta más reciente.', updated_at = now()
            FROM (SELECT id, row_number() OVER (PARTITION BY tenant_id, customer_id, brand_id ORDER BY due_at DESC, created_at DESC) AS n
                  FROM crm_tasks WHERE task_type = 'REBUY' AND status = 'OPEN') d
            WHERE t.id = d.id AND d.n > 1
            SQL);
        DB::statement("CREATE UNIQUE INDEX IF NOT EXISTS crm_tasks_una_recompra ON crm_tasks (tenant_id, customer_id, brand_id) WHERE task_type = 'REBUY' AND status = 'OPEN'");

        DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS customer_rebuy_profiles_cliente_marca ON customer_rebuy_profiles (tenant_id, customer_id, brand_id)');
        DB::statement("ALTER TABLE customer_rebuy_profiles ADD CONSTRAINT customer_rebuy_profiles_estado CHECK (status IN ('NEW','ACTIVE','DUE','AT_RISK','LOST'))");
        DB::statement("ALTER TABLE customer_rebuy_profiles ADD CONSTRAINT customer_rebuy_profiles_frecuencia CHECK (status = 'NEW' OR median_interval_days IS NOT NULL)");
        DB::statement('CREATE INDEX IF NOT EXISTS customer_rebuy_profiles_estado_idx ON customer_rebuy_profiles (status, brand_id)');

        DB::statement('ALTER TABLE delivery_surveys ALTER COLUMN comments TYPE text');
        DB::statement('ALTER TABLE delivery_surveys ADD COLUMN IF NOT EXISTS message_id uuid REFERENCES conversation_messages (id) ON DELETE RESTRICT');
        DB::statement('ALTER TABLE delivery_surveys ADD COLUMN IF NOT EXISTS answered_by uuid REFERENCES users (id) ON DELETE RESTRICT');
        DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS delivery_surveys_pedido ON delivery_surveys (tenant_id, order_id)');
        DB::statement("ALTER TABLE delivery_surveys ADD CONSTRAINT delivery_surveys_envio CHECK (send_mode IN ('SESSION','TEMPLATE','NOT_SENT'))");
        DB::statement('ALTER TABLE delivery_surveys ADD CONSTRAINT delivery_surveys_notas CHECK ((rating_service IS NULL OR rating_service BETWEEN 1 AND 5) AND (rating_product IS NULL OR rating_product BETWEEN 1 AND 5))');
        DB::statement('ALTER TABLE delivery_surveys ADD CONSTRAINT delivery_surveys_respondida CHECK (answered_at IS NULL OR rating_service IS NOT NULL)');
        DB::statement('ALTER TABLE delivery_surveys ADD CONSTRAINT delivery_surveys_comentario CHECK (comments IS NULL OR length(comments) <= 1000)');
        DB::statement('CREATE INDEX IF NOT EXISTS delivery_surveys_envio_idx ON delivery_surveys (sent_at DESC)');
        DB::statement('REVOKE DELETE, TRUNCATE ON delivery_surveys FROM aycha_app');
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION crm_encuesta_no_cambia() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                IF (NEW.order_id, NEW.customer_id, NEW.seller_user_id, NEW.brand_id, NEW.sent_at, NEW.send_mode, NEW.message_id)
                    IS DISTINCT FROM (OLD.order_id, OLD.customer_id, OLD.seller_user_id, OLD.brand_id, OLD.sent_at, OLD.send_mode, OLD.message_id) THEN
                    RAISE EXCEPTION 'RN-CRM-20: el envío de una encuesta no se cambia' USING ERRCODE = 'check_violation';
                END IF;
                IF OLD.answered_at IS NOT NULL AND (NEW.answered_at, NEW.rating_service, NEW.rating_product, NEW.received_as_ordered, NEW.bought_outside_catalog, NEW.comments, NEW.answered_by)
                    IS DISTINCT FROM (OLD.answered_at, OLD.rating_service, OLD.rating_product, OLD.received_as_ordered, OLD.bought_outside_catalog, OLD.comments, OLD.answered_by) THEN
                    RAISE EXCEPTION 'RN-CRM-20: la respuesta de una encuesta no se cambia' USING ERRCODE = 'check_violation';
                END IF;
                RETURN NEW;
            END $$;
            DROP TRIGGER IF EXISTS crm_encuesta_no_cambia ON delivery_surveys;
            CREATE TRIGGER crm_encuesta_no_cambia BEFORE UPDATE ON delivery_surveys FOR EACH ROW EXECUTE FUNCTION crm_encuesta_no_cambia();
            SQL);
    }

    public function down(): void
    {
        DB::statement('DROP TRIGGER IF EXISTS crm_encuesta_no_cambia ON delivery_surveys');
        DB::statement('DROP FUNCTION IF EXISTS crm_encuesta_no_cambia()');
        DB::statement('GRANT DELETE ON delivery_surveys TO aycha_app');
        DB::statement('DROP INDEX IF EXISTS delivery_surveys_envio_idx');
        foreach (['comentario', 'respondida', 'notas', 'envio'] as $c) {
            DB::statement("ALTER TABLE delivery_surveys DROP CONSTRAINT IF EXISTS delivery_surveys_{$c}");
        }
        DB::statement('DROP INDEX IF EXISTS delivery_surveys_pedido');
        DB::statement('ALTER TABLE delivery_surveys DROP COLUMN IF EXISTS answered_by');
        DB::statement('ALTER TABLE delivery_surveys DROP COLUMN IF EXISTS message_id');
        DB::statement('ALTER TABLE delivery_surveys ALTER COLUMN comments TYPE varchar(255)');
        DB::statement('DROP INDEX IF EXISTS customer_rebuy_profiles_estado_idx');
        DB::statement('ALTER TABLE customer_rebuy_profiles DROP CONSTRAINT IF EXISTS customer_rebuy_profiles_frecuencia');
        DB::statement('ALTER TABLE customer_rebuy_profiles DROP CONSTRAINT IF EXISTS customer_rebuy_profiles_estado');
        DB::statement('DROP INDEX IF EXISTS customer_rebuy_profiles_cliente_marca');
        DB::statement('DROP INDEX IF EXISTS crm_tasks_una_recompra');
        // La tarea duplicada que se cerró queda cerrada: una tarea hecha no se reabre.
    }
};
