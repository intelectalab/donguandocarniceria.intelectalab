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
 * CRM-16 Encuesta posentrega (RN-CRM-20): a las crm_survey_delay_hours (2 h) de entregado un pedido se envía una encuesta
 * por el chat del pedido. Dentro de la ventana de servicio va como mensaje; fuera de ella, como plantilla de utilidad si
 * el pedido no agotó sus crm_utility_templates_per_order; si las agotó (o no hay chat), queda «no enviada». Si el cliente
 * marca «no recibí lo que pedí» se crea una tarea de seguimiento; si marca «compré algo que no está en la web», además
 * una alerta de control.
 */
class Encuestas
{
    public const ENVIOS = ['SESSION' => 'En la ventana', 'TEMPLATE' => 'Plantilla de utilidad', 'NOT_SENT' => 'No enviada'];

    public const SENALES = ['NO_RECIBIO' => 'No recibió lo que pidió', 'FUERA_WEB' => 'Compró algo que no está en la web', 'SIN_RESPUESTA' => 'Sin respuesta'];

    public const TEXTO = '¿Cómo te fue con tu pedido {{pedido}}? Califica del 1 al 5 la atención y el producto, y dinos si recibiste lo que pediste.';

    /** Programa y envía las encuestas que tocan (dentro de la empresa ya fijada). Solo pedidos entregados en las últimas 48 h. */
    public static function enviarPendientes(?Carbon $ahora = null): array
    {
        $ahora ??= now();
        $retraso = (int) (Params::get('crm_survey_delay_hours') ?? 2);
        $pedidos = DB::table('sales_orders as o')->join('customers as c', 'c.id', '=', 'o.customer_id')->whereIn('o.status', ['DELIVERED', 'CLOSED'])
            ->whereNotNull('o.delivered_at')->whereBetween('o.delivered_at', [$ahora->copy()->subHours(48), $ahora->copy()->subHours($retraso)])
            ->where('o.channel', '<>', 'COUNTER')->where('c.full_name', 'not ilike', 'clientes varios%')
            ->whereNotExists(fn ($x) => $x->from('delivery_surveys as s')->whereColumn('s.order_id', 'o.id'))
            ->get(['o.*']);
        $n = ['SESSION' => 0, 'TEMPLATE' => 0, 'NOT_SENT' => 0];
        foreach ($pedidos as $o) {
            $n[self::enviar($o, $ahora)]++;
        }

        return $n;
    }

    private static function enviar(object $o, Carbon $ahora): string
    {
        return DB::transaction(function () use ($o, $ahora) {
            $modo = 'NOT_SENT';
            $mensaje = null;
            $link = DB::table('conversation_orders')->where('order_id', $o->id)->value('conversation_id');
            $cv = $link ? Conversaciones::fila($link) : null;
            $ch = $cv ? DB::table('messaging_channels')->where('id', $cv->channel_id)->first() : null;
            if ($cv && $ch && $ch->connection_mode !== 'APP_ONLY') {
                $vars = Plantillas::variables($cv, $o);
                $ventana = $cv->service_window_expires_at && Carbon::parse($cv->service_window_expires_at)->gte($ahora);
                if ($ventana) {
                    $r = Plantillas::rellenar(self::TEXTO, $vars);
                    $mensaje = Mensajes::salir($cv, $ch, ['body' => $r['texto'], 'msg_type' => 'TEXT', 'category' => 'SERVICE', 'origin' => 'SYSTEM', 'order_id' => $o->id])['id'];
                    $modo = 'SESSION';
                } elseif ($ch->kind === 'WHATSAPP' && Plantillas::utilidadDelPedido($o->id) < Plantillas::tope()) {
                    $t = DB::table('message_templates')->where('purpose', 'POST_DELIVERY_SURVEY')->where('provider_status', 'APPROVED')
                        ->where(fn ($w) => $w->where('brand_id', $cv->brand_id)->orWhereNull('brand_id'))->orderByRaw('brand_id IS NULL')->first();
                    $r = $t ? Plantillas::rellenar($t->body, $vars) : null;
                    if ($t && ! $r['faltan']) {
                        $mensaje = Mensajes::salir($cv, $ch, ['body' => $r['texto'], 'msg_type' => 'TEMPLATE', 'category' => $t->category, 'template_id' => $t->id,
                            'origin' => 'SYSTEM', 'order_id' => $o->id])['id'];
                        $modo = 'TEMPLATE';
                    }
                }
            }
            $id = DB::table('delivery_surveys')->insertGetId(['order_id' => $o->id, 'customer_id' => $o->customer_id, 'seller_user_id' => $o->seller_id, 'brand_id' => $o->brand_id,
                'sent_at' => $ahora, 'send_mode' => $modo, 'message_id' => $mensaje, 'created_at' => now(), 'updated_at' => now()], 'id');
            Events::emit('survey.sent', 'delivery_surveys', $id, ['order' => $o->id, 'mode' => $modo]);

            return $modo;
        });
    }

