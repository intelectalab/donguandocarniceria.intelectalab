<?php

namespace App\Modulos\Crm\Services;

use App\Models\User;
use App\Support\Access;
use App\Support\Events;
use App\Support\Paginas;
use App\Support\RuleError;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * CRM-05 Leads: el embudo NUEVO → CONTACTADO → CALIFICADO → GANADO o PERDIDO / DESCARTADO, por marca, red, número,
 * anuncio y vendedora. Un lead se gana solo con su pedido desde el chat (RN-CRM-09) y se pierde con motivo. Un número que
 * ya es cliente no es lead (RN-CRM-10).
 */
class Leads
{
    /** Columnas del tablero kanban y cuántas tarjetas trae cada una (las más recientes). */
    public const TABLERO = ['NEW', 'CONTACTED', 'QUALIFIED', 'WON', 'LOST'];

    public const POR_COLUMNA = 25;

    public const ESTADOS = ['NEW' => 'Nuevo', 'CONTACTED' => 'Contactado', 'QUALIFIED' => 'Calificado', 'WON' => 'Ganado', 'LOST' => 'Perdido', 'DISCARDED' => 'Descartado'];

    public const MOTIVOS = ['PRICE' => 'Precio', 'NO_STOCK' => 'Sin stock', 'OUT_OF_ZONE' => 'Fuera de zona', 'NO_RESPONSE' => 'No respondió', 'DELIVERY_TIME' => 'Plazo de entrega',
        'PRODUCT_NOT_OFFERED' => 'Producto que no vendemos', 'DUPLICATE' => 'Duplicado', 'SPAM' => 'Spam', 'OTHER' => 'Otro'];

    public const ORIGENES = ['WHATSAPP' => 'WhatsApp', 'MESSENGER' => 'Messenger', 'INSTAGRAM' => 'Instagram', 'TIKTOK' => 'TikTok', 'PHONE' => 'Teléfono',
        'WALK_IN' => 'Visita al local', 'REFERRAL' => 'Referido', 'WEB_FORM' => 'Formulario web', 'OTHER' => 'Otro'];

    public const MANUALES = ['PHONE', 'WALK_IN', 'REFERRAL', 'WEB_FORM', 'OTHER'];

    private static function base(User $u)
    {
        $a = Access::for($u);
        $q = DB::table('leads as l')->when($a['brands'], fn ($w) => $w->whereIn('l.brand_id', $a['brands']));
        if (! Access::can($u, 'crm.conversation.view_all')) {
            $q->where(fn ($w) => $w->where('l.owner_user_id', $u->id)->orWhereExists(fn ($x) => $x->from('channel_members as m')->whereColumn('m.channel_id', 'l.channel_id')
                ->where('m.user_id', $u->id)->where('m.active', true)));
        }

        return $q;
    }

