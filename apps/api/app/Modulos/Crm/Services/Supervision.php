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
 * CRM-06 Supervisión en vivo (RN-CRM-02, 03 y 14): los chats abiertos de las marcas de la supervisora, la cola sin
 * asignar, los chats sin responder más de crm_unanswered_alert_minutes en horario, la primera respuesta del día y cada
 * vendedora con su estado, sus números, sus chats abiertos sobre su tope, sus pedidos del día y sus alertas abiertas.
 * Desde aquí se reasigna o se toma un chat y se cambia el estado de una vendedora.
 */
class Supervision
{
    private static function limites(): array
    {
        return [
            'sin_responder' => (int) (Params::get('crm_unanswered_alert_minutes') ?? 15),
            'cola' => (int) (Params::get('crm_unassigned_alert_minutes') ?? 5),
            'meta' => (int) (Params::get('crm_first_response_target_minutes') ?? 5),
        ];
    }

    /** Los chats abiertos visibles con su espera (minutos en horario sin respuesta, o en cola). */
    private static function abiertos(array $f, User $u, Carbon $ahora): array
    {
        $q = Conversaciones::visibles($u)->where('v.status', '<>', 'CLOSED')
            ->leftJoin('channel_contacts as k', 'k.id', '=', 'v.contact_id')->leftJoin('customers as cu', 'cu.id', '=', 'v.customer_id')
            ->leftJoin('leads as l', 'l.id', '=', 'v.lead_id')->leftJoin('users as us', 'us.id', '=', 'v.assigned_user_id')->leftJoin('brands as b', 'b.id', '=', 'v.brand_id')
            ->when(! empty($f['marca']), fn ($w) => $w->where('v.brand_id', $f['marca']))
            ->when(! empty($f['canal']), fn ($w) => $w->where('v.channel_id', $f['canal']));

        return $q->get(['v.id', 'v.channel_id', 'v.brand_id', 'v.assigned_user_id', 'v.status', 'v.opened_at', 'v.queued_at', 'v.last_inbound_at', 'v.last_reply_at',
            'v.entry_point', 'v.ad_code', 'c.kind', 'c.display_name as channel_name', 'b.name as brand_name', 'us.name as assigned_name',
            DB::raw('coalesce(cu.full_name, l.full_name, k.display_name, k.external_user_id) AS contacto'), 'k.external_user_id'])
            ->map(function ($v) use ($ahora) {
                $sinRespuesta = $v->last_inbound_at && (! $v->last_reply_at || $v->last_reply_at < $v->last_inbound_at);
                $v->espera = $sinRespuesta ? Conversaciones::minutosHabiles(Carbon::parse($v->last_inbound_at), $ahora, $v->brand_id) : 0;
                $v->en_cola_min = $v->assigned_user_id ? null : (int) floor(Carbon::parse($v->queued_at ?? $v->opened_at)->diffInSeconds($ahora) / 60);

                return $v;
            })->all();
    }

