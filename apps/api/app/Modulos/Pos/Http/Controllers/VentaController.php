<?php

namespace App\Modulos\Pos\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Cli\Services\Celulares;
use App\Modulos\Pos\Services\Cajas;
use App\Modulos\Pos\Services\Comprobantes;
use App\Modulos\Pos\Services\Mostrador;
use App\Modulos\Pos\Services\Ose;
use App\Modulos\Pos\Services\Turnos;
use App\Support\Access;
use App\Support\Correo;
use App\Support\Logos;
use App\Support\RuleError;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * POS-02 Venta, POS-03 Ingreso de peso, POS-04 Cobro, POS-05 Comprobante y POS-10 Ventas del turno.
 * Reglas en Services\Mostrador, Cobros, Comprobantes y Ose.
 */
class VentaController extends Controller
{
    /** La caja de la venta: la de mi turno abierto o la elegida (para consultar sin turno). */
    private function caja(Request $request): object
    {
        $u = $request->user();
        $t = Turnos::abiertoDe($u);
        if ($t) {
            return Cajas::caja($t->terminal_id);
        }
        if ($id = $request->input('terminal_id', $request->query('terminal_id'))) {
            return Cajas::caja($id, $u);
        }
        $c = Cajas::visibles($u, true)->first();
        if (! $c) {
            RuleError::fail('RN-POS-01', 'No hay cajas registradoras activas en tu local: créalas en Cajas registradoras.');
        }

        return Cajas::caja($c->id);
    }

    /** POS-02: productos con precio de la caja y stock del almacén de la caja. */
    public function productos(Request $request)
    {
        $caja = $this->caja($request);

        return response()->json([
            'caja' => ['id' => $caja->id, 'name' => $caja->name, 'scale_mode' => $caja->scale_mode,
                'almacen' => DB::table('warehouses')->where('id', $caja->warehouse_id)->value('name')],
            'productos' => Mostrador::productos($caja, $request->user(), $request->query('q'), $request->query('linea'), $request->boolean('con_stock')),
        ]);
    }

    /** Lector: código de barras, SKU o etiqueta de balanza. */
    public function codigo(Request $request)
    {
        $d = $request->validate(['code' => ['required', 'string', 'max:40'], 'variant_id' => ['nullable', 'uuid']]);
        $c = preg_replace('/\s+/', '', $d['code']);
        $caja = $this->caja($request);
        if (preg_match('/^2\d{12}$/', $c)) {
            $e = Mostrador::etiqueta($c, $d['variant_id'] ?? null);
            $p = Mostrador::productos($caja, $request->user())->firstWhere('id', $e['variant_id']);

            return response()->json(['tipo' => 'ETIQUETA', 'etiqueta' => $e, 'producto' => $p]);
        }
        if ($d['variant_id'] ?? null) {
            RuleError::fail('RN-POS-06', "«{$c}» no es una etiqueta de balanza (EAN-13 que empieza con 2).");
        }
        $v = DB::table('product_variants')->where('status', 'ACTIVE')->where('sellable', true)
            ->where(fn ($q) => $q->where('barcode', $c)->orWhereRaw('upper(sku) = ?', [mb_strtoupper($c)]))->first(['id']);
        if (! $v) {
            RuleError::fail('RN-PED-02', "No se reconoce el código {$c}: búscalo por nombre (no existe el producto libre).");
        }
        $p = Mostrador::productos($caja, $request->user())->firstWhere('id', $v->id);
        if (! $p) {
            RuleError::fail('RN-PED-02', 'Ese producto no se vende en tu alcance.');
        }

        return response()->json(['tipo' => 'PRODUCTO', 'producto' => $p]);
    }

    /** POS-03: valida el peso digitado para una variante (RN-POS-04). */
    public function peso(Request $request)
    {
        $d = $request->validate(['variant_id' => ['required', 'uuid'], 'weight_kg' => ['required'], 'qty' => ['nullable', 'integer', 'min:1'], 'override' => ['nullable', 'boolean']]);
        $v = DB::table('product_variants')->where('id', $d['variant_id'])->first() ?? abort(404, 'Producto no encontrado.');
        $w = Mostrador::validarPeso($v, $d['weight_kg'], (int) ($d['qty'] ?? 1), (bool) ($d['override'] ?? false), $request->user());

        return response()->json(['weight_kg' => number_format($w, 3, '.', '')]);
    }

    /** Carrito con precios y totales por marca, sin guardar nada. */
    public function cotizar(Request $request)
    {
        $d = $request->validate(['lines' => ['required', 'array', 'min:1', 'max:80']]);

        return response()->json(Mostrador::cotizar($this->caja($request), $d['lines'], $request->user()));
    }

