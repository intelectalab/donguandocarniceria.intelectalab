<?php

namespace App\Modulos\Grj\Services;

use App\Models\User;
use App\Modulos\Com\Services\ComprobantesService;
use App\Modulos\Com\Services\OrdenesService;
use App\Modulos\Com\Services\RecepcionesService;
use App\Modulos\Com\Services\Soporte as C;
use App\Modulos\Plt\Services\Periodos;
use App\Support\Access;
use App\Support\Events;
use App\Support\Params;
use App\Support\RuleError;
use Carbon\CarbonImmutable;
use Illuminate\Database\QueryException;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * GRJ · Integración con la granja relacionada.
 *  RN-GRJ-01  los vínculos de un proveedor no se superponen (también en la base, EXCLUDE).
 *  RN-GRJ-02  el documento esperado lo decide la fecha (vínculo vigente), no quien emite.
 *  RN-GRJ-03  NTI solo con el mismo RUC de la empresa; con otro RUC, INVOICE.
 *  RN-GRJ-04  un envío se identifica por su clave (tenant de la granja + tipo + número): no se duplica (también en la base).
 *  RN-GRJ-05  no se recibe un ítem sin mapear: el envío queda RECEIVED_PENDING.
 *  RN-GRJ-06  cada línea recibida crea su lote local con origen FARM y los datos de origen de la granja.
 *  RN-GRJ-07  diferencia de peso sobre grj_weight_tolerance_pct exige motivo y deja el envío DISPUTED.
 *  RN-GRJ-08  la NTI se valoriza al precio de transferencia sin IGV.
 *  RN-GRJ-09  la conciliación mensual no se cierra con diferencias sin motivo o en disputa.
 *  RN-GRJ-10  el cambio a factura cierra el NTI en la fecha de corte y abre INVOICE desde el día siguiente.
 *  RN-GRJ-11  la entrada se guarda cruda; si no se pudo procesar queda con su error visible.
 */
final class GranjaService
{
    public const ESTADOS = ['RECEIVED_PENDING' => 'Por recibir', 'RECEIVED' => 'Recibido', 'DISPUTED' => 'En disputa', 'RECONCILED' => 'Conciliado', 'ERROR' => 'Con error'];

    public static function tolerancia(): float
    {
        return (float) (Params::get('grj_weight_tolerance_pct') ?? 1);
    }

    private static function soloFecha(?string $s): string
    {
        return $s ? substr(CarbonImmutable::parse($s)->setTimezone('America/Lima')->toDateTimeString(), 0, 10) : C::hoy();
    }

    /** El proveedor de la granja relacionada (el primero si hay varios). */
    public static function granja(?string $supplierId = null): ?object
    {
        return DB::table('suppliers')->where('supplier_type', 'RELATED_FARM')->when($supplierId, fn ($q, $v) => $q->where('id', $v))->orderBy('created_at')->first();
    }

    /* ============================================================ vínculos (GRJ-01) */

    public static function vinculoEn(string $supplierId, string $fecha): ?object
    {
        return DB::table('farm_links')->where('supplier_id', $supplierId)->where('status', '<>', 'CLOSED')->where('valid_from', '<=', $fecha)
            ->where(fn ($q) => $q->whereNull('valid_to')->orWhere('valid_to', '>=', $fecha))->orderByDesc('valid_from')->first();
    }

    /** grj_expected_doc_type: NTI o INVOICE según el vínculo vigente en la fecha (RN-GRJ-02). */
    public static function documentoEsperado(string $supplierId, string $fecha): ?string
    {
        return self::vinculoEn($supplierId, substr($fecha, 0, 10))?->mode;
    }

    public static function crearVinculo(array $d, User $quien, bool $sistema = false): object
    {
        if (! $sistema && ! Access::can($quien, 'grj.link.manage')) {
            C::permiso($quien, 'grj.link.manage', 'crear vínculos con la granja');
        }
        $s = DB::table('suppliers')->where('id', $d['supplier_id'] ?? null)->first() ?? RuleError::fail('RN-GRJ-03', 'Elige el proveedor de la granja.');
        $modo = $d['mode'] ?? null;
        if (! in_array($modo, ['NTI', 'INVOICE'], true)) {
            RuleError::fail('RN-GRJ-03', 'El modo es NTI (misma empresa) o factura.');
        }
        $desde = $d['valid_from'] ?? null;
        $hasta = $d['valid_to'] ?? null;
        if (! $desde) {
            RuleError::fail('RN-GRJ-01', 'Indica desde cuándo rige el vínculo.');
        }
        if ($hasta && $hasta < $desde) {
            RuleError::fail('RN-GRJ-01', 'La vigencia termina antes de empezar.');
        }
        $empresa = DB::table('companies')->where('id', $d['company_id'] ?? null)->first() ?? DB::table('companies')->where('ruc', $s->doc_number)->first()
            ?? DB::table('companies')->orderBy('legal_name')->first();
        $ruc = trim((string) ($d['farm_ruc'] ?? ($modo === 'NTI' ? $s->doc_number : '')));
        if ($modo === 'NTI' && $ruc !== $empresa->ruc) {
            RuleError::fail('RN-GRJ-03', 'Un vínculo NTI solo vale si la granja tiene el mismo RUC de la empresa ('.$empresa->ruc.'); '.C::nombreProveedor($s).' tiene '
                .($ruc ?: 'otro RUC').': el modo debe ser con factura.');
        }
        if ($modo === 'INVOICE') {
            if (! C::rucValido($ruc)) {
                RuleError::fail('RN-GRJ-03', 'Con factura, la granja necesita su RUC propio válido ('.($ruc ?: 'vacío').').');
            }
            if ($ruc === $empresa->ruc) {
                RuleError::fail('RN-GRJ-03', 'Con el mismo RUC de la empresa no hay factura entre ambas: el modo es NTI.');
            }
        }
        $choque = DB::table('farm_links')->where('supplier_id', $s->id)->where('status', '<>', 'CLOSED')
            ->where('valid_from', '<=', $hasta ?? '9999-12-31')->where(fn ($q) => $q->whereNull('valid_to')->orWhere('valid_to', '>=', $desde))->first();
        if ($choque) {
            RuleError::fail('RN-GRJ-01', 'Se superpone con el vínculo '.($choque->mode === 'NTI' ? 'NTI' : 'con factura').' vigente del '.C::dmy($choque->valid_from).' '
                .($choque->valid_to ? 'al '.C::dmy($choque->valid_to) : 'sin fin').': los vínculos de un mismo proveedor no se superponen.');
        }
        try {
            $id = DB::table('farm_links')->insertGetId([
                'supplier_id' => $s->id, 'company_id' => $empresa->id, 'mode' => $modo, 'valid_from' => $desde, 'valid_to' => $hasta,
                'farm_tenant_ref' => $d['farm_tenant_ref'] ?? 'granja-donguando', 'farm_ruc' => $ruc, 'farm_legal_name' => $d['farm_legal_name'] ?? $s->legal_name,
                'connector_status' => $d['connector_status'] ?? 'FAKE', 'status' => 'ACTIVE', 'created_by' => $quien->id, 'notes' => $d['notes'] ?? null,
            ], 'id');
        } catch (QueryException $e) {
            if (str_contains($e->getMessage(), 'farm_links_sin_superponer')) {
                RuleError::fail('RN-GRJ-01', 'Se superpone con otro vínculo del mismo proveedor.');
            }
            throw $e;
        }
        Events::emit('farm_link.created', 'farm_links', $id, ['mode' => $modo, 'valid_from' => $desde]);

        return DB::table('farm_links')->find($id);
    }

