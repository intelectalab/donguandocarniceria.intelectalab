<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

// OPS · dominios de correo permitidos para las cuentas de la consola: antes fijo en el código (intelectalab.com);
// ahora un parámetro de plataforma que se cambia en OPS-16 con motivo. Vacío = se acepta cualquier correo.
return new class extends Migration
{
    public function up(): void
    {
        DB::table('platform_parameters')->insertOrIgnore([
            'key' => 'ops_platform_email_domains', 'value' => json_encode(['intelectalab.com']),
            'description' => 'Dominios de correo permitidos para las cuentas de la consola; vacío acepta cualquier correo', 'updated_at' => now(),
        ]);
    }

    public function down(): void
    {
        DB::table('platform_parameters')->where('key', 'ops_platform_email_domains')->delete();
    }
};
