<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

// SEG · sesiones anteriores (SEG-07, SEG-09). La sesión vigente es el token de Sanctum; al cerrarse o
// vencer, el token se borra. Este disparador la archiva en user_sessions con su estado (REVOKED o
// EXPIRED) y su motivo, que quien la cierra deja en app.cierre_estado y app.cierre_motivo
// (App\Modulos\Seg\Services\Sesiones::cerrando). Sin motivo queda «Sesión cerrada».
// Solo archiva la sesión de la empresa del contexto (RLS); user_sessions pasa a ser de solo inserción.
return new class extends Migration
{
    public function up(): void
    {
        DB::statement(<<<'SQL'
            CREATE OR REPLACE FUNCTION seg_archivar_sesion() RETURNS trigger
            LANGUAGE plpgsql SET search_path = public, pg_temp
            AS $$
            BEGIN
                IF app_tenant_id() IS DISTINCT FROM OLD.tenant_id THEN
                    RETURN OLD;
                END IF;
                INSERT INTO user_sessions (tenant_id, user_id, device_id, token_hash, ip, user_agent, client, status,
                                           started_at, last_seen_at, expires_at, revoked_at, revoke_reason)
                VALUES (OLD.tenant_id, OLD.tokenable_id, OLD.device_id, md5(OLD.id::text), coalesce(OLD.ip, ''), coalesce(OLD.device, ''),
                        OLD.name, coalesce(nullif(current_setting('app.cierre_estado', true), ''), 'REVOKED'),
                        OLD.created_at, coalesce(OLD.last_used_at, OLD.created_at), coalesce(OLD.expires_at, now()), now(),
                        left(coalesce(nullif(current_setting('app.cierre_motivo', true), ''), 'Sesión cerrada'), 255));
                RETURN OLD;
            END
            $$
        SQL);
        DB::statement('CREATE TRIGGER seg_archivar_sesion AFTER DELETE ON personal_access_tokens FOR EACH ROW EXECUTE FUNCTION seg_archivar_sesion()');
        DB::statement('CREATE INDEX IF NOT EXISTS user_sessions_usuario_fecha_index ON user_sessions (user_id, revoked_at DESC)');
        DB::statement('REVOKE UPDATE, DELETE, TRUNCATE ON user_sessions FROM aycha_app');  // solo inserción
    }

    public function down(): void
    {
        DB::statement('GRANT UPDATE, DELETE ON user_sessions TO aycha_app');
        DB::statement('DROP INDEX IF EXISTS user_sessions_usuario_fecha_index');
        DB::statement('DROP TRIGGER IF EXISTS seg_archivar_sesion ON personal_access_tokens');
        DB::statement('DROP FUNCTION IF EXISTS seg_archivar_sesion()');
    }
};