    public static function cerrarVinculo(string $id, string $hasta, User $quien): object
    {
        $l = DB::table('farm_links')->where('id', $id)->first() ?? abort(404);
        if ($hasta < $l->valid_from) {
            RuleError::fail('RN-GRJ-01', 'El fin no puede ser anterior al inicio del vínculo.');
        }
        DB::table('farm_links')->where('id', $id)->update(['valid_to' => $hasta, 'notes' => trim(($l->notes ? $l->notes.' · ' : '')."Terminado el {$hasta} por {$quien->name}"), 'updated_at' => now()]);

        return DB::table('farm_links')->find($id);
    }

    /** GRJ-06: cambio a factura en la fecha de corte (RN-GRJ-10). */
    public static function cambioAFactura(array $d, User $quien): array
    {
        return DB::transaction(function () use ($d, $quien) {
            C::permiso($quien, 'grj.link.manage', 'hacer el cambio a factura');
            $s = self::granja($d['supplier_id'] ?? null) ?? RuleError::fail('RN-GRJ-10', 'No hay un proveedor de granja relacionada.');
            $corte = $d['cut_date'] ?? null;
            if (! $corte) {
                RuleError::fail('RN-GRJ-10', 'Elige la fecha de corte.');
            }
            $siguiente = CarbonImmutable::parse($corte)->addDay();
            if ($siguiente->day !== 1) {
                RuleError::fail('RN-GRJ-10', 'La fecha de corte debe ser el último día de un mes ('.C::dmy($corte).' no lo es).');
            }
            $nti = self::vinculoEn($s->id, $corte);
            if (! $nti || $nti->mode !== 'NTI') {
                RuleError::fail('RN-GRJ-10', 'No hay un vínculo NTI vigente en la fecha de corte.');
            }
            $despues = DB::table('farm_dispatches')->where('farm_link_id', $nti->id)->whereRaw("(dispatched_at AT TIME ZONE 'America/Lima')::date > ?", [$corte])->first();
            if ($despues) {
                RuleError::fail('RN-GRJ-10', "Ya hay una NTI posterior al corte ({$despues->farm_document_number}): elige un corte posterior.");
            }
            if (Periodos::cerrado($siguiente->toDateString(), $nti->company_id)) {
                RuleError::fail('RN-GRJ-10', 'El día siguiente al corte cae en un período cerrado.');
            }
            $hastaAntes = $nti->valid_to;
            DB::table('farm_links')->where('id', $nti->id)->update(['valid_to' => $corte, 'notes' => trim(($nti->notes ? $nti->notes.' · ' : '').'Cambio a factura: NTI hasta el '.C::dmy($corte)), 'updated_at' => now()]);
            $inv = self::crearVinculo([
                'supplier_id' => $s->id, 'company_id' => $nti->company_id, 'mode' => 'INVOICE', 'valid_from' => $siguiente->toDateString(),
                'valid_to' => $hastaAntes && $hastaAntes > $corte ? $hastaAntes : null, 'farm_ruc' => $d['new_ruc'] ?? null, 'farm_legal_name' => $d['legal_name'] ?? 'GRANJA DON GUANDO SAC',
                'farm_tenant_ref' => $nti->farm_tenant_ref, 'connector_status' => $nti->connector_status, 'notes' => 'Cambio a factura: corte '.C::dmy($corte),
            ], $quien, true);
            Events::emit('farm_link.spin_off', 'farm_links', $inv->id, ['cut_date' => $corte, 'new_ruc' => $inv->farm_ruc]);

            return ['closed' => DB::table('farm_links')->find($nti->id), 'opened' => $inv];
        });
    }

    /** Deshace un cambio a factura que todavía no rige y sin envíos. */
    public static function deshacerCambio(User $quien): object
    {
        return DB::transaction(function () use ($quien) {
            C::permiso($quien, 'grj.link.manage', 'deshacer el cambio a factura');
            $s = self::granja() ?? abort(404);
            $inv = DB::table('farm_links')->where('supplier_id', $s->id)->where('mode', 'INVOICE')->where('status', '<>', 'CLOSED')->orderByDesc('valid_from')->first();
            if (! $inv) {
                RuleError::fail('RN-GRJ-10', 'No hay un cambio a factura programado.');
            }
            if ($inv->valid_from <= C::hoy()) {
                RuleError::fail('RN-GRJ-10', 'El vínculo con factura ya rige: no se deshace.');
            }
            if (DB::table('farm_dispatches')->where('farm_link_id', $inv->id)->exists()) {
                RuleError::fail('RN-GRJ-10', 'Ya hay envíos con factura.');
            }
            DB::table('farm_links')->where('id', $inv->id)->update(['status' => 'CLOSED', 'notes' => 'Programación deshecha', 'updated_at' => now()]);
            $nti = DB::table('farm_links')->where('supplier_id', $s->id)->where('mode', 'NTI')->where('status', '<>', 'CLOSED')
                ->where('valid_to', CarbonImmutable::parse($inv->valid_from)->subDay()->toDateString())->first();
            if ($nti) {
                DB::table('farm_links')->where('id', $nti->id)->update(['valid_to' => null, 'updated_at' => now()]);
            }

            return DB::table('farm_links')->find($inv->id);
        });
    }

