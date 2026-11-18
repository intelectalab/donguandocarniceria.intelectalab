<?php

namespace App\Modulos\Equ\Services;

use App\Models\User;
use App\Modulos\Plt\Services\Periodos;
use App\Support\Access;
use App\Support\Events;
use App\Support\Params;
use App\Support\RuleError;
use Carbon\CarbonImmutable;
use Illuminate\Database\QueryException;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * EQU · Equipos, calibración y mantenimiento. Dueño de equipment, equipment_calibrations, maintenance_plans,
 * maintenance_orders y equipment_usage: nadie más escribe esas tablas. Los demás módulos (PRO, ALM, CAL)
 * preguntan si un equipo se puede usar con exigirApto() o exigirBalanza(), y PRO registra horas con registrarUso().
 *
 *  RN-EQU-01  toda balanza exige calibración (también en la base).
 *  RN-EQU-02  calibración con número y archivo del certificado y vigencia posterior a la fecha (también en la base).
 *  RN-EQU-03  un equipo que exige calibración sin calibración PASS vigente a la fecha no se usa.
 *  RN-EQU-04  un equipo OUT_OF_SERVICE o RETIRED no se usa.
 *  RN-EQU-05  abrir una correctiva lo deja OUT_OF_SERVICE; cerrarla lo devuelve a ACTIVE si no queda otra abierta.
 *  RN-EQU-06  costo = mano de obra + repuestos + servicio externo, al centro de costo del equipo (también en la base).
 *  RN-EQU-07  el plan crea la orden al llegar la fecha o las horas; con más de equ_preventive_overdue_days de atraso avisa.
 *  RN-EQU-08  aviso equ_calibration_alert_days antes del vencimiento de una calibración.
 *  RN-EQU-09  carga por hora sugerida = (compra / vida útil + mantenimiento mensual) / horas de uso mensuales.
 *  RN-EQU-10  una calibración FAIL deja el equipo OUT_OF_SERVICE hasta una nueva PASS.
 *  RN-EQU-11  cámara o congeladora sin punto de temperatura en CAL no pasa a ACTIVE.
 *  RN-EQU-12  calibraciones de solo inserción (la base no deja cambiarlas ni borrarlas).
 */
final class EquiposService
{
    public const CATEGORIAS = ['SEALER', 'STOVE', 'POT', 'SCALE', 'COLD_ROOM', 'FREEZER', 'GRINDER', 'STUFFER', 'SAW', 'SLICER', 'LABEL_PRINTER', 'THERMOMETER', 'OTHER'];

    /** RN-EQU-11: equipos de frío con punto de temperatura en CAL. */
    public const FRIO = ['COLD_ROOM', 'FREEZER'];

    /** Equipos que no se registran por horas en producción (EQU-08). */
    public const SIN_HORAS = ['COLD_ROOM', 'FREEZER', 'LABEL_PRINTER'];

    public const ESTADOS = ['ACTIVE', 'OUT_OF_SERVICE', 'RETIRED'];

    public const URGENCIAS = ['LOW', 'NORMAL', 'HIGH'];

    /** Días de la ventana «por vencer» del calendario de calibraciones (EQU-04). */
    public const POR_VENCER_DIAS = 30;

    private const ABIERTAS = ['OPEN', 'IN_PROGRESS'];

    /* ================================================================ ¿se puede usar? (para PRO, ALM y CAL) */

    /**
     * Motivo por el que el equipo no se usa a la fecha, o null si está apto.
     *
     * @return array{rule: string, msg: string}|null
     */
    public static function motivoNoApto(object $e, ?string $fecha = null): ?array
    {
        $fecha = self::fecha($fecha);
        if ($e->status === 'RETIRED') {
            return ['rule' => 'RN-EQU-04', 'msg' => "{$e->code} está dado de baja y no se usa."];
        }
        if ($e->status === 'OUT_OF_SERVICE') {
            $oc = self::correctivasAbiertas($e->id)->first();
            $por = $oc ? " por la orden correctiva {$oc->number} ({$oc->description})" : ($e->oos_reason === 'CALIBRATION' ? ' por una calibración no conforme' : '');

            return ['rule' => 'RN-EQU-04', 'msg' => "{$e->code} está fuera de servicio{$por}."];
        }
        if ($e->requires_calibration && ! self::calibracionVigente($e->id, $fecha)) {
            $u = self::ultimaCalibracion($e->id);
            $detalle = $u ? ' (la última venció el '.self::dmy($u->valid_until).($u->result === 'FAIL' ? ', resultado no conforme' : '').')' : ' (no tiene ninguna)';

            return ['rule' => 'RN-EQU-03', 'msg' => "{$e->code} exige calibración y no tiene una calibración conforme vigente al ".self::dmy($fecha)."{$detalle}. Registra la calibración en Calibraciones."];
        }

        return null;
    }

    /** RN-EQU-03 y RN-EQU-04: falla si el equipo no se puede usar a la fecha. Devuelve el equipo. */
    public static function exigirApto(string $equipmentId, ?string $fecha = null): object
    {
        $e = DB::table('equipment')->where('id', $equipmentId)->first() ?? RuleError::fail('RN-EQU-04', 'Equipo no encontrado.');
        if ($m = self::motivoNoApto($e, $fecha)) {
            RuleError::fail($m['rule'], $m['msg']);
        }

        return $e;
    }

    /** CA-EQU-01: la balanza de un lote producido o recibido, o de una venta por peso, debe estar apta. */
    public static function exigirBalanza(string $equipmentId, ?string $fecha = null): object
    {
        $e = DB::table('equipment')->where('id', $equipmentId)->first();
        if (! $e || $e->category !== 'SCALE') {
            RuleError::fail('RN-EQU-03', 'Elige una balanza registrada en Equipos.');
        }

        return self::exigirApto($equipmentId, $fecha);
    }

    public static function apto(string $equipmentId, ?string $fecha = null): bool
    {
        $e = DB::table('equipment')->where('id', $equipmentId)->first();

        return $e !== null && self::motivoNoApto($e, $fecha) === null;
    }

    /** La calibración PASS vigente a la fecha (la que vence más tarde), o null. */
    public static function calibracionVigente(string $equipmentId, ?string $fecha = null): ?object
    {
        $fecha = self::fecha($fecha);

        return DB::table('equipment_calibrations')->where('equipment_id', $equipmentId)->where('result', 'PASS')
            ->where('calibrated_on', '<=', $fecha)->where('valid_until', '>=', $fecha)
            ->orderByDesc('valid_until')->orderByDesc('created_at')->first();
    }

    public static function ultimaCalibracion(string $equipmentId): ?object
    {
        return DB::table('equipment_calibrations')->where('equipment_id', $equipmentId)
            ->orderByDesc('calibrated_on')->orderByDesc('created_at')->first();
    }

    /**
     * Estado de calibración para EQU-04: NOT_APPLICABLE, BLOCKED (sin PASS vigente), EXPIRING (vence en 30 días) o USABLE.
     *
     * @return array{state: string, days: ?int, calibration: ?object}
     */
    public static function estadoCalibracion(object $e, ?string $fecha = null): array
    {
        $fecha = self::fecha($fecha);
        if (! $e->requires_calibration) {
            return ['state' => 'NOT_APPLICABLE', 'days' => null, 'calibration' => null];
        }
        $v = self::calibracionVigente($e->id, $fecha);
        if (! $v) {
            $u = self::ultimaCalibracion($e->id);

            return ['state' => 'BLOCKED', 'days' => $u ? self::dias($fecha, $u->valid_until) : null, 'calibration' => $u];
        }
        $d = self::dias($fecha, $v->valid_until);

        return ['state' => $d <= self::POR_VENCER_DIAS ? 'EXPIRING' : 'USABLE', 'days' => $d, 'calibration' => $v];
    }

    public static function correctivasAbiertas(string $equipmentId, ?string $salvo = null): Collection
    {
        return DB::table('maintenance_orders')->where('equipment_id', $equipmentId)->where('kind', 'CORRECTIVE')
            ->whereIn('status', self::ABIERTAS)->when($salvo, fn ($q) => $q->where('id', '<>', $salvo))->orderBy('reported_at')->get();
    }

    /* ================================================================ equipos (EQU-01, EQU-02) */

