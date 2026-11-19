<?php

use App\Modulos\Equ\Permisos;
use Illuminate\Database\Migrations\Migration;

/**
 * EQU · permiso propio para registrar horas de uso y lecturas de horómetro (equ.usage.record), para separar
 * mejor los roles: antes bastaba con entrar al módulo. En una base vacía no hace nada: la siembra lo agrega.
 */
return new class extends Migration
{
    public function up(): void
    {
        Permisos::asegurar($this->getConnection());
    }

    public function down(): void
    {
        Permisos::quitar($this->getConnection());
    }
};
