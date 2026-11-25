<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

// AUD-06 Políticas de retención, AUD-07 Corridas de depuración y AUD-08 Revisión de accesos (RN-AUD-02, 08 y 10).
//
// La depuración la hace la base, no la aplicación: la bitácora de accesos no se deja borrar (REVOKE DELETE) y la de
// cambios tiene el trigger change_log_inmutable. Solo estas funciones del dueño de la base borran, y siempre:
//  - en la empresa de la sesión (app_tenant_id()), nunca en otra;
//  - con la fecha de corte que calcula la base desde la política de la empresa (la aplicación no la elige);
//  - en una lista cerrada de categorías y tablas, con las reglas de qué se conserva (webhooks fallidos, mensajes por enviar…);
//  - devolviendo las filas borradas, para que la aplicación las archive en la misma transacción (si falla, no se borra nada).
return new class extends Migration
{
    public function up(): void
    {
        // Una política por categoría y empresa; plazos con sentido.
        DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS audit_retention_policies_categoria ON audit_retention_policies (tenant_id, category)');
        DB::statement("ALTER TABLE audit_retention_policies ADD CONSTRAINT audit_retention_policies_plazo CHECK (months > 0 AND unit IN ('DAYS','MONTHS'))");
        DB::statement('ALTER TABLE audit_retention_policies ALTER COLUMN updated_by TYPE varchar(120), ALTER COLUMN reason TYPE varchar(300)');
        DB::statement("SELECT audit.track('audit_retention_policies')");   // sus cambios se ven en AUD-01

        // Corridas: solo inserción (ya revocado); el número no se repite; si falla, queda el motivo.
        DB::statement('ALTER TABLE audit_purge_runs ADD COLUMN IF NOT EXISTS error_message varchar(500)');
        DB::statement('ALTER TABLE audit_purge_runs ALTER COLUMN run_by TYPE varchar(120)');
        DB::statement("ALTER TABLE audit_purge_runs ADD CONSTRAINT audit_purge_runs_estado CHECK (status IN ('COMPLETED','FAILED'))");
        DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS audit_purge_runs_numero ON audit_purge_runs (tenant_id, number)');

        // Revisiones: una por trimestre y empresa.
        DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS access_reviews_trimestre ON access_reviews (tenant_id, quarter)');
        DB::statement("ALTER TABLE access_reviews ADD CONSTRAINT access_reviews_estado CHECK (status IN ('OPEN','COMPLETED'))");
        DB::statement('ALTER TABLE access_reviews ALTER COLUMN reviewer TYPE varchar(120), ALTER COLUMN findings TYPE text');

        // La bitácora de cambios solo se borra desde la corrida de retención (la aplicación no tiene DELETE sobre ella).
        DB::statement(<<<'SQL'
            CREATE OR REPLACE FUNCTION audit.block_changes() RETURNS trigger
                LANGUAGE plpgsql
                AS $$
                BEGIN
                    IF TG_OP = 'DELETE' AND current_setting('aycha.purga', true) = 'on' THEN
                        RETURN OLD;
                    END IF;
                    RAISE EXCEPTION 'RN-AUD-01: la bitácora de cambios no se modifica ni se borra';
                END
                $$
        SQL);

        // Categoría => tabla, columna de fecha y qué se puede depurar (lo demás se conserva).
        DB::statement(<<<'SQL'
            CREATE OR REPLACE FUNCTION audit.retention_target(p_category text, OUT tbl text, OUT col text, OUT cond text)
                LANGUAGE sql IMMUTABLE
                AS $$
                    SELECT v.t, v.d, v.k FROM (VALUES
                        ('CHANGE_LOG',    'audit.change_log',        'changed_at',   'true'),
                        ('ACCESS_LOG',    'public.access_log',       'at',           'true'),
                        ('EXPORTS',       'public.data_exports',     'requested_at', 'status <> ''PENDING_APPROVAL'''),
                        ('NOTIFICATIONS', 'public.notifications',    'at',           'read_at IS NOT NULL'),
                        ('WEBHOOKS',      'public.webhook_events',   'received_at',  'status <> ''FAILED'''),
                        ('OUTBOX',        'public.outbox_messages',  'created_at',   'status IN (''SENT'', ''CANCELLED'')'),
                        ('DOMAIN_EVENTS', 'public.domain_events',    'occurred_at',  'true'),
                        ('RECORDINGS',    'public.tel_recordings',   'created_at',   'NOT legal_hold'),
                        ('FILES',         'public.file_attachments', 'deleted_at',   'status = ''DELETED''')
                    ) AS v(c, t, d, k) WHERE v.c = p_category
                $$
        SQL);

        // Fecha de corte (hora de Lima) según la política de la empresa de la sesión; NULL si no tiene política.
        DB::statement(<<<'SQL'
            CREATE OR REPLACE FUNCTION audit.retention_cutoff(p_category text) RETURNS date
                LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, audit
                AS $$
                DECLARE
                    p record;
                    v_hoy date := (now() AT TIME ZONE 'America/Lima')::date;
                BEGIN
                    IF app_tenant_id() IS NULL THEN
                        RAISE EXCEPTION 'RN-AUD-08: la depuración se hace dentro de una empresa';
                    END IF;
                    IF (SELECT tbl FROM audit.retention_target(p_category)) IS NULL THEN
                        RAISE EXCEPTION 'RN-AUD-08: categoría desconocida %', p_category;
                    END IF;
                    SELECT months, unit INTO p FROM audit_retention_policies WHERE tenant_id = app_tenant_id() AND category = p_category;
                    IF NOT FOUND THEN
                        RETURN NULL;
                    END IF;
                    -- Cambios y accesos: nunca menos de un año, aunque la política se alterara a mano (la aplicación exige 5).
                    IF p_category IN ('CHANGE_LOG', 'ACCESS_LOG') AND (p.unit <> 'MONTHS' OR p.months < 12) THEN
                        RAISE EXCEPTION 'RN-AUD-08: la auditoría de cambios y la bitácora de accesos se conservan al menos un año';
                    END IF;
                    RETURN CASE WHEN p.unit = 'DAYS' THEN v_hoy - p.months ELSE (v_hoy - make_interval(months => p.months))::date END;
                END
                $$
        SQL);

        // Cuántas filas se depurarían hoy.
        DB::statement(<<<'SQL'
            CREATE OR REPLACE FUNCTION audit.purge_count(p_category text) RETURNS bigint
                LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, audit
                AS $$
                DECLARE
                    t record;
                    v_corte date := audit.retention_cutoff(p_category);
                    n bigint;
                BEGIN
                    SELECT * INTO t FROM audit.retention_target(p_category);
                    IF v_corte IS NULL OR to_regclass(t.tbl) IS NULL THEN
                        RETURN 0;
                    END IF;
                    EXECUTE format('SELECT count(*) FROM %s WHERE tenant_id = $1 AND %I < ($2::timestamp AT TIME ZONE ''America/Lima'') AND (%s)', t.tbl, t.col, t.cond)
                        INTO n USING app_tenant_id(), v_corte;
                    RETURN n;
                END
                $$
        SQL);

        // Borra lo vencido y devuelve cada fila borrada (para archivarla). Las tablas con claves de otras (archivos,
        // grabaciones) se borran de a una: la que todavía usa otro registro se conserva.
        DB::statement(<<<'SQL'
            CREATE OR REPLACE FUNCTION audit.purge_rows(p_category text) RETURNS SETOF jsonb
                LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, audit
                AS $$
                DECLARE
                    t record;
                    v_corte date := audit.retention_cutoff(p_category);
                    r record;
                    j jsonb;
                BEGIN
                    SELECT * INTO t FROM audit.retention_target(p_category);
                    IF v_corte IS NULL OR to_regclass(t.tbl) IS NULL THEN
                        RETURN;
                    END IF;
                    PERFORM set_config('aycha.purga', 'on', true);
                    IF p_category IN ('FILES', 'RECORDINGS') THEN
                        FOR r IN EXECUTE format('SELECT id FROM %s WHERE tenant_id = $1 AND %I < ($2::timestamp AT TIME ZONE ''America/Lima'') AND (%s)', t.tbl, t.col, t.cond)
                            USING app_tenant_id(), v_corte
                        LOOP
                            BEGIN
                                EXECUTE format('DELETE FROM %s x WHERE x.id = $1 AND x.tenant_id = $2 RETURNING to_jsonb(x.*)', t.tbl) INTO j USING r.id, app_tenant_id();
                                IF j IS NOT NULL THEN
                                    RETURN NEXT j;
                                END IF;
                            EXCEPTION WHEN foreign_key_violation THEN
                                NULL;
                            END;
                        END LOOP;
                    ELSE
                        RETURN QUERY EXECUTE format('DELETE FROM %s x WHERE x.tenant_id = $1 AND x.%I < ($2::timestamp AT TIME ZONE ''America/Lima'') AND (%s) RETURNING to_jsonb(x.*)', t.tbl, t.col, t.cond)
                            USING app_tenant_id(), v_corte;
                    END IF;
                    PERFORM set_config('aycha.purga', 'off', true);
                END
                $$
        SQL);

        foreach (['audit.retention_cutoff(text)', 'audit.purge_count(text)', 'audit.purge_rows(text)'] as $f) {
            DB::statement("REVOKE ALL ON FUNCTION {$f} FROM PUBLIC");
            DB::statement("GRANT EXECUTE ON FUNCTION {$f} TO aycha_app");
        }
    }

    public function down(): void
    {
        DB::statement('DROP FUNCTION IF EXISTS audit.purge_rows(text)');
        DB::statement('DROP FUNCTION IF EXISTS audit.purge_count(text)');
        DB::statement('DROP FUNCTION IF EXISTS audit.retention_cutoff(text)');
        DB::statement('DROP FUNCTION IF EXISTS audit.retention_target(text)');
        DB::statement(<<<'SQL'
            CREATE OR REPLACE FUNCTION audit.block_changes() RETURNS trigger
                LANGUAGE plpgsql
                AS $$ BEGIN RAISE EXCEPTION 'RN-AUD-01: la bitácora de cambios no se modifica ni se borra'; END $$
        SQL);
        DB::statement('DROP TRIGGER IF EXISTS audit_change ON audit_retention_policies');
        DB::statement('ALTER TABLE access_reviews DROP CONSTRAINT IF EXISTS access_reviews_estado');
        DB::statement('DROP INDEX IF EXISTS access_reviews_trimestre');
        DB::statement('DROP INDEX IF EXISTS audit_purge_runs_numero');
        DB::statement('ALTER TABLE audit_purge_runs DROP CONSTRAINT IF EXISTS audit_purge_runs_estado');
        DB::statement('ALTER TABLE audit_purge_runs DROP COLUMN IF EXISTS error_message');
        DB::statement('ALTER TABLE audit_retention_policies DROP CONSTRAINT IF EXISTS audit_retention_policies_plazo');
        DB::statement('DROP INDEX IF EXISTS audit_retention_policies_categoria');
    }
};
