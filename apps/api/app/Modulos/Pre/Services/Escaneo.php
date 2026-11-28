<?php

namespace App\Modulos\Pre\Services;

use App\Models\User;
use App\Modulos\Alm\Services\InventarioService;
use App\Modulos\Alm\Services\ReservasService;
use App\Modulos\Cat\Services\Balanza;
use App\Modulos\Ped\Services\Estados;
use App\Modulos\Ped\Services\Pesos;
use App\Support\Events;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * Armado con escaneo (PRE-04), autorizaciones FEFO (PRE-12) y faltantes (PRE-09).
 * Cada lectura queda en picking_scans (de solo inserción), también las bloqueadas:
 *  - RN-PRE-03: producto que no está en el pedido → «pedido cruzado» si es de otro pedido de la ola, si no «producto equivocado».
 *  - RN-PRE-04: solo lotes liberados y vigentes; un producto con lote exige el lote.
 *  - RN-PRE-05: FEFO entre los lotes liberados con stock de los almacenes de venta del local, salvo autorización (pre.fefo.override).
 *  - RN-PRE-06: exceso sobre lo pedido, etiqueta de balanza leída dos veces y código desconocido.
 *  - RN-PRE-10: lo que se vende por peso exige el peso del paquete; al completar la línea, el peso va a PED (order.weighed).
 */
final class Escaneo
{
    /**
     * Qué es un código: etiqueta de balanza, lote, SKU o código de barras.
     *
     * @param  list<string>  $preferidas  variantes del pedido (desempatan códigos repetidos)
     * @return array{tipo: string, codigo: string, variant_id?: string, lot_id?: string, weight_kg?: ?float}
     */
    public static function leer(string $raw, array $preferidas = []): array
    {
        $c = mb_strtoupper(preg_replace('/\s+/', '', $raw));
        if ($c === '') {
            return ['tipo' => 'UNKNOWN', 'codigo' => $c];
        }
        $f = Balanza::formato();
        if (preg_match('/^\d{13}$/', $c) && str_starts_with($c, (string) $f['prefix'])) {
            $b = Balanza::leer($c, $f);
            if ($b['ok'] && $b['variant']) {
                return ['tipo' => 'SCALE', 'codigo' => $c, 'variant_id' => $b['variant']->id, 'weight_kg' => $b['weight_kg']];
            }
        }
        $orden = fn ($q, string $col) => $preferidas
            ? $q->orderByRaw('CASE WHEN '.$col.' IN ('.implode(',', array_fill(0, count($preferidas), '?')).') THEN 0 ELSE 1 END', $preferidas)
            : $q;
        $lote = $orden(DB::table('lots')->whereRaw('upper(code) = ?', [$c]), 'variant_id')->first(['id', 'variant_id']);
        if ($lote) {
            return ['tipo' => 'LOT', 'codigo' => $c, 'variant_id' => $lote->variant_id, 'lot_id' => $lote->id];
        }
        $v = $orden(DB::table('product_variants')->where(fn ($q) => $q->whereRaw('upper(sku) = ?', [$c])->orWhere('barcode', $c)), 'id')
            ->orderByRaw("CASE status WHEN 'ACTIVE' THEN 0 ELSE 1 END")->first(['id']);
        if ($v) {
            return ['tipo' => 'SKU', 'codigo' => $c, 'variant_id' => $v->id];
        }

        return ['tipo' => 'UNKNOWN', 'codigo' => $c];
    }

