<?php

namespace App\Modulos\Cli\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Cli\Models\Customer;
use App\Modulos\Cli\Services\Celulares;
use App\Modulos\Cli\Services\Clientes;
use App\Modulos\Cli\Services\Documentos;
use App\Modulos\Cli\Services\Duplicados;
use App\Support\Exportar;
use App\Support\Listado;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * CLI-01 Clientes: un solo cliente para las 5 marcas, buscado por celular (como sea que se
 * escriba), nombre, documento o correo. CLI-02 Ficha. CLI-03 Alta rápida. Bloqueo y consentimiento.
 * Reglas en Services\Clientes.
 */
class ClienteController extends Controller
{
    public const VISTAS = ['ACTIVE', 'BLOCKED', 'MERGED', 'ALL'];

    public function index(Request $request)
    {
        $f = $request->validate([
            'vista' => ['nullable', Rule::in(self::VISTAS)], 'customer_type' => ['nullable', Rule::in(Clientes::TIPOS)],
            'status' => ['nullable', Rule::in(['ACTIVE', 'BLOCKED', 'INACTIVE'])], 'seller_user_id' => ['nullable', 'uuid'],
            'zone_id' => ['nullable', 'uuid'], 'brand_id' => ['nullable', 'uuid'],
        ]);
        $q = $this->consulta();
        match ($f['vista'] ?? 'ACTIVE') {
            'ACTIVE' => $q->whereNull('c.merged_into_id')->where('c.status', '<>', 'INACTIVE'),
            'BLOCKED' => $q->where('c.status', 'BLOCKED'),
            'MERGED' => $q->whereNotNull('c.merged_into_id'),
            'ALL' => $q,
        };
        $q->when($f['customer_type'] ?? null, fn ($w, $v) => $w->where('c.customer_type', $v))
            ->when($f['status'] ?? null, fn ($w, $v) => $w->where('c.status', $v))
            ->when($f['seller_user_id'] ?? null, fn ($w, $v) => $w->where('c.seller_user_id', $v))
            ->when($f['zone_id'] ?? null, fn ($w, $v) => $w->whereExists(fn ($e) => $e->from('customer_addresses as a')->whereColumn('a.customer_id', 'c.id')
                ->where(['a.is_default' => true, 'a.status' => 'ACTIVE', 'a.zone_id' => $v])))
            ->when($f['brand_id'] ?? null, fn ($w, $v) => $w->whereRaw('(select o.brand_id from sales_orders o where o.customer_id = c.id and o.status <> ? order by o.created_at desc limit 1) = ?', ['CANCELLED', $v]));

        // El celular se busca como sea que se escriba: «987 654 321» encuentra +51987654321.
        $texto = trim((string) $request->query('q', ''));
        $digitos = preg_replace('/\D/', '', $texto);
        if (strlen($digitos) >= 6 && preg_match('/^[\d\s+().-]+$/', $texto)) {
            $q->where(fn ($w) => $w->where('c.phone', 'like', "%{$digitos}%")->orWhere('c.phone_alt', 'like', "%{$digitos}%")->orWhere('c.doc_number', 'like', "%{$digitos}%"));
            $request = $request->duplicate(array_diff_key($request->query(), ['q' => 1]));
        }
        $pagina = Listado::de($q, $request, buscar: ['c.full_name', 'c.trade_name', 'c.email', 'c.doc_number', 'c.phone'],
            ordenar: ['full_name', 'phone', 'customer_type', 'status', 'pedidos', 'ultima_compra', 'created_at'], porDefecto: 'full_name');
        $pagina->getCollection()->transform(fn ($c) => $this->fila($c));

        return response()->json($pagina);
    }