    /**
     * Crea o edita un equipo. RN-EQU-01 (balanza calibrada), RN-EQU-11 (frío con punto de temperatura),
     * RN-EQU-05 y RN-EQU-10 (no se activa a mano con una correctiva abierta o tras una calibración FAIL).
     */
    public static function guardarEquipo(array $d, ?string $id, User $quien): object
    {
        Access::can($quien, 'equ.equipment.manage') || RuleError::fail('RN-EQU-01', 'Crear y editar equipos pide el permiso equ.equipment.manage (jefe de producción).');

        return self::base(fn () => DB::transaction(function () use ($d, $id, $quien) {
            $antes = $id ? (DB::table('equipment')->where('id', $id)->lockForUpdate()->first() ?? RuleError::fail('RN-EQU-01', 'Equipo no encontrado.')) : null;
            $codigo = strtoupper(trim((string) ($d['code'] ?? $antes?->code ?? '')));
            $nombre = trim((string) ($d['name'] ?? $antes?->name ?? ''));
            ($codigo !== '' && $nombre !== '') || RuleError::fail('RN-EQU-01', 'El equipo necesita código y nombre.');
            DB::table('equipment')->where('code', $codigo)->when($id, fn ($q) => $q->where('id', '<>', $id))->exists()
                && RuleError::fail('RN-EQU-01', "Ya existe un equipo con el código {$codigo}.");
            $cat = $d['category'] ?? $antes?->category;
            in_array($cat, self::CATEGORIAS, true) || RuleError::fail('RN-EQU-01', 'Elige la categoría del equipo.');
            $calibra = array_key_exists('requires_calibration', $d) ? (bool) $d['requires_calibration'] : (bool) ($antes?->requires_calibration ?? false);
            if ($cat === 'SCALE' && ! $calibra) {
                RuleError::fail('RN-EQU-01', 'Toda balanza exige calibración: marca «Exige calibración».');
            }
            $local = $d['establishment_id'] ?? $antes?->establishment_id;
            $loc = DB::table('establishments')->where('id', $local)->first() ?? RuleError::fail('RN-EQU-01', 'Elige el local del equipo.');
            self::localEnAlcance($quien, $loc->id);
            $almacen = array_key_exists('warehouse_id', $d) ? ($d['warehouse_id'] ?: null) : $antes?->warehouse_id;
            if ($almacen && ! DB::table('warehouses')->where('id', $almacen)->where('establishment_id', $loc->id)->exists()) {
                RuleError::fail('RN-EQU-01', 'El almacén asociado debe ser del mismo local.');
            }
            $centro = $d['cost_center_id'] ?? $antes?->cost_center_id ?? self::centroDelLocal($loc->id);
            $centro || RuleError::fail('RN-EQU-06', 'Elige el centro de costo al que se cargan sus mantenimientos.');
            DB::table('cost_centers')->where('id', $centro)->where('status', 'ACTIVE')->exists()
                || RuleError::fail('RN-EQU-06', 'El centro de costo no existe o está inactivo.');

            $estado = $d['status'] ?? $antes?->status ?? 'ACTIVE';
            in_array($estado, self::ESTADOS, true) || RuleError::fail('RN-EQU-04', 'Estado no válido.');
            $fila = [
                'code' => $codigo, 'name' => mb_substr($nombre, 0, 80), 'category' => $cat, 'establishment_id' => $loc->id, 'warehouse_id' => $almacen,
                'requires_calibration' => $calibra, 'cost_center_id' => $centro, 'status' => $estado,
            ];
            foreach (['brand_name' => 40, 'model' => 40, 'serial_number' => 40, 'capacity' => 40, 'manual_url' => 255, 'notes' => 2000] as $c => $max) {
                if (array_key_exists($c, $d)) {
                    $fila[$c] = self::texto($d[$c], $max);
                }
            }
            if (array_key_exists('purchase_date', $d)) {
                $fila['purchase_date'] = $d['purchase_date'] ?: null;
            }
            foreach (['purchase_cost' => 2, 'power_kw' => 2, 'hourly_rate' => 4] as $c => $dec) {
                if (array_key_exists($c, $d)) {
                    $v = self::num($d[$c], $dec);
                    if ($v !== null && $v < 0) {
                        RuleError::fail($c === 'hourly_rate' ? 'RN-EQU-09' : 'RN-EQU-01', 'Los montos no pueden ser negativos.');
                    }
                    $fila[$c] = $c === 'hourly_rate' ? ($v ?? 0) : $v;
                }
            }
            if (array_key_exists('useful_life_months', $d)) {
                $v = $d['useful_life_months'] === null || $d['useful_life_months'] === '' ? null : (int) $d['useful_life_months'];
                ($v === null || $v > 0) || RuleError::fail('RN-EQU-09', 'La vida útil va en meses, mayor que cero.');
                $fila['useful_life_months'] = $v;
            }
            if (array_key_exists('photos', $d)) {
                $fila['photos'] = json_encode(array_values(array_filter(array_map(fn ($p) => self::texto($p, 255), (array) $d['photos']))), JSON_UNESCAPED_UNICODE);
            }

            // Cambios de estado a mano.
            if ($antes && $estado !== $antes->status) {
                if ($estado === 'ACTIVE') {
                    ($oc = self::correctivasAbiertas($antes->id)->first())
                        && RuleError::fail('RN-EQU-05', "{$antes->code} tiene abierta la orden correctiva {$oc->number}: vuelve a activo al cerrarla.");
                    if ($antes->oos_reason === 'CALIBRATION') {
                        RuleError::fail('RN-EQU-10', "{$antes->code} quedó fuera de servicio por una calibración no conforme: vuelve a activo con una nueva calibración conforme.");
                    }
                    $fila += ['oos_reason' => null, 'oos_since' => null];
                } elseif ($estado === 'OUT_OF_SERVICE') {
                    $fila += ['oos_reason' => 'MANUAL', 'oos_since' => now()];
                } else {
                    self::correctivasAbiertas($antes->id)->isNotEmpty()
                        && RuleError::fail('RN-EQU-04', "Cierra o anula las órdenes abiertas de {$antes->code} antes de darlo de baja.");
                    $fila += ['oos_reason' => null, 'oos_since' => null];
                }
            } elseif (! $antes && $estado === 'OUT_OF_SERVICE') {
                $fila += ['oos_reason' => 'MANUAL', 'oos_since' => now()];
            }
            // RN-EQU-11: una cámara o congeladora activa necesita su punto de temperatura en CAL-04.
            if (in_array($cat, self::FRIO, true) && $estado === 'ACTIVE' && ! self::puntoDeTemperatura($antes?->id, $almacen)) {
                RuleError::fail('RN-EQU-11', 'Toda cámara y congeladora necesita su punto de temperatura en Calidad (CAL-04) antes de quedar activa. Créalo, o guarda el equipo como fuera de servicio.');
            }

            if ($antes) {
                DB::table('equipment')->where('id', $antes->id)->update($fila + ['updated_at' => now(), 'qr_code' => $antes->code === $codigo ? $antes->qr_code : 'EQ-'.$codigo]);
                $eid = $antes->id;
                if ($estado === 'OUT_OF_SERVICE' && $antes->status !== 'OUT_OF_SERVICE') {
                    Events::emit('equipment.out_of_service', 'equipment', $eid, ['code' => $codigo, 'reason' => 'MANUAL']);
                }
            } else {
                $eid = DB::table('equipment')->insertGetId($fila + ['qr_code' => 'EQ-'.$codigo, 'hour_meter' => 0, 'meter_readings' => '[]', 'photos' => $fila['photos'] ?? '[]'], 'id');
            }

            return self::equipo($eid);
        }));
    }

    /** RN-EQU-09: el jefe de producción fija la carga por hora (por ejemplo, aplicando la sugerida). */
    public static function fijarCarga(string $id, mixed $carga, User $quien): object
    {
        Access::can($quien, 'equ.equipment.manage') || RuleError::fail('RN-EQU-09', 'La carga por hora la fija el jefe de producción (equ.equipment.manage).');
        $v = self::num($carga, 4);
        ($v !== null && $v >= 0) || RuleError::fail('RN-EQU-09', 'La carga por hora no puede ser negativa.');
        $e = DB::table('equipment')->where('id', $id)->first() ?? RuleError::fail('RN-EQU-09', 'Equipo no encontrado.');
        self::localEnAlcance($quien, $e->establishment_id);
        DB::table('equipment')->where('id', $id)->update(['hourly_rate' => $v, 'updated_at' => now()]);

        return self::equipo($id);
    }

