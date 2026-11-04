<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

// Dos piezas del núcleo que el prototipo no guarda como tabla:
//  - domain_events: los eventos entre módulos (order.confirmed, document.issued, stock.moved…).
//    Los escribe el servicio de eventos y de ahí salen al outbox (INT) y a los asientos (CNT).
//  - audit.change_log (AUD): cada cambio de una tabla de negocio, con el antes y el después.
//    Lo llena un trigger; nadie lo escribe a mano y nadie lo modifica (RN-AUD).
// Tablas nuevas con tenant: SELECT audit.track('tabla') en su migración para auditarlas.
return new class extends Migration
{
    // Registros que ya son una bitácora (o de alto volumen) y no se duplican en change_log.
    private array $sinBitacora = [
        'access_log', 'audit_purge_runs', 'accounting_period_events', 'password_history', 'user_sessions',
        'lot_status_changes', 'customer_balance_movements', 'customer_merges', 'conversation_assignments',
        'conversation_messages', 'message_status_events', 'message_charges', 'contact_consents',
        'delivery_events', 'delivery_cost_allocations', 'einvoice_submissions', 'expense_approvals',
        'sales_order_status_history', 'order_reschedules', 'pos_cash_movements', 'picking_scans',
        'kpi_snapshots', 'tel_recording_access_log', 'webhook_events', 'outbox_messages', 'integration_runs',
        'idempotency_keys', 'notifications', 'stock_movements', 'ad_spend_daily', 'ad_import_runs',
        'ad_attributions', 'web_sync_runs', 'messages', 'search_entries', 'domain_events',
    ];

    public function up(): void
    {
        DB::statement(<<<'SQL'
            CREATE TABLE domain_events (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                tenant_id uuid NOT NULL DEFAULT app_tenant_id() REFERENCES tenants(id) ON DELETE RESTRICT,
                event_name varchar(80) NOT NULL,
                aggregate_type varchar(80),
                aggregate_id uuid,
                payload jsonb NOT NULL DEFAULT '{}'::jsonb,
                user_id uuid DEFAULT app_user_id(),
                occurred_at timestamptz NOT NULL DEFAULT now()
            )
        SQL);
        DB::statement('CREATE INDEX domain_events_tenant_name_idx ON domain_events (tenant_id, event_name, occurred_at)');
        DB::statement('CREATE INDEX domain_events_aggregate_idx ON domain_events (aggregate_type, aggregate_id)');
        DB::statement("SELECT enable_tenant_rls('domain_events')");
        DB::statement('REVOKE UPDATE, DELETE, TRUNCATE ON domain_events FROM aycha_app');

        // IF NOT EXISTS: migrate:fresh solo borra public, y la bitácora nunca se borra desde una migración
        DB::statement('CREATE SCHEMA IF NOT EXISTS audit');
        DB::statement(<<<'SQL'
            CREATE TABLE IF NOT EXISTS audit.change_log (
                id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                tenant_id uuid,
                table_name text NOT NULL,
                row_id uuid,
                action char(1) NOT NULL CHECK (action IN ('I', 'U', 'D')),
                old_data jsonb,
                new_data jsonb,
                changed_columns text[],
                changed_by uuid DEFAULT app_user_id(),
                changed_at timestamptz NOT NULL DEFAULT now()
            )
        SQL);
        DB::statement('CREATE INDEX IF NOT EXISTS change_log_row_idx ON audit.change_log (table_name, row_id)');
        DB::statement('CREATE INDEX IF NOT EXISTS change_log_date_idx ON audit.change_log (tenant_id, changed_at)');
        DB::statement('CREATE INDEX IF NOT EXISTS change_log_user_idx ON audit.change_log (changed_by, changed_at)');

        // La app solo lee la bitácora de su tenant; escribe en ella únicamente el trigger.
        DB::statement('GRANT USAGE ON SCHEMA audit TO aycha_app');
        DB::statement('GRANT SELECT ON audit.change_log TO aycha_app');
        DB::statement('ALTER TABLE audit.change_log ENABLE ROW LEVEL SECURITY');
        DB::statement('DROP POLICY IF EXISTS tenant_isolation ON audit.change_log');
        DB::statement('CREATE POLICY tenant_isolation ON audit.change_log USING (tenant_id = app_tenant_id())');

        // Enmascara datos sensibles antes de guardarlos (RN-AUD-07).
        DB::statement(<<<'SQL'
            CREATE OR REPLACE FUNCTION audit.mask_sensitive(d jsonb) RETURNS jsonb
                LANGUAGE sql IMMUTABLE
                AS $$
                    SELECT CASE WHEN d IS NULL THEN NULL ELSE
                        d - ARRAY['password', 'remember_token', 'secret', 'secret_hash', 'token', 'token_hash', 'code_hash', 'totp_secret']
                    END
                $$
        SQL);

        DB::statement(<<<'SQL'
            CREATE OR REPLACE FUNCTION audit.log_change() RETURNS trigger
                LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, audit
                AS $$
                DECLARE
                    v_old jsonb := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN audit.mask_sensitive(to_jsonb(OLD)) END;
                    v_new jsonb := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN audit.mask_sensitive(to_jsonb(NEW)) END;
                    v_changed text[];
                BEGIN
                    IF TG_OP = 'UPDATE' THEN
                        SELECT array_agg(k) INTO v_changed FROM jsonb_object_keys(v_new) k
                        WHERE k <> 'updated_at' AND v_new -> k IS DISTINCT FROM v_old -> k;
                        IF v_changed IS NULL THEN RETURN NEW; END IF;
                    END IF;
                    INSERT INTO audit.change_log (tenant_id, table_name, row_id, action, old_data, new_data, changed_columns)
                    VALUES ((COALESCE(v_new, v_old) ->> 'tenant_id')::uuid, TG_TABLE_NAME, (COALESCE(v_new, v_old) ->> 'id')::uuid,
                            left(TG_OP, 1), v_old, v_new, v_changed);
                    RETURN COALESCE(NEW, OLD);
                END
                $$
        SQL);
        DB::statement(<<<'SQL'
            CREATE OR REPLACE FUNCTION audit.block_changes() RETURNS trigger
                LANGUAGE plpgsql
                AS $$ BEGIN RAISE EXCEPTION 'RN-AUD-01: la bitácora de cambios no se modifica ni se borra'; END $$
        SQL);
        DB::statement('DROP TRIGGER IF EXISTS change_log_inmutable ON audit.change_log');
        DB::statement('CREATE TRIGGER change_log_inmutable BEFORE UPDATE OR DELETE ON audit.change_log FOR EACH ROW EXECUTE FUNCTION audit.block_changes()');

        DB::statement(<<<'SQL'
            CREATE OR REPLACE FUNCTION audit.track(t regclass) RETURNS void
                LANGUAGE plpgsql
                AS $$
                BEGIN
                    EXECUTE format('DROP TRIGGER IF EXISTS audit_change ON %s', t);
                    EXECUTE format('CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON %s FOR EACH ROW EXECUTE FUNCTION audit.log_change()', t);
                END
                $$
        SQL);

        $excluidas = "'".implode("','", $this->sinBitacora)."'";
        DB::statement(<<<SQL
            DO \$\$ DECLARE r record; BEGIN
                FOR r IN
                    SELECT c.relname FROM pg_class c
                    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
                    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
                    WHERE c.relkind = 'r' AND c.relname NOT IN ($excluidas)
                LOOP
                    PERFORM audit.track(r.relname::regclass);
                END LOOP;
            END \$\$
        SQL);
    }

    public function down(): void
    {
        DB::statement(<<<'SQL'
            DO $$ DECLARE r record; BEGIN
                FOR r IN SELECT tgrelid::regclass AS t FROM pg_trigger WHERE tgname = 'audit_change' LOOP
                    EXECUTE format('DROP TRIGGER audit_change ON %s', r.t);
                END LOOP;
            END $$
        SQL);
        DB::statement('DROP SCHEMA IF EXISTS audit CASCADE');
        DB::statement('DROP TABLE IF EXISTS domain_events');
    }
};
