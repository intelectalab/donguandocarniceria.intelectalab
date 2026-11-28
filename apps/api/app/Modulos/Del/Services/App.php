<?php

namespace App\Modulos\Del\Services;

use App\Models\User;
use App\Modulos\Ped\Services\Estados;
use App\Modulos\Pre\Services\Reparto;
use App\Support\Events;
use App\Support\RuleError;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;

/**
 * App del repartidor (DEL-04, DEL-05): llegada, cobro contra entrega, entrega con prueba, no entregado,
 * incidencias y posición. Cada acción trae un id del teléfono (client_event_id): si la app sin conexión
 * la reenvía al sincronizar, se registra una sola vez (RN-DEL-06, CA-DEL-09).
 */
final class App
{
    /** Respuesta para un evento que ya estaba registrado. */
    private static function repetida(): array
    {
        return ['duplicate' => true];
    }

    /** RN-DEL-05: la parada debe estar abierta y su ruta en ruta; el repartidor solo actúa en sus rutas. */
    private static function enRuta(string $stopId, User $u): array
    {
        $s = DB::table('delivery_stops')->where('id', $stopId)->lockForUpdate()->first();
        if (! $s) {
            abort(404, 'No se encontró la parada.');
        }
        $r = Base::rutaVisible($s->route_id, $u, true);
        if ($r->status !== 'IN_ROUTE') {
            RuleError::fail('RN-DEL-05', "La ruta {$r->code} está ".Base::ruta($r->status).': no se registran llegadas, entregas ni cobros.');
        }
        if (! in_array($s->status, Base::ABIERTAS, true)) {
            RuleError::fail('RN-DEL-05', "La parada {$s->seq} ya está ".Base::parada($s->status).'.');
        }
        $o = DB::table('sales_orders')->where('id', $s->order_id)->first();

        return [$s, $r, $o];
    }

    private static function pendiente(object $s): float
    {
        return max(0.0, round((float) $s->cod_amount - (float) $s->collected_amount, 2));
    }

    public static function llegar(string $stopId, array $d, User $u): array
    {
        return DB::transaction(function () use ($stopId, $d, $u) {
            if (Base::repetido($d['client_event_id'] ?? null)) {
                return self::repetida();
            }
            [$s, $r] = self::enRuta($stopId, $u);
            Base::evento(['route_id' => $r->id, 'stop_id' => $s->id, 'event_type' => 'ARRIVED'] + self::lugar($d), $u);
            DB::table('delivery_stops')->where('id', $s->id)->update(['status' => 'ARRIVED', 'arrived_at' => $s->arrived_at ?? now(), 'updated_at' => now()]);

            return ['stop_id' => $s->id, 'status' => 'ARRIVED'];
        });
    }

    private static function lugar(array $d): array
    {
        return [
            'lat' => isset($d['lat']) && $d['lat'] !== '' ? (float) $d['lat'] : null, 'lng' => isset($d['lng']) && $d['lng'] !== '' ? (float) $d['lng'] : null,
            'client_event_id' => $d['client_event_id'] ?? null, 'device_id' => $d['device_id'] ?? null,
            'occurred_at' => ! empty($d['occurred_at']) ? $d['occurred_at'] : now(),
        ];
    }

    /** Cuenta de la caja del repartidor (DRIVER_CASH). Se crea la primera vez que cobra en efectivo. */
    public static function cuentaRepartidor(object $r): string
    {
        $id = DB::table('cash_accounts')->where('account_type', 'DRIVER_CASH')->where('user_id', $r->driver_user_id)->where('status', 'ACTIVE')->value('id');
        if ($id) {
            return $id;
        }
        $nombre = DB::table('users')->where('id', $r->driver_user_id)->value('name') ?? 'Repartidor';
        $codigo = 'DRV-'.mb_strtoupper(mb_substr(preg_replace('/[^A-Za-z]/', '', (string) Base::primerNombre($nombre)), 0, 12) ?: substr($r->driver_user_id, 0, 6));
        while (DB::table('cash_accounts')->where('code', $codigo)->exists()) {
            $codigo .= random_int(0, 9);
        }

        return DB::table('cash_accounts')->insertGetId([
            'code' => mb_substr($codigo, 0, 40), 'name' => mb_substr("Caja de ruta · {$nombre}", 0, 80), 'account_type' => 'DRIVER_CASH',
            'establishment_id' => $r->establishment_id, 'currency' => 'PEN', 'status' => 'ACTIVE', 'user_id' => $r->driver_user_id,
            'holder_employee_id' => $r->driver_employee_id, 'holder_name' => mb_substr($nombre, 0, 80), 'opening_balance' => 0,
        ], 'id');
    }