    /**
     * Lotes que se pueden tomar para el pedido, primero el que vence antes (FEFO): liberados, vigentes,
     * con vida suficiente a la entrega y con disponible en los almacenes de venta del local. Cuenta lo
     * reservado para este mismo pedido como suyo y descuenta lo ya escaneado sin descontar del stock.
     *
     * @return list<array{lot_id: string, lot_code: string, expiry_date: ?string, disponible: float, almacen: string}>
     */
    public static function lotesFefo(object $t, string $variantId): array
    {
        $o = DB::table('sales_orders')->where('id', $t->order_id)->first(['id', 'establishment_id', 'delivery_date']);
        $entrega = $o->delivery_date && $o->delivery_date >= Base::hoy() ? $o->delivery_date : Base::hoy();
        $filas = InventarioService::lotesDisponibles($variantId, ['establishment_id' => $o->establishment_id, 'delivery_date' => $entrega, 'incluir_reservado' => true]);
        $propias = DB::table('stock_reservations')->where('order_id', $o->id)->where('status', 'ACTIVE')->groupBy('balance_id')
            ->selectRaw('balance_id, sum(qty) q')->pluck('q', 'balance_id');
        $escaneado = $t->stock_moved ? collect() : DB::table('picking_scans')->where('task_id', $t->id)->where('scan_type', 'PICK')->where('result', 'OK')
            ->whereNotNull('lot_id')->groupBy('lot_id')->selectRaw('lot_id, sum(coalesce(qty, 1)) q')->pluck('q', 'lot_id');
        $por = [];
        foreach ($filas as $f) {
            if (! $f->lot_id) {
                continue;
            }
            $libre = (float) $f->qty - (float) $f->reserved_qty + (float) ($propias[$f->balance_id] ?? 0);
            $e = $por[$f->lot_id] ??= ['lot_id' => $f->lot_id, 'lot_code' => $f->lot_code, 'expiry_date' => $f->expiry_date, 'disponible' => 0.0, 'almacen' => $f->warehouse_code];
            $por[$f->lot_id]['disponible'] = $e['disponible'] + $libre;
        }
        $r = [];
        foreach ($por as $id => $e) {
            $e['disponible'] = Base::q($e['disponible'] - (float) ($escaneado[$id] ?? 0));
            if ($e['disponible'] > Base::EPS) {
                $r[] = $e;
            }
        }
        usort($r, fn ($a, $b) => strcmp((string) $a['expiry_date'], (string) $b['expiry_date']));

        return $r;
    }

