<?php

namespace App\Modulos\Gas\Services;

use App\Models\User;
use App\Modulos\Del\Services\Costos;
use App\Modulos\Plt\Services\Periodos;
use App\Support\Events;
use App\Support\Params;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * GAS-03 Bandeja de aprobación (RN-GAS-04, 07, 08 y 12). El nivel sale del monto en soles y de las reglas de
 * GAS-06 (primero la de la categoría o el local, luego la general); sin reglas, de gas_level1_max y gas_level2_max.
 * Las aprobaciones son de solo inserción.
 */
final class Aprobaciones
{
    public static function nivelRequerido(object $g): int
    {
        $monto = (float) $g->amount_pen;
        $reglas = DB::table('expense_approval_rules')->where('status', 'ACTIVE')
            ->where(fn ($w) => $w->whereNull('category_id')->orWhere('category_id', $g->category_id))
            ->where(fn ($w) => $w->whereNull('establishment_id')->orWhere('establishment_id', $g->establishment_id))
            ->where('min_amount', '<=', $monto)->where(fn ($w) => $w->whereNull('max_amount')->orWhere('max_amount', '>=', $monto))
            ->get(['level', 'category_id', 'establishment_id']);
        if ($reglas->isNotEmpty()) {
            // La más específica manda (categoría y local); entre iguales, la de nivel más alto.
            return (int) $reglas->sortByDesc(fn ($r) => ($r->category_id ? 20 : 0) + ($r->establishment_id ? 10 : 0) + (int) $r->level)->first()->level;
        }
        $n1 = (float) (Params::get('gas_level1_max') ?? 300);
        $n2 = (float) (Params::get('gas_level2_max') ?? 2000);

        return $monto <= $n1 + Base::EPS ? 1 : ($monto <= $n2 + Base::EPS ? 2 : 3);
    }

    public static function aprobar(string $id, ?string $comentario, User $u): object
    {
        DB::transaction(function () use ($id, $comentario, $u) {
            $g = DB::table('expenses')->where('id', $id)->lockForUpdate()->first();
            if (! $g) {
                abort(404, 'No se encontró el gasto.');
            }
            Gastos::visible($id, $u);
            self::puedeDecidir($g, $u);
            Periodos::abierto($g->issue_date, $g->company_id);
            Reparto::validar($g, true);   // RN-GAS-04
            $requerido = self::nivelRequerido($g);   // por si cambió la regla desde que se envió
            $nivel = Base::nivel($u);
            if ($nivel < $requerido) {
                RuleError::fail('RN-GAS-07', 'Este gasto de '.Base::soles((float) $g->amount_pen)." requiere una aprobación de nivel {$requerido} (".Base::NOMBRE_NIVEL[$requerido].'). Tu nivel es '.$nivel.'.');
            }
            DB::table('expense_approvals')->insert([
                'expense_id' => $g->id, 'level' => $nivel, 'approver_user_id' => $u->id, 'decision' => 'APPROVED',
                'comment' => trim((string) $comentario) !== '' ? mb_substr(trim((string) $comentario), 0, 1000) : null, 'decided_at' => now(),
            ]);
            $cambios = ['status' => 'APPROVED', 'approved_by' => $u->id, 'approved_at' => now(), 'required_level' => $requerido, 'updated_at' => now(),
                'history' => Base::historia($g->history, $u, 'Aprobó (nivel '.$nivel.')', trim((string) $comentario) ?: null)];
            if ($g->pay_source === 'PETTY') {
                // El dinero ya salió del fondo: queda pagado desde la cuenta de la caja chica y entra a su rendición.
                $fondo = CajaChica::fondoDeGasto($g);
                $cambios = array_merge($cambios, ['status' => 'PAID', 'paid_at' => now(), 'paid_from_account_id' => $fondo?->cash_account_id,
                    'paid_amount' => Base::r((float) $g->amount_pen - (float) $g->withholding_amount * (float) $g->exchange_rate), 'payment_reference' => 'Caja chica']);
            }
            DB::table('expenses')->where('id', $id)->update($cambios);
            self::costoDeReparto($g, $u);   // RN-GAS-12
            if ($g->petty_cash_report_id) {
                CajaChica::recalcular($g->petty_cash_report_id);
            }
            Events::emit('expense.approved', 'expenses', $id, ['number' => $g->number, 'amount_pen' => (float) $g->amount_pen, 'net_pen' => (float) $g->net_pen,
                'category_code' => $g->category_code, 'cost_center_id' => $g->cost_center_id, 'ad_campaign_id' => $g->ad_campaign_id, 'level' => $nivel]);
            if ($g->created_by) {
                Base::avisar(['user_id' => $g->created_by], "Gasto {$g->number} aprobado", 'Tu gasto de '.Base::soles((float) $g->amount_pen).' fue aprobado por '.$u->name.'.', 'GAS-02', $id, 'ok');
            }
        });

        return Gastos::fila($id);
    }

