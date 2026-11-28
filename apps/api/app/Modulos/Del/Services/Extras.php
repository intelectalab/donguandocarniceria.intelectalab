<?php

namespace App\Modulos\Del\Services;

use App\Models\User;
use App\Modulos\Int\Services\Archivos;
use App\Modulos\Ped\Services\Estados;
use App\Modulos\Pre\Services\Reparto;
use App\Support\Events;
use App\Support\RuleError;
use Carbon\CarbonImmutable;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;

/**
 * Ampliación de Delivery (DEL-17 a DEL-22): gastos del repartidor que entran al cuadre (RN-DEL-16), ticket de
 * entrega (RN-DEL-15), calidad de direcciones (RN-DEL-14), apoyo y derivación a motorizado externo
 * (RN-DEL-18 y RN-DEL-19) y mensajes del repartidor a control (RN-DEL-17).
 */
final class Extras
{
    /** Tipo de gasto => [nombre, tipo de costo de reparto]. */
    public const GASTOS = ['FUEL' => ['Combustible', 'FUEL'], 'MEAL' => ['Alimentación', 'DRIVER_MEAL'], 'TOLL' => ['Peajes', 'TOLL'],
        'EXT_COURIER' => ['Motorizado externo', 'CARRIER_FEE'], 'OTHER' => ['Otros', 'OTHER']];

    public const PAGADO_CON = ['ROUTE_CASH' => 'Del efectivo cobrado en ruta', 'OWN' => 'Con mi dinero (me reembolsan)'];

    public const DESTINOS = ['COORDINADOR_DELIVERY' => 'Coordinación de delivery', 'CAJERO' => 'Cobranza', 'SUPERVISORA_VENTAS' => 'Ventas'];

    /* ---------- Calidad de la dirección (DEL-19, RN-DEL-14) ---------- */

    /** Puntaje 0–100 de la dirección del pedido con lo que le falta. */
    public static function puntaje(object $o): array
    {
        $a = $o->address_id ? DB::table('customer_addresses')->where('id', $o->address_id)->first() : null;
        if (! $a) {
            return ['score' => 0, 'level' => 'BAD', 'issues' => ['El pedido no tiene dirección'], 'address' => null];
        }
        $p = 100;
        $faltas = [];
        $restar = function (int $n, string $m) use (&$p, &$faltas) {
            $p -= $n;
            $faltas[] = $m;
        };
        if ($a->lat === null || $a->lng === null) {
            $restar(40, 'Sin pin en el mapa');
        } else {
            $z = $a->zone_id ? DB::table('delivery_zones')->where('id', $a->zone_id)->first(['lat', 'lng']) : null;
            if ($z && $z->lat !== null && Base::km((float) $a->lat, (float) $a->lng, (float) $z->lat, (float) $z->lng) > 9) {
                $restar(25, 'El pin cae lejos de la zona elegida');
            }
            if ($a->pin_source === 'WEB') {
                $restar(8, 'Pin puesto por el cliente en la web: confírmalo');
            }
        }
        if (! $a->zone_id) {
            $restar(20, 'Sin zona de reparto');
        }
        if (trim((string) $a->reference) === '') {
            $restar(15, 'Sin referencia (color de casa, tienda cercana)');
        }
        if (! preg_match('/\d/', (string) $a->address_line)) {
            $restar(12, 'La dirección no tiene número');
        }
        if (mb_strlen((string) $a->address_line) < 15) {
            $restar(10, 'Dirección muy corta');
        }
        if (! ($o->contact_phone ?: $a->contact_phone ?: DB::table('customers')->where('id', $o->customer_id)->value('phone'))) {
            $restar(20, 'Sin teléfono de contacto');
        }
        if (! $a->verified_at) {
            $restar(8, 'Aún no confirmada con el cliente');
        }
        $p = max(0, $p);

        return ['score' => $p, 'level' => $p >= 85 ? 'OK' : ($p >= 65 ? 'REVIEW' : 'BAD'), 'issues' => $faltas, 'address' => [
            'id' => $a->id, 'line' => $a->address_line, 'reference' => $a->reference, 'district' => $a->district, 'lat' => $a->lat !== null ? (float) $a->lat : null,
            'lng' => $a->lng !== null ? (float) $a->lng : null, 'verified_at' => $a->verified_at, 'call_signal' => $a->call_signal,
            'location_requested_at' => $a->location_requested_at, 'verify_note' => $a->verify_note,
        ]];
    }

    public static function confirmarDireccion(string $addressId, ?string $nota, User $u): void
    {
        $a = DB::table('customer_addresses')->where('id', $addressId)->first();
        if (! $a) {
            abort(404, 'No se encontró la dirección.');
        }
        if ($a->lat === null || $a->lng === null) {
            RuleError::fail('RN-DEL-14', 'No se confirma una dirección sin pin: pide la ubicación al cliente.');
        }
        DB::table('customer_addresses')->where('id', $a->id)->update(['verified_at' => now(), 'verified_by' => $u->id,
            'verify_note' => $nota ? mb_substr(trim($nota), 0, 255) : null, 'updated_at' => now()]);
    }