    /**
     * PRE-04: una lectura contra el pedido. Devuelve el resultado (OK o el motivo del bloqueo) y el avance.
     *
     * @param  array{code: string, lot_code?: ?string, weight_kg?: mixed, qty?: mixed, device?: ?string}  $d
     * @param  array{by: string, of: string, reason: ?string}|null  $autorizacion  autorización FEFO de la supervisora
     */
    public static function escanear(string $taskId, array $d, User $u, ?array $autorizacion = null): array
    {
        return DB::transaction(function () use ($taskId, $d, $u, $autorizacion) {
            $t = Tareas::bloquear($taskId);
            if (! Base::veTarea($t, $u)) {
                abort(404, 'Tarea de preparación no encontrada.');
            }
            $o = Tareas::pedidoVivo($t);
            $w = $t->wave_id ? DB::table('picking_waves')->where('id', $t->wave_id)->first() : null;
            if (! $w || in_array($w->status, ['DRAFT', 'CANCELLED'], true)) {
                RuleError::fail('RN-PRE-02', "El pedido {$o->number} todavía no está en una ola liberada.");
            }
            if (! in_array($t->status, ['PENDING', 'PICKING'], true)) {
                RuleError::fail('RN-PRE-09', "La tarea del pedido {$o->number} ya está ".Base::tarea($t->status).': no admite más paquetes.');
            }
            if (! in_array($o->status, Base::PEDIDO_ARMABLE, true)) {
                RuleError::fail('RN-PRE-01', "El pedido {$o->number} está ".Estados::nombre($o->status).'.');
            }

            $lineas = Tareas::lineas($t->id);
            $p = self::leer((string) ($d['code'] ?? ''), $lineas->pluck('variant_id')->unique()->values()->all());
            $lote = ! empty($p['lot_id']) ? DB::table('lots')->where('id', $p['lot_id'])->first() : null;
            if (! $lote && ! empty($d['lot_code'])) {
                $lc = mb_strtoupper(trim((string) $d['lot_code']));
                $lote = DB::table('lots')->whereRaw('upper(code) = ?', [$lc])
                    ->when(! empty($p['variant_id']), fn ($q) => $q->orderByRaw('CASE WHEN variant_id = ? THEN 0 ELSE 1 END', [$p['variant_id']]))->first();
                if (! $lote && preg_match('/^[0-9a-f-]{36}$/i', $lc)) {
                    $lote = DB::table('lots')->where('id', strtolower($lc))->first();
                }
                if (! $lote) {
                    RuleError::fail('RN-PRE-04', "No existe el lote «{$d['lot_code']}».");
                }
            }
            $v = ! empty($p['variant_id']) ? DB::table('product_variants as v')->join('products as pr', 'pr.id', '=', 'v.product_id')
                ->where('v.id', $p['variant_id'])->first(['v.id', 'v.name', 'v.sku', 'v.sale_mode', 'v.brand_id', 'pr.requires_lot']) : null;
            $peso = $p['weight_kg'] ?? null;
            if ($peso === null && isset($d['weight_kg']) && $d['weight_kg'] !== '' && $d['weight_kg'] !== null) {
                $peso = Base::q($d['weight_kg']);
            }

            $registrar = function (string $res, ?string $regla, string $msg, array $extra = []) use ($t, $o, $p, $v, $lote, $peso, $u, $d, $autorizacion) {
                $id = DB::table('picking_scans')->insertGetId(array_merge([
                    'task_id' => $t->id, 'task_line_id' => null, 'scan_type' => 'PICK', 'barcode' => mb_substr($p['codigo'] !== '' ? $p['codigo'] : (string) ($d['code'] ?? ''), 0, 255),
                    'variant_id' => $v?->id, 'lot_id' => $lote?->id, 'weight_kg' => $peso, 'qty' => null, 'result' => $res, 'error_code' => $regla,
                    'message' => $msg, 'override_by' => $autorizacion['by'] ?? null, 'override_of' => $autorizacion['of'] ?? null,
                    'override_reason' => isset($autorizacion['reason']) ? mb_substr((string) $autorizacion['reason'], 0, 255) : null,
                    'device_id' => mb_substr((string) ($d['device'] ?? 'WEB'), 0, 40) ?: 'WEB', 'scanned_at' => now(), 'user_id' => $u->id,
                    'order_id' => $o->id, 'wave_id' => $t->wave_id,
                ], $extra), 'id');

                return ['result' => $res, 'ok' => $res === 'OK', 'code' => $regla, 'message' => $msg, 'scan_id' => $id,
                    'resultado' => Base::RESULTADOS[$res] ?? $res];
            };

            if ($p['tipo'] === 'UNKNOWN' || ! $v) {
                return $registrar('UNKNOWN', 'RN-PRE-06', "Código desconocido «{$p['codigo']}»: no es un lote, SKU, código de barras ni etiqueta de balanza.");
            }
            if ($p['tipo'] === 'SCALE' && DB::table('picking_scans')->where('barcode', $p['codigo'])->where('scan_type', 'PICK')->where('result', 'OK')->exists()) {
                return $registrar('DUPLICATE', 'RN-PRE-06', "La etiqueta de balanza {$p['codigo']} ya se leyó: cada paquete pesado tiene su propia etiqueta.");
            }
            $marcaNota = $v->brand_id !== $o->brand_id
                ? ' Es de '.DB::table('brands')->where('id', $v->brand_id)->value('name').' y el pedido es de '.DB::table('brands')->where('id', $o->brand_id)->value('name').'.' : '';
            $mias = $lineas->where('variant_id', $v->id)->values();
            if ($mias->isEmpty()) {
                $otra = DB::table('picking_tasks as x')->join('picking_task_lines as l', 'l.task_id', '=', 'x.id')
                    ->where('x.wave_id', $t->wave_id)->where('x.id', '<>', $t->id)->where('x.status', '<>', 'CANCELLED')->where('l.variant_id', $v->id)
                    ->first(['x.order_number', 'x.order_id']);
                if ($otra) {
                    $cli = Base::cliente(DB::table('sales_orders')->where('id', $otra->order_id)->value('customer_id'));

                    return $registrar('WRONG_ORDER', 'RN-PRE-03', "Pedido cruzado: {$v->name} es del pedido {$otra->order_number}".($cli ? " ({$cli})" : '').", no del {$o->number}. No lo pongas en esta bolsa.{$marcaNota}");
                }

                return $registrar('WRONG_PRODUCT', 'RN-PRE-03', "Producto equivocado: {$v->name} no está en el pedido {$o->number}.{$marcaNota}");
            }
            if ($lote && $lote->variant_id !== $v->id) {
                $otro = DB::table('product_variants')->where('id', $lote->variant_id)->value('name');

                return $registrar('WRONG_PRODUCT', 'RN-ALM-08', "El lote {$lote->code} es de {$otro}, no de {$v->name}.");
            }
            if ($v->requires_lot && ! $lote) {
                return $registrar('LOT_NOT_RELEASED', 'RN-PRE-04', "{$v->name} se controla por lote: escanea la etiqueta del lote o escribe su código.");
            }
            if ($lote) {
                $vencido = $lote->expiry_date && substr($lote->expiry_date, 0, 10) < Base::hoy();
                if ($lote->qc_status !== 'RELEASED' || $vencido) {
                    $estado = $vencido ? 'vencido' : match ($lote->qc_status) {
                        'QUARANTINE' => 'en cuarentena', 'BLOCKED' => 'bloqueado', 'REJECTED' => 'rechazado', 'RECALLED' => 'retirado', default => mb_strtolower($lote->qc_status),
                    };

                    return $registrar('LOT_NOT_RELEASED', 'RN-PRE-04', "El lote {$lote->code} está {$estado}: solo se prepara con lotes liberados. Sepáralo y avisa al almacén.");
                }
            }
            $linea = $mias->first(fn ($l) => ! Tareas::lineaCompleta($l, $o->brand_id)) ?? $mias->first();
            if (Tareas::lineaCompleta($linea, $o->brand_id)) {
                $hecho = $linea->sale_mode === 'KG' ? (float) $linea->weighed_kg : (float) $linea->qty_picked;

                return $registrar('EXCESS', 'RN-PRE-06', "Exceso: la línea de {$v->name} ya está completa (".Base::cant($hecho, $v->sale_mode).' de '.Base::cant((float) $linea->qty_required, $v->sale_mode).').', ['task_line_id' => $linea->id]);
            }
            if ($lote && ! $autorizacion) {
                $mejor = collect(self::lotesFefo($t, $v->id))->first(fn ($c) => $c['lot_id'] !== $lote->id && (string) $c['expiry_date'] < (string) substr((string) $lote->expiry_date, 0, 10));
                if ($mejor) {
                    return $registrar('NOT_FEFO', 'RN-PRE-05', 'FEFO: hay '.Base::cant($mejor['disponible'], $v->sale_mode)." del lote {$mejor['lot_code']} que vence el ".Base::fecha($mejor['expiry_date']).", antes que {$lote->code} (".Base::fecha($lote->expiry_date).'). Toma ese lote o pide autorización a la supervisora.',
                        ['task_line_id' => $linea->id, 'suggested_lot_id' => $mejor['lot_id']]);
                }
            }
            $pesado = $v->sale_mode !== 'UNIT';
            if ($pesado && ! ($peso > 0)) {
                RuleError::fail('RN-PRE-10', "{$v->name} se vende por peso: lee la etiqueta de balanza o escribe el peso del paquete.");
            }
            if ($pesado && $peso > 99.999) {
                RuleError::fail('RN-PRE-10', 'El peso de un paquete no puede pasar de 99,999 kg: revisa el número.');
            }
            // Unidades: un paquete por lectura (o varias iguales a la vez, sin pasar lo que falta).
            $suma = 1.0;
            if ($v->sale_mode === 'KG') {
                $suma = (float) $peso;
            } elseif ($v->sale_mode === 'UNIT' && isset($d['qty']) && $d['qty'] !== '' && $d['qty'] !== null) {
                $suma = (float) (int) $d['qty'];
                if ($suma < 1) {
                    RuleError::fail('RN-PRE-06', 'La cantidad de paquetes debe ser al menos 1.');
                }
                $falta = (float) $linea->qty_required - (float) $linea->qty_picked;
                if ($suma > $falta + Base::EPS) {
                    return $registrar('EXCESS', 'RN-PRE-06', 'Exceso: faltan '.Base::cant($falta, 'UNIT')." de {$v->name} y leíste ".Base::cant($suma, 'UNIT').'.', ['task_line_id' => $linea->id]);
                }
            }

            // Correcto
            $nuevoPicked = Base::q((float) $linea->qty_picked + $suma);
            $nuevoPeso = $pesado ? Base::q((float) ($linea->weighed_kg ?? 0) + (float) $peso) : $linea->weighed_kg;
            $linea->qty_picked = $nuevoPicked;
            $linea->weighed_kg = $nuevoPeso;
            $completa = Tareas::lineaCompleta($linea, $o->brand_id);
            DB::table('picking_task_lines')->where('id', $linea->id)->update([
                'qty_picked' => $nuevoPicked, 'weighed_kg' => $nuevoPeso, 'status' => $completa ? 'DONE' : 'PARTIAL', 'updated_at' => now(),
            ]);
            DB::table('picking_tasks')->where('id', $t->id)->update([
                'status' => 'PICKING', 'started_at' => $t->started_at ?? now(), 'preparer_user_id' => $t->preparer_user_id ?? $u->id, 'updated_at' => now(),
            ]);
            if ($w->status === 'RELEASED') {
                DB::table('picking_waves')->where('id', $w->id)->update(['status' => 'PICKING', 'updated_at' => now()]);
            }
            $msg = $v->name.($peso ? ' · '.Base::cant((float) $peso, 'KG') : '').($suma > 1 && $v->sale_mode === 'UNIT' ? ' · '.Base::cant($suma, 'UNIT') : '')
                .($lote ? " · lote {$lote->code}" : '')." → pedido {$o->number}";
            $r = $registrar('OK', null, $msg, ['task_line_id' => $linea->id, 'qty' => $suma]);

            if ($completa && $pesado && $linea->price_basis === 'KG') {
                $o2 = Pesos::registrar($o->id, [['line_id' => $linea->order_line_id, 'weighed_kg' => $nuevoPeso]], $u, $p['tipo'] === 'SCALE' ? 'SCALE' : 'MANUAL');
                $ev = collect(Pesos::evaluar($o2)['lineas'])->firstWhere('line_id', $linea->order_line_id);
                if ($ev && $ev['excede']) {
                    $r['over'] = true;
                    $r['diff_pct'] = $ev['diferencia_pct'];
                    $r['message'] .= ' · Diferencia de peso '.($ev['diferencia_pct'] > 0 ? '+' : '').number_format($ev['diferencia_pct'], 1, ',', '.').' %: supera la tolerancia; hay que avisar al cliente (Diferencia de peso).';
                }
            }
            $r['line'] = ['id' => $linea->id, 'qty_picked' => $nuevoPicked, 'weighed_kg' => $nuevoPeso, 'complete' => $completa];
            $r['finished'] = false;
            if (Tareas::lineas($t->id)->every(fn ($l) => Tareas::lineaCompleta($l, $o->brand_id))) {
                self::terminarArmado($t->id, $u);
                $r['finished'] = true;
            }

            return $r;
        });
    }

