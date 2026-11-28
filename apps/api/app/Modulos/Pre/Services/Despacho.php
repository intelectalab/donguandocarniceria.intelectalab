<?php

namespace App\Modulos\Pre\Services;

use App\Models\User;
use App\Modulos\Ped\Services\Estados;
use App\Support\Events;
use App\Support\RuleError;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Bolsas numeradas (PRE-06), verificación con foto (PRE-07) y carga del vehículo por escaneo (PRE-08).
 *  - RN-PRE-07: cada bolsa o caja térmica lleva «n de N», pedido, ruta, parada y un código único.
 *  - RN-PRE-08: al cargar se bloquea la bolsa de otra ruta y, con pre_load_order_strict, la de una parada
 *    mientras falten bolsas de paradas posteriores (la última parada va al fondo).
 *  - RN-PRE-09: no se embolsa ni verifica con líneas incompletas; verificar exige foto y número de bolsas;
 *    no se carga un pedido sin verificar.
 *  - RN-PRE-13: con pre_verify_by_other, verifica una persona distinta de quien armó.
 */
final class Despacho
{
    /** D-PRE-03: una bolsa por cada 6 kg o 4 unidades; caja térmica para congelados y provincia. */
    public static function sugerir(object $t): array
    {
        $ls = Tareas::lineas($t->id);
        $o = DB::table('sales_orders')->where('id', $t->order_id)->first(['fulfillment']);
        $congelado = $ls->contains(fn ($l) => $l->storage === 'FROZEN');
        $kg = $ls->sum(fn ($l) => (float) ($l->weighed_kg ?? $l->est_weight_kg ?? ((float) $l->qty_required * 0.5)));
        $unidades = $ls->sum(fn ($l) => $l->sale_mode === 'KG' ? 1 : (float) $l->qty_required);
        $n = max(1, min(20, (int) ceil(max($kg / 6, $unidades / 4))));

        return ['count' => $n, 'type' => $congelado || $o->fulfillment === 'PROVINCE_SHIPPING' ? 'THERMAL_BOX' : 'BAG'];
    }

    /** CA-PRE-05: «Pedido 1045 · bolsa 2 de 3 · Ruta SURCO-B · parada 4». */
    public static function leyenda(object $b, string $numeroPedido): string
    {
        return 'Pedido '.Base::numeroCorto($numeroPedido).' · '.(Base::BOLSAS[$b->parcel_type] ?? 'bolsa')." {$b->parcel_no} de {$b->parcel_count} · Ruta "
            .($b->route_code ?: '—').' · parada '.($b->stop_seq ?? '—');
    }

