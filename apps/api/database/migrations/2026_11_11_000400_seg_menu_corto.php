<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

// SEG · en qué menú dejó la barra lateral cada persona: el corto («Lo de todos los días») o el completo.
// Sin elegir (null) se ve el corto si su puesto tiene lista. Se guarda en la cuenta, como las estrellas.
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('ALTER TABLE users ADD COLUMN menu_corto boolean');
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE users DROP COLUMN IF EXISTS menu_corto');
    }
};