    private static function base(User $u)
    {
        $marcas = Access::for($u)['brands'];

        return DB::table('delivery_surveys as s')->when($marcas, fn ($w) => $w->whereIn('s.brand_id', $marcas));
    }

    private static function filtros($q, array $f)
    {
        foreach (['marca' => 's.brand_id', 'vendedora' => 's.seller_user_id', 'envio' => 's.send_mode'] as $k => $col) {
            if (! empty($f[$k])) {
                $q->where($col, $f[$k]);
            }
        }
        if (! empty($f['desde'])) {
            $q->where('s.sent_at', '>=', Carbon::parse($f['desde'], 'America/Lima')->startOfDay());
        }
        if (! empty($f['hasta'])) {
            $q->where('s.sent_at', '<=', Carbon::parse($f['hasta'], 'America/Lima')->endOfDay());
        }
        $t = trim((string) ($f['buscar'] ?? ''));
        if (mb_strlen($t) >= 2) {
            $p = '%'.addcslashes($t, '%_\\').'%';
            $q->where(fn ($w) => $w->where('o.number', 'ilike', $p)->orWhere('c.full_name', 'ilike', $p)->orWhere('c.phone', 'ilike', $p)->orWhere('s.comments', 'ilike', $p));
        }

        return $q;
    }

