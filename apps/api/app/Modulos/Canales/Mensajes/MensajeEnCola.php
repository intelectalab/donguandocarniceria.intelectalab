<?php

namespace App\Modulos\Canales\Mensajes;

use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * Respaldo sin envío real: registra el mensaje saliente en messages (estado QUEUED) con el número de
 * WhatsApp de la marca. El costo queda estimado con la tarifa de CRM; CRM lo confirma al enviarlo.
 */
final class MensajeEnCola implements EnviadorWhatsapp
{
    public function enviar(array $m): array
    {
        $canal = $m['channel_id'] ?? DB::table('messaging_channels')->where('kind', 'WHATSAPP')->where('status', 'ACTIVE')
            ->when($m['brand_id'] ?? null, fn ($q, $b) => $q->where('brand_id', $b))->orderBy('number')->value('id')
            ?? DB::table('messaging_channels')->where('kind', 'WHATSAPP')->orderBy('number')->value('id');
        $canal || RuleError::fail('RN-CMP-17', 'La marca no tiene un número de WhatsApp conectado.');
        $id = DB::table('messages')->insertGetId([
            'customer_id' => $m['customer_id'], 'channel_id' => $canal, 'direction' => 'OUT', 'kind' => $m['kind'], 'template' => $m['template'],
            'text' => $m['text'], 'ref' => $m['ref'] ?? null, 'sent_at' => now(), 'status' => 'QUEUED', 'cost' => $m['cost'] ?? 0,
        ], 'id');

        return ['message_id' => $id, 'status' => 'QUEUED', 'provider_message_id' => null];
    }
}
