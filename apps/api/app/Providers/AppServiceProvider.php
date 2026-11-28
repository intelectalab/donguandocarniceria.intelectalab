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
        // MAE · RN-MAE-14: fuente del tipo de cambio. El conector real (SUNAT) llega con INT; hasta entonces se carga a mano.
        $this->app->bind(\App\Modulos\Mae\Services\TipoCambio\FuenteTipoCambio::class, \App\Modulos\Mae\Services\TipoCambio\SinConector::class);
        // FAC · GRE electrónica para las transferencias entre locales de ALM.
        $this->app->bind(\App\Modulos\Alm\Services\Guias\EmisorGuiaRemision::class, \App\Modulos\Fac\Services\GuiaElectronicaFac::class);
    }

    public function boot(): void
    {
        Sanctum::usePersonalAccessTokenModel(PersonalAccessToken::class);
        // CRM instala en INT el procesador de los webhooks de WhatsApp y lo que pasa cuando el proveedor acepta un mensaje.
        \App\Modulos\Int\Services\Webhooks::$procesadores['WHATSAPP_CLOUD'] = [\App\Modulos\Crm\Services\Recepcion::class, 'webhookWhatsApp'];
        \App\Modulos\Int\Services\Salientes::$alEnviar['CRM'] = [\App\Modulos\Crm\Services\Mensajes::class, 'aceptado'];
        // WEB instala en INT los procesadores de WooCommerce y Mercado Pago y las corridas de catálogo y stock.
        \App\Modulos\Web\Services\Procesadores::instalar();
        // RN-SEG-09: una sesión sin uso por más del límite se cierra (antes de anotar este uso).
        Sanctum::authenticateAccessTokensUsing(function (PersonalAccessToken $token, bool $valido) {
            if (! $valido) {
                // Vencida por su duración: se archiva como vencida y se borra.
                if ($token->expires_at?->isPast()) {
                    Sesiones::cerrando('EXPIRED', 'Venció por duración', fn () => $token->delete(), $token->expires_at);
                }

                return false;
            }

            return Sesiones::vigente($token);
        });
    }
}