    public static function senal(string $addressId, ?string $valor): void
    {
        if ($valor !== null && ! in_array($valor, ['OK', 'WHATSAPP_ONLY', 'NO_SIGNAL'], true)) {
            RuleError::fail('RN-DEL-14', 'Elige cómo se contacta en esa dirección.');
        }
        DB::table('customer_addresses')->where('id', $addressId)->update(['call_signal' => $valor, 'updated_at' => now()]);
    }

    public static function pedirUbicacion(string $orderId, User $u): array
    {
        $o = DB::table('sales_orders')->where('id', $orderId)->first();
        if (! $o || ! $o->address_id) {
            RuleError::fail('RN-DEL-14', 'El pedido no tiene dirección.');
        }
        DB::table('customer_addresses')->where('id', $o->address_id)->update(['location_requested_at' => now(), 'updated_at' => now()]);
        // Mientras CRM no envíe la plantilla, la coordinación la manda con este enlace de WhatsApp.
        $tel = preg_replace('/\D/', '', (string) ($o->contact_phone ?: DB::table('customers')->where('id', $o->customer_id)->value('phone')));
        $intl = strlen($tel) === 9 ? '51'.$tel : $tel;
        $nombre = Base::primerNombre(Base::cliente($o->customer_id));
        $texto = "Hola {$nombre}, para llevarte tu pedido {$o->number} sin demoras, ¿nos compartes tu ubicación por WhatsApp (clip › Ubicación)? Gracias.";

        return ['customer_id' => $o->customer_id, 'url' => $tel !== '' ? "https://wa.me/{$intl}?text=".rawurlencode($texto) : null];
    }

    /* ---------- Ticket de entrega (DEL-18, RN-DEL-15) ---------- */

    public static function ticket(object $o): array
    {
        $lineas = DB::table('sales_order_lines as l')->leftJoin('product_variants as v', 'v.id', '=', 'l.variant_id')->where('l.sales_order_id', $o->id)
            ->orderBy('l.line_no')->get(['l.qty', 'l.unit_price', 'l.price_basis', 'l.est_weight_kg', 'l.weighed_kg', 'l.final_amount', 'l.est_amount', 'l.discount_amount', 'v.name']);
        $filas = [];
        foreach ($lineas as $l) {
            $porKg = $l->price_basis === 'KG';
            $est = $porKg ? (float) ($l->est_weight_kg ?? $l->qty) : null;
            $real = $porKg ? ($l->weighed_kg !== null ? (float) $l->weighed_kg : null) : null;
            $monto = $l->final_amount !== null ? (float) $l->final_amount : round(($porKg ? ($real ?? $est) : (float) $l->qty) * (float) $l->unit_price - (float) $l->discount_amount, 2);
            $montoEst = $l->est_amount !== null ? (float) $l->est_amount : round(($porKg ? $est : (float) $l->qty) * (float) $l->unit_price - (float) $l->discount_amount, 2);
            $filas[] = ['nombre' => $l->name, 'cantidad' => (float) $l->qty, 'por_kg' => $porKg, 'precio' => (float) $l->unit_price, 'kg_pedido' => $est, 'kg_pesado' => $real,
                'dif_kg' => $porKg && $real !== null ? round($real - $est, 3) : null, 'dif_pct' => $porKg && $real !== null && $est > 0 ? round(($real - $est) / $est * 100, 1) : null,
                'monto' => round($monto, 2), 'monto_estimado' => round($montoEst, 2)];
        }
        $sub = round(array_sum(array_column($filas, 'monto')), 2);
        $subEst = round(array_sum(array_column($filas, 'monto_estimado')), 2);
        $total = Rutas::totalPedido($o);
        $pagado = round((float) $o->paid_amount, 2);

        return ['pedido' => $o->number, 'cliente' => Base::cliente($o->customer_id), 'fecha' => $o->delivery_date, 'marca' => DB::table('brands')->where('id', $o->brand_id)->value('name'),
            'lineas' => $filas, 'subtotal' => $sub, 'subtotal_estimado' => $subEst, 'ajustes' => round($total - $sub, 2), 'delivery' => round((float) $o->delivery_fee, 2),
            'total' => $total, 'pagado' => $pagado, 'por_cobrar' => max(0, round($total - $pagado, 2)), 'diferencia_peso' => round($sub - $subEst, 2),
            'pesado' => collect($filas)->contains(fn ($f) => $f['kg_pesado'] !== null)];
    }

    public static function ticketEntregado(string $stopId, string $via, ?string $cid, User $u): array
    {
        if (Base::repetido($cid)) {
            return ['duplicate' => true];
        }
        if (! in_array($via, ['SHOWN', 'WHATSAPP'], true)) {
            RuleError::fail('RN-DEL-15', 'Indica si el ticket se mostró o se envió por WhatsApp.');
        }
        $s = Rutas::parada($stopId);
        $r = Base::rutaVisible($s->route_id, $u);
        Base::evento(['route_id' => $r->id, 'stop_id' => $s->id, 'event_type' => 'TICKET', 'client_event_id' => $cid,
            'notes' => $via === 'WHATSAPP' ? 'Ticket enviado por WhatsApp' : 'Ticket mostrado al cliente'], $u);

        return ['ok' => true];
    }

