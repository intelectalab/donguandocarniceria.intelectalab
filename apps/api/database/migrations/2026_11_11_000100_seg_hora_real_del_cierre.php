<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

// SEG · hora real del cierre en las sesiones anteriores. Quien cierra puede dejar en app.cierre_en el
// momento en que la sesión terminó de verdad (la limpieza de sesiones vencidas deja la hora en que
// venció, no la hora en que pasó). Sin ese dato queda la hora actual, como antes.
return new class extends Migration
{
    public function up(): void
    {
        DB::statement(<<<'SQL'
            CREATE OR REPLACE FUNCTION seg_archivar_sesion() RETURNS trigger
            LANGUAGE plpgsql SET search_path = public, pg_temp
            AS $$
            DECLARE
                cierre timestamptz := now();
            BEGIN
                IF app_tenant_id() IS DISTINCT FROM OLD.tenant_id THEN
                    RETURN OLD;
                END IF;
                BEGIN
                    cierre := least(now(), coalesce(nullif(current_setting('app.cierre_en', true), '')::timestamptz, now()));
                EXCEPTION WHEN others THEN
                    cierre := now();
                END;
                INSERT INTO user_sessions (tenant_id, user_id, device_id, token_hash, ip, user_agent, client, status,
                                           started_at, last_seen_at, expires_at, revoked_at, revoke_reason)
                VALUES (OLD.tenant_id, OLD.tokenable_id, OLD.device_id, md5(OLD.id::text), coalesce(OLD.ip, ''), coalesce(OLD.device, ''),
                        OLD.name, coalesce(nullif(current_setting('app.cierre_estado', true), ''), 'REVOKED'),
                        OLD.created_at, coalesce(OLD.last_used_at, OLD.created_at), coalesce(OLD.expires_at, now()), cierre,
                        left(coalesce(nullif(current_setting('app.cierre_motivo', true), ''), 'Sesión cerrada'), 255));
                RETURN OLD;
            END
            $$
        SQL);
    }

    public function down(): void
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
    }
};
