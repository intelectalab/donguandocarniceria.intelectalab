<?php

namespace App\Modulos\Com\Services;

use App\Models\User;
use App\Modulos\Alm\Services\InventarioService;
use App\Modulos\Com\Services\Soporte as C;
use App\Modulos\Plt\Services\Periodos;
use App\Support\Access;
use App\Support\Events;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * COM-03 Requerimientos, COM-04 Órdenes de compra y COM-05 Aprobación.
 *  RN-COM-01  OC con total mayor que com_po_approval_threshold_pen necesita aprobación de alguien con com.order.approve
 *             distinto de quien la creó; por debajo se aprueba sola al enviarla.
 *  RN-COM-11  un proveedor inactivo, no habido, de baja o suspendido no recibe OC.
 *  RN-COM-12  la OC a la granja con vínculo NTI no lleva IGV.
 */
final class OrdenesService
{
    public const ABIERTAS = ['APPROVED', 'PARTIALLY_RECEIVED'];

    /* ============================================================ requerimientos (COM-03) */

    public static function crearRequerimiento(array $d, User $quien): object
    {
        $w = InventarioService::almacen($d['warehouse_id'], $quien);
        InventarioService::variante($d['variant_id']);
        $id = DB::transaction(fn () => DB::table('purchase_requisitions')->insertGetId([
            'number' => C::numero('purchase_requisitions', 'RQ-', 4), 'source' => $d['source'] ?? 'MANUAL', 'source_ref' => $d['source_ref'] ?? null,
            'warehouse_id' => $w->id, 'establishment_id' => $w->establishment_id, 'variant_id' => $d['variant_id'], 'qty' => C::r($d['qty'], 3),
            'needed_date' => $d['needed_date'] ?? C::ahora()->addDays(3)->toDateString(), 'status' => 'PENDING',
            'requested_by' => $quien->id, 'requested_at' => now(), 'notes' => $d['notes'] ?? null,
        ], 'id'));

        return DB::table('purchase_requisitions')->find($id);
    }

    public static function cancelarRequerimiento(string $id, string $motivo): object
    {
        $r = DB::table('purchase_requisitions')->where('id', $id)->first() ?? abort(404);
        if ($r->status !== 'PENDING') {
            RuleError::fail('RN-COM-03', "El requerimiento {$r->number} ya no está pendiente.");
        }
        DB::table('purchase_requisitions')->where('id', $id)->update(['status' => 'CANCELLED', 'notes' => trim(($r->notes ? $r->notes.' · ' : '').'Cancelado: '.$motivo), 'updated_at' => now()]);

        return DB::table('purchase_requisitions')->find($id);
    }

    /**
     * Agrupa requerimientos pendientes en OC por proveedor y almacén. Sin proveedor elegido, el más barato del catálogo
     * que pueda recibir OC. Devuelve las OC creadas (en borrador).
     *
     * @param  array<string, string>  $proveedores  requerimiento => proveedor elegido
     */
    public static function agrupar(array $ids, array $proveedores, User $quien): array
    {
        return DB::transaction(function () use ($ids, $proveedores, $quien) {
            $reqs = DB::table('purchase_requisitions')->whereIn('id', $ids)->where('status', 'PENDING')->lockForUpdate()->get();
            if ($reqs->isEmpty()) {
                RuleError::fail('RN-COM-03', 'Elige al menos un requerimiento pendiente.');
            }
            $grupos = [];
            foreach ($reqs as $r) {
                $sid = $proveedores[$r->id] ?? DB::table('supplier_catalog as c')->join('suppliers as s', 's.id', '=', 'c.supplier_id')
                    ->where('c.variant_id', $r->variant_id)->where('c.status', 'ACTIVE')->where('s.status', 'ACTIVE')->whereNotIn('s.sunat_status', C::SUNAT_BLOQUEA)
                    ->orderBy('c.last_price')->value('c.supplier_id');
                if (! $sid) {
                    $v = DB::table('product_variants')->where('id', $r->variant_id)->value('name');
                    RuleError::fail('RN-COM-03', "{$v} no tiene proveedor en el catálogo: agrégalo en Catálogo por proveedor o elige uno.");
                }
                $grupos[$sid.'|'.$r->warehouse_id][] = $r;
            }
            $ocs = [];
            foreach ($grupos as $k => $rs) {
                [$sid, $wh] = explode('|', $k);
                $lineas = array_map(fn ($r) => [
                    'variant_id' => $r->variant_id, 'qty' => (float) $r->qty, 'price_basis' => self::base($r->variant_id),
                    'unit_price' => ProveedoresService::precioDe($sid, $r->variant_id) ?? (float) DB::table('product_variants')->where('id', $r->variant_id)->value('std_cost'),
                ], $rs);
                $oc = self::crear([
                    'supplier_id' => $sid, 'warehouse_id' => $wh, 'expected_date' => collect($rs)->min('needed_date'),
                    'notes' => 'Desde los requerimientos '.collect($rs)->pluck('number')->implode(', '), 'lines' => $lineas,
                ], $quien);
                DB::table('purchase_requisitions')->whereIn('id', collect($rs)->pluck('id'))->update(['status' => 'ORDERED', 'po_id' => $oc->id, 'updated_at' => now()]);
                $ocs[] = $oc;
            }

            return $ocs;
        });
    }