    /** PRE-06: numera las bolsas del pedido armado (vuelve a numerarlas si se cambia el número antes de verificar). */
    public static function embolsar(string $taskId, ?int $cantidad, ?string $tipo, User $u): array
    {
        return DB::transaction(function () use ($taskId, $cantidad, $tipo, $u) {
            $t = Tareas::bloquear($taskId);
            if (! Base::veTarea($t, $u)) {
                abort(404, 'Tarea de preparación no encontrada.');
            }
            $o = Tareas::pedidoVivo($t);
            if (in_array($t->status, ['PENDING', 'PICKING'], true)) {
                RuleError::fail('RN-PRE-09', "El pedido {$o->number} tiene líneas incompletas sin faltante aprobado: termina el armado antes de embolsar.");
            }
            if (! in_array($t->status, ['PICKED', 'PACKED'], true)) {
                RuleError::fail('RN-PRE-07', 'La tarea ya está '.Base::tarea($t->status).': las etiquetas no cambian.');
            }
            $sug = self::sugerir($t);
            $n = $cantidad ?: $sug['count'];
            if ($n < 1 || $n > 20) {
                RuleError::fail('RN-PRE-07', 'El número de bolsas va de 1 a 20.');
            }
            $tipo = $tipo ?: $sug['type'];
            if (! array_key_exists($tipo, Base::BOLSAS)) {
                RuleError::fail('RN-PRE-07', 'Elige bolsa, caja térmica, caja o cooler.');
            }
            if (! $t->route_key) {
                $r = Olas::rutaDe($t);
                DB::table('picking_tasks')->where('id', $t->id)->update($r + ['updated_at' => now()]);
                $t = Tareas::tarea($t->id);
            }
            DB::table('shipment_parcels')->where('task_id', $t->id)->delete();
            $digitos = preg_replace('/\D/', '', $o->number) ?: strtoupper(substr($o->id, 0, 6));
            $kg = (float) DB::table('picking_task_lines')->where('task_id', $t->id)->sum(DB::raw('coalesce(weighed_kg, est_weight_kg, 0)'));
            for ($i = 1; $i <= $n; $i++) {
                $codigo = "BOL-{$digitos}-{$i}";
                if (DB::table('shipment_parcels')->where('label_code', $codigo)->where('order_id', '<>', $o->id)->exists()) {
                    $codigo = "BOL-{$digitos}-".strtoupper(substr(str_replace('-', '', $o->id), -4))."-{$i}";
                }
                DB::table('shipment_parcels')->insert([
                    'task_id' => $t->id, 'order_id' => $o->id, 'parcel_no' => $i, 'parcel_count' => $n, 'parcel_type' => $tipo, 'label_code' => $codigo,
                    'route_id' => $t->route_id, 'route_code' => $t->route_code ?? 'SIN-RUTA', 'route_key' => $t->route_key, 'stop_seq' => $t->stop_seq ?? 1,
                    'weight_kg' => $kg > 0 ? round($kg / $n, 3) : null, 'status' => 'SEALED',
                ]);
            }
            DB::table('picking_tasks')->where('id', $t->id)->update(['parcel_count' => $n, 'parcel_type' => $tipo, 'status' => 'PACKED', 'packed_at' => now(), 'updated_at' => now()]);
            Olas::recalcular($t->wave_id);

            return self::bolsas($t->id);
        });
    }

    /** Bolsas de la tarea con su leyenda. */
    public static function bolsas(string $taskId): array
    {
        $t = Tareas::tarea($taskId);
        $o = DB::table('sales_orders')->where('id', $t->order_id)->first(['number', 'customer_id', 'fulfillment']);
        $cliente = Base::cliente($o->customer_id);

        return DB::table('shipment_parcels')->where('task_id', $taskId)->orderBy('parcel_no')
            ->get(['id', 'task_id', 'order_id', 'parcel_no', 'parcel_count', 'parcel_type', 'label_code', 'route_code', 'route_key', 'stop_seq', 'weight_kg', 'status', 'loaded_at'])
            ->map(fn ($b) => (array) $b + ['leyenda' => self::leyenda($b, $o->number), 'pedido' => $o->number, 'cliente' => $cliente])->all();
    }

    /** Las reglas de verificar, sin cambiar nada (se revisan antes de subir la foto). */
    public static function revisarVerificacion(object $t, ?int $bolsas, User $u): object
    {
        $o = Tareas::pedidoVivo($t);
        if (in_array($t->status, ['PENDING', 'PICKING'], true)) {
            RuleError::fail('RN-PRE-09', "El pedido {$o->number} tiene líneas incompletas sin faltante aprobado.");
        }
        if ($t->status === 'PICKED' || ! $t->parcel_count) {
            RuleError::fail('RN-PRE-09', "Embolsa y etiqueta el pedido {$o->number} antes de verificarlo (falta el número de bolsas).");
        }
        if ($t->status !== 'PACKED') {
            RuleError::fail('RN-PRE-09', 'La tarea ya está '.Base::tarea($t->status).'.');
        }
        if ($bolsas !== null && $bolsas !== (int) $t->parcel_count) {
            RuleError::fail('RN-PRE-09', "Contaste {$bolsas} bolsas y el pedido tiene {$t->parcel_count} etiquetas: revisa antes de verificar.");
        }
        if (Base::bool('pre_verify_by_other', $t->brand_id) && $t->preparer_user_id && $t->preparer_user_id === $u->id) {
            $quien = DB::table('users')->where('id', $t->preparer_user_id)->value('name');
            RuleError::fail('RN-PRE-13', "Verifica una persona distinta de quien armó el pedido ({$quien}).");
        }
        if ($o->weight_diff_status === 'NOTICE_REQUIRED') {
            RuleError::fail('RN-PED-05', "El peso real de {$o->number} difiere del estimado más de la tolerancia: avisa al cliente (Diferencia de peso) antes de verificar.");
        }

        return $o;
    }

