<?php

namespace App\Modulos\Plt\Services;

use App\Modulos\Plt\Models\Brand;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * Lo que otros módulos preguntan de una marca. Antes de crear un pedido, comprobante, producto…:
 *   Marcas::activa($brandId);
 */
final class Marcas
{
    /** La marca existe y admite documentos nuevos (RN-PLT-14, RN-SEP-06). Las inactivas o separadas solo se consultan. */
    public static function activa(string $brandId, string $reglaSeparada = 'RN-PLT-14'): Brand
    {
        $marca = Brand::find($brandId) ?? RuleError::fail('RN-PLT-14', 'La marca no existe.');
        if ($marca->status !== 'ACTIVE') {
            if ($marca->status === 'SEPARATED') {
                RuleError::fail($reglaSeparada, "La marca {$marca->name} ya fue separada: no admite pedidos ni comprobantes nuevos. Sus documentos anteriores se siguen consultando.");
            }
            RuleError::fail('RN-PLT-14', "La marca {$marca->name} está inactiva: no admite documentos nuevos. Sus documentos anteriores se siguen consultando.");
        }

        return $marca;
    }

    /**
     * Empresa emisora vigente para una marca en una fecha dada según brand_company_history (RN-SEP-05).
     * Si no hay vigencia para esa fecha, devuelve null (p. ej. si la marca se separó a otro cliente o sistema).
     */
    public static function empresaParaFecha(string $brandId, string $fecha): ?object
    {
        if (! DB::getSchemaBuilder()->hasTable('brand_company_history')) {
            return null;
        }
        $filas = DB::table('brand_company_history')
            ->where('brand_id', $brandId)
            ->orderBy('valid_from')
            ->get();

        if ($filas->isEmpty()) {
            return null;
        }

        foreach ($filas as $h) {
            if ($h->valid_from <= $fecha && ($h->valid_to === null || $fecha <= $h->valid_to)) {
                return $h;
            }
        }

        return null;
    }
}