    /* ---------- Gastos del repartidor (DEL-17, RN-DEL-16) ---------- */

    public static function gasto(string $routeId, array $d, UploadedFile|string|null $foto, User $u): array
    {
        return DB::transaction(function () use ($routeId, $d, $foto, $u) {
            if (Base::repetido($d['client_event_id'] ?? null)) {
                return ['duplicate' => true];
            }
            $r = Base::rutaVisible($routeId, $u, true);
            if (! in_array($r->status, ['PLANNED', 'LOADING', 'IN_ROUTE', 'RETURNED'], true)) {
                RuleError::fail('RN-DEL-16', "La ruta {$r->code} ya está ".Base::ruta($r->status).': no se registran gastos.');
            }
            if ($r->mode === 'THIRD_PARTY') {
                RuleError::fail('RN-DEL-16', 'Las rutas de terceros no tienen gastos del repartidor.');
            }
            $cat = (string) ($d['category'] ?? '');
            Base::exigirEn($cat, self::GASTOS, 'RN-DEL-16', 'Elige el tipo de gasto.');
            $monto = round((float) ($d['amount'] ?? 0), 2);
            if ($monto <= 0) {
                RuleError::fail('RN-DEL-16', 'El monto del gasto debe ser mayor que cero.');
            }
            $con = (string) ($d['paid_with'] ?? '');
            Base::exigirEn($con, self::PAGADO_CON, 'RN-DEL-16', 'Indica con qué dinero pagaste.');
            if (in_array($cat, ['FUEL', 'EXT_COURIER'], true) && ! $foto) {
                RuleError::fail('RN-DEL-16', 'Este gasto exige la foto del comprobante o del vale.');
            }
            $nota = trim((string) ($d['note'] ?? ''));
            if ($cat === 'OTHER' && $nota === '') {
                RuleError::fail('RN-DEL-16', 'Los gastos «Otros» llevan una nota que diga en qué se gastó.');
            }
            if ($cat === 'FUEL') {
                if ((float) ($d['fuel_gallons'] ?? 0) <= 0) {
                    RuleError::fail('RN-DEL-16', 'El combustible exige los galones cargados.');
                }
                if (trim((string) ($d['voucher_no'] ?? '')) === '') {
                    RuleError::fail('RN-DEL-16', 'El combustible exige el número de vale o comprobante.');
                }
            }
            $fotoId = Base::foto($foto, null, null, $u, 'RN-DEL-16');
            [$nombre, $tipo] = self::GASTOS[$cat];
            $costo = Costos::registrar(['cost_date' => $r->route_date, 'cost_type' => $tipo, 'amount' => $monto, 'route_id' => $r->id,
                'vehicle_id' => $cat === 'FUEL' ? $r->vehicle_id : null, 'employee_ref' => $r->driver_employee_id,
                'fuel_gallons' => $d['fuel_gallons'] ?? null, 'fuel_voucher_no' => $d['voucher_no'] ?? null,
                'notes' => "Gasto del repartidor · {$nombre}".($nota !== '' ? " · {$nota}" : '')], $u, false);
            $id = DB::table('driver_expenses')->insertGetId([
                'number' => Base::numero('driver_expenses', 'GDR-'), 'route_id' => $r->id, 'driver_user_id' => $r->driver_user_id, 'expense_date' => $r->route_date,
                'category' => $cat, 'amount' => $monto, 'paid_with' => $con, 'note' => $nota !== '' ? mb_substr($nota, 0, 255) : null, 'photo_file_id' => $fotoId,
                'fuel_gallons' => $cat === 'FUEL' ? round((float) $d['fuel_gallons'], 3) : null, 'voucher_no' => $cat === 'FUEL' ? mb_substr(trim($d['voucher_no']), 0, 40) : null,
                'cost_id' => $costo->id, 'status' => 'ACTIVE', 'client_event_id' => $d['client_event_id'] ?? null, 'created_by' => $u->id,
            ], 'id');
            Base::evento(['route_id' => $r->id, 'event_type' => 'EXPENSE', 'amount' => $monto, 'photo_file_id' => $fotoId, 'client_event_id' => $d['client_event_id'] ?? null,
                'notes' => "{$nombre} ".Base::soles($monto).' · '.($con === 'ROUTE_CASH' ? 'del efectivo de ruta' : 'dinero propio')], $u);

            return ['expense' => DB::table('driver_expenses')->where('id', $id)->first()];
        });
    }

