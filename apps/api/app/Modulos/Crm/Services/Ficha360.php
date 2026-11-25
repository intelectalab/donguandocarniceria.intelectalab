<?php

namespace App\Modulos\Crm\Services;

use App\Models\User;
use App\Modulos\Tel\Services\Llamadas;
use App\Modulos\Cli\Services\Clientes;
use App\Support\Access;
use App\Support\Paginas;
use Illuminate\Support\Facades\DB;

/**
 * CRM-04 Ficha 360 del cliente: datos, direcciones con pin, pedidos y saldos, chats de todos los números y redes, llamadas
 * (cuando TEL esté encendido), encuestas, consentimientos, recompra y valor de vida. La vendedora ve los clientes de las
 * conversaciones de sus números; la supervisión y la gerencia, todos los de sus marcas.
 */
class Ficha360
{
    public const PROPOSITOS = ['DATA_PROCESSING' => 'Tratamiento de datos', 'MARKETING' => 'Marketing', 'RECORDING_NOTICE' => 'Aviso de registro', 'SURVEY' => 'Encuestas'];

    public const TIPOS = ['PERSON' => 'Persona', 'RESTAURANT' => 'Restaurante', 'BUSINESS' => 'Empresa', 'CONSIGNMENT_POINT' => 'Punto de consignación', 'RELATED' => 'Vinculado', 'OTHER' => 'Otro'];

    public const RECOMPRA = ['NEW' => 'Nuevo', 'ACTIVE' => 'Al día', 'DUE' => 'Por avisar', 'AT_RISK' => 'En riesgo', 'LOST' => 'Perdido'];

    private static function base(User $u)
    {
        $q = DB::table('customers as c')->where('c.status', '<>', 'INACTIVE')->whereNull('c.merged_into_id');
        if (! Access::can($u, 'crm.conversation.view_all')) {
            // La vendedora: los clientes de las conversaciones que puede ver.
            $q->whereIn('c.id', Conversaciones::visibles($u)->whereNotNull('v.customer_id')->select('v.customer_id'));
        } elseif ($marcas = Access::for($u)['brands']) {
            $q->where(fn ($w) => $w->whereExists(fn ($x) => $x->from('sales_orders as o')->whereColumn('o.customer_id', 'c.id')->whereIn('o.brand_id', $marcas))
                ->orWhereExists(fn ($x) => $x->from('conversations as v')->whereColumn('v.customer_id', 'c.id')->whereIn('v.brand_id', $marcas)));
        }

        return $q;
    }

    public static function lista(array $f, User $u): array
    {
        $q = self::base($u);
        $t = trim((string) ($f['buscar'] ?? ''));
        if (mb_strlen($t) >= 2) {
            $p = '%'.addcslashes($t, '%_\\').'%';
            $q->where(fn ($w) => $w->where('c.full_name', 'ilike', $p)->orWhere('c.trade_name', 'ilike', $p)->orWhere('c.phone', 'ilike', $p)->orWhere('c.doc_number', 'ilike', $p));
        }
        if (! empty($f['tipo'])) {
            $q->where('c.customer_type', $f['tipo']);
        }
        if (! empty($f['con_chat'])) {
            $q->whereExists(fn ($x) => $x->from('conversations as v')->whereColumn('v.customer_id', 'c.id'));
        }
        $q->orderByDesc('c.last_order_at')->orderBy('c.full_name');
        Paginas::ordenar($q, ['nombre' => 'c.full_name', 'pedidos' => 'c.orders_count', 'ultimo' => 'c.last_order_at'], 'c.id', $f);
        $q->select(['c.id', 'c.full_name', 'c.trade_name', 'c.phone', 'c.customer_type', 'c.orders_count', 'c.last_order_at',
            DB::raw('(SELECT count(*) FROM conversations v WHERE v.customer_id = c.id) AS chats')]);

        $r = Paginas::de($q, fn ($c) => ['id' => $c->id, 'nombre' => $c->trade_name ?: $c->full_name, 'full_name' => $c->full_name, 'phone' => $c->phone,
            'tipo' => self::TIPOS[$c->customer_type] ?? $c->customer_type, 'pedidos' => (int) $c->orders_count, 'ultimo' => $c->last_order_at, 'chats' => (int) $c->chats], $f)
            + ['puede' => Access::can($u, 'crm.customer.view_full'), 'tipos' => collect(self::TIPOS)->map(fn ($l, $k) => ['value' => $k, 'label' => $l])->values()->all()];

        return $r;
    }

    /** Las llamadas del cliente (con Telefonía encendida): la vendedora solo las suyas, la supervisión todas. */
    private static function llamadas(string $cliente, User $u): array
    {
        $q = DB::table('tel_calls as c')->leftJoin('users as x', 'x.id', '=', 'c.user_id')->leftJoin('sales_orders as o', 'o.id', '=', 'c.order_id')->where('c.customer_id', $cliente);
        if (! Access::can($u, 'tel.call.view_all')) {
            $q->where('c.user_id', $u->id);
        }

        return $q->orderByDesc('c.started_at')->limit(100)->get(['c.id', 'c.direction', 'c.status', 'c.started_at', 'c.duration_seconds', 'c.wait_seconds', 'x.name as vendedora', 'o.number as pedido'])
            ->map(fn ($c) => ['id' => $c->id, 'direccion' => $c->direction === 'INBOUND' ? 'Entrante' : 'Saliente', 'status' => $c->status,
                'estado' => Llamadas::ESTADOS[$c->status] ?? $c->status, 'at' => $c->started_at, 'duracion' => (int) $c->duration_seconds,
                'espera' => (int) $c->wait_seconds, 'vendedora' => $c->vendedora, 'pedido' => $c->pedido])->all();
    }