    /** Cifras de cabecera y opciones de los filtros. ?mes=2026-10 para las cifras del mes (KPI-CLI-01 y 02). */
    public function resumen(Request $request)
    {
        $d = $request->validate(['mes' => ['nullable', 'date_format:Y-m']]);
        $desde = isset($d['mes']) ? Carbon::parse($d['mes'].'-01', 'America/Lima') : now('America/Lima')->startOfMonth();
        $hasta = $desde->copy()->addMonth();
        $activos = DB::table('customers')->whereNull('merged_into_id')->where('status', '<>', 'INACTIVE');

        // KPI-CLI-01: primer pedido confirmado dentro del mes.
        $nuevos = DB::table(DB::raw("(select customer_id, min(confirmed_at) as primero from sales_orders where confirmed_at is not null and status <> 'CANCELLED' group by customer_id) x"))
            ->where('primero', '>=', $desde)->where('primero', '<', $hasta)->count();
        // KPI-CLI-02: clientes con 2 o más entregas en el mes / clientes con al menos una entrega.
        $entregas = DB::table('sales_orders')->whereIn('status', ['DELIVERED', 'CLOSED'])
            ->where('delivery_date', '>=', $desde->toDateString())->where('delivery_date', '<', $hasta->toDateString())
            ->groupBy('customer_id')->selectRaw('customer_id, count(*) as n')->get();
        $recurrentes = $entregas->where('n', '>=', 2)->count();

        return response()->json([
            'mes' => $desde->format('Y-m'),
            'activos' => (clone $activos)->where('status', 'ACTIVE')->count(),
            'aceptan_publicidad' => (clone $activos)->where('marketing_opt_in', true)->count(),
            'bloqueados' => (clone $activos)->where('status', 'BLOCKED')->count(),
            'nuevos_mes' => $nuevos,
            'recurrentes' => ['valor' => $entregas->count() ? round($recurrentes / $entregas->count() * 100, 1) : 0.0, 'numerador' => $recurrentes, 'denominador' => $entregas->count()],
            'duplicados_abiertos' => DB::table('customer_duplicate_candidates')->where('status', 'OPEN')->count(),
            'opciones' => [
                'vendedoras' => DB::table('users')->whereIn('role', ['VENDEDORA', 'SUPERVISORA_VENTAS'])->where('status', 'ACTIVE')->orderBy('name')->get(['id', 'name']),
                'zonas' => DB::table('delivery_zones')->orderByRaw('coalesce(priority, 100)')->get(['id', 'code', 'name']),
                'marcas' => DB::table('brands')->orderBy('name')->get(['id', 'code', 'name']),
            ],
        ]);
    }

    /** Exportar la base (cli.customer.export): queda en la bitácora con quién y cuántas filas (Ley 29733). */
    public function exportar(Request $request)
    {
        $filas = $this->consulta()->whereNull('c.merged_into_id')->where('c.status', '<>', 'INACTIVE')->orderBy('c.full_name')->get()
            ->map(fn ($c) => [$c->full_name, $c->trade_name, $c->phone, $c->phone_alt, $c->email, $c->doc_type === 'NONE' ? '' : "{$c->doc_type} {$c->doc_number}",
                $c->customer_type, $c->zona, $c->pedidos, $c->ultima_compra ? substr($c->ultima_compra, 0, 10) : '', $c->vendedora, $c->marketing_opt_in ? 'Sí' : 'No', $c->status]);

        return Exportar::libro('Clientes', $request->user())
            ->hoja('Clientes', columnas: [
                ['titulo' => 'Nombre', 'ancho' => 32], ['titulo' => 'Nombre comercial', 'ancho' => 22], ['titulo' => 'Celular', 'ancho' => 15], ['titulo' => 'Celular alterno', 'ancho' => 15],
                ['titulo' => 'Correo', 'ancho' => 26], ['titulo' => 'Documento', 'ancho' => 16], ['titulo' => 'Tipo', 'ancho' => 14], ['titulo' => 'Zona', 'ancho' => 22],
                ['titulo' => 'Pedidos', 'ancho' => 9, 'tipo' => 'centro'], ['titulo' => 'Última compra', 'ancho' => 13], ['titulo' => 'Vendedora', 'ancho' => 20],
                ['titulo' => 'Acepta publicidad', 'ancho' => 12, 'tipo' => 'centro'], ['titulo' => 'Estado', 'ancho' => 10],
            ], filas: $filas, descripcion: 'Clientes activos y bloqueados. Datos personales: uso interno (Ley 29733).', resumen: ['Clientes' => $filas->count()])
            ->descargar('clientes.xlsx');
    }

    /** CLI-02: la ficha completa. */
    public function show(string $id)
    {
        $c = Customer::findOrFail($id);
        $pedidos = DB::table('sales_orders')->where('sales_orders.customer_id', $id)->where('sales_orders.status', '<>', 'CANCELLED');
        $entregados = (clone $pedidos)->whereIn('sales_orders.status', ['DELIVERED', 'CLOSED']);
        $totalEntregado = (float) (clone $entregados)->sum(DB::raw('coalesce(final_total, estimated_total)'));
        $nEntregados = (clone $entregados)->count();

        return response()->json($c->toArray() + [
            'nombre' => $c->nombre(),
            'vendedora' => $c->seller_user_id ? DB::table('users')->where('id', $c->seller_user_id)->value('name') : null,
            'fusionado_en' => $c->merged_into_id ? DB::table('customers')->where('id', $c->merged_into_id)->first(['id', 'full_name', 'trade_name']) : null,
            'direcciones' => DireccionController::deCliente($id),
            'duplicados' => $this->duplicados($id),
            'cifras' => [
                'pedidos' => (clone $pedidos)->count(), 'entregados' => $nEntregados, 'compras' => round($totalEntregado, 2),
                'ticket' => $nEntregados ? round($totalEntregado / $nEntregados, 2) : null,
                'saldo' => Clientes::saldo($id), 'por_cobrar' => Clientes::porCobrar($id),
            ],
            'por_marca' => (clone $pedidos)->leftJoin('brands as b', 'b.id', '=', 'sales_orders.brand_id')->groupBy('b.name')
                ->orderByRaw('count(*) desc')->selectRaw("coalesce(b.name, 'Sin marca') as nombre, count(*) as n")->get(),
            'por_canal' => (clone $pedidos)->groupBy('sales_orders.channel')->orderByRaw('count(*) desc')->selectRaw("coalesce(sales_orders.channel, 'OTHER') as canal, count(*) as n")->get(),
            'consentimientos' => DB::table('contact_consents')->where('customer_id', $id)->where('purpose', 'MARKETING')
                ->orderByDesc('recorded_at')->limit(6)->get(['id', 'granted', 'channel', 'evidence_text', 'recorded_at', 'recorded_by']),
        ]);
    }