    /**
     * RN-EQU-09: (costo de compra / vida útil en meses + costo de mantenimiento promedio mensual) / horas de uso
     * promedio mensual, con los últimos 90 días. null si falta la compra, la vida útil o no hubo uso.
     *
     * @return array{rate: ?string, monthly_depreciation: ?string, monthly_maintenance: string, monthly_hours: string}
     */
    public static function cargaSugerida(object $e): array
    {
        $desde = CarbonImmutable::now('America/Lima')->subDays(90)->toDateString();
        $mant = (float) DB::table('maintenance_orders')->where('equipment_id', $e->id)->where('status', 'DONE')
            ->where('finished_at', '>=', $desde)->sum('total_cost') / 3;
        $horas = (float) DB::table('equipment_usage')->where('equipment_id', $e->id)->where('used_on', '>=', $desde)->sum('hours') / 3;
        $dep = $e->purchase_cost !== null && $e->useful_life_months ? (float) $e->purchase_cost / (int) $e->useful_life_months : null;

        return [
            'rate' => $dep !== null && $horas > 0 ? self::t(($dep + $mant) / $horas, 2) : null,
            'monthly_depreciation' => $dep !== null ? self::t($dep, 2) : null, 'monthly_maintenance' => self::t($mant, 2), 'monthly_hours' => self::t($horas, 1),
        ];
    }

    /* ================================================================ calibraciones (EQU-03, EQU-04) */

    /** RN-EQU-02, RN-EQU-10 y RN-EQU-12. Una calibración no se edita: un error se corrige registrando otra. */
    public static function registrarCalibracion(array $d, User $quien): object
    {
        Access::can($quien, 'equ.calibration.record') || RuleError::fail('RN-EQU-02', 'Registrar calibraciones pide el permiso equ.calibration.record (Calidad o jefe de producción).');

        return self::base(fn () => DB::transaction(function () use ($d, $quien) {
            $e = DB::table('equipment')->where('id', $d['equipment_id'] ?? null)->lockForUpdate()->first() ?? RuleError::fail('RN-EQU-02', 'Elige el equipo.');
            self::localEnAlcance($quien, $e->establishment_id);
            $e->status === 'RETIRED' && RuleError::fail('RN-EQU-04', "{$e->code} está dado de baja.");
            $cert = trim((string) ($d['certificate_number'] ?? ''));
            $cert !== '' || RuleError::fail('RN-EQU-02', 'La calibración exige el número de certificado.');
            $archivo = trim((string) ($d['certificate_url'] ?? ''));
            $archivo !== '' || RuleError::fail('RN-EQU-02', 'La calibración exige el archivo del certificado.');
            $fecha = $d['calibrated_on'] ?? null;
            $vence = $d['valid_until'] ?? null;
            ($fecha && $vence && $vence > $fecha) || RuleError::fail('RN-EQU-02', 'La vigencia debe ser posterior a la fecha de calibración.');
            $fecha <= self::fecha(null) || RuleError::fail('RN-EQU-02', 'La fecha de calibración no puede ser futura.');
            in_array($d['result'] ?? '', ['PASS', 'FAIL'], true) || RuleError::fail('RN-EQU-02', 'Indica el resultado: conforme o no conforme.');
            $prov = $d['provider_supplier_id'] ?? null;
            if ($prov && ! DB::table('suppliers')->where('id', $prov)->exists()) {
                RuleError::fail('RN-EQU-02', 'Proveedor no encontrado.');
            }
            $nombreProv = self::texto($d['provider_name'] ?? null, 255) ?? ($prov ? DB::table('suppliers')->where('id', $prov)->value('legal_name') : null);
            $nombreProv || RuleError::fail('RN-EQU-02', 'Indica el proveedor que calibró.');
            $costo = self::num($d['cost'] ?? 0, 2) ?? 0;
            $costo >= 0 || RuleError::fail('RN-EQU-02', 'El costo no puede ser negativo.');
            $error = self::num($d['max_error_g'] ?? null, 3);

            $cid = DB::table('equipment_calibrations')->insertGetId([
                'equipment_id' => $e->id, 'calibrated_on' => $fecha, 'valid_until' => $vence, 'provider_supplier_id' => $prov, 'provider_name' => $nombreProv,
                'certificate_number' => mb_substr($cert, 0, 40), 'certificate_url' => mb_substr($archivo, 0, 255), 'max_error_g' => $error,
                'result' => $d['result'], 'cost' => $costo, 'notes' => self::texto($d['notes'] ?? null, 2000),
                'recorded_by' => mb_substr($quien->name, 0, 40), 'recorded_by_user_id' => $quien->id,
            ], 'id');

            if ($d['result'] === 'FAIL') {
                // RN-EQU-10: queda fuera de servicio hasta una nueva calibración conforme.
                DB::table('equipment')->where('id', $e->id)->update(['status' => 'OUT_OF_SERVICE', 'oos_reason' => $e->status === 'OUT_OF_SERVICE' && $e->oos_reason === 'CORRECTIVE' ? 'CORRECTIVE' : 'CALIBRATION',
                    'oos_since' => $e->status === 'OUT_OF_SERVICE' ? $e->oos_since : now(), 'updated_at' => now()]);
                self::avisar(['role' => 'JEFE_PRODUCCION'], "{$e->code} fuera de servicio: calibración no conforme", "Certificado {$cert}. No se usa hasta una nueva calibración conforme (RN-EQU-10).", 'EQU-02', $e->id, 'bad');
                Events::emit('equipment.out_of_service', 'equipment', $e->id, ['code' => $e->code, 'reason' => 'CALIBRATION', 'certificate' => $cert]);
            } elseif ($e->status === 'OUT_OF_SERVICE' && $e->oos_reason === 'CALIBRATION' && self::correctivasAbiertas($e->id)->isEmpty()) {
                DB::table('equipment')->where('id', $e->id)->update(['status' => 'ACTIVE', 'oos_reason' => null, 'oos_since' => null, 'updated_at' => now()]);
                Events::emit('equipment.back_in_service', 'equipment', $e->id, ['code' => $e->code, 'reason' => 'CALIBRATION']);
            }
            Events::emit('equipment.calibrated', 'equipment_calibrations', $cid, ['equipment_id' => $e->id, 'code' => $e->code, 'result' => $d['result'], 'valid_until' => $vence]);

            return DB::table('equipment_calibrations')->where('id', $cid)->first();
        }));
    }

    /** Vigencia sugerida al registrar una calibración (equ_scale_calibration_months, D-EQU-01). */
    public static function vigenciaSugerida(string $desde): string
    {
        return CarbonImmutable::parse($desde, 'America/Lima')->addMonthsNoOverflow((int) Params::get('equ_scale_calibration_months') ?: 6)->toDateString();
    }

    /* ================================================================ órdenes de mantenimiento (EQU-06, EQU-07) */

    /**
     * Abre una orden. Preventiva: desde un plan, con equ.maintenance.manage. Correctiva: desde una falla
     * (también equ.failure.report). RN-EQU-05: una correctiva deja el equipo fuera de servicio.
     */
    public static function abrirOrden(array $d, User $quien): object
    {
        $tipo = $d['kind'] ?? 'CORRECTIVE';
        in_array($tipo, ['PREVENTIVE', 'CORRECTIVE'], true) || RuleError::fail('RN-EQU-06', 'Tipo de orden no válido.');
        if ($tipo === 'PREVENTIVE' || ! Access::can($quien, 'equ.failure.report')) {
            Access::can($quien, 'equ.maintenance.manage') || RuleError::fail('RN-EQU-06', $tipo === 'PREVENTIVE'
                ? 'Abrir órdenes preventivas pide el permiso equ.maintenance.manage (jefe de producción).'
                : 'Reportar fallas pide el permiso equ.failure.report.');
        }

        return self::base(fn () => DB::transaction(function () use ($d, $tipo, $quien) {
            $e = DB::table('equipment')->where('id', $d['equipment_id'] ?? null)->lockForUpdate()->first() ?? RuleError::fail('RN-EQU-05', 'Escanea o elige el equipo.');
            self::localEnAlcance($quien, $e->establishment_id);

            return self::insertarOrden($e, $tipo, $d, $quien);
        }));
    }

