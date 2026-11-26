<?php

namespace App\Modulos\Canales\Mensajes;

/**
 * Envío de un mensaje de plantilla de WhatsApp (recordatorios de cobranza de B2B y campañas de CMP).
 * CRM, cuando conecte al proveedor oficial, registra su implementación:
 *   $this->app->bind(EnviadorWhatsapp::class, EnviadorCrm::class);
 * Mientras tanto se usa MensajeEnCola: deja el mensaje en messages con estado QUEUED para que CRM lo envíe.
 */
interface EnviadorWhatsapp
{
    /**
     * @param  array{customer_id: string, brand_id?: ?string, channel_id?: ?string, kind: string, template: string, text: string, ref?: ?string, cost?: float}  $m
     * @return array{message_id: string, status: string, provider_message_id: ?string}
     */
    public function enviar(array $m): array;
}