    /* ============================================================ órdenes de compra (COM-04) */

    /** Por kg si la variante se vende por kg o peso variable; si no, por unidad. */
    public static function base(string $variantId): string
    {
        return in_array(DB::table('product_variants')->where('id', $variantId)->value('sale_mode'), ['KG', 'UNIT_VARIABLE_WEIGHT'], true) ? 'KG' : 'UNIT';
    }

    /** RN-COM-12: la compra a la granja con vínculo NTI vigente no lleva IGV. */
    public static function sinIgv(string $supplierId, string $fecha): bool
    {
        return DB::table('farm_links')->where('supplier_id', $supplierId)->where('status', 'ACTIVE')->where('mode', 'NTI')
            ->where('valid_from', '<=', $fecha)->where(fn ($q) => $q->whereNull('valid_to')->orWhere('valid_to', '>=', $fecha))->exists();
    }

    private static function lineas(array $lineas): array
    {
        $out = [];
        foreach ($lineas as $l) {
            if (empty($l['variant_id']) || ! ((float) ($l['qty'] ?? 0) > 0)) {
                continue;
            }
            if (! isset($l['unit_price']) || $l['unit_price'] === '' || (float) $l['unit_price'] < 0) {
                $v = DB::table('product_variants')->where('id', $l['variant_id'])->value('name');
                RuleError::fail('RN-COM-04', "Indica el precio de {$v} (sin IGV).");
            }
            $base = $l['price_basis'] ?? self::base($l['variant_id']);
            $qty = C::r($l['qty'], 3);
            $peso = $base === 'KG' ? C::r(($l['est_weight_kg'] ?? null) ?: $qty, 3) : (($l['est_weight_kg'] ?? null) ? C::r($l['est_weight_kg'], 3) : null);
            $precio = C::r($l['unit_price'], 6);
            $out[] = ['variant_id' => $l['variant_id'], 'qty' => $qty, 'price_basis' => $base, 'est_weight_kg' => $peso, 'unit_price' => $precio,
                'subtotal' => C::r(($base === 'KG' ? $peso : $qty) * $precio), 'igv_affectation' => '10'];
        }
        if (! $out) {
            RuleError::fail('RN-COM-04', 'Agrega al menos una línea con producto y cantidad.');
        }

        return $out;
    }

    public static function crear(array $d, User $quien): object
    {
        return DB::transaction(function () use ($d, $quien) {
            $s = C::proveedor($d['supplier_id'] ?? null);
            ProveedoresService::exigirQuePuedaComprar($s);
            $w = InventarioService::almacen($d['warehouse_id'] ?? null, $quien);
            $fecha = C::fecha($d['order_date'] ?? null);
            $empresa = C::empresaDe($d['establishment_id'] ?? $w->establishment_id);
            Periodos::abierto($fecha, $empresa);
            $esperada = $d['expected_date'] ?? C::ahora()->addDays(2)->toDateString();
            if ($esperada < $fecha) {
                RuleError::fail('RN-COM-04', 'La fecha esperada no puede ser anterior a la fecha de la OC.');
            }
            $ls = self::lineas($d['lines'] ?? []);
            $sub = C::r(array_sum(array_column($ls, 'subtotal')));
            $igv = self::sinIgv($s->id, $fecha) ? 0.0 : C::r($sub * C::igv());
            $id = DB::table('purchase_orders')->insertGetId([
                'number' => C::numero('purchase_orders', 'OC01-', 6), 'company_id' => $empresa, 'establishment_id' => $d['establishment_id'] ?? $w->establishment_id,
                'supplier_id' => $s->id, 'warehouse_id' => $w->id, 'brand_id' => $d['brand_id'] ?? null, 'order_date' => $fecha, 'expected_date' => $esperada,
                'currency' => 'PEN', 'subtotal' => $sub, 'igv' => $igv, 'total' => C::r($sub + $igv), 'status' => 'DRAFT', 'notes' => $d['notes'] ?? null,
                'created_by' => $quien->id, 'no_igv' => $igv == 0.0, 'history' => C::historial(null, 'Creada', $quien),
            ], 'id');
            foreach ($ls as $l) {
                DB::table('purchase_order_lines')->insert($l + ['po_id' => $id]);
            }

            return self::ver($id);
        });
    }

