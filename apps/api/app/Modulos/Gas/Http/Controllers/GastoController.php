<?php

namespace App\Modulos\Gas\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Gas\Services\Aprobaciones;
use App\Modulos\Gas\Services\Base;
use App\Modulos\Gas\Services\Gastos;
use App\Modulos\Gas\Services\Pagos;
use App\Modulos\Gas\Services\Reparto;
use App\Modulos\Int\Services\Archivos;
use App\Support\Access;
use App\Support\Listado;
use App\Support\RuleError;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Http\UploadedFile;
use Illuminate\Validation\Rule;

/** GAS-01 Registrar, GAS-02 Mis gastos, GAS-03 Aprobación, GAS-04 Por pagar y pagados y GAS-10 Reparto. */
class GastoController extends Controller
{
    private const CAMPOS = ['establishment_id', 'brand_id', 'cost_center_id', 'category_id', 'doc_type', 'doc_series', 'doc_number', 'issue_date', 'currency',
        'total', 'igv', 'other_taxes', 'description', 'pay_source', 'supplier_doc', 'supplier_name', 'supplier_id', 'vehicle_id', 'route_id', 'employee_id',
        'fuel_gallons', 'fuel_voucher_no', 'odometer_km', 'ad_campaign_id', 'sales_channel'];

    private function datos(Request $request): array
    {
        $request->validate([
            'establishment_id' => ['nullable', 'uuid'], 'brand_id' => ['nullable', 'uuid'], 'cost_center_id' => ['nullable', 'uuid'], 'category_id' => ['nullable', 'uuid'],
            'supplier_id' => ['nullable', 'uuid'], 'vehicle_id' => ['nullable', 'uuid'], 'route_id' => ['nullable', 'uuid'], 'employee_id' => ['nullable', 'uuid'],
            'ad_campaign_id' => ['nullable', 'uuid'], 'issue_date' => ['nullable', 'date_format:Y-m-d'], 'description' => ['nullable', 'string', 'max:2000'],
            'doc_series' => ['nullable', 'string', 'max:20'], 'doc_number' => ['nullable', 'string', 'max:20'], 'supplier_doc' => ['nullable', 'string', 'max:15'],
            'supplier_name' => ['nullable', 'string', 'max:160'], 'fuel_voucher_no' => ['nullable', 'string', 'max:20'],
            'foto' => ['nullable', 'file', 'max:20480'], 'foto_data' => ['nullable', 'string', 'max:15000000'],
        ]);

        return array_map(fn ($v) => is_string($v) ? trim($v) : $v, $request->only(self::CAMPOS));
    }

    private function foto(Request $request): UploadedFile|string|null
    {
        $f = $request->file('foto');
        if ($f instanceof UploadedFile) {
            return $f;
        }
        $d = $request->input('foto_data');

        return is_string($d) && $d !== '' ? $d : null;
    }

    public function opciones(Request $request)
    {
        return response()->json(Gastos::opciones($request->user()));
    }

    public function proveedor(Request $request, string $ruc)
    {
        return response()->json(Gastos::proveedor($ruc));
    }

    /** Listas: mios (GAS-02), todos, pagar y pagados (GAS-04). */
    public function index(Request $request)
    {
        $u = $request->user();
        $f = $request->validate([
            'vista' => ['nullable', Rule::in(['mios', 'todos', 'pagar', 'pagados'])], 'estado' => ['nullable', Rule::in(array_keys(Base::ESTADOS))],
            'categoria' => ['nullable', 'uuid'], 'local' => ['nullable', 'uuid'], 'desde' => ['nullable', 'date_format:Y-m-d'], 'hasta' => ['nullable', 'date_format:Y-m-d'],
            'origen' => ['nullable', Rule::in(['PAYABLE', 'PETTY'])], 'abiertos' => ['nullable', 'boolean'],
        ]);
        $vista = $f['vista'] ?? 'mios';
        $q = Gastos::consulta();
        if ($vista === 'mios') {
            $q->where('e.created_by', $u->id);
        } else {
            if (in_array($vista, ['pagar', 'pagados'], true) ? ! (Pagos::puede($u) || Access::can($u, 'gas.expense.view_all')) : ! Base::veTodo($u)) {
                abort(403, 'Tu rol no ve esta lista.');
            }
            Base::alcance($q, $u);
            if ($vista === 'pagar') {
                $q->where('e.status', 'APPROVED')->where('e.pay_source', 'PAYABLE');
            } elseif ($vista === 'pagados') {
                $q->where('e.status', 'PAID');
            }
        }
        $q->when($f['estado'] ?? null, fn ($w, $v) => $w->where('e.status', $v))
            ->when($f['categoria'] ?? null, fn ($w, $v) => $w->where('e.category_id', $v))
            ->when($f['local'] ?? null, fn ($w, $v) => $w->where('e.establishment_id', $v))
            ->when($f['desde'] ?? null, fn ($w, $v) => $w->where('e.issue_date', '>=', $v))
            ->when($f['hasta'] ?? null, fn ($w, $v) => $w->where('e.issue_date', '<=', $v))
            ->when($f['origen'] ?? null, fn ($w, $v) => $w->where('e.pay_source', $v))
            ->when(! empty($f['abiertos']), fn ($w) => $w->whereIn('e.status', ['DRAFT', 'SUBMITTED', 'REJECTED']));   // GAS-10: los que aún se pueden repartir
        $resumen = (clone $q)->reorder()->select(DB::raw('count(*) AS n, coalesce(sum(e.amount_pen), 0) AS total'))->first();
        $p = Listado::de($q, $request, buscar: ['e.number', 'e.description', 'e.doc_number', 'e.supplier_name', 's.legal_name', 'c.name'],
            ordenar: ['issue_date', 'number', 'amount_pen', 'status', 'created_at', 'approved_at', 'paid_at'], porDefecto: $vista === 'pagar' ? 'approved_at' : '-created_at');
        $p->getCollection()->transform(fn ($g) => Gastos::aLista($g));

        return response()->json($p->toArray() + ['resumen' => ['n' => (int) $resumen->n, 'total' => Base::r($resumen->total)]]);
    }

