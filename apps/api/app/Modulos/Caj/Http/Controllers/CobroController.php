<?php

namespace App\Modulos\Caj\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Caj\Services\Base;
use App\Modulos\Caj\Services\Cobros;
use App\Modulos\Int\Services\Archivos;
use App\Support\Exportar;
use App\Support\Listado;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** CAJ-02 Registrar cobro, CAJ-03 Cobros y CAJ-04 Aplicar cobro. */
class CobroController extends Controller
{
    private function filtros(Request $request): array
    {
        return $request->validate([
            'desde' => ['nullable', 'date_format:Y-m-d'], 'hasta' => ['nullable', 'date_format:Y-m-d'], 'medio' => ['nullable', 'string', 'max:20'],
            'cuenta' => ['nullable', 'uuid'], 'marca' => ['nullable', 'uuid'], 'cobrado_por' => ['nullable', 'uuid'], 'estado' => ['nullable', 'in:CONFIRMED,REVERSED'],
            'conciliacion' => ['nullable', 'in:PENDING,MATCHED,DIFFERENCE,NOT_APPLICABLE'], 'origen' => ['nullable', 'in:CAJ,POS,DEL'], 'cliente' => ['nullable', 'uuid'], 'sin_aplicar' => ['nullable', 'in:0,1'],
        ]);
    }

    public function index(Request $request)
    {
        $f = $this->filtros($request);
        $p = Listado::de(Cobros::consulta($request->user(), $f), $request, buscar: ['p.number', 'p.reference', 'cu.full_name', 'p.pos_ticket'],
            ordenar: ['paid_at', 'amount', 'number'], porDefecto: '-paid_at');

        return response()->json(array_merge($p->toArray(), ['totales' => Cobros::totales($request->user(), $f)]));
    }

    public function opciones(Request $request)
    {
        $u = $request->user();
        $l = Base::locales($u);
        $m = Base::marcas($u);

        return response()->json([
            'medios' => Cobros::medios(), 'marcas_tarjeta' => collect(Cobros::MARCAS_TARJETA)->map(fn ($n, $k) => ['value' => $k, 'label' => $n])->values(),
            'marcas' => DB::table('brands')->where('status', 'ACTIVE')->when($m, fn ($q) => $q->whereIn('id', $m))->orderBy('name')->get(['id', 'name']),
            'locales' => DB::table('establishments')->where('status', 'ACTIVE')->when($l, fn ($q) => $q->whereIn('id', $l))->orderBy('name')->get(['id', 'name']),
            'cuentas' => DB::table('cash_accounts')->orderBy('code')->get(['id', 'code', 'name', 'account_type']),
            'cobradores' => DB::table('users')->whereIn('id', DB::table('payments')->whereNotNull('collected_by_user_id')->distinct()->select('collected_by_user_id'))
                ->orderBy('name')->get(['id', 'name']),
            'conciliacion' => Base::CONCILIACION, 'estados' => Base::ESTADOS_COBRO, 'origenes' => Base::ORIGENES,
        ]);
    }

    public function clientes(Request $request)
    {
        $id = (string) $request->query('id', '');
        if (preg_match('/^[0-9a-f-]{36}$/i', $id)) {
            return response()->json(DB::table('customers')->where('id', $id)->whereNull('merged_into_id')->get(['id', 'full_name', 'doc_type', 'doc_number', 'phone']));
        }
        $q = trim((string) $request->query('q', ''));
        if (mb_strlen($q) < 2) {
            return response()->json([]);
        }
        $patron = '%'.addcslashes(mb_strtolower($q), '%_\\').'%';

        return response()->json(DB::table('customers')->whereNull('merged_into_id')->where('status', '<>', 'INACTIVE')
            ->where(fn ($w) => $w->whereRaw("translate(lower(full_name), 'áéíóúüñ', 'aeiouun') like translate(?, 'áéíóúüñ', 'aeiouun')", [$patron])
                ->orWhere('doc_number', 'like', $patron)->orWhere('phone', 'like', $patron))
            ->orderBy('full_name')->limit(15)->get(['id', 'full_name', 'doc_type', 'doc_number', 'phone']));
    }

    public function pendientes(Request $request, string $clienteId)
    {
        return response()->json(Cobros::pendientesDe($clienteId, $request->user()));
    }

