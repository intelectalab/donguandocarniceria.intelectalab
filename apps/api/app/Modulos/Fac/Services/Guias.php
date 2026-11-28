<?php

namespace App\Modulos\Fac\Services;

use App\Models\User;
use App\Modulos\Alm\Services\TransferenciasService;
use App\Modulos\Plt\Models\DocumentSeries;
use App\Modulos\Plt\Services\Correlativo;
use App\Modulos\Plt\Services\Periodos;
use App\Support\Events;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * FAC-09 Guía de remisión remitente (RN-FAC-11, RN-FAC-12).
 * Motivo habilitado del catálogo 20 (fac_gre_allowed_reasons): 01 venta enlazada al pedido o al
 * comprobante, 04 traslado entre locales de la empresa enlazado a la transferencia (ALM). Transporte
 * público con transportista; privado con vehículo y conductor. El traslado no empieza antes de emitir.
 */
final class Guias
{
    /**
     * $d: establishment_id, series_id, transfer_reason_code, transport_mode, start_date, carrier_supplier_id,
     *     vehicle_id, driver_employee_id, driver_license, recipient_customer_id, dest_establishment_id,
     *     dest_address, dest_ubigeo, gross_weight_kg, packages, order_id, sales_document_id, transfer_id,
     *     notes, brand_id, lines (variant_id, description, qty, uom_code, weight_kg, lot_id).
     */
    public static function emitir(array $d, User $u): object
    {
        return DB::transaction(function () use ($d, $u) {
            $local = DB::table('establishments')->where('id', $d['establishment_id'])->first() ?? RuleError::fail('RN-FAC-12', 'El local de partida no existe.');
            Emision::alcance($u, $d['brand_id'] ?? null, $local->id);
            $motivo = str_pad((string) ($d['transfer_reason_code'] ?? ''), 2, '0', STR_PAD_LEFT);
            $habilitados = Catalogos::motivosGuia();
            if (! in_array($motivo, $habilitados, true)) {
                RuleError::fail('RN-FAC-11', 'El motivo '.$motivo.' ('.(Catalogos::CAT20[$motivo] ?? 'desconocido').') no está habilitado para la guía: usa '.implode(', ', $habilitados).'.');
            }
            $transfer = ! empty($d['transfer_id']) ? DB::table('stock_transfers')->where('id', $d['transfer_id'])->first() : null;
            if (! empty($d['transfer_id']) && ! $transfer) {
                RuleError::fail('RN-FAC-11', 'La transferencia no existe.');
            }
            $destLocal = ! empty($d['dest_establishment_id']) ? DB::table('establishments')->where('id', $d['dest_establishment_id'])->first() : null;
            if ($transfer && ! $destLocal) {
                $destLocal = DB::table('establishments')->where('id', $transfer->to_site)->first();
            }
            $mismaEmpresa = $destLocal && $destLocal->company_id === $local->company_id;
            if ($motivo === '01') {
                if ($transfer || ($destLocal && $mismaEmpresa)) {
                    RuleError::fail('RN-FAC-11', 'Un traslado entre locales de la misma empresa no es una venta: usa el motivo 04 (traslado entre establecimientos de la misma empresa).');
                }
                if (empty($d['order_id']) && empty($d['sales_document_id'])) {
                    RuleError::fail('RN-FAC-11', 'La guía por venta (motivo 01) se enlaza al pedido o al comprobante.');
                }
            }
            if ($motivo === '04') {
                if (! $transfer) {
                    RuleError::fail('RN-FAC-11', 'La guía de traslado entre locales (motivo 04) se enlaza a la transferencia de ALM.');
                }
                if (! $mismaEmpresa || $destLocal->id === $local->id) {
                    RuleError::fail('RN-FAC-11', 'El motivo 04 es para llevar mercadería a otro local de la misma empresa.');
                }
            }
            $modo = (string) ($d['transport_mode'] ?? '');
            if ($modo === '01' && empty($d['carrier_supplier_id'])) {
                RuleError::fail('RN-FAC-11', 'El transporte público exige el transportista.');
            }
            if ($modo === '02' && (empty($d['vehicle_id']) || empty($d['driver_employee_id']))) {
                RuleError::fail('RN-FAC-11', 'El transporte privado exige el vehículo y el conductor.');
            }
            if (! in_array($modo, ['01', '02'], true)) {
                RuleError::fail('RN-FAC-11', 'Elige la modalidad de transporte: público o privado.');
            }
            if ($modo === '02') {
                $lic = trim((string) ($d['driver_license'] ?? ''));
                if (! preg_match('/^[A-Z]\d{8}$/i', $lic)) {
                    RuleError::fail('RN-FAC-11', 'Escribe la licencia del conductor (una letra y 8 números, por ejemplo Q40143565).');
                }
            }
            $hoy = now('America/Lima')->toDateString();
            $inicio = $d['start_date'] ?? $hoy;
            if ($inicio < $hoy) {
                RuleError::fail('RN-FAC-11', 'El traslado no empieza antes de la emisión de la guía.');
            }
            try {
                Periodos::abierto($hoy, $local->company_id);
            } catch (RuleError $e) {
                RuleError::fail('RN-FAC-17', $e->getMessage());
            }
            $lineas = array_values(array_filter($d['lines'] ?? [], fn ($l) => (float) ($l['qty'] ?? 0) > 0));
            if (! $lineas) {
                RuleError::fail('RN-FAC-11', 'La guía necesita al menos un bien con cantidad.');
            }
            if (! ((float) ($d['gross_weight_kg'] ?? 0) > 0) || ! ((int) ($d['packages'] ?? 0) > 0)) {
                RuleError::fail('RN-FAC-11', 'Escribe el peso bruto y los bultos.');
            }
            $destino = trim((string) ($d['dest_address'] ?? '')) ?: ($destLocal->address ?? '');
            if ($destino === '') {
                RuleError::fail('RN-FAC-11', 'Escribe el punto de llegada.');
            }
            $serie = self::serie($local, $d['series_id'] ?? null);

            $g = Correlativo::emitir($serie->id, function (DocumentSeries $s, int $n) use ($d, $local, $destLocal, $motivo, $modo, $inicio, $hoy, $destino, $lineas, $transfer, $u) {
                if ($s->doc_type !== 'DISPATCH_GUIDE') {
                    RuleError::fail('RN-FAC-12', "La serie {$s->series} no es de guía de remisión.");
                }
                $full = Correlativo::numeroCompleto($s->series, $n);
                $id = DB::table('dispatch_guides')->insertGetId([
                    'company_id' => $local->company_id, 'establishment_id' => $local->id, 'brand_id' => $d['brand_id'] ?? null, 'series_id' => $s->id,
                    'series' => $s->series, 'number' => $n, 'full_number' => $full, 'issue_date' => $hoy, 'transfer_reason_code' => $motivo,
                    'transport_mode' => $modo, 'start_date' => $inicio, 'carrier_supplier_id' => $modo === '01' ? $d['carrier_supplier_id'] : null,
                    'recipient_customer_id' => $d['recipient_customer_id'] ?? null,
                    'origin_ubigeo' => $local->ubigeo ?: '150101', 'origin_address' => mb_substr((string) $local->address, 0, 255),
                    'dest_ubigeo' => $d['dest_ubigeo'] ?? ($destLocal->ubigeo ?? null) ?: '150101', 'dest_address' => mb_substr($destino, 0, 255),
                    'gross_weight_kg' => round((float) $d['gross_weight_kg'], 3), 'packages' => (int) $d['packages'],
                    'order_id' => $d['order_id'] ?? null, 'sales_document_id' => $d['sales_document_id'] ?? null,
                    'transfer_id' => $transfer?->id, 'transfer_ref' => $transfer?->number, 'dest_establishment_id' => $destLocal?->id,
                    'vehicle_id' => $modo === '02' ? $d['vehicle_id'] : null, 'driver_employee_id' => $modo === '02' ? $d['driver_employee_id'] : null,
                    'driver_license' => $modo === '02' ? strtoupper(trim((string) $d['driver_license'])) : null,
                    'status' => 'ISSUED', 'sunat_status' => 'PENDING', 'send_attempts' => 0, 'issued_at' => now(), 'issued_by' => mb_substr($u->name, 0, 120),
                    'notes' => $d['notes'] ?? null, 'created_at' => now(),
                ], 'id');
                foreach ($lineas as $l) {
                    $v = ! empty($l['variant_id']) ? DB::table('product_variants')->where('id', $l['variant_id'])->first(['id', 'name', 'sale_mode']) : null;
                    if (! $v) {
                        RuleError::fail('RN-FAC-11', 'Cada bien de la guía es un producto del catálogo.');
                    }
                    DB::table('dispatch_guide_lines')->insert([
                        'guide_id' => $id, 'variant_id' => $v->id, 'description' => trim((string) ($l['description'] ?? '')) ?: $v->name,
                        'qty' => round((float) $l['qty'], 3), 'uom_code' => $l['uom_code'] ?? ($v->sale_mode === 'KG' ? 'KGM' : 'NIU'),
                        'weight_kg' => isset($l['weight_kg']) && $l['weight_kg'] !== '' ? round((float) $l['weight_kg'], 3) : null, 'lot_id' => $l['lot_id'] ?? null, 'created_at' => now(),
                    ]);
                }

                return DB::table('dispatch_guides')->where('id', $id)->first();
            });
            if ($g->order_id) {
                DB::table('sales_orders')->where('id', $g->order_id)->update(['dispatch_guide_number' => $g->full_number, 'updated_at' => now()]);
            }
            Events::emit('guide.issued', 'dispatch_guides', $g->id, ['full_number' => $g->full_number, 'reason_code' => $motivo, 'transfer_id' => $g->transfer_id,
                'order_id' => $g->order_id, 'source' => 'FAC']);
            Envios::enviarGuia($g->id);

            return DB::table('dispatch_guides')->where('id', $g->id)->first();
        });
    }

