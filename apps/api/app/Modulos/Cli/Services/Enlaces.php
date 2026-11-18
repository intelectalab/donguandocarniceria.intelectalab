<?php

namespace App\Modulos\Cli\Services;

use App\Models\User;
use App\Modulos\Cli\Models\Customer;
use App\Support\Events;
use App\Support\Params;
use App\Support\RuleError;
use App\Support\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * CLI-07: enlace de un solo uso para que el cliente marque su pin y escriba la referencia desde su
 * celular. Vence a las cli_location_link_hours horas. Solo un enlace vivo por cliente: generar otro
 * anula el anterior. Se guarda el hash del token; el enlace completo solo se ve al crearlo.
 * El cliente lo abre sin sesión (/u/{token} en la web, /api/v1/publico/ubicacion/{token} en la API).
 */
final class Enlaces
{
    public const ESTADOS = ['PENDING', 'USED', 'EXPIRED', 'CANCELLED'];

    public static function hash(string $token): string
    {
        return hash('sha256', $token);
    }

    /** Estado real: un PENDING vencido se muestra como EXPIRED. */
    public static function estado(object $l): string
    {
        return $l->status === 'PENDING' && now()->greaterThan($l->expires_at) ? 'EXPIRED' : $l->status;
    }

    /** @return array{link: object, token: string, horas: int} */
    public static function crear(Customer $c, User $quien): array
    {
        if ($c->fusionado()) {
            RuleError::fail('RN-CLI-08', "{$c->nombre()} fue fusionado: envía el enlace al sobreviviente.");
        }
        if (! $c->phone) {
            RuleError::fail('RN-CLI-01', 'El cliente no tiene celular para enviarle el enlace.');
        }
        $horas = max(1, (int) (Params::get('cli_location_link_hours') ?? 24));
        $token = Str::random(32);

        return DB::transaction(function () use ($c, $quien, $horas, $token) {
            DB::table('customer_location_links')->where('customer_id', $c->id)->where('status', 'PENDING')
                ->update(['status' => 'CANCELLED', 'updated_at' => now()]);
            $id = DB::table('customer_location_links')->insertGetId([
                'customer_id' => $c->id, 'token_hash' => self::hash($token), 'phone' => $c->phone,
                'expires_at' => now()->addHours($horas), 'status' => 'PENDING', 'sent_via' => 'WHATSAPP', 'created_by' => mb_substr($quien->name, 0, 80),
            ]);
            Events::emit('customer.location_link_created', 'customers', $c->id, ['link_id' => $id, 'hours' => $horas]);

            return ['link' => DB::table('customer_location_links')->find($id), 'token' => $token, 'horas' => $horas];
        });
    }

    /**
     * Lo que ve el cliente al abrir el enlace. Fija la empresa del enlace (no hay sesión).
     *
     * @return array{link: object, cliente: Customer}
     */
    public static function abrir(string $token): array
    {
        $hash = self::hash($token);
        $empresa = DB::selectOne('SELECT cli_link_tenant(?) AS t', [$hash])?->t;
        if (! $empresa) {
            RuleError::fail('RN-CLI-05', 'Este enlace no existe. Pide uno nuevo a quien te atiende.');
        }
        TenantContext::set(TenantContext::find($empresa));
        $l = DB::table('customer_location_links')->where('token_hash', $hash)->first();
        $estado = self::estado($l);
        if ($estado === 'EXPIRED') {
            RuleError::fail('RN-CLI-05', 'El enlace venció. Pide uno nuevo a quien te atiende.');
        }
        if ($estado !== 'PENDING') {
            RuleError::fail('RN-CLI-05', 'Este enlace ya se usó o fue anulado: es de un solo uso. Pide uno nuevo a quien te atiende.');
        }

        return ['link' => $l, 'cliente' => Customer::findOrFail($l->customer_id)];
    }

    /** El cliente envía su ubicación: se guarda la dirección y el enlace queda usado. */
    public static function completar(string $token, array $v): array
    {
        ['link' => $l, 'cliente' => $c] = self::abrir($token);

        return DB::transaction(function () use ($l, $c, $v) {
            // Se toma el enlace antes de guardar: si el cliente envía dos veces a la vez, la segunda
            // espera a la primera, ya no lo encuentra pendiente y no deja una segunda dirección.
            $tomado = DB::table('customer_location_links')->where('id', $l->id)->where('status', 'PENDING')
                ->where('expires_at', '>', now())->update(['status' => 'USED', 'used_at' => now(), 'updated_at' => now()]);
            if ($tomado !== 1) {
                RuleError::fail('RN-CLI-05', 'Este enlace ya se usó o fue anulado: es de un solo uso. Pide uno nuevo a quien te atiende.');
            }
            $r = Direcciones::guardar($c, [
                'label' => 'Enviada por el cliente', 'pin_source' => ! empty($v['gps']) ? 'GPS' : 'LINK', 'geocode_confidence' => 1,
                'address_line' => $v['address_line'] ?? '', 'reference' => $v['reference'] ?? '', 'district' => $v['district'] ?? '',
                'lat' => $v['lat'] ?? null, 'lng' => $v['lng'] ?? null, 'contact_name' => $v['contact_name'] ?? null,
            ]);
            DB::table('customer_location_links')->where('id', $l->id)->update(['address_id' => $r['direccion']->id]);
            Events::emit('customer.location_received', 'customers', $c->id, ['link_id' => $l->id, 'address_id' => $r['direccion']->id, 'zone' => $r['zona']['code'] ?? null]);
            // Aviso a su vendedora (o a todas, si no tiene una asignada).
            DB::table('notifications')->insert([
                'user_id' => $c->seller_user_id, 'role' => $c->seller_user_id ? null : 'VENDEDORA', 'module' => 'CLI', 'tone' => 'ok', 'at' => now(),
                'title' => "Ubicación recibida de {$c->nombre()}",
                'body' => $r['direccion']->address_line.' · '.($r['zona']['name'] ?? 'fuera de cobertura'),
                'ref' => json_encode(['href' => "/m/cli/cli-05?id={$c->id}"]),
            ]);

            return $r;
        });
    }
}