    public static function panel(array $f, User $u): array
    {
        $ahora = now();
        $lim = self::limites();
        $dia = ! empty($f['dia']) ? Carbon::parse($f['dia'], 'America/Lima') : now('America/Lima');
        [$desde, $hasta] = [$dia->copy()->startOfDay(), $dia->copy()->endOfDay()];
        $abiertos = self::abiertos($f, $u, $ahora);
        $cola = array_filter($abiertos, fn ($v) => ! $v->assigned_user_id);
        $sinResp = array_filter($abiertos, fn ($v) => $v->espera > $lim['sin_responder']);

        // Primera respuesta de los chats abiertos ese día (RN-CRM-14: el reloj se detiene fuera del horario).
        $delDia = Conversaciones::visibles($u)->whereBetween('v.opened_at', [$desde, $hasta])->whereNotNull('v.first_response_at')
            ->when(! empty($f['marca']), fn ($w) => $w->where('v.brand_id', $f['marca']))->when(! empty($f['canal']), fn ($w) => $w->where('v.channel_id', $f['canal']))
            ->get(['v.assigned_user_id', 'v.brand_id', 'v.opened_at', 'v.first_response_at']);
        $frt = fn ($v) => Conversaciones::minutosHabiles(Carbon::parse($v->opened_at), Carbon::parse($v->first_response_at), $v->brand_id);
        $todas = $delDia->map($frt)->all();
        $mediana = self::mediana($todas);
        $vend = self::vendedorasBase($f, $u);
        $enLinea = collect($vend)->where('estado', 'ONLINE')->count();

        return [
            'cifras' => [
                'abiertos' => count($abiertos), 'en_cola' => count($cola), 'cola_vencida' => count(array_filter($cola, fn ($v) => $v->en_cola_min > $lim['cola'])),
                'sin_responder' => count($sinResp), 'primera_respuesta' => $mediana, 'primera_respuesta_chats' => count($todas),
                'en_linea' => $enLinea, 'vendedoras' => count($vend),
            ],
            'limites' => $lim, 'dia' => $dia->toDateString(), 'hoy' => now('America/Lima')->toDateString(),
            'opciones' => [
                'marcas' => DB::table('brands')->when(Access::for($u)['brands'], fn ($w, $b) => $w->whereIn('id', $b))->where('status', 'ACTIVE')->orderBy('name')
                    ->get(['id', 'name'])->map(fn ($b) => ['value' => $b->id, 'label' => $b->name])->all(),
                'canales' => Canales::visibles($u)->when(! empty($f['marca']), fn ($w) => $w->where('c.brand_id', $f['marca']))
                    ->orderByRaw("CASE c.kind WHEN 'WHATSAPP' THEN 0 ELSE 1 END")->orderBy('c.display_name')->get(['c.id', 'c.kind', 'c.display_name'])
                    ->map(fn ($c) => ['value' => $c->id, 'label' => (Canales::REDES[$c->kind] ?? $c->kind).' · '.$c->display_name])->all(),
                'estados' => collect(Equipos::ESTADOS_AGENTE)->map(fn ($l, $k) => ['value' => $k, 'label' => $l])->values()->all(),
            ],
            'puede' => ['reasignar' => Access::can($u, 'crm.conversation.reassign'), 'estado' => self::puedeEstado($u)],
            'yo' => $u->id,
        ];
    }

    /** La cola sin asignar o los chats sin responder, con buscador y orden. */
    public static function chats(string $tipo, array $f, User $u): array
    {
        $ahora = now();
        $lim = self::limites();
        $filas = array_values(array_filter(self::abiertos($f, $u, $ahora), fn ($v) => $tipo === 'cola' ? ! $v->assigned_user_id : $v->espera > $lim['sin_responder']));
        $t = mb_strtolower(trim((string) ($f['buscar'] ?? '')));
        if (mb_strlen($t) >= 2) {
            $filas = array_values(array_filter($filas, fn ($v) => str_contains(mb_strtolower(implode(' ', [$v->contacto, $v->external_user_id, $v->assigned_name, $v->channel_name, $v->ad_code])), $t)));
        }
        $miembros = DB::table('channel_members as m')->join('users as x', 'x.id', '=', 'm.user_id')->whereIn('m.channel_id', array_unique(array_column($filas, 'channel_id')))
            ->where('m.active', true)->where('x.status', 'ACTIVE')->orderBy('x.name')->get(['m.channel_id', 'x.id', 'x.name', 'm.member_role'])->groupBy('channel_id');
        $filas = array_map(fn ($v) => [
            'id' => $v->id, 'contacto' => $v->contacto ?: 'Cliente', 'celular' => $v->kind === 'WHATSAPP' ? $v->external_user_id : null,
            'canal' => (Canales::REDES[$v->kind] ?? $v->kind).' · '.$v->channel_name, 'kind' => $v->kind, 'marca' => $v->brand_name,
            'atiende' => $v->assigned_name, 'assigned_user_id' => $v->assigned_user_id,
            'entrada' => (Conversaciones::ENTRADAS[$v->entry_point] ?? $v->entry_point).($v->ad_code ? " {$v->ad_code}" : ''),
            'espera' => $v->assigned_user_id ? $v->espera : max($v->espera, (int) $v->en_cola_min), 'en_cola_min' => $v->en_cola_min,
            'soy_miembro' => collect($miembros[$v->channel_id] ?? [])->contains('id', $u->id),
            'miembros' => collect($miembros[$v->channel_id] ?? [])->map(fn ($m) => ['value' => $m->id, 'label' => $m->name.($m->member_role === 'SUPERVISOR' ? ' (supervisora)' : '')])->values()->all(),
        ], $filas);
        usort($filas, fn ($a, $b) => $b['espera'] <=> $a['espera']);

        return Paginas::deLista(Paginas::ordenarLista($filas, ['contacto', 'canal', 'atiende', 'espera'], $f), $f);
    }