    /**
     * EQU-07 Reporte de falla desde el celular: por QR o código. Si el equipo ya tiene una correctiva abierta,
     * el reporte se suma a esa orden (no se abren dos por la misma falla).
     *
     * @return array{order: object, created: bool}
     */
    public static function reportarFalla(array $d, User $quien): array
    {
        (Access::can($quien, 'equ.failure.report') || Access::can($quien, 'equ.maintenance.manage'))
            || RuleError::fail('RN-EQU-05', 'Reportar fallas pide el permiso equ.failure.report.');
        $desc = trim((string) ($d['description'] ?? ''));
        $desc !== '' || RuleError::fail('RN-EQU-05', 'Describe la falla.');

        return self::base(fn () => DB::transaction(function () use ($d, $desc, $quien) {
            $e = ! empty($d['equipment_id']) ? DB::table('equipment')->where('id', $d['equipment_id'])->first() : self::porCodigo((string) ($d['code'] ?? ''));
            $e || RuleError::fail('RN-EQU-05', 'Escanea el QR o elige el equipo.');
            $e = DB::table('equipment')->where('id', $e->id)->lockForUpdate()->first();
            self::localEnAlcance($quien, $e->establishment_id);
            $e->status === 'RETIRED' && RuleError::fail('RN-EQU-04', "{$e->code} está dado de baja.");
            if ($prev = self::correctivasAbiertas($e->id)->first()) {
                $hora = now('America/Lima')->format('d/m H:i');
                DB::table('maintenance_orders')->where('id', $prev->id)->update([
                    'description' => $prev->description." · Nuevo reporte ({$hora}, {$quien->name}): {$desc}",
                    'urgency' => ($d['urgency'] ?? '') === 'HIGH' ? 'HIGH' : $prev->urgency,
                    'photo_url' => $prev->photo_url ?? self::texto($d['photo_url'] ?? null, 255), 'updated_at' => now(),
                ]);

                return ['order' => self::orden($prev->id), 'created' => false];
            }

            return ['order' => self::insertarOrden($e, 'CORRECTIVE', $d + ['description' => $desc], $quien), 'created' => true];
        }));
    }

    public static function iniciarOrden(string $id, User $quien): object
    {
        self::gestor($quien);

        return DB::transaction(function () use ($id, $quien) {
            $m = self::bloquearOrden($id, $quien);
            $m->status === 'OPEN' || RuleError::fail('RN-EQU-06', "La orden {$m->number} no está abierta.");
            DB::table('maintenance_orders')->where('id', $id)->update(['status' => 'IN_PROGRESS', 'started_at' => now(), 'updated_at' => now()]);

            return self::orden($id);
        });
    }

    /**
     * Cierra y costea la orden. RN-EQU-06: total = mano de obra + repuestos (Σ cantidad × costo) + servicio externo,
     * al centro de costo del equipo. RN-EQU-05: la correctiva devuelve el equipo a ACTIVE si no queda otra abierta.
     * Si viene de un plan, el plan corre su próxima fecha u horas.
     */
    public static function terminarOrden(string $id, array $d, User $quien): object
    {
        self::gestor($quien);

        return self::base(fn () => DB::transaction(function () use ($id, $d, $quien) {
            $m = self::bloquearOrden($id, $quien);
            in_array($m->status, self::ABIERTAS, true) || RuleError::fail('RN-EQU-06', "La orden {$m->number} ya está ".($m->status === 'DONE' ? 'terminada' : 'anulada').'.');
            $e = DB::table('equipment')->where('id', $m->equipment_id)->lockForUpdate()->first();

            $mano = self::num($d['labor_cost'] ?? $m->labor_cost, 2) ?? 0;
            $externo = self::num($d['external_cost'] ?? $m->external_cost, 2) ?? 0;
            $horas = self::num($d['labor_hours'] ?? $m->labor_hours, 2) ?? 0;
            $repuestos = self::repuestos($d['parts'] ?? json_decode($m->parts ?? '[]', true) ?: []);
            $costoRep = round(array_sum(array_map(fn ($p) => $p['qty'] * $p['unit_cost'], $repuestos)), 2);
            if ($mano < 0 || $externo < 0 || $horas < 0) {
                RuleError::fail('RN-EQU-06', 'Los costos y las horas no pueden ser negativos.');
            }
            $prov = ($d['external_supplier_id'] ?? null) ?: $m->external_supplier_id;
            if ($externo > 0 && ! $prov) {
                RuleError::fail('RN-EQU-06', 'El servicio externo necesita el proveedor (su compra va por COM o su gasto por GAS).');
            }
            if ($prov && ! DB::table('suppliers')->where('id', $prov)->exists()) {
                RuleError::fail('RN-EQU-06', 'Proveedor no encontrado.');
            }
            $fin = isset($d['finished_at']) && $d['finished_at'] ? CarbonImmutable::parse($d['finished_at'], 'America/Lima') : CarbonImmutable::now('America/Lima');
            $fin->greaterThan(CarbonImmutable::now('America/Lima')->addMinutes(5)) && RuleError::fail('RN-EQU-06', 'La hora de término no puede ser futura.');
            $reportada = CarbonImmutable::parse($m->reported_at)->setTimezone('America/Lima');
            $fin->lessThan($reportada) && RuleError::fail('RN-EQU-06', 'La orden no puede terminar antes de reportarse.');
            $inicio = $m->started_at ? CarbonImmutable::parse($m->started_at) : $reportada;
            // Tiempo fuera de servicio: la correctiva desde el reporte; la preventiva, lo que duró el trabajo.
            $parada = isset($d['downtime_hours']) && $d['downtime_hours'] !== '' && $d['downtime_hours'] !== null
                ? self::num($d['downtime_hours'], 2)
                : round(max(0, ($m->kind === 'CORRECTIVE' ? $reportada : $inicio)->diffInMinutes($fin, false)) / 60, 1);
            ($parada !== null && $parada >= 0) || RuleError::fail('RN-EQU-06', 'El tiempo fuera de servicio no puede ser negativo.');
            $companyId = DB::table('establishments')->where('id', $e->establishment_id)->value('company_id');
            Periodos::abierto($fin, $companyId);

            DB::table('maintenance_orders')->where('id', $id)->update([
                'status' => 'DONE', 'started_at' => $m->started_at ?? $reportada, 'finished_at' => $fin, 'finished_by' => $quien->id,
                'diagnosis' => self::texto($d['diagnosis'] ?? $m->diagnosis, 2000), 'labor_hours' => $horas, 'labor_cost' => $mano,
                'parts' => json_encode($repuestos, JSON_UNESCAPED_UNICODE), 'parts_cost' => $costoRep, 'external_cost' => $externo,
                'external_supplier_id' => $prov, 'total_cost' => round($mano + $costoRep + $externo, 2), 'downtime_hours' => $parada,
                'cost_center_id' => $e->cost_center_id, 'updated_at' => now(),
            ]);
            self::volverAServicio($e, $m);
            if ($m->plan_id) {
                $p = DB::table('maintenance_plans')->where('id', $m->plan_id)->first();
                if ($p) {
                    DB::table('maintenance_plans')->where('id', $p->id)->update([
                        'last_done_on' => $fin->toDateString(),
                        'next_due_on' => $p->frequency_days ? $fin->addDays((int) $p->frequency_days)->toDateString() : $p->next_due_on,
                        'next_due_hours' => $p->frequency_hours ? round((float) $e->hour_meter + (int) $p->frequency_hours, 1) : $p->next_due_hours,
                        'updated_at' => now(),
                    ]);
                }
            }
            $o = self::orden($id);
            Events::emit('maintenance_order.closed', 'maintenance_orders', $id, [
                'number' => $o->number, 'equipment_id' => $e->id, 'kind' => $o->kind, 'total_cost' => $o->total_cost, 'cost_center_id' => $o->cost_center_id,
                'external_supplier_id' => $prov, 'external_cost' => $o->external_cost, 'downtime_hours' => $o->downtime_hours,
            ]);

            return $o;
        }));
    }

