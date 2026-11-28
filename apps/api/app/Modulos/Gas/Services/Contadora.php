<?php

namespace App\Modulos\Gas\Services;

use App\Models\User;
use App\Modulos\Del\Services\ParaGas;
use App\Modulos\Plt\Services\CentrosCosto;
use App\Modulos\Plt\Services\Periodos;
use App\Support\Events;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * GAS-09 Bandeja de la contadora (RN-GAS-06): gastos sin comprobante válido u observados, con su foto, para
 * clasificar o pedir corrección. También trae a Gastos los gastos del repartidor de las rutas ya liquidadas en DEL.
 */
final class Contadora
{
    /** Tipo de gasto del repartidor (DEL-17) => categoría de GAS. */
    private const DE_RUTA = ['FUEL' => 'DEL-COMB', 'MEAL' => 'DEL-ALIM', 'TOLL' => 'DEL-PEAJE', 'EXT_COURIER' => 'DEL-EMP', 'OTHER' => 'OTR'];

    private const NOMBRES_RUTA = ['FUEL' => 'Combustible', 'MEAL' => 'Alimentación', 'TOLL' => 'Peajes', 'EXT_COURIER' => 'Motorizado externo', 'OTHER' => 'Otros'];

    public static function bandeja(User $u, string $vista)
    {
        $q = Gastos::consulta()->where('e.status', '<>', 'VOIDED');
        if ($vista === 'revisados') {
            $q->whereNotNull('e.accounting_reviewed_at')->where('e.accounting_flag', '<>', 'OBSERVED')
                ->where('e.accounting_reviewed_at', '>=', now()->subDays(120));
        } else {
            $q->where(fn ($w) => $w->where('e.accounting_flag', 'OBSERVED')
                ->orWhere(fn ($x) => $x->where('e.accounting_flag', 'NO_VALID_RECEIPT')->whereNull('e.accounting_reviewed_at')));
        }

        return Base::alcance($q, $u);
    }

    /** Clasifica: confirma si el comprobante es válido o no (D-GAS-05) y, si hace falta, corrige la categoría o el centro de costo. */
    public static function clasificar(string $id, array $d, User $u): object
    {
        DB::transaction(function () use ($id, $d, $u) {
            $g = DB::table('expenses')->where('id', $id)->lockForUpdate()->first();
            if (! $g) {
                abort(404, 'No se encontró el gasto.');
            }
            Gastos::visible($id, $u);
            if ($g->status === 'VOIDED') {
                RuleError::fail('RN-GAS-06', 'El gasto está anulado.');
            }
            $bandera = (string) ($d['accounting_flag'] ?? '');
            if (! in_array($bandera, ['OK', 'NO_VALID_RECEIPT'], true)) {
                RuleError::fail('RN-GAS-06', 'Indica si el comprobante es válido o no.');
            }
            if ($bandera === 'OK' && $g->doc_type === 'NONE') {
                RuleError::fail('RN-GAS-06', 'Un gasto sin comprobante no puede quedar como válido.');
            }
            $cambios = ['accounting_flag' => $bandera, 'accounting_reviewed_at' => now(), 'accounting_reviewed_by' => $u->id,
                'accounting_note' => trim((string) ($d['note'] ?? '')) !== '' ? mb_substr(trim((string) $d['note']), 0, 255) : null];
            $aprobado = in_array($g->status, ['APPROVED', 'PAID'], true);
            $notas = [];
            if (! empty($d['category_id']) && $d['category_id'] !== $g->category_id) {
                $nueva = DB::table('expense_categories')->where('id', $d['category_id'])->where('status', 'ACTIVE')->first(['id', 'code', 'name', 'category_group']);
                if (! $nueva) {
                    RuleError::fail('RN-GAS-03', 'La categoría elegida no existe o está inactiva.');
                }
                $vieja = DB::table('expense_categories')->where('id', $g->category_id)->value('category_group');
                if ($aprobado && ($vieja === 'DELIVERY' || $nueva->category_group === 'DELIVERY')) {
                    RuleError::fail('RN-GAS-12', 'El gasto ya está aprobado y su categoría entra o sale de los costos de reparto: anúlalo y regístralo de nuevo.');
                }
                if ($aprobado) {
                    Periodos::abierto($g->issue_date, $g->company_id);
                }
                $cambios += ['category_id' => $nueva->id, 'category_code' => mb_substr($nueva->code, 0, 40)];
                $notas[] = 'categoría: '.$nueva->name;
            }
            if (! empty($d['cost_center_id']) && $d['cost_center_id'] !== $g->cost_center_id) {
                CentrosCosto::activo($d['cost_center_id']);
                if ($aprobado) {
                    Periodos::abierto($g->issue_date, $g->company_id);
                }
                $cambios['cost_center_id'] = $d['cost_center_id'];
                $notas[] = 'centro de costo: '.DB::table('cost_centers')->where('id', $d['cost_center_id'])->value('name');
            }
            $accion = $bandera === 'OK' ? 'Contadora: comprobante válido' : 'Contadora: sin comprobante válido';
            DB::table('expenses')->where('id', $id)->update($cambios + ['updated_at' => now(),
                'history' => Base::historia($g->history, $u, $accion, implode(' · ', array_filter([$notas ? 'Reclasificó '.implode(', ', $notas) : null, $cambios['accounting_note']])) ?: null)]);
            Events::emit('expense.classified', 'expenses', $id, ['number' => $g->number, 'flag' => $bandera]);
        });

        return Gastos::fila($id);
    }