    /** Cuenta para un cobro digital contra entrega (Yape o Plin de la empresa, POS). */
    private static function cuentaDigital(string $tipo, string $codigo): string
    {
        $id = DB::table('cash_accounts')->where('status', 'ACTIVE')->where('account_type', $tipo)->orderByRaw('code = ? desc', [$codigo])->orderBy('code')->value('id');
        if (! $id) {
            RuleError::fail('RN-DEL-09', 'No hay una cuenta activa de la empresa para ese medio: configúrala en Cajas y cuentas.');
        }

        return $id;
    }

    /** CB-000001 por empresa (la misma serie que el mostrador), con candado. */
    public static function numeroCobro(): string
    {
        DB::select('SELECT pg_advisory_xact_lock(hashtext(?))', ['caj:cobro:'.DB::selectOne('SELECT app_tenant_id() AS t')->t]);
        $max = DB::table('payments')->where('number', 'like', 'CB-%')
            ->selectRaw("max(nullif(regexp_replace(substr(number, 4), '\\D', '', 'g'), '')::int) AS n")->value('n');

        return 'CB-'.str_pad((string) (((int) $max) + 1), 6, '0', STR_PAD_LEFT);
    }

    /**
     * Registra un cobro contra entrega aplicado al pedido. El efectivo queda en la caja del repartidor (RN-DEL-09)
     * y lo digital en la cuenta de la empresa. Devuelve el id del cobro.
     */
    public static function registrarCobro(object $o, object $r, string $medio, float $monto, ?string $ref, ?string $tarjeta, User $u, ?string $cobradoPor = null): string
    {
        Base::exigirEn($medio, Base::MEDIOS_COBRO, 'RN-DEL-09', 'El cobro contra entrega solo usa medios de la empresa: efectivo, Yape o Plin de la empresa o POS.');
        $m = DB::table('payment_methods')->where('code', $medio)->first(['id', 'name', 'kind']);
        if (! $m) {
            RuleError::fail('RN-DEL-09', 'Ese medio de pago no está configurado.');
        }
        $ref = trim((string) $ref) ?: null;
        if (in_array($medio, ['YAPE', 'PLIN'], true) && ! $ref) {
            RuleError::fail('RN-CAJ-02', "{$m->name} exige el número de operación.");
        }
        if ($medio === 'CARD' && ! preg_match('/^\d{4}$/', (string) $tarjeta)) {
            RuleError::fail('RN-CAJ-02', 'El cobro con POS exige los 4 últimos dígitos de la tarjeta del voucher.');
        }
        if ($ref && DB::table('payments')->where('payment_method_id', $m->id)->where('status', 'CONFIRMED')->whereRaw('upper(reference) = ?', [mb_strtoupper($ref)])->exists()) {
            RuleError::fail('RN-CAJ-04', "La operación {$ref} de {$m->name} ya está registrada en otro cobro.");
        }
        $cuenta = match ($medio) {
            'CASH' => $r->mode === 'THIRD_PARTY' ? self::cuentaDigital('CASH_REGISTER', 'CAJA') : self::cuentaRepartidor($r),
            'CARD' => self::cuentaDigital('CARD_ACQUIRER', 'CARD'),
            default => self::cuentaDigital('WALLET', $medio),
        };
        $id = DB::table('payments')->insertGetId([
            'number' => self::numeroCobro(), 'customer_id' => $o->customer_id, 'payment_method_id' => $m->id, 'cash_account_id' => $cuenta,
            'amount' => round($monto, 2), 'paid_at' => now(), 'reference' => $ref ? mb_substr($ref, 0, 40) : null, 'status' => 'CONFIRMED',
            'brand_id' => $o->brand_id, 'establishment_id' => $o->establishment_id, 'fee_amount' => 0,
            'reconciliation_status' => $medio === 'CASH' ? 'NOT_APPLICABLE' : 'PENDING', 'received_by' => $u->id,
            'collected_by_user_id' => $cobradoPor ?? $r->driver_user_id ?? $u->id, 'card_brand' => $medio === 'CARD' ? 'VISA' : null,
            'card_last4' => $medio === 'CARD' ? $tarjeta : null, 'source' => 'DEL', 'created_at' => now(),
        ], 'id');
        // El cobro se aplica al pedido y, si ya tiene su boleta o factura emitida, también a ella (CAJ recalcula su saldo).
        // Sin comprobante, FAC lo enlaza al emitirlo.
        $doc = DB::table('sales_documents')->where('order_id', $o->id)->where('status', 'ISSUED')->whereIn('doc_type', ['INVOICE', 'RECEIPT'])
            ->where('sunat_status', '<>', 'REJECTED')->orderByDesc('created_at')->value('id');
        DB::table('payment_allocations')->insert(['payment_id' => $id, 'line_no' => 1, 'order_id' => $o->id, 'document_id' => $doc, 'amount' => round($monto, 2), 'created_at' => now()]);
        if ($doc) {
            \App\Modulos\Caj\Services\Cobros::recalcularComprobante($doc);
        }
        DB::table('sales_orders')->where('id', $o->id)->update(['paid_amount' => DB::raw('coalesce(paid_amount, 0) + '.round($monto, 2)), 'updated_at' => now()]);
        Events::emit('payment.registered', 'payments', $id, ['method' => $medio, 'amount' => round($monto, 2), 'source' => 'DEL', 'order_id' => $o->id]);

        return $id;
    }

