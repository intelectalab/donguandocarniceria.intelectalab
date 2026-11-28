<?php

namespace App\Modulos\Flo\Services;

use App\Models\User;
use App\Modulos\Gas\Services\Gastos as GasGastos;
use App\Support\Access;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * RN-FLO-17: cada carga de combustible, mantenimiento con comprobante, multa pagada y otro costo se registra una sola
 * vez como gasto en GAS. FLO no escribe en las tablas de GAS: enlaza un gasto ya registrado o crea su borrador con el
 * servicio de GAS (que aplica sus propias reglas RN-GAS-01 a 13).
 */
final class Gastos
{
    /** Tablas de FLO que enlazan un gasto. */
    public const TABLAS = ['fuel_loads' => 'number', 'vehicle_maintenances' => 'number', 'traffic_fines' => 'ballot_number', 'vehicle_costs' => 'id'];

    /** Tipo de costo de reparto (GAS) de cada costo de FLO, y el de respaldo si la empresa no tiene esa categoría. */
    public const TIPO_COSTO = [
        'FUEL' => ['FUEL'], 'MAINTENANCE_PREVENTIVE' => ['MAINTENANCE_PREVENTIVE', 'MAINTENANCE_CORRECTIVE'], 'MAINTENANCE_CORRECTIVE' => ['MAINTENANCE_CORRECTIVE', 'MAINTENANCE_PREVENTIVE'],
        'FINE' => ['FINE'], 'RENT' => ['RENT'], 'TOLL' => ['TOLL', 'PARKING'], 'PARKING' => ['PARKING', 'TOLL'], 'INSURANCE' => ['SOAT', 'OTHER'], 'TAX' => ['SOAT', 'OTHER'],
        'WASH' => ['MAINTENANCE_CORRECTIVE', 'OTHER'], 'TIRES' => ['MAINTENANCE_CORRECTIVE', 'OTHER'], 'OTHER' => ['OTHER', 'MAINTENANCE_CORRECTIVE'],
    ];

    /** ¿A qué registro de FLO ya está enlazado ese gasto? */
    public static function enlazadoA(string $gastoId, ?string $salvoTabla = null, ?string $salvoId = null): ?string
    {
        foreach (self::TABLAS as $t => $col) {
            $r = DB::table($t)->where('expense_id', $gastoId)->where('status', '<>', 'VOIDED')
                ->when($salvoTabla === $t, fn ($q) => $q->where('id', '<>', $salvoId))->first();
            if ($r) {
                return $col === 'id' ? 'un costo del vehículo' : $r->{$col};
            }
        }

        return null;
    }

    /** Enlaza un gasto de GAS al registro (una sola vez, del mismo vehículo, ni anulado ni rechazado). */
    public static function enlazar(string $tabla, string $id, string $gastoId): void
    {
        $fila = DB::table($tabla)->where('id', $id)->first();
        $g = DB::table('expenses')->where('id', $gastoId)->first(['id', 'number', 'status', 'vehicle_id', 'amount_pen']);
        if (! $fila || ! $g) {
            RuleError::fail('RN-FLO-17', 'No se encontró el gasto.');
        }
        if ($fila->expense_id && $fila->expense_id !== $gastoId) {
            RuleError::fail('RN-FLO-17', 'Este registro ya está enlazado al gasto '.DB::table('expenses')->where('id', $fila->expense_id)->value('number').'.');
        }
        if (in_array($g->status, ['VOIDED', 'REJECTED'], true)) {
            RuleError::fail('RN-FLO-17', "El gasto {$g->number} está ".($g->status === 'VOIDED' ? 'anulado' : 'rechazado').'.');
        }
        if ($g->vehicle_id && $g->vehicle_id !== $fila->vehicle_id) {
            RuleError::fail('RN-FLO-17', "El gasto {$g->number} es de otro vehículo.");
        }
        if ($otro = self::enlazadoA($gastoId, $tabla, $id)) {
            RuleError::fail('RN-FLO-17', "El gasto {$g->number} ya está enlazado a {$otro}: cada comprobante se registra una sola vez como gasto.");
        }
        DB::table($tabla)->where('id', $id)->update(['expense_id' => $gastoId, 'updated_at' => now()]);
    }

    /** Después de registrar en FLO: enlaza el gasto elegido o crea su borrador en GAS, según lo que pidió la persona. */
    public static function alRegistrar(string $tabla, string $id, array $d, array $c, User $u): void
    {
        if (! empty($d['expense_id'])) {
            self::enlazar($tabla, $id, (string) $d['expense_id']);

            return;
        }
        if (filter_var($d['create_expense'] ?? false, FILTER_VALIDATE_BOOLEAN)) {
            $gid = self::crear($c, $d, $u);
            self::enlazar($tabla, $id, $gid);
        }
    }

