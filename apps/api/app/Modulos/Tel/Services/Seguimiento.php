<?php

namespace App\Modulos\Tel\Services;

use App\Models\User;
use App\Support\Access;
use App\Support\Paginas;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * TEL-08 Historial de llamadas, TEL-09 Llamadas perdidas y TEL-11 Panel de supervisión (RN-TEL-07; KPI-TEL-01 a 07).
 *
 * La vendedora ve sus llamadas y sus tareas de devolver; la supervisión y la gerencia, todas las de sus marcas, y el
 * panel: en vivo, del día por vendedora y el costo de telefonía del mes en soles, también por pedido.
 */
class Seguimiento
{
    private static function llamadas(User $u)
    {
        $marcas = Access::for($u)['brands'];
        $q = DB::table('tel_calls as c')->when($marcas, fn ($w) => $w->whereIn('c.brand_id', $marcas));

        return Access::can($u, 'tel.call.view_all') ? $q : $q->where('c.user_id', $u->id);
    }

    private static function marcas(User $u): array
    {
        $ok = Access::for($u)['brands'];

        return DB::table('brands')->when($ok, fn ($w) => $w->whereIn('id', $ok))->where('status', 'ACTIVE')->orderBy('name')
            ->get(['id', 'name'])->map(fn ($b) => ['value' => $b->id, 'label' => $b->name])->all();
    }

    private static function personas(User $u, $sub): array
    {
        return Access::can($u, 'tel.call.view_all') ? DB::table('users as x')->whereIn('x.id', $sub)->orderBy('x.name')->get(['x.id', 'x.name'])
            ->map(fn ($x) => ['value' => $x->id, 'label' => $x->name])->all() : [];
    }

    /* ------------------------------------------------------------------ TEL-08 Historial */

