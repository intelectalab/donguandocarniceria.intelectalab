<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Relaciones entre módulos cuyo destino se crea en una migración posterior a la de su tabla.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('temperature_points', function (Blueprint $table) { $table->foreign('equipment_id')->references('id')->on('equipment')->restrictOnDelete(); $table->index('equipment_id'); });
        Schema::table('nonconformities', function (Blueprint $table) { $table->foreign('equipment_id')->references('id')->on('equipment')->restrictOnDelete(); $table->index('equipment_id'); });
    }

    public function down(): void
    {
        Schema::table('temperature_points', fn (Blueprint $table) => $table->dropForeign(['equipment_id']));
        Schema::table('nonconformities', fn (Blueprint $table) => $table->dropForeign(['equipment_id']));
    }
};
