<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Relaciones entre módulos cuyo destino se crea en una migración posterior a la de su tabla.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('purchase_receipts', function (Blueprint $table) { $table->foreign('farm_dispatch_id')->references('id')->on('farm_dispatches')->restrictOnDelete(); $table->index('farm_dispatch_id'); });
        Schema::table('purchase_documents', function (Blueprint $table) { $table->foreign('farm_dispatch_id')->references('id')->on('farm_dispatches')->restrictOnDelete(); $table->index('farm_dispatch_id'); });
    }

    public function down(): void
    {
        Schema::table('purchase_receipts', fn (Blueprint $table) => $table->dropForeign(['farm_dispatch_id']));
        Schema::table('purchase_documents', fn (Blueprint $table) => $table->dropForeign(['farm_dispatch_id']));
    }
};
