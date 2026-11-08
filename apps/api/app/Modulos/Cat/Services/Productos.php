<?php

namespace App\Modulos\Cat\Services;

use App\Models\User;
use App\Modulos\Cat\Models\Product;
use App\Modulos\Plt\Services\Marcas;
use App\Support\Access;
use App\Support\Events;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * Crear, editar, activar e inactivar productos (CAT-02) con sus reglas:
 *  RN-CAT-01  código único en la empresa; un producto es de una sola marca (con ventas, no cambia de marca).
 *  RN-CAT-09  un producto DIGESA activo tiene número de registro y vencimiento; vencido, no se publica en la web.
 *  RN-CAT-11  un producto no se borra: se inactiva, y sus variantes activas con él.
 *  RN-CAT-13  cambiar la afectación del IGV de un producto con ventas exige cat.product.tax_change y motivo.
 */
final class Productos
{
    /** Ya se vendió alguna de sus variantes (en un pedido). */
    public static function tieneVentas(string $productId): bool
    {
        return DB::table('sales_order_lines')
            ->whereIn('variant_id', DB::table('product_variants')->select('id')->where('product_id', $productId))
            ->exists();
    }

    /** @param  array<string, mixed>  $datos  campos validados del formulario */
    public static function guardar(array $datos, ?Product $actual, User $quien): Product
    {
        $marcas = Access::for($quien)['brands'];
        if ($marcas && ! in_array($datos['brand_id'], $marcas, true)) {
            RuleError::fail('RN-CAT-01', 'Solo puedes registrar productos de tus marcas.');
        }
        if (! $actual || $actual->brand_id !== $datos['brand_id']) {
            Marcas::activa($datos['brand_id']); // RN-PLT-14: no se crean productos en una marca inactiva
        }

        $conVentas = $actual && self::tieneVentas($actual->id);
        if ($conVentas && $actual->brand_id !== $datos['brand_id']) {
            RuleError::fail('RN-CAT-01', 'El producto ya tiene ventas con su marca: para venderlo en otra marca crea otro producto («Copiar a otra marca»).');
        }

        $status = $datos['status'] ?? 'ACTIVE';
        $autoridad = $datos['sanitary_authority'] ?? 'NONE';
        if ($autoridad === 'DIGESA' && $status === 'ACTIVE' && (empty($datos['sanitary_registry']) || empty($datos['sanitary_registry_expires']))) {
            RuleError::fail('RN-CAT-09', 'Un producto DIGESA activo necesita número de registro sanitario y fecha de vencimiento.');
        }

        $motivoIgv = trim((string) ($datos['tax_change_reason'] ?? ''));
        $cambiaIgv = $actual && $actual->igv_affectation !== $datos['igv_affectation'];
        if ($cambiaIgv && $conVentas) {
            if (! Access::can($quien, 'cat.product.tax_change')) {
                RuleError::fail('RN-CAT-13', 'Cambiar la afectación del IGV de un producto con ventas exige el permiso cat.product.tax_change.');
            }
            if (mb_strlen($motivoIgv) < 10) {
                RuleError::fail('RN-CAT-13', 'Escribe el motivo del cambio de afectación del IGV (al menos 10 caracteres): queda en la auditoría.');
            }
        }

        $linea = $datos['product_type'] === 'COMBO' ? 'COMBOS'
            : (DB::table('product_categories')->where('id', $datos['category_id'])->value('line') ?? $actual?->line ?? 'OTROS');

        $fila = [
            'code' => $datos['code'], 'name' => $datos['name'], 'brand_id' => $datos['brand_id'], 'category_id' => $datos['category_id'],
            'line' => $linea, 'product_type' => $datos['product_type'], 'origin' => $datos['origin'], 'storage' => $datos['storage'],
            'shelf_life_days' => (int) ($datos['shelf_life_days'] ?? 0), 'requires_lot' => (bool) ($datos['requires_lot'] ?? false),
            'igv_affectation' => $datos['igv_affectation'], 'sunat_product_code' => $datos['sunat_product_code'] ?? null,
            'allow_discount' => (bool) ($datos['allow_discount'] ?? true),
            'sanitary_authority' => $autoridad, 'sanitary_registry' => $datos['sanitary_registry'] ?? null,
            'sanitary_registry_expires' => $datos['sanitary_registry_expires'] ?? null, 'status' => $status,
        ];

        return DB::transaction(function () use ($fila, $actual, $cambiaIgv, $motivoIgv, $conVentas) {
            $vencido = RegistroSanitario::estado($fila)['code'] === 'EXPIRED';

            if (! $actual) {
                $p = Product::create($fila + ['web_publishable' => false, 'web_sync_status' => 'NOT_PUBLISHED']);
            } else {
                if ($vencido && $actual->web_publishable) {
                    $fila['web_publishable'] = false; // RN-CAT-09: con el registro vencido no se publica
                }
                // Un producto publicado que cambia se vuelve a enviar a la tienda en la siguiente sincronización (WEB).
                if (($fila['web_publishable'] ?? $actual->web_publishable) && $actual->web_sync_status === 'SYNCED') {
                    $fila['web_sync_status'] = 'PENDING';
                }
                $marcaAnterior = $actual->brand_id;
                $igvAnterior = $actual->igv_affectation;
                $actual->update($fila);
                $p = $actual;

                if ($fila['status'] !== 'ACTIVE') {
                    DB::table('product_variants')->where('product_id', $p->id)->where('status', 'ACTIVE')
                        ->update(['status' => 'INACTIVE', 'updated_at' => now()]);
                }
                if ($marcaAnterior !== $p->brand_id) {
                    DB::table('product_variants')->where('product_id', $p->id)->update(['brand_id' => $p->brand_id, 'updated_at' => now()]);
                }
                if ($cambiaIgv && $conVentas) {
                    Events::emit('product.tax_changed', 'products', $p->id,
                        ['code' => $p->code, 'from' => $igvAnterior, 'to' => $p->igv_affectation, 'reason' => $motivoIgv]);
                }
            }

            Events::emit('product.changed', 'products', $p->id, ['code' => $p->code, 'status' => $p->status]);

            return $p->fresh();
        });
    }

    /** Activar o inactivar desde la ficha, con las mismas reglas que al editar. */
    public static function cambiarEstado(Product $p, string $status, User $quien): Product
    {
        $datos = $p->only(['code', 'name', 'brand_id', 'category_id', 'product_type', 'origin', 'storage', 'shelf_life_days',
            'requires_lot', 'igv_affectation', 'sunat_product_code', 'allow_discount', 'sanitary_authority', 'sanitary_registry']);
        $datos['sanitary_registry_expires'] = $p->sanitary_registry_expires ? substr((string) $p->sanitary_registry_expires, 0, 10) : null;
        $datos['status'] = $status;

        return self::guardar($datos, $p, $quien);
    }
}