    /** PRE-12: la supervisora autoriza el lote bloqueado por FEFO; la lectura se repite con su autorización. */
    public static function autorizarFefo(string $scanId, ?string $motivo, User $u): array
    {
        return DB::transaction(function () use ($scanId, $motivo, $u) {
            $s = self::lecturaFefo($scanId, $u);

            return self::escanear($s->task_id, ['code' => $s->barcode, 'lot_code' => $s->lot_id, 'weight_kg' => $s->weight_kg, 'device' => 'WEB'], $u,
                ['by' => $u->id, 'of' => $s->id, 'reason' => trim((string) $motivo) ?: 'Autorizado por la supervisora']);
        });
    }

    /** PRE-12: la supervisora pide tomar el lote que vence antes. */
    public static function negarFefo(string $scanId, ?string $motivo, User $u): array
    {
        return DB::transaction(function () use ($scanId, $motivo, $u) {
            $s = self::lecturaFefo($scanId, $u);
            $msg = 'La supervisora pidió tomar el lote que vence antes'.(trim((string) $motivo) !== '' ? ': '.trim($motivo) : '.');
            DB::table('picking_scans')->insert([
                'task_id' => $s->task_id, 'task_line_id' => $s->task_line_id, 'scan_type' => 'PICK', 'barcode' => $s->barcode, 'variant_id' => $s->variant_id,
                'lot_id' => $s->lot_id, 'weight_kg' => $s->weight_kg, 'result' => 'NOT_FEFO', 'error_code' => 'OVERRIDE_DENIED', 'message' => $msg,
                'override_by' => $u->id, 'override_of' => $s->id, 'override_reason' => $motivo ? mb_substr(trim($motivo), 0, 255) : null,
                'suggested_lot_id' => $s->suggested_lot_id, 'device_id' => 'WEB', 'scanned_at' => now(), 'user_id' => $u->id, 'order_id' => $s->order_id, 'wave_id' => $s->wave_id,
            ]);

            return ['result' => 'NOT_FEFO', 'ok' => false, 'message' => $msg];
        });
    }

