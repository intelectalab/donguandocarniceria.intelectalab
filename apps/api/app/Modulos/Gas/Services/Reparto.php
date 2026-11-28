<?php

namespace App\Modulos\Gas\Services;

use App\Models\User;
use App\Modulos\Plt\Services\CentrosCosto;
use App\Modulos\Plt\Services\Marcas;
use App\Support\Access;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * GAS-10 Reparto entre centros de costo (RN-GAS-04): porcentajes por centro de costo, marca y canal. Los montos los
 * calcula la API sobre el monto en soles; la última línea absorbe el redondeo para que sumen el total exacto.
 */
final class Reparto
{
    public static function lineas(string $gastoId): array
    {
        return DB::table('expense_allocations as a')->leftJoin('cost_centers as c', 'c.id', '=', 'a.cost_center_id')->leftJoin('brands as b', 'b.id', '=', 'a.brand_id')
            ->where('a.expense_id', $gastoId)->orderByDesc('a.pct')->orderBy('c.code')
            ->get(['a.id', 'a.cost_center_id', 'a.brand_id', 'a.sales_channel', 'a.pct', 'a.amount', 'c.name as centro', 'c.code as centro_codigo', 'b.name as marca'])
            ->map(fn ($a) => ['id' => $a->id, 'cost_center_id' => $a->cost_center_id, 'brand_id' => $a->brand_id, 'sales_channel' => $a->sales_channel,
                'canal' => $a->sales_channel ? (Base::CANALES[$a->sales_channel] ?? $a->sales_channel) : null,
                'pct' => (float) $a->pct, 'amount' => (float) $a->amount, 'centro' => $a->centro, 'centro_codigo' => $a->centro_codigo, 'marca' => $a->marca])->all();
    }

    /** Guarda el reparto (reemplaza el anterior). Una lista vacía lo quita. */
    public static function guardar(string $gastoId, array $lineas, User $u): array
    {
        return DB::transaction(function () use ($gastoId, $lineas, $u) {
            $g = DB::table('expenses')->where('id', $gastoId)->lockForUpdate()->first();
            if (! $g) {
                abort(404, 'No se encontró el gasto.');
            }
            Gastos::visible($gastoId, $u);
            if (! in_array($g->status, ['DRAFT', 'SUBMITTED', 'REJECTED'], true)) {
                RuleError::fail('RN-GAS-04', 'El reparto se define antes de aprobar el gasto.');
            }
            if ($g->created_by !== $u->id && ! Access::can($u, 'gas.accounting.review') && Base::nivel($u) < 1) {
                RuleError::fail('RN-GAS-04', 'El reparto lo define quien registró el gasto, quien lo aprueba o la contadora.');
            }
            DB::table('expense_allocations')->where('expense_id', $gastoId)->delete();
            if (! $lineas) {
                DB::table('expenses')->where('id', $gastoId)->update(['allocated' => false, 'updated_at' => now(), 'history' => Base::historia($g->history, $u, 'Quitó el reparto')]);

                return [];
            }
            if (count($lineas) < 2) {
                RuleError::fail('RN-GAS-04', 'Un reparto tiene al menos dos líneas. Si va todo a un centro de costo, déjalo sin reparto.');
            }
            $total = (float) $g->amount_pen;
            $suma = 0.0;
            $vistos = [];
            $filas = [];
            foreach (array_values($lineas) as $i => $l) {
                $cc = (string) ($l['cost_center_id'] ?? '');
                $marca = (string) ($l['brand_id'] ?? '');
                $canal = ($l['sales_channel'] ?? null) ?: null;
                $pct = round((float) ($l['pct'] ?? 0), 4);
                if ($cc === '' || $marca === '') {
                    RuleError::fail('RN-GAS-04', 'Cada línea lleva centro de costo y marca.');
                }
                if ($pct <= 0 || $pct > 100) {
                    RuleError::fail('RN-GAS-04', 'Cada porcentaje debe estar entre 0 y 100.');
                }
                if ($canal && ! isset(Base::CANALES[$canal])) {
                    RuleError::fail('RN-GAS-04', 'El canal elegido no es válido.');
                }
                $clave = "{$cc}|{$marca}|{$canal}";
                if (isset($vistos[$clave])) {
                    RuleError::fail('RN-GAS-04', 'Hay dos líneas con el mismo centro de costo, marca y canal: júntalas.');
                }
                $vistos[$clave] = true;
                CentrosCosto::activo($cc);
                Marcas::activa($marca);
                $suma += $pct;
                $filas[] = ['expense_id' => $gastoId, 'cost_center_id' => $cc, 'brand_id' => $marca, 'sales_channel' => $canal, 'pct' => $pct];
            }
            if (abs($suma - 100) > 0.0001) {
                RuleError::fail('RN-GAS-04', 'El reparto suma '.rtrim(rtrim(number_format($suma, 4, ',', ''), '0'), ',').' % y debe sumar 100 %.');
            }
            $acumulado = 0.0;
            foreach ($filas as $i => $f) {
                $monto = $i === count($filas) - 1 ? Base::r($total - $acumulado) : Base::r($total * $f['pct'] / 100);
                $acumulado = Base::r($acumulado + $monto);
                DB::table('expense_allocations')->insert($f + ['amount' => $monto]);
            }
            DB::table('expenses')->where('id', $gastoId)->update(['allocated' => true, 'updated_at' => now(),
                'history' => Base::historia($g->history, $u, 'Repartió entre centros de costo', count($filas).' líneas')]);

            return self::lineas($gastoId);
        });
    }

    /** RN-GAS-04: si el gasto está repartido, el reparto suma el 100 % y el total del gasto. */
    public static function validar(object $g, bool $alAprobar = false): void
    {
        if (! $g->allocated) {
            return;
        }
        $l = DB::table('expense_allocations')->where('expense_id', $g->id)->get(['pct', 'amount']);
        $pct = round((float) $l->sum('pct'), 4);
        $monto = Base::r($l->sum('amount'));
        if ($l->count() < 2 || abs($pct - 100) > 0.0001 || abs($monto - (float) $g->amount_pen) > Base::EPS) {
            RuleError::fail('RN-GAS-04', 'El reparto entre centros de costo suma '.rtrim(rtrim(number_format($pct, 4, ',', ''), '0'), ',').' % y '.Base::soles($monto)
                .'; debe sumar 100 % y '.Base::soles((float) $g->amount_pen).'. Corrígelo en Reparto entre centros de costo'.($alAprobar ? ' antes de aprobar.' : '.'));
        }
    }
}