    public static function ver(string $id, User $u): array
    {
        $c = self::base($u)->where('c.id', $id)->first(['c.*']) ?? abort(404);
        $pedidos = DB::table('sales_orders as o')->leftJoin('brands as b', 'b.id', '=', 'o.brand_id')->leftJoin('users as x', 'x.id', '=', 'o.seller_id')
            ->where('o.customer_id', $id)->orderByDesc('o.created_at')->limit(100)
            ->get(['o.id', 'o.number', 'o.status', 'o.channel', 'o.created_at', 'o.estimated_total', 'o.final_total', 'o.paid_amount', 'b.name as marca', 'x.name as vendedora']);
        $cobrado = (float) DB::table('payments')->where('customer_id', $id)->where('status', 'CONFIRMED')->sum('amount');
        $porCobrar = Clientes::porCobrar($id);
        $contactos = DB::table('channel_contacts')->where('customer_id', $id)->pluck('id');
        $visibles = Conversaciones::visibles($u)->where('v.customer_id', $id)->pluck('v.id')->all();
        $chats = DB::table('conversations as v')->join('messaging_channels as m', 'm.id', '=', 'v.channel_id')->leftJoin('users as x', 'x.id', '=', 'v.assigned_user_id')
            ->where('v.customer_id', $id)->orderByDesc('v.opened_at')
            ->get(['v.id', 'v.status', 'v.opened_at', 'v.entry_point', 'v.ad_code', 'm.kind', 'm.display_name', 'x.name as atendio'])
            ->map(fn ($v) => ['id' => $v->id, 'status' => $v->status, 'status_name' => Conversaciones::ESTADOS[$v->status] ?? $v->status, 'opened_at' => $v->opened_at,
                'canal' => (Canales::REDES[$v->kind] ?? $v->kind).' · '.$v->display_name, 'entrada' => (Conversaciones::ENTRADAS[$v->entry_point] ?? $v->entry_point).($v->ad_code ? " {$v->ad_code}" : ''),
                'atendio' => $v->atendio, 'visible' => in_array($v->id, $visibles, true)])->all();
        $encuestas = DB::table('delivery_surveys as s')->leftJoin('sales_orders as o', 'o.id', '=', 's.order_id')->where('s.customer_id', $id)->orderByDesc('s.sent_at')
            ->get(['s.id', 'o.number', 's.sent_at', 's.answered_at', 's.rating_service', 's.rating_product', 's.received_as_ordered', 's.bought_outside_catalog', 's.comments'])->all();
        $consent = DB::table('contact_consents')->where(fn ($q) => $q->where('customer_id', $id)->when($contactos->isNotEmpty(), fn ($w) => $w->orWhereIn('contact_id', $contactos)))
            ->orderByDesc('recorded_at')->get(['id', 'purpose', 'granted', 'channel', 'evidence_text', 'recorded_at', 'recorded_by'])
            ->map(fn ($k) => (array) $k + ['purpose_name' => self::PROPOSITOS[$k->purpose] ?? $k->purpose])->all();
        $recompra = DB::table('customer_rebuy_profiles as p')->leftJoin('brands as b', 'b.id', '=', 'p.brand_id')->where('p.customer_id', $id)->orderBy('b.name')
            ->get(['p.id', 'b.name as marca', 'p.orders_count', 'p.median_interval_days', 'p.last_order_at', 'p.next_expected_at', 'p.status'])
            ->map(fn ($p) => (array) $p + ['status_name' => self::RECOMPRA[$p->status] ?? $p->status])->all();
        $tel = (bool) DB::table('tenant_modules')->where('module_code', 'TEL')->where('enabled', true)->exists();

        return [
            'id' => $c->id, 'nombre' => $c->trade_name ?: $c->full_name, 'full_name' => $c->full_name, 'trade_name' => $c->trade_name, 'phone' => $c->phone, 'phone_alt' => $c->phone_alt,
            'email' => $c->email, 'documento' => $c->doc_number ? trim("{$c->doc_type} {$c->doc_number}") : null, 'tipo' => self::TIPOS[$c->customer_type] ?? $c->customer_type,
            'canal_origen' => $c->source_channel, 'creado' => $c->created_at, 'bloqueado' => $c->blocked_reason,
            'cifras' => [
                'pedidos' => $pedidos->whereNotIn('status', ['CANCELLED', 'DRAFT'])->count(), 'valor_vida' => round($cobrado, 2), 'por_cobrar' => round((float) $porCobrar['total'], 2),
                'saldo_favor' => Clientes::saldo($id), 'chats' => count($chats), 'marketing' => Consentimientos::marketing($id, null),
            ],
            'direcciones' => DB::table('customer_addresses')->where('customer_id', $id)->where('status', '<>', 'INACTIVE')->orderByDesc('is_default')
                ->get(['id', 'label', 'address_line', 'district', 'reference', 'lat', 'lng', 'is_default'])->all(),
            'pedidos' => $pedidos->map(fn ($o) => ['id' => $o->id, 'number' => $o->number, 'status' => $o->status, 'canal' => $o->channel, 'marca' => $o->marca, 'at' => $o->created_at,
                'total' => (float) ($o->final_total ?? $o->estimated_total), 'pagado' => (float) $o->paid_amount, 'vendedora' => $o->vendedora])->all(),
            'chats' => $chats, 'encuestas' => $encuestas, 'consentimientos' => $consent, 'recompra' => $recompra,
            'llamadas' => $tel ? self::llamadas($id, $u) : null,
        ];
    }
}
