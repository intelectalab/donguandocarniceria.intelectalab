<?php

namespace App\Modulos\Alm\Services;

use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/** ALM-01: almacenes y ubicaciones por local (permiso alm.warehouse.manage). */
final class AlmacenesService
{
    public const TIPOS = ['MAIN', 'COLD_ROOM', 'FREEZER', 'STORE', 'PRODUCTION', 'QUARANTINE', 'TRANSIT', 'VEHICLE', 'RETURNS', 'CONSIGNMENT'];

    public static function guardar(array $d, ?string $id): object
    {
        $codigo = strtoupper(trim((string) ($d['code'] ?? '')));
        if ($codigo === '' || trim((string) ($d['name'] ?? '')) === '') {
            RuleError::fail('RN-ALM-01', 'El almacén necesita código y nombre.');
        }
        if (! in_array($d['wh_type'] ?? '', self::TIPOS, true)) {
            RuleError::fail('RN-ALM-01', 'Elige el tipo de almacén.');
        }
        if (($d['wh_type'] ?? '') !== 'TRANSIT' && empty($d['establishment_id'])) {
            RuleError::fail('RN-ALM-01', 'Elige el local del almacén (solo el de tránsito va sin local).');
        }
        if (isset($d['min_temp_c'], $d['max_temp_c']) && $d['min_temp_c'] !== '' && $d['max_temp_c'] !== '' && (float) $d['min_temp_c'] > (float) $d['max_temp_c']) {
            RuleError::fail('RN-ALM-01', 'La temperatura mínima no puede ser mayor que la máxima.');
        }
        if (! empty($d['parent_id']) && $d['parent_id'] === $id) {
            RuleError::fail('RN-ALM-01', 'Un almacén no puede estar dentro de sí mismo.');
        }
        if (DB::table('warehouses')->where('code', $codigo)->when($id, fn ($q) => $q->where('id', '<>', $id))->exists()) {
            RuleError::fail('RN-ALM-01', "Ya existe un almacén con el código {$codigo}.");
        }
        $estado = $d['status'] ?? 'ACTIVE';
        if ($id && $estado === 'INACTIVE' && DB::table('stock_balances')->where('warehouse_id', $id)->where('qty', '>', 0)->exists()) {
            RuleError::fail('RN-ALM-01', 'El almacén tiene stock: trasládalo antes de desactivarlo.');
        }
        $num = fn ($k) => isset($d[$k]) && $d[$k] !== '' && $d[$k] !== null ? (float) $d[$k] : null;
        $fila = [
            'code' => $codigo, 'name' => trim($d['name']), 'wh_type' => $d['wh_type'], 'establishment_id' => $d['establishment_id'] ?? null,
            'min_temp_c' => $num('min_temp_c'), 'max_temp_c' => $num('max_temp_c'), 'allows_sale' => (bool) ($d['allows_sale'] ?? false),
            'pick_priority' => (int) ($d['pick_priority'] ?? 100), 'parent_id' => $d['parent_id'] ?? null, 'vehicle_id' => $d['vehicle_id'] ?? null,
            'status' => in_array($estado, ['ACTIVE', 'INACTIVE'], true) ? $estado : 'ACTIVE',
        ];
        if ($id) {
            DB::table('warehouses')->where('id', $id)->update($fila + ['updated_at' => now()]) ?: RuleError::fail('RN-ALM-01', 'Almacén no encontrado.');
        } else {
            $id = DB::table('warehouses')->insertGetId($fila, 'id');
        }

        return DB::table('warehouses')->find($id);
    }
}
