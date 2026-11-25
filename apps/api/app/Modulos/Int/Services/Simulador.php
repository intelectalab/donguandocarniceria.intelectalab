<?php

namespace App\Modulos\Int\Services;

use App\Models\User;
use App\Support\Events;
use App\Support\RuleError;
use App\Support\TenantContext;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * INT-13 Simulador de integraciones: solo en prueba. Dispara webhooks de ejemplo firmados contra los endpoints de los
 * conectores de prueba (adaptador falso, sin internet, RN-INT-01) y muestra la respuesta y el efecto. Pasa por el mismo
 * receptor que los webhooks reales (Webhooks::recibir), así que valida firma, repetidos y módulo apagado igual.
 *
 * Si el endpoint de prueba no tiene secreto de firma, el simulador le genera uno al azar (es de prueba: nadie más lo
 * necesita) y lo deja registrado en la bitácora.
 */
final class Simulador
{
    /** Ejemplo => [nombre, proveedor del conector]. */
    public const EJEMPLOS = [
        'MP' => ['Pago aprobado de Mercado Pago', 'MERCADOPAGO'],
        'WA' => ['Mensaje entrante de WhatsApp', 'WHATSAPP_CLOUD'],
        'WOO' => ['Pedido de WooCommerce', 'WOOCOMMERCE'],
    ];

    /**
     * Solo existe en los ambientes de prueba y desarrollo (pendientes.md: «Oculto en producción»). En producción la API
     * lo rechaza y la web lo saca del menú (MeController: pantallas_ocultas).
     */
    public static function disponible(): bool
    {
        return ! app()->environment('production');
    }

    public static function opciones(): array
    {
        return collect(self::EJEMPLOS)->map(function ($e, $k) {
            $ep = self::endpoint($e[1]);

            return ['code' => $k, 'name' => $e[0], 'endpoint' => $ep?->name, 'disponible' => (bool) $ep, 'con_secreto' => $ep && str_starts_with((string) $ep->secret_enc, 'enc:v2:')];
        })->values()->all();
    }

    /**
     * @return array{respuestas: list<array{envio: int, http: int, status: string, duplicate: bool}>, evento: ?array, cuerpo: string, firma: string, endpoint: string}
     */
    public static function disparar(string $ejemplo, bool $firmaInvalida, int $veces, User $quien): array
    {
        [, $proveedor] = self::EJEMPLOS[$ejemplo] ?? RuleError::fail('RN-INT-01', 'Ese ejemplo no existe.');
        $ep = self::endpoint($proveedor) ?? RuleError::fail('RN-INT-01', 'No hay un endpoint de prueba para '.self::EJEMPLOS[$ejemplo][0].'. El simulador solo dispara contra conectores de prueba.');
        if (! str_starts_with((string) $ep->secret_enc, 'enc:v2:')) {
            DB::table('webhook_endpoints')->where('id', $ep->id)->update(['secret_enc' => 'enc:v2:'.Crypt::encryptString('sim_'.Str::random(40)), 'secret_loaded_at' => now(), 'updated_at' => now()]);
            Events::emit('webhook_endpoint.secret_loaded', 'webhook_endpoints', $ep->id, ['by' => $quien->id, 'name' => $ep->name, 'value' => 'generado por el simulador']);
            $ep = DB::table('webhook_endpoints')->where('id', $ep->id)->first();
        }
        $cuerpo = json_encode(self::cuerpo($ejemplo), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $firma = $firmaInvalida ? 'sha256='.str_repeat('0', 64) : 'sha256='.hash_hmac('sha256', $cuerpo, Crypt::decryptString(substr($ep->secret_enc, 7)));
        $cabeceras = ['content-type' => ['application/json'], 'x-signature' => [$firma], 'user-agent' => ['Simulador de GestionCarnica']];

        $empresa = TenantContext::tenant();
        $respuestas = [];
        try {
            for ($i = 1; $i <= $veces; $i++) {
                [$http, $r] = Webhooks::recibir($ep->token, $cuerpo, $cabeceras, '127.0.0.1', microtime(true));
                $respuestas[] = ['envio' => $i, 'http' => $http, 'status' => $r['status'], 'duplicate' => (bool) ($r['duplicate'] ?? false)];
            }
        } finally {
            // El receptor fija la empresa como lo haría una petición sin sesión: se vuelve a la sesión de quien simula.
            TenantContext::set($empresa);
            TenantContext::setUser($quien->id);
        }
        $ev = DB::table('webhook_events')->where('endpoint_id', $ep->id)->where('body', $cuerpo)->orderByDesc('received_at')->value('id');
        Events::emit('integration.simulated', 'webhook_endpoints', $ep->id, ['by' => $quien->id, 'ejemplo' => $ejemplo, 'veces' => $veces, 'firma_invalida' => $firmaInvalida]);

        return ['respuestas' => $respuestas, 'evento' => $ev ? Webhooks::ver($ev) : null, 'cuerpo' => $cuerpo, 'firma' => $firma, 'endpoint' => $ep->name];
    }

    /** El endpoint activo de un conector de prueba del proveedor. */
    private static function endpoint(string $proveedor): ?object
    {
        return DB::table('webhook_endpoints as e')->join('integration_connectors as c', 'c.id', '=', 'e.connector_id')
            ->where('c.provider', $proveedor)->where('c.environment', 'SANDBOX')->where('e.status', 'ACTIVE')->orderBy('e.name')->first(['e.*']);
    }

    /** Cuerpos de ejemplo con la forma que manda cada proveedor (datos inventados, ids únicos). */
    private static function cuerpo(string $ejemplo): array
    {
        $n = random_int(100000, 999999);
        $pedido = DB::table('sales_orders')->where('channel', 'WEB')->orderByDesc('created_at')->value('number') ?? 'P-000001';
        $cliente = DB::table('customers')->whereNotNull('phone')->where('status', 'ACTIVE')->orderBy('full_name')->first(['full_name', 'phone']);
        $telefono = $cliente->phone ?? '+51999000000';

        return match ($ejemplo) {
            'MP' => ['id' => (string) (1330000000 + $n), 'type' => 'payment', 'action' => 'payment.updated', 'live_mode' => false,
                'data' => ['id' => (string) (1330000000 + $n), 'status' => 'approved', 'transaction_amount' => 120.0, 'external_reference' => $pedido]],
            'WA' => ['object' => 'whatsapp_business_account', 'entry' => [['id' => 'SBX-'.$n, 'changes' => [['field' => 'messages', 'value' => [
                'messaging_product' => 'whatsapp', 'messages' => [['from' => ltrim($telefono, '+'), 'id' => 'wamid.SBX'.$n, 'type' => 'text',
                    'text' => ['body' => 'Hola, quiero 2 kilos de lomo para mañana']]]]]]]]],
            default => ['id' => 9000 + $n % 1000 + $n, 'number' => (string) (9000 + $n), 'status' => 'processing',
                'billing' => ['first_name' => explode(' ', (string) ($cliente->full_name ?? 'Cliente'))[0], 'phone' => $telefono],
                'line_items' => [['sku' => 'DG-LOM-1K', 'quantity' => 2]], 'customer_note' => 'Dejar en portería', 'payment_method' => 'woo-mercado-pago-basic'],
        };
    }
}
