<?php

namespace App\Modulos\Api\Services;

use App\Models\User;
use App\Support\Access;
use App\Support\Events;
use App\Support\Paginas;
use App\Support\Params;
use App\Support\RuleError;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * API-01 Claves, API-02 Crear clave y API-03 Detalle de clave (RN-API-01 a 04 y 10).
 *
 *  - El secreto se muestra una sola vez, al crear la clave; la base guarda el prefijo y su huella SHA-256.
 *  - El prefijo (ak_live_ o ak_test_ y 8 caracteres) es único en la plataforma e identifica a la empresa.
 *  - Toda clave vence (por defecto api_key_default_days, máximo api_key_max_days) y el vencimiento no se extiende.
 *  - Alcances del catálogo, marcas de la empresa (sin marcar: todas), IP o rangos permitidos y cliente B2B opcional.
 *  - Revocar exige motivo y no tiene vuelta; secreto, prefijo, entorno, alcances y marcas no cambian: se crea otra clave.
 */
final class Claves
{
    public const ENTORNOS = ['LIVE' => 'Producción', 'TEST' => 'Pruebas'];

    public const CANALES = ['B2B' => 'Venta a empresas', 'WEB' => 'Tienda web', 'OTHER' => 'Otro'];

    public const ESTADOS = ['ACTIVE' => 'Activa', 'REVOKED' => 'Revocada', 'EXPIRED' => 'Vencida'];

    private const ALFANUM = 'abcdefghijklmnopqrstuvwxyz0123456789';

    private const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

    public static function hoy(): string
    {
        return now('America/Lima')->toDateString();
    }

    public static function diasPorDefecto(): int
    {
        return (int) (Params::get('api_key_default_days') ?? 180);
    }

    public static function diasMaximo(): int
    {
        return (int) (Params::get('api_key_max_days') ?? 365);
    }

    /** ACTIVE, REVOKED o EXPIRED (vencida = el día de vencimiento ya pasó). */
    public static function estado(object $k): string
    {
        return $k->status === 'REVOKED' ? 'REVOKED' : ($k->expires_at < self::hoy() ? 'EXPIRED' : 'ACTIVE');
    }

    private static function azar(int $n, string $alfabeto): string
    {
        $s = '';
        $max = strlen($alfabeto) - 1;
        for ($i = 0; $i < $n; $i++) {
            $s .= $alfabeto[random_int(0, $max)];
        }

        return $s;
    }

    /** IP o rango CIDR IPv4 válido. */
    public static function ipValida(string $ip): bool
    {
        if (! preg_match('#^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(/(\d{1,2}))?$#', $ip, $m)) {
            return false;
        }
        foreach ([1, 2, 3, 4] as $i) {
            if ((int) $m[$i] > 255) {
                return false;
            }
        }

        return ! isset($m[6]) || (int) $m[6] <= 32;
    }

    private static function columnas(): array
    {
        return ['k.*', 'cu.full_name as cliente_nombre', 'cu.trade_name as cliente_comercial', 'uc.name as creo', 'ur.name as revoco'];
    }

    private static function base()
    {
        return DB::table('api_keys as k')->leftJoin('customers as cu', 'cu.id', '=', 'k.customer_id')->leftJoin('users as uc', 'uc.id', '=', 'k.created_by')
            ->leftJoin('users as ur', 'ur.id', '=', 'k.revoked_by');
    }