    /** Pide corrección a quien registró el gasto. */
    public static function observar(string $id, string $nota, User $u): object
    {
        DB::transaction(function () use ($id, $nota, $u) {
            $g = DB::table('expenses')->where('id', $id)->lockForUpdate()->first();
            if (! $g) {
                abort(404, 'No se encontró el gasto.');
            }
            Gastos::visible($id, $u);
            if ($g->status === 'VOIDED') {
                RuleError::fail('RN-GAS-06', 'El gasto está anulado.');
            }
            if (mb_strlen(trim($nota)) < 5) {
                RuleError::fail('RN-GAS-06', 'Escribe qué hay que corregir.');
            }
            DB::table('expenses')->where('id', $id)->update(['accounting_flag' => 'OBSERVED', 'accounting_note' => mb_substr(trim($nota), 0, 255),
                'accounting_reviewed_at' => null, 'accounting_reviewed_by' => $u->id, 'corrected_at' => null, 'updated_at' => now(),
                'history' => Base::historia($g->history, $u, 'Contadora: pidió corrección', trim($nota))]);
            if ($g->created_by && $g->created_by !== $u->id) {
                Base::avisar(['user_id' => $g->created_by], "Corrige el gasto {$g->number}", trim($nota), 'GAS-02', $id, 'warn');
            }
        });

        return Gastos::fila($id);
    }

