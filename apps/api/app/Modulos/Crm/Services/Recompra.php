<?php

namespace App\Modulos\Crm\Services;

use App\Models\User;
use App\Support\Access;
use App\Support\Events;
use App\Support\Paginas;
use App\Support\Params;
use App\Support\RuleError;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * CRM-15 Recompra (RN-CRM-19): un cliente con al menos crm_rebuy_min_orders (3) pedidos entregados de una marca tiene
 * frecuencia = mediana de días entre pedidos. La fecha esperada es el último pedido más esa frecuencia; la tarea de
 * recompra vence crm_rebuy_notice_days (3) días antes. Pasa a «en riesgo» al superar crm_rebuy_risk_factor (1,5) veces la
 * frecuencia sin comprar y a «perdido» al superar crm_rebuy_lost_factor (3) veces. Una sola tarea de recompra abierta por
 * cliente y marca. Se recalcula cada mañana (crm:recompra) y a pedido.
 */
class Recompra
{
    public const ESTADOS = ['DUE' => 'Por avisar', 'AT_RISK' => 'En riesgo', 'LOST' => 'Perdido', 'ACTIVE' => 'Al día', 'NEW' => 'Sin frecuencia aún'];

    private static function params(): array
    {
        return [
            'min' => (int) (Params::get('crm_rebuy_min_orders') ?? 3), 'aviso' => (int) (Params::get('crm_rebuy_notice_days') ?? 3),
            'riesgo' => (float) (Params::get('crm_rebuy_risk_factor') ?? 1.5), 'perdido' => (float) (Params::get('crm_rebuy_lost_factor') ?? 3),
        ];
    }

    private static function mediana(array $xs): float
    {
        sort($xs);
        $n = count($xs);

        return $n % 2 ? (float) $xs[intdiv($n, 2)] : ($xs[$n / 2 - 1] + $xs[$n / 2]) / 2;
    }

    /**
     * El perfil a partir de las fechas de los pedidos entregados (un día cuenta una vez).
     * CA-CRM-10: compras los días 1, 16 y 31 → frecuencia 15, esperado el 46, tarea el 43.
     *
     * @return array{orders_count:int, median_interval_days:?float, last_order_at:?string, next_expected_at:?string, status:string, due_task_at:?string}
     */
    public static function calcular(array $fechas, Carbon $hoy, ?array $p = null): array
    {
        $p ??= self::params();
        $ds = array_values(array_unique(array_map(fn ($d) => substr((string) $d, 0, 10), $fechas)));
        sort($ds);
        $n = count($ds);
        $ultimo = $ds[$n - 1] ?? null;
        if ($n < $p['min']) {
            return ['orders_count' => $n, 'median_interval_days' => null, 'last_order_at' => $ultimo, 'next_expected_at' => null, 'status' => 'NEW', 'due_task_at' => null];
        }
        $gaps = [];
        for ($i = 1; $i < $n; $i++) {
            $gaps[] = Carbon::parse($ds[$i - 1])->diffInDays(Carbon::parse($ds[$i]));
        }
        $med = self::mediana($gaps);
        $u = Carbon::parse($ultimo);
        $esperado = $u->copy()->addDays((int) round($med));
        $desde = $u->diffInDays($hoy->copy()->startOfDay(), false);
        $estado = $desde > $med * $p['perdido'] ? 'LOST' : ($desde > $med * $p['riesgo'] ? 'AT_RISK'
            : ($hoy->copy()->startOfDay()->diffInDays($esperado, false) <= $p['aviso'] ? 'DUE' : 'ACTIVE'));

        return ['orders_count' => $n, 'median_interval_days' => round($med, 1), 'last_order_at' => $ultimo, 'next_expected_at' => $esperado->toDateString(),
            'status' => $estado, 'due_task_at' => $esperado->copy()->subDays($p['aviso'])->toDateString()];
    }