    private static function presentar(object $k, array $marcas, array $alcances): array
    {
        $estado = self::estado($k);
        $dias = (int) Carbon::parse(self::hoy())->diffInDays(Carbon::parse($k->expires_at), false);
        $scopes = json_decode((string) $k->scopes, true) ?: [];
        $brands = json_decode((string) $k->brand_ids, true) ?: [];

        return [
            'id' => $k->id, 'name' => $k->name, 'description' => $k->description, 'environment' => $k->environment, 'entorno' => self::ENTORNOS[$k->environment] ?? $k->environment,
            'prefix' => $k->prefix, 'huella' => substr((string) $k->secret_hash, 0, 12), 'scopes' => $scopes,
            'alcances' => array_map(fn ($s) => ['code' => $s, 'name' => $alcances[$s]['name'] ?? $s, 'is_write' => $alcances[$s]['is_write'] ?? false], $scopes),
            'escritura' => (bool) array_filter($scopes, fn ($s) => str_ends_with($s, ':write')),
            'brand_ids' => $brands, 'marcas' => $brands ? array_values(array_map(fn ($b) => $marcas[$b] ?? '—', $brands)) : [],
            'allowed_ips' => json_decode((string) $k->allowed_ips, true) ?: [], 'customer_id' => $k->customer_id, 'cliente' => $k->cliente_comercial ?: $k->cliente_nombre,
            'channel' => $k->channel, 'canal' => self::CANALES[$k->channel] ?? $k->channel, 'expires_at' => $k->expires_at, 'dias' => $dias,
            'status' => $estado, 'estado' => self::ESTADOS[$estado], 'creo' => $k->creo, 'created_at' => $k->created_at,
            'revoked_at' => $k->revoked_at, 'revoco' => $k->revoco, 'revoke_reason' => $k->revoke_reason, 'last_used_at' => $k->last_used_at, 'last_ip' => $k->last_ip,
        ];
    }

    private static function marcas(): array
    {
        return DB::table('brands')->orderBy('name')->pluck('name', 'id')->all();
    }

    private static function alcancesPorCodigo(): array
    {
        return DB::table('api_scopes')->orderBy('sort_order')->get()->keyBy('code')->map(fn ($s) => ['name' => $s->name, 'is_write' => (bool) $s->is_write])->all();
    }

    /* ------------------------------------------------------------------ API-01 */