    public static function anularGasto(string $id, string $motivo, User $u): object
    {
        return DB::transaction(function () use ($id, $motivo, $u) {
            $g = DB::table('driver_expenses')->where('id', $id)->lockForUpdate()->first();
            if (! $g) {
                abort(404, 'No se encontró el gasto.');
            }
            Base::rutaVisible($g->route_id, $u);
            if ($g->status !== 'ACTIVE') {
                RuleError::fail('RN-DEL-16', 'El gasto ya está anulado.');
            }
            if ($g->settlement_id) {
                RuleError::fail('RN-DEL-16', 'El gasto ya entró en una liquidación: no se anula.');
            }
            if (mb_strlen(trim($motivo)) < 5) {
                RuleError::fail('RN-DEL-16', 'Anular un gasto exige el motivo.');
            }
            DB::table('driver_expenses')->where('id', $id)->update(['status' => 'VOIDED', 'note' => mb_substr(trim(($g->note ? $g->note.' · ' : '').'Anulado: '.$motivo), 0, 255), 'updated_at' => now()]);
            if ($g->cost_id) {
                DB::table('delivery_costs')->where('id', $g->cost_id)->update(['status' => 'VOIDED', 'void_reason' => mb_substr('Gasto anulado: '.trim($motivo), 0, 255), 'voided_at' => now(), 'voided_by' => $u->id, 'updated_at' => now()]);
            }

            return DB::table('driver_expenses')->where('id', $id)->first();
        });
    }

    /* ---------- Mensajes a control (DEL-21, DEL-22, RN-DEL-17) ---------- */

    public static function mensaje(string $routeId, array $d, UploadedFile|string|null $foto, ?UploadedFile $audio, User $u): array
    {
        return DB::transaction(function () use ($routeId, $d, $foto, $audio, $u) {
            if (Base::repetido($d['client_event_id'] ?? null)) {
                return ['duplicate' => true];
            }
            $r = Base::rutaVisible($routeId, $u);
            $tipo = (string) ($d['kind'] ?? 'TEXT');
            if (! in_array($tipo, ['TEXT', 'AUDIO', 'CAPTURE'], true)) {
                RuleError::fail('RN-DEL-17', 'Elige el tipo de mensaje.');
            }
            $texto = trim((string) ($d['text'] ?? ''));
            $parada = ! empty($d['stop_id']) ? Rutas::parada($d['stop_id']) : null;
            if ($parada && $parada->route_id !== $r->id) {
                RuleError::fail('RN-DEL-17', 'La parada no es de esa ruta.');
            }
            if ($tipo === 'TEXT' && $texto === '') {
                RuleError::fail('RN-DEL-17', 'Escribe el mensaje.');
            }
            if ($tipo === 'AUDIO' && ! $audio) {
                RuleError::fail('RN-DEL-17', 'Graba el audio antes de enviarlo.');
            }
            $monto = isset($d['amount']) && $d['amount'] !== '' ? round((float) $d['amount'], 2) : null;
            if ($tipo === 'CAPTURE') {
                if (! $foto) {
                    RuleError::fail('RN-DEL-17', 'Adjunta la captura del pago.');
                }
                if (! $monto || $monto <= 0) {
                    RuleError::fail('RN-DEL-17', 'La captura lleva el monto que aparece en ella.');
                }
            }
            $para = $d['to_role'] ?? ($tipo === 'CAPTURE' ? 'CAJERO' : 'COORDINADOR_DELIVERY');
            Base::exigirEn($para, self::DESTINOS, 'RN-DEL-17', 'Elige a quién va el mensaje.');
            $fotoId = $tipo === 'CAPTURE' ? Base::foto($foto, null, null, $u, 'RN-DEL-17') : null;
            $audioId = $tipo === 'AUDIO' ? Archivos::subir($audio, null, null, 'INTERNAL', $u)['id'] : null;
            $id = DB::table('driver_messages')->insertGetId([
                'route_id' => $r->id, 'stop_id' => $parada?->id, 'from_user_id' => $u->id, 'kind' => $tipo, 'text' => $texto !== '' ? mb_substr($texto, 0, 2000) : null,
                'audio_file_id' => $audioId, 'audio_sec' => $tipo === 'AUDIO' ? max(1, (int) ($d['audio_sec'] ?? 1)) : null, 'photo_file_id' => $fotoId,
                'amount' => $tipo === 'CAPTURE' ? $monto : null, 'to_role' => $para, 'status' => 'SENT', 'client_event_id' => $d['client_event_id'] ?? null,
            ], 'id');
            $resumen = match ($tipo) {
                'AUDIO' => 'Audio de '.max(1, (int) ($d['audio_sec'] ?? 1)).' s', 'CAPTURE' => 'Captura '.Base::soles((float) $monto), default => mb_substr($texto, 0, 60),
            };
            Base::evento(['route_id' => $r->id, 'stop_id' => $parada?->id, 'event_type' => 'MESSAGE', 'client_event_id' => $d['client_event_id'] ?? null,
                'notes' => $resumen.' → '.self::DESTINOS[$para]], $u);
            Base::avisar(['role' => $para], ($tipo === 'CAPTURE' ? 'Captura por confirmar' : 'Mensaje del reparto').' · '.$r->code,
                Base::primerNombre($u->name).': '.$resumen.($parada ? " (parada {$parada->seq})" : ''), 'DEL-22', $id, $tipo === 'CAPTURE' ? 'warn' : 'info');

            return ['message' => DB::table('driver_messages')->where('id', $id)->first()];
        });
    }

