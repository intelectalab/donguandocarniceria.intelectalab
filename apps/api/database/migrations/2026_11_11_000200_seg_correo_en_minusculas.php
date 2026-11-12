<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

// SEG · RN-SEG-01: el correo se guarda en minúsculas y sin espacios. La aplicación ya lo hace; con esta
// restricción la base tampoco acepta otro, así el índice único (empresa, correo) no deja pasar
// «Ana.Torres@…» junto a «ana.torres@…» aunque alguien escriba directo en la tabla.
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('ALTER TABLE users ADD CONSTRAINT users_email_minusculas CHECK (email = lower(btrim(email)))');
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_minusculas');
    }
};
