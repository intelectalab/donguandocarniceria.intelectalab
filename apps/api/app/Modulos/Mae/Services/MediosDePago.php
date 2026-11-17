<?php

namespace App\Modulos\Mae\Services;

use App\Models\User;
use App\Support\Events;
use App\Support\RuleError;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

/**
 * MAE-03 y MAE-04: medios de pago y sus comisiones por vigencia.
 *
 *  RN-MAE-03  los medios del sistema no se borran ni cambian código o tipo; se configuran y se desactivan.
 *  RN-MAE-04  Yape, Plin, POS Visa, Mercado Pago y transferencia exigen número de operación: validarCobro().
 *  RN-MAE-05  una sola comisión por medio y fecha (la base no deja que se crucen); comisión = monto × % + fijo, a 2 decimales.
 *
 * Para otros módulos (CAJ, POS, PED, WEB): MediosDePago::validarCobro($medioId, $referencia) y
 * MediosDePago::comision($medioId, $fecha, $monto).
 */
final class MediosDePago
{
    public const CANALES = ['COUNTER', 'DELIVERY', 'WHATSAPP', 'TIKTOK', 'WEB', 'B2B', 'CONSIGNMENT'];

    public const IGV = 0.18;

    public static function medio(string $id): object
    {
        return DB::table('payment_methods')->where('id', $id)->first() ?? RuleError::fail('RN-MAE-03', 'El medio de pago no existe.');
    }

    /** RN-MAE-04: un cobro con un medio que exige número de operación no se acepta sin él. */
    public static function validarCobro(string $medioId, ?string $referencia): object
    {
        $m = self::medio($medioId);
        if ($m->status !== 'ACTIVE') {
            RuleError::fail('RN-MAE-03', "{$m->name} está desactivado: no acepta cobros.");
        }
        if ($m->requires_reference && trim((string) $referencia) === '') {
            RuleError::fail('RN-MAE-04', "Un cobro con {$m->name} necesita el número de operación.");
        }

        return $m;
    }

    /** Comisión vigente de un medio en una fecha, o null. */
    public static function comisionVigente(string $medioId, string $fecha): ?object
    {
        return DB::table('payment_method_fees')->where('payment_method_id', $medioId)->where('valid_from', '<=', $fecha)
            ->where(fn ($q) => $q->whereNull('valid_to')->orWhere('valid_to', '>=', $fecha))->first();
    }

    /**
     * RN-MAE-05: comisión de un cobro. Sin comisión registrada para la fecha, es cero.
     *
     * @return array{fila: ?object, pct: float, fijo: float, comision: float, igv: float, neto: float}
     */
    public static function comision(string $medioId, string $fecha, float $monto): array
    {
        $f = self::comisionVigente($medioId, substr($fecha, 0, 10));
        $pct = $f ? (float) $f->fee_pct : 0.0;
        $fijo = $f ? (float) $f->fee_fixed : 0.0;
        $comision = round($monto * $pct / 100 + $fijo, 2);
        $igv = $f && ! $f->igv_included ? round($comision * self::IGV, 2) : 0.0;

        return ['fila' => $f, 'pct' => $pct, 'fijo' => $fijo, 'comision' => $comision, 'igv' => $igv, 'neto' => round($monto - $comision - $igv, 2)];
    }

    /** RN-MAE-03: nombre, entidad, plazo de abono, canales y contra entrega. Código y tipo no cambian. */
    public static function configurar(object $m, array $d, User $quien): object
    {
        if ($m->status === 'INTERNAL') {
            RuleError::fail('RN-MAE-03', "{$m->name} es interno del sistema: no se configura aquí.");
        }
        if (! empty($d['institution_code']) && ! DB::table('financial_institutions')->where('code', $d['institution_code'])->exists()) {
            RuleError::fail('RN-MAE-03', 'La entidad financiera no existe.');
        }
        DB::table('payment_methods')->where('id', $m->id)->update([
            'name' => trim($d['name']), 'institution_code' => $d['institution_code'] ?: null, 'settlement_days' => (int) $d['settlement_days'],
            'allowed_channels' => json_encode(array_values(array_intersect(self::CANALES, $d['allowed_channels']))),
            'allowed_on_delivery' => (bool) ($d['allowed_on_delivery'] ?? false), 'change_reason' => trim($d['reason']), 'updated_at' => now(),
        ]);
        Events::emit('payment_method.configured', 'payment_methods', $m->id, ['by' => $quien->id, 'reason' => trim($d['reason'])]);

        return self::medio($m->id);
    }

