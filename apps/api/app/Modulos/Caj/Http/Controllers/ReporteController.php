<?php

namespace App\Modulos\Caj\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Caj\Services\Base;
use App\Modulos\Caj\Services\Cierre;
use App\Modulos\Caj\Services\Cobranzas;
use App\Modulos\Caj\Services\Mensajes;
use App\Modulos\Caj\Services\Traslados;
use App\Support\Exportar;
use App\Support\Listado;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** CAJ-05 Mensaje de pago, CAJ-11 Cuentas por cobrar, CAJ-12 Traslados y CAJ-13 Cierre diario. */
class ReporteController extends Controller
{
    /* ---------- CAJ-05 ---------- */

    public function mensajeOpciones(Request $request)
    {
        $d = $request->validate(['brand_id' => ['nullable', 'uuid'], 'order_id' => ['nullable', 'uuid']]);
        $marca = $d['brand_id'] ?? (! empty($d['order_id']) ? DB::table('sales_orders')->where('id', $d['order_id'])->value('brand_id') : null);

        return response()->json(['medios' => Mensajes::opciones($marca)]);
    }

    public function pedidos(Request $request)
    {
        $q = trim((string) $request->query('q', ''));
        $base = Base::alcance(DB::table('sales_orders as p'), $request->user())->join('customers as c', 'c.id', '=', 'p.customer_id')
            ->whereNotIn('p.status', ['CANCELLED', 'DRAFT'])->whereRaw('coalesce(p.final_total, p.estimated_total) - p.paid_amount > 0.005');
        if ($q !== '') {
            $patron = '%'.addcslashes(mb_strtolower($q), '%_\\').'%';
            $base->where(fn ($w) => $w->whereRaw('lower(p.number) like ?', [$patron])
                ->orWhereRaw("translate(lower(c.full_name), 'áéíóúüñ', 'aeiouun') like translate(?, 'áéíóúüñ', 'aeiouun')", [$patron])->orWhere('c.phone', 'like', $patron));
        }

        return response()->json($base->orderByDesc('p.created_at')->limit(20)->get(['p.id', 'p.number', 'p.status', 'p.delivery_date', 'p.brand_id', 'c.full_name as cliente',
            DB::raw('round(coalesce(p.final_total, p.estimated_total) - p.paid_amount, 2) as pendiente')]));
    }

    public function mensaje(Request $request)
    {
        $d = $request->validate(['order_id' => ['nullable', 'uuid'], 'customer_id' => ['nullable', 'uuid'], 'brand_id' => ['nullable', 'uuid'],
            'amount' => ['nullable', 'numeric', 'min:0', 'max:999999'], 'method' => ['required', 'string', 'max:20'], 'cash_account_id' => ['nullable', 'uuid']]);

        return response()->json(Mensajes::armar($d, $request->user()));
    }

    /* ---------- CAJ-11 ---------- */

    private function filtrosCxc(Request $request): array
    {
        return $request->validate(['cliente' => ['nullable', 'uuid'], 'marca' => ['nullable', 'uuid'], 'tramo' => ['nullable', 'in:0-30,31-60,60+'], 'vencidos' => ['nullable', 'in:0,1']]);
    }

    public function cxc(Request $request)
    {
        $f = $this->filtrosCxc($request);
        $p = Listado::de(Cobranzas::consulta($request->user(), $f), $request, buscar: ['p.full_number', 'c.full_name', 'c.doc_number'],
            ordenar: ['issue_date', 'due_date', 'balance', 'dias'], porDefecto: 'issue_date');

        return response()->json(array_merge($p->toArray(), ['resumen' => Cobranzas::resumen($request->user(), $f)]));
    }

    public function cxcExportar(Request $request)
    {
        $f = $this->filtrosCxc($request);
        $filas = Cobranzas::consulta($request->user(), $f)->orderBy('c.full_name')->orderBy('p.issue_date')->limit(5000)->get()
            ->map(fn ($d) => [$d->cliente, $d->cliente_doc, $d->full_number, $d->marca, $d->issue_date, $d->due_date, (int) $d->dias, Cobranzas::TRAMOS[$d->tramo] ?? $d->tramo,
                (float) $d->total, (float) $d->balance, (int) $d->dias_vencido > 0 ? (int) $d->dias_vencido : null]);

        return Exportar::libro('Cuentas por cobrar', $request->user())
            ->hoja('Por cobrar', columnas: [
                ['titulo' => 'Cliente', 'ancho' => 32], ['titulo' => 'Documento', 'ancho' => 14], ['titulo' => 'Comprobante', 'ancho' => 15], ['titulo' => 'Marca', 'ancho' => 18],
                ['titulo' => 'Emisión', 'ancho' => 12, 'tipo' => 'fecha'], ['titulo' => 'Vence', 'ancho' => 12, 'tipo' => 'fecha'], ['titulo' => 'Días', 'ancho' => 8, 'tipo' => 'numero'],
                ['titulo' => 'Antigüedad', 'ancho' => 15], ['titulo' => 'Total', 'ancho' => 12, 'tipo' => 'soles'], ['titulo' => 'Saldo', 'ancho' => 12, 'tipo' => 'soles'],
                ['titulo' => 'Días vencido', 'ancho' => 12, 'tipo' => 'numero'],
            ], filas: $filas, descripcion: 'Comprobantes con saldo (total − notas de crédito − cobros aplicados)',
                resumen: ['Comprobantes' => $filas->count(), 'Saldo' => 'S/ '.number_format($filas->sum(9), 2)])
            ->descargar('cuentas-por-cobrar.xlsx');
    }

    /* ---------- CAJ-12 ---------- */

    public function traslados(Request $request)
    {
        $f = $request->validate(['desde' => ['nullable', 'date_format:Y-m-d'], 'hasta' => ['nullable', 'date_format:Y-m-d'], 'cuenta' => ['nullable', 'uuid'],
            'tipo' => ['nullable', 'in:LIQUIDACION,ABONO,MANUAL']]);
        $p = Listado::de(Traslados::consulta($request->user(), $f), $request, buscar: ['t.reference', 't.reason', 'a.name', 'b.name'],
            ordenar: ['transferred_at', 'amount'], porDefecto: '-transferred_at');
        $l = Base::locales($request->user());

        return response()->json(array_merge($p->toArray(), ['cuentas' => DB::table('cash_accounts')->where('status', 'ACTIVE')->where('account_type', '<>', 'DRIVER_CASH')
            ->when($l, fn ($q) => $q->where(fn ($w) => $w->whereNull('establishment_id')->orWhereIn('establishment_id', $l)))
            ->orderBy('code')->get(['id', 'code', 'name', 'account_type'])]));
    }

    public function trasladar(Request $request)
    {
        $d = $request->validate(['from_account_id' => ['required', 'uuid'], 'to_account_id' => ['required', 'uuid'], 'amount' => ['required', 'numeric', 'min:0.01', 'max:99999999'],
            'reference' => ['required', 'string', 'max:40'], 'reason' => ['required', 'string', 'max:255'], 'date' => ['nullable', 'date_format:Y-m-d']]);

        return response()->json(Traslados::crear($d, $request->user()), 201);
    }

    /* ---------- CAJ-13 ---------- */

    public function cierre(Request $request)
    {
        $d = $request->validate(['fecha' => ['nullable', 'date_format:Y-m-d'], 'establishment_id' => ['nullable', 'uuid']]);

        return response()->json(Cierre::delDia($d['fecha'] ?? Base::hoy(), $request->user(), $d['establishment_id'] ?? null));
    }
}
