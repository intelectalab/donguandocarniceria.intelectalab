<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

// SEG · ingreso general (sin dominio por empresa, TENANT_POR_DOMINIO=false): la empresa se toma
// del usuario. Como users y personal_access_tokens tienen RLS, antes de conocer la empresa no se
// pueden leer; estas dos funciones (del dueño, SECURITY DEFINER) devuelven solo el id de la
// empresa y nada más:
//  - auth_tenants_for_email(correo): empresas activas donde existe ese correo (ingreso y recuperación);
//  - auth_tenant_for_token(id): empresa del token (cada petición con sesión).
// Sanctum valida después el token completo (hash) dentro de esa empresa.
return new class extends Migration
{
    public function up(): void
    {
        DB::statement(<<<'SQL'
            CREATE OR REPLACE FUNCTION auth_tenants_for_email(p_email text) RETURNS SETOF uuid
                LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
                AS $$
                    SELECT DISTINCT u.tenant_id FROM users u JOIN tenants t ON t.id = u.tenant_id
                     WHERE lower(u.email) = lower(trim(p_email)) AND t.status = 'ACTIVE'
                $$
        SQL);
        DB::statement(<<<'SQL'
            CREATE OR REPLACE FUNCTION auth_tenant_for_token(p_id uuid) RETURNS uuid
                LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
                AS $$ SELECT tenant_id FROM personal_access_tokens WHERE id = p_id $$
        SQL);
        DB::statement('REVOKE ALL ON FUNCTION auth_tenants_for_email(text) FROM PUBLIC');
        DB::statement('REVOKE ALL ON FUNCTION auth_tenant_for_token(uuid) FROM PUBLIC');
        DB::statement('GRANT EXECUTE ON FUNCTION auth_tenants_for_email(text) TO aycha_app');
        DB::statement('GRANT EXECUTE ON FUNCTION auth_tenant_for_token(uuid) TO aycha_app');
    }

    public function down(): void
    {
        DB::statement('DROP FUNCTION IF EXISTS auth_tenant_for_token(uuid)');
        DB::statement('DROP FUNCTION IF EXISTS auth_tenants_for_email(text)');
    }
};
