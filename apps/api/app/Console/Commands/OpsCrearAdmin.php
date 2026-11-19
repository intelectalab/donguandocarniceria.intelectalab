<?php

namespace App\Console\Commands;

use App\Modulos\Ops\Services\UsuariosPlataforma;
use App\Support\RuleError;
use Illuminate\Console\Command;

/**
 * Crea la primera cuenta de la consola de Intelectalab (administrador de plataforma) e imprime su código de
 * activación. Solo funciona si no hay ningún administrador activo; después, las cuentas se crean en OPS-12.
 *   php artisan ops:crear-admin nombre@intelectalab.com "Nombre Apellido"
 * Con un correo de otro dominio, --agregar-dominio lo suma a los permitidos (ops_platform_email_domains).
 */
class OpsCrearAdmin extends Command
{
    protected $signature = 'ops:crear-admin {email} {nombre} {--agregar-dominio : Agrega el dominio del correo a los permitidos si no está}';

    protected $description = 'Crea la primera cuenta de la consola de plataforma y muestra su código de activación';

    public function handle(): int
    {
        try {
            $codigo = UsuariosPlataforma::primeraCuenta($this->argument('email'), $this->argument('nombre'), (bool) $this->option('agregar-dominio'));
        } catch (RuleError $e) {
            $this->error($e->getMessage());
            if ($e->rule === 'RN-OPS-01' && str_contains($e->getMessage(), 'dominio')) {
                $this->line('Si ese correo es correcto, vuelve a correr el comando con --agregar-dominio.');
            }

            return self::FAILURE;
        }
        $this->info('Cuenta creada como invitada. Para activarla, entra a /consola/activar con:');
        $this->line('  Correo: '.mb_strtolower($this->argument('email')));
        $this->line("  Código: {$codigo}  (vence en 48 horas; también se envió por correo)");
        $this->line('Ahí se crea la contraseña y se configura la app autenticadora (segundo factor obligatorio).');

        return self::SUCCESS;
    }
}