    /** RN-DEL-09: cobro contra entrega por el monto esperado de la parada. */
    public static function cobrar(string $stopId, array $d, User $u): array
    {
        return DB::transaction(function () use ($stopId, $d, $u) {
            if (Base::repetido($d['client_event_id'] ?? null)) {
                return self::repetida();
            }
            [$s, $r, $o] = self::enRuta($stopId, $u);
            $esperado = self::pendiente($s);
            if ($esperado <= Base::EPS) {
                RuleError::fail('RN-DEL-09', "La parada {$s->seq} no tiene saldo por cobrar.");
            }
            $monto = round((float) ($d['amount'] ?? 0), 2);
            if (abs($monto - $esperado) > Base::EPS) {
                RuleError::fail('RN-DEL-09', 'El monto esperado de la parada es '.Base::soles($esperado).'; registraste '.Base::soles($monto).'. Si el cliente paga distinto, registra una incidencia.');
            }
            $medio = (string) ($d['method'] ?? '');
            $pago = self::registrarCobro($o, $r, $medio, $esperado, $d['reference'] ?? null, $d['card_last4'] ?? null, $u);
            Base::evento(['route_id' => $r->id, 'stop_id' => $s->id, 'event_type' => 'COD_COLLECTED', 'amount' => $esperado, 'payment_id' => $pago,
                'notes' => Base::MEDIOS_COBRO[$medio].(! empty($d['reference']) ? ' · op. '.$d['reference'] : '')] + self::lugar($d), $u);
            DB::table('delivery_stops')->where('id', $s->id)->update(['collected_amount' => round((float) $s->collected_amount + $esperado, 2), 'updated_at' => now()]);

            return ['payment_id' => $pago, 'amount' => $esperado];
        });
    }

