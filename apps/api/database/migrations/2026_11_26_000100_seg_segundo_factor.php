<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

// SEG-02 Verificación del segundo factor y SEG-03 Activarlo (RN-SEG-05 a RN-SEG-07).
//  - users: el secreto TOTP cifrado con la clave de la aplicación, y el que se está activando (vence a los 15 minutos).
//  - mfa_recovery_codes: la huella SHA-256 del código cabe entera y «anulado» es una fecha.
//  - Los usuarios de la demostración que venían marcados con el segundo factor activo no tienen secreto guardado: se
//    les apaga la marca (y se anulan sus códigos) para que no queden fuera del sistema; lo activan ellos en Mi cuenta.
//  - Parámetro seg_mfa_enforce (apagado): con él encendido, los roles que exigen segundo factor deben activarlo al ingresar.
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('ALTER TABLE users ADD COLUMN totp_secret_enc text, ADD COLUMN totp_pending_enc text, ADD COLUMN totp_pending_at timestamptz');
        DB::statement('ALTER TABLE mfa_recovery_codes ALTER COLUMN code_hash TYPE varchar(64)');
        DB::statement("ALTER TABLE mfa_recovery_codes ALTER COLUMN voided_at TYPE timestamptz USING nullif(voided_at, '')::timestamptz");
        DB::statement('CREATE INDEX mfa_recovery_codes_vigentes_idx ON mfa_recovery_codes (user_id) WHERE used_at IS NULL AND voided_at IS NULL');

        DB::statement('UPDATE mfa_recovery_codes SET voided_at = now() WHERE voided_at IS NULL AND used_at IS NULL
            AND user_id IN (SELECT id FROM users WHERE twofa_enabled AND totp_secret_enc IS NULL)');
        DB::statement('UPDATE users SET twofa_enabled = false, mfa_enrolled_at = NULL, totp_last_step = NULL WHERE twofa_enabled AND totp_secret_enc IS NULL');

        DB::statement(<<<'SQL'
            INSERT INTO parameter_definitions (key, module_code, value_type, default_value, allowed_scopes, description)
            VALUES ('seg_mfa_enforce', 'SEG', 'BOOL', 'false', '["TENANT"]'::jsonb, 'Exigir el segundo factor a los roles que lo piden')
            ON CONFLICT (key) DO NOTHING
            SQL);
    }

    public function down(): void
    {
        DB::statement("DELETE FROM parameter_definitions WHERE key = 'seg_mfa_enforce'");
        DB::statement('DROP INDEX IF EXISTS mfa_recovery_codes_vigentes_idx');
        DB::statement('ALTER TABLE mfa_recovery_codes ALTER COLUMN voided_at TYPE varchar(20) USING voided_at::text');
        DB::statement('ALTER TABLE mfa_recovery_codes ALTER COLUMN code_hash TYPE varchar(40)');
        DB::statement('ALTER TABLE users DROP COLUMN IF EXISTS totp_pending_at, DROP COLUMN IF EXISTS totp_pending_enc, DROP COLUMN IF EXISTS totp_secret_enc');
    }
};