    /** Anula una orden abierta con motivo. Una correctiva anulada también devuelve el equipo a servicio (RN-EQU-05). */
    public static function anularOrden(string $id, string $motivo, User $quien): object
    {
        self::gestor($quien);
        mb_strlen(trim($motivo)) >= 5 || RuleError::fail('RN-EQU-06', 'Escribe el motivo de la anulación.');

        return DB::transaction(function () use ($id, $motivo, $quien) {
            $m = self::bloquearOrden($id, $quien);
            in_array($m->status, self::ABIERTAS, true) || RuleError::fail('RN-EQU-06', "La orden {$m->number} ya está cerrada.");
            DB::table('maintenance_orders')->where('id', $id)->update(['status' => 'VOIDED', 'void_reason' => mb_substr(trim($motivo), 0, 255),
                'voided_at' => now(), 'voided_by' => $quien->id, 'updated_at' => now()]);
            self::volverAServicio(DB::table('equipment')->where('id', $m->equipment_id)->lockForUpdate()->first(), $m);

            return self::orden($id);
        });
    }

    /* ================================================================ planes preventivos (EQU-05) */

    public static function guardarPlan(array $d, ?string $id, User $quien): object
    {
        self::gestor($quien);

        return self::base(fn () => DB::transaction(function () use ($d, $id, $quien) {
            $antes = $id ? (DB::table('maintenance_plans')->where('id', $id)->first() ?? RuleError::fail('RN-EQU-07', 'Plan no encontrado.')) : null;
            $e = DB::table('equipment')->where('id', $d['equipment_id'] ?? $antes?->equipment_id)->first() ?? RuleError::fail('RN-EQU-07', 'Elige el equipo.');
            self::localEnAlcance($quien, $e->establishment_id);
            $act = trim((string) ($d['activity'] ?? $antes?->activity ?? ''));
            $act !== '' || RuleError::fail('RN-EQU-07', 'Describe la actividad del plan.');
            $dias = array_key_exists('frequency_days', $d) ? (($d['frequency_days'] ?? '') === '' ? null : (int) $d['frequency_days']) : $antes?->frequency_days;
            $horas = array_key_exists('frequency_hours', $d) ? (($d['frequency_hours'] ?? '') === '' ? null : (int) $d['frequency_hours']) : $antes?->frequency_hours;
            (($dias && $dias > 0) || ($horas && $horas > 0)) || RuleError::fail('RN-EQU-07', 'Indica la frecuencia en días o en horas de uso.');
            $resp = $d['responsible_employee_id'] ?? $antes?->responsible_employee_id;
            $nombre = null;
            if ($resp) {
                $nombre = DB::table('employees')->where('id', $resp)->value('full_name') ?? RuleError::fail('RN-EQU-07', 'Responsable no encontrado.');
            }
            $estado = $d['status'] ?? $antes?->status ?? 'ACTIVE';
            in_array($estado, ['ACTIVE', 'INACTIVE'], true) || RuleError::fail('RN-EQU-07', 'Estado no válido.');
            $hoy = self::fecha(null);
            $proxFecha = array_key_exists('next_due_on', $d) ? ($d['next_due_on'] ?: null) : $antes?->next_due_on;
            $proxHoras = array_key_exists('next_due_hours', $d) ? self::num($d['next_due_hours'], 1) : $antes?->next_due_hours;
            // Sin próxima fecha u horas, se calcula desde hoy o desde el horómetro.
            $proxFecha ??= $dias ? CarbonImmutable::parse($hoy)->addDays($dias)->toDateString() : null;
            $proxHoras ??= $horas ? round((float) $e->hour_meter + $horas, 1) : null;
            $fila = [
                'equipment_id' => $e->id, 'activity' => mb_substr($act, 0, 255), 'frequency_days' => $dias, 'frequency_hours' => $horas,
                'next_due_on' => $dias ? $proxFecha : null, 'next_due_hours' => $horas ? $proxHoras : null,
                'responsible_employee_id' => $resp ?: null, 'responsible_name' => $nombre ? mb_substr($nombre, 0, 40) : self::texto($d['responsible_name'] ?? $antes?->responsible_name, 40),
                'expected_parts' => array_key_exists('expected_parts', $d) ? self::texto($d['expected_parts'], 255) : $antes?->expected_parts, 'status' => $estado,
            ];
            if ($antes) {
                DB::table('maintenance_plans')->where('id', $antes->id)->update($fila + ['updated_at' => now()]);
                $pid = $antes->id;
            } else {
                $pid = DB::table('maintenance_plans')->insertGetId($fila, 'id');
            }

            return self::plan($pid);
        }));
    }

    /** Estado del plan a la fecha: OK, DUE (toca por fecha u horas) u OVERDUE (más de equ_preventive_overdue_days de atraso). */
    public static function estadoPlan(object $p, ?string $fecha = null, ?float $horometro = null): string
    {
        $fecha = self::fecha($fecha);
        $horometro ??= (float) DB::table('equipment')->where('id', $p->equipment_id)->value('hour_meter');
        $atraso = $p->next_due_on ? self::dias($p->next_due_on, $fecha) : null;
        $porHoras = $p->next_due_hours !== null && $p->frequency_hours && $horometro >= (float) $p->next_due_hours;
        if ($atraso !== null && $atraso > (int) Params::get('equ_preventive_overdue_days')) {
            return 'OVERDUE';
        }

        return ($atraso !== null && $atraso >= 0) || $porHoras ? 'DUE' : 'OK';
    }

    /**
     * RN-EQU-07: crea las órdenes preventivas de los planes activos que tocan (una por plan: si ya hay una
     * abierta no se duplica) y avisa al jefe de producción de los vencidos. La corre equ:diario cada mañana.
     *
     * @return array{created: array<int, string>, overdue: array<int, string>}
     */
    public static function generarPreventivas(?string $fecha = null, ?User $quien = null): array
    {
        if ($quien) {
            self::gestor($quien);
        }
        $fecha = self::fecha($fecha);

        return self::base(fn () => DB::transaction(function () use ($fecha, $quien) {
            $creadas = [];
            $vencidos = [];
            $locales = $quien ? Access::for($quien)['establishments'] : [];
            $planes = DB::table('maintenance_plans as p')->join('equipment as e', 'e.id', '=', 'p.equipment_id')
                ->where('p.status', 'ACTIVE')->whereIn('e.status', ['ACTIVE', 'OUT_OF_SERVICE'])
                ->when($locales, fn ($q) => $q->whereIn('e.establishment_id', $locales))->orderBy('e.code')->get(['p.*', 'e.code', 'e.hour_meter', 'e.establishment_id']);
            $autor = $quien ?? self::autorSistema();
            foreach ($planes as $p) {
                $estado = self::estadoPlan($p, $fecha, (float) $p->hour_meter);
                if ($estado === 'OK') {
                    continue;
                }
                if ($estado === 'OVERDUE') {
                    $vencidos[] = "{$p->code}: {$p->activity}";
                }
                if (DB::table('maintenance_orders')->where('plan_id', $p->id)->whereIn('status', self::ABIERTAS)->exists()) {
                    continue;
                }
                $e = DB::table('equipment')->where('id', $p->equipment_id)->lockForUpdate()->first();
                $o = self::insertarOrden($e, 'PREVENTIVE', ['plan_id' => $p->id, 'description' => $p->activity, 'due_on' => $p->next_due_on], $autor);
                $creadas[] = $o->number;
            }
            if ($vencidos) {
                $clave = 'overdue:'.$fecha;
                if (! self::yaAvisado($clave)) {
                    $dias = (int) Params::get('equ_preventive_overdue_days');
                    self::avisar(['role' => 'JEFE_PRODUCCION'], count($vencidos).' preventivo(s) con más de '.$dias.' días de atraso', implode(' · ', $vencidos).' (RN-EQU-07)', 'EQU-05', null, 'warn', $clave);
                }
            }
            if ($creadas) {
                Events::emit('maintenance_order.preventive_created', 'maintenance_orders', null, ['numbers' => $creadas, 'date' => $fecha]);
            }

            return ['created' => $creadas, 'overdue' => $vencidos];
        }));
    }