    /** DEL-22: leído, confirmado (solo capturas, con el monto recibido) o rechazado con motivo. */
    public static function responder(string $id, array $d, User $u): object
    {
        return DB::transaction(function () use ($id, $d, $u) {
            $m = DB::table('driver_messages')->where('id', $id)->lockForUpdate()->first();
            if (! $m) {
                abort(404, 'No se encontró el mensaje.');
            }
            Base::rutaVisible($m->route_id, $u);
            $estado = (string) ($d['status'] ?? '');
            if (! in_array($estado, ['READ', 'CONFIRMED', 'REJECTED'], true)) {
                RuleError::fail('RN-DEL-17', 'Elige leído, confirmado o rechazado.');
            }
            if (in_array($m->status, ['CONFIRMED', 'REJECTED'], true)) {
                RuleError::fail('RN-DEL-17', 'El mensaje ya fue atendido.');
            }
            $resp = trim((string) ($d['reply'] ?? ''));
            $conf = null;
            if ($estado === 'CONFIRMED') {
                if ($m->kind !== 'CAPTURE') {
                    RuleError::fail('RN-DEL-17', 'Solo se confirman capturas de pago.');
                }
                if (! isset($d['confirmed_amount']) || $d['confirmed_amount'] === '' || (float) $d['confirmed_amount'] < 0) {
                    RuleError::fail('RN-DEL-17', 'Escribe el monto que ves recibido para confirmar.');
                }
                $conf = round((float) $d['confirmed_amount'], 2);
                if (abs($conf - (float) $m->amount) > Base::EPS && $resp === '') {
                    RuleError::fail('RN-DEL-17', 'El monto recibido ('.Base::soles($conf).') no coincide con la captura ('.Base::soles((float) $m->amount).'): escribe el motivo.');
                }
            }
            if ($estado === 'REJECTED' && $resp === '') {
                RuleError::fail('RN-DEL-17', 'Indica por qué se rechaza.');
            }
            DB::table('driver_messages')->where('id', $id)->update(['status' => $estado, 'reply' => $resp !== '' ? mb_substr($resp, 0, 255) : $m->reply,
                'confirmed_amount' => $conf, 'ack_by' => $u->id, 'ack_at' => now(), 'updated_at' => now()]);
            if ($estado !== 'READ') {
                Base::avisar(['user_id' => $m->from_user_id], $estado === 'CONFIRMED' ? 'Captura confirmada' : 'Mensaje rechazado',
                    $resp !== '' ? $resp : 'Cobranza confirmó tu captura.', 'DEL-21', $id, $estado === 'CONFIRMED' ? 'ok' : 'bad');
            }

            return DB::table('driver_messages')->where('id', $id)->first();
        });
    }

    /* ---------- Apoyo y derivación (DEL-20, RN-DEL-18 y RN-DEL-19) ---------- */

    /** Riesgo de no llegar en la franja: minutos de atraso de la última parada abierta. */
    public static function riesgo(object $r): array
    {
        $abiertas = DB::table('delivery_stops')->where('route_id', $r->id)->whereIn('status', Base::ABIERTAS)->orderBy('seq')->get(['id', 'seq', 'eta']);
        if ($abiertas->isEmpty() || ! $r->slot_to) {
            return ['abiertas' => $abiertas->count(), 'atraso_min' => 0, 'nivel' => 'OK'];
        }
        $fin = CarbonImmutable::parse($r->route_date.' '.$r->slot_to, 'America/Lima');
        $ultima = $abiertas->last()->eta ? CarbonImmutable::parse($abiertas->last()->eta) : $fin;
        $atraso = (int) round(($ultima->getTimestamp() - $fin->getTimestamp()) / 60);

        return ['abiertas' => $abiertas->count(), 'atraso_min' => max(0, $atraso), 'eta_ultima' => $ultima->toIso8601String(),
            'nivel' => $atraso > 30 ? 'BAD' : ($atraso > 0 ? 'WARN' : 'OK')];
    }

