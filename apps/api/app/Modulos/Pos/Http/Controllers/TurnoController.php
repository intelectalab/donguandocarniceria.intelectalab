<?php

namespace App\Modulos\Pos\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Pos\Services\Cajas;
use App\Modulos\Pos\Services\Turnos;
use App\Support\Access;
use App\Support\Params;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * POS-01 Abrir turno, POS-06 Ingresos y retiros, POS-07 Cerrar turno y POS-08 Aprobación de cierre.
 * Reglas en Services\Turnos.
 */
class TurnoController extends Controller
{
    /** Lo que necesita el mostrador al entrar: cajas, mi turno, turnos abiertos, medios y parámetros. */
    public function contexto(Request $request)
    {
        $u = $request->user();
        $mio = Turnos::abiertoDe($u);
        $a = Access::for($u);
        $abiertos = DB::table('pos_shifts as s')->join('pos_terminals as t', 't.id', '=', 's.terminal_id')->where('s.status', 'OPEN')
            ->when($a['establishments'], fn ($q) => $q->whereIn('s.establishment_id', $a['establishments']))
            ->orderBy('s.opened_at')->get(['s.id', 's.number', 's.cashier_name', 's.cashier_user_id', 's.opened_at', 't.name as caja', 't.code as caja_code']);

        return response()->json([
            'turno' => $mio ? $this->resumen($mio) : null,
            'cajas' => Cajas::visibles($u, true),
            'abiertos' => $abiertos,
            'medios' => Cajas::medios(),
            'denominaciones' => Turnos::DENOMINACIONES,
            'movimientos' => Turnos::MOVIMIENTOS,
            'marcas_tarjeta' => \App\Modulos\Pos\Services\Cobros::MARCAS_TARJETA,
            'lineas' => \App\Modulos\Pos\Services\Mostrador::LINEAS,
            'parametros' => [
                'peso_maximo' => (float) (Params::get('pos_max_manual_weight_kg') ?? 30),
                'retiro_con_autorizacion' => (float) (Params::get('pos_cash_out_approval_above') ?? 100),
                'diferencia_con_aviso' => (float) (Params::get('pos_max_cash_diff_without_approval') ?? 5),
                'comprobante_por_defecto' => (string) (Params::get('pos_receipt_default_doc') ?? 'RECEIPT'),
                'boleta_con_documento' => (float) (Params::get('fac_receipt_id_required_above') ?? 700),
            ],
            'puede' => [
                'vender' => Access::can($u, 'pos.sale.create'), 'abrir' => Access::can($u, 'pos.shift.open'),
                'aprobar' => Access::can($u, 'pos.shift.approve'), 'autorizar_retiro' => Access::can($u, 'pos.cash.withdraw'),
                'devolver' => Access::can($u, 'pos.sale.refund'), 'cajas' => Access::can($u, 'pos.terminal.manage'),
                'peso_fuera_de_rango' => Access::can($u, 'pos.weight.override'),
            ],
            'cliente_varios' => Cajas::clienteVarios(),
            'alertas' => $this->alertas($u),
        ]);
    }

    /** Avisos del mostrador: cierres por aprobar, turnos abiertos desde otro día, comprobantes en reintento. */
    private function alertas($u): array
    {
        $a = Access::for($u);
        $local = fn ($q, $col = 'establishment_id') => $q->when($a['establishments'], fn ($w) => $w->whereIn($col, $a['establishments']));
        $hoy = now('America/Lima')->toDateString();
        $r = [];
        $porAprobar = $local(DB::table('pos_shifts')->where('status', 'CLOSED'))->count();
        if ($porAprobar) {
            $r[] = ['tono' => 'info', 'texto' => "{$porAprobar} cierre(s) de caja por aprobar.", 'pantalla' => 'pos-08'];
        }
        $viejos = $local(DB::table('pos_shifts')->where('status', 'OPEN'))->whereRaw("(opened_at at time zone 'America/Lima')::date < ?", [$hoy])->pluck('number');
        if ($viejos->isNotEmpty()) {
            $r[] = ['tono' => 'bad', 'texto' => 'Turno de caja abierto desde otro día: '.$viejos->implode(', ').'.', 'pantalla' => 'pos-07'];
        }
        $cola = $local(DB::table('sales_documents')->whereNotNull('pos_terminal_id')->where('sunat_status', 'PENDING'))->count();
        if ($cola) {
            $r[] = ['tono' => 'warn', 'texto' => "{$cola} comprobante(s) del mostrador en cola de reintento: el ticket se entregó y el OSE no respondió.", 'pantalla' => 'pos-10'];
        }

        return $r;
    }