    /**
     * RN-EQU-08: avisa a Calidad y al jefe de producción las calibraciones que vencen en equ_calibration_alert_days
     * días o menos (una vez por calibración) y las balanzas ya vencidas (una vez por día).
     *
     * @return array{expiring: int, blocked: int}
     */
    public static function avisarCalibraciones(?string $fecha = null): array
    {
        $fecha = self::fecha($fecha);
        $dias = (int) Params::get('equ_calibration_alert_days');
        $porVencer = 0;
        $vencidas = [];
        foreach (DB::table('equipment')->where('requires_calibration', true)->where('status', '<>', 'RETIRED')->orderBy('code')->get() as $e) {
            $v = self::calibracionVigente($e->id, $fecha);
            if ($v && self::dias($fecha, $v->valid_until) <= $dias) {
                $clave = 'cal:'.$v->id;
                if (! self::yaAvisado($clave)) {
                    $d = self::dias($fecha, $v->valid_until);
                    foreach (['CALIDAD', 'JEFE_PRODUCCION'] as $rol) {
                        self::avisar(['role' => $rol], "Calibración de {$e->code} vence ".($d === 0 ? 'hoy' : "en {$d} día(s)"),
                            "{$e->name}: certificado {$v->certificate_number} vigente hasta el ".self::dmy($v->valid_until).'. Programa la calibración (RN-EQU-08).', 'EQU-04', $e->id, 'warn', $clave);
                    }
                    $porVencer++;
                }
            } elseif (! $v && $e->status === 'ACTIVE') {
                $vencidas[] = $e->code;
            }
        }
        if ($vencidas && ! self::yaAvisado('blocked:'.$fecha)) {
            self::avisar(['role' => 'CALIDAD'], count($vencidas).' equipo(s) con calibración vencida', implode(', ', $vencidas).': no se usan hasta calibrarlos (RN-EQU-03).', 'EQU-04', null, 'bad', 'blocked:'.$fecha);
        }

        return ['expiring' => $porVencer, 'blocked' => count($vencidas)];
    }

    /* ================================================================ uso (EQU-08) */

    /**
     * Horas de uso en una orden de producción (PRO-09). RN-EQU-03 y RN-EQU-04: solo un equipo apto a la fecha.
     * El costo = horas × carga por hora del momento, y el horómetro suma las horas.
     *
     * @param  array{equipment_id: string, hours: mixed, used_on?: ?string, order_ref?: ?string, production_order_id?: ?string, source?: string}  $d
     */
    public static function registrarUso(array $d, User $quien): object
    {
        return self::base(fn () => DB::transaction(function () use ($d, $quien) {
            $e = DB::table('equipment')->where('id', $d['equipment_id'] ?? null)->lockForUpdate()->first() ?? RuleError::fail('RN-EQU-04', 'Elige el equipo.');
            self::localEnAlcance($quien, $e->establishment_id);
            $fecha = self::fecha($d['used_on'] ?? null);
            $fecha <= self::fecha(null) || RuleError::fail('RN-EQU-04', 'La fecha de uso no puede ser futura.');
            self::exigirApto($e->id, $fecha);
            in_array($e->category, self::SIN_HORAS, true) && RuleError::fail('RN-EQU-04', "{$e->code} no se registra por horas de uso.");
            $horas = self::num($d['hours'] ?? null, 2);
            ($horas !== null && $horas > 0) || RuleError::fail('RN-EQU-04', 'Las horas deben ser mayores que cero.');
            $horas <= 24 || RuleError::fail('RN-EQU-04', 'Un registro no pasa de 24 horas.');
            $ref = self::texto($d['order_ref'] ?? null, 40);
            $po = $d['production_order_id'] ?? null;
            ($ref || $po) || RuleError::fail('RN-EQU-04', 'Indica la orden de producción.');
            $id = DB::table('equipment_usage')->insertGetId([
                'equipment_id' => $e->id, 'production_order_id' => $po, 'order_ref' => $ref ? strtoupper($ref) : null, 'used_on' => $fecha, 'hours' => $horas,
                'hourly_rate' => $e->hourly_rate, 'cost' => round($horas * (float) $e->hourly_rate, 2), 'source' => ($d['source'] ?? 'EQU') === 'PRO' ? 'PRO' : 'EQU',
                'recorded_by' => $quien->id,
            ], 'id');
            DB::table('equipment')->where('id', $e->id)->update(['hour_meter' => round((float) $e->hour_meter + $horas, 1), 'updated_at' => now()]);

            return DB::table('equipment_usage')->where('id', $id)->first();
        }));
    }

    /** Lectura del horómetro: no puede bajar. Devuelve el equipo y los planes por horas que ya tocan (RN-EQU-07). */
    public static function lecturaHorometro(string $id, mixed $horas, User $quien): array
    {
        return DB::transaction(function () use ($id, $horas, $quien) {
            $e = DB::table('equipment')->where('id', $id)->lockForUpdate()->first() ?? RuleError::fail('RN-EQU-07', 'Elige el equipo.');
            self::localEnAlcance($quien, $e->establishment_id);
            $v = self::num($horas, 1);
            ($v !== null && $v >= 0) || RuleError::fail('RN-EQU-07', 'Indica la lectura del horómetro.');
            $v + 0.05 >= (float) $e->hour_meter || RuleError::fail('RN-EQU-07', 'La lectura ('.self::n($v, 1).' h) es menor que la acumulada ('.self::n((float) $e->hour_meter, 1).' h).');
            $lecturas = json_decode($e->meter_readings ?? '[]', true) ?: [];
            $lecturas[] = ['at' => now('America/Lima')->format('Y-m-d\TH:i'), 'hours' => $v, 'by' => $quien->name];
            DB::table('equipment')->where('id', $id)->update(['hour_meter' => $v, 'meter_readings' => json_encode($lecturas, JSON_UNESCAPED_UNICODE), 'updated_at' => now()]);
            $tocan = DB::table('maintenance_plans')->where('equipment_id', $id)->where('status', 'ACTIVE')->whereNotNull('frequency_hours')
                ->where('next_due_hours', '<=', $v)->pluck('activity')->all();

            return ['equipment' => self::equipo($id), 'due_plans' => $tocan];
        });
    }

    /* ================================================================ indicadores (EQU-09) */

    /**
     * KPI-EQU-01 a 04 del período [desde, hasta], para los equipos de los locales dados (vacío = todos).
     *
     * @param  array<int, string>  $locales
     */
    public static function kpis(string $desde, string $hasta, array $locales = []): array
    {
        $equipos = DB::table('equipment')->where('status', '<>', 'RETIRED')->when($locales, fn ($q) => $q->whereIn('establishment_id', $locales))->get();
        $ids = $equipos->pluck('id')->all();
        $disp = self::disponibilidad($ids, $desde, $hasta);

        $balanzas = $equipos->where('category', 'SCALE')->where('status', 'ACTIVE');
        $ok = $balanzas->filter(fn ($b) => self::calibracionVigente($b->id, $hasta) !== null)->count();

        $costo = (float) DB::table('maintenance_orders')->whereIn('equipment_id', $ids)->where('status', 'DONE')
            ->whereRaw("(finished_at AT TIME ZONE 'America/Lima')::date BETWEEN ? AND ?", [$desde, $hasta])->sum('total_cost');

        // KPI-EQU-04: preventivas que vencían en el mes, cerradas dentro del margen de atraso.
        $margen = (int) Params::get('equ_preventive_overdue_days');
        $prev = DB::table('maintenance_orders')->whereIn('equipment_id', $ids)->where('kind', 'PREVENTIVE')->where('status', '<>', 'VOIDED')
            ->whereRaw("coalesce(due_on, (reported_at AT TIME ZONE 'America/Lima')::date) BETWEEN ? AND ?", [$desde, $hasta])->get();
        $aTiempo = $prev->filter(fn ($m) => $m->status === 'DONE' && CarbonImmutable::parse($m->finished_at)->setTimezone('America/Lima')->toDateString()
            <= CarbonImmutable::parse($m->due_on ?? CarbonImmutable::parse($m->reported_at)->setTimezone('America/Lima')->toDateString())->addDays($margen)->toDateString())->count();

        return [
            'period' => ['from' => $desde, 'to' => $hasta],
            'availability' => ['value' => $disp['pct'], 'down_hours' => $disp['down'], 'total_hours' => $disp['total'], 'equipment' => count($ids)],
            'scales' => ['value' => $balanzas->count() ? self::t($ok / $balanzas->count() * 100, 1) : null, 'ok' => $ok, 'total' => $balanzas->count()],
            'maintenance_cost' => self::t($costo, 2),
            'preventive' => ['value' => $prev->count() ? self::t($aTiempo / $prev->count() * 100, 1) : null, 'on_time' => $aTiempo, 'total' => $prev->count()],
        ];
    }