    public static function lista(array $f, User $u): array
    {
        $hoy = self::hoy();
        $q = self::base();
        if (! empty($f['entorno'])) {
            $q->where('k.environment', $f['entorno']);
        }
        match ($f['estado'] ?? '') {
            'ACTIVE' => $q->where('k.status', 'ACTIVE')->where('k.expires_at', '>=', $hoy),
            'REVOKED' => $q->where('k.status', 'REVOKED'),
            'EXPIRED' => $q->where('k.status', 'ACTIVE')->where('k.expires_at', '<', $hoy),
            default => null,
        };
        match ($f['escritura'] ?? '') {
            '1' => $q->whereRaw("EXISTS (SELECT 1 FROM jsonb_array_elements_text(k.scopes) s WHERE s LIKE '%:write')"),
            '0' => $q->whereRaw("NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(k.scopes) s WHERE s LIKE '%:write')"),
            default => null,
        };
        if (! empty($f['alcance'])) {
            $q->whereRaw('k.scopes @> ?::jsonb', [json_encode([$f['alcance']])]);
        }
        $t = trim((string) ($f['buscar'] ?? ''));
        if (mb_strlen($t) >= 2) {
            $p = '%'.addcslashes($t, '%_\\').'%';
            $q->where(fn ($w) => $w->where('k.name', 'ilike', $p)->orWhere('k.prefix', 'ilike', $p)->orWhere('k.description', 'ilike', $p)
                ->orWhere('cu.full_name', 'ilike', $p)->orWhere('cu.trade_name', 'ilike', $p));
        }
        $q->orderByRaw("CASE WHEN k.status = 'ACTIVE' AND k.expires_at >= ? THEN 0 ELSE 1 END", [$hoy])->orderByDesc('k.created_at')->orderBy('k.id');
        Paginas::ordenar($q, ['nombre' => 'k.name', 'entorno' => 'k.environment', 'vence' => 'k.expires_at', 'uso' => 'k.last_used_at', 'creada' => 'k.created_at'], 'k.id', $f);
        $q->select(self::columnas());
        $marcas = self::marcas();
        $alcances = self::alcancesPorCodigo();
        $c = DB::table('api_keys')->selectRaw("count(*) AS total,
            count(*) FILTER (WHERE status = 'ACTIVE' AND expires_at >= ?) AS activas,
            count(*) FILTER (WHERE status = 'ACTIVE' AND expires_at >= ? AND environment = 'LIVE') AS produccion,
            count(*) FILTER (WHERE status = 'ACTIVE' AND expires_at >= ? AND environment = 'TEST') AS pruebas,
            count(*) FILTER (WHERE status = 'ACTIVE' AND expires_at >= ? AND expires_at <= ?) AS por_vencer,
            count(*) FILTER (WHERE status = 'REVOKED') AS revocadas,
            count(*) FILTER (WHERE status = 'ACTIVE' AND expires_at < ?) AS vencidas", [$hoy, $hoy, $hoy, $hoy, Carbon::parse($hoy)->addDays(15)->toDateString(), $hoy])->first();
        $porVencer = DB::table('api_keys')->where('status', 'ACTIVE')->whereBetween('expires_at', [$hoy, Carbon::parse($hoy)->addDays(15)->toDateString()])->orderBy('expires_at')->pluck('name')->all();

        return Paginas::de($q, fn ($k) => self::presentar($k, $marcas, $alcances), $f) + [
            'cifras' => ['total' => (int) $c->total, 'activas' => (int) $c->activas, 'produccion' => (int) $c->produccion, 'pruebas' => (int) $c->pruebas,
                'por_vencer' => (int) $c->por_vencer, 'por_vencer_nombres' => $porVencer, 'revocadas' => (int) $c->revocadas, 'vencidas' => (int) $c->vencidas],
            'puede' => Access::can($u, 'api.key.manage'),
            'opciones' => ['alcances' => collect($alcances)->map(fn ($s, $code) => ['value' => $code, 'label' => "{$s['name']} ({$code})"])->values()->all()],
        ];
    }

    /* ------------------------------------------------------------------ API-02 */

    /** Lo que necesita el formulario: alcances, marcas, canales y los plazos. */
    public static function formulario(): array
    {
        $hoy = self::hoy();

        return [
            'alcances' => Catalogo::alcances(),
            'marcas' => DB::table('brands')->where('status', 'ACTIVE')->orderBy('name')->get(['id', 'name'])->map(fn ($b) => ['value' => $b->id, 'label' => $b->name])->all(),
            'canales' => collect(self::CANALES)->map(fn ($l, $k) => ['value' => $k, 'label' => $l])->values()->all(),
            'dias_defecto' => self::diasPorDefecto(), 'dias_maximo' => self::diasMaximo(),
            'vence_defecto' => Carbon::parse($hoy)->addDays(self::diasPorDefecto())->toDateString(), 'vence_maximo' => Carbon::parse($hoy)->addDays(self::diasMaximo())->toDateString(),
            'hoy' => $hoy,
        ];
    }

    /** Clientes con RUC para vincular la clave (el ERP de un restaurante, por ejemplo). */
    public static function clientes(string $buscar): array
    {
        $t = trim($buscar);
        if (mb_strlen($t) < 2) {
            return [];
        }
        $p = '%'.addcslashes($t, '%_\\').'%';

        return DB::table('customers')->where('status', '<>', 'INACTIVE')->whereNull('merged_into_id')
            ->where(fn ($w) => $w->where('full_name', 'ilike', $p)->orWhere('trade_name', 'ilike', $p)->orWhere('doc_number', 'ilike', $p))
            ->orderBy('full_name')->limit(20)->get(['id', 'full_name', 'trade_name', 'doc_type', 'doc_number'])
            ->map(fn ($c) => ['value' => $c->id, 'label' => ($c->trade_name ?: $c->full_name).($c->doc_number ? " · {$c->doc_type} {$c->doc_number}" : '')])->all();
    }

    /** Crea la clave y devuelve el secreto completo UNA sola vez (la base guarda la huella). */
    public static function crear(array $d, User $u): array
    {
        if (! Access::can($u, 'api.key.manage')) {
            RuleError::fail('RN-API-01', 'Crear claves es del administrador del sistema o la gerencia.');
        }
        $nombre = trim((string) $d['name']);
        if (mb_strlen($nombre) < 3) {
            RuleError::fail('RN-API-01', 'Ponle a la clave un nombre de al menos 3 caracteres: quién la usa y para qué.');
        }
        $entorno = $d['environment'];
        $alcances = array_values(array_unique($d['scopes'] ?? []));
        if (! $alcances) {
            RuleError::fail('RN-API-03', 'Elige al menos un alcance.');
        }
        $validos = DB::table('api_scopes')->whereIn('code', $alcances)->pluck('code')->all();
        if ($fuera = array_diff($alcances, $validos)) {
            RuleError::fail('RN-API-03', 'Alcances fuera del catálogo: '.implode(', ', $fuera).'.');
        }
        $hoy = self::hoy();
        $vence = $d['expires_at'] ?? Carbon::parse($hoy)->addDays(self::diasPorDefecto())->toDateString();
        $dias = (int) Carbon::parse($hoy)->diffInDays(Carbon::parse($vence), false);
        if ($dias <= 0) {
            RuleError::fail('RN-API-02', 'El vencimiento debe ser posterior a hoy.');
        }
        if ($dias > self::diasMaximo()) {
            RuleError::fail('RN-API-02', 'El vencimiento máximo es de '.self::diasMaximo().' días (hasta el '.Carbon::parse($hoy)->addDays(self::diasMaximo())->format('d/m/Y')."); pediste {$dias}.");
        }
        $marcas = array_values(array_unique(array_filter($d['brand_ids'] ?? [])));
        if ($marcas && DB::table('brands')->whereIn('id', $marcas)->count() !== count($marcas)) {
            RuleError::fail('RN-API-11', 'Alguna de las marcas no es de esta empresa.');
        }
        $ips = array_values(array_unique(array_filter(array_map('trim', is_array($d['allowed_ips'] ?? null) ? $d['allowed_ips'] : preg_split('/[\s,;]+/', (string) ($d['allowed_ips'] ?? ''))))));
        foreach ($ips as $ip) {
            if (! self::ipValida($ip)) {
                RuleError::fail('RN-API-11', "«{$ip}» no es una IP ni un rango válido (por ejemplo 181.65.70.12 o 181.65.70.0/24).");
            }
        }
        if (count($ips) > 20) {
            RuleError::fail('RN-API-11', 'Indica hasta 20 IP o rangos.');
        }
        $cliente = $d['customer_id'] ?? null;
        if ($cliente && ! DB::table('customers')->where('id', $cliente)->where('status', '<>', 'INACTIVE')->whereNull('merged_into_id')->exists()) {
            RuleError::fail('RN-API-11', 'El cliente vinculado no existe o está inactivo.');
        }
        $canal = $d['channel'] ?? ($cliente ? 'B2B' : 'WEB');

        $secreto = self::azar(40, self::BASE62);
        $id = null;
        $prefijo = null;
        for ($i = 0; $i < 5 && ! $id; $i++) {
            $prefijo = 'ak_'.($entorno === 'LIVE' ? 'live' : 'test').'_'.self::azar(8, self::ALFANUM);
            try {
                $id = DB::transaction(fn () => DB::table('api_keys')->insertGetId([
                    'name' => mb_substr($nombre, 0, 120), 'description' => isset($d['description']) && trim($d['description']) !== '' ? mb_substr(trim($d['description']), 0, 500) : null,
                    'environment' => $entorno, 'prefix' => $prefijo, 'secret_hash' => hash('sha256', $secreto), 'scopes' => json_encode($alcances), 'brand_ids' => json_encode($marcas),
                    'allowed_ips' => json_encode($ips), 'customer_id' => $cliente, 'channel' => $canal, 'expires_at' => $vence, 'status' => 'ACTIVE', 'created_by' => $u->id,
                    'created_at' => now(), 'updated_at' => now(),
                ], 'id'));
            } catch (\Illuminate\Database\UniqueConstraintViolationException) {
                $id = null;   // el prefijo ya existe en la plataforma: se sortea otro
            }
        }
        if (! $id) {
            RuleError::fail('RN-API-04', 'No se pudo generar un prefijo único. Intenta otra vez.');
        }
        Events::emit('api.key_created', 'api_keys', $id, ['by' => $u->id, 'prefix' => $prefijo, 'environment' => $entorno, 'scopes' => $alcances]);

        return ['clave' => self::ver($id, $u), 'token' => "{$prefijo}_{$secreto}"];
    }

    /* ------------------------------------------------------------------ API-03 */

    public static function ver(string $id, User $u): array
    {
        $k = self::base()->where('k.id', $id)->first(self::columnas()) ?? abort(404);

        return self::presentar($k, self::marcas(), self::alcancesPorCodigo()) + [
            'catalogo' => Catalogo::alcances(), 'puede' => Access::can($u, 'api.key.manage'),
        ];
    }

    /** Editar nombre, descripción, IP permitidas y acortar el vencimiento. Lo demás no cambia (RN-API-10). */
    public static function editar(string $id, array $d, User $u): array
    {
        if (! Access::can($u, 'api.key.manage')) {
            RuleError::fail('RN-API-10', 'Editar claves es del administrador del sistema o la gerencia.');
        }
        $k = DB::table('api_keys')->where('id', $id)->first() ?? abort(404);
        if (self::estado($k) !== 'ACTIVE') {
            RuleError::fail('RN-API-10', 'Una clave revocada o vencida no se edita: crea otra clave.');
        }
        $cambios = [];
        if (array_key_exists('name', $d)) {
            $n = trim((string) $d['name']);
            if (mb_strlen($n) < 3) {
                RuleError::fail('RN-API-01', 'El nombre debe tener al menos 3 caracteres.');
            }
            $cambios['name'] = mb_substr($n, 0, 120);
        }
        if (array_key_exists('description', $d)) {
            $cambios['description'] = trim((string) $d['description']) !== '' ? mb_substr(trim((string) $d['description']), 0, 500) : null;
        }
        if (array_key_exists('allowed_ips', $d)) {
            $ips = array_values(array_unique(array_filter(array_map('trim', is_array($d['allowed_ips']) ? $d['allowed_ips'] : preg_split('/[\s,;]+/', (string) $d['allowed_ips'])))));
            foreach ($ips as $ip) {
                if (! self::ipValida($ip)) {
                    RuleError::fail('RN-API-11', "«{$ip}» no es una IP ni un rango válido.");
                }
            }
            $cambios['allowed_ips'] = json_encode($ips);
        }
        if (! empty($d['expires_at'])) {
            if ($d['expires_at'] > $k->expires_at) {
                RuleError::fail('RN-API-02', 'El vencimiento no se extiende: crea otra clave.');
            }
            if ($d['expires_at'] <= self::hoy()) {
                RuleError::fail('RN-API-02', 'El vencimiento debe ser posterior a hoy; para dejarla sin efecto ya, revócala.');
            }
            $cambios['expires_at'] = $d['expires_at'];
        }
        if ($cambios) {
            DB::table('api_keys')->where('id', $id)->update($cambios + ['updated_at' => now()]);
            Events::emit('api.key_updated', 'api_keys', $id, ['by' => $u->id, 'fields' => array_keys($cambios)]);
        }

        return self::ver($id, $u);
    }

    /** Revocar con motivo (al menos 10 caracteres): la siguiente llamada con la clave responde 401. No tiene vuelta. */
    public static function revocar(string $id, string $motivo, User $u): array
    {
        if (! Access::can($u, 'api.key.manage')) {
            RuleError::fail('RN-API-10', 'Revocar claves es del administrador del sistema o la gerencia.');
        }
        $k = DB::table('api_keys')->where('id', $id)->first() ?? abort(404);
        $estado = self::estado($k);
        if ($estado !== 'ACTIVE') {
            RuleError::fail('RN-API-10', "La clave {$k->prefix} ya está ".($estado === 'REVOKED' ? 'revocada' : 'vencida').'.');
        }
        $motivo = trim($motivo);
        if (mb_strlen($motivo) < 10) {
            RuleError::fail('RN-API-10', 'Revocar exige un motivo de al menos 10 caracteres.');
        }
        DB::table('api_keys')->where('id', $id)->where('status', 'ACTIVE')->update(['status' => 'REVOKED', 'revoked_at' => now(), 'revoked_by' => $u->id,
            'revoke_reason' => mb_substr($motivo, 0, 500), 'updated_at' => now()]);
        Events::emit('api.key_revoked', 'api_keys', $id, ['by' => $u->id, 'prefix' => $k->prefix, 'reason' => $motivo]);

        return self::ver($id, $u);
    }
}