    /** Las vendedoras de los números visibles con sus cifras del día. */
    public static function vendedoras(array $f, User $u): array
    {
        $filas = self::vendedorasBase($f, $u, true);
        $t = mb_strtolower(trim((string) ($f['buscar'] ?? '')));
        if (mb_strlen($t) >= 2) {
            $filas = array_values(array_filter($filas, fn ($x) => str_contains(mb_strtolower($x['nombre'].' '.$x['numeros']), $t)));
        }
        if (! empty($f['estado'])) {
            $filas = array_values(array_filter($filas, fn ($x) => $x['estado'] === $f['estado']));
        }

        return Paginas::deLista(Paginas::ordenarLista($filas, ['nombre', 'estado', 'abiertos', 'sin_responder', 'primera_respuesta', 'pedidos', 'alertas'], $f), $f);
    }

    private static function vendedorasBase(array $f, User $u, bool $detalle = false): array
    {
        $canales = Canales::visibles($u)->when(! empty($f['marca']), fn ($w) => $w->where('c.brand_id', $f['marca']))
            ->when(! empty($f['canal']), fn ($w) => $w->where('c.id', $f['canal']))->get(['c.id', 'c.kind', 'c.display_name'])->keyBy('id');
        $ms = DB::table('channel_members as m')->join('users as x', 'x.id', '=', 'm.user_id')->whereIn('m.channel_id', $canales->keys())
            ->where('m.active', true)->where('m.member_role', 'AGENT')->where('x.status', 'ACTIVE')
            ->get(['m.user_id', 'm.channel_id', 'm.max_open_conversations', 'x.name'])->groupBy('user_id');
        $ids = $ms->keys()->all();
        $estados = Equipos::estados($ids);
        if (! $detalle) {
            return array_map(fn ($id) => ['id' => $id, 'estado' => $estados[$id] ?? 'OFFLINE'], $ids);
        }
        $ahora = now();
        $lim = self::limites();
        $abiertosN = Equipos::abiertos($ids);
        $sinResp = collect(self::abiertos($f, $u, $ahora))->filter(fn ($v) => $v->assigned_user_id && $v->espera > $lim['sin_responder'])->countBy('assigned_user_id');
        $dia = ! empty($f['dia']) ? Carbon::parse($f['dia'], 'America/Lima') : now('America/Lima');
        [$desde, $hasta] = [$dia->copy()->startOfDay(), $dia->copy()->endOfDay()];
        $frt = Conversaciones::visibles($u)->whereIn('v.assigned_user_id', $ids)->whereBetween('v.opened_at', [$desde, $hasta])->whereNotNull('v.first_response_at')
            ->get(['v.assigned_user_id', 'v.brand_id', 'v.opened_at', 'v.first_response_at'])->groupBy('assigned_user_id')
            ->map(fn ($xs) => self::mediana($xs->map(fn ($v) => Conversaciones::minutosHabiles(Carbon::parse($v->opened_at), Carbon::parse($v->first_response_at), $v->brand_id))->all()));
        $marcas = Access::for($u)['brands'];
        $pedidos = DB::table('sales_orders')->whereIn('seller_id', $ids)->whereBetween('created_at', [$desde, $hasta])->where('status', '<>', 'CANCELLED')
            ->when($marcas, fn ($w) => $w->whereIn('brand_id', $marcas))->selectRaw('seller_id, count(*) AS n')->groupBy('seller_id')->pluck('n', 'seller_id');
        $alertas = DB::table('control_alerts')->whereIn('user_id', $ids)->whereIn('status', ['OPEN', 'UNDER_REVIEW'])
            ->when($marcas, fn ($w) => $w->where(fn ($x) => $x->whereNull('brand_id')->orWhereIn('brand_id', $marcas)))
            ->selectRaw('user_id, count(*) AS n')->groupBy('user_id')->pluck('n', 'user_id');

        return $ms->map(function ($xs, $id) use ($canales, $estados, $abiertosN, $sinResp, $frt, $pedidos, $alertas) {
            $e = $estados[$id] ?? 'OFFLINE';

            return [
                'id' => $id, 'nombre' => $xs->first()->name, 'estado' => $e, 'estado_name' => Equipos::ESTADOS_AGENTE[$e],
                'numeros' => $xs->map(fn ($m) => (Canales::REDES[$canales[$m->channel_id]->kind] ?? '').' · '.$canales[$m->channel_id]->display_name)->implode(', '),
                'abiertos' => (int) ($abiertosN[$id] ?? 0), 'tope' => (int) $xs->max('max_open_conversations'),
                'sin_responder' => (int) ($sinResp[$id] ?? 0), 'primera_respuesta' => $frt[$id] ?? null,
                'pedidos' => (int) ($pedidos[$id] ?? 0), 'alertas' => (int) ($alertas[$id] ?? 0),
            ];
        })->sortBy('nombre')->values()->all();
    }

