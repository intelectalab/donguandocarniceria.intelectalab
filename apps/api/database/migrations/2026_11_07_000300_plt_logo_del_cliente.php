<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// PLT-06 (pestaña General): el logo del cliente, el que sale en el ingreso y en el menú. Va en una
// tabla propia con RLS, y no en tenants: la app solo lee tenants y así debe seguir, para que un
// error nunca cambie el plan o el estado de otro cliente. Una fila por cliente.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('tenant_branding', function (Blueprint $table) {
            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'))->primary();
            $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete();
            // Nombre del archivo en el disco privado (logo.png); la imagen se sirve con /v1/tenant/logo.
            $table->string('logo_url', 60)->nullable();
            $table->string('changed_by', 255)->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->nullable();
        });
        DB::statement("SELECT enable_tenant_rls('tenant_branding')");
        DB::statement("SELECT audit.track('tenant_branding')");
    }

    public function down(): void
    {
        Schema::dropIfExists('tenant_branding');
    }
};
