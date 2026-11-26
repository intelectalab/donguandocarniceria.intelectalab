<?php

namespace App\Modulos\Cal\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Cal\Services\CalidadService as Cal;
use App\Modulos\Pro\Http\Controllers\Alcance;
use App\Modulos\Pro\Services\Comun;
use App\Support\Listado;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** CAL-08 No conformidades, CAL-09 Acciones correctivas, CAL-10 Registros sanitarios, CAL-11 Reclamos, CAL-13 Tablero y opciones. */
class NoConformidadController extends Controller
{
    use Alcance;

    public function index(Request $r)
    {
        $q = DB::table('nonconformities as n')->join('establishments as e', 'e.id', '=', 'n.establishment_id')->leftJoin('lots as l', 'l.id', '=', 'n.lot_id')
            ->leftJoin('suppliers as s', 's.id', '=', 'n.supplier_id')->leftJoin('equipment as q', 'q.id', '=', 'n.equipment_id')->leftJoin('users as u', 'u.id', '=', 'n.responsible_user_id')
            ->when($r->query('status'), fn ($x, $v) => $x->whereIn('n.status', explode(',', $v)))
            ->when($r->query('severity'), fn ($x, $v) => $x->where('n.severity', $v))
            ->when($r->query('source'), fn ($x, $v) => $x->where('n.source', $v))
            ->selectRaw("n.id, n.number, n.source, n.severity, n.description, n.status, n.detected_at, n.due_date, n.closed_at, n.root_cause, n.establishment_id,
                coalesce(e.short, e.name) as establishment_name, l.code as lot_code, coalesce(s.trade_name, s.legal_name) as supplier_name, q.code as equipment_code, u.name as responsible_name,
                (SELECT count(*) FROM corrective_actions a WHERE a.nonconformity_id = n.id) as actions,
                (SELECT count(*) FROM corrective_actions a WHERE a.nonconformity_id = n.id AND a.status = 'PENDING') as pending_actions,
                (n.status <> 'CLOSED' AND n.due_date < CURRENT_DATE) as overdue");
        $this->porLocal($q, $r, 'n.establishment_id');

        return response()->json(Listado::de(DB::query()->fromSub($q, 's'), $r, buscar: ['number', 'description', 'lot_code', 'supplier_name', 'equipment_code', 'responsible_name'],
            ordenar: ['number', 'detected_at', 'due_date', 'severity', 'status'], porDefecto: '-detected_at'));
    }

    public function show(Request $r, string $id)
    {
        $n = Cal::nc($id);
        $this->dentroDelAlcance($r, $n->establishment_id);

        return response()->json($n);
    }

    public function store(Request $r)
    {
        $d = $r->validate(['source' => 'required|in:'.implode(',', Cal::ORIGENES_NC), 'severity' => 'required|in:MINOR,MAJOR,CRITICAL', 'description' => 'required|string|max:4000',
            'establishment_id' => 'nullable|uuid', 'lot_id' => 'nullable|uuid', 'supplier_id' => 'nullable|uuid', 'equipment_id' => 'nullable|uuid', 'production_order_id' => 'nullable|uuid',
            'responsible_user_id' => 'nullable|uuid', 'due_date' => 'nullable|date']);

        return response()->json(Cal::crearNC($d, $r->user()), 201);
    }

    public function update(Request $r, string $id)
    {
        $d = $r->validate(['root_cause' => 'nullable|string|max:255', 'responsible_user_id' => 'nullable|uuid', 'due_date' => 'nullable|date', 'status' => 'nullable|in:OPEN,IN_PROGRESS,VERIFICATION']);

        return response()->json(Cal::actualizarNC($id, $d, $r->user()));
    }

    public function cerrar(Request $r, string $id)
    {
        $d = $r->validate(['root_cause' => 'nullable|string|max:255', 'closing_notes' => 'nullable|string|max:2000', 'effectiveness_verified' => 'nullable|boolean']);

        return response()->json(Cal::cerrarNC($id, $d, $r->user()));
    }

    /* CAL-09 */

    public function acciones(Request $r)
    {
        $q = DB::table('corrective_actions as a')->join('nonconformities as n', 'n.id', '=', 'a.nonconformity_id')->leftJoin('users as u', 'u.id', '=', 'a.responsible_user_id')
            ->leftJoin('users as v', 'v.id', '=', 'a.verified_by')
            ->when($r->query('status'), fn ($x, $s) => $x->whereIn('a.status', explode(',', $s)))
            ->when($r->query('action_type'), fn ($x, $s) => $x->where('a.action_type', $s))
            ->selectRaw("a.id, a.nonconformity_id, a.action_type, a.description, a.due_date, a.done_at, a.status, a.evidence_url, a.verified_at, a.notes, n.number as nc_number, n.severity,
                n.establishment_id, u.name as responsible_name, v.name as verified_by_name, (a.status = 'PENDING' AND a.due_date < CURRENT_DATE) as overdue");
        $this->porLocal($q, $r, 'n.establishment_id');

        return response()->json(Listado::de(DB::query()->fromSub($q, 's'), $r, buscar: ['description', 'nc_number', 'responsible_name'], ordenar: ['due_date', 'status', 'nc_number'], porDefecto: 'due_date'));
    }

    public function agregarAccion(Request $r, string $id)
    {
        $d = $r->validate(['action_type' => 'required|in:CORRECTION,CORRECTIVE,PREVENTIVE', 'description' => 'required|string|max:2000', 'responsible_user_id' => 'nullable|uuid', 'due_date' => 'nullable|date']);

        return response()->json(Cal::agregarAccion($id, $d, $r->user()), 201);
    }

    public function avanzarAccion(Request $r, string $id)
    {
        $d = $r->validate(['status' => 'required|in:DONE,VERIFIED,CANCELLED', 'evidence_url' => 'nullable|string|max:255', 'notes' => 'nullable|string|max:1000']);

        return response()->json(Cal::avanzarAccion($id, $d['status'], $d, $r->user()));
    }

    /* CAL-10 */

    public function sanitarios(Request $r)
    {
        $q = DB::table('products as p')->leftJoin('brands as b', 'b.id', '=', 'p.brand_id')->where('p.status', 'ACTIVE')
            ->whereNotNull('p.sanitary_authority')->where('p.sanitary_authority', '<>', 'NONE')
            ->when($r->query('authority'), fn ($x, $v) => $x->where('p.sanitary_authority', $v))
            ->orderBy('p.name')->get(['p.id', 'p.code', 'p.name', 'p.sanitary_authority', 'p.sanitary_registry', 'p.sanitary_registry_expires', 'p.sanitary_alert_days', 'p.sanitary_certificate', 'b.name as brand_name']);
        $hist = DB::table('sanitary_registrations')->whereIn('product_id', $q->pluck('id'))->orderByDesc('issued_on')->get()->groupBy('product_id');
        $hoy = Comun::hoy();
        $filas = $q->map(function ($p) use ($hist, $hoy) {
            $p->light = \App\Modulos\Cat\Services\RegistroSanitario::estado($p, $hoy);
            $p->registrations = $hist[$p->id] ?? [];

            return $p;
        });
        $texto = mb_strtolower(trim((string) $r->query('q')));
        if ($texto !== '') {
            $filas = $filas->filter(fn ($p) => str_contains(mb_strtolower($p->code.' '.$p->name.' '.$p->sanitary_registry), $texto))->values();
        }
        if ($r->query('light')) {
            $filas = $filas->filter(fn ($p) => $p->light['code'] === $r->query('light'))->values();
        }

        return response()->json(['data' => $filas->values(), 'can_manage' => $this->puede($r, 'cal.sanitary.manage')]);
    }

    public function registrarSanitario(Request $r)
    {
        $d = $r->validate(['product_id' => 'required|uuid', 'authority' => 'required|in:DIGESA,SENASA', 'registration_type' => 'nullable|in:SANITARY_REGISTRY,SANITARY_AUTHORIZATION,HEALTH_CERTIFICATE',
            'number' => 'required|string|max:60', 'issued_on' => 'required|date', 'expires_on' => 'required|date', 'file_url' => 'nullable|string|max:255',
            'establishment_id' => 'nullable|uuid', 'notes' => 'nullable|string|max:1000', 'file' => 'nullable|file|mimes:pdf,jpg,jpeg,png|max:10240']);
        if ($r->hasFile('file')) {
            $d['file_url'] = $r->file('file')->store('sanitarios/'.$d['product_id'], 'local');
        }

        return response()->json(Cal::registrarSanitario($d, $r->user()), 201);
    }

    /* CAL-11 */

    public function reclamos(Request $r)
    {
        $q = DB::table('quality_claims as q')->join('customers as c', 'c.id', '=', 'q.customer_id')->join('products as p', 'p.id', '=', 'q.product_id')
            ->leftJoin('lots as l', 'l.id', '=', 'q.lot_id')->leftJoin('sales_orders as o', 'o.id', '=', 'q.sales_order_id')->leftJoin('nonconformities as n', 'n.id', '=', 'q.nonconformity_id')
            ->when($r->query('status'), fn ($x, $v) => $x->whereIn('q.status', explode(',', $v)))
            ->when($r->query('claim_type'), fn ($x, $v) => $x->where('q.claim_type', $v))
            ->selectRaw('q.id, q.number, q.claim_type, q.status, q.received_at, q.channel, q.resolution, q.resolved_at, q.description, q.establishment_id,
                coalesce(c.trade_name, c.full_name) as customer_name, p.name as product_name, l.code as lot_code, o.number as order_number, n.number as nc_number');
        $this->porLocal($q, $r, 'q.establishment_id');

        return response()->json(Listado::de(DB::query()->fromSub($q, 's'), $r, buscar: ['number', 'customer_name', 'product_name', 'lot_code', 'order_number'],
            ordenar: ['number', 'received_at', 'status', 'claim_type'], porDefecto: '-received_at'));
    }

    public function reclamo(Request $r, string $id)
    {
        $c = Cal::reclamo($id);
        $this->dentroDelAlcance($r, $c->establishment_id);
        // Notas de crédito del cliente, para elegir la que compensa el reclamo (RN-CAL-12).
        $c->credit_notes = DB::table('sales_documents')->where('doc_type', 'CREDIT_NOTE')->where('customer_id', $c->customer_id)
            ->orderByDesc('issue_date')->limit(30)->get(['id', 'full_number', 'issue_date', 'total']);

        return response()->json($c);
    }

    public function registrarReclamo(Request $r)
    {
        $d = $r->validate(['customer_id' => 'nullable|uuid', 'sales_order_id' => 'nullable|uuid', 'sales_document_id' => 'nullable|uuid', 'lot_id' => 'nullable|uuid', 'product_id' => 'nullable|uuid',
            'claim_type' => 'required|in:'.implode(',', Cal::TIPOS_RECLAMO), 'description' => 'required|string|max:4000', 'photo_url' => 'nullable|string|max:255',
            'channel' => 'nullable|string|max:20', 'received_at' => 'nullable|date', 'brand_id' => 'nullable|uuid', 'establishment_id' => 'nullable|uuid']);

        return response()->json(Cal::registrarReclamo($d, $r->user()), 201);
    }

    public function resolverReclamo(Request $r, string $id)
    {
        $d = $r->validate(['status' => 'nullable|in:RESOLVED,REJECTED,INVESTIGATING', 'resolution' => 'nullable|in:'.implode(',', Cal::RESOLUCIONES),
            'credit_note_id' => 'nullable|uuid', 'resolution_notes' => 'nullable|string|max:2000']);

        return response()->json(Cal::resolverReclamo($id, $d, $r->user()));
    }

    /* CAL-13 */

    public function tablero(Request $r)
    {
        [$desde, $hasta] = Comun::mes($r->query('month'));

        return response()->json(Cal::kpis($desde, $hasta, $this->locales($r)) + ['overdue_points' => Cal::puntosAtrasados(null, $this->locales($r))]);
    }

    public function opciones(Request $r)
    {
        $locales = \App\Support\Access::for($r->user())['establishments'];

        return response()->json([
            'establishments' => DB::table('establishments')->where('status', 'ACTIVE')->when($locales, fn ($q) => $q->whereIn('id', $locales))->orderBy('name')->get(['id', 'name', 'short']),
            'checklists' => DB::table('qc_checklists')->where('status', 'ACTIVE')->orderBy('name')->get(['id', 'code', 'name', 'stage', 'version']),
            'schedules' => DB::table('qc_schedules')->where('status', 'ACTIVE')->when($locales, fn ($q) => $q->whereIn('establishment_id', $locales))->get(['id', 'checklist_id', 'establishment_id', 'area', 'frequency']),
            'users' => DB::table('users')->where('status', 'ACTIVE')->orderBy('name')->get(['id', 'name']),
            'roles' => DB::table('roles')->orderBy('name')->get(['code', 'name']),
            'suppliers' => DB::table('suppliers')->orderBy('legal_name')->get(['id', DB::raw('coalesce(trade_name, legal_name) as name')]),
            'equipment' => DB::table('equipment')->where('status', '<>', 'RETIRED')->orderBy('code')->get(['id', 'code', 'name', 'establishment_id']),
            'warehouses' => DB::table('warehouses')->where('status', 'ACTIVE')->orderBy('code')->get(['id', 'code', 'name', 'establishment_id']),
            'vehicles' => DB::table('vehicles')->orderBy('plate')->get(['id', 'plate']),
            'products' => DB::table('products')->where('status', 'ACTIVE')->orderBy('name')->get(['id', 'code', 'name', 'brand_id', 'sanitary_authority']),
            'brands' => DB::table('brands')->where('status', 'ACTIVE')->orderBy('name')->get(['id', 'name']),
            'customers' => DB::table('customers')->whereNull('merged_into_id')->orderByRaw('coalesce(trade_name, full_name)')->limit(500)->get(['id', DB::raw('coalesce(trade_name, full_name) as name'), 'doc_number', 'phone']),
            'stages' => Cal::ETAPAS, 'answer_types' => Cal::TIPOS_RESPUESTA, 'frequencies' => Cal::FRECUENCIAS, 'point_types' => Cal::TIPOS_PUNTO,
            'nc_sources' => Cal::ORIGENES_NC, 'claim_types' => Cal::TIPOS_RECLAMO, 'resolutions' => Cal::RESOLUCIONES,
            'min_score_pct' => \App\Support\Params::get('cal_min_checklist_score_pct') ?? 90,
            'can' => ['release' => $this->puede($r, 'cal.lot.release'), 'record' => $this->puede($r, 'cal.inspection.record'), 'close' => $this->puede($r, 'cal.nonconformity.close'),
                'sanitary' => $this->puede($r, 'cal.sanitary.manage'), 'claim' => $this->puede($r, 'cal.claim.resolve'), 'checklist' => $this->puede($r, 'cal.checklist.manage')],
        ]);
    }
}