    /** RN-DEL-06: entrega con foto y el código de 4 dígitos del cliente, o su firma; distancia al pin. */
    public static function entregar(string $stopId, array $d, UploadedFile|string|null $foto, UploadedFile|string|null $firma, User $u): array
    {
        return DB::transaction(function () use ($stopId, $d, $foto, $firma, $u) {
            if (Base::repetido($d['client_event_id'] ?? null)) {
                return self::repetida();
            }
            [$s, $r, $o] = self::enRuta($stopId, $u);
            if (! $foto) {
                RuleError::fail('RN-DEL-06', 'La entrega exige foto: toma la foto del pedido entregado.');
            }
            $codigo = trim((string) ($d['code'] ?? ''));
            if (! $firma) {
                if ($codigo === '') {
                    RuleError::fail('RN-DEL-06', 'Escribe el código de entrega de 4 dígitos que recibió el cliente o pide su firma.');
                }
                if ($codigo !== (string) $s->delivery_code) {
                    RuleError::fail('RN-DEL-06', "El código {$codigo} no coincide con el código de entrega del pedido {$o->number}. Pide al cliente el código del mensaje «va en camino» o su firma.");
                }
            }
            if (self::pendiente($s) > Base::EPS) {
                RuleError::fail('RN-DEL-09', 'Cobra '.Base::soles(self::pendiente($s)).' antes de entregar, o marca «no entregado» con el motivo «sin pago».');
            }
            $lugar = self::lugar($d);
            $pin = Rutas::punto($o);
            $km = Base::km($lugar['lat'], $lugar['lng'], $pin[0], $pin[1]);
            $dist = $km !== null ? round($km * 1000, 1) : null;
            $fotoId = Base::foto($foto, 'sales_orders', $o->id, $u, 'RN-DEL-06');
            $firmaId = Base::foto($firma, 'sales_orders', $o->id, $u, 'RN-DEL-06');
            Base::evento(['route_id' => $r->id, 'stop_id' => $s->id, 'event_type' => 'DELIVERED', 'photo_file_id' => $fotoId, 'signature_file_id' => $firmaId,
                'delivery_code' => $firmaId ? null : $codigo, 'receiver_name' => $d['receiver'] ?? null,
                'notes' => $dist !== null ? 'A '.number_format($dist, 0, ',', '.').' m del pin' : null] + $lugar, $u);
            DB::table('delivery_stops')->where('id', $s->id)->update(['status' => 'DELIVERED', 'closed_at' => now(), 'pod_distance_m' => $dist,
                'arrived_at' => $s->arrived_at ?? now(), 'updated_at' => now()]);
            self::cerrarBolsas($s, 'DELIVERED');
            Estados::cambiar($o->id, 'DELIVERED', "Entregado en la ruta {$r->code}", $u);
            Seguimiento::alEntregar($o->id);
            $max = Base::num('del_pod_max_distance_m', 300);
            $fuera = $dist !== null && $dist > $max;
            if ($fuera) {
                Base::avisar(['role' => 'COORDINADOR_DELIVERY'], "Entrega fuera del radio · {$o->number}",
                    'La prueba se tomó a '.number_format($dist, 0, ',', '.')." m del pin (máximo {$max} m).", 'DEL-07', $s->id);
            }
            Events::emit('order.delivered_pod', 'sales_orders', $o->id, ['number' => $o->number, 'route_id' => $r->id, 'distance_m' => $dist]);

            return ['stop_id' => $s->id, 'status' => 'DELIVERED', 'distance_m' => $dist, 'outside_radius' => $fuera];
        });
    }

    private static function cerrarBolsas(object $s, string $estado): void
    {
        if (Reparto::marcar($s->order_id, $estado) === 0) {
            $bolsas = array_map(fn ($b) => array_merge($b, ['status' => $estado]), json_decode($s->bags ?: '[]', true) ?: []);
            DB::table('delivery_stops')->where('id', $s->id)->update(['bags' => json_encode($bolsas)]);
        }
    }