    /** Recalcula los perfiles de todos los clientes y crea las tareas que tocan (dentro de la empresa ya fijada). */
    public static function recalcular(?Carbon $hoy = null): array
    {
        $hoy ??= now('America/Lima');
        $pedidos = DB::table('sales_orders as o')->join('customers as c', 'c.id', '=', 'o.customer_id')->whereIn('o.status', ['DELIVERED', 'CLOSED'])
            ->where('c.full_name', 'not ilike', 'clientes varios%')
            ->orderBy('o.customer_id')->orderBy('o.brand_id')
            ->get(['o.customer_id', 'o.brand_id', 'o.seller_id', DB::raw("(coalesce(o.delivered_at, o.delivery_date::timestamptz, o.created_at) AT TIME ZONE 'America/Lima')::date AS dia")]);
        $grupos = [];
        foreach ($pedidos as $o) {
            $g = &$grupos[$o->customer_id.'|'.$o->brand_id];
            $g['fechas'][] = $o->dia;
            if ($o->seller_id && $o->dia >= ($g['ultimo'] ?? '')) {
                $g['ultimo'] = $o->dia;
                $g['vendedora'] = $o->seller_id;
            }
            unset($g);
        }
        $vendedoras = DB::table('user_roles as ur')->join('roles as r', 'r.id', '=', 'ur.role_id')->where('r.code', 'VENDEDORA')->pluck('ur.user_id')->flip();
        $abiertas = DB::table('crm_tasks')->where('task_type', 'REBUY')->where('status', 'OPEN')->get(['customer_id', 'brand_id'])
            ->mapWithKeys(fn ($t) => [$t->customer_id.'|'.$t->brand_id => true]);
        $perfiles = 0;
        $tareas = 0;
        $filas = [];
        $params = self::params();   // una vez por corrida (y por empresa)
        foreach ($grupos as $k => $g) {
            [$cliente, $marca] = explode('|', $k);
            $p = self::calcular($g['fechas'], $hoy, $params);
            $filas[] = [
                'customer_id' => $cliente, 'brand_id' => $marca, 'computed_at' => now(), 'orders_count' => $p['orders_count'], 'median_interval_days' => $p['median_interval_days'],
                'last_order_at' => $p['last_order_at'], 'next_expected_at' => $p['next_expected_at'], 'status' => $p['status'], 'created_at' => now(), 'updated_at' => now(),
            ];
            $perfiles++;
            if ($p['due_task_at'] && $p['status'] !== 'LOST' && $hoy->copy()->startOfDay()->diffInDays(Carbon::parse($p['due_task_at']), false) <= 7 && ! isset($abiertas[$k])) {
                $quien = isset($g['vendedora'], $vendedoras[$g['vendedora']]) ? $g['vendedora'] : null;
                $n = DB::table('crm_tasks')->insertOrIgnore(['task_type' => 'REBUY', 'status' => 'OPEN', 'customer_id' => $cliente, 'brand_id' => $marca, 'assigned_user_id' => $quien,
                    'due_at' => Carbon::parse($p['due_task_at'].' 09:00', 'America/Lima'),
                    'note' => mb_substr('Frecuencia '.number_format((float) $p['median_interval_days'], 1, ',', '').' días · esperado '.Carbon::parse($p['next_expected_at'])->format('d/m/Y'), 0, 255),
                    'created_at' => now(), 'updated_at' => now()]);
                $abiertas[$k] = true;
                $tareas += $n;
            }
        }
        foreach (array_chunk($filas, 300) as $lote) {
            DB::table('customer_rebuy_profiles')->upsert($lote, ['tenant_id', 'customer_id', 'brand_id'],
                ['computed_at', 'orders_count', 'median_interval_days', 'last_order_at', 'next_expected_at', 'status', 'updated_at']);
        }

        return ['perfiles' => $perfiles, 'tareas' => $tareas];
    }