    /** RN-FAC-12: serie T### de la empresa, activa y del local de partida (o de todos). */
    public static function serie(object $local, ?string $serieId): object
    {
        if ($serieId) {
            $s = DB::table('document_series')->where('id', $serieId)->first() ?? RuleError::fail('RN-FAC-12', 'La serie no existe.');
            if ($s->doc_type !== 'DISPATCH_GUIDE' || ! preg_match('/^T[A-Z0-9]{3}$/', $s->series)) {
                RuleError::fail('RN-FAC-12', "La serie {$s->series} no es de guía de remisión (T###).");
            }
            if ($s->company_id !== $local->company_id) {
                RuleError::fail('RN-FAC-12', "La serie {$s->series} no pertenece a la empresa emisora.");
            }
            if ($s->status !== 'ACTIVE') {
                RuleError::fail('RN-FAC-12', "La serie {$s->series} está inactiva.");
            }
            if ($s->establishment_id && $s->establishment_id !== $local->id && ! $s->all_sites) {
                RuleError::fail('RN-FAC-12', "La serie de guía {$s->series} es de otro local: la guía sale de {$local->name}.");
            }

            return $s;
        }

        return DB::table('document_series')->where('doc_type', 'DISPATCH_GUIDE')->where('status', 'ACTIVE')->where('company_id', $local->company_id)
            ->where(fn ($w) => $w->where('establishment_id', $local->id)->orWhereNull('establishment_id')->orWhere('all_sites', true))
            ->where('series', '~', '^T[A-Z0-9]{3}$')->orderByRaw('establishment_id = ? desc nulls last', [$local->id])->orderBy('series')->first()
            ?? RuleError::fail('RN-FAC-12', "No hay una serie de guía de remisión activa para {$local->name}: créala en Series (FAC-10).");
    }