    /** RN-DEL-07: no entregado con motivo y foto. Las bolsas vuelven devueltas y el pedido queda NO ENTREGADO. */
    public static function noEntregar(string $stopId, array $d, UploadedFile|string|null $foto, User $u): array
    {
        return DB::transaction(function () use ($stopId, $d, $foto, $u) {
            if (Base::repetido($d['client_event_id'] ?? null)) {
                return self::repetida();
            }
            [$s, $r, $o] = self::enRuta($stopId, $u);
            $motivo = (string) ($d['reason'] ?? '');
            Base::exigirEn($motivo, Base::MOTIVOS, 'RN-DEL-07', 'Elige el motivo del no entregado.');
            if (! $foto) {
                RuleError::fail('RN-DEL-07', 'El no entregado exige foto (fachada, timbre o producto).');
            }
            $nota = trim((string) ($d['notes'] ?? ''));
            if ($motivo === 'OTHER' && $nota === '') {
                RuleError::fail('RN-DEL-07', 'Con el motivo «Otro» escribe qué pasó.');
            }
            $fotoId = Base::foto($foto, 'sales_orders', $o->id, $u, 'RN-DEL-07');
            Base::evento(['route_id' => $r->id, 'stop_id' => $s->id, 'event_type' => 'FAILED', 'reason_code' => $motivo, 'photo_file_id' => $fotoId,
                'notes' => $nota ?: null] + self::lugar($d), $u);
            DB::table('delivery_stops')->where('id', $s->id)->update(['status' => 'FAILED', 'closed_at' => now(), 'fail_reason' => $motivo,
                'bags_returned' => false, 'updated_at' => now()]);
            self::cerrarBolsas($s, 'RETURNED');
            [$nombre, $codigoPed] = Base::MOTIVOS[$motivo];
            Estados::noEntregado($o->id, $codigoPed, $nombre.($nota !== '' ? ": {$nota}" : '')." (ruta {$r->code})", $u);
            Base::avisar(['role' => 'COORDINADOR_DELIVERY'], "No entregado · {$o->number}", "{$nombre} en la ruta {$r->code}. Reprograma en No entregados.", 'DEL-16', $s->id);

            return ['stop_id' => $s->id, 'status' => 'FAILED'];
        });
    }

    /** Incidencia en una parada de una ruta abierta (avisa al coordinador). */
    public static function incidencia(string $stopId, array $d, User $u): array
    {
        return DB::transaction(function () use ($stopId, $d, $u) {
            if (Base::repetido($d['client_event_id'] ?? null)) {
                return self::repetida();
            }
            $s = Rutas::parada($stopId);
            $r = Base::rutaVisible($s->route_id, $u);
            if (! in_array($r->status, ['PLANNED', 'LOADING', 'IN_ROUTE'], true)) {
                RuleError::fail('RN-DEL-05', 'Las incidencias se registran en paradas de una ruta abierta.');
            }
            $tipo = (string) ($d['type'] ?? '');
            Base::exigirEn($tipo, Base::INCIDENCIAS, 'RN-DEL-05', 'Elige el tipo de incidencia.');
            $nota = trim((string) ($d['notes'] ?? ''));
            $o = DB::table('sales_orders')->where('id', $s->order_id)->first(['number']);
            Base::evento(['route_id' => $r->id, 'stop_id' => $s->id, 'event_type' => 'INCIDENT', 'incident_type' => $tipo,
                'reason_code' => $tipo === 'DAMAGED_PRODUCT' ? 'DAMAGED' : 'OTHER', 'notes' => Base::INCIDENCIAS[$tipo].($nota !== '' ? " · {$nota}" : '')] + self::lugar($d), $u);
            Base::avisar(['role' => 'COORDINADOR_DELIVERY'], 'Incidencia · '.Base::INCIDENCIAS[$tipo], "Parada {$s->seq} de {$r->code} ({$o->number}). {$nota}", 'DEL-07', $s->id);

            return ['ok' => true];
        });
    }

