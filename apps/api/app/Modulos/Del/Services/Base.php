<?php

namespace App\Modulos\Del\Services;

use App\Models\User;
use App\Modulos\Int\Services\Archivos;
use App\Support\Access;
use App\Support\Params;
use App\Support\RuleError;
use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;

/**
 * Piezas comunes de DEL: nombres de estados, motivos y costos, parámetros, alcance por local,
 * correlativos, distancias, avisos y eventos de la app (solo inserción, sin duplicados).
 */
final class Base
{
    public const EPS = 0.005;

    public const RUTA = ['PLANNED' => 'planificada', 'LOADING' => 'cargando', 'IN_ROUTE' => 'en ruta', 'RETURNED' => 'de vuelta',
        'SETTLED' => 'liquidada', 'CANCELLED' => 'cancelada'];

    public const PARADA = ['PENDING' => 'pendiente', 'ARRIVED' => 'en el lugar', 'DELIVERED' => 'entregada', 'FAILED' => 'no entregada',
        'RESCHEDULED' => 'reprogramada', 'CANCELLED' => 'quitada', 'HANDED_OFF' => 'con motorizado externo'];

    public const MODOS = ['OWN' => 'Propia', 'RENTED' => 'Alquilada', 'THIRD_PARTY' => 'Tercero'];

    /** RN-DEL-07: motivos del no entregado, con su motivo del catálogo de PED (RN-PED-13). */
    public const MOTIVOS = [
        'CUSTOMER_ABSENT' => ['Cliente ausente', 'CLIENTE_AUSENTE'],
        'WRONG_ADDRESS' => ['Dirección errada', 'DIRECCION_ERRADA'],
        'REFUSED' => ['Rechazo del cliente', 'RECHAZO_PRODUCTO'],
        'DAMAGED' => ['Producto dañado', 'RECHAZO_PRODUCTO'],
        'NO_PAYMENT' => ['Sin pago', 'SIN_DINERO'],
        'OUT_OF_SLOT' => ['Fuera de franja', 'OTRO'],
        'VEHICLE' => ['Problema con el vehículo', 'ACCIDENTE_RUTA'],
        'COLD_CHAIN' => ['Cadena de frío', 'OTRO'],
        'OTHER' => ['Otro', 'OTRO'],
    ];

    public const INCIDENCIAS = ['CROSSED_ORDER' => 'Pedido cruzado', 'DAMAGED_PRODUCT' => 'Producto dañado', 'MISSING_ITEM' => 'Falta un producto',
        'CUSTOMER_COMPLAINT' => 'Reclamo del cliente', 'VEHICLE' => 'Problema con el vehículo', 'OTHER' => 'Otra'];

    /** RN-DEL-09: medios de la empresa para el cobro contra entrega. */
    public const MEDIOS_COBRO = ['CASH' => 'Efectivo', 'YAPE' => 'Yape de la empresa', 'PLIN' => 'Plin de la empresa', 'CARD' => 'POS (tarjeta)'];

    public const COSTOS = [
        'FUEL' => 'Combustible', 'MAINTENANCE_PREVENTIVE' => 'Mantenimiento preventivo', 'MAINTENANCE_CORRECTIVE' => 'Mantenimiento correctivo',
        'SOAT' => 'SOAT', 'TECH_INSPECTION' => 'Revisión técnica', 'RENT' => 'Alquiler del vehículo', 'TOLL' => 'Peaje', 'PARKING' => 'Estacionamiento',
        'FINE' => 'Multa', 'DRIVER_WAGE' => 'Sueldo o jornal', 'DRIVER_MEAL' => 'Alimentación', 'DRIVER_TRANSPORT' => 'Movilidad',
        'DELIVERY_BONUS' => 'Bono del repartidor', 'CARRIER_FEE' => 'Empresa de delivery', 'PROVINCE_FREIGHT' => 'Flete a provincia',
        'PACKAGING' => 'Empaque', 'OTHER' => 'Otro',
    ];

    /** Grupo del costo en el reparto por entrega (RN-DEL-14). */
    public const GRUPO = [
        'FUEL' => 'vehicle', 'MAINTENANCE_PREVENTIVE' => 'vehicle', 'MAINTENANCE_CORRECTIVE' => 'vehicle', 'SOAT' => 'vehicle', 'TECH_INSPECTION' => 'vehicle',
        'RENT' => 'vehicle', 'FINE' => 'vehicle', 'TOLL' => 'direct', 'PARKING' => 'direct', 'DRIVER_WAGE' => 'driver', 'DRIVER_MEAL' => 'driver',
        'DRIVER_TRANSPORT' => 'driver', 'DELIVERY_BONUS' => 'driver', 'CARRIER_FEE' => 'carrier', 'OTHER' => 'other',
    ];

    public const VEHICULOS = ['MOTO' => 'Moto', 'CAR' => 'Auto', 'VAN' => 'Furgoneta', 'TRUCK' => 'Camión', 'BICYCLE' => 'Bicicleta'];

