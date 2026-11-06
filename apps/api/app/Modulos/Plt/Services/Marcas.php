<?php

namespace App\Modulos\Plt\Services;

use App\Modulos\Plt\Models\Brand;
use App\Support\RuleError;

/**
 * Lo que otros módulos preguntan de una marca. Antes de crear un pedido, comprobante, producto…:
 *   Marcas::activa($brandId);
 */
final class Marcas
{
    /** La marca existe y admite documentos nuevos (RN-PLT-14). Las inactivas o separadas solo se consultan. */
    public static function activa(string $brandId): Brand
    {
        $marca = Brand::find($brandId) ?? RuleError::fail('RN-PLT-14', 'La marca no existe.');
        if ($marca->status !== 'ACTIVE') {
            $estado = $marca->status === 'SEPARATED' ? 'separada' : 'inactiva';
            RuleError::fail('RN-PLT-14', "La marca {$marca->name} está {$estado}: no admite documentos nuevos. Sus documentos anteriores se siguen consultando.");
        }

        return $marca;
    }
}