    /** Turno con su esperado, para POS-01, POS-06, POS-07 y POS-08. */
    private function resumen(object $t): array
    {
        $caja = DB::table('pos_terminals')->where('id', $t->terminal_id)->first(['id', 'code', 'name', 'warehouse_id', 'scale_mode', 'establishment_id']);
        $tickets = DB::table('sales_orders')->where('pos_shift_id', $t->id)->whereNotNull('pos_ticket')->distinct()->count('pos_ticket');
        $ventas = (float) DB::table('sales_documents')->where('pos_shift_id', $t->id)->whereIn('doc_type', ['RECEIPT', 'INVOICE'])->where('status', 'ISSUED')->whereNotNull('pos_ticket')->sum('total');

        // De mayor a menor denominación (jsonb guarda las claves en otro orden).
        $billetes = function ($json): ?array {
            $d = json_decode((string) $json, true);
            if (! is_array($d)) {
                return null;
            }
            uksort($d, fn ($a, $b) => (float) $b <=> (float) $a);

            return $d;
        };

        return array_merge((array) $t, [
            'opening_counts' => $billetes($t->opening_counts) ?? [],
            'closing_denoms' => $t->closing_denoms ? $billetes($t->closing_denoms) : null,
            'caja' => $caja, 'esperado' => Turnos::esperado($t), 'tickets' => $tickets, 'ventas' => round($ventas, 2),
            'conteos' => DB::table('pos_shift_counts as c')->join('payment_methods as m', 'm.id', '=', 'c.payment_method_id')->where('c.shift_id', $t->id)
                ->orderBy('m.sort_order')->get(['m.code', 'm.name', 'c.expected_amount', 'c.counted_amount', 'c.difference']),
        ]);
    }

    /** POS-08: turnos por estado (CLOSED por aprobar, APPROVED, OPEN o todos), con su cajera. */
    public function index(Request $request)
    {
        $a = Access::for($request->user());
        $estado = $request->query('status', 'CLOSED');
        $filas = DB::table('pos_shifts as s')->join('pos_terminals as t', 't.id', '=', 's.terminal_id')
            ->when($a['establishments'], fn ($q) => $q->whereIn('s.establishment_id', $a['establishments']))
            ->when($estado !== 'ALL', fn ($q) => $q->where('s.status', $estado))
            ->when($request->query('cashier'), fn ($q, $c) => $q->where('s.cashier_user_id', $c))
            ->orderByDesc('s.opened_at')->limit(100)
            ->get(['s.id', 's.number', 's.status', 's.cashier_name', 's.cashier_user_id', 's.opened_at', 's.closed_at', 's.opening_float',
                's.expected_cash', 's.counted_cash', 's.difference', 's.total_difference', 's.difference_reason', 's.over_limit',
                's.closed_by_name', 's.approved_by_name', 's.approved_at', 't.name as caja']);

        return response()->json($filas);
    }

    /** Un turno con su arqueo, movimientos, cobros por medio e historial de la cajera. */
    public function show(Request $request, string $id)
    {
        $t = Turnos::visible($id, $request->user());
        $historial = DB::table('pos_shifts')->where('cashier_user_id', $t->cashier_user_id)->where('id', '<>', $t->id)->where('status', '<>', 'OPEN')
            ->orderByDesc('closed_at')->limit(10)->get(['id', 'number', 'status', 'closed_at', 'difference', 'total_difference', 'difference_reason']);

        return response()->json($this->resumen($t) + [
            'movimientos' => DB::table('pos_cash_movements')->where('shift_id', $t->id)->orderBy('moved_at')->get(),
            'historial' => $historial,
            'diferencias_cajera' => [
                'turnos' => $historial->count(),
                'suma_abs' => round($historial->sum(fn ($h) => abs((float) $h->total_difference)), 2),
            ],
        ]);
    }

    public function abrir(Request $request)
    {
        $d = $request->validate(['terminal_id' => ['required', 'uuid'], 'counts' => ['nullable', 'array']]);
        $t = Turnos::abrir($d['terminal_id'], $d['counts'] ?? [], $request->user());

        return response()->json($this->resumen($t), 201);
    }

    public function movimientos(Request $request, string $id)
    {
        $t = Turnos::visible($id, $request->user());

        return response()->json([
            'turno' => $this->resumen($t),
            'movimientos' => DB::table('pos_cash_movements')->where('shift_id', $t->id)->orderByDesc('moved_at')->get(),
        ]);
    }

    public function movimiento(Request $request, string $id)
    {
        $d = $request->validate([
            'movement_type' => ['required', 'string'], 'amount' => ['required', 'numeric'], 'reason' => ['required', 'string', 'max:255'],
            'authorizer_email' => ['nullable', 'string', 'max:160'], 'authorizer_password' => ['nullable', 'string', 'max:200'],
        ]);
        $m = Turnos::movimiento($id, $d, $request->user());

        return response()->json(['movimiento' => $m, 'turno' => $this->resumen(Turnos::turno($id))], 201);
    }

    public function cerrar(Request $request, string $id)
    {
        $d = $request->validate(['counts' => ['nullable', 'array'], 'cash_denoms' => ['nullable', 'array'], 'reason' => ['nullable', 'string', 'max:255']]);
        $t = Turnos::cerrar($id, $d, $request->user());

        return response()->json($this->resumen($t));
    }

    public function aprobar(Request $request, string $id)
    {
        $d = $request->validate(['note' => ['nullable', 'string', 'max:255']]);
        $t = Turnos::aprobar($id, $d['note'] ?? null, $request->user());

        return response()->json($this->resumen($t));
    }
}