    /** Solo un borrador se edita: se reemplazan cabecera y líneas. */
    public static function editar(string $id, array $d, User $quien): object
    {
        return DB::transaction(function () use ($id, $d, $quien) {
            $po = self::bloquear($id);
            if ($po->status !== 'DRAFT') {
                RuleError::fail('RN-COM-04', "La OC {$po->number} ya se envió: solo se edita un borrador.");
            }
            $s = C::proveedor($d['supplier_id'] ?? $po->supplier_id);
            ProveedoresService::exigirQuePuedaComprar($s);
            $w = InventarioService::almacen($d['warehouse_id'] ?? $po->warehouse_id, $quien);
            $ls = self::lineas($d['lines'] ?? []);
            $sub = C::r(array_sum(array_column($ls, 'subtotal')));
            $igv = self::sinIgv($s->id, $po->order_date) ? 0.0 : C::r($sub * C::igv());
            DB::table('purchase_order_lines')->where('po_id', $id)->delete();
            foreach ($ls as $l) {
                DB::table('purchase_order_lines')->insert($l + ['po_id' => $id]);
            }
            DB::table('purchase_orders')->where('id', $id)->update([
                'supplier_id' => $s->id, 'warehouse_id' => $w->id, 'establishment_id' => $w->establishment_id, 'brand_id' => $d['brand_id'] ?? $po->brand_id,
                'expected_date' => $d['expected_date'] ?? $po->expected_date, 'notes' => $d['notes'] ?? $po->notes,
                'subtotal' => $sub, 'igv' => $igv, 'total' => C::r($sub + $igv), 'no_igv' => $igv == 0.0, 'history' => C::historial($po->history, 'Editada', $quien), 'updated_at' => now(),
            ]);

            return self::ver($id);
        });
    }

    /** RN-COM-01: al enviarla, hasta el umbral se aprueba sola; sobre el umbral queda por aprobar. */
    public static function enviar(string $id, User $quien): object
    {
        return DB::transaction(function () use ($id, $quien) {
            $po = self::bloquear($id);
            if ($po->status !== 'DRAFT') {
                RuleError::fail('RN-COM-01', "La OC {$po->number} no está en borrador.");
            }
            ProveedoresService::exigirQuePuedaComprar(C::proveedor($po->supplier_id));
            $umbral = C::param('com_po_approval_threshold_pen');
            if ((float) $po->total <= $umbral) {
                DB::table('purchase_orders')->where('id', $id)->update(['status' => 'APPROVED', 'auto_approved' => true, 'approved_at' => now(), 'submitted_at' => now(),
                    'history' => C::historial($po->history, 'Enviada y aprobada sola: '.C::soles($po->total).' no supera el umbral de '.C::soles($umbral), $quien), 'updated_at' => now()]);
                Events::emit('purchase_order.approved', 'purchase_orders', $id, ['number' => $po->number, 'auto' => true]);
            } else {
                DB::table('purchase_orders')->where('id', $id)->update(['status' => 'PENDING_APPROVAL', 'submitted_at' => now(),
                    'history' => C::historial($po->history, 'Enviada a aprobación: '.C::soles($po->total).' supera el umbral de '.C::soles($umbral), $quien), 'updated_at' => now()]);
                C::avisar(['GERENTE', 'ADMINISTRACION'], "OC {$po->number} por aprobar", C::nombreProveedor(C::proveedor($po->supplier_id)).' · '.C::soles($po->total), 'COM', 'COM-05', $id);
            }

            return self::ver($id);
        });
    }

    public static function aprobar(string $id, User $quien): object
    {
        return DB::transaction(function () use ($id, $quien) {
            $po = self::bloquear($id);
            if ($po->status !== 'PENDING_APPROVAL') {
                RuleError::fail('RN-COM-01', "La OC {$po->number} no está pendiente de aprobación.");
            }
            if ($po->created_by === $quien->id) {
                RuleError::fail('RN-COM-01', "Quien crea la OC no la aprueba: {$po->number} la creaste tú. Debe aprobarla otra persona.");
            }
            if (! Access::can($quien, 'com.order.approve')) {
                RuleError::fail('RN-COM-01', 'Aprobar una OC sobre el umbral es del gerente o de administración.');
            }
            DB::table('purchase_orders')->where('id', $id)->update(['status' => 'APPROVED', 'approved_by' => $quien->id, 'approved_at' => now(),
                'history' => C::historial($po->history, 'Aprobada', $quien), 'updated_at' => now()]);
            Events::emit('purchase_order.approved', 'purchase_orders', $id, ['number' => $po->number, 'auto' => false]);

            return self::ver($id);
        });
    }