    /** PRE-07: otra persona revisa el pedido armado con la foto obligatoria. El pedido pasa a LISTO (PED). */
    public static function verificar(string $taskId, ?string $fotoId, ?int $bolsas, User $u): object
    {
        return DB::transaction(function () use ($taskId, $fotoId, $bolsas, $u) {
            $t = Tareas::bloquear($taskId);
            if (! Base::veTarea($t, $u)) {
                abort(404, 'Tarea de preparación no encontrada.');
            }
            if (! $fotoId) {
                RuleError::fail('RN-PRE-09', "Toma la foto del pedido {$t->order_number} armado: verificar exige la foto.");
            }
            $o = self::revisarVerificacion($t, $bolsas, $u);
            DB::table('picking_tasks')->where('id', $t->id)->update([
                'status' => 'VERIFIED', 'verified_by' => $u->id, 'verified_at' => now(), 'finished_at' => now(), 'photo_file_id' => $fotoId, 'updated_at' => now(),
            ]);
            if (in_array($o->status, ['IN_PREPARATION', 'WEIGHED'], true)) {
                Estados::cambiar($o->id, 'READY', 'Verificado por '.$u->name, $u);
            }
            Events::emit('picking_task.verified', 'picking_tasks', $t->id, ['order_id' => $o->id, 'number' => $o->number, 'parcels' => (int) $t->parcel_count]);
            Olas::recalcular($t->wave_id);

            return Tareas::tarea($t->id);
        });
    }

    /* ---------------------------------------------------------------------- carga */

    /** Nombre de una ruta para la pantalla: el código de DEL o «SURCO-B · 09:00». */
    public static function nombreRuta(?string $clave): string
    {
        if (! $clave) {
            return '—';
        }
        if (str_starts_with($clave, 'DEL:')) {
            return DB::table('delivery_routes')->where('id', substr($clave, 4))->value('code') ?? $clave;
        }
        $p = explode('|', $clave);

        return ($p[2] ?? $clave).(! empty($p[1]) ? ' · '.$p[1] : '').(! empty($p[0]) && $p[0] !== Base::hoy() ? ' · '.Base::fecha($p[0]) : '');
    }