    /* ============================================================ mapeo (GRJ-02) */

    public static function mapeo(string $supplierId, string $codigo): ?object
    {
        return DB::table('farm_product_mappings')->where('supplier_id', $supplierId)->where('farm_item_code', $codigo)->where('status', 'ACTIVE')->first();
    }

    public static function mapear(array $d, User $quien): object
    {
        return DB::transaction(function () use ($d, $quien) {
            $s = self::granja($d['supplier_id'] ?? null) ?? RuleError::fail('RN-GRJ-05', 'No hay un proveedor de granja relacionada.');
            if (empty($d['farm_item_code']) || empty($d['variant_id'])) {
                RuleError::fail('RN-GRJ-05', 'Indica el código de la granja y la variante de Aycha.');
            }
            DB::table('product_variants')->where('id', $d['variant_id'])->exists() || RuleError::fail('RN-GRJ-05', 'La variante no existe.');
            $factor = (float) ($d['conversion_factor'] ?? 1);
            if ($factor <= 0) {
                RuleError::fail('RN-GRJ-05', 'El factor de conversión debe ser mayor que cero.');
            }
            $ex = DB::table('farm_product_mappings')->where('supplier_id', $s->id)->where('farm_item_code', $d['farm_item_code'])->where('status', 'ACTIVE')->first();
            $fila = ['variant_id' => $d['variant_id'], 'farm_item_name' => $d['farm_item_name'] ?? $ex->farm_item_name ?? $d['farm_item_code'], 'conversion_factor' => $factor,
                'transfer_price' => isset($d['transfer_price']) && $d['transfer_price'] !== '' ? C::r($d['transfer_price'], 6) : ($ex->transfer_price ?? 0), 'status' => $d['status'] ?? 'ACTIVE',
                'updated_at' => now()];
            if ($ex) {
                DB::table('farm_product_mappings')->where('id', $ex->id)->update($fila);
                $id = $ex->id;
            } else {
                $id = DB::table('farm_product_mappings')->insertGetId($fila + ['supplier_id' => $s->id, 'farm_item_code' => $d['farm_item_code']], 'id');
            }
            foreach (DB::table('farm_dispatches')->where('status', 'RECEIVED_PENDING')->whereNull('purchase_document_id')->pluck('id') as $pendiente) {
                self::procesar($pendiente, $quien);
            }

            return DB::table('farm_product_mappings')->find($id);
        });
    }

    /** Ítems que llegaron de la granja y no tienen mapeo activo. */
    public static function sinMapear(): Collection
    {
        return DB::table('farm_dispatch_lines as l')->join('farm_dispatches as d', 'd.id', '=', 'l.dispatch_id')->leftJoin('farm_links as k', 'k.id', '=', 'd.farm_link_id')
            ->whereNotExists(fn ($e) => $e->from('farm_product_mappings as m')->whereColumn('m.farm_item_code', 'l.farm_item_code')->whereColumn('m.supplier_id', 'k.supplier_id')->where('m.status', 'ACTIVE'))
            ->groupBy('l.farm_item_code')->selectRaw('l.farm_item_code as code, max(l.farm_item_name) as name, count(*) as count, sum(l.sent_weight_kg) as kg, max(l.unit_price) as unit_price')
            ->orderBy('l.farm_item_code')->get();
    }

    /* ============================================================ envíos (GRJ-03) */

    /** Entrada de un envío (webhook o carga manual). Idempotente por clave (RN-GRJ-04). */
    public static function ingresar(array $p, ?User $quien, string $origen = 'WEBHOOK'): array
    {
        return DB::transaction(function () use ($p, $quien, $origen) {
            $clave = ($p['farm_tenant'] ?? '?').':'.($p['document_type'] ?? '?').':'.($p['document_number'] ?? '?');
            DB::select('SELECT pg_advisory_xact_lock(hashtext(?))', ['grj:'.$clave]);
            $dup = DB::table('farm_dispatches')->where('idempotency_key', $clave)->first();
            if ($dup) {
                DB::table('farm_dispatches')->where('id', $dup->id)->update(['duplicates_received' => (int) $dup->duplicates_received + 1, 'last_duplicate_at' => now()]);

                return ['duplicate' => true, 'dispatch' => self::ver($dup->id)];
            }
            $vinc0 = DB::table('farm_links')->where('farm_tenant_ref', $p['farm_tenant'] ?? null)->where('status', '<>', 'CLOSED')->orderByDesc('valid_from')->first();
            $sid = $vinc0->supplier_id ?? self::granja()?->id;
            $fecha = self::soloFecha($p['dispatched_at'] ?? null);
            $vinc = ($sid ? self::vinculoEn($sid, $fecha) : null) ?? $vinc0;
            $esperado = $sid ? self::documentoEsperado($sid, $fecha) : null;
            $lineas = $p['lines'] ?? [];
            $id = DB::table('farm_dispatches')->insertGetId([
                'farm_link_id' => $vinc->id ?? null, 'idempotency_key' => $clave, 'farm_document_type' => $p['document_type'] ?? 'NTI', 'farm_document_number' => $p['document_number'] ?? '—',
                'dispatched_at' => isset($p['dispatched_at']) ? CarbonImmutable::parse($p['dispatched_at'], 'America/Lima') : now(), 'expected_doc_type' => $esperado,
                'total_sent_kg' => C::r(array_sum(array_map(fn ($l) => (float) ($l['weight_kg'] ?? 0), $lineas)), 3),
                'total_value' => C::r(array_sum(array_map(fn ($l) => (float) ($l['weight_kg'] ?? 0) * (float) ($l['unit_price'] ?? 0), $lineas))),
                'raw_payload' => json_encode($p, JSON_UNESCAPED_UNICODE), 'status' => 'RECEIVED_PENDING', 'source' => $origen, 'arrived_at' => now(), 'order_ref' => $p['order_ref'] ?? null,
                'duplicates_received' => 0, 'was_disputed' => false,
            ], 'id');
            if ($vinc) {
                DB::table('farm_links')->where('id', $vinc->id)->update(['last_webhook_at' => now()]);
            }
            $error = fn (string $m) => DB::table('farm_dispatches')->where('id', $id)->update(['status' => 'ERROR', 'error_message' => $m]);
            if (($p['signature_valid'] ?? true) === false) {
                $error('La firma del envío no es válida: se guardó tal como llegó y no se procesó. Pide a la granja reenviarlo.');
            } elseif (! $vinc) {
                $error('No hay un vínculo vigente con la granja para la fecha del envío.');
            } elseif (! $lineas) {
                $error('El envío llegó sin líneas.');
            } elseif ($esperado && ($p['document_type'] ?? null) !== $esperado) {
                $error('El '.C::dmy($fecha).' el documento esperado es '.($esperado === 'NTI' ? 'NTI sin IGV' : 'factura del RUC de la granja').' y llegó '.($p['document_type'] ?? '—')
                    .'. El tipo lo decide la fecha, no quien emite.');
            } else {
                foreach ($lineas as $l) {
                    $m = self::mapeo($sid, (string) ($l['item_code'] ?? ''));
                    DB::table('farm_dispatch_lines')->insert([
                        'dispatch_id' => $id, 'farm_item_code' => $l['item_code'] ?? '?', 'farm_item_name' => $l['item_name'] ?? ($l['item_code'] ?? '?'), 'farm_lot_code' => $l['lot_code'] ?? '—',
                        'farm_origin' => json_encode($l['origin'] ?? (object) [], JSON_UNESCAPED_UNICODE), 'sent_qty' => isset($l['qty']) ? (float) $l['qty'] : null,
                        'sent_weight_kg' => C::r($l['weight_kg'] ?? 0, 3), 'unit_price' => C::r(($l['unit_price'] ?? 0) ?: ($m->transfer_price ?? 0), 6), 'mapping_id' => $m->id ?? null,
                    ]);
                }
                self::procesar($id, $quien);
            }
            Events::emit('farm_dispatch.arrived', 'farm_dispatches', $id, ['number' => $p['document_number'] ?? null]);

            return ['duplicate' => false, 'dispatch' => self::ver($id)];
        });
    }