    /** Devuelve a borrador con el motivo (la bandeja del aprobador). */
    public static function devolver(string $id, string $motivo, User $quien): object
    {
        return DB::transaction(function () use ($id, $motivo, $quien) {
            $po = self::bloquear($id);
            if ($po->status !== 'PENDING_APPROVAL') {
                RuleError::fail('RN-COM-01', "La OC {$po->number} no está pendiente de aprobación.");
            }
            DB::table('purchase_orders')->where('id', $id)->update(['status' => 'DRAFT', 'submitted_at' => null,
                'history' => C::historial($po->history, 'Devuelta: '.$motivo, $quien), 'updated_at' => now()]);

            return self::ver($id);
        });
    }

    public static function anular(string $id, string $motivo, User $quien): object
    {
        return DB::transaction(function () use ($id, $motivo, $quien) {
            $po = self::bloquear($id);
            if (! in_array($po->status, ['DRAFT', 'PENDING_APPROVAL', 'APPROVED'], true)) {
                RuleError::fail('RN-COM-04', "La OC {$po->number} ya tiene recepciones: ciérrala en lugar de anularla.");
            }
            DB::table('purchase_orders')->where('id', $id)->update(['status' => 'VOIDED', 'void_reason' => mb_substr($motivo, 0, 255),
                'history' => C::historial($po->history, 'Anulada: '.$motivo, $quien), 'updated_at' => now()]);
            DB::table('purchase_requisitions')->where('po_id', $id)->update(['status' => 'PENDING', 'po_id' => null, 'updated_at' => now()]);

            return self::ver($id);
        });
    }

    /** Cierra una OC recibida en parte: lo que falta ya no se espera. */
    public static function cerrar(string $id, string $motivo, User $quien): object
    {
        return DB::transaction(function () use ($id, $motivo, $quien) {
            $po = self::bloquear($id);
            if (! in_array($po->status, self::ABIERTAS, true)) {
                RuleError::fail('RN-COM-04', "La OC {$po->number} no está abierta para recibir.");
            }
            DB::table('purchase_orders')->where('id', $id)->update(['status' => 'CLOSED',
                'history' => C::historial($po->history, 'Cerrada: '.$motivo, $quien), 'updated_at' => now()]);

            return self::ver($id);
        });
    }

    private static function bloquear(string $id): object
    {
        return DB::table('purchase_orders')->where('id', $id)->lockForUpdate()->first() ?? abort(404);
    }

    /** Lo pedido de una línea en su base (kg o unidades). */
    public static function pedido(object $l): float
    {
        return $l->price_basis === 'KG' ? (float) ($l->est_weight_kg ?? $l->qty) : (float) $l->qty;
    }

    public static function recibido(object $l): float
    {
        return $l->price_basis === 'KG' ? (float) $l->received_weight_kg : (float) $l->received_qty;
    }

    public static function ver(string $id): object
    {
        $po = DB::table('purchase_orders as o')->join('suppliers as s', 's.id', '=', 'o.supplier_id')->join('warehouses as w', 'w.id', '=', 'o.warehouse_id')
            ->leftJoin('establishments as e', 'e.id', '=', 'o.establishment_id')->leftJoin('users as uc', 'uc.id', '=', 'o.created_by')->leftJoin('users as ua', 'ua.id', '=', 'o.approved_by')
            ->leftJoin('brands as b', 'b.id', '=', 'o.brand_id')
            ->where('o.id', $id)->first(['o.*', 's.legal_name as supplier_name', 's.trade_name as supplier_trade_name', 's.doc_number as supplier_doc', 's.supplier_type',
                'w.code as warehouse_code', 'w.name as warehouse_name', 'e.name as establishment_name', 'uc.name as created_by_name', 'ua.name as approved_by_name', 'b.name as brand_name']) ?? abort(404);
        $po->history = json_decode($po->history ?? '[]', true) ?: [];
        $po->lines = DB::table('purchase_order_lines as l')->join('product_variants as v', 'v.id', '=', 'l.variant_id')->where('l.po_id', $id)
            ->orderBy('l.created_at')->orderBy('v.name')->get(['l.*', 'v.sku', 'v.name as variant_name', 'v.sale_mode']);
        foreach ($po->lines as $l) {
            $l->ordered = C::t(self::pedido($l), 3);
            $l->received = C::t(self::recibido($l), 3);
            $l->pending = C::t(max(0, self::pedido($l) - self::recibido($l)), 3);
        }
        $po->receipts = DB::table('purchase_receipts')->where('po_id', $id)->orderBy('received_at')->get(['id', 'number', 'received_at', 'total_cost', 'status']);
        $po->documents = DB::table('purchase_documents')->where('po_id', $id)->where('status', '<>', 'VOIDED')->get(['id', 'doc_type', 'series', 'number', 'total', 'match_status', 'status']);
        $po->threshold = C::t(C::param('com_po_approval_threshold_pen'));

        return $po;
    }
}