    public const COMBUSTIBLES = ['GASOLINE' => 'Gasolina', 'DIESEL' => 'Diésel', 'GLP' => 'GLP', 'GNV' => 'GNV', 'ELECTRIC' => 'Eléctrico', 'NONE' => 'Ninguno'];

    public const PROVINCIA = ['PREPARED' => 'preparado', 'HANDED_TO_AGENCY' => 'entregado a la agencia', 'IN_TRANSIT' => 'en tránsito',
        'DELIVERED' => 'entregado', 'RETURNED' => 'devuelto', 'LOST' => 'perdido'];

    public const ABIERTAS = ['PENDING', 'ARRIVED'];

    /** Paradas que cuentan en la ruta (las quitadas y reprogramadas no). */
    public const EN_RUTA = ['PENDING', 'ARRIVED', 'DELIVERED', 'FAILED', 'HANDED_OFF'];

    public static function hoy(): string
    {
        return CarbonImmutable::now('America/Lima')->toDateString();
    }

    public static function ruta(string $s): string
    {
        return self::RUTA[$s] ?? $s;
    }

    public static function parada(string $s): string
    {
        return self::PARADA[$s] ?? $s;
    }

    public static function fecha(?string $d): string
    {
        return $d ? CarbonImmutable::parse(substr($d, 0, 10))->format('d/m/Y') : '—';
    }

    public static function soles(float $n): string
    {
        return 'S/ '.number_format($n, 2, '.', ',');
    }

    public static function r(mixed $n, int $d = 2): float
    {
        return round((float) $n, $d);
    }

    public static function num(string $clave, float $defecto, ?string $marca = null): float
    {
        $v = Params::get($clave, $marca ? ['brand' => $marca] : []);

        return $v === null || $v === '' || ! is_numeric($v) ? $defecto : (float) $v;
    }

    public static function texto(string $clave, string $defecto): string
    {
        $v = Params::get($clave);

        return $v === null || $v === '' ? $defecto : (string) $v;
    }

    /** Locales que ve el usuario (vacío = todos). */
    public static function locales(User $u): array
    {
        return Access::for($u)['establishments'];
    }

    public static function alcance(Builder $q, User $u, string $col = 'r.establishment_id'): Builder
    {
        $l = self::locales($u);

        return $q->when($l, fn ($w) => $w->whereIn($col, $l));
    }

    public static function veLocal(User $u, ?string $establecimiento): bool
    {
        $l = self::locales($u);

        return ! $l || ($establecimiento && in_array($establecimiento, $l, true));
    }

    /** El usuario es repartidor (usa la app) y no coordina: solo ve sus rutas. */
    public static function soloSusRutas(User $u): bool
    {
        return Access::can($u, 'del.route.drive') && ! Access::can($u, 'del.route.plan') && ! Access::can($u, 'del.tracking.view');
    }

    /** Ruta con candado, visible para el usuario (local; el repartidor, solo las suyas). */
    public static function rutaVisible(string $id, User $u, bool $bloquear = false): object
    {
        $q = DB::table('delivery_routes')->where('id', $id);
        $r = $bloquear ? $q->lockForUpdate()->first() : $q->first();
        if (! $r || ! self::veLocal($u, $r->establishment_id) || (self::soloSusRutas($u) && $r->driver_user_id !== $u->id)) {
            abort(404, 'No se encontró la ruta.');
        }

        return $r;
    }

    /** Siguiente correlativo «LQR-00001» por empresa, con candado de la transacción. */
    public static function numero(string $tabla, string $prefijo, int $digitos = 5): string
    {
        DB::select('SELECT pg_advisory_xact_lock(hashtext(?))', ["del:{$tabla}:".DB::selectOne('SELECT app_tenant_id() AS t')->t]);
        $n = strlen($prefijo) + 1;
        $max = DB::table($tabla)->where('number', 'like', $prefijo.'%')
            ->selectRaw("max(nullif(regexp_replace(substr(number, {$n}), '\\D', '', 'g'), '')::int) AS n")->value('n');

        return $prefijo.str_pad((string) (((int) $max) + 1), $digitos, '0', STR_PAD_LEFT);
    }

    /** Distancia en km entre dos puntos (haversine). */
    public static function km(?float $lat1, ?float $lng1, ?float $lat2, ?float $lng2): ?float
    {
        if ($lat1 === null || $lng1 === null || $lat2 === null || $lng2 === null) {
            return null;
        }
        $r = 6371.0;
        $dLat = deg2rad($lat2 - $lat1);
        $dLng = deg2rad($lng2 - $lng1);
        $a = sin($dLat / 2) ** 2 + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin($dLng / 2) ** 2;

        return $r * 2 * atan2(sqrt($a), sqrt(1 - $a));
    }

    /** Teléfono enmascarado: «9871 2** *** 456». */
    public static function enmascarar(?string $tel): string
    {
        $s = preg_replace('/\D/', '', (string) $tel);

        return strlen($s) > 6 ? substr($s, 0, 4).' '.substr($s, 4, 1).'** *** '.substr($s, -3) : '—';
    }