    /** Vuelve a procesar un envío: mapeo y comprobante en COM (NTI sin IGV o factura con IGV según la fecha). */
    public static function procesar(string $id, ?User $quien, bool $forzar = false): object
    {
        $d = DB::table('farm_dispatches')->where('id', $id)->first() ?? abort(404);
        if ($d->purchase_document_id) {
            return $d;
        }
        $vinc = DB::table('farm_links')->where('id', $d->farm_link_id)->first();
        if ($d->status === 'ERROR' && ! $forzar && (! $vinc || ! DB::table('farm_dispatch_lines')->where('dispatch_id', $id)->exists())) {
            return $d;
        }
        $sid = $vinc->supplier_id ?? self::granja()->id;
        foreach (DB::table('farm_dispatch_lines')->where('dispatch_id', $id)->get() as $l) {
            $m = self::mapeo($sid, $l->farm_item_code);
            if ($m && $l->mapping_id !== $m->id) {
                DB::table('farm_dispatch_lines')->where('id', $l->id)->update(['mapping_id' => $m->id, 'unit_price' => (float) $l->unit_price ?: (float) $m->transfer_price, 'updated_at' => now()]);
            }
        }
        $lineas = DB::table('farm_dispatch_lines')->where('dispatch_id', $id)->get();
        $sin = $lineas->whereNull('mapping_id');
        if ($sin->isNotEmpty()) {
            DB::table('farm_dispatches')->where('id', $id)->update(['status' => 'RECEIVED_PENDING', 'error_message' => 'Ítems sin mapear: '
                .$sin->map(fn ($l) => "{$l->farm_item_code} ({$l->farm_item_name})")->implode(', ').'. Mapéalos en Mapeo de productos para recibir el envío.', 'updated_at' => now()]);

            return DB::table('farm_dispatches')->find($id);
        }
        $fecha = self::soloFecha($d->dispatched_at);
        $modo = $d->expected_doc_type ?? self::documentoEsperado($sid, $fecha) ?? 'NTI';
        [$serie, $numero] = array_pad(explode('-', (string) $d->farm_document_number, 2), 2, null);
        $local = DB::table('warehouses')->where('id', self::almacenDestino())->value('establishment_id');
        $quien ??= User::find($vinc->created_by ?? null) ?? User::query()->first();
        try {
            $doc = DB::transaction(fn () => ComprobantesService::registrar([
                'supplier_id' => $sid, 'doc_type' => $modo === 'NTI' ? 'INTERNAL_TRANSFER' : 'INVOICE', 'series' => $serie ?: 'NI01', 'number' => $numero ?: $d->farm_document_number,
                'issue_date' => $fecha, 'accounting_date' => $fecha, 'establishment_id' => $local, 'farm_dispatch_id' => $id, 'notes' => "Envío de la granja {$d->farm_document_number}",
                'lines' => $lineas->map(function ($l) {
                    $m = DB::table('farm_product_mappings')->find($l->mapping_id);

                    return ['variant_id' => $m->variant_id, 'description' => "{$l->farm_item_name} · lote granja {$l->farm_lot_code}", 'qty' => (float) $l->sent_weight_kg, 'unit_price' => (float) $l->unit_price];
                })->all(),
            ], $quien));
            DB::table('farm_dispatches')->where('id', $id)->update(['purchase_document_id' => $doc->id, 'status' => $d->status === 'ERROR' ? 'RECEIVED_PENDING' : $d->status,
                'error_message' => null, 'updated_at' => now()]);
        } catch (RuleError $e) {
            DB::table('farm_dispatches')->where('id', $id)->update(['status' => 'ERROR', 'error_message' => $e->getMessage(), 'updated_at' => now()]);
        }

        return DB::table('farm_dispatches')->find($id);
    }

    public static function almacenDestino(): ?string
    {
        return DB::table('warehouses')->where('code', 'CAM-L2')->value('id') ?? DB::table('warehouses')->where('wh_type', 'COLD_ROOM')->orderBy('code')->value('id');
    }

    /* ============================================================ recepción (GRJ-04) */

    /** Diferencia en % de los kg recibidos frente a los enviados. */
    public static function diferencia(float $enviado, float $recibido): float
    {
        return $enviado ? round(($recibido - $enviado) / $enviado * 100, 3) : 0.0;
    }