    /** PRE-08: rutas de una fecha (con pedidos liberados) y su avance de carga, contando los pedidos que aún no tienen bolsas. */
    public static function rutas(string $fecha, User $u, ?string $local = null): array
    {
        $q = DB::table('picking_tasks as t')
            ->leftJoin('shipment_parcels as b', fn ($j) => $j->on('b.task_id', '=', 't.id')->where('b.status', '<>', 'RETURNED'))
            ->whereNotNull('t.route_key')->where('t.status', '<>', 'CANCELLED')
            ->where(fn ($x) => $x->where('t.delivery_date', $fecha)->orWhere('t.route_key', 'like', $fecha.'|%'))
            ->when($local, fn ($x, $v) => $x->where('t.establishment_id', $v));
        Base::alcanceTareas($q, $u);
        $filas = $q->groupBy('t.route_key')->selectRaw("t.route_key, count(b.id) total, count(b.id) FILTER (WHERE b.status = 'LOADED') cargadas,
            count(DISTINCT t.id) pedidos, count(DISTINCT t.id) FILTER (WHERE b.id IS NULL) sin_bolsas")
            ->orderBy('t.route_key')->get();

        return $filas->map(fn ($r) => ['route_key' => $r->route_key, 'ruta' => self::nombreRuta($r->route_key), 'total' => (int) $r->total,
            'cargadas' => (int) $r->cargadas, 'pedidos' => (int) $r->pedidos, 'sin_bolsas' => (int) $r->sin_bolsas])->all();
    }

    /** Pedidos de la ruta que aún no tienen bolsas (no se pueden cargar todavía), de la última parada a la primera. */
    private static function sinBolsas(string $clave, ?User $u = null): Collection
    {
        $q = DB::table('picking_tasks as t')->where('t.route_key', $clave)->whereNotIn('t.status', ['CANCELLED', 'LOADED'])
            ->whereNotExists(fn ($x) => $x->from('shipment_parcels as b')->whereColumn('b.task_id', 't.id')->where('b.status', '<>', 'RETURNED'));
        if ($u) {
            Base::alcanceTareas($q, $u);
        }

        return $q->orderByDesc('t.stop_seq')->orderBy('t.order_number')->get(['t.id', 't.order_number', 't.stop_seq', 't.status']);
    }

    /** Bolsas de una ruta, de la última parada a la primera (orden de carga). */
    public static function carga(string $clave, User $u): array
    {
        $q = DB::table('shipment_parcels as b')->join('picking_tasks as t', 't.id', '=', 'b.task_id')->join('sales_orders as o', 'o.id', '=', 'b.order_id')
            ->where('b.route_key', $clave)->where('t.status', '<>', 'CANCELLED')->where('b.status', '<>', 'RETURNED');
        Base::alcanceTareas($q, $u);
        $bolsas = $q->orderByDesc('b.stop_seq')->orderBy('o.number')->orderBy('b.parcel_no')
            ->get(['b.id', 'b.label_code', 'b.parcel_no', 'b.parcel_count', 'b.parcel_type', 'b.route_code', 'b.stop_seq', 'b.status', 'b.loaded_at',
                'o.number', 'o.customer_id', 't.status as task_status', 't.id as task_id']);

        $faltan = self::sinBolsas($clave, $u);

        return [
            'route_key' => $clave, 'ruta' => self::nombreRuta($clave),
            'bolsas' => $bolsas->map(fn ($b) => (array) $b + ['leyenda' => self::leyenda($b, $b->number), 'cliente' => Base::cliente($b->customer_id)])->all(),
            'total' => $bolsas->count(), 'cargadas' => $bolsas->where('status', 'LOADED')->count(),
            'sin_bolsas' => $faltan->map(fn ($t) => ['task_id' => $t->id, 'pedido' => $t->order_number, 'parada' => $t->stop_seq, 'estado' => $t->status])->values()->all(),
        ];
    }

    /** RN-PRE-08: escaneo de una bolsa al subirla al vehículo de la ruta elegida. */
    public static function cargar(string $clave, string $raw, User $u, string $dispositivo = 'WEB'): array
    {
        return DB::transaction(function () use ($clave, $raw, $u, $dispositivo) {
            $codigo = mb_strtoupper(trim($raw));
            $b = $codigo !== '' ? DB::table('shipment_parcels')->where('label_code', $codigo)->lockForUpdate()->first() : null;
            $t = $b ? Tareas::tarea($b->task_id) : null;
            if ($t && ! Base::veTarea($t, $u)) {
                $b = $t = null;
            }
            $registrar = function (string $res, ?string $regla, string $msg) use ($b, $t, $clave, $codigo, $u, $dispositivo) {
                $id = DB::table('picking_scans')->insertGetId([
                    'task_id' => $t?->id, 'scan_type' => 'LOAD', 'barcode' => mb_substr($codigo, 0, 255), 'result' => $res, 'error_code' => $regla, 'message' => $msg,
                    'parcel_id' => $b?->id, 'route_key' => mb_substr($clave, 0, 80), 'device_id' => mb_substr($dispositivo, 0, 40) ?: 'WEB', 'scanned_at' => now(),
                    'user_id' => $u->id, 'order_id' => $t?->order_id, 'wave_id' => $t?->wave_id,
                ], 'id');

                return ['result' => $res, 'ok' => $res === 'OK', 'code' => $regla, 'message' => $msg, 'scan_id' => $id, 'resultado' => Base::RESULTADOS[$res] ?? $res];
            };
            if (! $b) {
                return $registrar('UNKNOWN', 'RN-PRE-06', "La etiqueta {$codigo} no existe.");
            }
            $numero = DB::table('sales_orders')->where('id', $b->order_id)->value('number');
            $leyenda = self::leyenda($b, $numero);
            if ($t->status === 'CANCELLED' || $b->status === 'RETURNED') {
                return $registrar('LOAD_ORDER', 'RN-PRE-01', "{$leyenda}: el pedido fue cancelado. No la subas y devuélvela al almacén.");
            }
            if ($b->route_key !== $clave) {
                return $registrar('WRONG_ROUTE', 'RN-PRE-08', "{$leyenda}: es de la ruta ".self::nombreRuta($b->route_key).', no de '.self::nombreRuta($clave).'. No la subas a este vehículo.');
            }
            if ($b->status === 'LOADED') {
                return $registrar('DUPLICATE', 'RN-PRE-08', "{$leyenda} ya está cargada.");
            }
            if (! in_array($t->status, ['VERIFIED', 'LOADED'], true)) {
                return $registrar('LOAD_ORDER', 'RN-PRE-09', "El pedido {$t->order_number} no está verificado: no se carga.");
            }
            if (Base::bool('pre_load_order_strict', $t->brand_id)) {
                $despues = DB::table('shipment_parcels as p')->join('picking_tasks as x', 'x.id', '=', 'p.task_id')
                    ->where('p.route_key', $clave)->where('p.status', 'SEALED')->where('p.stop_seq', '>', $b->stop_seq)->where('x.status', '<>', 'CANCELLED')
                    ->pluck('p.stop_seq');
                // Un pedido de una parada posterior que aún no tiene bolsas también va antes: si no, quedaría encima de esta.
                $sinArmar = self::sinBolsas($clave)->filter(fn ($x) => $x->stop_seq !== null && $x->stop_seq > $b->stop_seq);
                if ($sinArmar->isNotEmpty()) {
                    $lista = $sinArmar->map(fn ($x) => "{$x->order_number} (parada {$x->stop_seq})")->implode(', ');

                    return $registrar('LOAD_ORDER', 'RN-PRE-08', "Orden de carga: antes van {$lista}, que aún no tiene".($sinArmar->count() > 1 ? 'n' : '')
                        .' bolsas. Termina de armarlos y embolsarlos primero.');
                }
                if ($despues->isNotEmpty()) {
                    $paradas = $despues->unique()->sortDesc()->values()->implode(', ');
                    $varias = $despues->unique()->count() > 1;

                    return $registrar('LOAD_ORDER', 'RN-PRE-08', "Orden de carga: faltan {$despues->count()} bolsa(s) de la".($varias ? 's' : '').' parada'.($varias ? 's' : '')
                        ." {$paradas}. Se cargan primero: la última parada va al fondo.");
                }
            }
            DB::table('shipment_parcels')->where('id', $b->id)->update(['status' => 'LOADED', 'loaded_at' => now(), 'loaded_by' => $u->id, 'updated_at' => now()]);
            $r = $registrar('OK', null, "{$leyenda} cargada.");
            $r['task_loaded'] = false;
            $pendientes = DB::table('shipment_parcels')->where('task_id', $t->id)->where('status', '<>', 'LOADED')->count();
            if ($pendientes === 0) {
                DB::table('picking_tasks')->where('id', $t->id)->update(['status' => 'LOADED', 'loaded_at' => now(), 'updated_at' => now()]);
                Events::emit('order.loaded', 'sales_orders', $t->order_id, ['number' => $t->order_number, 'route_key' => $clave, 'route_id' => $b->route_id,
                    'parcels' => (int) DB::table('shipment_parcels')->where('task_id', $t->id)->count()]);
                Olas::recalcular($t->wave_id);
                $r['task_loaded'] = true;
            }

            return $r;
        });
    }
}
