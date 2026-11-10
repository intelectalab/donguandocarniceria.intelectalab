<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// SEG · IP y dispositivo de cada sesión (SEG-07, SEG-09, SEG-15). La sesión es el token de Sanctum;
// se anotan al iniciar sesión. El dispositivo es un resumen («Chrome · Windows»), no el user agent
// completo. Las sesiones abiertas antes de esta migración quedan sin estos datos.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('personal_access_tokens', function (Blueprint $table) {
            $table->string('ip', 40)->nullable();
            $table->string('device', 80)->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('personal_access_tokens', function (Blueprint $table) {
            $table->dropColumn(['ip', 'device']);
        });
    }
};
