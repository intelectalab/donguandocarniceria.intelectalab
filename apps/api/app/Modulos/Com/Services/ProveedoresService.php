<?php

namespace App\Modulos\Com\Services;

use App\Models\User;
use App\Modulos\Com\Services\Soporte as C;
use App\Support\Access;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * COM-01 Proveedores y COM-02 Catálogo por proveedor. COM es el dueño de las columnas de compras de suppliers
 * (condiciones, cuenta bancaria, estado SUNAT, calificación) y de supplier_catalog.
 *  RN-COM-11  RUC con formato válido; un proveedor no habido, de baja o suspendido no recibe OC.
 *  RN-COM-13  cambiar la cuenta bancaria exige com.supplier.bank_change (GERENTE) y queda en la auditoría.
 */
final class ProveedoresService
{
    public static function guardar(array $d, ?string $id, User $quien): object
    {
        return DB::transaction(function () use ($d, $id, $quien) {
            $actual = $id ? (DB::table('suppliers')->where('id', $id)->lockForUpdate()->first() ?? abort(404)) : null;
            $tipo = $d['doc_type'];
            $num = preg_replace('/\s+/', '', (string) $d['doc_number']);
            if ($tipo === 'RUC' && ! C::rucValido($num)) {
                RuleError::fail('RN-COM-11', "El RUC {$num} no es válido: son 11 dígitos con el dígito verificador de la SUNAT.");
            }
            if ($tipo === 'DNI' && ! preg_match('/^\d{8}$/', $num)) {
                RuleError::fail('RN-COM-11', 'El DNI tiene 8 dígitos.');
            }
            $dup = DB::table('suppliers')->where('doc_type', $tipo)->where('doc_number', $num)->when($id, fn ($q) => $q->where('id', '<>', $id))->first();
            if ($dup) {
                RuleError::fail('RN-COM-11', 'Ya existe el proveedor '.C::nombreProveedor($dup)." con {$tipo} {$num}.");
            }
            $fila = [
                'doc_type' => $tipo, 'doc_number' => $num, 'legal_name' => trim($d['legal_name']), 'trade_name' => trim((string) ($d['trade_name'] ?? '')) ?: null,
                'supplier_type' => $d['supplier_type'], 'phone' => $d['phone'] ?? null, 'email' => $d['email'] ?? null,
                'payment_terms_days' => (int) ($d['payment_terms_days'] ?? 0), 'default_cost_center_id' => $d['default_cost_center_id'] ?? null,
                'status' => $d['status'] ?? 'ACTIVE', 'notes' => $d['notes'] ?? null, 'bank_name' => $d['bank_name'] ?? null,
                'related_company_id' => $d['supplier_type'] === 'RELATED_FARM' ? ($d['related_company_id'] ?? C::empresaDe(null)) : null,
                'updated_at' => now(),
            ];
            if ($actual) {
                DB::table('suppliers')->where('id', $id)->update($fila);
                $cuenta = trim((string) ($d['bank_account'] ?? ''));
                if (array_key_exists('bank_account', $d) && $cuenta !== '' && $cuenta !== (string) $actual->bank_account) {
                    self::pedirCambioCuenta($id, $cuenta, $d['bank_reason'] ?? 'Cambio desde la ficha del proveedor', $quien);
                }
            } else {
                $id = DB::table('suppliers')->insertGetId($fila + [
                    'bank_account' => trim((string) ($d['bank_account'] ?? '')) ?: null, 'rating' => 3, 'sunat_status' => 'UNKNOWN',
                ], 'id');
                if ($tipo === 'RUC') {
                    self::consultarSunat($id);
                }
            }

            return self::ver($id);
        });
    }