    public static function lista(array $f, User $u): array
    {
        $q = self::base($u);
        if (! empty($f['desde'])) {
            $q->where('l.first_contact_at', '>=', Carbon::parse($f['desde'], 'America/Lima')->startOfDay());
        }
        if (! empty($f['hasta'])) {
            $q->where('l.first_contact_at', '<=', Carbon::parse($f['hasta'], 'America/Lima')->endOfDay());
        }
        foreach (['marca' => 'l.brand_id', 'red' => 'l.source', 'canal' => 'l.channel_id'] as $k => $col) {
            if (! empty($f[$k])) {
                $q->where($col, $f[$k]);
            }
        }
        if (($f['anuncio'] ?? '') !== '') {
            $f['anuncio'] === '1' ? $q->whereNotNull('l.ad_code') : $q->whereNull('l.ad_code');
        }
        if (! empty($f['vendedora'])) {
            $q->where(fn ($w) => $w->where('l.owner_user_id', $f['vendedora'])->orWhereExists(fn ($x) => $x->from('conversations as v')->whereColumn('v.lead_id', 'l.id')->where('v.assigned_user_id', $f['vendedora'])));
        }
        $t = trim((string) ($f['buscar'] ?? ''));
        if (mb_strlen($t) >= 2) {
            $p = '%'.addcslashes($t, '%_\\').'%';
            $q->where(fn ($w) => $w->where('l.full_name', 'ilike', $p)->orWhere('l.phone', 'ilike', $p)->orWhere('l.ad_code', 'ilike', $p));
        }
        $embudo = (clone $q)->selectRaw('l.status, count(*) AS n')->groupBy('l.status')->pluck('n', 'status');
        if (! empty($f['estado']) && empty($f['tablero'])) {
            $q->where('l.status', $f['estado']);
        }
        $q->leftJoin('messaging_channels as c', 'c.id', '=', 'l.channel_id')->leftJoin('brands as b', 'b.id', '=', 'l.brand_id')
            ->leftJoin('users as x', 'x.id', '=', DB::raw('coalesce(l.owner_user_id, (SELECT v.assigned_user_id FROM conversations v WHERE v.lead_id = l.id ORDER BY v.opened_at DESC LIMIT 1))'))
            ->orderByDesc('l.first_contact_at');
        Paginas::ordenar($q, ['nombre' => 'l.full_name', 'primer_contacto' => 'l.first_contact_at', 'estado' => 'l.status', 'marca' => 'b.name', 'canal' => 'c.display_name', 'vendedora' => 'x.name'], 'l.id', $f);
        $q->select(['l.*', 'c.display_name as canal', 'b.name as marca', 'x.name as vendedora']);
        $mes = now('America/Lima')->startOfMonth();
        $delMes = self::base($u)->where('l.first_contact_at', '>=', $mes);
        $creados = (clone $delMes)->count();
        $ganados = (clone $delMes)->where('l.status', 'WON')->count();

        if (! empty($f['tablero'])) {
            // Kanban: las más recientes de cada columna; el total de cada una sale del embudo.
            $filas = collect(self::TABLERO)->flatMap(fn ($e) => (clone $q)->where('l.status', $e)->limit(self::POR_COLUMNA)->get())->values();
            $chats = $filas->isEmpty() ? collect() : Conversaciones::visibles($u)->whereIn('v.lead_id', $filas->pluck('id'))->orderByDesc('v.opened_at')
                ->get(['v.id', 'v.lead_id'])->unique('lead_id')->pluck('id', 'lead_id');
            $datos = $filas->map(fn ($l) => self::presentar($l) + ['conversacion' => $chats[$l->id] ?? null])->all();
            $r = ['data' => $datos, 'current_page' => 1, 'last_page' => 1, 'per_page' => max(1, count($datos)), 'total' => count($datos), 'por_columna' => self::POR_COLUMNA];
        }

        return ($r ?? Paginas::de($q, fn ($l) => self::presentar($l), $f)) + [
            'embudo' => collect(self::ESTADOS)->map(fn ($n, $k) => ['estado' => $k, 'nombre' => $n, 'n' => (int) ($embudo[$k] ?? 0)])->values()->all(),
            'conversion' => ['creados' => $creados, 'ganados' => $ganados, 'pct' => $creados ? round($ganados / $creados * 100, 1) : null],
            'opciones' => self::opciones($u),
            'puede' => Access::can($u, 'crm.lead.manage'),
        ];
    }

    public static function ver(string $id, User $u): array
    {
        $l = self::base($u)->where('l.id', $id)->leftJoin('messaging_channels as c', 'c.id', '=', 'l.channel_id')->leftJoin('brands as b', 'b.id', '=', 'l.brand_id')
            ->leftJoin('users as x', 'x.id', '=', 'l.owner_user_id')->first(['l.*', 'c.display_name as canal', 'b.name as marca', 'x.name as vendedora']) ?? abort(404);
        $cv = DB::table('conversations')->where('lead_id', $id)->orderByDesc('opened_at')->first(['id', 'status']);

        return self::presentar($l) + [
            'notes' => $l->notes, 'first_response_at' => $l->first_response_at, 'converted_at' => $l->converted_at,
            'pedido' => $l->converted_order_id ? DB::table('sales_orders')->where('id', $l->converted_order_id)->value('number') : null,
            'conversacion' => $cv && Conversaciones::visibles($u)->where('v.id', $cv->id)->exists() ? $cv->id : null,
        ];
    }

    /** Calificar, descartar o perder (con motivo). Ganado solo con el pedido desde el chat. */
    public static function cambiarEstado(string $id, string $estado, ?string $motivo, ?string $nota, User $u): array
    {
        $l = self::base($u)->where('l.id', $id)->first(['l.*']) ?? abort(404);
        if ($estado === 'WON') {
            RuleError::fail('RN-CRM-09', 'Un lead pasa a ganado solo al crear su pedido desde el chat.');
        }
        if ($l->status === 'WON') {
            RuleError::fail('RN-CRM-09', 'El lead ya está ganado: tiene pedido.');
        }
        if ($estado === 'LOST' && ! isset(self::MOTIVOS[(string) $motivo])) {
            RuleError::fail('RN-CRM-09', 'Para marcar el lead como perdido elige el motivo.');
        }
        $notas = $nota && trim($nota) !== '' ? trim(implode(' · ', array_filter([$l->notes, now('America/Lima')->format('d/m').' '.$u->name.': '.trim($nota)]))) : $l->notes;
        DB::table('leads')->where('id', $id)->update(['status' => $estado, 'lost_reason' => $estado === 'LOST' ? $motivo : null, 'notes' => $notas ? mb_substr($notas, 0, 2000) : null,
            'owner_user_id' => $l->owner_user_id ?? $u->id, 'updated_at' => now()]);
        Events::emit('lead.status_changed', 'leads', $id, ['from' => $l->status, 'to' => $estado, 'reason' => $motivo, 'by' => $u->id]);

        return self::ver($id, $u);
    }