    /** RN-DEL-16: posición del repartidor con la app abierta en ruta (route.position_reported). */
    public static function posicion(string $routeId, array $d, User $u): array
    {
        return DB::transaction(function () use ($routeId, $d, $u) {
            if (Base::repetido($d['client_event_id'] ?? null)) {
                return self::repetida();
            }
            $r = Base::rutaVisible($routeId, $u);
            if ($r->status !== 'IN_ROUTE') {
                return ['ok' => false];
            }
            $lugar = self::lugar($d);
            if ($lugar['lat'] === null) {
                RuleError::fail('RN-DEL-16', 'Falta la posición.');
            }
            Base::evento(['route_id' => $r->id, 'event_type' => 'POSITION'] + $lugar, $u);
            Events::emit('route.position_reported', 'delivery_routes', $r->id, ['lat' => $lugar['lat'], 'lng' => $lugar['lng'], 'source' => 'POSITION']);

            return ['ok' => true];
        });
    }

    /** Llamar o escribir al cliente: el número se entrega solo al pedirlo y queda registrado. */
    public static function contacto(string $stopId, string $via, User $u): array
    {
        return DB::transaction(function () use ($stopId, $via, $u) {
            $s = Rutas::parada($stopId);
            $r = Base::rutaVisible($s->route_id, $u);
            $o = DB::table('sales_orders')->where('id', $s->order_id)->first();
            $tel = preg_replace('/\D/', '', (string) ($o->contact_phone ?: DB::table('customers')->where('id', $o->customer_id)->value('phone')));
            if ($tel === '') {
                RuleError::fail('RN-DEL-05', 'El pedido no tiene teléfono de contacto.');
            }
            $intl = strlen($tel) === 9 ? '51'.$tel : $tel;
            Base::evento(['route_id' => $r->id, 'stop_id' => $s->id, 'event_type' => $via === 'WHATSAPP' ? 'WHATSAPP' : 'CALL',
                'notes' => $via === 'WHATSAPP' ? 'Escribió al cliente' : 'Llamó al cliente'], $u);
            $nombre = Base::primerNombre(Base::cliente($o->customer_id));
            $texto = "Hola {$nombre}, soy el repartidor de tu pedido {$o->number}. ";

            return ['url' => $via === 'WHATSAPP' ? "https://wa.me/{$intl}?text=".rawurlencode($texto) : "tel:+{$intl}"];
        });
    }

    /** Sincroniza la cola de la app sin conexión: un mismo evento se registra una sola vez. */
    public static function sincronizar(array $e, User $u): array
    {
        $tipo = $e['type'] ?? '';
        $d = ($e['payload'] ?? []) + ['client_event_id' => $e['client_event_id'] ?? null];
        if (Base::repetido($d['client_event_id'])) {
            return self::repetida();
        }

        return match ($tipo) {
            'ARRIVED' => self::llegar($e['stop_id'], $d, $u),
            'COD_COLLECTED' => self::cobrar($e['stop_id'], $d, $u),
            'DELIVERED' => self::entregar($e['stop_id'], $d, $d['photo_data'] ?? null, $d['signature_data'] ?? null, $u),
            'FAILED' => self::noEntregar($e['stop_id'], $d, $d['photo_data'] ?? null, $u),
            'INCIDENT' => self::incidencia($e['stop_id'], $d, $u),
            'POSITION' => self::posicion($e['route_id'], $d, $u),
            'EXPENSE' => Extras::gasto($e['route_id'], $d, $d['photo_data'] ?? null, $u),
            'MESSAGE' => Extras::mensaje($e['route_id'], $d, $d['photo_data'] ?? null, null, $u),
            'TICKET' => Extras::ticketEntregado($e['stop_id'], (string) ($d['via'] ?? ''), $d['client_event_id'], $u),
            default => RuleError::fail('RN-DEL-06', 'Tipo de evento desconocido.'),
        };
    }
}