    /**
     * RN-COM-11 con el servicio de INT: sin conector configurado solo se valida el formato y el estado queda «Sin consultar»
     * (la contadora lo confirma en la SUNAT). Con conector activo, aquí se llamaría su consulta.
     */
    public static function consultarSunat(string $id): object
    {
        $s = C::proveedor($id);
        $conector = DB::table('integration_connectors')->where('status', 'ACTIVE')
            ->where(fn ($q) => $q->where('code', 'like', '%SUNAT%')->orWhere('name', 'ilike', '%sunat%'))->first();
        $msg = $s->doc_type !== 'RUC' ? 'Sin RUC: no se consulta en la SUNAT.'
            : ($conector ? 'Consulta enviada al conector '.$conector->name.'.' : 'Sin servicio de consulta configurado en Integraciones: se validó el formato del RUC.');
        DB::table('suppliers')->where('id', $id)->update(['sunat_checked_at' => now(), 'sunat_msg' => $msg, 'updated_at' => now()]);

        return self::ver($id);
    }

    /** Fija el estado SUNAT leído en la consulta (la contadora lo registra si no hay conector). */
    public static function fijarEstadoSunat(string $id, string $estado, ?string $nota): object
    {
        C::proveedor($id);
        DB::table('suppliers')->where('id', $id)->update([
            'sunat_status' => $estado, 'sunat_checked_at' => now(), 'updated_at' => now(),
            'sunat_msg' => mb_substr(trim((string) $nota) ?: 'Estado registrado a mano tras consultar la SUNAT.', 0, 255),
        ]);

        return self::ver($id);
    }

    /** RN-COM-13: con com.supplier.bank_change se aplica; sin él queda pendiente para GERENTE. */
    public static function pedirCambioCuenta(string $id, string $cuenta, ?string $motivo, User $quien): array
    {
        $s = C::proveedor($id);
        $cuenta = trim($cuenta);
        if ($cuenta === '') {
            RuleError::fail('RN-COM-13', 'Indica el número de cuenta bancaria.');
        }
        if (Access::can($quien, 'com.supplier.bank_change')) {
            DB::table('suppliers')->where('id', $id)->update(['bank_account' => $cuenta, 'pending_bank_change' => null, 'bank_changed_at' => now(), 'bank_changed_by' => $quien->id, 'updated_at' => now()]);

            return ['applied' => true];
        }
        DB::table('suppliers')->where('id', $id)->update(['pending_bank_change' => json_encode([
            'account' => $cuenta, 'reason' => $motivo, 'requested_by' => $quien->id, 'requested_by_name' => $quien->name, 'requested_at' => C::ahora()->format('Y-m-d\TH:i'),
        ], JSON_UNESCAPED_UNICODE), 'updated_at' => now()]);
        C::avisar(['GERENTE'], 'Cambio de cuenta bancaria por aprobar', C::nombreProveedor($s).": {$cuenta}", 'COM', 'COM-01', $id);

        return ['applied' => false];
    }

    public static function aprobarCambioCuenta(string $id, User $quien): object
    {
        return DB::transaction(function () use ($id, $quien) {
            $s = DB::table('suppliers')->where('id', $id)->lockForUpdate()->first() ?? abort(404);
            $p = json_decode($s->pending_bank_change ?? 'null', true) ?: RuleError::fail('RN-COM-13', 'No hay un cambio de cuenta pendiente.');
            if (($p['requested_by'] ?? null) === $quien->id) {
                RuleError::fail('RN-COM-13', 'Quien pide el cambio de cuenta no lo aprueba.');
            }
            DB::table('suppliers')->where('id', $id)->update(['bank_account' => $p['account'], 'pending_bank_change' => null, 'bank_changed_at' => now(), 'bank_changed_by' => $quien->id, 'updated_at' => now()]);

            return self::ver($id);
        });
    }

    public static function rechazarCambioCuenta(string $id): object
    {
        DB::table('suppliers')->where('id', $id)->update(['pending_bank_change' => null, 'updated_at' => now()]);

        return self::ver($id);
    }

    /** RN-COM-11: el proveedor puede recibir una OC. */
    public static function exigirQuePuedaComprar(object $s): void
    {
        if ($s->status !== 'ACTIVE') {
            RuleError::fail('RN-COM-11', C::nombreProveedor($s).' está inactivo: no recibe órdenes de compra.');
        }
        if (in_array($s->sunat_status, C::SUNAT_BLOQUEA, true)) {
            $e = ['NOT_LOCATED' => 'no habido', 'LOW' => 'de baja', 'SUSPENDED' => 'con suspensión temporal'][$s->sunat_status];
            RuleError::fail('RN-COM-11', C::nombreProveedor($s)." figura {$e} en la SUNAT: no recibe órdenes de compra hasta que regularice.");
        }
    }