    private static function puedeEstado(User $u): bool
    {
        return Access::can($u, 'crm.channel.manage') || Access::can($u, 'crm.conversation.reassign');
    }

    /** La supervisora (o quien administra los números) cambia el estado de una vendedora de sus números. Solo se agrega al historial. */
    public static function cambiarEstado(string $usuario, string $estado, User $u): array
    {
        if (! self::puedeEstado($u)) {
            RuleError::fail('RN-CRM-03', 'Solo la supervisora o quien administra los números cambia el estado de una vendedora.');
        }
        if (! isset(Equipos::ESTADOS_AGENTE[$estado])) {
            RuleError::fail('RN-CRM-02', 'El estado es en línea, ausente o desconectada.');
        }
        $miembro = DB::table('channel_members')->whereIn('channel_id', Canales::visibles($u)->select('c.id'))->where('user_id', $usuario)->where('active', true)->exists();
        if (! $miembro) {
            abort(404);
        }
        DB::table('crm_agent_status')->insert(['user_id' => $usuario, 'status' => $estado, 'changed_at' => DB::raw('clock_timestamp()'), 'created_at' => now()]);
        Events::emit('crm.agent_status_changed', 'users', $usuario, ['status' => $estado, 'by' => $u->id]);

        return ['id' => $usuario, 'estado' => $estado, 'estado_name' => Equipos::ESTADOS_AGENTE[$estado]];
    }

    private static function mediana(array $xs): ?float
    {
        $xs = array_values(array_filter($xs, fn ($x) => $x !== null));
        if (! $xs) {
            return null;
        }
        sort($xs);
        $n = count($xs);

        return $n % 2 ? (float) $xs[intdiv($n, 2)] : round(($xs[$n / 2 - 1] + $xs[$n / 2]) / 2, 1);
    }
}
