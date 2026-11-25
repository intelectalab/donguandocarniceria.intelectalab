<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

// TEL-06 Teléfono en la app y TEL-07 Llamar desde la ficha o el pedido (RN-TEL-04 a 08).
//  - Llamadas: dirección y estado válidos, el identificador del proveedor no se repite, la opción del menú es un
//    dígito; no se borran.
//  - Grabaciones: una por llamada, disponible o purgada; no se borran.
//  - Tareas de CRM: la de devolver una llamada perdida queda unida a su llamada, y hay una sola abierta por llamada
//    (RN-TEL-07).
return new class extends Migration
{
    public function up(): void
    {
        DB::statement("ALTER TABLE tel_calls ADD CONSTRAINT tel_calls_direccion CHECK (direction IN ('INBOUND','OUTBOUND'))");
        DB::statement("ALTER TABLE tel_calls ADD CONSTRAINT tel_calls_estado CHECK (status IN ('RINGING','IN_PROGRESS','COMPLETED','MISSED','VOICEMAIL','FAILED','BUSY','NO_ANSWER'))");
        DB::statement('ALTER TABLE tel_calls ADD CONSTRAINT tel_calls_opcion CHECK (menu_option IS NULL OR menu_option BETWEEN 1 AND 9)');
        DB::statement('ALTER TABLE tel_calls ADD CONSTRAINT tel_calls_tiempos CHECK (coalesce(wait_seconds, 0) >= 0 AND coalesce(duration_seconds, 0) >= 0)');
        DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS tel_calls_proveedor ON tel_calls (tenant_id, provider_call_id)');
        DB::statement('CREATE INDEX IF NOT EXISTS tel_calls_historial ON tel_calls (started_at DESC)');
        DB::statement('CREATE INDEX IF NOT EXISTS tel_calls_numero_cliente ON tel_calls (from_e164)');
        DB::statement('REVOKE DELETE, TRUNCATE ON tel_calls FROM aycha_app');

        DB::statement("ALTER TABLE tel_recordings ADD CONSTRAINT tel_recordings_estado CHECK (status IN ('AVAILABLE','PURGED'))");
        DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS tel_recordings_llamada ON tel_recordings (call_id)');
        DB::statement('REVOKE DELETE, TRUNCATE ON tel_recordings FROM aycha_app');

        DB::statement('ALTER TABLE crm_tasks ADD COLUMN IF NOT EXISTS call_id uuid REFERENCES tel_calls (id) ON DELETE RESTRICT');
        DB::statement("CREATE UNIQUE INDEX IF NOT EXISTS crm_tasks_una_por_llamada ON crm_tasks (call_id) WHERE call_id IS NOT NULL AND status = 'OPEN'");
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS crm_tasks_una_por_llamada');
        DB::statement('ALTER TABLE crm_tasks DROP COLUMN IF EXISTS call_id');
        DB::statement('GRANT DELETE ON tel_recordings TO aycha_app');
        DB::statement('DROP INDEX IF EXISTS tel_recordings_llamada');
        DB::statement('ALTER TABLE tel_recordings DROP CONSTRAINT IF EXISTS tel_recordings_estado');
        DB::statement('GRANT DELETE ON tel_calls TO aycha_app');
        foreach (['tel_calls_numero_cliente', 'tel_calls_historial', 'tel_calls_proveedor'] as $i) {
            DB::statement("DROP INDEX IF EXISTS {$i}");
        }
        foreach (['tiempos', 'opcion', 'estado', 'direccion'] as $c) {
            DB::statement("ALTER TABLE tel_calls DROP CONSTRAINT IF EXISTS tel_calls_{$c}");
        }
    }
};
