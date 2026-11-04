<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

// Relaciones que el generador dejó obligatorias porque en el prototipo siempre tenían valor, pero
// que en el negocio pueden faltar:
//  - ad_accounts.connector_id: una cuenta de anuncios existe antes de conectarla a su plataforma.
//  - tel_recordings.file_id: el audio se purga al vencer su retención (tel_purge_recordings) y la
//    grabación queda como registro.
return new class extends Migration
{
    private array $columnas = ['ad_accounts.connector_id', 'tel_recordings.file_id'];

    public function up(): void
    {
        foreach ($this->columnas as $col) {
            [$tabla, $columna] = explode('.', $col);
            DB::statement("ALTER TABLE {$tabla} ALTER COLUMN {$columna} DROP NOT NULL");
        }
    }

    public function down(): void
    {
        foreach ($this->columnas as $col) {
            [$tabla, $columna] = explode('.', $col);
            DB::statement("ALTER TABLE {$tabla} ALTER COLUMN {$columna} SET NOT NULL");
        }
    }
};