    /**
     * Guía desde la transferencia de ALM: ALM pide la guía a su emisor (GuiaElectronicaFac) y queda
     * enlazada en la transferencia. $d: los datos de transporte.
     */
    public static function desdeTransferencia(string $transferId, array $d, User $u): object
    {
        TransferenciasService::emitirGuia($transferId, $u, $d + ['electronica' => true]);
        $g = DB::table('dispatch_guides')->where('transfer_id', $transferId)->where('status', 'ISSUED')->orderByDesc('created_at')->first();

        return $g ?? RuleError::fail('RN-FAC-11', 'La transferencia ya tenía una guía registrada.');
    }

    /** Datos para armar la guía desde una transferencia (líneas, partida, llegada, peso). */
    public static function datosDeTransferencia(string $transferId): array
    {
        $t = DB::table('stock_transfers')->where('id', $transferId)->first() ?? RuleError::fail('RN-FAC-11', 'La transferencia no existe.');
        $ls = DB::table('stock_transfer_lines as l')->join('product_variants as v', 'v.id', '=', 'l.variant_id')->where('l.transfer_id', $t->id)
            ->get(['l.variant_id', 'l.lot_id', 'l.qty', 'l.weight_kg', 'v.name', 'v.sale_mode']);

        return [
            'transfer' => $t,
            'establishment_id' => $t->from_site, 'dest_establishment_id' => $t->to_site,
            'lines' => $ls->map(fn ($l) => ['variant_id' => $l->variant_id, 'description' => $l->name, 'qty' => (float) $l->qty,
                'uom_code' => $l->sale_mode === 'KG' ? 'KGM' : 'NIU', 'weight_kg' => $l->weight_kg !== null ? (float) $l->weight_kg : null, 'lot_id' => $l->lot_id])->all(),
            'gross_weight_kg' => round((float) $ls->sum(fn ($l) => (float) ($l->weight_kg ?? ($l->sale_mode === 'KG' ? $l->qty : 0))), 3) ?: null,
        ];
    }