    public static function cambiarEstado(object $m, bool $activo, string $motivo, User $quien): object
    {
        if ($m->status === 'INTERNAL') {
            RuleError::fail('RN-MAE-03', "{$m->name} es interno del sistema: no se activa ni desactiva.");
        }
        DB::table('payment_methods')->where('id', $m->id)->update(['status' => $activo ? 'ACTIVE' : 'INACTIVE', 'change_reason' => trim($motivo), 'updated_at' => now()]);
        Events::emit($activo ? 'payment_method.activated' : 'payment_method.deactivated', 'payment_methods', $m->id, ['by' => $quien->id, 'reason' => trim($motivo)]);

        return self::medio($m->id);
    }

    /**
     * RN-MAE-05: registra una comisión. Con $cerrarAnterior, la vigencia abierta anterior termina el día previo.
     * La base rechaza el cruce (EXCLUDE): aquí se responde con el mensaje de la regla.
     */
    public static function agregarComision(array $d, bool $cerrarAnterior, User $quien): object
    {
        $m = self::medio($d['payment_method_id']);
        if ($m->status === 'INTERNAL') {
            RuleError::fail('RN-MAE-03', "{$m->name} es interno del sistema: no lleva comisión.");
        }
        $desde = $d['valid_from'];
        $hasta = $d['valid_to'] ?? null;

        return DB::transaction(function () use ($m, $d, $desde, $hasta, $cerrarAnterior, $quien) {
            DB::table('payment_methods')->where('id', $m->id)->lockForUpdate()->first();
            if ($cerrarAnterior) {
                DB::table('payment_method_fees')->where('payment_method_id', $m->id)->whereNull('valid_to')->where('valid_from', '<', $desde)
                    ->update(['valid_to' => date('Y-m-d', strtotime($desde.' -1 day')), 'updated_at' => now()]);
            }
            $cruce = DB::table('payment_method_fees')->where('payment_method_id', $m->id)
                ->where('valid_from', '<=', $hasta ?? '9999-12-31')->where(fn ($q) => $q->whereNull('valid_to')->orWhere('valid_to', '>=', $desde))
                ->orderBy('valid_from')->first();
            if ($cruce) {
                $fin = $cruce->valid_to ? 'al '.date('d/m/Y', strtotime($cruce->valid_to)) : 'sin fecha de fin';
                $pct = number_format((float) $cruce->fee_pct, 2, ',', '.');
                RuleError::fail('RN-MAE-05', "Se cruza con la comisión de {$pct} % vigente del ".date('d/m/Y', strtotime($cruce->valid_from))." {$fin}: un medio tiene una sola comisión por fecha.");
            }
            try {
                $id = DB::table('payment_method_fees')->insertGetId([
                    'payment_method_id' => $m->id, 'valid_from' => $desde, 'valid_to' => $hasta, 'fee_pct' => $d['fee_pct'], 'fee_fixed' => $d['fee_fixed'] ?? 0,
                    'igv_included' => (bool) ($d['igv_included'] ?? true), 'note' => ($n = trim((string) ($d['note'] ?? ''))) === '' ? null : $n,
                    'status' => 'ACTIVE', 'created_by' => mb_substr($quien->name, 0, 80),
                ]);
            } catch (QueryException $e) {
                if (str_contains($e->getMessage(), 'payment_method_fees_sin_cruce')) {
                    RuleError::fail('RN-MAE-05', 'Se cruza con otra comisión del mismo medio: un medio tiene una sola comisión por fecha.');
                }
                throw $e;
            }
            Events::emit('payment_method.fee_added', 'payment_methods', $m->id, ['fee_id' => $id, 'from' => $desde, 'to' => $hasta, 'by' => $quien->id]);

            return DB::table('payment_method_fees')->find($id);
        });
    }
}