    /**
     * @param  array{warehouse_id?: string, received_at?: string, vehicle_temp_c?: mixed, scale_equipment_id?: string, inspection_result?: string,
     *               lines: array<int, array{id: string, received_weight_kg: mixed, received_qty?: mixed, temp_c?: mixed, reason?: ?string, decision?: string}>}  $x
     */
    public static function recibir(string $id, array $x, User $quien): object
    {
        return DB::transaction(function () use ($id, $x, $quien) {
            $d = DB::table('farm_dispatches')->where('id', $id)->lockForUpdate()->first() ?? abort(404);
            if ($d->status !== 'RECEIVED_PENDING') {
                RuleError::fail('RN-GRJ-05', "El envío {$d->farm_document_number} está «".(self::ESTADOS[$d->status] ?? $d->status).'»: no está por recibir.');
            }
            $ls = DB::table('farm_dispatch_lines')->where('dispatch_id', $id)->orderBy('created_at')->orderBy('farm_item_code')->get();
            $sin = $ls->whereNull('mapping_id');
            if ($sin->isNotEmpty()) {
                RuleError::fail('RN-GRJ-05', 'No se recibe una línea con un ítem de la granja sin mapear: '.$sin->pluck('farm_item_code')->implode(', ').'. Mapéalo primero.');
            }
            if (! $d->purchase_document_id) {
                $d = self::procesar($id, $quien, true);
                if (! $d->purchase_document_id) {
                    RuleError::fail('RN-GRJ-11', $d->error_message ?: 'El envío aún no tiene su documento.');
                }
            }
            $entradas = collect($x['lines'] ?? [])->keyBy('id');
            $tol = self::tolerancia();
            $evals = [];
            foreach ($ls as $l) {
                $e = $entradas[$l->id] ?? [];
                if (! isset($e['received_weight_kg']) || $e['received_weight_kg'] === '' || (float) $e['received_weight_kg'] < 0) {
                    RuleError::fail('RN-GRJ-07', "Registra los kg recibidos de {$l->farm_item_name}.");
                }
                $kg = (float) $e['received_weight_kg'];
                $dp = self::diferencia((float) $l->sent_weight_kg, $kg);
                $motivo = trim((string) ($e['reason'] ?? ''));
                $fuera = abs($dp) > $tol + 1e-9;
                if ($fuera && $motivo === '') {
                    RuleError::fail('RN-GRJ-07', "{$l->farm_item_name}: se enviaron ".C::kg($l->sent_weight_kg).' y llegaron '.C::kg($kg).' ('.($dp > 0 ? '+' : '').C::pct($dp, 2).'), más que la tolerancia de '
                        .C::pct($tol, 0).': indica el motivo; el envío quedará en disputa con la granja.');
                }
                $evals[] = compact('l', 'e', 'kg', 'dp', 'motivo', 'fuera');
            }
            $vinc = DB::table('farm_links')->find($d->farm_link_id);
            $sid = $vinc->supplier_id ?? self::granja()->id;
            $cuando = isset($x['received_at']) ? CarbonImmutable::parse($x['received_at'], 'America/Lima') : C::ahora();
            $rc = RecepcionesService::registrar([
                'supplier_id' => $sid, 'warehouse_id' => $x['warehouse_id'] ?? self::almacenDestino(), 'received_at' => $cuando->toIso8601String(),
                'vehicle_temp_c' => $x['vehicle_temp_c'] ?? null, 'carrier_guide' => $d->farm_document_number, 'scale_equipment_id' => $x['scale_equipment_id'] ?? null,
                'inspection_result' => $x['inspection_result'] ?? 'PENDING', 'receipt_type' => ($d->expected_doc_type ?? 'NTI') === 'NTI' ? 'FARM_NTI' : 'FARM_INVOICE',
                'farm_dispatch_id' => $id, 'notes' => "Envío de la granja {$d->farm_document_number}",
                'lines' => array_map(function ($v) use ($d, $cuando) {
                    $m = DB::table('farm_product_mappings')->find($v['l']->mapping_id);
                    $var = DB::table('product_variants')->find($m->variant_id);
                    $factor = (float) $m->conversion_factor ?: 1;
                    $qty = match ($var->sale_mode) {
                        'KG' => $v['kg'] * $factor,
                        'UNIT_VARIABLE_WEIGHT' => (float) ($v['e']['received_qty'] ?? 0) ?: ((float) $v['l']->sent_qty ?: round($v['kg'] / max(0.001, (float) $var->nominal_weight_kg ?: 1))),
                        default => (float) ($v['e']['received_qty'] ?? 0) ?: (float) $v['l']->sent_qty,
                    };
                    $origen = json_decode($v['l']->farm_origin ?: '{}', true) ?: [];

                    return ['variant_id' => $m->variant_id, 'qty' => $qty, 'weight_kg' => $v['kg'] * $factor, 'temp_c' => $v['e']['temp_c'] ?? null, 'price_basis' => 'KG',
                        'unit_price' => (float) $v['l']->unit_price / $factor, 'decision' => $v['e']['decision'] ?? 'ACCEPT', 'farm_lot_code' => $v['l']->farm_lot_code,
                        'farm_origin' => ['granja_documento' => $d->farm_document_number] + $origen, 'supplier_lot_code' => $v['l']->farm_lot_code,
                        'production_date' => $origen['fecha_beneficio'] ?? $cuando->toDateString()];
                }, $evals),
            ], $quien);
            foreach ($evals as $i => $v) {
                DB::table('farm_dispatch_lines')->where('id', $v['l']->id)->update([
                    'received_qty' => isset($v['e']['received_qty']) && $v['e']['received_qty'] !== '' ? (float) $v['e']['received_qty'] : $v['l']->sent_qty,
                    'received_weight_kg' => C::r($v['kg'], 3), 'temp_c' => isset($v['e']['temp_c']) && $v['e']['temp_c'] !== '' ? (float) $v['e']['temp_c'] : null,
                    'lot_id' => $rc->lines[$i]->lot_id ?? null, 'difference_pct' => $v['dp'], 'difference_reason' => $v['motivo'] ?: null, 'updated_at' => now(),
                ]);
            }
            $disputa = collect($evals)->contains(fn ($v) => $v['fuera']);
            DB::table('farm_dispatches')->where('id', $id)->update(['status' => $disputa ? 'DISPUTED' : 'RECEIVED', 'was_disputed' => $disputa, 'received_at' => $cuando,
                'received_by' => $quien->id, 'purchase_receipt_id' => $rc->id, 'updated_at' => now()]);
            DB::table('purchase_documents')->where('id', $d->purchase_document_id)->whereNull('receipt_id')->update(['receipt_id' => $rc->id]);
            DB::table('purchase_receipts')->where('id', $rc->id)->update(['document_id' => $d->purchase_document_id]);
            if ($d->order_ref) {
                $po = DB::table('purchase_orders')->where('number', $d->order_ref)->whereIn('status', OrdenesService::ABIERTAS)->first();
                if ($po) {
                    DB::table('purchase_orders')->where('id', $po->id)->update(['status' => 'RECEIVED', 'last_receipt_at' => $cuando, 'received_complete_at' => $cuando,
                        'history' => C::historial($po->history, "Recibida con el envío {$d->farm_document_number}", $quien), 'updated_at' => now()]);
                }
            }
            $conf = ['event' => 'aycha.dispatch_received', 'document' => $d->farm_document_number, 'received_at' => $cuando->toIso8601String(),
                'lines' => DB::table('farm_dispatch_lines')->where('dispatch_id', $id)->get()->map(fn ($l) => ['item_code' => $l->farm_item_code, 'sent_kg' => (float) $l->sent_weight_kg,
                    'received_kg' => (float) $l->received_weight_kg, 'difference_pct' => (float) $l->difference_pct, 'reason' => $l->difference_reason])->all()];
            DB::table('farm_dispatches')->where('id', $id)->update(['confirmation_sent_at' => now(), 'confirmation_payload' => json_encode($conf, JSON_UNESCAPED_UNICODE)]);
            Events::emit('farm_dispatch.received', 'farm_dispatches', $id, ['receipt_id' => $rc->id, 'disputed' => $disputa]);
            if ($disputa) {
                C::avisar(['CONTADORA', 'COMPRAS'], "Envío {$d->farm_document_number} en disputa", 'Diferencia de peso con la granja sobre la tolerancia.', 'GRJ', 'GRJ-04', $id);
            }

            return self::ver($id);
        });
    }

