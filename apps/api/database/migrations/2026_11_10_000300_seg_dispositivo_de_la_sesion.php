<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// SEG · dispositivo registrado desde el que se abrió cada sesión (RN-SEG-11): revocar el dispositivo
// cierra sus sesiones al instante. Solo lo llena el ingreso desde la app móvil; las sesiones del
// navegador quedan sin dispositivo registrado.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('personal_access_tokens', function (Blueprint $table) {
            $table->uuid('device_id')->nullable();
            $table->foreign('device_id')->references('id')->on('user_devices')->nullOnDelete();
            $table->index('device_id');
        });
    }

    public function down(): void
    {
        Schema::table('personal_access_tokens', function (Blueprint $table) {
            $table->dropForeign(['device_id']);
            $table->dropIndex(['device_id']);
            $table->dropColumn('device_id');
        });
    }
};