    public static function ver(string $id): object
    {
        $s = DB::table('suppliers as s')->leftJoin('cost_centers as cc', 'cc.id', '=', 's.default_cost_center_id')->where('s.id', $id)
            ->first(['s.*', 'cc.code as cost_center_code', 'cc.name as cost_center_name']) ?? abort(404);
        $s->pending_bank_change = json_decode($s->pending_bank_change ?? 'null', true);
        $s->bank_changed_by_name = C::usuario($s->bank_changed_by ?? null);

        return $s;
    }

    /* ============================================================ COM-02 catálogo */

    public static function guardarCatalogo(array $d, ?string $id): object
    {
        return DB::transaction(function () use ($d, $id) {
            C::proveedor($d['supplier_id']);
            $dup = DB::table('supplier_catalog')->where('supplier_id', $d['supplier_id'])->where('variant_id', $d['variant_id'])->when($id, fn ($q) => $q->where('id', '<>', $id))->exists();
            if ($dup) {
                RuleError::fail('RN-COM-02', 'Ese producto ya está en el catálogo del proveedor: edita su fila.');
            }
            $uom = $d['purchase_uom_id'] ?? DB::table('units_of_measure')->where('code', ($d['price_basis'] ?? 'KG') === 'KG' ? 'KGM' : 'NIU')->value('id')
                ?? DB::table('units_of_measure')->orderBy('code')->value('id');
            $fila = [
                'supplier_id' => $d['supplier_id'], 'variant_id' => $d['variant_id'], 'supplier_sku' => $d['supplier_sku'] ?? null, 'purchase_uom_id' => $uom,
                'price_basis' => $d['price_basis'], 'min_order_qty' => $d['min_order_qty'] ?? null, 'lead_time_days' => (int) ($d['lead_time_days'] ?? 1),
                'status' => $d['status'] ?? 'ACTIVE', 'updated_at' => now(),
            ];
            if ($id) {
                $c = DB::table('supplier_catalog')->where('id', $id)->first() ?? abort(404);
                DB::table('supplier_catalog')->where('id', $id)->update($fila);
                if (isset($d['last_price']) && abs((float) $d['last_price'] - (float) $c->last_price) > 0.0000001) {
                    self::precio($d['supplier_id'], $d['variant_id'], (float) $d['last_price'], C::hoy(), 'MANUAL');
                }
            } else {
                $id = DB::table('supplier_catalog')->insertGetId($fila + ['last_price' => $d['last_price'] ?? 0, 'price_history' => json_encode([
                    ['date' => C::hoy(), 'price' => (float) ($d['last_price'] ?? 0), 'source' => 'MANUAL'],
                ])], 'id');
            }

            return DB::table('supplier_catalog')->find($id);
        });
    }

    /** Último precio del catálogo y su historial (lo llaman la OC y el comprobante). */
    public static function precio(string $supplierId, string $variantId, float $precio, string $fecha, string $origen): void
    {
        $c = DB::table('supplier_catalog')->where('supplier_id', $supplierId)->where('variant_id', $variantId)->first();
        if (! $c) {
            return;
        }
        $h = json_decode($c->price_history ?? '[]', true) ?: [];
        $h[] = ['date' => $fecha, 'price' => round($precio, 6), 'source' => $origen];
        DB::table('supplier_catalog')->where('id', $c->id)->update(['last_price' => round($precio, 6), 'price_history' => json_encode(array_slice($h, -40)), 'updated_at' => now()]);
    }

    public static function precioDe(string $supplierId, string $variantId): ?float
    {
        $p = DB::table('supplier_catalog')->where('supplier_id', $supplierId)->where('variant_id', $variantId)->where('status', 'ACTIVE')->value('last_price');

        return $p === null ? null : (float) $p;
    }
}