    public static function lista(array $f, User $u): array
    {
        $join = fn ($q) => $q->join('sales_orders as o', 'o.id', '=', 's.order_id')->join('customers as c', 'c.id', '=', 's.customer_id')
            ->leftJoin('brands as b', 'b.id', '=', 's.brand_id')->leftJoin('users as x', 'x.id', '=', 's.seller_user_id');
        $q = self::filtros($join(self::base($u)), $f);
        $c = (clone $q)->selectRaw("count(*) AS enviadas, count(*) FILTER (WHERE s.send_mode <> 'NOT_SENT') AS salieron, count(s.answered_at) AS respondidas,
            avg(s.rating_service) AS atencion, avg(s.rating_product) AS producto, count(*) FILTER (WHERE s.received_as_ordered = false) AS no_recibio,
            count(*) FILTER (WHERE s.bought_outside_catalog) AS fuera_web, count(*) FILTER (WHERE s.send_mode = 'NOT_SENT') AS no_enviadas")->first();
        $porVendedora = (clone $q)->whereNotNull('s.answered_at')->whereNotNull('s.seller_user_id')->groupBy('x.name')
            ->selectRaw('x.name AS nombre, avg(s.rating_service) AS valor, count(*) AS n')->orderByDesc('valor')->get()
            ->map(fn ($x) => ['nombre' => $x->nombre, 'valor' => round((float) $x->valor, 2), 'n' => (int) $x->n])->all();
        $porMarca = (clone $q)->whereNotNull('s.answered_at')->groupBy('b.name')->selectRaw('b.name AS nombre, avg(s.rating_service) AS valor, count(*) AS n')->orderByDesc('valor')->get()
            ->map(fn ($x) => ['nombre' => $x->nombre, 'valor' => round((float) $x->valor, 2), 'n' => (int) $x->n])->all();
        match ($f['senal'] ?? '') {
            'NO_RECIBIO' => $q->where('s.received_as_ordered', false),
            'FUERA_WEB' => $q->where('s.bought_outside_catalog', true),
            'SIN_RESPUESTA' => $q->whereNull('s.answered_at')->where('s.send_mode', '<>', 'NOT_SENT'),
            default => null,
        };
        $q->orderByDesc('s.sent_at')->orderBy('s.id');
        Paginas::ordenar($q, ['pedido' => 'o.number', 'cliente' => 'c.full_name', 'marca' => 'b.name', 'vendedora' => 'x.name', 'enviada' => 's.sent_at',
            'atencion' => 's.rating_service', 'producto' => 's.rating_product'], 's.id', $f);
        $q->select(['s.*', 'o.number', 'c.full_name', 'c.trade_name', 'c.phone', 'b.name as marca', 'x.name as vendedora',
            DB::raw('(SELECT conversation_id FROM conversation_orders co WHERE co.order_id = s.order_id) AS conversation_id')]);
        $r = Paginas::de($q, fn ($s) => self::presentar($s), $f);
        $abribles = Conversaciones::visibles($u)->whereIn('v.id', array_filter(array_column($r['data'], 'conversation_id')))->pluck('v.id')->all();
        foreach ($r['data'] as &$fila) {
            $fila['conversation_id'] = in_array($fila['conversation_id'], $abribles, true) ? $fila['conversation_id'] : null;
        }
        unset($fila);
        $marcas = Access::for($u)['brands'];

        return $r + [
            'cifras' => ['enviadas' => (int) $c->enviadas, 'salieron' => (int) $c->salieron, 'respondidas' => (int) $c->respondidas, 'no_enviadas' => (int) $c->no_enviadas,
                'atencion' => $c->atencion !== null ? round((float) $c->atencion, 2) : null, 'producto' => $c->producto !== null ? round((float) $c->producto, 2) : null,
                'no_recibio' => (int) $c->no_recibio, 'fuera_web' => (int) $c->fuera_web],
            'por_vendedora' => $porVendedora, 'por_marca' => $porMarca,
            'reglas' => ['horas' => (int) (Params::get('crm_survey_delay_hours') ?? 2), 'tope' => Plantillas::tope()],
            'opciones' => [
                'senales' => collect(self::SENALES)->map(fn ($l, $k) => ['value' => $k, 'label' => $l])->values()->all(),
                'envios' => collect(self::ENVIOS)->map(fn ($l, $k) => ['value' => $k, 'label' => $l])->values()->all(),
                'marcas' => DB::table('brands')->when($marcas, fn ($w) => $w->whereIn('id', $marcas))->where('status', 'ACTIVE')->orderBy('name')
                    ->get(['id', 'name'])->map(fn ($b) => ['value' => $b->id, 'label' => $b->name])->all(),
                'vendedoras' => DB::table('users as x')->whereIn('x.id', self::base($u)->whereNotNull('s.seller_user_id')->select('s.seller_user_id'))->orderBy('x.name')
                    ->get(['x.id', 'x.name'])->map(fn ($x) => ['value' => $x->id, 'label' => $x->name])->all(),
            ],
            'puede' => ['responder' => self::puedeResponder($u)],
        ];
    }

    private static function presentar(object $s): array
    {
        return [
            'id' => $s->id, 'order_id' => $s->order_id, 'pedido' => $s->number, 'customer_id' => $s->customer_id, 'cliente' => $s->trade_name ?: $s->full_name, 'celular' => $s->phone,
            'marca' => $s->marca, 'vendedora' => $s->vendedora, 'sent_at' => $s->sent_at, 'send_mode' => $s->send_mode, 'envio' => self::ENVIOS[$s->send_mode] ?? $s->send_mode,
            'answered_at' => $s->answered_at, 'rating_service' => $s->rating_service !== null ? (int) $s->rating_service : null,
            'rating_product' => $s->rating_product !== null ? (int) $s->rating_product : null,
            'received_as_ordered' => $s->received_as_ordered === null ? null : (bool) $s->received_as_ordered,
            'bought_outside_catalog' => $s->bought_outside_catalog === null ? null : (bool) $s->bought_outside_catalog,
            'comments' => $s->comments, 'conversation_id' => $s->conversation_id,
        ];
    }

    private static function puedeResponder(User $u): bool
    {
        return Access::can($u, 'crm.survey.view') && (Access::can($u, 'crm.conversation.reply') || Access::can($u, 'crm.conversation.reassign'));
    }

    /**
     * Registra la respuesta que el cliente dio en el chat (una sola vez). «No recibí lo que pedí» crea la tarea de
     * seguimiento para la vendedora; «compré algo que no está en la web», además, la alerta de control.
     */
    public static function responder(string $id, array $d, User $u): array
    {
        if (! self::puedeResponder($u)) {
            RuleError::fail('RN-CRM-20', 'Tu rol no registra respuestas de encuestas.');
        }
        $s = self::base($u)->where('s.id', $id)->first(['s.*']) ?? abort(404);
        if ($s->answered_at) {
            RuleError::fail('RN-CRM-20', 'La encuesta ya tiene respuesta: no se cambia.');
        }
        if ($s->send_mode === 'NOT_SENT') {
            RuleError::fail('RN-CRM-20', 'La encuesta no se envió: no hay respuesta que registrar.');
        }
        $ahora = now();
        $comentario = isset($d['comments']) ? (trim((string) $d['comments']) ?: null) : null;
        DB::transaction(function () use ($s, $d, $u, $ahora, $comentario) {
            DB::table('delivery_surveys')->where('id', $s->id)->whereNull('answered_at')->update(['answered_at' => $ahora, 'answered_by' => $u->id,
                'rating_service' => $d['rating_service'], 'rating_product' => $d['rating_product'], 'received_as_ordered' => (bool) $d['received_as_ordered'],
                'bought_outside_catalog' => (bool) $d['bought_outside_catalog'], 'comments' => $comentario ? mb_substr($comentario, 0, 1000) : null, 'updated_at' => $ahora]);
            $noRecibio = ! $d['received_as_ordered'];
            if ($noRecibio || $d['bought_outside_catalog']) {
                DB::table('crm_tasks')->insert(['task_type' => 'SURVEY_FOLLOW_UP', 'status' => 'OPEN', 'customer_id' => $s->customer_id, 'order_id' => $s->order_id, 'brand_id' => $s->brand_id,
                    'assigned_user_id' => $s->seller_user_id, 'due_at' => $ahora->copy()->addHours(24),
                    'note' => $noRecibio ? 'Respondió «no recibí lo que pedí»' : 'Respondió «compré algo que no está en la web»', 'created_at' => $ahora, 'updated_at' => $ahora]);
            }
            if ($d['bought_outside_catalog']) {
                $link = DB::table('conversation_orders')->where('order_id', $s->order_id)->value('conversation_id');
                Control::senal('SURVEY_FLAG', 'Compró algo que no está en la web', $s->seller_user_id, $comentario ?? 'Respuesta de la encuesta posentrega',
                    $link ? Conversaciones::fila($link) : null, null, 'SURVEY');
            }
            Events::emit('survey.answered', 'delivery_surveys', $s->id, ['by' => $u->id, 'rating_service' => $d['rating_service']]);
        });
        $fila = self::base($u)->where('s.id', $id)->join('sales_orders as o', 'o.id', '=', 's.order_id')->join('customers as c', 'c.id', '=', 's.customer_id')
            ->leftJoin('brands as b', 'b.id', '=', 's.brand_id')->leftJoin('users as x', 'x.id', '=', 's.seller_user_id')
            ->first(['s.*', 'o.number', 'c.full_name', 'c.trade_name', 'c.phone', 'b.name as marca', 'x.name as vendedora',
                DB::raw('(SELECT conversation_id FROM conversation_orders co WHERE co.order_id = s.order_id) AS conversation_id')]);

        return self::presentar($fila);
    }
}