    /** Acuerdo con la granja sobre un envío en disputa. */
    public static function resolverDisputa(string $id, string $decision, string $nota, User $quien): object
    {
        if (! Access::can($quien, 'grj.reconciliation.close') && ! Access::can($quien, 'grj.link.manage') && ! Access::module($quien, 'GRJ', 'E')) {
            C::permiso($quien, 'grj.reconciliation.close', 'registrar acuerdos con la granja');
        }
        $d = DB::table('farm_dispatches')->where('id', $id)->first() ?? abort(404);
        if ($d->status !== 'DISPUTED') {
            RuleError::fail('RN-GRJ-07', 'El envío no está en disputa.');
        }
        if (mb_strlen(trim($nota)) < 5) {
            RuleError::fail('RN-GRJ-07', 'Indica el acuerdo con la granja.');
        }
        $ls = DB::table('farm_dispatch_lines')->where('dispatch_id', $id)->get();
        $kg = C::r($ls->sum(fn ($l) => (float) $l->received_weight_kg - (float) $l->sent_weight_kg), 3);
        $val = C::r($ls->sum(fn ($l) => ((float) $l->received_weight_kg - (float) $l->sent_weight_kg) * (float) $l->unit_price));
        DB::table('farm_dispatches')->where('id', $id)->update(['status' => 'RECEIVED', 'updated_at' => now(), 'agreement' => json_encode([
            'decision' => $decision, 'note' => $nota, 'kg_difference' => $kg, 'value_difference' => $val, 'by' => $quien->id, 'by_name' => $quien->name, 'at' => now()->toIso8601String(),
        ], JSON_UNESCAPED_UNICODE)]);

        return self::ver($id);
    }

    public static function ver(string $id): object
    {
        $d = DB::table('farm_dispatches as d')->leftJoin('farm_links as k', 'k.id', '=', 'd.farm_link_id')->leftJoin('suppliers as s', 's.id', '=', 'k.supplier_id')
            ->leftJoin('purchase_receipts as r', 'r.id', '=', 'd.purchase_receipt_id')->leftJoin('purchase_documents as pd', 'pd.id', '=', 'd.purchase_document_id')
            ->leftJoin('users as u', 'u.id', '=', 'd.received_by')->where('d.id', $id)
            ->first(['d.*', 'k.mode as link_mode', 'k.supplier_id', 's.trade_name as supplier_name', 'r.number as receipt_number', 'pd.series as doc_series', 'pd.number as doc_number',
                'pd.doc_type', 'pd.total as doc_total', 'pd.igv as doc_igv', 'u.name as received_by_name']) ?? abort(404);
        foreach (['raw_payload', 'agreement', 'confirmation_payload'] as $k) {
            $d->{$k} = $d->{$k} ? json_decode($d->{$k}, true) : null;
        }
        $d->lines = DB::table('farm_dispatch_lines as l')->leftJoin('farm_product_mappings as m', 'm.id', '=', 'l.mapping_id')->leftJoin('product_variants as v', 'v.id', '=', 'm.variant_id')
            ->leftJoin('products as p', 'p.id', '=', 'v.product_id')->leftJoin('lots as lo', 'lo.id', '=', 'l.lot_id')->where('l.dispatch_id', $id)->orderBy('l.created_at')->orderBy('l.farm_item_code')
            ->get(['l.*', 'm.variant_id', 'm.conversion_factor', 'v.sku', 'v.name as variant_name', 'v.sale_mode', 'p.storage', 'lo.code as lot_code', 'lo.qc_status']);
        foreach ($d->lines as $l) {
            $l->farm_origin = json_decode($l->farm_origin ?: '{}', true);
            $l->temp_max = RecepcionesService::tempMax($l->storage);
        }
        $d->tolerance_pct = self::tolerancia();
        $d->status_label = self::ESTADOS[$d->status] ?? $d->status;

        return $d;
    }

    /* ============================================================ conciliación (GRJ-05) */

    private static function delMes(string $periodo): Collection
    {
        $de = substr($periodo, 0, 7).'-01';
        $a = CarbonImmutable::parse($de)->endOfMonth()->toDateString();

        return DB::table('farm_dispatches')->whereRaw("(dispatched_at AT TIME ZONE 'America/Lima')::date BETWEEN ? AND ?", [$de, $a])->get();
    }