    /** Pedidos del cliente (pestaña de la ficha), paginados. */
    public function pedidos(Request $request, string $id)
    {
        Customer::findOrFail($id);
        $q = DB::table('sales_orders as o')->where('o.customer_id', $id)->leftJoin('brands as b', 'b.id', '=', 'o.brand_id')
            ->select(['o.id', 'o.number', 'o.created_at', 'o.channel', 'o.status', 'o.fulfillment', 'o.paid_amount', 'b.name as brand_name',
                DB::raw('coalesce(o.final_total, o.estimated_total) as total')]);

        return response()->json(Listado::de($q, $request, buscar: ['o.number'], ordenar: ['number', 'created_at', 'total', 'status'], porDefecto: '-created_at'));
    }

    /** Comprobantes del cliente (pestaña de la ficha), paginados. */
    public function comprobantes(Request $request, string $id)
    {
        Customer::findOrFail($id);
        $q = DB::table('sales_documents as d')->where('d.customer_id', $id)
            ->select(['d.id', 'd.full_number', 'd.doc_type', 'd.issue_date', 'd.brand_name', 'd.total', 'd.balance', 'd.due_date', 'd.sunat_status', 'd.status']);

        return response()->json(Listado::de($q, $request, buscar: ['d.full_number'], ordenar: ['issue_date', 'total', 'balance'], porDefecto: '-issue_date'));
    }

    /** CLI-03: ¿ese celular ya es de alguien? Se pregunta mientras se escribe. */
    public function celular(Request $request)
    {
        $d = $request->validate(['phone' => ['required', 'string', 'max:40']]);
        $p = Celulares::normalizar($d['phone']);
        $c = Clientes::buscarPorCelular($d['phone']);

        return response()->json(['normalizado' => $p, 'valido' => Celulares::valido($p),
            'existente' => $c ? ['id' => $c->id, 'nombre' => $c->nombre(), 'phone' => $c->phone, 'status' => $c->status] : null]);
    }

    /** CLI-03: altas de los últimos 7 días. */
    public function recientes()
    {
        return response()->json(DB::table('customers')->where('created_at', '>=', now()->subDays(7))->whereNull('merged_into_id')
            ->orderByDesc('created_at')->limit(10)->get(['id', 'full_name', 'trade_name', 'phone', 'created_at', 'created_by']));
    }

    /** CLI-03 Alta rápida: si el celular existe, devuelve ese cliente (CA-CLI-01). */
    public function rapida(Request $request)
    {
        $d = $request->validate([
            'phone' => ['required', 'string', 'max:40'], 'full_name' => ['required', 'string', 'max:255'],
            'customer_type' => ['required', Rule::in(Clientes::TIPOS)], 'source_channel' => ['required', Rule::in(Clientes::CANALES)],
            'origin_wa_number' => ['nullable', 'string', 'max:40'], 'marketing_opt_in' => ['boolean'],
        ]);
        $r = Clientes::altaRapida($d, $request->user());

        return response()->json(['customer' => $r['customer'], 'existente' => $r['existente'], 'duplicados' => count($r['duplicados'])], $r['existente'] ? 200 : 201);
    }

    public function store(Request $request)
    {
        $r = Clientes::crear($this->validar($request), $request->user());

        return response()->json(['customer' => $r['customer'], 'duplicados' => count($r['duplicados'])], 201);
    }

    public function update(Request $request, string $id)
    {
        return response()->json(Clientes::actualizar(Customer::findOrFail($id), $this->validar($request), $request->user()));
    }

    public function bloquear(Request $request, string $id)
    {
        $d = $request->validate(['motivo' => ['required', 'string', 'max:255']]);

        return response()->json(Clientes::bloquear(Customer::findOrFail($id), $d['motivo'], $request->user()));
    }

