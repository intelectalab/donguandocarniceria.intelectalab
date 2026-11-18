<?php

namespace App\Modulos\Plt\Services;

use App\Models\User;
use App\Support\Events;
use App\Support\RuleError;
use App\Support\TenantContext;
use Closure;
use Illuminate\Support\Facades\DB;

/**
 * Dominios de acceso de la empresa (PLT-13, RN-PLT-19). tenant_hostnames es global (sin RLS): el
 * ingreso la consulta antes de saber la empresa. Por eso aquí TODA consulta filtra por la empresa
 * de la sesión, y una empresa solo agrega dominios propios: los de GestionCarnica (*.aycha.pe) los asigna
 * Intelectalab. Un dominio nuevo queda «pendiente de DNS» hasta que su registro TXT pruebe que es
 * de la empresa. Publicarlo en el servidor (Nginx y certificado) lo hace Intelectalab.
 */
final class Dominios
{
    /** Dominios que solo asigna la plataforma. */
    public const DE_LA_PLATAFORMA = ['aycha.pe', 'localhost', 'test'];

    /** Para las pruebas: reemplaza la consulta DNS real. fn (string $host): string[] (los TXT). */
    public static ?Closure $resolverTxt = null;

    public static function deLaEmpresa()
    {
        return DB::table('tenant_hostnames')->where('tenant_id', self::empresa());
    }

    /** Pide un dominio propio: queda pendiente de DNS, con su texto de verificación. */
    public static function agregar(string $hostname, bool $principal, User $quien): object
    {
        $hn = mb_strtolower(trim($hostname));
        if (strlen($hn) > 253 || ! preg_match('/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/', $hn)
            || preg_match('/^[\d.]+$/', $hn)) {
            RuleError::fail('RN-PLT-19', 'Escribe un dominio válido, por ejemplo sistema.donguando.com.');
        }
        if (self::esDeLaPlataforma($hn)) {
            RuleError::fail('RN-PLT-19', 'Los dominios de aycha.pe los asigna Intelectalab: aquí solo se agrega un dominio propio.');
        }
        if (DB::table('tenant_hostnames')->where('hostname', $hn)->exists()) {
            // No se dice de quién es: solo que no está disponible.
            RuleError::fail('RN-PLT-19', "{$hn} ya está registrado: cada dominio identifica a un solo cliente.");
        }

        $id = DB::table('tenant_hostnames')->insertGetId([
            'tenant_id' => self::empresa(), 'hostname' => $hn, 'is_primary' => false, 'status' => 'PENDING_DNS',
            'verify_token' => 'aycha-verify='.bin2hex(random_bytes(10)),
            'created_at' => now(), 'updated_at' => now(),
        ], 'id');
        Events::emit('hostname.requested', 'tenant_hostnames', $id, ['hostname' => $hn, 'primary' => $principal, 'by' => $quien->name]);

        return self::deLaEmpresa()->where('id', $id)->first();
    }

    /**
     * Busca el registro TXT del dominio. Si está, el dominio queda activo y verificado (y principal
     * si se pidió). Si no, sigue pendiente y se dice qué falta.
     */
    public static function verificar(string $id, bool $principal = false): object
    {
        $d = self::deLaEmpresa()->where('id', $id)->first() ?? RuleError::fail('RN-PLT-19', 'Dominio no encontrado.');
        if ($d->status !== 'PENDING_DNS') {
            RuleError::fail('RN-PLT-19', "{$d->hostname} ya está verificado.");
        }
        $txt = self::txt($d->hostname);
        if (! in_array($d->verify_token, $txt, true)) {
            RuleError::fail('RN-PLT-19', "Todavía no se encuentra el registro TXT «{$d->verify_token}» en {$d->hostname}. "
                .'Los cambios de DNS pueden tardar unas horas en verse.');
        }

        return DB::transaction(function () use ($d, $principal) {
            if ($principal) {
                self::deLaEmpresa()->update(['is_primary' => false, 'updated_at' => now()]);
            }
            self::deLaEmpresa()->where('id', $d->id)->update(['status' => 'ACTIVE', 'verified_at' => now(), 'is_primary' => $principal, 'updated_at' => now()]);
            Events::emit('hostname.verified', 'tenant_hostnames', $d->id, ['hostname' => $d->hostname]);

            return self::deLaEmpresa()->where('id', $d->id)->first();
        });
    }

    public static function hacerPrincipal(string $id): void
    {
        $d = self::deLaEmpresa()->where('id', $id)->first() ?? RuleError::fail('RN-PLT-19', 'Dominio no encontrado.');
        if ($d->status !== 'ACTIVE') {
            RuleError::fail('RN-PLT-19', 'Solo un dominio activo puede ser el principal.');
        }
        DB::transaction(function () use ($d) {
            self::deLaEmpresa()->update(['is_primary' => false, 'updated_at' => now()]);
            self::deLaEmpresa()->where('id', $d->id)->update(['is_primary' => true, 'updated_at' => now()]);
        });
    }

    /** Desactiva un dominio que no es el principal, o retira una solicitud pendiente. */
    public static function desactivar(string $id): void
    {
        $d = self::deLaEmpresa()->where('id', $id)->first() ?? RuleError::fail('RN-PLT-19', 'Dominio no encontrado.');
        if ($d->is_primary) {
            RuleError::fail('RN-PLT-19', 'El dominio principal no se desactiva: primero elige otro como principal.');
        }
        if (self::esDeLaPlataforma($d->hostname)) {
            RuleError::fail('RN-PLT-19', "{$d->hostname} lo asignó Intelectalab: no se desactiva desde aquí.");
        }
        self::deLaEmpresa()->where('id', $d->id)->update(['status' => 'INACTIVE', 'updated_at' => now()]);
    }

    public static function esDeLaPlataforma(string $hostname): bool
    {
        foreach (self::DE_LA_PLATAFORMA as $base) {
            if ($hostname === $base || str_ends_with($hostname, ".{$base}")) {
                return true;
            }
        }

        return false;
    }

    private static function empresa(): string
    {
        return TenantContext::id() ?? RuleError::fail('RN-PLT-19', 'Sin cliente en la sesión.');
    }

    /** Registros TXT del dominio (solo consulta DNS; no se conecta al dominio). */
    private static function txt(string $hostname): array
    {
        if (self::$resolverTxt) {
            return (self::$resolverTxt)($hostname);
        }
        $registros = @dns_get_record($hostname, DNS_TXT) ?: [];

        return array_values(array_filter(array_map(fn ($r) => $r['txt'] ?? null, $registros)));
    }
}