    public static function pedirApoyo(string $routeId, array $d, User $u): array
    {
        return DB::transaction(function () use ($routeId, $d, $u) {
            if (Base::repetido($d['client_event_id'] ?? null)) {
                return ['duplicate' => true];
            }
            $r = Base::rutaVisible($routeId, $u, true);
            if ($r->status !== 'IN_ROUTE') {
                RuleError::fail('RN-DEL-18', 'El apoyo se pide con la ruta en curso.');
            }
            $ids = DB::table('delivery_stops')->where('route_id', $r->id)->whereIn('status', Base::ABIERTAS)->whereIn('id', (array) ($d['stop_ids'] ?? []))->pluck('id')->all();
            if (! $ids) {
                RuleError::fail('RN-DEL-18', 'Elige al menos una parada pendiente para el apoyo.');
            }
            $abiertos = DB::table('support_requests')->where('route_id', $r->id)->where('status', 'REQUESTED')->get(['stop_ids']);
            foreach ($abiertos as $a) {
                if (array_intersect($ids, json_decode($a->stop_ids, true) ?: [])) {
                    RuleError::fail('RN-DEL-18', 'Ya hay un pedido de apoyo abierto para alguna de esas paradas.');
                }
            }
            $motivo = trim((string) ($d['reason'] ?? '')) ?: 'Tiempo ajustado';
            $id = DB::table('support_requests')->insertGetId([
                'number' => Base::numero('support_requests', 'APY-'), 'route_id' => $r->id, 'stop_ids' => json_encode(array_values($ids)), 'reason' => mb_substr($motivo, 0, 255),
                'late_min' => isset($d['late_min']) ? (int) $d['late_min'] : (self::riesgo($r)['atraso_min'] ?: null), 'status' => 'REQUESTED', 'requested_by' => $u->id,
                'client_event_id' => $d['client_event_id'] ?? null,
            ], 'id');
            Base::evento(['route_id' => $r->id, 'event_type' => 'SUPPORT_REQUEST', 'client_event_id' => $d['client_event_id'] ?? null,
                'notes' => 'Apoyo en '.count($ids)." parada(s): {$motivo}"], $u);
            Base::avisar(['role' => 'COORDINADOR_DELIVERY'], "Apoyo pedido · {$r->code}", count($ids)." parada(s). {$motivo}", 'DEL-20', $id);

            return ['request' => DB::table('support_requests')->where('id', $id)->first()];
        });
    }

    /** Pasa una parada abierta de una ruta en curso a otra ruta (motorizado de apoyo). */
    private static function pasarParada(object $s, object $to, ?string $nota, User $u): void
    {
        $from = Rutas::ruta($s->route_id);
        DB::table('delivery_stops')->where('id', $s->id)->update(['status' => 'CANCELLED', 'closed_at' => now(), 'notes' => mb_substr("Apoyo: pasó a {$to->code}", 0, 255), 'updated_at' => now()]);
        $seq = (int) DB::table('delivery_stops')->where('route_id', $to->id)->whereIn('status', Base::EN_RUTA)->max('seq') + 1;
        $nueva = DB::table('delivery_stops')->insertGetId([
            'route_id' => $to->id, 'order_id' => $s->order_id, 'seq' => $seq, 'zone_id' => $s->zone_id, 'status' => 'PENDING', 'cod_amount' => $s->cod_amount,
            'collected_amount' => $s->collected_amount, 'delivery_code' => $s->delivery_code, 'bags' => $s->bags, 'kg' => $s->kg,
            'support_from' => mb_substr($from->code, 0, 40), 'notes' => $nota ? mb_substr($nota, 0, 255) : null,
        ], 'id');
        $num = DB::table('sales_orders')->where('id', $s->order_id)->value('number');
        Base::evento(['route_id' => $to->id, 'stop_id' => $nueva, 'event_type' => 'SUPPORT_ASSIGNED', 'notes' => "Recibe del apoyo el pedido {$num} desde {$from->code}"], $u);
        if (in_array($to->status, ['PLANNED', 'LOADING'], true)) {
            Reparto::sincronizar($s->order_id);
        }
        Rutas::calcularEta($to->id);
        Rutas::calcularEta($from->id);
    }