    public function desbloquear(Request $request, string $id)
    {
        $d = $request->validate(['nota' => ['nullable', 'string', 'max:255']]);

        return response()->json(Clientes::desbloquear(Customer::findOrFail($id), $d['nota'] ?? null, $request->user()));
    }

    public function consentimiento(Request $request, string $id)
    {
        $d = $request->validate(['acepta' => ['required', 'boolean'], 'canal' => ['required', Rule::in(['WHATSAPP', 'FACEBOOK', 'INSTAGRAM', 'TIKTOK', 'WEB', 'POS', 'PHONE'])],
            'evidencia' => ['nullable', 'string', 'max:500']]);

        return response()->json(Clientes::consentimiento(Customer::findOrFail($id), $d['acepta'], $d['canal'], $d['evidencia'] ?? null, $request->user()));
    }

    /** Pares abiertos del cliente, con el otro cliente de cada par. */
    private function duplicados(string $id): array
    {
        $pares = DB::table('customer_duplicate_candidates')->where('status', 'OPEN')
            ->where(fn ($q) => $q->where('customer_id', $id)->orWhere('duplicate_of_id', $id))->get();
        $otros = DB::table('customers')->whereIn('id', $pares->map(fn ($d) => $d->customer_id === $id ? $d->duplicate_of_id : $d->customer_id))
            ->get(['id', 'full_name', 'trade_name', 'phone'])->keyBy('id');

        return $pares->map(function ($d) use ($id, $otros) {
            $o = $otros[$d->customer_id === $id ? $d->duplicate_of_id : $d->customer_id] ?? null;

            return ['id' => $d->id, 'match_reason' => $d->match_reason, 'motivo' => Duplicados::MOTIVOS[$d->match_reason] ?? $d->match_reason,
                'score' => (float) $d->score, 'otro_id' => $o?->id, 'otro_nombre' => $o ? ($o->trade_name ?: $o->full_name) : null, 'otro_phone' => $o?->phone];
        })->values()->all();
    }

    private function validar(Request $request): array
    {
        return $request->validate([
            'full_name' => ['required', 'string', 'max:255'], 'trade_name' => ['nullable', 'string', 'max:255'],
            'customer_type' => ['required', Rule::in(Clientes::TIPOS)], 'phone' => ['nullable', 'string', 'max:40'], 'phone_alt' => ['nullable', 'string', 'max:40'],
            'email' => ['nullable', 'email', 'max:255'], 'doc_type' => ['required', Rule::in(Documentos::TIPOS)], 'doc_number' => ['nullable', 'string', 'max:20'],
            'seller_user_id' => ['nullable', 'uuid', Rule::exists('users', 'id')], 'notes' => ['nullable', 'string', 'max:2000'],
            'source_channel' => ['nullable', Rule::in(Clientes::CANALES)], 'marketing_opt_in' => ['boolean'],
        ]);
    }

    /** Lista de clientes con lo que muestra la tabla de CLI-01, en una sola consulta. */
    private function consulta()
    {
        return DB::table('customers as c')
            ->leftJoin('users as u', 'u.id', '=', 'c.seller_user_id')
            ->select(['c.id', 'c.full_name', 'c.trade_name', 'c.phone', 'c.phone_alt', 'c.email', 'c.doc_type', 'c.doc_number', 'c.doc_validated_at',
                'c.doc_validation_source', 'c.customer_type', 'c.status', 'c.merged_into_id', 'c.marketing_opt_in', 'c.created_at', 'u.name as vendedora',
                DB::raw("(select z.name from customer_addresses a join delivery_zones z on z.id = a.zone_id where a.customer_id = c.id and a.is_default and a.status = 'ACTIVE' limit 1) as zona"),
                DB::raw("(select count(*) from sales_orders o where o.customer_id = c.id and o.status <> 'CANCELLED') as pedidos"),
                DB::raw("(select max(o.created_at) from sales_orders o where o.customer_id = c.id and o.status <> 'CANCELLED') as ultima_compra"),
                DB::raw("(select b.name from sales_orders o join brands b on b.id = o.brand_id where o.customer_id = c.id and o.status <> 'CANCELLED' order by o.created_at desc limit 1) as ultima_marca"),
                DB::raw("exists(select 1 from customer_duplicate_candidates d where d.status = 'OPEN' and (d.customer_id = c.id or d.duplicate_of_id = c.id)) as duplicado"),
            ]);
    }

    private function fila(object $c): object
    {
        $c->pedidos = (int) $c->pedidos;
        $c->duplicado = (bool) $c->duplicado;
        $c->marketing_opt_in = (bool) $c->marketing_opt_in;

        return $c;
    }
}