    public static function cliente(?string $customerId): ?string
    {
        if (! $customerId) {
            return null;
        }
        $c = DB::table('customers')->where('id', $customerId)->first(['trade_name', 'full_name']);

        return $c ? ($c->trade_name ?: $c->full_name) : null;
    }

    public static function primerNombre(?string $nombre): ?string
    {
        $n = trim((string) $nombre);

        return $n === '' ? null : explode(' ', $n)[0];
    }

    /** Aviso en el centro de notificaciones: a una persona (user_id) o a un rol. */
    public static function avisar(array $para, string $titulo, string $cuerpo, string $pantalla, ?string $id, string $tono = 'warn'): void
    {
        DB::table('notifications')->insert($para + [
            'title' => mb_substr($titulo, 0, 255), 'body' => $cuerpo, 'ref' => json_encode(array_filter(['screen' => $pantalla, 'id' => $id])),
            'tone' => $tono, 'severity' => match ($tono) {
                'bad' => 'CRITICAL', 'warn' => 'WARNING', 'ok' => 'OK', default => 'INFO'
            },
            'module' => 'DEL', 'type' => 'ORDERS', 'at' => now(), 'in_app' => true,
        ]);
    }

    /** ¿Ya se registró ese evento del teléfono? (RN-DEL-06, CA-DEL-09). */
    public static function repetido(?string $clientEventId): bool
    {
        return $clientEventId !== null && $clientEventId !== '' && DB::table('delivery_events')->where('client_event_id', $clientEventId)->exists();
    }

    /** Evento de la ruta, de solo inserción. Sin id del teléfono, el servidor pone uno. */
    public static function evento(array $e, ?User $u = null): string
    {
        $cid = trim((string) ($e['client_event_id'] ?? '')) ?: 'srv-'.bin2hex(random_bytes(10));
        $id = DB::table('delivery_events')->insertGetId([
            'route_id' => $e['route_id'], 'stop_id' => $e['stop_id'] ?? null, 'event_type' => $e['event_type'],
            'reason_code' => $e['reason_code'] ?? null, 'lat' => $e['lat'] ?? null, 'lng' => $e['lng'] ?? null,
            'photo_file_id' => $e['photo_file_id'] ?? null, 'signature_file_id' => $e['signature_file_id'] ?? null,
            'delivery_code' => $e['delivery_code'] ?? null, 'amount' => $e['amount'] ?? null, 'payment_id' => $e['payment_id'] ?? null,
            'receiver_name' => isset($e['receiver_name']) ? mb_substr((string) $e['receiver_name'], 0, 120) : null,
            'notes' => $e['notes'] ?? null, 'incident_type' => $e['incident_type'] ?? null,
            'client_event_id' => mb_substr($cid, 0, 80), 'occurred_at' => $e['occurred_at'] ?? now(),
            'user_id' => $u?->id, 'device_id' => isset($e['device_id']) ? mb_substr((string) $e['device_id'], 0, 80) : null,
        ], 'id');

        return $id;
    }

    /**
     * Guarda una foto o firma de la app (archivo o imagen en base64 de la cola sin conexión) como adjunto del
     * registro. La misma foto ya adjunta se reutiliza. Devuelve el id del archivo o null si no vino.
     */
    public static function foto(UploadedFile|string|null $f, ?string $registro, ?string $registroId, User $u, string $regla, string $falta = ''): ?string
    {
        if (is_string($f)) {
            if (! preg_match('#^data:image/(jpeg|jpg|png|webp);base64,(.+)$#s', $f, $m)) {
                RuleError::fail($regla, 'La foto no es una imagen válida.');
            }
            $bytes = base64_decode($m[2], true);
            if ($bytes === false || strlen($bytes) < 50) {
                RuleError::fail($regla, 'La foto no es una imagen válida.');
            }
            $ext = $m[1] === 'png' ? 'png' : ($m[1] === 'webp' ? 'webp' : 'jpg');
            $tmp = tempnam(sys_get_temp_dir(), 'del');
            file_put_contents($tmp, $bytes);
            $f = new UploadedFile($tmp, 'foto.'.$ext, 'image/'.($ext === 'jpg' ? 'jpeg' : $ext), null, true);
        }
        if (! $f) {
            if ($falta !== '') {
                RuleError::fail($regla, $falta);
            }

            return null;
        }
        $huella = hash_file('sha256', $f->getRealPath());
        $ya = DB::table('file_attachments')->where('sha256', $huella)->where('status', 'ACTIVE')
            ->when($registro, fn ($q) => $q->where('entity', $registro)->where('entity_id', $registroId))->value('id');

        return $ya ?? Archivos::subir($f, $registro, $registroId, 'INTERNAL', $u)['id'];
    }

    /** Falla con la regla si el valor no es de la lista. */
    public static function exigirEn(string $valor, array $lista, string $regla, string $mensaje): void
    {
        if (! array_key_exists($valor, $lista)) {
            RuleError::fail($regla, $mensaje);
        }
    }
}
