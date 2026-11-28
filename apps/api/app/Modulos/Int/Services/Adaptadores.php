<?php

namespace App\Modulos\Int\Services;

/**
 * RN-INT-01: todo proveedor externo se usa a través de su interfaz, y cada interfaz tiene un adaptador falso que solo
 * existe en el entorno de prueba (SANDBOX), nunca en producción.
 *
 * Los adaptadores reales (WhatsApp Cloud, OSE, Mercado Pago…) se van instalando con cada módulo que los usa (CRM, FAC,
 * CAJ…). Hasta entonces «Probar conexión» en producción dice que el adaptador no está instalado y no lo cuenta como
 * falla, para que el conector no pase a «En error» por algo que no depende del proveedor.
 */
final class Adaptadores
{
    /** Tipo de conector => [nombre, interfaz]. */
    public const TIPOS = [
        'MESSAGING' => ['Mensajería', 'MessagingProvider'], 'EINVOICE' => ['Comprobantes (OSE o PSE)', 'EInvoiceProvider'],
        'PAYMENTS' => ['Pagos', 'PaymentGateway'], 'ADS' => ['Anuncios', 'AdsProvider'], 'TELEPHONY' => ['Telefonía', 'TelephonyProvider'],
        'MAPS' => ['Mapas', 'MapsProvider'], 'COMMERCE' => ['Comercio electrónico', 'CommerceProvider'], 'SCALE' => ['Balanzas', 'ScaleProvider'],
        'DELIVERY' => ['Empresas de delivery', 'DeliveryProvider'], 'GPS' => ['GPS de flota', 'TrackingProvider'], 'FARM' => ['Granja', 'FarmProvider'],
        'HR' => ['Personal (Ayni HR)', 'HrProvider'], 'EMAIL' => ['Correo', 'EmailProvider'], 'PUSH' => ['Notificaciones push', 'PushProvider'],
        'FX' => ['Tipo de cambio', 'FxProvider'],
    ];

    /** Adaptador real => nombre para la pantalla. */
    public const REALES = [
        'WhatsAppCloudAdapter' => 'WhatsApp Cloud API (oficial)', 'OsePseAdapter' => 'OSE o PSE de SUNAT', 'MercadoPagoAdapter' => 'Mercado Pago',
        'AdsApiAdapter' => 'API de anuncios (Meta, Google o TikTok)', 'TwilioAdapter' => 'Twilio', 'GoogleMapsAdapter' => 'Google Maps',
        'WooCommerceRestAdapter' => 'WooCommerce', 'SerialScaleAdapter' => 'Balanza por puerto serie', 'DeliveryCompanyAdapter' => 'Empresa de delivery',
        'GpsTrackerAdapter' => 'Rastreador GPS', 'GranjaApiAdapter' => 'API de la granja', 'AyniHrAdapter' => 'Ayni HR', 'SmtpAdapter' => 'Correo SMTP',
        'FcmAdapter' => 'Firebase (push)', 'SunatFxAdapter' => 'Tipo de cambio de SUNAT',
    ];

    /**
     * Adaptadores reales ya instalados en el sistema: clase que implementa probar(object $conector): array{ok: bool, error?: string}.
     * Cada módulo agrega aquí el suyo cuando lo construye.
     */
    private const INSTALADOS = [
        'WooCommerceRestAdapter' => \App\Modulos\Web\Services\Proveedores\WooCommerce::class,
        'MercadoPagoAdapter' => \App\Modulos\Web\Services\Proveedores\MercadoPago::class,
    ];

    public static function nombreTipo(string $tipo): string
    {
        return self::TIPOS[$tipo][0] ?? $tipo;
    }

    public static function nombreAdaptador(object $c): string
    {
        return $c->adapter === 'FAKE' ? 'Falso de prueba (sin internet)' : (self::REALES[$c->adapter] ?? $c->adapter);
    }