    /**
     * KPI-EQU-01: (horas del período × equipos − horas fuera de servicio) / (horas del período × equipos) × 100.
     * Fuera de servicio: las correctivas (abiertas hasta ahora; cerradas, su tiempo fuera de servicio dentro del
     * período) y las paradas de las preventivas cerradas en el período.
     *
     * @param  array<int, string>  $ids
     * @return array{pct: ?string, down: string, total: string}
     */
    public static function disponibilidad(array $ids, string $desde, string $hasta): array
    {
        $ini = CarbonImmutable::parse($desde, 'America/Lima')->startOfDay();
        $ahora = CarbonImmutable::now('America/Lima');
        $fin = CarbonImmutable::parse($hasta, 'America/Lima')->endOfDay();
        $fin = $fin->greaterThan($ahora) ? $ahora : $fin;
        $span = max(1, $ini->diffInMinutes($fin) / 60);
        $parada = 0.0;
        if ($ids) {
            foreach (DB::table('maintenance_orders')->whereIn('equipment_id', $ids)->where('status', '<>', 'VOIDED')
                ->where('reported_at', '<=', $fin)->where(fn ($q) => $q->whereNull('finished_at')->orWhere('finished_at', '>=', $ini))->get() as $m) {
                $rep = CarbonImmutable::parse($m->reported_at);
                $ter = $m->finished_at ? CarbonImmutable::parse($m->finished_at) : null;
                if ($m->kind === 'CORRECTIVE') {
                    if ($m->status === 'DONE' && $m->downtime_hours !== null && $rep->greaterThanOrEqualTo($ini) && $ter && $ter->lessThanOrEqualTo($fin)) {
                        $parada += (float) $m->downtime_hours;
                    } else {
                        $a = $rep->greaterThan($ini) ? $rep : $ini;
                        $b = $ter && $ter->lessThan($fin) ? $ter : $fin;
                        $parada += max(0, $a->diffInMinutes($b, false) / 60);
                    }
                } elseif ($m->status === 'DONE' && $m->downtime_hours && $ter && $ter->betweenIncluded($ini, $fin)) {
                    $parada += (float) $m->downtime_hours;
                }
            }
        }
        $total = $span * count($ids);

        return ['pct' => $total ? self::t(($total - $parada) / $total * 100, 2) : null, 'down' => self::t($parada, 1), 'total' => self::t($total, 1)];
    }

    /* ================================================================ lecturas */

    public static function equipo(string $id): object
    {
        return DB::table('equipment as e')->join('establishments as s', 's.id', '=', 'e.establishment_id')
            ->leftJoin('warehouses as w', 'w.id', '=', 'e.warehouse_id')->leftJoin('cost_centers as c', 'c.id', '=', 'e.cost_center_id')
            ->where('e.id', $id)->first(['e.*', 's.name as establishment_name', 's.short as establishment_short', 'w.code as warehouse_code', 'w.name as warehouse_name',
                'c.code as cost_center_code', 'c.name as cost_center_name']) ?? RuleError::fail('RN-EQU-04', 'Equipo no encontrado.');
    }

    public static function orden(string $id): object
    {
        $o = DB::table('maintenance_orders as m')->join('equipment as e', 'e.id', '=', 'm.equipment_id')
            ->leftJoin('users as u', 'u.id', '=', 'm.reported_by')->leftJoin('users as f', 'f.id', '=', 'm.finished_by')
            ->leftJoin('maintenance_plans as p', 'p.id', '=', 'm.plan_id')->leftJoin('suppliers as s', 's.id', '=', 'm.external_supplier_id')
            ->leftJoin('cost_centers as c', 'c.id', '=', 'm.cost_center_id')
            ->where('m.id', $id)->first(['m.*', 'e.code as equipment_code', 'e.name as equipment_name', 'e.establishment_id', 'e.status as equipment_status',
                'u.name as reported_by_name', 'f.name as finished_by_name', 'p.activity as plan_activity', 's.legal_name as supplier_name',
                'c.code as cost_center_code', 'c.name as cost_center_name']) ?? RuleError::fail('RN-EQU-06', 'Orden no encontrada.');
        $o->parts = json_decode($o->parts ?? '[]', true) ?: [];

        return $o;
    }

    public static function plan(string $id): object
    {
        return DB::table('maintenance_plans as p')->join('equipment as e', 'e.id', '=', 'p.equipment_id')->where('p.id', $id)
            ->first(['p.*', 'e.code as equipment_code', 'e.name as equipment_name', 'e.hour_meter']) ?? RuleError::fail('RN-EQU-07', 'Plan no encontrado.');
    }

    /** Busca por código, por QR («EQ-SEL-L1-01») o por el texto del QR con prefijo. */
    public static function porCodigo(string $codigo): ?object
    {
        $c = strtoupper(trim($codigo));
        if ($c === '') {
            return null;
        }

        return DB::table('equipment')->where(fn ($q) => $q->whereRaw('upper(code) = ?', [$c])->orWhereRaw('upper(qr_code) = ?', [$c])
            ->orWhereRaw("'EQ-' || upper(code) = ?", [$c]))->first();
    }

    /* ================================================================ apoyo */

    private static function insertarOrden(object $e, string $tipo, array $d, User $quien): object
    {
        $e->status === 'RETIRED' && RuleError::fail('RN-EQU-04', "{$e->code} está dado de baja.");
        $desc = trim((string) ($d['description'] ?? ''));
        $desc !== '' || RuleError::fail('RN-EQU-05', $tipo === 'CORRECTIVE' ? 'Describe la falla.' : 'Describe la actividad.');
        $plan = $d['plan_id'] ?? null;
        if ($tipo === 'PREVENTIVE') {
            $plan || RuleError::fail('RN-EQU-07', 'La orden preventiva sale de un plan: elígelo.');
            DB::table('maintenance_plans')->where('id', $plan)->where('equipment_id', $e->id)->exists() || RuleError::fail('RN-EQU-07', 'El plan no es de ese equipo.');
        }
        $urg = in_array($d['urgency'] ?? '', self::URGENCIAS, true) ? $d['urgency'] : 'NORMAL';
        $id = DB::table('maintenance_orders')->insertGetId([
            'number' => self::numero(), 'equipment_id' => $e->id, 'kind' => $tipo, 'plan_id' => $tipo === 'PREVENTIVE' ? $plan : null,
            'reported_at' => now(), 'reported_by' => $quien->id, 'description' => mb_substr($desc, 0, 2000), 'photo_url' => self::texto($d['photo_url'] ?? null, 255),
            'urgency' => $urg, 'parts' => '[]', 'cost_center_id' => $e->cost_center_id, 'status' => 'OPEN', 'due_on' => $d['due_on'] ?? null,
        ], 'id');
        if ($tipo === 'CORRECTIVE') {
            // RN-EQU-05: una correctiva abierta deja el equipo fuera de servicio.
            if ($e->status !== 'OUT_OF_SERVICE') {
                DB::table('equipment')->where('id', $e->id)->update(['status' => 'OUT_OF_SERVICE', 'oos_reason' => 'CORRECTIVE', 'oos_since' => now(), 'updated_at' => now()]);
            }
            $o = self::orden($id);
            self::avisar(['role' => 'JEFE_PRODUCCION'], "{$e->code} fuera de servicio", "{$o->number}: {$desc}", 'EQU-06', $id, $urg === 'HIGH' ? 'bad' : 'warn');
            Events::emit('equipment.out_of_service', 'equipment', $e->id, ['code' => $e->code, 'reason' => 'CORRECTIVE', 'order' => $o->number]);
        }
        Events::emit('maintenance_order.opened', 'maintenance_orders', $id, ['equipment_id' => $e->id, 'kind' => $tipo]);

        return self::orden($id);
    }