    /** Lead cargado a mano (teléfono, visita, referido, formulario). */
    public static function crear(array $d, User $u): array
    {
        $tel = '+'.ltrim(preg_replace('/[^\d+]/', '', (string) $d['phone']), '+');
        if (preg_match('/^9\d{8}$/', ltrim($tel, '+'))) {
            $tel = '+51'.ltrim($tel, '+');
        }
        if (! preg_match('/^\+519\d{8}$/', $tel) && ! preg_match('/^\+[1-9]\d{7,14}$/', $tel)) {
            RuleError::fail('RN-CRM-10', 'El celular va en formato internacional: +51 seguido de 9 dígitos.');
        }
        $marcas = Access::for($u)['brands'];
        if (($marcas && ! in_array($d['brand_id'], $marcas, true)) || ! DB::table('brands')->where('id', $d['brand_id'])->exists()) {
            RuleError::fail('RN-CRM-10', 'Elige una marca de tu alcance.');
        }
        if ($c = DB::table('customers')->where('phone', $tel)->first(['full_name'])) {
            RuleError::fail('RN-CRM-10', "{$c->full_name} ya es cliente con ese celular: no se crea un lead.");
        }
        if (DB::table('leads')->where('phone', $tel)->whereNotIn('status', ['LOST', 'DISCARDED', 'WON'])->exists()) {
            RuleError::fail('RN-CRM-10', 'Ya hay un lead abierto con ese celular.');
        }
        $id = DB::table('leads')->insertGetId(['brand_id' => $d['brand_id'], 'channel_id' => null, 'full_name' => mb_substr(trim($d['full_name']), 0, 120), 'phone' => $tel,
            'source' => $d['source'], 'owner_user_id' => $u->id, 'status' => 'NEW', 'first_contact_at' => now(), 'notes' => isset($d['notes']) ? mb_substr(trim((string) $d['notes']), 0, 2000) ?: null : null,
            'created_at' => now(), 'updated_at' => now()], 'id');
        Events::emit('lead.created', 'leads', $id, ['source' => $d['source'], 'by' => $u->id]);

        return self::ver($id, $u);
    }

    private static function opciones(User $u): array
    {
        $o = fn (array $a) => collect($a)->map(fn ($l, $k) => ['value' => $k, 'label' => $l])->values()->all();
        $a = Access::for($u);

        return ['estados' => $o(self::ESTADOS), 'motivos' => $o(self::MOTIVOS), 'redes' => $o(self::ORIGENES), 'manuales' => $o(array_intersect_key(self::ORIGENES, array_flip(self::MANUALES))),
            'marcas' => DB::table('brands')->when($a['brands'], fn ($w) => $w->whereIn('id', $a['brands']))->orderBy('name')->get(['id as value', 'name as label'])->all(),
            'canales' => Canales::visibles($u)->orderBy('c.display_name')->get(['c.id as value', 'c.display_name as label'])->all(),
            'vendedoras' => DB::table('channel_members as m')->join('users as x', 'x.id', '=', 'm.user_id')->where('m.member_role', 'AGENT')->where('m.active', true)
                ->select('x.id as value', 'x.name as label')->distinct()->orderBy('label')->get()->all()];
    }

    private static function presentar(object $l): array
    {
        return [
            'id' => $l->id, 'full_name' => $l->full_name, 'phone' => $l->phone, 'source' => $l->source, 'source_name' => self::ORIGENES[$l->source] ?? $l->source,
            'canal' => $l->canal ?? null, 'marca' => $l->marca ?? null, 'brand_id' => $l->brand_id, 'ad_code' => $l->ad_code, 'vendedora' => $l->vendedora ?? null,
            'first_contact_at' => $l->first_contact_at, 'status' => $l->status, 'status_name' => self::ESTADOS[$l->status] ?? $l->status,
            'lost_reason' => $l->lost_reason, 'lost_name' => $l->lost_reason ? (self::MOTIVOS[$l->lost_reason] ?? $l->lost_reason) : null,
        ];
    }
}
