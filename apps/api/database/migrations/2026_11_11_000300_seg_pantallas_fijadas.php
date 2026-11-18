<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

// SEG · pantallas que cada persona fija con la estrella en el menú («Lo de todos los días»). Se guardan
// en su cuenta, así la siguen en cualquier equipo. Solo códigos de pantalla (PED-02), como máximo 40.
return new class extends Migration
{
    public function up(): void
    {
        DB::statement("ALTER TABLE users ADD COLUMN menu_favs jsonb NOT NULL DEFAULT '[]'::jsonb");
        DB::statement("ALTER TABLE users ADD CONSTRAINT users_menu_favs_lista CHECK (jsonb_typeof(menu_favs) = 'array' AND jsonb_array_length(menu_favs) <= 40)");
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_menu_favs_lista');
        DB::statement('ALTER TABLE users DROP COLUMN IF EXISTS menu_favs');
    }
};