    /** La vendedora ve los clientes de sus chats y los que tienen su tarea de recompra; la supervisión, los de sus marcas. */
    private static function base(User $u)
    {
        $marcas = Access::for($u)['brands'];
        $q = DB::table('customer_rebuy_profiles as p')->when($marcas, fn ($w) => $w->whereIn('p.brand_id', $marcas));
        if (! Access::can($u, 'crm.conversation.view_all')) {
            $q->where(fn ($w) => $w->whereIn('p.customer_id', Conversaciones::visibles($u)->whereNotNull('v.customer_id')->select('v.customer_id'))
                ->orWhereExists(fn ($x) => $x->from('crm_tasks as t')->whereColumn('t.customer_id', 'p.customer_id')->whereColumn('t.brand_id', 'p.brand_id')
                    ->where('t.task_type', 'REBUY')->where('t.status', 'OPEN')->where('t.assigned_user_id', $u->id)));
        }

        return $q;
    }

    public static function lista(array $f, User $u): array
    {
        $q = self::base($u)->join('customers as c', 'c.id', '=', 'p.customer_id')->leftJoin('brands as b', 'b.id', '=', 'p.brand_id')
            ->leftJoin('crm_tasks as t', fn ($j) => $j->on('t.customer_id', '=', 'p.customer_id')->on('t.brand_id', '=', 'p.brand_id')->where('t.task_type', 'REBUY')->where('t.status', 'OPEN'))
            ->leftJoin('users as x', 'x.id', '=', 't.assigned_user_id');
        if (! empty($f['marca'])) {
            $q->where('p.brand_id', $f['marca']);
        }
        if (! empty($f['vendedora'])) {
            $f['vendedora'] === 'none' ? $q->whereNotNull('t.id')->whereNull('t.assigned_user_id') : $q->where('t.assigned_user_id', $f['vendedora']);
        }
        if (($f['tarea'] ?? '') !== '') {
            $f['tarea'] === '1' ? $q->whereNotNull('t.id') : $q->whereNull('t.id');
        }
        $t = trim((string) ($f['buscar'] ?? ''));
        if (mb_strlen($t) >= 2) {
            $p = '%'.addcslashes($t, '%_\\').'%';
            $q->where(fn ($w) => $w->where('c.full_name', 'ilike', $p)->orWhere('c.trade_name', 'ilike', $p)->orWhere('c.phone', 'ilike', $p));
        }
        $cuentas = (clone $q)->selectRaw('p.status, count(*) AS n')->groupBy('p.status')->pluck('n', 'status');
        $frecuencias = (clone $q)->whereNotNull('p.median_interval_days')->pluck('p.median_interval_days')->map(fn ($x) => (float) $x)->all();
        $q->where('p.status', $f['estado'] ?? 'DUE');
        $q->orderByRaw('p.next_expected_at NULLS LAST')->orderBy('c.full_name');
        Paginas::ordenar($q, ['cliente' => 'c.full_name', 'marca' => 'b.name', 'pedidos' => 'p.orders_count', 'frecuencia' => 'p.median_interval_days',
            'ultimo' => 'p.last_order_at', 'esperado' => 'p.next_expected_at', 'tarea' => 't.due_at'], 'p.id', $f);
        $q->select(['p.*', 'b.name as marca', 'c.full_name', 'c.trade_name', 'c.phone', 't.id as tarea_id', 't.due_at as tarea_vence', 'x.name as tarea_quien', 't.assigned_user_id']);
        $r = Paginas::de($q, fn ($p) => [
            'id' => $p->id, 'customer_id' => $p->customer_id, 'brand_id' => $p->brand_id, 'cliente' => $p->trade_name ?: $p->full_name, 'celular' => $p->phone, 'marca' => $p->marca,
            'pedidos' => (int) $p->orders_count, 'frecuencia' => $p->median_interval_days !== null ? (float) $p->median_interval_days : null,
            'ultimo' => $p->last_order_at, 'esperado' => $p->next_expected_at, 'status' => $p->status, 'estado' => self::ESTADOS[$p->status] ?? $p->status,
            'tarea' => $p->tarea_id ? ['id' => $p->tarea_id, 'vence' => $p->tarea_vence, 'quien' => $p->tarea_quien] : null, 'computed_at' => $p->computed_at,
        ], $f);
        $ids = array_column($r['data'], 'customer_id');
        $mk = [];
        foreach ($ids as $c) {
            $mk[$c] ??= Consentimientos::marketing($c, null);
        }
        foreach ($r['data'] as &$fila) {
            $fila['marketing'] = $mk[$fila['customer_id']] ?? null;
        }
        unset($fila);
        $marcas = Access::for($u)['brands'];
        $pp = self::params();

        return $r + [
            'cifras' => collect(self::ESTADOS)->mapWithKeys(fn ($l, $k) => [$k => (int) ($cuentas[$k] ?? 0)])->all()
                + ['frecuencia_mediana' => $frecuencias ? round(self::mediana($frecuencias), 1) : null],
            'calculado' => self::base($u)->max('p.computed_at'),
            'reglas' => $pp,
            'opciones' => [
                'estados' => collect(self::ESTADOS)->map(fn ($l, $k) => ['value' => $k, 'label' => $l])->values()->all(),
                'marcas' => DB::table('brands')->when($marcas, fn ($w) => $w->whereIn('id', $marcas))->where('status', 'ACTIVE')->orderBy('name')
                    ->get(['id', 'name'])->map(fn ($b) => ['value' => $b->id, 'label' => $b->name])->all(),
                'vendedoras' => DB::table('users as x')->whereIn('x.id', DB::table('crm_tasks')->where('task_type', 'REBUY')->where('status', 'OPEN')->whereNotNull('assigned_user_id')->select('assigned_user_id'))
                    ->orderBy('x.name')->get(['x.id', 'x.name'])->map(fn ($x) => ['value' => $x->id, 'label' => $x->name])->prepend(['value' => 'none', 'label' => 'Sin responsable'])->values()->all(),
            ],
            'puede' => ['recalcular' => Access::can($u, 'crm.conversation.reassign') || Access::can($u, 'crm.channel.manage'),
                'plantilla' => Access::can($u, 'crm.template.send_marketing'), 'ficha' => Access::can($u, 'crm.customer.view_full')],
        ];
    }