    public static function resolverApoyo(string $id, array $d, User $u): object
    {
        return DB::transaction(function () use ($id, $d, $u) {
            $q = DB::table('support_requests')->where('id', $id)->lockForUpdate()->first();
            if (! $q || $q->status !== 'REQUESTED') {
                RuleError::fail('RN-DEL-18', 'El pedido de apoyo ya fue atendido.');
            }
            $r = Base::rutaVisible($q->route_id, $u, true);
            $accion = (string) ($d['action'] ?? '');
            $nota = trim((string) ($d['note'] ?? ''));
            if ($accion === 'ASSIGN') {
                if (empty($d['to_route_id'])) {
                    RuleError::fail('RN-DEL-18', 'Elige la ruta que apoya.');
                }
                $to = Base::rutaVisible($d['to_route_id'], $u, true);
                if ($to->id === $r->id) {
                    RuleError::fail('RN-DEL-18', 'Elige otra ruta.');
                }
                if (! in_array($to->status, ['PLANNED', 'LOADING', 'IN_ROUTE'], true)) {
                    RuleError::fail('RN-DEL-18', "La ruta {$to->code} está ".Base::ruta($to->status).': no recibe paradas.');
                }
                foreach (json_decode($q->stop_ids, true) ?: [] as $sid) {
                    $s = DB::table('delivery_stops')->where('id', $sid)->lockForUpdate()->first();
                    if ($s && in_array($s->status, Base::ABIERTAS, true)) {
                        self::pasarParada($s, $to, $nota ?: null, $u);
                    }
                }
                DB::table('support_requests')->where('id', $id)->update(['status' => 'ASSIGNED', 'target_route_id' => $to->id, 'resolved_by' => $u->id, 'resolved_at' => now(),
                    'note' => $nota ?: null, 'updated_at' => now()]);
                if ($to->driver_user_id) {
                    Base::avisar(['user_id' => $to->driver_user_id], "Apoyo para {$r->code}", 'Se agregaron paradas a tu ruta '.$to->code.'.', 'DEL-04', $to->id, 'info');
                }
            } elseif ($accion === 'EXTERNAL') {
                DB::table('support_requests')->where('id', $id)->update(['status' => 'EXTERNAL_OK', 'resolved_by' => $u->id, 'resolved_at' => now(), 'note' => $nota ?: null, 'updated_at' => now()]);
                if ($r->driver_user_id) {
                    Base::avisar(['user_id' => $r->driver_user_id], 'Deriva con motorizado externo', "Autorizado en {$r->code}: toma las fotos del motorizado, la placa y el producto.", 'DEL-05', $r->id, 'info');
                }
            } elseif ($accion === 'REJECT') {
                if ($nota === '') {
                    RuleError::fail('RN-DEL-18', 'Indica por qué no se da el apoyo.');
                }
                DB::table('support_requests')->where('id', $id)->update(['status' => 'REJECTED', 'resolved_by' => $u->id, 'resolved_at' => now(), 'note' => $nota, 'updated_at' => now()]);
            } else {
                RuleError::fail('RN-DEL-18', 'Elige asignar a otra ruta, autorizar un motorizado externo o rechazar.');
            }

            return DB::table('support_requests')->where('id', $id)->first();
        });
    }

    /** RN-DEL-19: derivación a motorizado externo con nombre, placa y tres fotos; el costo entra como gasto. */
    public static function derivar(string $stopId, array $d, array $fotos, User $u): array
    {
        return DB::transaction(function () use ($stopId, $d, $fotos, $u) {
            if (Base::repetido($d['client_event_id'] ?? null)) {
                return ['duplicate' => true];
            }
            $s = DB::table('delivery_stops')->where('id', $stopId)->lockForUpdate()->first();
            if (! $s) {
                abort(404, 'No se encontró la parada.');
            }
            $r = Base::rutaVisible($s->route_id, $u, true);
            if ($r->status !== 'IN_ROUTE') {
                RuleError::fail('RN-DEL-19', 'La derivación se hace con la ruta en curso.');
            }
            if (! in_array($s->status, Base::ABIERTAS, true)) {
                RuleError::fail('RN-DEL-19', 'La parada ya no está abierta.');
            }
            $nombre = trim((string) ($d['courier_name'] ?? ''));
            if ($nombre === '') {
                RuleError::fail('RN-DEL-19', 'Escribe el nombre del motorizado.');
            }
            $placa = mb_strtoupper(trim((string) ($d['plate'] ?? '')));
            if (! preg_match('/^[A-Z0-9]{3,4}-?[A-Z0-9]{2,3}$/', $placa)) {
                RuleError::fail('RN-DEL-19', 'Escribe la placa del motorizado (por ejemplo 1234-AB o ABC-123).');
            }
            foreach (['courier' => 'la foto del motorizado', 'plate' => 'la foto de la placa', 'product' => 'la foto del producto que le entregas'] as $k => $m) {
                if (empty($fotos[$k])) {
                    RuleError::fail('RN-DEL-19', "Falta {$m}.");
                }
            }
            if (! isset($d['shipping_cost']) || $d['shipping_cost'] === '' || ! is_numeric($d['shipping_cost']) || (float) $d['shipping_cost'] < 0) {
                RuleError::fail('RN-DEL-19', 'Escribe el costo del envío (puede ser 0).');
            }
            $costo = round((float) $d['shipping_cost'], 2);
            $con = $d['paid_with'] ?? 'ROUTE_CASH';
            Base::exigirEn($con, self::PAGADO_CON, 'RN-DEL-19', 'Indica con qué dinero pagaste el envío.');
            $o = DB::table('sales_orders')->where('id', $s->order_id)->first();
            $ids = [];
            foreach (['courier', 'plate', 'product'] as $k) {
                $ids[$k] = Base::foto($fotos[$k], 'sales_orders', $o->id, $u, 'RN-DEL-19');
            }
            $pend = max(0.0, round((float) $s->cod_amount - (float) $s->collected_amount, 2));
            $id = DB::table('external_handoffs')->insertGetId([
                'number' => Base::numero('external_handoffs', 'DER-'), 'stop_id' => $s->id, 'route_id' => $r->id, 'order_id' => $o->id, 'courier_name' => mb_substr($nombre, 0, 120),
                'courier_phone' => ! empty($d['courier_phone']) ? mb_substr(preg_replace('/\D/', '', $d['courier_phone']), 0, 20) : null, 'plate' => $placa,
                'photo_courier' => $ids['courier'], 'photo_plate' => $ids['plate'], 'photo_product' => $ids['product'], 'shipping_cost' => $costo, 'paid_with' => $con,
                'cod_pending' => $pend, 'status' => 'HANDED', 'note' => ! empty($d['note']) ? mb_substr(trim($d['note']), 0, 255) : null,
                'client_event_id' => $d['client_event_id'] ?? null, 'created_by' => $u->id,
            ], 'id');
            DB::table('delivery_stops')->where('id', $s->id)->update(['status' => 'HANDED_OFF', 'handoff_id' => $id, 'closed_at' => now(), 'updated_at' => now()]);
            Base::evento(['route_id' => $r->id, 'stop_id' => $s->id, 'event_type' => 'HANDOFF', 'photo_file_id' => $ids['product'], 'client_event_id' => $d['client_event_id'] ?? null,
                'notes' => "Derivado a {$nombre} ({$placa}) · envío ".Base::soles($costo).($pend > 0 ? ' · cobro pendiente '.Base::soles($pend) : '')], $u);
            if ($costo > 0) {
                $g = self::gasto($r->id, ['category' => 'EXT_COURIER', 'amount' => $costo, 'paid_with' => $con, 'note' => "Derivación a {$nombre} ({$placa})"], $fotos['product'], $u);
                DB::table('external_handoffs')->where('id', $id)->update(['expense_id' => $g['expense']->id]);
            }
            Base::avisar(['role' => 'COORDINADOR_DELIVERY'], "Derivado a externo · {$o->number}", "{$nombre} ({$placa}) lleva el pedido. Confirma la entrega en Apoyo y derivaciones.", 'DEL-20', $id);

            return ['handoff' => DB::table('external_handoffs')->where('id', $id)->first()];
        });
    }

