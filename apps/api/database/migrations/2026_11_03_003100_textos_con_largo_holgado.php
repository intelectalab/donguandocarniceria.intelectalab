<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

// Corrección del generador: dio a cada columna de texto el largo justo de los datos del prototipo
// (20, 40, 80…), y datos reales más largos (un nombre, una referencia) fallarían. En PostgreSQL un
// varchar(255) no cuesta más que uno de 20: se amplían todas las columnas de texto cortas a 255.
// Lo que de verdad tiene un largo fijo se valida en la regla de negocio, no con el tipo.
return new class extends Migration
{
    public function up(): void
    {
        $columnas = DB::select("SELECT table_name, column_name FROM information_schema.columns
                                 WHERE table_schema = 'public' AND data_type = 'character varying'
                                   AND character_maximum_length < 255
                                   AND table_name NOT IN ('migrations', 'cache', 'cache_locks', 'jobs', 'job_batches', 'failed_jobs')");
        foreach ($columnas as $c) {
            // Comillas: hay columnas con nombres reservados (stock_movements.user).
            DB::statement("ALTER TABLE \"{$c->table_name}\" ALTER COLUMN \"{$c->column_name}\" TYPE varchar(255)");
        }
    }

    public function down(): void
    {
        // No se acortan: los datos que ya existan podrían no caber.
    }
};