    private static function lecturaFefo(string $scanId, User $u): object
    {
        // Las lecturas son de solo inserción: se bloquea la tarea para que dos supervisoras no resuelvan a la vez.
        $s = DB::table('picking_scans')->where('id', $scanId)->first();
        if (! $s || $s->result !== 'NOT_FEFO' || $s->override_of !== null || $s->task_id === null) {
            RuleError::fail('RN-PRE-05', 'Esa lectura no está bloqueada por FEFO.');
        }
        Tareas::bloquear($s->task_id);
        $t = Tareas::visible($s->task_id, $u);
        if (DB::table('picking_scans')->where('override_of', $s->id)->exists()) {
            RuleError::fail('RN-PRE-05', 'Esta lectura ya fue resuelta.');
        }
        if (! in_array($t->status, ['PENDING', 'PICKING'], true)) {
            RuleError::fail('RN-PRE-05', "La tarea del pedido {$t->order_number} ya está ".Base::tarea($t->status).': no hace falta autorizar.');
        }

        return $s;
    }

    /* ------------------------------------------------------------------ faltantes */

    /** PRE-09: quien arma registra el faltante de una línea con su motivo; avisa a la supervisora de almacén. */
    public static function pedirFaltante(string $lineId, string $motivo, User $u): object
    {
        return DB::transaction(function () use ($lineId, $motivo, $u) {
            [$l, $t] = self::lineaYTarea($lineId, $u);
            $motivo = trim($motivo);
            if (mb_strlen($motivo) < 5) {
                RuleError::fail('RN-PRE-12', 'El faltante exige un motivo (por ejemplo «no hay stock en cámara»).');
            }
            if (in_array($l->status, ['DONE', 'SHORT_APPROVED'], true)) {
                RuleError::fail('RN-PRE-12', 'La línea ya está completa.');
            }
            if (! in_array($t->status, ['PENDING', 'PICKING'], true)) {
                RuleError::fail('RN-PRE-12', "La tarea del pedido {$t->order_number} ya está ".Base::tarea($t->status).'.');
            }
            Tareas::pedidoVivo($t);
            DB::table('picking_task_lines')->where('id', $l->id)->update([
                'short_reason' => mb_substr($motivo, 0, 255), 'short_requested_by' => $u->id, 'short_requested_at' => now(), 'updated_at' => now(),
            ]);
            $nombre = DB::table('product_variants')->where('id', $l->variant_id)->value('name');
            Base::avisar(['role' => 'ALMACENERO'], "Faltante por aprobar · {$t->order_number}", "{$nombre}: {$motivo}", 'PRE-09', $t->id);

            return DB::table('picking_task_lines')->where('id', $l->id)->first();
        });
    }

