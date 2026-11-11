<?php

namespace App\Providers;

use App\Models\PersonalAccessToken;
use App\Modulos\Seg\Services\Sesiones;
use Illuminate\Support\ServiceProvider;
use Laravel\Sanctum\Sanctum;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        //
    }

    public function boot(): void
    {
        Sanctum::usePersonalAccessTokenModel(PersonalAccessToken::class);
        // RN-SEG-09: una sesión sin uso por más del límite se cierra (antes de anotar este uso).
        Sanctum::authenticateAccessTokensUsing(function (PersonalAccessToken $token, bool $valido) {
            if (! $valido) {
                // Vencida por su duración: se archiva como vencida y se borra.
                if ($token->expires_at?->isPast()) {
                    Sesiones::cerrando('EXPIRED', 'Venció por duración', fn () => $token->delete());
                }

                return false;
            }

            return Sesiones::vigente($token);
        });
    }
}
