<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

// AUD-05 Exportaciones (RN-AUD-05, RN-AUD-06).
//  - Dónde quedó el archivo generado (disco privado) y nombres que caben enteros.
//  - El estado solo puede ser por aprobar, lista, rechazada o vencida; el número no se repite en la empresa.
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('ALTER TABLE data_exports ADD COLUMN storage_key text');
        DB::statement('ALTER TABLE data_exports ALTER COLUMN requested_by TYPE varchar(120), ALTER COLUMN approved_by TYPE varchar(120), ALTER COLUMN rejected_by TYPE varchar(120),
            ALTER COLUMN file_name TYPE varchar(120), ALTER COLUMN reject_reason TYPE varchar(300), ALTER COLUMN reason TYPE varchar(300)');
        DB::statement("ALTER TABLE data_exports ADD CONSTRAINT data_exports_estado CHECK (status IN ('PENDING_APPROVAL','READY','REJECTED','EXPIRED'))");
        DB::statement('CREATE UNIQUE INDEX data_exports_numero ON data_exports (tenant_id, number)');
        DB::statement('CREATE INDEX data_exports_estado_idx ON data_exports (status, requested_at)');
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS data_exports_estado_idx');
        DB::statement('DROP INDEX IF EXISTS data_exports_numero');
        DB::statement('ALTER TABLE data_exports DROP CONSTRAINT IF EXISTS data_exports_estado');
        DB::statement('ALTER TABLE data_exports DROP COLUMN IF EXISTS storage_key');
    }
};