    public static function historial(array $f, User $u): array
    {
        $q = self::llamadas($u)->leftJoin('customers as cu', 'cu.id', '=', 'c.customer_id')->leftJoin('leads as l', 'l.id', '=', 'c.lead_id')
            ->leftJoin('users as x', 'x.id', '=', 'c.user_id')->leftJoin('brands as b', 'b.id', '=', 'c.brand_id')->leftJoin('sales_orders as o', 'o.id', '=', 'c.order_id')
            ->leftJoin('tel_recordings as r', 'r.call_id', '=', 'c.id');
        foreach (['direccion' => 'c.direction', 'estado' => 'c.status', 'vendedora' => 'c.user_id', 'marca' => 'c.brand_id'] as $k => $col) {
            if (! empty($f[$k])) {
                $q->where($col, $f[$k]);
            }
        }
        if (($f['grabacion'] ?? '') !== '') {
            $f['grabacion'] === '1' ? $q->whereNotNull('r.id') : $q->whereNull('r.id');
        }
        if (($f['pedido'] ?? '') !== '') {
            $f['pedido'] === '1' ? $q->whereNotNull('c.order_id') : $q->whereNull('c.order_id');
        }
        if (! empty($f['desde'])) {
            $q->where('c.started_at', '>=', Carbon::parse($f['desde'], 'America/Lima')->startOfDay());
        }
        if (! empty($f['hasta'])) {
            $q->where('c.started_at', '<=', Carbon::parse($f['hasta'], 'America/Lima')->endOfDay());
        }
        $t = trim((string) ($f['buscar'] ?? ''));
        if (mb_strlen($t) >= 2) {
            $p = '%'.addcslashes(str_replace(' ', '', $t), '%_\\').'%';
            $pn = '%'.addcslashes($t, '%_\\').'%';
            $q->where(fn ($w) => $w->where('c.from_e164', 'ilike', $p)->orWhere('c.to_e164', 'ilike', $p)->orWhere('cu.full_name', 'ilike', $pn)
                ->orWhere('l.full_name', 'ilike', $pn)->orWhere('o.number', 'ilike', $pn));
        }
        $c = (clone $q)->selectRaw("count(*) AS total, count(*) FILTER (WHERE c.status = 'COMPLETED') AS atendidas,
            count(*) FILTER (WHERE c.direction = 'INBOUND' AND c.status IN ('MISSED','NO_ANSWER','VOICEMAIL')) AS perdidas,
            count(*) FILTER (WHERE c.status = 'COMPLETED' AND c.order_id IS NOT NULL) AS con_pedido")->first();
        $q->orderByDesc('c.started_at')->orderBy('c.id');
        Paginas::ordenar($q, ['inicio' => 'c.started_at', 'cliente' => 'coalesce(cu.full_name, l.full_name)', 'marca' => 'b.name', 'vendedora' => 'x.name',
            'estado' => 'c.status', 'espera' => 'c.wait_seconds', 'duracion' => 'c.duration_seconds'], 'c.id', $f);
        $q->select(['c.*', 'x.name as vendedora', 'b.name as marca', 'o.number as pedido', DB::raw('coalesce(cu.trade_name, cu.full_name) AS cliente'), 'l.full_name as lead',
            'r.status as grabacion']);
        $r = Paginas::de($q, fn ($x) => [
            'id' => $x->id, 'started_at' => $x->started_at, 'direction' => $x->direction, 'direccion' => $x->direction === 'INBOUND' ? 'Entrante' : 'Saliente',
            'numero' => $x->direction === 'INBOUND' ? $x->from_e164 : $x->to_e164, 'cliente' => $x->cliente, 'lead' => $x->lead, 'marca' => $x->marca, 'vendedora' => $x->vendedora,
            'status' => $x->status, 'estado' => Llamadas::ESTADOS[$x->status] ?? $x->status, 'wait_seconds' => (int) $x->wait_seconds, 'duration_seconds' => (int) $x->duration_seconds,
            'grabacion' => $x->grabacion, 'pedido' => $x->pedido, 'preview' => (bool) $x->preview,
        ], $f);

        return $r + [
            'cifras' => ['total' => (int) $c->total, 'atendidas' => (int) $c->atendidas, 'perdidas' => (int) $c->perdidas,
                'con_pedido_pct' => (int) $c->atendidas ? round((int) $c->con_pedido / (int) $c->atendidas * 100, 1) : null],
            'opciones' => [
                'estados' => collect(Llamadas::ESTADOS)->map(fn ($l, $k) => ['value' => $k, 'label' => $l])->values()->all(),
                'marcas' => self::marcas($u), 'vendedoras' => self::personas($u, self::llamadas($u)->whereNotNull('c.user_id')->select('c.user_id')),
            ],
            'todas' => Access::can($u, 'tel.call.view_all'),
        ];
    }

    /* ------------------------------------------------------------------ TEL-09 Perdidas */

    private static function tareas(User $u)
    {
        $marcas = Access::for($u)['brands'];
        $q = DB::table('crm_tasks as t')->where('t.task_type', 'CALLBACK')->when($marcas, fn ($w) => $w->whereIn('t.brand_id', $marcas));

        return Access::can($u, 'tel.call.view_all') ? $q : $q->where('t.assigned_user_id', $u->id);
    }

    public static function perdidas(array $f, User $u): array
    {
        $ahora = now();
        $q = self::tareas($u)->leftJoin('tel_calls as c', 'c.id', '=', 't.call_id')->leftJoin('customers as cu', 'cu.id', '=', 't.customer_id')
            ->leftJoin('leads as l', 'l.id', '=', 't.lead_id')->leftJoin('users as x', 'x.id', '=', 't.assigned_user_id')->leftJoin('brands as b', 'b.id', '=', 't.brand_id');
        if (! empty($f['marca'])) {
            $q->where('t.brand_id', $f['marca']);
        }
        if (! empty($f['responsable'])) {
            $f['responsable'] === 'none' ? $q->whereNull('t.assigned_user_id') : $q->where('t.assigned_user_id', $f['responsable']);
        }
        $t = trim((string) ($f['buscar'] ?? ''));
        if (mb_strlen($t) >= 2) {
            $p = '%'.addcslashes(str_replace(' ', '', $t), '%_\\').'%';
            $pn = '%'.addcslashes($t, '%_\\').'%';
            $q->where(fn ($w) => $w->where('c.from_e164', 'ilike', $p)->orWhere('cu.phone', 'ilike', $p)->orWhere('l.phone', 'ilike', $p)->orWhere('cu.full_name', 'ilike', $pn)
                ->orWhere('l.full_name', 'ilike', $pn)->orWhere('t.note', 'ilike', $pn));
        }
        $c = (clone $q)->selectRaw("count(*) FILTER (WHERE t.status = 'OPEN') AS abiertas, count(*) FILTER (WHERE t.status = 'OPEN' AND t.due_at < ?) AS vencidas,
            count(*) FILTER (WHERE t.status = 'DONE' AND t.done_at <= t.due_at) AS a_tiempo, count(*) AS total, count(*) FILTER (WHERE t.status = 'DONE') AS hechas", [$ahora])->first();
        match ($f['estado'] ?? '') {
            'OPEN' => $q->where('t.status', 'OPEN'),
            'DONE' => $q->where('t.status', 'DONE'),
            'VENCIDA' => $q->where('t.status', 'OPEN')->where('t.due_at', '<', $ahora),
            default => null,
        };
        $q->orderByRaw("CASE t.status WHEN 'OPEN' THEN 0 ELSE 1 END")->orderBy('t.due_at')->orderBy('t.id');
        Paginas::ordenar($q, ['vence' => 't.due_at', 'cliente' => 'coalesce(cu.full_name, l.full_name)', 'responsable' => 'x.name', 'marca' => 'b.name', 'estado' => 't.status'], 't.id', $f);
        $q->select(['t.*', 'c.from_e164', 'c.started_at as llamada_at', 'b.name as marca', 'x.name as responsable', DB::raw('coalesce(cu.trade_name, cu.full_name, l.full_name) AS cliente'),
            DB::raw('coalesce(c.from_e164, cu.phone, l.phone) AS numero')]);
        $r = Paginas::de($q, fn ($x) => [
            'id' => $x->id, 'call_id' => $x->call_id, 'due_at' => $x->due_at, 'vencida' => $x->status === 'OPEN' && Carbon::parse($x->due_at)->lt($ahora),
            'numero' => $x->numero, 'cliente' => $x->cliente, 'customer_id' => $x->customer_id, 'lead_id' => $x->lead_id, 'marca' => $x->marca, 'responsable' => $x->responsable,
            'status' => $x->status, 'done_at' => $x->done_at, 'result' => $x->result, 'note' => $x->note, 'llamada_at' => $x->llamada_at,
            'a_tiempo' => $x->status === 'DONE' ? Carbon::parse($x->done_at)->lte(Carbon::parse($x->due_at)) : null,
            'puede' => $x->status === 'OPEN' && ($x->assigned_user_id === $u->id || Access::can($u, 'crm.conversation.reassign')),
        ], $f);

        return $r + [
            'cifras' => ['abiertas' => (int) $c->abiertas, 'vencidas' => (int) $c->vencidas, 'hechas' => (int) $c->hechas,
                'a_tiempo_pct' => (int) $c->total ? round((int) $c->a_tiempo / (int) $c->total * 100, 1) : null],
            'minutos' => (int) (DB::table('tel_settings')->value('callback_due_minutes') ?? 30),
            'opciones' => ['marcas' => self::marcas($u), 'responsables' => array_merge(self::personas($u, self::tareas($u)->whereNotNull('t.assigned_user_id')->select('t.assigned_user_id')),
                Access::can($u, 'tel.call.view_all') ? [['value' => 'none', 'label' => 'Sin responsable']] : [])],
        ];
    }

    /* ------------------------------------------------------------------ TEL-11 Panel */

    /** Tipo de cambio de venta del dólar vigente a una fecha (MAE-05); si no hay, 3,75. */
    public static function tipoDeCambio(Carbon $hasta): float
    {
        return (float) (DB::table('exchange_rates')->where('currency', 'USD')->where('date', '<=', $hasta->toDateString())->orderByDesc('date')->value('sell') ?? 3.75);
    }

    /** Costo de telefonía de un conjunto de llamadas (CA-TEL-07): voz, grabación y transcripción, en USD y en soles. */
    public static function costo($llamadas, Carbon $fecha): array
    {
        $s = DB::table('tel_settings')->first();
        $r = array_merge(Ajustes::TARIFAS, (array) json_decode((string) ($s->rates ?? '{}'), true));
        $filas = (clone $llamadas)->get(['c.id', 'c.direction', 'c.to_e164', 'c.duration_seconds', 'c.notice_played', 'c.order_id']);
        $min = 0;
        $voz = 0.0;
        $grab = 0.0;
        foreach ($filas as $c) {
            $m = (int) ceil(((int) $c->duration_seconds) / 60);
            $min += $m;
            $voz += $m * ($c->direction === 'OUTBOUND' ? (str_starts_with((string) $c->to_e164, '+519') ? $r['out_mobile'] : $r['out_landline']) : $r['inbound']);
            if ($c->notice_played && $m) {
                $grab += $m * $r['recording'];
            }
        }
        $trans = (float) DB::table('tel_transcripts')->whereIn('call_id', $filas->pluck('id'))->sum('cost_usd');
        $total = round($voz + $grab + $trans, 2);
        $fx = self::tipoDeCambio($fecha);
        $pedidos = $filas->pluck('order_id')->filter()->unique()->count();

        return ['minutos' => $min, 'voz_usd' => round($voz, 2), 'grabacion_usd' => round($grab, 2), 'transcripcion_usd' => round($trans, 2), 'total_usd' => $total,
            'tipo_de_cambio' => $fx, 'total_pen' => round($total * $fx, 2), 'pedidos' => $pedidos, 'por_pedido_pen' => $pedidos ? round($total * $fx / $pedidos, 2) : null];
    }

    public static function panel(array $f, User $u): array
    {
        $base = fn () => self::llamadas($u);
        $hoy = now('America/Lima')->toDateString();
        $ultimo = (clone $base())->max('c.started_at');
        $dia = ! empty($f['dia']) ? Carbon::parse($f['dia'], 'America/Lima')
            : ((clone $base())->where('c.started_at', '>=', now('America/Lima')->startOfDay())->exists() || ! $ultimo ? now('America/Lima') : Carbon::parse($ultimo)->setTimezone('America/Lima'));
        [$desde, $hasta] = [$dia->copy()->startOfDay(), $dia->copy()->endOfDay()];
        $mes = ! empty($f['mes']) ? Carbon::parse($f['mes'].'-01', 'America/Lima') : $dia->copy()->startOfMonth();
        [$mesDesde, $mesHasta] = [$mes->copy()->startOfMonth(), $mes->copy()->endOfMonth()];

        $vivo = (clone $base())->whereIn('c.status', ['RINGING', 'IN_PROGRESS'])->leftJoin('customers as cu', 'cu.id', '=', 'c.customer_id')->leftJoin('leads as l', 'l.id', '=', 'c.lead_id')
            ->leftJoin('users as x', 'x.id', '=', 'c.user_id')->leftJoin('brands as b', 'b.id', '=', 'c.brand_id')->orderBy('c.started_at')->limit(50)
            ->get(['c.id', 'c.status', 'c.direction', 'c.started_at', 'c.from_e164', 'c.to_e164', 'x.name as vendedora', 'b.name as marca', DB::raw('coalesce(cu.trade_name, cu.full_name, l.full_name) AS cliente')])
            ->map(fn ($c) => ['id' => $c->id, 'status' => $c->status, 'estado' => Llamadas::ESTADOS[$c->status], 'direccion' => $c->direction === 'INBOUND' ? 'Entrante' : 'Saliente',
                'desde' => $c->started_at, 'numero' => $c->direction === 'INBOUND' ? $c->from_e164 : $c->to_e164, 'cliente' => $c->cliente, 'marca' => $c->marca,
                'vendedora' => $c->vendedora ?? 'Sonando en el grupo'])->all();

        $delDia = (clone $base())->whereBetween('c.started_at', [$desde, $hasta])->whereNotIn('c.status', ['RINGING', 'IN_PROGRESS']);
        $d = (clone $delDia)->selectRaw("count(*) FILTER (WHERE c.direction = 'INBOUND') AS entrantes, count(*) FILTER (WHERE c.direction = 'INBOUND' AND c.status = 'COMPLETED') AS atendidas,
            count(*) FILTER (WHERE c.direction = 'INBOUND' AND c.status IN ('MISSED','NO_ANSWER','VOICEMAIL')) AS perdidas,
            avg(c.wait_seconds) FILTER (WHERE c.direction = 'INBOUND' AND c.status = 'COMPLETED') AS espera,
            avg(c.duration_seconds) FILTER (WHERE c.status = 'COMPLETED') AS duracion, count(*) AS total")->first();
        $alertasMes = DB::table('control_alerts')->where('source_type', 'CALL_TRANSCRIPT')->whereBetween('raised_at', [$mesDesde, $mesHasta])
            ->when(Access::for($u)['brands'], fn ($w, $b) => $w->where(fn ($x) => $x->whereNull('brand_id')->orWhereIn('brand_id', $b)));
        $porVendedora = (clone $delDia)->whereNotNull('c.user_id')->join('users as x', 'x.id', '=', 'c.user_id')->groupBy('c.user_id', 'x.name')
            ->selectRaw("c.user_id, x.name, count(*) AS llamadas, count(*) FILTER (WHERE c.status = 'COMPLETED') AS atendidas,
                count(*) FILTER (WHERE c.direction = 'INBOUND' AND c.status IN ('MISSED','NO_ANSWER','VOICEMAIL')) AS perdidas,
                avg(c.wait_seconds) FILTER (WHERE c.direction = 'INBOUND' AND c.status = 'COMPLETED') AS espera, avg(c.duration_seconds) FILTER (WHERE c.status = 'COMPLETED') AS duracion,
                count(*) FILTER (WHERE c.status = 'COMPLETED' AND c.order_id IS NOT NULL) AS con_pedido")->orderBy('x.name')->get();
        $alertasPor = (clone $alertasMes)->selectRaw('user_id, count(*) AS n')->groupBy('user_id')->pluck('n', 'user_id');
        $t = mb_strtolower(trim((string) ($f['buscar'] ?? '')));
        $vendedoras = $porVendedora->map(fn ($v) => ['id' => $v->user_id, 'nombre' => $v->name, 'llamadas' => (int) $v->llamadas, 'atendidas' => (int) $v->atendidas,
            'perdidas' => (int) $v->perdidas, 'espera' => $v->espera !== null ? (int) round($v->espera) : null, 'duracion' => $v->duracion !== null ? (int) round($v->duracion) : null,
            'con_pedido' => (int) $v->con_pedido, 'alertas' => (int) ($alertasPor[$v->user_id] ?? 0)])
            ->filter(fn ($v) => mb_strlen($t) < 2 || str_contains(mb_strtolower($v['nombre']), $t))->values()->all();
        $meses = (clone $base())->selectRaw("DISTINCT to_char(c.started_at AT TIME ZONE 'America/Lima', 'YYYY-MM') AS m")->orderByDesc('m')->limit(12)->pluck('m')->all();
        $s = DB::table('tel_settings')->first();

        return [
            'dia' => $dia->toDateString(), 'hoy' => $hoy, 'mes' => $mes->format('Y-m'),
            'meses' => array_map(fn ($m) => ['value' => $m, 'label' => Carbon::parse($m.'-01')->locale('es')->translatedFormat('F Y')], $meses ?: [$mes->format('Y-m')]),
            'vivo' => $vivo,
            'cifras' => ['en_curso' => collect($vivo)->where('status', 'IN_PROGRESS')->count(), 'sonando' => collect($vivo)->where('status', 'RINGING')->count(),
                'entrantes' => (int) $d->entrantes, 'atendidas' => (int) $d->atendidas, 'atendidas_pct' => (int) $d->entrantes ? round((int) $d->atendidas / (int) $d->entrantes * 100, 1) : null,
                'perdidas' => (int) $d->perdidas, 'espera' => $d->espera !== null ? (int) round($d->espera) : null, 'duracion' => $d->duracion !== null ? (int) round($d->duracion) : null,
                'alertas_mes' => (clone $alertasMes)->count()],
            'vendedoras' => $vendedoras,
            'costo' => self::costo((clone $base())->whereBetween('c.started_at', [$mesDesde, $mesHasta]), $mesHasta),
            'tarifas' => array_map('floatval', array_merge(Ajustes::TARIFAS, (array) json_decode((string) ($s->rates ?? '{}'), true))),
        ];
    }
}