    public static function conciliacion(string $periodo): array
    {
        $p = substr($periodo, 0, 7).'-01';
        $ds = self::delMes($p);
        $recibidos = $ds->whereIn('status', ['RECEIVED', 'DISPUTED', 'RECONCILED']);
        $tol = self::tolerancia();
        $por = [];
        $pend = [];
        foreach (DB::table('farm_dispatch_lines as l')->leftJoin('farm_product_mappings as m', 'm.id', '=', 'l.mapping_id')->leftJoin('product_variants as v', 'v.id', '=', 'm.variant_id')
            ->whereIn('l.dispatch_id', $recibidos->pluck('id'))->get(['l.*', 'm.variant_id', 'v.name as variant_name']) as $l) {
            $k = $l->variant_id ?? $l->farm_item_code;
            $o = $por[$k] ??= ['key' => $k, 'name' => $l->variant_name ?? $l->farm_item_name, 'sent_kg' => 0, 'received_kg' => 0, 'sent_value' => 0, 'received_value' => 0, 'lines' => 0];
            $o['sent_kg'] += (float) $l->sent_weight_kg;
            $o['received_kg'] += (float) $l->received_weight_kg;
            $o['sent_value'] += (float) $l->sent_weight_kg * (float) $l->unit_price;
            $o['received_value'] += (float) $l->received_weight_kg * (float) $l->unit_price;
            $o['lines']++;
            $por[$k] = $o;
            if (abs((float) $l->difference_pct) > $tol + 1e-9 && ! $l->difference_reason) {
                $pend[] = ['type' => 'NO_REASON', 'dispatch_id' => $l->dispatch_id, 'number' => $ds->firstWhere('id', $l->dispatch_id)->farm_document_number, 'detail' => $l->farm_item_name];
            }
        }
        foreach ([['DISPUTED', 'En disputa'], ['RECEIVED_PENDING', 'Por recibir'], ['ERROR', 'Con error']] as [$st, $txt]) {
            foreach ($ds->where('status', $st) as $d) {
                $pend[] = ['type' => $st === 'RECEIVED_PENDING' ? 'PENDING' : $st, 'dispatch_id' => $d->id, 'number' => $d->farm_document_number, 'detail' => $txt];
            }
        }
        $filas = array_values(array_map(fn ($o) => array_merge($o, ['sent_kg' => C::r($o['sent_kg'], 3), 'received_kg' => C::r($o['received_kg'], 3), 'sent_value' => C::r($o['sent_value']),
            'received_value' => C::r($o['received_value']), 'difference_kg' => C::r($o['received_kg'] - $o['sent_kg'], 3), 'difference_value' => C::r($o['received_value'] - $o['sent_value'])]), $por));
        $tot = fn ($k) => C::r(array_sum(array_column($filas, $k)), $k === 'sent_kg' || $k === 'received_kg' ? 3 : 2);
        $fila = DB::table('farm_reconciliations as r')->leftJoin('users as u', 'u.id', '=', 'r.closed_by')->leftJoin('users as a', 'a.id', '=', 'r.agreed_by')->where('r.period', $p)
            ->first(['r.*', 'u.name as closed_by_name', 'a.name as agreed_by_name']);

        return ['period' => $p, 'rows' => $filas, 'issues' => $pend, 'dispatches' => $ds->count(), 'sent_kg' => $tot('sent_kg'), 'received_kg' => $tot('received_kg'),
            'sent_value' => $tot('sent_value'), 'received_value' => $tot('received_value'), 'difference_kg' => C::r($tot('received_kg') - $tot('sent_kg'), 3),
            'difference_value' => C::r($tot('received_value') - $tot('sent_value')), 'reconciliation' => $fila, 'tolerance_pct' => $tol];
    }

    private static function guardarConciliacion(string $periodo, array $cambios): object
    {
        $c = self::conciliacion($periodo);
        $s = self::granja();
        $fin = CarbonImmutable::parse($c['period'])->endOfMonth()->toDateString();
        $vinc = ($s ? (self::vinculoEn($s->id, $fin) ?? self::vinculoEn($s->id, $c['period'])) : null) ?? DB::table('farm_links')->orderBy('valid_from')->first();
        $base = ['farm_link_id' => $vinc->id ?? null, 'period' => $c['period'], 'sent_kg' => $c['sent_kg'], 'received_kg' => $c['received_kg'], 'sent_value' => $c['sent_value'],
            'received_value' => $c['received_value'], 'difference_kg' => $c['difference_kg'], 'difference_value' => $c['difference_value'], 'updated_at' => now()];
        $ex = DB::table('farm_reconciliations')->where('period', $c['period'])->first();
        if ($ex) {
            DB::table('farm_reconciliations')->where('id', $ex->id)->update($base + $cambios);

            return DB::table('farm_reconciliations')->find($ex->id);
        }
        $id = DB::table('farm_reconciliations')->insertGetId($base + $cambios + ['status' => 'OPEN'], 'id');

        return DB::table('farm_reconciliations')->find($id);
    }

    public static function acordar(string $periodo, string $nota, User $quien): object
    {
        return DB::transaction(function () use ($periodo, $nota, $quien) {
            if (! Access::can($quien, 'grj.reconciliation.close') && ! Access::module($quien, 'GRJ', 'E')) {
                C::permiso($quien, 'grj.reconciliation.close', 'registrar el acuerdo con la granja');
            }
            if (mb_strlen(trim($nota)) < 5) {
                RuleError::fail('RN-GRJ-09', 'Describe el acuerdo con la granja.');
            }
            $c = self::conciliacion($periodo);
            $bloquean = array_filter($c['issues'], fn ($i) => in_array($i['type'], ['DISPUTED', 'NO_REASON'], true));
            if ($bloquean) {
                RuleError::fail('RN-GRJ-09', 'Hay '.count($bloquean).' diferencia(s) sin motivo o en disputa: resuélvelas antes de acordar el mes.');
            }

            return self::guardarConciliacion($periodo, ['status' => 'AGREED', 'notes' => $nota, 'agreed_by' => $quien->id, 'agreed_at' => now()]);
        });
    }

