<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

// AUD-01 a AUD-03 (RN-AUD-02, RN-AUD-03, RN-AUD-07).
//  - RN-AUD-07: la bitácora de cambios enmascaraba los secretos solo por algunos nombres de columna (password, token,
//    secret…). Las columnas cifradas nuevas (secret_enc de credenciales y webhooks, totp_secret_enc y totp_pending_enc del
//    segundo factor) quedaban copiadas. Ahora se enmascara por patrón de nombre (password, token, secret, totp, api_key,
//    code_hash, *_enc) y todo valor cifrado («enc:v…»), con «***»: se ve que cambió, nunca el valor.
//  - Las filas ya guardadas con esos valores se limpian (es la única vez que la migración toca la bitácora: borrar un
//    secreto que nunca debió quedar ahí).
//  - access_log: índices para la consulta por fecha y por evento.
return new class extends Migration
{
    public function up(): void
    {
        DB::statement(<<<'SQL'
            CREATE OR REPLACE FUNCTION audit.mask_sensitive(d jsonb) RETURNS jsonb
                LANGUAGE sql IMMUTABLE
                AS $$
                    SELECT CASE WHEN d IS NULL OR jsonb_typeof(d) <> 'object' THEN d ELSE (
                        SELECT coalesce(jsonb_object_agg(k, CASE
                            WHEN k ~* '(password|remember_token|secret|token|totp_secret|totp_pending|api_key|code_hash|_enc$)' AND v <> 'null'::jsonb THEN '"***"'::jsonb
                            WHEN jsonb_typeof(v) = 'string' AND (v #>> '{}') LIKE 'enc:v%' THEN '"***"'::jsonb
                            ELSE v END), '{}'::jsonb)
                        FROM jsonb_each(d) AS e(k, v)
                    ) END
                $$
        SQL);
        // Lo ya guardado: solo las filas que traen un secreto. La bitácora no se deja modificar (trigger change_log_inmutable,
        // RN-AUD-01): se suspende solo durante esta limpieza, dentro de la misma transacción, y se vuelve a activar.
        DB::statement('ALTER TABLE audit.change_log DISABLE TRIGGER change_log_inmutable');
        DB::statement(<<<'SQL'
            UPDATE audit.change_log SET old_data = audit.mask_sensitive(old_data), new_data = audit.mask_sensitive(new_data)
             WHERE (old_data IS NOT NULL AND EXISTS (SELECT 1 FROM jsonb_each(old_data) e(k, v)
                        WHERE k ~* '(password|remember_token|secret|token|totp_secret|totp_pending|api_key|code_hash|_enc$)' AND v NOT IN ('null'::jsonb, '"***"'::jsonb)
                           OR (jsonb_typeof(v) = 'string' AND (v #>> '{}') LIKE 'enc:v%')))
                OR (new_data IS NOT NULL AND EXISTS (SELECT 1 FROM jsonb_each(new_data) e(k, v)
                        WHERE k ~* '(password|remember_token|secret|token|totp_secret|totp_pending|api_key|code_hash|_enc$)' AND v NOT IN ('null'::jsonb, '"***"'::jsonb)
                           OR (jsonb_typeof(v) = 'string' AND (v #>> '{}') LIKE 'enc:v%')))
            SQL);
        DB::statement('ALTER TABLE audit.change_log ENABLE TRIGGER change_log_inmutable');
        DB::statement('CREATE INDEX IF NOT EXISTS access_log_fecha_idx ON access_log (tenant_id, at)');
        DB::statement('CREATE INDEX IF NOT EXISTS access_log_evento_idx ON access_log (event, at)');
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS access_log_evento_idx');
        DB::statement('DROP INDEX IF EXISTS access_log_fecha_idx');
        DB::statement(<<<'SQL'
            CREATE OR REPLACE FUNCTION audit.mask_sensitive(d jsonb) RETURNS jsonb
                LANGUAGE sql IMMUTABLE
                AS $$
                    SELECT CASE WHEN d IS NULL THEN NULL ELSE
                        d - ARRAY['password', 'remember_token', 'secret', 'secret_hash', 'token', 'token_hash', 'code_hash', 'totp_secret']
                    END
                $$
        SQL);
    }
};
