<?php

namespace App\Support;

use Illuminate\Support\Facades\DB;

/**
 * Parámetros de la spec (G.param del prototipo): primero el valor de la empresa (parameters, con RLS),
 * si no hay, el valor por defecto de parameter_definitions. Con marca o local, se busca primero ahí.
 *   Params::get('seg_max_failed_logins')
 *   Params::get('ped_weight_tolerance_pct', ['brand' => $brandId])
 */
final class Params
{
    public static function get(string $key, array $scope = []): mixed
    {
        foreach (['brand' => 'BRAND', 'site' => 'ESTABLISHMENT'] as $k => $type) {
            if (! empty($scope[$k])) {
                $v = DB::table('parameters')->where(['key' => $key, 'scope' => $type, 'scope_id' => $scope[$k]])->value('value');
                if ($v !== null) {
                    return $v;
                }
            }
        }
        $v = DB::table('parameters')->where('key', $key)->whereNull('scope_id')->value('value');

        return $v ?? DB::table('parameter_definitions')->where('key', $key)->value('default_value');
    }
}
