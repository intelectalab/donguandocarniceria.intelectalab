<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// PLT-03 y PLT-04: un RUC no se repite dentro de la empresa cliente (RN-PLT-13) y el código de
// establecimiento anexo SUNAT no se repite dentro de una misma empresa (RN-PLT-04).
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('companies', fn (Blueprint $t) => $t->unique(['tenant_id', 'ruc']));
        Schema::table('establishments', fn (Blueprint $t) => $t->unique(['company_id', 'sunat_code']));
    }

    public function down(): void
    {
        Schema::table('companies', fn (Blueprint $t) => $t->dropUnique(['tenant_id', 'ruc']));
        Schema::table('establishments', fn (Blueprint $t) => $t->dropUnique(['company_id', 'sunat_code']));
    }
};