    public static function cerrarConciliacion(string $periodo, User $quien): object
    {
        return DB::transaction(function () use ($periodo, $quien) {
            C::permiso($quien, 'grj.reconciliation.close', 'cerrar la conciliación con la granja');
            $c = self::conciliacion($periodo);
            $malos = array_filter($c['issues'], fn ($i) => $i['type'] !== 'ERROR');
            if ($malos) {
                RuleError::fail('RN-GRJ-09', 'La conciliación de '.Periodos::nombre($c['period']).' tiene '.count($malos).' pendiente(s) (disputas, diferencias sin motivo o envíos por recibir): no se cierra.');
            }
            if (($c['reconciliation']->status ?? null) !== 'AGREED') {
                RuleError::fail('RN-GRJ-09', 'Primero registra el acuerdo con la granja.');
            }
            foreach (self::delMes($c['period'])->where('status', 'RECEIVED') as $d) {
                DB::table('farm_dispatches')->where('id', $d->id)->update(['status' => 'RECONCILED', 'updated_at' => now()]);
            }

            return self::guardarConciliacion($periodo, ['status' => 'CLOSED', 'closed_by' => $quien->id, 'closed_at' => now()]);
        });
    }

    /** Para el cierre contable (CNT-12): el mes de la granja no cierra con diferencias sin motivo. */
    public static function conciliacionOk(string $periodo): array
    {
        $p = substr($periodo, 0, 7).'-01';
        if (self::delMes($p)->isEmpty()) {
            return ['ok' => true, 'detail' => 'Sin envíos de la granja en el mes.'];
        }
        $r = DB::table('farm_reconciliations')->where('period', $p)->first();
        if ($r && $r->status === 'CLOSED') {
            return ['ok' => true, 'detail' => 'Conciliación cerrada: '.C::kg($r->sent_kg).' enviados, '.C::kg($r->received_kg).' recibidos.'];
        }
        $c = self::conciliacion($p);

        return ['ok' => false, 'detail' => 'Conciliación '.($r ? ['OPEN' => 'abierta', 'AGREED' => 'acordada'][$r->status] ?? '' : 'sin abrir').': '.count($c['issues']).' pendiente(s). Ciérrala en Conciliación mensual de la granja.'];
    }

    /* ============================================================ tablero (GRJ-07) */

    public static function tablero(?string $mes): array
    {
        $de = substr($mes ?: C::hoy(), 0, 7).'-01';
        $a = CarbonImmutable::parse($de)->endOfMonth()->toDateString();
        $ds = DB::table('farm_dispatches')->whereNotNull('received_at')->whereRaw("(received_at AT TIME ZONE 'America/Lima')::date BETWEEN ? AND ?", [$de, $a])->get();
        $ls = DB::table('farm_dispatch_lines')->whereIn('dispatch_id', $ds->pluck('id'))->whereNotNull('received_weight_kg')->get();
        $enviado = $ls->sum(fn ($l) => (float) $l->sent_weight_kg);
        $dif = $ls->sum(fn ($l) => abs((float) $l->sent_weight_kg - (float) $l->received_weight_kg));
        $disp = $ds->filter(fn ($d) => $d->status === 'DISPUTED' || $d->was_disputed)->count();
        // KPI-GRJ-03: costo por kg de la granja frente a otros proveedores, por variante comprada a ambos
        $rl = DB::table('purchase_receipt_lines as l')->join('purchase_receipts as r', 'r.id', '=', 'l.receipt_id')->join('suppliers as s', 's.id', '=', 'r.supplier_id')
            ->leftJoin('product_variants as v', 'v.id', '=', 'l.variant_id')->where('r.status', 'POSTED')->where('l.accepted', true)->where('l.weight_kg', '>', 0)
            ->whereRaw("(r.received_at AT TIME ZONE 'America/Lima')::date BETWEEN ? AND ?", [$de, $a])->get(['l.variant_id', 'v.name', 'l.weight_kg', 'l.total_cost', 's.supplier_type']);
        $comp = $rl->groupBy('variant_id')->map(function ($g) {
            $f = $g->where('supplier_type', 'RELATED_FARM');
            $o = $g->where('supplier_type', '<>', 'RELATED_FARM');

            return ['variant_id' => $g[0]->variant_id, 'name' => $g[0]->name, 'farm_kg' => C::r($f->sum('weight_kg'), 1), 'farm_cost' => C::r($f->sum('total_cost')),
                'farm_per_kg' => $f->sum('weight_kg') > 0 ? C::r($f->sum('total_cost') / $f->sum('weight_kg')) : null,
                'other_per_kg' => $o->sum('weight_kg') > 0 ? C::r($o->sum('total_cost') / $o->sum('weight_kg')) : null];
        })->values();
        $ambos = $comp->filter(fn ($x) => $x['farm_per_kg'] !== null && $x['other_per_kg'] !== null);
        $num = $ambos->sum('farm_cost');
        $den = $ambos->sum(fn ($x) => $x['farm_kg'] * $x['other_per_kg']);
        $mes12 = DB::table('farm_dispatches')->whereRaw("dispatched_at >= (date_trunc('month', ?::date) - interval '5 months')", [$de])
            ->selectRaw("to_char(dispatched_at AT TIME ZONE 'America/Lima', 'YYYY-MM') as month, round(sum(total_sent_kg), 1) as kg, round(sum(total_value), 2) as value, count(*) as dispatches")
            ->groupBy('month')->orderBy('month')->get();

        return [
            'month' => substr($de, 0, 7), 'from' => $de, 'to' => $a,
            'kpis' => [
                'weight_diff_pct' => $enviado > 0 ? C::t($dif / $enviado * 100, 2) : null,
                'disputed_pct' => $ds->count() ? C::t($disp / $ds->count() * 100, 1) : null,
                'farm_cost_index' => $den > 0 ? C::t($num / $den * 100, 1) : null,
            ],
            'detail' => ['received' => $ds->count(), 'disputed' => $disp, 'sent_kg' => C::t($enviado, 1), 'diff_kg' => C::t($dif, 1),
                'pending' => DB::table('farm_dispatches')->where('status', 'RECEIVED_PENDING')->count(), 'errors' => DB::table('farm_dispatches')->where('status', 'ERROR')->count(),
                'unmapped' => self::sinMapear()->count()],
            'cost_compare' => $comp->sortByDesc('farm_kg')->values(),
            'months' => $mes12,
        ];
    }
}
