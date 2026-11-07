<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

// PLT-10 y PLT-11: los valores de los parámetros eran numeric, pero hay parámetros de sí/no, texto,
// hora, lista y JSON (65 de 271). Sus valores por defecto se perdieron al sembrar. Aquí:
// - los valores pasan a texto (5.0000 queda como 5);
// - se recuperan los valores por defecto y las opciones desde los datos del prototipo;
// - un parámetro tiene un solo valor por ámbito;
// - el historial guarda quién cambió (id) y es de solo inserción (RN-PLT-06).
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('ALTER TABLE parameter_definitions ALTER COLUMN default_value TYPE text USING trim_scale(default_value)::text');
        DB::statement('ALTER TABLE parameters ALTER COLUMN value TYPE text USING trim_scale(value)::text');
        DB::statement('ALTER TABLE parameter_history ALTER COLUMN old_value TYPE text USING trim_scale(old_value)::text');
        DB::statement('ALTER TABLE parameter_history ALTER COLUMN new_value TYPE text USING trim_scale(new_value)::text');
        // El primer cambio parte del valor por defecto, que puede no existir.
        DB::statement('ALTER TABLE parameter_history ALTER COLUMN old_value DROP NOT NULL');
        DB::statement('ALTER TABLE parameter_history ADD COLUMN IF NOT EXISTS changed_by_id uuid');

        $this->recuperarDefectos();

        DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS parameters_tenant_key_scope_unique ON parameters (tenant_id, key, scope, scope_id) NULLS NOT DISTINCT');
        DB::statement('REVOKE UPDATE, DELETE, TRUNCATE ON parameter_history FROM aycha_app');
    }

    /** Valores por defecto y opciones que no cabían en numeric, desde el mismo archivo que usa el seeder. */
    private function recuperarDefectos(): void
    {
        $archivo = database_path('seeders/data/prototipo.json.gz');
        if (! is_file($archivo)) {
            return;
        }
        $datos = json_decode(gzdecode(file_get_contents($archivo)), true);
        foreach ($datos['globales']['parameter_definitions'] ?? [] as $d) {
            $v = $d['default_value'] ?? null;
            $texto = match (true) {
                $v === null => null,
                is_bool($v) => $v ? 'true' : 'false',
                is_array($v) => json_encode($v, JSON_UNESCAPED_UNICODE),
                default => (string) $v,
            };
            DB::table('parameter_definitions')->where('key', $d['key'])->whereNull('default_value')->update(['default_value' => $texto]);
            if (! empty($d['options'])) {
                DB::table('parameter_definitions')->where('key', $d['key'])->whereNull('options')
                    ->update(['options' => json_encode($d['options'], JSON_UNESCAPED_UNICODE)]);
            }
        }
    }

    public function down(): void
    {
        DB::statement('GRANT UPDATE, DELETE ON parameter_history TO aycha_app');
        DB::statement('DROP INDEX IF EXISTS parameters_tenant_key_scope_unique');
        DB::statement('ALTER TABLE parameter_history DROP COLUMN IF EXISTS changed_by_id');
        // Lo que no es número no cabe de vuelta en numeric.
        $numero = "'^-?[0-9]+(\\.[0-9]+)?$'";
        DB::statement("DELETE FROM parameters WHERE value !~ {$numero}");
        DB::statement("DELETE FROM parameter_history WHERE new_value !~ {$numero} OR (old_value IS NOT NULL AND old_value !~ {$numero})");
        DB::statement("UPDATE parameter_history SET old_value = new_value WHERE old_value IS NULL");
        DB::statement('ALTER TABLE parameter_history ALTER COLUMN old_value SET NOT NULL');
        DB::statement('ALTER TABLE parameter_history ALTER COLUMN new_value TYPE numeric(14,2) USING new_value::numeric');
        DB::statement('ALTER TABLE parameter_history ALTER COLUMN old_value TYPE numeric(14,2) USING old_value::numeric');
        DB::statement('ALTER TABLE parameters ALTER COLUMN value TYPE numeric(14,2) USING value::numeric');
        DB::statement("ALTER TABLE parameter_definitions ALTER COLUMN default_value TYPE numeric(18,4) USING CASE WHEN default_value ~ {$numero} THEN default_value::numeric END");
    }
};
