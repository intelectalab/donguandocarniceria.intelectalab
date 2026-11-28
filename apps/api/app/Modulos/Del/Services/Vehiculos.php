<?php

namespace App\Modulos\Del\Services;

use App\Models\User;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/** DEL-12 Vehículos propios y alquilados con SOAT y revisión técnica (RN-DEL-03), odómetro y tarifa de alquiler. */
final class Vehiculos
{
    public const ESTADOS = ['ACTIVE' => 'Activo', 'MAINTENANCE' => 'En mantenimiento', 'INACTIVE' => 'Inactivo'];

    public static function guardar(?string $id, array $d, User $u): object
    {
        return DB::transaction(function () use ($id, $d, $u) {
            $placa = mb_strtoupper(preg_replace('/\s+/', '', (string) ($d['plate'] ?? '')));
            if (! preg_match('/^[A-Z0-9]{2,4}-?[A-Z0-9]{2,4}$/', $placa)) {
                RuleError::fail('RN-DEL-03', 'Escribe la placa (por ejemplo MTA-123 o 1234-AB).');
            }
            if (DB::table('vehicles')->whereRaw('upper(plate) = ?', [$placa])->when($id, fn ($q) => $q->where('id', '<>', $id))->exists()) {
                RuleError::fail('RN-DEL-03', "Ya existe un vehículo con la placa {$placa}.");
            }
            Base::exigirEn((string) ($d['vehicle_type'] ?? ''), Base::VEHICULOS, 'RN-DEL-03', 'Elige el tipo de vehículo.');
            $propiedad = (string) ($d['ownership'] ?? '');
            if (! in_array($propiedad, ['OWN', 'RENTED'], true)) {
                RuleError::fail('RN-DEL-03', 'Indica si es propio o alquilado.');
            }
            $local = $d['establishment_id'] ?? null;
            if (! $local || ! DB::table('establishments')->where('id', $local)->exists() || ! Base::veLocal($u, $local)) {
                RuleError::fail('RN-DEL-03', 'Elige el local del vehículo.');
            }
            if (! isset($d['capacity_kg']) || (float) $d['capacity_kg'] <= 0) {
                RuleError::fail('RN-DEL-03', 'Escribe la capacidad en kg.');
            }
            $proveedor = $d['provider_id'] ?? null ?: null;
            $tarifa = isset($d['rental_daily_rate']) && $d['rental_daily_rate'] !== '' ? round((float) $d['rental_daily_rate'], 2) : null;
            if ($propiedad === 'RENTED') {
                if ($tarifa === null || $tarifa < 0) {
                    RuleError::fail('RN-DEL-03', 'Un vehículo alquilado lleva su tarifa diaria de alquiler.');
                }
            } else {
                $proveedor = null;
                $tarifa = null;
            }
            if ($proveedor && ! DB::table('suppliers')->where('id', $proveedor)->exists()) {
                RuleError::fail('RN-DEL-03', 'El proveedor del alquiler no existe.');
            }
            $estado = $d['status'] ?? 'ACTIVE';
            Base::exigirEn($estado, self::ESTADOS, 'RN-DEL-03', 'Elige el estado del vehículo.');
            $combustible = $d['fuel_type'] ?? ($d['vehicle_type'] === 'BICYCLE' ? 'NONE' : 'GASOLINE');
            Base::exigirEn($combustible, Base::COMBUSTIBLES, 'RN-DEL-03', 'Elige el combustible.');
            $odo = isset($d['odometer_km']) && $d['odometer_km'] !== '' ? round((float) $d['odometer_km'], 1) : 0.0;
            if ($odo < 0) {
                RuleError::fail('RN-DEL-03', 'El odómetro no puede ser negativo.');
            }
            if ($id) {
                $antes = DB::table('vehicles')->where('id', $id)->first();
                if (! $antes || ! Base::veLocal($u, $antes->establishment_id)) {
                    abort(404, 'No se encontró el vehículo.');
                }
                if ($odo < (float) $antes->odometer_km - 0.05) {
                    RuleError::fail('RN-DEL-03', 'El odómetro no baja: el último registrado es '.number_format((float) $antes->odometer_km, 1, ',', '.').' km.');
                }
                if ($estado !== 'ACTIVE' && DB::table('delivery_routes')->where('vehicle_id', $id)->whereIn('status', ['IN_ROUTE'])->exists()) {
                    RuleError::fail('RN-DEL-03', 'El vehículo está en ruta: cámbialo de estado cuando vuelva.');
                }
            }
            $fila = [
                'plate' => $placa, 'vehicle_type' => $d['vehicle_type'], 'ownership' => $propiedad, 'provider_id' => $proveedor, 'establishment_id' => $local,
                'capacity_kg' => round((float) $d['capacity_kg'], 3), 'refrigerated' => (bool) ($d['refrigerated'] ?? false), 'status' => $estado, 'fuel_type' => $combustible,
                'soat_policy_no' => ! empty($d['soat_policy_no']) ? mb_substr(trim($d['soat_policy_no']), 0, 40) : null,
                'soat_expires_on' => $d['soat_expires_on'] ?? null ?: null, 'tech_inspection_expires_on' => $d['tech_inspection_expires_on'] ?? null ?: null,
                'odometer_km' => $odo, 'rental_daily_rate' => $tarifa, 'notes' => ! empty($d['notes']) ? mb_substr(trim($d['notes']), 0, 255) : null, 'updated_at' => now(),
            ];
            if ($id) {
                DB::table('vehicles')->where('id', $id)->update($fila);
            } else {
                $id = DB::table('vehicles')->insertGetId($fila, 'id');
            }

            return DB::table('vehicles')->where('id', $id)->first();
        });
    }

    /** Ficha para la lista: documentos a hoy, rutas del mes y costo de mantenimiento. */
    public static function ficha(object $v, string $fecha): array
    {
        [$desde, $hasta] = Costos::mes($fecha);

        return (array) $v + [
            'avisos' => Rutas::documentos($v, $fecha),
            'rutas_mes' => DB::table('delivery_routes')->where('vehicle_id', $v->id)->whereBetween('route_date', [$desde, $hasta])->where('status', '<>', 'CANCELLED')->count(),
            'mantenimiento_mes' => round((float) DB::table('delivery_costs')->where('vehicle_id', $v->id)->where('status', 'ACTIVE')
                ->whereIn('cost_type', ['MAINTENANCE_PREVENTIVE', 'MAINTENANCE_CORRECTIVE'])->whereBetween('cost_date', [$desde, $hasta])->sum('amount'), 2),
            'local' => DB::table('establishments')->where('id', $v->establishment_id)->value('name'),
            'proveedor' => $v->provider_id ? DB::table('suppliers')->where('id', $v->provider_id)->value('trade_name') : null,
        ];
    }
}