    public function store(Request $request)
    {
        $d = $this->datos($request);
        $g = Gastos::guardar($d, $this->foto($request), $request->user(), null, $request->boolean('enviar'));

        return response()->json(Gastos::ficha($g->id, $request->user()), 201);
    }

    public function update(Request $request, string $id)
    {
        $d = $this->datos($request);
        $g = Gastos::guardar($d, $this->foto($request), $request->user(), $id, $request->boolean('enviar'));

        return response()->json(Gastos::ficha($g->id, $request->user()));
    }

    public function show(Request $request, string $id)
    {
        return response()->json(Gastos::ficha($id, $request->user()));
    }

    public function enviar(Request $request, string $id)
    {
        Gastos::enviar($id, $request->user());

        return response()->json(Gastos::ficha($id, $request->user()));
    }

    public function corregir(Request $request, string $id)
    {
        $d = $this->datos($request);
        Gastos::corregir($id, $d, $this->foto($request), $request->user());

        return response()->json(Gastos::ficha($id, $request->user()));
    }

    public function anular(Request $request, string $id)
    {
        $d = $request->validate(['motivo' => ['required', 'string', 'max:255']]);
        Gastos::anular($id, $d['motivo'], $request->user());

        return response()->json(Gastos::ficha($id, $request->user()));
    }

    /** Enlace temporal a la foto del comprobante (solo si ve el gasto). */
    public function foto_(Request $request, string $id)
    {
        $g = Gastos::visible($id, $request->user());
        if (! $g->receipt_file_id) {
            RuleError::fail('RN-GAS-01', 'Este gasto no tiene foto del comprobante.');
        }

        return response()->json(Archivos::enlace($g->receipt_file_id, $request->user()));
    }

    public function bandeja(Request $request)
    {
        $q = Aprobaciones::bandeja($request->user());
        $resumen = (clone $q)->reorder()->select(DB::raw('count(*) AS n, coalesce(sum(e.amount_pen), 0) AS total'))->first();
        $p = Listado::de($q, $request, buscar: ['e.number', 'e.description', 'e.supplier_name', 'c.name', 'u.name'],
            ordenar: ['submitted_at', 'amount_pen', 'issue_date', 'number'], porDefecto: 'submitted_at');
        $p->getCollection()->transform(fn ($g) => Gastos::aLista($g));

        return response()->json($p->toArray() + ['resumen' => ['n' => (int) $resumen->n, 'total' => Base::r($resumen->total)], 'nivel' => Base::nivel($request->user())]);
    }

    public function aprobar(Request $request, string $id)
    {
        $d = $request->validate(['comentario' => ['nullable', 'string', 'max:1000']]);
        Aprobaciones::aprobar($id, $d['comentario'] ?? null, $request->user());

        return response()->json(Gastos::ficha($id, $request->user()));
    }

    public function rechazar(Request $request, string $id)
    {
        $d = $request->validate(['comentario' => ['required', 'string', 'max:1000']]);
        Aprobaciones::rechazar($id, $d['comentario'], $request->user());

        return response()->json(Gastos::ficha($id, $request->user()));
    }

    public function cuentas()
    {
        return response()->json(Pagos::cuentas());
    }

    public function pagar(Request $request, string $id)
    {
        $d = $request->validate(['cash_account_id' => ['required', 'uuid'], 'referencia' => ['nullable', 'string', 'max:40'], 'fecha' => ['nullable', 'date_format:Y-m-d']]);
        Pagos::pagar($id, $d['cash_account_id'], $d['referencia'] ?? null, $request->user(), $d['fecha'] ?? null);

        return response()->json(Gastos::ficha($id, $request->user()));
    }

    public function revertir(Request $request, string $id)
    {
        $d = $request->validate(['motivo' => ['required', 'string', 'max:255']]);
        Pagos::revertir($id, $d['motivo'], $request->user());

        return response()->json(Gastos::ficha($id, $request->user()));
    }

    public function reparto(Request $request, string $id)
    {
        Gastos::visible($id, $request->user());

        return response()->json(Reparto::lineas($id));
    }

    public function repartir(Request $request, string $id)
    {
        $d = $request->validate(['lineas' => ['present', 'array', 'max:30'], 'lineas.*.cost_center_id' => ['required', 'uuid'], 'lineas.*.brand_id' => ['required', 'uuid'],
            'lineas.*.sales_channel' => ['nullable', 'string', 'max:20'], 'lineas.*.pct' => ['required', 'numeric']]);
        Reparto::guardar($id, $d['lineas'], $request->user());

        return response()->json(Gastos::ficha($id, $request->user()));
    }
}
