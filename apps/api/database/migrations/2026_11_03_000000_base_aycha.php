<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

// Base de la base de datos: extensiones, contexto de la sesión (tenant y usuario) y la función que
// activa el aislamiento por tenant. Cada tabla con tenant_id llama a enable_tenant_rls('tabla').
//
// La app se conecta como aycha_app y, en cada petición, fija el contexto:
//   SELECT set_config('app.tenant_id', '<uuid>', true), set_config('app.user_id', '<uuid>', true);
// Sin contexto, app_tenant_id() es NULL y las políticas no devuelven ninguna fila.
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('CREATE EXTENSION IF NOT EXISTS pgcrypto');
        DB::statement('CREATE EXTENSION IF NOT EXISTS citext');
        DB::statement('CREATE EXTENSION IF NOT EXISTS btree_gist');

        // El rol lo crea infrastructure/postgres/init; esto solo cubre bases creadas a mano.
        DB::statement(<<<'SQL'
            DO $$ BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aycha_app') THEN
                    CREATE ROLE aycha_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
                END IF;
            END $$
        SQL);

        DB::statement(<<<'SQL'
            CREATE OR REPLACE FUNCTION app_tenant_id() RETURNS uuid
                LANGUAGE sql STABLE
                AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$
        SQL);
        DB::statement(<<<'SQL'
            CREATE OR REPLACE FUNCTION app_user_id() RETURNS uuid
                LANGUAGE sql STABLE
                AS $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$
        SQL);

        // Activa RLS con la política estándar. Úsala en cada tabla nueva con tenant_id.
        DB::statement(<<<'SQL'
            CREATE OR REPLACE FUNCTION enable_tenant_rls(t regclass) RETURNS void
                LANGUAGE plpgsql
                AS $$
                BEGIN
                    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
                    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %s', t);
                    EXECUTE format('CREATE POLICY tenant_isolation ON %s USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())', t);
                END
                $$
        SQL);

        // Tablas con tenant_id que todavía no tienen RLS: la consulta debe volver vacía.
        // Una tabla global a propósito (se lee antes de conocer el tenant) lleva un comentario
        // que empieza con «global:» y queda fuera.
        DB::statement(<<<'SQL'
            CREATE OR REPLACE VIEW rls_gaps AS
                SELECT c.relname AS table_name
                FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
                JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
                WHERE c.relkind = 'r' AND NOT c.relrowsecurity
                  AND COALESCE(obj_description(c.oid, 'pg_class'), '') NOT LIKE 'global:%'
        SQL);

        // Todo lo que cree el dueño de aquí en adelante queda disponible para la app;
        // las tablas de solo inserción y los catálogos le quitan permisos en su propia migración.
        DB::statement('GRANT USAGE ON SCHEMA public TO aycha_app');
        DB::statement('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO aycha_app');
        DB::statement('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO aycha_app');
        DB::statement('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO aycha_app');
        DB::statement('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO aycha_app');
        DB::statement('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO aycha_app');
        DB::statement('REVOKE ALL ON TABLE migrations FROM aycha_app');
    }

    public function down(): void
    {
        DB::statement('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM aycha_app');
        DB::statement('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM aycha_app');
        DB::statement('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM aycha_app');
        DB::statement('DROP VIEW IF EXISTS rls_gaps');
        DB::statement('DROP FUNCTION IF EXISTS enable_tenant_rls(regclass)');
        DB::statement('DROP FUNCTION IF EXISTS app_user_id()');
        DB::statement('DROP FUNCTION IF EXISTS app_tenant_id()');
    }
};
