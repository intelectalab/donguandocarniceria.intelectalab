<?php

namespace App\Modulos\Crm\Services;

use App\Models\User;
use App\Support\Events;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * Consentimiento de marketing (RN-CRM-08 y 21, Ley 29733): nunca se presume; se registra con evidencia (un mensaje del
 * cliente o un texto) y vale el último registro del cliente o del contacto. Solo se agregan registros: el historial queda.
 * La pantalla completa de consentimientos y avisos es CRM-18 (tanda 5).
 */
class Consentimientos
{
    /** true = otorgado, false = dio de baja, null = sin registro. */
    public static function marketing(?string $cliente, ?string $contacto): ?bool
    {
        if (! $cliente && ! $contacto) {
            return null;
        }
        $v = DB::table('contact_consents')->where('purpose', 'MARKETING')
            ->where(fn ($q) => $q->when($cliente, fn ($w) => $w->where('customer_id', $cliente))->when($contacto, fn ($w) => $w->orWhere('contact_id', $contacto)))
            ->orderByDesc('recorded_at')->orderByDesc('created_at')->value('granted');

        return $v === null ? null : (bool) $v;
    }

    /** Registra el «sí» o la baja de marketing desde la conversación, con la evidencia. */
    public static function registrarMarketing(string $conversacion, bool $otorgado, string $evidencia, ?string $mensaje, User $u): array
    {
        $cv = Conversaciones::visible($conversacion, $u);
        if (mb_strlen(trim($evidencia)) < 5) {
            RuleError::fail('RN-CRM-08', 'Indica la evidencia: qué dijo el cliente y dónde (al menos 5 caracteres).');
        }
        if ($mensaje && ! DB::table('conversation_messages')->where('id', $mensaje)->where('conversation_id', $cv->id)->where('direction', 'IN')->exists()) {
            RuleError::fail('RN-CRM-08', 'La evidencia debe ser un mensaje del cliente en esta conversación.');
        }
        $ch = DB::table('messaging_channels')->where('id', $cv->channel_id)->first(['kind', 'brand_id']);
        $id = DB::table('contact_consents')->insertGetId(['customer_id' => $cv->customer_id, 'contact_id' => $cv->contact_id, 'purpose' => 'MARKETING', 'granted' => $otorgado,
            'channel' => $ch->kind, 'evidence_message_id' => $mensaje, 'evidence_text' => mb_substr(trim($evidencia), 0, 500), 'recorded_at' => DB::raw('clock_timestamp()'), 'brand_id' => $ch->brand_id,
            'recorded_by' => mb_substr($u->name, 0, 120), 'source' => 'AGENT', 'created_at' => now()], 'id');
        Events::emit($otorgado ? 'consent.granted' : 'consent.revoked', 'contact_consents', $id, ['purpose' => 'MARKETING', 'by' => $u->id]);

        return Conversaciones::ver($conversacion, $u);
    }
}