    /**
     * Envía un mensaje saliente por el adaptador del conector, con su clave de idempotencia (RN-INT-11: el proveedor
     * que la admite no duplica el efecto en un reintento).
     *
     * @return array{ok: bool, ref: ?string, error: ?string, del_proveedor: bool} del_proveedor = la falla es del proveedor (cuenta para RN-INT-19)
     */
    /** ¿El conector puede enviar de verdad? (falso o de prueba, o con su adaptador instalado). */
    public static function puedeEnviar(object $c): bool
    {
        return $c->environment === 'SANDBOX' || $c->adapter === 'FAKE' || (isset(self::INSTALADOS[$c->adapter]) && method_exists(self::INSTALADOS[$c->adapter], 'enviar'));
    }

    public static function enviar(object $c, object $m): array
    {
        if ($c->environment === 'SANDBOX' || $c->adapter === 'FAKE') {
            if ($c->simulate_down) {
                return ['ok' => false, 'ref' => null, 'error' => 'HTTP 503 Service Unavailable: el proveedor no respondió', 'del_proveedor' => true];
            }

            return ['ok' => true, 'ref' => 'FAKE-'.substr(hash('sha256', $m->idempotency_key), 0, 16), 'error' => null, 'del_proveedor' => false];
        }
        $clase = self::INSTALADOS[$c->adapter] ?? null;
        if (! $clase || ! method_exists($clase, 'enviar')) {
            return ['ok' => false, 'ref' => null, 'del_proveedor' => false,
                'error' => 'El adaptador de '.self::nombreAdaptador($c).' todavía no está instalado: el mensaje no puede salir.'];
        }
        $r = (new $clase)->enviar($c, $m);

        return ['ok' => (bool) $r['ok'], 'ref' => $r['ref'] ?? null, 'error' => $r['ok'] ? null : mb_substr((string) ($r['error'] ?? 'Error del proveedor'), 0, 255), 'del_proveedor' => ! $r['ok']];
    }

    /**
     * Prueba la conexión con el adaptador del conector.
     *
     * @return array{ok: ?bool, mensaje: string, latencia: ?int, error: ?string} ok = null cuando no hay con qué probar
     */
    public static function probar(object $c): array
    {
        $inicio = hrtime(true);
        if ($c->environment === 'SANDBOX' || $c->adapter === 'FAKE') {
            // El falso responde al instante; «simular caída» lo hace fallar como si el proveedor no respondiera.
            if ($c->simulate_down) {
                return ['ok' => false, 'mensaje' => 'El proveedor no respondió (HTTP 503).', 'latencia' => null, 'error' => 'HTTP 503 Service Unavailable: el proveedor no respondió'];
            }
            $ms = max(1, (int) round((hrtime(true) - $inicio) / 1e6));

            return ['ok' => true, 'mensaje' => "Conexión correcta con el adaptador falso de prueba en {$ms} ms.", 'latencia' => $ms, 'error' => null];
        }
        $clase = self::INSTALADOS[$c->adapter] ?? null;
        if (! $clase) {
            return ['ok' => null, 'latencia' => null, 'error' => null,
                'mensaje' => 'El adaptador de '.self::nombreAdaptador($c).' todavía no está instalado en el sistema: se conectará cuando el módulo que lo usa lo incorpore. No se cuenta como falla.'];
        }
        $r = (new $clase)->probar($c);
        $ms = max(1, (int) round((hrtime(true) - $inicio) / 1e6));

        return ['ok' => (bool) $r['ok'], 'latencia' => $ms, 'error' => $r['ok'] ? null : mb_substr((string) ($r['error'] ?? 'Error del proveedor'), 0, 255),
            'mensaje' => $r['ok'] ? 'Conexión correcta con '.self::nombreAdaptador($c)." en {$ms} ms." : 'No se pudo conectar: '.($r['error'] ?? 'error del proveedor').'.'];
    }
}