    /**
     * Envía la plantilla de recompra por el chat de WhatsApp del cliente con la marca (RN-CRM-07 y 08: aprobada, de la
     * marca y con consentimiento de marketing vigente).
     */
    public static function enviarPlantilla(string $perfil, User $u): array
    {
        $p = self::base($u)->where('p.id', $perfil)->first(['p.*']) ?? abort(404);
        $cv = Conversaciones::visibles($u)->where('v.customer_id', $p->customer_id)->where('v.brand_id', $p->brand_id)->where('c.kind', 'WHATSAPP')
            ->orderByDesc('v.opened_at')->first(['v.id']);
        if (! $cv) {
            RuleError::fail('RN-CRM-07', 'El cliente no tiene un chat de WhatsApp con esta marca que puedas atender: llámalo o espera a que escriba.');
        }
        $t = DB::table('message_templates')->where('purpose', 'REBUY')->where('provider_status', 'APPROVED')
            ->where(fn ($w) => $w->where('brand_id', $p->brand_id)->orWhereNull('brand_id'))->orderByRaw('brand_id IS NULL')->first(['id']);
        if (! $t) {
            RuleError::fail('RN-CRM-07', 'No hay una plantilla de recompra aprobada para esta marca.');
        }
        $r = Plantillas::enviar($cv->id, $t->id, null, false, $u);
        Events::emit('rebuy.template_sent', 'customer_rebuy_profiles', $perfil, ['conversation' => $cv->id, 'by' => $u->id]);

        return ['conversation_id' => $cv->id, 'mensaje' => $r['mensaje']];
    }
}