    /** Datos para armar la guía de venta desde un pedido. */
    public static function datosDePedido(string $orderId): array
    {
        $o = DB::table('sales_orders')->where('id', $orderId)->first() ?? RuleError::fail('RN-FAC-11', 'El pedido no existe.');
        $ls = DB::table('sales_order_lines as l')->join('product_variants as v', 'v.id', '=', 'l.variant_id')->where('l.sales_order_id', $o->id)
            ->orderBy('l.line_no')->get(['l.variant_id', 'l.lot_id', 'l.qty', 'l.weighed_kg', 'l.est_weight_kg', 'l.price_basis', 'v.name', 'v.sale_mode']);
        $dir = $o->address_id ? DB::table('customer_addresses')->where('id', $o->address_id)->first(['address_line', 'ubigeo']) : null;
        $doc = Emision::comprobanteDelPedido($o->id);

        return [
            'order' => ['id' => $o->id, 'number' => $o->number, 'status' => $o->status], 'establishment_id' => $o->establishment_id, 'brand_id' => $o->brand_id,
            'recipient_customer_id' => $o->billing_customer_id ?? $o->customer_id, 'sales_document_id' => $doc?->id, 'sales_document' => $doc?->full_number,
            'dest_address' => $dir->address_line ?? $o->province_destination, 'dest_ubigeo' => $dir->ubigeo ?? null,
            'lines' => $ls->map(fn ($l) => ['variant_id' => $l->variant_id, 'description' => $l->name, 'qty' => $l->price_basis === 'KG' ? (float) ($l->weighed_kg ?? $l->est_weight_kg) : (float) $l->qty,
                'uom_code' => $l->price_basis === 'KG' ? 'KGM' : 'NIU', 'weight_kg' => $l->weighed_kg !== null ? (float) $l->weighed_kg : ($l->est_weight_kg !== null ? (float) $l->est_weight_kg : null), 'lot_id' => $l->lot_id])->all(),
            'gross_weight_kg' => round((float) $ls->sum(fn ($l) => (float) ($l->weighed_kg ?? $l->est_weight_kg ?? 0)), 3) ?: null,
        ];
    }

    public static function anular(string $id, string $motivo, User $u): object
    {
        return DB::transaction(function () use ($id, $motivo, $u) {
            $g = DB::table('dispatch_guides')->where('id', $id)->lockForUpdate()->first() ?? RuleError::fail('RN-FAC-10', 'La guía no existe.');
            Emision::alcance($u, $g->brand_id, $g->establishment_id);
            if (mb_strlen(trim($motivo)) < 5) {
                RuleError::fail('RN-FAC-10', 'Anular exige motivo (al menos 5 letras).');
            }
            if ($g->status === 'VOIDED') {
                RuleError::fail('RN-FAC-10', "La guía {$g->full_number} ya está anulada.");
            }
            if ($g->transfer_id && in_array(DB::table('stock_transfers')->where('id', $g->transfer_id)->value('status'), ['DISPATCHED', 'RECEIVED', 'RECEIVED_WITH_DIFF'], true)) {
                RuleError::fail('RN-FAC-10', "La transferencia {$g->transfer_ref} ya salió con la guía {$g->full_number}: no se anula.");
            }
            DB::table('dispatch_guides')->where('id', $id)->update(['status' => 'VOIDED', 'void_reason' => mb_substr(trim($motivo), 0, 255), 'voided_at' => now(),
                'voided_by' => mb_substr($u->name, 0, 120), 'sunat_status' => $g->sunat_status === 'PENDING' && (int) $g->send_attempts === 0 ? 'VOIDED' : $g->sunat_status,
                'next_retry_at' => null, 'updated_at' => now()]);
            Events::emit('guide.voided', 'dispatch_guides', $id, ['full_number' => $g->full_number, 'reason' => $motivo]);

            return DB::table('dispatch_guides')->where('id', $id)->first();
        });
    }
}
