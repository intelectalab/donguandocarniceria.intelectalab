<?php

namespace Tests;

use App\Support\Access;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use Illuminate\Support\Facades\Artisan;

/**
 * Las pruebas corren contra Postgres (aycha_test) porque RLS es parte de lo que se prueba.
 * La base se migra y se siembra una vez por corrida con el dueño (pgsql_owner); cada prueba
 * entra como aycha_app dentro de una transacción que se deshace al terminar.
 */
abstract class TestCase extends BaseTestCase
{
    use DatabaseTransactions;

    private static bool $preparada = false;

    protected array $connectionsToTransact = ['pgsql'];

    protected const DG = 'donguando.localhost';
    protected const CS = 'cs.localhost';
    protected const CLAVE = 'DonGuando2026';

    protected function setUp(): void
    {
        parent::setUp();
        if (! self::$preparada) {
            Artisan::call('migrate:fresh', ['--database' => 'pgsql_owner', '--seed' => true, '--force' => true]);
            self::$preparada = true;
        }
        Access::forget();
        TenantContext::set(null);
        config(['aycha.tenant_por_dominio' => false]);
    }

    /** Petición a la API desde el dominio de una empresa (en modo general la API lo ignora). */
    protected function desde(string $host, ?string $token = null): static
    {
        $this->app['auth']->forgetGuards();
        // withHeaders acumula: sin esto, el token de una petición anterior viajaría en la siguiente.
        $this->flushHeaders();
        $headers = ['X-Tenant-Host' => $host, 'Accept' => 'application/json'];

        return $this->withHeaders($token ? $headers + ['Authorization' => "Bearer {$token}"] : $headers);
    }

    protected function ingresar(string $host, string $email, string $clave = self::CLAVE): string
    {
        return $this->desde($host)->postJson('/api/v1/auth/login', ['email' => $email, 'password' => $clave])
            ->assertOk()->json('token');
    }
}