    /** POS-04: cobra y emite. */
    public function vender(Request $request)
    {
        $d = $request->validate([
            'lines' => ['required', 'array', 'min:1', 'max:80'], 'payments' => ['required', 'array', 'max:8'],
            'customer_id' => ['nullable', 'uuid'], 'doc_type' => ['nullable', 'in:RECEIPT,INVOICE'], 'shift_id' => ['nullable', 'uuid'],
        ]);

        return response()->json(Mostrador::vender($d, $request->user()), 201);
    }

    /** Clientes para identificar la venta: por celular, documento o nombre. */
    public function clientes(Request $request)
    {
        $q = trim((string) $request->query('q', ''));
        if (mb_strlen($q) < 3) {
            return response()->json([]);
        }
        $dig = preg_replace('/\D/', '', $q);
        $cel = Celulares::normalizar($q);
        $filas = DB::table('customers')->whereNull('merged_into_id')->where('customer_type', '<>', 'OTHER')
            ->where(function ($w) use ($q, $dig, $cel) {
                $w->whereRaw("translate(lower(full_name), 'áéíóúüñ', 'aeiouun') like translate(?, 'áéíóúüñ', 'aeiouun')", ['%'.mb_strtolower($q).'%'])
                    ->orWhereRaw("translate(lower(coalesce(trade_name, '')), 'áéíóúüñ', 'aeiouun') like translate(?, 'áéíóúüñ', 'aeiouun')", ['%'.mb_strtolower($q).'%']);
                if (strlen($dig) >= 6) {
                    $w->orWhere('doc_number', 'like', "{$dig}%")->orWhere('phone', 'like', '%'.($cel ?: $dig).'%');
                }
            })->orderBy('full_name')->limit(15)
            ->get(['id', 'full_name', 'trade_name', 'doc_type', 'doc_number', 'phone', 'email', 'status', 'customer_type']);

        return response()->json($filas->map(fn ($c) => (array) $c + ['saldo' => \App\Modulos\Cli\Services\Clientes::saldo($c->id)]));
    }

    /** POS-05: el comprobante para el ticket. */
    public function comprobante(Request $request, string $id)
    {
        return response()->json(Comprobantes::detalle($this->doc($request, $id)));
    }

    /** Los comprobantes de un ticket (una venta con varias marcas tiene uno por marca). */
    public function ticket(Request $request, string $ticket)
    {
        $a = Access::for($request->user());
        $ids = DB::table('sales_documents')->where('pos_ticket', $ticket)->whereIn('doc_type', ['RECEIPT', 'INVOICE'])
            ->when($a['establishments'], fn ($q) => $q->whereIn('establishment_id', $a['establishments']))->orderBy('full_number')->pluck('id');
        if ($ids->isEmpty()) {
            abort(404, 'Ticket no encontrado.');
        }

        return response()->json($ids->map(fn ($id) => Comprobantes::detalle(DB::table('sales_documents')->where('id', $id)->first()))->all());
    }

    private function doc(Request $request, string $id): object
    {
        $d = DB::table('sales_documents')->where('id', $id)->first();
        if (! $d || ! $d->pos_terminal_id || ! Cajas::enAlcance($d->establishment_id, $request->user())) {
            abort(404, 'Comprobante no encontrado.');
        }

        return $d;
    }

    /** RN-POS-12: vuelve a enviar al OSE un comprobante en la cola de reintentos. */
    public function reenviar(Request $request, string $id)
    {
        $d = $this->doc($request, $id);
        if ($d->sunat_status !== 'PENDING') {
            RuleError::fail('RN-FAC-06', "El comprobante {$d->full_number} ya fue enviado.");
        }
        Ose::enviar($d->id);

        return response()->json(Comprobantes::detalle(DB::table('sales_documents')->where('id', $id)->first()));
    }

    /** POS-05: envía el comprobante por correo. */
    public function correo(Request $request, string $id)
    {
        $v = $request->validate(['email' => ['required', 'email:rfc', 'max:160']]);
        $x = Comprobantes::detalle($this->doc($request, $id));
        $d = $x['documento'];
        $parrafos = ["{$x['tipo']} electrónica {$d->full_number} de {$d->brand_name}, emitida el ".date('d/m/Y', strtotime($d->issue_date)).'.'];
        foreach ($x['lineas'] as $l) {
            $parrafos[] = "{$l->description}: ".rtrim(rtrim(number_format((float) $l->qty, 3, ',', ' '), '0'), ',').($l->uom_code === 'KGM' ? ' kg' : ' u').' × S/ '.number_format((float) $l->unit_price, 2).' = S/ '.number_format((float) $l->total, 2);
        }
        $parrafos[] = 'Op. gravada S/ '.number_format((float) $d->subtotal, 2).' · IGV S/ '.number_format((float) $d->igv, 2).' · Total S/ '.number_format((float) $d->total, 2);
        Correo::enviar($v['email'], "{$x['tipo']} {$d->full_number} · {$d->brand_name}", [
            'titulo' => "{$x['tipo']} {$d->full_number}", 'saludo' => "Hola {$d->customer_name}:", 'parrafos' => $parrafos,
            'nota' => $x['empresa'] ? "{$x['empresa']['razon_social']} · RUC {$x['empresa']['ruc']}" : null,
        ]);

        return response()->json(['ok' => true]);
    }

