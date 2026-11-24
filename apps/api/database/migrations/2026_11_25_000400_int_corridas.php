<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

// INT-08 Corridas programadas: el resultado solo puede ser completada, parcial o fallida; los contadores nunca son
// negativos, y un índice por proceso y fecha para la lista y para contar las fallas del día (RN-MAE-14).
return new class extends Migration
{
    public function up(): void
    {
        DB::statement("ALTER TABLE integration_runs ADD CONSTRAINT integration_runs_estado CHECK (status IN ('COMPLETED','PARTIAL','FAILED'))");
        DB::statement('ALTER TABLE integration_runs ADD CONSTRAINT integration_runs_items CHECK (items_ok >= 0 AND items_failed >= 0)');
        DB::statement('CREATE INDEX integration_runs_proceso_idx ON integration_runs (job, started_at)');
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS integration_runs_proceso_idx');
        DB::statement('ALTER TABLE integration_runs DROP CONSTRAINT IF EXISTS integration_runs_items, DROP CONSTRAINT IF EXISTS integration_runs_estado');
    }
};
