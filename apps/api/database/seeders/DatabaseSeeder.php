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
        $this->call(AlmDemoSeeder::class);
    }
}