    public static function rechazar(string $id, string $comentario, User $u): object
    {
        DB::transaction(function () use ($id, $comentario, $u) {
            $g = DB::table('expenses')->where('id', $id)->lockForUpdate()->first();
            if (! $g) {
                abort(404, 'No se encontró el gasto.');
            }
            Gastos::visible($id, $u);
            self::puedeDecidir($g, $u);
            if (mb_strlen(trim($comentario)) < 5) {
                RuleError::fail('RN-GAS-07', 'Escribe el motivo del rechazo para que se pueda corregir.');
            }
            $nivel = Base::nivel($u);
            if ($nivel < (int) $g->required_level) {
                RuleError::fail('RN-GAS-07', "Este gasto lo decide el nivel {$g->required_level} (".Base::NOMBRE_NIVEL[(int) $g->required_level].').');
            }
            DB::table('expense_approvals')->insert([
                'expense_id' => $g->id, 'level' => $nivel, 'approver_user_id' => $u->id, 'decision' => 'REJECTED',
                'comment' => mb_substr(trim($comentario), 0, 1000), 'decided_at' => now(),
            ]);
            DB::table('expenses')->where('id', $id)->update(['status' => 'REJECTED', 'rejection_reason' => mb_substr(trim($comentario), 0, 255), 'updated_at' => now(),
                'history' => Base::historia($g->history, $u, 'Rechazó', trim($comentario))]);
            if ($g->petty_cash_report_id) {
                CajaChica::recalcular($g->petty_cash_report_id);
            }
            Events::emit('expense.rejected', 'expenses', $id, ['number' => $g->number, 'reason' => trim($comentario)]);
            if ($g->created_by) {
                Base::avisar(['user_id' => $g->created_by], "Gasto {$g->number} rechazado", trim($comentario), 'GAS-02', $id, 'warn');
            }
        });

        return Gastos::fila($id);
    }

    /** RN-GAS-07 y RN-GAS-08: solo un gasto enviado; nadie decide su propio gasto. */
    private static function puedeDecidir(object $g, User $u): void
    {
        if ($g->status !== 'SUBMITTED') {
            RuleError::fail('RN-GAS-07', 'Solo se aprueba o rechaza un gasto enviado. Este está '.mb_strtolower(Base::ESTADOS[$g->status] ?? $g->status).'.');
        }
        if ($g->created_by === $u->id) {
            RuleError::fail('RN-GAS-08', 'Nadie aprueba su propio gasto: lo debe decidir otra persona.');
        }
        if (Base::nivel($u) < 1) {
            RuleError::fail('RN-GAS-07', 'Tu rol no aprueba gastos.');
        }
    }

    /** RN-GAS-12: un gasto de una categoría de reparto se copia como costo de DEL, sin IGV, con su vehículo, ruta, repartidor, galones y vale. */
    public static function costoDeReparto(object $g, User $u): void
    {
        $cat = $g->category_id ? DB::table('expense_categories')->where('id', $g->category_id)->first(['category_group', 'delivery_cost_type', 'name']) : null;
        if (! $cat || $cat->category_group !== 'DELIVERY' || ! $cat->delivery_cost_type) {
            return;
        }
        if (DB::table('delivery_costs')->where('expense_id', $g->id)->where('status', 'ACTIVE')->exists()) {
            return;
        }
        $vale = $g->fuel_voucher_no ?: trim(($g->doc_series ? $g->doc_series.'-' : '').($g->doc_number ?? '')) ?: $g->number;
        Costos::registrar([
            'cost_date' => $g->issue_date, 'cost_type' => $cat->delivery_cost_type, 'amount' => (float) $g->net_pen,
            'route_id' => $g->route_id, 'vehicle_id' => $g->vehicle_id, 'employee_ref' => $g->employee_id, 'supplier_id' => $g->supplier_id,
            'fuel_gallons' => $g->fuel_gallons, 'fuel_voucher_no' => $vale, 'odometer_km' => $g->odometer_km,
            'expense_id' => $g->id, 'source' => 'GAS', 'establishment_id' => $g->establishment_id,
            'notes' => "Gasto {$g->number} · {$cat->name}".($g->supplier_name ? " · {$g->supplier_name}" : ''),
        ], $u, false);
    }

    /** Bandeja: gastos enviados que el usuario puede decidir (su nivel o menos) y que no son suyos. */
    public static function bandeja(User $u)
    {
        $nivel = Base::nivel($u);
        $q = Gastos::consulta()->where('e.status', 'SUBMITTED')->where('e.required_level', '<=', $nivel)->where('e.created_by', '<>', $u->id);

        return Base::alcance($q, $u);
    }
}
