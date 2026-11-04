<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

// SEG · el generador tomó el largo de estas columnas de los hashes de demo del prototipo (8 a 14
// caracteres). Un hash real (bcrypt/argon, sha256 en hex) necesita más: se amplían a 255.
return new class extends Migration
{
    private array $columnas = [
        'password_history' => 'password_hash',
        'password_reset_tokens' => 'token_hash',
        'mfa_recovery_codes' => 'code_hash',
        'user_sessions' => 'token_hash',
        'user_devices' => 'fingerprint_hash',
    ];

    public function up(): void
    {
        foreach ($this->columnas as $tabla => $columna) {
            DB::statement("ALTER TABLE {$tabla} ALTER COLUMN {$columna} TYPE varchar(255)");
        }
    }

    public function down(): void
    {
        // No se acortan: los hashes reales no cabrían.
    }
};
