<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    // Corre con el dueño de las tablas: php artisan db:seed --database=pgsql_owner
    // Cada módulo agrega aquí su seeder de demo, después de la base.
    public function run(): void
    {
        $this->call(PrototipoSeeder::class);
        \App\Modulos\Equ\Permisos::asegurar(); // permisos de EQU que la spec no trae
        \Illuminate\Support\Facades\DB::statement('UPDATE tenants t SET ruc = (SELECT c.ruc FROM companies c WHERE c.tenant_id = t.id ORDER BY c.created_at, c.id LIMIT 1) WHERE t.ruc IS NULL'); // OPS: RUC de cada empresa
        $this->call(AlmDemoSeeder::class);
        $this->call(EquDemoSeeder::class);
        $this->call(CalDemoSeeder::class);
        $this->call(CanalesDemoSeeder::class);
        $this->call(WebDemoSeeder::class);
        $this->call(FloDemoSeeder::class);
        $this->call(PerDemoSeeder::class);
        $this->call(PrsDemoSeeder::class);
        $this->call(TabDemoSeeder::class);
    }
}