    /** RN-EQU-05: sin otra correctiva abierta, el equipo vuelve a ACTIVE (salvo que esté fuera por calibración o de baja). */
    private static function volverAServicio(object $e, object $m): void
    {
        if ($m->kind !== 'CORRECTIVE' || $e->status !== 'OUT_OF_SERVICE' || in_array($e->oos_reason, ['CALIBRATION', 'MANUAL'], true)) {
            return;
        }
        if (self::correctivasAbiertas($e->id, $m->id)->isNotEmpty()) {
            return;
        }
        DB::table('equipment')->where('id', $e->id)->update(['status' => 'ACTIVE', 'oos_reason' => null, 'oos_since' => null, 'updated_at' => now()]);
        Events::emit('equipment.back_in_service', 'equipment', $e->id, ['code' => $e->code, 'order' => $m->number]);
    }

    /** @return array<int, array{description: string, qty: float, unit_cost: float}> */
    private static function repuestos(array $lista): array
    {
        $out = [];
        foreach ($lista as $p) {
            $p = (array) $p;
            $desc = self::texto($p['description'] ?? null, 120);
            if ($desc === null) {
                continue;
            }
            $q = self::num($p['qty'] ?? null, 3);
            $c = self::num($p['unit_cost'] ?? null, 2);
            ($q !== null && $q > 0) || RuleError::fail('RN-EQU-06', "La cantidad de «{$desc}» debe ser mayor que cero.");
            ($c !== null && $c >= 0) || RuleError::fail('RN-EQU-06', "El costo de «{$desc}» no puede ser negativo.");
            $out[] = ['description' => $desc, 'qty' => $q, 'unit_cost' => $c];
        }

        return $out;
    }

    private static function puntoDeTemperatura(?string $equipoId, ?string $almacen): bool
    {
        return DB::table('temperature_points')->where('status', 'ACTIVE')
            ->where(fn ($q) => $q->when($equipoId, fn ($x) => $x->orWhere('equipment_id', $equipoId))->when($almacen, fn ($x) => $x->orWhere('warehouse_id', $almacen)))
            ->when(! $equipoId && ! $almacen, fn ($q) => $q->whereRaw('false'))->exists();
    }

    private static function centroDelLocal(string $localId): ?string
    {
        return DB::table('cost_centers')->where('establishment_id', $localId)->where('status', 'ACTIVE')
            ->orderByRaw("CASE WHEN code LIKE 'PROD-%' THEN 0 ELSE 1 END")->orderBy('code')->value('id');
    }

    private static function gestor(User $quien): void
    {
        Access::can($quien, 'equ.maintenance.manage') || RuleError::fail('RN-EQU-06', 'Abrir, cerrar y costear órdenes pide el permiso equ.maintenance.manage (jefe de producción).');
    }

    private static function bloquearOrden(string $id, User $quien): object
    {
        $m = DB::table('maintenance_orders')->where('id', $id)->lockForUpdate()->first() ?? RuleError::fail('RN-EQU-06', 'Orden no encontrada.');
        self::localEnAlcance($quien, DB::table('equipment')->where('id', $m->equipment_id)->value('establishment_id'));

        return $m;
    }

    private static function localEnAlcance(User $quien, ?string $localId): void
    {
        $locales = Access::for($quien)['establishments'];
        if ($localId && $locales && ! in_array($localId, $locales, true)) {
            RuleError::fail('RN-EQU-04', 'El equipo es de un local fuera de tu alcance.');
        }
    }

    /** Siguiente número de orden («OM-0033»), por empresa, con candado de la transacción. */
    private static function numero(): string
    {
        DB::select('SELECT pg_advisory_xact_lock(hashtext(?))', ['equ:om:'.DB::selectOne('SELECT app_tenant_id() AS t')->t]);
        $max = DB::table('maintenance_orders')->where('number', 'like', 'OM-%')
            ->selectRaw("max(nullif(regexp_replace(substr(number, 4), '\\D', '', 'g'), '')::int) AS n")->value('n');

        return 'OM-'.str_pad((string) (((int) $max) + 1), 4, '0', STR_PAD_LEFT);
    }

    /** Las órdenes que crea la tarea diaria quedan a nombre del jefe de producción (o del gerente). */
    private static function autorSistema(): User
    {
        $id = DB::table('users as u')->join('user_roles as ur', 'ur.user_id', '=', 'u.id')->join('roles as r', 'r.id', '=', 'ur.role_id')
            ->whereIn('r.code', ['JEFE_PRODUCCION', 'GERENTE'])->where('u.status', 'ACTIVE')
            ->orderByRaw("CASE r.code WHEN 'JEFE_PRODUCCION' THEN 0 ELSE 1 END")->orderBy('u.name')->value('u.id');

        return User::findOrFail($id);
    }

    private static function yaAvisado(string $clave): bool
    {
        return DB::table('notifications')->where('module', 'EQU')->whereRaw("ref->>'key' = ?", [$clave])->exists();
    }

    private static function avisar(array $para, string $titulo, string $cuerpo, string $pantalla, ?string $id, string $tono, ?string $clave = null): void
    {
        DB::table('notifications')->insert($para + [
            'title' => mb_substr($titulo, 0, 255), 'body' => $cuerpo, 'ref' => json_encode(array_filter(['screen' => $pantalla, 'id' => $id, 'key' => $clave])),
            'tone' => $tono, 'module' => 'EQU', 'at' => now(), 'type' => 'ALERTS', 'in_app' => true,
        ]);
    }

    /** Fecha AAAA-MM-DD en Lima (hoy si viene vacía). */
    public static function fecha(?string $f): string
    {
        return $f ? CarbonImmutable::parse($f, 'America/Lima')->toDateString() : CarbonImmutable::now('America/Lima')->toDateString();
    }

    /** Días de $desde a $hasta (negativo si $hasta es antes). */
    public static function dias(string $desde, string $hasta): int
    {
        return (int) CarbonImmutable::parse(substr($desde, 0, 10), 'America/Lima')->diffInDays(CarbonImmutable::parse(substr($hasta, 0, 10), 'America/Lima'), false);
    }

    private static function dmy(string $f): string
    {
        return CarbonImmutable::parse(substr($f, 0, 10))->format('d/m/Y');
    }

    private static function num(mixed $v, int $d): ?float
    {
        if ($v === null || $v === '') {
            return null;
        }
        $v = is_string($v) ? str_replace(',', '.', trim($v)) : $v;

        return is_numeric($v) ? round((float) $v, $d) : null;
    }

    private static function texto(mixed $v, int $max): ?string
    {
        $s = trim((string) $v);

        return $s === '' ? null : mb_substr($s, 0, $max);
    }

    /** Texto decimal para la API: «12.50». */
    public static function t(mixed $v, int $d = 2): ?string
    {
        return $v === null ? null : number_format(round((float) $v, $d), $d, '.', '');
    }

    private static function n(float $v, int $d): string
    {
        return number_format($v, $d, '.', ',');
    }

    /** Las restricciones de la base se traducen a la regla que las pide. */
    private static function base(\Closure $fn): mixed
    {
        try {
            return $fn();
        } catch (QueryException $e) {
            $msg = $e->getMessage();
            foreach ([
                'equipment_balanza_calibrada' => ['RN-EQU-01', 'Toda balanza exige calibración.'],
                'equipment_calibrations_certificado' => ['RN-EQU-02', 'La calibración exige el número y el archivo del certificado.'],
                'equipment_calibrations_vigencia' => ['RN-EQU-02', 'La vigencia debe ser posterior a la fecha de calibración.'],
                'maintenance_orders_total' => ['RN-EQU-06', 'El costo debe ser mano de obra + repuestos + servicio externo.'],
                'maintenance_orders_una_abierta_por_plan' => ['RN-EQU-07', 'El plan ya tiene una orden abierta.'],
                'equipment_tenant_id_code_unique' => ['RN-EQU-01', 'Ya existe un equipo con ese código.'],
                'equipment_tenant_id_qr_code_unique' => ['RN-EQU-01', 'Ya existe un equipo con ese QR.'],
            ] as $restriccion => [$regla, $texto]) {
                if (str_contains($msg, $restriccion)) {
                    RuleError::fail($regla, $texto);
                }
            }
            throw $e;
        }
    }
}