    /** Borrador del gasto en GAS con los datos del registro de FLO (la persona lo completa y lo envía a aprobar en GAS). */
    public static function crear(array $c, array $d, User $u): string
    {
        if (! in_array('GAS', Access::for($u)['enabled_modules'], true)) {
            RuleError::fail('RN-FLO-17', 'Gastos (GAS) está apagado: registra el gasto cuando se encienda y enlázalo después.');
        }
        if (! Access::can($u, 'gas.expense.create')) {
            abort(403, 'Tu rol no registra gastos: pide a administración que lo registre y luego enlázalo.');
        }
        $cat = null;
        foreach (self::TIPO_COSTO[$c['tipo']] ?? ['OTHER'] as $t) {
            $cat = DB::table('expense_categories')->where('category_group', 'DELIVERY')->where('delivery_cost_type', $t)->where('status', 'ACTIVE')->orderBy('code')->first();
            if ($cat) {
                break;
            }
        }
        if (! $cat) {
            RuleError::fail('RN-FLO-17', 'No hay una categoría de gasto de reparto para este costo: créala en Gastos (Categorías).');
        }
        $cc = DB::table('cost_centers')->where('status', 'ACTIVE')->where(fn ($w) => $w->whereRaw('upper(code) = ?', ['DEL'])->orWhere('area', 'DELIVERY'))->orderBy('code')->value('id')
            ?? DB::table('cost_centers')->where('status', 'ACTIVE')->orderBy('code')->value('id');
        $v = $c['vehiculo'];
        $doc = (string) ($d['doc_type'] ?? '') ?: $cat->default_doc_type;
        $monto = round((float) $c['monto'], 2);
        $datos = [
            'establishment_id' => $v->establishment_id, 'cost_center_id' => $cc, 'category_id' => $cat->id, 'issue_date' => $c['fecha'], 'description' => mb_substr($c['descripcion'], 0, 2000),
            'doc_type' => $doc, 'doc_series' => $d['doc_series'] ?? null, 'doc_number' => $d['doc_number'] ?? null, 'supplier_doc' => $d['supplier_doc'] ?? null,
            'supplier_name' => $d['supplier_name'] ?? null, 'supplier_id' => ($d['supplier_doc'] ?? null) ? null : ($c['proveedor'] ?? null),
            'total' => $monto, 'igv' => $doc === 'INVOICE' ? round($monto - $monto / 1.18, 2) : 0, 'currency' => 'PEN',
            'vehicle_id' => $v->id, 'employee_id' => $c['empleado'] ?? null, 'fuel_gallons' => $c['galones'] ?? null, 'fuel_voucher_no' => $c['vale'] ?? null,
            'odometer_km' => $c['odometro'] ?? null, 'pay_source' => 'PAYABLE',
        ];
        $g = GasGastos::guardar($datos, null, $u);
        if (! empty($c['foto'])) {
            DB::table('expenses')->where('id', $g->id)->update(['receipt_file_id' => $c['foto']]);
        }

        return $g->id;
    }

    /** Gastos de GAS que se pueden enlazar: del vehículo, de la categoría del costo y sin enlace. */
    public static function candidatos(string $tipo, string $vehiculoId, User $u): array
    {
        Base::vehiculo($vehiculoId, $u, 'RN-FLO-17');
        $tipos = self::TIPO_COSTO[$tipo] ?? [];
        $q = DB::table('expenses as e')->join('expense_categories as c', 'c.id', '=', 'e.category_id')
            ->where('e.vehicle_id', $vehiculoId)->whereNotIn('e.status', ['VOIDED', 'REJECTED'])
            ->when($tipos, fn ($w) => $w->whereIn('c.delivery_cost_type', $tipos));
        foreach (self::TABLAS as $t => $col) {
            $q->whereNotExists(fn ($x) => $x->from($t)->whereColumn("{$t}.expense_id", 'e.id')->where("{$t}.status", '<>', 'VOIDED'));
        }

        return $q->orderByDesc('e.issue_date')->limit(30)
            ->get(['e.id', 'e.number', 'e.issue_date', 'e.amount_pen', 'e.status', 'e.description', 'e.doc_type', 'e.doc_series', 'e.doc_number', 'e.fuel_gallons', 'c.name as categoria'])
            ->map(fn ($e) => array_replace((array) $e, ['amount_pen' => (float) $e->amount_pen]))->all();
    }
}