    /** El coordinador confirma si el motorizado externo entregó (con el cobro pendiente) o no. */
    public static function cerrarDerivacion(string $id, array $d, User $u): object
    {
        return DB::transaction(function () use ($id, $d, $u) {
            $h = DB::table('external_handoffs')->where('id', $id)->lockForUpdate()->first();
            if (! $h || $h->status !== 'HANDED') {
                RuleError::fail('RN-DEL-19', 'La derivación ya fue cerrada.');
            }
            $r = Base::rutaVisible($h->route_id, $u, true);
            $s = DB::table('delivery_stops')->where('id', $h->stop_id)->lockForUpdate()->first();
            $o = DB::table('sales_orders')->where('id', $h->order_id)->first();
            $nota = trim((string) ($d['note'] ?? ''));
            if (empty($d['delivered'])) {
                if ($nota === '') {
                    RuleError::fail('RN-DEL-19', 'Indica por qué no se entregó.');
                }
                DB::table('external_handoffs')->where('id', $id)->update(['status' => 'FAILED', 'closed_at' => now(), 'closed_by' => $u->id, 'note' => mb_substr($nota, 0, 255), 'updated_at' => now()]);
                DB::table('delivery_stops')->where('id', $s->id)->update(['status' => 'FAILED', 'fail_reason' => 'OTHER', 'bags_returned' => false, 'updated_at' => now()]);
                Reparto::marcar($o->id, 'RETURNED');
                Estados::noEntregado($o->id, 'OTRO', "Motorizado externo {$h->courier_name}: {$nota}", $u);
            } else {
                $pago = null;
                if ((float) $h->cod_pending > Base::EPS) {
                    $pago = App::registrarCobro($o, $r, (string) ($d['method'] ?? ''), (float) $h->cod_pending, $d['reference'] ?? null, $d['card_last4'] ?? null, $u, $u->id);
                    DB::table('delivery_stops')->where('id', $s->id)->update(['collected_amount' => round((float) $s->collected_amount + (float) $h->cod_pending, 2)]);
                }
                DB::table('external_handoffs')->where('id', $id)->update(['status' => 'DELIVERED', 'closed_at' => now(), 'closed_by' => $u->id, 'payment_id' => $pago,
                    'note' => $nota !== '' ? mb_substr($nota, 0, 255) : $h->note, 'updated_at' => now()]);
                DB::table('delivery_stops')->where('id', $s->id)->update(['status' => 'DELIVERED', 'closed_at' => now(), 'updated_at' => now()]);
                Reparto::marcar($o->id, 'DELIVERED');
                Estados::cambiar($o->id, 'DELIVERED', "Entregado por el motorizado externo {$h->courier_name} ({$h->plate})", $u);
                Seguimiento::alEntregar($o->id);
            }
            Base::evento(['route_id' => $r->id, 'stop_id' => $s->id, 'event_type' => 'HANDOFF_CLOSED', 'notes' => empty($d['delivered']) ? "No entregado: {$nota}" : 'Entrega confirmada'], $u);
            Events::emit('delivery.handoff_closed', 'external_handoffs', $id, ['delivered' => ! empty($d['delivered'])]);

            return DB::table('external_handoffs')->where('id', $id)->first();
        });
    }
}