    public function store(Request $request)
    {
        $d = $request->validate([
            'customer_id' => ['required', 'uuid'], 'method' => ['required', 'string', 'max:20'], 'cash_account_id' => ['required', 'uuid'],
            'amount' => ['required', 'numeric', 'min:0.01', 'max:9999999'], 'paid_at' => ['nullable', 'string', 'max:25'], 'reference' => ['nullable', 'string', 'max:60'],
            'card_brand' => ['nullable', 'string', 'max:20'], 'card_last4' => ['nullable', 'string', 'max:4'], 'brand_id' => ['nullable', 'uuid'],
            'establishment_id' => ['nullable', 'uuid'], 'notes' => ['nullable', 'string', 'max:255'], 'to_balance' => ['nullable'],
            'applications' => ['nullable'], 'voucher' => ['nullable', 'file', 'max:'.(Archivos::maxMb() * 1024)],
        ]);
        // Con foto, el formulario llega como multipart: las aplicaciones vienen en JSON.
        if (is_string($d['applications'] ?? null)) {
            $d['applications'] = json_decode($d['applications'], true) ?: [];
        }
        $d['applications'] = is_array($d['applications'] ?? null) ? $d['applications'] : [];
        $d['to_balance'] = filter_var($d['to_balance'] ?? false, FILTER_VALIDATE_BOOLEAN);

        return response()->json(Cobros::registrar($d, $request->user(), $request->file('voucher')), 201);
    }

    public function show(Request $request, string $id)
    {
        $p = Cobros::detalle($id);
        if (! Base::enAlcance($request->user(), $p->brand_id, $p->establishment_id)) {
            abort(404, 'No se encontró el cobro.');
        }
        $p->pendientes = $p->status === 'CONFIRMED' && $p->sin_aplicar > Base::EPS ? Cobros::pendientesDe($p->customer_id, $request->user()) : null;

        return response()->json($p);
    }

    public function aplicar(Request $request, string $id)
    {
        $d = $request->validate(['applications' => ['required', 'array', 'min:1', 'max:30'], 'applications.*.order_id' => ['nullable', 'uuid'],
            'applications.*.document_id' => ['nullable', 'uuid'], 'applications.*.amount' => ['required', 'numeric', 'min:0', 'max:9999999']]);

        return response()->json(Cobros::aplicar($id, $d['applications'], $request->user()));
    }

    public function revertir(Request $request, string $id)
    {
        $d = $request->validate(['reason' => ['nullable', 'string', 'max:255']]);

        return response()->json(Cobros::revertir($id, $d['reason'] ?? null, $request->user()));
    }

    /** Enlace temporal a la foto del voucher. */
    public function voucher(Request $request, string $id)
    {
        $p = DB::table('payments')->where('id', $id)->first(['brand_id', 'establishment_id', 'voucher_file_id']);
        if (! $p || ! $p->voucher_file_id || ! Base::enAlcance($request->user(), $p->brand_id, $p->establishment_id)) {
            abort(404, 'El cobro no tiene foto del voucher.');
        }

        return response()->json(Archivos::enlace($p->voucher_file_id, $request->user()));
    }

    public function exportar(Request $request)
    {
        $f = $this->filtros($request);
        $filas = Cobros::consulta($request->user(), $f)->orderByDesc('p.paid_at')->limit(5000)->get()
            ->map(fn ($p) => [$p->number, \Carbon\CarbonImmutable::parse($p->paid_at)->setTimezone('America/Lima')->format('Y-m-d H:i'), $p->medio_nombre, $p->cuenta, $p->reference,
                $p->cliente, $p->marca, $p->cobrado_por, (float) $p->amount, (float) $p->aplicado, Base::ESTADOS_COBRO[$p->status] ?? $p->status,
                Base::CONCILIACION[$p->reconciliation_status] ?? $p->reconciliation_status]);

        return Exportar::libro('Cobros', $request->user())
            ->hoja('Cobros', columnas: [
                ['titulo' => 'Cobro', 'ancho' => 12], ['titulo' => 'Fecha y hora', 'ancho' => 17, 'tipo' => 'centro'], ['titulo' => 'Medio', 'ancho' => 18],
                ['titulo' => 'Cuenta', 'ancho' => 26], ['titulo' => 'Operación', 'ancho' => 16], ['titulo' => 'Cliente', 'ancho' => 30], ['titulo' => 'Marca', 'ancho' => 18],
                ['titulo' => 'Cobrado por', 'ancho' => 20], ['titulo' => 'Monto', 'ancho' => 12, 'tipo' => 'soles'], ['titulo' => 'Aplicado', 'ancho' => 12, 'tipo' => 'soles'],
                ['titulo' => 'Estado', 'ancho' => 12], ['titulo' => 'Conciliación', 'ancho' => 15],
            ], filas: $filas, descripcion: 'Cobros con los filtros de la lista', resumen: ['Cobros' => $filas->count(), 'Monto' => 'S/ '.number_format($filas->sum(8), 2)])
            ->descargar('cobros.xlsx');
    }
}