    /** Logo de la marca para el ticket (no exige el módulo de marcas). */
    public function logo(string $id)
    {
        $m = DB::table('brands')->where('id', $id)->first(['logo_url']) ?? abort(404);

        return Logos::servir('marcas', $m->logo_url);
    }

    /** POS-10: tickets del turno (o de mi turno abierto) con medio, comprobante y estado SUNAT. */
    public function ventasDelTurno(Request $request)
    {
        $u = $request->user();
        $turno = $request->query('shift_id') ? Turnos::visible($request->query('shift_id'), $u) : Turnos::abiertoDe($u);
        $a = Access::for($u);
        $turnos = DB::table('pos_shifts as s')->join('pos_terminals as t', 't.id', '=', 's.terminal_id')
            ->when($a['establishments'], fn ($q) => $q->whereIn('s.establishment_id', $a['establishments']))
            ->when(! Access::can($u, 'pos.shift.approve'), fn ($q) => $q->where('s.cashier_user_id', $u->id))
            ->orderByDesc('s.opened_at')->limit(30)->get(['s.id', 's.number', 's.status', 's.cashier_name', 's.opened_at', 't.name as caja']);
        if (! $turno) {
            return response()->json(['turno' => null, 'turnos' => $turnos, 'filas' => [], 'cifras' => null]);
        }
        if (! Access::can($u, 'pos.shift.approve') && $turno->cashier_user_id !== $u->id) {
            abort(404, 'Turno no encontrado.');
        }
        $docs = DB::table('sales_documents as d')->leftJoin('pos_shifts as s', 's.id', '=', 'd.pos_shift_id')
            ->where('d.pos_shift_id', $turno->id)->orderByDesc('d.issued_at')
            ->get(['d.id', 'd.full_number', 'd.doc_type', 'd.pos_ticket', 'd.customer_name', 'd.brand_name', 'd.total', 'd.sunat_status', 'd.sunat_message',
                'd.issued_at', 'd.status', 'd.related_document_id', 'd.send_attempts', 'd.needs_review', 'd.order_id']);
        $medios = DB::table('payment_allocations as a')->join('payments as p', 'p.id', '=', 'a.payment_id')->join('payment_methods as m', 'm.id', '=', 'p.payment_method_id')
            ->whereIn('a.document_id', $docs->pluck('id'))->where('p.status', 'CONFIRMED')
            ->get(['a.document_id', 'm.name'])->groupBy('document_id')->map(fn ($g) => $g->pluck('name')->unique()->implode(' + '));
        $saldo = DB::table('customer_balance_movements')->whereIn('order_id', $docs->pluck('order_id')->filter())->where('movement_type', 'APPLIED')->pluck('order_id')->flip();
        $filas = $docs->map(fn ($d) => (array) $d + ['medio' => trim(($medios[$d->id] ?? '').(isset($saldo[$d->order_id]) && $d->doc_type !== 'CREDIT_NOTE' ? ' + Saldo a favor' : ''), ' +') ?: null]);
        $ventas = $docs->whereIn('doc_type', ['RECEIPT', 'INVOICE'])->where('status', 'ISSUED');
        $tickets = $ventas->pluck('pos_ticket')->filter()->unique()->count();

        return response()->json([
            'turno' => ['id' => $turno->id, 'number' => $turno->number, 'status' => $turno->status, 'cashier_name' => $turno->cashier_name, 'opened_at' => $turno->opened_at],
            'turnos' => $turnos, 'filas' => $filas,
            'cifras' => [
                'tickets' => $tickets, 'ventas' => round((float) $ventas->sum('total'), 2),
                'promedio' => $tickets ? round((float) $ventas->sum('total') / $tickets, 2) : 0,
                'notas' => round((float) $docs->where('doc_type', 'CREDIT_NOTE')->sum('total'), 2),
                'pendientes' => $docs->where('sunat_status', 'PENDING')->count(),
            ],
        ]);
    }
}