    /**
     * RN-PRE-12: la supervisora aprueba el faltante (nunca quien prepara el pedido). La línea queda
     * completa con lo que se armó; si se cobra por kg, el peso armado va a PED. La vendedora recibe el aviso.
     */
    public static function aprobarFaltante(string $lineId, User $u): object
    {
        return DB::transaction(function () use ($lineId, $u) {
            [$l, $t] = self::lineaYTarea($lineId, $u);
            if (! $l->short_reason) {
                RuleError::fail('RN-PRE-12', 'Primero se registra el faltante con su motivo.');
            }
            if ($l->status === 'SHORT_APPROVED') {
                RuleError::fail('RN-PRE-12', 'El faltante ya está aprobado.');
            }
            if (! in_array($t->status, ['PENDING', 'PICKING'], true)) {
                RuleError::fail('RN-PRE-12', "La tarea del pedido {$t->order_number} ya está ".Base::tarea($t->status).'.');
            }
            if ($t->preparer_user_id === $u->id || $l->short_requested_by === $u->id) {
                RuleError::fail('RN-PRE-12', 'Un faltante no lo aprueba quien prepara el pedido: lo aprueba otra supervisora.');
            }
            $o = Tareas::pedidoVivo($t);
            $hecho = $l->sale_mode === 'KG' ? (float) ($l->weighed_kg ?? 0) : (float) $l->qty_picked;
            $falta = Base::q(max(0, (float) $l->qty_required - $hecho));
            DB::table('picking_task_lines')->where('id', $l->id)->update([
                'status' => 'SHORT_APPROVED', 'short_approved_by' => $u->id, 'short_approved_at' => now(), 'short_qty' => $falta, 'updated_at' => now(),
            ]);
            if ($l->weighted && $l->price_basis === 'KG' && in_array($o->status, ['IN_PREPARATION', 'WEIGHED'], true)) {
                // Sin nada armado, el peso mínimo deja el importe de la línea en casi cero.
                Pesos::registrar($o->id, [['line_id' => $l->order_line_id, 'weighed_kg' => max(0.001, (float) ($l->weighed_kg ?? 0))]], $u, 'MANUAL');
            }
            $texto = "{$l->name}: faltan ".Base::cant($falta, $l->sale_mode)." ({$l->short_reason}). Coordina con ".(Base::cliente($o->customer_id) ?? 'el cliente').'.';
            Base::avisar($o->seller_id ? ['user_id' => $o->seller_id] : ['role' => 'SUPERVISORA_VENTAS'], "Faltante en el pedido {$o->number}", $texto, 'PED-03', $o->id);
            Events::emit('picking.short_approved', 'picking_task_lines', $l->id, ['order_id' => $o->id, 'number' => $o->number, 'variant_id' => $l->variant_id, 'short_qty' => $falta]);
            if (Tareas::lineas($t->id)->every(fn ($x) => Tareas::lineaCompleta($x, $t->brand_id))) {
                self::terminarArmado($t->id, $u);
            }

            return DB::table('picking_task_lines')->where('id', $l->id)->first();
        });
    }