    /**
     * Trae los gastos del repartidor de rutas liquidadas (DEL-17). Los pagados con el efectivo de la ruta quedan
     * pagados (ya se descontaron en la liquidación); los pagados con dinero propio quedan aprobados por pagar, para
     * reembolsar al repartidor. El costo de reparto ya existe en DEL: solo se enlaza, no se duplica.
     */
    public static function traerDeRuta(User $u): array
    {
        return DB::transaction(function () use ($u) {
            DB::select('SELECT pg_advisory_xact_lock(hashtext(?))', ['gas:traer:'.DB::selectOne('SELECT app_tenant_id() AS t')->t]);
            $traidos = 0;
            $cerrados = 0;
            $total = 0.0;
            $categorias = DB::table('expense_categories')->get(['id', 'code', 'default_cost_center_id', 'category_group'])->keyBy('code');
            $ccReparto = DB::table('cost_centers')->where('code', 'DEL')->value('id');
            foreach (ParaGas::gastosLiquidados() as $x) {
                $local = DB::table('establishments')->where('id', $x->establishment_id)->first(['id', 'company_id']);
                if (! $local) {
                    continue;
                }
                if (Periodos::cerrado($x->expense_date, $local->company_id)) {
                    $cerrados++;

                    continue;
                }
                $cat = $categorias[self::DE_RUTA[$x->category] ?? 'OTR'] ?? $categorias->firstWhere('category_group', 'DELIVERY');
                if (! $cat) {
                    continue;
                }
                $cc = $cat->default_cost_center_id ?: $ccReparto;
                $marca = DB::table('cost_centers')->where('id', $cc)->value('brand_id') ?: Gastos::marcaPorDefecto();
                $aprobo = $x->approved_by ?: $x->settled_by ?: $u->id;
                $creador = $x->driver_user_id ?: $x->created_by ?: $u->id;
                $propio = $x->paid_with === 'OWN';
                $nombre = self::NOMBRES_RUTA[$x->category] ?? $x->category;
                $creadorNombre = DB::table('users')->where('id', $creador)->value('name') ?? 'Repartidor';
                $historia = json_encode([
                    ['at' => substr((string) $x->created_at, 0, 16), 'user' => $creadorNombre, 'action' => "Registró el gasto en la ruta {$x->ruta} ({$x->number})"],
                    ['at' => now('America/Lima')->format('Y-m-d\TH:i'), 'user' => $u->name, 'action' => "Pasó a Gastos con la liquidación {$x->liquidacion}"],
                ], JSON_UNESCAPED_UNICODE);
                $id = DB::table('expenses')->insertGetId([
                    'number' => Base::numero('expenses', 'GS-'), 'company_id' => $local->company_id, 'establishment_id' => $local->id, 'cost_center_id' => $cc,
                    'brand_id' => $marca, 'category_id' => $cat->id, 'category_code' => $cat->code, 'doc_type' => 'NONE', 'issue_date' => $x->expense_date,
                    'currency' => 'PEN', 'exchange_rate' => 1, 'subtotal' => $x->amount, 'igv' => 0, 'other_taxes' => 0, 'total' => $x->amount, 'withholding_amount' => 0,
                    'net_pen' => $x->amount, 'description' => "Gasto de la ruta {$x->ruta} · {$nombre}".($x->note ? " · {$x->note}" : ''),
                    'status' => $propio ? 'APPROVED' : 'PAID', 'source_module' => 'DEL', 'vehicle_id' => $x->vehicle_id, 'route_id' => $x->route_id,
                    'employee_id' => $x->driver_employee_id, 'fuel_gallons' => $x->fuel_gallons, 'fuel_voucher_no' => $x->voucher_no ? mb_substr($x->voucher_no, 0, 20) : null,
                    'receipt_file_id' => $x->photo_file_id, 'accounting_flag' => 'NO_VALID_RECEIPT', 'created_by' => $creador, 'pay_source' => $propio ? 'PAYABLE' : null,
                    'required_level' => 1, 'history' => $historia, 'submitted_at' => $x->created_at, 'approved_by' => $aprobo, 'approved_at' => now(),
                    'paid_at' => $propio ? null : now(), 'paid_amount' => $propio ? null : $x->amount,
                    'payment_reference' => $propio ? null : mb_substr("Efectivo de ruta · {$x->liquidacion}", 0, 40), 'driver_expense_id' => $x->id,
                ], 'id');
                DB::table('expense_approvals')->insert(['expense_id' => $id, 'level' => 0, 'approver_user_id' => $aprobo, 'decision' => 'APPROVED',
                    'comment' => "Aprobado en la liquidación {$x->liquidacion} de la ruta {$x->ruta}", 'decided_at' => now()]);
                if ($x->cost_id) {
                    ParaGas::enlazarCosto($x->cost_id, $id);
                }
                Events::emit('expense.approved', 'expenses', $id, ['number' => null, 'amount_pen' => (float) $x->amount, 'net_pen' => (float) $x->amount,
                    'category_code' => $cat->code, 'cost_center_id' => $cc, 'source' => 'DEL', 'driver_expense_id' => $x->id]);
                $traidos++;
                $total += (float) $x->amount;
            }

            return ['traidos' => $traidos, 'total' => Base::r($total), 'en_periodo_cerrado' => $cerrados];
        });
    }

    /** Cuántos gastos de ruta liquidados faltan traer. */
    public static function porTraer(): int
    {
        return ParaGas::gastosLiquidados()->count();
    }
}