    /** La supervisora no aprueba el faltante: la línea vuelve a armarse (por ejemplo, con otro lote). */
    public static function rechazarFaltante(string $lineId, ?string $motivo, User $u): object
    {
        return DB::transaction(function () use ($lineId, $motivo, $u) {
            [$l, $t] = self::lineaYTarea($lineId, $u);
            if (! $l->short_reason || $l->status === 'SHORT_APPROVED') {
                RuleError::fail('RN-PRE-12', 'No hay un faltante pendiente en esa línea.');
            }
            DB::table('picking_task_lines')->where('id', $l->id)->update(['short_reason' => null, 'short_requested_by' => null, 'short_requested_at' => null, 'updated_at' => now()]);
            if ($l->short_requested_by) {
                Base::avisar(['user_id' => $l->short_requested_by], "Faltante no aprobado · {$t->order_number}",
                    "{$l->name}: sigue armando la línea".(trim((string) $motivo) !== '' ? '. '.trim($motivo) : '.'), 'PRE-04', $t->id);
            }

            return DB::table('picking_task_lines')->where('id', $l->id)->first();
        });
    }

    private static function lineaYTarea(string $lineId, User $u): array
    {
        $l = DB::table('picking_task_lines')->where('id', $lineId)->lockForUpdate()->first();
        if (! $l) {
            abort(404, 'Línea no encontrada.');
        }
        $t = Tareas::visible($l->task_id, $u);
        $l = Tareas::lineas($t->id)->firstWhere('id', $l->id);

        return [$l, $t];
    }

    /* ------------------------------------------------------- fin del armado y stock */

    /**
     * Armado completo (RN-PRE-09): la tarea pasa a ARMADA y el stock sale de lo escaneado (lote por lote).
     * Si el stock no se puede descontar (saldo insuficiente…), el armado igual termina y queda el motivo
     * para que el almacén lo resuelva y lo descuente desde Lista por pedido.
     */
    public static function terminarArmado(string $taskId, User $u): object
    {
        return DB::transaction(function () use ($taskId, $u) {
            $t = Tareas::bloquear($taskId);
            if (! Tareas::lineas($t->id)->every(fn ($l) => Tareas::lineaCompleta($l, $t->brand_id))) {
                RuleError::fail('RN-PRE-09', "El pedido {$t->order_number} tiene líneas incompletas sin faltante aprobado.");
            }
            DB::table('picking_tasks')->where('id', $t->id)->update(['status' => 'PICKED', 'picked_at' => now(), 'updated_at' => now()]);
            if (! $t->stock_moved) {
                self::intentarDescontar($t->id, $u);
            }
            Events::emit('picking_task.picked', 'picking_tasks', $t->id, ['order_id' => $t->order_id, 'number' => $t->order_number]);
            Olas::recalcular($t->wave_id);

            return Tareas::tarea($t->id);
        });
    }

    /** Descuenta el stock y, si falla, guarda el motivo en la tarea sin deshacer el armado. */
    public static function intentarDescontar(string $taskId, User $u): bool
    {
        try {
            DB::transaction(fn () => self::descontar($taskId, $u));
            DB::table('picking_tasks')->where('id', $taskId)->update(['stock_moved' => true, 'stock_error' => null, 'updated_at' => now()]);

            return true;
        } catch (RuleError $e) {
            DB::table('picking_tasks')->where('id', $taskId)->update(['stock_error' => mb_substr($e->getMessage(), 0, 500), 'updated_at' => now()]);

            return false;
        }
    }

    /** Reintento a mano desde Lista por pedido (PRE-03), cuando el almacén ya corrigió el saldo. */
    public static function reintentarStock(string $taskId, User $u): object
    {
        return DB::transaction(function () use ($taskId, $u) {
            $t = Tareas::bloquear($taskId);
            if (! Base::veTarea($t, $u)) {
                abort(404, 'Tarea de preparación no encontrada.');
            }
            if ($t->stock_moved) {
                RuleError::fail('RN-PRE-09', 'El stock de este pedido ya se descontó.');
            }
            if (! in_array($t->status, ['PICKED', 'PACKED', 'VERIFIED', 'LOADED'], true)) {
                RuleError::fail('RN-PRE-09', 'El stock se descuenta al terminar el armado.');
            }
            Tareas::pedidoVivo($t);
            DB::transaction(fn () => self::descontar($t->id, $u));
            DB::table('picking_tasks')->where('id', $t->id)->update(['stock_moved' => true, 'stock_error' => null, 'updated_at' => now()]);

            return Tareas::tarea($t->id);
        });
    }

    /**
     * Salida de venta por lo escaneado: se liberan las reservas del pedido (ALM) y sale cada lote leído
     * desde los almacenes de venta del local, en orden de prioridad de recojo. Todo o nada.
     */
    private static function descontar(string $taskId, User $u): void
    {
        $t = Tareas::tarea($taskId);
        $o = DB::table('sales_orders')->where('id', $t->order_id)->first(['id', 'number', 'establishment_id']);
        ReservasService::liberar($o->id, "Preparado en PRE: sale lo escaneado del pedido {$o->number}", $u);
        $almacenes = DB::table('warehouses')->where('establishment_id', $o->establishment_id)->where('allows_sale', true)->where('status', 'ACTIVE')
            ->orderBy('pick_priority')->pluck('id')->all();
        $lecturas = DB::table('picking_scans')->where('task_id', $t->id)->where('scan_type', 'PICK')->where('result', 'OK')->get();
        foreach ($lecturas->groupBy(fn ($s) => $s->variant_id.'|'.($s->lot_id ?? '')) as $grupo) {
            $s0 = $grupo->first();
            $q = Base::q($grupo->sum(fn ($s) => (float) ($s->qty ?? 1)));
            $pesoTotal = $grupo->every(fn ($s) => $s->weight_kg !== null) ? Base::q($grupo->sum('weight_kg')) : null;
            $q0 = $q;
            $saldos = DB::table('stock_balances')->where('variant_id', $s0->variant_id)->whereIn('warehouse_id', $almacenes)->where('qty', '>', Base::EPS)
                ->when($s0->lot_id, fn ($x) => $x->where('lot_id', $s0->lot_id), fn ($x) => $x->whereNull('lot_id'))
                ->orderByRaw('array_position(?::uuid[], warehouse_id)', ['{'.implode(',', $almacenes).'}'])->get(['warehouse_id', 'qty', 'reserved_qty']);
            foreach ($saldos as $b) {
                if ($q <= Base::EPS) {
                    break;
                }
                $libre = (float) $b->qty - (float) $b->reserved_qty;
                $toma = Base::q(min($q, $libre));
                if ($toma <= Base::EPS) {
                    continue;
                }
                InventarioService::mover([
                    'type' => 'SALE', 'warehouse_id' => $b->warehouse_id, 'variant_id' => $s0->variant_id, 'lot_id' => $s0->lot_id, 'qty' => $toma,
                    'weight_kg' => $pesoTotal !== null ? Base::q($pesoTotal * $toma / $q0) : null,
                    'source_type' => 'SALES_ORDER', 'source_id' => $o->id, 'reason' => "Preparación del pedido {$o->number}",
                ], $u);
                $q = Base::q($q - $toma);
            }
            if ($q > Base::EPS) {
                $v = DB::table('product_variants')->where('id', $s0->variant_id)->first(['name', 'sale_mode']);
                $lote = $s0->lot_id ? DB::table('lots')->where('id', $s0->lot_id)->value('code') : null;
                RuleError::fail('RN-ALM-03', 'No hay saldo disponible para descontar '.Base::cant($q, $v->sale_mode)." de {$v->name}".($lote ? " (lote {$lote})" : '').' en los almacenes de venta del local.');
            }
        }
    }
}
